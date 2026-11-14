"""Learner-facing Module Overview: authored metadata on ``curriculum.modules``.

Storage
    ``curriculum.modules.module_overview`` (JSONB, nullable), keyed by the
    existing ``module_catalogue_id``. Only *new* descriptive text lives there.
    Everything the LMS already knows about a module -- title, programme, dates,
    tutor, weeks, components, outcomes, hours, progress -- is read from its
    existing source and is never copied into this column.

Stored shape (schemaVersion 2)::

    {"schemaVersion": 2,
     "summary": "...", "description": "...",
     "descriptionSections": [
         {"id": "practise", "heading": "What you'll practise",
          "body": "...", "bullets": ["..."]}],
     "highlights": ["..."],
     "sidebarSections": [
         {"id": "tools", "heading": "Tools & software",
          "body": "...", "bullets": ["..."]}],
     "targetAudience": ["..."], "prerequisites": ["..."], "requirements": ["..."],
     "instructor": {"tutorName": "...", "bio": "...", "photoUrl": "https://..."},
     "updatedAt": "2026-11-12T10:00:00.123456Z"}

``sidebarSections`` is optional and additive within version 2: records saved
before it existed simply have no custom sidebar sections.

``heroBackgroundUrl`` is likewise optional and additive: an image shown behind
the learner Hero (a public https:// image, or an uploaded Hero background --
see "Uploaded instructor photos" below, which applies to it too). It is stored
only when set and belongs to the module, not to a tutor.

Version 1 records (no ``descriptionSections`` / ``highlights``) are read as
they are -- the missing keys are simply empty -- and are never rewritten in
place. A record becomes version 2 only when staff explicitly save it again.

Instructor overrides belong to one tutor
    The module row's ``tutor_name`` stays authoritative. An optional biography
    or photo is stored together with the tutor name it was written for, taken
    from the module row at save time (never from the client). It is shown only
    while that is still the module's tutor, so a tutor change can never show
    the previous tutor's biography or photo. A photo is resolved as: the
    matching override, else the known-instructor default for the exact
    (normalised) tutor name, else none. No fuzzy matching.

Text is plain text. HTML is refused on save and the frontend renders text
nodes only, so nothing authored here can execute in a learner's browser. The
backend never fetches the photo URL.

Uploaded instructor photos
    Staff may upload a photo instead of pasting a URL. The bytes go through
    ``upload_storage`` -- the same container, path shape and serving route as
    every other curriculum authoring upload (Azure/S3 when configured, local
    disk otherwise) -- into a per-module ``instructor-photo`` slot. The upload
    endpoint writes no database row: the editor uploads on Save overview and
    then stores the returned ``/curriculum_api/curriculum/uploads/...`` URL in
    ``instructor.photoUrl`` through the normal overview save, so the overview
    still changes only on Save. Only that exact upload-path shape is accepted
    as a relative photo URL; any other photo must be a public https:// image.
    Replacing or removing a photo never deletes the file (another overview may
    reference it); the only delete is the editor's cleanup of a file it just
    uploaded whose overview save then failed, and only while no overview
    references it.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
import unicodedata
from dataclasses import dataclass, field as dataclass_field
from datetime import datetime, timezone
from urllib.parse import urlsplit

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.http import require_GET

from . import upload_storage
from .module_overview_schema import COLUMN

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 2
#: Versions the editor may send and the readers understand.
SUPPORTED_VERSIONS = (1, 2)

MAX_SUMMARY = 300
MAX_DESCRIPTION = 5000
MAX_BIO = 2000
MAX_URL = 2048
MAX_LIST_ITEMS = 10
MAX_LIST_ITEM = 200
LIST_KEYS = ('targetAudience', 'prerequisites', 'requirements', 'highlights')
TEXT_KEYS = ('summary', 'description')
SECTIONS_KEY = 'descriptionSections'
MAX_SECTIONS = 12
MAX_SECTION_HEADING = 120
MAX_SECTION_BODY = 3000
SECTION_KEYS = frozenset({'id', 'heading', 'body', 'bullets'})
#: Custom sections shown in the learner sidebar, below the system-managed cards.
SIDEBAR_KEY = 'sidebarSections'
MAX_SIDEBAR_SECTIONS = 6
#: Every section list: key -> maximum number of sections. Same item rules for each.
SECTION_LISTS = {SECTIONS_KEY: MAX_SECTIONS, SIDEBAR_KEY: MAX_SIDEBAR_SECTIONS}
INPUT_KEYS = frozenset({*TEXT_KEYS, *LIST_KEYS, *SECTION_LISTS, 'instructorBio', 'instructorPhotoUrl',
                        'heroBackgroundUrl', 'schemaVersion'})
IMAGE_EXTENSIONS = ('.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif')

#: Uploaded instructor photos (see module docstring).
PHOTO_UPLOAD_SLOT = 'instructor-photo'
PHOTO_URL_PREFIX = upload_storage.UPLOAD_URL_PREFIX
MAX_PHOTO_BYTES = 5 * 1024 * 1024
MIN_PHOTO_SIDE = 64
MAX_PHOTO_SIDE = 6000
MAX_PHOTO_PIXELS = 36_000_000
#: Decoded image format -> (accepted file extensions, stored extension, content type).
PHOTO_FORMATS = {
    'JPEG': (('.jpg', '.jpeg'), '.jpg', 'image/jpeg'),
    'PNG': (('.png',), '.png', 'image/png'),
    'WEBP': (('.webp',), '.webp', 'image/webp'),
}
#: Optional Hero background image: a top-level key, not bound to a tutor.
HERO_KEY = 'heroBackgroundUrl'
HERO_UPLOAD_SLOT = 'hero-background'
MAX_HERO_BYTES = 8 * 1024 * 1024
MIN_HERO_WIDTH = 640
MIN_HERO_HEIGHT = 200
MAX_HERO_SIDE = 8000
MAX_HERO_PIXELS = 40_000_000


def _uploaded_url_pattern(slot):
    """The only relative URL accepted for an image: a file in some module's ``slot``."""
    return re.compile(
        r'^' + re.escape(PHOTO_URL_PREFIX)
        + r'(?P<module>[A-Za-z0-9_-]{1,96})/' + re.escape(slot)
        + r'/(?P<name>[A-Za-z0-9_-]{1,120})\.(?:jpg|jpeg|png|webp)$'
    )


