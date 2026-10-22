from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import hashlib
import logging
import time

from django.core.cache import cache
from django.db import DatabaseError, connections, transaction
from django.utils import timezone

from .models import ReadModel


logger = logging.getLogger(__name__)
CACHE_NAMESPACE = "shared-read-model:v1"
_CACHE_FAILURE_COOLDOWN_SECONDS = 5.0
_cache_unavailable_until = 0.0
CONTACT_MODELS = frozenset({'learner.home', 'record.monitor', 'coach.dashboard'})


def _scope_lock(cursor, model_key, scope_type, scope_id):
    # Publication and invalidation only; never hold this while reading sources.
    key = '\x1f'.join((model_key, scope_type, scope_id))
    cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', ['read-model-contact:' + key])


def contact_revision(model_key, scope_type, scope_id, *, using='default'):
    """Capture before building; absence is a valid initial generation."""
    with connections[using].cursor() as cursor:
        cursor.execute('''SELECT source_revision->>'contact_generation' FROM public.platform_read_models
            WHERE model_key=%s AND scope_type=%s AND scope_id=%s''', [model_key, scope_type, scope_id])
        row = cursor.fetchone()
    return (row[0] if row else None) or ''


def invalidate_contact_projection(cursor, model_key, scope_type, scope_id):
    """Existing JSON metadata is a CAS generation, not a new source authority."""
    from uuid import uuid4
    _scope_lock(cursor, model_key, scope_type, scope_id)
    cursor.execute('''INSERT INTO public.platform_read_models
        (model_key,scope_type,scope_id,schema_version,payload,source_revision,status,refreshed_at,expires_at)
        VALUES (%s,%s,%s,1,'{}'::jsonb,jsonb_build_object('contact_generation',%s::text),'error',now(),now())
        ON CONFLICT (model_key,scope_type,scope_id) DO UPDATE SET
        source_revision=platform_read_models.source_revision || EXCLUDED.source_revision,
        status='error',expires_at=now()''', [model_key, scope_type, scope_id, str(uuid4())])


def _cache_available() -> bool:
    return time.monotonic() >= _cache_unavailable_until


def _mark_cache_unavailable() -> None:
    global _cache_unavailable_until
    _cache_unavailable_until = time.monotonic() + _CACHE_FAILURE_COOLDOWN_SECONDS


@dataclass(frozen=True)
class ReadModelValue:
    payload: dict
    schema_version: int
    refreshed_at: object
    expires_at: object

    @property
    def stale(self) -> bool:
        return bool(self.expires_at and self.expires_at <= timezone.now())


def cache_key(model_key: str, scope_type: str, scope_id: str, schema_version: int) -> str:
    raw = "\x1f".join((model_key, scope_type, scope_id, str(schema_version)))
    return f"{CACHE_NAMESPACE}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()}"


def get_read_model(
    model_key: str,
    scope_type: str,
    scope_id: str,
    *,
    schema_version: int,
    cache_ttl: int,
    using: str = "default",
) -> ReadModelValue | None:
    key = cache_key(model_key, scope_type, scope_id, schema_version)
    cached = None
    if model_key not in CONTACT_MODELS and _cache_available():
        try:
            cached = cache.get(key)
        except Exception as exc:
            _mark_cache_unavailable()
            logger.warning("read_model_cache_unavailable operation=get model=%s error=%s", model_key, exc)
    if isinstance(cached, dict) and cached.get("schema_version") == schema_version:
        return ReadModelValue(
            payload=dict(cached.get("payload") or {}),
            schema_version=schema_version,
            refreshed_at=cached.get("refreshed_at"),
            expires_at=cached.get("expires_at"),
        )

    try:
        row = (
            ReadModel.objects.using(using)
            .filter(
                model_key=model_key,
                scope_type=scope_type,
                scope_id=scope_id,
                schema_version=schema_version,
                status=ReadModel.STATUS_READY,
            )
            .only("payload", "schema_version", "refreshed_at", "expires_at")
            .first()
        )
    except DatabaseError as exc:
        # Deploying code before its additive migration must retain the legacy
        # path. The feature flag can be enabled only after this table exists.
        logger.warning("read_model_store_unavailable operation=get model=%s error=%s", model_key, exc)
        return None
    if row is None:
        return None

    envelope = {
        "payload": dict(row.payload or {}),
        "schema_version": int(row.schema_version),
        "refreshed_at": row.refreshed_at,
        "expires_at": row.expires_at,
    }
    if model_key not in CONTACT_MODELS and _cache_available():
        try:
            cache.set(key, envelope, timeout=max(int(cache_ttl), 1))
        except Exception as exc:
            _mark_cache_unavailable()
            logger.warning("read_model_cache_unavailable operation=set model=%s error=%s", model_key, exc)
    return ReadModelValue(**envelope)


