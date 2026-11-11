"""The Coach Review availability endpoint is exercised with synthetic data and Graph."""
import json
from datetime import date, datetime, timezone
from inspect import unwrap
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from coach_api.views import coach_review_availability


class CoachReviewAvailabilityEndpointTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 10, 27)))
        clock = self.enterContext(patch("learner_api.coach_availability.datetime", wraps=datetime))
        clock.now.return_value = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
        self.factory = RequestFactory()
        self.learner = MagicMock()
        self.learner.id = 21
        self.owner = patch.object(views, "authenticated_coach_email", return_value="coach@example.invalid")
        self.owner.start()
        self.addCleanup(self.owner.stop)
        self.caseload = patch.object(views, "fetch_caseload_dashboard_profiles", return_value=[self.learner])
        self.caseload.start()
        self.addCleanup(self.caseload.stop)
        rows = MagicMock()
        rows.exclude.return_value = rows
        rows.__iter__.return_value = iter(())
        self.rows = patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=rows)
        self.rows.start()
        self.addCleanup(self.rows.stop)
        self.graph = patch("coach_api.views.microsoft_graph_request", return_value={"value": [{
            "scheduleId": "coach@example.invalid",
            "workingHours": {"timeZone": {"name": "Europe/London"}, "startTime": "09:00",
                             "endTime": "17:00", "daysOfWeek": ["wednesday"]},
            "availabilityView": "0" * 96,
        }]})
        self.graph_mock = self.graph.start()
        self.addCleanup(self.graph.stop)

    def get(self, query="learnerId=21&date=2026-10-28&durationMinutes=75"):
        request = self.factory.get("/coach_api/coach/reviews/availability?" + query)
        return unwrap(coach_review_availability)(request)

    def test_returns_duration_specific_london_slots_from_real_slot_intersection(self):
        response = self.get()
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["timeZone"], "Europe/London")
        self.assertEqual(payload["durationMinutes"], 75)
        self.assertEqual(payload["times"][0], "09:00")
        self.assertEqual(payload["times"][-1], "15:45")
        self.assertNotIn("16:00", payload["times"])
        self.graph_mock.assert_called_once()

    def test_provider_failure_is_not_reported_as_free(self):
        self.graph_mock.side_effect = TimeoutError("synthetic timeout")
        response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)["error"], "AVAILABILITY_UNAVAILABLE")

    def test_coach_picker_uses_college_hours_when_outlook_has_no_uk_overlap(self):
        self.graph_mock.return_value["value"][0]["workingHours"] = {
            "timeZone": {"name": "Pacific Standard Time"}, "startTime": "11:00",
            "endTime": "16:00", "daysOfWeek": ["monday"],
        }
        response = self.get()
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((payload["times"][0], payload["times"][-1]), ("09:00", "15:45"))

    def test_rejects_manipulated_duration_outside_policy(self):
        response = self.get("learnerId=21&date=2026-10-28&durationMinutes=481")
        self.assertEqual(response.status_code, 400)
        self.graph_mock.assert_not_called()
