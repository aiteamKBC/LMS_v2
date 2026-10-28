"""OCR security and failure contracts. No database or external AI calls."""
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, override_settings
from PIL import Image

from .reading_ocr import reading_ocr, reading_ocr_csrf, _transcribe


@override_settings(OPENAI_API_KEY='synthetic-test-key', CACHES={
    'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'},
})
class ReadingOcrTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()
        self.provider = patch('learner_api.reading_ocr._transcribe', return_value='Scanned reading text.')
        self.transcribe = self.provider.start()
        self.addCleanup(self.provider.stop)

    def request(self, role='learner', account_id=1, content=None, csrf=True):
        if content is None:
            image = io.BytesIO()
            Image.new('RGB', (40, 60), 'white').save(image, format='PNG')
            content = image.getvalue()
        request = self.factory.post('/learner_api/reading/ocr/', {
            'page': SimpleUploadedFile('page.png', content, content_type='image/png'),
        })
        request.login_account = SimpleNamespace(pk=account_id, role=role) if role else None
        request._dont_enforce_csrf_checks = csrf
        return request

    def test_learner_and_staff_can_extract_with_account_scoped_cache(self):
        for role, account in [('learner', 1), ('staff', 2), ('admin', 3)]:
            with self.subTest(role=role):
                for _ in range(2):
                    response = reading_ocr(self.request(role=role, account_id=account))
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content), {'text': 'Scanned reading text.'})
        self.assertEqual(self.transcribe.call_count, 3)

    def test_anonymous_employer_and_missing_csrf_cannot_spend(self):
        for request, status in [(self.request(role=None), 401), (self.request(role='employer'), 403),
                                (self.request(csrf=False), 403)]:
            self.assertEqual(reading_ocr(request).status_code, status)
        self.transcribe.assert_not_called()

    def test_invalid_or_oversize_images_cannot_spend(self):
        for content in (b'not an image', b'x' * (2 * 1024 * 1024 + 1)):
            self.assertEqual(reading_ocr(self.request(content=content)).status_code, 400)
        self.transcribe.assert_not_called()

    def test_missing_provider_key_has_actionable_error(self):
        with override_settings(OPENAI_API_KEY=''):
            self.assertEqual(reading_ocr(self.request()).status_code, 503)
        self.transcribe.assert_not_called()

    def test_provider_failure_is_not_cached_and_can_retry_without_leaking_details(self):
        self.transcribe.side_effect = [RuntimeError('secret provider details'), 'Recovered']
        failed = reading_ocr(self.request())
        self.assertEqual(failed.status_code, 502)
        self.assertNotIn(b'secret', failed.content)
        self.assertEqual(json.loads(reading_ocr(self.request()).content)['text'], 'Recovered')

    def test_rate_limit_rejects_new_provider_call(self):
        with patch('learner_api.reading_ocr._within_limit', return_value=False):
            response = reading_ocr(self.request())
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response['Retry-After'], '60')
        self.transcribe.assert_not_called()

    def test_csrf_token_is_only_issued_to_allowed_roles(self):
        for role, status in [('learner', 200), ('staff', 200), ('employer', 403), (None, 401)]:
            request = self.factory.get('/learner_api/reading/ocr/csrf/')
            request.login_account = SimpleNamespace(pk=1, role=role) if role else None
            response = reading_ocr_csrf(request)
            self.assertEqual(response.status_code, status)
            if status == 200:
                self.assertTrue(json.loads(response.content)['csrfToken'])

    def test_provider_receives_pixels_without_storage_or_document_instructions(self):
        with patch('openai.OpenAI') as client:
            create = client.return_value.__enter__.return_value.responses.create
            create.return_value = SimpleNamespace(status='completed', output_text='  Reading text  ')
            self.assertEqual(_transcribe(b'image'), 'Reading text')
            args = create.call_args.kwargs
            self.assertFalse(args['store'])
            self.assertEqual(args['input'][0]['content'][0]['image_url'], 'data:image/jpeg;base64,aW1hZ2U=')
            self.assertIn('untrusted', args['instructions'])
            create.return_value.status = 'incomplete'
            with self.assertRaises(ValueError):
                _transcribe(b'image')
