"""Module Overview: the optional Hero background image.

    python manage.py test curriculum_api.tests_module_overview_hero --settings=config.settings_sqlite_test

No database and no storage: the module row is the dict-backed stub from
tests_module_overview and ``upload_storage.store``/``delete`` are mocked, so no
bytes reach Azure, S3 or local disk. Images are generated in memory.
"""
from __future__ import annotations

import json
from contextlib import ExitStack
from unittest.mock import patch

from django.test import Client, SimpleTestCase
from django.urls import resolve

from curriculum_api import module_overview as mo
from curriculum_api import views
from curriculum_api.tests_module_overview import COPY, CUSTOM, COPY_URL, MODULE, NOW, EndpointTestCase, editor_input
from curriculum_api.tests_module_overview_photo import UPLOADED as UPLOADED_PHOTO, image_bytes, upload

HERO_URL = f'/curriculum_api/curriculum/modules/{MODULE}/overview/hero-background/'
UPLOADED = f'/curriculum_api/curriculum/uploads/{MODULE}/hero-background/hero-20261114100000000000.jpg'
REMOTE = 'https://images.example.org/banners/campus.webp'
WIDE = (1200, 400)


def hero_upload(name='banner.jpg', fmt='JPEG', size=WIDE, content=None):
    return upload(name, image_bytes(fmt, size) if content is None else content, 'image/jpeg')


class HeroUrlTests(SimpleTestCase):
    def test_public_https_or_an_uploaded_hero_only(self):
        for url in (REMOTE, UPLOADED, UPLOADED.replace('.jpg', '.png'), UPLOADED.replace('.jpg', '.webp')):
            with self.subTest(url=url):
                self.assertEqual(mo.hero_url_error(url), '')
        refused = [
            'http://images.example.org/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA',
            'https://localhost/a.png', 'https://10.0.0.5/a.png', 'https://images.example.org/a.svg',
            # An instructor photo or any other upload is never a Hero background.
            UPLOADED_PHOTO,
            f'/curriculum_api/curriculum/uploads/{MODULE}/cover/cover-1.png',
            f'/curriculum_api/curriculum/uploads/{MODULE}/hero-background/../x.png',
            f'/curriculum_api/curriculum/uploads/{MODULE}/hero-background/a.gif',
        ]
        for url in refused:
            with self.subTest(url=url):
                self.assertTrue(mo.hero_url_error(url))
        # ...and a Hero upload is never an instructor photo.
        self.assertTrue(mo.photo_url_error(UPLOADED))

    def test_uploaded_hero_is_served_by_the_existing_uploads_route(self):
        self.assertEqual(resolve(UPLOADED).url_name, 'curriculum-uploaded-file')


class HeroStoredShapeTests(SimpleTestCase):
    def test_saved_only_when_set_and_returned_to_learner_and_editor(self):
        stored = mo.build_stored(mo.validate_input(editor_input(heroBackgroundUrl=f'  {UPLOADED}  ')),
                                 current_tutor='Ray Mead', now=NOW)
        self.assertEqual(stored[mo.HERO_KEY], UPLOADED)
        self.assertEqual(mo.learner_view(stored, 'Ray Mead')[mo.HERO_KEY], UPLOADED)
        self.assertEqual(mo.editor_view(MODULE, stored, 'Ray Mead')['overview'][mo.HERO_KEY], UPLOADED)
        # Not bound to the tutor: a tutor change keeps the module's background.
        self.assertEqual(mo.learner_view(stored, 'Andrew Millington')[mo.HERO_KEY], UPLOADED)
        without = mo.build_stored(mo.validate_input(editor_input()), current_tutor='Ray Mead', now=NOW)
        self.assertNotIn(mo.HERO_KEY, without)

    def test_a_hero_background_alone_is_an_authored_overview(self):
        empty = editor_input(summary='', description='', targetAudience=[], requirements=[])
        stored = mo.build_stored(mo.validate_input({**empty, 'heroBackgroundUrl': REMOTE}), current_tutor='', now=NOW)
        self.assertEqual(stored[mo.HERO_KEY], REMOTE)
        self.assertTrue(mo.has_authored_content(stored))
        self.assertIsNone(mo.build_stored(mo.validate_input(empty), current_tutor='', now=NOW))

    def test_older_records_and_unsafe_stored_values_read_as_empty(self):
        for stored in (None, {'summary': 'v1 record'}, {'summary': 'S', 'heroBackgroundUrl': 'javascript:alert(1)'},
                       {'summary': 'S', 'heroBackgroundUrl': UPLOADED_PHOTO}, {'summary': 'S', 'heroBackgroundUrl': 42}):
            with self.subTest(stored=stored):
                self.assertEqual(mo.learner_view(stored, 'Ray Mead')[mo.HERO_KEY], '')
                self.assertEqual(mo.editor_view(MODULE, stored, 'Ray Mead')['overview'][mo.HERO_KEY], '')

    def test_invalid_values_are_refused_on_save(self):
        for value, message in (('http://images.example.org/a.png', 'https://'), (UPLOADED_PHOTO, 'https://'), (7, 'Must be text')):
            with self.subTest(value=value), self.assertRaises(mo.OverviewValidationError) as caught:
                mo.validate_input(editor_input(heroBackgroundUrl=value))
            self.assertEqual(caught.exception.errors[0]['field'], 'heroBackgroundUrl')
            self.assertIn(message, caught.exception.errors[0]['message'])

    def test_duplicate_references_the_same_background(self):
        source = {'summary': 'S', 'heroBackgroundUrl': UPLOADED}
        copied = mo.copy_for_duplicate(source, target_tutor='Andrew Millington', now=NOW)
        self.assertEqual(copied[mo.HERO_KEY], UPLOADED)


