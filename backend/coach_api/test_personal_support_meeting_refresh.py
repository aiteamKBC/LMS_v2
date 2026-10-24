"""PSP retains its existing generic meeting action without a Review bypass."""
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views
from . import test_meeting_read_security as security_fixtures


class PersonalSupportMeetingRefreshTests(SimpleTestCase):
    call = security_fixtures.MeetingReadSecurityTests.call
    assert_no_effects = security_fixtures.MeetingReadSecurityTests.assert_no_effects
    test_view_as_guard = security_fixtures.MeetingReadSecurityTests.test_view_as_get_is_passive_and_post_is_forbidden_through_real_guard
    test_csrf_guard = security_fixtures.MeetingReadSecurityTests.test_refresh_post_retains_csrf
    test_role_guard = security_fixtures.MeetingReadSecurityTests.test_real_guard_rejects_missing_session_and_non_coach_roles

    def setUp(self):
        security_fixtures.MeetingReadSecurityTests.setUp(self)
        self.record.event_key = 'imported-review:synthetic-psp'
        self.record.idempotency_key = self.record.event_key
        self.record.event_type = 'progress-review'
        self.record.graph_event_id = 'existing-graph'
        self.record.sync_state = 'synced'
        self.record.meeting_link = 'https://example.invalid/existing-meeting'
        self.definition = {
            'template': {'reviewTypeCode': 'aptem_psp'},
            'instance': {'id': self.record.event_key, 'learnerId': 42,
                         'status': 'not-scheduled', 'completedAt': None},
            'historicalReview': {'id': '407', 'type': 'Personal Support Plan',
                                 'status': 'not-scheduled', 'completedDate': None},
            'booking': {'eventKey': self.record.event_key, 'conflict': False,
                        'syncState': 'synced', 'meetingLink': self.record.meeting_link},
            # A PSP can have an appointment before its form is initialized.
            'migratedForm': False, 'readOnly': True, 'answers': {'saved': 'Keep'},
        }
        self.definition_read = self.stack.enter_context(patch.object(
            views, '_imported_review_definition', return_value=self.definition))

    def test_existing_psp_appointment_refresh_keeps_generic_response_and_form(self):
        before = deepcopy(self.definition)
        response = self.call(views.coach_timetable_event_artifacts, 'post')
        self.assertEqual(response.status_code, 200)
        self.graph.assert_called_once_with(self.record)
        self.persist.assert_called_once()
        self.generate.assert_called_once_with(self.record, retry_failed=True)
        self.assertEqual(self.definition, before)
        self.definition_read.assert_called_with(self.record.owner_email, self.record.event_key)

    def test_psp_passive_get_remains_stored_only(self):
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, suffix='?refresh=1').status_code, 200)
        self.assert_no_effects()
        self.definition_read.assert_not_called()

    def test_other_imported_families_still_require_check_session(self):
        for family, source in [('aptem_mcm', 'Monthly Coaching Meeting'),
                               ('aptem_progress_review', 'Progress Review'),
                               ('aptem_progress_review', 'Progress Review (+ Skills Radar)')]:
            with self.subTest(source=source):
                self.definition['template']['reviewTypeCode'] = family
                self.definition['historicalReview']['type'] = source
                self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.assert_no_effects()

    def test_invalid_source_owner_learner_booking_and_sync_never_refresh(self):
        changes = [
            ('instance', 'id', 'imported-review:other'), ('instance', 'learnerId', 99),
            ('historicalReview', 'type', 'Progress Review'),
            ('historicalReview', 'completedDate', '2026-10-24'),
            ('historicalReview', 'status', 'cancelled'),
            ('historicalReview', 'status', 'unknown'),
            ('booking', 'eventKey', 'imported-review:other'), ('booking', 'conflict', True),
            ('booking', 'syncState', 'failed'), ('booking', 'meetingLink', None),
            ('booking', 'meetingLink', 'https://example.invalid/another-meeting'),
        ]
        for section, key, value in changes:
            with self.subTest(section=section, key=key):
                changed = deepcopy(self.definition)
                changed[section][key] = value
                self.definition_read.return_value = changed
                self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.definition_read.return_value = None
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.assert_no_effects()

    def test_frozen_psp_and_native_association_never_refresh(self):
        for status in ('awaiting-signature', 'completed', 'cancelled'):
            with self.subTest(status=status):
                self.definition['instance']['status'] = status
                self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.definition['instance']['status'] = 'scheduled'
        for name, value in [('review_instance_id', 'REVI-other'), ('review_template_id', 'REV-other'),
                            ('sync_state', 'failed'), ('graph_event_id', '')]:
            with self.subTest(field=name):
                previous = getattr(self.record, name)
                setattr(self.record, name, value)
                self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
                setattr(self.record, name, previous)
        self.assert_no_effects()

    def test_psp_can_refresh_after_start_but_not_after_completion(self):
        self.definition['localStatus'] = 'in-progress'
        self.definition['instance']['status'] = 'in-progress'
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 200)
        self.graph.reset_mock()
        self.definition['localStatus'] = 'completed'
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.graph.assert_not_called()

    def test_untrusted_owner_cannot_use_a_valid_psp_definition(self):
        from inspect import unwrap
        request = self.factory.post('/')
        request.coach_email = 'unrelated@example.invalid'
        self.assertEqual(unwrap(views.coach_timetable_event_artifacts)(request, self.record.event_key).status_code, 409)
        self.definition_read.assert_not_called()
        self.assert_no_effects()


class PersonalSupportRefreshSourceTests(SimpleTestCase):
    from . import test_personal_support_booking as fixtures
    setUp = fixtures.PersonalSupportDefinitionTests.setUp
    _patch = fixtures.PersonalSupportDefinitionTests._patch
    _set_source_status = fixtures.PersonalSupportDefinitionTests._set_source_status

    def test_real_imported_definition_and_booking_resolver_authorize_only_own_active_psp(self):
        from datetime import date, time
        from .models import CoachCalendarEvent
        from .personal_support_booking import can_refresh_meeting
        record = CoachCalendarEvent(pk=7, event_key='imported-review:A-7',
            owner_email='coach@example.invalid', learner_id=21, event_type='progress-review',
            status='scheduled', sync_state='synced', graph_event_id='existing-graph',
            meeting_link='https://example.invalid/existing-meeting',
            scheduled_date=date(2026, 10, 24), scheduled_time=time(10), duration_minutes=60)
        with patch('coach_api.personal_support_booking.booking_for_imported_review', return_value=record):
            self.assertTrue(can_refresh_meeting(record.owner_email, record))
            record.learner_id = 99
            self.assertFalse(can_refresh_meeting(record.owner_email, record))
            record.learner_id = 21
            row = list(self.cursor.fetchall.return_value[0])
            row[9] = 'Completed'
            self.cursor.fetchall.return_value = [tuple(row)]
            self.assertFalse(can_refresh_meeting(record.owner_email, record))