@dataclass(frozen=True)
class ImageKind:
    """One kind of uploadable overview image: where it is stored and its limits."""
    slot: str             # folder under the module in the upload container
    file_prefix: str      # stored file name: <prefix>-<timestamp>.<ext>
    field: str            # field name in upload error responses
    noun: str             # user-facing ("photo", "background image")
    log_noun: str         # log messages
    max_bytes: int
    min_width: int
    min_height: int
    max_side: int
    max_pixels: int
    pattern: re.Pattern = dataclass_field(repr=False)

    def match(self, url):
        return self.pattern.match(url) if isinstance(url, str) else None


INSTRUCTOR_PHOTO = ImageKind(
    slot=PHOTO_UPLOAD_SLOT, file_prefix='instructor', field='instructorPhoto', noun='photo',
    log_noun='an instructor photo', max_bytes=MAX_PHOTO_BYTES, min_width=MIN_PHOTO_SIDE,
    min_height=MIN_PHOTO_SIDE, max_side=MAX_PHOTO_SIDE, max_pixels=MAX_PHOTO_PIXELS,
    pattern=_uploaded_url_pattern(PHOTO_UPLOAD_SLOT),
)
HERO_BACKGROUND = ImageKind(
    slot=HERO_UPLOAD_SLOT, file_prefix='hero', field='heroBackground', noun='background image',
    log_noun='a Hero background image', max_bytes=MAX_HERO_BYTES, min_width=MIN_HERO_WIDTH,
    min_height=MIN_HERO_HEIGHT, max_side=MAX_HERO_SIDE, max_pixels=MAX_HERO_PIXELS,
    pattern=_uploaded_url_pattern(HERO_UPLOAD_SLOT),
)

#: Photos supplied by Kent Business College for its instructors, keyed by the
#: exact normalised tutor name (see :func:`person_key`). The single place this
#: mapping lives: learner and admin responses both resolve through it.
KNOWN_INSTRUCTOR_PHOTOS = {
    'andrew millington': 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/a2be2ade866f464cae0f60aa3bae25c4.webp',
    'ray mead': 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/8feac92ab1694a919754ce97fc4973f0.webp',
    'stephen jenner': 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/52d33b52bb5f4ea5b8eca49a21251cf7.webp',
    'amgad badewi': 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/c2ae514648c44ca5a1b1763a11b7cf3d.webp',
    'steven wake': 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/031b05260ce4497fa63970e9f76a3ab4.webp',
}

#: Values the curriculum stores for "no tutor yet". Not a person.
UNASSIGNED_TUTOR_KEYS = frozenset({'', 'unassigned', 'to be assigned', 'tba', 'tbc', 'none', 'n/a', 'emptystring'})

_HTML_TAG = re.compile(r'<\s*/?\s*[a-zA-Z!?]')
_CONTROL = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')
_SPACES = re.compile(r'\s+')
_SECTION_ID = re.compile(r'^[A-Za-z0-9_-]{1,40}$')


class OverviewValidationError(ValueError):
    def __init__(self, errors):
        super().__init__('; '.join(f"{error['field']}: {error['message']}" for error in errors))
        self.errors = errors


# ---------------------------------------------------------------------------
# Pure helpers (no database)
# ---------------------------------------------------------------------------

def person_key(name) -> str:
    """Exact-match key for a person's name: case, width and spacing only."""
    if not isinstance(name, str):
        return ''
    return _SPACES.sub(' ', unicodedata.normalize('NFKC', name)).strip().casefold()


def tutor_display_name(name) -> str:
    """The module's tutor as it should be shown, or '' when none is assigned."""
    if not isinstance(name, str):
        return ''
    display = _SPACES.sub(' ', name).strip()
    return '' if person_key(display) in UNASSIGNED_TUTOR_KEYS else display


#: Leading professional titles ignored for photo lookup only: "Dr", "Dr.",
#: "Prof", "Prof.", "Professor", followed by a space, dot or comma. Only at the
#: start of the name, repeated ("Prof. Dr. ..."); never from the middle.
_LEADING_TITLE = re.compile(r'^(?:dr|prof|professor)(?:\.\s*|,\s*|\s+)')

