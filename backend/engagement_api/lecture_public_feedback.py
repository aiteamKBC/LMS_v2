"""One stable Live Sessions QR, with email-matched module membership.

This is intentionally a narrow, email-only public flow. An email is not proof
of identity. The newest available lecture is selected after identity lookup.
"""
from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from azure.core.exceptions import AzureError, ResourceNotFoundError
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError, connection, transaction
from django.db.models import Q
from django.db.models.functions import Lower, Trim
from django.http import HttpResponse, JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from learner_api import evidence_storage
from learner_api.models import EnrolmentUser, LearnerProfile
from curriculum_api.models import LiveSession, LiveSessionOccurrence, ModuleAuthoringModule
from .feedback import (
    _iso, _section_dict, _selected_delivery_question_ids, save_owned_response,
    upload_owned_photo,
)
from .feedback_delivery import (
    QR_SCHEDULE_SOURCE, _form_for_occurrence, _pin_delivery_questions,
    ensure_delivery_questions, lecture_after_form_creation,
)
from .feedback_delivery_guard import tag_transaction
from .helpers import json_body, json_error
from .module_feedback import assigned_active_module_ids
from .models import FeedbackAnswer, FeedbackDelivery, FeedbackDeliveryRecipient, FeedbackResponse, FeedbackUpload

logger = logging.getLogger(__name__)
QR_CLAIM_ERROR = 'Invalid email for this lecture.'
EARLY_WINDOW = timedelta(minutes=60)
INACTIVE_SESSION_STATES = {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}


def _eligible_modules(learner):
    """Use exact assigned module IDs; a learner can be taught by another group."""
    assigned = assigned_active_module_ids(learner.pk)
    if not assigned:
        return {}
    modules = ModuleAuthoringModule.objects.filter(
        module_catalogue_id__in=assigned, deleted_at__isnull=True,
        is_programme_deleted=False,
    )
    # The module catalogue ID already identifies its delivery group. An
    # explicit learning-plan assignment may point to a module outside the
    # learner's home group; the delivery must still match the module's group.
    return {row.module_catalogue_id: row for row in modules if row.group_id}


def _window_open(occurrence, now):
    """Never open before the scheduled start, even for a short lecture."""
    start, end = occurrence.scheduled_start, occurrence.scheduled_end
    return (start < end and max(start, end - EARLY_WINDOW) <= now < end
            and occurrence.actual_end is None
            and str(occurrence.status or '').casefold() not in INACTIVE_SESSION_STATES)


def _current_lecture(modules, now):
    """Find the learner's latest ongoing scheduled session in their group."""
    if not modules:
        return None
    series = {row.pk: row for row in LiveSession.objects.filter(
        module_catalogue_id__in=modules,
    ) if str(row.status or '').casefold() not in INACTIVE_SESSION_STATES}
    if not series:
        return None
    candidates = LiveSessionOccurrence.objects.filter(
        live_session_id__in=series, scheduled_start__lte=now,
        scheduled_end__gt=now, actual_end__isnull=True,
    ).order_by('-scheduled_start', '-id')
    for occurrence in candidates:
        parent = series[occurrence.live_session_id]
        if (occurrence.scheduled_start < occurrence.scheduled_end
                and str(occurrence.status or '').casefold() not in INACTIVE_SESSION_STATES
                and str(occurrence.status or '').casefold() not in {'completed', 'ended'}):
            return occurrence, parent, modules[parent.module_catalogue_id]
    return None


def _provisional_delivery_open(delivery, now):
    """A rescheduled or cancelled session cannot keep its old QR window."""
    occurrence = LiveSessionOccurrence.objects.filter(pk=delivery.occurrence_key).first()
    if occurrence is None:
        return False
    parent = LiveSession.objects.filter(pk=occurrence.live_session_id).first()
    if (parent is None or parent.module_catalogue_id != delivery.module_catalogue_id
            or str(parent.status or '').casefold() in INACTIVE_SESSION_STATES
            or str(occurrence.status or '').casefold() in INACTIVE_SESSION_STATES):
        return False
    if occurrence.actual_end is not None:
        return now >= occurrence.actual_end
    if str(occurrence.status or '').casefold() in {'completed', 'ended'}:
        return False
    return now >= occurrence.scheduled_end or _window_open(occurrence, now)


