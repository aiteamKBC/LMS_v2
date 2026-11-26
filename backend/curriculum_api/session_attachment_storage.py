"""Private files: optional Bunny Storage or the existing LMS archive backend."""
import os
import re
from urllib.parse import quote

import requests

from .session_attachment_policy import AttachmentError, MAX_FILE_BYTES

STORAGE_HOSTS = frozenset(('storage.bunnycdn.com', 'uk.storage.bunnycdn.com', 'ny.storage.bunnycdn.com',
                         'la.storage.bunnycdn.com', 'sg.storage.bunnycdn.com', 'se.storage.bunnycdn.com',
                         'br.storage.bunnycdn.com', 'jh.storage.bunnycdn.com', 'syd.storage.bunnycdn.com'))


def bunny_configuration():
    zone = os.environ.get('BUNNY_SESSION_ATTACHMENTS_ZONE', '').strip()
    key = os.environ.get('BUNNY_SESSION_ATTACHMENTS_KEY', '').strip()
    host = os.environ.get('BUNNY_SESSION_ATTACHMENTS_HOST', 'storage.bunnycdn.com').strip()
    if not zone and not key:
        return None
    if not (re.fullmatch(r'[A-Za-z0-9_-]{1,100}', zone) and key and host in STORAGE_HOSTS):
        raise AttachmentError('Session attachment storage configuration is incomplete.')
    return zone, key, host


def bunny_request(method, path, **kwargs):
    config = bunny_configuration()
    if not config:
        raise AttachmentError('Bunny attachment storage is not configured.')
    zone, key, host = config
    if not re.fullmatch(r'session-attachments/[a-f0-9]{64}/[a-f0-9]{64}\.[a-z0-9]+', path):
        raise AttachmentError('Invalid saved attachment path.')
    try:
        response = requests.request(method, f'https://{host}/{quote(zone, safe="")}/{path}',
                                    headers={'AccessKey': key, **kwargs.pop('headers', {})},
                                    allow_redirects=False, timeout=(10, 60), **kwargs)
    except requests.RequestException:
        raise AttachmentError('Attachment storage could not be reached. Please retry.') from None
    if not 200 <= response.status_code < 300:
        response.close()
        raise AttachmentError('Attachment storage did not accept the request. Please retry.')
    return response


def store(stream, path, mime, digest, size):
    config = bunny_configuration()
    if config:
        with bunny_request('PUT', path, data=stream, headers={'Content-Type': mime, 'Checksum': digest.upper()}) as response:
            pass
        return 'bunny:' + config[0]
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.blob import ContentSettings
    from .session_archive import CONTAINER, storage_client
    blob = storage_client().get_blob_client(CONTAINER, path)
    try:
        blob.upload_blob(stream, overwrite=False, metadata={'sha256': digest},
                         content_settings=ContentSettings(content_type=mime), max_concurrency=1)
    except ResourceExistsError:
        properties = blob.get_blob_properties(logging_enable=False)
        if properties.size != size or properties.metadata.get('sha256') != digest:
            raise AttachmentError('The saved attachment could not be verified.') from None
    return CONTAINER


def file_response(row):
    """Called only after the existing series/learner/occurrence authorization gate."""
    from django.http import HttpResponseRedirect, StreamingHttpResponse
    from django.utils.http import content_disposition_header
    from .session_attachment_policy import filename, public_metadata
    meta = public_metadata(row)
    name = filename(meta['fileName'])
    disposition = content_disposition_header(True, name)
    if str(row['container']).startswith('bunny:'):
        config = bunny_configuration()
        if not config or row['container'] != 'bunny:' + config[0]:
            raise AttachmentError('This attachment storage zone is unavailable.')
        upstream = bunny_request('GET', row['blob_name'], stream=True)
        size = int(meta['sizeBytes'])
        if not 0 < size <= MAX_FILE_BYTES or upstream.headers.get('Content-Length') != str(size):
            upstream.close()
            raise AttachmentError('The attachment size could not be verified.')
        def chunks():
            received = 0
            try:
                for part in upstream.iter_content(64 * 1024):
                    received += len(part)
                    if received > size:
                        raise AttachmentError('The attachment exceeded its saved size.')
                    yield part
                if received != size:
                    raise AttachmentError('The attachment download was incomplete.')
            finally:
                upstream.close()
        response = StreamingHttpResponse(chunks(), content_type='application/octet-stream')
        response['Content-Length'] = str(size)
        response['Content-Disposition'] = disposition
    else:
        from learner_api.evidence_storage import get_read_sas
        response = HttpResponseRedirect(get_read_sas(row['container'], row['blob_name'], ttl_minutes=5,
                                                    content_type='application/octet-stream', content_disposition=disposition))
    response['X-Content-Type-Options'] = 'nosniff'
    response['Cache-Control'] = 'private, no-store'
    return response
