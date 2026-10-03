"""Staff campaign and public token endpoints for event RSVP."""
from __future__ import annotations

from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from .event_rsvp import configure_campaign, recipient_for_token, reset_failed_recipients, save_rsvp, send_invitations
from .feedback import _answer_empty, _iso, _section_dict, _valid_answer
from .helpers import json_body, json_error
from .models import (
    Event, EventRsvpCampaign, EventRsvpRecipient, FeedbackAnswer, FeedbackQuestion, FeedbackResponse,
)
from .permissions import actor_name, require_staff


def public_csrf(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    response = JsonResponse({'csrfToken': get_token(request)})
    response['Cache-Control'] = 'no-store'
    return response


def _recipient_dict(item):
    return {
        'id': item.id, 'name': item.recipient_name, 'email': item.recipient_email,
        'learnerId': item.learner_id or None, 'inviteStatus': item.invite_status,
        'rsvpStatus': item.rsvp_status, 'sentAt': _iso(item.invitation_sent_at),
        'respondedAt': _iso(item.responded_at), 'error': item.invitation_error,
    }


@require_staff
def campaign(request, event_id):
    event = Event.objects.filter(pk=event_id).first()
    if event is None:
        return json_error('Event not found.', status=404)
    current = EventRsvpCampaign.objects.select_related('form').filter(event=event).first()
    if request.method == 'GET':
        recipients = current.recipients.filter(revoked_at__isnull=True).order_by('recipient_name', 'id') if current else []
        return JsonResponse({
            'event': {'id': event.id, 'title': event.title},
            'form': ({'id': current.form_id, 'title': current.form.title} if current else None),
            'recipients': [_recipient_dict(item) for item in recipients],
        })
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    action = payload.get('action')
    if action == 'configure':
        retry_emails = payload.get('retryEmails') or []
        if not isinstance(retry_emails, list):
            return json_error('Retry recipients must be a list of email addresses.')
        try:
            current = configure_campaign(
                event=event, form_id=payload.get('formId'),
                learner_ids=payload.get('learnerIds') or [], guests=payload.get('guests') or [],
                created_by=actor_name(request) or 'Staff',
            )
            reset_failed_recipients(current, retry_emails)
        except (TypeError, ValueError) as exc:
            return json_error(str(exc) or 'Could not configure RSVP campaign.')
        return JsonResponse({
            'campaignId': current.id,
            'recipientCount': current.recipients.filter(revoked_at__isnull=True).count(),
        })
    if action != 'send':
        return json_error('Unsupported RSVP action.')
    if current is None:
        return json_error('Configure the RSVP audience before sending.', status=409)
    resend_all = payload.get('resendAll') is True
    pending_only = payload.get('pendingOnly') is True and not resend_all
    if resend_all:
        current.recipients.filter(revoked_at__isnull=True).update(
            invite_status='pending', invitation_sent_at=None, invitation_error='',
            updated_at=timezone.now(),
        )
    statuses = ['pending'] if pending_only else ['pending', 'failed']
    recipients = list(current.recipients.filter(
        revoked_at__isnull=True, invite_status__in=statuses,
    ).order_by('id')[:100])
    results = send_invitations(current, recipients)
    remaining = current.recipients.filter(
        revoked_at__isnull=True, invite_status__in=statuses,
    ).count()
    return JsonResponse({
        'attempted': len(results), 'sent': sum(item['sent'] for item in results),
        'failed': sum(not item['sent'] for item in results), 'remaining': remaining,
    })


def _public_form(recipient):
    form = recipient.campaign.form
    response = FeedbackResponse.objects.filter(
        form=form, rsvp_recipient=recipient,
    ).prefetch_related('answers').first()
    answers = {str(answer.question_id): answer.answer for answer in response.answers.all()} if response else {}
    return {
        'id': form.id, 'title': form.title, 'description': form.description,
        'instructions': form.instructions, 'allowSaveContinue': form.allow_save_continue,
        'allowEditAfterSubmission': True,
        'sections': [_section_dict(section) for section in form.sections.all()],
        'response': {
            'id': response.id if response else None,
            'status': response.status if response else 'not_started',
            'answers': answers, 'submittedAt': _iso(response.submitted_at) if response else None,
        },
    }


def public_access(request):
    payload = json_body(request) or {} if request.method == 'POST' else {}
    token = request.GET.get('token', '') if request.method == 'GET' else payload.get('token', '')
    recipient = recipient_for_token(token)
    if recipient is None:
        return json_error('This RSVP link is invalid or has expired.', status=404)
    if request.method == 'GET' or payload.get('action') == 'read':
        response = JsonResponse({
            'event': {
                'id': recipient.campaign.event_id, 'title': recipient.campaign.event.title,
                'date': recipient.campaign.event.date, 'time': recipient.campaign.event.time,
                'location': recipient.campaign.event.location,
            },
            'recipient': {'name': recipient.recipient_name},
            'rsvpStatus': recipient.rsvp_status,
            'form': _public_form(recipient),
            'expiresAt': _iso(recipient.token_expires_at),
        })
        response['Cache-Control'] = 'private, no-store'
        return response
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    answers = payload.get('answers') or {}
    if not isinstance(answers, dict):
        return json_error('Answers must be an object keyed by question ID.')
    form = recipient.campaign.form
    questions = {str(item.id): item for item in FeedbackQuestion.objects.filter(section__form=form)}
    if any(str(question_id) not in questions for question_id in answers):
        return json_error('One or more question IDs do not belong to this form.')
    for question_id, value in answers.items():
        if questions[str(question_id)].question_type == 'photo_upload':
            return json_error('Photo questions are not available on event RSVP forms.')
        if not _valid_answer(questions[str(question_id)], value):
            return json_error(f'Invalid answer for question {question_id}.')
    existing = FeedbackResponse.objects.filter(form=form, rsvp_recipient=recipient).prefetch_related('answers').first()
    effective = {str(item.question_id): item.answer for item in existing.answers.all()} if existing else {}
    effective.update(answers)
    missing = [item.id for item in questions.values() if item.required and _answer_empty(item, effective.get(str(item.id)))]
    if missing:
        return json_error('Complete every required question before submitting.', fields=[str(value) for value in missing])
    try:
        with transaction.atomic():
            # Serialize repeated/double-clicked responses for this recipient so
            # booking counts remain idempotent under concurrent submissions.
            recipient = EventRsvpRecipient.objects.select_for_update().select_related(
                'campaign__event', 'campaign__form',
            ).get(pk=recipient.pk)
            save_rsvp(recipient, payload.get('rsvpStatus'))
            response, _ = FeedbackResponse.objects.get_or_create(
                form=form, rsvp_recipient=recipient,
                defaults={
                    'learner_id': recipient.learner_id, 'learner_name': recipient.recipient_name,
                    'status': 'in_progress',
                },
            )
            for question_id, value in answers.items():
                FeedbackAnswer.objects.update_or_create(
                    response=response, question_id=question_id, defaults={'answer': value},
                )
            response.status = 'completed'
            response.submitted_at = timezone.now()
            response.save(update_fields=['status', 'submitted_at', 'updated_at'])
    except ValueError as exc:
        return json_error(str(exc))
    return JsonResponse({
        'rsvpStatus': recipient.rsvp_status,
        'response': {'id': response.id, 'status': response.status, 'submittedAt': _iso(response.submitted_at)},
    })
