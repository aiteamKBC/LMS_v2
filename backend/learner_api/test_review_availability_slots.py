"""Synthetic Graph checks for Review slot intersections; never contacts Graph or a database."""
from datetime import date, time
from django.test import SimpleTestCase
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from learner_api.coach_availability import AvailabilityUnavailable, free_slots


class ReviewAvailabilitySlotTests(SimpleTestCase):
    day = date(2026, 10, 28)  # weekday, GMT

    def setup_calendar(self, *, zone="Europe/London", start="09:00", end="17:00", days=None, view=None):
        schedule = {
            "scheduleId": "coach@example.invalid",
            "workingHours": {
                "timeZone": {"name": zone}, "startTime": start, "endTime": end,
                "daysOfWeek": days or ["monday", "tuesday", "wednesday", "thursday", "friday"],
            },
            "availabilityView": view or "0" * 96,
        }
        records = MagicMock()
        records.exclude.return_value = records
        records.__iter__.return_value = iter(())
        manager = patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=records)
        manager.start()
        self.addCleanup(manager.stop)
        graph = patch("coach_api.views.microsoft_graph_request", return_value={"value": [schedule]})
        graph_mock = graph.start()
        self.addCleanup(graph.stop)
        return graph_mock

    def test_slots_intersect_london_hours_duration_coach_hours_and_busy_view(self):
        busy = list("0" * 96)
        busy[40:44] = list("1" * 4)  # 10:00–11:00 London
        self.setup_calendar(zone="Europe/Paris", start="10:00", end="16:00", view="".join(busy))

        slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)

        self.assertIn("09:00", slots)  # 10:00–11:00 Paris is 09:00–10:00 London in GMT.
        self.assertNotIn("10:00", slots)  # Graph busy slot.
        self.assertIn("14:00", slots)
        self.assertNotIn("15:00", slots)  # Coach working hours end at 16:00 Paris.
        self.assertNotIn("16:00", slots)
        self.assertFalse(any(slot < "09:00" for slot in slots))

    def test_duration_removes_starts_that_would_finish_after_1700(self):
        self.setup_calendar()
        for duration, latest in ((30, "16:30"), (45, "16:15"), (60, "16:00"),
                                 (90, "15:30"), (120, "15:00")):
            with self.subTest(duration=duration):
                slots = free_slots("coach@example.invalid", self.day, 0,
                                   duration=duration, review_hours=True)
                self.assertIn(latest, slots)
                self.assertNotIn(f"{(int(latest[:2]) * 60 + int(latest[3:]) + 15) // 60:02d}:"
                                 f"{(int(latest[:2]) * 60 + int(latest[3:]) + 15) % 60:02d}", slots)

    def test_review_slots_ignore_browser_offset_and_intersect_cairo_work_hours_as_instants(self):
        graph = self.setup_calendar(zone="Egypt Standard Time", start="10:00", end="18:00")
        london_slots = free_slots("coach@example.invalid", self.day, 120,
                                  duration=60, review_hours=True)
        _args, kwargs = graph.call_args
        payload = kwargs["payload"]
        self.assertEqual(payload["startTime"], {"dateTime": "2026-10-28T00:00:00+00:00", "timeZone": "UTC"})
        self.assertEqual(payload["endTime"], {"dateTime": "2026-10-29T00:00:00+00:00", "timeZone": "UTC"})
        self.assertIn("09:00", london_slots)
        self.assertIn("14:00", london_slots)
        self.assertNotIn("14:15", london_slots)

    def test_rescheduling_excludes_only_the_exact_current_graph_booking(self):
        busy = list("0" * 96)
        busy[40:44] = list("1" * 4)  # 10:00–11:00 London
        graph = self.setup_calendar(view="".join(busy))
        schedule = graph.return_value
        record = SimpleNamespace(
            pk=51, event_key="review:21:PR:1", scheduled_date=self.day,
            scheduled_time=time(10), duration_minutes=60, graph_event_id="graph-event-51",
        )
        def event(event_id, start, end):
            return {"id": event_id, "showAs": "busy", "isCancelled": False,
                    "start": {"dateTime": f"2026-10-28T{start}:00Z"},
                    "end": {"dateTime": f"2026-10-28T{end}:00Z"}}
        for other, blocked in (([], False), ([event("different-meeting", "10:30", "11:00")], True)):
            with self.subTest(other=bool(other)):
                graph.reset_mock()
                graph.side_effect = lambda method, path, **kwargs: (schedule if method == "POST" else
                    {"value": [event("graph-event-51", "10:00", "11:00"), *other]})
                slots = free_slots("coach@example.invalid", self.day, 0, duration=60,
                                   review_hours=True, exclude_event_key=record.event_key,
                                   exclude_record_id=record.pk, review_self_record=record)
                self.assertIn("09:15", slots)  # Only its own meeting overlaps.
                self.assertEqual("10:00" not in slots, blocked)
                self.assertEqual("10:15" not in slots, blocked)
                self.assertEqual(sum(call.args[0] == "GET" for call in graph.call_args_list), 1)

    def test_summer_slots_use_london_instants_not_browser_offset(self):
        graph = self.setup_calendar()
        slots = free_slots("coach@example.invalid", date(2027, 7, 1), -180, duration=30, review_hours=True)
        self.assertEqual((slots[0], slots[-1]), ("09:00", "16:30"))
        self.assertEqual(graph.call_args.kwargs["payload"]["startTime"]["dateTime"], "2027-06-30T23:00:00+00:00")


    def test_weekends_and_graph_failures_do_not_return_fabricated_slots(self):
        self.setup_calendar()
        self.assertEqual(free_slots("coach@example.invalid", date(2026, 10, 31), 0, review_hours=True), [])
        with patch("coach_api.views.microsoft_graph_request", side_effect=TimeoutError):
            with self.assertRaises(AvailabilityUnavailable):
                free_slots("coach@example.invalid", self.day, 0, review_hours=True)


