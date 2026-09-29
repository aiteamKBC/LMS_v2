"""HTTP endpoints for staff event imports and bearer-token attendee forms."""
from __future__ import annotations

import json

from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from .event_feedback import (
    import_event_attendance, parse_attendance, recipient_for_token,
    send_event_invitations,
)
from .feedback import _answer_empty, _iso, _section_dict, _valid_answer
from .helpers import json_body, json_error
from .models import (
    Event, FeedbackAnswer, FeedbackEventCampaign, FeedbackEventRecipient,
    FeedbackQuestion, FeedbackResponse,
)
from .permissions import actor_name, require_staff


def public_csrf(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    response = JsonResponse({'csrfToken': get_token(request)})
    response['Cache-Control'] = 'no-store'
    return response


def _preview_dict(preview):
    return {
        'presentCount': preview['presentCount'],
        'ignoredCount': preview['ignoredCount'],
        'errors': preview['errors'],
        'attendees': preview['attendees'][:100],
        'attendeePreviewTruncated': len(preview['attendees']) > 100,
    }


@require_staff
def attendance_import(request, event_id):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        preview = parse_attendance(request.FILES.get('file'))
    except ValueError as exc:
        return json_error(str(exc))
    if request.POST.get('preview', 'true').casefold() != 'false':
        return JsonResponse({'preview': _preview_dict(preview)})
    try:
        raw_ids = json.loads(request.POST.get('formIds') or '[]')
        if not isinstance(raw_ids, list):
            raise ValueError
        event, forms, recipients = import_event_attendance(
            event_id=event_id, form_ids=raw_ids, preview=preview,
            created_by=actor_name(request) or 'Staff',
        )
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        return json_error(str(exc) or 'Choose at least one Post-event feedback form.')
    return JsonResponse({
        'eventId': event.id, 'formCount': len(forms),
        'recipientCount': len(recipients), 'preview': _preview_dict(preview),
    })


@require_staff
def event_campaign(request, event_id):
    event = Event.objects.filter(pk=event_id).first()
    if event is None:
        return json_error('Event not found.', status=404)
    if request.method == 'GET':
        campaigns = FeedbackEventCampaign.objects.select_related('form').filter(event=event).order_by('form__title')
        recipients = FeedbackEventRecipient.objects.filter(event=event, revoked_at__isnull=True)
        return JsonResponse({
            'event': {'id': event.id, 'title': event.title},
            'forms': [{
                'id': item.form_id, 'title': item.form.title,
                'status': item.status,
            } for item in campaigns],
            'recipients': [{
                'id': item.id, 'name': item.attendee_name, 'email': item.attendee_email,
                'learnerId': item.learner_id or None, 'inviteStatus': item.invite_status,
                'sentAt': _iso(item.invitation_sent_at), 'error': item.invitation_error,
            } for item in recipients.order_by('attendee_name', 'id')],
        })
    if request.method == 'POST':
        payload = json_body(request) or {}
        resend_all = payload.get('resendAll') is True
        if resend_all:
            # Queue the whole active roster, but retain the established
            # 100-message batch size so a large spreadsheet cannot hold one
            # request open while thousands of mail calls complete.
            FeedbackEventRecipient.objects.filter(
                event=event, revoked_at__isnull=True,
            ).update(
                invite_status='pending', invitation_sent_at=None,
                invitation_error='', updated_at=timezone.now(),
            )
        recipient_query = FeedbackEventRecipient.objects.filter(
            event=event, revoked_at__isnull=True,
            invite_status__in=['pending', 'failed'],
        ).order_by('id')
        recipients = list(recipient_query[:100])
        results = send_event_invitations(event, recipients)
        remaining = FeedbackEventRecipient.objects.filter(
            event=event, revoked_at__isnull=True, invite_status__in=['pending', 'failed'],
        ).count()
        return JsonResponse({
            'attempted': len(results),
            'sent': sum(item['sent'] for item in results),
            'failed': sum(not item['sent'] for item in results),
            'remaining': remaining,
        })
    return json_error('Method not allowed.', status=405)


def _public_form_dict(form, recipient):
    response = FeedbackResponse.objects.filter(
        form=form, event_recipient=recipient,
    ).prefetch_related('answers').first()
    answers = {str(answer.question_id): answer.answer for answer in response.answers.all()} if response else {}
    return {
        'id': form.id, 'title': form.title, 'description': form.description,
        'instructions': form.instructions,
        'allowSaveContinue': form.allow_save_continue,
        'allowEditAfterSubmission': form.allow_edit_after_submission,
        'sections': [_section_dict(section) for section in form.sections.all()],
        'response': {
            'id': response.id if response else None,
            'status': response.status if response else 'not_started',
            'answers': answers,
            'submittedAt': _iso(response.submitted_at) if response else None,
        },
    }


def public_event_access(request):
    payload = json_body(request) or {} if request.method == 'POST' else {}
    if request.method == 'GET' or (request.method == 'POST' and payload.get('action') == 'read'):
        token = request.GET.get('token', '') if request.method == 'GET' else payload.get('token', '')
        recipient = recipient_for_token(token)
        if recipient is None:
            return json_error('This feedback link is invalid or has expired.', status=404)
        campaigns = FeedbackEventCampaign.objects.select_related('form').prefetch_related(
            'form__sections__questions',
        ).filter(
            event=recipient.event, status='open', form__status='published', form__form_type='post_event',
        ).order_by('form__title', 'form_id')
        response = JsonResponse({
            'event': {
                'id': recipient.event_id, 'title': recipient.event.title,
                'date': recipient.event.date, 'location': recipient.event.location,
            },
            'recipient': {'name': recipient.attendee_name},
            'forms': [_public_form_dict(item.form, recipient) for item in campaigns],
            'expiresAt': _iso(recipient.token_expires_at),
        })
        response['Cache-Control'] = 'private, no-store'
        return response
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    recipient = recipient_for_token(payload.get('token', ''))
    if recipient is None:
        return json_error('This feedback link is invalid or has expired.', status=404)
    try:
        form_id = int(payload.get('formId'))
    except (TypeError, ValueError):
        return json_error('Choose a feedback form.')
    campaign = FeedbackEventCampaign.objects.select_related('form').filter(
        event=recipient.event, form_id=form_id, status='open',
        form__status='published', form__form_type='post_event',
    ).first()
    if campaign is None:
        return json_error('Feedback form not found.', status=404)
    form = campaign.form
    answers = payload.get('answers')
    submit = bool(payload.get('submit'))
    if not isinstance(answers, dict):
        return json_error('Answers must be an object keyed by question ID.')
    if not submit and not form.allow_save_continue:
        return json_error('This form does not allow saving before submission.', status=409)
    questions = {str(item.id): item for item in FeedbackQuestion.objects.filter(section__form=form)}
    if any(str(question_id) not in questions for question_id in answers):
        return json_error('One or more question IDs do not belong to this form.')
    for question_id, value in answers.items():
        if questions[str(question_id)].question_type == 'photo_upload':
            return json_error('Photo questions are not available on guest event feedback yet.')
        if not _valid_answer(questions[str(question_id)], value):
            return json_error(f'Invalid answer for question {question_id}.')
    existing = FeedbackResponse.objects.filter(form=form, event_recipient=recipient).prefetch_related('answers').first()
    if existing and existing.status == 'completed' and not form.allow_edit_after_submission:
        return json_error('This response has already been submitted.', status=409)
    effective = {str(item.question_id): item.answer for item in existing.answers.all()} if existing else {}
    effective.update(answers)
    if submit:
        missing = [item.id for item in questions.values() if item.required and _answer_empty(item, effective.get(str(item.id)))]
        if missing:
            return json_error('Complete all required questions before submitting.', fields=missing)
    with transaction.atomic():
        response, _ = FeedbackResponse.objects.select_for_update().get_or_create(
            form=form, event_recipient=recipient,
            defaults={
                'learner_id': recipient.learner_id, 'learner_name': recipient.attendee_name,
                'programme': '',
            },
        )
        if response.status == 'completed' and not form.allow_edit_after_submission:
            return json_error('This response has already been submitted.', status=409)
        for question_id, value in answers.items():
            FeedbackAnswer.objects.update_or_create(
                response=response, question_id=int(question_id), defaults={'answer': value},
            )
        if submit:
            response.status = 'completed'
            response.submitted_at = timezone.now()
            response.save(update_fields=['status', 'submitted_at', 'updated_at'])
        else:
            response.save(update_fields=['updated_at'])
    return JsonResponse({'response': {
        'id': response.id, 'status': response.status,
        'submittedAt': _iso(response.submitted_at), 'updatedAt': _iso(response.updated_at),
    }})
