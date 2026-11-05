"""Read-only API tests. Use settings_sqlite_test; all DB/Graph reads are mocked."""
import json
from datetime import date, datetime, time, timezone
from types import SimpleNamespace
from threading import Barrier
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from django.db import DatabaseError
from django.db.models import Q
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve
from django.http import HttpResponse

from coach_api import recordings_api as api
from coach_api import recordings_media as media
from coach_api.recordings_cache import recent_read
from coach_api import views
from login import permissions
from login.identity import accesses_for_staff


OWNER = 'coach@example.invalid'
OTHER = 'other@example.invalid'
account_accesses = permissions._accesses_of


def meeting(event_id='event-1', email='learner@example.invalid'):
    return {'id': event_id, 'start': {'dateTime': '2026-10-20T09:00:00Z'},
            'end': {'dateTime': '2026-10-20T10:00:00Z'},
            'attendees': [{'emailAddress': {'address': email}}]}


def source_job(context=None, *, available=True):
    context = context or api.event_context(OWNER, meeting())
    return SimpleNamespace(state='idle', error_code='', result={'base': 'users/coach/onlineMeetings/meeting',
        'artifacts': [{'graph_artifact_id': 'file', 'artifact_type': 'recording',
            'created_datetime': context['start'], 'end_datetime': context['end'], 'sourceAvailable': available}]})


