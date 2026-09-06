from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections, router
from django.utils import timezone

from coach_api.models import CoachCalendarEvent
from coach_api.views import (
    coach_meeting_snapshot_tables_ready,
    fetch_coach_meeting_graph_snapshot,
    persist_coach_meeting_snapshots,
)


class Command(BaseCommand):
    help = (
        "Fetch Microsoft Teams artifacts and attendance for coach calendar events "
        "and persist them into the manual snapshot tables."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--all",
            action="store_true",
            help="Sync every scheduled/in-progress/completed coach calendar event that has a Teams link.",
        )
        parser.add_argument(
            "--recent",
            action="store_true",
            help="Sync coach calendar events that ended recently. Intended for cron/scheduled jobs.",
        )
        parser.add_argument(
            "--lookback-hours",
            type=int,
            default=24,
            help="With --recent, sync meetings that ended within this many hours. Default: 24.",
        )
        parser.add_argument(
            "--event-key",
            dest="event_key",
            default="",
            help="Sync one coach calendar event by event_key.",
        )
        parser.add_argument(
            "--owner-email",
            dest="owner_email",
            default="",
            help="Sync matching coach calendar events for one owner/organizer email.",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of events to process. Use 0 for no limit.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="List the matching events without calling Microsoft Graph or writing snapshots.",
        )
        parser.add_argument(
            "--allow-missing-tables",
            action="store_true",
            help="Return successfully when the manual snapshot tables have not been created yet.",
        )

    def handle(self, *args, **options):
        sync_all = bool(options["all"])
        sync_recent = bool(options["recent"])
        event_key = (options["event_key"] or "").strip()
        owner_email = (options["owner_email"] or "").strip()
        limit = options["limit"]
        lookback_hours = options["lookback_hours"]
        dry_run = bool(options["dry_run"])
        allow_missing_tables = bool(options["allow_missing_tables"])

        if not sync_all and not sync_recent and not event_key and not owner_email:
            raise CommandError("Pass --all, --recent, --event-key, or --owner-email so the sync scope is explicit.")
        if limit < 0:
            raise CommandError("--limit must be 0 or greater.")
        if lookback_hours < 1:
            raise CommandError("--lookback-hours must be 1 or greater.")

        database = router.db_for_write(CoachCalendarEvent) or "default"
        if not dry_run and not coach_meeting_snapshot_tables_ready(database):
            message = (
                "Snapshot tables are missing on the active database branch. "
                "Run backend/coach_api/sql/coach_meeting_artifacts_attendance_snapshots.sql first."
            )
            if allow_missing_tables:
                self.stdout.write(self.style.WARNING(message))
                return
            raise CommandError(message)

        records = self._matching_records(
            sync_all=sync_all,
            sync_recent=sync_recent,
            event_key=event_key,
            owner_email=owner_email,
            limit=limit,
            lookback_hours=lookback_hours,
        )
        if not records:
            self.stdout.write(self.style.WARNING("No coach calendar events matched this sync scope."))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(f"Dry run: {len(records)} event(s) matched."))
            for record in records:
                self.stdout.write(self._describe_record(record))
            return

        stored = 0
        skipped = 0
        partial = 0
        failed = 0

        for record in records:
            close_old_connections()
            snapshot, error_payload, status_code = fetch_coach_meeting_graph_snapshot(record)
            if error_payload:
                skipped += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipped {record.event_key}: {error_payload.get('code') or status_code} - "
                        f"{error_payload.get('detail') or 'Microsoft Graph could not return this meeting.'}"
                    )
                )
                continue

            storage = persist_coach_meeting_snapshots(
                record,
                artifacts=snapshot["artifacts"],
                attendance_reports=snapshot["attendanceReports"],
                attendance_tracker=snapshot["attendanceTracker"],
            )
            if not storage.get("stored"):
                failed += 1
                reason = storage.get("reason") or "unknown"
                if reason == "snapshot_tables_missing":
                    raise CommandError(
                        "Snapshot tables are missing on the active database branch. "
                        "Run backend/coach_api/sql/coach_meeting_artifacts_attendance_snapshots.sql first."
                    )
                self.stdout.write(self.style.ERROR(f"Failed {record.event_key}: {reason}"))
                continue

            stored += 1
            if snapshot.get("partial"):
                partial += 1
            attendance = snapshot["attendance"]
            self.stdout.write(
                self.style.SUCCESS(
                    f"Stored {record.event_key}: "
                    f"{len(snapshot['artifacts'])} artifact(s), "
                    f"{attendance['reportCount']} attendance report(s), "
                    f"{len(attendance['tracker'])} attendance row(s)"
                )
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. stored={stored}, partial={partial}, skipped={skipped}, failed={failed}"
            )
        )

    def _matching_records(
        self,
        *,
        sync_all: bool,
        sync_recent: bool,
        event_key: str,
        owner_email: str,
        limit: int,
        lookback_hours: int,
    ) -> list[CoachCalendarEvent]:
        queryset = (
            CoachCalendarEvent.objects.exclude(meeting_link="")
            .exclude(status__in=[CoachCalendarEvent.STATUS_NOT_SCHEDULED, CoachCalendarEvent.STATUS_CANCELLED])
            .order_by("-scheduled_date", "-updated_at", "event_key")
        )
        if event_key:
            queryset = queryset.filter(event_key=event_key)
        if owner_email:
            queryset = queryset.filter(owner_email__iexact=owner_email)

        if sync_recent:
            now = timezone.now()
            window_start = now - timedelta(hours=lookback_hours)
            queryset = queryset.filter(
                scheduled_date__gte=window_start.date(),
                scheduled_date__lte=now.date(),
            )
            records = [
                record
                for record in queryset
                if self._event_end_at(record) is not None
                and window_start <= self._event_end_at(record) <= now
            ]
            records.sort(key=lambda record: self._event_end_at(record) or now)
            return records[:limit] if limit else records

        if limit:
            queryset = queryset[:limit]
        return list(queryset)

    def _describe_record(self, record: CoachCalendarEvent) -> str:
        date_value = record.scheduled_date.isoformat() if record.scheduled_date else "--"
        time_value = record.scheduled_time.strftime("%H:%M") if record.scheduled_time else "--"
        return (
            f"{record.event_key} | {record.event_type} | {record.status} | "
            f"{date_value} {time_value} | owner={record.owner_email} | learner={record.learner_name}"
        )

    def _event_end_at(self, record: CoachCalendarEvent):
        if not record.scheduled_date:
            return None
        scheduled_time = record.scheduled_time or time(0, 0)
        start_at = datetime.combine(record.scheduled_date, scheduled_time)
        if timezone.is_naive(start_at):
            start_at = timezone.make_aware(start_at, timezone.get_current_timezone())
        duration = max(int(record.duration_minutes or 60), 1)
        return start_at + timedelta(minutes=duration)
