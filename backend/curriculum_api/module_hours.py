"""A module's fixed target is separate from its derived component OTJH.

Only explicit account grants permit changing targets or delegating access.
Super-admin/workspace grants deliberately confer neither of these powers.

The current curriculum database has no module-hours tables (targets, access
grants and their audit were not carried over). There, every read answers the
empty state -- no target, no grant -- so the module form and the account
console load normally and offer no edit; a write is refused with
``module_hours_not_available`` and nothing is created.
"""
import json

from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

from login.permissions import require_access, require_role
from .module_hours_schema import table_name


class RevisionConflict(Exception):
    pass


def response(payload, status=200):
    result = JsonResponse(payload, status=status)
    result['Cache-Control'] = 'no-store'
    return result


_PRESENT = {}


def available():
    """True when this database keeps the module-hours tables (cached per process)."""
    key = connection.settings_dict.get('NAME'), connection.vendor
    if key not in _PRESENT:
        if connection.vendor != 'postgresql':
            _PRESENT[key] = True  # the SQLite test schema provisions them
        else:
            with connection.cursor() as cursor:
                cursor.execute('SELECT to_regclass(%s) IS NOT NULL', ['curriculum.module_hours_access'])
                _PRESENT[key] = bool(cursor.fetchone()[0])
    return _PRESENT[key]


def not_available():
    return response({'error': 'Module hour targets are not available on the current curriculum database.',
                     'code': 'module_hours_not_available'}, 409)


def unavailable():
    return response({'error': 'Module hours are temporarily unavailable. Please try again.',
                     'code': 'module_hours_unavailable'}, 503)


def read_target(module_id):
    if not available():
        return {'targetMinutes': None, 'revision': 0}
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT target_minutes, revision FROM {table_name(connection, "module_hours_targets")} WHERE module_id = %s', [module_id])
        row = cursor.fetchone()
    return {'targetMinutes': row[0] if row else None, 'revision': row[1] if row else 0}


def read_access(account_id):
    if not available():
        return {'canMatch': False, 'canManage': False, 'revision': 0}
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT can_match, can_manage, revision FROM {table_name(connection, "module_hours_access")} WHERE account_id = %s', [account_id])
        row = cursor.fetchone()
    return {'canMatch': bool(row[0]) if row else False,
            'canManage': bool(row[1]) if row else False, 'revision': row[2] if row else 0}


def audit(kind, entity_id, actor_id, before, after):
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {table_name(connection, 'module_hours_audit')}
            (kind, entity_id, actor_id, before_value, after_value, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)''',
            [kind, str(entity_id), actor_id, json.dumps(before), json.dumps(after), timezone.now()])


def write_target(module_id, target_minutes, expected_revision, actor_id):
    """Must run in a transaction. Conditional upsert also guards first saves."""
    before = read_target(module_id)
    if before['revision'] != expected_revision:
        raise RevisionConflict()
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {table_name(connection, 'module_hours_targets')}
            (module_id, target_minutes, revision, updated_by, updated_at)
            VALUES (%s, %s, 1, %s, %s)
            ON CONFLICT (module_id) DO UPDATE SET target_minutes = excluded.target_minutes,
              revision = {table_name(connection, 'module_hours_targets').split('.')[-1]}.revision + 1,
              updated_by = excluded.updated_by, updated_at = excluded.updated_at
            WHERE {table_name(connection, 'module_hours_targets').split('.')[-1]}.revision = %s
            RETURNING target_minutes, revision''',
            [module_id, target_minutes, actor_id, timezone.now(), expected_revision])
        row = cursor.fetchone()
    if row is None:
        raise RevisionConflict()
    after = {'targetMinutes': row[0], 'revision': row[1]}
    audit('target', module_id, actor_id, before, after)
    return after


def write_access(account_id, can_match, can_manage, expected_revision, actor_id, *, audit_source='account_console'):
    before = read_access(account_id)
    if before['revision'] != expected_revision:
        raise RevisionConflict()
    table = table_name(connection, 'module_hours_access')
    with connection.cursor() as cursor:
        cursor.execute(f'''INSERT INTO {table}
            (account_id, can_match, can_manage, revision, updated_by, updated_at)
            VALUES (%s, %s, %s, 1, %s, %s)
            ON CONFLICT (account_id) DO UPDATE SET can_match = excluded.can_match,
              can_manage = excluded.can_manage, revision = {table.split('.')[-1]}.revision + 1,
              updated_by = excluded.updated_by, updated_at = excluded.updated_at
            WHERE {table.split('.')[-1]}.revision = %s
            RETURNING can_match, can_manage, revision''',
            [account_id, can_match, can_manage, actor_id, timezone.now(), expected_revision])
        row = cursor.fetchone()
    if row is None:
        raise RevisionConflict()
    after = {'canMatch': bool(row[0]), 'canManage': bool(row[1]), 'revision': row[2]}
    audit('access', account_id, actor_id, before, {**after, 'source': audit_source})
    return after


