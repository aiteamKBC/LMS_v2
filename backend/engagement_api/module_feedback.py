"""Date-based module feedback, independent of lecture attendance and Teams.

Deliveries are opened lazily by the learner queue and staff reporting reads.
Deliveries pin template versions. Schedule edits move recipients who have not
started a response, while preserving started and completed response history.
"""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.db import connection, transaction
from django.utils import timezone

from learner_api import learning_plan as plans
from learner_api.models import EnrolmentUser

from .models import FeedbackDelivery, FeedbackDeliveryRecipient, FeedbackForm, FeedbackResponse

MODULE_FORM_TYPES = {'mid_module': 'Mid-module Feedback', 'end_module': 'End-module Feedback'}
BUSINESS_TZ = ZoneInfo('Europe/London')


def module_feedback_date(start, end, form_type):
    """Average local calendar dates, keeping half days and business-zone DST."""
    if form_type not in MODULE_FORM_TYPES:
        raise ValueError('Unsupported module feedback type.')
    try:
        start = date.fromisoformat(str(start)) if not isinstance(start, date) else start
        end = date.fromisoformat(str(end)) if not isinstance(end, date) else end
        if start is None or end is None or end < start:
            raise ValueError
        began = datetime.combine(start, time.min)
        ended = datetime.combine(end, time.min)
    except (ValueError, TypeError):
        raise ValueError('Module feedback requires valid start and end dates, with the end on or after the start.') from None
    checkpoint = began + (ended - began) / 2 if form_type == 'mid_module' else ended
    return timezone.make_aware(checkpoint, BUSINESS_TZ)


def active_modules():
    """Only live published delivery modules, retaining their exact placement."""
    with connection.cursor() as cursor:
        cursor.execute('''SELECT m.module_catalogue_id, m.title, m.start_date, m.end_date,
                                p.programme_id, p.name AS programme_name,
                                c.cohort_id, c.cohort_name, g.group_id, g.group_name
                           FROM curriculum.modules m
                           JOIN curriculum.groups g ON g.group_id = m.group_id
                           JOIN curriculum.cohorts c ON c.cohort_id = g.cohort_id
                           JOIN curriculum.programmes p ON p.programme_id = c.programme_id
                          WHERE m.deleted_at IS NULL AND g.deleted_at IS NULL
                            AND c.deleted_at IS NULL AND p.deleted_at IS NULL
                            AND COALESCE(m.is_programme_deleted, false) = false
                            AND COALESCE(g.is_programme_deleted, false) = false
                            AND COALESCE(p.is_archived, false) = false
                            AND lower(COALESCE(m.status, 'draft')) = 'published'
                            AND lower(COALESCE(c.status, 'active')) <> 'archived'
                            AND lower(COALESCE(p.status, 'active')) <> 'archived'
                          ORDER BY m.module_catalogue_id''')
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def module_memberships(wanted, learner_id=None):
    """Use the assignment directory's rules, including cleared/explicit plans.

    The staff path reads compact SQL facts rather than downloading every plan.
    The learner path uses the same authoritative resolver for their own plan.
    Neither path hydrates content, writes plans, or reconciles identities.
    """
    if learner_id is not None:
        learner = EnrolmentUser.all_learners.filter(pk=learner_id).first()
        if learner is None:
            return {}
        return {str(learner.pk): set(plans._effective_plan_ids(learner, {})) & wanted}
    from curriculum_api.learner_assignment_counts_sql import fetch_plan_facts, _effective_ids_from_fact
    facts = fetch_plan_facts(wanted)
    cache = dict(plans.group_module_ids_bulk({(fact['programme'], fact['grp']) for fact in facts}))
    result = {}
    for fact in facts:
        learner_id = str(fact['learner_id'])
        if fact['ambiguous']:
            learner = EnrolmentUser.all_learners.get(pk=learner_id)
            result[learner_id] = set(plans._effective_plan_ids(learner, cache)) & wanted
        else:
            result[learner_id] = _effective_ids_from_fact(fact, wanted, cache)
    return result


def assigned_active_module_ids(learner_id):
    wanted = {row['module_catalogue_id'] for row in active_modules()}
    return module_memberships(wanted, learner_id).get(str(learner_id), set()) if wanted else set()


def module_delivery_accessible(delivery, learner_id):
    return delivery.module_catalogue_id in assigned_active_module_ids(learner_id)