def _qr_delivery_open(delivery, now):
    if delivery.attendance_source == QR_SCHEDULE_SOURCE:
        return _provisional_delivery_open(delivery, now)
    if delivery.available_at <= now:
        return True
    # An already-created attendance delivery may still be in the QR window.
    return _provisional_delivery_open(delivery, now)


def _ensure_current_delivery(occurrence, module, now):
    """Pin one form version and one random question set per occurrence."""
    with transaction.atomic():
        existing = FeedbackDelivery.objects.select_for_update().select_related('form').filter(
            occurrence_key=occurrence.pk,
        ).first()
        form = existing.form if existing else _form_for_occurrence(
            occurrence.pk, module.module_catalogue_id, occurrence.scheduled_start,
        )
        if (form is None or form.form_type != 'post_lecture' or form.status != 'published'
                or (form.start_date and form.start_date > now)
                or not lecture_after_form_creation(form, occurrence.scheduled_start)):
            return None
        if existing:
            if (existing.status != 'open' or existing.module_catalogue_id != module.module_catalogue_id
                    or (existing.group_id and existing.group_id != module.group_id)):
                return None
            ensure_delivery_questions(existing)
            return existing
        tag_transaction(connection)
        delivery, created = FeedbackDelivery.objects.get_or_create(
            occurrence_key=occurrence.pk,
            defaults={
                'form': form, 'attendance_source': QR_SCHEDULE_SOURCE,
                'programme_id': module.programme_id, 'programme_name': module.programme_name,
                'cohort_id': module.cohort_id, 'cohort_name': module.cohort_name,
                'group_id': module.group_id, 'group_name': module.group_name,
                'module_catalogue_id': module.module_catalogue_id,
                'module_name': module.title,
                'session_title': f'{module.title} - Session {occurrence.session_number}',
                'tutor_name': module.tutor_name or '',
                'starts_at': occurrence.scheduled_start, 'ends_at': occurrence.scheduled_end,
                'available_at': occurrence.scheduled_end, 'status': 'open',
            },
        )
        if created:
            _pin_delivery_questions(delivery, form)
        else:
            if (delivery.status != 'open' or delivery.module_catalogue_id != module.module_catalogue_id
                    or (delivery.group_id and delivery.group_id != module.group_id)):
                return None
            pinned_form = delivery.form
            if (pinned_form.form_type != 'post_lecture' or pinned_form.status != 'published'
                    or (pinned_form.start_date and pinned_form.start_date > now)
                    or not lecture_after_form_creation(pinned_form, occurrence.scheduled_start)):
                return None
            ensure_delivery_questions(delivery)
        return delivery


def lecture_token(delivery):
    message = f'{delivery.pk}:{delivery.form_id}:{delivery.occurrence_key}'
    digest = salted_hmac('engagement.public_lecture_feedback.v1', message, algorithm='sha256').hexdigest()
    return f'{delivery.pk}.{digest}'


def _delivery_for_token(token):
    token = str(token or '')
    try:
        delivery_id, digest = token.split('.', 1)
        if not delivery_id.isdecimal() or len(delivery_id) > 19 or len(digest) != 64:
            return None
        delivery = FeedbackDelivery.objects.select_related('form').filter(pk=int(delivery_id)).first()
    except (ValueError, TypeError):
        return None
    if delivery is None or not constant_time_compare(lecture_token(delivery), token):
        return None
    form = delivery.form
    now = timezone.now()
    if (delivery.status != 'open' or form.form_type != 'post_lecture' or form.status != 'published'
            or not _qr_delivery_open(delivery, now) or (form.start_date and form.start_date > now)
            or not lecture_after_form_creation(form, delivery.starts_at)):
        return None
    return delivery


