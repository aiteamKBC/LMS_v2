"""End-to-end: the Coach side is driven by Curriculum's Review architecture.

    Review Template -> Review Type -> learner start date -> Curriculum
    recurrence -> generated occurrence -> Coach calendar -> schedule ->
    review instance

Every assertion here exists to catch a regression back towards one of the two
things this replaced: a fixed interval constant (30 days for MCM, 12 weeks for
Progress Review), and classification by a template's display name.
"""
from datetime import date, timedelta
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase

from curriculum_api import review_instances, review_schedule, review_types, reviews
from curriculum_api import views as curriculum_views

from .views import (
    build_generated_calendar_event,
    resolve_curriculum_programme_id,
    resolve_curriculum_review_occurrences,
    resolve_schedule_window,
    review_event_type_for_type_code,
)

PROGRAMME_ID = 'PROG-COACH-ARCH'
PROGRAMME_NAME = 'Coach Architecture Programme'
# enrolment."Created_users"."Start_date" -- the learner's own date.
LEARNER_START = date(2026, 8, 10)
# "Learner"."learners".start_date -- the profile mirror, stamped with the
# COHORT delivery window by active_users.mirror_learner_placement.
COHORT_START = date(2026, 8, 3)
WINDOW_END = date(2027, 8, 9)


class CoachReviewArchitectureTestCase(TestCase):
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
            review_instances.REVIEW_INSTANCE_SIGNATURES_TABLE,
            review_instances.REVIEW_INSTANCE_ANSWERS_TABLE,
            review_instances.REVIEW_INSTANCES_TABLE,
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

    def _template(self, *, name, type_id, interval, unit='weeks'):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name, 'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01', 'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _system(self, code):
        return review_types.get_review_type_by_code(code)['id']

    def _custom(self, name):
        row, errors = review_types.create_review_type(name)
        self.assertIsNone(errors, errors)
        return row['id']

    def _enrolment_row(self, start_date=LEARNER_START):
        raw = start_date.isoformat() if start_date else ''
        return SimpleNamespace(
            id=101, pk=101, email='learner@example.com', learner_type='commercial',
            # learner_start_date is the Review recurrence anchor; start_date is
            # kept in step too since resolve_schedule_window's WINDOW bound
            # still reads it.
            learner_start_date=raw, start_date=raw,
            end_date=WINDOW_END.isoformat(),
            practical_period_end_date='', apprenticeship_end_date='',
        )

    def _learner(self):
        return SimpleNamespace(
            id=248, pk=248, username='Test Learner', email='learner@example.com',
            programme=PROGRAMME_NAME, cohort='Cohort A', group_name='Group A',
            learner_type='commercial', enrolment_id=101,
            start_date=COHORT_START, end_date=date(2027, 8, 2),
        )

    def _coach_events(self):
        """Exactly what the coach caseload timetable builds for this learner."""
        learner = self._learner()
        start, end = resolve_schedule_window(
            learner.id, {learner.id: self._enrolment_row()}, {}, learner,
        )
        events = []
        for occurrence in resolve_curriculum_review_occurrences(
            programme_id=resolve_curriculum_programme_id(PROGRAMME_NAME),
            learner_id=learner.id, learner_status='Active',
            learner_start_date=start, window_start=start, window_end=end,
            template_cache={},
        ):
            events.append(build_generated_calendar_event(
                learner=learner, owner_email='coach@example.com', owner_name='Coach One',
                event_type=review_event_type_for_type_code(occurrence.get('reviewTypeCode')),
                sequence=occurrence['occurrenceNumber'], target_date=occurrence['targetDate'],
                review_template_id=occurrence['reviewTemplateId'],
                review_title=occurrence['reviewName'], review_type=occurrence,
            ))
        return sorted(events, key=lambda event: event['date'])

    def _rows(self, source):
        return [event for event in self._coach_events() if event['source'] == source]


