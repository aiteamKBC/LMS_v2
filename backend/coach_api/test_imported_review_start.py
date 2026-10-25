"""Status-only imported start contract. Synthetic objects; no DB/providers."""
import json
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import date, time, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from . import views


class ImportedStartTests(SimpleTestCase):
    def setUp(self):
        self.overlay = SimpleNamespace(pk=3, event_key='imported-review:source-7',
            owner_email='coach@example.invalid', learner_id=41, source_review_id=7,
            status='scheduled', completed_at=None, template_snapshot={'sections': [{'id': 'section'}]},
            answers={'answer': 'Keep'}, meeting_intelligence={}, save=Mock(),
            migrated_signatures=Mock())
        self.overlay.migrated_signatures.exists.return_value = False
        self.calendar = SimpleNamespace(pk=8, event_key=self.overlay.event_key,
            owner_email=self.overlay.owner_email, learner_id=41, learner_name='Synthetic learner', event_type='progress-review',
            status='scheduled', sync_state='synced', graph_event_id='graph-event',
            graph_organizer_email=self.overlay.owner_email, meeting_link='https://example.invalid/teams',
            graph_web_link='', scheduled_date=date(2026, 10, 20), scheduled_time=time(10),
            duration_minutes=60, save=Mock())
        self.definition = {'migratedForm': True, 'readOnly': False,
            'instance': {'id': self.overlay.event_key, 'learnerId': 41, 'status': 'scheduled'},
            'historicalReview': {'id': 7, 'type': 'Progress Review', 'status': 'Scheduled'}}

    def start(self, route=None, **payload):
        request = RequestFactory().post('/local-status', data=json.dumps({'status': 'in-progress', **payload}),
                                        content_type='application/json')
        handler = views.coach_review_instance_local_status
        while hasattr(handler, '__wrapped__'):
            handler = handler.__wrapped__
        with patch('coach_api.views.authenticated_coach_email', return_value=self.overlay.owner_email), \
             patch('coach_api.views._imported_review_definition', return_value=self.definition), \
             patch('coach_api.views._owned_migrated_overlay', return_value=self.overlay), \
             patch('coach_api.review_sources.booking_for_overlay', return_value=self.calendar), \
             patch('django.db.transaction.atomic', return_value=nullcontext()), \
             patch('coach_api.migrated_template_sync.synchronize_definition_locked') as sync:
            result = handler(request, route or self.overlay.event_key)
        return result, sync

    def test_initialized_psp_starts_without_other_psp_lifecycle_work(self):
        self.definition['historicalReview']['type'] = 'Personal Support Plan'
        response, _ = self.start()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.overlay.status, 'in-progress')
        self.assertEqual(self.calendar.status, 'in-progress')

    def test_repeated_start_is_idempotent(self):
        self.overlay.status = self.calendar.status = 'in-progress'
        response, _ = self.start()
        self.assertEqual(response.status_code, 200)
        self.overlay.save.assert_not_called()
        self.calendar.save.assert_not_called()

    def test_start_changes_status_only_and_does_not_synchronize_answers(self):
        response, sync = self.start()
        self.assertEqual(response.status_code, 200)
        sync.assert_not_called()
        self.overlay.save.assert_called_once_with(update_fields=['status', 'updated_at'])
        self.assertEqual(self.overlay.answers, {'answer': 'Keep'})

    def test_join_rejects_different_calendar_association(self):
        response, _ = self.start(calendarEventKey='unrelated-calendar')
        self.assertEqual(response.status_code, 409)
        self.overlay.save.assert_not_called()

    def test_stale_join_link_or_schedule_does_not_start_replacement_booking(self):
        for payload in ({'meetingLink': 'https://example.invalid/old'}, {'scheduledDate': '2026-01-01'},
                        {'scheduledTime': '15:00'}):
            with self.subTest(payload=payload):
                self.assertEqual(self.start(**payload)[0].status_code, 409)
                self.overlay.save.assert_not_called()

    def test_malformed_join_target_is_rejected_without_mutation(self):
        self.assertEqual(self.start(meetingLink=['invalid'])[0].status_code, 400)
        self.overlay.save.assert_not_called()

    def test_calendar_legacy_key_resolves_authoritative_review_and_ownership(self):
        self.calendar.event_key = 'learner-book:progress-review:apprenticeship:200:2026-10:7'
        with patch('coach_api.models.CoachCalendarEvent.objects.filter') as calendar, \
             patch('coach_api.background_meeting_sync.imported_context') as context:
            calendar.return_value.first.return_value = self.calendar
            context.return_value = {'reviewKey': self.overlay.event_key, 'overlayId': self.overlay.pk}
            response, _ = self.start(route=self.calendar.event_key, calendarEventKey=self.calendar.event_key)
        self.assertEqual(response.status_code, 200)
        calendar.assert_called_once_with(event_key=self.calendar.event_key, owner_email__iexact=self.overlay.owner_email)
        context.assert_called_once_with(self.calendar)
        self.assertEqual(self.overlay.status, 'in-progress')

    def test_calendar_native_or_uninitialized_psp_never_creates_or_starts_a_review(self):
        for context in (None, {'reviewKey': self.overlay.event_key, 'overlayId': None}):
            with self.subTest(context=context), patch('coach_api.models.CoachCalendarEvent.objects.filter') as calendar, \
                 patch('coach_api.background_meeting_sync.imported_context', return_value=context):
                calendar.return_value.first.return_value = self.calendar
                response, _ = self.start(route='legacy-calendar', calendarEventKey='legacy-calendar')
            self.assertEqual(response.status_code, 409)
            self.overlay.save.assert_not_called()

    def test_advanced_stages_are_unchanged(self):
        for status in ('awaiting-signature', 'completed', 'submitted', 'not-scheduled'):
            with self.subTest(status=status):
                self.overlay.status = status
                response, _ = self.start()
                self.assertEqual(response.status_code, 409)
                self.overlay.save.assert_not_called()

    def test_signed_or_completed_timestamp_cannot_be_restarted_from_inconsistent_scheduled_state(self):
        self.overlay.migrated_signatures.exists.return_value = True
        self.assertEqual(self.start()[0].status_code, 409)
        self.overlay.migrated_signatures.exists.return_value = False
        self.overlay.completed_at = timezone.now()
        self.assertEqual(self.start()[0].status_code, 409)
        self.overlay.save.assert_not_called()

    def test_wrong_owner_cancelled_or_unsynced_booking_cannot_start(self):
        for field, value in [('owner_email', 'other@example.invalid'), ('status', 'cancelled'),
                             ('sync_state', 'failed'), ('meeting_link', ''), ('graph_event_id', '')]:
            old = getattr(self.calendar, field)
            with self.subTest(field=field):
                setattr(self.calendar, field, value)
                self.assertEqual(self.start()[0].status_code, 409)
                self.overlay.save.assert_not_called()
                setattr(self.calendar, field, old)

    def snapshot(self):
        from .migrated_session_scope import booking_window
        start, end = booking_window(self.calendar)
        return {'attendance': {'expectedAttendees': [{'role': 'learner', 'email': 'learner@example.invalid'}]},
            'attendanceReports': [{'id': 'report', 'meetingStartDateTime': start.isoformat(),
                'meetingEndDateTime': end.isoformat(), 'records': [{'email': 'learner@example.invalid',
                    'totalAttendanceSeconds': 60}]}], 'artifacts': [], 'resourceErrors': {}, 'errors': [],
            'transcriptCollectionComplete': True, 'attendanceTracker': {}, 'partial': False}

    def test_verified_attendance_requires_current_window_positive_duration_and_strict_identity(self):
        from .imported_review_start import has_start_evidence
        snapshot = self.snapshot()
        self.assertTrue(has_start_evidence(self.calendar, snapshot))
        for field, value in [('email', 'other@example.invalid'), ('email', ''), ('totalAttendanceSeconds', 0)]:
            modified = deepcopy(snapshot)
            modified['attendanceReports'][0]['records'][0][field] = value
            self.assertFalse(has_start_evidence(self.calendar, modified))
        snapshot['attendance']['expectedAttendees'][0]['role'] = 'employer'
        self.assertFalse(has_start_evidence(self.calendar, snapshot))
        snapshot = self.snapshot()
        snapshot['resourceErrors']['attendance'] = 'fetch'
        self.assertFalse(has_start_evidence(self.calendar, snapshot))
        snapshot = self.snapshot()
        self.calendar.scheduled_date += timedelta(days=7)
        self.assertFalse(has_start_evidence(self.calendar, snapshot))

    def test_transcript_requires_complete_collection_all_segments_and_one_current_call(self):
        from .imported_review_start import has_start_evidence
        snapshot = self.snapshot()
        report = snapshot['attendanceReports'].pop()
        artifact = {'artifact_type': 'transcript', 'graph_artifact_id': 'segment-1', 'call_id': 'call-1',
                    'created_datetime': report['meetingStartDateTime'], 'end_datetime': report['meetingEndDateTime'],
                    'transcript_text': 'Synthetic complete transcript'}
        snapshot['artifacts'] = [artifact, {**artifact, 'graph_artifact_id': 'segment-2'}]
        self.assertTrue(has_start_evidence(self.calendar, snapshot))
        for mutation in ('page', 'error', 'empty', 'call', 'undated', 'old', 'recording'):
            with self.subTest(mutation=mutation):
                modified = deepcopy(snapshot)
                row = modified['artifacts'][1]
                if mutation == 'page': modified['transcriptCollectionComplete'] = False
                if mutation == 'error': row['transcript_fetch_error'] = 'Unavailable'
                if mutation == 'empty': row['transcript_text'] = ''
                if mutation == 'call': row['call_id'] = 'another-call'
                if mutation == 'undated':
                    for item in modified['artifacts']:
                        item.pop('created_datetime'); item.pop('end_datetime')
                if mutation == 'old':
                    for item in modified['artifacts']:
                        item.update(created_datetime='2025-01-01T10:00:00Z', end_datetime='2025-01-01T11:00:00Z')
                if mutation == 'recording':
                    for item in modified['artifacts']: item['artifact_type'] = 'recording'
                self.assertFalse(has_start_evidence(self.calendar, modified))

    def test_check_session_starts_on_complete_early_transcript_without_relaxing_end_gate(self):
        from .migrated_intelligence_views import migrated_review_check_session
        from .migrated_session_scope import booking_window
        local = timezone.localtime() - timedelta(minutes=10)
        self.calendar.scheduled_date, self.calendar.scheduled_time = local.date(), local.time().replace(tzinfo=None)
        start, _ = booking_window(self.calendar)
        snapshot = self.snapshot()
        snapshot['attendanceReports'] = []
        snapshot['artifacts'] = [{'artifact_type': 'transcript', 'graph_artifact_id': 'segment', 'call_id': 'call',
            'created_datetime': start.isoformat(), 'end_datetime': timezone.now().isoformat(), 'transcript_text': 'Synthetic content'}]
        request = RequestFactory().post('/', data='{}', content_type='application/json')
        handler = migrated_review_check_session
        while hasattr(handler, '__wrapped__'): handler = handler.__wrapped__
        with patch('coach_api.migrated_intelligence_views._association', return_value=(self.overlay, self.calendar, {})), \
             patch('coach_api.migrated_intelligence_views._checked_lock', return_value=(self.overlay, self.calendar, None)), \
             patch('coach_api.views.stored_coach_meeting_snapshot', return_value={'artifacts': [], 'storage': {'stored': True}}), \
             patch('coach_api.views.fetch_coach_meeting_graph_snapshot', return_value=(snapshot, None, 200)), \
             patch('django.db.transaction.atomic', return_value=nullcontext()), \
             patch('coach_api.views.persist_coach_meeting_snapshots') as persist, \
             patch('coach_api.views.openai_meeting_summary') as ai:
            response = handler(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['code'], 'MEETING_END_NOT_CONFIRMED')
        self.assertEqual(self.overlay.status, 'in-progress')
        self.assertEqual(self.overlay.answers, {'answer': 'Keep'})
        persist.assert_not_called()
        ai.assert_not_called()

    def test_psp_check_teams_evidence_starts_only_existing_scheduled_overlay(self):
        for status in ('scheduled', 'completed', 'awaiting-signature', None):
            for evidence in ('attendance', 'transcript'):
                with self.subTest(status=status, evidence=evidence), ExitStack() as stack:
                    self.setUp()
                    self.overlay.status = status or 'scheduled'
                    snapshot = self.snapshot()
                    if evidence == 'transcript':
                        report = snapshot['attendanceReports'].pop()
                        snapshot['artifacts'] = [{'artifact_type': 'transcript', 'graph_artifact_id': 'segment',
                            'call_id': 'call', 'created_datetime': report['meetingStartDateTime'],
                            'end_datetime': report['meetingEndDateTime'], 'transcript_text': 'Synthetic complete content'}]
                    previous = {'artifacts': [], 'attendanceReports': [], 'storage': {'stored': True}}
                    def mock(target, **kwargs): return stack.enter_context(patch(target, **kwargs))
                    mock('coach_api.views.coach_meeting_artifact_record', return_value=self.calendar)
                    mock('coach_api.views.coach_meeting_write_error', return_value=None)
                    mock('coach_api.views.fetch_coach_meeting_graph_snapshot', return_value=(snapshot, None, 200))
                    mock('coach_api.views.stored_coach_meeting_snapshot', return_value=previous)
                    mock('coach_api.views.apply_teams_attendance_status_transition', return_value=False)
                    mock('coach_api.views.ensure_coach_meeting_summary', return_value=None)
                    mock('coach_api.views.authenticated_coach_email', return_value=self.overlay.owner_email)
                    mock('django.db.transaction.atomic', return_value=nullcontext())
                    calendar = mock('coach_api.models.CoachCalendarEvent.objects')
                    calendar.using.return_value.select_for_update.return_value.get.return_value = self.calendar
                    overlays = mock('coach_api.models.ImportedReviewInstance.objects')
                    overlays.using.return_value.select_for_update.return_value.get.return_value = self.overlay
                    mock('coach_api.background_meeting_sync.imported_context', return_value={'family': 'PSP',
                         'overlayId': self.overlay.pk if status else None, 'completed': status == 'completed'})
                    persist = views.persist_coach_meeting_snapshots
                    mock('coach_api.views.persist_coach_meeting_snapshots', side_effect=lambda record, **kw:
                         persist(record, **kw) if kw.get('imported_refresh') else {'stored': True})
                    handler = views.coach_timetable_event_artifacts
                    while hasattr(handler, '__wrapped__'): handler = handler.__wrapped__
                    response = handler(RequestFactory().post('/'), self.calendar.event_key)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(self.overlay.status, 'in-progress' if status == 'scheduled' else status or 'scheduled')
                    self.assertEqual(self.overlay.answers, {'answer': 'Keep'})
                    overlays.create.assert_not_called()
                    if status != 'scheduled': self.overlay.save.assert_not_called()
