from datetime import date, datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .active_users import (
    _coerce_ksb_items,
    _fetch_ksb_items,
    _reported_minutes,
    completed_hours_from_progress,
    refresh_learner_ksb_snapshot,
)
from .attendance import _summarize_attendance
from .evidence_storage import (
    blob_url,
    parse_blob_url,
    resolve_read_url,
    upload_to_quarantine,
)
from .learner_detail import (
    _active_profile_for_source,
    _schedule_based_week_target,
    _sequential_week_target,
)
from .mappers import to_learner_detail
from .models import _progress_entry_activity, _serialise_quiz_ref


class LearnerQuizReferenceTests(SimpleTestCase):
    def test_serialises_numeric_quiz_reference_without_breaking_text_ids(self):
        self.assertEqual(_serialise_quiz_ref("42"), 42)
        self.assertEqual(_serialise_quiz_ref("quiz-42"), "quiz-42")
        self.assertIsNone(_serialise_quiz_ref(None))


class ProgressActivityProjectionTests(SimpleTestCase):
    def test_projects_feed_fields_from_the_progress_entry(self):
        occurred_at = datetime(2026, 8, 2, 10, 30, tzinfo=timezone.utc)
        entry = SimpleNamespace(
            kind="video",
            feed_kind="video",
            feed_action="Watched video",
            feed_title="Project planning",
            feed_detail="2h",
            feed_occurred_at=occurred_at,
            component_ref="COMP-1",
            component_type="video",
            quiz_ref=None,
            module_title="Module 1",
            week_title="Week 1",
            component_title="Project planning",
            passed=None,
            submitted_at=occurred_at,
            reported_time="2h",
        )

        self.assertEqual(
            _progress_entry_activity(entry),
            {
                "kind": "video",
                "action": "Watched video",
                "title": "Project planning",
                "detail": "2h",
                "componentId": "COMP-1",
                "componentType": "video",
                "quizId": None,
                "module": "Module 1",
                "week": "Week 1",
                "passed": None,
                "at": "2026-08-02T10:30:00+00:00",
            },
        )


class LearnerProfileResolutionTests(SimpleTestCase):
    @patch("learner_api.learner_detail.LearnerProfile.objects.filter")
    def test_resolves_active_profile_by_email_before_source_id(self, profile_filter):
        expected = SimpleNamespace(id=2)
        profile_filter.return_value.first.return_value = expected

        result = _active_profile_for_source(
            SimpleNamespace(email=" Learner@Example.com "),
            source_pk=19,
        )

        self.assertIs(result, expected)
        profile_filter.assert_called_once_with(
            email__iexact="Learner@Example.com",
            lifecycle_status="active",
        )

    @patch("learner_api.learner_detail.LearnerProfile.objects.filter")
    def test_falls_back_to_source_id_only_when_source_has_no_email(self, profile_filter):
        expected = SimpleNamespace(id=19)
        profile_filter.return_value.first.return_value = expected

        result = _active_profile_for_source(
            SimpleNamespace(email="  "),
            source_pk=19,
        )

        self.assertIs(result, expected)
        profile_filter.assert_called_once_with(id=19, lifecycle_status="active")

    @patch("learner_api.learner_detail.LearnerProfile.objects.filter")
    def test_does_not_cross_link_an_unmatched_email_by_source_id(self, profile_filter):
        profile_filter.return_value.first.return_value = None

        result = _active_profile_for_source(
            SimpleNamespace(email="missing@example.com"),
            source_pk=19,
        )

        self.assertIsNone(result)
        profile_filter.assert_called_once_with(
            email__iexact="missing@example.com",
            lifecycle_status="active",
        )


