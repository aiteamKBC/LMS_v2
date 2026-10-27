"""Read saved metadata/config only: no workers, Microsoft, email or AI calls."""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from hashlib import sha256
import json
from types import SimpleNamespace
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import router

from coach_api.models import CoachingRecordingJob
from coach_api.recordings_calendar import _window
from coach_api.recordings_index import indexed_calendars
from coach_api.recordings_jobs import source_summary
from coach_api.recordings_saved_evidence import source_dsn


def source_counts(dsn, owner, start, end, first, last):
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    from psycopg.rows import dict_row

    info = conninfo_to_dict(dsn)
    target = sha256(f'{info.get("host", "")}:{info.get("dbname", "")}'.encode()).hexdigest()[:12]
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=3,
                         options='-c default_transaction_read_only=on') as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='5000ms'")
            cursor.execute('''SELECT count(*) AS sessions,
                count(*) FILTER(WHERE meeting_id IS NOT NULL AND meeting_start_time IS NOT NULL) AS linked,
                count(*) FILTER(WHERE ai_status='completed' AND report_ai::jsonb IS NOT NULL
                    AND report_ai::jsonb<>'null'::jsonb) AS completed_reports,
                count(*) FILTER(WHERE has_transcript AND nullif(transcript,'') IS NOT NULL) AS transcripts
                FROM public.dashboard_sessions_cache WHERE lower(trim(case_owner_email))=%s
                AND ((meeting_start_time>=%s AND meeting_start_time<%s)
                    OR (meeting_start_time IS NULL AND planned_date BETWEEN %s AND %s))''',
                [owner, start, end, first, last])
            dashboard = cursor.fetchone()
            cursor.execute('''SELECT count(*) AS sessions,
                count(*) FILTER(WHERE r.ai_status='completed' AND r.report IS NOT NULL
                    AND r.report<>'null'::jsonb) AS completed_reports
                FROM public.all_sessions_cache c LEFT JOIN public.report_ai r ON r.session_id=c.id
                WHERE lower(trim(c.coach_email))=%s AND c.actual_start_at>=%s AND c.actual_start_at<%s''',
                [owner, start, end])
            return {'state': 'available', 'target': target, 'dashboard': dashboard,
                    'allSessions': cursor.fetchone()}


class Command(BaseCommand):
    help = 'Diagnose one coach/date window from saved metadata and the read-only Coaching Session source.'

    def add_arguments(self, parser):
        parser.add_argument('--coach-email', required=True)
        parser.add_argument('--start', required=True)
        parser.add_argument('--end', required=True)
        parser.add_argument('--time-zone', default='Africa/Cairo')

    def handle(self, **options):
        owner = options['coach_email'].strip().casefold()
        try:
            first, last = date.fromisoformat(options['start']), date.fromisoformat(options['end'])
            zone = ZoneInfo(options['time_zone'])
            start, end = _window(datetime.combine(first, time.min, zone).astimezone(timezone.utc),
                datetime.combine(last + timedelta(days=1), time.min, zone).astimezone(timezone.utc))
            if '@' not in owner or len(owner) > 320:
                raise ValueError()
        except (ValueError, OverflowError, ZoneInfoNotFoundError):
            raise CommandError('Choose one coach email and an inclusive date range of at most 31 days in a valid time zone.') from None
        alias = router.db_for_read(CoachingRecordingJob) or 'default'
        database = settings.DATABASES[alias]
        target = sha256(f'{database.get("HOST", "")}:{database.get("NAME", "")}'.encode()).hexdigest()[:12]
        # Do not call calendar_snapshots/ensure_jobs: diagnostics must not enqueue
        # work, reset retries or change the retained snapshot generation.
        saved = (CoachingRecordingJob.objects.filter(kind='calendar', owner_email=owner,
            last_success_at__isnull=False, context__start__lte=start.isoformat(), context__end__gte=end.isoformat())
            .defer('result').order_by('-last_success_at').first())
        events = indexed_calendars([saved], start, end) if saved else {}
        media = list(CoachingRecordingJob.objects.filter(kind='evidence', owner_email=owner,
            context__start__lt=end.isoformat(), context__end__gt=start.isoformat())
            .values('state', 'error_code', 'last_success_at', 'result__artifacts', 'result__noTeams')[:1001])
        counts = Counter()
        for row in media[:1000]:
            summary = source_summary(SimpleNamespace(error_code=row['error_code'], last_success_at=row['last_success_at'],
                result={'artifacts': row['result__artifacts'] or [], 'noTeams': row['result__noTeams']}))
            label = 'ready' if summary['readyCount'] else summary['check'].get('reason', summary['check']['state'])
            counts[label] += 1
        dsn = source_dsn()
        source = {'state': 'disabled', 'hint': 'Check COACHING_SESSIONS_DATABASE_URL and test-branch flags in this serving environment.'}
        if dsn:
            try:
                source = source_counts(dsn, owner, start, end, first, last)
            except Exception as error:
                # Never print exceptions containing DSNs, SQL or learner data.
                source = {'state': 'unavailable', 'errorType': type(error).__name__}
        report = {'lmsTarget': target, 'start': str(first), 'end': str(last), 'timeZone': options['time_zone'],
            'calendar': {'state': 'indexed' if saved and saved.key in events else 'not-indexed',
                'lastSuccessfulAt': saved.last_success_at.isoformat() if saved else None,
                'eventCount': len(events[saved.key]) if saved and saved.key in events else None,
                'errorCode': saved.error_code if saved else None},
            'recordingChecks': dict(counts), 'recordingChecksTruncated': len(media) > 1000, 'source': source}
        self.stdout.write(json.dumps(report, sort_keys=True))
