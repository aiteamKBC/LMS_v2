"""Module Overview: uploaded instructor photos.

    python manage.py test curriculum_api.tests_module_overview_photo --settings=config.settings_sqlite_test

No database and no storage: the module row is the dict-backed stub from
tests_module_overview and ``upload_storage.store``/``delete`` are mocked, so no
bytes reach Azure, S3 or local disk. Images are generated in memory.
"""
from __future__ import annotations

import io
import json
from contextlib import ExitStack
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, SimpleTestCase
from django.urls import resolve
from PIL import Image

from curriculum_api import module_overview as mo
from curriculum_api import views
from curriculum_api.tests_module_overview import (
    ANDREW, COPY, CUSTOM, MODULE, NOW, RAY, EndpointTestCase, editor_input,
)

PHOTO_URL = f'/curriculum_api/curriculum/modules/{MODULE}/overview/instructor-photo/'
UPLOADED = f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/instructor-20261114100000000000.png'


def image_bytes(fmt='PNG', size=(200, 200)):
    buffer = io.BytesIO()
    Image.new('RGB', size, (20, 80, 160)).save(buffer, format=fmt)
    return buffer.getvalue()


def upload(name='photo.png', content=None, content_type='image/png'):
    return SimpleUploadedFile(name, image_bytes() if content is None else content, content_type=content_type)


class UploadedPhotoUrlTests(SimpleTestCase):
    def test_only_the_instructor_photo_upload_shape_is_accepted_as_relative(self):
        self.assertEqual(mo.photo_url_error(UPLOADED), '')
        for ext in ('jpg', 'jpeg', 'webp'):
            self.assertEqual(mo.photo_url_error(UPLOADED.replace('.png', f'.{ext}')), '')
        refused = [
            f'/curriculum_api/curriculum/uploads/{MODULE}/cover/cover-1.png',
            f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/../secret.png',
            f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/a.svg',
            f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/a.gif',
            f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/sub/a.png',
            f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/a.png?x=1',
            '/instructor-photo/a.png',
            '//evil.example.org/a.png',
            'curriculum_api/curriculum/uploads/M/instructor-photo/a.png',
        ]
        for url in refused:
            with self.subTest(url=url):
                self.assertTrue(mo.photo_url_error(url))
        # Public https URLs keep their existing rule.
        self.assertEqual(mo.photo_url_error(CUSTOM), '')
        self.assertTrue(mo.photo_url_error('http://images.example.org/a.png'))

    def test_uploaded_url_is_served_by_the_existing_uploads_route(self):
        self.assertEqual(resolve(UPLOADED).url_name, 'curriculum-uploaded-file')
        self.assertEqual(mo.PHOTO_URL_PREFIX, '/curriculum_api/curriculum/uploads/')

    def test_uploaded_photo_is_bound_to_the_tutor_like_any_override(self):
        stored = mo.build_stored(mo.validate_input(editor_input(instructorPhotoUrl=UPLOADED)),
                                 current_tutor='Ray Mead', now=NOW)
        self.assertEqual(stored['instructor'], {'tutorName': 'Ray Mead', 'bio': '', 'photoUrl': UPLOADED})
        self.assertEqual(mo.learner_view(stored, 'Ray Mead')['instructor'],
                         {'name': 'Ray Mead', 'bio': '', 'photoUrl': UPLOADED})
        self.assertEqual(mo.editor_view(MODULE, stored, 'Ray Mead')['overview']['instructorPhotoUrl'], UPLOADED)
        # A tutor change never shows the previous tutor's uploaded photo: the new
        # tutor's known default (or nothing) is shown instead.
        self.assertEqual(mo.learner_view(stored, 'Andrew Millington')['instructor']['photoUrl'], ANDREW)
        self.assertEqual(mo.learner_view(stored, 'Someone New')['instructor']['photoUrl'], '')
        self.assertEqual(mo.editor_view(MODULE, stored, 'Andrew Millington')['overview']['instructorPhotoUrl'], '')

    def test_removing_the_upload_falls_back_to_the_known_default(self):
        stored = mo.build_stored(mo.validate_input(editor_input(instructorPhotoUrl='', instructorBio='Bio')),
                                 current_tutor='Dr. Ray Mead', now=NOW)
        instructor = mo.learner_view(stored, 'Dr. Ray Mead')['instructor']
        self.assertEqual(instructor['name'], 'Dr. Ray Mead')  # displayed name unchanged
        self.assertEqual(instructor['photoUrl'], RAY)

    def test_segment_is_ascii_safe(self):
        self.assertEqual(mo.photo_upload_segment('MOD 1/../x'), 'MOD-1-x')
        self.assertEqual(mo.photo_upload_segment(''), 'module')


