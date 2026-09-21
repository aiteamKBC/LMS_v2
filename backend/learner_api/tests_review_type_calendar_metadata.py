"""The learner calendar carries each Review's TYPE, not just its routing bucket.

Every Curriculum Review reaches the learner calendar under one of three legacy
``source`` values -- ``mcr``, ``progress-review`` or ``review`` -- because that
is what event keys, booking and the Coach pages are keyed on. On its own that
is lossy: a Career Review and a Gateway Review are both ``source: "review"``,
so the page could only ever offer one generic "Review" filter.

These cover the metadata that fixes it: every review-driven event now also
carries ``reviewTypeId`` / ``reviewTypeCode`` / ``reviewTypeName`` /
``reviewTypeIsSystem``, resolved from the template's Review Type, while
``source`` is left exactly as it was.

The two names stay firmly apart:

    title            review_templates.name  -- "Monthly Learner Catch-up"
    reviewTypeName   review_types.name      -- "Monthly Coaching Meeting"
"""
from datetime import date
from types import SimpleNamespace

from django.db import connection
from django.test import TestCase

from curriculum_api import review_instances, review_schedule, review_types, reviews
from curriculum_api import views as curriculum_views

from .calendar import _generated_cycle_events, _serialize_event, review_type_rows_by_template

PROGRAMME_ID = 'PROG-FILTERS'
PROGRAMME_NAME = 'Filter Test Programme'
LEARNER_START = '2026-08-10'


class ReviewTypeCalendarMetadataTestCase(TestCase):
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

    def _review(self, *, name, type_id, interval=1, unit='months'):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name,
            'enabled': True,
            'reviewTypeId': type_id,
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
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

    def _enrolment_row(self):
        return SimpleNamespace(
            id=101, pk=101, email='learner@example.com', learner_type='commercial',
            # learner_start_date is the Review recurrence anchor; start_date is
            # kept in step too since resolve_schedule_window's WINDOW bound
            # still reads it.
            learner_start_date=LEARNER_START, start_date=LEARNER_START, end_date='2027-08-09',
            practical_period_end_date='', apprenticeship_end_date='',
        )

    def _profile(self):
        return SimpleNamespace(
            id=248, pk=248, email='learner@example.com',
            start_date=date(2026, 8, 10), end_date=date(2027, 8, 9),
            coach_name='Coach One', coach_email='coach@example.com',
            programme=PROGRAMME_NAME, programme_status='Active',
            cohort='Cohort A', group_name='Group A',
        )

    def _events(self):
        return _generated_cycle_events(self._enrolment_row(), self._profile(), set())

    def _by_type_name(self):
        buckets = {}
        for event in self._events():
            buckets.setdefault(event.get('reviewTypeName'), []).append(event)
        return buckets


class GeneratedEventMetadataTests(ReviewTypeCalendarMetadataTestCase):
    def test_an_mcm_event_carries_the_monthly_coaching_meeting_type(self):
        self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        event = self._events()[0]
        self.assertEqual(event['reviewTypeCode'], 'mcm')
        self.assertEqual(event['reviewTypeName'], 'Monthly Coaching Meeting')
        self.assertTrue(event['reviewTypeIsSystem'])
        # The legacy routing value is untouched.
        self.assertEqual(event['source'], 'mcr')

    def test_a_progress_review_event_carries_the_progress_review_type(self):
        self._review(name='Progress Review', type_id=self._system('progress_review'), interval=12, unit='weeks')
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
        # Still routed generically -- the Coach consumers are unaffected.
        self.assertEqual(event['source'], 'review')

    def test_two_custom_types_stay_distinguishable_despite_one_routing_value(self):
        self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        self._review(name='Gateway Check', type_id=self._custom('Gateway Review'), interval=2, unit='months')

        sources = {event['source'] for event in self._events()}
        type_codes = {event['reviewTypeCode'] for event in self._events()}
        self.assertEqual(sources, {'review'})
        self.assertEqual(type_codes, {'career_review', 'gateway_review'})

    def test_the_card_title_is_the_template_name_and_the_filter_label_is_the_type(self):
        # The brief's worked example.
        self._review(name='Monthly Learner Catch-up', type_id=self._system('mcm'))
        event = self._events()[0]
        self.assertIn('Monthly Learner Catch-up', event['title'])
        self.assertEqual(event['reviewTypeName'], 'Monthly Coaching Meeting')

    def test_renaming_the_template_does_not_move_its_type(self):
        review_id = self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        before = self._events()[0]['reviewTypeId']

        reviews.update_review(review_id, {'name': 'Monthly Learner Catch-up'}, actor='test')
        after = self._events()[0]

        self.assertEqual(after['reviewTypeId'], before)
        self.assertEqual(after['reviewTypeName'], 'Monthly Coaching Meeting')
        self.assertIn('Monthly Learner Catch-up', after['title'])

    def test_two_templates_of_one_type_share_that_type(self):
        career = self._custom('Career Review')
        self._review(name='Career Planning Session', type_id=career)
        self._review(name='Where next?', type_id=career, interval=3, unit='months')

        titles = {event['title'].split(' — ')[0] for event in self._events()}
        type_ids = {event['reviewTypeId'] for event in self._events()}
        self.assertEqual(len(titles), 2)
        self.assertEqual(type_ids, {career})

    def test_an_unclassified_template_reports_no_type_rather_than_guessing(self):
        review_id = self._review(name='Legacy review', type_id=self._system('mcm'))
        curriculum_views.update_rows(
            reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [review_id], {'review_type_id': ''},
        )
        event = self._events()[0]
        self.assertIsNone(event['reviewTypeId'])
        self.assertIsNone(event['reviewTypeName'])
        self.assertEqual(event['source'], 'review')

    def test_every_review_type_present_is_represented(self):
        self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        self._review(name='Progress Review', type_id=self._system('progress_review'), interval=12, unit='weeks')
        self._review(name='Career Planning Session', type_id=self._custom('Career Review'), interval=2, unit='months')
        self._review(name='Gateway Check', type_id=self._custom('Gateway Review'), interval=4, unit='months')
        self._review(name='Support Plan', type_id=self._custom('Personal Support Plan'), interval=6, unit='months')

        self.assertEqual(
            set(self._by_type_name()),
            {'Monthly Coaching Meeting', 'Progress Review', 'Career Review',
             'Gateway Review', 'Personal Support Plan'},
        )

    def test_counts_per_type_are_what_the_recurrences_produce(self):
        self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=6, unit='months')
        self._review(name='Career Planning Session', type_id=self._custom('Career Review'), interval=3, unit='months')

        buckets = self._by_type_name()
        # Window is the learner's year, 2026-08-10 to 2027-08-09, counted from
        # their start date: 6-monthly gives one occurrence (2027-02-10),
        # 3-monthly gives three (2026-11-10, 2027-02-10, 2027-05-10).
        self.assertEqual(
            [event['targetDate'] for event in buckets['Monthly Coaching Meeting']],
            ['2027-02-10'],
        )
        self.assertEqual(
            [event['targetDate'] for event in buckets['Career Review']],
            ['2026-11-10', '2027-02-10', '2027-05-10'],
        )


