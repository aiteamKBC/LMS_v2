from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api.views import _case_file_next_session, _case_file_review_events, fetch_case_file_shell, serialize_case_file_shell


class CaseFileShellTests(SimpleTestCase):
    def test_query_is_scoped_by_stable_profile_id_and_coach(self):
        profile = SimpleNamespace(id=316, enrolment_id=5170)
        profile_queryset = MagicMock()
        profile_queryset.filter.return_value.only.return_value.first.return_value = profile
        source_queryset = MagicMock()
        source_queryset.filter.return_value.only.return_value.first.return_value = SimpleNamespace(id=5170)

        with patch("coach_api.views.LearnerProfile.objects.annotate", return_value=profile_queryset), \
             patch("coach_api.views.EnrolmentUser.all_learners", source_queryset):
            loaded_profile, source = fetch_case_file_shell(" COACH@example.test ", 316)

        self.assertIs(loaded_profile, profile)
        self.assertEqual(source.id, 5170)
        profile_queryset.filter.assert_called_once_with(id=316, coach_email_key="coach@example.test")
        source_queryset.filter.assert_called_once_with(pk=5170)

    def test_aptem_source_wins_when_profile_agrees(self):
        payload = serialize_case_file_shell(
            self.profile(aptem_id=9001), self.source(aptem_id="9001")
        )
        self.assertEqual(payload["identity"]["aptemId"], "9001")
        self.assertEqual(payload["identity"]["source"], "aptem")
        self.assertFalse(payload["identity"]["identityConflict"])

    def test_native_identity_has_no_aptem_id(self):
        payload = serialize_case_file_shell(self.profile(aptem_id=None), self.source(aptem_id=None))
        self.assertIsNone(payload["identity"]["aptemId"])
        self.assertEqual(payload["identity"]["source"], "native")

    def test_conflicting_aptem_ids_are_not_guessed(self):
        payload = serialize_case_file_shell(self.profile(aptem_id=9001), self.source(aptem_id="9002"))
        self.assertIsNone(payload["identity"]["aptemId"])
        self.assertEqual(payload["identity"]["source"], "conflict")
        self.assertTrue(payload["identity"]["identityConflict"])

    @patch("coach_api.views.curriculum_review_instances.reconcile_review_event_keys", return_value={})
    @patch("coach_api.views.fetch_standalone_event_records", return_value=[])
    @patch("coach_api.views.fetch_calendar_event_records", return_value={})
    @patch("coach_api.views.resolve_coach_review_events")
    @patch("coach_api.views.coach_staff_display_name", return_value="Coach A")
    def test_review_resolution_processes_exactly_one_stable_learner(self, _name, resolver, _records, standalone, _reconcile):
        profile = self.profile()
        resolver.return_value = {"events": [], "reviewGenerationIssues": [], "aptemProfileIds": set()}

        events, issues = _case_file_review_events("coach@example.test", profile)

        self.assertEqual(events, [])
        self.assertEqual(issues, [])
        resolver.assert_called_once_with("coach@example.test", "Coach A", [profile])
        standalone.assert_called_once_with("coach@example.test", learner_id=316)

    @patch("coach_api.views.collect_live_session_events")
    @patch("coach_api.views.coach_staff_display_name", return_value="Coach A")
    def test_next_session_uses_learner_scope_and_selects_earliest_valid_event(self, _name, collect):
        profile = self.profile(programme_id="p1", cohort_id="c1", group_id="g1")
        collect.return_value = [
            {"id": "later", "date": "2099-02-01", "startHour": 9, "status": "scheduled"},
            {"id": "cancelled", "date": "2099-01-01", "startHour": 9, "status": "cancelled"},
            {"id": "earliest", "date": "2099-01-02", "startHour": 10, "status": "scheduled"},
        ]

        event = _case_file_next_session("coach@example.test", profile)

        self.assertEqual(event["id"], "earliest")
        self.assertEqual(event["learnerId"], "316")
        self.assertEqual(event["enrolmentId"], "5170")
        collect.assert_called_once()
        kwargs = collect.call_args.kwargs
        self.assertFalse(kwargs["require_coach_access"])
        self.assertEqual(kwargs["learner_scope"]["group_id"], "g1")

    @staticmethod
    def profile(**overrides):
        values = dict(
            id=316, enrolment_id=5170, aptem_id=None, learner_type="apprenticeship",
            full_name="Daniel Test", email="daniel@example.test", programme="Programme A",
            programme_status="Active", cohort="Cohort A", group_name="Group A",
            coach_name="Coach A", coach_email="coach@example.test", coach_rag="green",
            start_date=None, end_date=None, gateway_review_date=None,
        )
        values.update(overrides)
        return SimpleNamespace(**values)

    @staticmethod
    def source(**overrides):
        values = dict(
            id=5170, aptem_id=None, learner_type="apprenticeship", username="Daniel Test",
            email="daniel@example.test", programme="Programme A", programme_status="Active",
            cohort="Cohort A", group="Group A", employer="Employer A", coach_name="Coach A",
            coach_email="coach@example.test", start_date=None, end_date=None,
        )
        values.update(overrides)
        return SimpleNamespace(**values)
