"""Staff campaign management and token-scoped public feedback endpoints."""
from __future__ import annotations

from django.db import transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_date

from .external_feedback import (
    CAMPAIGN_TYPES, parse_manual_recipients, parse_recipients,
    recipient_for_token, send_invitations,
)
from .feedback import _answer_empty, _iso, _section_dict, _valid_answer
from .helpers import json_body, json_error
from .models import (
    FeedbackAnswer, FeedbackExternalCampaign, FeedbackExternalRecipient,
    FeedbackForm, FeedbackQuestion, FeedbackResponse,
)
from .permissions import actor_name, require_staff


def _preview_dict(preview):
    return {
        'valid': preview['valid'][:200],
        'invalidEmails': preview['invalidEmails'][:200],
        'missingRows': preview['missingRows'][:200],
        'duplicates': preview['duplicates'][:200],
        'counts': {key: len(preview[key]) for key in ('valid', 'invalidEmails', 'missingRows', 'duplicates')},
        'truncated': any(len(preview[key]) > 200 for key in ('valid', 'invalidEmails', 'missingRows', 'duplicates')),
    }


def _campaign_dict(campaign, *, include_recipients=False):
    data = {
        'id': campaign.id, 'campaignType': campaign.campaign_type,
        'name': campaign.name, 'sessionDate': campaign.session_date.isoformat(),
        'status': campaign.status, 'form': {
            'id': campaign.form_id, 'title': campaign.form.title,
            'version': campaign.form.version, 'formType': campaign.form.form_type,
        },
        'createdBy': campaign.created_by, 'createdAt': _iso(campaign.created_at),
        'updatedAt': _iso(campaign.updated_at),
    }
    recipients = campaign.recipients.all()
    data['counts'] = {status: recipients.filter(delivery_status=status).count() for status in ('pending', 'sent', 'opened', 'submitted', 'failed')}
    data['recipientCount'] = recipients.count()
    if include_recipients:
        data['recipients'] = [{
            'id': item.id, 'name': item.recipient_name, 'email': item.recipient_email,
            'status': item.delivery_status, 'sentAt': _iso(item.invitation_sent_at),
            'openedAt': _iso(item.opened_at), 'submittedAt': _iso(item.submitted_at),
            'error': item.invitation_error,
            'responseId': item.response_id,
        } for item in recipients.order_by('recipient_name', 'id')]
    return data


@require_staff
def campaigns(request):
    if request.method == 'GET':
        queryset = FeedbackExternalCampaign.objects.select_related('form').prefetch_related('recipients')
        campaign_type = request.GET.get('type', '')
        if campaign_type:
            if campaign_type not in CAMPAIGN_TYPES:
                return json_error('Unsupported campaign type.')
            queryset = queryset.filter(campaign_type=campaign_type)
        return JsonResponse({'campaigns': [_campaign_dict(item) for item in queryset.order_by('-session_date', '-id')]})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    try:
        campaign_type = str(request.POST.get('campaignType') or '').strip()
        if campaign_type not in CAMPAIGN_TYPES:
            raise ValueError('Choose Information Session or Commitment Meeting.')
        name = str(request.POST.get('name') or '').strip()
        if not name or len(name) > 255:
            raise ValueError('Session or meeting name is required and must be 255 characters or fewer.')
        session_date = parse_date(str(request.POST.get('sessionDate') or ''))
        if session_date is None:
            raise ValueError('Choose a valid session or meeting date.')
        form = FeedbackForm.objects.filter(
            pk=request.POST.get('formId'), form_type=campaign_type,
            status='published', is_current=True,
        ).first()
        if form is None:
            raise ValueError('Choose a current published form matching the campaign type.')
        manual_text = str(request.POST.get('manualRecipients') or '')
        upload = request.FILES.get('file')
        if manual_text.strip() and upload is not None:
            raise ValueError('Use either manual recipients or a spreadsheet, not both.')
        manual_send = bool(manual_text.strip())
        preview = parse_manual_recipients(manual_text) if manual_send else parse_recipients(upload)
        if manual_send and any(preview[key] for key in ('invalidEmails', 'missingRows', 'duplicates')):
            problems = []
            if preview['invalidEmails']:
                problems.append(f"invalid email on row(s) {', '.join(str(item['row']) for item in preview['invalidEmails'])}")
            if preview['missingRows']:
                problems.append(f"missing value on row(s) {', '.join(str(item['row']) for item in preview['missingRows'])}")
            if preview['duplicates']:
                problems.append(f"duplicate email on row(s) {', '.join(str(item['row']) for item in preview['duplicates'])}")
            raise ValueError('Fix manual recipients before sending: ' + '; '.join(problems) + '.')
        if not manual_send and request.POST.get('preview', 'true').casefold() != 'false':
            return JsonResponse({'preview': _preview_dict(preview)})
        if not preview['valid']:
            raise ValueError('Add at least one valid recipient before creating the campaign.')
        with transaction.atomic():
            campaign = FeedbackExternalCampaign.objects.create(
                campaign_type=campaign_type, name=name, session_date=session_date,
                form=form, status='draft', created_by=actor_name(request) or 'Staff',
            )
            FeedbackExternalRecipient.objects.bulk_create([
                FeedbackExternalRecipient(
                    campaign=campaign, recipient_name=item['name'],
                    recipient_email=item['email'], delivery_status='pending',
                ) for item in preview['valid']
            ])
    except (TypeError, ValueError) as exc:
        return json_error(str(exc))
    campaign = FeedbackExternalCampaign.objects.select_related('form').prefetch_related('recipients').get(pk=campaign.pk)
    delivery = None
    if manual_send:
        campaign.status = 'open'
        campaign.save(update_fields=['status', 'updated_at'])
        results = send_invitations(list(campaign.recipients.select_related('campaign').order_by('id')))
        delivery = {
            'attempted': len(results), 'sent': sum(item['sent'] for item in results),
            'failed': sum(not item['sent'] for item in results), 'remaining': sum(not item['sent'] for item in results),
        }
        campaign = FeedbackExternalCampaign.objects.select_related('form').prefetch_related('recipients').get(pk=campaign.pk)
    return JsonResponse({
        'campaign': _campaign_dict(campaign, include_recipients=True),
        'preview': _preview_dict(preview), 'delivery': delivery,
    }, status=201)