class AttendanceSummaryTests(SimpleTestCase):
    def test_summarizes_session_rows_for_the_learner_page(self):
        updated_at = datetime(2026, 7, 21, 14, 28, tzinfo=timezone.utc)
        common = {
            'learner_id': 2,
            'learner_name': 'Test Learner',
            'learner_email': 'learner@example.com',
            'catchup_completed': False,
            'updated_at': updated_at,
        }
        rows = [
            {**common, 'session_date': date(2026, 7, 15), 'attendance_status': 'absent', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 7, 8), 'attendance_status': 'absent', 'minutes_late': 0, 'catchup_completed': True},
            {**common, 'session_date': date(2026, 7, 1), 'attendance_status': 'present', 'minutes_late': 12},
            {**common, 'session_date': date(2026, 6, 24), 'attendance_status': 'present', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 6, 17), 'attendance_status': 'present', 'minutes_late': 0},
        ]

        summary = _summarize_attendance(rows)

        self.assertEqual(summary['sessions'], 5)
        self.assertEqual(summary['present'], 3)
        self.assertEqual(summary['absent'], 2)
        self.assertEqual(summary['late'], 1)
        self.assertEqual(summary['catchup'], 1)
        self.assertEqual(summary['attendanceRate'], 60)
        self.assertEqual(summary['risk'], 'red')
        self.assertEqual(summary['consecutiveMissed'], 2)
        self.assertEqual(summary['lastSessionDate'], '2026-07-15')
        self.assertEqual(summary['updatedAt'], '2026-07-21T14:28:00+00:00')

    def test_returns_none_without_session_rows(self):
        self.assertIsNone(_summarize_attendance([]))


