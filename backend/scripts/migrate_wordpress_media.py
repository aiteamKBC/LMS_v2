"""Migrate active WordPress lesson media to the existing Azure curriculum store.

Dry run by default; --apply requires the printed database fingerprint. No Django
startup, learner/history writes, source deletion, ACL changes or blob overwrites.
Only configured WordPress GETs are allowed. Credentials and signed URLs are never
logged or saved to the resumable state file. Run with Python -I -B.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
from tempfile import TemporaryFile
from threading import Lock, local
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

PREFIX = '/curriculum_api/curriculum/uploads/'
FIELDS = ('source_url', 'video_iframe_url', 'audio_iframe_url', 'reading_iframe_url')
PAYLOAD_FIELDS = (*FIELDS, 'iframe_url', 'reading_text_body', 'text_body', 'html_body',
                  'lms_cleared_media_fields', 'lms_media_attachments')
NATIVE_FIELDS = ('videoUrl', 'audioUrl', 'resourceUrl', 'podcastUrl', 'presentationUrl',
                 'uploadedFileUrl', 'assignmentFileUrl', 'readingContent', 'embedCode',
                 'lessonContent', 'transcript', 'attachments',
                 'lessonMaterialLinks', 'speakerNotes', 'assignmentBrief',
                 'componentFiles', 'readingUrl', 'handbookUrl', 'podcastEmbedCode',
                 'assignmentContent', 'resourceDownloadsHtml')
URL_PATTERN = re.compile(r'https?://[^\s"\'<>\\]+')


def unwrap(value):
    value = html.unescape(str(value or ''))
    for _ in range(3):
        parsed = urlsplit(value)
        if parsed.hostname != 'view.officeapps.live.com':
            break
        value = (parse_qs(parsed.query).get('src') or [''])[0]
    return value


def source_key(value, host):
    parsed = urlsplit(unwrap(value))
    if parsed.scheme not in {'http', 'https'} or parsed.hostname != host or parsed.username or parsed.password:
        return ''
    reference = (parse_qs(parsed.query).get('attachment_id') or [''])[0]
    if re.fullmatch(r'/wp-json/kbc-lms/v1/material/[0-9]+/(?:view|embed)', parsed.path) and reference.isdigit():
        return 'attachment:' + reference
    if parsed.path.startswith('/wp-content/uploads/'):
        return 'file:' + hashlib.sha256(unquote(parsed.path).encode()).hexdigest()
    return 'page:' + hashlib.sha256(unquote(parsed.path).rstrip('/').encode()).hexdigest()


def urls(value):
    if isinstance(value, str):
        yield from URL_PATTERN.findall(value)
    elif isinstance(value, dict):
        for nested in value.values():
            yield from urls(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from urls(nested)


def replace_urls(value, mapping, host):
    if isinstance(value, str):
        return URL_PATTERN.sub(lambda match: mapping.get(source_key(match[0], host), {}).get('url', match[0]), value)
    if isinstance(value, list):
        return [replace_urls(item, mapping, host) for item in value]
    if isinstance(value, dict):
        return {key: replace_urls(item, mapping, host) for key, item in value.items()}
    return value


def safe_filename(value):
    name = unquote(str(value or '')).replace('\\', '/').rsplit('/', 1)[-1]
    name = re.sub(r'[\x00-\x1f<>:"|?*]', '_', name).strip(' .')
    if not name or name in {'.', '..'}:
        raise ValueError('invalid_filename')
    return name[:180]


def native_media_values(settings):
    """Select only active media, including the author's legacy field aliases."""
    values = {key: settings[key] for key in NATIVE_FIELDS if key in settings}
    legacy = settings.get('legacySettings')
    if isinstance(legacy, str):
        try:
            legacy = json.loads(legacy)
        except ValueError:
            legacy = None
    if isinstance(legacy, dict):
        media = {key: legacy[key] for key in NATIVE_FIELDS if key in legacy}
        if media:
            values['legacySettings'] = media
    return values


def native_media_patch(settings, mapping, host):
    values = native_media_values(settings)
    patch = {key: replace_urls(value, mapping, host) for key, value in values.items()
             if replace_urls(value, mapping, host) != value}
    if 'legacySettings' in patch:
        original = settings['legacySettings']
        legacy = json.loads(original) if isinstance(original, str) else original
        merged = {**legacy, **patch['legacySettings']}
        patch['legacySettings'] = json.dumps(merged) if isinstance(original, str) else merged
    return patch


def valid_signature(mime, data):
    if not data or data.lstrip().lower().startswith((b'<!doctype html', b'<html')):
        return False
    if mime == 'application/pdf':
        return data.startswith(b'%PDF-')
    if 'openxmlformats' in mime or mime == 'application/zip':
        return data.startswith(b'PK')
    if mime in {'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'}:
        return data.startswith(bytes.fromhex('d0cf11e0'))
    if mime.startswith('video/'):
        return b'ftyp' in data[:32] or data.startswith((bytes.fromhex('1a45dfa3'), b'RIFF', b'OggS'))
    if mime.startswith('audio/'):
        return data.startswith((b'ID3', b'RIFF', b'OggS', b'fLaC')) or b'ftyp' in data[:32] or (len(data) > 1 and data[0] == 255 and data[1] >= 224)
    if mime.startswith('image/'):
        return data.startswith((b'\x89PNG', b'\xff\xd8\xff', b'GIF8', b'RIFF', b'BM'))
    return mime in {'text/plain', 'text/csv', 'application/rtf'}