class HeroInspectionTests(SimpleTestCase):
    def test_accepts_wide_jpeg_png_and_webp(self):
        for fmt, name in (('JPEG', 'a.jpg'), ('PNG', 'a.png'), ('WEBP', 'a.webp')):
            with self.subTest(name=name):
                info, problem = mo.inspect_hero(upload(name, image_bytes(fmt, WIDE)))
                self.assertEqual(problem, '')
                self.assertEqual((info['width'], info['height']), WIDE)

    def test_refuses_types_spoofing_corruption_and_bad_dimensions(self):
        cases = {
            'gif': upload('a.gif', image_bytes('GIF', WIDE)),
            'svg': upload('a.svg', b'<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'),
            'spoofed': upload('a.png', image_bytes('JPEG', WIDE)),
            'script': upload('a.jpg', b'<script>alert(1)</script>', 'image/jpeg'),
            'oversized': upload('a.jpg', b'\xff\xd8\xff' + b'0' * mo.MAX_HERO_BYTES, 'image/jpeg'),
            'too small for a banner': upload('a.png', image_bytes('PNG', (400, 400))),
            'too short': upload('a.png', image_bytes('PNG', (1200, 120))),
        }
        for label, file in cases.items():
            with self.subTest(label):
                info, problem = mo.inspect_hero(file)
                self.assertIsNone(info)
                self.assertTrue(problem)
        self.assertIn('8 MB', mo.inspect_hero(cases['oversized'])[1])
        self.assertIn('640 × 200', mo.inspect_hero(cases['too short'])[1])

    def test_instructor_photo_limits_are_unchanged(self):
        self.assertEqual((mo.MAX_PHOTO_BYTES, mo.MIN_PHOTO_SIDE, mo.MAX_PHOTO_SIDE), (5 * 1024 * 1024, 64, 6000))
        # A small square photo is still a valid instructor photo, though too small for a Hero.
        self.assertEqual(mo.inspect_photo(upload('a.png', image_bytes('PNG', (200, 200))))[1], '')
        self.assertTrue(mo.inspect_hero(upload('a.png', image_bytes('PNG', (200, 200))))[1])


