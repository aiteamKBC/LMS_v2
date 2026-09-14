"""Review recurrence anchors STRICTLY to the learner's own start date.

    Curriculum Review Template -> Review Type
        -> enrolment."Created_users"."Start_date"
        -> recurrence engine -> generated occurrence

There is no cohort/profile fallback anywhere on that path. "Learner"."learners"
.start_date is the profile mirror, which active_users.mirror_learner_placement
stamps with the COHORT delivery window on every placement edit; letting the
anchor fall back to it silently turned "we do not know when this learner
started" into "they started when their cohort did".

These pin the strict rule on both calendars, for MCM, Progress Review and a
custom Review Type alike -- and pin that the WINDOW helper
(resolve_schedule_window), which other scheduling legitimately relies on, still
falls back exactly as it always has.
"""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from coach_api.views import (
    REVIEW_ANCHOR_INVALID_START,
    REVIEW_ANCHOR_MISSING_ROW,
    REVIEW_ANCHOR_MISSING_START,
    resolve_review_anchor_date,
    resolve_schedule_window,
)
from curriculum_api import review_instances, review_types, reviews

from .calendar import _generated_cycle_events
from .tests_learner_review_pages import LearnerReviewPageTestCase, LEARNER_START, PROGRAMME_ID

# The profile mirror's date -- the COHORT's, deliberately a week earlier than
# the learner's own, so any fallback shows up as a wrong date rather than a
# coincidence.
COHORT_START = date(2026, 8, 3)
MIRROR_ID = 248


def enrolment_row(**overrides):
    """enrolment."Created_users" -- note Start_date is TEXT in Postgres, so the
    fixture stores a string exactly as the column does."""
    fields = {
        'id': 101, 'pk': 101, 'email': 'learner@example.com', 'learner_type': 'commercial',
        'start_date': LEARNER_START.isoformat(), 'end_date': '2027-08-09',
        'practical_period_end_date': '', 'apprenticeship_end_date': '',
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def profile_row(**overrides):
    """"Learner"."learners" -- the mirror, carrying the cohort window."""
    fields = {
        'id': MIRROR_ID, 'pk': MIRROR_ID, 'email': 'learner@example.com',
        'start_date': COHORT_START, 'end_date': date(2027, 8, 2),
        'coach_name': 'Coach One', 'coach_email': 'coach@example.com',
        'programme': 'Review Pages Programme', 'programme_status': 'Active',
        'full_name': 'Test Learner', 'cohort': 'Cohort A', 'group_name': 'Group A',
        # Read by build_generated_calendar_event when it shapes a coach event.
        'username': 'Test Learner', 'learner_type': 'commercial', 'enrolment_id': '101',
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def source_maps(row):
    """The {profile_id: Created_users row} maps both calendars pass around."""
    if row is None:
        return {}, {}
    if str(getattr(row, 'learner_type', '')).casefold() == 'commercial':
        return {MIRROR_ID: row}, {}
    return {}, {MIRROR_ID: row}


class StrictReviewAnchorTestCase(LearnerReviewPageTestCase):
    """Shared fixtures. No tests of its own."""

    def _template(self, *, name, type_code, interval=4, unit='weeks'):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name,
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(type_code)['id'],
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id)

    def _custom_template(self, *, name, type_name, interval=4, unit='weeks'):
        type_row, errors = review_types.create_review_type(type_name, actor='test')
        self.assertIsNone(errors, errors)
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name, 'enabled': True, 'reviewTypeId': type_row['id'],
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01', 'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id), type_row

    def _learner_calendar_dates(self, row, *, mirror=None):
        """What /learner/monthly-coaching, /learner/progress-reviews and the
        learner calendar all render -- they share this one generator."""
        events = _generated_cycle_events(row, mirror or profile_row(), set())
        return sorted(event['date'] for event in events)

    def _coach_timetable_dates(self, row, *, mirror=None):
        """What the Coach timetable renders, through the real view."""
        from coach_api import views as coach_views

        mirror = mirror or profile_row()
        with patch.object(coach_views, 'fetch_owner_active_learner_profiles', return_value=[mirror]), \
             patch.object(coach_views, 'fetch_source_schedule_rows', return_value=source_maps(row)), \
             patch.object(coach_views, 'coach_staff_display_name', return_value='Coach One'), \
             patch.object(coach_views, 'build_learner_profile_map', return_value={MIRROR_ID: mirror}), \
             patch.object(coach_views, 'fetch_standalone_event_records', return_value=[]), \
             patch.object(coach_views, 'learner_employer_attendee', return_value=None):
            payload = coach_views.collect_generated_timetable(
                'coach@example.com', include_live_sessions=False, include_scheduler_queues=False,
            )
        return sorted(event['date'] for event in payload['events']), payload['summary']['sourceCounts']


