"""Durable curriculum video imports, including scoped live-session recordings.

New/changed video sources are queued by authoring saves and the database event
worker, including external SQL writers. Existing content is imported only by
an explicit staff request or scoped command. The
original authored source remains unchanged after Bunny finishes encoding.
Live-session jobs use the dedicated Microsoft-only transfer handler. Workers never
hold a database transaction while downloading/uploading a video.
"""
from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import threading
from contextlib import nullcontext
from datetime import timedelta

from django.db import close_old_connections, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from login.permissions import require_role

from .bunny_stream import BunnyStream, VideoImportError, is_bunny_url, playback_url
from .models import CurriculumVideoImport
from .video_sources import download_url, download_video, source_url, validate_video
from .video_uploads import save_mp4, stored_video, stored_video_path

logger = logging.getLogger(__name__)
_worker_lock = threading.Lock()


def flag_enabled():
    return os.environ.get('BUNNY_STREAM_ENABLED', '').lower() in ('true', '1', 'yes')


_TABLES_PRESENT = {}


def tables_available():
    """True when this database has the import tables (migrations 0077/0078).

    The normalised database (NEW_ENDPOINT_URL) has neither, and with the flag on
    every Module Builder save that queued a video then failed whole (500, saved
    nothing). Read once per process and database; a restart picks up tables
    created later.
    """
    from django.db import connection
    key = (connection.settings_dict.get('HOST'), connection.settings_dict.get('NAME'), connection.vendor)
    if key not in _TABLES_PRESENT:
        if connection.vendor != 'postgresql':
            _TABLES_PRESENT[key] = True  # the SQLite test schema creates them
        else:
            from .models import CurriculumVideoChange
            try:
                with connection.cursor() as cursor:
                    cursor.execute(
                        'SELECT to_regclass(%s) IS NOT NULL AND to_regclass(%s) IS NOT NULL',
                        [CurriculumVideoImport._meta.db_table, CurriculumVideoChange._meta.db_table],
                    )
                    present = bool(cursor.fetchone()[0])
            except Exception:
                logger.warning('Could not check the curriculum video import tables.', exc_info=True)
                return False  # unknown, not remembered
            if not present:
                logger.warning('BUNNY_STREAM_ENABLED is set but this database has no curriculum video '
                               'import tables; video imports stay off.')
            _TABLES_PRESENT[key] = present
    return _TABLES_PRESENT[key]


def enabled():
    # Enable only after migrations 0077/0078 are deployed. An absent key is an explicit
    # failed import, never a silent fallback to local video storage. The flag alone
    # is not enough: without the tables a save that queues an import fails whole.
    return flag_enabled() and tables_available()


def _views():
    from . import views
    return views


def _settings(row):
    value = row.get('settings_json', row.get('settings', {}))
    return json.loads(value) if isinstance(value, str) else value or {}


def target(kind, target_id):
    v = _views()
    if kind == 'module':
        table, key = v.AUTHORING_MODULES_TABLE, 'module_catalogue_id'
        component_table, parent_key = v.AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id'
    elif kind == 'template':
        table, key = v.WEEK_TEMPLATES_TABLE, 'id'
        component_table, parent_key = v.WEEK_TEMPLATE_COMPONENTS_TABLE, 'week_template_id'
    else:
        raise VideoImportError('Unknown curriculum video scope.')
    parents = v.authoring_fetch_all(table, f'{key} = %s', [target_id], ensure_tables=False)
    if not parents or v.row_has_deleted_at(parents[0]):
        raise VideoImportError('Save the module or week template before uploading its video.')
    parent = parents[0]
    rows = v.authoring_fetch_all(component_table, f'{parent_key} = %s', [target_id], ensure_tables=False)
    rows = [r for r in rows if not v.row_has_deleted_at(r) and r.get('type') == 'video']
    scope = {key: str(parent.get(key) or '') for key in (
        'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name')}
    if kind == 'template' and scope['group_id']:
        groups = v.authoring_fetch_all(v.GROUPS_TABLE, 'group_id = %s', [scope['group_id']], ensure_tables=False)
        if groups:
            scope['cohort_id'] = str(groups[0].get('cohort_id') or '')
            scope['cohort_name'] = str(groups[0].get('cohort_name') or '')
    module = parent
    if kind == 'template':
        module = {}
        if parent.get('module_catalogue_id'):
            modules = v.authoring_fetch_all(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s',
                                           [parent['module_catalogue_id']], ensure_tables=False)
            module = modules[0] if modules else {}
        scope['template_title'] = str(parent.get('title') or '')
    scope.update({'module_id': str(parent.get('module_catalogue_id') or (target_id if kind == 'module' else '')),
                  'module_title': str(module.get('title') or ''), 'target_kind': kind, 'target_id': target_id})
    return component_table, rows, scope


