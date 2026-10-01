"""Copy stored direct file URLs to private Azure blobs; dry-run by default.

Run with backend/.venv/Scripts/python.exe -I backend/scripts/backup_source_materials.py
Use --apply only for the intended database and --allow-host for each file host.
No Django startup, old database reads, discovery API, or source record deletion.
"""
import argparse
import hashlib
import ipaddress
import json
import re
import socket
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryFile
from urllib.parse import urljoin, urlsplit, quote, parse_qs, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
import requests
from azure.storage.blob import BlobServiceClient, ContentSettings
from azure.core.exceptions import ResourceExistsError
from config import settings


def validate_url(url, allowed_hosts):
    parts = urlsplit(url)
    if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
            or parts.port not in (None, 443) or parts.hostname.lower() not in allowed_hosts):
        raise ValueError('unapproved_file_host')
    addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
        raise ValueError('non_public_file_host')


def file_url(row):
    # Embedded web players are not downloadable video files. Their responses
    # will be rejected below rather than archived as bogus media.
    return next((row.get(key) for key in ('source_url', 'reading_iframe_url',
        'video_iframe_url', 'audio_iframe_url') if str(row.get(key) or '').startswith('https://')), '')


def drive_download_url(url):
    """Convert a stored Drive file link, retaining any access resource key."""
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname != 'drive.google.com' or parts.username or parts.password:
        return None
    match = re.match(r'^/file/d/([A-Za-z0-9_-]+)(?:/|$)', parts.path)
    params = parse_qs(parts.query)
    ident = match[1] if match else (params.get('id') or [''])[0]
    if not re.fullmatch(r'[A-Za-z0-9_-]+', ident):
        return None
    query = {'id': ident, 'export': 'download'}
    if params.get('resourcekey'):
        query['resourcekey'] = params['resourcekey'][0]
    return 'https://drive.usercontent.google.com/download?' + urlencode(query)


class DriveDownloadForm(HTMLParser):
    """Read only the explicit large-file confirmation form, never scripts."""
    def __init__(self):
        super().__init__()
        self.active = False
        self.forms = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'form':
            self.active = attrs.get('id') == 'download-form'
            if self.active:
                self.forms.append((attrs, {}))
        elif tag == 'input' and self.active and attrs.get('type', '').lower() == 'hidden':
            name = attrs.get('name')
            if name in {'id', 'export', 'confirm', 'uuid', 'resourcekey'}:
                self.forms[-1][1][name] = attrs.get('value', '')

    def handle_endtag(self, tag):
        if tag == 'form':
            self.active = False


def drive_confirmation_url(url, html):
    source = urlsplit(url)
    if source.scheme != 'https' or source.hostname != 'drive.usercontent.google.com' or source.path != '/download':
        return None
    original = parse_qs(source.query)
    parser = DriveDownloadForm()
    parser.feed(html)
    if len(parser.forms) != 1:
        return None
    attrs, values = parser.forms[0]
    action = urlsplit(urljoin(url, attrs.get('action', '')))
    if (attrs.get('method', 'get').lower() != 'get' or action.scheme != 'https'
            or action.hostname != source.hostname or action.path != '/download'
            or action.username or action.password or action.port not in (None, 443)
            or action.query or action.fragment or not values.get('id')
            or [values['id']] != original.get('id') or values.get('export') != 'download'
            or not values.get('confirm')):
        return None
    if original.get('resourcekey'):
        values['resourcekey'] = original['resourcekey'][0]
    return 'https://drive.usercontent.google.com/download?' + urlencode(values)


def download(url, allowed_hosts, output, max_bytes):
    # Restart partial downloads after transient DNS/network failures. Never
    # retry invalid content or permission failures as if they were files.
    for attempt in range(4):
        output.seek(0)
        output.truncate()
        try:
            return download_once(url, allowed_hosts, output, max_bytes)
        except (socket.gaierror, requests.ConnectionError, requests.Timeout,
                requests.exceptions.ChunkedEncodingError):
            if attempt == 3:
                raise
        except requests.HTTPError as error:
            if error.response.status_code not in (429, 500, 502, 503, 504) or attempt == 3:
                raise
        time.sleep(2 ** (attempt + 1))


