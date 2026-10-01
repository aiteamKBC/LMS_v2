from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
import logging
import socket
import time
import uuid

from django.conf import settings
from django.db import connections, transaction
from django.db.models import Q
from django.utils import timezone

from .models import ReadModelEvent
from .registry import registered
from .repository import put_read_model


logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 8
_last_outbox_purge_at = 0.0
_OUTBOX_PURGE_INTERVAL_SECONDS = 60 * 60


def worker_identity() -> str:
    return f"{socket.gethostname()}:{uuid.uuid4().hex[:12]}"


def claim_events(
    *, limit: int, worker_id: str, using: str = "default", model_key: str | None = None,
) -> list[ReadModelEvent]:
    now = timezone.now()
    lease_seconds = max(int(getattr(settings, "READ_MODEL_WORKER_LEASE_SECONDS", 300)), 30)
    stale_before = now - timedelta(seconds=lease_seconds)
    with transaction.atomic(using=using):
        stale_leases = ReadModelEvent.objects.using(using).filter(
            status=ReadModelEvent.STATUS_PROCESSING,
            locked_at__lt=stale_before,
        )
        if model_key:
            stale_leases = stale_leases.filter(model_key=model_key)
        stale_leases.update(
            status=ReadModelEvent.STATUS_RETRY,
            locked_at=None,
            locked_by="",
            available_at=now,
        )
        queryset = (
            ReadModelEvent.objects.using(using)
            .filter(
                status__in=[ReadModelEvent.STATUS_PENDING, ReadModelEvent.STATUS_RETRY],
                available_at__lte=now,
            )
            .order_by("available_at", "created_at")
        )
        if model_key:
            queryset = queryset.filter(model_key=model_key)
        if connections[using].vendor == "postgresql":
            queryset = queryset.select_for_update(skip_locked=True)
        else:
            queryset = queryset.select_for_update()
        events = list(queryset[: max(int(limit), 1)])
        ids = [event.pk for event in events]
        if ids:
            ReadModelEvent.objects.using(using).filter(pk__in=ids).update(
                status=ReadModelEvent.STATUS_PROCESSING,
                locked_at=now,
                locked_by=worker_id,
            )
        for event in events:
            event.status = ReadModelEvent.STATUS_PROCESSING
            event.locked_at = now
            event.locked_by = worker_id
        return events


def _mark_success(
    events: list[ReadModelEvent],
    *,
    model_key: str,
    scope_type: str,
    scope_id: str,
    refresh_started_at,
    using: str,
) -> None:
    """Complete the claimed events and older duplicates for the same scope.

    The projection builder always reconstructs the complete current scope. Any
    pending/retry event that existed before that reconstruction started is
    therefore covered by the same result, even if it fell beyond this worker's
    claim limit. Events created while the builder is running are deliberately
    left pending so a concurrent domain change cannot be lost.
    """
    ReadModelEvent.objects.using(using).filter(
        Q(pk__in=[event.pk for event in events])
        | Q(
            model_key=model_key,
            scope_type=scope_type,
            scope_id=scope_id,
            status__in=[ReadModelEvent.STATUS_PENDING, ReadModelEvent.STATUS_RETRY],
            created_at__lte=refresh_started_at,
        )
    ).update(
        status=ReadModelEvent.STATUS_PROCESSED,
        processed_at=timezone.now(),
        locked_at=None,
        locked_by="",
        last_error="",
    )


def _mark_failure(events: list[ReadModelEvent], exc: Exception, *, using: str) -> None:
    now = timezone.now()
    for event in events:
        attempts = int(event.attempts) + 1
        dead = attempts >= MAX_ATTEMPTS
        delay = min(2 ** attempts, 300)
        ReadModelEvent.objects.using(using).filter(pk=event.pk).update(
            status=ReadModelEvent.STATUS_DEAD if dead else ReadModelEvent.STATUS_RETRY,
            attempts=attempts,
            available_at=now + timedelta(seconds=delay),
            locked_at=None,
            locked_by="",
            last_error=f"{type(exc).__name__}: {str(exc)}"[:2000],
        )


def purge_processed_events(*, using: str = "default", force: bool = False) -> int:
    """Bound processed outbox history without touching retry/dead-letter rows."""
    global _last_outbox_purge_at
    now_monotonic = time.monotonic()
    if not force and now_monotonic - _last_outbox_purge_at < _OUTBOX_PURGE_INTERVAL_SECONDS:
        return 0
    _last_outbox_purge_at = now_monotonic
    retention_days = max(int(getattr(settings, "READ_MODEL_OUTBOX_RETENTION_DAYS", 7)), 1)
    cutoff = timezone.now() - timedelta(days=retention_days)
    deleted, _ = ReadModelEvent.objects.using(using).filter(
        status=ReadModelEvent.STATUS_PROCESSED,
        created_at__lt=cutoff,
    ).delete()
    return deleted


def process_once(
    *, limit: int = 100, worker_id: str | None = None, using: str = "default",
    model_key: str | None = None,
) -> dict:
    purge_processed_events(using=using)
    worker_id = worker_id or worker_identity()
    claimed = claim_events(
        limit=limit, worker_id=worker_id, using=using, model_key=model_key,
    )
    grouped: dict[tuple[str, str, str], list[ReadModelEvent]] = defaultdict(list)
    for event in claimed:
        grouped[(event.model_key, event.scope_type, event.scope_id)].append(event)

    completed = failed = 0
    for (model_key, scope_type, scope_id), events in grouped.items():
        try:
            spec = registered(model_key)
            if spec.scope_type != scope_type:
                raise ValueError(f"Scope type {scope_type!r} does not match registered {spec.scope_type!r}.")
            refresh_started_at = timezone.now()
            payload = spec.builder(scope_id)
            value = put_read_model(
                model_key,
                scope_type,
                scope_id,
                payload,
                schema_version=spec.schema_version,
                ttl_seconds=spec.ttl_seconds,
                using=using,
            )
            if value is None:
                raise RuntimeError("The shared read-model table is unavailable.")
            _mark_success(
                events,
                model_key=model_key,
                scope_type=scope_type,
                scope_id=scope_id,
                refresh_started_at=refresh_started_at,
                using=using,
            )
            completed += len(events)
        except Exception as exc:
            logger.exception("read_model_refresh_failed model=%s scope_type=%s", model_key, scope_type)
            _mark_failure(events, exc, using=using)
            failed += len(events)
    return {"claimed": len(claimed), "completed": completed, "failed": failed, "groups": len(grouped)}