@require_staff
def campaign_detail(request, campaign_id):
    campaign = FeedbackExternalCampaign.objects.select_related('form').prefetch_related('recipients').filter(pk=campaign_id).first()
    if campaign is None:
        return json_error('Feedback campaign not found.', status=404)
    if request.method == 'GET':
        return JsonResponse({'campaign': _campaign_dict(campaign, include_recipients=True)})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    if payload.get('action') != 'send':
        return json_error('Unsupported campaign action.')
    requested_ids = payload.get('recipientIds')
    recipients = campaign.recipients.filter(delivery_status__in=['pending', 'failed']).select_related('campaign').order_by('id')
    if requested_ids is not None:
        if not isinstance(requested_ids, list) or any(not isinstance(value, int) for value in requested_ids):
            return json_error('recipientIds must be a list of recipient IDs.')
        recipients = recipients.filter(id__in=requested_ids)
    recipients = list(recipients[:100])
    if recipients and campaign.status == 'draft':
        campaign.status = 'open'
        campaign.save(update_fields=['status', 'updated_at'])
    results = send_invitations(recipients)
    remaining = campaign.recipients.filter(delivery_status__in=['pending', 'failed']).count()
    return JsonResponse({
        'attempted': len(results), 'sent': sum(item['sent'] for item in results),
        'failed': sum(not item['sent'] for item in results), 'remaining': remaining,
    })


def public_csrf(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    response = JsonResponse({'csrfToken': get_token(request)})
    response['Cache-Control'] = 'no-store'
    return response


def _public_payload(recipient, response=None):
    form = recipient.campaign.form
    answers = {str(item.question_id): item.answer for item in response.answers.all()} if response else {}
    return {
        'campaign': {
            'id': recipient.campaign_id, 'campaignType': recipient.campaign.campaign_type,
            'name': recipient.campaign.name, 'sessionDate': recipient.campaign.session_date.isoformat(),
        },
        'recipient': {'name': recipient.recipient_name},
        'form': {
            'id': form.id, 'title': form.title, 'description': form.description,
            'instructions': form.instructions,
            'sections': [_section_dict(section) for section in form.sections.all()],
            'response': {
                'id': response.id if response else None,
                'status': response.status if response else 'not_started',
                'answers': answers, 'submittedAt': _iso(response.submitted_at) if response else None,
            },
        },
        'expiresAt': _iso(recipient.token_expires_at),
    }


def public_access(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    if payload.get('action') == 'read':
        recipient = recipient_for_token(payload.get('token', ''))
        if recipient is None:
            return json_error('This feedback link is invalid or has expired.', status=404)
        if recipient.delivery_status in {'sent', 'failed'}:
            recipient.delivery_status = 'opened'
            recipient.opened_at = timezone.now()
            recipient.save(update_fields=['delivery_status', 'opened_at', 'updated_at'])
        response = (
            FeedbackResponse.objects.filter(pk=recipient.response_id).prefetch_related('answers').first()
            if recipient.response_id else None
        )
        result = JsonResponse(_public_payload(recipient, response))
        result['Cache-Control'] = 'private, no-store'
        return result
    answers = payload.get('answers')
    if not isinstance(answers, dict):
        return json_error('Answers must be an object keyed by question ID.')
    with transaction.atomic():
        recipient = recipient_for_token(payload.get('token', ''), lock=True)
        if recipient is None:
            return json_error('This feedback link is invalid or has expired.', status=404)
        if recipient.delivery_status == 'submitted' or recipient.response_id:
            return json_error('This feedback has already been submitted.', status=409)
        form = recipient.campaign.form
        questions = {str(item.id): item for item in FeedbackQuestion.objects.filter(section__form=form)}
        if any(str(question_id) not in questions for question_id in answers):
            return json_error('One or more question IDs do not belong to this form.')
        for question_id, value in answers.items():
            if questions[str(question_id)].question_type == 'photo_upload':
                return json_error('Photo questions are not available for public session feedback.')
            if not _valid_answer(questions[str(question_id)], value):
                return json_error(f'Invalid answer for question {question_id}.')
        missing = [item.id for item in questions.values() if item.required and _answer_empty(item, answers.get(str(item.id)))]
        if missing:
            return json_error('Complete all required questions before submitting.', fields=missing)
        response = FeedbackResponse.objects.create(
            form=form, learner_id=f'external:{recipient.id}',
            learner_name=recipient.recipient_name, programme='',
        )
        for question_id, value in answers.items():
            FeedbackAnswer.objects.update_or_create(
                response=response, question_id=int(question_id), defaults={'answer': value},
            )
        now = timezone.now()
        response.status = 'completed'
        response.submitted_at = now
        response.save(update_fields=['status', 'submitted_at', 'updated_at'])
        recipient.response = response
        recipient.delivery_status = 'submitted'
        recipient.submitted_at = now
        recipient.save(update_fields=['response', 'delivery_status', 'submitted_at', 'updated_at'])
    return JsonResponse({'response': {'id': response.id, 'status': response.status, 'submittedAt': _iso(response.submitted_at)}})
