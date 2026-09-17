"""The Calculate endpoint: who may run it, which Review Type has it, which
date it anchors to, and when it stops being allowed.

    python manage.py test coach_api.tests_review_instance_progress_endpoint

The calculation itself is covered by learner_api/tests_review_progress_snapshot
.py, and the storage/freeze rules by
curriculum_api/tests_review_progress_snapshot.py. What is pinned here is the
wiring in between -- above all that the view hands the calculator the
learner's OWN programme start date and the server's own clock, never a
cohort/group date and never anything the client sent.
"""
import json
from datetime import date, datetime
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory, TestCase

from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views

from . import views as coach_views

COACH_EMAIL = 'coach@example.com'
OTHER_COACH_EMAIL = 'other-coach@example.com'
LEARNER_PROFILE_ID = 601

#: The learner's own programme start date...
LEARNER_START = date(2024, 10, 18)
#: ...and the cohort delivery window the same enrolment row also carries.
COHORT_START = date(2024, 10, 1)

CANNED_SNAPSHOT = {
    'calculationMethod': 'planned_hours',
    'calculatedFrom': LEARNER_START.isoformat(),
    'calculatedAt': '2026-09-16T14:35:02',
    'calculatedBy': COACH_EMAIL,
    'weeksElapsed': 100,
    'programmeProgress': {'actual': 28, 'expected': 56, 'planned': 100, 'actualPercent': 28.0,
                          'expectedPercent': 56.0, 'variancePercent': -28.0, 'varianceDirection': 'below'},
    'offTheJobHours': {'actual': 64, 'expected': 41, 'planned': 100, 'actualPercent': 64.0,
                       'expectedPercent': 41.0, 'variancePercent': 23.0, 'varianceDirection': 'above'},
}


