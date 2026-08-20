import json
from datetime import date, datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from django.db import DatabaseError

from .active_users import (
    ComponentReferenceError,
    DeletedComponentReferenceError,
    OrphanComponentReferenceError,
    _canonical_ksb_items,
    _coerce_ksb_items,
    _fetch_ksb_items,
    _ksb_version_hash,
    _reported_minutes,
    completed_hours_from_progress,
    component_reference_exists,
    component_reference_state,
    refresh_learner_ksb_snapshot,
    hydrate_training_plan,
    save_progress_record,
)
from .active_users import connections as active_users_connections
from .components import submit_component_progress
from . import progress_rules
from .progress_rules import (
    progress_achievement_status,
    progress_counts_as_achieved,
    progress_record_counts_as_achieved,
)
from .attendance import _summarize_attendance
from .evidence_storage import (
    blob_url,
    parse_blob_url,
    resolve_read_url,
    upload_to_quarantine,
)
from .identity import learner_profile_for_source
from .learner_detail import (
    _active_profile_for_source,
    _append_week_quizzes,
    _display_quiz_title,
    _matching_module_ids_for_quiz_record,
    _schedule_based_week_target,
    _sequential_week_target,
)
from .learner_progression import ACTIVE_STATUS, READY_TO_ENROL_STATUS, _as_date, advance_learner
from .mappers import to_learner_detail
from .models import LearnerProfile, _progress_entry_activity, _serialise_quiz_ref
from .reflection_submissions import get_reflection_submission


class LearnerQuizReferenceTests(SimpleTestCase):
    def test_serialises_numeric_quiz_reference_without_breaking_text_ids(self):
        self.assertEqual(_serialise_quiz_ref("42"), 42)
        self.assertEqual(_serialise_quiz_ref("quiz-42"), "quiz-42")
        self.assertIsNone(_serialise_quiz_ref(None))


class LearnerDetailPrefetchTests(SimpleTestCase):
    @patch("learner_api.learner_detail.prefetch_related_objects")
    @patch("learner_api.learner_detail.learner_profile_for_source")
    def test_prefetches_the_complete_progress_graph(self, resolve_profile, prefetch):
        source = SimpleNamespace(email="learner@example.com")
        profile = Mock()
        resolve_profile.return_value = profile

        self.assertIs(_active_profile_for_source(source, 19), profile)

        resolve_profile.assert_called_once_with(source, 19, active_only=True)
        prefetch.assert_called_once_with(
            [profile],
            "ksb_assignment__profile_version__definitions",
            "assigned_ksbs",
            "progress_entries__ksb_links",
            "progress_entries__quiz_answers__chosen_answers",
            "progress_entries__quiz_answers__correct_answers",
        )

    @patch("learner_api.learner_detail.prefetch_related_objects")
    @patch("learner_api.learner_detail.learner_profile_for_source", return_value=None)
    def test_skips_prefetch_when_the_learner_is_not_active(self, _resolve_profile, prefetch):
        self.assertIsNone(_active_profile_for_source(SimpleNamespace(), 19))
        prefetch.assert_not_called()


