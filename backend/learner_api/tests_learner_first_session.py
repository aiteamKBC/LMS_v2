"""The learner's own first-session state, and the gate it drives.

The first session moved off the enrolment form and onto the learner: they sign
in, book it with their case owner, and their programme opens on the day. This
endpoint is the single answer to "where does this learner stand", and the
``access`` word it returns is what holds them out or lets them in.

The rules that matter here, rather than the plumbing:

* the decision is the server's, so a learner cannot reach their programme early
  by changing the clock on their own machine;
* it is computed per request, so nothing has to run overnight and a moved
  session takes effect at once;
* an Aptem learner never gets a first session at all, so the gate must let them
  straight through rather than holding them out for good.

``SimpleTestCase``: the learner lookup, the calendar row and the case-owner
resolution are patched, so nothing here touches the database.
"""
import json
from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from django.test.client import RequestFactory

from . import calendar as learner_calendar


def body(response):
    return json.loads(response.content.decode("utf-8"))


def booking(scheduled_date, *, status="scheduled"):
    return SimpleNamespace(
        pk=1, event_key="first-session:7:1:2026-10-05", event_type="first-session",
        scheduled_date=scheduled_date, scheduled_time=time(10, 0), duration_minutes=60,
        status=status, sequence=1,
    )


class FirstSessionAccessTests(SimpleTestCase):
    def call(self, *, record=None, aptem_id=None, owner=("ann@kbc.test", "Ann Coach")):
        learner = SimpleNamespace(pk=7, aptem_id=aptem_id)
        model = SimpleNamespace(
            all_learners=SimpleNamespace(
                filter=lambda **kw: SimpleNamespace(first=lambda: learner)
            )
        )
        chain = SimpleNamespace(
            exclude=lambda **kw: SimpleNamespace(
                order_by=lambda *a: SimpleNamespace(first=lambda: record)
            )
        )
        request = RequestFactory().get("/learner_api/calendar/commercial/7/first-session/")
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch.object(learner_calendar.CoachCalendarEvent, "objects",
                          SimpleNamespace(filter=lambda **kw: chain)), \
             patch.object(learner_calendar, "_case_owner_contact", lambda l: owner), \
             patch.object(learner_calendar, "_serialize_event", lambda r: {"eventKey": r.event_key}), \
             patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            return learner_calendar.learner_first_session(request, "commercial", 7)

    def test_nothing_booked_asks_the_learner_to_book(self):
        payload = body(self.call(record=None))

        self.assertEqual(payload["access"], "book")
        self.assertFalse(payload["booked"])
        self.assertIsNone(payload["startsOn"])
        self.assertEqual(payload["caseOwner"], {"name": "Ann Coach", "email": "ann@kbc.test"})

    def test_a_session_still_ahead_holds_the_learner(self):
        ahead = learner_calendar.first_session_uk_today() + timedelta(days=3)

        payload = body(self.call(record=booking(ahead)))

        self.assertEqual(payload["access"], "waiting")
        self.assertTrue(payload["booked"])
        self.assertEqual(payload["startsOn"], ahead.isoformat())

    def test_the_programme_opens_on_the_day_itself(self):
        """Not the day after: the session happens on this date, and the learner
        should find their programme there when they arrive for it."""
        today = learner_calendar.first_session_uk_today()

        payload = body(self.call(record=booking(today)))

        self.assertEqual(payload["access"], "open")

    def test_a_session_already_held_leaves_the_programme_open(self):
        behind = learner_calendar.first_session_uk_today() - timedelta(days=1)

        self.assertEqual(body(self.call(record=booking(behind)))["access"], "open")

    def test_an_aptem_learner_is_never_held_out(self):
        """They arrive with a history and are skipped by the booking code, so a
        first session is never going to exist for them."""
        payload = body(self.call(record=None, aptem_id="123456"))

        self.assertEqual(payload["access"], "open")
        self.assertFalse(payload["booked"])

    def test_a_learner_with_no_case_owner_is_reported_rather_than_guessed(self):
        payload = body(self.call(record=None, owner=("", "")))

        self.assertIsNone(payload["caseOwner"])
        # Still 'book': the screen says who to contact rather than pretending
        # there is nothing to arrange.
        self.assertEqual(payload["access"], "book")

    def test_free_busy_and_access_are_never_cached(self):
        """A stale answer would hold a learner out on the morning of their own
        session, or let them in the day before."""
        response = self.call(record=None)

        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_an_unknown_kind_is_refused(self):
        request = RequestFactory().get("/x/")
        with patch.dict(learner_calendar.SOURCE_MODELS, {}, clear=True), \
             patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            response = learner_calendar.learner_first_session(request, "nonsense", 7)

        self.assertEqual(response.status_code, 404)

    def test_only_get_is_allowed(self):
        request = RequestFactory().post("/learner_api/calendar/commercial/7/first-session/")
        with patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            response = learner_calendar.learner_first_session(request, "commercial", 7)

        self.assertEqual(response.status_code, 405)


