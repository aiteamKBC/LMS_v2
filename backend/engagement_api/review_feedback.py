"""Recognize imported Review completion without changing either source.

The delivery's unique source_review_id is the durable, once-per-Review marker.
Reconciliation is safe after retries, concurrent reads and a later Aptem import.
No mail, Graph request or other external effect is performed here.
"""
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
import logging

from django.db import connection
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from coach_api.migrated_reviews import review_family, source_is_completed
from coach_api.models import ImportedReviewInstance
from coach_api.review_sources import (
    ReviewIdentityConflict, enrolment_for_review_profile, linked_overlay,
    review_profile_for_source, source_for_learner,
)
from learner_api.models import EnrolmentUser, LearnerProfile

from .models import FeedbackForm, FeedbackReviewDelivery

logger = logging.getLogger(__name__)

REVIEW_FORM_TYPES = {
    'post_mcm_review': 'Monthly Coaching Meeting',
    'post_progress_review': 'Progress Review',
}
FORM_TYPE_BY_FAMILY = {
    'MCM': 'post_mcm_review',
    'PR': 'post_progress_review',
    'PR_SKILLS_RADAR': 'post_progress_review',
}


def completion_datetime(value):
    """Keep instants; interpret date-only/naive imports in the business zone."""
    # review_history imports the HTTP workspace. Keep it out of AppConfig.ready
    # when this service's completion signal is registered.
    from learner_api.review_history import _parse_imported_datetime

    try:
        parsed = parse_datetime(value) if isinstance(value, str) else None
        parsed = parsed or _parse_imported_datetime(value)
    except (TypeError, ValueError, OverflowError):
        return None
    if parsed is not None and timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_default_timezone())
    return parsed


@dataclass(frozen=True)
class ReviewCompletion:
    lms_completed: bool
    aptem_completed: bool
    lms_completed_at: datetime | None
    aptem_completed_at: datetime | None
    first_completed_at: datetime | None
    undated_completion: bool

    @property
    def completed(self):
        return self.lms_completed or self.aptem_completed

    @property
    def source(self):
        if self.lms_completed and self.aptem_completed:
            return 'both'
        return 'LMS' if self.lms_completed else 'Aptem' if self.aptem_completed else None


def review_completion(row, overlay=None):
    from learner_api.review_history import _json_value, _normalise_status

    data = _json_value(row.get('review_data'), dict, {})
    metadata = _json_value(data.get('source_metadata'), dict, {})
    aptem_at = completion_datetime(row.get('completed_date') or metadata.get('Completed Date'))
    aptem_completed = source_is_completed({
        'status': _normalise_status(row.get('status') or metadata.get('Status')),
        'completedDate': aptem_at,
    })
    lms_completed = bool(overlay and str(overlay.status).strip().casefold() == 'completed')
    lms_at = completion_datetime(overlay.completed_at) if overlay else None
    # Reopening clears completed_at. Its preserved original completion remains
    # the launch boundary, even if the corrected document completes much later.
    intelligence = _json_value(getattr(overlay, 'meeting_intelligence', None), dict, {})
    reopened_raw = intelligence.get('reopenCompletedAt')
    reopened_at = completion_datetime(reopened_raw)
    dates = [value for value in (aptem_at, lms_at, reopened_at) if value is not None]
    undated = ((aptem_completed and aptem_at is None)
               or (lms_completed and lms_at is None and reopened_at is None)
               or bool(reopened_raw and reopened_at is None))
    return ReviewCompletion(lms_completed, aptem_completed, lms_at, aptem_at,
                            min(dates) if dates else None, bool(undated))