def fingerprint(kind, target_id, component_id, source, scope):
    identity = [kind, target_id, component_id, source, scope.get('programme_id'), scope.get('cohort_id'), scope.get('group_id')]
    return hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest()


def enqueue(kind, target_id, component, scope, *, file_hash='', title=''):
    original = source_url(_settings(component))
    source = '' if file_hash else original
    if not file_hash and (not source or is_bunny_url(source)):
        return None
    ident = fingerprint(kind, target_id, component['id'], file_hash or source, scope)
    asset, created = CurriculumVideoImport.objects.get_or_create(fingerprint=ident, defaults={
        'target_kind': kind, 'target_id': target_id, 'component_id': component['id'],
        'source_url': source, 'source_at_start': original, 'scope': scope,
        'status': 'awaiting_file' if file_hash else 'queued',
        'title': title or component.get('title') or 'Curriculum video',
        'library_id': os.environ.get('BUNNY_STREAM_LIBRARY_ID', '798153'),
    })
    if not created:
        asset.requested_at = timezone.now()
        asset.save(update_fields=['requested_at'])
    if not created and asset.status == 'superseded':
        # Recheck a previously stored copy when the author selects it again.
        asset.source_at_start = original
        asset.status, asset.error = 'processing' if asset.video_id else 'queued', ''
        asset.save(update_fields=['source_at_start', 'status', 'error', 'updated_at'])
    return asset


def enqueue_saved_video(kind, target_id, component, scope):
    """Save and manual import use the same idempotent request/retry action."""
    asset = enqueue(kind, target_id, component, scope)
    if asset and asset.status == 'failed':
        # A simultaneous worker may already have claimed this import. Do not
        # reset its state or lease from a stale instance read by the save request.
        CurriculumVideoImport.objects.filter(pk=asset.pk, status='failed').update(
            status='queued', error='', updated_at=timezone.now())
        asset.refresh_from_db()
    return asset


def _matches_current_source(asset):
    """Label the stored copy without writing component settings or playback URLs."""
    try:
        _, rows, scope = target(asset.target_kind, asset.target_id)
    except VideoImportError:
        return False
    if CurriculumVideoImport.objects.filter(
        target_kind=asset.target_kind, target_id=asset.target_id,
        component_id=asset.component_id, requested_at__gt=asset.requested_at,
    ).exclude(pk=asset.pk).exists():
        return False
    row = next((row for row in rows if row['id'] == asset.component_id), None)
    if row is None or any(scope.get(k) != asset.scope.get(k) for k in ('programme_id', 'cohort_id', 'group_id')):
        return False
    return source_url(_settings(row)) == asset.source_at_start