class LearnerReflectionStatusTests(SimpleTestCase):
    def test_loads_all_statuses_in_one_read_without_running_schema_ddl(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [
            ("quiz", "quiz-68", "accepted"),
            ("reading", "COMP-1", "submitted_for_tutor_review"),
        ]
        connection = MagicMock()
        connection.cursor.return_value = cursor
        request = RequestFactory().get(
            "/learner_api/reflection/submissions/",
            {"learnerKind": "commercial", "learnerId": "19"},
        )

        with patch("learner_api.reflection_submissions.connections", {"enrolment": connection}):
            response = get_reflection_submission(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json.loads(response.content)["statuses"],
            [
                {"activityType": "quiz", "activityId": "quiz-68", "status": "accepted"},
                {
                    "activityType": "reading",
                    "activityId": "COMP-1",
                    "status": "submitted_for_tutor_review",
                },
            ],
        )
        sql = " ".join(call.args[0].lower() for call in cursor.execute.call_args_list)
        self.assertNotIn("create ", sql)
        self.assertNotIn("alter ", sql)
        self.assertNotIn("drop ", sql)


class LearnerProgressionTests(SimpleTestCase):
    def _learner(self, status, start_date="2026-09-01", learner_type="apprenticeship", plan=None):
        return SimpleNamespace(
            pk=19,
            learner_type=learner_type,
            programme_status=status,
            start_date=start_date,
            learning_plan=plan,
            training_plan=None,
            save=Mock(),
        )

    @patch("learner_api.learner_progression.compliance_documents_complete", return_value=True)
    @patch("learner_api.learner_progression._programme_start_date", return_value=date(2026, 9, 1))
    @patch("learner_api.learner_progression.timezone.localdate", return_value=date(2026, 8, 8))
    def test_completed_documents_move_delivery_learner_to_ready_to_enrol(self, _today, _start, complete):
        learner = self._learner("Delivery")

        self.assertEqual(advance_learner(learner), READY_TO_ENROL_STATUS)
        self.assertEqual(learner.programme_status, READY_TO_ENROL_STATUS)
        learner.save.assert_called_once_with(update_fields=["programme_status"])
        complete.assert_called_once_with("apprenticeship", 19)

    @patch("learner_api.active_users.sync_active_user")
    @patch("learner_api.learner_progression._programme_start_date", return_value=date(2026, 8, 8))
    @patch("learner_api.learner_progression.timezone.localdate", return_value=date(2026, 8, 8))
    def test_ready_learner_becomes_active_on_their_start_date(self, _today, _start, sync):
        learner = self._learner(READY_TO_ENROL_STATUS)

        self.assertEqual(advance_learner(learner), ACTIVE_STATUS)
        self.assertEqual(learner.programme_status, ACTIVE_STATUS)
        learner.save.assert_called_once_with(update_fields=["programme_status"])
        sync.assert_called_once_with(learner)

    def test_parses_legacy_text_start_dates(self):
        self.assertEqual(_as_date("2026-08-08"), date(2026, 8, 8))
        self.assertEqual(_as_date("2026-08-08T09:30:00Z"), date(2026, 8, 8))

    @patch("learner_api.active_users.sync_active_user")
    @patch("learner_api.learner_progression._programme_start_date", return_value=date(2026, 8, 8))
    @patch("learner_api.learner_progression.timezone.localdate", return_value=date(2026, 8, 8))
    def test_commercial_waits_for_an_assigned_plan_even_after_start_date(self, _today, _start, sync):
        learner = self._learner("Delivery", learner_type="commercial")

        self.assertIsNone(advance_learner(learner))
        self.assertEqual(learner.programme_status, "Delivery")
        sync.assert_not_called()

    @patch("learner_api.active_users.sync_active_user")
    @patch("learner_api.learner_progression._programme_start_date", return_value=date(2026, 8, 8))
    @patch("learner_api.learner_progression.timezone.localdate", return_value=date(2026, 8, 8))
    def test_commercial_becomes_active_after_start_date_with_assigned_plan(self, _today, _start, sync):
        learner = self._learner("Delivery", learner_type="commercial", plan=[{"moduleId": "mod-1"}])

        self.assertEqual(advance_learner(learner), "Active")
        self.assertEqual(learner.programme_status, "Active")
        sync.assert_called_once_with(learner)


class TrainingPlanHydrationTests(SimpleTestCase):
    @patch("learner_api.active_users.connections")
    def test_selected_modules_are_expanded_with_authored_weeks_and_components(self, connections):
        cursor = MagicMock()
        connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
        cursor.fetchall.return_value = [
            ("mod-1", "Module 1", 11, "Week 1", 1, 101, "Watch this", "video"),
            ("mod-1", "Module 1", 11, "Week 1", 1, 102, "Quiz", "quiz"),
            ("mod-1", "Module 1", 12, "Week 2", 2, 103, "Read this", "reading"),
        ]

        result = hydrate_training_plan([{"moduleId": "mod-1", "moduleTitle": "Old title"}])

        self.assertEqual(result, [{
            "moduleId": "mod-1",
            "moduleTitle": "Module 1",
            "weeks": [
                {"weekId": "11", "weekTitle": "Week 1", "components": [
                    {"componentId": "101", "componentTitle": "Watch this"},
                    {"componentId": "102", "componentTitle": "Quiz"},
                ]},
                {"weekId": "12", "weekTitle": "Week 2", "components": [
                    {"componentId": "103", "componentTitle": "Read this"},
                ]},
            ],
        }])


class LearnerActivityFeedProjectionTests(SimpleTestCase):
    def test_returns_empty_activity_feed_when_no_progress_is_prefetched(self):
        learner = LearnerProfile()
        learner._prefetched_objects_cache = {"progress_entries": []}

        self.assertEqual(learner.activity_feed_entries(), [])

    @patch("learner_api.models._progress_entry_activity")
    def test_uses_prefetched_progress_entries_when_available(self, project_entry):
        learner = LearnerProfile()
        learner._prefetched_objects_cache = {
            "progress_entries": [
                SimpleNamespace(feed_kind="video", feed_key="keep"),
                SimpleNamespace(feed_kind="", feed_key="skip"),
            ]
        }
        project_entry.side_effect = lambda entry: {"kind": entry.feed_key, "at": entry.feed_key}

        self.assertEqual(
            learner.activity_feed_entries(newest_first=True),
            [{"kind": "keep", "at": "keep"}],
        )
        project_entry.assert_called_once()


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
    """How a Created_users row is matched to its "Learner".learners profile.

    ``enrolment_id`` is the real link and is tried first. Email is only a
    fallback for profiles that predate that column — it is a poor key, because a
    corrected address breaks it and two people sharing one collide, which is
    exactly why the explicit column exists.
    """

    @staticmethod
    def _returns(*results):
        """Make ``LearnerProfile.objects.filter(...).first()`` yield each result
        in turn, so the *order* of the lookups can be asserted."""
        calls = []

        def fake_filter(**kwargs):
            calls.append(kwargs)
            outcome = results[len(calls) - 1] if len(calls) <= len(results) else None
            return SimpleNamespace(first=lambda: outcome)

        return fake_filter, calls

    @patch("learner_api.identity.LearnerProfile.objects.filter")
    def test_prefers_the_explicit_enrolment_link(self, profile_filter):
        expected = SimpleNamespace(id=2, enrolment_id=19)
        fake, calls = self._returns(expected)
        profile_filter.side_effect = fake

        result = learner_profile_for_source(
            SimpleNamespace(email=" Learner@Example.com "), 19, active_only=True,
        )

        self.assertIs(result, expected)
        # One lookup, on the link — email is never consulted when it resolves.
        self.assertEqual(calls, [{"enrolment_id": 19, "lifecycle_status": "active"}])

    @patch("learner_api.identity.LearnerProfile.objects.filter")
    def test_falls_back_to_email_when_the_link_is_not_set(self, profile_filter):
        """Profiles created before enrolment_id existed still resolve."""
        expected = SimpleNamespace(id=2, enrolment_id=None, save=lambda **kw: None)
        fake, calls = self._returns(None, expected)
        profile_filter.side_effect = fake

        result = learner_profile_for_source(
            SimpleNamespace(email=" Learner@Example.com "), 19, active_only=True,
        )

        self.assertIs(result, expected)
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {"email__iexact": "Learner@Example.com", "lifecycle_status": "active"},
        ])

    @patch("learner_api.identity.LearnerProfile.objects.filter")
    def test_an_email_match_repairs_the_missing_link(self, profile_filter):
        """Self-healing: the inferred link is written back, so the fallback
        empties itself instead of being consulted forever."""
        saved = {}
        expected = SimpleNamespace(
            id=2, enrolment_id=None,
            save=lambda **kwargs: saved.update(kwargs),
        )
        fake, _calls = self._returns(None, expected)
        profile_filter.side_effect = fake

        learner_profile_for_source(
            SimpleNamespace(email="learner@example.com"), 19, active_only=True,
        )

        self.assertEqual(expected.enrolment_id, 19)
        self.assertEqual(saved, {"update_fields": ["enrolment_id"]})

    @patch("learner_api.identity.LearnerProfile.objects.filter")
    def test_falls_back_to_source_id_only_when_source_has_no_email(self, profile_filter):
        expected = SimpleNamespace(id=19)
        fake, calls = self._returns(None, expected)
        profile_filter.side_effect = fake

        result = learner_profile_for_source(
            SimpleNamespace(email="  "), 19, active_only=True,
        )

        self.assertIs(result, expected)
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {"pk": 19, "lifecycle_status": "active"},
        ])

    @patch("learner_api.identity.LearnerProfile.objects.filter")
    def test_does_not_cross_link_an_unmatched_email_by_source_id(self, profile_filter):
        """The safety property: when a learner HAS an email and it matches
        nobody, resolution stops. Falling through to the primary key would hand
        back whichever unrelated profile happened to share that number — the two
        tables' id sequences are independent."""
        fake, calls = self._returns(None, None)
        profile_filter.side_effect = fake

        result = learner_profile_for_source(
            SimpleNamespace(email="missing@example.com"), 19, active_only=True,
        )

        self.assertIsNone(result)
        # Never a third, pk-based lookup.
        self.assertEqual(calls, [
            {"enrolment_id": 19, "lifecycle_status": "active"},
            {"email__iexact": "missing@example.com", "lifecycle_status": "active"},
        ])


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


