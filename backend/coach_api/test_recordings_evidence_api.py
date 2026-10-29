"""Authorization and exports use synthetic identities and mocked stores only."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from coach_api import recordings_api as api
from login import permissions
from login.identity import accesses_for_staff

OWNER = 'coach@example.invalid'
OTHER = 'other@example.invalid'


class EvidenceApiTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('coach_api.completion_status.completion_summary',return_value={'state':'unverified','source':'aptem'}))
        self.factory = RequestFactory()
        self.staff = SimpleNamespace(id=7, email=OWNER, access='curriculum', access_extra='')
        self.account = SimpleNamespace(subject_id=7, subject_type='staff', role='staff')
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.enterContext(patch.object(permissions, 'authenticate_request', side_effect=self.authenticate))
        self.enterContext(patch.object(permissions, '_accesses_of', side_effect=lambda account: accesses_for_staff(self.staff)))
        self.enterContext(patch.object(api, '_staff', return_value=self.staff))
        self.enterContext(patch.object(api, '_coaches', return_value=[{'email': OWNER}, {'email': OTHER}]))
        self.enterContext(patch.object(api, 'source_details', return_value=None))
        self.local = self.enterContext(patch.object(api, 'saved_calendar_attendance', return_value={'state': 'pending', 'reportCount': 0, 'rows': []}))
        self.queue = self.enterContext(patch.object(api, 'queue_attendance', return_value=None))
        self.evidence = api.empty_evidence('matched')
        self.evidence['transcript'] = {'content': 'Synthetic transcript <script>not HTML</script>', 'durationSeconds': 60, 'updatedAt': None}
        self.evidence['analyses'] = [{'id': 'analysis-1', 'learnerName': 'Synthetic Learner', 'type': 'monthly_coaching',
            'status': 'completed', 'report': {'executive_summary': 'Synthetic saved report'}, 'updatedAt': None}]
        self.source = self.enterContext(patch.object(api, 'saved_evidence', return_value=self.evidence))
        self.scope = self.enterContext(patch.object(api.LearnerProfile.objects, 'annotate'))
        self.scope.return_value.filter.return_value.values.return_value = [
            {'aptem_id': 11, 'enrolment_aptem': '42'}, {'aptem_id': 12, 'enrolment_aptem': None},
            {'aptem_id': 13, 'enrolment_aptem': 'invalid'}]
        self.context = api.calendar_context(OWNER, 'event', '2026-10-22T09:00:00Z', '2026-10-22T10:00:00Z')

    def authenticate(self, request):
        request.login_account = self.account
        return self.account

    def request(self, *, owner=OWNER, kind='transcript', reference=None, **params):
        context = {**self.context, 'owner': owner}
        return self.factory.get('/evidence', {'reference': reference or api.calendar_reference(context),
            'eventKey': api.calendar_key(context), 'kind': kind, **params})

    def test_curriculum_exports_only_same_meeting_saved_transcript_and_json_report(self):
        response = api.coaching_saved_evidence_download(self.request())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content.decode(), self.evidence['transcript']['content'])
        self.assertEqual(response['Content-Disposition'], 'attachment; filename="coaching-transcript.txt"')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(response['Content-Type'].startswith('text/plain'))
        self.assertIsNone(self.source.call_args.kwargs['learner_ids'])
        response = api.coaching_saved_evidence_download(self.request(kind='analysis', analysisId='analysis-1'))
        self.assertEqual(json.loads(response.content), self.evidence['analyses'][0]['report'])
        self.queue.assert_not_called()

    def test_coach_reports_use_current_caseload_and_prefer_stable_enrolment_identity(self):
        self.staff.access = 'coach'
        response = api.coaching_saved_evidence_download(self.request())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.source.call_args.kwargs['learner_ids'], [12, 42])
        self.assertEqual(self.scope.return_value.filter.call_args.kwargs, {'owner_key': OWNER})

    def test_other_coach_and_non_coach_roles_cannot_read_preview_or_download(self):
        self.staff.access = 'coach'
        for view in (api.coaching_recording_session, api.coaching_saved_evidence_download):
            self.assertEqual(view(self.request(owner=OTHER)).status_code, 404)
        for role in ('tutor', 'learner', 'employer', 'advanced_admin'):
            self.staff.access = role
            self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 403)
        self.source.assert_not_called()

    def test_cached_source_never_bypasses_a_revoked_role_or_removed_coach(self):
        self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 200)
        self.source.reset_mock()
        self.staff.access = 'tutor'
        self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 403)
        self.staff.access = 'curriculum'
        with patch.object(api, '_coaches', return_value=[]):
            self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 404)
        self.source.assert_not_called()

    def test_invalid_reference_event_or_foreign_report_id_is_rejected(self):
        self.assertEqual(api.coaching_saved_evidence_download(self.request(reference='tampered')).status_code, 400)
        self.assertEqual(api.coaching_saved_evidence_download(self.request(eventKey='another')).status_code, 404)
        self.assertEqual(api.coaching_saved_evidence_download(self.request(kind='analysis', analysisId='other-meeting')).status_code, 404)
        self.assertEqual(api.coaching_saved_evidence_download(self.request(kind='arbitrary')).status_code, 400)

    def test_pending_ai_and_missing_source_do_not_return_fabricated_files(self):
        self.evidence['analyses'][0]['status'] = 'processing'
        self.assertEqual(api.coaching_saved_evidence_download(self.request(kind='analysis', analysisId='analysis-1')).status_code, 404)
        self.source.return_value = api.empty_evidence('unavailable')
        self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 503)
        self.source.return_value = api.empty_evidence('not-found')
        self.assertEqual(api.coaching_saved_evidence_download(self.request()).status_code, 404)

    def test_saved_attendance_recovers_missing_lms_evidence_without_another_graph_job(self):
        self.evidence['attendance'] = {'state': 'available', 'reportCount': 1, 'source': 'coaching-session',
            'rows': [{'name': 'Actual participant', 'status': 'attended', 'totalAttendanceSeconds': 60}]}
        response = api.coaching_recording_session(self.request())
        data = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(data['attendance'], self.evidence['attendance'])
        self.assertEqual(data['evidence']['transcript'], self.evidence['transcript'])
        self.queue.assert_not_called()
        download = api.coaching_saved_evidence_download(self.request(kind='attendance'))
        self.assertEqual(json.loads(download.content), data['attendance'])

    def test_verified_local_attendance_is_retained_even_when_saved_source_is_offline(self):
        self.source.return_value = api.empty_evidence('unavailable')
        self.local.return_value = {'state': 'available', 'reportCount': 1,
            'rows': [{'name': 'Verified participant', 'totalAttendanceSeconds': 100, 'status': 'attended'}]}
        response = api.coaching_recording_session(self.request())
        data = json.loads(response.content)
        self.assertEqual(data['attendance'], self.local.return_value)
        self.queue.assert_not_called()
        self.assertEqual(json.loads(api.coaching_saved_evidence_download(self.request(kind='attendance')).content), data['attendance'])

    def test_endpoint_is_get_only_and_registered(self):
        self.assertEqual(resolve('/coach_api/coaching-recordings/evidence').func, api.coaching_saved_evidence_download)
        self.assertEqual(api.coaching_saved_evidence_download(self.factory.post('/evidence')).status_code, 405)

    def test_saved_local_attendance_returns_without_waiting_for_external_source(self):
        self.local.return_value = {'state': 'available', 'reportCount': 1, 'rows': [{'name': 'Actual participant', 'totalAttendanceSeconds': 60}]}
        self.source.side_effect = AssertionError('Slow source must not run in the fast local attendance path')
        response = api.coaching_recording_session(self.request(part='attendance'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['attendance'], self.local.return_value)
        self.assertNotIn('evidence', json.loads(response.content))
        self.source.assert_not_called()
        self.queue.assert_not_called()

    def test_evidence_is_independent_and_current_authorization_still_applies(self):
        response = api.coaching_recording_session(self.request(part='evidence'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.source.call_args.kwargs['part'], 'evidence')
        self.assertNotIn('attendance', json.loads(response.content)['evidence'])
        self.local.assert_not_called()
        self.queue.assert_not_called()
        self.staff.access = 'coach'
        self.assertEqual(api.coaching_recording_session(self.request(owner=OTHER, part='evidence')).status_code, 404)
        self.assertEqual(api.coaching_recording_session(self.request(part='invalid')).status_code, 400)

    def test_provider_transcript_check_is_explicit_and_after_current_authorization(self):
        with patch.object(api, 'check_microsoft_transcript', return_value=self.evidence) as check:
            self.assertEqual(api.coaching_recording_session(self.request(part='evidence')).status_code, 200)
            check.assert_not_called()
            self.assertEqual(api.coaching_recording_session(self.request(part='evidence', checkMicrosoft='1')).status_code, 200)
            self.assertEqual(check.call_count, 1)
            self.staff.access = 'tutor'
            self.assertEqual(api.coaching_recording_session(self.request(part='evidence', checkMicrosoft='1')).status_code, 403)
            self.assertEqual(check.call_count, 1)

    def test_explicit_transcript_download_recovers_cache_miss_even_when_source_is_offline(self):
        self.source.return_value = api.empty_evidence('unavailable')
        recovered = {**self.evidence, 'analysisState': 'unavailable'}
        with patch.object(api, 'check_microsoft_transcript', return_value=recovered) as check:
            response = api.coaching_saved_evidence_download(self.request(checkMicrosoft='1'))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.content.decode(), self.evidence['transcript']['content'])
            self.assertEqual(check.call_count, 1)
            self.staff.access = 'coach'
            self.assertEqual(api.coaching_saved_evidence_download(self.request(owner=OTHER, checkMicrosoft='1')).status_code, 404)
            self.assertEqual(check.call_count, 1)

    def test_failed_provider_download_has_a_safe_retryable_response(self):
        self.source.return_value = api.empty_evidence('not-found')
        failed = {**self.source.return_value, 'transcriptCheck': {'state': 'unavailable', 'code': 'microsoft_timeout'}}
        with patch.object(api, 'check_microsoft_transcript', return_value=failed):
            response = api.coaching_saved_evidence_download(self.request(checkMicrosoft='1'))
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['code'], 'transcript_unavailable')

    def test_pdf_endpoint_returns_pdf_bytes_inline_or_attachment_with_current_authorization(self):
        response = api.coaching_saved_evidence_pdf(self.request(kind='analysis', analysisId='analysis-1', preview='1'))
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b'%PDF-'))
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertTrue(response['Content-Disposition'].startswith('inline;'))
        self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(self.source.call_args.kwargs['part'], 'pdf')
        download = api.coaching_saved_evidence_pdf(self.request())
        self.assertEqual(download.status_code, 200)
        self.assertTrue(download['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(resolve('/coach_api/coaching-recordings/pdf').func, api.coaching_saved_evidence_pdf)
        self.staff.access = 'coach'
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request(owner=OTHER)).status_code, 404)
        self.staff.access = 'tutor'
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request()).status_code, 403)

    def test_pdf_never_uses_foreign_or_unfinished_reports_or_a_missing_transcript(self):
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request(kind='analysis', analysisId='foreign')).status_code, 404)
        self.evidence['analyses'][0]['status'] = 'processing'
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request(kind='analysis', analysisId='analysis-1')).status_code, 404)
        self.source.return_value = api.empty_evidence('not-found')
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request()).status_code, 404)
        self.source.return_value = api.empty_evidence('unavailable')
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request()).status_code, 503)
        self.assertEqual(api.coaching_saved_evidence_pdf(self.request(kind='attendance')).status_code, 400)
        self.assertEqual(api.coaching_saved_evidence_pdf(self.factory.post('/pdf')).status_code, 405)

    def test_provider_failure_does_not_block_verified_saved_transcript_or_report_pdf(self):
        self.evidence['transcriptCheck'] = {'state': 'unavailable', 'code': 'microsoft_access_denied'}
        for params in ({}, {'kind': 'analysis', 'analysisId': 'analysis-1'}):
            response = api.coaching_saved_evidence_pdf(self.request(**params))
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.content.startswith(b'%PDF-'))