class AnchorResolutionTests(StrictReviewAnchorTestCase):
    def test_1_created_users_start_date_is_the_anchor(self):
        anchor, reason = resolve_review_anchor_date(MIRROR_ID, *source_maps(enrolment_row()))
        self.assertEqual(anchor, LEARNER_START)
        self.assertIsNone(reason)
        # The column is TEXT; the anchor must come back as a real date, parsed
        # through the shared helper -- never the raw string.
        self.assertIsInstance(anchor, date)

    def test_3_missing_created_users_row_yields_no_anchor(self):
        anchor, reason = resolve_review_anchor_date(MIRROR_ID, {}, {})
        self.assertIsNone(anchor)
        self.assertEqual(reason, REVIEW_ANCHOR_MISSING_ROW)

    def test_4_blank_start_date_yields_no_anchor(self):
        for blank in ('', '   ', None):
            with self.subTest(blank=blank):
                anchor, reason = resolve_review_anchor_date(
                    MIRROR_ID, *source_maps(enrolment_row(start_date=blank)),
                )
                self.assertIsNone(anchor)
                self.assertEqual(reason, REVIEW_ANCHOR_MISSING_START)

    def test_5_invalid_start_date_yields_no_anchor(self):
        for bad in ('not-a-date', '2026-13-45', 'TBC'):
            with self.subTest(bad=bad):
                anchor, reason = resolve_review_anchor_date(
                    MIRROR_ID, *source_maps(enrolment_row(start_date=bad)),
                )
                self.assertIsNone(anchor)
                self.assertEqual(reason, REVIEW_ANCHOR_INVALID_START)

    def test_11_the_window_helper_keeps_its_profile_fallback(self):
        """Scope guard: resolve_schedule_window is used for the WINDOW, which
        other scheduling legitimately relies on. Only the ANCHOR went strict."""
        mirror = profile_row()
        # No source row at all -- the window still falls back to the mirror.
        start, end = resolve_schedule_window(MIRROR_ID, {}, {}, mirror)
        self.assertEqual(start, COHORT_START)
        self.assertEqual(end, mirror.end_date)
        # A blank source start still falls back too.
        commercial, enrolment = source_maps(enrolment_row(start_date=''))
        start, _end = resolve_schedule_window(MIRROR_ID, commercial, enrolment, mirror)
        self.assertEqual(start, COHORT_START)
        # And a real source start still wins over the mirror.
        commercial, enrolment = source_maps(enrolment_row())
        start, _end = resolve_schedule_window(MIRROR_ID, commercial, enrolment, mirror)
        self.assertEqual(start, LEARNER_START)