class PhotoInspectionTests(SimpleTestCase):
    def test_accepts_jpeg_png_and_webp_by_decoded_content(self):
        for fmt, name, content_type in (('JPEG', 'a.jpg', 'image/jpeg'), ('JPEG', 'a.JPEG', 'image/jpeg'),
                                        ('PNG', 'a.png', 'image/png'), ('WEBP', 'a.webp', 'image/webp')):
            with self.subTest(name=name):
                info, problem = mo.inspect_photo(upload(name, image_bytes(fmt)))
                self.assertEqual(problem, '')
                self.assertEqual(info['contentType'], content_type)

    def test_refuses_wrong_type_spoofed_corrupt_empty_oversized_and_bad_dimensions(self):
        cases = {
            'gif': upload('a.gif', image_bytes('GIF')),
            'svg': upload('a.svg', b'<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'),
            'spoofed': upload('a.jpg', image_bytes('PNG'), 'image/jpeg'),
            'not an image': upload('a.png', b'this is text, not a picture'),
            'empty': upload('a.png', b''),
            'oversized': upload('a.png', b'\x89PNG' + b'0' * mo.MAX_PHOTO_BYTES),
            'too small': upload('a.png', image_bytes('PNG', (32, 32))),
            'too wide': upload('a.png', image_bytes('PNG', (mo.MAX_PHOTO_SIDE + 1, 64))),
        }
        for label, file in cases.items():
            with self.subTest(label):
                info, problem = mo.inspect_photo(file)
                self.assertIsNone(info)
                self.assertTrue(problem)
        self.assertIn('5 MB', mo.inspect_photo(cases['oversized'])[1])


