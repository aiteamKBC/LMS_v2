from datetime import date
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .period import build_review_period
from .review_pack import (
    NOT_AVAILABLE,
    _build_evidence_sections,
    _normalize_training_plan_details,
    build_ksb_progress,
    build_review_pack,
    completed_component_ids,
    ksb_parent_code,
    ksb_type_code,
    progress_counts_as_achieved,
)

EVIDENCE_COLUMNS = (
    "id", "original_filename", "content_type", "size_bytes", "status", "scan_result",
    "section_ref", "uploaded_at", "Training_plan_details", "component_ref",
    "progress_entry_id", "container", "blob_name",
)


class _FakeCursor:
    def __init__(self, columns, rows):
        self.description = [(c,) for c in columns]
        self._rows = rows

    def execute(self, *args, **kwargs):
        pass

    def fetchall(self):
        return self._rows

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class _FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self._cursor


class ProgressCountsAsAchievedTests(SimpleTestCase):
    def test_none_record_is_not_achieved(self):
        self.assertFalse(progress_counts_as_achieved(None))

    def test_explicit_failure_is_never_achieved_even_for_non_graded_kinds(self):
        self.assertFalse(progress_counts_as_achieved({"kind": "video", "passed": False}))

    def test_quiz_only_counts_when_passed(self):
        self.assertFalse(progress_counts_as_achieved({"kind": "quiz", "passed": None}))
        self.assertTrue(progress_counts_as_achieved({"kind": "quiz", "passed": True}))

    def test_non_graded_kind_counts_without_a_pass_flag(self):
        self.assertTrue(progress_counts_as_achieved({"kind": "video", "passed": None}))


class CompletedComponentIdsTests(SimpleTestCase):
    def test_collects_from_both_sources_deduplicated(self):
        detail = {
            "videoProgress": [{"componentId": "c1", "kind": "video", "passed": None}],
            "componentProgress": [
                {"componentId": "c1", "kind": "component", "passed": None},
                {"componentId": "c2", "kind": "quiz", "passed": True},
                {"componentId": "c3", "kind": "quiz", "passed": False},
            ],
        }
        self.assertEqual(completed_component_ids(detail), {"c1", "c2"})


class NormalizeTrainingPlanDetailsTests(SimpleTestCase):
    """Regression: "Learner"."evidence_files"."Training_plan_details" is a
    `json` column that some rows return already-decoded and others return as
    a raw JSON string — build_review_pack must not assume either shape."""

    def test_passes_through_an_already_decoded_dict(self):
        self.assertEqual(_normalize_training_plan_details({"componentTitle": "X"}), {"componentTitle": "X"})

    def test_decodes_a_json_string(self):
        self.assertEqual(_normalize_training_plan_details('{"componentTitle": "X"}'), {"componentTitle": "X"})

    def test_blank_or_invalid_or_missing_values_become_an_empty_dict(self):
        self.assertEqual(_normalize_training_plan_details(None), {})
        self.assertEqual(_normalize_training_plan_details(""), {})
        self.assertEqual(_normalize_training_plan_details("not json"), {})
        self.assertEqual(_normalize_training_plan_details("[1, 2]"), {})


class BuildEvidenceSectionsTests(SimpleTestCase):
    """Regression coverage for _build_evidence_sections against a real-shaped
    DB row, since the unit-level NormalizeTrainingPlanDetailsTests above only
    prove the helper works in isolation, not that the query path uses it."""

    @patch("learner_api.evidence_storage.azure_configured", return_value=False)
    @patch("learner_api.evidence._marking_status", return_value="")
    @patch("learner_api.evidence.ensure_evidence_tables")
    def test_a_json_string_training_plan_details_does_not_crash_the_pipeline(
        self, mock_ensure, mock_marking, mock_azure_configured,
    ):
        period = build_review_period(date(2026, 6, 15), review_number=1)
        row = (
            "ev-1", "brief.pdf", "application/pdf", 1024, "approved", "clean",
            "comp-1", date(2026, 5, 1), '{"componentTitle": "Campaign brief", "ksbCodes": ["K1"]}',
            "comp-1", 55, "evidence-approved", "a/b/brief.pdf",
        )
        fake_connection = _FakeConnection(_FakeCursor(EVIDENCE_COLUMNS, [row]))

        with patch("django.db.connections", {"enrolment": fake_connection}):
            warnings = []
            evidence, assignments, workplace = _build_evidence_sections("apprenticeship", 42, period, warnings)

        self.assertEqual(len(evidence), 1)
        self.assertEqual(evidence[0]["evidence_summary"], "Campaign brief")
        self.assertEqual(evidence[0]["ksb_mappings"], ["K1"])
        self.assertEqual(len(assignments), 1)  # linked via component_ref -> classified as an assignment
        self.assertEqual(workplace, [])

    @patch("learner_api.evidence_storage.azure_configured", return_value=False)
    @patch("learner_api.evidence._marking_status", return_value="")
    @patch("learner_api.evidence.ensure_evidence_tables")
    def test_an_already_decoded_dict_still_works(self, mock_ensure, mock_marking, mock_azure_configured):
        period = build_review_period(date(2026, 6, 15), review_number=1)
        row = (
            "ev-2", "photo.png", "image/png", 2048, "approved", "clean",
            "", date(2026, 5, 2), {"componentTitle": "Site visit"},
            None, None, "evidence-approved", "a/b/photo.png",
        )
        fake_connection = _FakeConnection(_FakeCursor(EVIDENCE_COLUMNS, [row]))

        with patch("django.db.connections", {"enrolment": fake_connection}):
            evidence, assignments, workplace = _build_evidence_sections("apprenticeship", 42, period, [])

        self.assertEqual(evidence[0]["evidence_summary"], "Site visit")
        self.assertEqual(assignments, [])
        self.assertEqual(len(workplace), 1)  # no component/progress link -> workplace evidence


