"""Versioned on-disk presentation manifests and rendered assets."""
from __future__ import annotations

from django.conf import settings
from pathlib import Path
import hashlib
import json
import shutil
from .presentation_rendering import (
    _deck_model,
    _pdf_model,
)
from .presentation_values import (
    LEGACY_SUFFIXES,
    MODEL_VERSION,
    OOXML_SUFFIXES,
    PDF_SUFFIXES,
    RENDER_DIR_NAME,
    UnsupportedDeck,
)
import logging

logger = logging.getLogger('curriculum_api.pptx_slides')


def _cached_render(relative_path, source, stamp, build, kind):
    """Render `source` through the on-disk cache, or return what is cached.

    Shared by decks and PDFs: both key on the upload path, both invalidate on
    the content stamp, and both keep their page images in the same directory as
    the manifest so dropping the directory drops the whole render.
    """
    key = render_cache_key(relative_path)
    cache_dir = render_root() / key
    manifest = cache_dir / 'deck.json'
    url_prefix = '/curriculum_api/curriculum/uploads/%s/%s' % (RENDER_DIR_NAME, key)
    # Qualified by the model version so a renderer change re-parses rather
    # than replaying a model built by an older version of this module.
    stamp = _versioned(stamp) or _stamp(source)

    if manifest.exists():
        try:
            cached = json.loads(manifest.read_text(encoding='utf-8'))
            if cached.get('stamp') == stamp:
                return cached['deck']
        except Exception:
            logger.warning('Discarding unreadable render cache at %s', manifest)
    # Any surviving render belongs to a replaced file; its images are dead weight.
    if cache_dir.exists():
        shutil.rmtree(cache_dir, ignore_errors=True)
    cache_dir.mkdir(parents=True, exist_ok=True)

    try:
        deck = build(source, cache_dir, url_prefix)
    except UnsupportedDeck:
        raise
    except Exception as error:
        logger.exception('Could not render %s %s', kind, relative_path)
        raise UnsupportedDeck(
            'This %s could not be read for inline display. Open or download it instead.' % kind
        ) from error

    manifest.write_text(
        json.dumps({'stamp': stamp, 'source': relative_path, 'deck': deck}),
        encoding='utf-8',
    )
    return deck


def render_root():
    from .upload_paths import COMPONENT_UPLOAD_ROOT
    return Path(settings.MEDIA_ROOT) / COMPONENT_UPLOAD_ROOT / RENDER_DIR_NAME


def _stamp(source):
    stat = source.stat()
    return '%s:%s:%s' % (MODEL_VERSION, stat.st_size, stat.st_mtime_ns)


def _versioned(stamp):
    """A caller's content stamp, qualified by the model version.

    A stamp identifies the *bytes* — upload_storage builds it from a blob's size
    and etag, or a local file's size and mtime — so on its own it says nothing
    about the shape of the model those bytes were rendered into. Without the
    version folded in, improving this renderer left every already-cached deck
    replaying its old model forever, and the fix looked like it had not worked.
    """
    return None if not stamp else 'v%s:%s' % (MODEL_VERSION, stamp)


def render_cache_key(relative_path):
    """The cache directory name for an upload path."""
    return hashlib.sha1(relative_path.encode('utf-8')).hexdigest()[:20]


def cached_deck_model(relative_path):
    """The last render stored for this upload path, or None.

    Read-only and stamp-blind, unlike ``render_uploaded_deck``, which exists to
    keep a render in step with its source: that one compares ``_stamp(source)``
    and deletes the cache when the file has changed underneath it. Neither is
    possible once the source is gone — there is no stat to take and nothing to
    compare — and deleting the only surviving copy of a deck would be the worst
    of the available options.

    So this is deliberately the lenient reader, used only when the upload has
    vanished. Uploads live under MEDIA_ROOT, which is not in version control and
    not backed up, so a file disappearing while its render survives is a real
    state and not a theoretical one.
    """
    manifest = render_root() / render_cache_key(relative_path) / 'deck.json'
    if not manifest.is_file():
        return None
    try:
        cached = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        logger.warning('Unreadable slide render cache at %s', manifest)
        return None
    deck = cached.get('deck')
    return deck if isinstance(deck, dict) else None


def deck_model_for_stamp(relative_path, stamp):
    """The cached render for exactly these bytes, or None.

    Lets a caller answer from the cache before fetching the deck at all: a deck
    in blob storage would otherwise be downloaded on every request just to
    discover the render was already on disk.
    """
    stamp = _versioned(stamp)
    if not stamp:
        return None
    manifest = render_root() / render_cache_key(relative_path) / 'deck.json'
    if not manifest.is_file():
        return None
    try:
        cached = json.loads(manifest.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None
    if cached.get('stamp') != stamp:
        return None
    deck = cached.get('deck')
    return deck if isinstance(deck, dict) else None


def render_uploaded_deck(relative_path, source, stamp=None):
    """The slide model for an uploaded deck, rendering it if not already cached.

    `relative_path` is the storage-relative path of the upload and keys the
    cache. `stamp` identifies the bytes being rendered; a caller reading from
    blob storage passes the blob's own stamp, because `source` is then a
    temporary copy whose mtime would miss the cache every time. Raises
    UnsupportedDeck, whose message is learner-facing, when the file is not an
    OOXML deck or cannot be parsed.
    """
    source = Path(source)
    suffix = source.suffix.lower()
    if suffix in PDF_SUFFIXES:
        return _cached_render(relative_path, source, stamp, _pdf_model, 'document')
    if suffix in LEGACY_SUFFIXES:
        raise UnsupportedDeck(
            'This deck uses the older PowerPoint 97-2003 format, which cannot be shown '
            'inline. Re-save it as .pptx — or as a PDF — and upload it again.'
        )
    if suffix not in OOXML_SUFFIXES:
        raise UnsupportedDeck('This file is not a document that can be shown inline.')
    return _cached_render(relative_path, source, stamp, _deck_model, 'deck')


def is_renderable_deck_path(path):
    """True when a resource path is a document this module can render."""
    cleaned = str(path or '').split('?')[0].split('#')[0]
    return Path(cleaned).suffix.lower() in (OOXML_SUFFIXES | PDF_SUFFIXES)
