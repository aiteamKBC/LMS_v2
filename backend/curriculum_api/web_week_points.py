"""Named week Points owned by one saved curriculum week.

Membership never rewrites components, their original pointNumber, or progress.
"""
import json

from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from login.permissions import require_access
from .web_week_points_schema import table_name


class RevisionConflict(Exception):
    pass


def validate_points(value, component_ids):
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError('Supply up to 100 Points.')
    ids, members, result = set(), set(), []
    for point in value:
        if not isinstance(point, dict) or set(point) != {'id', 'title', 'componentIds'}:
            raise ValueError('Each Point needs an id, name and activity list.')
        identifier, title, activities = point['id'], point['title'], point['componentIds']
        if not isinstance(identifier, str) or not 1 <= len(identifier) <= 100 or identifier in ids:
            raise ValueError('Point identities must be unique.')
        if not isinstance(title, str) or not 1 <= len(title.strip()) <= 120:
            raise ValueError('Each Point needs a name of up to 120 characters.')
        if not isinstance(activities, list) or any(not isinstance(item, str) for item in activities):
            raise ValueError('Invalid activity list.')
        if any(item not in component_ids for item in activities):
            raise ValueError('Choose saved activities from this week only.')
        if len(set(activities)) != len(activities) or members.intersection(activities):
            raise ValueError('An activity can belong to only one week Point.')
        ids.add(identifier)
        members.update(activities)
        result.append({'id': identifier, 'title': title.strip(), 'componentIds': activities})
    return result


def read_configurations(week_ids, *, db=connection):
    if not week_ids:
        return {}
    with db.cursor() as cursor:
        cursor.execute(f'SELECT week_id, module_id, points_json, revision FROM {table_name(db)} '
                       f'WHERE week_id IN ({", ".join(["%s"] * len(week_ids))})', list(week_ids))
        return {row[0]: {'moduleId': row[1], 'points': json.loads(row[2]), 'revision': row[3]}
                for row in cursor.fetchall()}


def save_configuration(module_id, week_id, points, revision, actor_id, *, db=connection):
    table = table_name(db)
    with db.cursor() as cursor:
        # Atomic compare-and-swap also protects concurrent first saves.
        cursor.execute(f'''INSERT INTO {table}
            (week_id, module_id, points_json, revision, updated_by, updated_at)
            SELECT %s, %s, %s, 1, %s, %s WHERE %s = 0
            ON CONFLICT (week_id) DO NOTHING RETURNING revision''',
            [week_id, module_id, json.dumps(points), actor_id, timezone.now(), revision])
        row = cursor.fetchone()
        if row is None and revision > 0:
            cursor.execute(f'''UPDATE {table} SET points_json = %s, revision = revision + 1,
                updated_by = %s, updated_at = %s
                WHERE week_id = %s AND module_id = %s AND revision = %s RETURNING revision''',
                [json.dumps(points), actor_id, timezone.now(), week_id, module_id, revision])
            row = cursor.fetchone()
    if row is None:
        raise RevisionConflict()
    return row[0]


def saved_week(module_id, week_id):
    from . import views
    week = views.fetch_all(f'''SELECT id FROM {views.table_name('weeks')}
        WHERE id = %s AND module_catalogue_id = %s AND deleted_at IS NULL''', [week_id, module_id])
    if not week:
        return None
    rows = views.fetch_all(f'''SELECT id, title, type FROM {views.table_name('components')}
        WHERE week_id = %s AND module_catalogue_id = %s AND deleted_at IS NULL
        ORDER BY display_order, id''', [week_id, module_id])
    return [{'id': row['id'], 'title': row['title'], 'type': row['type']} for row in rows]


@require_http_methods(['GET', 'PUT'])
@require_access('curriculum')
@ensure_csrf_cookie
@csrf_protect
def week_points(request, module_id, week_id):
    from .module_hours import stored_module
    from . import views
    try:
        resolved = stored_module(module_id)
        if not resolved:
            return JsonResponse({'error': 'Module not found.'}, status=404)
        module_id, module = resolved
        with transaction.atomic():
            if request.method == 'PUT':
                views.lock_module_structure_row(module_id)
                module = views.authoring_module_exists(module_id)
                if not module:
                    return JsonResponse({'error': 'Module not found.'}, status=404)
                archived = views.archived_programme_module_edit_error(module,
                    title=module.get('title'), programme_id=module.get('programme_id'),
                    programme_name=module.get('programme_name', ''))
                if archived is not None:
                    return archived
            components = saved_week(module_id, week_id)
            if components is None:
                return JsonResponse({'error': 'Save this week before editing its Points.'}, status=404)
            saved = read_configurations([week_id]).get(week_id)
            if saved and saved['moduleId'] != module_id:
                return JsonResponse({'error': 'Points do not belong to this module.'}, status=409)
            points = saved['points'] if saved else []
            revision = saved['revision'] if saved else 0
            if request.method == 'PUT':
                payload = json.loads(request.body)
                if not isinstance(payload, dict) or set(payload) != {'points', 'expectedRevision'}:
                    raise ValueError('Supply Points and their expected revision.')
                expected = payload['expectedRevision']
                if type(expected) is not int or not 0 <= expected < 2147483647:
                    raise ValueError('Invalid Points revision.')
                points = validate_points(payload['points'], {item['id'] for item in components})
                revision = save_configuration(module_id, week_id, points, expected, request.login_account.id)
        response = JsonResponse({'moduleId': module_id, 'weekId': week_id, 'points': points, 'editorId': str(request.login_account.id),
            'revision': revision, 'csrfToken': get_token(request),
            'activities': [{key: value for key, value in item.items() if key != 'settings'} for item in components]})
        response['Cache-Control'] = 'private, no-store'
        return response
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({'error': 'Invalid Points. Supply names, unique identities and activities from this week.'}, status=400)
    except RevisionConflict:
        return JsonResponse({'error': 'Someone else changed these Points. Reload before saving.'}, status=409)
    except DatabaseError:
        return JsonResponse({'error': 'Week Points are unavailable. Check the Points migration and retry.'}, status=503)
