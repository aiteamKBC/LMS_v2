"""The coach calendar carries each Review's TYPE, not just its routing bucket.

Mirror of learner_api.tests_review_type_calendar_metadata, for the other
calendar. Every Curriculum Review reaches the coach timetable under one of
three legacy ``source`` values -- ``mcr``, ``progress-review`` or ``review`` --
because scheduling, Teams, meeting artifacts, per-source theming and the
Progress Review / MCM actions are all keyed on it. On its own that is lossy:
a Career Review and a Gateway Review are both ``source: "review"``.

These cover the metadata that fixes it -- ``reviewTypeId`` /
``reviewTypeCode`` / ``reviewTypeName`` / ``reviewTypeIsSystem`` on every
review-driven event, generated and booked -- while ``source`` is left exactly
as it was.

    title            review_templates.name  -- the card title
    reviewTypeName   review_types.name      -- the filter label
"""
from datetime import date
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase

from curriculum_api import review_instances, review_schedule, review_types, reviews
from curriculum_api import views as curriculum_views

from .views import (
    build_generated_calendar_event,
    review_event_type_for_type_code,
    review_type_event_fields,
    review_type_fields_by_template,
)

PROGRAMME_ID = 'PROG-COACH-FILTERS'


class CoachReviewTypeMetadataTestCase(TestCase):
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
            'name': 'Coach Filter Programme', 'status': 'active',
            'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(),
            'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _review(self, *, name, type_id):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name, 'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': 1, 'unit': 'months'},
            'scheduleAnchorDate': '2026-01-01', 'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _system(self, code):
        return review_types.get_review_type_by_code(code)['id']

    def _custom(self, name):
        row, errors = review_types.create_review_type(name)
        self.assertIsNone(errors, errors)
        return row['id']

    def _learner(self):
        return SimpleNamespace(
            id=248, pk=248, username='Test Learner', email='learner@example.com',
            programme='Coach Filter Programme', cohort='Cohort A', group_name='Group A',
            learner_type='commercial', enrolment_id=101,
        )

    def _generated(self, occurrence):
        """One coach calendar event from an occurrence, exactly as the caseload
        timetable builds it."""
        return build_generated_calendar_event(
            learner=self._learner(),
            owner_email='coach@example.com',
            owner_name='Coach One',
            event_type=review_event_type_for_type_code(occurrence.get('reviewTypeCode')),
            sequence=occurrence['occurrenceNumber'],
            target_date=occurrence['targetDate'],
            review_template_id=occurrence['reviewTemplateId'],
            review_title=occurrence['reviewName'],
            review_type=occurrence,
        )

    def _occurrences(self):
        return review_instances.resolve_programme_review_occurrences(
            PROGRAMME_ID, learner_id=248, learner_status='Active',
            learner_start_date=date(2026, 8, 10),
            window_start=date(2026, 8, 10), window_end=date(2027, 8, 9),
        )

    def _events(self):
        return [self._generated(occurrence) for occurrence in self._occurrences()]


