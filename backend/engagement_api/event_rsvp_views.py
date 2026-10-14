"""Staff campaign and public token endpoints for event RSVP."""
from __future__ import annotations

from io import BytesIO
import logging
from pathlib import PurePath
import uuid

from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContentSettings
from django.conf import settings
from django.db import DatabaseError, transaction
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone

from learner_api import evidence_storage
from learner_api.profile_photo import normalize_photo

from .event_rsvp import configure_campaign, recipient_for_token, reset_failed_recipients, save_rsvp, send_invitations
from .feedback import _answer_empty, _iso, _section_dict, _valid_answer
from .helpers import json_body, json_error
from .models import (
    Event, EventRsvpCampaign, EventRsvpRecipient, FeedbackAnswer, FeedbackQuestion, FeedbackResponse, FeedbackUpload,
)
from .permissions import actor_name, require_staff

logger = logging.getLogger(__name__)
MAX_RSVP_PHOTO_UPLOAD_BYTES = 20 * 1024 * 1024


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
        if not _valid_answer(questions[str(question_id)], value):
            return json_error(f'Invalid answer for question {question_id}.')
    existing = FeedbackResponse.objects.filter(form=form, rsvp_recipient=recipient).prefetch_related('answers').first()
    for question_id, value in answers.items():
        question = questions[str(question_id)]
        if question.question_type == 'photo_upload' and value not in (None, ''):
            if not isinstance(value, dict) or not existing or not FeedbackUpload.objects.filter(
                pk=value.get('uploadId'), response=existing, question=question,
            ).exists():
                return json_error(f'Upload a photo for question {question_id} before submitting.')
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


def public_photo_upload(request):
    """Upload a private photo to the response identified by an active RSVP token."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    recipient = recipient_for_token(request.POST.get('token', ''))
    if recipient is None:
        return json_error('This RSVP link is invalid or has expired.', status=404)
    try:
        question = FeedbackQuestion.objects.get(
            pk=request.POST.get('questionId'), section__form=recipient.campaign.form,
            question_type='photo_upload',
        )
    except (FeedbackQuestion.DoesNotExist, ValueError, TypeError):
        return json_error('Photo question not found.', status=404)
    if not evidence_storage.azure_configured():
        return json_error('Photo storage is not configured.', status=503)
    upload = request.FILES.get('photo')
    if upload is None:
        return json_error('Choose a photo to upload.')
    try:
        content = normalize_photo(upload, max_upload_bytes=MAX_RSVP_PHOTO_UPLOAD_BYTES)
    except ValueError as exc:
        return json_error(str(exc))

    response, _ = FeedbackResponse.objects.get_or_create(
        form=recipient.campaign.form, rsvp_recipient=recipient,
        defaults={
            'learner_id': recipient.learner_id or '',
            'learner_name': recipient.recipient_name,
            'status': 'in_progress',
        },
    )
    container = getattr(settings, 'AZURE_FEEDBACK_UPLOADS_CONTAINER', 'feedback-uploads')
    blob_name = f'responses/{response.id}/questions/{question.id}/{uuid.uuid4()}.jpg'
    old_upload = FeedbackUpload.objects.filter(response=response, question=question).first()
    try:
        with evidence_storage._service_client(retry_total=0) as service:
            try:
                service.get_container_client(container).create_container()
            except ResourceExistsError:
                pass
            service.get_blob_client(container=container, blob=blob_name).upload_blob(
                BytesIO(content), overwrite=False, max_concurrency=1,
                content_settings=ContentSettings(content_type='image/jpeg', cache_control='private, no-store'),
                connection_timeout=10, read_timeout=30,
            )
        with transaction.atomic():
            if old_upload:
                old_blob_name = old_upload.blob_name
                old_upload.blob_name = blob_name
                old_upload.original_name = PurePath(upload.name or 'photo').name[:255]
                old_upload.content_type = 'image/jpeg'
                old_upload.size = len(content)
                old_upload.save(update_fields=['blob_name', 'original_name', 'content_type', 'size'])
                saved_upload = old_upload
            else:
                old_blob_name = None
                saved_upload = FeedbackUpload.objects.create(
                    response=response, question=question, blob_name=blob_name,
                    original_name=PurePath(upload.name or 'photo').name[:255],
                    content_type='image/jpeg', size=len(content),
                )
            answer = {'uploadId': str(saved_upload.id), 'filename': saved_upload.original_name}
            FeedbackAnswer.objects.update_or_create(response=response, question=question, defaults={'answer': answer})
        if old_blob_name:
            try:
                evidence_storage.delete_blob(container, old_blob_name)
            except AzureError:
                logger.warning('Could not remove replaced public RSVP photo %s', old_upload.id)
    except (AzureError, RuntimeError, DatabaseError):
        try:
            evidence_storage.delete_blob(container, blob_name)
        except Exception:  # noqa: BLE001 - cleanup must not hide the safe API response
            pass
        logger.warning('Public RSVP photo storage unavailable for response %s', response.id)
        return json_error('Your photo could not be saved. Please try again.', status=503)
    return JsonResponse({'answer': answer}, status=201)


def public_photo_remove(request):
    """Remove a saved photo only for the respondent holding its active token."""
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    recipient = recipient_for_token(payload.get('token', ''))
    if recipient is None:
        return json_error('This RSVP link is invalid or has expired.', status=404)
    try:
        upload_id = uuid.UUID(str(payload.get('uploadId', '')))
    except (ValueError, TypeError, AttributeError):
        return json_error('Photo not found.', status=404)
    upload = FeedbackUpload.objects.select_related('response', 'question').filter(
        pk=upload_id, response__rsvp_recipient=recipient,
        response__form=recipient.campaign.form,
    ).first()
    if upload is None:
        return json_error('Photo not found.', status=404)
    if not evidence_storage.azure_configured():
        return json_error('Photo storage is not configured.', status=503)
    container = getattr(settings, 'AZURE_FEEDBACK_UPLOADS_CONTAINER', 'feedback-uploads')
    try:
        try:
            evidence_storage.delete_blob(container, upload.blob_name)
        except ResourceNotFoundError:
            pass
        with transaction.atomic():
            FeedbackAnswer.objects.filter(response=upload.response, question=upload.question).update(answer=None)
            upload.delete()
    except (AzureError, DatabaseError, RuntimeError):
        logger.warning('Could not remove RSVP photo %s for response %s', upload.id, upload.response_id)
        return json_error('Your photo could not be removed. Please try again.', status=503)
    return JsonResponse({'removed': True})


def public_photo_content(request, upload_id):
    """Serve a public RSVP photo only while its matching invitation token is valid."""
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    try:
        upload = FeedbackUpload.objects.select_related('response__rsvp_recipient').get(pk=upload_id)
    except FeedbackUpload.DoesNotExist:
        return json_error('Photo not found.', status=404)
    linked_recipient = upload.response.rsvp_recipient
    token_recipient = recipient_for_token(request.headers.get('X-Event-Response-Token', ''))
    if linked_recipient is None or token_recipient is None or token_recipient.pk != linked_recipient.pk:
        return json_error('Photo not found.', status=404)
    if not evidence_storage.azure_configured():
        return json_error('Photo storage is not configured.', status=503)
    container = getattr(settings, 'AZURE_FEEDBACK_UPLOADS_CONTAINER', 'feedback-uploads')
    try:
        content = evidence_storage.download_blob_bytes(container, upload.blob_name, max_bytes=1024 * 1024)
    except (AzureError, ValueError):
        return json_error('Photo could not be loaded.', status=503)
    response = HttpResponse(content, content_type='image/jpeg')
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