def _learner_for_email(address):
    email = str(address or '').strip().casefold()
    try:
        validate_email(email)
    except ValidationError:
        return None
    # Aptem and LMS can have different addresses for the same canonical learner.
    # Never guess if an address belongs to more than one enrolment identity.
    direct_ids = EnrolmentUser.all_learners.annotate(key=Lower(Trim('email'))).filter(
        key=email,
    ).values_list('id', flat=True)[:2]
    profile_ids = LearnerProfile.objects.annotate(key=Lower(Trim('email'))).filter(
        key=email, enrolment_id__isnull=False,
    ).values_list('enrolment_id', flat=True)[:2]
    learner_ids = {int(identifier) for identifier in [*direct_ids, *profile_ids]}
    if len(learner_ids) != 1:
        return None
    return EnrolmentUser.all_learners.filter(pk=learner_ids.pop()).first()


def _latest_available_delivery(modules):
    """Only a published, opened lecture in the learner's current plan qualifies."""
    if not modules:
        return None
    now = timezone.now()
    deliveries = FeedbackDelivery.objects.select_related('form').filter(
        module_catalogue_id__in=modules, status='open',
        form__form_type='post_lecture', form__status='published',
        starts_at__isnull=False,
    ).filter(
        Q(available_at__lte=now) | Q(attendance_source=QR_SCHEDULE_SOURCE),
    ).order_by('-starts_at', '-id')
    for delivery in deliveries:
        if ((not delivery.group_id or delivery.group_id == modules[delivery.module_catalogue_id].group_id)
                and (not delivery.form.start_date or delivery.form.start_date <= now)
                and lecture_after_form_creation(delivery.form, delivery.starts_at)
                and _qr_delivery_open(delivery, now)):
            return delivery
    return None


def _recipient(delivery, learner):
    return FeedbackDeliveryRecipient.objects.filter(
        delivery=delivery, learner_id=str(learner.pk), revoked_at__isnull=True,
    ).first()


def _claim_recipient(delivery, learner):
    with transaction.atomic():
        recipient, _ = FeedbackDeliveryRecipient.objects.select_for_update().get_or_create(
            delivery=delivery, learner_id=str(learner.pk),
            defaults={
                'learner_name': learner.username or learner.email or f'Learner {learner.pk}',
                'programme': learner.programme or '',
                'attendance_reference': '', 'due_date': delivery.form.due_date,
                'public_claimed_at': timezone.now(),
            },
        )
        if recipient.public_claimed_at is None or recipient.revoked_at is not None:
            recipient.public_claimed_at = recipient.public_claimed_at or timezone.now()
            recipient.revoked_at = None
            recipient.save(update_fields=['public_claimed_at', 'revoked_at'])
    return recipient


def public_csrf(request):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    response = JsonResponse({'csrfToken': get_token(request)})
    response['Cache-Control'] = 'no-store'
    return response


def _access(token, email):
    delivery = _delivery_for_token(token)
    if delivery is None:
        return None, None, json_error('This lecture feedback link is unavailable.', status=404)
    learner = _learner_for_email(email)
    if learner is None:
        return None, None, json_error(QR_CLAIM_ERROR, status=404)
    modules = _eligible_modules(learner)
    module = modules.get(delivery.module_catalogue_id)
    if module is None or (delivery.group_id and delivery.group_id != module.group_id):
        return None, None, json_error(QR_CLAIM_ERROR, status=404)
    return delivery, learner, None


