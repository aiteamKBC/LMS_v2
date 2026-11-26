"""Session file selection and configuration checks; no database or network I/O."""
import hashlib
import json
import mimetypes
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath
from urllib.parse import urlsplit

MAX_FILE_BYTES = 50 * 1024 * 1024
ALLOWED_EXTENSIONS = frozenset(('.pdf', '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx',
                                '.csv', '.txt', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.odt', '.odp', '.ods'))


class AttachmentError(ValueError):
    """A safe error suitable for staff; never include an upstream exception."""


def import_enabled():
    return os.environ.get('SESSION_ATTACHMENTS_AUTO_IMPORT_ENABLED', '').lower() in ('true', '1', 'yes')


def settings_payload():
    from .session_attachment_storage import bunny_configuration
    try:
        provider = 'unavailable'
        if bunny_configuration():
            provider = 'bunny'
        else:
            from django.conf import settings
            if settings.configured:
                from config.blob_storage import storage_configured
                configured = storage_configured(getattr(settings, 'AZURE_STORAGE_ACCOUNT', ''),
                                                getattr(settings, 'AZURE_STORAGE_KEY', ''))
                if configured and os.environ.get('AZURE_SESSION_RECORDINGS_CONTAINER', 'session-recordings').strip():
                    provider = 'lms'
    except AttachmentError:
        provider = 'unavailable'
    return {'maxBytes': MAX_FILE_BYTES, 'automaticImport': import_enabled(), 'storageProvider': provider}


def recording_only_access(series):
    """An explicit additional meeting grants its resources, unlike a recording-only link."""
    return series.get('linked_session_numbers') is not None and not series.get('additional_meeting_access')


def filename(value):
    name = str(value or '').replace('\\', '/').rsplit('/', 1)[-1]
    name = re.sub(r'[\x00-\x1f\x7f]', '', name).strip()[:180]
    if not name or PurePosixPath(name).suffix.lower() not in ALLOWED_EXTENSIONS:
        raise AttachmentError('Choose a PDF, presentation, document, spreadsheet, image or text file.')
    return name


def content_type(name):
    return mimetypes.guess_type(filename(name))[0] or 'application/octet-stream'


def instant(value):
    try:
        result = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def occurrence_for_message(message, occurrences):
    """Only an unambiguous scheduled session window, including preparation time."""
    sent = instant(message.get('createdDateTime'))
    if not sent or message.get('deletedDateTime'):
        return None
    matches = []
    for occurrence in occurrences:
        start, end = instant(occurrence.get('scheduled_start')), instant(occurrence.get('scheduled_end'))
        if str(occurrence.get('status') or '').lower() in ('cancelled', 'canceled', 'deleted', 'failed', 'superseded'):
            continue
        if start and end and start <= end and start - timedelta(hours=2) <= sent <= end + timedelta(hours=4):
            matches.append(occurrence)
    return matches[0] if len(matches) == 1 else None


def sharepoint_url(value):
    try:
        url = urlsplit(str(value or ''))
        return (url.scheme == 'https' and bool(url.hostname) and url.hostname.endswith('.sharepoint.com')
                and not url.username and not url.password and url.port in (None, 443) and not url.fragment)
    except ValueError:
        return False


def message_files(messages, occurrences, presenter_ids):
    """Never publish learner uploads, cards, arbitrary URLs, or another week's files."""
    output, seen = [], set()
    presenters = {str(i).casefold() for i in presenter_ids if i}
    for message in messages:
        sender = ((message.get('from') or {}).get('user') or {}).get('id')
        if str(sender or '').casefold() not in presenters:
            continue
        occurrence = occurrence_for_message(message, occurrences)
        if not occurrence:
            continue
        for attachment in message.get('attachments') or []:
            if attachment.get('contentType') != 'reference' or not sharepoint_url(attachment.get('contentUrl')):
                continue
            try:
                name = filename(attachment.get('name'))
            except AttachmentError:
                continue
            ident = (occurrence['id'], message.get('id'), attachment.get('id'))
            if not all(ident) or ident in seen:
                continue
            seen.add(ident)
            output.append({'occurrence': occurrence, 'message_id': message['id'], 'attachment_id': attachment['id'],
                           'name': name, 'url': attachment['contentUrl']})
    return output


def artifact_id(occurrence_id, digest):
    return 'FILE-' + hashlib.sha256((str(occurrence_id) + ':' + digest).encode()).hexdigest()


def public_metadata(row):
    metadata = row.get('metadata') or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            metadata = {}
    value = metadata.get('lmsSessionAttachment') if isinstance(metadata, dict) else None
    if not isinstance(value, dict):
        return {}
    return {key: value[key] for key in ('fileName', 'contentType', 'sizeBytes') if key in value}
