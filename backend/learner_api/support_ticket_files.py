"""Private support attachments; reuse the existing evidence storage lifecycle."""
from contextlib import contextmanager
from hashlib import sha256
from io import BytesIO
import logging
from pathlib import PurePosixPath
from uuid import uuid4

from azure.core.exceptions import ResourceNotFoundError
from django.conf import settings
from django.http import HttpResponse
from django.utils.http import content_disposition_header

from . import evidence_storage as storage

logger = logging.getLogger(__name__)
MAX_FILES = 5
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain', '.log': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip',
}


class AttachmentError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def prepare(uploads, ticket_id):
    if len(uploads) > MAX_FILES:
        raise AttachmentError('Attach up to 5 files per ticket or reply.')
    prepared = []
    total = 0
    for upload in uploads:
        name = PurePosixPath(upload.name.replace('\\', '/')).name
        suffix = PurePosixPath(name).suffix.lower()
        if suffix not in TYPES or len(name) > 200 or any(ord(c) < 32 for c in name):
            raise AttachmentError('Choose an image, PDF, Office document, text, log, CSV or ZIP file (filename up to 200 characters).')
        if not 0 < upload.size <= MAX_FILE_BYTES:
            raise AttachmentError('Each attachment must be non-empty and no larger than 10 MB.')
        content = upload.read(MAX_FILE_BYTES + 1)
        total += len(content)
        if len(content) != upload.size or total > MAX_TOTAL_BYTES:
            raise AttachmentError('Attachments must total no more than 25 MB.')
        file_id = str(uuid4())
        prepared.append(({
            'id': file_id, 'name': name, 'size': len(content), 'contentType': TYPES[suffix],
            'sha256': sha256(content).hexdigest(),
            'container': settings.AZURE_APPROVED_CONTAINER,
            'blobName': f'support-tickets/{ticket_id}/{file_id}',
        }, content))
    return prepared


def matches(saved, prepared):
    fields = ('name', 'size', 'sha256')
    return [[item.get(key) for key in fields] for item in saved] == [
        [item.get(key) for key in fields] for item, _ in prepared]


def public(items):
    return [{key: item[key] for key in ('id', 'name', 'size', 'contentType')} for item in items]


@contextmanager
def upload_session():
    """Remove only this attempt's blobs when storage or the DB transaction fails."""
    staged = []
    try:
        yield staged
    except Exception:
        for container, key in reversed(staged):
            try:
                storage.delete_blob(container, key)
            except ResourceNotFoundError:
                pass
            except Exception:
                logger.warning('Support attachment cleanup failed; storage reconciliation is required.')
        raise


def save(prepared, staged):
    if not prepared:
        return
    if not storage.azure_configured():
        raise AttachmentError('Attachment storage is unavailable. Your ticket has not been saved; please retry.', 503)
    # This is the same scan hook used by learner evidence. It currently has no
    # malware scanner configured; do not describe its verdict as a real scan.
    from .evidence import _scan
    try:
        for item, content in prepared:
            key = item['blobName']
            quarantine = settings.AZURE_QUARANTINE_CONTAINER
            staged.append((quarantine, key))
            storage.upload_to_quarantine(BytesIO(content), key, item['contentType'])
            if _scan(quarantine, key) != 'clean':
                raise AttachmentError('An attachment was rejected. Remove it and try again.')
            staged.append((item['container'], key))
            storage.move_blob(quarantine, item['container'], key)
    except AttachmentError:
        raise
    except Exception:
        raise AttachmentError('Attachments could not be saved. Your message is kept; please retry.', 503) from None


def download(item):
    try:
        content = storage.download_blob_bytes(item['container'], item['blobName'], max_bytes=MAX_FILE_BYTES)
    except ResourceNotFoundError:
        raise AttachmentError('Attachment not found.', 404) from None
    except Exception:
        raise AttachmentError('The attachment could not be downloaded. Please retry.', 503) from None
    # Never render user-supplied content as HTML or execute it on the LMS origin.
    response = HttpResponse(content, content_type='application/octet-stream')
    response['Content-Disposition'] = content_disposition_header(True, item['name'])
    response['X-Content-Type-Options'] = 'nosniff'
    return response