def enrolment_row(**overrides):
    """enrolment."Created_users" -- Learner_start_date/Start_date are TEXT in
    Postgres, so the fixture stores strings exactly as the columns do."""
    fields = {
        'id': 900, 'pk': 900, 'email': 'learner@example.com', 'learner_type': 'apprenticeship',
        'learner_start_date': LEARNER_START.isoformat(),
        'start_date': COHORT_START.isoformat(),
        'programme': 'Project Controls',
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class ReviewProgressEndpointTestCase(TestCase):
    databases = {'default', 'enrolment'}

    def setUp(self):
        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_instances.provision_review_instance_tables()
        self._clear()
        self._programme()

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
                    id varchar(128) primary key, programme_id varchar(128), program_id varchar(128),
                    name varchar(255), status varchar(32), is_active boolean, is_archived boolean,
                    created_at timestamp, updated_at timestamp
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
            'id': 'PROG-PR', 'programme_id': 'PROG-PR', 'program_id': 'PROG-PR',
            'name': 'Project Controls', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _instance(self, *, type_code=None, coach_email=COACH_EMAIL, occurrence_number=1):
        type_code = type_code or review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW
        review_id, errors = reviews.create_review('PROG-PR', {
            'name': 'Progress Review' if type_code != 'mcm' else 'Monthly Coaching Meeting',
            'enabled': True, 'reviewTypeId': review_types.get_review_type_by_code(type_code)['id'],
            'recurrence': {'interval': 3, 'unit': 'months'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'Review', 'fields': [{'title': 'Notes', 'fieldType': 'text', 'required': False}]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_instances.ensure_review_instance(
            reviews.get_review_template_row(review_id),
            learner_id=LEARNER_PROFILE_ID, learner_kind='apprenticeship', programme_id='PROG-PR',
            occurrence_number=occurrence_number, target_date=date(2026, 1, 3),
            coach_email=coach_email, actor='test',
        )

    def _calculate(self, instance_id, *, owner_email=COACH_EMAIL, row=None,
                   profile=SimpleNamespace(id=LEARNER_PROFILE_ID, email='learner@example.com'),
                   snapshot=CANNED_SNAPSHOT):
        """POST the Calculate endpoint with the learner lookups stubbed.

        Only the two learner-data lookups are stubbed -- the anchor resolution
        under test (resolve_review_anchor_date), the authorization gate and the
        persistence are all the real thing.
        """
        request = RequestFactory().post(f'/coach_api/coach/reviews/{instance_id}/progress')
        request.coach_email = owner_email
        source_row = enrolment_row() if row is None else row
        maps = ({}, {LEARNER_PROFILE_ID: source_row}) if source_row else ({}, {})
        with patch.object(coach_views.LearnerProfile, 'objects') as manager, \
                patch.object(coach_views, 'fetch_source_schedule_rows', return_value=maps), \
                patch.object(coach_views, 'build_progress_snapshot', return_value=snapshot) as builder:
            manager.filter.return_value.first.return_value = profile
            response = unwrap(coach_views.coach_review_instance_progress)(request, instance_id)
        return response, builder

    def _stored(self, instance_id):
        return review_instances.review_instance_progress_snapshot(
            review_instances.get_review_instance(instance_id))

    # --------------------------------------------------------- permissions

    def test_another_coach_cannot_calculate_someone_elses_review(self):
        instance = self._instance()
        response, builder = self._calculate(instance['id'], owner_email=OTHER_COACH_EMAIL)
        self.assertEqual(response.status_code, 404)
        builder.assert_not_called()
        self.assertIsNone(self._stored(instance['id']))

    def test_only_post_is_accepted(self):
        instance = self._instance()
        request = RequestFactory().get(f'/coach_api/coach/reviews/{instance["id"]}/progress')
        request.coach_email = COACH_EMAIL
        self.assertEqual(unwrap(coach_views.coach_review_instance_progress)(request, instance['id']).status_code, 405)

    def test_an_unknown_instance_is_not_calculable(self):
        response, builder = self._calculate('REVI-DOES-NOT-EXIST')
        self.assertEqual(response.status_code, 404)
        builder.assert_not_called()

    # ---------------------------------------------------- the type it is for

    def test_another_review_type_has_no_progress_calculation(self):
        instance = self._instance(type_code=review_types.REVIEW_TYPE_CODE_MCM)
        response, builder = self._calculate(instance['id'])
        self.assertEqual(response.status_code, 404)
        self.assertIn('only available on a Progress Review', json.loads(response.content)['detail'])
        builder.assert_not_called()
        self.assertIsNone(self._stored(instance['id']))

    # ------------------------------------------------------ the date it uses

    def test_it_calculates_from_the_learners_own_start_date_not_the_cohorts(self):
        instance = self._instance()
        response, builder = self._calculate(instance['id'])
        self.assertEqual(response.status_code, 200)
        passed = builder.call_args.kwargs
        self.assertEqual(passed['learner_start_date'], LEARNER_START)
        self.assertNotEqual(passed['learner_start_date'], COHORT_START)

    def test_the_calculation_time_is_the_servers_own_clock(self):
        instance = self._instance()
        before = datetime.utcnow()
        _response, builder = self._calculate(instance['id'])
        after = datetime.utcnow()
        calculated_at = builder.call_args.kwargs['calculated_at']
        self.assertTrue(before <= calculated_at <= after)
        self.assertEqual(builder.call_args.kwargs['calculated_by'], COACH_EMAIL)

    def test_a_learner_with_no_start_date_of_their_own_is_refused_not_defaulted(self):
        instance = self._instance()
        response, builder = self._calculate(
            instance['id'], row=enrolment_row(learner_start_date=None))
        self.assertEqual(response.status_code, 409)
        self.assertIn('no individual programme start date', json.loads(response.content)['detail'])
        builder.assert_not_called()
        # Never quietly anchored to the cohort date the same row carries.
        self.assertIsNone(self._stored(instance['id']))

    # ------------------------------------------------- persistence + freeze

    def test_a_successful_calculation_is_stored_and_returned(self):
        instance = self._instance()
        response, _builder = self._calculate(instance['id'])
        self.assertEqual(response.status_code, 200)
        returned = json.loads(response.content)['progressSnapshot']
        self.assertEqual(returned['calculatedFrom'], LEARNER_START.isoformat())
        self.assertEqual(returned['offTheJobHours']['actualPercent'], 64.0)
        self.assertEqual(self._stored(instance['id'])['calculatedAt'], '2026-09-16T14:35:02')

    def test_recalculating_before_signing_replaces_the_stored_snapshot(self):
        instance = self._instance()
        self._calculate(instance['id'])
        self._calculate(instance['id'], snapshot={**CANNED_SNAPSHOT, 'calculatedAt': '2026-10-02T08:00:00'})
        self.assertEqual(self._stored(instance['id'])['calculatedAt'], '2026-10-02T08:00:00')

    def test_it_is_refused_once_the_review_reaches_the_signature_step(self):
        for status in (review_instances.STATUS_AWAITING_SIGNATURE, review_instances.STATUS_COMPLETED):
            with self.subTest(status=status):
                instance = self._instance(occurrence_number=10 + len(status))
                self._calculate(instance['id'])
                review_instances.set_review_instance_status(instance['id'], status, actor='test')

                response, _builder = self._calculate(
                    instance['id'], snapshot={**CANNED_SNAPSHOT, 'calculatedAt': '2027-01-01T00:00:00'})
                self.assertEqual(response.status_code, 409)
                # The figures that were signed are the ones still stored.
                self.assertEqual(self._stored(instance['id'])['calculatedAt'], '2026-09-16T14:35:02')
