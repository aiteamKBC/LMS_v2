"""Bunny Stream transport. No Django startup, database access or automatic retries.

The library key never leaves the server. A caller must retain the returned video
identity before sending bytes so a retry can reuse it.
"""
from __future__ import annotations

import os
import base64
import re
from urllib.parse import urlsplit

import requests


class VideoImportError(Exception):
    """A safe, user-facing error (never an upstream body, URL or credential)."""

    def __init__(self, message, *, status_code=None):
        super().__init__(message)
        self.status_code = status_code


class MissingProgrammeCollection(VideoImportError):
    """Discovery completed successfully, but the programme has no collection."""


class VideoUploadConflict(VideoImportError):
    """The upload endpoint refuses a video identity that already received bytes."""


COLLECTION_NAMES = {
    'PROG-MM-L6': ('Marketing Manager Level 6',),
    'PROG-ME-L4': ('Marketing Executive Level 4', 'Marketing Excutive Level 4'),
    'PROG-APM-L4': ('Associate Project Management Level 4', 'Associat Project Managment Level 4'),
    'PROG-PCP-L6': ('Project Controls Professional Level 6', 'Project Control Professional Level 6'),
}
FREE_COURSE_COLLECTION = 'Free course'


def live_library_id():
    """LiveSessions is separate from the existing curriculum-material library."""
    library = os.environ.get('BUNNY_LIVE_STREAM_LIBRARY_ID', '796471').strip()
    if not library.isdigit():
        raise VideoImportError('The LiveSessions library identity is not configured.')
    return library


def library_secret(library_id, suffix):
    """Select a credential by the saved library; never send another library's key."""
    library = str(library_id)
    materials = os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153').strip()
    if library == materials:
        prefix = 'BUNNY_STREAM_'
    elif library == live_library_id():
        prefix = 'BUNNY_LIVE_STREAM_'
    else:
        raise VideoImportError('The saved Bunny library is not configured. Existing media is unchanged.')
    return os.environ.get(prefix + suffix, '').strip()


def programme_collection_name(programme_id, programme_name):
    aliases = COLLECTION_NAMES.get(programme_id, ())
    name = ' '.join(str(aliases[0] if aliases else programme_name or '').split())
    if not str(programme_id or '').strip() or name.casefold() in ('', 'unassigned', 'unassigned programme', 'unassigned program'):
        raise VideoImportError('A saved programme is required for its Bunny collection.')
    return name


def module_label(scope):
    if scope.get('free_course_module_id'):
        return str(scope.get('free_course_name') or '').strip()
    label = str(scope.get('module_code') or scope.get('module_title') or scope.get('template_title') or '').strip()
    label = ' '.join(label.split())
    # The LMS stores MSP's full title; use its familiar module name in Bunny.
    if re.match(r'^Managing Successful Programmes\b', label, re.I):
        return 'MSP'
    return label


def video_title(import_id, title, scope=None):
    marker = f'[LMS:{import_id}]'
    name = str(title or 'Curriculum video').strip()
    if name.startswith(marker + ' '):
        name = name[len(marker) + 1:]
    if name.endswith(' ' + marker):
        name = name[:-len(marker) - 1]
    label = module_label(scope or {})
    prefix = label + ' — ' if label else ''
    if prefix and not name.casefold().startswith(prefix.casefold()):
        name = prefix + name
    # Keep recovery identity at the end so the visible title starts with module.
    return f'{name} {marker}'


def playback_url(library_id, video_id):
    if not str(library_id).isdigit() or not re.fullmatch(r'[0-9a-fA-F-]{36}', str(video_id)):
        raise VideoImportError('Bunny returned an invalid video identity.')
    return f'https://iframe.mediadelivery.net/embed/{library_id}/{video_id}?autoplay=false'


def is_bunny_url(value):
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'https' and parsed.hostname == 'iframe.mediadelivery.net'
                and bool(re.fullmatch(r'/embed/\d+/[0-9a-fA-F-]{36}', parsed.path)))
    except ValueError:
        return False


