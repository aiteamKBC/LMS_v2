from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from read_models.models import ReadModel, ReadModelEvent
from read_models.outbox import enqueue_read_model_event
from read_models.registry import registered


class Command(BaseCommand):
    help = "Enqueue a bounded set of missing/stale projections as a lost-event safety net."

    def add_arguments(self, parser):
        parser.add_argument("--model", required=True)
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--max-age-seconds", type=int)

    def handle(self, *args, **options):
        if not getattr(settings, "READ_MODEL_OUTBOX_ENABLED", False):
            raise CommandError("READ_MODEL_OUTBOX_ENABLED must be true before reconciliation.")
        try:
            spec = registered(options["model"])
        except KeyError as exc:
            raise CommandError(str(exc)) from exc

        limit = max(min(int(options["limit"]), 1000), 1)
        max_age = options["max_age_seconds"]
        max_age = max(int(max_age if max_age is not None else spec.ttl_seconds), 1)
        cutoff = timezone.now() - timedelta(seconds=max_age)

        stale_ids = list(
            ReadModel.objects.filter(model_key=spec.model_key, scope_type=spec.scope_type)
            .filter(Q(refreshed_at__lt=cutoff) | ~Q(schema_version=spec.schema_version))
            .order_by("refreshed_at")
            .values_list("scope_id", flat=True)[:limit]
        )
        candidates = list(dict.fromkeys(str(value) for value in stale_ids))

        if len(candidates) < limit and spec.scope_source is not None:
            discovered = list(dict.fromkeys(
                str(value) for value in spec.scope_source(limit * 2) if str(value or "").strip()
            ))
            fresh_ids = set(
                ReadModel.objects.filter(
                    model_key=spec.model_key,
                    scope_type=spec.scope_type,
                    scope_id__in=discovered,
                    schema_version=spec.schema_version,
                    refreshed_at__gte=cutoff,
                ).values_list("scope_id", flat=True)
            )
            for scope_id in discovered:
                if scope_id not in fresh_ids and scope_id not in candidates:
                    candidates.append(scope_id)
                    if len(candidates) >= limit:
                        break

        selected = candidates[:limit]
        queued_ids = set(ReadModelEvent.objects.filter(
            model_key=spec.model_key,
            scope_type=spec.scope_type,
            scope_id__in=selected,
            status__in=[
                ReadModelEvent.STATUS_PENDING,
                ReadModelEvent.STATUS_PROCESSING,
                ReadModelEvent.STATUS_RETRY,
            ],
        ).values_list("scope_id", flat=True))
        enqueued = 0
        for scope_id in selected:
            if scope_id in queued_ids:
                continue
            if enqueue_read_model_event(
                event_type="read_model.reconciliation_requested",
                model_key=spec.model_key,
                scope_type=spec.scope_type,
                scope_id=scope_id,
                payload={"reason": "bounded-reconciliation"},
            ):
                enqueued += 1
        self.stdout.write(f"examined={len(selected)} enqueued={enqueued}")