class LearnerQuizModuleMatchingTests(SimpleTestCase):
    def test_matches_quiz_to_module_by_programme_and_module_name(self):
        quiz_record = {
            "module": "Risk Management",
            "programme_id": "PROG-1",
            "programme": "Fouda-Programme",
        }
        modules_by_id = {
            "MOD-RISK": {
                "module": "Risk Management",
                "programmeId": "PROG-1",
                "programme": "Fouda-Programme",
            },
            "MOD-OTHER": {
                "module": "Fouda-Module",
                "programmeId": "PROG-1",
                "programme": "Fouda-Programme",
            },
        }

        self.assertEqual(
            _matching_module_ids_for_quiz_record(quiz_record, modules_by_id, explicit_module_ids=set()),
            ["MOD-RISK"],
        )

    def test_explicit_module_assignments_win_over_metadata_guessing(self):
        quiz_record = {
            "module": "Risk Management",
            "programme_id": "PROG-1",
            "programme": "Fouda-Programme",
        }
        modules_by_id = {
            "MOD-RISK": {
                "module": "Risk Management",
                "programmeId": "PROG-1",
                "programme": "Fouda-Programme",
            },
        }

        self.assertEqual(
            _matching_module_ids_for_quiz_record(quiz_record, modules_by_id, explicit_module_ids={"MOD-RISK"}),
            ["MOD-RISK"],
        )


