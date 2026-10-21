from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.test import SimpleTestCase

from . import booking_availability as availability, views


class CoachOutlookAvailabilityTests(SimpleTestCase):
    def event(self, **changes):
        return {"id": "other", "iCalUId": "other-uid", "showAs": "busy", "isCancelled": False,
                "start": {"dateTime": "2026-07-01T08:00:00", "timeZone": "UTC"},
                "end": {"dateTime": "2026-07-01T09:00:00", "timeZone": "UTC"}, **changes}

    def check(self, **options):
        availability.ensure_coach_outlook_available("coach@example.test", date(2026, 7, 1), time(9), 60, **options)

    def test_request_uses_uk_instant_and_read_only_calendar_view(self):
        for day, expected in ((date(2026, 7, 1), "08:00:00+00:00"), (date(2026, 12, 17), "09:00:00+00:00")):
            with self.subTest(day=day), patch.object(views, "microsoft_graph_request", return_value={"value": []}) as graph:
                availability.ensure_coach_outlook_available("coach@example.test", day, time(9), 60)
                self.assertEqual(graph.call_args.args[0], "GET")
                path = graph.call_args.args[1]
                self.assertTrue(path.startswith("users/coach%40example.test/calendarView?"))
                self.assertTrue(parse_qs(urlsplit(path).query)["startDateTime"][0].endswith(expected))
                self.assertNotIn("subject", path)

    def test_busy_and_tentative_overlap_is_rejected_without_private_details(self):
        for show_as in ("busy", "tentative", "oof", "unknown"):
            with self.subTest(show_as=show_as), patch.object(views, "microsoft_graph_request", return_value={"value": [self.event(showAs=show_as)]}):
                with self.assertRaisesRegex(views.LearnerCalendarConflict, "Your coach is busy") as caught:
                    self.check()
                self.assertNotIn("other-uid", str(caught.exception))

    def test_free_cancelled_and_adjacent_events_do_not_block(self):
        rows = [self.event(showAs="free"), self.event(isCancelled=True),
                self.event(start={"dateTime": "2026-07-01T09:00:00Z"}, end={"dateTime": "2026-07-01T10:00:00Z"})]
        with patch.object(views, "microsoft_graph_request", return_value={"value": rows}):
            self.check()

    def test_reschedule_excludes_only_its_own_event_not_another_at_the_same_time(self):
        record = SimpleNamespace(graph_event_id="own", graph_organizer_email="coach@example.test")
        with patch.object(views, "microsoft_graph_request", return_value={"value": [self.event(id="own")]}):
            self.check(record=record)
        with patch.object(views, "microsoft_graph_request", return_value={"value": [self.event(id="own"), self.event()]}):
            with self.assertRaises(views.LearnerCalendarConflict):
                self.check(record=record)

    def test_legacy_organizer_exclusion_uses_ical_identity(self):
        record = SimpleNamespace(graph_event_id="legacy", graph_organizer_email="original@example.test")
        with patch.object(views, "microsoft_graph_request", side_effect=[{"iCalUId": "own-uid"}, {"value": [self.event(iCalUId="own-uid")]}]) as graph:
            self.check(record=record)
        self.assertIn("original%40example.test/events/legacy", graph.call_args_list[0].args[1])

    def test_pagination_does_not_miss_a_busy_event(self):
        with patch.object(views, "get_graph_settings", return_value={"base_url": "https://graph.microsoft.com/v1.0"}), \
             patch.object(views, "microsoft_graph_request", side_effect=[
                 {"value": [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/coach%40example.test/calendarView?$skip=1"},
                 {"value": [self.event()]},
             ]):
            with self.assertRaises(views.LearnerCalendarConflict):
                self.check()

    def test_unavailable_or_malformed_calendar_never_reports_free(self):
        for result in ({}, {"value": [self.event(start={})]}, {"value": [], "@odata.nextLink": "https://example.invalid/calendarView"}):
            with self.subTest(result=result), patch.object(views, "microsoft_graph_request", return_value=result):
                with self.assertRaises(availability.CoachAvailabilityUnavailable):
                    self.check()
        with patch.object(views, "microsoft_graph_request", side_effect=RuntimeError("Private provider details")):
            with self.assertRaises(availability.CoachAvailabilityUnavailable) as caught:
                self.check()
            self.assertNotIn("Private", str(caught.exception))


class ImportedPersonalCalendarTimezoneTests(SimpleTestCase):
    def test_business_timezone_overrides_browser_offset_and_excludes_old_slot_with_its_own_dst(self):
        from learner_api import calendar_connections as calendar
        # New appointment is in winter; the old appointment was in summer.
        with patch.object(calendar, "_db", side_effect=RuntimeError("Use cached slots")), \
             patch.object(calendar, "_cached_booking_conflicts", return_value=False) as cached:
            calendar.booking_conflicts("commercial", 1, date(2026, 12, 17), time(9), 60, -120,
                exclude_scheduled_date=date(2026, 7, 1), exclude_scheduled_time=time(9), exclude_duration_minutes=60,
                business_time_zone="Europe/London")
        self.assertEqual(cached.call_args.args[2].isoformat(), "2026-12-17T09:00:00+00:00")
        self.assertEqual(cached.call_args.kwargs["exclude_start_dt"].isoformat(), "2026-07-01T08:00:00+00:00")
