"""Read-only reporting over existing assignments and pinned question sets.

Do not call attendance/module sync, ensure_delivery_questions or any write helper
here. Analytics must never initialize a draw or move a learner's availability.
"""
from collections import defaultdict

from django.db.models import Prefetch, Q

from learner_api.models import EnrolmentUser
from .models import (
    EventRsvpRecipient, FeedbackAnswer, FeedbackAssignment, FeedbackDelivery,
    FeedbackDeliveryQuestion, FeedbackDeliveryRecipient, FeedbackEventCampaign,
    FeedbackEventRecipient, FeedbackForm, FeedbackQuestion, FeedbackResponse, FeedbackReviewDelivery,
)
from .feedback_scoring import overall_metrics, question_metrics, response_key
from .feedback_insights import answer_in_period, report_insights
from .feedback_classification import response_classifications


def completed_report_responses(family_ids=None, *, delivery_ids=None, submitted_from=None, submitted_until=None, group_id=None, module_id=None):
    query = FeedbackResponse.objects.filter(status='completed')
    if family_ids is not None:
        query = query.filter(form_id__in=family_ids)
    if delivery_ids is not None:
        query = query.filter(delivery_id__in=delivery_ids)
    if group_id:
        query = query.filter(Q(delivery__group_id=group_id) | Q(delivery_id__isnull=True, form__group_id=group_id))
    if module_id:
        query = query.filter(Q(delivery__module_catalogue_id=module_id)
                             | Q(delivery_id__isnull=True, form__module_catalogue_id=module_id))
    if submitted_from is not None:
        query = query.filter(submitted_at__gte=submitted_from)
    if submitted_until is not None:
        query = query.filter(submitted_at__lt=submitted_until)
    return list(query.select_related('form', 'delivery'))


def dashboard_groups(family_ids=None):
    """Historical group snapshots, not current learner membership."""
    forms = FeedbackForm.objects.all()
    deliveries = FeedbackDelivery.objects.all()
    if family_ids is not None:
        forms = forms.filter(id__in=family_ids)
        deliveries = deliveries.filter(form_id__in=family_ids)
    groups = {}
    for query in (forms, deliveries):
        for identifier, name in query.exclude(group_id='').values_list('group_id', 'group_name'):
            groups[identifier] = name or groups.get(identifier) or identifier
    return [{'id': identifier, 'name': name} for identifier, name in sorted(groups.items(), key=lambda item: (item[1], item[0]))]


def dashboard_modules(family_ids=None, *, group_id=None):
    """Module snapshots in this type/group, including historical form versions."""
    forms = FeedbackForm.objects.all()
    deliveries = FeedbackDelivery.objects.all()
    if family_ids is not None:
        forms = forms.filter(id__in=family_ids)
        deliveries = deliveries.filter(form_id__in=family_ids)
    if group_id:
        forms = forms.filter(group_id=group_id)
        deliveries = deliveries.filter(group_id=group_id)
    modules = {}
    for query in (forms, deliveries):
        for identifier, name in query.exclude(module_catalogue_id='').order_by('id').values_list('module_catalogue_id', 'module_name'):
            modules[identifier] = name or modules.get(identifier) or identifier
    return [{'id': identifier, 'name': name} for identifier, name in sorted(modules.items(), key=lambda item: (item[1], item[0]))]


def lecture_analytics_options(family_ids=None):
    """Existing lecture deliveries only; do not initialize or synchronize anything."""
    query = FeedbackDelivery.objects.filter(form__form_type='post_lecture').exclude(status='cancelled')
    if family_ids is not None:
        query = query.filter(form_id__in=family_ids)
    return [{
        'deliveryId': row.id, 'moduleId': row.module_catalogue_id, 'moduleName': row.module_name,
        'sessionTitle': row.session_title, 'occurrenceKey': row.occurrence_key,
        'startsAt': (row.starts_at or row.available_at).isoformat(),
        'cohortName': row.cohort_name, 'groupName': row.group_name,
        'formTitle': row.form.title, 'version': row.form.version,
    } for row in query.select_related('form').order_by('-available_at', '-id')]


