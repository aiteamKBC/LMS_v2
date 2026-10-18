"""Office Online previews of uploads that have no Azure copy to sign.

The learner saw Microsoft's "File not found -- the URL of the original file is
not valid or the document is not publicly accessible" on a reading. Office
downloads the file from Microsoft's servers, and when an upload had no blob to
sign the preview page handed it the learner's own session-protected upload URL,
which the API gate refuses to anyone without a session.
"""
from unittest import mock
from urllib.parse import unquote

from django.core import signing
from django.http import Http404
from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views
from login.api_gate import is_gated

UPLOAD = f'{views.COMPONENT_UPLOAD_ROOT}/MOD-1/COMP-1/Reading pack.doc'


def _opened(data=b'DOC', content_type='application/msword'):
    return iter([data]), len(data), content_type


class OfficePreviewLinkTests(SimpleTestCase):
    def test_link_names_the_file_and_round_trips(self):
        link = views.office_preview_link(UPLOAD)

        self.assertTrue(link.startswith('/curriculum_api/office-preview/'))
        self.assertTrue(unquote(link).endswith('/Reading pack.doc'))
        token = link.split('/')[3]
        self.assertEqual(
            signing.loads(token, salt=views.OFFICE_PREVIEW_SALT, max_age=views.OFFICE_PREVIEW_MAX_AGE_SECONDS),
            UPLOAD,
        )

    def test_link_is_reachable_without_a_session(self):
        self.assertFalse(is_gated(views.office_preview_link(UPLOAD)))

    def test_serves_the_named_upload(self):
        token = views.office_preview_link(UPLOAD).split('/')[3]
        with mock.patch.object(views.upload_storage, 'open_stream', return_value=_opened()) as opened:
            response = views.curriculum_office_preview_file(RequestFactory().get('/'), token, 'Reading pack.doc')

        opened.assert_called_once_with(UPLOAD)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/msword')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(b''.join(response.streaming_content), b'DOC')

    def test_refuses_a_forged_or_expired_token(self):
        forged = signing.dumps(UPLOAD, salt='some-other-purpose', compress=True)
        with self.assertRaises(Http404):
            views.curriculum_office_preview_file(RequestFactory().get('/'), forged, 'x.doc')

        token = views.office_preview_link(UPLOAD).split('/')[3]
        with mock.patch('django.core.signing.time.time', return_value=10 ** 11):
            with self.assertRaises(Http404):
                views.curriculum_office_preview_file(RequestFactory().get('/'), token, 'x.doc')

    def test_refuses_anything_outside_component_uploads(self):
        for path in ('evidence/learner-1/cv.docx', f'{views.COMPONENT_UPLOAD_ROOT}/../evidence/cv.docx'):
            with self.subTest(path=path):
                token = signing.dumps(path, salt=views.OFFICE_PREVIEW_SALT, compress=True)
                with self.assertRaises(Http404):
                    views.curriculum_office_preview_file(RequestFactory().get('/'), token, 'cv.docx')


class UploadPreviewPageTests(SimpleTestCase):
    def preview(self, signed_url):
        request = RequestFactory().get('/curriculum_api/curriculum/uploads/MOD-1/COMP-1/Reading pack.doc?preview=1')
        with mock.patch.object(views.upload_storage, 'open_stream', return_value=_opened()), \
                mock.patch.object(views.upload_storage, 'signed_read_url', return_value=signed_url):
            return views.curriculum_uploaded_file(request, 'MOD-1/COMP-1/Reading pack.doc')

    def test_a_file_with_no_blob_gets_a_signed_link_not_the_session_url(self):
        page = self.preview('').content.decode()

        self.assertIn('view.officeapps.live.com', page)
        self.assertIn('office-preview', unquote(page))
        self.assertNotIn('curriculum%2Fuploads', page)

    def test_a_blob_still_uses_its_azure_sas_url(self):
        page = self.preview('https://store.blob.core.windows.net/c/doc?sig=abc').content.decode()

        self.assertIn('store.blob.core.windows.net', unquote(page))


class EmptyUploadTests(SimpleTestCase):
    def serve(self, path, preview=False):
        request = RequestFactory().get('/' + ('?preview=1' if preview else ''))
        with mock.patch.object(views.upload_storage, 'open_stream', return_value=(iter([]), 0, 'application/pdf')):
            return views.curriculum_uploaded_file(request, path)

    def test_zero_byte_legacy_placeholder_falls_back_to_the_original_source(self):
        response = self.serve('_legacy_files/4711/handout.pdf')

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Location'], '/learner_api/media/legacy-attachment/4711/')

    def test_other_empty_uploads_say_so(self):
        with self.assertRaisesMessage(Http404, 'empty'):
            self.serve('MOD-1/COMP-1/handout.pdf')
        with self.assertRaisesMessage(Http404, 'empty'):
            self.serve('MOD-1/COMP-1/brief.doc', preview=True)
