"""Phase 4: authorised manual scheduled -> in-progress fallback.

    python manage.py test coach_api.tests_review_instance_manual_override

Exception path only: real Microsoft Teams attendance
(apply_teams_attendance_status_transition, Phase 2/3) remains the normal
scheduled -> in-progress trigger. This covers the fallback used when that
signal cannot be detected -- authorization (assigned coach / super-admin
view-as), reason validation, the monotonic status guard, started_at rules,
the interim audit log, and coexistence with later real attendance.

Role-rejection for a learner/employer session is not re-tested here: this
endpoint is protected by the same, already-tested @coach_access_required
decorator as every other coach route (see coach_api.tests_security's
test_every_coach_route_rejects_a_learner_session) -- a non-staff session
never reaches the view body at all. This file covers what is specific to
this endpoint: ownership *within* an authenticated coach session, and the
domain function's own rules.
"""
import json
import logging
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
ADMIN_EMAIL = 'admin@example.com'


class ManualOverrideTestCase(TestCase):
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
            'id': 'PROG-MANUAL', 'programme_id': 'PROG-MANUAL', 'program_id': 'PROG-MANUAL',
            'name': 'Manual Override Programme', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _template(self, *, type_code='mcm'):
        type_id = review_types.get_review_type_by_code(type_code)['id']
        review_id, errors = reviews.create_review('PROG-MANUAL', {
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

    def _scheduled_linked_row(self, *, learner_id=901, event_type='mcr', type_code='mcm', status=None, owner_email=COACH_EMAIL):
        review_id = self._template(type_code=type_code)
        record = CoachCalendarEvent.objects.create(
            event_key=f'{event_type}:{learner_id}:1:2026-10-01', event_type=event_type,
            owner_email=owner_email, owner_name='Coach',
            learner_id=learner_id, learner_name='Learner', learner_email='learner@example.com',
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=status or CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/manual-test',
            review_template_id=review_id,
        )
        base_event = {'eventKey': record.event_key, 'source': event_type, 'targetDate': '2026-10-01', 'learnerId': learner_id}
        coach_views.ensure_review_instance_for_calendar_record(record, base_event)
        record.refresh_from_db()
        return record

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    def _call(self, instance_id, *, body=None, coach_email=COACH_EMAIL, view_as=False, admin=None):
        request = RequestFactory().post(
            f'/coach_api/coach/reviews/{instance_id}/mark-in-progress',
            data=json.dumps(body or {}), content_type='application/json',
        )
        request.coach_email = coach_email
        request.coach_view_as = view_as
        request.coach_view_as_admin = admin
        return unwrap(coach_views.coach_review_instance_mark_in_progress_manually)(request, instance_id)

    # -- 1/22: assigned coach, MCM and PR both use the same domain function ----

    def test_assigned_coach_manually_marks_scheduled_mcm_in_progress(self):
        record = self._scheduled_linked_row(event_type='mcr', type_code='mcm')
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_assigned_coach_manually_marks_scheduled_pr_in_progress(self):
        record = self._scheduled_linked_row(learner_id=902, event_type='progress-review', type_code='progress_review')
        response = self._call(record.review_instance_id, body={'reasonCode': 'graph-unavailable'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    # -- 3: unrelated coach rejected --------------------------------------------

    def test_unrelated_coach_is_rejected(self):
        record = self._scheduled_linked_row(owner_email=COACH_EMAIL)
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'}, coach_email=OTHER_COACH_EMAIL)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    # -- 6/7/8: invalid source status --------------------------------------------

    def test_not_scheduled_is_rejected(self):
        review_id = self._template()
        template = reviews.get_review_template_row(review_id)
        instance = review_instances.ensure_review_instance(
            template, learner_id=1, learner_kind='', programme_id='PROG-MANUAL',
            occurrence_number=1, target_date=date(2026, 10, 1), coach_email=COACH_EMAIL,
        )
        response = self._call(instance['id'], body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('status', json.loads(response.content)['errors'])
        self.assertEqual(review_instances.get_review_instance(instance['id'])['status'], review_instances.STATUS_NOT_SCHEDULED)

    def test_awaiting_signature_is_rejected(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        review_instances.set_review_instance_status(instance['id'], review_instances.STATUS_AWAITING_SIGNATURE, actor='test')
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_completed_is_rejected(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        review_instances.set_review_instance_status(
            instance['id'], review_instances.STATUS_COMPLETED, actor='test',
            extra={'completed_at': curriculum_views.datetime.utcnow()},
        )
        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    def test_already_in_progress_manual_rewrite_is_rejected(self):
        record = self._scheduled_linked_row()
        self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)
        started_at_first = self._instance(record)['started_at']

        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(self._instance(record)['started_at'], started_at_first)

    # -- 9/10/11: reason validation ----------------------------------------------

    def test_empty_reason_is_rejected(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': ''})
        self.assertEqual(response.status_code, 400)
        self.assertIn('reason', json.loads(response.content)['errors'])
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_other_without_note_is_rejected(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': 'other'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('note', json.loads(response.content)['errors'])
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_valid_reason_is_accepted(self):
        record = self._scheduled_linked_row()
        response = self._call(record.review_instance_id, body={'reasonCode': 'other', 'note': 'Meeting happened over Zoom instead.'})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    # -- 12/13: started_at rule ---------------------------------------------------

    def test_started_at_defaults_to_now_when_not_specified(self):
        record = self._scheduled_linked_row()
        before = curriculum_views.datetime.utcnow()
        self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        after = curriculum_views.datetime.utcnow()
        started_at = self._instance(record)['started_at']
        self.assertTrue(before <= started_at <= after)

    def test_started_at_uses_coach_specified_time(self):
        record = self._scheduled_linked_row()
        self._call(record.review_instance_id, body={
            'reasonCode': 'attendance-not-detected', 'startedAt': '2026-10-01T10:03:00Z',
        })
        started_at = self._instance(record)['started_at']
        self.assertEqual(started_at.isoformat(), '2026-10-01T10:03:00')

    def test_started_at_not_overwritten_if_already_present(self):
        # Not reachable through the normal scheduled-only path, but the
        # function's own rule (never overwrite an existing started_at) is
        # pinned directly against the domain function.
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        curriculum_views.update_rows(
            review_instances.REVIEW_INSTANCES_TABLE, 'id = %s', [instance['id']],
            {'started_at': curriculum_views.datetime(2026, 1, 1, 9, 0, 0)},
        )
        instance = review_instances.get_review_instance(instance['id'])
        ok, row = review_instances.mark_review_instance_in_progress_manually(
            instance, reason_code='attendance-not-detected', actor=COACH_EMAIL,
        )
        self.assertTrue(ok, row)
        self.assertEqual(row['started_at'], curriculum_views.datetime(2026, 1, 1, 9, 0, 0))

    # -- 14/15/16/17/18: mirroring + untouched fields ----------------------------

    def test_calendar_status_mirrors_and_other_fields_untouched(self):
        record = self._scheduled_linked_row()
        original_target_date = record.target_date
        original_scheduled_date = record.scheduled_date
        original_scheduled_time = record.scheduled_time
        original_meeting_link = record.meeting_link

        response = self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        self.assertEqual(response.status_code, 200, response.content)
        record.refresh_from_db()

        self.assertEqual(record.status, CoachCalendarEvent.STATUS_IN_PROGRESS)
        self.assertEqual(record.target_date, original_target_date)
        self.assertEqual(record.scheduled_date, original_scheduled_date)
        self.assertEqual(record.scheduled_time, original_scheduled_time)
        self.assertEqual(record.meeting_link, original_meeting_link)
        self.assertEqual(record.review_responses, {})

    # -- 20: late Teams attendance after manual override -------------------------

    def test_late_teams_attendance_after_manual_override_does_not_regress_or_duplicate(self):
        record = self._scheduled_linked_row()
        self._call(record.review_instance_id, body={'reasonCode': 'attendance-not-detected'})
        manual_instance = self._instance(record)
        self.assertEqual(manual_instance['status'], review_instances.STATUS_IN_PROGRESS)
        manual_started_at = manual_instance['started_at']

        late_attendance = [{
            'email': 'coach@example.com', 'displayName': 'Coach',
            'intervals': [{'joinDateTime': '2026-10-01T10:20:00Z', 'leaveDateTime': '2026-10-01T10:30:00Z'}],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, late_attendance)
        self.assertFalse(changed)  # already in-progress -- no second transition
        instance_after = self._instance(record)
        self.assertEqual(instance_after['status'], review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(instance_after['started_at'], manual_started_at)  # not silently replaced

    # -- 21: unlinked historical row unaffected -----------------------------------

    def test_unlinked_historical_row_is_never_auto_linked_or_created(self):
        CoachCalendarEvent.objects.create(
            event_key='mcr:903:1:2025-01-01', event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach',
            learner_id=903, learner_name='Old Learner', learner_email='old@example.com',
            scheduled_date=date(2025, 1, 1), scheduled_time=time(10, 0),
            target_date=date(2025, 1, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/old',
        )
        rows = curriculum_views.fetch_all(
            f"select id from {curriculum_views.table_name(review_instances.REVIEW_INSTANCES_TABLE)} where learner_id = %s",
            [903],
        )
        self.assertEqual(rows, [])

    # -- 23: audit log persisted --------------------------------------------------

    def test_audit_log_line_is_emitted(self):
        record = self._scheduled_linked_row()
        with self.assertLogs('curriculum_api.review_instance_manual_override', level='INFO') as captured:
            self._call(record.review_instance_id, body={'reasonCode': 'scheduler-delay', 'note': 'cron did not run'})
        self.assertEqual(len(captured.records), 1)
        log_record = captured.records[0]
        self.assertEqual(log_record.review_instance_id, record.review_instance_id)
        self.assertEqual(log_record.calendar_event_id, record.pk)
        self.assertEqual(log_record.previous_status, review_instances.STATUS_SCHEDULED)
        self.assertEqual(log_record.new_status, review_instances.STATUS_IN_PROGRESS)
        self.assertEqual(log_record.source, 'manual')
        self.assertEqual(log_record.reason_code, 'scheduler-delay')
        self.assertEqual(log_record.note, 'cron did not run')
        self.assertEqual(log_record.changed_by, COACH_EMAIL)

    # -- 24/25: super-admin view-as ----------------------------------------------

    def test_super_admin_view_as_can_manually_mark_in_progress(self):
        record = self._scheduled_linked_row(owner_email=COACH_EMAIL)
        admin = type('Admin', (), {'username': 'Demo Admin', 'email': ADMIN_EMAIL})()
        response = self._call(
            record.review_instance_id, body={'reasonCode': 'attendance-not-detected'},
            coach_email=COACH_EMAIL, view_as=True, admin=admin,
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)
        # Attributed to the real actor (the admin), not silently as the coach.
        self.assertIn('Demo Admin', self._instance(record)['updated_by'])
        self.assertIn(COACH_EMAIL, self._instance(record)['updated_by'])

    def test_super_admin_view_as_still_bound_to_the_named_coachs_own_instance(self):
        # coach_email under view-as is the IMPERSONATED coach's own email
        # (installed by coach_access_required) -- so ownership still applies:
        # naming a different coach's review through this same mechanism is
        # exactly the "unrelated coach" case, not a bypass.
        record = self._scheduled_linked_row(owner_email=OTHER_COACH_EMAIL)
        admin = type('Admin', (), {'username': 'Demo Admin', 'email': ADMIN_EMAIL})()
        response = self._call(
            record.review_instance_id, body={'reasonCode': 'attendance-not-detected'},
            coach_email=COACH_EMAIL, view_as=True, admin=admin,
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)