def _source_rows(profile_id, source_review_id=None):
    sql = '''SELECT id, aptem_review_id, learner_id, learner_name,
                    review_type, review_name, completed_date, status,
                    jsonb_build_object(
                        'source_metadata', review_data->'source_metadata',
                        'aptem_learner_id', review_data->'aptem_learner_id'
                    ) AS review_data
               FROM "Learner".reviews WHERE learner_id = %s'''
    params = [profile_id]
    if source_review_id is not None:
        sql += ' AND id = %s'
        params.append(source_review_id)
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def sync_review_feedback(learner_id, *, source_review_id=None):
    """Reconcile persisted completions for an *enrolment* learner identity.

    published_at remains the existing launch boundary. Missing dates are
    reported, never replaced with observation time/updated_at. The source row
    persists pending work, including when the post-commit fast path fails.
    """
    from learner_api.review_history import _json_value

    result = {key: 0 for key in ('created', 'existing', 'incomplete', 'historical',
                                'undated', 'future', 'unlinked', 'identityConflicts')}
    templates = {}
    for form in FeedbackForm.objects.filter(
        form_type__in=REVIEW_FORM_TYPES, status='published', is_current=True,
        published_at__isnull=False,
    ).order_by('-published_at', '-id'):
        templates.setdefault(form.form_type, form)
    if not templates:
        return result

    learner = EnrolmentUser.all_learners.filter(pk=learner_id).first()
    if learner is None:
        return result
    profile = review_profile_for_source(learner)
    identity = source_for_learner(learner, profile)
    if profile is None or identity.kind != 'aptem':
        return result
    rows = _source_rows(profile.pk, source_review_id)
    if source_review_id is not None and not rows:
        result['unlinked'] = 1
        logger.warning('Review feedback unresolved: source review does not match the verified learner')
        return result
    review_ids = {row['id'] for row in rows}
    # Include mismatched owners of these source IDs so conflicts cannot quietly
    # fall back to Aptem-only detection. Legacy keys are scoped by Profile ID.
    overlays = list(ImportedReviewInstance.objects.filter(
        Q(source_review_id__in=review_ids)
        | Q(learner_id=profile.pk, source_review_id__isnull=True),
    ))
    legacy_keys = Counter(str(row.get('aptem_review_id') or '') for row in rows)
    linked_ids = set()
    existing = {item.source_review_id: item for item in FeedbackReviewDelivery.objects.filter(
        source_review_id__in=review_ids,
    )}
    now = timezone.now()
    for row in rows:
        form = templates.get(FORM_TYPE_BY_FAMILY.get(review_family(row['review_type'])))
        if form is None:
            continue
        data = _json_value(row.get('review_data'), dict, {})
        if (str(row['learner_id']) != str(profile.pk)
                or (data.get('aptem_learner_id')
                    and str(data['aptem_learner_id']) != str(identity.aptem_id))):
            result['identityConflicts'] += 1
            continue
        aptem_id = str(row.get('aptem_review_id') or '')
        event = {'learnerId': str(profile.pk), 'reviewId': str(row['id']),
                 'eventKey': f'imported-review:{aptem_id}'}
        candidates = [item for item in overlays if item.source_review_id == row['id']
                      or (item.source_review_id is None and aptem_id
                          and item.event_key == event['eventKey'])]
        if (any(str(item.learner_id) != str(profile.pk) for item in candidates)
                or (legacy_keys[aptem_id] > 1
                    and any(item.source_review_id is None for item in candidates))):
            result['identityConflicts'] += 1
            continue
        try:
            overlay = linked_overlay(event, candidates)
        except ReviewIdentityConflict:
            result['identityConflicts'] += 1
            continue
        if overlay:
            linked_ids.add(overlay.pk)
        delivery = existing.get(row['id'])
        if delivery is not None:
            result['existing' if str(delivery.learner_id) == str(learner.pk)
                   else 'identityConflicts'] += 1
            continue
        state = review_completion(row, overlay)
        if not state.completed:
            result['incomplete'] += 1
            continue
        if state.first_completed_at and state.first_completed_at < form.published_at:
            result['historical'] += 1
            continue
        if state.undated_completion or state.first_completed_at is None:
            result['undated'] += 1
            continue
        if state.first_completed_at > now:
            result['future'] += 1
            continue
        # The UNIQUE source_review_id constraint makes recognition a durable
        # transition exactly once, including concurrent LMS/Aptem detections.
        delivery, created = FeedbackReviewDelivery.objects.get_or_create(
            source_review_id=row['id'], defaults={
                'form': form, 'aptem_review_id': aptem_id,
                'learner_id': str(learner.pk), 'learner_name': row.get('learner_name') or '',
                'review_type': row['review_type'], 'review_name': row.get('review_name') or '',
                'completed_at': state.first_completed_at,
            },
        )
        if str(delivery.learner_id) != str(learner.pk):
            result['identityConflicts'] += 1
        else:
            result['created' if created else 'existing'] += 1
    if source_review_id is None:
        result['unlinked'] = sum(item.source_review_id is None and item.pk not in linked_ids
                                 for item in overlays)
    if any(result[key] for key in ('unlinked', 'identityConflicts', 'undated')):
        # Counts only: no learner names, emails, source payloads or credentials.
        logger.warning('Review feedback unresolved: unlinked=%d identity_conflicts=%d undated=%d',
                       result['unlinked'], result['identityConflicts'], result['undated'])
    return result


def sync_completed_overlay(overlay):
    """Post-commit fast path; page/command reconciliation is the retry path."""
    profile = LearnerProfile.objects.filter(pk=overlay.learner_id).first()
    learner = enrolment_for_review_profile(profile)
    if learner is None:
        logger.warning('Review feedback unresolved: completion has no verified enrolment link')
        return
    return sync_review_feedback(learner.pk, source_review_id=overlay.source_review_id)
