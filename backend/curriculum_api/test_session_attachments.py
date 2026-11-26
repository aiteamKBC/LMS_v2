import io
import base64
import json
import os
import unittest
from http.client import HTTPConnection
from urllib.parse import parse_qs, urlsplit
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile

from curriculum_api import session_attachment_policy as policy
from curriculum_api import session_attachment_storage as storage
from curriculum_api import session_attachment_import as importer
from curriculum_api import session_attachments as attachments

OCCURRENCE = {'id': 'O1', 'live_session_id': 'S1', 'scheduled_start': '2026-11-26T09:00:00Z',
              'scheduled_end': '2026-11-26T10:00:00Z', 'status': 'scheduled'}


def message(sender='TUTOR', sent='2026-11-26T09:15:00Z', url='https://college.sharepoint.com/slides.pdf'):
    return {'id': 'MESSAGE', 'from': {'user': {'id': sender}}, 'createdDateTime': sent,
            'attachments': [{'id': 'A1', 'name': 'Slides.pdf', 'contentType': 'reference', 'contentUrl': url}]}


class SelectionTests(unittest.TestCase):
    def test_only_recording_links_exclude_session_resources(self):
        self.assertFalse(policy.recording_only_access({'id': 'S1'}))
        self.assertTrue(policy.recording_only_access({'linked_session_numbers': {1}}))
        self.assertFalse(policy.recording_only_access({
            'linked_session_numbers': {1}, 'additional_meeting_access': True}))

    def test_presenter_files_map_to_the_exact_occurrence(self):
        selected = policy.message_files([message()], [OCCURRENCE], {'TUTOR'})
        self.assertEqual([f['occurrence']['id'] for f in selected], ['O1'])

    def test_learner_files_and_another_session_are_never_published(self):
        self.assertEqual(policy.message_files([message('LEARNER'), message(sent='2026-11-27T09:15:00Z')], [OCCURRENCE], {'TUTOR'}), [])

    def test_overlapping_windows_are_not_guessed(self):
        other = {**OCCURRENCE, 'id': 'O2'}
        self.assertEqual(policy.message_files([message()], [OCCURRENCE, other], {'TUTOR'}), [])

    def test_preparation_files_and_timezone_offsets(self):
        self.assertEqual(policy.occurrence_for_message(message(sent='2026-11-26T09:30:00+02:00'), [OCCURRENCE])['id'], 'O1')

    def test_deleted_cancelled_and_external_files_are_excluded(self):
        self.assertEqual(policy.message_files([{**message(), 'deletedDateTime': 'now'},
            message(url='https://127.0.0.1/file.pdf'), message(url='https://college.sharepoint.com.evil.invalid/a.pdf')], [OCCURRENCE], {'TUTOR'}), [])
        self.assertIsNone(policy.occurrence_for_message(message(), [{**OCCURRENCE, 'status': 'cancelled'}]))

    def test_repeat_messages_are_deduplicated(self):
        self.assertEqual(len(policy.message_files([message(), message()], [OCCURRENCE], {'TUTOR'})), 1)

    def test_preauthenticated_hosts_are_only_for_graph_resolved_downloads(self):
        url = 'https://b0mpua-by3301.files.1drv.com/synthetic-file?temporary=opaque'
        self.assertTrue(policy.microsoft_download_url(url))
        self.assertFalse(policy.sharepoint_url(url))
        self.assertEqual(policy.message_files([message(url=url)], [OCCURRENCE], {'TUTOR'}), [])

    def test_identity_is_stable_but_isolated_between_sessions(self):
        self.assertEqual(policy.artifact_id('O1', 'abc'), policy.artifact_id('O1', 'abc'))
        self.assertNotEqual(policy.artifact_id('O1', 'abc'), policy.artifact_id('O2', 'abc'))

    def test_filenames_and_private_metadata(self):
        self.assertEqual(policy.filename('../Slides.pdf'), 'Slides.pdf')
        self.assertEqual(policy.filename('folder\\notes\r\n.pdf'), 'notes.pdf')
        for name in ('index.html', 'script.exe', 'macro.pptm', 'missing'):
            with self.assertRaises(policy.AttachmentError): policy.filename(name)
        self.assertEqual(policy.public_metadata({'metadata': {'lmsSessionAttachment': {
            'fileName': 'Slides.pdf', 'sourceReferences': ['private'], 'sha256': 'secret', 'sizeBytes': 1}}}),
            {'fileName': 'Slides.pdf', 'sizeBytes': 1})