class ScriptedCursor:
    def __init__(self, results):
        self._results = list(results)
        self._current = []

    def execute(self, sql, params=None):
        self._current = self._results.pop(0) if self._results else []

    def fetchall(self):
        return list(self._current)

    def fetchone(self):
        return self._current[0] if self._current else None


class ScriptedConnection:
    def __init__(self, cursor):
        self._cursor = cursor

    def cursor(self):
        return self

    def __enter__(self):
        return self._cursor

    def __exit__(self, exc_type, exc, tb):
        return False


class LearnerWeekQuizVisibilityTests(SimpleTestCase):
    def test_explicit_module_links_surface_quiz_without_module_or_week_metadata(self):
        weeks = [{
            "module": "Fouda-Module",
            "week": "Week 1",
            "moduleId": "MOD-FOUDA",
            "weekId": "WEEK-1",
        }]
        components = []
        cursor = ScriptedCursor([
            [("MOD-FOUDA", "Fouda-Module", "PROG-1", "Fouda-Programme")],
            [],
            [(90, "MOD-FOUDA", "")],
            [(90, "", "test aya", 7, 60, "Minutes", "PROG-1", "Fouda-Programme", "")],
            [],
        ])

        with patch("learner_api.learner_detail.connections", {"enrolment": ScriptedConnection(cursor)}):
            next_weeks, next_components = _append_week_quizzes(weeks, components)

        self.assertEqual(len(next_weeks), 2)
        self.assertIn(
            {
                "module": "Fouda-Module",
                "week": "Module assessments",
                "moduleId": "MOD-FOUDA",
                "weekId": "quiz-module-assessments::MOD-FOUDA",
            },
            next_weeks,
        )
        self.assertEqual(len(next_components), 1)
        self.assertEqual(next_components[0]["component"], "Quiz · test aya")
        self.assertTrue(next_components[0]["isQuiz"])
        self.assertEqual(next_components[0]["moduleId"], "MOD-FOUDA")
        self.assertEqual(next_components[0]["weekId"], "quiz-module-assessments::MOD-FOUDA")
        self.assertEqual(next_components[0]["quizMeta"]["quizId"], 90)

    def legacy_test_explicit_module_week_links_place_quiz_into_the_real_week(self):
        weeks = [{
            "module": "Risk Management",
            "week": "Week 1",
            "moduleId": "MOD-RISK",
            "weekId": "WEEK-RISK-1",
        }]
        components = []
        cursor = ScriptedCursor([
            [("MOD-RISK", "Risk Management", "PROG-1", "Fouda-Programme")],
            [],
            [(92, "MOD-RISK", "WEEK-RISK-1")],
            [(92, "", "Aya test 2", 7, 60, "Minutes", "PROG-1", "Fouda-Programme", "")],
            [],
        ])

        with patch("learner_api.learner_detail.connections", {"enrolment": ScriptedConnection(cursor)}):
            next_weeks, next_components = _append_week_quizzes(weeks, components)

        self.assertEqual(next_weeks, weeks)
        self.assertEqual(len(next_components), 1)
        self.assertEqual(next_components[0]["component"], "Quiz Â· Aya test 2")
        self.assertEqual(next_components[0]["moduleId"], "MOD-RISK")
        self.assertEqual(next_components[0]["weekId"], "WEEK-RISK-1")
        self.assertEqual(next_components[0]["quizMeta"]["quizId"], 92)

    def test_explicit_module_week_links_place_quiz_into_the_real_week_v2(self):
        weeks = [{
            "module": "Risk Management",
            "week": "Week 1",
            "moduleId": "MOD-RISK",
            "weekId": "WEEK-RISK-1",
        }]
        components = []
        cursor = ScriptedCursor([
            [("MOD-RISK", "Risk Management", "PROG-1", "Fouda-Programme")],
            [],
            [(92, "MOD-RISK", "WEEK-RISK-1")],
            [(92, "", "Aya test 2", 7, 60, "Minutes", "PROG-1", "Fouda-Programme", "")],
            [],
        ])

        with patch("learner_api.learner_detail.connections", {"enrolment": ScriptedConnection(cursor)}):
            next_weeks, next_components = _append_week_quizzes(weeks, components)

        self.assertEqual(next_weeks, weeks)
        self.assertEqual(len(next_components), 1)
        self.assertEqual(next_components[0]["component"], _display_quiz_title("Aya test 2"))
        self.assertEqual(next_components[0]["moduleId"], "MOD-RISK")
        self.assertEqual(next_components[0]["weekId"], "WEEK-RISK-1")
        self.assertEqual(next_components[0]["quizMeta"]["quizId"], 92)


