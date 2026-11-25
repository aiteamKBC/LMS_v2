"""Frozen-source HTTP and real PPTX/PDF parity in disposable Docker only."""
import hashlib
import importlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

from django.http import Http404
from django.test import RequestFactory, SimpleTestCase, override_settings

from curriculum_api import views, pptx_slides
from curriculum_api.catalogue.api import media_delivery
from curriculum_api.catalogue.application import presentation_reads
from curriculum_api.catalogue.infrastructure import presentation_rendering, presentation_cache
from curriculum_api.catalogue.tests.tests_pptx_slides import build_deck
from curriculum_api.catalogue.tests import tests_pptx_slides as renderer_fixtures

RAW = (Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/media_delivery_snapshot.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest() == '98957690e559d54fc5af7402e045cf4d42566da22de86369c7a79f69c284cd6b'
SNAPSHOT = json.loads(RAW)


def original_http():
    namespace = dict(vars(views))
    for name, entry in SNAPSHOT['views'].items():
        source = '\n'.join('@' + d for d in entry['decorators']) + '\n' + entry['source']
        exec(compile(source, '<frozen media HTTP>', 'exec'), namespace)
    return namespace


def response_value(call):
    try:
        response = call()
    except Http404 as error:
        return '404', str(error)
    try:
        body = b''.join(response.streaming_content) if response.streaming else response.content
        return response.status_code, dict(response.items()), body
    finally:
        response.close()


class MediaBoundaryParity(SimpleTestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.override = override_settings(MEDIA_ROOT=self.root)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.old = original_http()
        self.factory = RequestFactory()

    def compare(self, symbol, request, *args):
        before = response_value(lambda: self.old[symbol](request, *args))
        after = response_value(lambda: getattr(views, symbol)(request, *args))
        self.assertEqual(after, before)
        return after

    def test_download_headers_bytes_and_error_states_match(self):
        path = self.root / views.COMPONENT_UPLOAD_ROOT / 'M/C/file.pdf'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'%PDF-synthetic-file')
        for header in ('', 'bytes=0-3', 'bytes=-4', 'bytes=999-', 'bytes=bad', 'bytes=0-1,3-4'):
            with self.subTest(header=header):
                self.compare('curriculum_uploaded_file', self.factory.get('/', HTTP_RANGE=header), 'M/C/file.pdf')
        for name in ('M/C/missing.pdf', '../secret.pdf'):
            self.compare('curriculum_uploaded_file', self.factory.get('/'), name)

    def test_cover_cache_and_method_contracts_match(self):
        relative = 'M/cover/cover-20261121000000000000.png'
        path = self.root / views.COMPONENT_UPLOAD_ROOT / relative
        path.parent.mkdir(parents=True)
        path.write_bytes(b'synthetic-image')
        response = self.compare('curriculum_uploaded_file', self.factory.get('/'), relative)
        self.assertIn('immutable', response[1]['Cache-Control'])
        self.compare('curriculum_uploaded_file', self.factory.post('/'), relative)
        self.compare('curriculum_presentation_slides', self.factory.post('/'))

    def test_signed_preview_response_and_invalid_tokens_match(self):
        relative = views.COMPONENT_UPLOAD_ROOT + '/M/C/Reading pack.doc'
        path = self.root / relative
        path.parent.mkdir(parents=True)
        path.write_bytes(b'DOC')
        with patch('django.core.signing.time.time', return_value=1800000000):
            self.assertEqual(views.office_preview_link(relative), self.old['office_preview_link'](relative))
            token = views.office_preview_link(relative).split('/')[3]
            self.compare('curriculum_office_preview_file', self.factory.get('/'), token, 'Reading pack.doc')
            self.compare('curriculum_office_preview_file', self.factory.get('/'), token + 'forged', 'Reading pack.doc')
            self.compare('curriculum_uploaded_file', self.factory.get('/', {'preview': '1'}), 'M/C/Reading pack.doc')

    def test_stamped_cache_missing_source_and_unreadable_source_match(self):
        request = self.factory.get('/', {'src': '/curriculum_api/curriculum/uploads/M/C/deck.pptx'})
        deck = {'slides': [], 'slideCount': 0}
        for cached, retained in ((deck, None), (None, deck), (None, None)):
            with self.subTest(cached=cached, retained=retained), \
                    patch.object(pptx_slides, 'deck_model_for_stamp', return_value=cached), \
                    patch.object(pptx_slides, 'cached_deck_model', return_value=retained):
                self.compare('curriculum_presentation_slides', request)
        path = self.root / views.COMPONENT_UPLOAD_ROOT / 'M/C/deck.pptx'
        path.parent.mkdir(parents=True)
        path.write_bytes(b'not a deck')
        self.assertEqual(self.compare('curriculum_presentation_slides', request)[0], 415)

    def test_legacy_proxy_status_and_temporary_file_cleanup_match(self):
        request = self.factory.get('/', {'src': '/learner_api/media/legacy-attachment/123/'})
        proxy = ModuleType('learner_api.media_proxy')
        paths = []
        def render(_key, path, stamp):
            self.assertEqual(Path(path).read_bytes(), b'synthetic-deck')
            self.assertEqual(stamp, 'legacy-attachment:123')
            paths.append(Path(path))
            return {'slides': [], 'slideCount': 0}
        for status in (None, 403, 503):
            proxy._load_legacy_attachment_bytes = lambda ident: (b'synthetic-deck', SimpleNamespace(status_code=status) if status else None)
            with patch.dict(sys.modules, {'learner_api.media_proxy': proxy}), \
                    patch.object(pptx_slides, 'deck_model_for_stamp', return_value=None), \
                    patch.object(pptx_slides, 'render_uploaded_deck', side_effect=render):
                self.compare('curriculum_presentation_slides', request)
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_actual_api_application_and_renderer_are_invoked(self):
        target = self.root / views.COMPONENT_UPLOAD_ROOT / 'M/C/deck.pptx'
        target.parent.mkdir(parents=True)
        build_deck(target)
        with patch.object(media_delivery, 'curriculum_presentation_slides', wraps=media_delivery.curriculum_presentation_slides) as api, \
                patch.object(presentation_reads, 'read_uploaded_presentation', wraps=presentation_reads.read_uploaded_presentation) as application, \
                patch.object(presentation_cache, '_deck_model', wraps=presentation_rendering._deck_model) as render:
            response = self.client.get('/curriculum_api/curriculum/presentations/slides/', {'src': '/curriculum_api/curriculum/uploads/M/C/deck.pptx'})
        self.assertEqual(response.status_code, 200)
        api.assert_called_once()
        application.assert_called_once()
        render.assert_called_once()


class RendererParity(SimpleTestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = {'__name__': 'frozen_presentation_renderer'}
        exec(compile(SNAPSHOT['pptx_source'], '<frozen presentation renderer>', 'exec'), self.original)

    def compare(self, function, source):
        left, right = self.root / 'before', self.root / 'after'
        expected = self.original[function](source, left, '/assets')
        actual = getattr(pptx_slides, function)(source, right, '/assets')
        self.assertEqual(actual, expected)
        assets = lambda p: {str(f.relative_to(p)): f.read_bytes() for f in p.rglob('*') if f.is_file()}
        self.assertEqual(assets(left), assets(right))

    def test_legacy_exports_are_the_actual_owned_objects(self):
        for name, owner in SNAPSHOT['pptx_owners'].items():
            with self.subTest(symbol=name):
                module = importlib.import_module('curriculum_api.catalogue.infrastructure.' + owner)
                self.assertIs(getattr(pptx_slides, name), getattr(module, name))

    def test_real_pptx_geometry_colours_text_tables_and_assets_match(self):
        for dark in (False, True):
            with self.subTest(dark=dark):
                source = self.root / 'deck.pptx'
                build_deck(source, dark_master=dark)
                self.compare('_deck_model', source)

    def test_real_pdf_page_models_and_image_bytes_match(self):
        source = self.root / 'document.pdf'
        renderer_fixtures.PdfPageRenderTests._write_pdf(source, pages=3)
        self.compare('_pdf_model', source)
