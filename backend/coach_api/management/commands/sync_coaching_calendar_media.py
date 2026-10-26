"""Import external coaching calendar evidence without creating bookings or invitations."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections

from coach_api.recordings_api import _bookings, _coaches, _learners, _parameters
from coach_api.recordings_calendar import compare_coach_calendar, load_coach_calendar
from coach_api.recordings_calendar_media import event_context
from coach_api.recordings_calendar_sync import CalendarMeetingWithoutTeams, sync_calendar_event
from coach_api.recordings_errors import calendar_failure


class Command(BaseCommand):
    help = 'Discover completed external coach calendar metadata and actual attendance; recordings stay in SharePoint.'

    def add_arguments(self, parser):
        parser.add_argument('--coach-email', default='')
        parser.add_argument('--all-coaches', action='store_true')
        parser.add_argument('--start', default='', help='First local date, YYYY-MM-DD.')
        parser.add_argument('--end', default='', help='Last local date, inclusive; maximum 31 days.')
        parser.add_argument('--recent-days', type=int, default=0, help='Rolling local date window, 1..31 days; use instead of --start/--end for scheduled recovery.')
        parser.add_argument('--time-zone', default='Europe/London')
        parser.add_argument('--offset', type=int, default=0)
        parser.add_argument('--limit', type=int, default=0, help='0 processes the whole selected range. A limited pass reports the next offset and exits incomplete.')
        parser.add_argument('--metadata-only', action='store_true', help='Compatibility option; all runs save metadata only and never transfer recordings.')
        parser.add_argument('--dry-run', action='store_true', help='Validate the authorised LMS coach/date scope only, without Graph calls or writes.')

    def handle(self, *args, **options):
        owner = options['coach_email'].strip().casefold()
        if bool(owner) == bool(options['all_coaches']) or options['offset'] < 0 or options['limit'] < 0:
            raise CommandError('Choose one coach or --all-coaches and non-negative paging values.')
        try:
            first, last = options['start'], options['end']
            recent = options.get('recent_days', 0)
            if recent:
                if not 1 <= recent <= 31 or first or last:
                    raise ValueError()
                today = datetime.now(timezone.utc).astimezone(ZoneInfo(options['time_zone'])).date()
                first, last = (today - timedelta(days=recent - 1)).isoformat(), today.isoformat()
            start, end, *_ = _parameters({'start': first, 'end': last, 'timeZone': options['time_zone']})
        except (ValueError, TypeError, KeyError, OverflowError):
            raise CommandError('Choose a valid explicit local date range of at most 31 days and time zone.') from None
        coaches = [row for row in _coaches() if not owner or row['email'] == owner]
        if owner and not coaches:
            raise CommandError('The selected mailbox is not an authorised LMS coach.')
        if options['dry_run']:
            self.stdout.write(f'Dry run: {len(coaches)} authorised coach calendar(s); no Microsoft reads or writes performed.')
            return
        candidates, failures = [], 0
        now = datetime.now(timezone.utc)
        for coach in coaches:
            try:
                events = load_coach_calendar(coach['email'], start, end)
                result = compare_coach_calendar(events, _bookings(coach['email'], start, end), _learners(coach['email']),
                    coach_email=coach['email'], start=start, end=end, now=now)
                if not result['complete']:
                    raise ValueError('Incomplete calendar; scope cannot be verified.')
                external = {(row['calendarEventId'], row['startsAt'], row['endsAt']) for row in result['meetings']
                            if row['match'] != 'matched' and row['phase'] == 'ended'}
                for event in events:
                    context = event_context(coach['email'], event)
                    if (context['event'], context['start'], context['end']) in external:
                        candidates.append((coach, event))
                        external.remove((context['event'], context['start'], context['end']))
            except Exception as error:
                failures += 1
                self.stderr.write(f'Calendar unavailable: {calendar_failure(error)["code"]}. No missing meetings inferred.')
            finally:
                close_old_connections()
        candidates.sort(key=lambda item: (event_context(item[0]['email'], item[1])['start'], item[0]['email'], item[1]['id']))
        offset, limit = options['offset'], options['limit']
        page = candidates[offset:offset + limit] if limit else candidates[offset:]
        archived = existing = stored = skipped = 0
        for coach, event in page:
            try:
                counts = sync_calendar_event(coach['email'], event, archive=False, owner_name=coach['name'])
                stored += 1
                archived += counts['archived']
                existing += counts['existing']
            except CalendarMeetingWithoutTeams:
                skipped += 1
            except Exception as error:
                failures += 1
                self.stderr.write(f'Calendar meeting evidence unavailable: {type(error).__name__}. Retry the same scope to recover.')
            finally:
                close_old_connections()
        next_offset = offset + len(page)
        self.stdout.write(f'Stored={stored}; archived={archived}; existing={existing}; without_teams={skipped}; failed={failures}.')
        if next_offset < len(candidates):
            raise CommandError(f'Incomplete range: rerun with --offset {next_offset}, or --limit 0 for the whole range.')
        if failures:
            raise CommandError('Some calendars or meetings could not be synchronised; saved evidence was retained. Retry the same range.')
