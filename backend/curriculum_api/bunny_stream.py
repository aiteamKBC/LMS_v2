"""Bunny Stream transport. No Django startup, database access or automatic retries.

The library key never leaves the server. A caller must retain the returned video
identity before sending bytes so a retry can reuse it.
"""
from __future__ import annotations

import os
import re
from urllib.parse import urlsplit

import requests


class VideoImportError(Exception):
    """A safe, user-facing error (never an upstream body, URL or credential)."""


COLLECTION_NAMES = {
    'PROG-MM-L6': ('Marketing Manager Level 6',),
    'PROG-ME-L4': ('Marketing Executive Level 4', 'Marketing Excutive Level 4'),
    'PROG-APM-L4': ('Associate Project Management Level 4', 'Associat Project Managment Level 4'),
    'PROG-PCP-L6': ('Project Controls Professional Level 6', 'Project Control Professional Level 6'),
}
FREE_COURSE_COLLECTION = 'Free course'


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
        self.api_key = api_key if api_key is not None else os.environ.get('BUNNY_STREAM_API_KEY', '').strip()
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
                raise VideoImportError('Bunny rejected the library API key or its permissions.')
            if not 200 <= response.status_code < 300:
                raise VideoImportError(f'Bunny returned HTTP {response.status_code}. The original video is unchanged.')
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
        names = {x.casefold() for x in COLLECTION_NAMES.get(programme_id, ())}
        if programme_name:
            names.add(programme_name.strip().casefold())
        matches = []
        for page in range(1, 101):
            result = self.request('GET', '/collections', params={'page': page, 'itemsPerPage': 100})
            items = result.get('items', [])
            matches.extend(item for item in items if str(item.get('name', '')).strip().casefold() in names)
            if len(items) < 100:
                break
        if len(matches) != 1:
            raise VideoImportError('The programme must match exactly one collection in the Curriculum library.')
        return matches[0]['guid']

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

    def metadata(self, video_id, scope, title):
        tags = [{'property': 'lms.' + key, 'value': str(value or '')}
                for key, value in {**scope, 'title': title}.items()]
        self.request('POST', f'/videos/{video_id}', json={'metaTags': tags})

    def upload(self, video_id, file_obj):
        file_obj.seek(0)
        return self.request('PUT', f'/videos/{video_id}', data=file_obj,
                            headers={'Content-Type': 'application/octet-stream'}, timeout=(15, 1200))

    def video(self, video_id):
        return self.request('GET', f'/videos/{video_id}')
