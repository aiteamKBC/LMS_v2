"""Staff-authored feedback follow-up, with server-owned addressing and history."""
import logging
import os
from uuid import UUID

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect

from learner_api.models import EnrolmentUser
from login import email_azure
from login.sessions import authenticate_request

from .helpers import json_body, json_error
from .models import FeedbackResponse, FeedbackResponseEmail
from .permissions import require_staff
from .quality_tickets import close_response_ticket


QUALITY_MAILBOX = 'Quality.Support@kentbusinesscollege.com'
logger = logging.getLogger(__name__)


def recipient_for_response(response):
    """Never infer an employer's address from the related learner identity."""
    if response.form.anonymous_responses:
        return None, 'Email is unavailable for anonymous feedback.'
    if response.status != 'completed':
        return None, 'Email is available after the response is submitted.'
    if response.form.form_type == 'post_progress_review_employer':
        delivery = response.employer_review_delivery
        email = getattr(delivery, 'employer_email', '') if delivery else ''
        name = getattr(delivery, 'employer_name', '') if delivery else ''
    elif response.event_recipient_id:
        email, name = response.event_recipient.attendee_email, response.event_recipient.attendee_name
    elif response.rsvp_recipient_id:
        email, name = response.rsvp_recipient.recipient_email, response.rsvp_recipient.recipient_name
    else:
        learner_id = str(response.learner_id or '')
        learner = (EnrolmentUser.all_learners.filter(pk=int(learner_id)).first()
                   if learner_id.isdecimal() else None)
        email = getattr(learner, 'email', '') if learner else ''
        name = getattr(learner, 'username', '') if learner else ''
    email = str(email or '').strip()
    try:
        validate_email(email)
    except ValidationError:
        return None, 'The respondent does not have a valid email address.'
    return {'name': name or response.learner_name, 'email': email}, ''


def email_dict(entry):
    return {
        'id': str(entry.id), 'subject': entry.subject, 'body': entry.body,
        'to': entry.recipient_email, 'from': entry.sender_email,
        'sentBy': entry.actor_name, 'status': entry.status, 'error': entry.error,
        'createdAt': entry.created_at.isoformat(),
        'sentAt': entry.sent_at.isoformat() if entry.sent_at else None,
        'qualityTicket': {'status': entry.ticket_close_status, 'error': entry.ticket_close_error},
    }


def quality_mail_config():
    """Use the dedicated Quality app when declared; never mix app credentials."""
    names = ('QUALITY_MAIL_TENANT_ID', 'QUALITY_MAIL_CLIENT_ID', 'QUALITY_MAIL_CLIENT_SECRET', 'QUALITY_MAIL_ENABLED')
    if not any(name in os.environ for name in names):
        return None  # Existing installations continue using the shared mail app.
    def enabled(name):
        return os.environ.get(name, 'true').strip().lower() not in {'0', 'false', 'no', 'off'}
    return {
        'tenant_id': os.environ.get('QUALITY_MAIL_TENANT_ID', '').strip(),
        'client_id': os.environ.get('QUALITY_MAIL_CLIENT_ID', '').strip(),
        'client_secret': os.environ.get('QUALITY_MAIL_CLIENT_SECRET', '').strip(),
        'sender': QUALITY_MAILBOX,
        'enabled': enabled('QUALITY_MAIL_ENABLED') and enabled('AZURE_MAIL_ENABLED'),
    }


def render_quality_email(entry):
    html = render_to_string('engagement_api/response_email.html', {
        'subject': entry.subject, 'message': entry.body,
        'reply_email': QUALITY_MAILBOX, 'logo_cid': email_azure.BRAND_LOGO_CID,
    })
    text = f'{entry.body}\n\nQuality Support team\nKent Business College\n\nReply to this email to contact {QUALITY_MAILBOX}.'
    return html, text


def _send(entry):
    # Do not exercise the transport's development console fallback with private
    # respondent data. Configuration failures are recorded for the staff UI.
    config = quality_mail_config()
    if not email_azure.is_configured(config):
        return False, 'not-configured'
    html, text = render_quality_email(entry)
    return email_azure.send_mail(
        to=entry.recipient_email, subject=entry.subject, html_body=html, text_body=text,
        sender_name='KBC Quality Support', sender_mailbox=QUALITY_MAILBOX,
        reply_to=QUALITY_MAILBOX, save_to_sent=True, redact_logs=True,
        **({'configuration': config} if config is not None else {}),
    )


def _responses_for_send():
    # Keep this lock on the response table alone. Nullable recipient joins cannot
    # be locked, and Django's schema-qualified db_table names are invalid in
    # PostgreSQL's FOR UPDATE OF clause. Related records load separately.
    return FeedbackResponse.objects.select_for_update()


def complete_ticket_close(entry, response):
    """Retry the ticket operation, never the already-accepted mail transport."""
    if entry.status != 'sent' or entry.ticket_close_status not in {'pending', 'failed'}:
        return entry
    with transaction.atomic():
        # Avoid schema-qualified FOR UPDATE OF and nullable relation joins.
        entry = FeedbackResponseEmail.objects.select_for_update().get(pk=entry.pk)
        if entry.status != 'sent' or entry.ticket_close_status not in {'pending', 'failed'}:
            return entry
        try:
            entry.ticket_close_status = close_response_ticket(response, actor_name=entry.actor_name)
            entry.ticket_close_error = ''
        except Exception as exc:
            logger.warning('Feedback email ticket closure failed for request %s (%s).', entry.id, type(exc).__name__)
            entry.ticket_close_status = 'failed'
            entry.ticket_close_error = 'Email accepted for sending, but the linked Quality ticket could not be synchronized. Retry ticket closure; do not resend the email.'
        entry.save(update_fields=['ticket_close_status', 'ticket_close_error'])
    return entry


