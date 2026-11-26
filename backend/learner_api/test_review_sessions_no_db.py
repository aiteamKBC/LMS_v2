"""Review list/detail contracts and real ownership gates, with database reads mocked."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import review_sessions as views


class ReviewSessionsTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=125)
        self.profile = SimpleNamespace(id=25)
        self.model = MagicMock()
        self.model.all_learners.filter.return_value.first.return_value = self.source
        self.factory = RequestFactory()
        self.events = [{"id": "imported-review:1", "eventKey": "imported-review:1",
                        "source": "progress-review", "reviewSource": "aptem",
                        "calendarEventKey": "booking-1", "migratedForm": True,
                        "importedReview": {"type": "Progress Review", "status": "completed",
                                           "sections": [{"name": "Historical answers"}]}}]
        self.read = self.enterContext(patch.object(views, "coaching_events_for_learner", return_value=self.events))
        self.mirror = self.enterContext(patch.object(views, "_calendar_profile", return_value=self.profile))
        self.outcomes = self.enterContext(patch.object(views, "annotate_meeting_outcomes"))
        self.enterContext(patch.object(views, "SOURCE_MODELS", {"commercial": self.model, "apprenticeship": self.model}))
        self.enterContext(patch("login.permissions._auth_gate_enabled", return_value=True))
        self.enterContext(patch.object(views.logger, "exception"))

    def request(self, *, role="learner", owner=125, pk=125, kind="commercial", content=None, method="get"):
        account = SimpleNamespace(role=role, subject_id=owner) if role else None
        request = getattr(self.factory, method)("/learner_api/review-sessions/", {"content": content} if content else {})
        with patch("login.permissions.authenticate_request", return_value=account):
            return views.learner_review_sessions(request, kind=kind, pk=pk)

    def test_summary_keeps_booking_and_source_metadata_using_the_narrow_reader(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                response = self.request(kind=kind, content="summary")
                self.assertEqual(response.status_code, 200)
                data = json.loads(response.content)
                expected = [{**self.events[0], "importedReview": {**self.events[0]["importedReview"], "sections": []}}]
                self.assertEqual(data["events"], expected)
                self.assertEqual(self.events[0]["importedReview"]["sections"], [{"name": "Historical answers"}])
                self.assertEqual(data["learner"], {"kind": kind, "id": 125})
                self.assertIn("bookingCalendar", data)
                self.read.assert_called_with(self.source, self.profile, only_sources=views.REVIEW_SOURCES)
                self.outcomes.assert_called_with(expected)

    def test_full_read_keeps_historical_sections_and_never_uses_summary_mode(self):
        response = self.request()
        self.assertEqual(json.loads(response.content)["events"][0]["importedReview"]["sections"],
                         [{"name": "Historical answers"}])
        self.read.assert_called_once_with(self.source, self.profile)

    def test_only_review_sessions_are_returned_without_loading_lectures_or_recovery(self):
        self.read.return_value = [self.events[0], {"eventKey": "catch-up:1", "source": "catch-up"},
                                  {"eventKey": "native:1", "source": "progress-review", "reviewSource": "curriculum"},
                                  self.events[0]]
        with patch("learner_api.calendar.assigned_curriculum_module_ids") as modules, \
             patch("learner_api.calendar.alternative_recovery_events_for_learner") as recovery, \
             patch("coach_api.views.collect_live_session_events") as lectures:
            response = self.request(content="summary")
        self.assertEqual([event["eventKey"] for event in json.loads(response.content)["events"]],
                         ["imported-review:1", "native:1"])
        modules.assert_not_called()
        recovery.assert_not_called()
        lectures.assert_not_called()

    def test_empty_source_stays_empty(self):
        self.read.return_value = []
        self.assertEqual(json.loads(self.request(content="summary").content)["events"], [])

    def test_failures_are_not_returned_as_an_empty_success(self):
        self.read.side_effect = DatabaseError("synthetic unavailable store")
        response = self.request(content="summary")
        self.assertEqual(response.status_code, 502)
        self.assertNotIn("events", json.loads(response.content))

    def test_other_learners_employers_and_anonymous_callers_cannot_read(self):
        for options, expected in [({"owner": 126}, 404), ({"role": "employer"}, 403), ({"role": None}, 401)]:
            with self.subTest(options=options):
                self.assertEqual(self.request(**options).status_code, expected)
        self.model.all_learners.filter.assert_not_called()
        self.read.assert_not_called()

    def test_staff_and_admin_retain_existing_read_access(self):
        for role in ("staff", "admin"):
            with self.subTest(role=role):
                self.assertEqual(self.request(role=role, owner=99).status_code, 200)

    def test_invalid_requests_do_not_read_reviews(self):
        for options, expected in [({"kind": "unknown"}, 404), ({"content": "invalid"}, 400), ({"method": "post"}, 405)]:
            with self.subTest(options=options):
                self.assertEqual(self.request(**options).status_code, expected)
        self.read.assert_not_called()

    def test_missing_learner_is_not_an_empty_review_list(self):
        self.model.all_learners.filter.return_value.first.return_value = None
        self.assertEqual(self.request().status_code, 404)
        self.read.assert_not_called()