class LearnerKsbSnapshotTests(SimpleTestCase):
    def test_versioned_ksb_content_is_canonical_and_deduplicated(self):
        items = _canonical_ksb_items([
            {"code": " k1 ", "number": "1", "type": "Knowledge", "description": "First"},
            {"code": "K1", "number": "1", "type": "Knowledge", "description": "Duplicate"},
            {"code": "S2", "number": "2", "type": "Skills", "description": "Second"},
        ])

        self.assertEqual([item["code"] for item in items], ["K1", "S2"])
        self.assertEqual(items[0]["description"], "First")
        self.assertEqual(len(_ksb_version_hash(items)), 64)
        self.assertEqual(_ksb_version_hash(items), _ksb_version_hash(list(items)))

    def test_version_hash_changes_when_a_definition_changes(self):
        original = [{"code": "K1", "number": "1", "type": "Knowledge", "description": "Original"}]
        changed = [{**original[0], "description": "Updated"}]

        self.assertNotEqual(_ksb_version_hash(original), _ksb_version_hash(changed))

    def test_reported_minutes_treats_small_bare_numbers_as_hours_and_large_values_as_minutes(self):
        self.assertEqual(_reported_minutes("2"), 120.0)
        self.assertEqual(_reported_minutes("2h"), 120.0)
        self.assertEqual(_reported_minutes("1.5"), 90.0)
        self.assertEqual(_reported_minutes("120"), 120.0)
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

    def test_completed_hours_prefers_curriculum_expected_otjh_for_known_components(self):
        progress = [
            {"kind": "video", "componentId": "component-1", "reportedTime": "120"},
            {"kind": "component", "componentId": "component-2", "reportedTime": "5"},
        ]
        components = [
            {"componentId": "component-1", "expectedOtjh": 1.5},
            {"componentId": "component-2", "expectedOtjh": 2},
        ]

        self.assertEqual(completed_hours_from_progress(progress, components), "3.5")

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


