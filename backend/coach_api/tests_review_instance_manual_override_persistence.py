"""Phase 5: manual scheduled -> in-progress overrides are persisted, and
ONLY manual overrides -- never a normal Teams-attendance transition, and
never a completion/signature.

    python manage.py test coach_api.tests_review_instance_manual_override_persistence

curriculum.review_instance_manual_overrides is append-only and exists
exclusively for the manual fallback (see
curriculum_api.review_instances.mark_review_instance_in_progress_manually /
record_review_instance_manual_override). Authorization/reason/status-guard
behaviour is already covered by tests_review_instance_manual_override.py;
this file is specifically about what does and does not end up as a row in
that table.
"""
import json
from datetime import date, time
from inspect import unwrap

from django.db import connection
from django.test import RequestFactory, TestCase

from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views

from . import views as coach_views
from .models import CoachCalendarEvent

COACH_EMAIL = 'coach@example.com'
OTHER_COACH_EMAIL = 'other-coach@example.com'


class ManualOverridePersistenceTestCase(TestCase):
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
            review_instances.REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE,
            review_instances.REVIEW_INSTANCE_SIGNATURES_TABLE,
            review_instances.REVIEW_INSTANCE_ANSWERS_TABLE,
            review_instances.REVIEW_INSTANCES_TABLE,
            reviews.REVIEW_FIELDS_TABLE, reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE, review_types.REVIEW_TYPES_TABLE, 'programmes',
        ):
            with connection.cursor() as cursor:
                if curriculum_views.table_exists(table):
                    cursor.execute(f'delete from {curriculum_views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _programme(self):
        curriculum_views.insert_row('programmes', {
            'id': 'PROG-PERSIST', 'programme_id': 'PROG-PERSIST', 'program_id': 'PROG-PERSIST',
            'name': 'Persistence Programme', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _template(self, *, type_code='mcm'):
        type_id = review_types.get_review_type_by_code(type_code)['id']
        review_id, errors = reviews.create_review('PROG-PERSIST', {
            'name': 'Monthly Coaching Meeting' if type_code == 'mcm' else 'Progress Review',
            'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _scheduled_linked_row(self, *, learner_id=1001, event_type='mcr', type_code='mcm', status=None, owner_email=COACH_EMAIL):
        review_id = self._template(type_code=type_code)
        record = CoachCalendarEvent.objects.create(
            event_key=f'{event_type}:{learner_id}:1:2026-10-01', event_type=event_type,
            owner_email=owner_email, owner_name='Coach',
            learner_id=learner_id, learner_name='Learner', learner_email='learner@example.com',
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=status or CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/persist-test',
            review_template_id=review_id,
        )
        base_event = {'eventKey': record.event_key, 'source': event_type, 'targetDate': '2026-10-01', 'learnerId': learner_id}
        coach_views.ensure_review_instance_for_calendar_record(record, base_event)
        record.refresh_from_db()
        return record

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    def _override_rows(self, instance_id):
        return review_instances.list_review_instance_manual_overrides(instance_id)

    def _call(self, instance_id, *, body=None, coach_email=COACH_EMAIL):
        request = RequestFactory().post(
            f'/coach_api/coach/reviews/{instance_id}/mark-in-progress',
            data=json.dumps(body or {}), content_type='application/json',
        )
        request.coach_email = coach_email
        request.coach_view_as = False
        request.coach_view_as_admin = None
        return unwrap(coach_views.coach_review_instance_mark_in_progress_manually)(request, instance_id)

    # -- 1/2: exactly one row for a valid MCM/PR override ------------------------

    def test_valid_mcm_override_creates_exactly_one_row(self):
        record = self._scheduled_linked_row(event_type='mcr', type_code='mcm')
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 200, response.content)
        rows = self._override_rows(record.review_instance_id)
        self.assertEqual(len(rows), 1)

    def test_valid_pr_override_creates_exactly_one_row(self):
        record = self._scheduled_linked_row(learner_id=1002, event_type='progress-review', type_code='progress_review')
        response = self._call(record.review_instance_id, body={'reasonCode': 'graph-unavailable'})
        self.assertEqual(response.status_code, 200, response.content)
        rows = self._override_rows(record.review_instance_id)
        self.assertEqual(len(rows), 1)

    # -- 3-10: stored field values ------------------------------------------------

    def test_stored_row_field_values(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={
            'reasonCode': 'other', 'note': 'Meeting happened over Zoom.',
        })
        self.assertEqual(response.status_code, 200, response.content)
        rows = self._override_rows(record.review_instance_id)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['review_instance_id'], record.review_instance_id)
        self.assertEqual(row['calendar_event_id'], record.pk)
        self.assertEqual(row['previous_status'], review_instances.STATUS_SCHEDULED)
        self.assertEqual(row['new_status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(row['reason_code'], 'other')
        self.assertEqual(row['note'], 'Meeting happened over Zoom.')
        self.assertEqual(row['changed_by'], COACH_EMAIL)
        self.assertIsNotNone(row['changed_at'])

    # -- 11/12: manual_started_at ------------------------------------------------

    def test_manual_started_at_uses_supplied_actual_start_time(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={
            'reasonCode': 'attendance-not-detected', 'startedAt': '2026-10-01T10:03:00Z',
        })
        self.assertEqual(response.status_code, 200, response.content)
        row = self._override_rows(record.review_instance_id)[0]
        self.assertEqual(row['manual_started_at'].isoformat(), '2026-10-01T10:03:00')

    def test_manual_started_at_uses_effective_started_at_when_none_supplied(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 200, response.content)
        instance = self._instance(record)
        row = self._override_rows(record.review_instance_id)[0]
        self.assertEqual(row['manual_started_at'], instance['started_at'])

    # -- 13/14: invalid reason / other-without-note creates no row --------------

    def test_invalid_reason_creates_no_row(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': 'not-a-real-reason'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    def test_other_without_note_creates_no_row(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': 'other'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 15: unrelated coach creates no row ---------------------------------------

    def test_unrelated_coach_creates_no_row(self):
        record = self._scheduled_linked_row(owner_email=COACH_EMAIL)
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'}, coach_email=OTHER_COACH_EMAIL)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 16: repeated override creates no second row ------------------------------

    def test_repeated_override_creates_no_second_row(self):
        record = self._scheduled_linked_row()
        first = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(first.status_code, 200, first.content)
        second = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(second.status_code, 400)
        self.assertEqual(len(self._override_rows(record.review_instance_id)), 1)

    # -- 17/18: awaiting-signature / completed create no row ----------------------

    def test_awaiting_signature_creates_no_row(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        review_instances.force_review_instance_status_for_tests(instance['id'], review_instances.STATUS_AWAITING_SIGNATURE, actor='test')
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    def test_completed_creates_no_row(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        review_instances.force_review_instance_status_for_tests(
            instance['id'], review_instances.STATUS_COMPLETED, actor='test',
            extra={'completed_at': curriculum_views.datetime.utcnow()},
        )
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 19: failed atomic status transition creates no row -----------------------

    def test_failed_compare_and_swap_creates_no_row(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        # A stale in-memory instance_row (still says 'scheduled') racing
        # against a status that has already moved on underneath it.
        review_instances.force_review_instance_status_for_tests(instance['id'], review_instances.STATUS_AWAITING_SIGNATURE, actor='test')
        ok, result = review_instances.mark_review_instance_in_progress_manually(
            instance, reason_code='attendance-not-detected', actor=COACH_EMAIL,
        )
        self.assertFalse(ok)
        self.assertIn('status', result)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 20: delayed Teams attendance after manual override creates no new row ----

    def test_delayed_teams_attendance_after_manual_override_creates_no_new_row(self):
        record = self._scheduled_linked_row()
        self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(len(self._override_rows(record.review_instance_id)), 1)

        late_attendance = [{
            'email': COACH_EMAIL, 'displayName': 'Coach',
            'intervals': [{'joinDateTime': '2026-10-01T10:20:00Z', 'leaveDateTime': '2026-10-01T10:30:00Z'}],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, late_attendance)
        self.assertFalse(changed)
        self.assertEqual(len(self._override_rows(record.review_instance_id)), 1)

    # -- 21: normal Teams attendance never creates a manual override row ----------

    def test_normal_teams_attendance_transition_creates_no_manual_override_row(self):
        record = self._scheduled_linked_row(learner_id=1003)
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach',
            'intervals': [{'joinDateTime': '2026-10-01T10:01:00Z', 'leaveDateTime': '2026-10-01T10:30:00Z'}],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 22: normal completion/signature create no manual override rows -----------

    def test_normal_completion_and_signature_create_no_manual_override_rows(self):
        record = self._scheduled_linked_row(learner_id=1004)
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach',
            'intervals': [{'joinDateTime': '2026-10-01T10:01:00Z', 'leaveDateTime': '2026-10-01T10:30:00Z'}],
        }]
        coach_views.apply_teams_attendance_status_transition(record, records)
        instance = self._instance(record)
        definition = review_instances.review_instance_form_definition(instance)
        field_id = definition['sections'][0]['fields'][0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'All good.'}, actor=COACH_EMAIL)
        instance = self._instance(record)

        ok, errors = review_instances.complete_review_instance(instance, actor=COACH_EMAIL)
        self.assertTrue(ok, errors)
        instance = self._instance(record)
        self.assertEqual(instance['status'], review_instances.STATUS_AWAITING_SIGNATURE)

        review_instances.record_review_instance_signature(
            instance, 'advisor', signed_by=COACH_EMAIL, signed_name='Coach',
            signature='data:image/png;base64,abc', actor=COACH_EMAIL,
        )
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)
        self.assertEqual(self._override_rows(record.review_instance_id), [])

    # -- 23: historical unlinked review creates no row through this new flow -----

    def test_historical_unlinked_review_creates_no_manual_override_row(self):
        CoachCalendarEvent.objects.create(
            event_key='mcr:1005:1:2025-01-01', event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach',
            learner_id=1005, learner_name='Old Learner', learner_email='old@example.com',
            scheduled_date=date(2025, 1, 1), scheduled_time=time(10, 0),
            target_date=date(2025, 1, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/old',
        )
        review_instances.ensure_review_instance_manual_overrides_table()
        rows = curriculum_views.fetch_all(
            f'select * from {curriculum_views.table_name(review_instances.REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)}',
            [],
        )
        self.assertEqual(rows, [])