#: Explicitly approved alternative names, as photo-lookup keys. No automatic
#: nickname guessing: a name not listed here must match exactly.
INSTRUCTOR_NAME_ALIASES = {
    'steve wake': 'steven wake',
}


def photo_lookup_key(name) -> str:
    """The KNOWN_INSTRUCTOR_PHOTOS key for a tutor name, for photo lookup only.

    Case, width and spacing as :func:`person_key`; then recognised leading
    titles are removed and approved aliases applied. Deterministic and exact:
    no partial, fuzzy or similarity matching. The displayed name and the
    binding of saved instructor details to a tutor do not use this.
    """
    key = person_key(name)
    while True:
        stripped = _LEADING_TITLE.sub('', key, count=1).strip()
        if stripped == key or not stripped:
            break
        key = stripped
    return INSTRUCTOR_NAME_ALIASES.get(key, key)


def default_photo_url(tutor_name) -> str:
    return KNOWN_INSTRUCTOR_PHOTOS.get(photo_lookup_key(tutor_display_name(tutor_name)), '')


def _clean_text(value, field, limit, errors, *, single_line=False):
    if value is None:
        return ''
    if not isinstance(value, str):
        errors.append({'field': field, 'message': 'Must be text.'})
        return ''
    text = _CONTROL.sub('', value.replace('\r\n', '\n').replace('\r', '\n'))
    text = _SPACES.sub(' ', text) if single_line else re.sub(r'[ \t]+\n', '\n', re.sub(r'\n{3,}', '\n\n', text))
    text = text.strip()
    if _HTML_TAG.search(text):
        errors.append({'field': field, 'message': 'HTML is not allowed. Use plain text.'})
        return ''
    if len(text) > limit:
        errors.append({'field': field, 'message': f'Must be {limit} characters or fewer.'})
        return ''
    return text


def _clean_list(value, field, errors):
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({'field': field, 'message': 'Must be a list of text items.'})
        return []
    items, seen = [], set()
    for index, raw in enumerate(value):
        item = _clean_text(raw, f'{field}[{index}]', MAX_LIST_ITEM, errors, single_line=True)
        if item and item.casefold() not in seen:
            seen.add(item.casefold())
            items.append(item)
    if len(items) > MAX_LIST_ITEMS:
        errors.append({'field': field, 'message': f'Add at most {MAX_LIST_ITEMS} items.'})
        return []
    return items


def _unique_section_id(raw, index, used):
    candidate = raw if isinstance(raw, str) and _SECTION_ID.match(raw) else f'section-{index + 1}'
    base, suffix = candidate, 2
    while candidate in used:
        candidate = f'{base[:34]}-{suffix}'
        suffix += 1
    used.add(candidate)
    return candidate


def _clean_sections(value, errors, key=SECTIONS_KEY, limit=MAX_SECTIONS):
    """Ordered optional sections (Description or sidebar). Blank sections are dropped."""
    if value is None:
        return []
    if not isinstance(value, list):
        errors.append({'field': key, 'message': 'Must be a list of sections.'})
        return []
    if len(value) > limit:
        errors.append({'field': key, 'message': f'Add at most {limit} sections.'})
        return []
    sections, used = [], set()
    for index, raw in enumerate(value):
        field = f'{key}[{index}]'
        if not isinstance(raw, dict):
            errors.append({'field': field, 'message': 'Must be a section.'})
            continue
        unknown = sorted(set(raw) - SECTION_KEYS)
        if unknown:
            errors.append({'field': field, 'message': f"Unknown field(s): {', '.join(unknown)}."})
            continue
        heading = _clean_text(raw.get('heading'), f'{field}.heading', MAX_SECTION_HEADING, errors, single_line=True)
        body = _clean_text(raw.get('body'), f'{field}.body', MAX_SECTION_BODY, errors)
        bullets = _clean_list(raw.get('bullets'), f'{field}.bullets', errors)
        if not (heading or body or bullets):
            continue
        if not heading:
            errors.append({'field': f'{field}.heading', 'message': 'Add a heading for this section.'})
            continue
        sections.append({'id': _unique_section_id(raw.get('id'), index, used), 'heading': heading,
                         'body': body, 'bullets': bullets})
    return sections


def photo_upload_segment(module_id) -> str:
    """The module's folder name in uploaded photo paths: ASCII-safe and bounded."""
    return re.sub(r'[^A-Za-z0-9_-]+', '-', str(module_id or '')).strip('-')[:96] or 'module'


def uploaded_photo_match(url):
    """The match for an instructor-photo upload URL, or None."""
    return INSTRUCTOR_PHOTO.match(url)


def uploaded_hero_match(url):
    """The match for a Hero background upload URL, or None."""
    return HERO_BACKGROUND.match(url)


def photo_url_error(url) -> str:
    """Why ``url`` is not an acceptable instructor photo URL, or ''.

    Accepted: a public HTTPS image URL, or the URL of an uploaded instructor
    photo (see :func:`uploaded_photo_match`).
    """
    return _image_url_error(url, INSTRUCTOR_PHOTO)


def hero_url_error(url) -> str:
    """Why ``url`` is not an acceptable Hero background URL, or ''.

    The same public HTTPS rule as photos; the only relative URL accepted is an
    uploaded Hero background (never an instructor photo or another upload).
    """
    return _image_url_error(url, HERO_BACKGROUND)


