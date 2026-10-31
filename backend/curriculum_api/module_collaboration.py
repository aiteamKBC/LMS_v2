"""Staff-only coordination for Module Builder; content stays in PostgreSQL.

Claims and saves take the SAME existing module-row lock. Consequently another
owner cannot be granted the field between a save's ownership check and commit,
even if Redis expires a lease during the transaction. No lock is held while a
person types; renewals and presence only touch Redis.
"""
import functools
import time
from urllib.parse import quote

from django.conf import settings
from django.db import transaction, DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .module_collaboration_state import (
    CoordinationUnavailable, ReservationBusy, HEARTBEAT_SECONDS, blocked_fields, changed_fields,
    field_key, parse_field_key, transition,
)
from .module_collaboration_store import RedisRoomStore

_store = None


def enabled(module_id):
    if not settings.configured or not getattr(settings, 'CURRICULUM_COLLABORATION_ENABLED', False):
        return False
    allowed = getattr(settings, 'CURRICULUM_COLLABORATION_MODULES', ())
    return not allowed or module_id in allowed


def get_store():
    global _store
    if _store is None:
        import redis
        from redis.backoff import NoBackoff
        from redis.retry import Retry
        url = getattr(settings, 'CURRICULUM_COLLABORATION_REDIS_URL', '') or settings.CHAT_REDIS_URL
        _store = RedisRoomStore(redis.Redis.from_url(url, socket_timeout=0.35, socket_connect_timeout=0.2,
            retry=Retry(NoBackoff(), 0), decode_responses=True))
    return _store


def resolve_module(module_id):
    from . import views as v
    if not isinstance(module_id, str) or len(module_id) > 140:
        return ''
    resolved = v.resolve_stored_module_catalogue_id(module_id)
    return resolved if resolved and v.authoring_module_exists(resolved) else ''


def staff_only(view):
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        from login.permissions import require_role
        return require_role('admin', 'staff')(view)(request, *args, **kwargs)
    return wrapped


@require_GET
@staff_only
def collaboration_configuration(request, module_id):
    if not enabled(module_id):
        return JsonResponse({'enabled': False})
    resolved = resolve_module(module_id)
    if not resolved or not enabled(resolved):
        return JsonResponse({'error': 'Module not found.'}, status=404)
    response = JsonResponse({'enabled': True, 'moduleId': resolved,
        'websocketPath': '/ws/curriculum/module-collaboration/' + quote(resolved, safe='') + '/',
        'heartbeatSeconds': HEARTBEAT_SECONDS})
    response['Cache-Control'] = 'no-store'
    return response


def claim(module_id, actor, key):
    try:
        return _claim(module_id, actor, key)
    except DatabaseError as exc:
        cause = exc.__cause__
        if getattr(cause, 'sqlstate', None) == '55P03' or getattr(cause, 'pgcode', None) == '55P03':
            raise ReservationBusy('A module save is in progress. Your draft is retained; retry this field shortly.') from exc
        raise CoordinationUnavailable('A module save is in progress. Your draft is retained; try again shortly.') from exc


def _claim(module_id, actor, key):
    from . import views as v
    kind, identifier, _ = parse_field_key(key)
    with transaction.atomic():
        if v.connection.vendor == 'postgresql':
            with v.connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '1s'")
        v.lock_module_structure_row(module_id)
        # New, unsaved records also need reservations. Other record IDs have
        # no effect outside this module's room; the normal save validates them.
        if kind == 'module' and identifier != module_id:
            raise ValueError('The edited item is not in this module.')
        return apply_event(module_id, 'claim', actor, key=key)


def apply_event(module_id, action, actor, **kwargs):
    def change(room, now):
        before = room or {'members': {}, 'leases': {}}
        updated, result = transition(room, action, actor, now, **kwargs)
        result['presenceChanged'] = {k: v['name'] for k, v in before.get('members', {}).items()} != {
            k: v['name'] for k, v in updated['members'].items()}
        result['released'] = list(before.get('leases', {}).keys() - updated['leases'].keys())
        return updated, result
    return get_store().update(module_id, change)


def check_structure_save(request, module_id, stored, candidate, payload, *, removed=None):
    """Call inside the view's transaction and module-row lock, before any write."""
    if not enabled(module_id):
        return None
    from login.sessions import authenticate_request
    account = authenticate_request(request)
    # Preserve the HTTP API gate's existing Django-operator identity as well
    # as LMS staff. It cannot impersonate a socket editor or bypass a lease.
    django_user = getattr(request, 'user', None) if account is None else None
    django_operator = bool(django_user is not None and getattr(django_user, 'is_authenticated', False))
    if (account is not None and account.role not in ('admin', 'staff')) or (account is None and not django_operator):
        return JsonResponse({'error': 'Staff access is required.'}, status=403)
    principal = str(account.pk) if account is not None else 'django:' + str(django_user.pk)
    metadata = payload.get('collaboration') or {}
    if not isinstance(metadata, dict):
        return JsonResponse({'error': 'Invalid editing identity.'}, status=400)
    editor = str(metadata.get('editorId') or '')[:80]
    proofs = metadata.get('proofs') or {}
    if not isinstance(proofs, dict) or len(proofs) > 256 or any(not isinstance(v, str) or len(v) > 80 for v in proofs.values()):
        return JsonResponse({'error': 'Invalid editing ownership.'}, status=400)
    try:
        room = get_store().read(module_id)
        member = room['members'].get(editor)
        if member and member['account'] != principal:
            return JsonResponse({'error': 'This editor belongs to another session.'}, status=403)
        if not room['leases'] and not proofs:
            return None  # No reservations to check; avoid walking a large module.
        parents = {c['id']: w['id'] for w in stored.get('weekStructure') or [] for c in w.get('components') or []}
        changes = {field_key(removed[0], removed[1], '$delete')} if removed else changed_fields(stored, candidate)
        refused = blocked_fields(room, changes, editor, proofs, time.time(), parents=parents)
    except CoordinationUnavailable:
        return JsonResponse({'error': 'Editing coordination could not be checked. Your draft is retained; try again shortly.',
            'code': 'module_coordination_unavailable'}, status=503)
    if refused:
        return JsonResponse({'error': 'Some fields are being edited elsewhere or their edit reservation expired. Your draft is retained.',
            'code': 'module_edit_reserved', 'blockedFields': refused}, status=409)
    return None


def check_removal(request, module_id, kind, identifier, payload):
    """Legacy/archive paths must respect reservations too; caller holds row lock."""
    if not enabled(module_id):
        return None
    from . import views as v
    stored = v.get_authoring_structure_payload(module_id) if kind == 'week' else {}
    return check_structure_save(request, module_id, stored or {}, {}, payload, removed=(kind, identifier))


def announce_saved(module_id):
    if not enabled(module_id):
        return
    # The notification is a hint. The normal versioned changes endpoint remains
    # authoritative on reconnect; a dropped notification never loses a save.
    def broadcast():
        import hashlib
        import logging
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        try:
            layer = get_channel_layer()
            if layer:
                async_to_sync(layer.group_send)('module_edit_' + hashlib.sha256(module_id.encode()).hexdigest(),
                    {'type': 'module.saved'})
        except Exception:
            logging.getLogger(__name__).warning('A module was saved but its live notification was unavailable.')
    transaction.on_commit(broadcast)
