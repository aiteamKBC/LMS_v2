"""The slide viewer's behaviour when an uploaded deck's file has gone.

    python manage.py test curriculum_api.tests_slide_fallback

No database: the slides endpoint only reads the filesystem.

Uploads live under MEDIA_ROOT, which is neither version-controlled nor backed
up, so a deck's .pptx disappearing while its rendered model survives is a real
state — it is what a learner hit here, and the page dead-ended on it even though
the slides were still on disk in rendered form. These tests pin the recovery,
and pin that it stays a fallback: a deck whose file is present must still be read
through the stamped cache, so replacing the file replaces what learners see.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings

from . import pptx_slides

UPLOAD_ROOT = 'curriculum_component_uploads'
RELATIVE = f'{UPLOAD_ROOT}/MOD-1/COMP-1/deck-20260101000000.pptx'
PUBLIC_URL = '/curriculum_api/curriculum/uploads/MOD-1/COMP-1/deck-20260101000000.pptx'
SLIDES_URL = '/curriculum_api/curriculum/presentations/slides/'

CACHED_DECK = {
    'slideWidthPx': 1920,
    'slideHeightPx': 1080,
    'slideCount': 2,
    'slides': [
        {'number': 1, 'layout': 'Title', 'background': None, 'shapes': [], 'notes': ''},
        {'number': 2, 'layout': 'Content', 'background': None, 'shapes': [], 'notes': ''},
    ],
}


class SlideDeckSourceMissingTests(SimpleTestCase):
    def setUp(self):
        self._media = tempfile.TemporaryDirectory()
        self.addCleanup(self._media.cleanup)
        self.media_root = Path(self._media.name)
        self.overridden = override_settings(MEDIA_ROOT=str(self.media_root))
        self.overridden.enable()
        self.addCleanup(self.overridden.disable)

    def write_cache(self, relative_path=RELATIVE, stamp='stale-stamp', deck=None):
        """Put a rendered deck in the cache, as a successful view would have."""
        cache_dir = pptx_slides.render_root() / pptx_slides.render_cache_key(relative_path)
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / 'deck.json').write_text(
            json.dumps({'stamp': stamp, 'source': relative_path, 'deck': deck or CACHED_DECK}),
            encoding='utf-8',
        )
        return cache_dir

    # ── the read-only lookup ────────────────────────────────────────────────

    def test_cached_deck_model_ignores_the_stamp(self):
        """The stamp is a stat of the source; with no source there is nothing to
        compare it against, so the cache is read regardless."""
        self.write_cache(stamp='does-not-match-anything')
        deck = pptx_slides.cached_deck_model(RELATIVE)
        self.assertIsNotNone(deck)
        self.assertEqual(deck['slideCount'], 2)

    def test_cached_deck_model_is_none_without_a_cache(self):
        self.assertIsNone(pptx_slides.cached_deck_model(RELATIVE))

    def test_cached_deck_model_survives_an_unreadable_cache(self):
        """A truncated manifest must not 500 the page."""
        cache_dir = pptx_slides.render_root() / pptx_slides.render_cache_key(RELATIVE)
        cache_dir.mkdir(parents=True, exist_ok=True)
        (cache_dir / 'deck.json').write_text('{not json', encoding='utf-8')
        self.assertIsNone(pptx_slides.cached_deck_model(RELATIVE))

    def test_cached_deck_model_rejects_a_manifest_with_no_deck(self):
        self.write_cache(deck=None)  # writes CACHED_DECK
        cache_dir = pptx_slides.render_root() / pptx_slides.render_cache_key(RELATIVE)
        (cache_dir / 'deck.json').write_text(json.dumps({'stamp': 'x'}), encoding='utf-8')
        self.assertIsNone(pptx_slides.cached_deck_model(RELATIVE))

    def test_the_cache_key_is_derived_from_the_upload_path(self):
        # Two uploads must not share a render.
        self.assertNotEqual(
            pptx_slides.render_cache_key(RELATIVE),
            pptx_slides.render_cache_key(f'{UPLOAD_ROOT}/MOD-1/COMP-2/deck.pptx'),
        )

    # ── the endpoint ────────────────────────────────────────────────────────

    def test_a_missing_file_serves_the_last_render(self):
        self.write_cache()
        response = self.client.get(SLIDES_URL, {'src': PUBLIC_URL})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload['slides']), 2)
        # Flagged so a caller can say the deck still needs re-uploading: the
        # download and open-in-a-new-tab links point at the raw file.
        self.assertIs(payload['sourceMissing'], True)

    def test_a_missing_file_with_no_render_still_asks_for_a_reupload(self):
        response = self.client.get(SLIDES_URL, {'src': PUBLIC_URL})
        self.assertEqual(response.status_code, 404)
        self.assertIn('not on the server any more', response.json()['error'])

    def test_a_path_outside_the_upload_root_is_refused(self):
        # Not a 404-with-cache path: this never names an upload at all.
        response = self.client.get(SLIDES_URL, {'src': '/somewhere/else/deck.pptx'})
        self.assertEqual(response.status_code, 400)

    def test_a_present_file_is_not_served_from_the_lenient_cache(self):
        """The fallback must not become the normal path.

        A real .pptx here would be re-rendered and its stamp checked; what
        matters is that a stale cache does not win while the file exists. The
        file is deliberately not a valid deck, so a 200 could only have come
        from the cache — and the assertion is that it does not.
        """
        self.write_cache(stamp='stale-stamp')
        target = self.media_root / RELATIVE
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b'not a real pptx')
        response = self.client.get(SLIDES_URL, {'src': PUBLIC_URL})
        self.assertNotEqual(response.status_code, 200)
