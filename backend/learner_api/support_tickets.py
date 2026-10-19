"""Account-owned LMS support tickets. No Inclusion or email side effects."""
import functools
import json
from uuid import UUID

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from login.permissions import authenticate_request, _unauthenticated, _accesses_of

TABLE = '"Learner".support_tickets'
CATEGORIES = {'Technical Issue', 'Learning Support', 'Data / MIS', 'Coaching Query', 'Safeguarding Concern', 'Other'}
PRIORITIES = {'low', 'medium', 'high', 'urgent'}
STATUSES = {'open', 'in-progress', 'resolved', 'closed'}


class TicketError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def staff_allowed(account):
    return account.role == 'admin' or (account.role == 'staff' and 'support' in _accesses_of(account))


def endpoint(staff=False):
    def decorate(view):
        @csrf_protect
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            try:
                account = authenticate_request(request)
                if account is None or not account.is_active:
                    return _unauthenticated(request)
                allowed = staff_allowed(account) if staff else account.role == 'learner' and account.subject_type == 'learner'
                if not allowed:
                    raise TicketError('You do not have access to these support tickets.', 403)
                if request.method not in {'GET', 'POST'}:
                    raise TicketError('Method not allowed.', 405)
                body = {}
                if request.method == 'POST':
                    if len(request.body) > 40000:
                        raise TicketError('The request is too large.', 413)
                    body = json.loads(request.body or b'{}')
                    if not isinstance(body, dict):
                        raise TicketError('A JSON object is required.')
                result = view(request, account, body, staff=staff, *args, **kwargs)
                if 'ticket' in result:
                    result['ticket'] = public_ticket(result['ticket'])
                if 'tickets' in result:
                    result['tickets'] = [public_ticket(ticket) for ticket in result['tickets']]
                response = JsonResponse({**result, 'csrfToken': get_token(request)})
            except TicketError as exc:
                response = JsonResponse({'error': str(exc)}, status=exc.status)
            except (ValueError, TypeError, UnicodeDecodeError):
                response = JsonResponse({'error': 'Invalid support ticket request.'}, status=400)
            except DatabaseError:
                response = JsonResponse({'error': 'Support tickets are unavailable. Your message has not been cleared; please retry.'}, status=503)
            response['Cache-Control'] = 'private, no-store'
            return response
        return wrapped
    return decorate


def text_field(body, key, maximum):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum:
        raise TicketError(f'{key} is required and must be at most {maximum} characters.')
    return value.strip()


def only(body, fields):
    if set(body) - set(fields):
        raise TicketError('The request contains unsupported fields.')


def unpack(row):
    return json.loads(row[0]) if isinstance(row[0], str) else row[0]


def public_ticket(ticket):
    return {**ticket, 'replies': [{key: value for key, value in reply.items() if key != 'accountId'}
                                 for reply in ticket.get('replies', [])]}


def collection(request, account, body, *, staff):
    if request.method == 'GET':
        try:
            offset = max(0, int(request.GET.get('offset', '0')))
        except ValueError:
            raise TicketError('Invalid page.') from None
        with connections['enrolment'].cursor() as cursor:
            where, params = ('', []) if staff else ('WHERE owner_account_id=%s', [account.pk])
            cursor.execute(f'SELECT data FROM {TABLE} {where} ORDER BY created_at DESC, id LIMIT 101 OFFSET %s', [*params, offset])
            rows = cursor.fetchall()
        return {'tickets': [unpack(row) for row in rows[:100]], 'nextOffset': offset + 100 if len(rows) > 100 else None}
    if staff:
        raise TicketError('Create tickets from your learner account.', 403)
    only(body, {'requestId', 'title', 'description', 'category', 'priority'})
    ticket_id = str(UUID(text_field(body, 'requestId', 36)))
    title = text_field(body, 'title', 200)
    description = text_field(body, 'description', 10000)
    if body.get('category') not in CATEGORIES or body.get('priority') not in PRIORITIES:
        raise TicketError('Select a valid category and priority.')
    now = timezone.now().isoformat()
    data = dict(id=ticket_id, title=title, description=description, category=body['category'],
                priority=body['priority'], status='open', submitted=now, lastUpdate=now,
                requester=account.display_name or 'Learner', assignedTo='', assignedTeam='LMS Support',
                messages=0, timeline=[{'event': 'Opened', 'timestamp': now}], replies=[])
    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        cursor.execute(f'INSERT INTO {TABLE} (id,owner_account_id,enrolment_id,data) VALUES (%s,%s,%s,%s::jsonb) ON CONFLICT(id) DO NOTHING',
                       [ticket_id, account.pk, account.subject_id, json.dumps(data)])
        cursor.execute(f'SELECT data FROM {TABLE} WHERE id=%s AND owner_account_id=%s', [ticket_id, account.pk])
        row = cursor.fetchone()
        if not row:
            raise TicketError('This request ID has already been used.', 409)
        saved = unpack(row)
        if any(saved.get(key) != data[key] for key in ('title', 'description', 'category', 'priority')):
            raise TicketError('This request ID belongs to a different ticket. Reload the ticket list before retrying.', 409)
    return {'ticket': saved}


