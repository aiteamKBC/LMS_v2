"""Phase 3: the canonical MCM/Progress Review lifecycle is enforced end to end.

    python manage.py test coach_api.tests_review_instance_lifecycle_state_machine

Editable forms can be submitted without booking or attendance. Required
signatures still gate completion, and real Teams attendance alone advances
a scheduled meeting to in-progress.

Monotonic: no test here should ever observe a backward transition. Unlike
tests_teams_attendance_in_progress.py (which is about the attendance signal
itself), this file is about the surrounding state machine: what
complete_review_instance/record_review_instance_signature allow or refuse
from each status, and that a coach/learner can only ever act on their own
review instance.
"""
from datetime import date, time

from django.db import connection
from django.test import RequestFactory

from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views

from . import views as coach_views
from .models import CoachCalendarEvent
from .tests_support.transaction_cases import CoachTransactionTestCase

COACH_EMAIL = 'coach@example.com'
OTHER_COACH_EMAIL = 'other-coach@example.com'
LEARNER_EMAIL = 'learner@example.com'
NATIVE_LEARNER_ID = 900601


def _interval(join_iso, leave_iso):
    return {'joinDateTime': join_iso, 'leaveDateTime': leave_iso}


class ReviewLifecycleStateMachineTestCase(CoachTransactionTestCase):
    databases = {'default', 'enrolment'}

    def setUp(self):
        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        self._ensure_programmes_table()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_instances.provision_review_instance_tables()
        self._clear()
        CoachCalendarEvent.objects.filter(owner_email=COACH_EMAIL, event_key__in=[
            f'{kind}:{learner_id}:1:2026-10-01'
            for kind in ('mcr', 'progress-review') for learner_id in (NATIVE_LEARNER_ID, 900602, 900603)
        ]).delete()
        self._programme()
        # Real source guards read through the enrolment alias; committed parents
        # let these tests exercise that guard rather than bypass it with a mock.
        from learner_api.models import LearnerProfile
        from .tests_support.persisted_fixtures import fixed_identity
        LearnerProfile.objects.using('default').filter(pk__in=(900001, NATIVE_LEARNER_ID, 900602, 900603)).delete()
        for learner_id in (900001, NATIVE_LEARNER_ID, 900602, 900603):
            fixed_identity(LearnerProfile, id=learner_id, full_name='Synthetic learner',
                email=f'learner-{learner_id}@example.invalid', learner_type='commercial',
                coach_email=COACH_EMAIL, programme_id='PROG-SM',
                programme_status='Active', lifecycle_status='active', aptem_id=None, enrolment_id=None)

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
        # Supply the current schema's required columns as well as lightweight fixtures.
        from .tests_support.persisted_fixtures import programme
        programme('PROG-SM')
        curriculum_views.invalidate_curriculum_cache()

    def _template(self, *, type_code='mcm', signatures=None):
        signatures = signatures if signatures is not None else {
            'advisor': True, 'employer': False, 'participant': False, 'referrer': False,
        }
        type_id = review_types.get_review_type_by_code(type_code)['id']
        review_id, errors = reviews.create_review('PROG-SM', {
            'name': 'Monthly Coaching Meeting' if type_code == 'mcm' else 'Progress Review',
            'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [], 'signatures': signatures,
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _scheduled_linked_row(self, *, learner_id=NATIVE_LEARNER_ID, event_type='mcr', type_code='mcm', signatures=None, owner_email=COACH_EMAIL):
        review_id = self._template(type_code=type_code, signatures=signatures)
        record = CoachCalendarEvent.objects.create(
            event_key=f'{event_type}:{learner_id}:1:2026-10-01', event_type=event_type,
            owner_email=owner_email, owner_name='Coach',
            learner_id=learner_id, learner_name='Learner', learner_email=LEARNER_EMAIL,
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/sm-test',
            review_template_id=review_id,
        )
        base_event = {'eventKey': record.event_key, 'source': event_type, 'targetDate': '2026-10-01', 'learnerId': learner_id}
        coach_views.ensure_review_instance_for_calendar_record(record, base_event)
        record.refresh_from_db()
        return record

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    def _answer_required_field(self, record, *, actor):
        instance = self._instance(record)
        definition = review_instances.review_instance_form_definition(instance)
        field_id = definition['sections'][0]['fields'][0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'All good.'}, actor=actor)

    def _confirm_attendance(self, record, *, email='coach@example.com', display_name='Coach'):
        records = [{'email': email, 'displayName': display_name,
                    'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')]}]
        return coach_views.apply_teams_attendance_status_transition(record, records)

    def _complete_via_view(self, instance_id, *, owner_email=COACH_EMAIL):
        request = RequestFactory().post(
            f'/coach_api/coach/reviews/{instance_id}/complete',
            data='{}', content_type='application/json',
        )
        request.coach_email = owner_email
        from inspect import unwrap
        return unwrap(coach_views.coach_review_instance_complete)(request, instance_id)

    def _sign_via_view(self, instance_id, role, *, owner_email=COACH_EMAIL, signed_name='Signer'):
        import json
        from inspect import unwrap
        request = RequestFactory().post(
            f'/coach_api/coach/reviews/{instance_id}/signatures',
            data=json.dumps({'role': role, 'signedName': signed_name, 'signature': 'data:image/png;base64,abc'}),
            content_type='application/json',
        )
        request.coach_email = owner_email
        return unwrap(coach_views.coach_review_instance_signature)(request, instance_id)

    # -- 1/2: submission validates answers independently of booking ------------

    def test_unscheduled_form_requires_answers_and_signatures_without_creating_a_booking(self):
        review_id = self._template()
        template = reviews.get_review_template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=900001, learner_kind='', programme_id='PROG-SM',
            occurrence_number=1, target_date=date(2026, 10, 1), coach_email=COACH_EMAIL,
        )
        self.assertEqual(instance['status'], review_instances.STATUS_NOT_SCHEDULED)
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertFalse(ok)
        self.assertIn('fields', errors)
        self.assertEqual(review_instances.get_review_instance(instance['id'])['status'], review_instances.STATUS_NOT_SCHEDULED)
        field_id = review_instances.review_instance_form_definition(instance)['sections'][0]['fields'][0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'Reviewed without a meeting.'}, actor=COACH_EMAIL)
        self.assertEqual(self._complete_via_view(instance['id'], owner_email=OTHER_COACH_EMAIL).status_code, 404)
        response = self._complete_via_view(instance['id'])
        self.assertEqual(response.status_code, 200, response.content)
        submitted = review_instances.get_review_instance(instance['id'])
        self.assertEqual(submitted['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        self.assertIsNone(submitted['calendar_event_id'])
        self.assertIsNone(submitted['started_at'])
        self.assertIsNone(submitted['completed_at'])
        self.assertFalse(CoachCalendarEvent.objects.exists())
        self.assertEqual(self._sign_via_view(instance['id'], 'advisor').status_code, 200)
        self.assertEqual(review_instances.get_review_instance(instance['id'])['status'], review_instances.STATUS_COMPLETED)
        self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_scheduled_submission_requires_answers_and_mirrors_calendar(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        self.assertEqual(instance['status'], review_instances.STATUS_SCHEDULED)
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertFalse(ok)
        self.assertIn('fields', errors)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)
        self._answer_required_field(record, actor=COACH_EMAIL)
        response = self._complete_via_view(record.review_instance_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)
        self.assertIsNone(self._instance(record)['started_at'])

    def test_unscheduled_native_families_keep_configured_otjh_eligibility(self):
        from curriculum_api.review_otjh import completed_hours
        expected = 0
        for type_code in ('mcm', 'progress_review'):
            for eligible in (False, True):
                with self.subTest(type_code=type_code, eligible=eligible):
                    template_id = self._template(type_code=type_code, signatures={
                        'advisor': False, 'employer': False, 'participant': False, 'referrer': False})
                    curriculum_views.update_rows(reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [template_id], {
                        'expected_otjh': 1.25, 'counts_towards_otjh': eligible})
                    template = reviews.get_review_template_row(template_id)
                    instance = review_instances.ensure_review_instance(
                        template, learner_id=900001, learner_kind='', programme_id='PROG-SM',
                        occurrence_number=1, target_date=date(2026, 10, 1), coach_email=COACH_EMAIL)
                    field_id = review_instances.review_instance_form_definition(instance)['sections'][0]['fields'][0]['id']
                    review_instances.save_review_instance_answers(instance, {field_id: 'Completed review'}, actor=COACH_EMAIL)
                    response = self._complete_via_view(instance['id'])
                    self.assertEqual(response.status_code, 200, response.content)
                    completed = review_instances.get_review_instance(instance['id'])
                    self.assertEqual(completed['status'], 'completed')
                    self.assertIsNone(completed['started_at'])
                    self.assertIsNone(completed['calendar_event_id'])
                    expected += 1.25 if eligible else 0
                    self.assertEqual(completed_hours(900001), expected)
        self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_scheduled_progress_review_without_required_signatures_completes_without_attendance(self):
        record = self._scheduled_linked_row(type_code='progress_review', event_type='progress-review',
            signatures={'advisor': False, 'employer': False, 'participant': False, 'referrer': False})
        self._answer_required_field(record, actor=COACH_EMAIL)
        ok, errors = review_instances.complete_review_instance(self._instance(record), actor=COACH_EMAIL)
        self.assertTrue(ok, errors)
        self.assertIsNone(errors)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)
        self.assertIsNone(self._instance(record)['started_at'])
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertEqual(record.scheduled_date, date(2026, 10, 1))

    def test_submission_refuses_cross_learner_coach_or_review_calendar_links(self):
        record = self._scheduled_linked_row()
        self._answer_required_field(record, actor=COACH_EMAIL)
        instance = self._instance(record)
        for field, value in [('learner_id', 900602), ('owner_email', OTHER_COACH_EMAIL),
                             ('review_instance_id', 'unrelated-review')]:
            with self.subTest(field=field):
                original = getattr(record, field)
                setattr(record, field, value)
                record.save(update_fields=[field])
                ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
                self.assertFalse(ok)
                self.assertIn('status', errors)
                self.assertEqual(review_instances.get_review_instance(instance['id'])['status'], 'scheduled')
                record.refresh_from_db()
                self.assertEqual(record.status, 'scheduled')
                setattr(record, field, original)
                record.save(update_fields=[field])

    def test_unbooked_mcm_validates_answers_then_freezes_for_signatures(self):
        template = reviews.get_review_template_row(self._template())
        instance = review_instances.ensure_review_instance(
            template, learner_id=900001, learner_kind='', programme_id='PROG-SM',
            occurrence_number=1, target_date=date(2026, 10, 1), coach_email=COACH_EMAIL,
        )
        definition = review_instances.review_instance_form_definition(instance)
        field_id = definition['sections'][0]['fields'][0]['id']
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertFalse(ok)
        self.assertIn('fields', errors)
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL,
            answers={field_id: 'Completed coaching discussion'})
        self.assertTrue(ok, errors)
        saved = review_instances.get_review_instance(instance['id'])
        self.assertEqual(saved['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        self.assertIsNone(saved['started_at'])
        self.assertFalse(saved.get('calendar_event_id'))
        saved_definition = review_instances.review_instance_form_definition(saved)
        self.assertEqual(saved_definition['sections'][0]['fields'][0]['answer'], 'Completed coaching discussion')

    # -- 3/4: drafting is never blocked, and never changes status -------------

    def test_scheduled_open_form_remains_scheduled(self):
        record = self._scheduled_linked_row()
        from inspect import unwrap
        request = RequestFactory().get('/coach_api/coach/reviews/x')
        request.coach_email = COACH_EMAIL
        response = unwrap(coach_views.coach_review_instance_detail)(request, record.review_instance_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_scheduled_save_draft_remains_scheduled(self):
        record = self._scheduled_linked_row()
        self._answer_required_field(record, actor=COACH_EMAIL)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    # -- 5: real attendance is the only way to in-progress ---------------------

    def test_teams_attendance_moves_scheduled_to_in_progress(self):
        record = self._scheduled_linked_row()
        changed = self._confirm_attendance(record)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    # -- 6/7: completion branches on whether a signature is required ----------

    def test_in_progress_complete_with_signature_required_moves_to_awaiting_signature(self):
        record = self._scheduled_linked_row(signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        response = self._complete_via_view(record.review_instance_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_in_progress_complete_with_no_signature_required_moves_straight_to_completed(self):
        record = self._scheduled_linked_row(signatures={'advisor': False, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        response = self._complete_via_view(record.review_instance_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    # -- 8/9: signature roles gate the final transition ------------------------

    def test_awaiting_signature_with_missing_required_role_stays_awaiting_signature(self):
        record = self._scheduled_linked_row(
            signatures={'advisor': True, 'employer': False, 'participant': True, 'referrer': False},
        )
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        self._sign_via_view(record.review_instance_id, 'advisor')
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_final_required_signature_completes_the_review(self):
        record = self._scheduled_linked_row(
            signatures={'advisor': True, 'employer': False, 'participant': True, 'referrer': False},
        )
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self._sign_via_view(record.review_instance_id, 'advisor')
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        instance = self._instance(record)
        review_instances.record_review_instance_signature(
            instance, 'participant', signed_by=LEARNER_EMAIL, signed_name='Learner',
            signature='data:image/png;base64,abc', actor=LEARNER_EMAIL,
        )
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertIsNotNone(record.review_completed_at)

    # -- 18: participant + employer both required ------------------------------

    def test_participant_and_employer_signatures_both_required(self):
        record = self._scheduled_linked_row(
            signatures={'advisor': False, 'employer': True, 'participant': True, 'referrer': False},
        )
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        instance = self._instance(record)
        review_instances.record_review_instance_signature(
            instance, 'participant', signed_by=LEARNER_EMAIL, signed_name='Learner',
            signature='data:image/png;base64,abc', actor=LEARNER_EMAIL,
        )
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)
        self.assertIsNone(record.review_completed_at)

        instance = self._instance(record)
        review_instances.record_review_instance_signature(
            instance, 'employer', signed_by='employer@example.com', signed_name='Employer',
            signature='data:image/png;base64,abc', actor='employer@example.com',
        )
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)
        record.refresh_from_db()
        instance = self._instance(record)
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertIsNotNone(record.review_completed_at)
        self.assertIsNotNone(instance['completed_at'])

    # -- 10/11: completed is a terminal state -----------------------------------

    def test_signing_again_after_completed_is_the_existing_documented_idempotent_behaviour(self):
        """record_review_instance_signature already allows a signature while
        status == completed (not just awaiting-signature) -- documented,
        pre-existing behaviour (see its own docstring) that lets a second
        required signer submit even if a concurrent first signer already
        completed the instance. Phase 3 does not change this; this test
        pins it rather than silently altering it."""
        record = self._scheduled_linked_row(signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self._sign_via_view(record.review_instance_id, 'advisor')
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

        response = self._sign_via_view(record.review_instance_id, 'advisor')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    def test_completing_an_already_completed_review_is_rejected_and_does_not_corrupt_state(self):
        record = self._scheduled_linked_row(signatures={'advisor': False, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        completed_instance = self._instance(record)
        self.assertEqual(completed_instance['status'], review_instances.STATUS_COMPLETED)
        completed_at = completed_instance['completed_at']

        response = self._complete_via_view(record.review_instance_id)
        self.assertEqual(response.status_code, 400)
        instance_after = self._instance(record)
        self.assertEqual(instance_after['status'], review_instances.STATUS_COMPLETED)
        self.assertEqual(instance_after['completed_at'], completed_at)  # not rewritten

    # -- 12/13: attendance polling never regresses a later status --------------

    def test_attendance_polling_after_awaiting_signature_does_not_regress(self):
        record = self._scheduled_linked_row(signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        changed = self._confirm_attendance(record)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_attendance_polling_after_completed_does_not_regress(self):
        record = self._scheduled_linked_row(signatures={'advisor': False, 'employer': False, 'participant': False, 'referrer': False})
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

        changed = self._confirm_attendance(record)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    # -- 14/15: ownership -------------------------------------------------------

    def test_coach_cannot_act_on_another_coachs_review(self):
        record = self._scheduled_linked_row(owner_email=COACH_EMAIL)
        self._confirm_attendance(record)
        response = self._complete_via_view(record.review_instance_id, owner_email=OTHER_COACH_EMAIL)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_learner_cannot_sign_another_learners_review(self):
        import json
        from inspect import unwrap
        from unittest.mock import patch
        from learner_api import calendar as learner_calendar

        record = self._scheduled_linked_row(learner_id=900602)
        self._confirm_attendance(record)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        request = RequestFactory().post(
            f'/calendar/commercial/999/events/{record.event_key}/sign/',
            data=json.dumps({'signature': 'data:image/png;base64,abc', 'name': 'Impostor'}),
            content_type='application/json',
        )
        # _learner_calendar_record (learner_api/calendar.py) is what actually
        # scopes a record to the requesting learner's own pk/email -- it
        # queries the real (Postgres-only, unmanaged) learner tables, which
        # this sqlite test environment cannot provision (see Phase 0's
        # settings_sqlite_test.py notes). Learner pk 999 asking for learner
        # 602's event is exactly the case that lookup returns None for in a
        # real deployment; patching it to that return value tests the
        # endpoint's own handling of "not this learner's record" without
        # depending on real Postgres schema.
        with patch.object(learner_calendar, '_learner_calendar_record', return_value=None):
            response = unwrap(learner_calendar.learner_progress_review_sign)(request, 'commercial', 999, record.event_key)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    # -- 17: MCM and PR share the same rules ------------------------------------

    def test_progress_review_uses_the_same_canonical_lifecycle(self):
        record = self._scheduled_linked_row(
            learner_id=900603, event_type='progress-review', type_code='progress_review',
            signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
        )
        instance = self._instance(record)
        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertFalse(ok)
        # Scheduled PRs already share MCM's field-validation submission path.
        # Refuse the unanswered required field without changing the lifecycle.
        field_id = review_instances.review_instance_form_definition(instance)['sections'][0]['fields'][0]['id']
        self.assertEqual(errors, {'fields': [field_id]})
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

        self._confirm_attendance(record, email=LEARNER_EMAIL, display_name='Learner')
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)
        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        self._sign_via_view(record.review_instance_id, 'advisor')
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    # -- calendar consistency across the whole chain ----------------------------

    def test_calendar_status_mirrors_every_step(self):
        record = self._scheduled_linked_row(signatures={'advisor': True, 'employer': False, 'participant': False, 'referrer': False})
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)

        self._confirm_attendance(record)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_IN_PROGRESS)

        self._answer_required_field(record, actor=COACH_EMAIL)
        self._complete_via_view(record.review_instance_id)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)

        self._sign_via_view(record.review_instance_id, 'advisor')
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