def send_response_email(response, account, payload):
    if not isinstance(payload, dict) or set(payload) - {'requestId', 'subject', 'body', 'expectedRecipient'}:
        return json_error('Unsupported email fields. The recipient is set by the server.')
    subject, body = payload.get('subject'), payload.get('body')
    if (not isinstance(subject, str) or not subject.strip() or len(subject.strip()) > 255
            or '\r' in subject or '\n' in subject):
        return json_error('Enter a subject of at most 255 characters on one line.')
    if not isinstance(body, str) or not body.strip() or len(body.strip()) > 10000:
        return json_error('Enter a message of at most 10,000 characters.')
    try:
        request_id = UUID(str(payload.get('requestId', '')))
    except ValueError:
        return json_error('A valid email request ID is required.')

    # Serialize claims for this response, and commit the sending record BEFORE
    # Graph. A timeout or a process crash must never let a browser retry send twice.
    with transaction.atomic():
        locked = _responses_for_send().get(pk=response.pk)
        recipient, reason = recipient_for_response(locked)
        if not recipient:
            return json_error(reason, status=409)
        entry = FeedbackResponseEmail.objects.filter(pk=request_id).first()
        if entry is not None:
            if (entry.response_id != response.pk or entry.actor_account_id != account.pk
                    or entry.subject != subject.strip() or entry.body != body.strip()):
                return json_error('This email request ID has already been used.', status=409)
            return JsonResponse({'email': email_dict(complete_ticket_close(entry, locked))})
        # A preview can become stale if the account email changes while composing.
        # This is a comparison only; it cannot override the server-owned address.
        if payload.get('expectedRecipient') != recipient['email']:
            return json_error('The respondent email changed. Reload the email preview before sending.', status=409)
        entry = FeedbackResponseEmail.objects.create(
            id=request_id, response=locked, recipient_email=recipient['email'],
            sender_email=QUALITY_MAILBOX, subject=subject.strip(), body=body.strip(),
            actor_account_id=account.pk, actor_name=(account.display_name or 'Staff')[:255], status='sending',
        )

    try:
        sent, detail = _send(entry)
    except Exception:
        # No raw provider body, message content or address belongs in logs.
        logger.warning('Feedback email transport outcome unknown for request %s.', entry.id)
        sent, detail = False, 'unknown'
    if sent:
        entry.status, entry.sent_at, entry.error = 'sent', timezone.now(), ''
        entry.ticket_close_status = 'pending'
    elif str(detail).startswith('not-configured'):
        entry.status, entry.error = 'failed', 'Email is not configured. Contact your administrator.'
    elif str(detail).startswith('graph '):
        entry.status, entry.error = 'failed', 'The mail service rejected this message. Check access to the Quality Support mailbox.'
    else:
        entry.status, entry.error = 'unknown', 'Sending could not be confirmed. Check the Quality Support Sent Items before sending again.'
    entry.save(update_fields=['status', 'error', 'sent_at', 'ticket_close_status'])
    entry = complete_ticket_close(entry, response)
    return JsonResponse({'email': email_dict(entry)}, status=201)


@csrf_protect
@require_staff
def retry_ticket_close(request, pk, email_id):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        response = FeedbackResponse.objects.get(pk=pk)
        entry = FeedbackResponseEmail.objects.get(pk=email_id, response_id=pk)
        if response.form.anonymous_responses:
            return json_error('Email is unavailable for anonymous feedback.', status=409)
        if entry.status != 'sent':
            return json_error('Ticket closure requires an email accepted for sending.', status=409)
        result = JsonResponse({'email': email_dict(complete_ticket_close(entry, response))})
        result['Cache-Control'] = 'private, no-store'
        return result
    except (FeedbackResponse.DoesNotExist, FeedbackResponseEmail.DoesNotExist):
        return json_error('Feedback email not found.', status=404)
    except DatabaseError:
        return json_error('The ticket closure result is unavailable. Refresh email history before retrying.', status=503)


@csrf_protect
@require_staff
def response_emails(request, pk):
    if request.method not in {'GET', 'POST'}:
        return json_error('Method not allowed.', status=405)
    if request.method == 'POST' and len(request.body) > 50000:
        return json_error('The email request is too large.', status=413)
    try:
        response = FeedbackResponse.objects.select_related(
            'form', 'event_recipient', 'rsvp_recipient', 'employer_review_delivery',
        ).get(pk=pk)
        if request.method == 'POST':
            result = send_response_email(response, authenticate_request(request), json_body(request))
        else:
            recipient, reason = recipient_for_response(response)
            # Anonymous feedback must not expose an address through its history.
            history = ([email_dict(item) for item in FeedbackResponseEmail.objects.filter(
                response=response).order_by('-created_at', '-id')[:100]] if recipient else [])
            result = JsonResponse({
                'recipient': recipient, 'sender': QUALITY_MAILBOX, 'replyTo': QUALITY_MAILBOX,
                'canSend': bool(recipient), 'reason': reason, 'emails': history,
            })
    except FeedbackResponse.DoesNotExist:
        return json_error('Feedback response not found.', status=404)
    except DatabaseError as exc:
        logger.warning('Feedback email database error for response %s (%s, SQLSTATE %s).',
                       pk, type(exc).__name__, getattr(exc.__cause__, 'sqlstate', 'unknown'))
        return json_error('Email history is unavailable. Refresh before retrying; check Sent Items if you already sent a message.', status=503)
    result['Cache-Control'] = 'private, no-store'
    return result
