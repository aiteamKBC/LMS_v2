"""Atomic activation boundaries; no identity guessing or automatic replay."""
from contextlib import contextmanager

from django.db import DatabaseError, transaction


class ActivationFailed(DatabaseError):
    """The caller's transaction must not commit a failed activation."""


@contextmanager
def locked_source(source):
    from learner_api.models import EnrolmentUser

    if getattr(getattr(source, '_state', None), 'db', None) not in (None, 'enrolment'):
        raise ActivationFailed('Unverified activation database.')
    with transaction.atomic(using='enrolment'):
        fresh = EnrolmentUser.all_learners.using('enrolment').select_for_update(nowait=True).filter(pk=source.pk).first()
        if fresh is None:
            raise ActivationFailed('Activation source no longer exists.')
        if not getattr(source, 'uuid', None) or str(fresh.uuid) != str(source.uuid):
            raise ActivationFailed('Activation source identity changed or is missing.')
        yield fresh


def require_active_profile(source):
    from learner_api.active_users import sync_active_user

    if str(source.programme_status or '').strip().casefold() != 'active':
        raise ActivationFailed('Activation requires an Active source.')
    profile = sync_active_user(source)
    if profile is None:
        raise ActivationFailed('Learner activation failed. Please retry after resolving the cause.')
    return profile