class GeneratedCoachEventTests(CoachReviewTypeMetadataTestCase):
    def test_an_mcm_event_carries_the_system_type_and_keeps_its_routing_source(self):
        self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'mcm')
        self.assertEqual(event['reviewTypeName'], 'Monthly Coaching Meeting')
        self.assertTrue(event['reviewTypeIsSystem'])
        self.assertEqual(event['source'], 'mcr')
        # `type` still drives the coach's card theming.
        self.assertEqual(event['type'], 'coaching')

    def test_a_progress_review_event_carries_the_progress_review_type(self):
        self._review(name='Progress Review', type_id=self._system('progress_review'))
        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'progress_review')
        self.assertEqual(event['reviewTypeName'], 'Progress Review')
        self.assertEqual(event['source'], 'progress-review')

    def test_a_custom_career_review_carries_its_own_type(self):
        self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'career_review')
        self.assertEqual(event['reviewTypeName'], 'Career Review')
        self.assertFalse(event['reviewTypeIsSystem'])
        self.assertEqual(event['source'], 'review')

    def test_a_custom_gateway_review_carries_its_own_type(self):
        self._review(name='Gateway Check', type_id=self._custom('Gateway Review'))
        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'gateway_review')
        self.assertEqual(event['reviewTypeName'], 'Gateway Review')

    def test_two_custom_types_stay_distinguishable_under_one_routing_value(self):
        self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        self._review(name='Gateway Check', type_id=self._custom('Gateway Review'))
        events = self._events()
        self.assertEqual({event['source'] for event in events}, {'review'})
        self.assertEqual(
            {event['reviewTypeCode'] for event in events},
            {'career_review', 'gateway_review'},
        )

    def test_the_card_title_is_the_template_name_and_the_filter_label_is_the_type(self):
        self._review(name='Monthly Learner Catch-up', type_id=self._system('mcm'))
        event = self._events()[0]
        self.assertEqual(event['title'], 'Monthly Learner Catch-up')
        self.assertEqual(event['reviewTypeName'], 'Monthly Coaching Meeting')

    def test_renaming_the_template_retitles_the_card_but_not_the_type(self):
        review_id = self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        before = self._events()[0]['reviewTypeId']

        reviews.update_review(review_id, {'name': 'Monthly Learner Development Session'}, actor='test')
        after = self._events()[0]

        self.assertEqual(after['title'], 'Monthly Learner Development Session')
        self.assertEqual(after['reviewTypeId'], before)
        self.assertEqual(after['reviewTypeName'], 'Monthly Coaching Meeting')

    def test_reclassifying_a_template_moves_its_future_occurrences(self):
        review_id = self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        gateway = self._custom('Gateway Review')
        reviews.update_review(review_id, {'reviewTypeId': gateway}, actor='test')

        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'gateway_review')
        self.assertEqual(event['reviewTypeId'], gateway)

    def test_two_templates_of_one_type_share_that_type(self):
        mcm = self._system('mcm')
        self._review(name='Monthly Learner Catch-up', type_id=mcm)
        self._review(name='Monthly Review', type_id=mcm)
        events = self._events()
        self.assertEqual({event['reviewTypeId'] for event in events}, {mcm})
        self.assertEqual(len({event['title'] for event in events}), 2)

    def test_an_unclassified_template_reports_no_type_rather_than_guessing(self):
        review_id = self._review(name='Legacy review', type_id=self._system('mcm'))
        curriculum_views.update_rows(
            reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], {'review_type_id': ''},
        )
        event = self._events()[0]
        self.assertIsNone(event['reviewTypeId'])
        self.assertIsNone(event['reviewTypeName'])
        self.assertFalse(event['reviewTypeIsSystem'])
        self.assertEqual(event['source'], 'review')


class CoachEventFieldShapeTests(CoachReviewTypeMetadataTestCase):
    def test_a_non_review_event_carries_the_four_fields_as_empty(self):
        fields = review_type_event_fields(None)
        self.assertEqual(fields, {
            'reviewTypeId': None, 'reviewTypeCode': None,
            'reviewTypeName': None, 'reviewTypeIsSystem': False,
        })

    def test_blank_strings_are_normalised_to_none(self):
        fields = review_type_event_fields({
            'reviewTypeId': '   ', 'reviewTypeCode': '', 'reviewTypeName': None,
            'reviewTypeIsSystem': False,
        })
        self.assertEqual(fields, {
            'reviewTypeId': None, 'reviewTypeCode': None,
            'reviewTypeName': None, 'reviewTypeIsSystem': False,
        })

    def test_the_batch_resolver_returns_one_entry_per_template(self):
        career = self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        mcm = self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))

        resolved = review_type_fields_by_template([career, mcm, '', None, career])
        self.assertEqual(
            {template_id: fields['reviewTypeCode'] for template_id, fields in resolved.items()},
            {career: 'career_review', mcm: 'mcm'},
        )

    def test_an_unknown_template_id_is_simply_absent(self):
        self.assertEqual(review_type_fields_by_template(['REV-DOES-NOT-EXIST']), {})

    def test_no_template_ids_costs_no_query(self):
        self.assertEqual(review_type_fields_by_template([]), {})
