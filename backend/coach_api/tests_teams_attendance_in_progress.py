"""Phase 2: scheduled -> in-progress only from a real Microsoft Teams join.

    python manage.py test coach_api.tests_teams_attendance_in_progress

Covers apply_teams_attendance_status_transition end to end against real
CoachCalendarEvent + curriculum review_instances rows -- no mocked HTTP, no
mocked Graph client: attendance records are passed in exactly as
fetch_coach_meeting_graph_snapshot would have already returned them (this
function never issues its own Graph call).
"""
import json
from datetime import date, time, timedelta
from inspect import unwrap
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory, TestCase

from curriculum_api import review_instances, review_types, reviews
from curriculum_api import views as curriculum_views

from . import views as coach_views
from .models import CoachCalendarEvent

PROGRAMME_ID = 'PROG-ATTENDANCE'
COACH_EMAIL = 'coach@example.com'
LEARNER_EMAIL = 'learner@example.com'


def _interval(join_iso, leave_iso):
    return {'joinDateTime': join_iso, 'leaveDateTime': leave_iso}


class AttendanceInProgressTestCase(TestCase):
    # coach_meeting_expected_attendees looks up the learner profile (routed to
    # the 'enrolment' alias) for progress-review rows even when learner_email/
    # learner_name are already set on the calendar record.
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
            'id': PROGRAMME_ID, 'programme_id': PROGRAMME_ID, 'program_id': PROGRAMME_ID,
            'name': 'Attendance Programme', 'status': 'active', 'is_active': True, 'is_archived': False,
            'created_at': curriculum_views.datetime.utcnow(), 'updated_at': curriculum_views.datetime.utcnow(),
        })
        curriculum_views.invalidate_curriculum_cache()

    def _template(self, *, type_code='mcm', signatures=True):
        type_id = review_types.get_review_type_by_code(type_code)['id']
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': 'Monthly Coaching Meeting' if type_code == 'mcm' else 'Progress Review',
            'enabled': True, 'reviewTypeId': type_id,
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': signatures, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return review_id

    def _scheduled_linked_row(self, *, learner_id=501, event_type='mcr', type_code='mcm', status=None):
        """A calendar row already through the real scheduling hook
        (ensure_review_instance_for_calendar_record), so its linked
        review_instances row is genuinely at STATUS_SCHEDULED -- exactly the
        starting state this phase's transition requires."""
        review_id = self._template(type_code=type_code)
        record = CoachCalendarEvent.objects.create(
            event_key=f'{event_type}:{learner_id}:1:2026-10-01', event_type=event_type,
            owner_email=COACH_EMAIL, owner_name='Coach One',
            learner_id=learner_id, learner_name='Learner One', learner_email=LEARNER_EMAIL,
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=status or CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/attendance-test',
            review_template_id=review_id,
        )
        base_event = {'eventKey': record.event_key, 'source': event_type, 'targetDate': '2026-10-01', 'learnerId': learner_id}
        coach_views.ensure_review_instance_for_calendar_record(record, base_event)
        record.refresh_from_db()
        return record

    def _instance(self, record):
        return review_instances.get_review_instance(record.review_instance_id)

    # -- prerequisite: scheduling actually reaches review_instances 'scheduled' -----

    def test_scheduling_moves_the_linked_instance_to_scheduled(self):
        record = self._scheduled_linked_row()
        self.assertTrue(record.review_instance_id)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    # -- 1/2/3: who joins ------------------------------------------------------

    def test_coach_joins_first_moves_to_in_progress(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_learner_joins_first_moves_to_in_progress(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': LEARNER_EMAIL, 'displayName': 'Learner One',
            'intervals': [_interval('2026-10-01T10:02:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_both_join_is_a_single_idempotent_transition(self):
        record = self._scheduled_linked_row()
        records = [
            {'email': COACH_EMAIL, 'displayName': 'Coach One',
             'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')]},
            {'email': LEARNER_EMAIL, 'displayName': 'Learner One',
             'intervals': [_interval('2026-10-01T10:02:00Z', '2026-10-01T10:30:00Z')]},
        ]
        first = coach_views.apply_teams_attendance_status_transition(record, records)
        second = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(first)
        self.assertFalse(second)  # already in-progress -- no-op, not a re-transition
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    # -- 4/5/8: nobody joins ----------------------------------------------------

    def test_nobody_joins_stays_scheduled(self):
        record = self._scheduled_linked_row()
        changed = coach_views.apply_teams_attendance_status_transition(record, [])
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_scheduled_time_passing_with_no_attendance_stays_scheduled(self):
        record = self._scheduled_linked_row()
        record.scheduled_date = date.today() - timedelta(days=3)
        record.save(update_fields=['scheduled_date'])
        changed = coach_views.apply_teams_attendance_status_transition(record, [])
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_teams_url_exists_but_no_attendance_record_stays_scheduled(self):
        record = self._scheduled_linked_row()
        self.assertTrue(record.meeting_link)
        changed = coach_views.apply_teams_attendance_status_transition(record, [])
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_zero_duration_interval_stays_scheduled(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'totalAttendanceSeconds': 0,
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:01:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_positive_short_interval_moves_to_in_progress(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'totalAttendanceSeconds': 1,
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:01:01Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_attendance_tracker_does_not_mark_zero_duration_as_attended(self):
        serialized = coach_views.serialize_coach_meeting_attendance_record('report-1', {
            'emailAddress': COACH_EMAIL,
            'attendanceIntervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:01:00Z')],
        }, 1)
        self.assertEqual(serialized['totalAttendanceSeconds'], 0)
        self.assertFalse(serialized['attended'])

    # -- 6/7: opening the form / saving a draft is not attendance ---------------

    def test_opening_the_review_form_does_not_move_status(self):
        record = self._scheduled_linked_row()
        request = RequestFactory().get('/coach_api/coach/reviews/x')
        request.coach_email = COACH_EMAIL
        response = unwrap(coach_views.coach_review_instance_detail)(request, record.review_instance_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_opening_a_scheduled_unlinked_review_recovers_scheduled_instance(self):
        review_id = self._template()
        record = CoachCalendarEvent.objects.create(
            event_key='mcr:550:1:2026-10-01', event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach One',
            learner_id=550, learner_name='Learner One', learner_email=LEARNER_EMAIL,
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/recovery-test',
            review_template_id=review_id,
        )
        base_event = {
            'eventKey': record.event_key,
            'source': 'mcr',
            'targetDate': '2026-10-01',
            'learnerId': 550,
            'sequence': 1,
            'occurrenceNumber': 1,
            'reviewTemplateId': review_id,
        }
        request = RequestFactory().post(
            '/coach_api/coach/reviews/open',
            data=json.dumps({'eventKey': record.event_key}),
            content_type='application/json',
        )
        request.coach_email = COACH_EMAIL
        with patch('coach_api.views.find_generated_timetable_event', return_value=(base_event, 'Coach One')):
            response = unwrap(coach_views.coach_review_instance_for_event)(request)

        self.assertEqual(response.status_code, 200)
        instance_id = json.loads(response.content)['instanceId']
        record.refresh_from_db()
        self.assertEqual(record.review_instance_id, instance_id)
        self.assertEqual(review_instances.get_review_instance(instance_id)['status'], review_instances.STATUS_SCHEDULED)

    def test_saving_a_draft_answer_does_not_move_status(self):
        record = self._scheduled_linked_row()
        instance = self._instance(record)
        definition = review_instances.review_instance_form_definition(instance)
        field_id = definition['sections'][0]['fields'][0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'Going well.'}, actor=COACH_EMAIL)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    # -- 9/10: identity matching --------------------------------------------------

    def test_attendance_from_an_unrelated_person_stays_scheduled(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': 'someone-else@example.com', 'displayName': 'Someone Else',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    def test_identical_display_name_different_email_is_not_credited(self):
        record = self._scheduled_linked_row()
        # An imposter sharing the coach's display name, but a different
        # mailbox -- must never be treated as proof the real coach attended.
        records = [{
            'email': 'impostor@example.com', 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

    # -- 11/12: monotonic, never regress -----------------------------------------

    def test_awaiting_signature_is_never_moved_back_to_in_progress(self):
        record = self._scheduled_linked_row()
        review_instances.force_review_instance_status_for_tests(
            record.review_instance_id, review_instances.STATUS_AWAITING_SIGNATURE, actor='test',
        )
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_AWAITING_SIGNATURE)

    def test_completed_is_never_moved_back_to_in_progress(self):
        record = self._scheduled_linked_row()
        review_instances.force_review_instance_status_for_tests(
            record.review_instance_id, review_instances.STATUS_COMPLETED, actor='test',
            extra={'completed_at': curriculum_views.datetime.utcnow()},
        )
        records = [{
            'email': LEARNER_EMAIL, 'displayName': 'Learner One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_COMPLETED)

    # -- 13: idempotent, started_at not rewritten --------------------------------

    def test_repeated_sync_does_not_rewrite_started_at(self):
        record = self._scheduled_linked_row()
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        coach_views.apply_teams_attendance_status_transition(record, records)
        first_started_at = self._instance(record)['started_at']

        later_records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:45:00Z')],
        }]
        changed_again = coach_views.apply_teams_attendance_status_transition(record, later_records)
        self.assertFalse(changed_again)
        self.assertEqual(self._instance(record)['started_at'], first_started_at)

    # -- 14: PR follows the same rule as MCM -------------------------------------

    def test_progress_review_follows_the_same_rule(self):
        record = self._scheduled_linked_row(
            learner_id=502, event_type='progress-review', type_code='progress_review',
        )
        changed_before = coach_views.apply_teams_attendance_status_transition(record, [])
        self.assertFalse(changed_before)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_SCHEDULED)

        records = [{
            'email': LEARNER_EMAIL, 'displayName': 'Learner One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertTrue(changed)
        self.assertEqual(self._instance(record)['status'], review_instances.STATUS_IN_PROGRESS)

    # -- 15: unlinked historical row never gets a review_instance created --------

    def test_unlinked_historical_row_creates_no_review_instance_and_is_a_no_op(self):
        record = CoachCalendarEvent.objects.create(
            event_key='mcr:9999:1:2025-01-01', event_type='mcr',
            owner_email=COACH_EMAIL, owner_name='Coach One',
            learner_id=9999, learner_name='Old Learner', learner_email='old@example.com',
            scheduled_date=date(2025, 1, 1), scheduled_time=time(10, 0),
            target_date=date(2025, 1, 1), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_IN_PROGRESS,
            meeting_link='https://teams.microsoft.com/meet/old',
        )
        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2025-01-01T10:01:00Z', '2025-01-01T10:30:00Z')],
        }]
        changed = coach_views.apply_teams_attendance_status_transition(record, records)
        self.assertFalse(changed)
        # No review_instances row was ever created for this row.
        rows = curriculum_views.fetch_all(
            f'select id from {curriculum_views.table_name(review_instances.REVIEW_INSTANCES_TABLE)} '
            f'where learner_id = %s', [9999],
        )
        self.assertEqual(rows, [])

    # -- calendar mirror + untouched fields ---------------------------------------

    def test_calendar_status_mirrors_and_other_fields_stay_untouched(self):
        record = self._scheduled_linked_row()
        original_target_date = record.target_date
        original_scheduled_date = record.scheduled_date
        original_scheduled_time = record.scheduled_time
        original_meeting_link = record.meeting_link

        records = [{
            'email': COACH_EMAIL, 'displayName': 'Coach One',
            'intervals': [_interval('2026-10-01T10:01:00Z', '2026-10-01T10:30:00Z')],
        }]
        coach_views.apply_teams_attendance_status_transition(record, records)
        record.refresh_from_db()

        self.assertEqual(record.status, CoachCalendarEvent.STATUS_IN_PROGRESS)
        self.assertEqual(record.target_date, original_target_date)
        self.assertEqual(record.scheduled_date, original_scheduled_date)
        self.assertEqual(record.scheduled_time, original_scheduled_time)
        self.assertEqual(record.meeting_link, original_meeting_link)
        self.assertEqual(record.review_responses, {})
