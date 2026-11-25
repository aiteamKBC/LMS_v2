"""Read-only signed previews and atomic, replayable module configuration changes.

No learner, source catalogue, cache, notification or external-service writes.
All SQL uses the same database/transaction as the existing Module Targets API.
"""
import hashlib
import json
from datetime import timedelta
from functools import wraps
from uuid import UUID, uuid4

from django.core import signing
from django.db import DatabaseError, IntegrityError, connection, transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from login.permissions import require_access
from . import module_hours as hours

SALT = 'curriculum.module-hours.v2'
KINDS = {'set_targets', 'save_defaults', 'apply_defaults'}
MAX_ITEMS = 100


class Conflict(Exception):
    pass


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), default=str)


def digest(value):
    return hashlib.sha256(encode(value).encode()).hexdigest()


def query(sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchall() if cursor.description else []


def endpoint(methods):
    def decorate(view):
        @csrf_exempt
        @require_http_methods(methods)
        @require_access('curriculum')
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                return hours.response(view(request, *args, **kwargs))
            except PermissionError:
                return hours.response({'error': 'Module hours permission is required.', 'code': 'forbidden'}, 403)
            except (Conflict, hours.RevisionConflict):
                return hours.response({'error': 'The preview or request changed. Review a fresh preview.',
                                       'code': 'stale_preview'}, 409)
            except signing.BadSignature:
                return hours.response({'error': 'Preview is invalid or expired. Preview again.',
                                       'code': 'stale_preview'}, 409)
            except (ValueError, TypeError):
                return hours.response({'error': 'Invalid module hours request.', 'code': 'invalid_request'}, 400)
            except IntegrityError:
                return hours.response({'error': 'A referenced record changed. Preview again.',
                                       'code': 'module_hours_reference_changed'}, 409)
            except DatabaseError:
                return hours.unavailable()
        return wrapped
    return decorate


def payload(request, fields):
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        raise PermissionError()
    if len(request.body) > 262144:
        raise ValueError()
    value = json.loads(request.body)
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError()
    return value


def grant(actor, lock=False):
    access = hours.read_access(actor, for_update=lock)
    if not access['canMatch']:
        raise PermissionError()
    return access


def lock_identity(actor):
    """Hold live identity/workspace rows on the target transaction connection."""
    from login.models import LoginAccount
    from login.identity import accesses_for_staff
    from learner_api.models import StaffUser
    from learner_api.constants import ACCESS_SUPER_ADMIN
    account = LoginAccount.objects.using(connection.alias).select_for_update().filter(pk=actor).only(
        'subject_type', 'subject_id', 'role', 'is_active').first()
    if not account or not account.is_active or account.subject_type != 'staff' or account.role not in {'staff', 'admin'}:
        raise PermissionError()
    staff = StaffUser.objects.using(connection.alias).select_for_update().filter(pk=account.subject_id).only(
        'access', 'access_extra').first()
    accesses = accesses_for_staff(staff) if staff else set()
    if not ({'curriculum', ACCESS_SUPER_ADMIN} & set(accesses)):
        raise PermissionError()


def read_default(module):
    rows = query('''SELECT id,target_minutes,revision FROM curriculum.module_hours_defaults
                    WHERE module_id=%s''', [module])
    return ({'id': str(rows[0][0]), 'targetMinutes': rows[0][1], 'revision': rows[0][2]}
            if rows else None)


def module_state(identifier):
    from . import views
    resolved = hours.stored_module(identifier)
    if not resolved:
        return None, 'module_missing'
    key, row = resolved
    archived = views.archived_programme_module_edit_error(row, title=row.get('title'),
        programme_id=row.get('programme_id'), programme_name=row.get('programme_name', ''))
    inactive = (str(row.get('status', '')).lower() in {'inactive', 'deleted', 'archived'}
                or bool(row.get('deleted_at')) or views.programme_deleted_row(row))
    return {'moduleId': key, 'moduleRevision': digest(row),
            'target': hours.read_target(key), 'default': read_default(key)}, (
                'module_inactive' if archived is not None or inactive else None)


def validate_items(kind, items):
    if kind not in KINDS or not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise ValueError()
    fields = {'moduleId'}
    fields |= {'expectedDefaultRevision'} if kind == 'save_defaults' else {'expectedRevision'}
    fields |= {'expectedDefaultRevision'} if kind == 'apply_defaults' else {'targetMinutes'}
    for item in items:
        if not isinstance(item, dict) or set(item) != fields:
            raise ValueError()
        if not isinstance(item['moduleId'], str) or not 1 <= len(item['moduleId']) <= 140:
            raise ValueError()
    return items


def evaluate(kind, items):
    outcomes, canonical, seen = [], [], set()
    for item in items:
        state, reason = module_state(item['moduleId'])
        key = state['moduleId'] if state else item['moduleId']
        if key in seen:
            raise ValueError('Duplicate module selection.')
        seen.add(key)
        intent = {**item, 'moduleId': key}
        canonical.append(intent)
        proposed = item.get('targetMinutes')
        for name in ('expectedRevision', 'expectedDefaultRevision'):
            if name in item and (type(item[name]) is not int or not 0 <= item[name] <= 2147483647):
                reason = 'invalid_revision'
        if kind != 'apply_defaults' and proposed is not None and (
                type(proposed) is not int or not 0 < proposed <= 2147483647):
            reason = 'invalid_minutes'
        if state and not reason:
            default = state['default']
            if 'expectedRevision' in item and item['expectedRevision'] != state['target']['revision']:
                reason = 'target_changed'
            if 'expectedDefaultRevision' in item and item['expectedDefaultRevision'] != (default['revision'] if default else 0):
                reason = 'default_changed'
            if kind == 'apply_defaults':
                if not default or default['targetMinutes'] is None:
                    reason = 'missing_default'
                else:
                    proposed = default['targetMinutes']
        before = state['default'] if state and kind == 'save_defaults' else state['target'] if state else None
        action = 'blocked' if reason else 'unchanged' if before and before['targetMinutes'] == proposed else 'update'
        outcomes.append({'moduleId': key, 'state': state, 'targetMinutes': proposed,
                         'action': action, 'reason': reason})
    return canonical, outcomes


def summary(items):
    return {name: sum(item['action'] == action for item in items)
            for name, action in [('willUpdate', 'update'), ('unchanged', 'unchanged'), ('blocked', 'blocked')]} | {'selected': len(items)}


@endpoint(['POST'])
def preview(request):
    access = grant(request.login_account.id)
    data = payload(request, {'operation', 'items'})
    kind = data['operation']
    items = validate_items(kind, data['items'])
    # One MVCC snapshot, no staging rows or schema bootstrap.
    with transaction.atomic():
        query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
        canonical, outcomes = evaluate(kind, items)
    state = {'contractVersion': 2, 'actor': request.login_account.id, 'operation': kind, 'items': canonical,
             'outcomes': outcomes, 'grantRevision': access['revision'], 'nonce': str(uuid4())}
    blocked = any(item['action'] == 'blocked' for item in outcomes)
    return {'contractVersion': 2, 'operation': kind, 'items': outcomes, 'summary': summary(outcomes),
            'canConfirm': not blocked, 'fingerprint': digest(state),
            'expiresAt': (timezone.now() + timedelta(minutes=15)).isoformat(),
            'previewToken': None if blocked else signing.dumps(state, salt=SALT, compress=True)}


def replay(actor, key, nonce, intent_hash):
    rows = query('''SELECT intent_hash,outcome FROM curriculum.module_hours_operations
                    WHERE actor_key=%s AND (idempotency_key=%s OR preview_nonce=%s)''', [actor, key, nonce])
    if not rows:
        return None
    if len(rows) != 1 or rows[0][0] != intent_hash:
        raise Conflict()
    return {**json.loads(rows[0][1]), 'replayed': True}


@endpoint(['POST'])
def confirm(request):
    data = payload(request, {'previewToken', 'fingerprint', 'confirmed', 'idempotencyKey'})
    if data['confirmed'] is not True or not isinstance(data['previewToken'], str):
        raise ValueError()
    key = str(UUID(data['idempotencyKey']))
    state = signing.loads(data['previewToken'], salt=SALT)
    if state.get('contractVersion') != 2:
        raise Conflict()
    actor = request.login_account.id
    if state['actor'] != actor:
        raise PermissionError()
    if digest(state) != data['fingerprint']:
        raise Conflict()
    intent_hash = digest({'operation': state['operation'], 'items': state['items'], 'nonce': state['nonce']})
    from . import views
    with transaction.atomic():
        for item in sorted(state['items'], key=lambda item: item['moduleId']):
            views.lock_module_structure_row(item['moduleId'])
        lock_identity(actor)
        access = grant(actor, lock=True)
        old = replay(actor, key, state['nonce'], intent_hash)
        if old:
            return old
        signing.loads(data['previewToken'], salt=SALT, max_age=900)
        if access['revision'] != state['grantRevision']:
            raise Conflict()
        _, outcomes = evaluate(state['operation'], state['items'])
        if outcomes != state['outcomes'] or any(item['action'] == 'blocked' for item in outcomes):
            raise Conflict()
        operation_id, now = str(uuid4()), timezone.now()
        query('''INSERT INTO curriculum.module_hours_operations
                 (id,actor_id,actor_key,idempotency_key,preview_nonce,intent_hash,outcome,created_at)
                 VALUES(%s,%s,%s,%s,%s,%s,%s,%s)''',
              [operation_id, actor, actor, key, state['nonce'], intent_hash, '{}', now])
        result_items = []
        for item in outcomes:
            module = item['moduleId']
            before = item['state']['default'] if state['operation'] == 'save_defaults' else item['state']['target']
            after = before
            if item['action'] == 'update':
                if state['operation'] == 'save_defaults':
                    default_id = before['id'] if before else str(uuid4())
                    revision = (before['revision'] if before else 0) + 1
                    query('''INSERT INTO curriculum.module_hours_defaults
                        (id,module_id,module_key,target_minutes,revision,updated_at) VALUES(%s,%s,%s,%s,%s,%s)
                        ON CONFLICT(module_id) DO UPDATE SET target_minutes=excluded.target_minutes,
                        revision=excluded.revision,updated_at=excluded.updated_at''',
                        [default_id, module, module, item['targetMinutes'], revision, now])
                    after = {'id': default_id, 'targetMinutes': item['targetMinutes'], 'revision': revision}
                    query('''INSERT INTO curriculum.module_hours_default_revisions
                        (default_id,revision,operation_id,before_value,after_value) VALUES(%s,%s,%s,%s,%s)''',
                        [default_id, revision, operation_id, encode(before), encode(after)])
                else:
                    after = hours.write_target(module, item['targetMinutes'], before['revision'], actor)
            result_item = {'moduleId': module, 'action': item['action'], 'before': before, 'after': after}
            result_items.append(result_item)
            query('INSERT INTO curriculum.module_hours_operation_items(operation_id,module_key,outcome) VALUES(%s,%s,%s)',
                  [operation_id, module, encode(result_item)])
        result = {'operationId': operation_id, 'operation': state['operation'], 'contractVersion': 2,
                  'items': result_items, 'summary': summary(outcomes), 'appliedAt': now.isoformat(), 'replayed': False}
        query('UPDATE curriculum.module_hours_operations SET outcome=%s WHERE id=%s', [encode(result), operation_id])
        return result


@endpoint(['GET'])
def defaults(request):
    identifiers = request.GET.getlist('moduleId')
    if not 1 <= len(identifiers) <= MAX_ITEMS:
        raise ValueError()
    before_revision = int(request.GET.get('beforeRevision', '2147483647'))
    if before_revision < 1:
        raise ValueError()
    items = []
    for identifier in identifiers:
        state, reason = module_state(identifier)
        revisions = []
        if state and state['default']:
            revisions = [{'revision': row[0], 'before': json.loads(row[1]), 'after': json.loads(row[2])}
                         for row in query('''SELECT revision,before_value,after_value
                         FROM curriculum.module_hours_default_revisions WHERE default_id=%s
                         AND revision<%s ORDER BY revision DESC LIMIT 101''', [state['default']['id'], before_revision])]
        configured = bool(state and state['default'] and state['default']['targetMinutes'] is not None)
        items.append({'moduleId': identifier, 'state': state, 'reason': reason, 'revisions': revisions[:100],
                      'configured': configured, 'valid': configured and reason is None,
                      'nextBeforeRevision': revisions[99]['revision'] if len(revisions) > 100 else None})
    return {'items': items, 'canMatch': hours.read_access(request.login_account.id)['canMatch']}


@endpoint(['GET'])
def operations(request):
    # Explicitly creator-only; canManage never grants access to another actor.
    identifier = request.GET.get('operationId')
    params = [request.login_account.id]
    where = 'actor_key=%s'
    if identifier:
        where += ' AND id=%s'
        params.append(str(UUID(identifier)))
    cursor = request.GET.get('before')
    if cursor:
        rows = query('SELECT created_at,id FROM curriculum.module_hours_operations WHERE actor_key=%s AND id=%s',
                     [request.login_account.id, str(UUID(cursor))])
        if not rows:
            raise ValueError()
        where += ' AND (created_at,id)<(%s,%s)'
        params.extend(rows[0])
    rows = query(f'''SELECT outcome FROM curriculum.module_hours_operations WHERE {where}
                     ORDER BY created_at DESC,id DESC LIMIT 101''', params)
    outcomes = [json.loads(row[0]) for row in rows[:100]]
    return {'operations': outcomes, 'nextCursor': outcomes[-1]['operationId'] if len(rows) > 100 else None}
