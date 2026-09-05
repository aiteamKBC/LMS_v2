"""The learner's calendar shows the same coaching cycle their coach sees.

Monthly coaching and progress reviews are generated, not stored: the coach
timetable derives them from the learner's delivery window every time it loads,
and a row exists only once somebody schedules one. The learner calendar read
stored rows alone, so a learner whose coach had not booked yet saw an empty
calendar while their coach saw a column of "Not Scheduled" slots.

These cover the two halves of the fix: the cycle is generated with the coach's
own generator (same intervals, same window, same keys), and stored rows win
where they exist.
"""
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from coach_api.views import (
    TIMETABLE_MCR_INTERVAL,
    TIMETABLE_PROGRESS_REVIEW_INTERVAL,
    build_timetable_event_key,
)

from .calendar import _belongs_to_current_cycle, _generated_cycle_events

START = date(2026, 8, 3)
END = date(2027, 8, 2)


def _mirror(**kwargs):
    fields = {
        'id': 248,
        'email': 'aya.khater@example.com',
        'start_date': START,
        'end_date': END,
        'coach_name': 'Coach Two',
        'coach_email': 'coach21@g.com',
        # Read when live curriculum sessions are folded in; empty keeps these
        # focused on the coaching cycle.
        'programme': '',
        'cohort': '',
        'group_name': '',
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def _learner(**kwargs):
    fields = {
        'pk': 101,
        'email': 'aya.khater@example.com',
        'start_date': None,
        'end_date': None,
        'practical_period_end_date': '',
        'apprenticeship_end_date': '',
    }
    fields.update(kwargs)
    return SimpleNamespace(**fields)


def _record(event_type='mcr', learner_id=248, event_key='mcr:248:1:2026-09-02'):
    return SimpleNamespace(event_type=event_type, learner_id=learner_id, event_key=event_key)


class GeneratedCycleTests(SimpleTestCase):
    def test_the_cycle_is_generated_from_the_learners_window(self):
        events = _generated_cycle_events(_learner(), _mirror(), set())

        monthly = [e for e in events if e['source'] == 'mcr']
        reviews = [e for e in events if e['source'] == 'progress-review']
        self.assertTrue(monthly)
        self.assertTrue(reviews)
        # Counted from the start date at the coach's own intervals.
        self.assertEqual(monthly[0]['date'], (START + TIMETABLE_MCR_INTERVAL).isoformat())
        self.assertEqual(
            reviews[0]['date'], (START + TIMETABLE_PROGRESS_REVIEW_INTERVAL).isoformat(),
        )

    def test_every_slot_carries_the_key_the_coach_timetable_builds(self):
        # The keys are how the two calendars are reconciled — a different key
        # would put the same meeting on both screens as two separate items.
        events = _generated_cycle_events(_learner(), _mirror(), set())
        first = next(e for e in events if e['source'] == 'mcr')

        self.assertEqual(
            first['eventKey'],
            build_timetable_event_key(248, 'mcr', 1, START + TIMETABLE_MCR_INTERVAL),
        )

    def test_a_generated_slot_reads_as_not_scheduled_with_no_time(self):
        events = _generated_cycle_events(_learner(), _mirror(), set())
        first = events[0]

        self.assertEqual(first['status'], 'not-scheduled')
        self.assertIsNone(first['scheduledDate'])
        self.assertIsNone(first['scheduledTime'])
        self.assertFalse(first['invited'])
        self.assertTrue(first['isTimeEstimated'])
        # Named as the learner's own coach, since that is who they would meet.
        self.assertEqual(first['coachEmail'], 'coach21@g.com')

    def test_a_slot_that_is_already_booked_is_left_to_its_stored_row(self):
        booked = build_timetable_event_key(248, 'mcr', 1, START + TIMETABLE_MCR_INTERVAL)

        events = _generated_cycle_events(_learner(), _mirror(), {booked})

        self.assertNotIn(booked, [e['eventKey'] for e in events])
        # The rest of the cycle still generates.
        self.assertTrue([e for e in events if e['source'] == 'mcr'])

    def test_the_window_falls_back_to_the_enrolment_row(self):
        # The coach passes prefetched commercial/enrolment maps; this endpoint
        # holds one learner, so the row's own dates stand in.
        learner = _learner(start_date='2026-08-03', end_date='2027-08-02')

        events = _generated_cycle_events(learner, _mirror(start_date=None, end_date=None), set())

        self.assertTrue(events)

    def test_a_learner_with_no_window_has_no_cycle_to_show(self):
        # Nothing to count from — the coach timetable skips them too.
        self.assertEqual(
            _generated_cycle_events(_learner(), _mirror(start_date=None, end_date=None), set()), [],
        )

    def test_an_end_date_before_the_start_generates_nothing(self):
        mirror = _mirror(start_date=END, end_date=START)

        self.assertEqual(_generated_cycle_events(_learner(), mirror, set()), [])

    def test_a_learner_with_no_delivery_record_has_no_cycle(self):
        self.assertEqual(_generated_cycle_events(_learner(), None, set()), [])


class StoredRowOwnershipTests(SimpleTestCase):
    """Which stored rows are this learner's cycle.

    Rows match on email as well as mirror id, so a learner's bookings survive
    their mirror being recreated. The bad case is a cycle slot generated against
    a mirror that has since been deleted: its dates came from a window the
    learner no longer has, and the coach — who only builds keys from live
    caseload profiles — cannot see it.
    """

    def test_a_slot_from_this_learners_own_mirror_is_kept(self):
        self.assertTrue(_belongs_to_current_cycle(_record(), _mirror()))

    def test_a_slot_left_behind_by_a_deleted_mirror_is_dropped(self):
        orphan = _record(learner_id=2, event_key='mcr:2:1:2026-08-07')

        self.assertFalse(_belongs_to_current_cycle(orphan, _mirror()))

    def test_a_booking_is_kept_whatever_mirror_it_was_made_under(self):
        # Somebody arranged these; they belong to the learner regardless.
        for event_type in ('catch-up', 'student-support', 'eligibility-review'):
            record = _record(event_type=event_type, learner_id=2)
            self.assertTrue(
                _belongs_to_current_cycle(record, _mirror()),
                f'{event_type} should survive a mirror change',
            )

    def test_a_row_with_no_learner_id_is_kept(self):
        # Matched by email alone; nothing says it is not theirs.
        self.assertTrue(_belongs_to_current_cycle(_record(learner_id=None), _mirror()))

    def test_nothing_is_filtered_for_a_learner_with_no_mirror(self):
        # Without a mirror there is no id to compare against, and hiding their
        # history would be worse than showing an old row.
        self.assertTrue(_belongs_to_current_cycle(_record(learner_id=2), None))


class CalendarResponseTests(SimpleTestCase):
    """The endpoint hands the page one calendar in date order."""

    def _call(self, records, mirror):
        from django.test import RequestFactory

        from . import calendar as module

        queryset = Mock()
        queryset.order_by.return_value = records
        with patch.object(module, 'SOURCE_MODELS', {'commercial': Mock()}) as models, \
                patch.object(module.CoachCalendarEvent.objects, 'filter', return_value=queryset), \
                patch.object(module, 'learner_profile_for_source', return_value=mirror):
            models['commercial'].all_learners.filter.return_value.first.return_value = _learner()
            response = module.learner_calendar(RequestFactory().get('/x'), 'commercial', 101)
        import json
        return json.loads(response.content)

    def test_generated_slots_are_returned_in_date_order(self):
        # No coach email: live curriculum sessions are folded in through the
        # coach module and read the database, which is not what these assert.
        body = self._call([], _mirror(coach_email=''))
        dates = [event['date'] for event in body['events']]

        self.assertTrue(dates)
        self.assertEqual(dates, sorted(dates))

    def test_the_cycle_appears_even_with_nothing_booked(self):
        # The reported bug: an empty learner calendar beside a coach calendar
        # full of "Not Scheduled" slots.
        body = self._call([], _mirror(coach_email=''))

        cycle = [e for e in body['events'] if e['source'] in ('mcr', 'progress-review')]
        self.assertTrue(cycle)
        self.assertTrue(all(e['status'] == 'not-scheduled' for e in cycle))