def _image_url_error(url, kind) -> str:
    if not isinstance(url, str) or not url:
        return 'Enter an image URL.'
    if len(url) > MAX_URL:
        return f'Must be {MAX_URL} characters or fewer.'
    if kind.match(url):
        return ''
    if any(character.isspace() for character in url) or any(character in url for character in '"\'<>\\`'):
        return 'The URL contains characters that are not allowed.'
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return 'Enter a valid URL.'
    if parts.scheme != 'https':
        return 'The image must use an https:// address.'
    if parts.username or parts.password or '@' in parts.netloc:
        return 'The URL must not contain credentials.'
    host = (parts.hostname or '').lower()
    if not host or '.' not in host or host.endswith(('.local', '.internal', '.localhost')) or host == 'localhost':
        return 'Use a public image address.'
    try:
        ipaddress.ip_address(host)
        return 'Use a public image address, not an IP address.'
    except ValueError:
        pass
    if port not in (None, 443):
        return 'Use the standard https port.'
    if not parts.path.lower().endswith(IMAGE_EXTENSIONS):
        return 'The URL must point to an image file (.jpg, .jpeg, .png, .webp, .gif or .avif).'
    return ''


def safe_photo_url(url) -> str:
    return url if isinstance(url, str) and not photo_url_error(url) else ''


def safe_hero_url(url) -> str:
    return url if isinstance(url, str) and not hero_url_error(url) else ''


def _clean_image_url(payload, key, check, errors) -> str:
    value = payload.get(key)
    if value in (None, ''):
        return ''
    if not isinstance(value, str):
        errors.append({'field': key, 'message': 'Must be text.'})
        return ''
    value = value.strip()
    problem = check(value) if value else ''
    if problem:
        errors.append({'field': key, 'message': problem})
        return ''
    return value


def validate_input(payload) -> dict:
    """Validate the editor's fields. Returns cleaned values or raises."""
    if not isinstance(payload, dict):
        raise OverviewValidationError([{'field': 'overview', 'message': 'Must be an object.'}])
    errors = []
    unknown = sorted(set(payload) - INPUT_KEYS)
    if unknown:
        errors.append({'field': 'overview', 'message': f"Unknown field(s): {', '.join(unknown)}."})
    version = payload.get('schemaVersion', SCHEMA_VERSION)
    if version is not None and (isinstance(version, bool) or version not in SUPPORTED_VERSIONS):
        errors.append({'field': 'schemaVersion', 'message': f'Unsupported version {version!r}.'})
    cleaned = {
        'summary': _clean_text(payload.get('summary'), 'summary', MAX_SUMMARY, errors, single_line=True),
        'description': _clean_text(payload.get('description'), 'description', MAX_DESCRIPTION, errors),
        **{key: _clean_list(payload.get(key), key, errors) for key in LIST_KEYS},
        **{key: _clean_sections(payload.get(key), errors, key, limit) for key, limit in SECTION_LISTS.items()},
        'instructorBio': _clean_text(payload.get('instructorBio'), 'instructorBio', MAX_BIO, errors),
        'instructorPhotoUrl': '',
    }
    photo = payload.get('instructorPhotoUrl')
    if photo not in (None, ''):
        if not isinstance(photo, str):
            errors.append({'field': 'instructorPhotoUrl', 'message': 'Must be text.'})
        else:
            photo = photo.strip()
            problem = photo_url_error(photo) if photo else ''
            if problem:
                errors.append({'field': 'instructorPhotoUrl', 'message': problem})
            else:
                cleaned['instructorPhotoUrl'] = photo
    cleaned[HERO_KEY] = _clean_image_url(payload, HERO_KEY, hero_url_error, errors)
    if errors:
        raise OverviewValidationError(errors)
    return cleaned


def parse_stored(value):
    """The stored overview as a dict, or None. Tolerant of text/JSON/garbage."""
    if isinstance(value, (bytes, bytearray)):
        value = value.decode('utf-8', 'replace')
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) else None


def _stored_text(stored, key, limit):
    value = stored.get(key)
    return value[:limit] if isinstance(value, str) else ''


def _stored_list(stored, key):
    value = stored.get(key)
    if not isinstance(value, list):
        return []
    return [item[:MAX_LIST_ITEM] for item in value if isinstance(item, str) and item.strip()][:MAX_LIST_ITEMS]


def _stored_sections(stored, key=SECTIONS_KEY):
    """Stored sections, tolerant of older records (none) and malformed entries."""
    limit = SECTION_LISTS[key]
    value = (stored or {}).get(key)
    if not isinstance(value, list):
        return []
    sections, used = [], set()
    for index, raw in enumerate(value):
        if not isinstance(raw, dict):
            continue
        heading = _stored_text(raw, 'heading', MAX_SECTION_HEADING).strip()
        if not heading:
            continue
        sections.append({'id': _unique_section_id(raw.get('id'), index, used), 'heading': heading,
                         'body': _stored_text(raw, 'body', MAX_SECTION_BODY).strip(),
                         'bullets': _stored_list(raw, 'bullets')})
        if len(sections) >= limit:
            break
    return sections


