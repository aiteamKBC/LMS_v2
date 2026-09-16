"""Review recurrence is anchored to the LEARNER's start date, never the cohort's.

Two different "start date" columns exist for the same learner, and they are
routinely different:

    enrolment."Created_users"."Start_date"   (EnrolmentUser.start_date, text)
        The learner's OWN start date -- what they enrolled on.

    "Learner"."learners".start_date          (LearnerProfile.start_date, date)
        The profile mirror. active_users.mirror_learner_placement stamps the
        COHORT delivery window onto it on every placement edit ("the window
        belongs to the cohort, so it moves with the placement"), so this is a
        cohort date for any learner whose placement has been touched.

    "Learner"."Active_users"."Start_date"    (ActiveUser.start_date, date)
        Also the cohort delivery window, per its own column comment.

A Review recurring monthly for a learner who started on the 10th must fall on
the 10th, even when their cohort started on the 3rd. The coach timetable and
the learner's own calendar must agree on that date -- they are the same
meeting, and a learner told the 3rd while their coach holds the 10th is the
bug these cover.
"""
from datetime import date
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase

from coach_api.views import (
    resolve_curriculum_programme_id,
    resolve_curriculum_review_occurrences,
    resolve_schedule_window,
)
from curriculum_api import review_instances, review_schedule, review_types, reviews
from curriculum_api import views as curriculum_views

from .calendar import _generated_cycle_events

# The brief's worked example.
LEARNER_START = date(2026, 8, 10)
COHORT_START = date(2026, 8, 3)
WINDOW_END = date(2027, 8, 9)

EXPECTED_MONTHLY = ['2026-09-10', '2026-10-10', '2026-11-10']
COHORT_ANCHORED = ['2026-09-03', '2026-10-03', '2026-11-03']

PROGRAMME_ID = 'PROG-ANCHOR'
PROGRAMME_NAME = 'Anchor Test Programme'


