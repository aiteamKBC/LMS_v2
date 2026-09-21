"""/learner/monthly-coaching and /learner/progress-reviews follow Curriculum.

Both pages read the same endpoint as the learner calendar
(``fetchLearnerCalendarEvents``) and select their rows client-side:

    monthly-coaching   events.filter(event => event.source === 'mcr')
    progress-reviews   events.filter(event => event.source === 'progress-review')

``source`` is derived from the Review Type code of the template that produced
the occurrence (``mcm`` -> ``mcr``, ``progress_review`` -> ``progress-review``),
so both pages are Review-Type driven end to end. These tests pin the thing
that used to be hard-coded: the DATES. They come from the Curriculum Review
template's own recurrence, counted from the learner's own start date -- not
from the retired 30-day / 12-week constants.
"""
from datetime import date, timedelta
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase

from curriculum_api import review_instances, review_schedule, review_types, reviews
from curriculum_api import views as curriculum_views

from .calendar import _generated_cycle_events

PROGRAMME_ID = 'PROG-REVIEW-PAGES'
PROGRAMME_NAME = 'Review Pages Programme'
# The learner's own start date, from enrolment."Created_users"."Start_date".
LEARNER_START = date(2026, 8, 10)


class LearnerReviewPageTestCase(TestCase):
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
            reviews.REVIEW_FIELDS_TABLE, reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE, review_types.REVIEW_TYPES_TABLE, 'programmes',
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

    def _template(self, *, name, type_code, interval, unit):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name,
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(type_code)['id'],
            'recurrence': {'interval': interval, 'unit': unit},
            # Deliberately not the learner's date: the template anchor drives
            # Curriculum's programme-level preview, never a learner's own
            # occurrences.
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    # The two objects the learner calendar reads its window from.
    def _enrolment_row(self):
        """enrolment."Created_users" -- the learner's own record."""
        return SimpleNamespace(
            id=101, pk=101, email='learner@example.com', learner_type='commercial',
            # learner_start_date is the Review recurrence anchor; start_date is
            # kept in step too since resolve_schedule_window's WINDOW bound
            # still reads it.
            learner_start_date=LEARNER_START.isoformat(), start_date=LEARNER_START.isoformat(),
            end_date='2027-08-09', practical_period_end_date='', apprenticeship_end_date='',
        )

    def _profile(self):
        """"Learner"."learners" -- the profile mirror, carrying the cohort window."""
        return SimpleNamespace(
            id=248, pk=248, email='learner@example.com',
            start_date=date(2026, 8, 3), end_date=date(2027, 8, 2),
            coach_name='Coach One', coach_email='coach@example.com',
            programme=PROGRAMME_NAME, programme_status='Active',
            cohort='Cohort A', group_name='Group A',
        )

    def _page_rows(self, source):
        """The rows one of the two pages ends up rendering -- the learner
        calendar payload, filtered exactly the way the page filters it."""
        events = _generated_cycle_events(self._enrolment_row(), self._profile(), set())
        return sorted(
            (event for event in events if event['source'] == source),
            key=lambda event: event['date'],
        )


class MonthlyCoachingPageRecurrenceTests(LearnerReviewPageTestCase):
    def test_a_six_weekly_mcm_template_drives_the_monthly_coaching_page(self):
        """Review Type stays Monthly Coaching Meeting; only the schedule moves.

        The page must follow the template's 6 weeks, not the retired 30-day
        TIMETABLE_MCR_INTERVAL.
        """
        self._template(
            name='Monthly Coaching Meeting', type_code=review_types.REVIEW_TYPE_CODE_MCM,
            interval=6, unit='weeks',
        )

        rows = self._page_rows('mcr')
        self.assertTrue(rows, 'the Monthly Coaching page received no rows')

        # Counted from the LEARNER's start date, six weeks at a time.
        expected = [
            (LEARNER_START + timedelta(weeks=6 * step)).isoformat()
            for step in range(1, len(rows) + 1)
        ]
        self.assertEqual([row['date'] for row in rows], expected)

        # Six weeks apart, and nowhere near the legacy 30-day step.
        gaps = {
            date.fromisoformat(later['date']) - date.fromisoformat(earlier['date'])
            for earlier, later in zip(rows, rows[1:])
        }
        self.assertEqual(gaps, {timedelta(weeks=6)})
        self.assertNotIn(timedelta(days=30), gaps)

        # Still classified as a Monthly Coaching Meeting throughout.
        self.assertEqual({row['reviewTypeCode'] for row in rows}, {'mcm'})