def download_once(url, allowed_hosts, output, max_bytes):
    with requests.Session() as session:
        session.trust_env = False
        for _ in range(6):
            validate_url(url, allowed_hosts)
            with session.get(url, stream=True, allow_redirects=False, timeout=(10, 60)) as response:
                if response.is_redirect:
                    url = urljoin(url, response.headers['Location'])
                    continue
                response.raise_for_status()
                mime = response.headers.get('Content-Type', '').split(';')[0].lower().strip()
                if mime == 'text/html' and urlsplit(url).hostname == 'drive.usercontent.google.com':
                    # Never archive a login/error/confirmation page as media.
                    # A bounded parser may follow the same file's explicit form.
                    chunks, size = [], 0
                    for chunk in response.iter_content(16384):
                        size += len(chunk)
                        if size > 256 * 1024:
                            raise ValueError('unsupported_or_embedded_content')
                        chunks.append(chunk)
                    html = b''.join(chunks).decode('utf-8', errors='replace')
                    confirmed = drive_confirmation_url(url, html)
                    if confirmed and confirmed != url:
                        url = confirmed
                        continue
                    raise ValueError('source_download_unavailable')
                if not (mime in {'application/pdf', 'application/msword', 'application/vnd.ms-powerpoint',
                                 'application/vnd.ms-excel'} or mime.startswith(('audio/', 'video/',
                                 'application/vnd.openxmlformats-officedocument.'))):
                    raise ValueError('unsupported_or_embedded_content')
                if int(response.headers.get('Content-Length') or 0) > max_bytes:
                    raise ValueError('file_too_large')
                digest, size = hashlib.sha256(), 0
                for chunk in response.iter_content(1024 * 1024):
                    if not chunk:
                        continue
                    if size == 0 and (chunk.lstrip().lower().startswith((b'<!doctype html', b'<html'))
                                      or (mime == 'application/pdf' and not chunk.startswith(b'%PDF-'))):
                        raise ValueError('invalid_file_content')
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError('file_too_large')
                    digest.update(chunk)
                    output.write(chunk)
                if not size:
                    raise ValueError('empty_file')
                output.seek(0)
                return mime, size, digest.hexdigest()
    raise ValueError('too_many_redirects')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--limit', type=int, default=20)
    parser.add_argument('--after-id', type=int, default=0)
    parser.add_argument('--allow-host', action='append', default=[])
    parser.add_argument('--max-mb', type=int, default=512)
    parser.add_argument('--workers', type=int, default=1)
    parser.add_argument('--direct-files-only', action='store_true')
    parser.add_argument('--include-drive', action='store_true')
    parser.add_argument('--record-id', type=int)
    parser.add_argument('--priority-id', type=int)
    parser.add_argument('--videos-only', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.workers <= 8:
        parser.error('workers must be between 1 and 8')
    if args.limit < 1 or args.max_mb < 1:
        parser.error('limit and max-mb must be positive')
    config = settings.DATABASES['enrolment']
    account, container = settings.AZURE_MATERIALS_STORAGE_ACCOUNT, settings.AZURE_MATERIALS_CONTAINER
    if args.apply:
        if not account or not settings.AZURE_MATERIALS_STORAGE_KEY or not args.allow_host:
            parser.error('Material credentials and explicit file hosts are required')
        service = BlobServiceClient(account_url=f'https://{account}.blob.core.windows.net',
            credential=settings.AZURE_MATERIALS_STORAGE_KEY, retry_total=4,
            max_single_put_size=1024*1024, max_block_size=1024*1024)
        # Existing private container only. Do not change account ACLs or create
        # containers as a side effect of backing up content.
        properties = service.get_container_client(container).get_container_properties()
        if properties.public_access:
            raise ValueError('material_container_must_be_private')
    with psycopg.connect(host=config['HOST'], dbname=config['NAME'], user=config['USER'],
            password=config['PASSWORD'], port=config.get('PORT') or 5432, sslmode='require',
            autocommit=True, row_factory=dict_row) as conn:
        if not args.apply:
            conn.read_only = True
        with conn.cursor() as cursor:
            cursor.execute("SET statement_timeout='30s'")
            cursor.execute('''SELECT m.id,m.source_url,m.reading_iframe_url,m.video_iframe_url,
                m.audio_iframe_url,m.content_type,m.updated_at FROM curriculum.source_materials m
                WHERE m.deleted_at IS NULL AND m.id>%s AND (%s::bigint IS NULL OR m.id=%s)
                  AND m.backup_status IS DISTINCT FROM 'available'
                  AND (NOT %s OR lower(m.content_type) IN ('video','recording','live'))
                ORDER BY (m.id=%s) DESC NULLS LAST,m.id LIMIT %s''',
                [args.after_id, args.record_id, args.record_id, args.videos_only, args.priority_id, args.limit])
            rows = cursor.fetchall()
        counts = {'selected': len(rows), 'uploaded': 0, 'skipped': 0, 'failed': 0}
        if not args.apply:
            counts['direct_url_candidates'] = sum(bool(file_url(row)) for row in rows)
            print(json.dumps({'mode': 'dry-run', 'database_alias': 'enrolment',
                'azure_account': account, 'container': container, **counts}))
            return
        def transfer(row):
            url = (row.get('video_iframe_url') or file_url(row)) if args.videos_only else file_url(row)
            if not url:
                return 'skipped'
            drive_url = drive_download_url(url) if args.include_drive else None
            if drive_url:
                url = drive_url
            if args.direct_files_only and not drive_url and (urlsplit(url).hostname not in args.allow_host
                    or Path(urlsplit(url).path).suffix.lower() not in {'.pdf', '.mp4', '.mp3', '.m4a', '.pptx', '.docx', '.xlsx', '.doc', '.xls', '.ppt'}):
                return 'skipped'
            try:
                with TemporaryFile() as output:
                    mime, size, sha = download(url, set(h.lower() for h in args.allow_host), output, args.max_mb*1024*1024)
                    name = f'source-materials/{row["id"]}/{sha}'
                    blob = service.get_blob_client(container=container, blob=name)
                    try:
                        blob.upload_blob(output, overwrite=False, metadata={'sha256': sha},
                            content_settings=ContentSettings(content_type=mime, content_disposition='inline'),
                            max_concurrency=1, connection_timeout=20, read_timeout=120)
                    except ResourceExistsError:
                        pass
                    props = blob.get_blob_properties()
                    if props.size != size or props.metadata.get('sha256') != sha:
                        raise ValueError('blob_verification_failed')
                permanent_url = f'https://{account}.blob.core.windows.net/{container}/{quote(name, safe="/")}'
                metadata = Jsonb({'azure_storage_account': account, 'azure_blob_url': permanent_url})
                # Large transfers outlive idle database connections. Each
                # completed file gets its own short-lived write connection.
                with psycopg.connect(host=config['HOST'], dbname=config['NAME'], user=config['USER'],
                        password=config['PASSWORD'], port=config.get('PORT') or 5432, sslmode='require',
                        connect_timeout=15, options='-c statement_timeout=30000',
                        row_factory=dict_row) as write_conn, write_conn.cursor() as cursor:
                    cursor.execute('''UPDATE curriculum.source_materials SET blob_container=%s,
                        blob_name=%s,blob_content_type=%s,blob_size_bytes=%s,blob_sha256=%s,
                        backup_status='available',last_backup_at=now(),last_success_at=now(),
                        last_checked_at=now(),last_error=NULL,updated_at=now(),
                        source_metadata=coalesce(source_metadata,'{}'::jsonb)||%s
                        WHERE id=%s AND deleted_at IS NULL AND updated_at IS NOT DISTINCT FROM %s
                        RETURNING id,blob_sha256''', [container,name,mime,size,sha,metadata,row['id'],row['updated_at']])
                    verified = cursor.fetchone()
                    if not verified or verified['blob_sha256'] != sha:
                        raise ValueError('material_changed_during_copy')
                return 'uploaded'
            except Exception as error:
                # Never log URLs, query-string tokens, database credentials or
                # provider exception bodies. Failed copies never become available.
                print(json.dumps({'record_id': row['id'], 'error_type': type(error).__name__,
                    'reason': str(error) if isinstance(error, ValueError) and str(error) in {
                        'unapproved_file_host', 'non_public_file_host', 'unsupported_or_embedded_content',
                        'source_download_unavailable',
                        'file_too_large', 'invalid_file_content', 'empty_file', 'too_many_redirects',
                        'blob_verification_failed', 'material_changed_during_copy'} else None,
                    'http_status': getattr(getattr(error, 'response', None), 'status_code', None)}), flush=True)
                return 'failed'
        print(json.dumps({'status': 'started', 'azure_account': account, 'container': container, **counts}), flush=True)
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(transfer, row): row['id'] for row in rows}
            for index, future in enumerate(as_completed(futures), 1):
                outcome = future.result()
                counts[outcome] += 1
                print(json.dumps({'processed': index, 'record_id': futures[future], 'outcome': outcome, **counts}), flush=True)
        print(json.dumps(counts))
        if counts['failed']:
            raise SystemExit(1)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'error_type': type(error).__name__, 'status': getattr(error, 'status_code', None)}))
        raise SystemExit(1)