class ReviewAnchorDateTestCase(TestCase):
    def setUp(self):
        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_schedule.provision_review_schedule_tables()
        review_instances.provision_review_instance_tables()
        self._clear()
        self._programme()
        self._monthly_review()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            table = 'curriculum.programmes' if connection.vendor == 'postgresql' else 'programmes'
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
            cursor.execute(
                f"""
                create table if not exists {table} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            review_types.REVIEW_TYPES_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {curriculum_views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _programme(self):
        curriculum_views.insert_row('programmes', {
            'id': PROGRAMME_ID, 'programme_id': PROGRAMME_ID, 'program_id': PROGRAMME_ID,
            'name': PROGRAMME_NAME, 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(),
            'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _monthly_review(self):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': 'Monthly Coaching Meeting',
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(review_types.REVIEW_TYPE_CODE_MCM)['id'],
            'recurrence': {'interval': 1, 'unit': 'months'},
            # Deliberately NOT the learner's date and not the cohort's: the
            # template anchor drives Curriculum's programme-level schedule
            # preview, never a learner's own occurrences.
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': False}]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        self.review_id = review_id
        self.template = reviews.get_review_template_row(review_id)

    # ---------------------------------------------------------------- fakes

    def _enrolment_row(self, start_date='2026-08-10'):
        """enrolment."Created_users" -- the learner's own record. Start_date is
        a TEXT column on this table, which is why it is a string here.

        learner_start_date is set to the same value: this fixture's `start_date`
        parameter represents "the learner's own date" for both the (legacy,
        window-only) Start_date column and the Review anchor column
        (Learner_start_date) -- see learner_api.tests_review_anchor_strict for
        tests that specifically distinguish the two.
        """
        return SimpleNamespace(
            id=101, pk=101, email='learner@example.com', learner_type='commercial',
            learner_start_date=start_date, start_date=start_date, end_date='2027-08-09',
            practical_period_end_date='', apprenticeship_end_date='',
        )

    def _profile(self, start_date=COHORT_START):
        """"Learner"."learners" -- the mirror, carrying the COHORT window."""
        return SimpleNamespace(
            id=248, pk=248, email='learner@example.com',
            start_date=start_date, end_date=date(2027, 8, 2),
            coach_name='Coach One', coach_email='coach@example.com',
            programme=PROGRAMME_NAME, programme_status='Active',
            cohort='Cohort A', group_name='Group A',
        )


class OccurrenceEngineAnchorTests(ReviewAnchorDateTestCase):
    """curriculum_api.review_instances.resolve_learner_occurrences."""

    def _dates(self, learner_start_date):
        return [
            occurrence['targetDate'].isoformat()
            for occurrence in review_instances.resolve_learner_occurrences(
                self.template, 101, None, learner_start_date, learner_start_date, WINDOW_END,
            )
        ]

    def test_monthly_occurrences_follow_the_learner_start_date(self):
        self.assertEqual(self._dates(LEARNER_START)[:3], EXPECTED_MONTHLY)

    def test_the_cohort_start_date_would_have_produced_different_dates(self):
        # Proves the two inputs are genuinely distinguishable -- without this,
        # the assertion above could pass for the wrong reason.
        self.assertEqual(self._dates(COHORT_START)[:3], COHORT_ANCHORED)

    def test_the_template_anchor_date_does_not_drive_learner_occurrences(self):
        # The template's scheduleAnchorDate is 2026-01-01; if it leaked into
        # the learner's occurrences these would land on the 1st.
        self.assertTrue(all(day.endswith('-10') for day in self._dates(LEARNER_START)))

    def test_no_learner_start_date_produces_no_occurrences(self):
        # Documented current behaviour: the engine refuses to guess. It does
        # NOT substitute the cohort date, and it does not fall back to the
        # template's own anchor.
        self.assertEqual(self._dates(None), [])


class ScheduleWindowSourceTests(ReviewAnchorDateTestCase):
    """coach_api.views.resolve_schedule_window -- which column is read."""

    def test_the_enrolment_rows_own_start_date_wins_over_the_cohort_mirror(self):
        start, _end = resolve_schedule_window(
            248, {}, {248: self._enrolment_row()}, self._profile(),
        )
        self.assertEqual(start, LEARNER_START)

    def test_a_commercial_row_is_read_the_same_way(self):
        start, _end = resolve_schedule_window(
            248, {248: self._enrolment_row()}, {}, self._profile(),
        )
        self.assertEqual(start, LEARNER_START)

    def test_without_an_enrolment_row_the_cohort_stamped_mirror_is_used(self):
        # Documented current behaviour, NOT an endorsement: when the learner
        # has no start date of their own, both calendars fall back to
        # LearnerProfile.start_date, which mirror_learner_placement stamps
        # with the cohort window. Reported rather than changed.
        start, _end = resolve_schedule_window(248, {}, {}, self._profile())
        self.assertEqual(start, COHORT_START)

    def test_a_blank_enrolment_start_date_falls_back_the_same_way(self):
        start, _end = resolve_schedule_window(
            248, {}, {248: self._enrolment_row(start_date='')}, self._profile(),
        )
        self.assertEqual(start, COHORT_START)


class CoachTimetableAnchorTests(ReviewAnchorDateTestCase):
    """The dates the coach's caseload timetable generates."""

    def test_the_coach_timetable_counts_from_the_learners_own_start_date(self):
        start, end = resolve_schedule_window(
            248, {248: self._enrolment_row()}, {}, self._profile(),
        )
        occurrences = resolve_curriculum_review_occurrences(
            programme_id=resolve_curriculum_programme_id(PROGRAMME_NAME),
            learner_id=248, learner_status='Active',
            learner_start_date=start, window_start=start, window_end=end,
            template_cache={},
        )
        self.assertEqual(
            [o['targetDate'].isoformat() for o in occurrences][:3], EXPECTED_MONTHLY,
        )


class LearnerCalendarAnchorTests(ReviewAnchorDateTestCase):
    """The dates the learner's own calendar generates.

    Same meeting, same generator, so the same dates as the coach sees -- the
    learner calendar must not anchor on the cohort-stamped profile mirror
    while the coach anchors on the learner's own record.
    """

    def _dates(self, learner, profile):
        return sorted(
            event['date'] for event in _generated_cycle_events(learner, profile, set())
            if event['source'] == 'mcr'
        )

    def test_the_learner_calendar_counts_from_the_learners_own_start_date(self):
        dates = self._dates(self._enrolment_row(), self._profile())
        self.assertEqual(dates[:3], EXPECTED_MONTHLY)
        self.assertNotIn(COHORT_ANCHORED[0], dates)

    def test_the_learner_and_their_coach_are_shown_the_same_dates(self):
        learner, profile = self._enrolment_row(), self._profile()

        learner_dates = self._dates(learner, profile)

        start, end = resolve_schedule_window(248, {248: learner}, {}, profile)
        coach_dates = sorted(
            o['targetDate'].isoformat()
            for o in resolve_curriculum_review_occurrences(
                programme_id=resolve_curriculum_programme_id(PROGRAMME_NAME),
                learner_id=248, learner_status='Active',
                learner_start_date=start, window_start=start, window_end=end,
                template_cache={},
            )
        )
        self.assertEqual(learner_dates, coach_dates)

    def test_without_an_enrolment_start_date_nothing_is_generated(self):
        """The missing-date case, now decided rather than merely reported.

        This used to fall through to the cohort window on the profile mirror,
        so a learner with no start date of their own saw a full cycle of
        confidently wrong dates. Review recurrence is anchored strictly now:
        no learner-specific start date means no Reviews, and a warning naming
        the learner and the Reviews that were skipped. See
        learner_api.tests_review_anchor_strict for the whole rule.
        """
        dates = self._dates(self._enrolment_row(start_date=''), self._profile())
        self.assertEqual(dates, [])
        self.assertNotIn(COHORT_ANCHORED[0], dates)