def process(import_id, file_obj=None, *, session_lease_id=None):
    with transaction.atomic():
        asset = CurriculumVideoImport.objects.select_for_update().get(pk=import_id)
        if asset.status in ('ready', 'superseded'):
            if asset.target_kind == 'live_session' and asset.status == 'ready':
                from .session_bunny import publish_outcome
                publish_outcome(asset)
            return asset
        if asset.lease_until and asset.lease_until > timezone.now():
            return asset
        if not asset.source_url and file_obj is None and not asset.video_id:
            asset.status, asset.error = 'failed', 'Choose the MP4 again to retry this upload.'
            asset.save(update_fields=['status', 'error', 'updated_at'])
            return asset
        asset.lease_until = timezone.now() + timedelta(minutes=60)
        asset.status, asset.error = 'uploading', ''
        asset.save(update_fields=['lease_until', 'status', 'error', 'updated_at'])
    try:
        if asset.target_kind == 'live_session':
            from .session_bunny import transfer_recording
            transfer_recording(asset, lease_id=session_lease_id)
            return asset
        local_source = stored_video_path(asset.source_url)
        if asset.source_url and not local_source:
            download_url(asset.source_url)
        client = BunnyStream(asset.library_id)
        if not asset.collection_id:
            asset.collection_id = client.collection(asset.scope.get('programme_id'), asset.scope.get('programme_name'))
            asset.save(update_fields=['collection_id', 'updated_at'])
        if not asset.video_id:
            recovered = client.find_import(asset.id)
            if recovered:
                asset.video_id = recovered['guid']
                playback_url(asset.library_id, asset.video_id)
                asset.save(update_fields=['video_id', 'updated_at'])
        video = client.video(asset.video_id) if asset.video_id else None
        if video is None or video.get('status') in (0, 6):
            if file_obj is None and not asset.source_url:
                raise VideoImportError('Choose the MP4 again to retry this upload.')
            source_stream = (nullcontext(file_obj) if file_obj is not None else
                             stored_video(asset.source_url) if local_source else download_video(asset.source_url))
            with source_stream as stream:
                validate_video(stream)
                if not asset.video_id:
                    # Verify/download the source before creating a remote object.
                    # Persist its ID before sending bytes so retries reuse it.
                    created = client.create(asset.id, asset.title, asset.collection_id, scope=asset.scope)
                    asset.video_id = created['guid']
                    playback_url(asset.library_id, asset.video_id)
                    asset.save(update_fields=['video_id', 'updated_at'])
                client.metadata(asset.video_id, {**asset.scope, 'component_id': asset.component_id}, asset.title)
                client.upload(asset.video_id, stream)
            video = client.video(asset.video_id)
        status = video.get('status')
        if status == 5:
            raise VideoImportError('Bunny could not encode this video. The original source is unchanged.')
        if status == 4:
            asset.status = 'ready' if _matches_current_source(asset) else 'superseded'
        else:
            asset.status = 'processing'
    except VideoImportError as exc:
        asset.status, asset.error = 'failed', str(exc)
    except Exception:
        # Do not log upstream exception text: it may contain a signed URL/key.
        logger.error('Curriculum video import %s failed unexpectedly.', asset.id)
        asset.status, asset.error = 'failed', 'The import could not finish. The original video is unchanged.'
    finally:
        asset.lease_until = None
        asset.save(update_fields=['status', 'error', 'lease_until', 'updated_at'])
        if asset.target_kind == 'live_session':
            from .session_bunny import publish_outcome
            publish_outcome(asset)
    return asset


def run_pending(limit=20):
    from .video_changes import capture_pending

    capture_pending(limit)
    now = timezone.now()
    pending = CurriculumVideoImport.objects.filter(status__in=['queued', 'processing', 'uploading']).filter(
        Q(lease_until__isnull=True) | Q(lease_until__lte=now),
    ).order_by('updated_at')
    ids = list(pending.values_list('id', flat=True)[:limit])
    for import_id in ids:
        process(import_id)
    return len(ids)


def wake_worker():
    if not enabled() or not _worker_lock.acquire(blocking=False):
        return
    def work():
        try:
            close_old_connections()
            run_pending()
        except Exception:
            logger.error('Curriculum video worker could not run; imports remain in the durable queue.')
        finally:
            close_old_connections()
            _worker_lock.release()
    threading.Thread(target=work, name='curriculum-video-import', daemon=True).start()


