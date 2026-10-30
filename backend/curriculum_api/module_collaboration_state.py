"""Pure, bounded page presence and temporary field ownership.

No content values, cookies, database calls or transport. Every transition runs
atomically in the store; the database's existing module-row lock serializes
lease acquisition with structure saves. Renew/leave cannot grant ownership.
"""
import copy
import json
import re
import secrets

from .module_merge import CONTROL_KEYS, DERIVED_MODULE_FIELDS, DERIVED_WEEK_FIELDS, PLANNED_SETTING_KEYS, TEAMS_OWNED_SETTING_KEYS

LEASE_SECONDS = 60
PRESENCE_SECONDS = 75
HEARTBEAT_SECONDS = 20
MAX_MEMBERS = 200
MAX_LEASES = 1024
_PROPERTY = re.compile(r'^(?:[A-Za-z][A-Za-z0-9_]*)(?:\.[A-Za-z][A-Za-z0-9_]*){0,4}$|^\$(?:delete|record|order)$')


class CoordinationUnavailable(RuntimeError):
    pass


def same_token(expected, supplied):
    return isinstance(supplied, str) and supplied.isascii() and secrets.compare_digest(expected, supplied)


def field_key(kind, identifier, field):
    return json.dumps([kind, str(identifier), field], separators=(',', ':'))


def parse_field_key(key):
    try:
        kind, identifier, field = json.loads(key)
        if kind not in ('module', 'week', 'component') or not isinstance(identifier, str) or not 0 < len(identifier) <= 140:
            raise ValueError
        if not isinstance(field, str) or not _PROPERTY.fullmatch(field) or len(field) > 160:
            raise ValueError
        if kind == 'module' and field.split('.')[0] in DERIVED_MODULE_FIELDS:
            raise ValueError
        if kind == 'week' and field.split('.')[0] in DERIVED_WEEK_FIELDS:
            raise ValueError
        if kind == 'component' and field.startswith('settings.') and field.split('.')[1] in TEAMS_OWNED_SETTING_KEYS | PLANNED_SETTING_KEYS:
            raise ValueError
        return kind, identifier, field
    except (ValueError, TypeError, json.JSONDecodeError):
        raise ValueError('Choose a valid editable field.') from None


def overlapping(first, second):
    a, b = parse_field_key(first), parse_field_key(second)
    if a[:2] != b[:2]:
        return False
    if a[2] in ('$delete', '$record', 'type') or b[2] in ('$delete', '$record', 'type'):
        return True
    return a[2] == b[2] or a[2].startswith(b[2] + '.') or b[2].startswith(a[2] + '.')


def clean_room(room, now):
    room = copy.deepcopy(room or {'members': {}, 'leases': {}})
    members, leases = room.setdefault('members', {}), room.setdefault('leases', {})
    for editor, member in list(members.items()):
        if member['expires'] <= now:
            del members[editor]
    for key, lease in list(leases.items()):
        member = members.get(lease['editor'])
        if lease['expires'] <= now or not member or member['connection'] != lease['connection']:
            del leases[key]
    return room


def public_room(room, now):
    return {
        'serverTime': now,
        'members': [{'editorId': editor, 'name': member['name']} for editor, member in room['members'].items()],
        'leases': [{'key': key, 'editorId': lease['editor'], 'name': lease['name'], 'expiresAt': lease['expires']}
                   for key, lease in room['leases'].items()],
    }


def member_matches(room, editor, connection):
    return (room['members'].get(editor) or {}).get('connection') == connection


def transition(room, action, actor, now, *, key='', token='', renew=()):
    """Return new state and response. A stale connection can never remove a new one."""
    room = clean_room(room, now)
    editor, connection = actor['editor'], actor['connection']
    if action == 'join':
        previous = room['members'].get(editor)
        if previous and previous['account'] != actor['account']:
            raise ValueError('Choose a new editor identity for this tab.')
        if editor not in room['members'] and len(room['members']) >= MAX_MEMBERS:
            raise CoordinationUnavailable('This page has reached its collaboration capacity.')
        room['members'][editor] = {**actor, 'expires': now + PRESENCE_SECONDS}
        room = clean_room(room, now)
    elif not member_matches(room, editor, connection):
        return room, {'ok': False, 'code': 'connection_expired', **public_room(room, now)}
    elif action == 'leave':
        del room['members'][editor]
        room = clean_room(room, now)
    elif action == 'heartbeat':
        room['members'][editor]['expires'] = now + PRESENCE_SECONDS
        # Only keys actively edited recently are renewed by the client. An open
        # or hidden page alone never keeps unsaved fields occupied indefinitely.
        for proof in list(renew)[:64]:
            if not isinstance(proof, dict) or not isinstance(proof.get('key'), str):
                raise ValueError('Invalid reservation renewal.')
            lease = room['leases'].get(proof.get('key'))
            if lease and lease['editor'] == editor and lease['connection'] == connection and same_token(lease['token'], proof.get('token', '')):
                lease['expires'] = now + LEASE_SECONDS
    elif action == 'claim':
        parse_field_key(key)
        for other_key, lease in room['leases'].items():
            if lease['editor'] != editor and overlapping(key, other_key):
                return room, {'ok': False, 'code': 'field_busy', 'key': key, 'name': lease['name'], **public_room(room, now)}
        lease = room['leases'].get(key)
        if not lease or lease['editor'] != editor or lease['connection'] != connection:
            if len(room['leases']) >= MAX_LEASES:
                raise CoordinationUnavailable('Too many fields are being edited. Save or cancel before continuing.')
            lease = {**actor, 'token': secrets.token_hex(16)}
        lease['expires'] = now + LEASE_SECONDS
        room['leases'][key] = lease
        return room, {'ok': True, 'key': key, 'token': lease['token'], **public_room(room, now)}
    elif action == 'release':
        lease = room['leases'].get(key)
        if lease and lease['editor'] == editor and lease['connection'] == connection and same_token(lease['token'], token):
            del room['leases'][key]
    elif action != 'snapshot':
        raise ValueError('Unsupported collaboration event.')
    return room, {'ok': True, **public_room(room, now)}


