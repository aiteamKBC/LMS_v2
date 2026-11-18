"""Batch the existing form summary rules without changing their scope."""
from collections import defaultdict

from django.db.models import Count, Q

from learner_api.models import EnrolmentUser
from .models import (
    FeedbackAssignment, FeedbackDelivery, FeedbackDeliveryRecipient,
    FeedbackEmployerReviewDelivery, FeedbackEventRecipient, FeedbackForm,
    FeedbackResponse, FeedbackReviewDelivery,
)


def form_report_counts(forms, *, versioned_types, employer_type):
    if not forms:
        return {}
    identifiers = {form.id for form in forms}
    templates = {form.template_key for form in forms if form.form_type in versioned_types}
    families = defaultdict(set)
    if templates:
        for identifier, template in FeedbackForm.objects.filter(template_key__in=templates).values_list('id', 'template_key'):
            families[template].add(identifier)
    scope = identifiers | {identifier for members in families.values() for identifier in members}
    assignments = defaultdict(list)
    for form_id, kind, target in FeedbackAssignment.objects.filter(form_id__in=scope).values_list('form_id', 'target_type', 'target_id'):
        assignments[form_id].append((kind, target))
    all_learners = (EnrolmentUser.all_learners.count()
                    if any(kind == 'all_learners' for rows in assignments.values() for kind, _ in rows) else 0)

    def counts(model, **filters):
        return dict(model.objects.filter(form_id__in=scope, **filters).order_by().values('form_id')
                    .annotate(total=Count('id')).values_list('form_id', 'total'))

    recipients = dict(FeedbackDeliveryRecipient.objects.filter(delivery__form_id__in=scope, revoked_at__isnull=True)
                      .order_by().values('delivery__form_id').annotate(total=Count('id'))
                      .values_list('delivery__form_id', 'total'))
    reviews = counts(FeedbackReviewDelivery)
    employer_reviews = counts(FeedbackEmployerReviewDelivery)
    deliveries = set(FeedbackDelivery.objects.filter(form_id__in=identifiers).order_by().values_list('form_id', flat=True).distinct())
    responses = {row['form_id']: row for row in FeedbackResponse.objects.filter(form_id__in=scope).order_by()
                 .values('form_id').annotate(started=Count('id'), completed=Count('id', filter=Q(status='completed')))}
    event_ids = {form.id for form in forms if form.form_type == 'post_event'}
    events = (dict(FeedbackEventRecipient.objects.filter(
        event__feedback_campaigns__form_id__in=event_ids, event__feedback_campaigns__status='open', revoked_at__isnull=True,
    ).order_by().values('event__feedback_campaigns__form_id').annotate(total=Count('id', distinct=True))
                   .values_list('event__feedback_campaigns__form_id', 'total')) if event_ids else {})
    result = {}
    for form in forms:
        members = families[form.template_key] if form.form_type in versioned_types else {form.id}
        manual = [item for identifier in members for item in assignments[identifier]]
        manual_count = all_learners if any(kind == 'all_learners' for kind, _ in manual) else len({target for kind, target in manual if kind == 'learner'})
        review_counts = employer_reviews if form.form_type == employer_type else reviews
        assigned = (events.get(form.id, 0) if form.form_type == 'post_event' else
                    manual_count + sum(recipients.get(identifier, 0) + review_counts.get(identifier, 0) for identifier in members))
        result[form.id] = {
            'assigned': assigned,
            'started': sum(responses.get(identifier, {}).get('started', 0) for identifier in members),
            'completed': sum(responses.get(identifier, {}).get('completed', 0) for identifier in members),
            # History is version-owned even when displayed counts cover a family.
            'history': bool(responses.get(form.id, {}).get('started') or form.id in deliveries or reviews.get(form.id)
                            or (form.form_type == employer_type and employer_reviews.get(form.id))),
        }
    return result