def download_parts(session, url, output, max_bytes, expected_mime='', progress=None):
    """Bounded, retryable ranges; never combine different versions of a file."""
    import requests
    offset, total, validator, digest, mime = 0, None, '', hashlib.sha256(), ''
    block = 512 * 1024
    while total is None or offset < total:
        headers = {'Accept-Encoding': 'identity', 'Range': f'bytes={offset}-{offset + block - 1}'}
        if validator:
            headers['If-Range'] = validator
        for attempt in range(3):
            try:
                with session.get(url, headers=headers, stream=True, allow_redirects=False, timeout=(10, 20)) as response:
                    response.raise_for_status()
                    current_mime = response.headers.get('Content-Type', '').split(';')[0].lower().strip()
                    if current_mime == 'application/octet-stream' and expected_mime:
                        current_mime = expected_mime
                    if (expected_mime and current_mime != expected_mime) or (mime and mime != current_mime):
                        raise ValueError('source_mime_mismatch')
                    etag = response.headers.get('ETag') or ''
                    current_validator = (etag if not etag.startswith('W/') else '') or response.headers.get('Last-Modified') or ''
                    if validator and current_validator != validator:
                        raise ValueError('source_changed_during_download')
                    if response.status_code == 206:
                        match = re.fullmatch(r'bytes ([0-9]+)-([0-9]+)/([0-9]+)', response.headers.get('Content-Range', ''))
                        if not match:
                            raise ValueError('invalid_content_range')
                        start, end, length = map(int, match.groups())
                        if start != offset or end < start or end >= length or end - start + 1 > block:
                            raise ValueError('invalid_content_range')
                        if total is not None and total != length:
                            raise ValueError('source_changed_during_download')
                        if length > max_bytes:
                            raise ValueError('file_too_large')
                        if end + 1 < length and not current_validator:
                            raise ValueError('source_version_unverifiable')
                        data = bytearray()
                        for chunk in response.iter_content(65536):
                            data.extend(chunk)
                            if len(data) > end - start + 1:
                                raise ValueError('invalid_content_range')
                        if len(data) != end - start + 1:
                            raise requests.exceptions.ChunkedEncodingError('Incomplete source range')
                        total = length
                    elif response.status_code == 200 and offset == 0:
                        declared = response.headers.get('Content-Length')
                        if declared and int(declared) > max_bytes:
                            raise ValueError('file_too_large')
                        # A source without ranges is still streamed to disk.
                        output.seek(0)
                        output.truncate()
                        digest, size = hashlib.sha256(), 0
                        for chunk in response.iter_content(256*1024):
                            if not chunk:
                                continue
                            if size == 0 and not valid_signature(current_mime, chunk):
                                raise ValueError('invalid_file_content')
                            size += len(chunk)
                            if size > max_bytes:
                                raise ValueError('file_too_large')
                            output.write(chunk)
                            digest.update(chunk)
                        if not size or (declared and size != int(declared)):
                            raise requests.exceptions.ChunkedEncodingError('Incomplete source file')
                        return current_mime, size, digest.hexdigest()
                    else:
                        raise ValueError('source_changed_or_redirected')
                    if offset == 0 and not valid_signature(current_mime, data):
                        raise ValueError('invalid_file_content')
                    mime, validator = current_mime, current_validator
                    output.write(data)
                    digest.update(data)
                    offset += len(data)
                    if progress and (offset == total or offset % (32 * block) == 0):
                        progress(offset, total)
                    break
            except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError):
                if attempt == 2:
                    raise
                time.sleep(attempt + 1)
        else:
            raise ValueError('incomplete_download')
    return mime, offset, digest.hexdigest()


def source_file_header(session, url, max_bytes, expected_mime=''):
    """Read a bounded signature and a strong version for conditional Azure copy."""
    with session.get(url, headers={'Accept-Encoding': 'identity', 'Range': 'bytes=0-65535'},
                     stream=True, allow_redirects=False, timeout=(10, 20)) as response:
        response.raise_for_status()
        etag = response.headers.get('ETag') or ''
        if response.status_code != 206 or not etag or etag.startswith('W/'):
            return None
        match = re.fullmatch(r'bytes 0-([0-9]+)/([0-9]+)', response.headers.get('Content-Range', ''))
        if not match:
            raise ValueError('invalid_content_range')
        end, size = map(int, match.groups())
        if end >= size or end >= 65536 or size > max_bytes:
            raise ValueError('invalid_source_size')
        mime = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if mime == 'application/octet-stream' and expected_mime:
            mime = expected_mime
        if expected_mime and mime != expected_mime:
            raise ValueError('source_mime_mismatch')
        data = bytearray()
        for chunk in response.iter_content(65536):
            data.extend(chunk)
            if len(data) > end + 1:
                raise ValueError('invalid_content_range')
        if len(data) != end + 1 or not valid_signature(mime, data):
            raise ValueError('invalid_file_content')
        return {'etag': etag, 'size': size, 'mime': mime, 'head': bytes(data),
                'last_modified': response.headers.get('Last-Modified')}


class ReadingHTML(HTMLParser):
    """Keep reading content, never publish executable WordPress markup."""
    tags = set('p div span h1 h2 h3 h4 h5 h6 br hr ul ol li table thead tbody tfoot tr th td strong b em i u s blockquote pre code a img sub sup'.split())
    void = {'br', 'hr', 'img'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style'}:
            self.hidden += 1
        if tag == 'iframe' and not self.hidden:
            source = dict(attrs).get('src') or ''
            if source.startswith(('https://', 'http://', PREFIX)):
                self.parts.append('<a href="' + html.escape(source, quote=True) + '">Open embedded content</a>')
        if self.hidden or tag not in self.tags:
            return
        accepted = []
        for key, value in attrs:
            if value is None or key not in {'href', 'src', 'alt', 'title', 'colspan', 'rowspan'}:
                continue
            if key in {'href', 'src'} and not (value.startswith(('/', '#', 'https://', 'http://')) and not value.startswith('//')):
                continue
            accepted.append(f' {key}="{html.escape(value, quote=True)}"')
        self.parts.append('<' + tag + ''.join(accepted) + '>')

    def handle_endtag(self, tag):
        if tag in {'script', 'style'} and self.hidden:
            self.hidden -= 1
        elif not self.hidden and tag in self.tags and tag not in self.void:
            self.parts.append('</' + tag + '>')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(html.escape(data))


def clean_reading(value):
    parser = ReadingHTML()
    parser.feed(value)
    return ''.join(parser.parts)


def read_source_json(session, url, headers):
    """Retry interrupted metadata reads without retrying access/not-found errors."""
    import requests
    for attempt in range(3):
        try:
            with session.get(url, headers=headers, allow_redirects=False, stream=True, timeout=(10, 30)) as response:
                response.raise_for_status()
                if response.status_code != 200:
                    raise ValueError('source_redirect')
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 8*1024*1024:
                        raise ValueError('oversized_schema')
                    chunks.append(chunk)
                return json.loads(b''.join(chunks))
        except requests.HTTPError as error:
            if error.response.status_code not in {429, 502, 503, 504} or attempt == 2:
                raise
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError):
            if attempt == 2:
                raise
        time.sleep(attempt + 1)


def recovered_files(records, blobs):
    """Recover committed aliases after an interrupted run, never guess conflicts."""
    candidates = defaultdict(set)
    for record in records:
        for key, name in (record.get('verified_files') or {}).items():
            if re.fullmatch(r'(attachment:[0-9]+|(?:file|page):[0-9a-f]{64})', key):
                candidates[key].add(name)
    result, conflicts = {}, 0
    for key, names in candidates.items():
        if len(names) != 1:
            conflicts += 1
            continue
        name = next(iter(names))
        actual = blobs.get(name)
        if not actual or not actual.get('size') or not actual.get('mime'):
            continue
        result[key] = {'blob': name, **actual, 'url': PREFIX + quote(name, safe='/')}
        if name.startswith('_wordpress_text/'):
            result[key]['inline'] = True
    return result, conflicts