def sync_module_feedback(learner_id=None):
    """Idempotently deliver both phases to assigned learners when dates arrive.

    A module-specific published template overrides an all-modules template.
    The globally unique occurrence key prevents a version edit or retry from
    delivering the same module phase twice. Started responses keep their dates.
    """
    now = timezone.now()
    with transaction.atomic():
        forms = list(FeedbackForm.objects.select_for_update().filter(
            form_type__in=MODULE_FORM_TYPES, status='published', is_current=True,
        ).order_by('-published_at', '-id'))
        if not forms:
            return
        modules = active_modules()
        wanted = {row['module_catalogue_id'] for row in modules}
        memberships = module_memberships(wanted, learner_id) if wanted else {}
        existing_deliveries = {row.occurrence_key: row for row in FeedbackDelivery.objects.select_related('form').filter(
            attendance_source='module_dates', module_catalogue_id__in=wanted,
        )}
        recipient_scope = {'delivery_id__in': [row.id for row in existing_deliveries.values()]}
        if learner_id is not None:
            recipient_scope['learner_id'] = str(learner_id)
        # Lock existing recipients in one read. Writes take the same row lock
        # before starting a response, so rescheduling cannot race a first save.
        existing_recipients = {(row.delivery_id, str(row.learner_id)): row for row in
                               FeedbackDeliveryRecipient.objects.select_for_update().filter(**recipient_scope)}
        learners = {str(row.pk): row for row in EnrolmentUser.all_learners.filter(
            pk__in=[key for key, ids in memberships.items() if ids],
        ).only('id', 'username', 'email', 'programme')}
        for module in modules:
            module_id = module['module_catalogue_id']
            for phase, label in MODULE_FORM_TYPES.items():
                matching = [form for form in forms if form.form_type == phase and (
                    form.delivery_scope == 'all_modules' or form.module_catalogue_id == module_id
                )]
                matching.sort(key=lambda form: form.delivery_scope != 'module')
                if not matching:
                    continue
                form = matching[0]
                key = f'module:{phase}:{module_id}'
                delivery = existing_deliveries.get(key)
                launch_form = delivery.form if delivery is not None else form
                try:
                    available_at = module_feedback_date(module['start_date'], module['end_date'], phase)
                    end_at = module_feedback_date(module['start_date'], module['end_date'], 'end_module')
                    published_at = launch_form.published_at or now
                    if end_at.date() < published_at.astimezone(BUSINESS_TZ).date():
                        available_at = None  # Never backfill modules ended before launch.
                except ValueError:
                    available_at = None
                if delivery is None:
                    if available_at is None or available_at > now or (form.start_date and form.start_date > now):
                        continue
                    delivery, _ = FeedbackDelivery.objects.get_or_create(
                        occurrence_key=key,
                        defaults={
                            'form': form, 'module_catalogue_id': module_id,
                            'module_name': module['title'], 'attendance_source': 'module_dates',
                            'session_title': f"{module['title']} — {label}",
                            'available_at': available_at, 'starts_at': available_at, 'ends_at': available_at,
                            **{field: module[field] or '' for field in (
                                'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name',
                            )},
                        },
                    )
                if delivery.status != 'open':
                    continue
                assigned_ids = [key for key, ids in memberships.items() if module_id in ids]
                recipients = FeedbackDeliveryRecipient.objects.filter(delivery=delivery)
                if learner_id is not None:
                    recipients = recipients.filter(learner_id=str(learner_id))
                recipients.exclude(learner_id__in=assigned_ids).filter(revoked_at__isnull=True).update(revoked_at=now)
                for member_id in assigned_ids:
                    learner = learners[member_id]
                    recipient = existing_recipients.get((delivery.id, member_id))
                    created = False
                    if recipient is None:
                        recipient, created = FeedbackDeliveryRecipient.objects.select_for_update().get_or_create(
                            delivery=delivery, learner_id=member_id,
                            defaults={
                                'learner_name': learner.username or learner.email or f'Learner {member_id}',
                                'programme': learner.programme or '', 'due_date': None,
                                'available_at': available_at,
                            },
                        )
                    if recipient.revoked_at is not None:
                        recipient.revoked_at = None
                        recipient.save(update_fields=['revoked_at'])
                    if not created and recipient.available_at != available_at and not FeedbackResponse.objects.filter(
                        delivery=delivery, learner_id=member_id,
                    ).exists():
                        recipient.available_at = available_at
                        recipient.save(update_fields=['available_at'])