class TransferTests(unittest.TestCase):
    def test_existing_azure_file_uses_short_scoped_download_and_safe_headers(self):
        row = {'container': 'private-test', 'blob_name': 'one-file', 'metadata': json.dumps({
            'lmsSessionAttachment': {'fileName': 'Lesson.pdf', 'sizeBytes': 9}})}
        with patch('learner_api.evidence_storage.get_read_sas', return_value='https://example.invalid/one-file?signature=opaque') as sign:
            response = storage.file_response(row)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(sign.call_args.kwargs['ttl_minutes'], 5)
        self.assertEqual(sign.call_args.kwargs['content_type'], 'application/octet-stream')
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_bunny_download_rejects_another_storage_zone_and_changed_size(self):
        row = {'container': 'bunny:other-zone', 'blob_name': 'saved', 'metadata': {
            'lmsSessionAttachment': {'fileName': 'Lesson.pdf', 'sizeBytes': 9}}}
        with patch.object(storage, 'bunny_configuration', return_value=('current-zone', 'private', 'storage.bunnycdn.com')), patch.object(storage, 'bunny_request') as get:
            with self.assertRaises(policy.AttachmentError): storage.file_response(row)
            get.assert_not_called()
            row['container'] = 'bunny:current-zone'
            get.return_value.headers = {'Content-Length': '10'}
            with self.assertRaises(policy.AttachmentError): storage.file_response(row)
            get.return_value.close.assert_called_once()

    def test_automatic_import_reports_missing_chat_consent_without_fetching_messages(self):
        claims = base64.urlsafe_b64encode(json.dumps({'roles': ['Files.ReadWrite.All']}).encode()).decode().rstrip('=')
        read = Mock(side_effect=[[{'id': 'S1', 'organizer_email': 'tutor@example.invalid'}], [OCCURRENCE]])
        with patch.dict(os.environ, {'SESSION_ATTACHMENTS_AUTO_IMPORT_ENABLED': 'true'}), \
             patch.object(importer, 'settings_payload', return_value={'storageProvider': 'lms'}), \
             patch('curriculum_api.session_results.read', read), \
             patch('django.utils.timezone.now', return_value=datetime(2026, 11, 26, 12, tzinfo=timezone.utc)), \
             patch('coach_api.views.microsoft_graph_token', return_value='header.' + claims + '.signature'), \
             patch('coach_api.views.microsoft_graph_request') as graph:
            errors = importer.sync_series_attachments('S1')
        self.assertEqual(len(errors), 1); self.assertIn('chat-read consent', errors[0]); graph.assert_not_called()

    def test_presenter_file_is_imported_once_with_a_non_secret_source_reference(self):
        claims = base64.urlsafe_b64encode(json.dumps({'roles': ['Files.ReadWrite.All', 'Chat.Read.All']}).encode()).decode().rstrip('=')
        def read(sql, params):
            if 'FROM curriculum.live_sessions ' in sql: return [{'id': 'S1', 'organizer_email': 'tutor@example.invalid'}]
            if 'FROM curriculum.live_session_occurrences ' in sql: return [OCCURRENCE]
            return []
        def graph(method, path):
            if path.startswith('users/tutor'): return {'id': 'TUTOR'}
            if 'onlineMeetings' in path: return {'chatInfo': {'threadId': 'THREAD'}}
            if path.startswith('chats/'): return {'value': [message()]}
            if path.startswith('shares/'): return {'id': 'DRIVE-FILE', 'file': {'mimeType': 'application/pdf'}, 'size': 9,
                '@microsoft.graph.downloadUrl': 'https://college.sharepoint.com/file?opaque=secret'}
            raise AssertionError('Unexpected Graph call')
        with patch.dict(os.environ, {'SESSION_ATTACHMENTS_AUTO_IMPORT_ENABLED': 'true'}), \
             patch.object(importer, 'settings_payload', return_value={'storageProvider': 'lms'}), \
             patch('curriculum_api.session_results.read', side_effect=read), \
             patch('django.utils.timezone.now', return_value=datetime(2026, 11, 26, 12, tzinfo=timezone.utc)), \
             patch('coach_api.views.microsoft_graph_token', return_value='header.' + claims + '.signature'), \
             patch('coach_api.views.microsoft_graph_request', side_effect=graph), \
             patch('curriculum_api.views.live_session_meeting_groups', return_value=[('users/U/onlineMeetings/M', [OCCURRENCE])]), \
             patch.object(importer, 'download_file', return_value=io.BytesIO(b'%PDF-test')), \
             patch.object(attachments, 'save_file') as save:
            self.assertEqual(importer.sync_series_attachments('S1'), [])
        self.assertEqual(save.call_args.args[0]['id'], 'O1')
        self.assertEqual(len(save.call_args.kwargs['source_reference']), 64)
        self.assertNotIn('secret', save.call_args.kwargs['source_reference'])

    def test_valid_pdf_and_empty_wrong_format_oversize_failures(self):
        file, name, digest, size = attachments.prepare_file(io.BytesIO(b'%PDF-1.7\nlesson'), 'Slides.pdf')
        with file: self.assertEqual(file.read(), b'%PDF-1.7\nlesson')
        self.assertEqual(size, 15)
        for data in (b'', b'<html>not PDF</html>'):
            with self.assertRaises(policy.AttachmentError): attachments.prepare_file(io.BytesIO(data), 'Slides.pdf')
        with patch.object(attachments, 'MAX_FILE_BYTES', 4), self.assertRaises(policy.AttachmentError):
            attachments.prepare_file(io.BytesIO(b'12345'), 'notes.txt')

    def test_storage_configuration_never_uses_stream_keys(self):
        with patch.dict(os.environ, {'BUNNY_STREAM_API_KEY': 'unrelated'}, clear=True):
            self.assertIsNone(storage.bunny_configuration())
        with patch.dict(os.environ, {'BUNNY_SESSION_ATTACHMENTS_ZONE': 'session-files'}, clear=True):
            with self.assertRaises(policy.AttachmentError): storage.bunny_configuration()

    def test_unconfigured_archive_reports_unavailable(self):
        with patch.dict(os.environ, {}, clear=True), override_settings(
                STORAGE_BACKEND='azure', AZURE_STORAGE_ACCOUNT='', AZURE_STORAGE_KEY='', AWS_S3_STORAGE_BUCKET=''):
            self.assertEqual(policy.settings_payload()['storageProvider'], 'unavailable')

    def test_s3_archive_needs_its_namespace_and_bucket_without_an_azure_key(self):
        with patch.dict(os.environ, {}, clear=True), override_settings(
                STORAGE_BACKEND='s3', AZURE_STORAGE_ACCOUNT='test-namespace', AZURE_STORAGE_KEY='',
                AWS_S3_STORAGE_BUCKET='synthetic-private-bucket'):
            self.assertEqual(policy.settings_payload()['storageProvider'], 'lms')
            with override_settings(AWS_S3_STORAGE_BUCKET=''):
                self.assertEqual(policy.settings_payload()['storageProvider'], 'unavailable')

    def test_bunny_upload_is_private_has_checksum_and_cannot_redirect(self):
        config = {'BUNNY_SESSION_ATTACHMENTS_ZONE': 'session-files', 'BUNNY_SESSION_ATTACHMENTS_KEY': 'test-key'}
        response = Mock(status_code=201); response.__enter__ = Mock(return_value=response); response.__exit__ = Mock()
        path = 'session-attachments/' + 'a'*64 + '/' + 'b'*64 + '.pdf'
        with patch.dict(os.environ, config, clear=True), patch.object(storage.requests, 'request', return_value=response) as send:
            self.assertEqual(storage.store(io.BytesIO(b'%PDF'), path, 'application/pdf', 'abcd', 4), 'bunny:session-files')
        self.assertFalse(send.call_args.kwargs['allow_redirects'])
        self.assertEqual(send.call_args.kwargs['headers']['Checksum'], 'ABCD')

    def test_ready_copy_reuses_existing_identity_without_another_upload(self):
        cursor = Mock(); cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock()
        cursor.fetchone.side_effect = [('O1',), ({'lmsSessionAttachment': {'fileName': 'First.pdf', 'contentType': 'application/pdf', 'sizeBytes': 9, 'sourceReferences': []}},)]
        connection = Mock(); connection.cursor.return_value = cursor
        with patch.object(attachments, 'connections', {'default': connection}), \
             patch.object(attachments.transaction, 'atomic', return_value=nullcontext()), \
             patch('curriculum_api.session_results.read', return_value=[{'status': 'ready', 'blob_name': 'saved'}]), \
             patch.object(storage, 'store') as upload:
            a = attachments.save_file(OCCURRENCE, io.BytesIO(b'%PDF-same'), 'Again.pdf', source_reference='reference')
        upload.assert_not_called()
        self.assertEqual(a, policy.artifact_id('O1', __import__('hashlib').sha256(b'%PDF-same').hexdigest()))
        statements = ' '.join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertNotIn('curriculum.components', statements)
        self.assertNotIn('attendance SET', statements)

    def test_download_rejects_untrusted_hosts_before_network(self):
        with patch.object(importer.requests, 'get') as get:
            for url in ('http://college.sharepoint.com/x', 'https://localhost/x', 'https://evil.invalid/x',
                        'https://fake.files.1drv.com.evil.invalid/x', 'https://user:pass@real.files.1drv.com/x',
                        'https://real.files.1drv.com:444/x', 'http://real.files.1drv.com/x',
                        'https://real.files.1drv.com/x#fragment'):
                with self.assertRaises(policy.AttachmentError): importer.download_file(url, 1)
        get.assert_not_called()

    def test_graph_downloads_accept_sharepoint_and_onedrive_hosts_without_bearer_or_redirects(self):
        for url in ('https://college.sharepoint.com/synthetic-file',
                    'https://b0mpua-by3301.files.1drv.com/synthetic-file?temporary=opaque'):
            response = Mock(status_code=200); response.iter_content.return_value = [b'%PDF-test']
            with patch.object(importer.requests, 'get', return_value=nullcontext(response)) as get:
                with importer.download_file(url, 9) as stream:
                    self.assertEqual(stream.read(), b'%PDF-test')
            self.assertFalse(get.call_args.kwargs['allow_redirects'])
            self.assertNotIn('Authorization', get.call_args.kwargs.get('headers', {}))

    def test_expired_or_changed_microsoft_download_cannot_publish(self):
        response = Mock(status_code=200); response.iter_content.return_value = [b'too-long']
        with patch.object(importer.requests, 'get', return_value=nullcontext(response)), self.assertRaises(policy.AttachmentError):
            importer.download_file('https://college.sharepoint.com/file?secret=opaque', 2)

    def test_bad_pagination_is_not_a_partial_success(self):
        get = Mock(side_effect=[{'value': [message()], '@odata.nextLink': 'https://evil.invalid/next'}])
        with self.assertRaises(RuntimeError): importer.bounded_messages(get, 'THREAD', datetime(2026, 11, 26, tzinfo=timezone.utc), 'https://graph.microsoft.com/v1.0')

    def test_chat_query_is_accepted_by_the_http_transport_and_preserves_graph_filters(self):
        paths = []
        def get(method, path):
            # putrequest validates the HTTP request target without opening a socket.
            connection = HTTPConnection('graph.microsoft.com')
            try:
                connection.putrequest(method, '/v1.0/' + path)
            finally:
                connection.close()
            paths.append(path)
            return {'value': [message()]}
        result = importer.bounded_messages(get, 'THREAD', datetime(2026, 11, 26, tzinfo=timezone.utc),
                                          'https://graph.microsoft.com/v1.0')
        self.assertEqual(result, [message()])
        self.assertEqual(parse_qs(urlsplit(paths[0]).query), {'$top': ['50'],
            '$orderby': ['lastModifiedDateTime desc'], '$filter': ['lastModifiedDateTime gt 2026-11-26T00:00:00Z']})

    def test_disabled_import_does_not_call_microsoft_or_read_database(self):
        with patch.dict(os.environ, {}, clear=True), patch('curriculum_api.session_results.read') as read:
            self.assertEqual(importer.sync_series_attachments('S1'), [])
        read.assert_not_called()

    def test_enabled_import_rejects_missing_storage_before_database_or_microsoft(self):
        with patch.dict(os.environ, {'SESSION_ATTACHMENTS_AUTO_IMPORT_ENABLED': 'true'}), \
             patch.object(importer, 'settings_payload', return_value={'storageProvider': 'unavailable'}), \
             patch('curriculum_api.session_results.read') as read, \
             patch('coach_api.views.microsoft_graph_request') as graph:
            self.assertEqual(importer.sync_series_attachments('S1'), ['Session attachment storage needs configuration.'])
        read.assert_not_called(); graph.assert_not_called()