class LearnerReviewAvailabilityIdentityTests(SimpleTestCase):
    def test_reschedule_uses_resolved_binding_when_profile_and_enrolment_ids_differ(self):
        from inspect import unwrap
        import json
        from django.test import RequestFactory
        from learner_api.coach_availability import coach_available_slots
        from coach_api.review_sources import ReviewIdentityConflict
        learner = SimpleNamespace(pk=121)
        profile = SimpleNamespace(id=21, coach_email="coach@example.invalid")
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = learner
        record = SimpleNamespace(pk=51, learner_id=21, event_key="booking:51",
            scheduled_date=date(2027, 3, 1), scheduled_time=time(10), duration_minutes=60,
            graph_event_id="original-event")
        rows = MagicMock()
        rows.first.return_value = record
        rows.exclude.return_value = rows
        rows.__iter__.side_effect = lambda: iter(())
        schedule = {"value": [{"scheduleId": profile.coach_email, "availabilityView": "0" * 96,
            "workingHours": {"timeZone": {"name": "Europe/London"}, "startTime": "09:00", "endTime": "17:00", "daysOfWeek": ["monday"]}}]}
        for resolved, expected in (([{"eventKey": "imported-review:1", "calendarEventKey": "booking:51"}], 200), ([], 409)):
            with self.subTest(expected=expected), \
                 patch("learner_api.learner_detail.SOURCE_MODELS", {"commercial": model}), \
                 patch("learner_api.identity.learner_profile_for_source", return_value=profile), \
                 patch("learner_api.calendar.coaching_events_for_learner", return_value=resolved), \
                 patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=rows), \
                 patch("coach_api.views.microsoft_graph_request", return_value=schedule) as graph:
                request = RequestFactory().get("/availability", {"date": "2027-03-01", "purpose": "review", "excludeEventKey": "booking:51"})
                response = unwrap(coach_available_slots)(request, "commercial", 121)
                self.assertEqual(response.status_code, expected)
                if expected == 200:
                    self.assertIn("16:00", json.loads(response.content)["times"])
                else:
                    graph.assert_not_called()
        with patch("learner_api.learner_detail.SOURCE_MODELS", {"commercial": model}), \
             patch("learner_api.identity.learner_profile_for_source", return_value=profile), \
             patch("learner_api.calendar.coaching_events_for_learner", side_effect=ReviewIdentityConflict("conflicting binding")), \
             patch("coach_api.views.microsoft_graph_request") as graph:
            response = unwrap(coach_available_slots)(request, "commercial", 121)
            self.assertEqual(response.status_code, 409)
            graph.assert_not_called()
