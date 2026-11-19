"""Discover committed imports, including SQL/bulk writers outside this repository.

Discovery deliberately has no completion/date/type predicate. All eligibility
belongs to sync_review_feedback; a late date or changed source is reconsidered
on every sweep, without a high-water mark that could lose an update or retry.
"""
import logging
from contextlib import nullcontext

from django.db import connection, transaction

from coach_api.review_sources import ReviewIdentityConflict, enrolment_for_review_profile
from learner_api.models import LearnerProfile

from .review_feedback import ALL_REVIEW_FORM_TYPES, FeedbackForm, sync_review_feedback

logger = logging.getLogger(__name__)


def source_profile_ids(after, limit):
    with connection.cursor() as cursor:
        cursor.execute('''SELECT DISTINCT learner_id FROM "Learner".reviews
                          WHERE learner_id > %s ORDER BY learner_id LIMIT %s''', [after, limit])
        return [row[0] for row in cursor.fetchall()]


def claim_profile(profile_id):
    """Transaction-scoped locks also work through a transaction-pooling endpoint."""
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0))',
                       [f'review-feedback-profile:{profile_id}'])
        return cursor.fetchone()[0]


def reconcile_imported_reviews(*, batch_size=100, dry_run=False, should_stop=None, lock_profiles=False):
    """Bound source reads, isolate failures, and use the trusted ID bridge.

    Run on an autocommit connection: a poll must never process its caller's
    uncommitted import. Failed/unlinked profiles remain discoverable next time.
    Returned counts contain no learner identifiers or source payloads.
    """
    if not 1 <= batch_size <= 1000:
        raise ValueError('batch_size must be between 1 and 1000.')
    if connection.in_atomic_block or not connection.get_autocommit():
        raise RuntimeError('Review discovery requires a committed autocommit connection.')
    if lock_profiles and connection.vendor != 'postgresql':
        raise RuntimeError('Profile claims require PostgreSQL.')
    counts = {'profiles': 0, 'unlinkedProfiles': 0, 'failedProfiles': 0, 'busyProfiles': 0, 'stopped': False}
    if not FeedbackForm.objects.filter(form_type__in=ALL_REVIEW_FORM_TYPES, status='published',
                                       is_current=True, published_at__isnull=False).exists():
        return counts
    after = 0
    while not (should_stop and should_stop()):
        ids = source_profile_ids(after, batch_size)
        if not ids:
            break
        profiles = {item.pk: item for item in LearnerProfile.objects.filter(pk__in=ids)}
        for profile_id in ids:
            if should_stop and should_stop():
                counts['stopped'] = True
                return counts
            counts['profiles'] += 1
            try:
                # Short transactions isolate each learner and release claims
                # automatically on commit, rollback or connection loss. Never
                # hold a session lock across a pooled connection's statements.
                with transaction.atomic() if lock_profiles else nullcontext():
                    if lock_profiles and not claim_profile(profile_id):
                        counts['busyProfiles'] += 1
                        continue
                    learner = enrolment_for_review_profile(profiles.get(profile_id))
                    if learner is None:
                        counts['unlinkedProfiles'] += 1
                        continue
                    result = (sync_review_feedback(learner.pk, dry_run=True) if dry_run
                              else sync_review_feedback(learner.pk))
                # Count success only after the profile's transaction commits.
                for key, value in result.items():
                    counts[key] = counts.get(key, 0) + value
            except ReviewIdentityConflict:
                counts['identityConflicts'] = counts.get('identityConflicts', 0) + 1
                counts['unlinkedProfiles'] += 1
            except Exception as exc:  # one failure must not starve the remaining batch
                counts['failedProfiles'] += 1
                logger.error('Review feedback profile reconciliation failed (%s); next sweep will retry.',
                             type(exc).__name__)
        after = ids[-1]
    counts['stopped'] = bool(should_stop and should_stop())
    return counts