class KsbCodeHelpersTests(SimpleTestCase):
    def test_ksb_parent_code_strips_subcodes(self):
        self.assertEqual(ksb_parent_code("k3.1"), "K3")
        self.assertEqual(ksb_parent_code(" b2 "), "B2")

    def test_ksb_type_code_recognises_full_words_and_letters(self):
        self.assertEqual(ksb_type_code("Knowledge"), "K")
        self.assertEqual(ksb_type_code("S"), "S")
        self.assertEqual(ksb_type_code(None, code="B4"), "B")
        self.assertEqual(ksb_type_code(None, code=""), "?")


class BuildKsbProgressTests(SimpleTestCase):
    def _detail(self, mappings, done_ids):
        components = [
            {
                "componentId": cid,
                "component": f"Activity {cid}",
                "module": "Module 1",
                "week": "Week 1",
                "type": "activity",
                "ksbMappings": mapping_list,
            }
            for cid, mapping_list in mappings.items()
        ]
        return {
            "components": components,
            "ksbs": [{"code": "K1", "type": "Knowledge", "description": "Understands X"}],
            "componentProgress": [{"componentId": cid, "kind": "component", "passed": None} for cid in done_ids],
            "videoProgress": [],
        }

    def test_not_started_when_nothing_done(self):
        detail = self._detail({"c1": [{"code": "K1", "weight": 5, "classification": "main"}]}, done_ids=[])
        progress = build_ksb_progress(detail)
        self.assertEqual(len(progress), 1)
        self.assertEqual(progress[0]["status"], "not-started")
        self.assertEqual(progress[0]["pct"], 0)
        self.assertEqual(progress[0]["totalCount"], 1)

    def test_in_progress_when_partially_done(self):
        detail = self._detail(
            {
                "c1": [{"code": "K1", "weight": 5, "classification": "main"}],
                "c2": [{"code": "K1", "weight": 5, "classification": "main"}],
            },
            done_ids=["c1"],
        )
        progress = build_ksb_progress(detail)
        self.assertEqual(progress[0]["status"], "in-progress")
        self.assertEqual(progress[0]["pct"], 50)
        self.assertEqual(progress[0]["doneCount"], 1)

    def test_complete_when_fully_done(self):
        detail = self._detail({"c1": [{"code": "K1", "weight": 5, "classification": "main"}]}, done_ids=["c1"])
        progress = build_ksb_progress(detail)
        self.assertEqual(progress[0]["status"], "complete")
        self.assertEqual(progress[0]["pct"], 100)

    def test_recorded_evidence_forces_complete_even_with_no_contributors(self):
        detail = self._detail({}, done_ids=[])
        progress = build_ksb_progress(detail, evidenced_codes=["K1"])
        self.assertEqual(progress[0]["status"], "complete")
        self.assertEqual(progress[0]["pct"], 100)

    def test_subcodes_roll_up_to_the_parent_ksb(self):
        detail = self._detail({"c1": [{"code": "K1.2", "weight": 5, "classification": "main"}]}, done_ids=["c1"])
        progress = build_ksb_progress(detail)
        self.assertEqual(progress[0]["code"], "K1")
        self.assertEqual(progress[0]["availableWeight"], 5)


def _mock_source(learner_id=42, learner_type="apprenticeship"):
    source = MagicMock()
    source.id = learner_id
    source.learner_type = learner_type
    source.username = "Jordan Example"
    source.email = "jordan@example.com"
    source.programme = "Marketing Executive Level 4"
    source.employer = "Acme Ltd"
    source.line_manager = "Sam Manager"
    source.cohort = "Cohort A"
    source.group = "Group 1"
    source.coach_name = "Coach Casey"
    source.start_date = "2025-01-01"
    source.end_date = "2026-06-30"
    source.apprenticeship_end_date = None
    source.practical_period_end_date = None
    source.aptem_id = "APT-1"
    source.minimum_required_hours = "300"
    return source