class CoachingRecordingsApiTests(SimpleTestCase):
    def test_lms_cancellation_survives_microsoft_outage_with_its_date_basis(self):
        self.bookings.return_value = [{'event_key': 'mcr:1', 'owner_email': OWNER, 'learner_id': 1,
            'event_type': 'mcr', 'status': 'not-scheduled', 'sync_state': 'cancelled',
            'scheduled_date': None, 'scheduled_time': None,
            'updated_at': datetime(2026, 10, 20, tzinfo=timezone.utc)}]
        self.graph.side_effect = RuntimeError('provider unavailable')
        response, data = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertTrue(data['partial'])
        self.assertEqual(data['cancelledBookings'][0]['sources'], ['lms'])
        self.assertEqual(data['cancelledBookings'][0]['dateBasis'], 'record-updated')
        self.assertIsNone(data['cancelledBookings'][0]['startsAt'])

    def setUp(self):
        cache.clear()
        self.enterContext(patch('coach_api.completion_status.completion_summary',return_value={'state':'unverified','source':'aptem'}))
        self.factory = RequestFactory()
        self.staff = SimpleNamespace(id=7, email=' COACH@example.invalid ', username='Coach',
                                     access='coach', access_extra='')
        self.account = SimpleNamespace(subject_id=7, subject_type='staff', role='staff',
                                       email='untrusted-account-cache@example.invalid')
        self.roster = [
            {'id': 1, 'email': 'learner@example.invalid', 'full_name': 'Learner One',
             'coach_email': OWNER, 'learner_type': 'apprenticeship'},
            {'id': 2, 'email': 'second@example.invalid', 'full_name': 'Learner Two',
             'coach_email': OTHER, 'learner_type': 'commercial'},
        ]
        self.directory = [{'email': OWNER, 'name': 'Coach'}, {'email': OTHER, 'name': 'Other'}]
        self.staff_read = self.enterContext(patch.object(api, '_staff', side_effect=lambda account: self.staff))
        self.coaches = self.enterContext(patch.object(api, '_coaches', return_value=self.directory))
        self.learners = self.enterContext(patch.object(api, '_learners', side_effect=lambda owner:
            self.roster if owner is None else [row for row in self.roster if row['coach_email'] == owner]))
        self.bookings = self.enterContext(patch.object(api, '_bookings', return_value=[]))
        self.roster_bookings = self.enterContext(patch.object(api, '_roster_bookings', return_value=[]))
        self.graph = self.enterContext(patch.object(api, 'load_coach_calendar', return_value=[]))
        self.lectures = self.enterContext(patch.object(api, 'lecture_occurrences', return_value=[]))
        self.sources = self.enterContext(patch.object(api, 'evidence_jobs', return_value={}))
        self.source_details = self.enterContext(patch.object(api, 'source_details', return_value=None))
        self.attendance_queue = self.enterContext(patch.object(api, 'queue_attendance', return_value=None))
        self.saved_evidence = self.enterContext(patch.object(api, '_saved_session_evidence', return_value=api.empty_evidence('not-found')))
        self.archive_inventory = self.enterContext(patch.object(media, 'archive_rows', side_effect=AssertionError('Azure inventory is forbidden')))
        self.azure_storage = self.enterContext(patch('curriculum_api.session_archive.storage_client', side_effect=AssertionError('Azure storage is forbidden')))
        self.azure_sign = self.enterContext(patch('learner_api.evidence_storage.get_read_sas', side_effect=AssertionError('Azure SAS is forbidden')))
        self.enterContext(patch.object(permissions, 'authenticate_request', side_effect=self.authenticate))
        self.grants = self.enterContext(patch.object(permissions, '_accesses_of',
            side_effect=lambda account: accesses_for_staff(self.staff)))
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def authenticate(self, request):
        request.login_account = self.account
        return self.account

    def get(self, **params):
        response = api.coaching_recordings_calendar(self.factory.get('/coach_api/coaching-recordings/calendar',
            {'start': '2026-10-01', 'end': '2026-10-31', **params}))
        return response, json.loads(response.content)

    def test_background_snapshot_does_not_wait_for_graph_and_keeps_pending_honest(self):
        self.staff.access = 'curriculum'
        with patch.object(api, '_bookings_many', return_value={OWNER: []}) as bookings, \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': None, 'pending': True, 'error': None, 'syncedAt': None}]), \
                patch.object(api, 'evidence_jobs', return_value={}):
            response, data = self.get(background='1', coachEmail=OWNER)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data['sync']['pending'])
        self.assertEqual(data['sync']['initialPendingCalendars'], 1)
        self.assertEqual(data['sync']['initialPendingEvidence'], 0)
        self.assertEqual(data['coverage']['checkedCoachEmails'], [])
        self.assertEqual(data['coverage']['nextOffset'], None)
        self.assertFalse(data['partial'])
        self.graph.assert_not_called()
        self.learners.assert_called_once_with(OWNER)
        bookings.assert_called_once()

    def test_background_source_recording_is_ready_without_azure_and_directory_is_not_repeated(self):
        self.staff.access = 'curriculum'
        event = {**meeting(), 'subject': 'Original coach conversation'}
        context = api.event_context(OWNER, event)
        source = SimpleNamespace(state='idle', error_code='', result={'artifacts': [{'graph_artifact_id': 'source-file',
            'created_datetime': context['start'], 'end_datetime': context['end'], 'sourceAvailable': True}]})
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': [event], 'pending': False, 'error': None, 'syncedAt': context['end']}]), \
                patch.object(api, 'evidence_jobs', return_value={api.calendar_key(context): source}):
            _, first = self.get(background='1', coachEmail=OWNER)
            row = first['meetings'][0]
            self.assertTrue(row['readyToAction'])
            self.assertEqual(row['media']['recordings'][0]['source'], 'microsoft')
            self.assertNotIn('archiveState', row['media']['recordings'][0])
            self.assertEqual(row['title'], event['subject'])
            _, second = self.get(background='1', coachEmail=OWNER, directoryHash=first['sync']['directoryHash'])
            self.assertTrue(second['sync']['directoryUnchanged'])
            self.assertEqual(second['learners'], [])
            self.assertEqual(second['coaches'], [])
            self.roster = []
            _, third = self.get(background='1', coachEmail=OWNER, directoryHash=first['sync']['directoryHash'])
            self.assertFalse(third['sync']['directoryUnchanged'])
            self.assertEqual(third['meetings'][0]['learnerIds'], [])
        self.graph.assert_not_called()

    def test_background_all_coaches_never_reads_azure_inventory_or_storage(self):
        self.staff.access = 'curriculum'
        snapshots = [{'events': [meeting(event_id=f'event-{index}')], 'pending': False, 'error': None,
                      'syncedAt': '2026-10-20T10:00:00Z'} for index in range(2)]
        with patch.object(api, '_bookings_many', return_value={OWNER: [], OTHER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=snapshots), \
                patch.object(api, 'evidence_jobs', return_value={}):
            response, data = self.get(background='1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(data['meetings']), 2)
        self.archive_inventory.assert_not_called()
        self.azure_storage.assert_not_called()
        self.azure_sign.assert_not_called()

    def test_unchanged_background_snapshot_returns_no_body_only_after_fresh_authorization(self):
        self.staff.access = 'curriculum'
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': [], 'pending': False, 'error': None, 'syncedAt': None}]):
            response, first = self.get(background='1', coachEmail=OWNER)
            request = self.factory.get('/calendar', {'start': '2026-10-01', 'end': '2026-10-31', 'background': '1', 'coachEmail': OWNER},
                HTTP_IF_NONE_MATCH=response['ETag'])
            unchanged = api.coaching_recordings_calendar(request)
            self.assertEqual(unchanged.status_code, 304)
            self.assertEqual(unchanged.content, b'')
            self.assertEqual(unchanged['ETag'], f'"{first["sync"]["version"]}"')
            self.staff.access = 'tutor'
            self.assertEqual(api.coaching_recordings_calendar(request).status_code, 403)

    def test_changed_roster_cannot_reuse_an_old_snapshot_etag(self):
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': [], 'pending': False, 'error': None, 'syncedAt': None}]):
            first, _ = self.get(background='1')
            self.roster = []
            response = api.coaching_recordings_calendar(self.factory.get('/calendar',
                {'start': '2026-10-01', 'end': '2026-10-31', 'background': '1'}, HTTP_IF_NONE_MATCH=first['ETag']))
        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response['ETag'], first['ETag'])
        self.assertEqual(json.loads(response.content)['learners'], [])

    def test_large_calendar_response_is_compressed_only_when_the_client_supports_it(self):
        import gzip
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': [meeting()], 'pending': False, 'error': None, 'syncedAt': None}]):
            response = api.coaching_recordings_calendar(self.factory.get('/calendar',
                {'start': '2026-10-01', 'end': '2026-10-31', 'background': '1'}, HTTP_ACCEPT_ENCODING='gzip'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Encoding'], 'gzip')
        data = json.loads(gzip.decompress(response.content))
        self.assertEqual(data['meetings'][0]['calendarEventId'], 'event-1')

    def test_opening_details_queues_only_that_occurrences_attendance(self):
        context = api.calendar_context(OWNER, 'external', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        with patch.object(api, 'saved_calendar_attendance', return_value={'state': 'pending', 'reportCount': 0, 'rows': []}):
            response = api.coaching_recording_session(self.factory.get('/session', {'reference': api.calendar_reference(context)}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.attendance_queue.call_args.args[0].graph_event_id, 'external')

    def test_evidence_metadata_preserves_availability_without_large_private_bodies(self):
        context=api.calendar_context(OWNER,'external','2026-10-20T09:00:00Z','2026-10-20T10:00:00Z')
        self.saved_evidence.return_value={**api.empty_evidence('matched'),
            'transcript':{'content':'Private transcript','durationSeconds':None,'updatedAt':None,'partCount':2},
            'analyses':[{'id':'report','status':'completed','report':{'summary':'Private analysis'}}]}
        response=api.coaching_recording_session(self.factory.get('/session',{'reference':api.calendar_reference(context),'part':'evidence','metadataOnly':'1'}))
        self.assertEqual(response.status_code,200);data=json.loads(response.content)['evidence']
        self.assertTrue(data['analyses'][0]['reportAvailable']);self.assertEqual(data['transcript']['partCount'],2)
        self.assertNotIn('content',data['transcript']);self.assertNotIn('report',data['analyses'][0])
        self.assertNotIn('Private',response.content.decode())

    def test_due_idle_evidence_keeps_polling_until_background_refresh_finishes(self):
        event = meeting()
        context = api.event_context(OWNER, event)
        job = SimpleNamespace(state='idle', error_code='', next_run_at=datetime(2000, 1, 1, tzinfo=timezone.utc), result={'artifacts': []})
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[{'events': [event], 'pending': False, 'error': None, 'syncedAt': context['end']}]), \
                patch.object(api, 'evidence_jobs', return_value={api.calendar_key(context): job}):
            _, data = self.get(background='1')
        self.assertTrue(data['sync']['pending'])
        self.assertEqual(data['sync']['pendingEvidence'], 1)
        self.assertEqual(data['sync']['initialPendingEvidence'], 1)

    def test_saved_results_refresh_without_being_counted_as_initial_loading(self):
        event = meeting()
        context = api.event_context(OWNER, event)
        source = source_job(context)
        source.last_success_at = datetime(2026, 10, 20, 11, tzinfo=timezone.utc)
        source.next_run_at = datetime(2000, 1, 1, tzinfo=timezone.utc)
        snapshots = [{'events': [event], 'pending': True, 'error': None, 'syncedAt': context['end']}]
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=snapshots), \
                patch.object(api, 'evidence_jobs', return_value={api.calendar_key(context): source}):
            for state in ('queued', 'running', 'idle'):
                source.state = state
                response, data = self.get(background='1')
                self.assertEqual(response.status_code, 200)
                # Preserve the old pending contract for existing clients.
                self.assertTrue(data['sync']['pending'])
                self.assertEqual(data['sync']['pendingCalendars'], 1)
                self.assertEqual(data['sync']['pendingEvidence'], 1)
                self.assertEqual(data['sync']['initialPendingCalendars'], 0)
                self.assertEqual(data['sync']['initialPendingEvidence'], 0)
                self.assertTrue(data['meetings'][0]['readyToAction'])
            saved_version = data['sync']['version']
            source.last_success_at = None
            _, first_check = self.get(background='1')
            self.assertEqual(first_check['sync']['initialPendingEvidence'], 1)
            self.assertNotEqual(first_check['sync']['version'], saved_version)
        self.graph.assert_not_called()

    def test_failed_initial_calendar_is_an_issue_not_endless_initial_loading(self):
        snapshot = {'events': None, 'pending': False,
                    'error': {'code': 'calendar_not_found', 'retryable': False}, 'syncedAt': None}
        with patch.object(api, '_bookings_many', return_value={OWNER: []}), \
                patch.object(api, 'calendar_snapshots', return_value=[snapshot]):
            response, data = self.get(background='1')
        self.assertEqual(response.status_code, 503)
        self.assertTrue(data['partial'])
        self.assertFalse(data['sync']['pending'])
        self.assertEqual(data['sync']['initialPendingCalendars'], 0)
        self.assertEqual(data['errors'][0]['code'], 'calendar_not_found')

    def test_direct_microsoft_delivery_is_owner_bound_scoped_and_range_capable(self):
        context = api.calendar_context(OWNER, 'external', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        reference = api.calendar_reference(context)
        artifact = {'graph_artifact_id': 'file', 'created_datetime': context['start'], 'end_datetime': context['end'], 'sourceAvailable': True}
        self.source_details.return_value = SimpleNamespace(result={'base': 'users/coach/onlineMeetings/meeting', 'artifacts': [artifact]})
        with patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch.object(views, 'microsoft_graph_request', return_value={'id': 'file', 'createdDateTime': context['start'], 'endDateTime': context['end']}) as graph, \
                patch('coach_api.recordings_transport.recording_response', return_value=HttpResponse(b'bytes', status=206)) as deliver:
            request = self.factory.get('/coach_api/coaching-recordings/recording', {'reference': reference, 'recordingId': 'file', 'preview': '1'}, HTTP_RANGE='bytes=0-63')
            response = api.coaching_recording_content(request)
            self.assertEqual(response.status_code, 206)
            self.assertEqual(deliver.call_args.kwargs['byte_range'], 'bytes=0-63')
            self.assertTrue(deliver.call_args.kwargs['preview'])
            self.staff.email = OTHER
            self.assertEqual(api.coaching_recording_content(request).status_code, 404)
            self.assertEqual(deliver.call_count, 1)
            self.assertEqual(graph.call_count, 1)

    def test_direct_source_identity_mismatch_never_starts_video_delivery(self):
        context = api.calendar_context(OWNER, 'external', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        self.source_details.return_value = SimpleNamespace(result={'base': 'users/coach/onlineMeetings/meeting', 'artifacts': [
            {'graph_artifact_id': 'file', 'created_datetime': context['start'], 'end_datetime': context['end']}]})
        with patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch.object(views, 'microsoft_graph_request', return_value={'id': 'foreign', 'createdDateTime': context['start'], 'endDateTime': context['end']}), \
                patch('coach_api.recordings_transport.recording_response') as deliver:
            request = self.factory.get('/coach_api/coaching-recordings/recording', {'reference': api.calendar_reference(context), 'recordingId': 'file'})
            self.assertEqual(api.coaching_recording_content(request).status_code, 409)
        deliver.assert_not_called()

    def test_source_details_are_reviewable_without_any_azure_dependency(self):
        context = api.calendar_context(OWNER, 'external', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        self.source_details.return_value = SimpleNamespace(error_code='', result={'artifacts': [
            {'graph_artifact_id': 'file', 'created_datetime': context['start'], 'end_datetime': context['end'], 'sourceAvailable': True}]})
        with patch.object(api, 'saved_calendar_attendance', return_value={'state': 'available', 'reportCount': 1, 'rows': []}):
            response = api.coaching_recording_session(self.factory.get('/coach_api/coaching-recordings/session',
                {'reference': api.calendar_reference(context)}))
        data = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(data['partial'])
        self.assertEqual(data['media']['readyCount'], 1)
        self.assertNotIn('archiveState', data['media']['recordings'][0])
        self.assertEqual(data['media']['recordings'][0]['source'], 'microsoft')
        self.archive_inventory.assert_not_called()
        self.azure_storage.assert_not_called()

    def test_recent_calendar_reuses_only_provider_read_and_rechecks_caseload_and_grants(self):
        self.graph.return_value = [meeting()]
        self.get(); self.get()
        self.assertEqual(self.graph.call_count, 1)
        self.assertEqual(self.learners.call_count, 2)
        self.assertEqual(self.staff_read.call_count, 2)
        self.roster = []
        _, data = self.get()
        self.assertEqual(data['learners'], [])
        self.assertEqual(data['meetings'][0]['learnerIds'], [])
        self.staff.access = 'tutor'
        self.assertEqual(self.get()[0].status_code, 403)
        self.assertEqual(self.graph.call_count, 1)

    def test_directory_is_authorised_and_available_without_waiting_for_any_provider_or_bookings(self):
        response, data = self.get(directoryOnly='1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['email'] for row in data['coaches']], [OWNER])
        self.assertEqual(data['learners'], [])
        self.learners.assert_not_called()
        self.assertEqual(data['meetings'], [])
        self.assertEqual(data['coverage'], {'checkedCoachEmails': [], 'totalCoaches': 1, 'nextOffset': 0})
        self.graph.assert_not_called(); self.bookings.assert_not_called(); self.sources.assert_not_called()
        self.assertEqual(self.get(directoryOnly='1', coachEmail=OTHER)[0].status_code, 404)

    def test_graph_failures_expose_only_safe_actionable_categories_and_preserve_incomplete_coverage(self):
        cases = [
            (404, 'MailboxNotEnabledForRESTAPI', 'calendar_mailbox_unavailable', False),
            (404, 'ErrorItemNotFound', 'calendar_not_found', False),
            (403, 'ErrorAccessDenied', 'calendar_access_denied', False),
            (401, 'InvalidAuthenticationToken', 'calendar_access_denied', False),
            (400, 'BadRequest', 'calendar_request_rejected', False),
            (429, 'TooManyRequests', 'calendar_throttled', True),
            (503, 'ServiceUnavailable', 'calendar_read_failed', True),
        ]
        for status, provider_code, code, retryable in cases:
            with self.subTest(status=status, provider_code=provider_code):
                error = RuntimeError(f'Private provider details code={provider_code}; mailbox=secret@example.invalid; token=private-token')
                error.__cause__ = HTTPError('https://graph.example.invalid/private-path', status, 'private-body', {}, None)
                self.graph.side_effect = error
                response, data = self.get(refresh='1')
                self.assertEqual(response.status_code, 503)
                self.assertEqual(data['errors'], [{'coachEmail': OWNER, 'code': code, 'retryable': retryable}])
                self.assertEqual(data['coverage']['checkedCoachEmails'], [])
                self.assertTrue(data['partial'])
                for secret in ('Private provider', 'private-token', 'secret@example.invalid', 'private-path'):
                    self.assertNotIn(secret, response.content.decode())

    def test_timeouts_are_distinguished_from_an_empty_calendar_and_can_be_retried(self):
        for cause in (TimeoutError('private timeout'), URLError(TimeoutError('private timeout'))):
            error = RuntimeError('private transport details'); error.__cause__ = cause
            self.graph.side_effect = error
            _, data = self.get()
            self.assertEqual(data['errors'][0]['code'], 'calendar_timeout')
            self.assertTrue(data['errors'][0]['retryable'])
            self.assertTrue(data['partial'])

    def test_provider_message_cannot_install_a_false_mailbox_diagnosis(self):
        error = RuntimeError('Microsoft Graph GET private failed: HTTP 404; code=ErrorItemNotFound; message=code=MailboxNotEnabledForRESTAPI')
        error.__cause__ = HTTPError('https://graph.example.invalid/private', 404, 'private', {}, None)
        self.graph.side_effect = error
        _, data = self.get()
        self.assertEqual(data['errors'][0]['code'], 'calendar_not_found')

    def test_refresh_bypasses_provider_cache_and_another_owner_cannot_reuse_it(self):
        self.get(); self.get(refresh='1')
        self.assertEqual(self.graph.call_count, 2)
        self.assertEqual(self.get(coachEmail=OTHER)[0].status_code, 404)
        self.assertEqual(self.graph.call_count, 2)
        self.get(start='2026-10-02')
        self.assertEqual(self.graph.call_count, 3)

    def test_provider_failures_are_recoverable_without_waiting_for_cache_expiry(self):
        self.graph.side_effect = [RuntimeError('unavailable'), []]
        self.assertEqual(self.get()[0].status_code, 503)
        self.assertEqual(self.get()[0].status_code, 200)
        self.assertEqual(self.graph.call_count, 2)

    def test_independent_coach_reads_overlap_without_running_database_reads_in_workers(self):
        self.staff.access = 'curriculum'
        barrier = Barrier(2)
        def read(*args):
            barrier.wait(timeout=3)
            return []
        self.graph.side_effect = read
        response, data = self.get(limit='2')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(data['coverage']['checkedCoachEmails']), {OWNER, OTHER})


    def roster_get(self, **params):
        response = api.coaching_recordings_learners(self.factory.get('/coach_api/coaching-recordings/learners',
            {'start': '2026-10-01', 'end': '2026-10-31', **params}))
        return response, json.loads(response.content)

    @staticmethod
    def roster_booking(**changes):
        return {'event_key': 'mcr:1', 'owner_email': OWNER, 'learner_id': 1, 'event_type': 'mcr',
            'target_date': date(2026, 10, 19), 'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10),
            'duration_minutes': 60, 'sequence': 1, 'status': 'awaiting-signature', 'sync_state': 'synced',
            'review_completed_at': None, 'updated_at': datetime(2026, 10, 21, tzinfo=timezone.utc), **changes}

    def test_learner_roster_route_uses_current_own_caseload_without_graph_or_media_calls(self):
        self.assertEqual(resolve('/coach_api/coaching-recordings/learners').func, api.coaching_recordings_learners)
        self.roster_bookings.return_value = [self.roster_booking()]
        response, data = self.roster_get(ownerEmail=OTHER, learnerIds='2', role='admin')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual((data['scope'], data['source'], data['coach']['email']), ('own', 'lms', OWNER))
        self.assertEqual([row['id'] for row in data['learners']], ['1'])
        self.assertEqual(data['learners'][0]['bookings'][0]['status'], 'awaiting-signature')
        self.assertEqual(data['learners'][0]['bookings'][0]['startsAt'], '2026-10-20T09:00:00+00:00')
        self.assertIsNone(data['learners'][0]['bookings'][0]['reviewCompletedAt'])
        self.assertEqual(self.roster_bookings.call_args.args[:2], (OWNER, [1]))
        self.graph.assert_not_called(); self.sources.assert_not_called()

    def test_learner_roster_does_not_guess_booking_or_review_completion_from_missing_records(self):
        _, data = self.roster_get()
        self.assertEqual(data['learners'][0]['bookings'], [])
        self.assertNotIn('progressPercent', data['learners'][0])
        self.assertEqual(data['coverage'], {'offset': 0, 'totalLearners': 1, 'nextOffset': None})

    def test_learner_roster_admin_requires_one_authorised_coach_and_supports_commercial_learner(self):
        for grant in ('curriculum', 'super-admin'):
            with self.subTest(grant=grant):
                self.staff.access = grant
                self.assertEqual(self.roster_get()[0].status_code, 400)
                self.assertEqual(self.roster_get(coachEmail='unknown@example.invalid')[0].status_code, 404)
                response, data = self.roster_get(coachEmail=OTHER)
                self.assertEqual(response.status_code, 200)
                self.assertEqual((data['scope'], data['coach']['email']), ('all', OTHER))
                self.assertEqual([(row['id'], row['learnerType']) for row in data['learners']], [('2', 'commercial')])

    def test_learner_roster_cannot_select_another_coach_or_use_a_stale_grant(self):
        self.assertEqual(self.roster_get(coachEmail=OTHER)[0].status_code, 404)
        self.grants.side_effect = None; self.grants.return_value = frozenset({'coach'})
        self.staff.access = ''
        self.assertEqual(self.roster_get()[0].status_code, 403)
        self.learners.assert_not_called(); self.roster_bookings.assert_not_called()

    def test_learner_roster_honours_secondary_coach_and_curriculum_grants(self):
        self.staff.access = 'tutor'; self.staff.access_extra = 'coach'
        self.assertEqual(self.roster_get()[1]['scope'], 'own')
        self.staff.access_extra = 'curriculum'
        response, data = self.roster_get(coachEmail=OTHER)
        self.assertEqual((response.status_code, data['scope'], data['learners'][0]['id']), (200, 'all', '2'))

    def test_learner_roster_refuses_anonymous_learner_employer_and_ungranted_staff(self):
        self.account = None
        self.assertEqual(self.roster_get()[0].status_code, 401)
        for role in ('learner', 'employer'):
            self.account = SimpleNamespace(role=role)
            self.assertEqual(self.roster_get()[0].status_code, 403)
        self.account = SimpleNamespace(role='staff', subject_type='staff', subject_id=7)
        self.staff.access = 'tutor'
        self.assertEqual(self.roster_get()[0].status_code, 403)
        self.roster_bookings.assert_not_called()

    def test_learner_roster_filters_transferred_learners_and_another_owners_booking(self):
        self.roster_bookings.return_value = [self.roster_booking(), self.roster_booking(event_key='other-owner', owner_email=OTHER),
            self.roster_booking(event_key='former-learner', learner_id=2)]
        _, data = self.roster_get()
        self.assertEqual([row['eventKey'] for row in data['learners'][0]['bookings']], ['mcr:1'])

    def test_learner_roster_preserves_any_saved_booking_type_and_unknown_status(self):
        self.roster_bookings.return_value = [self.roster_booking(event_type='custom-coaching', status='legacy-status')]
        _, data = self.roster_get()
        row = data['learners'][0]['bookings'][0]
        self.assertEqual((row['eventType'], row['status']), ('custom-coaching', 'legacy-status'))

    def test_learner_roster_distinguishes_planned_date_and_erased_cancellation_time(self):
        self.roster_bookings.return_value = [
            self.roster_booking(event_key='planned', status='not-scheduled', scheduled_date=None, scheduled_time=None),
            self.roster_booking(event_key='cancelled', status='not-scheduled', sync_state='cancelled',
                scheduled_date=None, scheduled_time=None, target_date=date(2025, 1, 1)),
        ]
        _, data = self.roster_get()
        planned, cancelled = data['learners'][0]['bookings']
        self.assertEqual((planned['startsAt'], planned['periodBasis']), (None, 'target'))
        self.assertEqual((cancelled['startsAt'], cancelled['periodBasis'], cancelled['cancelled']), (None, 'record-updated', True))
        self.assertIsNotNone(cancelled['recordUpdatedAt'])

    def test_learner_roster_excludes_out_of_period_booking_without_rewriting_status(self):
        self.roster_bookings.return_value = [self.roster_booking(scheduled_date=date(2025, 1, 1))]
        self.assertEqual(self.roster_get()[1]['learners'][0]['bookings'], [])

    def test_learner_roster_search_and_paging_keep_all_current_learners_even_without_bookings(self):
        self.roster.append({'id': 3, 'full_name': 'Third Learner', 'email': 'third@example.invalid',
                            'coach_email': OWNER, 'learner_type': 'commercial'})
        _, data = self.roster_get(limit='1')
        self.assertEqual(data['coverage'], {'offset': 0, 'totalLearners': 2, 'nextOffset': 1})
        self.assertEqual(data['learners'][0]['id'], '1')
        _, data = self.roster_get(limit='1', offset='1')
        self.assertEqual([row['id'] for row in data['learners']], ['3'])
        self.assertIsNone(data['coverage']['nextOffset'])
        _, data = self.roster_get(search='THIRD')
        self.assertEqual([row['id'] for row in data['learners']], ['3'])

    def test_learner_roster_database_failure_is_visible_not_an_empty_caseload(self):
        self.roster_bookings.side_effect = DatabaseError('private database details')
        response, data = self.roster_get()
        self.assertEqual((response.status_code, data['code']), (503, 'coaching_roster_unavailable'))
        self.assertNotIn('private database details', response.content.decode())
        self.assertNotIn('learners', data)

    def test_learner_roster_rejects_invalid_ranges_and_paging_before_reading_caseload(self):
        for params in ({'limit': '101'}, {'offset': '-1'}, {'start': 'bad'}, {'end': '2026-12-31'}, {'search': 'x' * 101}):
            self.assertEqual(self.roster_get(**params)[0].status_code, 400)
        self.learners.assert_not_called(); self.roster_bookings.assert_not_called()

    def test_learner_roster_is_get_only(self):
        self.assertEqual(api.coaching_recordings_learners(self.factory.post('/coach_api/coaching-recordings/learners')).status_code, 405)

    def test_route_is_registered_without_changing_timetable_endpoints(self):
        self.assertEqual(resolve('/coach_api/coaching-recordings/calendar').func, api.coaching_recordings_calendar)

    def test_coach_uses_fresh_server_email_and_own_caseload(self):
        response, data = self.get(ownerEmail=OTHER, role='admin')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(data['scope'], 'own')
        self.assertEqual([row['id'] for row in data['learners']], ['1'])
        self.assertEqual(data['coaches'], [{'email': OWNER, 'name': 'Coach'}])
        self.learners.assert_called_once_with(OWNER)
        self.assertEqual(self.graph.call_args.args[0], OWNER)
        self.coaches.assert_not_called()

    def test_coach_cannot_select_other_mailbox(self):
        response, _ = self.get(coachEmail=OTHER)
        self.assertEqual(response.status_code, 404)
        self.graph.assert_not_called()
        self.bookings.assert_not_called()

    def test_own_calendar_keeps_any_meeting_title_when_no_learner_or_lms_booking_is_linked(self):
        self.learners.side_effect = lambda owner: []
        self.graph.return_value = [{**meeting(), 'subject': 'Internal planning and coaching', 'attendees': []}]
        response, data = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['scope'], 'own')
        self.graph.assert_called_once()
        self.assertEqual(self.graph.call_args.args[0], OWNER)
        self.assertEqual(len(data['meetings']), 1)
        row = data['meetings'][0]
        self.assertEqual(row['title'], 'Internal planning and coaching')
        self.assertEqual((row['eventKey'], row['learnerIds'], row['media']['state'], row['readyToAction']),
                         (None, [], 'pending', True))
        self.assertEqual(api.read_reference(row['recordingsReference'])['owner'], OWNER)

    def test_any_calendar_meeting_can_be_ready_and_open_saved_attendance_without_a_native_booking(self):
        self.graph.return_value = [{**meeting(), 'subject': 'Support, planning and progress', 'attendees': []}]
        self.sources.side_effect = lambda contexts: {api.calendar_key(ctx): source_job(ctx) for ctx in contexts}
        with patch.object(api, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 21, tzinfo=timezone.utc)
            _, data = self.get()
        row = data['meetings'][0]
        self.assertTrue(row['readyToAction']); self.assertIsNone(row['eventKey'])
        self.assertEqual(row['match'], 'external')
        self.graph.reset_mock()
        attendance = {'state': 'available', 'reportCount': 1, 'rows': [{'name': 'Actual Participant', 'status': 'attended'}]}
        with patch.object(api, 'saved_calendar_attendance', return_value=attendance) as saved:
            response = api.coaching_recording_session(self.factory.get('/session', {'reference': row['recordingsReference']}))
        self.assertEqual(response.status_code, 200)
        detail = json.loads(response.content)
        self.assertEqual(detail['reference'], row['recordingsReference'])
        self.assertTrue(detail['eventKey'].startswith('coach-calendar:'))
        self.assertEqual(detail['attendance'], attendance)
        self.assertIsNone(saved.call_args.args[0].learner_id)
        self.graph.assert_not_called()

    def test_published_recording_is_ready_before_scheduled_end_without_changing_calendar_phase(self):
        self.graph.return_value = [meeting()]
        self.sources.side_effect = lambda contexts: {api.calendar_key(ctx): source_job(ctx) for ctx in contexts}
        with patch.object(api, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026,10,20,9,30,tzinfo=timezone.utc)
            response, data = self.get()
        self.assertEqual(response.status_code,200)
        row = data['meetings'][0]
        self.assertEqual(row['phase'],'in-progress')
        self.assertTrue(row['readyToAction'])
        self.assertEqual(row['media']['readyCount'],1)
        attendance = {'state':'available','reportCount':1,'rows':[]}
        with patch.object(api, 'saved_calendar_attendance', return_value=attendance):
            response=api.coaching_recording_session(self.factory.get('/session',{'reference':row['recordingsReference'],'part':'attendance'}))
        self.assertEqual(response.status_code,200)
        self.assertTrue(self.source_details.call_args.kwargs['discover'])

    def test_every_category_with_verified_recording_opens_attendance_in_ready_without_booking_or_ai_dependency(self):
        self.graph.return_value = [{**meeting(), 'subject': 'Synthetic calendar appointment', 'attendees': []}]
        self.sources.side_effect = lambda contexts: {api.calendar_key(ctx): source_job(ctx) for ctx in contexts}
        attendance = {'state': 'available', 'reportCount': 1, 'rows': [{'name': 'Synthetic Participant', 'status': 'attended', 'totalAttendanceSeconds': 755}]}
        for kind in ('MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'):
            with self.subTest(category=kind), patch.object(api, 'category', return_value=(kind, 'calendar-title')), \
                    patch.object(api, 'datetime', wraps=datetime) as clock, \
                    patch.object(api, 'saved_calendar_attendance', return_value=attendance):
                clock.now.return_value = datetime(2026, 10, 21, tzinfo=timezone.utc)
                self.graph.reset_mock()
                response, data = self.get()
                self.assertEqual(response.status_code, 200)
                row = data['meetings'][0]
                self.assertEqual(row['category'], kind)
                self.assertTrue(row['readyToAction'])
                self.assertIsNone(row['eventKey'])
                self.source_details.return_value = source_job()
                self.graph.reset_mock()
                response = api.coaching_recording_session(self.factory.get('/session', {'reference': row['recordingsReference'], 'part': 'attendance'}))
                detail = json.loads(response.content)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(detail['media']['readyCount'], 1)
                self.assertEqual(detail['attendance'], attendance)
                self.graph.assert_not_called()
                self.saved_evidence.assert_not_called()
                self.attendance_queue.assert_not_called()

    def test_all_ended_categories_are_ready_even_before_recording_or_attendance_discovery(self):
        self.graph.return_value = [{**meeting(), 'subject': 'Synthetic calendar appointment', 'attendees': []}]
        for kind in ('MCM', 'PR', 'SUPPORT', 'OTHER', 'LECTURE'):
            with self.subTest(category=kind), patch.object(api, 'category', return_value=(kind, 'calendar-title')), \
                    patch.object(api, 'datetime', wraps=datetime) as clock:
                clock.now.return_value = datetime(2026, 10, 21, tzinfo=timezone.utc)
                response, data = self.get()
                self.assertEqual(response.status_code, 200)
                row = data['meetings'][0]
                self.assertEqual(row['category'], kind)
                self.assertEqual(row['phase'], 'ended')
                self.assertTrue(row['readyToAction'])
                self.assertEqual(row['media']['readyCount'], 0)
                self.assertEqual(row['media']['state'], 'pending')
                self.assertIsNone(row['eventKey'])
                self.saved_evidence.assert_not_called()
                self.attendance_queue.assert_not_called()

    def test_a_failed_recheck_retains_ready_parts_but_never_claims_complete_evidence(self):
        saved = source_job()
        saved.error_code = 'evidence_unavailable'
        self.source_details.return_value = saved
        attendance = {'state': 'available', 'reportCount': 1, 'rows': []}
        reference = api.calendar_reference(api.event_context(OWNER, meeting()))
        with patch.object(api, 'saved_calendar_attendance', return_value=attendance):
            response = api.coaching_recording_session(self.factory.get('/session', {'reference': reference, 'part': 'attendance'}))
        detail = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(detail['partial'])
        self.assertEqual(detail['media']['check']['state'], 'failed')
        self.assertEqual(detail['media']['readyCount'], 1)
        self.assertEqual(detail['attendance']['state'], 'available')
        self.graph.assert_not_called()

    def test_calendar_reference_rechecks_owner_grants_and_cannot_be_used_for_another_event_key(self):
        token = api.calendar_reference(api.calendar_context(OTHER, 'event', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'))
        self.assertEqual(api.coaching_recording_session(self.factory.get('/session', {'reference': token})).status_code, 404)
        own = api.calendar_reference(api.calendar_context(OWNER, 'event', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'))
        self.assertEqual(api.coaching_recording_session(self.factory.get('/session', {'reference': own, 'eventKey': 'mcr:1'})).status_code, 404)
        self.assertEqual(api.coaching_recording_session(self.factory.get('/session', {'reference': own + 'changed'})).status_code, 400)
        self.grants.side_effect = None; self.grants.return_value = frozenset({'coach'})
        self.staff.access = 'tutor'
        self.assertEqual(api.coaching_recording_session(self.factory.get('/session', {'reference': own})).status_code, 403)
        self.sources.assert_not_called()

    def test_curriculum_can_download_another_coachs_verified_microsoft_recording(self):
        self.staff.access = 'curriculum'
        context = api.calendar_context(OTHER, 'event', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        self.source_details.return_value = source_job(context)
        with patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch.object(views, 'microsoft_graph_request', return_value={'id': 'file', 'createdDateTime': context['start'], 'endDateTime': context['end']}), \
                patch('coach_api.recordings_transport.recording_response', return_value=HttpResponse(b'bytes', status=206)) as deliver:
            response = api.coaching_recording_content(self.factory.get('/recording', {'reference': api.calendar_reference(context), 'recordingId': 'file'}))
        self.assertEqual(response.status_code, 206)
        self.assertFalse(deliver.call_args.kwargs['preview'])
        self.azure_sign.assert_not_called()
        self.azure_storage.assert_not_called()

    def test_external_recording_from_another_date_cannot_be_downloaded_with_this_calendar_reference(self):
        context = api.calendar_context(OWNER, 'event', '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z')
        old = {**context, 'start': '2026-10-19T09:00:00Z', 'end': '2026-10-19T10:00:00Z'}
        self.source_details.return_value = source_job(old)
        with patch('coach_api.recordings_transport.recording_response') as deliver:
            response = api.coaching_recording_content(self.factory.get('/recording', {'reference': api.calendar_reference(context), 'recordingId': 'file'}))
        self.assertEqual(response.status_code, 409)
        deliver.assert_not_called()
        self.azure_sign.assert_not_called()

    def test_coach_cannot_probe_out_of_caseload_learner(self):
        for learner_id in ('2', '999'):
            response, data = self.get(learnerId=learner_id)
            self.assertEqual((response.status_code, data['code']), (404, 'not_found'))
        self.graph.assert_not_called()

    def test_curriculum_and_super_admin_can_read_all_coaches_and_learner_types(self):
        for access in ('curriculum', 'super-admin'):
            with self.subTest(access=access):
                self.staff.access = access
                response, data = self.get()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(data['scope'], 'all')
                self.assertEqual({row['learnerType'] for row in data['learners']}, {'apprenticeship', 'commercial'})
                self.assertEqual(data['coverage']['checkedCoachEmails'], [OWNER, OTHER])
        self.assertTrue(all(call.args == (None,) for call in self.learners.call_args_list))

    def test_secondary_curriculum_grant_gives_explicit_all_access(self):
        self.staff.access_extra = 'curriculum'
        response, data = self.get()
        self.assertEqual((response.status_code, data['scope']), (200, 'all'))

    def test_secondary_coach_grant_is_own_scope(self):
        self.staff.access, self.staff.access_extra = 'tutor', 'coach'
        response, data = self.get()
        self.assertEqual((response.status_code, data['scope']), (200, 'own'))

    def test_unauthenticated_and_non_staff_roles_are_refused_before_data_reads(self):
        self.account = None
        response, _ = self.get()
        self.assertEqual(response.status_code, 401)
        for role in ('learner', 'employer'):
            self.account = SimpleNamespace(role=role)
            response, _ = self.get()
            self.assertEqual(response.status_code, 403)
        self.staff_read.assert_not_called()
        self.graph.assert_not_called()

    def test_other_staff_grants_are_refused(self):
        for access in ('enrolment', 'tutor', ''):
            self.staff.access = access
            response, _ = self.get()
            self.assertEqual(response.status_code, 403)
        self.graph.assert_not_called()

    def test_real_access_gate_reads_secondary_grant_from_staff_database(self):
        self.staff.access, self.staff.access_extra = 'tutor', 'coach'
        with patch.object(permissions, '_accesses_of', account_accesses), \
                patch.object(api.StaffUser.objects, 'filter') as query:
            query.return_value.only.return_value.first.return_value = self.staff
            response, data = self.get()
        self.assertEqual((response.status_code, data['scope']), (200, 'own'))
        query.assert_called_once_with(pk=7)

    def test_real_access_gate_does_not_trust_an_admin_role_without_grants(self):
        self.account.role = 'admin'
        self.staff.access = 'tutor'
        with patch.object(permissions, '_accesses_of', account_accesses), \
                patch.object(api.StaffUser.objects, 'filter') as query:
            query.return_value.only.return_value.first.return_value = self.staff
            response, _ = self.get()
        self.assertEqual(response.status_code, 403)
        self.staff_read.assert_not_called()
        self.graph.assert_not_called()

    def test_revoked_grant_during_request_fails_closed(self):
        self.grants.side_effect = None
        self.grants.return_value = frozenset({'coach'})
        self.staff.access = ''
        response, _ = self.get()
        self.assertEqual(response.status_code, 403)
        self.graph.assert_not_called()

    def test_missing_staff_or_email_fails_closed(self):
        self.grants.side_effect = None
        self.grants.return_value = frozenset({'coach'})
        self.staff_read.side_effect = None
        self.staff_read.return_value = None
        self.assertEqual(self.get()[0].status_code, 403)
        self.staff_read.return_value = self.staff
        self.staff.email = ''
        self.assertEqual(self.get()[0].status_code, 403)
        self.graph.assert_not_called()

    def test_date_and_pagination_validation_happens_before_data_reads(self):
        for params in ({'end': '2026-11-01'}, {'start': '2026-11-01'}, {'timeZone': 'unknown'},
                       {'start': 'invalid'}, {'offset': '-1'}, {'limit': '11'}, {'limit': '0'},
                       {'learnerId': '-1'}, {'learnerId': 'not-an-id'}):
            with self.subTest(params=params):
                response, _ = self.get(**params)
                self.assertEqual(response.status_code, 400)
        self.graph.assert_not_called()
        self.staff_read.assert_not_called()

    def test_autumn_31_day_range_preserves_business_timezone(self):
        response, _ = self.get()
        self.assertEqual(response.status_code, 200)
        _, start, end = self.graph.call_args.args
        self.assertEqual(start, datetime(2026, 9, 30, 23, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 11, 1, tzinfo=timezone.utc))

    def test_coach_pages_have_explicit_coverage_and_next_offset(self):
        self.staff.access = 'curriculum'
        response, data = self.get(limit='1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['coverage'], {'checkedCoachEmails': [OWNER], 'totalCoaches': 2, 'nextOffset': 1})
        self.graph.assert_called_once()
        _, data = self.get(offset='1', limit='1')
        self.assertEqual(data['coverage'], {'checkedCoachEmails': [OTHER], 'totalCoaches': 2, 'nextOffset': None})

    def test_learner_filter_only_returns_selected_learners_meetings(self):
        self.staff.access = 'curriculum'
        self.graph.return_value = [meeting(), meeting('event-2', 'second@example.invalid')]
        response, data = self.get(coachEmail=OWNER, learnerId='2')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['calendarEventId'] for row in data['meetings']], ['event-2'])
        self.assertEqual(data['meetings'][0]['learnerIds'], ['2'])

    def test_failing_one_coach_retains_other_results_and_reports_partial(self):
        self.staff.access = 'curriculum'
        self.graph.side_effect = [RuntimeError('private token and provider body'), [meeting()]]
        response, data = self.get()
        self.assertEqual(response.status_code, 207)
        self.assertTrue(data['partial'])
        self.assertEqual(data['coverage']['checkedCoachEmails'], [OTHER])
        self.assertEqual(data['errors'], [{'coachEmail': OWNER, 'code': 'calendar_read_failed', 'retryable': True}])
        self.assertNotIn('private token', response.content.decode())
        self.assertEqual(len(data['meetings']), 1)

    def test_failed_calendar_never_reports_lms_bookings_as_missing(self):
        self.graph.side_effect = RuntimeError('private details')
        response, data = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertTrue(data['partial'])
        self.assertEqual(data['lmsOnly'], [])

    def test_incomplete_calendar_is_visible_as_partial(self):
        self.graph.return_value = [None]
        response, data = self.get()
        self.assertEqual(response.status_code, 207)
        self.assertEqual(data['errors'][0]['code'], 'calendar_incomplete')
        self.assertEqual(data['lmsOnly'], [])

    def test_database_failure_is_not_empty_success_or_external_fetch(self):
        self.learners.side_effect = DatabaseError('private connection string')
        response, data = self.get()
        self.assertEqual((response.status_code, data['code']), (503, 'coaching_calendar_unavailable'))
        self.assertNotIn('private connection', response.content.decode())
        self.graph.assert_not_called()

    def test_native_booking_mismatch_and_lms_only_are_scoped(self):
        self.bookings.return_value = [{
            'event_key': 'mcr:1:1', 'owner_email': OWNER, 'learner_id': 1,
            'event_type': 'mcr', 'graph_event_id': 'event-1', 'meeting_link': '',
            'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10),
            'duration_minutes': 60, 'status': 'scheduled', 'sync_state': 'synced'}]
        response, data = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['lmsOnly'][0]['coachEmail'], OWNER)
        self.assertEqual(data['lmsOnly'][0]['eventKey'], 'mcr:1:1')

    def test_endpoint_is_read_only(self):
        response = api.coaching_recordings_calendar(self.factory.post('/coach_api/coaching-recordings/calendar'))
        self.assertEqual(response.status_code, 405)
        self.staff_read.assert_not_called()
        self.graph.assert_not_called()

    def media_get(self, view, **params):
        request = self.factory.get('/coach_api/coaching-recordings/session', {'eventKey': 'mcr:1', **params})
        return view(request)

    def record(self, **changes):
        return SimpleNamespace(**{'event_key': 'mcr:1', 'owner_email': OWNER, 'learner_id': 1,
            'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10), 'duration_minutes': 60, **changes})

    def test_details_read_stored_attendance_without_refresh_or_writes(self):
        snapshot = {'storage': {'stored': True, 'syncedAt': '2026-10-20T12:00:00Z'}, 'partial': False,
            'attendanceReports': [{'meetingStartDateTime': '2026-10-20T09:00:00Z', 'meetingEndDateTime': '2026-10-20T10:00:00Z'}],
            'attendance': {'reportCount': 1, 'tracker': [{'name': 'Learner One', 'status': 'attended',
                'totalAttendanceSeconds': 600, 'private_raw_data': 'do not return'}]}}
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value=snapshot) as read:
            query.return_value.first.return_value = self.record()
            response = self.media_get(api.coaching_recording_session, refresh='1')
        data = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['attendance']['state'], 'available')
        self.assertEqual(data['attendance']['rows'][0]['status'], 'attended')
        self.assertNotIn('private_raw_data', response.content.decode())
        read.assert_called_once()
        self.graph.assert_not_called()

    def test_details_and_content_refuse_foreign_coach_before_reading_files(self):
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(api, 'source_details') as files, patch.object(views, 'stored_coach_meeting_snapshot') as snapshot:
            query.return_value.first.return_value = self.record(owner_email=OTHER)
            for view in (api.coaching_recording_session, api.coaching_recording_content):
                self.assertEqual(self.media_get(view).status_code, 404)
            files.assert_not_called()
            snapshot.assert_not_called()

    def test_transferred_learner_is_not_readable_by_former_coach(self):
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query:
            query.return_value.first.return_value = self.record(learner_id=2)
            self.assertEqual(self.media_get(api.coaching_recording_content).status_code, 404)

    def test_curriculum_can_read_other_coach_session_and_missing_report_stays_pending(self):
        self.staff.access = 'curriculum'
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value={
                    'storage': {'stored': True}, 'attendance': {'reportCount': 0, 'tracker': []}}):
            query.return_value.first.return_value = self.record(owner_email=OTHER, learner_id=2)
            response = self.media_get(api.coaching_recording_session)
        self.assertEqual(json.loads(response.content)['attendance']['state'], 'pending')

    def test_coach_can_read_own_commercial_learners_session(self):
        self.staff.email = OTHER
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value={
                    'storage': {'stored': True}, 'attendance': {'reportCount': 0, 'tracker': []}}):
            query.return_value.first.return_value = self.record(owner_email=OTHER, learner_id=2)
            response = self.media_get(api.coaching_recording_session)
        self.assertEqual(response.status_code, 200)
        self.learners.assert_called_once_with(OTHER)

    def test_missing_snapshot_is_unavailable_not_absent(self):
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value={'storage': {'stored': False}}):
            query.return_value.first.return_value = self.record()
            data = json.loads(self.media_get(api.coaching_recording_session).content)
        self.assertEqual(data['attendance']['state'], 'unavailable')
        self.assertTrue(data['partial'])

    def test_recording_id_must_belong_to_authorised_session(self):
        self.source_details.return_value = source_job()
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query:
            query.return_value.first.return_value = self.record(graph_event_id='event-1')
            self.assertEqual(self.media_get(api.coaching_recording_content, recordingId='foreign-file').status_code, 404)
        self.azure_sign.assert_not_called()

    def test_native_preview_and_download_recheck_microsoft_identity_without_any_azure_redirect(self):
        self.source_details.return_value = source_job()
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch.object(views, 'microsoft_graph_request', return_value={'id': 'file', 'createdDateTime': '2026-10-20T09:00:00Z', 'endDateTime': '2026-10-20T10:00:00Z'}) as graph, \
                patch('coach_api.recordings_transport.recording_response', return_value=HttpResponse(b'bytes', status=206)) as deliver:
            query.return_value.first.return_value = self.record(graph_event_id='event-1')
            for preview in ('1', '0'):
                response = self.media_get(api.coaching_recording_content, recordingId='file', preview=preview)
                self.assertEqual(response.status_code, 206)
                self.assertNotIn('Location', response)
                self.assertEqual(deliver.call_args.kwargs['preview'], preview == '1')
            self.assertEqual(graph.call_count, 1)
            self.assertEqual(deliver.call_count, 2)
        self.archive_inventory.assert_not_called()
        self.azure_storage.assert_not_called()
        self.azure_sign.assert_not_called()

    def test_unavailable_microsoft_recording_never_falls_back_to_an_azure_copy(self):
        self.source_details.return_value = source_job()
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch.object(views, 'microsoft_graph_request', side_effect=RuntimeError('Microsoft unavailable')), \
                patch('coach_api.recordings_transport.recording_response') as deliver:
            query.return_value.first.return_value = self.record(graph_event_id='event-1')
            response = self.media_get(api.coaching_recording_content, recordingId='file')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('Location', response)
        deliver.assert_not_called()
        self.azure_storage.assert_not_called()
        self.azure_sign.assert_not_called()

    def test_same_link_other_days_recording_is_not_downloadable(self):
        old = api.calendar_context(OWNER, 'event-1', '2026-10-13T09:00:00Z', '2026-10-13T10:00:00Z')
        self.source_details.return_value = source_job(old)
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch('coach_api.recordings_transport.recording_response') as deliver:
            query.return_value.first.return_value = self.record(graph_event_id='event-1')
            response = self.media_get(api.coaching_recording_content, recordingId='file')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['code'], 'recording_session_mismatch')
        deliver.assert_not_called()
        self.azure_sign.assert_not_called()

    def test_reused_link_attendance_uses_only_the_current_sessions_report(self):
        snapshot = {'storage': {'stored': True}, 'attendance': {'reportCount': 2,
            'expectedAttendees': [{'email': 'learner@example.invalid', 'displayName': 'Learner One'}],
            'tracker': [{'name': 'Incorrect combined time', 'totalAttendanceSeconds': 4200}]},
            'attendanceReports': [
                {'meetingStartDateTime': '2026-10-13T09:00:00Z', 'meetingEndDateTime': '2026-10-13T10:00:00Z',
                 'records': [{'email': 'learner@example.invalid', 'attended': True, 'totalAttendanceSeconds': 3600}]},
                {'meetingStartDateTime': '2026-10-20T09:00:00Z', 'meetingEndDateTime': '2026-10-20T10:00:00Z',
                 'records': [{'email': 'learner@example.invalid', 'attended': True, 'totalAttendanceSeconds': 600}]},
            ]}
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value=snapshot):
            query.return_value.first.return_value = self.record()
            data = json.loads(self.media_get(api.coaching_recording_session).content)
        self.assertEqual(data['attendance']['state'], 'available')
        self.assertEqual(data['attendance']['reportCount'], 1)
        self.assertEqual(data['attendance']['rows'][0]['totalAttendanceSeconds'], 600)
        self.assertEqual(snapshot['attendance']['tracker'][0]['totalAttendanceSeconds'], 4200)

    def test_unknown_report_dates_cannot_publish_absence(self):
        snapshot = {'storage': {'stored': True}, 'attendance': {'reportCount': 1,
            'tracker': [{'name': 'Learner One', 'status': 'absent'}]}, 'attendanceReports': [{}]}
        with patch.object(api.CoachCalendarEvent.objects, 'filter') as query, \
                patch.object(views, 'stored_coach_meeting_snapshot', return_value=snapshot):
            query.return_value.first.return_value = self.record()
            data = json.loads(self.media_get(api.coaching_recording_session).content)
        self.assertEqual(data['attendance']['state'], 'unavailable')
        self.assertEqual(data['attendance']['rows'], [])

    def test_media_endpoints_reject_ungranted_roles_and_writes(self):
        for view in (api.coaching_recording_session, api.coaching_recording_content):
            self.account.role = 'learner'
            self.assertEqual(self.media_get(view).status_code, 403)
            self.account.role = 'staff'
            self.assertEqual(view(self.factory.post('/coach_api/coaching-recordings/session')).status_code, 405)

    def test_ended_meeting_stays_ready_for_review_when_microsoft_recording_is_unavailable(self):
        self.bookings.return_value = [{'event_key': 'mcr:1', 'owner_email': OWNER, 'learner_id': 1,
            'event_type': 'mcr', 'graph_event_id': 'event-1', 'meeting_link': '',
            'scheduled_date': date(2026, 10, 20), 'scheduled_time': time(10),
            'duration_minutes': 60, 'status': 'scheduled', 'sync_state': 'synced'}]
        self.graph.return_value = [meeting()]
        self.sources.side_effect = None
        context = api.event_context(OWNER, meeting())
        self.sources.return_value = {api.calendar_key(context): source_job(context)}
        data = self.get()[1]
        self.assertTrue(data['meetings'][0]['readyToAction'])
        self.sources.return_value = {api.calendar_key(context): source_job(context, available=False)}
        response, data = self.get()
        self.assertEqual(response.status_code, 207)
        self.assertTrue(data['meetings'][0]['readyToAction'])
        self.assertEqual(data['meetings'][0]['media']['readyCount'], 0)
        self.assertEqual(data['errors'][0]['code'], 'recordings_incomplete')


class CoachingArchiveInventoryTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_recent_inventory_reuses_ready_head_but_details_and_refresh_recheck_it(self):
        start, end = datetime(2026, 10, 20, 9, tzinfo=timezone.utc), datetime(2026, 10, 20, 10, tzinfo=timezone.utc)
        row = {'event_key': 'mcr:1', 'id': 'file', 'container': 'private', 'blob': 'file.mp4', 'size': 50,
               'uploadedAt': start, 'startsAt': start, 'endsAt': end}
        with patch.object(media, 'archive_rows', return_value=[row]), patch.object(media, 'recording_state', return_value='ready') as head:
            for _ in range(2):
                self.assertEqual(media.recording_summaries(['mcr:1'], windows={'mcr:1': (start, end)}, recent=True)['mcr:1']['readyCount'], 1)
            self.assertEqual(head.call_count, 1)
            media.recording_summaries(['mcr:1'], windows={'mcr:1': (start, end)})
            self.assertEqual(head.call_count, 2)
            head.return_value = 'missing'
            self.assertEqual(media.recording_summaries(['mcr:1'], windows={'mcr:1': (start, end)}, recent=True, refresh=True)['mcr:1']['readyCount'], 0)
            media.recording_summaries(['mcr:1'], windows={'mcr:1': (start, end)}, recent=True)
            self.assertEqual(head.call_count, 4)

    def test_evicted_reads_reload_and_cache_outage_never_hides_the_provider_result(self):
        from unittest.mock import Mock
        load = Mock(return_value=['a'])
        self.assertEqual(recent_read('test', ['owner', 'window'], load), ['a'])
        recent_read('test', ['owner', 'window'], load)
        self.assertEqual(load.call_count, 1)
        cache.clear()
        recent_read('test', ['owner', 'window'], load)
        self.assertEqual(load.call_count, 2)
        with patch('coach_api.recordings_cache.cache.get', side_effect=RuntimeError('cache unavailable')), \
                patch('coach_api.recordings_cache.cache.set', side_effect=RuntimeError('cache unavailable')):
            self.assertEqual(recent_read('test', 'other-owner', load), ['a'])

    def test_archive_query_is_read_only_and_parameterised_by_session(self):
        with patch.object(media, 'blob_columns_ready', return_value=True), \
                patch.object(media.router, 'db_for_read', return_value='default'), \
                patch.object(media.connections['default'], 'cursor') as connection:
            cursor = connection.return_value.__enter__.return_value
            cursor.fetchall.return_value = []
            self.assertEqual(media.archive_rows(['mcr:1']), [])
        sql, params = cursor.execute.call_args.args
        self.assertTrue(sql.strip().startswith('SELECT'))
        self.assertIn('event_key=ANY(%s)', sql)
        self.assertEqual(params, [['mcr:1']])

    def test_another_occurrences_recording_cannot_become_ready_even_if_saved_under_same_key(self):
        row = {'event_key': 'mcr:1', 'id': 'old-recording', 'startsAt': datetime(2026, 10, 13, 9, tzinfo=timezone.utc),
               'endsAt': datetime(2026, 10, 13, 10, tzinfo=timezone.utc)}
        window = (datetime(2026, 10, 20, 9, tzinfo=timezone.utc), datetime(2026, 10, 20, 10, tzinfo=timezone.utc))
        with patch.object(media, 'archive_rows', return_value=[row]), patch.object(media, 'recording_state') as verify:
            result = media.recording_summaries(['mcr:1'], windows={'mcr:1': window})
        self.assertEqual(result['mcr:1']['readyCount'], 0)
        self.assertEqual(result['mcr:1']['recordings'], [])
        verify.assert_not_called()

    def test_early_recording_that_overlaps_session_is_valid_but_unknown_dates_need_review(self):
        window = (datetime(2026, 10, 20, 9, tzinfo=timezone.utc), datetime(2026, 10, 20, 10, tzinfo=timezone.utc))
        self.assertTrue(media.in_session_window('2026-10-20T08:45:00Z', '2026-10-20T10:05:00Z', window))
        self.assertFalse(media.in_session_window('2026-10-20T08:00:00Z', '2026-10-20T08:30:00Z', window))
        self.assertIsNone(media.in_session_window(None, None, window))

    def test_ready_requires_uploaded_metadata_and_actual_nonempty_matching_blob(self):
        row = {'container': 'private', 'blob': 'safe.mp4', 'size': 500, 'uploadedAt': datetime.now(timezone.utc)}
        with patch('curriculum_api.session_archive.storage_client') as storage:
            blob = storage.return_value.get_blob_client.return_value
            for size, expected in ((500, 'ready'), (0, 'missing'), (400, 'missing')):
                blob.get_blob_properties.return_value.size = size
                self.assertEqual(media.recording_state(row), expected)
            blob.get_blob_properties.side_effect = RuntimeError('private provider detail')
            self.assertEqual(media.recording_state(row), 'unavailable')
            self.assertEqual(media.recording_state({**row, 'error': 'failed'}), 'failed')
            self.assertEqual(media.recording_state({**row, 'uploadedAt': None}), 'pending')

    def test_inventory_is_event_scoped_and_never_exposes_blob_paths_or_errors(self):
        start, end = datetime(2026, 10, 20, 9, tzinfo=timezone.utc), datetime(2026, 10, 20, 10, tzinfo=timezone.utc)
        row = {'event_key': 'mcr:1', 'id': 'file', 'container': 'private', 'blob': 'private-path', 'error': 'secret',
               'startsAt': start, 'endsAt': end}
        with patch.object(media, 'archive_rows', return_value=[row, {**row, 'event_key': 'foreign'}]):
            result = media.recording_summaries(['mcr:1'], windows={'mcr:1': (start, end)})
        self.assertEqual(len(result['mcr:1']['recordings']), 1)
        self.assertEqual(result['mcr:1']['state'], 'failed')
        self.assertNotIn('private-path', json.dumps(result))
        self.assertNotIn('secret', json.dumps(result))


class CoachingRecordingsQueriesTests(SimpleTestCase):
    def test_coach_directory_respects_secondary_grants_and_normalises_email(self):
        rows = [SimpleNamespace(email=' COACH@example.invalid ', username='Coach', access='tutor', access_extra='coach'),
                SimpleNamespace(email=OTHER, username='Other', access='curriculum', access_extra='')]
        with patch.object(api.StaffUser.objects, 'only') as query:
            query.return_value.order_by.return_value = rows
            self.assertEqual(api._coaches(), [{'email': OWNER, 'name': 'Coach'}])

    def test_own_roster_is_filtered_in_database_and_does_not_prefetch_private_relations(self):
        with patch.object(api.LearnerProfile.objects, 'all') as query:
            filtered = query.return_value.annotate.return_value.filter.return_value
            filtered.order_by.return_value.values.return_value = []
            self.assertEqual(api._learners(OWNER), [])
            query.return_value.annotate.return_value.filter.assert_called_once_with(owner_key=OWNER)

    def test_booking_query_scopes_owner_type_and_date_before_reading(self):
        with patch.object(api.CoachCalendarEvent.objects, 'annotate') as query:
            query.return_value.filter.return_value.values.return_value = []
            start, end = datetime(2026, 10, 1, tzinfo=timezone.utc), datetime(2026, 10, 2, tzinfo=timezone.utc)
            self.assertEqual(api._bookings(OWNER, start, end), [])
            # The new cancellation scope also includes saved rows whose session
            # time was erased, using their explicitly labelled update period.
            query.return_value.filter.assert_called_once_with(
                Q(scheduled_date__range=(date(2026, 9, 30), date(2026, 10, 2)))
                | (Q(scheduled_date__isnull=True, updated_at__gte=start, updated_at__lt=end)
                   & (Q(status='cancelled') | Q(sync_state='cancelled'))),
                owner_key=OWNER, event_type__in=('mcr', 'progress-review', 'student-support'))