def public_lecture_access(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    if payload.get('action') == 'discover':
        learner = _learner_for_email(payload.get('email'))
        if learner is None:
            return json_error('Invalid email.', status=404)
        modules = _eligible_modules(learner)
        current = _current_lecture(modules, timezone.now())
        if current:
            occurrence, _, module = current
            now = timezone.now()
            if not _window_open(occurrence, now):
                return json_error('Feedback for the current lecture opens in its final 60 minutes.', status=409)
            delivery = _ensure_current_delivery(occurrence, module, now)
            if delivery is None:
                return json_error('No published Live Sessions Feedback is available for this lecture.', status=404)
        else:
            delivery = _latest_available_delivery(modules)
        if delivery is None:
            return json_error('No Live Sessions Feedback is available for this email yet.', status=404)
        response = JsonResponse({'token': lecture_token(delivery)})
        response['Cache-Control'] = 'private, no-store'
        return response
    delivery, learner, error = _access(payload.get('token'), payload.get('email'))
    if error:
        return error
    form = delivery.form
    if payload.get('action') == 'read':
        recipient = _recipient(delivery, learner)
        ensure_delivery_questions(delivery)
        response = FeedbackResponse.objects.filter(
            delivery=delivery, learner_id=str(learner.pk),
        ).prefetch_related('answers').first()
        selected_ids = _selected_delivery_question_ids(delivery, recipient, response)
        sections = [_section_dict(section) for section in form.sections.prefetch_related('questions').all()]
        if selected_ids is not None:
            for section in sections:
                section['questions'] = [question for question in section['questions'] if question['id'] in selected_ids]
        data = JsonResponse({
            'lecture': {'title': delivery.session_title, 'moduleName': delivery.module_name,
                        'startsAt': _iso(delivery.starts_at)},
            'learner': {'name': learner.username or learner.email or ''},
            'form': {'id': form.id, 'title': form.title, 'description': form.description,
                     'instructions': form.instructions,
                     'allowSaveContinue': form.allow_save_continue,
                     'allowEditAfterSubmission': form.allow_edit_after_submission,
                     'sections': sections,
                     'response': {'id': response.id if response else None,
                                  'status': response.status if response else 'not_started',
                                  'answers': {str(answer.question_id): answer.answer for answer in response.answers.all()} if response else {},
                                  'submittedAt': _iso(response.submitted_at) if response else None}},
        })
        data['Cache-Control'] = 'private, no-store'
        return data
    if payload.get('action') != 'save':
        return json_error('Unsupported action.')
    recipient = _claim_recipient(delivery, learner)
    return save_owned_response(
        request, learner_id=str(learner.pk), learner_name=learner.username or '',
        form=form, delivery=delivery, recipient=recipient,
    )


def public_photo_upload(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    delivery, learner, error = _access(request.POST.get('token'), request.POST.get('email'))
    if error:
        return error
    try:
        question_id = int(request.POST.get('questionId', ''))
    except (TypeError, ValueError):
        return json_error('Photo question not found.', status=404)
    return upload_owned_photo(
        request, learner_id=str(learner.pk), learner_name=learner.username or '',
        form=delivery.form, delivery=delivery, recipient=_claim_recipient(delivery, learner),
        question_id=question_id,
    )


def _owned_upload(delivery, learner, upload_id):
    return FeedbackUpload.objects.select_related('response', 'question').filter(
        pk=upload_id, response__delivery=delivery, response__learner_id=str(learner.pk),
    ).first()


def public_photo_remove(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request) or {}
    delivery, learner, error = _access(payload.get('token'), payload.get('email'))
    if error:
        return error
    try:
        upload_id = uuid.UUID(str(payload.get('uploadId', '')))
    except (TypeError, ValueError, AttributeError):
        return json_error('Photo not found.', status=404)
    upload = _owned_upload(delivery, learner, upload_id)
    if upload is None:
        return json_error('Photo not found.', status=404)
    if upload.response.status == 'completed' and not delivery.form.allow_edit_after_submission:
        return json_error('This response has already been submitted.', status=409)
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
        logger.warning('Could not remove public lecture feedback photo %s', upload_id)
        return json_error('Your photo could not be removed. Please try again.', status=503)
    return JsonResponse({'removed': True})


def public_photo_content(request, upload_id):
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    delivery, learner, error = _access(
        request.headers.get('X-Lecture-Feedback-Token'),
        request.headers.get('X-Lecture-Feedback-Email'),
    )
    if error:
        return error
    upload = _owned_upload(delivery, learner, upload_id)
    if upload is None:
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