def _mock_profile(active=True):
    profile = MagicMock()
    profile.lifecycle_status = "active" if active else "leaver"
    profile.start_date = date(2025, 1, 1)
    profile.end_date = date(2026, 6, 30)
    profile.completed_hours = 120
    profile.target_hours = 100
    profile.planned_hours = 400
    profile.otjh_status = "On track"
    profile.coach_name = "Coach Casey"
    return profile


class BuildReviewPackTests(SimpleTestCase):
    def setUp(self):
        self.period = build_review_period(date(2026, 3, 26), review_number=1)

    @patch("progress_reviews_api.review_pack._build_evidence_sections", return_value=([], [], []))
    @patch("progress_reviews_api.review_pack._build_attendance_section")
    @patch("learner_api.learner_detail.build_learner_detail")
    @patch("progress_reviews_api.review_pack._resolve_profile")
    @patch("progress_reviews_api.review_pack._resolve_learner")
    def test_active_learner_produces_a_complete_pack(
        self, mock_resolve_learner, mock_resolve_profile, mock_build_detail, mock_attendance, mock_evidence,
    ):
        mock_resolve_learner.return_value = ("apprenticeship", _mock_source())
        mock_resolve_profile.return_value = _mock_profile(active=True)
        mock_build_detail.return_value = {
            "name": "Jordan Example", "email": "jordan@example.com", "programme": "Marketing Executive Level 4",
            "employer": "Acme Ltd", "lineManager": "Sam Manager", "cohort": "Cohort A", "group": "Group 1",
            "otjhStatus": "On track", "components": [], "ksbs": [], "quizAttempts": [], "videoProgress": [],
            "componentProgress": [],
        }
        mock_attendance.return_value = {
            "attendance_percentage": 92, "monthly_summary": [], "missed_sessions": 0,
            "catch_ups_completed": 0, "catch_ups_needed": 0, "engagement_notes": "Fine.",
        }

        pack = build_review_pack(42, self.period, review_id="run-1", generated_by="coach@kbc.example")

        self.assertEqual(set(pack.keys()), {
            "learner", "review", "attendance", "progress", "otj", "lms_modules", "evidence",
            "assignments", "workplace_activities", "ksbs", "epa", "actions", "manager_questions",
            "source_warnings",
        })
        self.assertTrue(pack["learner"]["active_status"])
        self.assertEqual(pack["learner"]["full_name"], "Jordan Example")
        self.assertEqual(pack["review"]["review_id"], "run-1")
        self.assertEqual(pack["review"]["generated_by"], "coach@kbc.example")
        self.assertEqual(pack["otj"]["completed_otj_hours"], 120.0)

    @patch("progress_reviews_api.review_pack._build_evidence_sections", return_value=([], [], []))
    @patch("progress_reviews_api.review_pack._build_attendance_section")
    @patch("learner_api.learner_detail.build_learner_detail")
    @patch("progress_reviews_api.review_pack._resolve_profile")
    @patch("progress_reviews_api.review_pack._resolve_learner")
    def test_inactive_learner_is_flagged_not_generation_blocked_here(
        self, mock_resolve_learner, mock_resolve_profile, mock_build_detail, mock_attendance, mock_evidence,
    ):
        """build_review_pack always builds a preview; the /generate endpoint is
        what enforces 'active learners only', by reading learner.active_status."""
        mock_resolve_learner.return_value = ("apprenticeship", _mock_source())
        mock_resolve_profile.return_value = _mock_profile(active=False)
        mock_build_detail.return_value = {"components": [], "ksbs": [], "quizAttempts": [], "videoProgress": [], "componentProgress": []}
        mock_attendance.return_value = {
            "attendance_percentage": NOT_AVAILABLE, "monthly_summary": [], "missed_sessions": NOT_AVAILABLE,
            "catch_ups_completed": NOT_AVAILABLE, "catch_ups_needed": NOT_AVAILABLE, "engagement_notes": NOT_AVAILABLE,
        }

        pack = build_review_pack(42, self.period)

        self.assertFalse(pack["learner"]["active_status"])

    @patch("progress_reviews_api.review_pack._build_evidence_sections", return_value=([], [], []))
    @patch("learner_api.attendance.fetch_kbc_attendance_rows", side_effect=RuntimeError("no route to host"))
    @patch("learner_api.learner_detail.build_learner_detail")
    @patch("progress_reviews_api.review_pack._resolve_profile")
    @patch("progress_reviews_api.review_pack._resolve_learner")
    def test_attendance_failure_degrades_to_not_available_with_a_warning(
        self, mock_resolve_learner, mock_resolve_profile, mock_build_detail, mock_attendance, mock_evidence,
    ):
        mock_resolve_learner.return_value = ("apprenticeship", _mock_source())
        mock_resolve_profile.return_value = _mock_profile(active=True)
        mock_build_detail.return_value = {"components": [], "ksbs": [], "quizAttempts": [], "videoProgress": [], "componentProgress": []}

        pack = build_review_pack(42, self.period)

        self.assertEqual(pack["attendance"]["attendance_percentage"], NOT_AVAILABLE)
        self.assertTrue(any("attendance" in warning.lower() for warning in pack["source_warnings"]))
