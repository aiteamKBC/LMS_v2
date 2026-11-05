"""Synthetic bound-call characterization; physical claims run on PostgreSQL separately."""
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, override_settings

from .actual_session_resolution import VerifiedMeetingTarget
from .bound_actual_session import BoundSessionConflict, bound_session
from .migrated_intelligence_views import _resource_state
from .migrated_session_scope import booking_fingerprint, scope_snapshot


class BoundActualSessionTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(pk=51, event_key='imported-review:synthetic',
            learner_id=7, owner_email='coach@example.invalid', graph_event_id='graph-51',
            graph_organizer_email='coach@example.invalid', meeting_link='https://example.invalid/meeting',
            review_instance_id=None, review_template_id=None, scheduled_date=date(2026, 10, 25),
            scheduled_time=time(10), duration_minutes=60)
        self.overlay = SimpleNamespace(pk=9, source_review_id=81, learner_id=7,
            event_key=self.record.event_key, owner_email=self.record.owner_email)
        self.claim = {'schemaVersion': 1, 'selectionVersion': 1, 'eventKey': self.record.event_key,
            'calendarId': 51, 'profileId': 7, 'ownerEmail': self.record.owner_email,
            'graphEventId': self.record.graph_event_id, 'bookingFingerprint': booking_fingerprint(self.record),
            'sourceReviewId': 81, 'overlayEventKey': self.record.event_key,
            'tenantId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'organizerId': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'onlineMeetingId': 'online-51', 'callId': 'call-51', 'reportId': 'report-51',
            'associationMethod': 'single-run-corroborated'}
        self.overlay.meeting_intelligence = {'actualSession': self.claim}
        self.owner = SimpleNamespace(state='active', provenance='graph-calendar-verified',
            overlay_id=9, source_review_id=81, learner_id=7,
            review_event_key=self.record.event_key, owner_email=self.record.owner_email,
            graph_event_id=self.record.graph_event_id,
            booking_fingerprint=self.claim['bookingFingerprint'],
            tenant_id=self.claim['tenantId'], organizer_id=self.claim['organizerId'],
            online_meeting_id='online-51')
        self.target = VerifiedMeetingTarget('synthetic-base', self.claim['tenantId'],
            self.claim['organizerId'], 'online-51', 51, 'graph-51', self.claim['bookingFingerprint'])

    @override_settings(APTEM_ACTUAL_SESSION_ASSOCIATION_POLICY_APPROVED=True)
    def test_exact_owner_target_and_claim_are_required(self):
        with patch('coach_api.bound_actual_session.ImportedMeetingOwnership.objects') as objects:
            objects.filter.return_value.first.return_value = self.owner
            bound = bound_session(self.record, overlay=self.overlay, target=self.target)
            self.assertEqual(bound.context.call_id, 'call-51')
            self.assertEqual(bound.context.report_id, 'report-51')
            self.owner.online_meeting_id = 'other-meeting'
            with self.assertRaises(BoundSessionConflict):
                bound_session(self.record, overlay=self.overlay, target=self.target)

    @override_settings(APTEM_ACTUAL_SESSION_ASSOCIATION_POLICY_APPROVED=False)
    def test_saved_claim_does_not_bypass_disabled_policy(self):
        with patch('coach_api.bound_actual_session.ImportedMeetingOwnership.objects') as objects:
            objects.filter.return_value.first.return_value = self.owner
            with self.assertRaises(BoundSessionConflict):
                bound_session(self.record, overlay=self.overlay)
            objects.filter.assert_not_called()

    @override_settings(APTEM_ACTUAL_SESSION_ASSOCIATION_POLICY_APPROVED=True)
    def test_missing_registry_fails_closed_without_database_details(self):
        with patch('coach_api.bound_actual_session.ImportedMeetingOwnership.objects') as objects:
            objects.filter.return_value.first.side_effect = DatabaseError('synthetic missing table')
            with self.assertRaises(BoundSessionConflict) as caught:
                bound_session(self.record, overlay=self.overlay)
        self.assertNotIn('table', str(caught.exception))

    @override_settings(APTEM_ACTUAL_SESSION_ASSOCIATION_POLICY_APPROVED=True)
    def test_off_window_segments_are_selected_by_call_not_nearby_date(self):
        with patch('coach_api.bound_actual_session.ImportedMeetingOwnership.objects') as objects:
            objects.filter.return_value.first.return_value = self.owner
            session = bound_session(self.record, overlay=self.overlay).context
        def media(kind, artifact, call):
            return {'artifact_type': kind, 'graph_artifact_id': artifact, 'call_id': call,
                'created_datetime': '2026-10-28T10:00:00Z', 'end_datetime': '2026-10-28T10:30:00Z',
                'metadata': {'callId': call, 'meetingId': 'online-51'}}
        snapshot = {'artifacts': [media('transcript', 'segment-a', 'call-51'),
            media('transcript', 'segment-b', 'call-51'), media('recording', 'video', 'call-51'),
            media('recording', 'other-video', 'call-52')],
            'attendanceReports': [
                {'id': 'report-51', 'meetingStartDateTime': '2026-10-28T10:00:00Z',
                 'meetingEndDateTime': '2026-10-28T10:30:00Z', 'records': []},
                {'id': 'other-report', 'meetingStartDateTime': '2026-10-28T10:00:00Z',
                 'meetingEndDateTime': '2026-10-28T10:30:00Z', 'records': []}],
            'attendance': {'expectedAttendees': []}}
        with patch('coach_api.views.build_coach_meeting_attendance_tracker', return_value={}):
            scoped = scope_snapshot(self.record, snapshot, session=session)
        self.assertEqual({row['graph_artifact_id'] for row in scoped['artifacts']},
                         {'segment-a', 'segment-b', 'video'})
        self.assertEqual([row['id'] for row in scoped['attendanceReports']], ['report-51'])

    def test_booked_end_cannot_complete_a_bound_call_without_report(self):
        from django.utils import timezone
        state = _resource_state(self.record, {'artifacts': [], 'resourceErrors': {}},
            {'artifacts': []}, [], None, [], False, timezone.now(), session=SimpleNamespace(report_id='report-51'))
        self.assertEqual(state['meetingEndStatus'], 'pending')
        self.assertEqual(state['meetingEndCode'], 'MEETING_END_PENDING')