class CoachRecurrenceTests(CoachReviewArchitectureTestCase):
    def test_1_an_mcm_template_every_six_weeks_drives_the_coach_timetable(self):
        self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6)

        rows = self._rows('mcr')
        self.assertTrue(rows)
        self.assertEqual(
            [row['date'] for row in rows],
            [(LEARNER_START + timedelta(weeks=6 * step)).isoformat() for step in range(1, len(rows) + 1)],
        )
        gaps = {
            date.fromisoformat(b['date']) - date.fromisoformat(a['date'])
            for a, b in zip(rows, rows[1:])
        }
        self.assertEqual(gaps, {timedelta(weeks=6)})
        # The retired constant.
        self.assertNotIn(timedelta(days=30), gaps)

    def test_2_a_pr_template_every_eight_weeks_drives_the_coach_timetable(self):
        self._template(name='Progress Review', type_id=self._system('progress_review'), interval=8)

        rows = self._rows('progress-review')
        self.assertTrue(rows)
        self.assertEqual(
            [row['date'] for row in rows],
            [(LEARNER_START + timedelta(weeks=8 * step)).isoformat() for step in range(1, len(rows) + 1)],
        )
        gaps = {
            date.fromisoformat(b['date']) - date.fromisoformat(a['date'])
            for a, b in zip(rows, rows[1:])
        }
        self.assertEqual(gaps, {timedelta(weeks=8)})
        self.assertNotIn(timedelta(weeks=12), gaps)

    def test_3_occurrences_anchor_to_the_learner_start_date_not_the_cohorts(self):
        # The learner started on the 10th; their cohort (and therefore the
        # profile mirror) on the 3rd.
        self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=1, unit='months')

        dates = [row['date'] for row in self._rows('mcr')]
        self.assertEqual(dates[:3], ['2026-09-10', '2026-10-10', '2026-11-10'])
        self.assertNotIn('2026-09-03', dates)


class CoachClassificationTests(CoachReviewArchitectureTestCase):
    def test_4_renaming_an_mcm_template_changes_the_title_not_the_classification(self):
        review_id = self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6)
        before = self._rows('mcr')[0]

        reviews.update_review(review_id, {'name': 'Monthly Learner Development Session'}, actor='test')
        after = self._rows('mcr')[0]

        self.assertEqual(after['title'], 'Monthly Learner Development Session')
        self.assertNotEqual(after['title'], before['title'])
        self.assertEqual(after['source'], 'mcr')
        self.assertEqual(after['reviewTypeCode'], 'mcm')
        self.assertEqual(after['reviewTypeId'], before['reviewTypeId'])
        self.assertEqual(after['date'], before['date'])

    def test_5_renaming_a_pr_template_changes_the_title_not_the_classification(self):
        review_id = self._template(name='Progress Review', type_id=self._system('progress_review'), interval=8)
        before = self._rows('progress-review')[0]

        reviews.update_review(review_id, {'name': 'Quarterly Employer Catch-up'}, actor='test')
        after = self._rows('progress-review')[0]

        self.assertEqual(after['title'], 'Quarterly Employer Catch-up')
        self.assertEqual(after['source'], 'progress-review')
        self.assertEqual(after['reviewTypeCode'], 'progress_review')
        self.assertEqual(after['reviewTypeId'], before['reviewTypeId'])

    def test_6_reclassifying_an_mcm_template_moves_it_to_the_career_review_bucket(self):
        review_id = self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6)
        self.assertTrue(self._rows('mcr'))

        career = self._custom('Career Review')
        reviews.update_review(review_id, {'reviewTypeId': career}, actor='test')

        # Gone from the MCM bucket...
        self.assertEqual(self._rows('mcr'), [])
        # ...and in its own, carrying its own identity.
        moved = self._rows('review')
        self.assertTrue(moved)
        self.assertEqual({row['reviewTypeCode'] for row in moved}, {'career_review'})
        self.assertEqual({row['reviewTypeName'] for row in moved}, {'Career Review'})
        self.assertEqual({row['reviewTypeId'] for row in moved}, {career})

    def test_7_a_custom_career_review_reaches_the_coach_timetable(self):
        self._template(
            name='Career Planning Session', type_id=self._custom('Career Review'), interval=6,
        )

        rows = self._rows('review')
        self.assertTrue(rows)
        self.assertEqual(rows[0]['title'], 'Career Planning Session')
        self.assertEqual(rows[0]['reviewTypeCode'], 'career_review')
        self.assertEqual(rows[0]['reviewTypeName'], 'Career Review')
        self.assertFalse(rows[0]['reviewTypeIsSystem'])
        # Never mistaken for either system type.
        self.assertEqual(self._rows('mcr'), [])
        self.assertEqual(self._rows('progress-review'), [])

    def test_8_a_programme_with_no_review_template_generates_nothing(self):
        # No template at all: the Coach side must produce no MCM, no Progress
        # Review, nothing. There is no legacy fallback schedule.
        self.assertEqual(self._coach_events(), [])

    def test_8b_a_disabled_template_generates_nothing_either(self):
        review_id = self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6)
        reviews.update_review(review_id, {'enabled': False}, actor='test')
        self.assertEqual(self._coach_events(), [])


