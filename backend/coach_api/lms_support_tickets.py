"""LMS tickets for the authenticated coach's current caseload; replies only."""
import functools
import json
from uuid import UUID

from django.db import DatabaseError, connections, transaction
from django.http import HttpResponseBase, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from learner_api import support_tickets as lms
from learner_api import support_ticket_files as files
from .auth import authenticated_coach_email, coach_access_required, is_coach_view_as
from .support_tickets import caseload_learners


def endpoint(view):
    @coach_access_required
    @csrf_protect
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            if request.method not in {'GET', 'POST'}:
                raise lms.TicketError('Method not allowed.', 405)
            result = view(request, *args, **kwargs)
            response = result if isinstance(result, HttpResponseBase) else JsonResponse(result)
        except (lms.TicketError, files.AttachmentError) as exc:
            response = JsonResponse({'error': str(exc)}, status=exc.status)
        except (ValueError, TypeError, UnicodeDecodeError):
            response = JsonResponse({'error': 'Invalid support ticket request.'}, status=400)
        except DatabaseError:
            response = JsonResponse({'error': 'LMS support tickets are unavailable. Please retry.'}, status=503)
        response['Cache-Control'] = 'private, no-store'
        return response
    return wrapped


def caseload(request):
    # Ticket enrolment_id is the account's subject_id, not Learner.learners.id.
    # Do not fall back to email or accept learner/coach identities from the body.
    return {learner.enrolment_id: learner for learner in caseload_learners(authenticated_coach_email(request))
            if learner.enrolment_id is not None}


def serialize(ticket, learner):
    return {**lms.public_ticket(ticket), 'learnerId': learner.id, 'learnerName': learner.full_name}


def read_ticket(cursor, ticket_id, learners, *, lock=False):
    cursor.execute(
        f'SELECT data,enrolment_id FROM {lms.TABLE} WHERE id=%s AND enrolment_id=ANY(%s)'
        + (' FOR UPDATE' if lock else ''), [str(ticket_id), list(learners)],
    )
    row = cursor.fetchone()
    if row is None or row[1] not in learners:
        raise lms.TicketError('Ticket not found.', 404)
    return lms.unpack(row), learners[row[1]]


@endpoint
def collection(request):
    if request.method != 'GET':
        raise lms.TicketError('Method not allowed.', 405)
    offset = max(0, int(request.GET.get('offset', '0')))
    learners = caseload(request)
    rows = []
    if learners:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute(
                f'SELECT data,enrolment_id FROM {lms.TABLE} WHERE enrolment_id=ANY(%s) '
                'ORDER BY created_at DESC,id LIMIT 101 OFFSET %s', [list(learners), offset],
            )
            rows = cursor.fetchall()
    return {'tickets': [serialize(lms.unpack(row), learners[row[1]]) for row in rows[:100]],
            'nextOffset': offset + 100 if len(rows) > 100 else None, 'readOnly': is_coach_view_as(request)}


@endpoint
def detail(request, ticket_id):
    learners = caseload(request)
    body = {}
    if request.method == 'POST':
        if request.content_type != 'application/json':
            raise lms.TicketError('Coach replies must contain text only.')
        if len(request.body) > 40000:
            raise lms.TicketError('The request is too large.', 413)
        body = json.loads(request.body or b'{}')
        if not isinstance(body, dict):
            raise lms.TicketError('A JSON object is required.')
        lms.only(body, {'requestId', 'body'})
        reply_id = str(UUID(lms.text_field(body, 'requestId', 36)))
        message = lms.text_field(body, 'body', 4000)
    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        ticket, learner = read_ticket(cursor, ticket_id, learners, lock=request.method == 'POST')
        if request.method == 'POST':
            account = request.login_account
            previous = next((reply for reply in ticket['replies'] if reply['id'] == reply_id), None)
            if previous:
                if previous.get('accountId') != account.pk or previous['body'] != message:
                    raise lms.TicketError('This reply ID has already been used.', 409)
            else:
                now = timezone.now().isoformat()
                ticket['replies'].append(dict(id=reply_id, accountId=account.pk,
                                              sender=account.display_name or 'Coach', senderRole='Coach',
                                              body=message, timestamp=now, attachments=[]))
                ticket['messages'] = len(ticket['replies'])
                ticket['lastUpdate'] = now
                cursor.execute(f'UPDATE {lms.TABLE} SET data=%s::jsonb WHERE id=%s AND enrolment_id=%s',
                               [json.dumps(ticket), str(ticket_id), learner.enrolment_id])
    return {'ticket': serialize(ticket, learner)}


@endpoint
def attachment(request, ticket_id, attachment_id):
    if request.method != 'GET':
        raise lms.TicketError('Method not allowed.', 405)
    learners = caseload(request)
    with connections['enrolment'].cursor() as cursor:
        ticket, _ = read_ticket(cursor, ticket_id, learners)
    items = [*ticket.get('attachments', []),
             *(item for reply in ticket.get('replies', []) for item in reply.get('attachments', []))]
    item = next((item for item in items if item['id'] == str(attachment_id)), None)
    if item is None:
        raise lms.TicketError('Attachment not found.', 404)
    return files.download(item)