class OrphanComponentReferenceTests(SimpleTestCase):
    """component_ref must resolve, or the write is rejected outright.

    These pin the fix for the defect that produced the historical orphan set:
    component_ref was persisted straight from the client, so a stale or
    frontend-generated id created a row referring to nothing while the request
    still reported success. Curriculum, Coach and reporting all join on
    component_ref, so such a row is invisible everywhere it matters.
    """

    def _connections(self, cursor):
        return {"default": ScriptedConnection(cursor), "enrolment": ScriptedConnection(cursor)}

    def test_known_component_resolves(self):
        cursor = ScriptedCursor([[(1,)]])
        with patch.dict(active_users_connections, self._connections(cursor), clear=False):
            self.assertTrue(component_reference_exists("COMP-REAL"))

    def test_unknown_component_does_not_resolve(self):
        cursor = ScriptedCursor([[], []])
        with patch.dict(active_users_connections, self._connections(cursor), clear=False):
            self.assertFalse(component_reference_exists("COMP-GHOST"))

    def test_blank_component_id_never_resolves(self):
        self.assertFalse(component_reference_exists(""))
        self.assertFalse(component_reference_exists(None))

    def test_unreachable_database_is_not_reported_as_a_missing_component(self):
        """A lookup that could not run is not evidence of absence.

        Answering "does not exist" here would reject a perfectly valid write
        whenever the database hiccuped, turning an outage into data loss.
        """
        class ExplodingConnection:
            def cursor(self):
                raise DatabaseError("connection refused")

        exploding = {"default": ExplodingConnection(), "enrolment": ExplodingConnection()}
        with patch.dict(active_users_connections, exploding, clear=False):
            with self.assertRaises(DatabaseError):
                component_reference_exists("COMP-REAL")

    def test_save_progress_record_rejects_an_unknown_component(self):
        learner = SimpleNamespace(pk=1)
        with patch("learner_api.active_users.component_reference_state", return_value=("unknown", "")):
            with self.assertRaises(OrphanComponentReferenceError) as raised:
                save_progress_record(learner, {"kind": "component", "componentId": "COMP-GHOST"})
        self.assertIn("COMP-GHOST", str(raised.exception))

    def test_non_component_activity_is_not_rejected(self):
        """A standalone quiz carries no componentId and must still be storable.

        The guard exists to stop fake component links, not to force every
        activity to be component-based.
        """
        learner = SimpleNamespace(pk=1)
        with patch("learner_api.active_users.component_reference_state") as state:
            with patch("learner_api.active_users.transaction.atomic", side_effect=RuntimeError("reached the write")):
                with self.assertRaises(RuntimeError):
                    save_progress_record(learner, {"kind": "quiz", "quizId": "64"})
        state.assert_not_called()


