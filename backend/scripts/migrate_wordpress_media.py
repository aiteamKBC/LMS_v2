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
from tempfile import TemporaryFile
from threading import Lock, local
from urllib.parse import parse_qs, quote, unquote, urljoin, urlsplit

PREFIX = '/curriculum_api/curriculum/uploads/'
FIELDS = ('source_url', 'video_iframe_url', 'audio_iframe_url', 'reading_iframe_url')
PAYLOAD_FIELDS = (*FIELDS, 'iframe_url', 'reading_text_body', 'text_body', 'html_body', 'lms_cleared_media_fields')
NATIVE_FIELDS = ('videoUrl', 'audioUrl', 'resourceUrl', 'podcastUrl', 'presentationUrl',
                 'uploadedFileUrl', 'assignmentFileUrl', 'readingContent', 'embedCode',
                 'lessonContent', 'transcript', 'attachments',
                 'lessonMaterialLinks', 'speakerNotes', 'assignmentBrief')
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
    if re.fullmatch(r'/wp-json/kbc-lms/v1/material/[0-9]+/view', parsed.path) and reference.isdigit():
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


def material_patch(row, mapping, host, attachments, reading=''):
    """Only active media fields change; quiz/history and unknown keys survive."""
    payload = deepcopy(row.get('payload') or {})
    changes = {field: replace_urls(row.get(field), mapping, host) for field in FIELDS}
    for field in PAYLOAD_FIELDS:
        if field in payload:
            payload[field] = replace_urls(payload[field], mapping, host)
    if attachments:
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

    def save_file(self, key, result):
        with self.guard:
            self.state['files'][key] = result
            self.state_path.parent.mkdir(parents=True, exist_ok=True)
            temp = self.state_path.with_suffix('.tmp')
            temp.write_text(json.dumps(self.state), encoding='utf-8')
            temp.replace(self.state_path)

    def get_json(self, path, *, authenticated=False):
        url = path if path.startswith('https://') else self.origin + path
        if urlsplit(url).hostname != self.host:
            raise ValueError('unapproved_source')
        headers = {'Accept': 'application/json'}
        if authenticated:
            headers['X-KBC-API-Key'] = self.settings.KBC_LMS_API_KEY
        with self.requests.Session() as session:
            session.trust_env = False
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

    def inventory(self):
        for blob in self.store.list_blobs(include=['metadata']):
            self.blobs[blob.name] = {'size': blob.size, 'mime': blob.content_settings.content_type or '',
                                    'sha256': (blob.metadata or {}).get('sha256')}
            match = re.fullmatch(r'_legacy_files/([0-9]+)/[^/]+', blob.name)
            if match and blob.size:
                self.by_attachment[match[1]].append(blob.name)

    def known(self, key):
        saved = self.state['files'].get(key)
        if saved:
            actual = self.blobs.get(saved['blob'])
            if actual and actual['size'] == saved['size'] and actual['mime'] == saved['mime']:
                return saved
        if key.startswith('attachment:'):
            names = self.by_attachment.get(key.split(':')[1], [])
            if len(names) == 1:
                name = names[0]
                return {'blob': name, **self.blobs[name], 'url': PREFIX + quote(name, safe='/')}
        return None

    def upload(self, data, name, mime, size, sha):
        from azure.core.exceptions import ResourceExistsError
        blob = self.store.get_blob_client(name)
        try:
            blob.upload_blob(data, overwrite=False, metadata={'sha256': sha},
                content_settings=self.ContentSettings(content_type=mime, content_disposition='inline'),
                max_concurrency=2)
        except ResourceExistsError:
            pass
        props = blob.get_blob_properties()
        if props.size != size or props.metadata.get('sha256') != sha:
            raise ValueError('upload_verification_failed')
        result = {'blob': name, 'mime': mime, 'size': size, 'sha256': sha,
                  'url': PREFIX + quote(name, safe='/')}
        with self.guard:
            self.blobs[name] = result
            self.counts['uploaded_files'] += 1
            self.counts['uploaded_bytes'] += size
        return result

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
            with TemporaryFile() as output, self.requests.Session() as session:
                session.trust_env = False
                with session.get(url, headers={'Accept-Encoding': 'identity'}, stream=True,
                                 allow_redirects=False, timeout=(10, 60)) as response:
                    response.raise_for_status()
                    if response.status_code != 200:
                        raise ValueError('source_redirect')
                    mime = response.headers.get('Content-Type', '').split(';')[0].lower().strip()
                    if mime == 'application/octet-stream' and expected_mime:
                        mime = expected_mime
                    if expected_mime and mime != expected_mime:
                        raise ValueError('source_mime_mismatch')
                    size, digest = 0, hashlib.sha256()
                    for chunk in response.iter_content(256*1024):
                        if not chunk:
                            continue
                        if size == 0 and not valid_signature(mime, chunk):
                            raise ValueError('invalid_file_content')
                        size += len(chunk)
                        if size > self.args.max_mb*1024*1024:
                            raise ValueError('file_too_large')
                        digest.update(chunk)
                        output.write(chunk)
                    if not size:
                        raise ValueError('empty_file')
                    declared = response.headers.get('Content-Length')
                    if declared and not response.headers.get('Content-Encoding') and int(declared) != size:
                        raise ValueError('incomplete_download')
                sha = digest.hexdigest()
                filename = safe_filename(filename or parsed.path)
                # Content-addressed names never overwrite an older migrated file.
                folder = '_legacy_files/' + key.split(':')[1] if key.startswith('attachment:') else '_wordpress_files/' + sha
                name = folder + '/' + sha[:12] + '-' + filename
                output.seek(0)
                result = self.upload(output, name, mime, size, sha)
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
        attachments = deepcopy((payload.get('source') or {}).get('attachments') or [])
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
            reference = str(item.get('attachment_id') or '')
            if reference.isdigit():
                needed.setdefault('attachment:' + reference, '')
        for key, value in needed.items():
            if not key.startswith(('attachment:', 'file:')):
                continue
            try:
                if key in self.unavailable:
                    failures.append(self.unavailable[key])
                    continue
                expected = next((item.get('mime_type') or '' for item in attachments
                    if key == 'attachment:' + str(item.get('attachment_id'))), '')
                mapping[key] = self.copy_file(key, value, expected_mime=expected)
            except Exception as error:
                problem = {'key': key, 'error': type(error).__name__, 'status': getattr(getattr(error, 'response', None), 'status_code', None)}
                failures.append(problem)
                with self.guard:
                    self.unavailable[key] = problem
        for item in attachments:
            found = mapping.get('attachment:' + str(item.get('attachment_id')))
            if found:
                item['lms_url'] = found['url']
        reading = ''
        if schema:
            schema_key = source_key(schema.get('iframe_url'), self.host)
            selected = mapping.get(schema_key)
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
            if key.startswith('page:') and 'blob' in result:
                self.save_file(key, result)
        return {'material_id': row['material_id'], 'changed': bool(fields or patch), 'unresolved': failures}

    def native_rows(self):
        rows, after = [], ''
        while True:
            with self.connect() as conn, conn.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout='30s'")
                cur.execute('''SELECT id,updated_at,(SELECT coalesce(jsonb_object_agg(key,value),'{}'::jsonb)
                FROM jsonb_each(settings_json) WHERE key=ANY(%s) AND value::text LIKE %s) AS settings_json
                FROM curriculum.components WHERE deleted_at IS NULL AND id::text>%s
                AND EXISTS (SELECT 1 FROM jsonb_each(settings_json)
                    WHERE key=ANY(%s) AND value::text LIKE %s)
                ORDER BY id::text LIMIT 500''',
                [list(NATIVE_FIELDS), '%' + self.host + '%', after, list(NATIVE_FIELDS), '%' + self.host + '%'])
                batch = cur.fetchall()
            if not batch:
                return rows
            rows.extend(row for row in batch if any(source_key(url, self.host)
                for key in NATIVE_FIELDS for url in urls((row['settings_json'] or {}).get(key))))
            after = str(batch[-1]['id'])
            self.emit(stage='component_inventory', candidates=len(rows))

    def process_native(self, row):
        values = {k: row['settings_json'][k] for k in NATIVE_FIELDS if k in row['settings_json']}
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
        patch = {k: replace_urls(v, mapping, self.host) for k, v in values.items()
                 if replace_urls(v, mapping, self.host) != v}
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
    if not 1 <= args.workers <= 4:
        parser.error('Use one to four transfer workers.')
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