class CancelledFirstSessionTests(SimpleTestCase):
    def test_a_cancelled_session_is_excluded_from_the_lookup(self):
        """A cancelled session is one that is no longer happening, so the
        learner is back to booking rather than waiting for it."""
        seen = {}

        learner = SimpleNamespace(pk=7, aptem_id=None)
        model = SimpleNamespace(
            all_learners=SimpleNamespace(filter=lambda **kw: SimpleNamespace(first=lambda: learner))
        )

        def exclude(**kwargs):
            seen["excluded"] = kwargs
            return SimpleNamespace(order_by=lambda *a: SimpleNamespace(first=lambda: None))

        def filter_(**kwargs):
            seen["filtered"] = kwargs
            return SimpleNamespace(exclude=exclude)

        request = RequestFactory().get("/learner_api/calendar/commercial/7/first-session/")
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch.object(learner_calendar.CoachCalendarEvent, "objects",
                          SimpleNamespace(filter=filter_)), \
             patch.object(learner_calendar, "_case_owner_contact", lambda l: ("a@b.test", "A")), \
             patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            learner_calendar.learner_first_session(request, "commercial", 7)

        self.assertEqual(seen["filtered"]["event_type"], "first-session")
        self.assertEqual(seen["excluded"]["status"], "cancelled")


