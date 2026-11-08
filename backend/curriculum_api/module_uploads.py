"""List the files stored for one module's component uploads.

Component uploads are stored at ``<module>/<component>/<name>-<timestamp><ext>``
(see ``views.component_upload_metadata``). Removing a file from a component only
edits that component's settings; the stored file stays. The Module Builder's
"use a file already uploaded in this module" picker reads this list, so a file
can be attached again without uploading a copy.

Read-only. Staff-only through the ``/curriculum_api/`` rule in login/api_gate.py
(this path is deliberately not under ``/curriculum_api/curriculum/uploads/``,
which learners can read).
"""
from __future__ import annotations

import logging
import mimetypes
import re

from django.core.exceptions import SuspiciousFileOperation
from django.http import JsonResponse

from curriculum_api import upload_storage
from learner_api import evidence_storage

logger = logging.getLogger(__name__)

#: A module with more stored files than this is cut off, and says so.
MAX_FILES = 500
#: ``<stem>-<YYYYmmddHHMMSSffffff><ext>``; the stamp is dropped for display.
_STAMPED_NAME = re.compile(r'^(?P<stem>.+)-\d{20}(?P<ext>\.[^.]*)?$')
_RESERVED_SLOTS = {'_slide_renders'}


def _display_name(stored_name: str) -> str:
    match = _STAMPED_NAME.match(stored_name)
    return f"{match['stem']}{match['ext'] or ''}" if match else stored_name


def _entry(module_id, component_id, stored_name, size, modified):
    from curriculum_api.views import AI_MATERIAL_UPLOAD_SLOT
    if component_id in _RESERVED_SLOTS or component_id == AI_MATERIAL_UPLOAD_SLOT:
        return None
    return {
        'fileName': _display_name(stored_name),
        'url': f'{upload_storage.UPLOAD_URL_PREFIX}{module_id}/{component_id}/{stored_name}',
        'size': int(size or 0),
        'contentType': mimetypes.guess_type(stored_name)[0] or '',
        'componentId': component_id,
        'uploadedAt': modified.isoformat() if modified else None,
    }


def _stored_entries(module_id):
    client = evidence_storage._service_client(retry_total=1).get_container_client(upload_storage.container_name())
    for blob in client.list_blobs(name_starts_with=f'{module_id}/'):
        parts = blob.name.split('/')
        if len(parts) != 3 or not parts[2]:
            continue
        yield _entry(module_id, parts[1], parts[2], blob.size, getattr(blob, 'last_modified', None))


def _local_entries(module_id):
    from datetime import datetime, timezone
    from curriculum_api.views import COMPONENT_UPLOAD_ROOT
    root = upload_storage.local_path(f'{COMPONENT_UPLOAD_ROOT}/{module_id}')
    if root is None or not root.is_dir():
        return
    for path in root.glob('*/*'):
        if path.is_file():
            stat = path.stat()
            yield _entry(module_id, path.parent.name, path.name, stat.st_size,
                         datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc))


def module_uploaded_files(request, module_catalogue_id):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    from curriculum_api.views import safe_upload_segment
    raw = str(module_catalogue_id or '').strip()
    try:
        module_id = safe_upload_segment(raw, '')
    except SuspiciousFileOperation:
        module_id = ''
    # The same sanitising the upload used; anything it would change was never a
    # folder an upload could have been written to.
    if not module_id or module_id != raw:
        return JsonResponse({'error': 'Unknown module.'}, status=400)

    files = {}
    # Local disk first, as reads do: an upload from before the move to cloud
    # storage, or from a machine without it, is only there.
    for item in _local_entries(module_id):
        if item:
            files[item['url']] = item
    if upload_storage.azure_enabled():
        try:
            for item in _stored_entries(module_id):
                if item:
                    files.setdefault(item['url'], item)
        except Exception:
            logger.exception('Unable to list stored uploads for module %s.', module_id)
            return JsonResponse({'error': 'The stored files for this module could not be listed. Please retry.'}, status=503)

    ordered = sorted(files.values(), key=lambda item: item['uploadedAt'] or '', reverse=True)
    return JsonResponse({
        'moduleCatalogueId': module_id,
        'files': ordered[:MAX_FILES],
        'truncated': len(ordered) > MAX_FILES,
    })