class AccessTests(unittest.TestCase):
    def test_additional_meeting_attachments_are_scoped_to_the_authorized_occurrence(self):
        from curriculum_api import linked_recording_access as access
        def attachment_query(sql, params):
            self.assertEqual(params, ['FILE-1', 'S1'])
            return [{'session_number': 1}] if "'attachment'" in sql else []
        with patch.object(access, 'read', side_effect=attachment_query):
            self.assertTrue(access.linked_artifact_allowed({'id': 'S1', 'linked_session_numbers': {1},
                'additional_meeting_access': True}, 'FILE-1'))
            self.assertFalse(access.linked_artifact_allowed({'id': 'S1', 'linked_session_numbers': {2},
                'additional_meeting_access': True}, 'FILE-1'))
            self.assertFalse(access.linked_artifact_allowed({'id': 'S1', 'linked_session_numbers': {1}}, 'FILE-1'))

    def test_staff_upload_rejects_missing_storage_before_reading_or_preparing_a_file(self):
        view = attachments.upload_attachment.__wrapped__.__wrapped__.__wrapped__
        request = RequestFactory().post('/upload', {'file': SimpleUploadedFile('Slides.pdf', b'%PDF-test')})
        with patch.object(attachments, 'settings_payload', return_value={'storageProvider': 'unavailable'}), \
             patch('curriculum_api.session_results.read') as read, \
             patch.object(attachments, 'prepare_file') as prepare, patch.object(attachments, 'save_file') as save:
            response = view(request, 'S1', 1)
        self.assertEqual(response.status_code, 503)
        read.assert_not_called(); prepare.assert_not_called(); save.assert_not_called()

    def test_unauthenticated_and_learner_uploads_are_rejected(self):
        factory = RequestFactory()
        for account in (None, SimpleNamespace(role='learner')):
            request = factory.post('/upload')
            request._dont_enforce_csrf_checks = True
            with patch('login.permissions.authenticate_request', return_value=account), \
                 patch('curriculum_api.session_results.read') as read:
                response = attachments.upload_attachment(request, 'S1', 1)
            self.assertIn(response.status_code, (401, 403))
            read.assert_not_called()

    def test_staff_upload_without_csrf_is_rejected(self):
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch('curriculum_api.session_results.read') as read:
            response = attachments.upload_attachment(RequestFactory().post('/upload'), 'S1', 1)
        self.assertEqual(response.status_code, 403); read.assert_not_called()

    def test_staff_upload_requires_an_existing_exact_session(self):
        factory = RequestFactory()
        view = attachments.upload_attachment.__wrapped__.__wrapped__.__wrapped__
        with patch.object(attachments, 'settings_payload', return_value={'storageProvider': 'lms'}), \
             patch('curriculum_api.session_results.read', return_value=[]), patch.object(attachments, 'save_file') as save:
            response = view(factory.post('/upload'), 'OTHER', 2)
        self.assertEqual(response.status_code, 404); save.assert_not_called()

    def test_staff_upload_uses_the_resolved_occurrence(self):
        view = attachments.upload_attachment.__wrapped__.__wrapped__.__wrapped__
        request = RequestFactory().post('/upload', {'file': SimpleUploadedFile('Slides.pdf', b'%PDF-test')})
        with patch.object(attachments, 'settings_payload', return_value={'storageProvider': 'lms'}), \
             patch('curriculum_api.session_results.read', return_value=[OCCURRENCE]), patch.object(attachments, 'save_file', return_value='FILE-1') as save:
            response = view(request, 'S1', 1)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(save.call_args.args[0]['id'], 'O1')
        self.assertEqual(json.loads(response.content)['state'], 'ready')