class ComponentWriteSoftDeleteTests(SimpleTestCase):
    """New activity may not target deleted curriculum; history still resolves.

    Two different questions are asked of the same ``component_ref``:

    * *historical read* — does this id name a Component at all? Soft-deleted
      counts, because a learner legitimately completed something that was
      archived afterwards and every report joins on that id.
    * *new authoritative write* — may new delivery be recorded against it? A
      withdrawn Component may not, including when the withdrawal came from an
      ancestor (week / module / group / cohort / programme).
    """

    # Column order of _COMPONENT_LINEAGE_DELETED_SQL.
    LEVELS = ("component", "week", "module", "group", "cohort", "programme")

    def _connections(self, cursor):
        return {"default": ScriptedConnection(cursor), "enrolment": ScriptedConnection(cursor)}

    def _lineage_row(self, *deleted_levels):
        return tuple(level in set(deleted_levels) for level in self.LEVELS)

    def _state(self, *deleted_levels):
        cursor = ScriptedCursor([[self._lineage_row(*deleted_levels)]])
        with patch.dict(active_users_connections, self._connections(cursor), clear=False):
            return component_reference_state("COMP-UNDER-TEST")

    def test_component_with_clean_lineage_is_valid_for_new_activity(self):
        self.assertEqual(self._state(), ("active", ""))

    def test_unknown_component_reports_unknown_not_deleted(self):
        cursor = ScriptedCursor([[], []])
        with patch.dict(active_users_connections, self._connections(cursor), clear=False):
            self.assertEqual(component_reference_state("COMP-GHOST"), ("unknown", ""))

    def test_blank_component_id_is_unknown(self):
        self.assertEqual(component_reference_state(""), ("unknown", ""))
        self.assertEqual(component_reference_state(None), ("unknown", ""))

    def test_directly_deleted_component_is_rejected_for_new_activity(self):
        self.assertEqual(self._state("component"), ("deleted", "component"))

    def test_deletion_through_each_ancestor_is_detected_and_named(self):
        """Parent-driven deletion is the case a component-only check misses."""
        for level in ("week", "module", "group", "cohort", "programme"):
            with self.subTest(deleted_level=level):
                self.assertEqual(self._state(level), ("deleted", level))

    def test_unreachable_database_is_not_reported_as_deleted(self):
        """Same principle as the orphan check: no answer is not an answer.

        Treating an unreachable lookup as "deleted" would reject valid learner
        work for the duration of a database hiccup.
        """
        class ExplodingConnection:
            def cursor(self):
                raise DatabaseError("connection refused")

        exploding = {"default": ExplodingConnection(), "enrolment": ExplodingConnection()}
        with patch.dict(active_users_connections, exploding, clear=False):
            with self.assertRaises(DatabaseError):
                component_reference_state("COMP-REAL")

    def test_historical_read_still_resolves_a_soft_deleted_component(self):
        """The read helper must NOT inherit the write restriction.

        Progress rows already pointing at an archived Component have to stay
        traceable, so existence is all this asks.
        """
        cursor = ScriptedCursor([[(1,)]])
        with patch.dict(active_users_connections, self._connections(cursor), clear=False):
            self.assertTrue(component_reference_exists("COMP-20260719113158962888"))

    def test_save_progress_record_rejects_a_soft_deleted_component(self):
        learner = SimpleNamespace(pk=1)
        with patch("learner_api.active_users.component_reference_state", return_value=("deleted", "component")):
            with patch("learner_api.active_users.transaction.atomic", side_effect=AssertionError("must not write")):
                with self.assertRaises(DeletedComponentReferenceError) as raised:
                    save_progress_record(learner, {"kind": "component", "componentId": "COMP-DEAD"})
        self.assertIn("COMP-DEAD", str(raised.exception))
        self.assertIn("component", str(raised.exception))

    def test_save_progress_record_rejects_a_component_deleted_through_its_parent(self):
        learner = SimpleNamespace(pk=1)
        with patch("learner_api.active_users.component_reference_state", return_value=("deleted", "module")):
            with patch("learner_api.active_users.transaction.atomic", side_effect=AssertionError("must not write")):
                with self.assertRaises(DeletedComponentReferenceError) as raised:
                    save_progress_record(learner, {"kind": "component", "componentId": "COMP-ORPHANED-MODULE"})
        self.assertIn("module", str(raised.exception))

    def test_save_progress_record_accepts_an_active_component(self):
        learner = SimpleNamespace(pk=1)
        with patch("learner_api.active_users.component_reference_state", return_value=("active", "")):
            with patch("learner_api.active_users._component_learning_context", return_value={}):
                with patch("learner_api.active_users.transaction.atomic", side_effect=RuntimeError("reached the write")):
                    with self.assertRaises(RuntimeError):
                        save_progress_record(learner, {"kind": "component", "componentId": "COMP-LIVE"})

    def test_both_rejections_share_one_base_so_callers_map_them_to_one_status(self):
        self.assertTrue(issubclass(OrphanComponentReferenceError, ComponentReferenceError))
        self.assertTrue(issubclass(DeletedComponentReferenceError, ComponentReferenceError))