class LearnerKsbSnapshotTests(SimpleTestCase):
    def test_reported_minutes_treats_bare_numbers_as_hours(self):
        self.assertEqual(_reported_minutes("2"), 120.0)
        self.assertEqual(_reported_minutes("2h"), 120.0)
        self.assertEqual(_reported_minutes("1.5"), 90.0)
        self.assertEqual(_reported_minutes("120 min"), 120.0)

    def test_completed_hours_dedupes_repeated_otj_progress(self):
        progress = [
            {"kind": "video", "reportedTime": "2", "ksbs": ["K3.1", "S1.2"], "submittedAt": "2026-07-27T08:00:00Z"},
            {"kind": "video", "reportedTime": "2", "ksbs": ["S1.2", "K3.1"], "submittedAt": "2026-07-27T09:00:00Z"},
            {"kind": "video", "reportedTime": "1", "ksbs": ["K4"], "submittedAt": "2026-07-27T10:00:00Z"},
            {"kind": "component", "componentId": "component-1", "reportedTime": "3h"},
            {"kind": "component", "componentId": "component-1", "reportedTime": "3h"},
        ]

        self.assertEqual(completed_hours_from_progress(progress), "6")

    def test_coerce_ksb_items_parses_profile_json_payload(self):
        items = _coerce_ksb_items(
            '[{"code":"1","type":"K","title":"Knowledge 1","description":"Knowledge 1","displayOrder":2},'
            '{"code":"2","type":"S","title":"Skill 2","description":"Skill 2","displayOrder":1}]'
        )

        self.assertEqual(
            items,
            [
                {"code": "S2", "number": "2", "type": "Skills", "description": "Skill 2"},
                {"code": "K1", "number": "1", "type": "Knowledge", "description": "Knowledge 1"},
            ],
        )

    def test_to_learner_detail_exposes_progress_ksb_codes_from_all_progress_types(self):
        source = SimpleNamespace(
            id=42,
            username="Test Learner",
            email="learner@example.com",
            phone_number="",
            programme="Programme A",
            programme_status="Active",
            cohort="Cohort A",
            group="Group 1",
            training_plan=[],
            employer="Employer A",
            line_manager="Manager A",
        )
        learner_profile = SimpleNamespace(
            training_plan_progress=[
                {"kind": "quiz", "ksbs": ["K1"]},
                {"kind": "video", "ksbs": ["S2"]},
                {"kind": "component", "ksbs": ["B3", "K1"]},
            ],
            activity_feed_entries=lambda newest_first=False: [],
            ksbs=[{"code": "K1", "number": "1", "type": "Knowledge", "description": "Knowledge 1"}],
        )

        detail = to_learner_detail(source, learner_profile)

        self.assertEqual(detail["progressKsbCodes"], ["B3", "K1", "S2"])

    @patch("learner_api.active_users.replace_learner_ksbs")
    @patch("learner_api.active_users._fetch_ksb_items", return_value=[])
    def test_refresh_learner_ksb_snapshot_preserves_existing_rows_when_lookup_is_empty(self, fetch_ksbs, replace_ksbs):
        learner = SimpleNamespace(id=42)
        source = SimpleNamespace(programme="Programme A", training_plan=[])

        result = refresh_learner_ksb_snapshot(learner, source, training_plan=[])

        self.assertEqual(result, [])
        fetch_ksbs.assert_called_once_with("Programme A", training_plan=[])
        replace_ksbs.assert_not_called()

    @patch("learner_api.active_users._fetch_ksb_items_from_profile_source")
    @patch("learner_api.active_users._resolve_ksb_profile_source_id")
    @patch("learner_api.active_users._fetch_ksb_items_from_plan_mappings")
    @patch("learner_api.active_users._fetch_ksb_items_for_programme", return_value=[])
    @patch("learner_api.active_users._resolve_programme_id", return_value="PROG-1")
    def test_fetch_ksb_items_prefers_profile_source_before_plan_mappings(
        self,
        resolve_programme_id,
        fetch_for_programme,
        fetch_from_plan_mappings,
        resolve_profile_source,
        fetch_from_profile_source,
    ):
        fetch_from_profile_source.return_value = [
            {"code": "K2", "number": "2", "type": "Knowledge", "description": "Knowledge 2"},
        ]
        resolve_profile_source.return_value = "KSBP-1"

        result = _fetch_ksb_items("Programme A", training_plan=[{"moduleId": "MOD-1"}])

        self.assertEqual(result, fetch_from_profile_source.return_value)
        resolve_programme_id.assert_called_once_with("Programme A", training_plan=[{"moduleId": "MOD-1"}])
        fetch_for_programme.assert_called_once_with("PROG-1", "Programme A")
        resolve_profile_source.assert_called_once_with(
            programme_id="PROG-1",
            programme="Programme A",
            training_plan=[{"moduleId": "MOD-1"}],
        )
        fetch_from_profile_source.assert_called_once_with("KSBP-1")
        fetch_from_plan_mappings.assert_not_called()

    @patch("learner_api.active_users._fetch_ksb_items_from_profile_source", return_value=[
        {"code": "K2", "number": "2", "type": "Knowledge", "description": "Knowledge 2"},
    ])
    @patch("learner_api.active_users._resolve_ksb_profile_source_id", return_value="KSBP-1")
    @patch("learner_api.active_users._fetch_ksb_items_from_plan_mappings", return_value=[
        {"code": "K1", "number": "1", "type": "Knowledge", "description": "Knowledge 1"},
    ])
    @patch("learner_api.active_users._fetch_ksb_items_for_programme", return_value=[])
    @patch("learner_api.active_users._resolve_programme_id", return_value="PROG-1")
    def test_fetch_ksb_items_uses_profile_source_even_if_plan_mappings_exist(
        self,
        resolve_programme_id,
        fetch_for_programme,
        fetch_from_plan_mappings,
        resolve_profile_source,
        fetch_from_profile_source,
    ):
        result = _fetch_ksb_items("Programme A", training_plan=[{"moduleId": "MOD-1"}])

        self.assertEqual(result, fetch_from_profile_source.return_value)
        resolve_programme_id.assert_called_once_with("Programme A", training_plan=[{"moduleId": "MOD-1"}])
        fetch_for_programme.assert_called_once_with("PROG-1", "Programme A")
        resolve_profile_source.assert_called_once_with(
            programme_id="PROG-1",
            programme="Programme A",
            training_plan=[{"moduleId": "MOD-1"}],
        )
        fetch_from_profile_source.assert_called_once_with("KSBP-1")
        fetch_from_plan_mappings.assert_not_called()

    @patch("learner_api.active_users._fetch_ksb_items_from_profile_source", return_value=[])
    @patch("learner_api.active_users._resolve_ksb_profile_source_id", return_value="KSBP-1")
    @patch("learner_api.active_users._fetch_ksb_items_from_plan_mappings", return_value=[
        {"code": "K1", "number": "1", "type": "Knowledge", "description": "Knowledge 1"},
    ])
    @patch("learner_api.active_users._fetch_ksb_items_for_programme", return_value=[])
    @patch("learner_api.active_users._resolve_programme_id", return_value="PROG-1")
    def test_fetch_ksb_items_falls_back_to_plan_mappings_when_profile_source_is_empty(
        self,
        resolve_programme_id,
        fetch_for_programme,
        fetch_from_plan_mappings,
        resolve_profile_source,
        fetch_from_profile_source,
    ):
        result = _fetch_ksb_items("Programme A", training_plan=[{"moduleId": "MOD-1"}])

        self.assertEqual(result, fetch_from_plan_mappings.return_value)
        resolve_programme_id.assert_called_once_with("Programme A", training_plan=[{"moduleId": "MOD-1"}])
        fetch_for_programme.assert_called_once_with("PROG-1", "Programme A")
        resolve_profile_source.assert_called_once_with(
            programme_id="PROG-1",
            programme="Programme A",
            training_plan=[{"moduleId": "MOD-1"}],
        )
        fetch_from_profile_source.assert_called_once_with("KSBP-1")
        fetch_from_plan_mappings.assert_called_once_with(
            programme_id="PROG-1",
            programme="Programme A",
            training_plan=[{"moduleId": "MOD-1"}],
        )


