"""Link an existing Teams recurrence to one LMS delivery without editing Teams.

The calendar mailbox may hold only an attendee's copy of the event. Calendar
event IDs from that mailbox are therefore never saved as organizer event IDs.
The Teams onlineMeeting ID, resolved from the real organizer and join URL, is
the identity used by the recording and attendance workers.
"""

import hashlib
import re
import uuid
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction


def _utc_instant(item, field):
    from curriculum_api.teams_weekly_calendar import graph_event_utc
    from curriculum_api.views import parse_graph_datetime

    normalized = graph_event_utc(item)
    parsed = parse_graph_datetime((normalized.get(field) or {}).get('dateTime'))
    if not parsed:
        raise CommandError('Teams returned an occurrence without a valid time.')
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def _matching_instance_dates(instances, module, session_plan):
    """Require one Teams event on each date in the LMS's authoritative plan."""
    first = module.get('start_date')
    last = module.get('end_date')
    count = int(module.get('sessions_number') or 0)
    if not first or not last or not 1 <= count <= 52:
        raise CommandError('The module needs a dated session plan before linking Teams.')
    try:
        expected = [date.fromisoformat(str(item['date'])) for item in session_plan]
    except (KeyError, TypeError, ValueError):
        raise CommandError('The module has an invalid dated session plan.') from None
    actual = [item['start'].date() for item in instances]
    if len(expected) != count or expected[0] != first or expected[-1] > last or expected != actual:
        raise CommandError('Teams dates differ from this module delivery plan; review the module before linking.')


def _select_recurring_event(matches, join_url_sha256=''):
    """Keep ambiguous same-title meetings separate without exposing join URLs."""
    digest = str(join_url_sha256 or '').strip().lower()
    if digest and not re.fullmatch(r'[0-9a-f]{64}', digest):
        raise CommandError('--join-url-sha256 must be the full SHA-256 of a Teams join URL.')
    by_join = {}
    for mailbox, item in matches:
        join_url = str((item.get('onlineMeeting') or {}).get('joinUrl') or '').strip()
        if join_url and (not digest or hashlib.sha256(join_url.encode()).hexdigest() == digest):
            by_join.setdefault(join_url, []).append((mailbox, item))
    if len(by_join) != 1:
        raise CommandError('Expected one distinct recurring Teams meeting; discovery was empty or ambiguous.')
    return next(iter(by_join.values()))[0]


def _conflicting_manual_overrides(rows, join_url):
    """Only explicit, different join links need replacement before attaching."""
    return [(component_id, override) for component_id, override in rows
            if override and override.strip() != join_url]