def body(request, fields):
    if request.headers.get('X-Requested-With') != 'XMLHttpRequest':
        raise PermissionError('Missing X-Requested-With header.')
    try:
        payload = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Invalid JSON body.') from None
    if not isinstance(payload, dict) or set(payload) != fields:
        raise ValueError('Supply only the required hours fields.')
    revision = payload.get('expectedRevision')
    if type(revision) is not int or not 0 <= revision <= 2147483647:
        raise ValueError('A valid hours revision is required.')
    return payload


def stored_module(identifier):
    from . import views
    if not identifier or len(identifier) > 140:
        return None
    resolved = views.resolve_stored_module_catalogue_id(identifier)
    row = views.authoring_module_exists(resolved) if resolved else None
    return (resolved, row) if row else None


@csrf_exempt
@require_http_methods(['GET', 'PATCH'])
@require_access('curriculum')
def module_target(request, module_id):
    try:
        resolved = stored_module(module_id)
        if not resolved:
            return response({'error': 'Module not found.'}, 404)
        identifier, module = resolved
        access = read_access(request.login_account.id)
        if request.method == 'GET':
            return response({'moduleId': identifier, **read_target(identifier), 'canMatch': access['canMatch']})
        if not available():
            return not_available()
        if not access['canMatch']:
            return response({'error': 'Match Module Hours permission is required.', 'code': 'forbidden'}, 403)
        payload = body(request, {'targetMinutes', 'expectedRevision'})
        target = payload['targetMinutes']
        if target is not None and (type(target) is not int or not 0 < target <= 2147483647):
            raise ValueError('Target hours must be positive and expressed in whole minutes.')
        from . import views
        with transaction.atomic():
            views.lock_module_structure_row(identifier)
            # Re-read under the same lock used by archive and module saves.
            module = views.authoring_module_exists(identifier)
            if not module:
                return response({'error': 'Module not found.'}, 404)
            archived = views.archived_programme_module_edit_error(module,
                title=module.get('title'), programme_id=module.get('programme_id'),
                programme_name=module.get('programme_name', ''))
            if archived is not None:
                return archived
            if not read_access(request.login_account.id)['canMatch']:
                return response({'error': 'Match Module Hours permission is required.', 'code': 'forbidden'}, 403)
            result = write_target(identifier, target, payload['expectedRevision'], request.login_account.id)
        return response({'moduleId': identifier, **result, 'canMatch': True})
    except RevisionConflict:
        return response({'error': 'The hours target changed. Review the latest target before saving again.',
                         'code': 'hours_conflict', 'current': read_target(identifier)}, 409)
    except PermissionError as exc:
        return response({'error': str(exc), 'code': 'csrf'}, 403)
    except ValueError as exc:
        return response({'error': str(exc)}, 400)
    except DatabaseError:
        return unavailable()


@require_http_methods(['GET'])
@require_role('admin', 'staff')
def own_access(request):
    try:
        return response(read_access(request.login_account.id))
    except DatabaseError:
        return unavailable()


@csrf_exempt
@require_http_methods(['GET', 'PATCH'])
@require_role('admin')
def account_access(request, account_id):
    try:
        actor_id = request.login_account.id
        if not available():
            return not_available()
        if not read_access(actor_id)['canManage']:
            return response({'error': 'Module hours access management permission is required.', 'code': 'forbidden'}, 403)
        from login.models import LoginAccount
        account = LoginAccount.objects.filter(pk=account_id, subject_type='staff').first()
        if account is None:
            return response({'error': 'Staff account not found.'}, 404)
        if request.method == 'GET':
            return response(read_access(account_id))
        payload = body(request, {'canMatch', 'canManage', 'expectedRevision'})
        if type(payload['canMatch']) is not bool or type(payload['canManage']) is not bool:
            raise ValueError('Hours permissions must be true or false.')
        if payload['canManage'] and account.role != 'admin':
            raise ValueError('The access manager must have access to the administrator account console.')
        with transaction.atomic():
            # Serialise delegation with revocation of the acting manager.
            lock = ' FOR UPDATE' if connection.vendor == 'postgresql' else ''
            with connection.cursor() as cursor:
                cursor.execute(f'SELECT can_manage FROM {table_name(connection, "module_hours_access")} WHERE account_id = %s{lock}', [actor_id])
                manager = cursor.fetchone()
            if not manager or not manager[0]:
                return response({'error': 'Module hours access management permission is required.', 'code': 'forbidden'}, 403)
            result = write_access(account_id, payload['canMatch'], payload['canManage'], payload['expectedRevision'], actor_id)
        return response(result)
    except RevisionConflict:
        return response({'error': 'These hours permissions changed. Reload them before saving.',
                         'code': 'hours_conflict', 'current': read_access(account_id)}, 409)
    except PermissionError as exc:
        return response({'error': str(exc), 'code': 'csrf'}, 403)
    except ValueError as exc:
        return response({'error': str(exc)}, 400)
    except DatabaseError:
        return unavailable()