def _flatten(kind, identifier, record):
    excluded = DERIVED_MODULE_FIELDS if kind == 'module' else DERIVED_WEEK_FIELDS if kind == 'week' else frozenset()
    ignored = {'id', 'moduleId', 'weekId', 'components', 'weekStructure', 'structureRevision', 'itemFingerprints'} | CONTROL_KEYS
    result = {}
    def walk(value, path):
        if isinstance(value, dict) and value:
            for name, child in value.items():
                if path == 'settings' and name in TEAMS_OWNED_SETTING_KEYS | PLANNED_SETTING_KEYS:
                    continue
                walk(child, path + '.' + name if path else name)
        else:
            key = field_key(kind, identifier, path)
            try:
                parse_field_key(key)
            except ValueError:
                return
            result[key] = value
    for name, value in record.items():
        if name not in excluded | ignored:
            walk(value, name)
    return result


def edit_values(module):
    values = _flatten('module', module.get('catalogueId') or module.get('id') or '', module)
    for week in module.get('weekStructure') or []:
        values.update(_flatten('week', week['id'], week))
        for component in week.get('components') or []:
            values.update(_flatten('component', component['id'], component))
    return values


def changed_fields(stored, candidate):
    before, after = edit_values(stored), edit_values(candidate)
    absent = object()
    changed = {key for key in before.keys() | after.keys() if before.get(key, absent) != after.get(key, absent)}
    old_weeks, new_weeks = stored.get('weekStructure') or [], candidate.get('weekStructure') or []
    if [w['id'] for w in old_weeks] != [w['id'] for w in new_weeks]:
        changed.add(field_key('module', candidate.get('catalogueId') or stored.get('catalogueId') or '', '$order'))
    old_by_id = {w['id']: w for w in old_weeks}
    for week in new_weeks:
        original = old_by_id.get(week['id'])
        if original and [c['id'] for c in original.get('components') or []] != [c['id'] for c in week.get('components') or []]:
            changed.add(field_key('week', week['id'], '$order'))
    for kind in ('week', 'component'):
        old = {json.loads(key)[1] for key in before if json.loads(key)[0] == kind}
        new = {json.loads(key)[1] for key in after if json.loads(key)[0] == kind}
        changed.update(field_key(kind, identifier, '$delete') for identifier in old - new)
    return changed


def blocked_fields(room, changed, editor, proofs, now, *, parents=None):
    """Used under the same DB row lock as claims and writes, never just in the UI."""
    room = clean_room(room, now)
    blocked = {}
    parents = parents or {}
    for key in changed:
        kind, identifier, field = parse_field_key(key)
        for held_key, lease in room['leases'].items():
            held_kind, held_id, _ = parse_field_key(held_key)
            removes_child = kind == 'week' and field == '$delete' and held_kind == 'component' and parents.get(held_id) == identifier
            removes_module = kind == 'module' and field == '$delete'
            if not overlapping(key, held_key) and not removes_child and not removes_module:
                continue
            if lease['editor'] != editor or not same_token(lease['token'], proofs.get(held_key, '')):
                blocked[key] = {'key': key, 'name': lease['name'], 'reason': 'field_busy'}
        # An expired token is not permission, even if no one has acquired the
        # field yet. The caller must re-acquire and retain its saved base version.
        if key in proofs:
            lease = room['leases'].get(key)
            if not lease or lease['editor'] != editor or not same_token(lease['token'], proofs[key]):
                blocked[key] = {'key': key, 'name': '', 'reason': 'lease_expired'}
    return list(blocked.values())