class Command(BaseCommand):
    help = 'Preview or link one existing Teams recurrence to a dated LMS module. Never creates or changes a Teams event.'

    def add_arguments(self, parser):
        parser.add_argument('--module-id', required=True)
        parser.add_argument('--join-url', help='Review the exact existing Teams join URL using the same checked workflow as Module Builder.')
        parser.add_argument('--week-id', action='append', dest='week_ids', help='Saved week to link; repeat for selected weeks. Defaults to all main live weeks.')
        parser.add_argument('--subject', help='Exact Teams event subject; defaults to the module group name.')
        parser.add_argument('--calendar-mailbox', help='Mailbox holding an attendee copy, if it is not an LMS organizer.')
        parser.add_argument('--join-url-sha256', help='Select one same-title Teams meeting by the SHA-256 of its join URL.')
        parser.add_argument('--replace-manual-link-overrides', action='store_true',
                            help='Replace differing manual join links on this module after verifying the Teams series.')
        parser.add_argument('--apply', action='store_true', help='Save the verified link and queue its recording sync.')

    def handle(self, *args, **options):
        from coach_api.views import get_graph_settings, microsoft_graph_request
        from curriculum_api import views as v
        from curriculum_api.session_graph import collection

        module_id = options['module_id'].strip()
        if options.get('join_url'):
            import json
            from curriculum_api.teams_existing_series import preview, apply, LinkError
            weeks = options.get('week_ids')
            if not weeks:
                rows = v.active_component_rows(v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE,
                    'module_catalogue_id = %s', [module_id]))
                weeks = sorted({row['week_id'] for row in rows if v.replaceable_live_session(row)})
            payload = {'link': options['join_url'], 'weekIds': weeks,
                       'calendarMailbox': options.get('calendar_mailbox') or ''}
            try:
                report = preview(module_id, payload)
                if options.get('apply'):
                    report = apply(module_id, {'previewToken': report['previewToken']})
            except LinkError as exc:
                raise CommandError(str(exc)) from exc
            self.stdout.write(json.dumps({'module': module_id,
                'action': 'linked' if options.get('apply') else 'preview',
                'matched': report['matched'], 'unmatched': report['unmatched'],
                'alreadyLinked': report.get('alreadyLinked', False)}))
            return
        modules = v.authoring_fetch_all(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
        if len(modules) != 1:
            raise CommandError('The requested module was not found.')
        module = modules[0]
        if module.get('deleted_at') or module.get('is_programme_deleted'):
            raise CommandError('The requested module is archived.')
        if not module.get('group_id'):
            raise CommandError('Choose a group delivery module, not a standalone content module.')
        first = module.get('start_date')
        last = module.get('end_date')
        if not first or not last:
            raise CommandError('The module has no dated delivery range.')
        subject = (options.get('subject') or module.get('group_name') or '').strip()
        if not subject:
            raise CommandError('The Teams subject is required.')
        mailboxes = [options.get('calendar_mailbox')]
        if not mailboxes[0]:
            mailboxes.append(v.teams_meeting_default_organizer())
            with connection.cursor() as cursor:
                cursor.execute("SELECT DISTINCT organizer_email FROM curriculum.live_sessions WHERE status='active' AND organizer_email<>''")
                mailboxes.extend(row[0] for row in cursor.fetchall())
        mailboxes = list(dict.fromkeys(mailbox for mailbox in mailboxes if mailbox))
        if not mailboxes:
            raise CommandError('No accessible LMS calendar mailbox is available for discovery.')
        base_url = get_graph_settings()['base_url']
        search = urlencode({
            'startDateTime': f'{first.isoformat()}T00:00:00Z',
            'endDateTime': f'{(first + timedelta(days=1)).isoformat()}T00:00:00Z',
            '$select': 'id,subject,start,end,organizer,onlineMeeting,seriesMasterId,type,isCancelled',
        })
        matches = []
        for candidate in mailboxes:
            candidate_key = quote(candidate, safe='')
            try:
                day_events = collection(microsoft_graph_request,
                    f'users/{candidate_key}/calendarView?{search}', base_url)
            except RuntimeError:
                continue  # A known LMS mailbox can be inaccessible or retired.
            matches.extend((candidate, item) for item in day_events
                if (item.get('subject') or '').strip().casefold() == subject.casefold()
                and not item.get('isCancelled') and item.get('seriesMasterId'))
        mailbox, first_event = _select_recurring_event(matches, options.get('join_url_sha256'))
        mailbox_key = quote(mailbox, safe='')
        master_id = first_event['seriesMasterId']
        try:
            master = microsoft_graph_request('GET',
                f'users/{mailbox_key}/events/{quote(master_id, safe="")}'
                '?$select=id,subject,start,end,organizer,onlineMeeting,recurrence,responseRequested,allowNewTimeProposals,hideAttendees')
        except RuntimeError:
            raise CommandError('Teams did not allow reading the selected recurring event.') from None
        recurrence = master.get('recurrence') or {}
        if (recurrence.get('pattern') or {}).get('type', '').lower() != 'weekly':
            raise CommandError('The Teams event is not a weekly recurrence.')
        organizer = ((master.get('organizer') or {}).get('emailAddress') or {}).get('address', '').strip()
        join_url = ((master.get('onlineMeeting') or {}).get('joinUrl') or '').strip()
        if not organizer or not join_url:
            raise CommandError('The Teams organizer or join link is unavailable.')
        selected_join_url = ((first_event.get('onlineMeeting') or {}).get('joinUrl') or '').strip()
        if join_url != selected_join_url:
            raise CommandError('The selected occurrence and its recurring meeting have different Teams links.')

        instance_query = urlencode({
            'startDateTime': f'{first.isoformat()}T00:00:00Z',
            'endDateTime': f'{(last + timedelta(days=2)).isoformat()}T00:00:00Z',
            '$select': 'id,start,end,type,isCancelled,onlineMeeting,seriesMasterId',
        })
        try:
            raw_instances = collection(microsoft_graph_request,
                f'users/{mailbox_key}/events/{quote(master_id, safe="")}/instances?{instance_query}', base_url)
        except RuntimeError:
            raise CommandError('Teams did not return the complete list of recurring sessions.') from None
        instances = []
        for event in raw_instances:
            if event.get('isCancelled'):
                raise CommandError('The Teams series contains a cancelled session; review before linking.')
            event_join = ((event.get('onlineMeeting') or {}).get('joinUrl') or '').strip()
            if event_join and event_join != join_url:
                raise CommandError('A Teams session uses a different meeting link; review before linking.')
            start = _utc_instant(event, 'start')
            end = _utc_instant(event, 'end')
            if end <= start:
                raise CommandError('A Teams session has an invalid duration.')
            instances.append({'start': start, 'end': end})
        instances.sort(key=lambda item: item['start'])
        if len({item['start'] for item in instances}) != len(instances):
            raise CommandError('Teams returned duplicate session times.')
        _matching_instance_dates(instances, module, v.module_week_session_plan(module))

        try:
            meeting = v.teams_online_meeting_from_join_url(organizer, join_url)
        except RuntimeError:
            raise CommandError('Teams did not allow resolving the meeting behind its join link.') from None
        meeting_id = (meeting or {}).get('id') or ''
        if not meeting_id:
            raise CommandError('The online meeting ID is unavailable; recording sync would fail.')
        owner_id = v.teams_online_meeting_owner_id(organizer, join_url)
        # Probe the same collection used by the recording worker before saving.
        try:
            microsoft_graph_request('GET',
                f'users/{quote(owner_id, safe="")}/onlineMeetings/{quote(meeting_id, safe="")}/recordings?$top=1')
        except RuntimeError:
            raise CommandError('Teams did not allow reading this meeting\'s recordings.') from None

        existing = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [module_id])
        if existing:
            raise CommandError('This module already has a saved Teams series; review it instead of importing another.')
        reused = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'online_meeting_id = %s', [meeting_id])
        if reused:
            raise CommandError('This online meeting is already linked to an LMS module.')
        with connection.cursor() as cursor:
            cursor.execute('''SELECT id, settings_json->>'liveSessionLinkOverride'
                FROM curriculum.components WHERE module_catalogue_id=%s
                  AND type IN ('live-session','live_session') AND deleted_at IS NULL
                  AND coalesce(settings_json->>'liveSessionLinkOverride','')<>'' ''', [module_id])
            manual_links = _conflicting_manual_overrides(cursor.fetchall(), join_url)
        if manual_links and not options.get('replace_manual_link_overrides'):
            raise CommandError('This module has different manual Teams links; review them and pass '
                               '--replace-manual-link-overrides to replace them.')

        series_id = f'LIVE-{uuid.uuid4().hex.upper()}'
        now = datetime.utcnow()
        timezone_name = ((recurrence.get('range') or {}).get('recurrenceTimeZone') or 'GMT Standard Time')
        warnings = [{
            'code': 'external_calendar_read_only',
            'message': 'Linked from an attendee calendar. LMS can read recordings but cannot edit the organizer calendar.',
        }]
        series = {
            'id': series_id, 'module_catalogue_id': module_id, 'module_draft_id': '',
            'module_title': subject, 'provider': 'Microsoft Teams',
            # The ID above belongs to an attendee's mailbox. Saving it as an
            # organizer event ID would make later calendar edits target a 404.
            'online_meeting_id': meeting_id, 'join_url': join_url,
            'meeting_options_url': (meeting or {}).get('meetingOptionsWebUrl') or '',
            'organizer_email': organizer, 'attendees': v.json_db_value([]),
            'presenters': v.json_db_value([]), 'co_organizers': v.json_db_value([]),
            'start_datetime': instances[0]['start'], 'timezone': timezone_name,
            'duration_minutes': int((instances[0]['end'] - instances[0]['start']).total_seconds() / 60),
            'repeat_pattern': 'weekly', 'repeat_occurrences': len(instances),
            'recording': 'record' if (meeting or {}).get('allowRecording') else 'none',
            'meeting_type': 'linked-external', 'status': 'active',
            'warnings': v.json_db_value(warnings), 'calendar_series': v.json_db_value([]),
            'created_at': now, 'updated_at': now,
        }
        occurrences = [{
            'id': f'OCC-{uuid.uuid4().hex.upper()}', 'live_session_id': series_id,
            'session_number': index, 'graph_event_id': '',
            'scheduled_start': item['start'], 'scheduled_end': item['end'],
            'join_url': join_url, 'online_meeting_id': meeting_id,
            'status': 'scheduled', 'created_at': now, 'updated_at': now,
        } for index, item in enumerate(instances, 1)]
        expected_updates, expected_components = v.attach_teams_meeting_to_module_weeks(
            module_id, series, v.live_session_row_to_component_settings(series), occurrences,
            create_missing=True, dry_run=True)
        if expected_updates + expected_components != len(occurrences):
            raise CommandError('The module week structure cannot hold every Teams session exactly once.')
        if not options['apply']:
            self.stdout.write(f'PREVIEW module={module_id} Teams sessions={len(occurrences)} '
                              f'existing live components={expected_updates} new live components={expected_components}; '
                              f'manual links to replace={len(manual_links)}; '
                              'Graph recordings readable; no changes made.')
            return

        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('SELECT module_catalogue_id FROM curriculum.modules WHERE module_catalogue_id=%s FOR UPDATE', [module_id])
                if not cursor.fetchone():
                    raise CommandError('The module disappeared before linking.')
                cursor.execute('SELECT count(*) FROM curriculum.live_sessions WHERE module_catalogue_id=%s OR online_meeting_id=%s',
                               [module_id, meeting_id])
                if cursor.fetchone()[0]:
                    raise CommandError('A Teams series was linked concurrently; no changes made.')
                cursor.execute('''SELECT id, settings_json->>'liveSessionLinkOverride'
                    FROM curriculum.components WHERE module_catalogue_id=%s
                      AND type IN ('live-session','live_session') AND deleted_at IS NULL
                      AND coalesce(settings_json->>'liveSessionLinkOverride','')<>'' FOR UPDATE''', [module_id])
                if sorted(_conflicting_manual_overrides(cursor.fetchall(), join_url)) != sorted(manual_links):
                    raise CommandError('Manual Teams links changed during import; no changes made.')
                if manual_links:
                    cursor.execute('''UPDATE curriculum.components
                        SET settings_json=settings_json-'liveSessionLinkOverride', updated_at=%s
                        WHERE module_catalogue_id=%s AND id=ANY(%s)''',
                        [now, module_id, [component_id for component_id, _override in manual_links]])
                    if cursor.rowcount != len(manual_links):
                        raise CommandError('Manual Teams links changed during import; transaction rolled back.')
            v.authoring_upsert(v.LIVE_SESSIONS_TABLE, ['id'], series)
            for occurrence in occurrences:
                v.authoring_upsert(v.LIVE_SESSION_OCCURRENCES_TABLE, ['id'], occurrence)
            updated, created = v.attach_teams_meeting_to_module_weeks(
                module_id, series, v.live_session_row_to_component_settings(series), occurrences,
                create_missing=True)
            if updated + created != len(occurrences):
                raise CommandError('The week links changed during import; transaction rolled back.')
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO curriculum.session_result_jobs(live_session_id) VALUES (%s) '
                               'ON CONFLICT(live_session_id) DO NOTHING', [series_id])
                cursor.execute('''SELECT count(*) FROM curriculum.live_session_occurrences
                    WHERE live_session_id=%s AND join_url<>'' AND online_meeting_id<>'' ''', [series_id])
                saved_count = cursor.fetchone()[0]
                cursor.execute('''SELECT settings_json->>'teamsOccurrenceId',
                                      settings_json->>'liveSessionUrl', live_sessions_link
                    FROM curriculum.components
                    WHERE module_catalogue_id=%s AND type IN ('live-session','live_session')
                      AND deleted_at IS NULL AND settings_json->>'teamsLiveSessionId'=%s''', [module_id, series_id])
                linked_rows = cursor.fetchall()
            linked_ids = [row[0] for row in linked_rows]
            if (saved_count != len(occurrences)
                    or sorted(linked_ids) != sorted(row['id'] for row in occurrences)
                    or any(row[1] != join_url or row[2] != join_url for row in linked_rows)):
                raise CommandError('The week links failed verification; transaction rolled back.')
        linked_count = len(linked_ids)
        self.stdout.write(f'LINKED module={module_id} series={series_id} '
                          f'sessions={saved_count} week links={linked_count}; recording sync queued.')
