import json
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.test import RequestFactory
from django.utils import timezone

from coach_api.views import has_graph_credentials
from curriculum_api.models import LiveSessionOccurrence
from curriculum_api.views import curriculum_teams_meeting_artifacts


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

    def handle(self, *args, **options):
        if not has_graph_credentials():
            raise CommandError('Microsoft Graph credentials are not configured.')

        lookback_hours = max(1, int(options['lookback_hours']))
        limit = max(1, int(options['limit']))
        requested_ids = [value.strip() for value in options['live_session_ids'] if value.strip()]
        now = timezone.now()

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
        if not live_session_ids:
            self.stdout.write('No recently ended Teams meetings need checking.')
            return

        factory = RequestFactory()
        succeeded = 0
        partial = 0
        failed = 0
        totals = {
            'attendanceReports': 0,
            'attendanceRecords': 0,
            'transcripts': 0,
            'recordings': 0,
            'reportingRows': 0,
        }

        for live_session_id in live_session_ids:
            request = factory.post(
                f'/curriculum/teams-meetings/{live_session_id}/artifacts/',
                data=b'',
                content_type='application/json',
            )
            try:
                response = curriculum_teams_meeting_artifacts(request, live_session_id)
                payload = json.loads(response.content.decode('utf-8'))
            except Exception as exc:  # keep the other series moving
                failed += 1
                self.stderr.write(self.style.ERROR(f'{live_session_id}: {exc}'))
                continue

            if response.status_code >= 300 and response.status_code != 207:
                failed += 1
                self.stderr.write(self.style.ERROR(
                    f'{live_session_id}: HTTP {response.status_code} '
                    f'{payload.get("error") or payload.get("detail") or "sync failed"}'
                ))
                continue

            synced = payload.get('synced') or {}
            for key in totals:
                totals[key] += int(synced.get(key) or 0)
            if payload.get('partial'):
                partial += 1
                self.stderr.write(self.style.WARNING(
                    f'{live_session_id}: partial sync; ' + '; '.join(payload.get('errors') or [])
                ))
            else:
                succeeded += 1

        self.stdout.write(self.style.SUCCESS(
            'Teams artifact sync finished: '
            f'{succeeded} succeeded, {partial} partial, {failed} failed; '
            f'{totals["attendanceRecords"]} attendance records, '
            f'{totals["transcripts"]} transcripts, '
            f'{totals["recordings"]} recordings, '
            f'{totals["reportingRows"]} learner reporting rows.'
        ))
        if failed:
            raise CommandError(f'{failed} Teams meeting series failed to sync.')
