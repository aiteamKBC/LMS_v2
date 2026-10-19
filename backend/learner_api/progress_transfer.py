"""Self-service requests and admin-only approval of module-level credit."""
import functools
import json
from uuid import uuid4

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from login.permissions import authenticate_request, _unauthenticated
from old_otjh.service import ServiceError

from . import canonical_learning as canonical
from . import progress_transfer_store as store
from .progress_transfer_policy import eligible_pairs, public_item


def endpoint(role):
    def decorate(view):
        @csrf_protect
        @require_http_methods(['GET', 'POST'])
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                account = authenticate_request(request)
                if account is None:
                    return _unauthenticated(request)
                if account.role != role:
                    return JsonResponse({'error': 'You do not have permission to perform this action.'}, status=403)
                if role == 'learner' and int(kwargs['pk']) != account.subject_id:
                    return JsonResponse({'error': 'Learner not found.'}, status=404)
                if request.method == 'POST':
                    payload = json.loads(request.body or b'{}')
                    if not isinstance(payload, dict) or payload.get('confirm') is not True or set(payload) != {'confirm'}:
                        return JsonResponse({'error': 'Confirm this action to continue.'}, status=400)
                response = view(request, account, *args, **kwargs)
            except ServiceError as exc:
                response = JsonResponse({'error': str(exc), 'code': exc.code}, status=exc.status)
            except (ValueError, TypeError, UnicodeDecodeError):
                response = JsonResponse({'error': 'Invalid transfer request.'}, status=400)
            except DatabaseError:
                response = JsonResponse({'error': 'Progress transfer is unavailable. Please try again.'}, status=503)
            response['Cache-Control'] = 'private, no-store'
            return response
        return wrapped
    return decorate


def source_owner(kind, pk):
    from .my_learning import SOURCE_FIELDS, SOURCE_MODELS
    model = SOURCE_MODELS.get(kind)
    source = model.all_learners.only(*SOURCE_FIELDS).filter(pk=pk).first() if model else None
    if source is None:
        raise ServiceError('Learner not found.', 'not_found', 404)
    return source, canonical.require_profile(pk)


def available(source, owner, state):
    from .my_learning import load_context
    context = load_context(source, owner)
    _, assigned_ids, _, _, courses, _, _, _, _, metadata, _ = context
    pairs = eligible_pairs(metadata['imported_courses'], metadata['replacement_courses'],
        {f"legacy:{int(course['source_course_ref'])}" for course in courses}, set(assigned_ids), state['items'])
    return context, pairs


def request_summary(items):
    grouped = {}
    for item in items:
        row = grouped.setdefault(item['requestId'], {key: item[key] for key in ('requestId', 'status', 'requestedAt', 'approvedAt')})
        row.setdefault('modules', []).append(public_item(item))
    return list(grouped.values())


def transfer_preview(source, owner):
    state = store.read_state(source.pk)
    context, pairs = available(source, owner, state)
    courses, metadata = context[4], context[9]
    titles = {f"legacy:{int(course['source_course_ref'])}": course['source_course_title'] for course in courses}
    current = {f"current:{item['id']}": item['title'] for item in metadata['current_subjects']}
    return {'eligible': [{'courseRef': old, 'moduleId': ref[8:], 'oldTitle': titles[old], 'newTitle': current[ref]}
                         for ref, old in pairs.items()], 'requests': request_summary(state['items'])}


def create_request(source, kind, owner, account):
    from .my_learning import assemble_cards
    with store.lock_learner(source.pk) as cursor:
        state = store.read_state(source.pk)
        pending = [item for item in state['items'] if item['status'] == 'pending']
        if pending:
            return request_summary(pending)[0]
        context, pairs = available(source, owner, state)
        if not pairs:
            raise ServiceError('No old modules are currently eligible for transfer.', 'no_eligible_modules', 409)
        _, _, records, native, courses, definitions, done, started, hours, metadata, credits = context
        cards, _ = assemble_cards(native, metadata['current_subjects'], courses, definitions, done, started,
                                 hours, metadata, records, metadata['modules'], credits)
        by_id = {card['id']: card for card in cards}
        request_id = str(uuid4())
        items, frozen_ids = [], set()
        current_titles = {row['id']: row['title'] for row in metadata['current_subjects']}
        for ref, old in pairs.items():
            card = by_id[old]
            ids = {str(ident) for (course, _), values in metadata['record_ids'].items()
                   if str(course) == old[7:] for ident in values}
            frozen_ids.update(ids)
            items.append(dict(courseRef=old, moduleId=ref[8:], oldTitle=card['title'], newTitle=current_titles[ref[8:]],
                percent=card['progress'], hours=card['actualHours'] or 0,
                activityCount=card['activityCount'], completedActivityCount=card['completedActivityCount'],
                recordIds=sorted(ids)))
        # Load complete records once, retaining evidence and reporting history.
        # Snapshot only historical rows; native activity saves remain independent.
        snapshots = [record for record in canonical.entries_for(owner) if str(record['id']) in frozen_ids
                     and record.get('source_system') == 'old_lms']
        cursor.execute(f'''INSERT INTO {store.REQUESTS}
            (id,enrolment_id,learner_id,learner_kind,requested_by,records) VALUES (%s,%s,%s,%s,%s,%s::jsonb)''',
            [request_id, source.pk, owner['id'], kind, account.id, store.dumps(snapshots)])
        for item in items:
            cursor.execute(f'''INSERT INTO {store.ITEMS} (request_id,enrolment_id,course_ref,module_id,snapshot)
                VALUES (%s,%s,%s,%s,%s::jsonb)''', [request_id, source.pk, item['courseRef'], item['moduleId'], store.dumps(item)])
        return next(row for row in request_summary(store.read_state(source.pk)['items']) if row['requestId'] == request_id)