class ProgressReviewPageRecurrenceTests(LearnerReviewPageTestCase):
    def test_an_eight_weekly_pr_template_drives_the_progress_review_page(self):
        """Review Type stays Progress Review; only the schedule moves.

        The page must follow the template's 8 weeks, not the retired 12-week
        TIMETABLE_PROGRESS_REVIEW_INTERVAL.
        """
        self._template(
            name='Progress Review', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
            interval=8, unit='weeks',
        )

        rows = self._page_rows('progress-review')
        self.assertTrue(rows, 'the Progress Review page received no rows')

        expected = [
            (LEARNER_START + timedelta(weeks=8 * step)).isoformat()
            for step in range(1, len(rows) + 1)
        ]
        self.assertEqual([row['date'] for row in rows], expected)

        gaps = {
            date.fromisoformat(later['date']) - date.fromisoformat(earlier['date'])
            for earlier, later in zip(rows, rows[1:])
        }
        self.assertEqual(gaps, {timedelta(weeks=8)})
        self.assertNotIn(timedelta(weeks=12), gaps)

        self.assertEqual({row['reviewTypeCode'] for row in rows}, {'progress_review'})


class NoCurriculumTemplateProducesNothingTests(LearnerReviewPageTestCase):
    """A learner's start date alone must never generate MCM/PR occurrences.

    There is no fixed-interval fallback: with no enabled Curriculum template
    for a Review Type, that page gets zero rows, no matter how much time has
    passed since the learner started -- not "every 30 days", not "every 12
    weeks", not one occurrence.
    """

    def test_no_mcm_template_produces_no_monthly_coaching_rows(self):
        # No MCM template created for this programme at all.
        rows = self._page_rows('mcr')
        self.assertEqual(rows, [])

    def test_no_progress_review_template_produces_no_progress_review_rows(self):
        rows = self._page_rows('progress-review')
        self.assertEqual(rows, [])

    def test_one_month_past_start_date_alone_produces_no_review(self):
        events = _generated_cycle_events(self._enrolment_row(), self._profile(), set())
        self.assertEqual(events, [])

    def test_twelve_weeks_past_start_date_alone_produces_no_progress_review(self):
        # Same fixtures, no Progress Review template configured -- reaching
        # the old 12-week mark must not manufacture an occurrence.
        events = _generated_cycle_events(self._enrolment_row(), self._profile(), set())
        self.assertEqual([e for e in events if e['source'] == 'progress-review'], [])

    def test_learner_with_no_curriculum_programme_mapping_gets_nothing(self):
        """A learner whose programme does not resolve in Curriculum at all
        (not just "has no template") also gets zero generated occurrences --
        never the historical fixed-interval slots."""
        profile = SimpleNamespace(
            id=999, pk=999, email='no-programme@example.com',
            start_date=date(2026, 8, 3), end_date=date(2027, 8, 2),
            coach_name='Coach One', coach_email='coach@example.com',
            programme='Programme With No Curriculum Mapping', programme_status='Active',
            cohort='Cohort A', group_name='Group A',
        )
        enrolment = SimpleNamespace(
            id=999, pk=999, email='no-programme@example.com', learner_type='commercial',
            start_date=LEARNER_START.isoformat(), end_date='2027-08-09',
            practical_period_end_date='', apprenticeship_end_date='',
        )
        events = _generated_cycle_events(enrolment, profile, set())
        self.assertEqual(events, [])