class LearnerCalendarStrictAnchorTests(StrictReviewAnchorTestCase):
    def test_1_occurrences_generate_from_created_users_start_date(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        dates = self._learner_calendar_dates(enrolment_row())
        self.assertTrue(dates)
        self.assertEqual(dates[0], (LEARNER_START + timedelta(weeks=4)).isoformat())

    def test_2_created_users_wins_over_a_different_profile_cohort_start(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        dates = self._learner_calendar_dates(enrolment_row())
        # Anchored on the 10th, not the cohort's 3rd.
        self.assertEqual(dates[0], (LEARNER_START + timedelta(weeks=4)).isoformat())
        self.assertNotIn((COHORT_START + timedelta(weeks=4)).isoformat(), dates)

    def test_3_missing_created_users_row_generates_nothing(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        # The mirror still carries a perfectly usable cohort start date; the
        # point is that it must NOT be used.
        self.assertEqual(self._learner_calendar_dates(None), [])

    def test_4_blank_created_users_start_date_generates_nothing(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.assertEqual(self._learner_calendar_dates(enrolment_row(start_date='')), [])

    def test_5_invalid_created_users_start_date_generates_nothing(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.assertEqual(self._learner_calendar_dates(enrolment_row(start_date='not-a-date')), [])

    def test_6_mcm_follows_the_strict_rule(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        events = _generated_cycle_events(enrolment_row(), profile_row(), set())
        self.assertEqual({event['reviewTypeCode'] for event in events}, {'mcm'})
        self.assertEqual(events[0]['date'], (LEARNER_START + timedelta(weeks=4)).isoformat())
        self.assertEqual(_generated_cycle_events(None, profile_row(), set()), [])

    def test_7_progress_review_follows_the_strict_rule(self):
        self._template(
            name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
            interval=8, unit='weeks',
        )
        events = _generated_cycle_events(enrolment_row(), profile_row(), set())
        self.assertEqual({event['reviewTypeCode'] for event in events}, {'progress_review'})
        self.assertEqual(events[0]['date'], (LEARNER_START + timedelta(weeks=8)).isoformat())
        self.assertEqual(_generated_cycle_events(None, profile_row(), set()), [])

    def test_8_a_custom_review_type_follows_the_strict_rule(self):
        _template, type_row = self._custom_template(name='Career Conversation', type_name='Career Review')
        events = _generated_cycle_events(enrolment_row(), profile_row(), set())
        self.assertEqual({event['reviewTypeCode'] for event in events}, {type_row['code']})
        self.assertEqual(events[0]['date'], (LEARNER_START + timedelta(weeks=4)).isoformat())
        self.assertEqual(_generated_cycle_events(None, profile_row(), set()), [])

    def test_a_skip_is_logged_with_the_identifiers_needed_to_fix_it(self):
        template = self._template(
            name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM,
        )
        with self.assertLogs('coach_api.views', level='WARNING') as captured:
            self.assertEqual(self._learner_calendar_dates(None), [])
        message = '\n'.join(captured.output)
        self.assertIn(f'learner_id={MIRROR_ID}', message)
        self.assertIn('learner_email=learner@example.com', message)
        self.assertIn('learner_name=Test Learner', message)
        self.assertIn(f'programme_id={PROGRAMME_ID}', message)
        self.assertIn(f'review_template_id={template["id"]}', message)
        self.assertIn('review_type_code=mcm', message)
        self.assertIn(f'reason={REVIEW_ANCHOR_MISSING_ROW}', message)


class CoachTimetableStrictAnchorTests(StrictReviewAnchorTestCase):
    def test_1_coach_timetable_generates_from_created_users_start_date(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        dates, counts = self._coach_timetable_dates(enrolment_row())
        self.assertTrue(dates)
        self.assertEqual(dates[0], (LEARNER_START + timedelta(weeks=4)).isoformat())
        self.assertEqual(counts['reviewAnchorSkipped'], 0)

    def test_3_4_5_no_usable_start_date_generates_nothing(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        for row, reason in (
            (None, REVIEW_ANCHOR_MISSING_ROW),
            (enrolment_row(start_date=''), REVIEW_ANCHOR_MISSING_START),
            (enrolment_row(start_date='not-a-date'), REVIEW_ANCHOR_INVALID_START),
        ):
            with self.subTest(reason=reason):
                dates, counts = self._coach_timetable_dates(row)
                self.assertEqual(dates, [])
                self.assertEqual(counts['reviewAnchorSkipped'], 1)
                self.assertEqual(counts['reviewAnchorSkipReasons'], {reason: 1})

    def test_9_coach_and_learner_calendars_produce_the_same_dates(self):
        self._template(name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self._template(
            name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
            interval=8, unit='weeks',
        )
        row = enrolment_row()
        coach_dates, _counts = self._coach_timetable_dates(row)
        learner_dates = self._learner_calendar_dates(row)
        self.assertTrue(coach_dates)
        self.assertEqual(coach_dates, learner_dates)

        # And they agree on nothing, too, when the anchor cannot be resolved --
        # the failure mode that used to show the coach one thing and the
        # learner another.
        coach_dates, _counts = self._coach_timetable_dates(None)
        self.assertEqual(coach_dates, [])
        self.assertEqual(self._learner_calendar_dates(None), [])


class NoInstanceWithoutAnAnchorTests(StrictReviewAnchorTestCase):
    def test_10_no_review_instance_exists_for_an_occurrence_never_generated(self):
        """Instances are only ever created FROM a generated occurrence (on
        schedule, or on the coach's first open of one). With no anchor there is
        no occurrence, so there is nothing to create an instance from."""
        template = self._template(
            name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM,
        )
        review_instances.provision_review_instance_tables()

        self.assertEqual(self._learner_calendar_dates(None), [])
        coach_dates, _counts = self._coach_timetable_dates(None)
        self.assertEqual(coach_dates, [])

        # Nothing was written: no instance for any occurrence number.
        for occurrence_number in range(1, 6):
            self.assertIsNone(
                review_instances.find_review_instance(template['id'], MIRROR_ID, occurrence_number),
            )
