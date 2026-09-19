"""Freezing a Progress Review's calculated progress and RAG against the Review
Instance that owns them.

See learner_api/tests_review_progress_snapshot.py for the calculation itself
(and the start-date rule it must obey), and tests_review_pdf.py for the export
that renders what is frozen here.
"""
from datetime import date

from django.db import connection
from django.test import TestCase

from . import review_instances, review_schedule, review_types, reviews, views


def snapshot(calculated_at='2026-09-16T14:35:02', **overrides):
    payload = {
        'calculationMethod': 'planned_hours',
        'calculatedFrom': '2024-10-18',
        'calculatedAt': calculated_at,
        'calculatedBy': 'coach@example.test',
        'weeksElapsed': 100,
        'programmeProgress': {'actual': 28, 'expected': 56, 'planned': 100, 'actualPercent': 28.0,
                              'expectedPercent': 56.0, 'variancePercent': -28.0, 'varianceDirection': 'below'},
        'offTheJobHours': {'actual': 64, 'expected': 41, 'planned': 100, 'actualPercent': 64.0,
                           'expectedPercent': 41.0, 'variancePercent': 23.0, 'varianceDirection': 'above'},
    }
    payload.update(overrides)
    return payload


class ReviewProgressSnapshotTestCase(TestCase):
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
            review_schedule.CLASH_RESOLUTIONS_TABLE,
            review_schedule.OCCURRENCE_OVERRIDES_TABLE,
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _programme(self, programme_id='PROG-PR'):
        views.insert_row('programmes', {
            'id': programme_id, 'programme_id': programme_id, 'program_id': programme_id,
            'name': 'Project Controls', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': views.datetime.utcnow(), 'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _template(self, programme_id, *, name='Progress Review',
                  review_type_code=None, with_rag=True):
        """A Curriculum-authored template. The RAG question declares itself
        through its configuration's semanticKey -- never through its title."""
        fields = [{'title': 'Notes', 'fieldType': 'text', 'required': False}]
        if with_rag:
            fields.append({
                'title': 'Overall status this quarter',
                'fieldType': 'list_item',
                'required': False,
                'configuration': {'semanticKey': 'rag_status', 'options': ['Green', 'Amber', 'Red']},
            })
        review_id, errors = reviews.create_review(programme_id, {
            'name': name,
            'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(
                review_type_code or review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)['id'],
            'recurrence': {'interval': 3, 'unit': 'months'},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'Review', 'fields': fields}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id)

    def _instance(self, template, *, learner_id=101, occurrence_number=1, target_date=date(2026, 1, 3)):
        return review_instances.ensure_review_instance(
            template, learner_id=learner_id, learner_kind='apprenticeship',
            programme_id=template.get('programme_id'), occurrence_number=occurrence_number,
            target_date=target_date, coach_email='coach@example.test', actor='test',
        )

    def _rag_field_id(self, instance):
        definition = review_instances.review_instance_form_definition(instance)
        return next(field['id'] for section in definition['sections'] for field in section['fields']
                    if field['configuration'].get('semanticKey') == 'rag_status')

    # ------------------------------------------------------- persistence

    def test_the_snapshot_is_stored_against_its_own_review_instance(self):
        template = self._template(self._programme())
        first, second = self._instance(template), self._instance(template, occurrence_number=2)
        review_instances.save_review_instance_progress_snapshot(first, snapshot(), actor='coach@example.test')

        stored = review_instances.review_instance_progress_snapshot(
            review_instances.get_review_instance(first['id']))
        self.assertEqual(stored['calculatedFrom'], '2024-10-18')
        self.assertEqual(stored['offTheJobHours']['actualPercent'], 64.0)
        # The other occurrence is untouched.
        self.assertIsNone(review_instances.review_instance_progress_snapshot(
            review_instances.get_review_instance(second['id'])))

    def test_reopening_the_form_returns_the_stored_snapshot_and_never_recalculates(self):
        template = self._template(self._programme())
        instance = self._instance(template)
        self.assertIsNone(
            review_instances.review_instance_form_definition(instance)['progressSnapshot'])

        review_instances.save_review_instance_progress_snapshot(instance, snapshot(), actor='test')
        for _ in range(3):
            definition = review_instances.review_instance_form_definition(
                review_instances.get_review_instance(instance['id']))
            self.assertEqual(definition['progressSnapshot']['calculatedAt'], '2026-09-16T14:35:02')
            self.assertEqual(definition['progressSnapshot']['programmeProgress']['actualPercent'], 28.0)

    def test_recalculating_before_signing_replaces_the_previous_snapshot(self):
        template = self._template(self._programme())
        instance = self._instance(template)
        review_instances.save_review_instance_progress_snapshot(instance, snapshot(), actor='test')
        review_instances.save_review_instance_progress_snapshot(
            review_instances.get_review_instance(instance['id']),
            snapshot(calculated_at='2026-10-01T09:00:00',
                     offTheJobHours={'actual': 70, 'expected': 45, 'planned': 100, 'actualPercent': 70.0,
                                     'expectedPercent': 45.0, 'variancePercent': 25.0, 'varianceDirection': 'above'}),
            actor='test',
        )
        stored = review_instances.review_instance_progress_snapshot(
            review_instances.get_review_instance(instance['id']))
        self.assertEqual(stored['calculatedAt'], '2026-10-01T09:00:00')
        self.assertEqual(stored['offTheJobHours']['actualPercent'], 70.0)

    # --------------------------------------------------------- the freeze

    def test_progress_cannot_be_recalculated_once_signing_begins(self):
        template = self._template(self._programme())
        for status in (review_instances.STATUS_AWAITING_SIGNATURE, review_instances.STATUS_COMPLETED):
            with self.subTest(status=status):
                instance = self._instance(template, occurrence_number=hash(status) % 90 + 5)
                review_instances.save_review_instance_progress_snapshot(instance, snapshot(), actor='test')
                review_instances.force_review_instance_status_for_tests(instance['id'], status, actor='test')
                signed = review_instances.get_review_instance(instance['id'])

                with self.assertRaisesMessage(ValueError, 'cannot be recalculated after the signature step begins'):
                    review_instances.save_review_instance_progress_snapshot(
                        signed, snapshot(calculated_at='2027-01-01T00:00:00'), actor='test')

                # The figures that were signed are exactly the ones still stored.
                kept = review_instances.review_instance_progress_snapshot(
                    review_instances.get_review_instance(instance['id']))
                self.assertEqual(kept['calculatedAt'], '2026-09-16T14:35:02')
                self.assertEqual(kept['offTheJobHours']['actualPercent'], 64.0)

    def test_a_completed_review_keeps_its_own_figures_as_the_learner_moves_on(self):
        """The learner's later progress lives elsewhere entirely -- nothing
        reads it back into a completed review."""
        template = self._template(self._programme())
        instance = self._instance(template)
        review_instances.save_review_instance_progress_snapshot(instance, snapshot(), actor='test')
        review_instances.force_review_instance_status_for_tests(
            instance['id'], review_instances.STATUS_COMPLETED, actor='test')

        # A newer review for the same learner records much higher figures.
        later = self._instance(template, occurrence_number=2, target_date=date(2026, 4, 3))
        review_instances.save_review_instance_progress_snapshot(later, snapshot(
            calculated_at='2027-01-04T10:00:00',
            programmeProgress={'actual': 65, 'expected': 60, 'planned': 100, 'actualPercent': 65.0,
                               'expectedPercent': 60.0, 'variancePercent': 5.0, 'varianceDirection': 'above'},
            offTheJobHours={'actual': 80, 'expected': 70, 'planned': 100, 'actualPercent': 80.0,
                            'expectedPercent': 70.0, 'variancePercent': 10.0, 'varianceDirection': 'above'},
        ), actor='test')

        old = review_instances.review_instance_form_definition(
            review_instances.get_review_instance(instance['id']))['progressSnapshot']
        self.assertEqual(old['programmeProgress']['actualPercent'], 28.0)
        self.assertEqual(old['offTheJobHours']['actualPercent'], 64.0)

    # ---------------------------------------------------------------- RAG

    def test_rag_is_read_through_the_templates_marker_not_a_question_title(self):
        template = self._template(self._programme())
        instance = self._instance(template)
        review_instances.force_review_instance_status_for_tests(
            instance['id'], review_instances.STATUS_IN_PROGRESS, actor='test')
        started = review_instances.get_review_instance(instance['id'])
        review_instances.save_review_instance_answers(
            started, {self._rag_field_id(started): 'Green'}, actor='test')

        self.assertEqual(review_instances.review_instance_rag_value(
            review_instances.get_review_instance(instance['id'])), 'Green')

    def test_a_template_with_no_rag_question_reports_no_rag_rather_than_guessing(self):
        template = self._template(self._programme(), with_rag=False)
        instance = self._instance(template)
        self.assertEqual(review_instances.review_instance_rag_value(instance), '')

    def test_rag_history_covers_this_learners_completed_progress_reviews_newest_first(self):
        programme = self._programme()
        template = self._template(programme)
        older = self._instance(template, occurrence_number=1, target_date=date(2025, 4, 16))
        newer = self._instance(template, occurrence_number=2, target_date=date(2026, 1, 3))
        for instance, answer in ((older, ''), (newer, 'Green')):
            review_instances.force_review_instance_status_for_tests(
                instance['id'], review_instances.STATUS_IN_PROGRESS, actor='test')
            started = review_instances.get_review_instance(instance['id'])
            if answer:
                review_instances.save_review_instance_answers(
                    started, {self._rag_field_id(started): answer}, actor='test')
            review_instances.force_review_instance_status_for_tests(
                instance['id'], review_instances.STATUS_COMPLETED, actor='test')

        history = review_instances.progress_review_rag_history(101)
        self.assertEqual([entry['targetDate'] for entry in history], ['2026-01-03', '2025-04-16'])
        self.assertEqual([entry['rag'] for entry in history], ['Green', ''])

    def test_rag_history_excludes_other_review_types_learners_and_unfinished_reviews(self):
        programme = self._programme()
        progress_template = self._template(programme)
        mcm_template = self._template(programme, name='Monthly Coaching Meeting',
                                      review_type_code=review_types.REVIEW_TYPE_CODE_MCM)

        completed = self._instance(progress_template, occurrence_number=1)
        review_instances.force_review_instance_status_for_tests(
            completed['id'], review_instances.STATUS_COMPLETED, actor='test')
        # Same learner, still in progress.
        self._instance(progress_template, occurrence_number=2, target_date=date(2026, 4, 3))
        # Same learner, a different Review Type, completed.
        other_type = self._instance(mcm_template, occurrence_number=1, target_date=date(2026, 2, 1))
        review_instances.force_review_instance_status_for_tests(
            other_type['id'], review_instances.STATUS_COMPLETED, actor='test')
        # A different learner's completed Progress Review.
        other_learner = self._instance(progress_template, learner_id=202, occurrence_number=1)
        review_instances.force_review_instance_status_for_tests(
            other_learner['id'], review_instances.STATUS_COMPLETED, actor='test')

        history = review_instances.progress_review_rag_history(101)
        self.assertEqual([entry['reviewInstanceId'] for entry in history], [completed['id']])

    def test_only_a_progress_review_form_carries_a_rag_history(self):
        programme = self._programme()
        mcm = self._instance(self._template(programme, name='Monthly Coaching Meeting',
                                            review_type_code=review_types.REVIEW_TYPE_CODE_MCM))
        progress = self._instance(self._template(programme), occurrence_number=3)
        self.assertNotIn('ragHistory', review_instances.review_instance_form_definition(mcm))
        self.assertIn('ragHistory', review_instances.review_instance_form_definition(progress))