def attachment_file_aliases(attachments, mapping, host):
    """An imported attachment's exact file URL identifies its verified blob."""
    matches = defaultdict(dict)
    for item in attachments:
        if not isinstance(item, dict):
            continue
        known = mapping.get('attachment:' + str(item.get('attachment_id')))
        if not known or (item.get('mime_type') and item['mime_type'] != known['mime']):
            continue
        for field in ('file_url', 'open_url'):
            key = source_key(item.get(field), host)
            if key.startswith('file:'):
                matches[key][known['blob']] = known
    return {key: next(iter(choices.values())) for key, choices in matches.items() if len(choices) == 1}


def sharepoint_identity(value):
    """Stable file identity from the source lesson, without any sharing token."""
    parsed = urlsplit(value or '')
    if parsed.scheme != 'https' or parsed.hostname != 'kentbusinesscollege.sharepoint.com':
        return None
    marker = parsed.path.lower().find('/_layouts/')
    identity = next((values[0] for key, values in parse_qs(parsed.query).items()
                     if key.lower() in {'uniqueid', 'sourcedoc'} and values), '').strip('{}').lower()
    if marker < 0 or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', identity):
        return None
    return {'host': parsed.hostname, 'site_path': parsed.path[:marker].lower(), 'unique_id': identity}


def provider_reference(provider, value):
    """Approved direct players retain their original provider and activity type."""
    parsed = urlsplit(value or '')
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        return None
    spotify = (provider == 'spotify' and parsed.netloc == 'open.spotify.com'
               and re.fullmatch(r'/embed/(?:show|episode|track|album|playlist)/[A-Za-z0-9]+', parsed.path))
    youtube = (provider == 'youtube' and parsed.netloc in {'www.youtube.com', 'www.youtube-nocookie.com'}
               and re.fullmatch(r'/embed/[A-Za-z0-9_-]{6,}', parsed.path))
    return {'provider': provider, 'url': value} if spotify or youtube else None


def material_patch(row, mapping, host, attachments, reading=''):
    """Only active media fields change; quiz/history and unknown keys survive."""
    payload = deepcopy(row.get('payload') or {})
    changes = {field: replace_urls(row.get(field), mapping, host) for field in FIELDS}
    for field in PAYLOAD_FIELDS:
        if field in payload:
            payload[field] = replace_urls(payload[field], mapping, host)
    if attachments:
        if payload.get('source') is not None and not isinstance(payload['source'], dict):
            # Some snapshots use source as a provenance string. Keep its type
            # and value, and store the verified attachment manifest separately.
            payload['lms_media_attachments'] = attachments
        else:
            source = deepcopy(payload.get('source') or {})
            source['attachments'] = attachments
            payload['source'] = source
    if reading:
        # A navigation page with inline reading is not a playable media file.
        payload['reading_text_body'] = reading
        for field in FIELDS:
            key = source_key(row.get(field), host)
            if mapping.get(key, {}).get('inline'):
                changes[field] = ''
        for field in (*FIELDS, 'iframe_url'):
            key = source_key((row.get('payload') or {}).get(field), host)
            if mapping.get(key, {}).get('inline'):
                payload[field] = ''
    cleared = set(payload.get('lms_cleared_media_fields') or [])
    cleared.update(field for field in FIELDS if row.get(field) and changes.get(field) == '')
    if reading or any(item.get('url') == '' for item in mapping.values()):
        primary = ('video_iframe_url' if row.get('content_type') in {'video', 'live', 'recording'} else
                   'audio_iframe_url' if row.get('content_type') in {'audio', 'podcast'} else 'reading_iframe_url')
        if not changes.get(primary):
            cleared.add(primary)
    if cleared:
        payload['lms_cleared_media_fields'] = sorted(cleared)
    return {key: value for key, value in changes.items() if value != row.get(key)}, {
        key: value for key, value in payload.items() if value != (row.get('payload') or {}).get(key)}


