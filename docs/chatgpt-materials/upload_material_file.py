"""Upload downloaded material bytes to Azure; never import Django or write to Neon.

Preview is the default. --execute uploads and verifies one file. Existing blobs
are never overwritten; a matching existing file is verified and reused.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
from pathlib import Path
import re

MAX_BYTES = 300 * 1024 * 1024
CHUNK_BYTES = 256 * 1024
MIME_TYPES = {
    '.pdf': 'application/pdf',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pps': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppsx': 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain; charset=utf-8',
    '.rtf': 'application/rtf',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'video/mp4',
    '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg', '.webm': 'video/webm', '.vtt': 'text/vtt',
}


class TransferError(Exception):
    """A deliberately credential-free error message."""


def load_config(path):
    values = {}
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def checked_id(value):
    if (
        not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,127}', value)
        or value.lower().startswith('training-module-')
        or any(marker in value.upper() for marker in ('REPLACE', 'UNSELECTED', 'EXAMPLE'))
    ):
        raise TransferError('Use the verified canonical module/component IDs, without placeholders or paths.')
    return value


def build_plan(file_path, module_id, component_id, config):
    module_id, component_id = checked_id(module_id), checked_id(component_id)
    file_path = Path(file_path).resolve(strict=True)
    if not file_path.is_file():
        raise TransferError('The source must be a downloaded local file.')
    suffix = file_path.suffix.lower()
    if suffix not in MIME_TYPES:
        raise TransferError('Unsupported material extension. HTML and executable files are not accepted.')
    size = file_path.stat().st_size
    if size <= 0 or size > MAX_BYTES:
        raise TransferError('Material must be non-empty and no larger than 300 MiB.')
    digest = hashlib.sha256()
    with file_path.open('rb') as stream:
        first = stream.read(CHUNK_BYTES)
        probe = first.lstrip(b'\xef\xbb\xbf \t\r\n').lower()
        if probe.startswith((b'<!doctype html', b'<html')):
            raise TransferError('The downloaded file is an HTML page, possibly a sign-in page. Retrieve the actual file content.')
        digest.update(first)
        count = len(first)
        for chunk in iter(lambda: stream.read(CHUNK_BYTES), b''):
            count += len(chunk)
            if count > MAX_BYTES:
                raise TransferError('The source exceeds the size limit.')
            digest.update(chunk)
    if count != size:
        raise TransferError('The source changed during inspection. Retry with a stable local file.')
    sha256 = digest.hexdigest()
    stem = re.sub(r'[^A-Za-z0-9_-]+', '-', file_path.stem).strip('-_')[:64] or 'material'
    blob_name = f'{module_id}/{component_id}/{stem}-{sha256}{suffix}'
    container = config.get('AZURE_CURRICULUM_CONTAINER') or 'curriculum-uploads'
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', container) or '--' in container:
        raise TransferError('Invalid configured curriculum container name.')
    return {
        'moduleCatalogueId': module_id, 'componentId': component_id,
        'container': container, 'blobName': blob_name,
        'lmsUrl': '/curriculum_api/curriculum/uploads/' + blob_name,
        'fileName': file_path.name, 'contentType': MIME_TYPES[suffix],
        'sizeBytes': size, 'sha256': sha256,
    }


def upload_and_verify(file_path, plan, config, service_factory=None):
    from azure.core.exceptions import ResourceExistsError
    from azure.storage.blob import BlobServiceClient, ContentSettings

    account, key = config.get('AZURE_STORAGE_ACCOUNT', ''), config.get('AZURE_STORAGE_KEY', '')
    if not re.fullmatch(r'[a-z0-9]{3,24}', account) or not key:
        raise TransferError('The selected environment file must contain a valid Azure account and key.')
    factory = service_factory or BlobServiceClient
    with factory(
        account_url=f'https://{account}.blob.core.windows.net', credential=key,
        max_single_put_size=CHUNK_BYTES, max_block_size=CHUNK_BYTES,
        retry_total=2, connection_timeout=10, read_timeout=30,
    ) as service:
        blob = service.get_blob_client(container=plan['container'], blob=plan['blobName'])
        # The existing container is required. No container or permission changes.
        status = 'uploaded_and_verified'
        try:
            with Path(file_path).open('rb') as stream:
                blob.upload_blob(
                    stream, overwrite=False, length=plan['sizeBytes'],
                    content_settings=ContentSettings(content_type=plan['contentType']),
                    metadata={'sha256': plan['sha256']}, max_concurrency=1,
                )
        except ResourceExistsError:
            status = 'existing_and_verified'
        if blob.get_blob_properties().size != plan['sizeBytes']:
            raise TransferError('Destination size does not match. Nothing was overwritten or deleted; inspect the destination.')
        # Read the destination bytes: uploaded metadata alone is not verification.
        digest, count = hashlib.sha256(), 0
        for chunk in blob.download_blob(max_concurrency=1).chunks():
            digest.update(chunk)
            count += len(chunk)
        if count != plan['sizeBytes'] or digest.hexdigest() != plan['sha256']:
            raise TransferError('Destination checksum does not match. Do not register this material in the LMS.')
    return status


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env', type=Path, default=Path(__file__).with_name('PRIVATE_CONNECTIONS.env'))
    parser.add_argument('--file', type=Path, required=True, help='Actual downloaded file, not a SharePoint URL.')
    parser.add_argument('--module-id', required=True, help='Verified canonical module catalogue ID.')
    parser.add_argument('--component-id', required=True, help='Stable component ID allocated for this material.')
    parser.add_argument('--execute', action='store_true', help='Upload the file and verify the destination bytes.')
    args = parser.parse_args(argv)
    logging.getLogger('azure').setLevel(logging.CRITICAL)
    plan = None
    try:
        config = load_config(args.env)
        plan = build_plan(args.file, args.module_id, args.component_id, config)
        status = upload_and_verify(args.file, plan, config) if args.execute else 'preview_only_no_network_requests'
        print(json.dumps({
            'status': status, **plan,
            'databaseChanged': False, 'learnerVisibilityVerified': False,
        }, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:
        # SDK exceptions can contain URLs/tokens: never print str(exc) blindly.
        message = str(exc) if isinstance(exc, TransferError) else 'Transfer failed. Check the source file, configuration and reported error code.'
        code = str(getattr(exc, 'error_code', '') or '')
        code = code if re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', code) else None
        print(json.dumps({
            'status': 'failed_not_verified', 'error': message,
            'errorType': type(exc).__name__, 'azureErrorCode': code,
            'destination': plan, 'databaseChanged': False,
        }, ensure_ascii=False, indent=2))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