class BunnyStream:
    def __init__(self, library_id=None, api_key=None, session=None):
        self.library_id = str(library_id or os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'))
        self.api_key = api_key if api_key is not None else library_secret(self.library_id, 'API_KEY')
        if not self.library_id.isdigit() or not self.api_key:
            raise VideoImportError('Bunny Stream is not configured. Contact an administrator.')
        self.base = f'https://video.bunnycdn.com/library/{self.library_id}'
        self.session = session or requests.Session()

    def request(self, method, path, **kwargs):
        headers = {'AccessKey': self.api_key, 'Accept': 'application/json'}
        headers.update(kwargs.pop('headers', {}))
        try:
            response = self.session.request(method, self.base + path, headers=headers,
                                            timeout=kwargs.pop('timeout', (15, 60)),
                                            allow_redirects=False, **kwargs)
        except requests.RequestException:
            raise VideoImportError('Bunny could not be reached. Retry using the existing import.') from None
        try:
            if response.status_code in (401, 403):
                raise VideoImportError('Bunny rejected the library API key or its permissions.', status_code=response.status_code)
            if (response.status_code == 400 and method.upper() == 'PUT'
                    and re.fullmatch(r'/videos/[0-9a-fA-F-]{36}', path)):
                raise VideoUploadConflict('Bunny has already received an upload for this video. Retry the saved import.')
            if not 200 <= response.status_code < 300:
                raise VideoImportError(f'Bunny returned HTTP {response.status_code}. The original video is unchanged.', status_code=response.status_code)
            try:
                result = response.json()
            except ValueError:
                raise VideoImportError('Bunny returned an unreadable response.') from None
            if not isinstance(result, dict) or result.get('success') is False:
                raise VideoImportError('Bunny did not accept the operation. The original video is unchanged.')
            return result
        finally:
            response.close()

    def collection(self, programme_id, programme_name):
        programme_collection_name(programme_id, programme_name)
        names = {' '.join(x.split()).casefold() for x in COLLECTION_NAMES.get(programme_id, ())}
        if programme_name:
            names.add(' '.join(programme_name.split()).casefold())
        matches = []
        for page in range(1, 101):
            result = self.request('GET', '/collections', params={'page': page, 'itemsPerPage': 100})
            items = result.get('items')
            if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
                raise VideoImportError('Bunny returned an unreadable collection list.')
            matches.extend(item for item in items if ' '.join(str(item.get('name', '')).split()).casefold() in names)
            if len(items) < 100:
                break
        else:
            raise VideoImportError('The Bunny collection list is incomplete. Retry collection discovery.')
        if not matches:
            raise MissingProgrammeCollection('The programme has no collection in the Curriculum library.')
        if len(matches) > 1:
            raise VideoImportError('The programme must match exactly one collection in the Curriculum library.')
        guid = matches[0].get('guid')
        if not isinstance(guid, str) or not guid:
            raise VideoImportError('Bunny returned an invalid collection identity.')
        return guid

    def create_programme_collection(self, programme_id, programme_name):
        name = programme_collection_name(programme_id, programme_name)
        result = self.request('POST', '/collections', json={'name': name})
        guid = result.get('guid')
        if not isinstance(guid, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', guid):
            raise VideoImportError('Bunny has not confirmed the new programme collection identity.')
        return guid

    def free_course_collection(self):
        """All standalone courses share the fixed Free course collection."""
        name = FREE_COURSE_COLLECTION
        matches = []
        for page in range(1, 101):
            result = self.request('GET', '/collections', params={'page': page, 'itemsPerPage': 100})
            items = result.get('items')
            if not isinstance(items, list):
                raise VideoImportError('Bunny returned an unreadable collection list.')
            matches.extend(item for item in items if str(item.get('name', '')).strip().casefold() == name.casefold())
            if len(items) < 100:
                break
        else:
            raise VideoImportError('The Bunny collection list is incomplete. Administrator review is needed.')
        if len(matches) > 1:
            raise VideoImportError('More than one Bunny collection is named Free course. Administrator review is needed.')
        # After a lost create response, a retry finds the collection here before
        # attempting another POST. API errors remain visible to the importer.
        collection = matches[0] if matches else self.request('POST', '/collections', json={'name': name})
        guid = collection.get('guid')
        if not isinstance(guid, str) or not re.fullmatch(r'[0-9a-fA-F-]{36}', guid):
            raise VideoImportError('Bunny returned an invalid collection identity.')
        return guid

    def find_import(self, import_id, *, exclude_video_ids=()):
        marker = f'[LMS:{import_id}]'
        result = self.request('GET', '/videos', params={'search': marker, 'itemsPerPage': 100})
        matches = [v for v in result.get('items', []) if v.get('guid') not in exclude_video_ids and (
            v.get('title', '').startswith(marker + ' ') or v.get('title', '').endswith(' ' + marker))]
        if len(matches) > 1:
            raise VideoImportError('More than one Bunny video matches this import. Administrator review is needed.')
        return matches[0] if matches else None

    def create(self, import_id, title, collection_id, *, scope=None):
        # Keep this marker even after completion: it recovers an accepted create
        # whose response was lost, without creating another remote video.
        return self.request('POST', '/videos', json={
            'title': video_title(import_id, title, scope), 'collectionId': collection_id,
        })

    def rename(self, video_id, import_id, title, scope):
        return self.request('POST', f'/videos/{video_id}', json={
            'title': video_title(import_id, title, scope),
        })

    def move_to_collection(self, video_id, collection_id):
        """Change only the folder; retain the encoded media and playback identity."""
        before = self.video(video_id)
        if before.get('guid') != video_id:
            raise VideoImportError('The Bunny recording identity could not be verified.')
        if before.get('collectionId') != collection_id:
            self.request('POST', f'/videos/{video_id}', json={'collectionId': collection_id})
        after = self.video(video_id)
        if after.get('guid') != video_id or after.get('collectionId') != collection_id:
            raise VideoImportError('Bunny has not confirmed the recording collection change.')
        if before.get('status') == 4 and any(before.get(key) != after.get(key)
                                             for key in ('status', 'length', 'storageSize')):
            raise VideoImportError('The recording media changed during collection verification. Review the saved identity.')
        return after

    def metadata(self, video_id, scope, title):
        tags = [{'property': 'lms.' + key, 'value': str(value or '')}
                for key, value in {**scope, 'title': title}.items()]
        self.request('POST', f'/videos/{video_id}', json={'metaTags': tags})

    def upload(self, video_id, file_obj):
        file_obj.seek(0)
        return self.request('PUT', f'/videos/{video_id}', data=file_obj,
                            headers={'Content-Type': 'application/octet-stream'}, timeout=(15, 1200))

    def video(self, video_id, *, timeout=(15, 60)):
        return self.request('GET', f'/videos/{video_id}', timeout=timeout)

    def caption(self, video_id, content, *, label):
        result = self.request('POST', f'/videos/{video_id}/captions/en', timeout=(3, 8), json={
            'srclang': 'en', 'label': label,
            'captionsFile': base64.b64encode(content.encode('utf-8')).decode('ascii'),
        })
        if result.get('data', {}).get('valid') is False:
            raise VideoImportError('Bunny could not validate the saved captions.')
        return result
