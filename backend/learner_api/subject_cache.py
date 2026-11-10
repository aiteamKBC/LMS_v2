"""Shared cache of a learner's assigned-subject rows.

The "current subjects" statements (student_activity.CURRENT_SUBJECTS_SQL,
overview_week.HOME_SUBJECTS_SQL) read one learner's ``Training_plan`` /
``Learning_plan`` from ``enrolment."Created_users"``, the normalised mirror in
``"Learner".learner_training_plan_modules`` and the module titles in
``curriculum.modules``. Pages and panels ran them again on every request.

``subject_rows(cursor, sql, enrolment_id)`` returns the statement's rows from
Valkey when it can. The key carries:

* a digest of the statement text, so a different statement is a different key;
* the learner's ``Created_users`` id;
* the shared curriculum epoch, which any curriculum write moves (module titles
  and deletions are part of the result);
* the learner's version and the namespace generation (config.cache_versions),
  which every write to the learner's row, profile link or mirror moves once it
  commits. A missing version is a miss.

Versions are read before the database, so rows read after a write committed
are never stored under a version older than that write. Entries live
``ENTRY_TTL_SECONDS`` (120 s) at most.

Valkey unavailable: the statement runs against the database, exactly as
before; the process-local fallback is never used. Residual risk (see
config.cache_versions): a process that cannot reach Valkey cannot retire
entries the others still read, for at most the 120 s TTL.
"""
from __future__ import annotations

import hashlib
import logging

from django.db.models.signals import post_delete, post_init, post_save

from config import cache_versions

logger = logging.getLogger(__name__)

NAMESPACE = 'lplan'
ENTRY_TTL_SECONDS = 120


def enabled() -> bool:
    return (cache_versions.enabled('LEARNER_SUBJECT_CACHE') and cache_versions.shared_cache_available()
            and not cache_versions.in_transaction())


def _digest(text) -> str:
    return hashlib.sha1(str(text).encode()).hexdigest()[:16]


def subject_rows(cursor, sql, enrolment_id):
    """``cursor.execute(sql, [enrolment_id]); cursor.fetchall()``, cached."""
    key = None
    if enabled() and enrolment_id not in (None, ''):
        try:
            from curriculum_api.views import shared_curriculum_epoch
            version, generation = cache_versions.current(NAMESPACE, enrolment_id)
            epoch = shared_curriculum_epoch()
            key = (f'lplan:v1:{_digest(sql)}:{enrolment_id}:{epoch}:'
                   f'{_digest(version)}:{_digest(generation)}')
            cached = cache_versions.strict('get', key)
            if cached is not None:
                return list(cached)
        except cache_versions.Unavailable:
            key = None
        except Exception:
            logger.warning('Learner subject cache unavailable; reading the database.', exc_info=True)
            key = None
    cursor.execute(sql, [enrolment_id])
    rows = cursor.fetchall()
    if key is not None:
        try:
            cache_versions.strict('set', key, [tuple(row) for row in rows], timeout=ENTRY_TTL_SECONDS)
        except cache_versions.Unavailable:
            pass
    return rows


def bump_learners(enrolment_ids, using=None):
    cache_versions.bump(NAMESPACE, enrolment_ids, using=using)


def _on_enrolment_write(sender, instance, using=None, **kwargs):
    bump_learners([instance.pk], using=using)


def _remember_profile_link(sender, instance, **kwargs):
    instance._subject_cache_enrolment_id = instance.__dict__.get('enrolment_id')


def _on_profile_write(sender, instance, using=None, **kwargs):
    # The old link too: the learner it was attached to loses this mirror.
    bump_learners([instance.enrolment_id, getattr(instance, '_subject_cache_enrolment_id', None)], using=using)
    instance._subject_cache_enrolment_id = instance.enrolment_id


def _on_plan_module_write(sender, instance, using=None, **kwargs):
    targets = sender.cache_version_targets([instance])
    bump_learners(targets.get(NAMESPACE, []), using=using)


def connect_signals():
    from .models import CommercialUser, EnrolmentUser, LearnerProfile, LearnerTrainingPlanModule
    for signal in (post_save, post_delete):
        name = 'save' if signal is post_save else 'delete'
        for model in (EnrolmentUser, CommercialUser):
            signal.connect(_on_enrolment_write, sender=model, weak=False,
                           dispatch_uid=f'subject-cache:{model.__name__}:{name}')
        signal.connect(_on_profile_write, sender=LearnerProfile, weak=False,
                       dispatch_uid=f'subject-cache:profile:{name}')
        signal.connect(_on_plan_module_write, sender=LearnerTrainingPlanModule, weak=False,
                       dispatch_uid=f'subject-cache:plan-module:{name}')
    post_init.connect(_remember_profile_link, sender=LearnerProfile, weak=False,
                      dispatch_uid='subject-cache:profile:init')
