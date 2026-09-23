"""Free slots for a named case owner, used by the enrolment form.

The enrolment form books a real meeting on a real person's calendar before the
learner exists, so it cannot use ``coach_available_slots`` -- that resolves the
coach from the learner's own profile. These are the rules of the sibling
endpoint that names the case owner instead:

* the mailbox is resolved the same way the booking itself resolves it, so the
  slots shown belong to the calendar the meeting will be created on;
* an unknown or ambiguous name has no mailbox, and is refused rather than
  quietly checking somebody else's diary;
* a Microsoft outage is reported as such, because an empty list would read as
  "that person is fully booked".

``SimpleTestCase``: ``free_slots`` and the staff-name lookup are patched, so
nothing here touches the database or Graph.
"""
import json
from unittest.mock import patch

from django.test import SimpleTestCase
from django.test.client import RequestFactory

from .coach_availability import (
    AvailabilityUnavailable,
    case_owner_available_slots,
    college_day_availability,
    college_day_hours,
    within_college_hours,
)


def call(**params):
    """Invoke the view with the auth gate off, as an anonymous staff request.

    ``LEARNER_API_REQUIRE_AUTH=0`` is the documented switch ``staff_only``
    itself reads; the permission behaviour is the decorator's own contract and
    is tested with it, so these tests exercise the view's logic.
    """
    request = RequestFactory().get("/learner_api/calendar/case-owner-availability/", params)
    with patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
        return case_owner_available_slots(request)


def body(response):
    """The decoded JSON payload -- a view called directly returns a raw
    ``JsonResponse``, which has no test-client ``.json()`` helper."""
    return json.loads(response.content.decode("utf-8"))


class CaseOwnerAvailabilityTests(SimpleTestCase):
    def test_returns_the_named_owners_free_slots(self):
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann Coach", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots",
                   return_value=["09:00", "10:00"]) as slots:
            response = call(caseOwner="Ann Coach", date="2026-10-01", timezoneOffsetMinutes="-60")

        self.assertEqual(response.status_code, 200)
        payload = body(response)
        self.assertEqual(payload["date"], "2026-10-01")
        self.assertEqual(payload["durationMinutes"], 60)
        # Only the free hours are bookable...
        self.assertEqual(payload["times"], ["09:00", "10:00"])
        # ...but the whole college day is reported, so the form can show the
        # taken hours as taken rather than silently omitting them.
        self.assertEqual([slot["time"] for slot in payload["slots"]], college_day_hours())
        self.assertEqual(
            [slot["time"] for slot in payload["slots"] if slot["available"]],
            ["09:00", "10:00"],
        )
        # The mailbox checked is the one resolved from the name, not the name.
        self.assertEqual(slots.call_args.args[0], "ann@kbc.test")

    def test_free_busy_is_never_cached(self):
        """A stale slot list would offer a time the owner has since filled."""
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots", return_value=[]):
            response = call(caseOwner="Ann", date="2026-10-01")

        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_missing_case_owner_is_refused(self):
        with patch("learner_api.coach_availability.free_slots") as slots:
            response = call(date="2026-10-01")

        self.assertEqual(response.status_code, 400)
        slots.assert_not_called()

    def test_a_name_with_no_mailbox_is_refused_rather_than_guessed(self):
        """An ambiguous or unknown name resolves to an empty email.

        Checking anybody's calendar on the strength of that would be showing one
        person's diary under another person's name.
        """
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": ""}), \
             patch("learner_api.coach_availability.free_slots") as slots:
            response = call(caseOwner="Ann", date="2026-10-01")

        self.assertEqual(response.status_code, 400)
        self.assertIn("email address", body(response)["error"])
        slots.assert_not_called()

    def test_a_bad_date_is_refused(self):
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots") as slots:
            response = call(caseOwner="Ann", date="not-a-date")

        self.assertEqual(response.status_code, 400)
        slots.assert_not_called()

    def test_an_out_of_range_offset_is_refused(self):
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots") as slots:
            response = call(caseOwner="Ann", date="2026-10-01", timezoneOffsetMinutes="9000")

        self.assertEqual(response.status_code, 400)
        slots.assert_not_called()

    def test_a_microsoft_outage_is_reported_not_shown_as_fully_booked(self):
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots",
                   side_effect=AvailabilityUnavailable("Could not check the coach calendar.")):
            response = call(caseOwner="Ann", date="2026-10-01")

        self.assertEqual(response.status_code, 503)
        self.assertIn("Could not check", body(response)["error"])