class StoredEventMetadataTests(ReviewTypeCalendarMetadataTestCase):
    """A booked row resolves its type through review_template_id, so it sits in
    the same bucket as the unbooked occurrences around it."""

    def _record(self, template_id, event_type='review'):
        return SimpleNamespace(
            event_key='review:248:1:2026-09-10', event_type=event_type, sequence=1,
            review_template_id=template_id, occurrence_number=1,
            status='scheduled', target_date=date(2026, 9, 10), scheduled_date=date(2026, 9, 10),
            scheduled_time=None, duration_minutes=60, owner_name='Coach One',
            owner_email='coach@example.com', meeting_provider='teams', meeting_link='',
            graph_web_link='', notes='', review_responses={}, review_completed_at=None,
            graph_event_id='', last_graph_sync_error='',
        )

    def test_a_booked_custom_review_carries_its_type(self):
        review_id = self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        event = _serialize_event(self._record(review_id))
        self.assertEqual(event['reviewTypeCode'], 'career_review')
        self.assertEqual(event['reviewTypeName'], 'Career Review')
        self.assertEqual(event['source'], 'review')

    def test_a_booked_mcm_carries_the_system_type(self):
        review_id = self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'))
        event = _serialize_event(self._record(review_id, event_type='mcr'))
        self.assertEqual(event['reviewTypeCode'], 'mcm')
        self.assertTrue(event['reviewTypeIsSystem'])

    def test_a_non_review_row_carries_no_type(self):
        event = _serialize_event(self._record('', event_type='catch-up'))
        self.assertIsNone(event['reviewTypeId'])
        self.assertIsNone(event['reviewTypeName'])
        self.assertFalse(event['reviewTypeIsSystem'])
        self.assertEqual(event['source'], 'catch-up')

    def test_reclassifying_a_review_moves_its_booked_events_too(self):
        # Review Type is routing metadata read live, not part of a historical
        # record -- a booked event follows its template's current type.
        review_id = self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        gateway = self._custom('Gateway Review')
        reviews.update_review(review_id, {'reviewTypeId': gateway}, actor='test')

        event = _serialize_event(self._record(review_id))
        self.assertEqual(event['reviewTypeCode'], 'gateway_review')

    def test_the_batch_resolver_returns_one_row_per_template(self):
        career = self._review(name='Career Planning Session', type_id=self._custom('Career Review'))
        mcm = self._review(name='Monthly Coaching Meeting', type_id=self._system('mcm'), interval=2)

        resolved = review_type_rows_by_template([career, mcm, '', None, career])
        self.assertEqual(
            {template_id: row['code'] for template_id, row in resolved.items()},
            {career: 'career_review', mcm: 'mcm'},
        )

    def test_an_unknown_template_id_is_simply_absent(self):
        self.assertEqual(review_type_rows_by_template(['REV-DOES-NOT-EXIST']), {})