def detail(request, account, body, ticket_id, *, staff):
    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        where, params = ('', []) if staff else (' AND owner_account_id=%s', [account.pk])
        cursor.execute(f'SELECT data FROM {TABLE} WHERE id=%s{where} FOR UPDATE', [str(ticket_id), *params])
        row = cursor.fetchone()
        if not row:
            raise TicketError('Ticket not found.', 404)
        ticket = unpack(row)
        if request.method == 'GET':
            return {'ticket': ticket}
        action = body.get('action')
        now = timezone.now().isoformat()
        if action == 'reply':
            only(body, {'action', 'requestId', 'body'})
            reply_id = str(UUID(text_field(body, 'requestId', 36)))
            message = text_field(body, 'body', 4000)
            previous = next((reply for reply in ticket['replies'] if reply['id'] == reply_id), None)
            if previous:
                if previous.get('accountId') != account.pk or previous['body'] != message:
                    raise TicketError('This reply ID has already been used.', 409)
                return {'ticket': ticket}
            ticket['replies'].append(dict(id=reply_id, accountId=account.pk, sender=account.display_name or ('Support' if staff else 'Learner'),
                                          senderRole='Support' if staff else 'Learner', body=message, timestamp=now))
            ticket['messages'] = len(ticket['replies'])
        elif action == 'status' and staff:
            only(body, {'action', 'status', 'expectedStatus'})
            if body.get('status') not in STATUSES:
                raise TicketError('Invalid ticket status.')
            if body.get('expectedStatus') != ticket['status']:
                raise TicketError('The ticket has changed. Refresh before updating its status.', 409)
            ticket['status'] = body['status']
            ticket['timeline'].append(dict(event=body['status'], timestamp=now, detail=account.display_name or 'Support'))
        elif action == 'assign' and staff:
            only(body, {'action'})
            ticket['assignedTo'] = account.display_name or 'Support'
            ticket['timeline'].append(dict(event='Assigned', timestamp=now, detail=ticket['assignedTo']))
        elif action == 'feedback' and not staff:
            only(body, {'action', 'rating', 'comment'})
            if ticket['status'] not in {'resolved', 'closed'} or type(body.get('rating')) is not int or not 1 <= body['rating'] <= 5:
                raise TicketError('Rate a resolved ticket from 1 to 5.')
            comment = body.get('comment', '')
            if not isinstance(comment, str) or len(comment) > 4000:
                raise TicketError('Feedback must be at most 4000 characters.')
            ticket['feedback'] = dict(rating=body['rating'], comment=comment, timestamp=now)
        else:
            raise TicketError('This ticket action is not allowed.', 403)
        ticket['lastUpdate'] = now
        cursor.execute(f'UPDATE {TABLE} SET data=%s::jsonb WHERE id=%s', [json.dumps(ticket), str(ticket_id)])
    return {'ticket': ticket}


learner_tickets = endpoint()(collection)
learner_ticket = endpoint()(detail)
staff_tickets = endpoint(staff=True)(collection)
staff_ticket = endpoint(staff=True)(detail)