class Migrator:
    def __init__(self, settings, args):
        import requests
        import psycopg
        from psycopg.rows import dict_row
        from psycopg.types.json import Jsonb
        from azure.storage.blob import BlobServiceClient, ContentSettings
        self.settings, self.args = settings, args
        self.requests, self.psycopg, self.dict_row, self.Jsonb = requests, psycopg, dict_row, Jsonb
        self.ContentSettings = ContentSettings
        self.config = settings.DATABASES['audit']
        self.target = hashlib.sha256(f"{self.config['HOST']}:{self.config['NAME']}".encode()).hexdigest()[:16]
        self.base = settings.KBC_LMS_SCHEMA_URL.rsplit('/', 1)[0]
        self.host = urlsplit(self.base).hostname
        self.origin = f'https://{self.host}'
        self.account, self.container = settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_CURRICULUM_CONTAINER
        self.guard, self.file_locks = Lock(), defaultdict(Lock)
        self.unavailable = {}
        self.thread_state, self.write_connections = local(), []
        self.state_path = Path(__file__).resolve().parents[2] / '.cache/wordpress-azure-migration/state.json'
        from datetime import datetime, timezone
        self.report_path = self.state_path.with_name('run-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S') + '.jsonl')
        self.state = json.loads(self.state_path.read_text()) if self.state_path.exists() else {'files': {}}
        if self.state.get('target', self.target) != self.target:
            raise ValueError('state_target_mismatch')
        self.state['target'] = self.target
        self.state.setdefault('providers', {})
        self.service = BlobServiceClient(account_url=f'https://{self.account}.blob.core.windows.net',
            credential=settings.AZURE_STORAGE_KEY, retry_total=2,
            max_single_put_size=256*1024, max_block_size=256*1024,
            connection_timeout=15, read_timeout=60)
        self.store = self.service.get_container_client(self.container)
        self.blobs, self.by_attachment = {}, defaultdict(list)
        self.counts = Counter()

    def connect(self, *, write=False):
        c = self.config
        conn = self.psycopg.connect(host=c['HOST'], port=c.get('PORT') or 5432,
            dbname=c['NAME'], user=c['USER'], password=c['PASSWORD'],
            sslmode=c.get('OPTIONS', {}).get('sslmode', 'require'), connect_timeout=15, row_factory=self.dict_row)
        conn.read_only = not write
        return conn

    def emit(self, **values):
        print(json.dumps(values), flush=True)
        if self.args.apply:
            self.report_path.parent.mkdir(parents=True, exist_ok=True)
            with self.report_path.open('a', encoding='utf-8') as report:
                report.write(json.dumps(values) + '\n')

    def writer(self):
        # Reuse one connection per worker; transactions end before any transfer.
        # Opening two TLS connections per file makes a large catalogue needlessly
        # slow and adds load to the shared database.
        conn = getattr(self.thread_state, 'writer', None)
        if conn is None or conn.closed:
            conn = self.connect(write=True)
            conn.autocommit = True
            self.thread_state.writer = conn
            with self.guard:
                self.write_connections.append(conn)
        return conn

    def _persist_state(self):
        # Called under the writer lock. On Windows a short-lived reader can
        # prevent atomic replacement; retry the rename, never drop the state.
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.state_path.with_suffix('.tmp')
        temp.write_text(json.dumps(self.state), encoding='utf-8')
        for attempt in range(3):
            try:
                temp.replace(self.state_path)
                return
            except PermissionError:
                if attempt == 2:
                    raise
                time.sleep(0.1 * (attempt + 1))

    def save_file(self, key, result):
        with self.guard:
            self.state['files'][key] = result
            self._persist_state()

    def save_provider(self, key, result):
        if not key.startswith('page:') or not provider_reference(result.get('provider'), result.get('url')):
            raise ValueError('invalid_provider_reference')
        with self.guard:
            self.state['providers'][key] = result
            self._persist_state()

    def get_json(self, path, *, authenticated=False):
        url = path if path.startswith('https://') else self.origin + path
        if urlsplit(url).hostname != self.host:
            raise ValueError('unapproved_source')
        headers = {'Accept': 'application/json'}
        if authenticated:
            headers['X-KBC-API-Key'] = self.settings.KBC_LMS_API_KEY
        with self.requests.Session() as session:
            session.trust_env = False
            return read_source_json(session, url, headers)

    def inventory(self):
        # Render caches and unrelated authored uploads can dwarf the source
        # archive. Small pages also avoid long, fragile listing responses.
        for prefix in ('_legacy_files/', '_wordpress_files/', '_wordpress_text/'):
            for blob in self.store.list_blobs(name_starts_with=prefix, include=['metadata'], results_per_page=250):
                self.blobs[blob.name] = {'size': blob.size, 'mime': blob.content_settings.content_type or '',
                                        'sha256': (blob.metadata or {}).get('sha256'),
                                        'source_version': (blob.metadata or {}).get('source_version')}
                match = re.fullmatch(r'_legacy_files/([0-9]+)/[^/]+', blob.name)
                if match and blob.size:
                    self.by_attachment[match[1]].append(blob.name)
            self.emit(stage='storage_inventory', prefix=prefix, files=len(self.blobs))

    def recover_committed_files(self):
        with self.connect() as conn, conn.cursor() as cur:
            cur.execute("""SELECT source_metadata->'wordpress_azure_migration' AS migration
                FROM curriculum.source_materials WHERE deleted_at IS NULL AND source_system='old_lms'
                AND source_metadata ? 'wordpress_azure_migration'""")
            records = [row['migration'] for row in cur.fetchall()]
            mappings, conflicts = recovered_files(records, self.blobs)
        recovered = 0
        for key, result in mappings.items():
            if key not in self.state['files']:
                self.save_file(key, result)
                recovered += 1
        providers = defaultdict(dict)
        for record in records:
            for key, result in (record.get('resolved_provider_urls') or {}).items():
                verified = provider_reference(result.get('provider'), result.get('url'))
                if verified and key.startswith('page:'):
                    providers[key][verified['url']] = verified
        for key, choices in providers.items():
            if len(choices) == 1 and key not in self.state['providers']:
                self.save_provider(key, next(iter(choices.values())))
            elif len(choices) > 1:
                conflicts += 1
        self.emit(stage='recovered_committed_files', aliases=recovered, conflicts=conflicts)

    def known(self, key):
        saved = self.state['files'].get(key)
        if saved:
            actual = self.blobs.get(saved['blob'])
            if (actual and actual['size'] == saved['size'] and actual['mime'] == saved['mime']
                    and (not saved.get('sha256') or actual.get('sha256') == saved['sha256'])
                    and (not saved.get('source_version') or actual.get('source_version') == saved['source_version'])):
                return saved
            return None
        if key.startswith('attachment:'):
            names = self.by_attachment.get(key.split(':')[1], [])
            if len(names) == 1:
                name = names[0]
                return {'blob': name, **self.blobs[name], 'url': PREFIX + quote(name, safe='/')}
        provider = self.state.get('providers', {}).get(key)
        if provider:
            return provider_reference(provider.get('provider'), provider.get('url'))
        return None

    def upload(self, data, name, mime, size, sha, source_url=''):
        from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
        blob = self.store.get_blob_client(name)
        try:
            props = blob.get_blob_properties()
        except ResourceNotFoundError:
            props = None
        if props is None:
            copied = False
            if source_url:
                parsed = urlsplit(source_url)
                if (parsed.scheme != 'https' or parsed.netloc != self.host
                        or not parsed.path.startswith('/wp-content/uploads/')):
                    raise ValueError('unapproved_copy_source')
                # Azure can read public source files directly. Its MD5 check
                # binds that transfer to the exact bytes already downloaded and
                # SHA-256 verified here, even if the remote file changes later.
                md5 = hashlib.md5()
                if isinstance(data, bytes):
                    md5.update(data)
                else:
                    data.seek(0)
                    for chunk in iter(lambda: data.read(1024*1024), b''):
                        md5.update(chunk)
                    data.seek(0)
                try:
                    blob.upload_blob_from_url(source_url, overwrite=False,
                        source_content_md5=md5.digest(), metadata={'sha256': sha},
                        include_source_blob_properties=False,
                        content_settings=self.ContentSettings(content_type=mime, content_disposition='inline',
                                                              content_md5=md5.digest()))
                    copied = True
                    self.emit(stage='server_copy', bytes=size)
                except ResourceExistsError:
                    copied = True
                except AzureError as error:
                    self.emit(stage='server_copy_fallback', error=type(error).__name__,
                              status=getattr(error, 'status_code', None))
                    # A response timeout can occur after a successful commit.
                    try:
                        props = blob.get_blob_properties()
                        copied = True
                    except ResourceNotFoundError:
                        pass
            if not copied:
                try:
                    blob.upload_blob(data, overwrite=False, metadata={'sha256': sha},
                        content_settings=self.ContentSettings(content_type=mime, content_disposition='inline'),
                        max_concurrency=2)
                except ResourceExistsError:
                    pass
            props = props or blob.get_blob_properties()
        if props.size != size or props.metadata.get('sha256') != sha:
            raise ValueError('upload_verification_failed')
        result = {'blob': name, 'mime': mime, 'size': size, 'sha256': sha,
                  'url': PREFIX + quote(name, safe='/')}
        with self.guard:
            self.blobs[name] = result
            self.counts['uploaded_files'] += 1
            self.counts['uploaded_bytes'] += size
        return result

    def copy_public_file(self, key, url, filename, expected_mime):
        """Conditionally copy, checking source stability and destination bytes."""
        from email.utils import parsedate_to_datetime
        from azure.core import MatchConditions
        from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
        parsed = urlsplit(url)
        if parsed.scheme != 'https' or parsed.netloc != self.host or not parsed.path.startswith('/wp-content/uploads/'):
            raise ValueError('unapproved_copy_source')
        try:
            with self.requests.Session() as session:
                session.trust_env = False
                source = source_file_header(session, url, self.args.max_mb*1024*1024, expected_mime)
            if source is None:
                return None
            version = hashlib.sha256(json.dumps({'key': source_key(url, self.host),
                **{field: source[field] for field in ('etag', 'size', 'mime')}}, sort_keys=True).encode()).hexdigest()
            folder = '_legacy_files/' + key.split(':')[1] if key.startswith('attachment:') else '_wordpress_files/' + version
            name = folder + '/' + version[:12] + '-' + safe_filename(filename or parsed.path)
            blob = self.store.get_blob_client(name)
            try:
                props = blob.get_blob_properties()
            except ResourceNotFoundError:
                try:
                    conditions = {'source_etag': source['etag'],
                                  'source_match_condition': MatchConditions.IfNotModified}
                    # This external HTTP origin's ETag is rejected by Azure's
                    # copy API. Its Last-Modified condition is supported. Also
                    # compare the strong source version after copying: a changed
                    # source must never be linked, including same-second edits.
                    if source.get('last_modified'):
                        modified = parsedate_to_datetime(source['last_modified'])
                        if modified.tzinfo is not None:
                            conditions = {'source_if_unmodified_since': modified}
                    blob.upload_blob_from_url(url, overwrite=False, **conditions, include_source_blob_properties=False,
                        metadata={'source_version': version},
                        content_settings=self.ContentSettings(content_type=source['mime'], content_disposition='inline'))
                except ResourceExistsError:
                    pass
                props = blob.get_blob_properties()
            with self.requests.Session() as session:
                session.trust_env = False
                after = source_file_header(session, url, self.args.max_mb*1024*1024, expected_mime)
            if not after or any(after[field] != source[field] for field in ('etag', 'size', 'mime', 'head')):
                raise ValueError('source_changed_during_copy')
            if (props.size != source['size'] or props.metadata.get('source_version') != version
                    or props.content_settings.content_type != source['mime']):
                raise ValueError('copy_verification_failed')
            if blob.download_blob(offset=0, length=len(source['head'])).readall() != source['head']:
                raise ValueError('copied_signature_mismatch')
            # This is a version identity, not a SHA-256 of the file body.
            # Azure enforces the source condition; the strong ETag is checked
            # before and after the operation, even for timestamp conditions.
            result = {'blob': name, 'mime': source['mime'], 'size': source['size'], 'sha256': None,
                      'source_version': version, 'url': PREFIX + quote(name, safe='/')}
            with self.guard:
                self.blobs[name] = result
                self.counts['uploaded_files'] += 1
                self.counts['uploaded_bytes'] += source['size']
            self.emit(stage='conditional_server_copy', source_key=key, bytes=source['size'])
            return result
        except (AzureError, self.requests.RequestException) as error:
            self.emit(stage='conditional_copy_fallback', source_key=key, error=type(error).__name__)
            return None

    def copy_file(self, key, url='', filename='', expected_mime=''):
        with self.guard:
            lock = self.file_locks[key]
        with lock:
            existing = self.known(key)
            if existing and (not expected_mime or existing['mime'] == expected_mime):
                return existing
            if key.startswith('attachment:'):
                reference = key.split(':')[1]
                meta = self.get_json('/wp-json/wp/v2/media/' + reference)
                if str(meta.get('id')) != reference:
                    raise ValueError('attachment_identity_mismatch')
                url, expected_mime = meta.get('source_url') or '', meta.get('mime_type') or expected_mime
                filename = safe_filename(urlsplit(url).path)
            parsed = urlsplit(url)
            if parsed.hostname != self.host or not parsed.path.startswith('/wp-content/uploads/'):
                raise ValueError('not_a_source_file')
            url = self.origin + quote(parsed.path, safe='/%') + ('?' + parsed.query if parsed.query else '')
            result = self.copy_public_file(key, url, filename, expected_mime)
            if result:
                self.save_file(key, result)
                direct_key = source_key(url, self.host)
                if direct_key.startswith('file:') and direct_key != key:
                    self.save_file(direct_key, result)
                return result
            with TemporaryFile() as output, self.requests.Session() as session:
                session.trust_env = False
                self.emit(stage='source_download', source_key=key)
                mime, size, sha = download_parts(session, url, output, self.args.max_mb*1024*1024,
                    expected_mime, lambda done, total: self.emit(stage='download_progress', source_key=key,
                                                              bytes_read=done, total_bytes=total))
                filename = safe_filename(filename or parsed.path)
                # Content-addressed names never overwrite an older migrated file.
                folder = '_legacy_files/' + key.split(':')[1] if key.startswith('attachment:') else '_wordpress_files/' + sha
                name = folder + '/' + sha[:12] + '-' + filename
                output.seek(0)
                result = self.upload(output, name, mime, size, sha, source_url=url)
            self.save_file(key, result)
            # Public attachment metadata binds the current exact upload URL to
            # this identity; other consumers may store that URL instead of ID.
            direct_key = source_key(url, self.host)
            if direct_key.startswith('file:') and direct_key != key:
                self.save_file(direct_key, result)
            return result

    def staged_sharepoint_file(self, source):
        """Consume only exact files fetched separately with delegated access.

        The migration never requests Microsoft tokens or changes permissions.
        A staged file must carry its original site/GUID and verified SHA-256.
        """
        identity = sharepoint_identity(source)
        if not identity:
            return None
        key = 'sharepoint:' + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        existing = self.known(key)
        if existing:
            return existing
        folder = self.state_path.parent / 'sharepoint-staging'
        manifest = folder / (identity['unique_id'] + '.json')
        if not manifest.exists():
            return None
        record = json.loads(manifest.read_text(encoding='utf-8'))
        if any(record.get(field) != value for field, value in identity.items()):
            raise ValueError('staged_source_identity_mismatch')
        path = folder / (identity['unique_id'] + '.mp4')
        if record.get('mime') != 'video/mp4' or path.stat().st_size != record.get('size'):
            raise ValueError('staged_source_size_or_type_mismatch')
        digest = hashlib.sha256()
        with path.open('rb') as handle:
            first = handle.read(65536)
            if not valid_signature(record['mime'], first):
                raise ValueError('invalid_staged_video')
            digest.update(first)
            for chunk in iter(lambda: handle.read(1024*1024), b''):
                digest.update(chunk)
            sha = digest.hexdigest()
            if sha != record.get('sha256'):
                raise ValueError('staged_source_digest_mismatch')
            handle.seek(0)
            name = '_wordpress_files/' + sha + '/' + identity['unique_id'] + '.mp4'
            result = self.upload(handle, name, record['mime'], record['size'], sha)
        self.save_file(key, result)
        return result

    def read_materials(self):
        rows, after = [], 0
        while True:
            with self.connect() as conn, conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout='30s'")
                cur.execute('''SELECT id,material_id,content_type,source_url,video_iframe_url,audio_iframe_url,
                reading_iframe_url,backup_status,blob_name,updated_at,
                (SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb) FROM jsonb_each(payload)
                    WHERE key=ANY(%s)) AS payload,
                source_metadata#>>'{wordpress_azure_migration,inline_reading}'='true' AS inline_migrated,
                source_metadata->'wordpress_azure_migration' AS migration_state,
                (jsonb_array_length(CASE WHEN jsonb_typeof(payload#>'{quiz,questions}')='array'
                    THEN payload#>'{quiz,questions}' ELSE '[]'::jsonb END)>0) AS has_quiz
                FROM curriculum.source_materials WHERE source_system='old_lms' AND deleted_at IS NULL
                AND id>%s AND (%s::bigint[] IS NULL OR material_id=ANY(%s)) ORDER BY id LIMIT 500''',
                [[*PAYLOAD_FIELDS, 'source'], after, self.args.material_id or None, self.args.material_id or None])
                batch = cur.fetchall()
            if not batch:
                break
            rows.extend(row for row in batch if (row['inline_migrated'] and not row['payload'].get('lms_cleared_media_fields')) or any(source_key(u, self.host) for u in urls(
                {**{k: row.get(k) for k in FIELDS}, 'payload': row['payload']})))
            after = batch[-1]['id']
            self.emit(stage='material_inventory', through_record=after, candidates=len(rows))
        return rows

    def process_material(self, row):
        mapping, failures = {}, []
        payload = row.get('payload') or {}
        source = payload.get('source') if isinstance(payload.get('source'), dict) else {}
        attachments = deepcopy(payload.get('lms_media_attachments', source.get('attachments')) or [])
        if isinstance(attachments, str):
            attachments = json.loads(attachments)
        if not isinstance(attachments, list):
            raise ValueError('invalid_attachment_manifest')
        values = {**{k: row.get(k) for k in FIELDS}, 'payload': {k: payload.get(k) for k in PAYLOAD_FIELDS}}
        needed = {source_key(u, self.host): unwrap(u) for u in urls(values) if source_key(u, self.host)}
        schema = None
        # Navigation may simply be retained provenance for an already stored file.
        primary = ('video_iframe_url' if row['content_type'] in {'video', 'live', 'recording'} else
                   'audio_iframe_url' if row['content_type'] in {'audio', 'podcast'} else 'reading_iframe_url')
        # Do not treat hyperlinks to other lessons inside reading as this lesson.
        page_keys = list({source_key(value, self.host) for value in (
            row.get('source_url'), row.get(primary), payload.get('source_url'),
            payload.get(primary), payload.get('iframe_url')) if source_key(value, self.host).startswith('page:')})
        existing_primary = row.get(primary) or ''
        if row['backup_status'] == 'available' and row['blob_name'] in self.blobs and existing_primary.startswith(PREFIX):
            info = self.blobs[row['blob_name']]
            for key in page_keys:
                mapping[key] = {'url': existing_primary, 'blob': row['blob_name'], **info}
        elif page_keys:
            schema = self.get_json(f'{self.base}/material/{row["material_id"]}/schema', authenticated=True)
            if int(schema.get('material_id') or 0) != row['material_id']:
                raise ValueError('material_identity_mismatch')
            # Keep imported companions; append newly discovered files by identity.
            known_ids = {str(a.get('attachment_id')) for a in attachments if isinstance(a, dict)}
            for item in (schema.get('source') or {}).get('attachments') or []:
                if str(item.get('attachment_id')) not in known_ids:
                    attachments.append(item)
                    known_ids.add(str(item.get('attachment_id')))
            source = schema.get('iframe_url') or ''
            key = source_key(source, self.host)
            if key.startswith(('attachment:', 'file:')):
                needed[key] = unwrap(source)
        for item in attachments:
            if not isinstance(item, dict):
                continue
            reference = str(item.get('attachment_id') or '')
            if reference.isdigit():
                needed.setdefault('attachment:' + reference, '')
                known = self.known('attachment:' + reference)
                if known and (not item.get('mime_type') or known['mime'] == item['mime_type']):
                    mapping['attachment:' + reference] = known
        mapping.update(attachment_file_aliases(attachments, mapping, self.host))
        # Resolve identities before their direct URL aliases to avoid copying
        # large files that already have a verified Azure attachment.
        for key, value in sorted(needed.items(), key=lambda pair: not pair[0].startswith('attachment:')):
            if key.startswith('page:') and key not in page_keys:
                found = self.known(key)
                if found:
                    mapping[key] = found
            if not key.startswith(('attachment:', 'file:')):
                continue
            if key in mapping:
                continue
            try:
                if key in self.unavailable:
                    failures.append(self.unavailable[key])
                    continue
                expected = next((item.get('mime_type') or '' for item in attachments
                    if isinstance(item, dict) and key == 'attachment:' + str(item.get('attachment_id'))), '')
                mapping[key] = self.copy_file(key, value, expected_mime=expected)
                if key.startswith('attachment:'):
                    mapping.update(attachment_file_aliases(attachments, mapping, self.host))
            except Exception as error:
                problem = {'key': key, 'error': type(error).__name__, 'status': getattr(getattr(error, 'response', None), 'status_code', None)}
                failures.append(problem)
                with self.guard:
                    self.unavailable[key] = problem
        for item in attachments:
            if not isinstance(item, dict):
                continue
            found = mapping.get('attachment:' + str(item.get('attachment_id')))
            if found:
                item['lms_url'] = found['url']
        attachments = replace_urls(attachments, mapping, self.host)
        reading = ''
        if schema:
            schema_key = source_key(schema.get('iframe_url'), self.host)
            selected = mapping.get(schema_key) or self.staged_sharepoint_file(schema.get('iframe_url'))
            if not selected and not schema.get('text_body'):
                selected = provider_reference((schema.get('source') or {}).get('provider'), schema.get('iframe_url'))
            if selected:
                mapping.update({key: selected for key in page_keys})
            elif schema.get('text_body'):
                body = next((payload.get(k) for k in ('reading_text_body', 'text_body', 'html_body') if payload.get(k)), schema['text_body'])
                for value in urls(body):
                    key = source_key(value, self.host)
                    if key.startswith(('attachment:', 'file:')) and key not in mapping:
                        try:
                            mapping[key] = self.copy_file(key, unwrap(value))
                        except Exception as error:
                            failures.append({'key': key, 'error': type(error).__name__})
                # The existing LMS renderer sanitizes reading and retains its
                # supported embeds. Only the standalone HTML archive is reduced
                # to inert markup; never remove external lesson content in DB.
                reading = replace_urls(body, mapping, self.host)
                raw = clean_reading(reading).encode('utf-8')
                sha = hashlib.sha256(raw).hexdigest()
                name = f'_wordpress_text/{row["material_id"]}/{sha}.html'
                result = self.upload(raw, name, 'text/html; charset=utf-8', len(raw), sha)
                result['inline'] = True
                mapping.update({key: result for key in page_keys})
            elif row['has_quiz'] and schema.get('component_type') == 'quiz':
                mapping.update({key: {'url': ''} for key in page_keys})
            else:
                failures.append({'key': 'material:' + str(row['material_id']), 'error': 'no_file_or_inline_content'})
        fields, patch = material_patch(row, mapping, self.host, attachments, reading)
        if row.get('inline_migrated') and payload.get('reading_text_body'):
            cleared = sorted(set(payload.get('lms_cleared_media_fields') or []) |
                ({primary} if not row.get(primary) else set()))
            if cleared != payload.get('lms_cleared_media_fields'):
                patch['lms_cleared_media_fields'] = cleared
        selected_primary = fields.get(primary, row.get(primary))
        primary_file = next((item for item in mapping.values() if item.get('url') == selected_primary
                            and 'blob' in item and not item.get('inline')), None)
        if primary_file and row['backup_status'] != 'available':
            fields.update(blob_container=self.container, blob_name=primary_file['blob'],
                blob_content_type=primary_file['mime'], blob_size_bytes=primary_file['size'],
                blob_sha256=primary_file.get('sha256'), backup_status='available')
        if fields or patch:
            from psycopg import sql
            prior = row.get('migration_state') or {}
            metadata = {'wordpress_azure_migration': {**prior,
                'verified_files': {**prior.get('verified_files', {}), **{key: item['blob'] for key, item in mapping.items() if 'blob' in item}},
                'resolved_provider_urls': {**prior.get('resolved_provider_urls', {}),
                    **{key: item for key, item in mapping.items() if item.get('provider') in {'spotify', 'youtube'}}},
                                                     'inline_reading': bool(reading or row.get('inline_migrated'))}}
            if primary_file and row['backup_status'] != 'available':
                metadata['azure_storage_account'] = self.account
            assignments = [sql.SQL('{}=%s').format(sql.Identifier(field)) for field in fields]
            assignments.extend([sql.SQL("payload=coalesce(payload,'{}'::jsonb)||%s"),
                                sql.SQL("source_metadata=coalesce(source_metadata,'{}'::jsonb)||%s"), sql.SQL('updated_at=now()')])
            conn = self.writer()
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(sql.SQL('UPDATE curriculum.source_materials SET {} WHERE id=%s AND deleted_at IS NULL AND updated_at IS NOT DISTINCT FROM %s RETURNING id').format(sql.SQL(',').join(assignments)),
                    [*fields.values(), self.Jsonb(patch), self.Jsonb(metadata), row['id'], row['updated_at']])
                if not cur.fetchone():
                    raise ValueError('material_changed_during_transfer')
            # This SELECT starts after COMMIT, so it verifies committed data.
            with conn.cursor() as cur:
                cur.execute('SELECT payload,source_url,video_iframe_url,audio_iframe_url,reading_iframe_url,blob_container,blob_name,blob_content_type,blob_size_bytes,blob_sha256,backup_status FROM curriculum.source_materials WHERE id=%s', [row['id']])
                actual = cur.fetchone()
                if any(actual[k] != v for k, v in fields.items()) or any(actual['payload'].get(k) != v for k, v in patch.items()):
                    raise ValueError('committed_verification_failed')
        with self.guard:
            self.counts['changed_materials'] += bool(fields or patch)
            self.counts['material_failures'] += bool(failures)
        for key, result in mapping.items():
            if 'blob' in result and self.state['files'].get(key) != result:
                self.save_file(key, result)
            elif result.get('provider') and self.state['providers'].get(key) != result:
                self.save_provider(key, result)
        return {'material_id': row['material_id'], 'changed': bool(fields or patch), 'unresolved': failures}

    def native_rows(self):
        rows, after = [], ''
        fields = [*NATIVE_FIELDS, 'legacySettings']
        while True:
            with self.connect() as conn, conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout='30s'")
                cur.execute('''SELECT id,updated_at,(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
                FROM jsonb_each(settings_json) WHERE key=ANY(%s) AND value::text LIKE %s) AS settings_json
                FROM curriculum.components WHERE deleted_at IS NULL AND id::text>%s
                AND EXISTS (SELECT 1 FROM jsonb_each(settings_json)
                    WHERE key=ANY(%s) AND value::text LIKE %s)
                ORDER BY id::text LIMIT 500''',
                [fields, '%' + self.host + '%', after, fields, '%' + self.host + '%'])
                batch = cur.fetchall()
            if not batch:
                return rows
            rows.extend(row for row in batch if any(source_key(url, self.host)
                for url in urls(native_media_values(row['settings_json'] or {}))))
            after = str(batch[-1]['id'])
            self.emit(stage='component_inventory', candidates=len(rows))

    def process_native(self, row):
        values = native_media_values(row['settings_json'])
        references = {source_key(url, self.host): unwrap(url) for url in urls(values) if source_key(url, self.host)}
        mapping, unresolved = {}, []
        for key, value in references.items():
            found = self.known(key)
            if found:
                mapping[key] = found
                continue
            if key in self.unavailable:
                unresolved.append(key)
                continue
            if key.startswith(('attachment:', 'file:')):
                try:
                    mapping[key] = self.copy_file(key, value)
                    continue
                except Exception as error:
                    with self.guard:
                        self.unavailable[key] = {'key': key, 'error': type(error).__name__,
                            'status': getattr(getattr(error, 'response', None), 'status_code', None)}
            unresolved.append(key)
        patch = native_media_patch(row['settings_json'], mapping, self.host)
        if patch:
            conn = self.writer()
            with conn.transaction(), conn.cursor() as cur:
                cur.execute('''UPDATE curriculum.components SET settings_json=settings_json||%s,updated_at=now()
                    WHERE id=%s AND deleted_at IS NULL AND updated_at IS NOT DISTINCT FROM %s RETURNING id''',
                    [self.Jsonb(patch), row['id'], row['updated_at']])
                if not cur.fetchone():
                    raise ValueError('component_changed_during_transfer')
            with conn.cursor() as cur:
                cur.execute('SELECT settings_json FROM curriculum.components WHERE id=%s', [row['id']])
                actual = cur.fetchone()['settings_json']
                if any(actual.get(k) != v for k, v in patch.items()):
                    raise ValueError('committed_verification_failed')
        with self.guard:
            self.counts['changed_components'] += bool(patch)
            self.counts['components_with_unresolved_links'] += bool(unresolved)
        return {'component_id': str(row['id']), 'changed': bool(patch), 'unresolved_count': len(unresolved)}

    def migrate_audit_links(self):
        """The same attachments also serve imported programme content players."""
        from psycopg import sql
        import ast
        tree = ast.parse((Path(__file__).resolve().parents[1] / 'learner_api/media_proxy.py').read_text(encoding='utf-8'))
        tables = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'PROGRAMME_AUDIT_MATERIAL_TABLES' for target in node.targets))
        for table in tables:
            with self.connect() as conn, conn.cursor() as cur:
                cur.execute(sql.SQL('SELECT id,source_url,embed_url,updated_at FROM programme_audit.{} WHERE source_url LIKE %s OR embed_url LIKE %s').format(sql.Identifier(table)),
                    ['%' + self.host + '%', '%' + self.host + '%'])
                rows = cur.fetchall()
            changed, unresolved = [], 0
            for row in rows:
                mapping = {}
                for value in (row['source_url'], row['embed_url']):
                    key = source_key(value, self.host)
                    found = self.known(key)
                    if found:
                        mapping[key] = found
                    elif key:
                        unresolved += 1
                source = replace_urls(row['source_url'], mapping, self.host)
                embed = replace_urls(row['embed_url'], mapping, self.host)
                if source != row['source_url'] or embed != row['embed_url']:
                    changed.append((source, embed, row['id'], row['updated_at']))
            if changed:
                conn = self.writer()
                with conn.transaction(), conn.cursor() as cur:
                    cur.executemany(sql.SQL('''UPDATE programme_audit.{} SET source_url=%s,embed_url=%s,updated_at=now()
                        WHERE id=%s AND updated_at IS NOT DISTINCT FROM %s RETURNING id''').format(sql.Identifier(table)), changed, returning=True)
                    for item in changed:
                        actual = cur.fetchone()
                        if not actual or actual['id'] != item[2]:
                            raise ValueError('audit_material_changed_during_transfer')
                        cur.nextset()
                with conn.cursor() as cur:
                    cur.execute(sql.SQL('SELECT id,source_url,embed_url FROM programme_audit.{} WHERE id=ANY(%s)').format(sql.Identifier(table)),
                                [[item[2] for item in changed]])
                    actual = {r['id']: r for r in cur.fetchall()}
                    if any(actual[item[2]]['source_url'] != item[0] or actual[item[2]]['embed_url'] != item[1] for item in changed):
                        raise ValueError('committed_verification_failed')
            self.counts['changed_programme_links'] += len(changed)
            self.counts['unresolved_programme_links'] += unresolved
            self.emit(programme=table, changed_links=len(changed), unresolved_links=unresolved)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-target')
    parser.add_argument('--material-id', type=int, action='append', default=[])
    parser.add_argument('--limit', type=int)
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--max-mb', type=int, default=1024)
    parser.add_argument('--phase', choices=['materials', 'native', 'audit', 'all'], default='all')
    args = parser.parse_args()
    if not 1 <= args.workers <= 12:
        parser.error('Use one to twelve transfer workers.')
    if args.max_mb < 1 or (args.limit is not None and args.limit < 1):
        parser.error('Size and selection limits must be positive.')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from config import settings
    worker = Migrator(settings, args)
    worker.emit(mode='apply' if args.apply else 'dry-run', target=worker.target,
                database=worker.config['NAME'], source=worker.host, azure_account=worker.account, container=worker.container)
    if args.apply and args.expected_target != worker.target:
        parser.error('Apply requires the verified --expected-target.')
    rows = worker.read_materials() if args.phase in {'all', 'materials'} else []
    if args.limit:
        rows = rows[:args.limit]
    worker.emit(selected_materials=len(rows), types=dict(Counter(r['content_type'] for r in rows)))
    native = worker.native_rows() if args.phase in {'native', 'all'} and not args.material_id else []
    worker.emit(selected_native_components=len(native))
    if not args.apply:
        return
    worker.store.get_container_properties()  # Existing destination only; no ACL changes.
    worker.inventory()
    worker.recover_committed_files()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(worker.process_material, row): row['material_id'] for row in rows}
        for index, job in enumerate(as_completed(jobs), 1):
            try:
                result = job.result()
            except Exception as error:
                worker.counts['failed_materials'] += 1
                result = {'material_id': jobs[job], 'error': type(error).__name__,
                          'status': getattr(getattr(error, 'response', None), 'status_code', None)}
            worker.emit(processed=index, total=len(rows), **result)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(worker.process_native, row): row['id'] for row in native}
        for index, job in enumerate(as_completed(jobs), 1):
            try:
                result = job.result()
            except Exception as error:
                worker.counts['failed_components'] += 1
                result = {'component_id': str(jobs[job]), 'error': type(error).__name__}
            worker.emit(native_processed=index, total=len(native), **result)
    if args.phase in {'audit', 'all', 'native'} and not args.material_id:
        worker.migrate_audit_links()
    worker.emit(totals=dict(worker.counts))
    for connection in worker.write_connections:
        connection.close()
    worker.service.close()
    if any(worker.counts[k] for k in ('failed_materials', 'material_failures', 'failed_components', 'components_with_unresolved_links', 'unresolved_programme_links')):
        raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1) from None