def stored_instructor(stored):
    instructor = (stored or {}).get('instructor')
    if not isinstance(instructor, dict):
        return None
    tutor = tutor_display_name(instructor.get('tutorName'))
    bio = _stored_text(instructor, 'bio', MAX_BIO)
    photo = safe_photo_url(instructor.get('photoUrl'))
    if not tutor or not (bio or photo):
        return None
    return {'tutorName': tutor, 'bio': bio, 'photoUrl': photo}


def has_authored_content(stored) -> bool:
    if not stored:
        return False
    return bool(any(_stored_text(stored, key, MAX_DESCRIPTION) for key in TEXT_KEYS)
                or any(_stored_list(stored, key) for key in LIST_KEYS)
                or any(_stored_sections(stored, key) for key in SECTION_LISTS)
                or stored_instructor(stored)
                or safe_hero_url(stored.get(HERO_KEY)))


def build_stored(cleaned, *, current_tutor, previous=None, now=None):
    """The JSON to store for a save, or None when nothing is authored.

    The instructor override is bound to ``current_tutor`` (read from the
    module row). When the editor supplies no instructor details and the
    previous override belongs to a *different* tutor, that override is kept as
    it was -- it cannot render for the current tutor, and a save of the other
    fields must not silently discard it.
    """
    tutor = tutor_display_name(current_tutor)
    stored = {
        'schemaVersion': SCHEMA_VERSION,
        **{key: cleaned.get(key) or '' for key in TEXT_KEYS},
        **{key: list(cleaned.get(key) or []) for key in LIST_KEYS},
        **{key: [dict(section) for section in cleaned.get(key) or []] for key in SECTION_LISTS},
    }
    bio, photo = cleaned.get('instructorBio') or '', cleaned.get('instructorPhotoUrl') or ''
    previous_instructor = stored_instructor(previous)
    if bio or photo:
        if not tutor:
            raise OverviewValidationError([{'field': 'instructorBio',
                'message': 'Assign a tutor to this module before adding instructor details.'}])
        stored['instructor'] = {'tutorName': tutor, 'bio': bio, 'photoUrl': photo}
    elif previous_instructor and person_key(previous_instructor['tutorName']) != person_key(tutor):
        stored['instructor'] = previous_instructor
    # Optional and module-level; written only when set, so records without one
    # keep exactly their previous shape.
    hero = cleaned.get(HERO_KEY) or ''
    if hero:
        stored[HERO_KEY] = hero
    if not has_authored_content(stored):
        return None
    stored['updatedAt'] = (now or datetime.now(timezone.utc)).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    return stored


def copy_for_duplicate(source, *, target_tutor, now=None):
    """Reusable overview for a module explicitly duplicated from ``source``.

    Descriptive text is copied. The instructor override is copied only when the
    duplicate has the *same* tutor; for a different tutor it is dropped, so the
    copy resolves to its own tutor (and that tutor's default photo, if any).
    """
    source = parse_stored(source)
    if not has_authored_content(source):
        return None
    cleaned = {
        **{key: _stored_text(source, key, MAX_DESCRIPTION if key == 'description' else MAX_SUMMARY) for key in TEXT_KEYS},
        **{key: _stored_list(source, key) for key in LIST_KEYS},
        **{key: _stored_sections(source, key) for key in SECTION_LISTS},
        'instructorBio': '', 'instructorPhotoUrl': '',
        # The Hero background belongs to the module's presentation, not a tutor:
        # the duplicate references the same image (never deleted automatically).
        HERO_KEY: safe_hero_url(source.get(HERO_KEY)),
    }
    instructor = stored_instructor(source)
    tutor = tutor_display_name(target_tutor)
    if instructor and tutor and person_key(instructor['tutorName']) == person_key(tutor):
        cleaned['instructorBio'], cleaned['instructorPhotoUrl'] = instructor['bio'], instructor['photoUrl']
    return build_stored(cleaned, current_tutor=tutor, now=now)


def resolve_instructor(tutor_name, stored):
    """The instructor a learner sees: always the module's actual tutor."""
    name = tutor_display_name(tutor_name)
    if not name:
        return None
    override = stored_instructor(stored)
    if override and person_key(override['tutorName']) != person_key(name):
        override = None
    return {
        'name': name,
        'bio': override['bio'] if override else '',
        'photoUrl': (override or {}).get('photoUrl') or default_photo_url(name),
    }


def learner_view(stored, tutor_name):
    """What the learner read returns. Plain values only, empty when absent."""
    stored = parse_stored(stored) or {}
    return {
        'summary': _stored_text(stored, 'summary', MAX_SUMMARY),
        'description': _stored_text(stored, 'description', MAX_DESCRIPTION),
        **{key: _stored_list(stored, key) for key in LIST_KEYS},
        **{key: _stored_sections(stored, key) for key in SECTION_LISTS},
        'instructor': resolve_instructor(tutor_name, stored),
        HERO_KEY: safe_hero_url(stored.get(HERO_KEY)),
    }


