from datetime import datetime, timedelta, timezone

from django.core.management.base import BaseCommand
from django.db import connections

from learner_api.calendar_connections import _row, _sync_connection_busy


class Command(BaseCommand):
    help = "Refresh cached busy slots for all connected learner calendars."

    def add_arguments(self, parser):
        parser.add_argument("--past-days", type=int, default=1)
        parser.add_argument("--future-days", type=int, default=90)
        parser.add_argument("--chunk-days", type=int, default=30)

    def handle(self, *args, **options):
        past_days = max(0, options["past_days"])
        future_days = max(1, options["future_days"])
        chunk_days = max(1, min(31, options["chunk_days"]))
        now = datetime.now(timezone.utc)
        range_start = now - timedelta(days=past_days)
        range_end = now + timedelta(days=future_days)

        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                '''SELECT learner_kind, learner_id, provider
                   FROM "Learner"."calendar_connections"
                   WHERE status = 'connected'
                   ORDER BY learner_kind, learner_id, provider'''
            )
            connections_to_sync = cursor.fetchall()

        synced = failed = 0
        for kind, learner_id, provider in connections_to_sync:
            cursor_start = range_start
            try:
                row = _row(kind, learner_id, provider)
                row.update({"kind": kind, "learnerId": learner_id})
                while cursor_start < range_end:
                    cursor_end = min(cursor_start + timedelta(days=chunk_days), range_end)
                    _sync_connection_busy(row, cursor_start.isoformat(), cursor_end.isoformat())
                    cursor_start = cursor_end
                synced += 1
            except Exception as exc:  # noqa: BLE001
                failed += 1
                self.stderr.write(f"{kind}/{learner_id}/{provider}: {exc}")

        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                '''DELETE FROM "Learner"."calendar_busy_slots"
                   WHERE ends_at < %s''',
                [range_start],
            )
            deleted = cursor.rowcount

        self.stdout.write(
            self.style.SUCCESS(
                f"Synced {synced} connection(s); {failed} failed; removed {deleted} expired slot(s)."
            )
        )
