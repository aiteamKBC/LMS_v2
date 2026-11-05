"""Prepare calendar indexes from saved snapshots, with no Microsoft I/O."""
from django.core.management.base import BaseCommand, CommandError
from django.db import router, transaction

from coach_api.models import CoachingRecordingJob
from coach_api.recordings_api import _coaches, _parameters
from coach_api.recordings_index import publish_calendar_index


class Command(BaseCommand):
    help = 'Index saved coach calendars in an explicit date range; never fetch Microsoft or video.'

    def add_arguments(self, parser):
        scope = parser.add_mutually_exclusive_group(required=True)
        scope.add_argument('--coach-email')
        scope.add_argument('--all-coaches', action='store_true')
        parser.add_argument('--start', required=True)
        parser.add_argument('--end', required=True)
        parser.add_argument('--time-zone', default='Europe/London')
        parser.add_argument('--limit', type=int, default=100)
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **options):
        try:
            start, end, *_ = _parameters({'start': options['start'], 'end': options['end'],
                                         'timeZone': options['time_zone']})
        except (TypeError, ValueError, KeyError) as error:
            raise CommandError('Choose a valid time zone and an inclusive range of at most 31 days.') from error
        limit = options['limit']
        if not 1 <= limit <= 500:
            raise CommandError('Limit must be between 1 and 500 saved windows.')
        coaches = {row['email'] for row in _coaches()}
        owner = (options.get('coach_email') or '').strip().casefold()
        if owner:
            if owner not in coaches:
                raise CommandError('Choose a registered LMS coach.')
            coaches = {owner}
        elif not options.get('all_coaches'):
            raise CommandError('Choose one coach or explicitly select all coaches.')
        database = router.db_for_write(CoachingRecordingJob) or 'default'
        source = CoachingRecordingJob.objects.using(database).filter(kind='calendar', owner_email__in=coaches,
            last_success_at__isnull=False, context__start__lt=end.isoformat(), context__end__gt=start.isoformat())
        keys = list(source.order_by('key').values_list('key', flat=True)[:limit + 1])
        if len(keys) > limit:
            raise CommandError('Saved windows exceed the limit. Narrow the coach/date scope or increase --limit.')
        if options['dry_run']:
            self.stdout.write(f'DRY RUN: {len(keys)} saved calendar windows; no Microsoft calls or writes.')
            return
        windows, meetings = 0, 0
        for key in keys:
            # Serialize with job completion and rebuild from its current complete
            # generation. Source snapshots and historical evidence are untouched.
            with transaction.atomic(using=database):
                job = source.select_for_update().filter(pk=key).first()
                if job is None:
                    continue
                if job.context.get('owner') != job.owner_email:
                    raise CommandError('Saved calendar owner mismatch; projection was not replaced.')
                if not isinstance(job.result.get('events'), list):
                    raise CommandError('Saved calendar is incomplete; projection was not replaced.')
                meetings += publish_calendar_index(job.key, job.context, job.result['events'],
                    job.last_success_at, using=database)
                windows += 1
        self.stdout.write(f'Indexed {meetings} meetings in {windows} saved windows; no Microsoft calls.')