def editor_view(module_id, stored, tutor_name, *, available=True):
    """What the Module Builder editor loads."""
    stored = parse_stored(stored)
    tutor = tutor_display_name(tutor_name)
    instructor = stored_instructor(stored)
    matches = bool(instructor and tutor and person_key(instructor['tutorName']) == person_key(tutor))
    return {
        'moduleCatalogueId': module_id,
        'available': available,
        'tutorName': tutor,
        'defaultPhotoUrl': default_photo_url(tutor),
        'hasOverview': has_authored_content(stored),
        'updatedAt': (stored or {}).get('updatedAt') or None,
        'overview': {
            'summary': _stored_text(stored or {}, 'summary', MAX_SUMMARY),
            'description': _stored_text(stored or {}, 'description', MAX_DESCRIPTION),
            **{key: _stored_list(stored or {}, key) for key in LIST_KEYS},
            **{key: _stored_sections(stored, key) for key in SECTION_LISTS},
            'instructorBio': instructor['bio'] if matches else '',
            'instructorPhotoUrl': instructor['photoUrl'] if matches else '',
            HERO_KEY: safe_hero_url((stored or {}).get(HERO_KEY)),
        },
        # An override written for a previous tutor: kept, never shown to learners.
        'previousTutorDetails': instructor['tutorName'] if instructor and not matches else None,
    }


# ---------------------------------------------------------------------------
# Learner read (called from learner_api.my_learning.read_module after its
# plan-ownership check)
# ---------------------------------------------------------------------------

def read_learner_overview(cursor, module_id, tutor_name):
    """The overview for one module the caller has already authorised.

    ``to_jsonb(m)->'module_overview'`` reads NULL when the column has not been
    added yet, so the learner page keeps working before the migration runs.
    """
    stored = None
    try:
        cursor.execute(
            "SELECT to_jsonb(m)->'module_overview' FROM curriculum.modules m WHERE m.module_catalogue_id=%s",
            [module_id],
        )
        row = cursor.fetchone()
        stored = parse_stored(row[0]) if row else None
    except (DatabaseError, TypeError, IndexError):
        stored = None
    return learner_view(stored, tutor_name)


# ---------------------------------------------------------------------------
# Staff endpoints. /curriculum_api/ is limited to admin/staff accounts by
# login.api_gate; these views add CSRF, validation and concurrency checks.
# ---------------------------------------------------------------------------

def _views():
    from . import views
    return views


def column_available() -> bool:
    v = _views()
    v.ensure_module_authoring_tables()
    return v.has_column(v.AUTHORING_MODULES_TABLE, COLUMN)


def read_module_row(module_id, *, lock=False):
    """The live module row's id, tutor and overview, or None."""
    v = _views()
    table = v.authoring_table_name(v.AUTHORING_MODULES_TABLE)
    suffix = ' for update' if lock and v.connection.vendor == 'postgresql' else ''
    rows = v.fetch_all(
        f'select module_catalogue_id, tutor_name, {v.quote_ident(COLUMN)} as module_overview '
        f'from {table} where module_catalogue_id = %s and deleted_at is null{suffix}',
        [module_id],
    )
    return rows[0] if rows else None


def write_overview(module_id, stored):
    """Write only ``module_overview``; every other column is left alone.

    ``update_rows`` returns the stored row and records the curriculum revision
    (versioning), like every other authoring write.
    """
    v = _views()
    return v.update_rows(
        v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id],
        {COLUMN: json.dumps(stored) if stored is not None else None},
        allow_null_columns=[COLUMN],
    )


def overview_module_ids():
    v = _views()
    table = v.authoring_table_name(v.AUTHORING_MODULES_TABLE)
    rows = v.fetch_all(
        f'select module_catalogue_id from {table} '
        f'where {v.quote_ident(COLUMN)} is not null and deleted_at is null',
    )
    return sorted(str(row['module_catalogue_id']) for row in rows if row.get('module_catalogue_id'))


def _resolve_module_id(identifier):
    v = _views()
    identifier = v.clean_str(identifier)
    return (v.resolve_stored_module_catalogue_id(identifier) or identifier) if identifier else ''


def _error(message, status, **extra):
    return JsonResponse({'error': message, **extra}, status=status)


def _unavailable():
    return _error(
        'Module overview storage is not set up on this database yet. '
        'Run curriculum_api migration 0086 (adds curriculum.modules.module_overview) and retry.',
        503, code='overview_storage_missing',
    )


@require_GET
def overview_csrf(request):
    return JsonResponse({'csrfToken': get_token(request)})


@require_GET
def overview_status(request):
    """Which modules already have an overview (drives Add vs Edit labels)."""
    try:
        if not column_available():
            return JsonResponse({'available': False, 'moduleIds': []})
        return JsonResponse({'available': True, 'moduleIds': overview_module_ids()})
    except DatabaseError:
        return _error('Could not read module overviews. Please try again.', 503)