class LearnerOtjhTargetTests(SimpleTestCase):
    def test_schedule_based_week_target_uses_weeks_started_by_today_across_modules(self):
        week_rows = [
            {"moduleId": "MOD-1", "weekId": "W1", "otjh": 16.0},
            {"moduleId": "MOD-1", "weekId": "W2", "otjh": 6.5},
            {"moduleId": "MOD-1", "weekId": "W3", "otjh": 7.0},
            {"moduleId": "MOD-2", "weekId": "W4", "otjh": 2.0},
        ]
        module_start_by_id = {
            "MOD-1": date(2026, 7, 21),
            "MOD-2": date(2026, 8, 1),
        }
        week_offset_by_id = {
            "W1": 0,
            "W2": 1,
            "W3": 2,
            "W4": 0,
        }

        target = _schedule_based_week_target(
            week_rows,
            module_start_by_id,
            week_offset_by_id,
            today=date(2026, 8, 1),
        )

        self.assertEqual(target, 24.5)

    def test_sequential_week_target_falls_back_to_learner_start_date(self):
        week_rows = [
            {"otjh": 16.0},
            {"otjh": 6.5},
            {"otjh": 7.0},
            {"otjh": 6.5},
        ]

        target = _sequential_week_target(
            week_rows,
            learner_start_date=date(2026, 7, 21),
            today=date(2026, 8, 1),
        )

        self.assertEqual(target, 22.5)


@override_settings(
    AZURE_STORAGE_ACCOUNT="lmsstorage",
    AZURE_STORAGE_KEY="test-key",
    AZURE_QUARANTINE_CONTAINER="evidence-quarantine",
    AZURE_APPROVED_CONTAINER="evidence-approved",
    AZURE_REJECTED_CONTAINER="evidence-rejected",
    AZURE_SAS_TTL_MINUTES=15,
)
class EvidenceStorageUrlTests(SimpleTestCase):
    @patch("learner_api.evidence_storage._service_client")
    def test_upload_rewinds_file_before_sending_it_to_azure(self, service_client):
        upload = BytesIO(b"complete-file-content")
        upload.read()
        blob_client = (
            service_client.return_value
            .get_blob_client.return_value
        )

        upload_to_quarantine(upload, "absence-reports/file.png", "image/png")

        uploaded_stream = blob_client.upload_blob.call_args.args[0]
        self.assertEqual(b"complete-file-content", uploaded_stream.read())

    def test_canonical_url_round_trips_container_and_blob_name(self):
        url = blob_url(
            "evidence-quarantine",
            "absence-reports/apprenticeship/42/file name.pdf",
        )

        self.assertEqual(
            parse_blob_url(url),
            (
                "evidence-quarantine",
                "absence-reports/apprenticeship/42/file name.pdf",
            ),
        )
        self.assertIn("file%20name.pdf", url)

    def test_rejects_urls_from_another_storage_account(self):
        self.assertIsNone(
            parse_blob_url(
                "https://otheraccount.blob.core.windows.net/"
                "evidence-quarantine/file.pdf"
            )
        )

    @patch("learner_api.evidence_storage.generate_blob_sas", return_value="signed-token")
    def test_resolves_allowed_blob_to_short_lived_sas(self, generate_sas):
        stored_url = blob_url("evidence-quarantine", "absence-reports/file.pdf")

        result = resolve_read_url(stored_url, {"evidence-quarantine"})

        self.assertEqual(f"{stored_url}?signed-token", result)
        generate_sas.assert_called_once()

    def test_does_not_sign_blob_from_disallowed_container(self):
        stored_url = blob_url("evidence-rejected", "absence-reports/file.pdf")

        self.assertEqual("", resolve_read_url(stored_url, {"evidence-approved"}))

    def test_preserves_legacy_local_evidence_url(self):
        self.assertEqual(
            "/media/absence-evidence/legacy.pdf",
            resolve_read_url(
                "/media/absence-evidence/legacy.pdf",
                {"evidence-approved"},
            ),
        )
