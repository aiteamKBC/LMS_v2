"""Curriculum Home read-model lookup and refresh events.

Payload construction and registry setup remain at the composition boundary.
"""
from __future__ import annotations
from django.conf import settings
from read_models.outbox import enqueue_read_model_event
from read_models.repository import get_read_model


MODEL_KEY = 'curriculum.home'


SCOPE_TYPE = 'curriculum'


SCHEMA_VERSION = 1


EVENT_REFRESH_REQUESTED = 'curriculum.home.refresh_requested'


VISIBILITIES = ('operational', 'all')


def curriculum_scope_id(visibility: str) -> str:
    value = str(visibility or '').strip().casefold()
    if value not in VISIBILITIES:
        raise ValueError('Unknown Curriculum visibility.')
    return value


def curriculum_home_scope_ids(limit: int):
    return list(VISIBILITIES[:max(min(int(limit), len(VISIBILITIES)), 0)])


def get_curriculum_home(visibility: str):
    scope_id = curriculum_scope_id(visibility)
    return get_read_model(
        MODEL_KEY,
        SCOPE_TYPE,
        scope_id,
        schema_version=SCHEMA_VERSION,
        cache_ttl=max(int(getattr(settings, 'CURRICULUM_HOME_READ_MODEL_TTL_SECONDS', 30)), 1),
    )


def enqueue_curriculum_home_refresh(
    visibility: str, *, reason: str, using: str = 'default',
) -> bool:
    try:
        scope_id = curriculum_scope_id(visibility)
    except ValueError:
        return False
    return enqueue_read_model_event(
        event_type=EVENT_REFRESH_REQUESTED,
        model_key=MODEL_KEY,
        scope_type=SCOPE_TYPE,
        scope_id=scope_id,
        payload={'reason': str(reason or 'change')[:120]},
        using=using,
    )


def enqueue_all_curriculum_home_refreshes(*, reason: str, using: str = 'default') -> bool:
    queued = False
    for visibility in VISIBILITIES:
        queued = enqueue_curriculum_home_refresh(
            visibility, reason=reason, using=using,
        ) or queued
    return queued
