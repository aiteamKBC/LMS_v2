from datetime import timedelta

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.utils import timezone

from coach_api.views import has_graph_credentials
from curriculum_api.models import LiveSessionOccurrence


class Command(BaseCommand):
    help = (
        'Pull Microsoft Teams attendance, transcripts and recordings for '
        'meetings that ended recently. Run this command every five minutes.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--lookback-hours',
            type=int,
            default=24,
            help='Retry meetings that ended within this many hours (default: 24).',
        )
        parser.add_argument(
            '--limit',
            type=int,
            default=100,
            help='Maximum number of meeting series to sync in one run (default: 100).',
        )
        parser.add_argument(
            '--live-session-id',
            action='append',
            dest='live_session_ids',
            default=[],
            help='Sync only this live-session series. May be supplied more than once.',
        )
        parser.add_argument(
            '--skip-coach-meetings',
            action='store_true',
            help='Only sync curriculum live sessions; skip MCM/PR/catch-up coach meeting snapshots.',
        )
        parser.add_argument(
            '--coach-limit',
            type=int,
            default=100,
            help='Maximum number of recently ended coach meetings to sync in one run (default: 100).',
        )

    def handle(self, *args, **options):
        if not has_graph_credentials():
            raise CommandError('Microsoft Graph credentials are not configured.')

        lookback_hours = max(1, int(options['lookback_hours']))
        limit = max(1, int(options['limit']))
        coach_limit = max(1, int(options['coach_limit']))
        requested_ids = [value.strip() for value in options['live_session_ids'] if value.strip()]
        now = timezone.now()
        should_sync_coach_meetings = not options['skip_coach_meetings'] and not requested_ids

        queryset = LiveSessionOccurrence.objects.filter(
            scheduled_end__lte=now,
            scheduled_end__gte=now - timedelta(hours=lookback_hours),
        )
        if requested_ids:
            queryset = queryset.filter(live_session_id__in=requested_ids)

        # A series may contain several occurrences. Sync it once: the existing
        # endpoint asks Graph for every meeting/occurrence group and upserts all
        # returned rows using stable ids, so retries are safe and idempotent.
        live_session_ids = list(dict.fromkeys(
            queryset.order_by('scheduled_end').values_list('live_session_id', flat=True)
        ))[:limit]
        # The existing scheduler entrypoint also drains UI-requested jobs.
        # One lease protects a series across concurrent command invocations.
        with connections['default'].cursor() as cursor:
            for series_id in live_session_ids:
                cursor.execute("""INSERT INTO curriculum.session_result_jobs(live_session_id,force_refresh)
                    VALUES (%s,%s) ON CONFLICT(live_session_id) DO UPDATE
                    SET state='queued',requested_at=now(),next_attempt_at=now(),attempts=0,force_refresh=EXCLUDED.force_refresh
                    WHERE session_result_jobs.state NOT IN ('queued','running')
                      AND (EXCLUDED.force_refresh OR (session_result_jobs.state='complete'
                           AND session_result_jobs.finished_at<now()-interval '30 minutes'))""",
                    [series_id, bool(requested_ids)])
        try:
            call_command('process_session_results', limit=limit, scheduled=False,
                         stdout=self.stdout, stderr=self.stderr)
        finally:
            if should_sync_coach_meetings:
                self._sync_coach_meeting_snapshots(lookback_hours, coach_limit)

    def _sync_coach_meeting_snapshots(self, lookback_hours: int, limit: int) -> None:
        self.stdout.write('Checking recently ended coach meetings for Teams artifacts and attendance...')
        call_command(
            'sync_coach_meeting_snapshots',
            '--recent',
            '--lookback-hours',
            str(lookback_hours),
            '--limit',
            str(limit),
            '--allow-missing-tables',
            stdout=self.stdout,
            stderr=self.stderr,
        )
