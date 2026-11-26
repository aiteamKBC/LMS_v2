"""Synthetic checks for college Review hours and conflicts; no live Graph or database."""
from datetime import date, datetime, time, timezone
from django.test import SimpleTestCase
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from learner_api.coach_availability import AvailabilityUnavailable, free_slots


class ReviewAvailabilitySlotTests(SimpleTestCase):
    day = date(2026, 10, 28)  # weekday, GMT

    def setUp(self):
        # Keep the booking day in the future regardless of when the suite runs.
        self.enterContext(patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 10, 27)))
        clock = self.enterContext(patch("learner_api.coach_availability.datetime", wraps=datetime))
        clock.now.return_value = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)

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

    def test_slots_use_college_hours_and_still_exclude_outlook_conflicts(self):
        busy = list("0" * 96)
        busy[40:44] = list("1" * 4)  # 10:00–11:00 London
        self.setup_calendar(zone="Europe/Paris", start="10:00", end="16:00", view="".join(busy))

        slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)

        self.assertIn("09:00", slots)
        self.assertNotIn("10:00", slots)  # Graph busy slot.
        self.assertIn("14:00", slots)
        self.assertIn("15:00", slots)  # Personal Outlook working hours do not close the college day.
        self.assertIn("16:00", slots)
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

    def test_review_slots_ignore_browser_offset_and_cairo_work_hours(self):
        graph = self.setup_calendar(zone="Egypt Standard Time", start="10:00", end="18:00")
        london_slots = free_slots("coach@example.invalid", self.day, 120,
                                  duration=60, review_hours=True)
        _args, kwargs = graph.call_args
        payload = kwargs["payload"]
        self.assertEqual(payload["startTime"], {"dateTime": "2026-10-28T00:00:00+00:00", "timeZone": "UTC"})
        self.assertEqual(payload["endTime"], {"dateTime": "2026-10-29T00:00:00+00:00", "timeZone": "UTC"})
        self.assertIn("09:00", london_slots)
        self.assertIn("14:00", london_slots)
        self.assertIn("14:15", london_slots)
        self.assertEqual(london_slots[-1], "16:00")

    def test_personal_working_hours_days_and_timezone_cannot_restrict_reviews(self):
        graph = self.setup_calendar()
        schedule = graph.return_value["value"][0]
        for hours in (
            {"timeZone": {"name": "Pacific Standard Time"}, "startTime": "11:00",
             "endTime": "16:00", "daysOfWeek": ["monday"]},
            {"timeZone": {"name": "Middle East Standard Time"}, "startTime": "08:00",
             "endTime": "17:00", "daysOfWeek": []},
            {}, None,
        ):
            with self.subTest(hours=hours):
                if hours is None:
                    schedule.pop("workingHours", None)
                else:
                    schedule["workingHours"] = hours
                slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)
                self.assertEqual((slots[0], slots[-1], len(slots)), ("09:00", "16:00", 29))

    def test_pacific_hours_do_not_hide_free_morning_but_tentative_meetings_still_block(self):
        busy = list("0" * 96)
        busy[36:38] = "11"  # 09:00-09:30 London.
        busy[64:68] = "1111"  # 16:00-17:00 London.
        self.setup_calendar(zone="Pacific Standard Time", start="08:00", end="17:00", view="".join(busy))
        slots = free_slots("coach@example.invalid", date(2026, 11, 2), 0, duration=60, review_hours=True)
        self.assertEqual((slots[0], slots[-1], len(slots)), ("09:30", "15:00", 23))
        self.assertNotIn("09:00", slots)
        self.assertNotIn("15:15", slots)

    def test_every_non_free_outlook_status_still_blocks_overlapping_reviews(self):
        graph = self.setup_calendar()
        for status in "12345":  # Tentative, busy, out of office and unknown values.
            with self.subTest(status=status):
                busy = list("0" * 96)
                busy[40:44] = status * 4
                graph.return_value["value"][0]["availabilityView"] = "".join(busy)
                slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)
                self.assertIn("09:00", slots)
                self.assertNotIn("09:15", slots)
                self.assertNotIn("10:00", slots)
                self.assertIn("11:00", slots)

    def test_review_does_not_acquire_the_catchup_one_hour_lead_time(self):
        self.setup_calendar()
        with patch("learner_api.coach_availability.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 28, 8, 45, tzinfo=timezone.utc)
            slots = free_slots("coach@example.invalid", self.day, 0, duration=60, review_hours=True)
        self.assertEqual(slots[0], "09:00")

    def test_non_review_slots_still_use_outlook_working_hours(self):
        self.setup_calendar(start="10:00", end="12:00")
        slots = free_slots("coach@example.invalid", self.day, 0, duration=60)
        self.assertEqual((slots[0], slots[-1], len(slots)), ("10:00", "11:00", 5))

    def test_missing_or_incomplete_free_busy_data_never_opens_review_slots(self):
        graph = self.setup_calendar()
        for schedule in ({}, {"availabilityView": "0"}, {"error": {"responseCode": "Unavailable"}}):
            with self.subTest(schedule=schedule):
                graph.return_value = {"value": [{"scheduleId": "coach@example.invalid", **schedule}]}
                with self.assertRaises(AvailabilityUnavailable):
                    free_slots("coach@example.invalid", self.day, 0, review_hours=True)

    def test_final_booking_validation_uses_the_same_college_slots_and_conflicts(self):
        from coach_api.booking_availability import ensure_coach_review_slot_available
        from coach_api.views import LearnerCalendarConflict
        busy = list("0" * 96)
        busy[40:44] = "2222"
        self.setup_calendar(zone="Pacific Standard Time", view="".join(busy))
        ensure_coach_review_slot_available("coach@example.invalid", self.day, time(9), 60)
        with self.assertRaises(LearnerCalendarConflict):
            ensure_coach_review_slot_available("coach@example.invalid", self.day, time(10), 60)

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
        graph = self.setup_calendar()
        for day in (date(2026, 10, 31), date(2026, 11, 1), date(2026, 12, 25), date(2026, 10, 26)):
            with self.subTest(day=day):
                self.assertEqual(free_slots("coach@example.invalid", day, 0, review_hours=True), [])
        graph.assert_not_called()
        with patch("coach_api.views.microsoft_graph_request", side_effect=TimeoutError):
            with self.assertRaises(AvailabilityUnavailable):
                free_slots("coach@example.invalid", self.day, 0, review_hours=True)


class LearnerReviewAvailabilityIdentityTests(SimpleTestCase):
    def test_both_learner_kinds_receive_college_hours_despite_personal_outlook_hours(self):
        import json
        from inspect import unwrap
        from django.test import RequestFactory
        from learner_api.coach_availability import coach_available_slots
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = SimpleNamespace(pk=121)
        profile = SimpleNamespace(id=21, coach_email="coach@example.invalid")
        rows = MagicMock()
        rows.exclude.return_value = rows
        rows.__iter__.side_effect = lambda: iter(())
        schedule = {"value": [{"scheduleId": profile.coach_email, "availabilityView": "0" * 96,
            "workingHours": {"timeZone": {"name": "Pacific Standard Time"}, "startTime": "11:00",
                             "endTime": "16:00", "daysOfWeek": ["friday"]}}]}
        with patch("learner_api.booking_calendar.timezone.localdate", return_value=date(2026, 10, 27)), \
             patch("learner_api.coach_availability.datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 27, 12, tzinfo=timezone.utc)
            for kind in ("commercial", "apprenticeship"):
                with self.subTest(kind=kind), \
                     patch("learner_api.learner_detail.SOURCE_MODELS", {kind: model}), \
                     patch("learner_api.identity.learner_profile_for_source", return_value=profile), \
                     patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=rows), \
                     patch("coach_api.views.microsoft_graph_request", return_value=schedule):
                    request = RequestFactory().get("/availability", {
                        "date": "2026-11-02", "purpose": "review", "durationMinutes": 60,
                    })
                    response = unwrap(coach_available_slots)(request, kind, 121)
                    self.assertEqual(response.status_code, 200)
                    slots = json.loads(response.content)["times"]
                    self.assertEqual((slots[0], slots[-1], len(slots)), ("09:00", "16:00", 29))

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
