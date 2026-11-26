"""Session attachments reuse saved artifacts and the existing authorized file routes.

No curriculum activities, completion requirements, attendance, or hours are created.
"""
import hashlib
import json
import logging
import tempfile
from pathlib import PurePosixPath

from django.db import connections, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .session_attachment_policy import AttachmentError, MAX_FILE_BYTES, artifact_id, content_type, filename, settings_payload

log = logging.getLogger(__name__)


def prepare_file(stream, name):
    """Bounded disk spool, SHA256 identity, and no trust in a browser's MIME header."""
    name = filename(name)
    digest, size = hashlib.sha256(), 0
    copy = tempfile.TemporaryFile()
    try:
        for part in iter(lambda: stream.read(64 * 1024), b''):
            size += len(part)
            if size > MAX_FILE_BYTES:
                raise AttachmentError('Session attachments must be 50 MB or smaller.')
            digest.update(part); copy.write(part)
        if not size:
            raise AttachmentError('The attachment is empty.')
        copy.seek(0)
        header = copy.read(8)
        extension = PurePosixPath(name).suffix.lower()
        if extension == '.pdf' and not header.startswith(b'%PDF-'):
            raise AttachmentError('The file is not a valid PDF.')
        if extension in ('.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods') and not header.startswith(b'PK\x03\x04'):
            raise AttachmentError('The file is not a valid Office document.')
        copy.seek(0)
        return copy, name, digest.hexdigest(), size
    except Exception:
        copy.close()
        raise


def save_file(occurrence, stream, name, *, source_reference='', created_at=None):
    from .session_attachment_storage import store
    from .session_results import read
    copy, name, digest, size = prepare_file(stream, name)
    ident = artifact_id(occurrence['id'], digest)
    path = ('session-attachments/' + hashlib.sha256(str(occurrence['id']).encode()).hexdigest()
            + '/' + digest + PurePosixPath(name).suffix.lower())
    meta = {'fileName': name, 'contentType': content_type(name), 'sizeBytes': size,
            'sha256': digest, 'sourceReferences': [source_reference] if source_reference else []}
    try:
        # Save identity before storage I/O. Retrying a lost response uses one object.
        with transaction.atomic(using='default'), connections['default'].cursor() as cursor:
            cursor.execute('''SELECT id FROM curriculum.live_session_occurrences
                WHERE id=%s AND live_session_id=%s FOR KEY SHARE''', [occurrence['id'], occurrence['live_session_id']])
            if not cursor.fetchone():
                raise AttachmentError('Session not found.')
            cursor.execute('''INSERT INTO curriculum.live_session_artifacts
                (id,occurrence_id,artifact_type,graph_artifact_id,content_url,call_id,content_correlation_id,
                 metadata,created_datetime,created_at,updated_at)
                VALUES (%s,%s,'attachment',%s,'','','',%s::jsonb,%s,now(),now()) ON CONFLICT(id) DO NOTHING''',
                [ident, occurrence['id'], 'sha256:' + digest, json.dumps({'lmsSessionAttachment': meta}), created_at or timezone.now()])
            cursor.execute('''SELECT metadata FROM curriculum.live_session_artifacts
                WHERE id=%s AND occurrence_id=%s AND artifact_type='attachment' FOR UPDATE''', [ident, occurrence['id']])
            current = cursor.fetchone()
            if not current:
                raise AttachmentError('The saved file identity belongs to another session.')
            saved = current[0] if isinstance(current[0], dict) else json.loads(current[0])
            references = saved['lmsSessionAttachment'].setdefault('sourceReferences', [])
            if source_reference and source_reference not in references and len(references) < 1000:
                references.append(source_reference)
                cursor.execute('UPDATE curriculum.live_session_artifacts SET metadata=%s::jsonb,updated_at=now() WHERE id=%s',
                               [json.dumps(saved), ident])
            cursor.execute('''INSERT INTO curriculum.session_result_archive
                (artifact_id,occurrence_id,container,blob_name,status,last_error)
                VALUES (%s,%s,'',%s,'pending','') ON CONFLICT(artifact_id) DO NOTHING''', [ident, occurrence['id'], path])
        existing = read('''SELECT status,blob_name FROM curriculum.session_result_archive WHERE artifact_id=%s
            AND occurrence_id=%s''', [ident, occurrence['id']])
        if existing and existing[0]['status'] == 'ready':
            return ident
        if existing:
            path = existing[0]['blob_name']
            meta = saved['lmsSessionAttachment']
        try:
            container = store(copy, path, meta['contentType'], digest, size)
            with connections['default'].cursor() as cursor:
                cursor.execute('''UPDATE curriculum.session_result_archive SET container=%s,blob_name=%s,
                    status='ready',last_error='',updated_at=now() WHERE artifact_id=%s AND occurrence_id=%s''',
                    [container, path, ident, occurrence['id']])
        except Exception:
            with connections['default'].cursor() as cursor:
                cursor.execute('''UPDATE curriculum.session_result_archive SET status='failed',
                    last_error='Attachment storage needs retry.',updated_at=now()
                    WHERE artifact_id=%s AND occurrence_id=%s AND status<>'ready' ''', [ident, occurrence['id']])
            raise AttachmentError('The attachment could not be saved. Retry the same file.') from None
        return ident
    finally:
        copy.close()


@require_POST
@csrf_protect
@require_role('admin', 'staff')
def upload_attachment(request, series_id, session_number):
    from .session_results import read
    if settings_payload()['storageProvider'] == 'unavailable':
        return JsonResponse({'error': 'Session attachment storage needs configuration.'}, status=503)
    rows = read('''SELECT o.id,o.live_session_id FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        WHERE o.live_session_id=%s AND o.session_number=%s
        AND lower(coalesce(o.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')
        AND lower(coalesce(s.status,'')) NOT IN ('cancelled','canceled','deleted','failed','superseded')''',
        [series_id, session_number])
    if len(rows) != 1:
        return JsonResponse({'error': 'Session not found.'}, status=404)
    files = request.FILES.getlist('file')
    if len(files) != 1:
        return JsonResponse({'error': 'Choose one session attachment.'}, status=400)
    try:
        ident = save_file(rows[0], files[0], files[0].name)
        response = JsonResponse({'id': ident, 'state': 'ready'}, status=201)
        response['Cache-Control'] = 'private, no-store'
        return response
    except AttachmentError as error:
        return JsonResponse({'error': str(error)}, status=400)
    except Exception as error:
        log.warning('Session attachment upload unavailable (%s).', type(error).__name__)
        return JsonResponse({'error': 'Session attachments are temporarily unavailable.'}, status=503)
