"""The Review Engine (review_instances.py): learner-anchored occurrence
resolution, eligibility, idempotent instances, answers, conditional fields
and completion. See tests_review_schedule.py for the programme-level
schedule preview this shares its table/date-maths with.
"""
import json
from datetime import date

from django.db import connection
from django.test import TestCase

from . import review_instances, review_schedule, review_types, reviews, views


class ReviewInstancesTestCase(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_schedule.provision_review_schedule_tables()
        review_instances.provision_review_instance_tables()
        self._clear()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table = 'curriculum.programmes'
            else:
                table = 'programmes'
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
            review_schedule.CLASH_RESOLUTIONS_TABLE,
            review_schedule.OCCURRENCE_OVERRIDES_TABLE,
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        # review_types is a seeded lookup table, not per-test data: re-seed it
        # rather than clearing it, since every Review needs a type.
        review_types.seed_system_review_types()

    def _programme(self, programme_id='PROG-DATA', name='Data Technician'):
        views.insert_row('programmes', {
            'id': programme_id, 'programme_id': programme_id, 'program_id': programme_id,
            'name': name, 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': views.datetime.utcnow(), 'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _create_review(self, programme_id, *, name, interval, unit, review_type_code=None, sections=None, **overrides):
        type_code = review_type_code or review_types.REVIEW_TYPE_CODE_MCM
        payload = {
            'name': name,
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(type_code)['id'],
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': sections if sections is not None else [
                {'title': 'General', 'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': True}]},
            ],
        }
        payload.update(overrides)
        review_id, errors = reviews.create_review(programme_id, payload, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _template_row(self, review_id):
        return reviews.get_review_template_row(review_id)

    # ---------------------------------------------------------------- A/B

    def test_monthly_review_occurrences_match_worked_example(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 8, 2),
            window_start=date(2026, 1, 1), window_end=date(2027, 1, 1),
        )
        dates = [o['targetDate'] for o in occurrences[:3]]
        self.assertEqual(dates, [date(2026, 9, 2), date(2026, 10, 2), date(2026, 11, 2)])
        self.assertEqual([o['occurrenceNumber'] for o in occurrences[:3]], [1, 2, 3])

    def test_progress_review_occurrences_use_twelve_week_interval(self):
        review_id = self._create_review('PROG-A', name='Progress Review', interval=12, unit='weeks')
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 8, 2),
            window_start=date(2026, 1, 1), window_end=date(2027, 6, 1),
        )
        dates = [o['targetDate'] for o in occurrences[:2]]
        self.assertEqual(dates, [date(2026, 8, 2) + review_instances.timedelta(weeks=12),
                                  date(2026, 8, 2) + review_instances.timedelta(weeks=24)])

    # ------------------------------------------------------------------ C

    def test_disabled_review_produces_no_occurrences(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months', enabled=False)
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 8, 2),
            window_start=date(2026, 1, 1), window_end=date(2027, 1, 1),
        )
        self.assertEqual(occurrences, [])

    # ------------------------------------------------------------------ D

    def test_ineligible_learner_status_produces_no_occurrences(self):
        review_id = self._create_review(
            'PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months',
            applicableStatuses=['Active'],
        )
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status='Withdrawn',
            learner_start_date=date(2026, 8, 2),
            window_start=date(2026, 1, 1), window_end=date(2027, 1, 1),
        )
        self.assertEqual(occurrences, [])

        eligible = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status='Active',
            learner_start_date=date(2026, 8, 2),
            window_start=date(2026, 1, 1), window_end=date(2027, 1, 1),
        )
        self.assertTrue(eligible)

    # ------------------------------------------------------------------ E

    def test_occurrence_count_limits_total_occurrences(self):
        review_id = self._create_review(
            'PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months',
            occurrenceCount=5,
        )
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status=None,
            learner_start_date=date(2026, 1, 1),
            window_start=date(2026, 1, 1), window_end=date(2030, 1, 1),
        )
        self.assertEqual(len(occurrences), 5)

    def test_null_occurrence_count_is_unlimited(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        occurrences = review_instances.resolve_learner_occurrences(
            template, learner_id=1, learner_status=None,
            learner_start_date=date(2020, 1, 1),
            window_start=date(2020, 1, 1), window_end=date(2030, 1, 1),
        )
        self.assertGreater(len(occurrences), 5)

    # -------------------------------------------------------------- F/G/H

    def test_conditional_field_does_not_block_completion_when_hidden(self):
        sections = [{
            'title': 'General',
            'fields': [{
                'title': 'Any issues?', 'fieldType': 'boolean_case_block', 'required': True,
                'yesFields': [{'title': 'Explain', 'fieldType': 'text', 'required': True}],
                'noFields': [],
            }],
        }]
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months', sections=sections)
        template = self._template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )

        parent_field_id = review_instances.reviews.get_review_field_rows(review_id)[0]['id']
        review_instances.save_review_instance_answers(instance, {parent_field_id: 'no'}, actor='coach@example.com')
        instance = review_instances.get_review_instance(instance['id'])
        ok, errors = review_instances.complete_review_instance(instance, actor='coach@example.com')
        self.assertTrue(ok, errors)

    def test_required_visible_field_blocks_completion_when_unanswered(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )
        ok, errors = review_instances.complete_review_instance(instance, actor='coach@example.com')
        self.assertFalse(ok)
        self.assertIn('fields', errors)

        field_id = reviews.get_review_field_rows(review_id)[0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'All good.'}, actor='coach@example.com')
        instance = review_instances.get_review_instance(instance['id'])
        ok, errors = review_instances.complete_review_instance(instance, actor='coach@example.com')
        self.assertTrue(ok, errors)

    # ---------------------------------------------------------------- I/K

    def test_draft_answer_survives_reload(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )
        field_id = reviews.get_review_field_rows(review_id)[0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'Draft note'}, actor='coach@example.com')

        reloaded = review_instances.get_review_instance(instance['id'])
        definition = review_instances.review_instance_form_definition(reloaded)
        saved_answer = definition['sections'][0]['fields'][0]['answer']
        self.assertEqual(saved_answer, 'Draft note')

    def test_ensure_review_instance_is_idempotent(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        first = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )
        second = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )
        self.assertEqual(first['id'], second['id'])
        rows = views.fetch_all(
            f"select count(*) as c from {views.table_name(review_instances.REVIEW_INSTANCES_TABLE)} where review_template_id = %s",
            [review_id],
        )
        self.assertEqual(rows[0]['c'], 1)

    # ---------------------------------------------------------------- M

    def test_completed_instance_keeps_its_frozen_question_after_template_edit(self):
        review_id = self._create_review('PROG-A', name='Monthly Coaching Meeting', interval=1, unit='months')
        template = self._template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='commercial', programme_id='PROG-A',
            occurrence_number=1, target_date=date(2026, 9, 2), coach_email='coach@example.com',
        )
        field_id = reviews.get_review_field_rows(review_id)[0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'Answered before the edit'}, actor='coach@example.com')
        instance = review_instances.get_review_instance(instance['id'])
        ok, _ = review_instances.complete_review_instance(instance, actor='coach@example.com')
        self.assertTrue(ok)

        # Curriculum renames the question after completion.
        reviews.update_review(review_id, {
            'sections': [{'title': 'General', 'fields': [{'title': 'Renamed after completion', 'fieldType': 'text', 'required': True}]}],
        }, actor='curriculum-admin')

        completed_instance = review_instances.get_review_instance(instance['id'])
        frozen_definition = review_instances.review_instance_form_definition(completed_instance)
        self.assertEqual(frozen_definition['sections'][0]['fields'][0]['title'], 'Notes')
        self.assertEqual(frozen_definition['sections'][0]['fields'][0]['answer'], 'Answered before the edit')
        # The display title, unlike the question set, stays live.
        reviews.update_review(review_id, {'name': 'Monthly Coaching Review'}, actor='curriculum-admin')
        frozen_definition = review_instances.review_instance_form_definition(review_instances.get_review_instance(instance['id']))
        self.assertEqual(frozen_definition['template']['name'], 'Monthly Coaching Review')
