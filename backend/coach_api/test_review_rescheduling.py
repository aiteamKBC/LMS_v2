"""Regression tests using only explicitly verified in-memory SQLite and fake Teams.

Run with unittest after selecting settings_sqlite_test and NAME=:memory:.
This module refuses schema setup on file-backed or PostgreSQL connections.
"""
from copy import copy, deepcopy
from contextlib import ExitStack
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from django.conf import settings
from django.db import connection
from django.db import ProgrammingError
from django.test import override_settings, RequestFactory

from . import views, review_rescheduling as policy
from .models import CoachCalendarEvent, ReviewAttendanceLink, ReviewBookingReschedule
from .test_review_attendance_links import snapshot, link_for


class ReviewRescheduleTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if (connection.vendor != 'sqlite' or connection.settings_dict['NAME'] != ':memory:'
                or not settings.COACH_TEST_MODE):
            raise RuntimeError('These tests require a fresh in-memory SQLite connection.')
        cls.models = (CoachCalendarEvent, ReviewAttendanceLink, ReviewBookingReschedule)
        with connection.schema_editor() as editor:
            for model in cls.models:
                editor.create_model(model)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            for model in reversed(cls.models):
                editor.delete_model(model)
        super().tearDownClass()

    def setUp(self):
        for model in reversed(self.models):
            model.objects.all().delete()
        self.record = CoachCalendarEvent.objects.create(
            event_key='review:21:template:1', learner_id=21,
            owner_email='coach@example.invalid', learner_email='student@example.invalid',
            learner_name='Synthetic learner', event_type='mcr', target_date=date(2026, 10, 27),
            scheduled_date=date(2026, 10, 27), scheduled_time=time(10), duration_minutes=60,
            status='in-progress', sync_state='synced', graph_event_id='existing-event',
            graph_organizer_email='coach@example.invalid', meeting_link='https://example.invalid/meeting',
            review_template_id='template', review_instance_id='instance',
            notes='Saved notes', review_responses={'answer': 'Keep my draft'},
        )
        self.snapshot = snapshot()
        self.snapshot['attendanceReports'] = self.snapshot['attendance']['reports']
        self.snapshot['attendanceTracker'] = {'tracker': self.snapshot['attendance']['tracker']}
        self.instance = dict(id='instance', calendar_event_id=self.record.pk, learner_id=21,
                             coach_email=self.record.owner_email, review_template_id='template', status='in-progress')
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(views, 'stored_coach_meeting_snapshot', side_effect=lambda *a, **kw: deepcopy(self.snapshot)))
        self.stack.enter_context(patch.object(views, 'coach_meeting_expected_attendees', return_value=self.snapshot['attendance']['expectedAttendees']))
        self.stack.enter_context(patch('coach_api.reconciliation_links.for_calendar', return_value=None))
        self.stack.enter_context(patch.object(views.curriculum_review_instances, 'get_review_instance', side_effect=lambda *a, **kw: deepcopy(self.instance)))
        for name in ('lock_learner_calendar', 'ensure_learner_calendar_available', 'ensure_coach_booking_available', 'england_non_delivery_reason'):
            self.stack.enter_context(patch.object(views, name, return_value=None))
        self.original_slot = (self.record.scheduled_date, self.record.scheduled_time, 60)

    def persist(self, *, coach=True, expected=None, candidate=None, overlay=None):
        candidate = candidate or copy(self.record)
        candidate.scheduled_date = date(2026, 11, 3)
        candidate.status = 'scheduled'  # Native scheduling's existing input.
        return views.persist_calendar_sync_reservation(candidate, coach_reschedule=coach,
            expected_booking=expected or self.original_slot, overlay=overlay,
            review_event={'reviewSource': 'aptem'} if overlay else None)

    def test_pending_report_allows_coach_reschedule(self):
        self.snapshot['attendanceReports'] = []
        self.snapshot['attendance']['tracker'] = []
        self.assertIsNone(policy.require_started_reschedule(self.record, 'in-progress'))

    def test_coach_only_attendance_allows_reschedule(self):
        self.snapshot['attendance']['tracker'].append(dict(role='coach', expected=True, attended=True, totalAttendanceSeconds=600))
        self.assertIsNone(policy.require_started_reschedule(self.record, 'in-progress'))

    def test_positive_learner_attendance_blocks_even_below_threshold(self):
        self.snapshot['attendance']['tracker'][0].update(attended=True, totalAttendanceSeconds=1)
        with self.assertRaises(views.LearnerCalendarConflict):
            self.persist()
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)
        self.record.refresh_from_db()
        self.assertEqual(self.record.scheduled_date, self.original_slot[0])

    def test_saved_attendance_still_blocks_after_email_change(self):
        self.record.learner_email = 'changed@example.invalid'
        self.snapshot['attendance']['tracker'][0].update(attended=True, totalAttendanceSeconds=60)
        self.assertTrue(policy.learner_attended(self.record))

    def test_explicit_coach_link_to_guest_blocks(self):
        attendance = self.snapshot['attendance']
        link = link_for(self.record, attendance)
        with patch('coach_api.review_attendance_links.saved_links', return_value=[link]):
            self.assertTrue(policy.learner_attended(self.record))

    def test_another_learner_link_does_not_count(self):
        link = link_for(self.record, self.snapshot['attendance'], learner_id=22)
        with patch('coach_api.review_attendance_links.saved_links', return_value=[link]):
            self.assertFalse(policy.learner_attended(self.record))

    def test_evidence_read_failure_blocks_without_booking_write(self):
        self.snapshot['partial'] = True
        with self.assertRaises(views.LearnerCalendarConflict):
            self.persist()
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)

    def test_closed_unlinked_and_unrelated_bookings_are_not_eligible(self):
        for field, value in [('status', 'completed'), ('status', 'awaiting-signature'),
                             ('event_type', 'catch-up'), ('graph_event_id', ''),
                             ('sync_state', 'syncing')]:
            with self.subTest(field=field, value=value):
                record = copy(self.record); setattr(record, field, value)
                with self.assertRaises(views.LearnerCalendarConflict):
                    policy.require_started_reschedule(record, 'in-progress')

    def test_native_preserves_answers_status_and_provider_identity(self):
        result = self.persist()
        self.assertEqual(result.status, 'in-progress')
        self.assertEqual(result.review_responses, {'answer': 'Keep my draft'})
        self.assertEqual(result.notes, 'Saved notes')
        self.assertEqual(result.review_instance_id, 'instance')
        self.assertEqual(result.graph_event_id, 'existing-event')
        self.assertEqual(result.meeting_link, self.record.meeting_link)
        self.assertEqual(result.scheduled_date, date(2026, 11, 3))
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(ReviewBookingReschedule.objects.get().scheduled_date, self.original_slot[0])

    def test_native_progress_review_uses_the_same_guard(self):
        self.record.event_type = 'progress-review'; self.record.save()
        self.assertEqual(self.persist().status, 'in-progress')

    def test_missing_history_storage_never_changes_the_booking(self):
        with patch.object(ReviewBookingReschedule.objects, 'get_or_create', side_effect=ProgrammingError('missing storage')):
            with self.assertRaisesRegex(views.LearnerCalendarConflict, 'history is unavailable'):
                self.persist()
        self.record.refresh_from_db()
        self.assertEqual(self.record.scheduled_date, self.original_slot[0])

    def test_missing_expected_slot_rejected_by_shared_writer(self):
        candidate = copy(self.record); candidate.scheduled_date = date(2026, 11, 3)
        with self.assertRaises(views.LearnerCalendarConflict):
            views.persist_calendar_sync_reservation(candidate, coach_reschedule=True)
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)

    def test_imported_preserves_overlay_and_source(self):
        self.record.review_instance_id = ''; self.record.review_template_id = ''
        self.record.save()
        overlay = SimpleNamespace(status='in-progress', meeting_intelligence={}, answers={'saved': 'draft'})
        result = self.persist(overlay=overlay)
        self.assertEqual(result.status, 'in-progress')
        self.assertEqual(overlay.answers, {'saved': 'draft'})
        self.assertEqual(overlay.status, 'in-progress')

    def test_learner_shared_writer_still_rejects_in_progress(self):
        with self.assertRaises(views.LearnerCalendarConflict):
            self.persist(coach=False)
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)

    def test_retry_does_not_duplicate_history_or_booking(self):
        self.persist()
        self.record.refresh_from_db()
        self.persist()
        self.assertEqual(ReviewBookingReschedule.objects.count(), 1)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_stale_concurrent_slot_rejected(self):
        with self.assertRaises(views.LearnerCalendarConflict):
            self.persist(expected=(date(2026, 10, 26), time(10), 60))
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)

    def test_identity_conflict_rejected_before_archive(self):
        for field, value in [('learner_id', 22), ('owner_email', 'other@example.invalid')]:
            with self.subTest(field=field):
                candidate = copy(self.record); setattr(candidate, field, value)
                with self.assertRaises(views.LearnerCalendarConflict):
                    self.persist(candidate=candidate)
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)

    def test_review_instance_identity_mismatch_rejected(self):
        self.instance['learner_id'] = 22
        with self.assertRaises(views.LearnerCalendarConflict):
            self.persist()

    def test_busy_slot_rolls_back_history_and_slot(self):
        with patch.object(views, 'ensure_learner_calendar_available', side_effect=views.LearnerCalendarConflict('Busy')):
            with self.assertRaises(views.LearnerCalendarConflict):
                self.persist()
        self.assertEqual(ReviewBookingReschedule.objects.count(), 0)
        self.record.refresh_from_db()
        self.assertEqual(self.record.scheduled_date, self.original_slot[0])

    def test_refresh_started_before_reschedule_cannot_publish_stale_evidence(self):
        self.persist()
        with patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
             patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=True), \
             patch.object(views, 'connections') as connections:
            result = views.persist_coach_meeting_snapshots(self.record, artifacts=[],
                attendance_reports=[], attendance_tracker={})
            self.assertEqual(result, {'stored': False, 'reason': 'snapshot_context_changed'})
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value.execute.assert_not_called()

    def test_archive_is_not_visible_to_other_booking_or_provider(self):
        self.persist()
        for field, value in [('learner_id', 22), ('pk', 999), ('graph_event_id', 'another-event'),
                             ('owner_email', 'other@example.invalid')]:
            with self.subTest(field=field):
                other = copy(self.record); setattr(other, field, value)
                self.assertEqual(policy.previous_bookings(other), [])

    def test_previous_reports_and_media_stay_separate_from_current(self):
        self.persist(); self.record.refresh_from_db()
        old = dict(artifact_type='transcript', graph_artifact_id='old', call_id='old-call',
                   created_datetime='2026-10-27T10:00:00Z', end_datetime='2026-10-27T11:00:00Z',
                   metadata={'_lms_graph_event_id': 'existing-event'})
        new = {**old, 'graph_artifact_id': 'new', 'call_id': 'new-call',
               'created_datetime': '2026-11-03T10:00:00Z', 'end_datetime': '2026-11-03T11:00:00Z'}
        self.snapshot['artifacts'] = [old, new]
        original = deepcopy(self.snapshot)
        current = policy.current_evidence(self.record, self.snapshot)
        self.assertEqual([row['graph_artifact_id'] for row in current['artifacts']], ['new'])
        self.assertEqual(current['attendanceReports'], [])
        history = policy.historical_artifacts(self.record, self.snapshot)
        self.assertEqual([row['graph_artifact_id'] for row in history], ['old'])
        self.assertTrue(history[0]['previous_session'])
        self.assertEqual(original, self.snapshot)
        self.assertIsNone(policy.historical_content(self.record, 'transcript', 'foreign-id', self.snapshot))

    def test_attendance_badge_uses_native_report_until_booking_is_rescheduled(self):
        from .review_attendance_display import outcome
        report = dict(id='early-report', meetingStartDateTime='2026-10-27T09:00:00Z',
                      meetingEndDateTime='2026-10-27T09:08:00Z', records=[])
        self.assertEqual(outcome(self.record, [report], [], native=True), 'missed')
        self.persist()
        self.record.refresh_from_db()
        self.assertEqual(outcome(self.record, [report], [], native=True), 'pending')
        current = {**report, 'id': 'replacement-report',
                   'meetingStartDateTime': '2026-11-03T10:00:00Z',
                   'meetingEndDateTime': '2026-11-03T10:08:00Z'}
        self.assertEqual(outcome(self.record, [report, current], [], native=True), 'missed')

    def test_previous_recording_keeps_verified_playback_after_reschedule(self):
        self.persist(); self.record.refresh_from_db()
        self.snapshot['artifacts'] = [dict(artifact_type='recording', graph_artifact_id='old-video',
            call_id='old-call', created_datetime='2026-10-27T10:00:00Z', end_datetime='2026-10-27T11:00:00Z',
            metadata={'_lms_graph_event_id': 'existing-event', '_lms_verified_online_meeting_id': 'online'})]
        request = RequestFactory().get('/video')
        with patch('coach_api.recording_archive.archived_recording_url', return_value=None) as archive, \
             patch('coach_api.imported_recording_playback.stream_imported_recording', return_value='safe-response') as stream:
            result = views.coach_meeting_artifact_content_response(request, self.record,
                'imported-review:alias', 'recording', 'old-video', imported_review=True)
            self.assertEqual(result, 'safe-response')
            self.assertIsNone(stream.call_args.args[2]['selectionError'])
            self.assertEqual(stream.call_args.args[3]['graph_artifact_id'], 'old-video')
            archive.assert_called_once_with(self.record.event_key, 'old-video')

    def test_imported_can_reschedule_uses_attendance_for_in_progress_only(self):
        from .migrated_rescheduling import can_reschedule
        overlay = SimpleNamespace(status='in-progress')
        self.assertTrue(can_reschedule(overlay, self.record, family='PR'))
        self.snapshot['attendance']['tracker'][0]['attended'] = True
        self.assertFalse(can_reschedule(overlay, self.record, family='PR'))

    def test_personal_support_plan_policy_is_not_expanded(self):
        from .migrated_rescheduling import can_reschedule
        self.assertFalse(can_reschedule(SimpleNamespace(status='in-progress'), self.record, family='PSP'))

    def test_inconsistent_completed_imported_overlay_is_not_reschedulable(self):
        from .migrated_rescheduling import can_reschedule
        self.assertFalse(can_reschedule(SimpleNamespace(status='in-progress', completed_at='2026-10-27'), self.record, family='PR'))

    @override_settings(APTEM_ACTUAL_SESSION_ASSOCIATION_POLICY_APPROVED=True)
    def test_old_claim_is_retained_but_never_selected_as_the_replacement_call(self):
        from .bound_actual_session import bound_session, BoundSessionConflict
        from .migrated_session_scope import booking_fingerprint
        claim = dict(schemaVersion=1, selectionVersion=1, calendarId=self.record.pk,
                     profileId=21, ownerEmail=self.record.owner_email, graphEventId='existing-event',
                     eventKey=self.record.event_key, bookingFingerprint=booking_fingerprint(self.record),
                     sourceReviewId=81, overlayEventKey=self.record.event_key,
                     tenantId='tenant', organizerId='organizer', onlineMeetingId='online',
                     callId='old-call', reportId='old-report', associationMethod='single-run-corroborated')
        overlay = SimpleNamespace(pk=9, learner_id=21, source_review_id=81, event_key=self.record.event_key,
                                  owner_email=self.record.owner_email, status='in-progress',
                                  meeting_intelligence={'actualSession': claim})
        owner = SimpleNamespace(state='active', provenance='graph-calendar-verified', overlay_id=9,
                                source_review_id=81, learner_id=21, review_event_key=self.record.event_key,
                                owner_email=self.record.owner_email, graph_event_id='existing-event',
                                booking_fingerprint=claim['bookingFingerprint'], tenant_id='tenant',
                                organizer_id='organizer', online_meeting_id='online')
        with patch('coach_api.bound_actual_session.ImportedMeetingOwnership.objects') as objects:
            objects.filter.return_value.first.return_value = owner
            objects.select_for_update.return_value.filter.return_value.first.return_value = owner
            self.persist(overlay=overlay)
            self.record.refresh_from_db()
            owner.booking_fingerprint = booking_fingerprint(self.record)
            self.assertIsNone(bound_session(self.record, overlay=overlay))
            self.assertEqual(overlay.meeting_intelligence['actualSession'], claim)
            self.assertEqual(ReviewBookingReschedule.objects.get().session_claim, claim)
            # Check Teams must be reachable for the replacement appointment,
            # without deleting/rewriting the protected historical claim.
            from . import migrated_intelligence_views as intelligence
            request = RequestFactory().post('/check', data='{}', content_type='application/json')
            with patch.object(intelligence, '_association', return_value=(overlay, self.record, {})), \
                 patch.object(intelligence, '_check_writable', return_value=None), \
                 patch.object(intelligence, '_check_basis', return_value={}), \
                 patch.object(views, 'fetch_coach_meeting_graph_snapshot', side_effect=RuntimeError('synthetic transport')) as fetch:
                with self.assertRaisesRegex(RuntimeError, 'synthetic transport'):
                    unwrap(intelligence.migrated_review_check_session)(request, overlay.event_key)
                fetch.assert_called_once()
            owner.learner_id = 22
            with self.assertRaises(BoundSessionConflict):
                bound_session(self.record, overlay=overlay)

    def test_existing_scheduled_policy_is_unchanged(self):
        from .migrated_rescheduling import can_reschedule
        self.record.status = 'scheduled'
        self.assertTrue(can_reschedule(SimpleNamespace(status='scheduled'), self.record))