def module_overview_detail(request, module_catalogue_id):
    """GET the editor's view; PUT a whole overview (optimistic concurrency)."""
    if request.method not in ('GET', 'PUT'):
        return _error('Method not allowed.', 405)
    try:
        module_id = _resolve_module_id(module_catalogue_id)
        if not module_id:
            return _error('A module is required.', 400)
        if not column_available():
            return _unavailable()
        if request.method == 'GET':
            row = read_module_row(module_id)
            if not row:
                return _error('Module not found.', 404)
            return JsonResponse(editor_view(module_id, row.get('module_overview'), row.get('tutor_name')))
        payload = _views().json_body(request)
        if not isinstance(payload, dict):
            return _error('Invalid JSON body.', 400)
        try:
            cleaned = validate_input(payload.get('overview'))
        except OverviewValidationError as error:
            return _error('Check the highlighted fields.', 400, fields=error.errors)
        expected = payload.get('expectedUpdatedAt') or None
        with transaction.atomic():
            row = read_module_row(module_id, lock=True)
            if not row:
                return _error('Module not found.', 404)
            previous = parse_stored(row.get('module_overview'))
            current = (previous or {}).get('updatedAt') or None
            if expected != current:
                return _error(
                    'Someone else changed this module overview after you opened it. '
                    'Reload the latest version and apply your changes again.',
                    409, conflict=True, current=editor_view(module_id, previous, row.get('tutor_name')),
                )
            try:
                stored = build_stored(cleaned, current_tutor=row.get('tutor_name'), previous=previous)
            except OverviewValidationError as error:
                return _error('Check the highlighted fields.', 400, fields=error.errors)
            write_overview(module_id, stored)
        _views().invalidate_curriculum_cache()
        return JsonResponse({**editor_view(module_id, stored, row.get('tutor_name')), 'saved': True})
    except DatabaseError:
        return _error('The module overview could not be saved. Please try again.', 503)


def module_overview_copy(request, module_catalogue_id):
    """Copy a source module's reusable overview onto its explicit duplicate.

    Called by the Module Builder's Duplicate flow with the source module id it
    duplicated from. Never matches by title. Never overwrites an overview the
    target already has. Learner progress, enrolments and delivery state are not
    part of the overview and are never touched.
    """
    if request.method != 'POST':
        return _error('Method not allowed.', 405)
    payload = _views().json_body(request)
    try:
        target_id = _resolve_module_id(module_catalogue_id)
        source_id = _resolve_module_id(payload.get('sourceModuleCatalogueId')) if isinstance(payload, dict) else ''
        if not target_id or not source_id:
            return _error('Both the duplicated module and its source module are required.', 400)
        if source_id == target_id:
            return _error('A module cannot be duplicated from itself.', 400)
        if not column_available():
            return _unavailable()
        with transaction.atomic():
            source = read_module_row(source_id)
            target = read_module_row(target_id, lock=True)
            if not source or not target:
                return _error('Module not found.', 404)
            if has_authored_content(parse_stored(target.get('module_overview'))):
                return JsonResponse({'copied': False, 'reason': 'target_has_overview'})
            stored = copy_for_duplicate(source.get('module_overview'), target_tutor=target.get('tutor_name'))
            if stored is None:
                return JsonResponse({'copied': False, 'reason': 'source_has_no_overview'})
            write_overview(target_id, stored)
        _views().invalidate_curriculum_cache()
        source_instructor = stored_instructor(parse_stored(source.get('module_overview')))
        return JsonResponse({'copied': True, 'instructorCopied': 'instructor' in stored,
                             # Details existed but belonged to a different tutor.
                             'instructorDropped': bool(source_instructor) and 'instructor' not in stored,
                             **editor_view(target_id, stored, target.get('tutor_name'))})
    except DatabaseError:
        return _error('The module overview could not be copied. Please try again.', 503)


# ---------------------------------------------------------------------------
# Overview image uploads: the instructor photo and the Hero background.
# Staff-only like every /curriculum_api/ route; CSRF is enforced by the
# middleware (the views are not exempt). They store bytes only: the overview
# row changes solely through module_overview_detail's PUT.
# ---------------------------------------------------------------------------

def inspect_image(uploaded_file, kind):
    """``(format_info, '')`` for an acceptable image of ``kind``, else ``(None, problem)``.

    The decoded content decides the type: the file name must agree with it, and
    the client's declared content type is never trusted.
    """
    name = str(getattr(uploaded_file, 'name', '') or '')
    suffix = ('.' + name.rsplit('.', 1)[-1].lower()) if '.' in name else ''
    if suffix not in {ext for exts, _stored, _type in PHOTO_FORMATS.values() for ext in exts}:
        return None, 'Choose a JPG, PNG or WebP image.'
    size = getattr(uploaded_file, 'size', 0) or 0
    if size <= 0:
        return None, 'The selected file is empty.'
    if size > kind.max_bytes:
        return None, f'The image is too large. The maximum size is {kind.max_bytes // (1024 * 1024)} MB.'
    from PIL import Image
    try:
        uploaded_file.seek(0)
        with Image.open(uploaded_file) as image:
            image_format = image.format
            width, height = image.size
            if width * height > kind.max_pixels:
                return None, f'The image is too large. Use at most {kind.max_side} pixels on each side.'
            image.verify()
    except Exception:  # noqa: BLE001 - any decoder failure means "not a usable image"
        return None, 'The file is not a valid JPG, PNG or WebP image.'
    finally:
        try:
            uploaded_file.seek(0)
        except Exception:  # noqa: BLE001
            pass
    info = PHOTO_FORMATS.get(image_format)
    if not info:
        return None, 'The file is not a valid JPG, PNG or WebP image.'
    if suffix not in info[0]:
        return None, 'The file name does not match its image type. Choose a JPG, PNG or WebP image.'
    if width < kind.min_width or height < kind.min_height:
        return None, f'The image is too small. Use at least {kind.min_width} × {kind.min_height} pixels.'
    if width > kind.max_side or height > kind.max_side:
        return None, f'The image is too large. Use at most {kind.max_side} pixels on each side.'
    return {'format': image_format, 'extension': info[1], 'contentType': info[2],
            'width': width, 'height': height}, ''


