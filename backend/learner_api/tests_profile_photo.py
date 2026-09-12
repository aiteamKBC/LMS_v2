from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from azure.core.exceptions import ResourceExistsError, ResourceNotFoundError, ServiceRequestError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, RequestFactory, Client, override_settings
from django.urls import path
from PIL import Image

from .profile_photo import MAX_UPLOAD_BYTES, learner_profile_photo, normalize_photo, photo_bytes

urlpatterns = [path('photo/<str:kind>/<int:pk>/', learner_profile_photo)]


def image_upload(format='PNG'):
    buffer = BytesIO()
    image = Image.new('RGB', (80, 40), 'purple')
    exif = Image.Exif()
    exif[270] = 'Private original metadata'
    image.save(buffer, format=format, exif=exif)
    return SimpleUploadedFile('original.' + format.lower(), buffer.getvalue(), content_type=Image.MIME[format])


class ProfilePhotoTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role='learner', subject_id=125)
        self.factory = RequestFactory()
        self.model = MagicMock()
        self.model.all_learners.filter.return_value.exists.return_value = True
        for target, value in [('login.permissions._auth_gate_enabled', True),
                              ('login.permissions.authenticate_request', self.account)]:
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch('learner_api.profile_photo.SOURCE_MODELS', {'commercial': self.model, 'apprenticeship': self.model})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_images_are_decoded_resized_and_stripped_of_metadata(self):
        for format in ('PNG', 'JPEG', 'WEBP'):
            with self.subTest(format=format):
                encoded = normalize_photo(image_upload(format))
                with Image.open(BytesIO(encoded)) as result:
                    self.assertEqual(result.format, 'JPEG')
                    self.assertEqual(result.size, (512, 512))
                    self.assertFalse(result.getexif())

    def test_invalid_or_oversized_upload_never_reaches_storage(self):
        oversized = SimpleUploadedFile('oversized.jpg', b'x' * (MAX_UPLOAD_BYTES + 1), content_type='image/jpeg')
        for upload in (SimpleUploadedFile('fake.jpg', b'<svg onload="alert(1)"></svg>', content_type='image/jpeg'), oversized):
            with patch('learner_api.profile_photo.photo_bytes') as store:
                response = learner_profile_photo(self.factory.post('/', {'photo': upload}), kind='commercial', pk=125)
            self.assertEqual(response.status_code, 400)
            store.assert_not_called()

    def test_missing_file_and_unsupported_kind_are_rejected(self):
        with patch('learner_api.profile_photo.photo_bytes') as store:
            self.assertEqual(learner_profile_photo(self.factory.post('/'), kind='commercial', pk=125).status_code, 400)
            self.assertEqual(learner_profile_photo(self.factory.get('/'), kind='unknown', pk=125).status_code, 404)
        store.assert_not_called()

    def test_other_learners_cannot_read_or_replace_the_photo(self):
        for request in (self.factory.get('/'), self.factory.post('/', {'photo': image_upload()})):
            with patch('learner_api.profile_photo.photo_bytes') as store:
                response = learner_profile_photo(request, kind='commercial', pk=126)
            self.assertEqual(response.status_code, 404)
            store.assert_not_called()
        self.model.all_learners.filter.assert_not_called()

    def test_missing_learner_never_reaches_storage(self):
        self.model.all_learners.filter.return_value.exists.return_value = False
        with patch('learner_api.profile_photo.photo_bytes') as store:
            response = learner_profile_photo(self.factory.get('/'), kind='commercial', pk=125)
        self.assertEqual(response.status_code, 404)
        store.assert_not_called()

    def test_upload_response_is_the_saved_photo_and_a_fresh_read_returns_it(self):
        stored = {}

        def memory_store(learner_id, content=None):
            if content is not None:
                stored[learner_id] = content
            return stored.get(learner_id)

        with patch('learner_api.profile_photo.photo_bytes', side_effect=memory_store):
            self.assertEqual(learner_profile_photo(self.factory.get('/'), kind='commercial', pk=125).status_code, 204)
            uploaded = learner_profile_photo(self.factory.post('/', {'photo': image_upload()}), kind='commercial', pk=125)
            loaded = learner_profile_photo(self.factory.get('/'), kind='apprenticeship', pk=125)
        self.assertEqual(uploaded.status_code, 200)
        self.assertEqual(uploaded.content, loaded.content)
        self.assertEqual(loaded['Content-Type'], 'image/jpeg')
        self.assertEqual(loaded['Cache-Control'], 'private, no-store')
        self.assertEqual(loaded['X-Content-Type-Options'], 'nosniff')

    def test_storage_failure_never_claims_that_the_upload_succeeded(self):
        with patch('learner_api.profile_photo.photo_bytes', side_effect=ServiceRequestError('internal-secret')):
            result = learner_profile_photo(self.factory.post('/', {'photo': image_upload()}), kind='commercial', pk=125)
        self.assertEqual(result.status_code, 503)
        self.assertNotIn(b'internal-secret', result.content)

    @override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=['django.middleware.csrf.CsrfViewMiddleware'])
    def test_upload_requires_csrf_even_with_an_authenticated_session(self):
        with patch('learner_api.profile_photo.photo_bytes') as store:
            result = Client(enforce_csrf_checks=True).post('/photo/commercial/125/', {'photo': image_upload()})
        self.assertEqual(result.status_code, 403)
        store.assert_not_called()


class PhotoStorageTests(SimpleTestCase):
    def test_replacement_uses_one_private_canonical_blob_without_a_database_write(self):
        with patch('learner_api.profile_photo.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.profile_photo.evidence_storage._service_client') as client:
            service = client.return_value.__enter__.return_value
            service.get_container_client.return_value.create_container.side_effect = ResourceExistsError('exists')
            self.assertEqual(photo_bytes(125, b'normalized-jpeg'), b'normalized-jpeg')
        service.get_blob_client.assert_called_once_with(container='learner-photos', blob='enrolment/125/profile.jpg')
        service.get_container_client.return_value.create_container.assert_called_once_with(connection_timeout=5, read_timeout=15)
        upload = service.get_blob_client.return_value.upload_blob.call_args
        self.assertTrue(upload.kwargs['overwrite'])
        self.assertEqual(upload.args[0], b'normalized-jpeg')

    def test_read_of_missing_photo_does_not_create_a_container(self):
        with patch('learner_api.profile_photo.evidence_storage.azure_configured', return_value=True), \
             patch('learner_api.profile_photo.evidence_storage._service_client') as client:
            service = client.return_value.__enter__.return_value
            service.get_blob_client.return_value.download_blob.side_effect = ResourceNotFoundError('missing')
            self.assertIsNone(photo_bytes(125))
        service.get_container_client.assert_not_called()
