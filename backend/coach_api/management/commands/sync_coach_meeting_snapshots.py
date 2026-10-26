from datetime import datetime, time, timedelta

from django.core.management.base import BaseCommand, CommandError
from django.core.exceptions import ObjectDoesNotExist
from django.db import DatabaseError, close_old_connections, router
from django.utils import timezone

from coach_api.models import CoachCalendarEvent
from coach_api.background_meeting_sync import imported_context
from coach_api.migrated_session_scope import (meeting_artifacts, meeting_reports,
                                              snapshot_version, validate_attendance_response)
from coach_api.migrated_intelligence_views import _graph_target_failure
from coach_api.bound_actual_session import BoundSessionConflict, bound_session
from coach_api.views import (
    apply_teams_attendance_status_transition,
    coach_meeting_snapshot_tables_ready,
    fetch_coach_meeting_graph_snapshot,
    persist_coach_meeting_snapshots,
    stored_coach_meeting_snapshot,
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
            help=(
                "Sync coach calendar events whose scheduled meeting time is close to now: "
                "already started (or starting within --lead-minutes) and either still running "
                "or ended within --lookback-hours. Intended for a periodic (e.g. every 5 "
                "minutes) cron/scheduled job -- this is what actually catches a Teams meeting "
                "moving to in-progress shortly after someone joins, not just its final artifacts."
            ),
        )
        parser.add_argument(
            "--lookback-hours",
            type=int,
            default=24,
            help="With --recent, keep syncing a meeting for this many hours after it ended (its attendance "
                 "report/artifacts can take a while to appear). Default: 24.",
        )
        parser.add_argument(
            "--lead-minutes",
            type=int,
            default=10,
            help="With --recent, also sync a meeting starting within this many minutes "
                 "(Teams often allows joining slightly before the scheduled start). Default: 10.",
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
        lead_minutes = options["lead_minutes"]
        dry_run = bool(options["dry_run"])
        allow_missing_tables = bool(options["allow_missing_tables"])

        if not sync_all and not sync_recent and not event_key and not owner_email:
            raise CommandError("Pass --all, --recent, --event-key, or --owner-email so the sync scope is explicit.")
        if limit < 0:
            raise CommandError("--limit must be 0 or greater.")
        if lookback_hours < 1:
            raise CommandError("--lookback-hours must be 1 or greater.")
        if lead_minutes < 0:
            raise CommandError("--lead-minutes must be 0 or greater.")

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
            lead_minutes=lead_minutes,
        )
        if not records:
            self.stdout.write(self.style.WARNING("No coach calendar events matched this sync scope."))
            return

        if dry_run:
            self.stdout.write(self.style.WARNING(f"Dry run: {len(records)} event(s) matched."))
            for record in records:
                try:
                    context = imported_context(record)
                except (DatabaseError, ValueError, ObjectDoesNotExist):
                    self.stdout.write('Skipped meeting: source association could not be verified.')
                    continue
                self.stdout.write(f"APTEM {context['family']}: eligible resource refresh (dry run)."
                                  if context else self._describe_record(record))
            return

        stored = 0
        skipped = 0
        partial = 0
        failed = 0

        for record in records:
            close_old_connections()
            try:
                context = imported_context(record)
            except (DatabaseError, ValueError, ObjectDoesNotExist):
                skipped += 1
                self.stdout.write(self.style.WARNING('Skipped meeting: source association could not be verified.'))
                continue
            if context:
                try:
                    from coach_api.models import ImportedReviewInstance
                    overlay = (ImportedReviewInstance.objects.filter(pk=context['overlayId']).first()
                               if context.get('overlayId') else None)
                    bound = bound_session(record, overlay=overlay) if (
                        context['family'] in {'MCM', 'PR', 'PR_SKILLS_RADAR'} and overlay) else None
                except (BoundSessionConflict, DatabaseError):
                    skipped += 1
                    self.stdout.write(f"APTEM {context['family']}: claimed session changed; refresh skipped.")
                    continue
                previous = stored_coach_meeting_snapshot(record, database=database, safe_diagnostics=True)
                if not (previous.get('storage') or {}).get('stored') or previous.get('partial'):
                    failed += 1
                    self.stdout.write(f"APTEM {context['family']}: snapshot_read_unavailable; no refresh attempted.")
                    continue
                expected_version = snapshot_version(previous)
            options = {'attendance_response_validator': validate_attendance_response,
                       'target_error_handler': _graph_target_failure, 'safe_diagnostics': True} if context else {}
            meeting_target = {}
            meeting_scoped = bool(context and not bound and context['family'] in {
                'MCM', 'PR', 'PR_SKILLS_RADAR'})
            if context and bound:
                from coach_api.actual_session_resolution import strict_imported_meeting_target
                from coach_api.migrated_intelligence_views import _transcript_collection
                from coach_api.migrated_session_scope import select_artifacts
                def owned_target(current):
                    identity = {}
                    base, error = strict_imported_meeting_target(current, identity_out=identity)
                    if not error and base:
                        try:
                            bound_session(current, overlay=overlay, target=identity.get('target'))
                        except BoundSessionConflict:
                            return '', {'code': 'ACTUAL_SESSION_CLAIM_CONFLICT',
                                        'detail': 'Claimed meeting context changed.'}
                    return base, error
                def selected_transcripts(current, attendance, metadata):
                    rows, error = select_artifacts(current,
                        {'attendanceReports': attendance, 'artifacts': metadata}, session=bound.context)
                    return [] if error else [row['graph_artifact_id'] for row in rows
                                             if row.get('artifact_type') == 'transcript']
                options.update(target_resolver=owned_target,
                    transcript_collection_fetcher=_transcript_collection,
                    transcript_content_selector=selected_transcripts,
                    independent_resources=True)
            elif meeting_scoped:
                from coach_api.actual_session_resolution import review_meeting_target
                from coach_api.migrated_intelligence_views import _transcript_collection

                def owned_target(current):
                    return review_meeting_target(current, identity_out=meeting_target)

                def selected_transcripts(current, _reports, metadata):
                    target = meeting_target.get('target')
                    if target is None:
                        return []
                    rows, _error = meeting_artifacts(current, {'artifacts': metadata},
                        target.online_meeting_id, trusted_fetch=True)
                    return [row['graph_artifact_id'] for row in rows
                            if row.get('artifact_type') == 'transcript']

                options.update(target_resolver=owned_target,
                    transcript_collection_fetcher=_transcript_collection,
                    transcript_content_selector=selected_transcripts,
                    independent_resources=True)
            try:
                snapshot, error_payload, status_code = fetch_coach_meeting_graph_snapshot(record, **options)
            except (RuntimeError, TimeoutError, ValueError):
                if context is None:
                    raise
                failed += 1
                self.stdout.write(f"APTEM {context['family']}: refresh failed (resource fetch).")
                continue
            if error_payload:
                if context:
                    failed += 1
                    self.stdout.write(self.style.WARNING(f"APTEM {context['family']}: refresh failed (HTTP {status_code})."))
                    continue
                skipped += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipped {record.event_key}: {error_payload.get('code') or status_code} - "
                        f"{error_payload.get('detail') or 'Microsoft Graph could not return this meeting.'}"
                    )
                )
                continue

            meeting_id = None
            if meeting_scoped:
                target = meeting_target.get('target')
                if target is None:
                    failed += 1
                    self.stdout.write('APTEM meeting target unavailable; refresh skipped.')
                    continue
                meeting_id = target.online_meeting_id
                artifacts, media_error = meeting_artifacts(record, snapshot, meeting_id,
                    trusted_fetch=True)
                reports, report_error = meeting_reports(snapshot,
                    meeting_id=meeting_id, graph_event_id=record.graph_event_id)
                snapshot['artifacts'] = [{**row, 'metadata': {**(row.get('metadata') or {}),
                    '_lms_graph_event_id': record.graph_event_id,
                    '_lms_verified_online_meeting_id': meeting_id}} for row in artifacts]
                snapshot['attendanceReports'] = [{**row, '_lms_graph_event_id': record.graph_event_id,
                    '_lms_verified_online_meeting_id': meeting_id} for row in reports]
                snapshot['partial'] = bool(snapshot.get('partial') or media_error or report_error)
                if media_error or report_error:
                    snapshot.setdefault('errors', []).append(
                        'Some Teams evidence had conflicting identity and was skipped.')

            # This is the primary, cron-friendly path for the scheduled ->
            # in-progress transition: a linked MCM/Progress Review only moves
            # once this sync actually sees a real Teams join, using the
            # attendance records this command already fetched for its own
            # snapshot-persistence purposes below -- no second Graph call.
            if context is None:
                apply_teams_attendance_status_transition(record, (snapshot.get("attendance") or {}).get("records") or [])

            try:
                storage = persist_coach_meeting_snapshots(
                    record,
                    artifacts=snapshot["artifacts"],
                    attendance_reports=snapshot["attendanceReports"],
                    attendance_tracker=snapshot["attendanceTracker"],
                    **({'imported_refresh': {'snapshot': snapshot, 'expected_version': expected_version,
                        'preserve_existing': True, 'context': context,
                        'session': bound.context if context and bound else None,
                        'meeting_id': meeting_id,
                        'revalidate': lambda current: imported_context(current) == context}}
                       if context else {}),
                )
            except (DatabaseError, ValueError, ObjectDoesNotExist):
                if context is None:
                    raise
                storage = {'stored': False, 'reason': 'snapshot_context_unavailable'}
            if not storage.get("stored"):
                reason = storage.get("reason") or "unknown"
                if context and reason in {'snapshot_context_changed', 'snapshot_superseded'}:
                    skipped += 1
                    self.stdout.write(f"APTEM {context['family']}: skipped ({reason}).")
                    continue
                failed += 1
                if reason == "snapshot_tables_missing":
                    raise CommandError(
                        "Snapshot tables are missing on the active database branch. "
                        "Run backend/coach_api/sql/coach_meeting_artifacts_attendance_snapshots.sql first."
                    )
                label = f"APTEM {context['family']}" if context else record.event_key
                self.stdout.write(self.style.ERROR(f"Failed {label}: {reason}"))
                continue

            stored += 1
            if snapshot.get("partial") or storage.get('resourceRefresh') == 'partial':
                partial += 1
            attendance = snapshot["attendance"]
            if context:
                outcome = {'partial': 'partial; incomplete evidence excluded', 'updated': 'updated',
                           'pending': 'pending; previous evidence retained'}[storage['resourceRefresh']]
                self.stdout.write(f"APTEM {context['family']}: resources stored; {outcome}.")
                continue
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
        lead_minutes: int = 10,
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
            lead = timedelta(minutes=max(int(lead_minutes), 0))
            # Widened window (Phase 3): the original condition only matched a
            # meeting that had ALREADY ENDED within --lookback-hours -- fine
            # for "go fetch final artifacts", but it would never catch a
            # meeting still in progress, since its end time is still in the
            # future at the moment someone actually joins. A meeting now
            # qualifies once it has started (within `lead_minutes` early, in
            # case Teams let someone in ahead of the scheduled time) and its
            # end/lookback window hasn't gone stale -- covering "about to
            # start" through "still running" through "recently ended", not
            # just the last of those three.
            queryset = queryset.filter(
                scheduled_date__gte=window_start.date(),
                scheduled_date__lte=(now + lead).date(),
            )
            records = [
                record
                for record in queryset
                if self._event_start_at(record) is not None
                and self._event_start_at(record) - lead <= now
                and self._event_end_at(record) >= window_start
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

    def _event_start_at(self, record: CoachCalendarEvent):
        if not record.scheduled_date:
            return None
        scheduled_time = record.scheduled_time or time(0, 0)
        start_at = datetime.combine(record.scheduled_date, scheduled_time)
        if timezone.is_naive(start_at):
            start_at = timezone.make_aware(start_at, timezone.get_current_timezone())
        return start_at

    def _event_end_at(self, record: CoachCalendarEvent):
        start_at = self._event_start_at(record)
        if start_at is None:
            return None
        duration = max(int(record.duration_minutes or 60), 1)
        return start_at + timedelta(minutes=duration)
