"""Progress-review feedback owned by an authenticated employer, never a learner.

Pending assignments are durable and retain their original template. Resolving
them never creates an account, sends mail, or changes the learner's employer.
"""
from django.db import connections
from django.db.models import Q
from django.db.models.functions import Lower, Trim
from django.http import JsonResponse
from django.utils import timezone

from learner_api.models import Employer, EnrolmentUser
from login.models import LoginAccount
from login.sessions import authenticate_request

from .helpers import json_error
from .models import FeedbackEmployerReviewDelivery, FeedbackResponse
from .review_feedback import EMPLOYER_REVIEW_FORM_TYPE


def employer_contact(learner):
    # Employer_email is deliberately not mapped onto every enrolment/login
    # query. Read only this contact column when feedback needs it.
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT "Employer_email" FROM enrolment."Created_users" WHERE id = %s', [learner.pk])
        row = cursor.fetchone()
    return (str(row[0] or '').strip().lower() if row else '')


def learners_with_employer_email(email):
    """Discover imported completions even before an explicit Employer_id exists."""
    if not email:
        return []
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT id FROM enrolment."Created_users"
            WHERE "Employer_id" IS NULL AND lower(btrim(coalesce("Employer_email", ''))) = %s''',
            [email.strip().lower()])
        return [row[0] for row in cursor.fetchall()]


def resolve_pending_delivery(delivery, learner):
    if delivery.employer_id is not None:
        return  # Historical recipient is pinned, including after employment changes.
    email = employer_contact(learner)
    employer_id = getattr(learner, 'employer_id', None)
    employer = None
    reason = 'missing_employer_link'
    if employer_id is not None:
        employer = Employer.objects.filter(pk=employer_id).first()
        reason = 'invalid_employer_link'
    elif email:
        matches = list(Employer.objects.annotate(contact_email=Lower(Trim('email'))).filter(contact_email=email)[:2])
        employer = matches[0] if len(matches) == 1 else None
        reason = 'ambiguous_employer_email' if len(matches) > 1 else 'missing_employer_profile'
    if employer is not None:
        valid_account = LoginAccount.objects.filter(
            subject_type='employer', role='employer', subject_id=employer.pk, is_active=True,
        ).exists()
        reason = '' if valid_account else 'missing_employer_account'
        if valid_account:
            # A conditional update makes concurrent retries resolve once. A
            # later resolver cannot replace a recipient that already won.
            updated = FeedbackEmployerReviewDelivery.objects.filter(pk=delivery.pk, employer_id__isnull=True).update(
                employer_id=employer.pk, employer_name=employer.full_name[:255],
                employer_email=(employer.email or '').strip().lower(), pending_reason='',
            )
            if updated:
                delivery.employer_id = employer.pk
                delivery.employer_name = employer.full_name[:255]
                delivery.employer_email = (employer.email or '').strip().lower()
                delivery.pending_reason = ''
            else:
                delivery.refresh_from_db()
            return
    delivery.employer_name = (getattr(learner, 'employer', '') or '')[:255]
    delivery.employer_email = email
    delivery.pending_reason = reason
    FeedbackEmployerReviewDelivery.objects.filter(pk=delivery.pk, employer_id__isnull=True).update(
        employer_name=delivery.employer_name, employer_email=email, pending_reason=reason,
    )


def reconcile_employer(employer_id):
    """Retry this employer's persisted work, including imports and pending links."""
    from .review_feedback import sync_review_feedback
    employer = Employer.objects.filter(pk=employer_id).first()
    if employer is None:
        return
    email = (employer.email or '').strip()
    learners = list(EnrolmentUser.all_learners.filter(
        Q(employer_id=employer_id) | Q(pk__in=learners_with_employer_email(email)),
    ))
    for learner in learners:
        sync_review_feedback(learner.pk)
    pending_scope = Q(learner_id__in=[str(learner.pk) for learner in learners])
    if email:
        pending_scope |= Q(employer_email__iexact=email)
    for delivery in FeedbackEmployerReviewDelivery.objects.filter(pending_scope, employer_id__isnull=True):
        learner = EnrolmentUser.all_learners.filter(pk=delivery.learner_id).first()
        if learner is not None:
            resolve_pending_delivery(delivery, learner)


def employer_scope(request, employer_id, *, write=False):
    account = authenticate_request(request)
    if account is None:
        return None, json_error('Authentication required.', status=401)
    if account.role in {'admin', 'staff'} and not write:
        return account, None
    if account.role != 'employer' or account.subject_type != 'employer':
        return None, json_error('Only the assigned employer can submit a response.', status=403)
    if account.subject_id != employer_id:
        return None, json_error('Feedback not found.', status=404)
    return account, None


def delivery_context(employer_id, delivery_id):
    now = timezone.now()
    return FeedbackEmployerReviewDelivery.objects.select_related('form').filter(
        pk=delivery_id, employer_id=employer_id, pending_reason='',
        form__form_type=EMPLOYER_REVIEW_FORM_TYPE, form__status='published',
    ).filter(Q(form__start_date__isnull=True) | Q(form__start_date__lte=now)).first()


def forms(request, employer_id):
    _, error = employer_scope(request, employer_id)
    if error is not None:
        return error
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    reconcile_employer(employer_id)
    now = timezone.now()
    deliveries = list(FeedbackEmployerReviewDelivery.objects.select_related('form').filter(
        employer_id=employer_id, pending_reason='', form__status='published',
        form__form_type=EMPLOYER_REVIEW_FORM_TYPE,
    ).filter(Q(form__start_date__isnull=True) | Q(form__start_date__lte=now)).order_by('-assigned_at', '-id'))
    responses = {r.employer_review_delivery_id: r for r in FeedbackResponse.objects.filter(
        employer_review_delivery_id__in=[d.id for d in deliveries],
    )}
    return JsonResponse({'forms': [{
        'id': d.id, 'title': d.form.title, 'learnerName': d.learner_name,
        'reviewName': d.review_name or d.review_type, 'completedAt': d.completed_at.isoformat(),
        'assignedAt': d.assigned_at.isoformat(),
        'status': responses[d.id].status if d.id in responses else 'not_started',
    } for d in deliveries]})


def form_detail(request, employer_id, delivery_id):
    from . import feedback
    _, error = employer_scope(request, employer_id)
    if error is not None:
        return error
    if request.method != 'GET':
        return json_error('Method not allowed.', status=405)
    delivery = delivery_context(employer_id, delivery_id)
    if delivery is None:
        return json_error('Feedback not found.', status=404)
    response = FeedbackResponse.objects.filter(employer_review_delivery=delivery).prefetch_related('answers').first()
    data = feedback.form_dict(delivery.form, include_structure=True)
    data['reviewDelivery'] = {
        'id': delivery.id, 'reviewType': delivery.review_type,
        'reviewName': delivery.review_name, 'completedAt': delivery.completed_at.isoformat(),
    }
    data['relatedLearnerName'] = delivery.learner_name
    data['response'] = {
        'id': response.id if response else None,
        'status': response.status if response else 'not_started',
        'answers': {str(a.question_id): a.answer for a in response.answers.all()} if response else {},
        'submittedAt': feedback._iso(response.submitted_at) if response else None,
    }
    return JsonResponse({'form': data})


def response_save(request, employer_id, delivery_id):
    from . import feedback
    account, error = employer_scope(request, employer_id, write=True)
    if error is not None:
        return error
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    delivery = delivery_context(employer_id, delivery_id)
    if delivery is None:
        return json_error('Feedback not found.', status=404)
    return feedback.save_owned_response(
        request, learner_id=delivery.learner_id, learner_name=account.display_name or delivery.employer_name,
        form=delivery.form, delivery=None, recipient=delivery, employer_review_delivery_id=delivery.id,
    )


def photo_upload(request, employer_id, delivery_id, question_id):
    from . import feedback
    account, error = employer_scope(request, employer_id, write=True)
    if error is not None:
        return error
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    delivery = delivery_context(employer_id, delivery_id)
    if delivery is None:
        return json_error('Feedback not found.', status=404)
    return feedback.upload_owned_photo(
        request, learner_id=delivery.learner_id, learner_name=account.display_name or delivery.employer_name,
        form=delivery.form, delivery=None, recipient=delivery, question_id=question_id,
        employer_review_delivery_id=delivery.id,
    )