def question_analytics(family_ids=None, *, delivery_ids=None, submitted_from=None, submitted_until=None,
                       group_id=None, module_id=None, classification=None, dashboard=False):
    response_scope = {'group_id': group_id} if group_id else {}
    if module_id:
        response_scope['module_id'] = module_id
    responses = completed_report_responses(family_ids, delivery_ids=delivery_ids, submitted_from=submitted_from, submitted_until=submitted_until, **response_scope)
    all_responses = (completed_report_responses(family_ids, delivery_ids=delivery_ids, **response_scope)
                     if dashboard and (submitted_from is not None or submitted_until is not None) else responses)
    submitted = FeedbackAnswer.objects.filter(response__status='completed')
    if delivery_ids is not None:
        submitted = submitted.filter(response__delivery_id__in=delivery_ids)
    if group_id:
        submitted = submitted.filter(Q(response__delivery__group_id=group_id)
                                     | Q(response__delivery_id__isnull=True, response__form__group_id=group_id))
    if module_id:
        submitted = submitted.filter(Q(response__delivery__module_catalogue_id=module_id)
                                     | Q(response__delivery_id__isnull=True, response__form__module_catalogue_id=module_id))
    query = FeedbackQuestion.objects.select_related('section__form').prefetch_related(Prefetch(
        'answers', queryset=submitted.select_related('response'),
        to_attr='submitted_answers',
    ))
    if family_ids is not None:
        query = query.filter(section__form_id__in=family_ids)
    if delivery_ids is not None:
        query = query.filter(section__form__deliveries__id__in=delivery_ids).distinct()
    questions = list(query)
    if not questions:
        if classification:
            responses = responses if classification == 'unscored' else []
        result = {'questionMetrics': [], 'overallScore': overall_metrics([]), 'insights': {
            **report_insights([], []), 'classification': response_classifications([], [], responses),
        }}
        if dashboard:
            result['coverage'] = {'assigned': None, 'submitted': len(all_responses), 'rate': None}
        return result
    form_ids = {question.section.form_id for question in questions}
    manual_form_ids = ({question.section.form_id for question in questions
                        if (not group_id or getattr(question.section.form, 'group_id', '') == group_id)
                        and (not module_id or getattr(question.section.form, 'module_catalogue_id', '') == module_id)}
                       if group_id or module_id else form_ids)
    base = defaultdict(set)
    unknown_forms = set()
    assignments = list(FeedbackAssignment.objects.filter(form_id__in=manual_form_ids).values_list('form_id', 'target_type', 'target_id')) if delivery_ids is None else []
    coverage_known = all(kind in {'all_learners', 'learner'} for _, kind, _ in assignments)
    all_learners = (list(EnrolmentUser.all_learners.values_list('id', flat=True))
                    if any(kind == 'all_learners' for _, kind, _ in assignments) else [])
    for form_id, kind, learner_id in assignments:
        if kind == 'all_learners':
            base[form_id].update(('manual', form_id, str(identifier)) for identifier in all_learners)
        elif kind == 'learner':
            base[form_id].add(('manual', form_id, str(learner_id)))
        else:
            unknown_forms.add(form_id)  # Do not fabricate coverage for an unsupported assignment type.
    reviews = FeedbackReviewDelivery.objects.filter(form_id__in=manual_form_ids).values_list('form_id', 'id') if delivery_ids is None else []
    for form_id, identifier in reviews:
        base[form_id].add(('review', identifier))
    campaigns = list(FeedbackEventCampaign.objects.filter(form_id__in=manual_form_ids).exclude(status='cancelled').values_list('form_id', 'event_id')) if delivery_ids is None else []
    event_forms = defaultdict(set)
    for form_id, event_id in campaigns:
        event_forms[event_id].add(form_id)
    event_recipients = FeedbackEventRecipient.objects.filter(event_id__in=event_forms, revoked_at__isnull=True).values_list('event_id', 'id') if event_forms else []
    for event_id, identifier in event_recipients:
        for form_id in event_forms[event_id]:
            base[form_id].add(('event', identifier))
    rsvp = EventRsvpRecipient.objects.filter(
        campaign__form_id__in=manual_form_ids, revoked_at__isnull=True,
    ).exclude(campaign__status='cancelled').values_list('campaign__form_id', 'id') if delivery_ids is None else []
    for form_id, identifier in rsvp:
        base[form_id].add(('rsvp', identifier))

    delivery_query = FeedbackDelivery.objects.filter(form_id__in=form_ids).exclude(status='cancelled')
    if delivery_ids is not None:
        delivery_query = delivery_query.filter(id__in=delivery_ids)
    if group_id:
        delivery_query = delivery_query.filter(group_id=group_id)
    if module_id:
        delivery_query = delivery_query.filter(module_catalogue_id=module_id)
    deliveries = list(delivery_query.values(
        'id', 'form_id', 'question_set_pinned',
    ))
    recipients = defaultdict(set)
    for delivery_id, learner_id in FeedbackDeliveryRecipient.objects.filter(
        delivery__form_id__in=form_ids, revoked_at__isnull=True,
    ).values_list('delivery_id', 'learner_id'):
        recipients[delivery_id].add(('delivery', delivery_id, str(learner_id)))
    pinned = defaultdict(set)
    for delivery_id, question_id in FeedbackDeliveryQuestion.objects.filter(
        delivery__form_id__in=form_ids,
    ).values_list('delivery_id', 'question_id'):
        pinned[delivery_id].add(question_id)
    unpinned_ids = [delivery['id'] for delivery in deliveries if not delivery['question_set_pinned']]
    started = set(FeedbackResponse.objects.filter(delivery_id__in=unpinned_ids).values_list('delivery_id', flat=True)) if unpinned_ids else set()
    bank_forms = {question.section.form_id for question in questions if question.section.questions_per_delivery is not None}
    by_form = defaultdict(list)
    for delivery in deliveries:
        by_form[delivery['form_id']].append(delivery)
        if (not delivery['question_set_pinned'] and delivery['form_id'] in bank_forms
                and delivery['id'] not in started and recipients[delivery['id']]):
            # An older worker has not selected these questions yet. Leave coverage
            # unknown instead of changing the delivery or counting the whole bank.
            unknown_forms.add(delivery['form_id'])
    coverage_opportunities = {(form_id, key) for form_id, keys in base.items() for key in keys}
    for delivery in deliveries:
        coverage_opportunities.update((delivery['form_id'], key) for key in recipients[delivery['id']])
    coverage_opportunities.update((response.form_id, response_key(response)) for response in all_responses)
    rows, question_answers, metric_scopes = [], [], {}
    for question in questions:
        form_id = question.section.form_id
        opportunities = set(base[form_id])
        selected_in_scope = False
        for delivery in by_form[form_id]:
            if delivery['question_set_pinned']:
                selected = question.id in pinned[delivery['id']]
            else:
                selected = form_id not in bank_forms or delivery['id'] in started
            if selected:
                selected_in_scope = True
                opportunities.update(recipients[delivery['id']])
        if delivery_ids is not None and not selected_in_scope:
            continue  # Never show the rest of a bank as if this lecture delivered it.
        all_answers = [answer for answer in question.submitted_answers
                       if delivery_ids is None or answer.response.delivery_id in delivery_ids]
        # Date filters change only the numerator; retain historical assignment coverage.
        opportunities.update(response_key(answer.response) for answer in all_answers if answer.response.status == 'completed')
        answers = [answer for answer in all_answers if answer_in_period(answer, submitted_from, submitted_until)]
        rows.append(question_metrics(question, opportunities, denominator_known=form_id not in unknown_forms, answers=answers))
        question_answers.append((question, answers))
        metric_scopes[question.id] = (opportunities, form_id not in unknown_forms)
    if classification:
        classified = response_classifications(rows, question_answers, responses)
        selected = {response['responseId'] for response in classified['responses'] if response['classification'] == classification}
        responses = [response for response in responses if response.id in selected]
        question_answers = [(question, [answer for answer in answers if answer.response.id in selected])
                            for question, answers in question_answers]
        rows = [question_metrics(question, metric_scopes[question.id][0], denominator_known=metric_scopes[question.id][1], answers=answers)
                for question, answers in question_answers]
    overall = overall_metrics(rows)
    insights = report_insights(rows, question_answers)
    insights['classification'] = response_classifications(rows, question_answers, responses)
    for row in rows:
        row.pop('_score')
    result = {'questionMetrics': rows, 'overallScore': overall, 'insights': insights}
    if dashboard:
        assigned = len(coverage_opportunities)
        submitted_count = len({(response.form_id, response_key(response)) for response in all_responses})
        result['coverage'] = {'assigned': assigned if coverage_known else None, 'submitted': submitted_count,
                              'rate': round(submitted_count / assigned * 100, 1) if coverage_known and assigned else None}
    if delivery_ids is not None:
        result['selectionPending'] = bool(unknown_forms)
    return result