def put_read_model(model_key, scope_type, scope_id, payload, *, schema_version,
                   ttl_seconds, source_revision=None, using='default', expected_contact_revision=None):
    """Reject a build that crossed a committed contact change, including ABA.

    Protected publishers must capture before building. Persisted rows remain
    authoritative for reads; Redis is not used for these contact projections.
    """
    model = model_key
    args = (model, scope_type, scope_id, payload)
    kwargs = dict(schema_version=schema_version, ttl_seconds=ttl_seconds, source_revision=source_revision, using=using)
    if expected_contact_revision is None:
        if model in CONTACT_MODELS:
            return None
        return _put_read_model(*args, **kwargs)
    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            _scope_lock(cursor, model, scope_type, scope_id)
        current = contact_revision(model, scope_type, scope_id, using=using)
        if current != expected_contact_revision:
            return None
        kwargs['source_revision'] = {**(kwargs.get('source_revision') or {}), 'contact_generation': current}
        return _put_read_model(*args, **kwargs)


def _put_read_model(
    model_key: str,
    scope_type: str,
    scope_id: str,
    payload: dict,
    *,
    schema_version: int,
    ttl_seconds: int,
    source_revision: dict | None = None,
    using: str = "default",
) -> ReadModelValue | None:
    if not isinstance(payload, dict):
        raise ValueError("A shared read-model payload must be a JSON object.")
    expires_at = timezone.now() + timedelta(seconds=max(int(ttl_seconds), 1))
    try:
        row, _created = ReadModel.objects.using(using).update_or_create(
            model_key=model_key,
            scope_type=scope_type,
            scope_id=scope_id,
            defaults={
                "payload": payload,
                "schema_version": schema_version,
                "source_revision": source_revision or {},
                "status": ReadModel.STATUS_READY,
                "expires_at": expires_at,
            },
        )
    except DatabaseError as exc:
        logger.warning("read_model_store_unavailable operation=put model=%s error=%s", model_key, exc)
        return None

    value = ReadModelValue(
        payload=dict(payload),
        schema_version=int(schema_version),
        refreshed_at=row.refreshed_at,
        expires_at=row.expires_at,
    )
    if model_key not in CONTACT_MODELS and _cache_available():
        try:
            cache.set(
                cache_key(model_key, scope_type, scope_id, schema_version),
                {
                    "payload": value.payload,
                    "schema_version": value.schema_version,
                    "refreshed_at": value.refreshed_at,
                    "expires_at": value.expires_at,
                },
                timeout=max(int(ttl_seconds), 1),
            )
        except Exception as exc:
            _mark_cache_unavailable()
            logger.warning("read_model_cache_unavailable operation=set model=%s error=%s", model_key, exc)
    return value


def invalidate_read_model_cache(
    model_key: str,
    scope_type: str,
    scope_id: str,
    *,
    schema_version: int,
) -> None:
    if _cache_available():
        try:
            cache.delete(cache_key(model_key, scope_type, scope_id, schema_version))
        except Exception as exc:
            _mark_cache_unavailable()
            logger.warning("read_model_cache_unavailable operation=delete model=%s error=%s", model_key, exc)