class PhotoEndpointTests(EndpointTestCase):
    def setUp(self):
        super().setUp()
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.store = stack.enter_context(
            patch.object(mo.upload_storage, 'store', side_effect=lambda file, path, content_type: path))
        self.delete = stack.enter_context(patch.object(mo.upload_storage, 'delete'))
        self.in_use = stack.enter_context(patch.object(mo, 'photo_in_use', return_value=False))

    def post(self, file=None, client=None, url=PHOTO_URL, **extra):
        data = {'file': file} if file is not None else {}
        return (client or self.client).post(url, data, **extra)

    def discard(self, url):
        return self.client.delete(PHOTO_URL, json.dumps({'url': url}), content_type='application/json')

    def test_upload_stores_bytes_and_returns_a_saveable_url_without_touching_the_overview(self):
        response = self.post(upload('My Photo.png'))
        self.assertEqual(response.status_code, 201, response.content)
        url = response.json()['url']
        self.assertEqual(mo.photo_url_error(url), '')
        self.assertTrue(url.startswith(f'/curriculum_api/curriculum/uploads/{MODULE}/instructor-photo/instructor-'))
        self.assertNotIn('Photo', url)  # the original file name is not used
        path, content_type = self.store.call_args.args[1:]
        self.assertEqual(path, f'{views.COMPONENT_UPLOAD_ROOT}/{url.removeprefix(mo.PHOTO_URL_PREFIX)}')
        self.assertEqual(content_type, 'image/png')  # from the decoded image, not the client
        self.assertEqual(self.modules.writes, [])
        self.invalidate.assert_not_called()
        # The returned URL is then saved through the normal overview PUT.
        saved = self.put(editor_input(instructorPhotoUrl=url))
        self.assertEqual(saved.status_code, 200, saved.content)
        stored = json.loads(self.modules.rows[MODULE]['module_overview'])
        self.assertEqual(stored['instructor'], {'tutorName': 'Ray Mead', 'bio': '', 'photoUrl': url})
        # Unrelated module columns are untouched by both steps.
        self.assertEqual(self.modules.rows[MODULE]['title'], 'Untouched title')

    def test_upload_refusals_store_nothing(self):
        for file in (upload('a.gif', image_bytes('GIF')), upload('a.png', b'not an image'),
                     upload('a.png', image_bytes('PNG', (20, 20))), None):
            with self.subTest(name=getattr(file, 'name', None)):
                response = self.post(file)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['fields'][0]['field'], 'instructorPhoto')
        self.store.assert_not_called()

    def test_needs_a_tutor_a_module_and_storage(self):
        self.modules.rows[MODULE]['tutor_name'] = 'TBC'
        self.assertEqual(self.post(upload()).status_code, 400)
        self.modules.rows[MODULE]['tutor_name'] = 'Ray Mead'
        missing = '/curriculum_api/curriculum/modules/MOD-NOPE/overview/instructor-photo/'
        self.assertEqual(self.post(upload(), url=missing).status_code, 404)
        self.available.return_value = False
        self.assertEqual(self.post(upload()).status_code, 503)
        self.store.assert_not_called()

    def test_storage_failure_reports_and_records_nothing(self):
        self.store.side_effect = OSError('storage down')
        with self.assertLogs(mo.logger, 'ERROR'):
            response = self.post(upload())
        self.assertEqual(response.status_code, 503)
        self.assertIn('Nothing was saved', response.json()['error'])
        self.assertEqual(self.modules.writes, [])

    def test_only_post_and_delete_and_csrf_is_enforced(self):
        self.assertEqual(self.client.get(PHOTO_URL).status_code, 405)
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(self.post(upload(), client=strict).status_code, 403)
        self.assertEqual(strict.delete(PHOTO_URL, json.dumps({'url': UPLOADED}),
                                       content_type='application/json').status_code, 403)
        token = strict.get('/curriculum_api/curriculum/module-overviews/csrf/').json()['csrfToken']
        self.assertEqual(self.post(upload(), client=strict, HTTP_X_CSRFTOKEN=token).status_code, 201)
        self.store.assert_called_once()
        self.delete.assert_not_called()

    def test_discard_removes_an_unsaved_upload_for_this_module_only(self):
        self.assertEqual(self.discard(UPLOADED).json(), {'deleted': True})
        self.delete.assert_called_once_with(
            f'{views.COMPONENT_UPLOAD_ROOT}/{MODULE}/instructor-photo/instructor-20261114100000000000.png')
        self.delete.reset_mock()
        for url in (UPLOADED.replace(MODULE, COPY), CUSTOM, f'/curriculum_api/curriculum/uploads/{MODULE}/cover/a.png', ''):
            with self.subTest(url=url):
                self.assertEqual(self.discard(url).status_code, 400)
        self.delete.assert_not_called()
        self.assertEqual(self.modules.writes, [])

    def test_discard_never_deletes_a_referenced_photo(self):
        self.in_use.return_value = True
        self.assertEqual(self.discard(UPLOADED).status_code, 409)
        self.in_use.return_value = False
        self.modules.rows[MODULE]['module_overview'] = json.dumps(
            {'instructor': {'tutorName': 'Ray Mead', 'bio': '', 'photoUrl': UPLOADED}})
        self.assertEqual(self.discard(UPLOADED).json(), {'deleted': False, 'reason': 'in_use'})
        self.delete.assert_not_called()

    def test_photo_in_use_scans_overviews_with_a_parameterised_like(self):
        with patch.object(views, 'fetch_all', return_value=[{'module_catalogue_id': COPY}]) as fetch:
            self.assertTrue(type(self).real_in_use(UPLOADED))
        sql, params = fetch.call_args.args
        self.assertIn('like %s', sql)
        self.assertEqual(params, [f'%{UPLOADED}%'])

    real_in_use = staticmethod(mo.photo_in_use)


class PhotoAccessTests(SimpleTestCase):
    def test_upload_endpoint_is_staff_only_and_uploads_are_readable_by_learners(self):
        from login import api_gate
        self.assertEqual(api_gate.rule_for(PHOTO_URL)[1], api_gate.STAFF)
        roles = api_gate.rule_for(UPLOADED)[1]
        self.assertIn('learner', roles)
        self.assertIn('staff', roles)
        self.assertNotIn('employer', roles)