class CollegeHoursTests(SimpleTestCase):
    """The college's own working day, not the case owner's Outlook one.

    ``free_slots`` judges availability against the owner's working hours in the
    owner's own timezone, then reports the time in the caller's zone. For a
    mailbox set to another country those disagree, and the first session is
    booked at UK wall clock regardless -- so a slot outside the college day
    would book an hour the owner is not working.
    """

    def test_hours_outside_the_college_day_are_dropped(self):
        self.assertEqual(
            within_college_hours(["06:00", "07:00", "09:00", "16:00", "17:00", "18:00"]),
            ["09:00", "16:00"],
        )

    def test_the_last_slot_starts_early_enough_to_finish_by_five(self):
        """An hour-long session starting at 16:30 would run past 17:00."""
        self.assertEqual(within_college_hours(["16:00", "16:30", "17:00"]), ["16:00"])

    def test_quarter_hours_are_dropped_so_the_form_offers_whole_hours(self):
        self.assertEqual(
            within_college_hours(["09:00", "09:15", "09:30", "09:45", "10:00"]),
            ["09:00", "10:00"],
        )

    def test_a_malformed_time_is_skipped_rather_than_raising(self):
        self.assertEqual(within_college_hours(["nope", "10:00"]), ["10:00"])

    def test_the_endpoint_applies_the_college_day(self):
        """A Cairo-timezone mailbox reports UK slots from 07:00; the form must
        not offer them."""
        with patch("learner_api.coach_assignment.case_owner_coach",
                   return_value={"coach_name": "Ann", "coach_email": "ann@kbc.test"}), \
             patch("learner_api.coach_availability.free_slots",
                   return_value=["07:00", "08:00", "09:00", "14:00", "18:00"]):
            response = call(caseOwner="Ann", date="2026-10-01")

        self.assertEqual(body(response)["times"], ["09:00", "14:00"])


class CollegeDayAvailabilityTests(SimpleTestCase):
    """Every hour of the college day, each marked free or busy.

    The form lists the whole day so a taken hour reads as taken. An hour simply
    missing would read as the college not working then, which is a different
    and wrong message.
    """

    def test_the_whole_college_day_is_reported(self):
        self.assertEqual(
            [slot["time"] for slot in college_day_availability([])],
            ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"],
        )

    def test_hours_the_owner_is_busy_are_reported_as_unavailable(self):
        day = {slot["time"]: slot["available"] for slot in college_day_availability(["09:00", "14:00"])}

        self.assertTrue(day["09:00"])
        self.assertTrue(day["14:00"])
        self.assertFalse(day["10:00"])
        self.assertFalse(day["16:00"])

    def test_a_fully_booked_day_still_lists_every_hour(self):
        """Nothing is selectable, but the day is not shown as non-working."""
        day = college_day_availability([])

        self.assertEqual(len(day), 8)
        self.assertFalse(any(slot["available"] for slot in day))

    def test_a_free_hour_outside_the_college_day_is_not_offered(self):
        """A foreign-timezone mailbox can report 07:00 as free; it is not a
        time this college books, and booking it would use UK wall clock."""
        day = college_day_availability(["07:00", "09:00"])

        self.assertNotIn("07:00", [slot["time"] for slot in day])
        self.assertEqual([s["time"] for s in day if s["available"]], ["09:00"])