class CoachSchedulingTests(CoachReviewArchitectureTestCase):
    """Scheduling consumes the generated occurrence -- it never re-derives one."""

    def test_9_the_review_instance_keeps_the_occurrence_date_and_number(self):
        review_id = self._template(name='Career Planning Session', type_id=self._custom('Career Review'), interval=6)
        occurrence_event = self._rows('review')[1]
        template_row = reviews.get_review_template_row(review_id)

        instance = review_instances.ensure_review_instance(
            template_row,
            learner_id=248, learner_kind='', programme_id=PROGRAMME_ID,
            occurrence_number=occurrence_event['occurrenceNumber'],
            target_date=date.fromisoformat(occurrence_event['targetDate']),
            coach_email='coach@example.com', actor='coach@example.com',
        )

        self.assertEqual(instance['review_template_id'], review_id)
        self.assertEqual(int(instance['learner_id']), 248)
        self.assertEqual(instance['occurrence_number'], occurrence_event['occurrenceNumber'])
        self.assertEqual(
            curriculum_views.format_date(instance['target_date']), occurrence_event['targetDate'],
        )

    def test_10_scheduling_twice_reuses_the_instance_and_never_recomputes_a_date(self):
        review_id = self._template(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6)
        occurrence_event = self._rows('mcr')[0]
        template_row = reviews.get_review_template_row(review_id)

        def schedule():
            return review_instances.ensure_review_instance(
                template_row,
                learner_id=248, learner_kind='', programme_id=PROGRAMME_ID,
                occurrence_number=occurrence_event['occurrenceNumber'],
                target_date=date.fromisoformat(occurrence_event['targetDate']),
                coach_email='coach@example.com', actor='coach@example.com',
            )

        first, second = schedule(), schedule()
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(
            curriculum_views.format_date(second['target_date']), occurrence_event['targetDate'],
        )
        # And the occurrence the timetable offers is unchanged by scheduling --
        # nothing recalculates the cadence on the way through.
        self.assertEqual(self._rows('mcr')[0]['date'], occurrence_event['date'])

    def test_the_instance_form_is_the_templates_own_questions(self):
        review_id = self._template(name='Career Planning Session', type_id=self._custom('Career Review'), interval=6)
        occurrence_event = self._rows('review')[0]
        instance = review_instances.ensure_review_instance(
            reviews.get_review_template_row(review_id),
            learner_id=248, learner_kind='', programme_id=PROGRAMME_ID,
            occurrence_number=occurrence_event['occurrenceNumber'],
            target_date=date.fromisoformat(occurrence_event['targetDate']),
            coach_email='coach@example.com', actor='coach@example.com',
        )

        definition = review_instances.review_instance_form_definition(
            review_instances.get_review_instance(instance['id'])
        )
        titles = [
            field['title']
            for section in definition['sections']
            for field in section['fields']
        ]
        # A custom type opens the same generic form as any other Review, built
        # from its own template's questions -- nothing hard-coded per type.
        self.assertEqual(titles, ['How is it going?'])