def approve_request(request_id, account):
    from .my_learning import load_context, native_done
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'SELECT enrolment_id,learner_kind FROM {store.REQUESTS} WHERE id=%s', [request_id])
        row = cursor.fetchone()
    if not row:
        raise ServiceError('Transfer request not found.', 'not_found', 404)
    pk, kind = row
    with store.lock_learner(pk) as cursor:
        state = store.read_state(pk)
        items = [item for item in state['items'] if item['requestId'] == str(request_id)]
        if not items:
            raise ServiceError('Transfer request not found.', 'not_found', 404)
        if all(item['status'] == 'approved' for item in items):
            return request_summary(items)[0]
        source, owner = source_owner(kind, pk)
        context = load_context(source, owner)
        _, assigned, _, native, courses, _, _, _, _, metadata, _ = context
        pairs = eligible_pairs(metadata['imported_courses'], metadata['replacement_courses'],
            {f"legacy:{int(course['source_course_ref'])}" for course in courses}, set(assigned))
        if any(pairs.get('current:' + item['moduleId']) != item['courseRef'] for item in items):
            raise ServiceError('A module assignment or course mapping changed. Review it before approving this request.',
                               'transfer_mapping_changed', 409)
        for item in items:
            components = [c for c in native['components'] if c.get('moduleId') == item['moduleId']]
            item['baselineCompletedIds'] = [c['componentId'] for c in components if c.get('componentId') and native_done(c, native)]
            item['baselinePercent'] = 100 * len(set(item['baselineCompletedIds'])) / len(components) if components else 0
            cursor.execute(f'UPDATE {store.ITEMS} SET snapshot=%s::jsonb WHERE request_id=%s AND enrolment_id=%s AND module_id=%s',
                [store.dumps({key: value for key, value in item.items() if key not in ('requestId','status','requestedAt','approvedAt')}), request_id, pk, item['moduleId']])
        cursor.execute(f"UPDATE {store.REQUESTS} SET status='approved',approved_by=%s,approved_at=now() WHERE id=%s AND status='pending'",
                       [account.id, request_id])
        return next(row for row in request_summary(store.read_state(pk)['items']) if row['requestId'] == str(request_id))


@endpoint('learner')
def learner_request(request, account, kind, pk):
    source, owner = source_owner(kind, pk)
    if request.method == 'POST':
        return JsonResponse({'request': create_request(source, kind, owner, account)})
    return JsonResponse({**transfer_preview(source, owner), 'csrfToken': get_token(request)})


@endpoint('admin')
def admin_requests(request, account, request_id=None):
    if request_id is not None:
        if request.method != 'POST':
            return JsonResponse({'error': 'Use Confirm to approve this request.'}, status=405)
        return JsonResponse({'request': approve_request(request_id, account)})
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    offset = int(request.GET.get('offset', 0))
    if offset < 0:
        raise ValueError('Invalid offset')
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(f'''SELECT r.id,r.enrolment_id,r.learner_kind,r.status,r.requested_at,r.approved_at,
            l.full_name,l.programme,jsonb_agg(i.snapshot ORDER BY i.course_ref)
            FROM {store.REQUESTS} r JOIN "Learner".learners l ON l.id=r.learner_id AND l.enrolment_id=r.enrolment_id
            JOIN {store.ITEMS} i ON i.request_id=r.id AND i.enrolment_id=r.enrolment_id
            GROUP BY r.id,l.full_name,l.programme
            ORDER BY (r.status='pending') DESC,r.requested_at DESC,r.id LIMIT 51 OFFSET %s''', [offset])
        rows = cursor.fetchall()
    result = [{'requestId': str(row[0]), 'learnerId': str(row[1]), 'learnerKind': row[2], 'status': row[3],
               'requestedAt': row[4].isoformat(), 'approvedAt': row[5].isoformat() if row[5] else None,
               'learnerName': row[6], 'programme': row[7], 'modules': [public_item(item) for item in store.decode(row[8])]}
              for row in rows[:50]]
    return JsonResponse({'requests': result, 'nextOffset': offset+50 if len(rows)>50 else None, 'csrfToken': get_token(request)})