class BookingBeforeActiveTests(SimpleTestCase):
    """What a learner may book before their programme has started.

    A learner waiting for their first session is Onboarding or Delivery, never
    Active -- so they have no coach mirror. The first session is the meeting
    that makes them Active, so requiring one to book it would be circular.
    Everything else stays shut until the programme is actually running.
    """

    def book(self, session_type, *, mirror=None, existing=False, owner=("ann@kbc.test", "Ann", 3)):
        learner = SimpleNamespace(pk=7, aptem_id=None, email="l@kbc.test", username="L")
        model = SimpleNamespace(
            all_learners=SimpleNamespace(filter=lambda **kw: SimpleNamespace(first=lambda: learner))
        )
        chain = SimpleNamespace(
            exclude=lambda **kw: SimpleNamespace(exists=lambda: existing)
        )
        request = RequestFactory().post(
            "/learner_api/calendar/commercial/7/book/",
            data=json.dumps({"sessionType": session_type}),
            content_type="application/json",
        )
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch.object(learner_calendar, "learner_profile_for_source", lambda *a, **k: mirror), \
             patch.object(learner_calendar, "_case_owner_record", lambda l: owner), \
             patch.object(learner_calendar.CoachCalendarEvent, "objects",
                          SimpleNamespace(filter=lambda **kw: chain)), \
             patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            return learner_calendar.learner_calendar_book(request, "commercial", 7)

    def test_a_pre_active_learner_may_book_their_first_session(self):
        """No coach mirror, so this used to be refused outright -- which made
        the one meeting that starts the programme impossible to arrange."""
        response = self.book("first-session", mirror=None)

        # It gets past the Active check and fails later on the missing date,
        # which is the next thing the view asks for.
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("Only Active learners", body(response)["error"])

    def test_a_pre_active_learner_cannot_book_anything_else(self):
        for session_type in ("catch-up", "student-support", "mcr", "progress-review"):
            with self.subTest(session_type=session_type):
                response = self.book(session_type, mirror=None)

                self.assertEqual(response.status_code, 400)
                self.assertIn("Only Active learners", body(response)["error"])
                # Says what they can do instead of only what they cannot.
                self.assertIn("first learning session", body(response)["error"])

    def test_the_first_session_is_booked_with_the_case_owner_not_a_coach(self):
        seen = {}

        def owner(learner):
            seen["asked"] = True
            return ("ann@kbc.test", "Ann", 3)

        learner = SimpleNamespace(pk=7, aptem_id=None, email="l@kbc.test", username="L")
        model = SimpleNamespace(
            all_learners=SimpleNamespace(filter=lambda **kw: SimpleNamespace(first=lambda: learner))
        )
        chain = SimpleNamespace(exclude=lambda **kw: SimpleNamespace(exists=lambda: False))
        request = RequestFactory().post(
            "/learner_api/calendar/commercial/7/book/",
            data=json.dumps({"sessionType": "first-session"}),
            content_type="application/json",
        )
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch.object(learner_calendar, "learner_profile_for_source", lambda *a, **k: None), \
             patch.object(learner_calendar, "_case_owner_record", owner), \
             patch.object(learner_calendar.CoachCalendarEvent, "objects",
                          SimpleNamespace(filter=lambda **kw: chain)), \
             patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}):
            learner_calendar.learner_calendar_book(request, "commercial", 7)

        self.assertTrue(seen.get("asked"))

    def test_a_learner_with_no_case_owner_is_told_who_to_contact(self):
        response = self.book("first-session", mirror=None, owner=("", "", None))

        self.assertEqual(response.status_code, 400)
        self.assertIn("case owner", body(response)["error"])

    def test_a_second_first_session_is_refused(self):
        """One programme start, one first session. A stale tab must not produce
        two meetings and two invitations."""
        response = self.book("first-session", mirror=None, existing=True)

        self.assertEqual(response.status_code, 409)
        self.assertIn("already booked", body(response)["error"])


class BookingStampsTheStartDateTests(SimpleTestCase):
    """Booking the first session sets the learner's programme start date.

    The enrolment form used to do this through first_session._stamp. The
    learner books it themselves now, so the booking endpoint has to carry the
    date across -- it is the anchor review scheduling reads, and the enrolment
    header states it. Without this the header showed an empty start date next
    to a booked session.
    """

    def test_the_booked_date_becomes_the_start_date(self):
        saved = {}

        def record_save(learner, fields):
            saved["fields"] = list(fields)
            saved["start"] = learner.learner_start_date

        subject = SimpleNamespace(pk=7, learner_start_date=None)
        model = SimpleNamespace(
            all_learners=SimpleNamespace(filter=lambda **kw: SimpleNamespace(first=lambda: subject))
        )
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch("learner_api.learner_dates.save_enrolment_fields", record_save):
            learner_calendar._follow_first_session_start_date(
                "commercial", 7,
                SimpleNamespace(event_type="first-session"),
                date(2026, 9, 22),
            )

        self.assertEqual(saved["start"], "2026-09-22")
        self.assertEqual(saved["fields"], ["learner_start_date"])

    def test_the_booking_endpoint_stamps_it(self):
        """Guards the wiring, not the helper: the call was missing from the
        booking path even though the helper existed for reschedule."""
        import inspect

        source = inspect.getsource(learner_calendar.learner_calendar_book)

        self.assertIn("_follow_first_session_start_date", source)
