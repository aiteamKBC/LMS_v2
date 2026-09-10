import asyncio
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import quote

from django.test import RequestFactory, SimpleTestCase, override_settings

from .subject_content import build_material
from .subject_files import stream_pdf
from .student_activity import subject_file, _local_pdf_urls


@override_settings(KBC_LMS_SCHEMA_URL='https://example.org/wp-json/kbc-lms/v1/all-students-schema')
class SubjectFileTests(SimpleTestCase):
    def test_original_pdf_is_extracted_from_office_without_losing_its_token(self):
        original = 'https://example.org/wp-json/kbc-lms/v1/material/10/view?attachment_id=9&token=test-token'
        wrapper = 'https://view.officeapps.live.com/op/embed.aspx?src=' + quote(original, safe='')
        schema = {'content_type': 'pdf', 'iframe_url': wrapper, 'source': {'attachments': [
            {'attachment_id': 9, 'filename': 'Reading.pdf', 'mime_type': 'application/pdf'}]}}
        material = build_material({'title': 'Reading', '_source': {}}, schema)
        self.assertEqual(material['media'][0]['url'], original)
        self.assertEqual(material['media'][0]['kind'], 'pdf')
        self.assertTrue(material['has_reading'])
        public = _local_pdf_urls(material, 'apprenticeship', 123, 500, 10)
        self.assertEqual(public['media'][0]['url'], '/learner_api/student-activity/apprenticeship/123/500/10/files/9/')
        self.assertNotIn('test-token', json.dumps(public))

    def test_office_documents_and_external_sources_keep_their_existing_viewer(self):
        for kind, original in [('docx', 'https://example.org/file?attachment_id=9'), ('pdf', 'https://other.example.org/file?attachment_id=9')]:
            wrapper = 'https://view.officeapps.live.com/op/embed.aspx?src=' + quote(original, safe='')
            material = build_material({'title': 'Document', '_source': {}}, {'content_type': kind, 'iframe_url': wrapper})
            self.assertEqual(material['media'][0]['url'], wrapper)
            self.assertEqual(material['media'][0]['kind'], 'document')

    def test_only_an_attachment_in_the_owned_activity_can_be_downloaded(self):
        definition = {'media': [{'kind': 'pdf', 'attachment_id': '9', 'url': 'https://example.org/pdf'}]}
        with patch('login.permissions._auth_gate_enabled', return_value=True), \
                patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=123)), \
                patch('learner_api.student_activity._owned_material', return_value=(77, {})) as owned, \
                patch('learner_api.student_activity.material_schema', return_value={}), \
                patch('learner_api.student_activity.build_material', return_value=definition), \
                patch('learner_api.subject_files.stream_pdf', return_value='PDF') as stream:
            request = RequestFactory().get('/')
            self.assertEqual(subject_file(request, kind='apprenticeship', pk=123, group_id=500, activity_id=10, attachment_id=9), 'PDF')
            owned.assert_called_once_with('apprenticeship', 123, 500, 10)
            self.assertEqual(subject_file(request, kind='apprenticeship', pk=123, group_id=500, activity_id=10, attachment_id=99).status_code, 404)
            self.assertEqual(subject_file(request, kind='apprenticeship', pk=124, group_id=500, activity_id=10, attachment_id=9).status_code, 404)
            stream.assert_called_once()

    def test_stream_returns_pdf_bytes_and_closes_upstream(self):
        upstream = BytesIO(b'%PDF-test')
        upstream.headers = {'Content-Type': 'application/pdf', 'Content-Length': '9'}
        upstream.status = 200
        with patch('learner_api.subject_files.urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = upstream
            response = stream_pdf(RequestFactory().get('/'), 'https://example.org/file')
        async def consume():
            return b''.join([chunk async for chunk in response.streaming_content])
        self.assertEqual(asyncio.run(consume()), b'%PDF-test')
        self.assertTrue(upstream.closed)
        self.assertEqual(response['Content-Type'], 'application/pdf')

    def test_login_html_and_untrusted_hosts_cannot_masquerade_as_pdfs(self):
        with patch('learner_api.subject_files.urllib.request.build_opener') as opener:
            self.assertEqual(stream_pdf(RequestFactory().get('/'), 'https://other.example.org/file').status_code, 404)
            opener.assert_not_called()
            upstream = MagicMock(headers={'Content-Type': 'text/html'})
            opener.return_value.open.return_value = upstream
            self.assertEqual(stream_pdf(RequestFactory().get('/'), 'https://example.org/file').status_code, 502)
            upstream.close.assert_called_once()