def inspect_photo(uploaded_file):
    """:func:`inspect_image` with the instructor photo limits."""
    return inspect_image(uploaded_file, INSTRUCTOR_PHOTO)


def inspect_hero(uploaded_file):
    """:func:`inspect_image` with the Hero background limits."""
    return inspect_image(uploaded_file, HERO_BACKGROUND)


def photo_in_use(url) -> bool:
    """Whether any module's stored overview mentions ``url``.

    A LIKE scan of the JSON text: over-matching only ever reports "in use",
    which keeps the file -- the safe direction for a delete guard.
    """
    v = _views()
    table = v.authoring_table_name(v.AUTHORING_MODULES_TABLE)
    rows = v.fetch_all(
        f'select module_catalogue_id from {table} '
        f'where cast({v.quote_ident(COLUMN)} as text) like %s limit 1',
        [f'%{url}%'],
    )
    return bool(rows)


def _image_field_error(kind, message, status=400):
    return _error(message, status, fields=[{'field': kind.field, 'message': message}])


def _store_image(module_id, uploaded_file, kind):
    info, problem = inspect_image(uploaded_file, kind)
    if problem:
        return _image_field_error(kind, problem)
    root = _views().COMPONENT_UPLOAD_ROOT
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')
    relative = f'{root}/{photo_upload_segment(module_id)}/{kind.slot}/{kind.file_prefix}-{timestamp}{info["extension"]}'
    failed = f'The {kind.noun} could not be uploaded. Nothing was saved; please try again.'
    try:
        saved = upload_storage.store(uploaded_file, relative, info['contentType'])
    except Exception:  # noqa: BLE001 - storage outage; reported, nothing recorded
        logger.exception('Unable to store %s for module %s.', kind.log_noun, module_id)
        return _error(failed, 503)
    url = PHOTO_URL_PREFIX + saved.removeprefix(f'{root}/')
    if not kind.match(url):
        # Storage renamed it into a shape the overview would refuse: drop it.
        upload_storage.delete(saved)
        logger.error('%s for module %s was stored under an unexpected name.', kind.log_noun.capitalize(), module_id)
        return _error(failed, 503)
    logger.info('Stored %s for module %s (%s bytes, %sx%s).',
                kind.log_noun, module_id, uploaded_file.size, info['width'], info['height'])
    return JsonResponse({'uploaded': True, 'url': url, 'width': info['width'], 'height': info['height']}, status=201)


def _discard_image(request, module_id, row, kind):
    """Remove an image this module's editor uploaded but never saved."""
    payload = _views().json_body(request)
    url = payload.get('url') if isinstance(payload, dict) else None
    match = kind.match(url)
    if not match or match.group('module') != photo_upload_segment(module_id):
        return _error(f'Only an unsaved {kind.noun} uploaded for this module can be discarded.', 400)
    # Checked against this row as read and against every module's overview,
    # so a saved or copied reference always keeps the file.
    if url in str(row.get('module_overview') or '') or photo_in_use(url):
        return JsonResponse({'deleted': False, 'reason': 'in_use'}, status=409)
    root = _views().COMPONENT_UPLOAD_ROOT
    upload_storage.delete(f'{root}/{url.removeprefix(PHOTO_URL_PREFIX)}')
    return JsonResponse({'deleted': True})


def _image_endpoint(request, module_catalogue_id, kind, *, needs_tutor):
    """POST: store an image of ``kind``, return its URL. DELETE: discard an unsaved one."""
    if request.method not in ('POST', 'DELETE'):
        return _error('Method not allowed.', 405)
    try:
        module_id = _resolve_module_id(module_catalogue_id)
        if not module_id:
            return _error('A module is required.', 400)
        if not column_available():
            return _unavailable()
        row = read_module_row(module_id)
        if not row:
            return _error('Module not found.', 404)
        if request.method == 'DELETE':
            return _discard_image(request, module_id, row, kind)
        if needs_tutor and not tutor_display_name(row.get('tutor_name')):
            return _image_field_error(kind, 'Assign a tutor to this module before adding instructor details.')
        uploaded_file = request.FILES.get('file')
        if not uploaded_file:
            return _image_field_error(kind, 'Choose an image to upload.')
        return _store_image(module_id, uploaded_file, kind)
    except DatabaseError:
        return _error(f'The {kind.noun} could not be processed. Please try again.', 503)


def instructor_photo(request, module_catalogue_id):
    """POST: store an instructor photo, return its URL. DELETE: discard an unsaved one."""
    return _image_endpoint(request, module_catalogue_id, INSTRUCTOR_PHOTO, needs_tutor=True)


def hero_background(request, module_catalogue_id):
    """POST: store a Hero background image, return its URL. DELETE: discard an unsaved one.

    Unlike the instructor photo it needs no tutor: the background belongs to
    the module's page, not to a person.
    """
    return _image_endpoint(request, module_catalogue_id, HERO_BACKGROUND, needs_tutor=False)