class HeroEndpointTests(EndpointTestCase):
    def setUp(self):
        super().setUp()
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.store = stack.enter_context(
            patch.object(mo.upload_storage, 'store', side_effect=lambda file, path, content_type: path))
        self.delete = stack.enter_context(patch.object(mo.upload_storage, 'delete'))
        self.in_use = stack.enter_context(patch.object(mo, 'photo_in_use', return_value=False))

    def post(self, file=None, client=None, **extra):
        return (client or self.client).post(HERO_URL, {'file': file} if file is not None else {}, **extra)

    def discard(self, url):
        return self.client.delete(HERO_URL, json.dumps({'url': url}), content_type='application/json')

    def test_upload_returns_a_hero_url_then_saves_with_the_overview_and_reloads(self):
        response = self.post(hero_upload('My Campus.JPG'))
        self.assertEqual(response.status_code, 201, response.content)
        url = response.json()['url']
        self.assertTrue(url.startswith(f'/curriculum_api/curriculum/uploads/{MODULE}/hero-background/hero-'))
        self.assertTrue(url.endswith('.jpg'))
        self.assertEqual(mo.hero_url_error(url), '')
        path, content_type = self.store.call_args.args[1:]
        self.assertEqual(path, f'{views.COMPONENT_UPLOAD_ROOT}/{url.removeprefix(mo.PHOTO_URL_PREFIX)}')
        self.assertEqual(content_type, 'image/jpeg')
        self.assertEqual(self.modules.writes, [])  # uploading saves nothing
        saved = self.put(editor_input(heroBackgroundUrl=url))
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['overview'][mo.HERO_KEY], url)
        self.assertEqual(json.loads(self.modules.rows[MODULE]['module_overview'])[mo.HERO_KEY], url)
        self.assertEqual(self.client.get(f'/curriculum_api/curriculum/modules/{MODULE}/overview/').json()['overview'][mo.HERO_KEY], url)
        self.assertEqual(self.modules.rows[MODULE]['title'], 'Untouched title')

    def test_needs_no_tutor_but_refuses_bad_files_and_reports_storage_failure(self):
        self.modules.rows[MODULE]['tutor_name'] = 'TBC'
        self.assertEqual(self.post(hero_upload()).status_code, 201)
        self.store.reset_mock()
        for file in (hero_upload('a.png', 'PNG', (300, 300)), upload('a.jpg', b'not an image', 'image/jpeg'), None):
            with self.subTest(file=getattr(file, 'name', None)):
                response = self.post(file)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['fields'][0]['field'], 'heroBackground')
        self.store.assert_not_called()
        self.store.side_effect = OSError('storage down')
        with self.assertLogs(mo.logger, 'ERROR'):
            response = self.post(hero_upload())
        self.assertEqual(response.status_code, 503)
        self.assertIn('background image could not be uploaded', response.json()['error'])
        self.assertEqual(self.modules.writes, [])

    def test_csrf_and_methods(self):
        self.assertEqual(self.client.get(HERO_URL).status_code, 405)
        strict = Client(enforce_csrf_checks=True)
        self.assertEqual(self.post(hero_upload(), client=strict).status_code, 403)
        token = strict.get('/curriculum_api/curriculum/module-overviews/csrf/').json()['csrfToken']
        self.assertEqual(self.post(hero_upload(), client=strict, HTTP_X_CSRFTOKEN=token).status_code, 201)

    def test_discard_only_unsaved_hero_uploads_of_this_module(self):
        self.assertEqual(self.discard(UPLOADED).json(), {'deleted': True})
        self.delete.assert_called_once_with(f'{views.COMPONENT_UPLOAD_ROOT}/{MODULE}/hero-background/hero-20261114100000000000.jpg')
        self.delete.reset_mock()
        for url in (UPLOADED.replace(MODULE, COPY), UPLOADED_PHOTO, REMOTE, CUSTOM, ''):
            with self.subTest(url=url):
                self.assertEqual(self.discard(url).status_code, 400)
        self.in_use.return_value = True
        self.assertEqual(self.discard(UPLOADED).status_code, 409)
        self.delete.assert_not_called()

    def test_duplicate_endpoint_copies_the_background(self):
        self.modules.rows[MODULE]['module_overview'] = json.dumps({'summary': 'S', 'heroBackgroundUrl': REMOTE})
        body = self.client.post(COPY_URL, json.dumps({'sourceModuleCatalogueId': MODULE}), content_type='application/json').json()
        self.assertTrue(body['copied'])
        self.assertEqual(body['overview'][mo.HERO_KEY], REMOTE)


class HeroAccessTests(SimpleTestCase):
    def test_upload_endpoint_is_staff_only(self):
        from login import api_gate
        self.assertEqual(api_gate.rule_for(HERO_URL)[1], api_gate.STAFF)
        self.assertIn('learner', api_gate.rule_for(UPLOADED)[1])