class ComponentWriteEndpointRejectionTests(SimpleTestCase):
    """The service-layer rejections must surface as a client error, not a 200."""

    def _post(self, component_id):
        request = RequestFactory().post(
            f"/learner_api/components/{component_id}/complete/?kind=apprenticeship&learnerId=19",
            data=json.dumps({}),
            content_type="application/json",
        )
        return submit_component_progress(request, component_id)

    def _run(self, save_side_effect):
        profile = SimpleNamespace(training_plan_progress=[])
        with patch("learner_api.components.SOURCE_MODELS", {"apprenticeship": Mock()}) as models:
            models["apprenticeship"].objects.get.return_value = SimpleNamespace(id=19)
            with patch("learner_api.components._component_meta", return_value=("podcast", "Podcast")):
                with patch("learner_api.components.component_ksb_codes", return_value=["K1"]):
                    with patch("learner_api.components._completion_criteria", return_value=(True, None)):
                        with patch("learner_api.components.learner_profile_for_source", return_value=profile):
                            with patch(
                                "learner_api.components.save_progress_record",
                                side_effect=save_side_effect,
                            ):
                                return self._post("COMP-UNDER-TEST")

    def test_unknown_component_write_returns_400(self):
        response = self._run(OrphanComponentReferenceError("COMP-GHOST"))
        self.assertEqual(response.status_code, 400)
        self.assertIn("COMP-GHOST", json.loads(response.content)["error"])

    def test_soft_deleted_component_write_returns_400(self):
        response = self._run(DeletedComponentReferenceError("COMP-DEAD", "week"))
        self.assertEqual(response.status_code, 400)
        payload = json.loads(response.content)
        self.assertIn("COMP-DEAD", payload["error"])
        self.assertIn("week", payload["error"])


class ProgressAchievementRuleTests(SimpleTestCase):
    """Failed / unresolved activity can never count as achieved KSB delivery.

    The rule used to be applied only to ``kind == 'quiz'``, and was safe purely
    because no failed row happened to carry Component lineage. These pin the
    rule itself, so a graded Component with a valid ``component_ref``, valid
    lineage and a valid KSB snapshot still cannot claim its KSBs on a failure.
    """

    def test_an_ungraded_completion_counts(self):
        self.assertTrue(progress_counts_as_achieved(kind="component", passed=None))
        self.assertTrue(progress_counts_as_achieved(kind="video", passed=None))

    def test_an_explicit_failure_never_counts_whatever_the_kind(self):
        for kind in ("component", "video", "quiz", "live_session", ""):
            with self.subTest(kind=kind):
                self.assertFalse(progress_counts_as_achieved(kind=kind, passed=False))

    def test_a_graded_kind_needs_an_explicit_pass(self):
        self.assertTrue(progress_counts_as_achieved(kind="quiz", passed=True))
        self.assertFalse(progress_counts_as_achieved(kind="quiz", passed=None))
        self.assertFalse(progress_counts_as_achieved(kind="QUIZ", passed=None))

    def test_a_passed_flag_on_an_ungraded_kind_is_honoured(self):
        self.assertTrue(progress_counts_as_achieved(kind="component", passed=True))

    def test_status_explains_why_a_row_was_excluded(self):
        self.assertEqual(progress_achievement_status(kind="component", passed=None), "achieved")
        self.assertEqual(progress_achievement_status(kind="component", passed=False), "failed")
        self.assertEqual(progress_achievement_status(kind="quiz", passed=None), "incomplete")
        self.assertEqual(progress_achievement_status(kind="quiz", passed=False), "failed")

    def test_record_form_reads_the_serialised_progress_shape(self):
        failed = {
            "kind": "component",
            "componentId": "COMP-20260816E2E",
            "ksbs": ["K1"],
            "passed": False,
        }
        self.assertFalse(progress_record_counts_as_achieved(failed))
        self.assertTrue(progress_record_counts_as_achieved({**failed, "passed": True}))
        self.assertFalse(progress_record_counts_as_achieved(None))
        self.assertFalse(progress_record_counts_as_achieved("not a record"))

    def test_the_rule_has_exactly_one_implementation(self):
        """No SQL twin to drift from this one — see the module docstring."""
        self.assertFalse(
            [name for name in dir(progress_rules) if "sql" in name.lower()],
            "a SQL variant of the completion rule would be a second implementation",
        )