def tracked_save(view, kind):
    """Keep the existing response/validation contracts; enqueue after successful saves."""
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if not enabled() or request.method not in ('POST', 'PATCH', 'PUT'):
            return view(request, *args, **kwargs)
        from login.permissions import _forbidden, _unauthenticated
        from login.sessions import authenticate_request
        account = authenticate_request(request)
        if account is None:
            return _unauthenticated(request)
        if account.role not in ('admin', 'staff'):
            return _forbidden(('admin', 'staff'))
        try:
            payload = json.loads(request.body)
        except (ValueError, AttributeError):
            payload = {}
        requested_ids = payload.get('importVideoComponentIds', []) if isinstance(payload, dict) else []
        requested_ids = {value for value in requested_ids if isinstance(value, str)} if isinstance(requested_ids, list) else set()
        target_id = kwargs.get('module_catalogue_id') or kwargs.get('identifier') or ''
        changed_component_id = kwargs.get('component_id', '')
        actual_kind = kind
        if kind == 'component':
            actual_kind = 'module'
            existing = _views().authoring_fetch_all(_views().AUTHORING_COMPONENTS_TABLE, 'id = %s', [kwargs.get('component_id', '')], ensure_tables=False)
            if existing:
                target_id = existing[0].get('module_catalogue_id') or ''
            else:
                try:
                    data = json.loads(request.body)
                    target_id = data.get('moduleCatalogueId') or data.get('module_catalogue_id') or data.get('moduleId') or ''
                except (ValueError, AttributeError):
                    pass
        if actual_kind == 'module' and target_id.startswith(('catalogue-module-', 'training-module-')):
            target_id = _views().resolve_stored_module_catalogue_id(target_id) or target_id
        with transaction.atomic():
            before, old_scope = {}, {}
            if target_id:
                try:
                    _, rows, old_scope = target(actual_kind, target_id)
                    before = {r['id']: source_url(_settings(r)) for r in rows}
                except VideoImportError:
                    pass
            response = view(request, *args, **kwargs)
            if response.status_code >= 300:
                return response
            if kind == 'component':
                saved = json.loads(response.content).get('component') or {}
                changed_component_id = saved.get('id') or changed_component_id
                target_id = saved.get('moduleCatalogueId') or target_id
            if not target_id:
                data = json.loads(response.content)
                if data.get('existing'):
                    return response
                data = data.get('weekTemplate') or data.get('module') or data
                target_id = data.get('catalogueId') or data.get('moduleCatalogueId') or data.get('id')
            if target_id:
                try:
                    _, rows, scope = target(actual_kind, target_id)
                except VideoImportError:
                    # Legacy module creation also uses this route, without an
                    # authoring component scope. Preserve its successful save.
                    return response
                if kind == 'component':
                    rows = [r for r in rows if r['id'] == changed_component_id]
                changed_scope = any(scope.get(k) != old_scope.get(k) for k in ('programme_id', 'cohort_id', 'group_id'))
                for row in rows:
                    # Explicit Save also requests the open video even when its
                    # link is unchanged. Only saved rows in this scope qualify;
                    # never import sibling historical videos merely on page load.
                    if (changed_scope or kind == 'component' or row['id'] in requested_ids
                            or source_url(_settings(row)) != before.get(row['id'], '')):
                        enqueue_saved_video(actual_kind, target_id, row, scope)
                transaction.on_commit(wake_worker)
        return response
    return wrapped


def public_asset(asset):
    result = {'id': str(asset.id), 'status': asset.status, 'error': asset.error,
              'libraryId': asset.library_id, 'videoId': asset.video_id, 'collectionId': asset.collection_id,
              'sourceAtStart': asset.source_at_start}
    if asset.status == 'ready':
        result['bunnyUrl'] = playback_url(asset.library_id, asset.video_id)
    return result


@csrf_protect
@require_role('admin', 'staff')
def component_video(request, kind, target_id, component_id):
    if request.method not in ('GET', 'POST'):
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    if not enabled():
        message = ('Bunny video imports are switched on, but this database has no video import tables yet.'
                   if flag_enabled() else 'Bunny video imports are not enabled yet.')
        return JsonResponse({'enabled': False, 'error': message}, status=503)
    try:
        _, rows, scope = target(kind, target_id)
        component = next((r for r in rows if r['id'] == component_id), None)
        if component is None:
            if request.method == 'GET':
                return JsonResponse({'enabled': True, 'saved': False, 'import': None, 'scope': scope})
            raise VideoImportError('Save this video component before importing its source.')
        if request.method == 'GET':
            assets = CurriculumVideoImport.objects.filter(target_kind=kind, target_id=target_id, component_id=component_id).order_by('-requested_at')
            asset = assets.first()
            if asset and asset.status in ('queued', 'uploading', 'processing'):
                transaction.on_commit(wake_worker)
            return JsonResponse({'enabled': True, 'saved': True, 'import': public_asset(asset) if asset else None, 'scope': scope})
        for key in ('programme_id', 'cohort_id', 'group_id'):
            if key in request.POST and request.POST[key] != scope.get(key, ''):
                raise VideoImportError('The programme, cohort or group no longer matches this module. Refresh before retrying.')
        uploaded = request.FILES.get('file')
        saved_settings = None
        if uploaded:
            if not str(uploaded.name).lower().endswith('.mp4'):
                raise VideoImportError('Choose an MP4 video file.')
            validate_video(uploaded)
            asset, saved_settings = save_mp4(kind, target_id, component, scope, uploaded,
                                             title=request.POST.get('title', '')[:500])
            # The durable LMS file lets the supervised worker retry after a web
            # timeout or restart. Do not hold the upload request for Bunny IO.
            transaction.on_commit(wake_worker)
        else:
            asset = enqueue_saved_video(kind, target_id, component, scope)
            transaction.on_commit(wake_worker)
        result = {'enabled': True, 'import': public_asset(asset) if asset else None}
        if saved_settings is not None:
            result['savedSettings'] = saved_settings
        return JsonResponse(result, status=202)
    except VideoImportError as exc:
        return JsonResponse({'error': str(exc)}, status=400)
