"""Moving a first session moves the programme start date with it.

Booking the first session writes its date to ``learner_start_date`` because the
programme starts at that session (first_session._stamp). The reschedule
endpoint did not know that, so moving the meeting left the start date on the
old day -- and that column is the strict anchor review scheduling reads, so the
learner's whole review timeline would stay pinned to a day nothing happens on.

These cover the rule rather than the endpoint's plumbing: which event types
move the start date, and that a failure to write it does not undo a meeting
Microsoft has already moved.

``SimpleTestCase``: the learner lookup and the save are patched, so nothing
here touches the database.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import calendar as learner_calendar


def record(event_type="first-session"):
    return SimpleNamespace(event_type=event_type)


class FollowFirstSessionStartDateTests(SimpleTestCase):
    def _move(self, subject, *, event_type="first-session", kind="commercial", save=None):
        """Run the follow-up with the learner lookup stubbed out.

        ``kind`` is the kind *looked up*; the stub model is always registered
        under "commercial", so passing anything else exercises the unknown-kind
        path rather than silently registering it.
        """
        saved = {}

        def record_save(learner, fields):
            saved["fields"] = list(fields)
            saved["start"] = learner.learner_start_date

        model = SimpleNamespace(
            all_learners=SimpleNamespace(
                filter=lambda **kwargs: SimpleNamespace(first=lambda: subject)
            )
        )
        with patch.dict(learner_calendar.SOURCE_MODELS, {"commercial": model}, clear=True), \
             patch("learner_api.learner_dates.save_enrolment_fields", save or record_save):
            learner_calendar._follow_first_session_start_date(
                kind, 7, record(event_type), date(2026, 10, 5),
            )
        return saved

    def test_the_start_date_follows_the_moved_session(self):
        subject = SimpleNamespace(pk=7, learner_start_date="2026-09-23")

        saved = self._move(subject)

        self.assertEqual(saved["start"], "2026-10-05")
        self.assertEqual(saved["fields"], ["learner_start_date"])

    def test_other_session_types_leave_the_start_date_alone(self):
        """A catch-up happens *within* a programme that already started.

        Moving one must not drag the learner's start date -- and with it every
        scheduled review -- along behind it.
        """
        subject = SimpleNamespace(pk=7, learner_start_date="2026-09-23")

        saved = self._move(subject, event_type="catch-up")

        self.assertEqual(saved, {})
        self.assertEqual(subject.learner_start_date, "2026-09-23")

    def test_an_unknown_learner_kind_is_ignored(self):
        saved = self._move(SimpleNamespace(pk=7, learner_start_date=""), kind="nonsense")

        self.assertEqual(saved, {})

    def test_a_missing_learner_is_ignored(self):
        saved = self._move(None)

        self.assertEqual(saved, {})

    def test_a_failed_write_does_not_raise(self):
        """The meeting has already moved in Graph and everybody has been
        re-invited by this point, so raising would report a failure for
        something that did happen."""
        def explode(learner, fields):
            raise DatabaseError("enrolment is down")

        subject = SimpleNamespace(pk=7, learner_start_date="2026-09-23")

        # The assertion is that this returns rather than propagating.
        self._move(subject, save=explode)
