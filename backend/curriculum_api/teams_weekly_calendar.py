"""Several Graph series behind one module calendar, with an explicit link per session."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo
import uuid

from django.http import JsonResponse


def graph_event_utc(event):
    """Graph DateTimeTimeZone values are instants, including non-UTC responses."""
    from . import views as v
    event = dict(event)
    for field in ('start', 'end'):
        value = event.get(field) or {}
        instant = v.parse_graph_datetime(value.get('dateTime'))
        if not instant:
            continue
        if instant.tzinfo is None:
            name = value.get('timeZone') or 'UTC'
            zone = v.GRAPH_WINDOWS_TO_IANA.get(name, name)
            instant = instant.replace(tzinfo=ZoneInfo(zone))
        event[field] = {'dateTime': instant.astimezone(timezone.utc).isoformat(), 'timeZone': 'UTC'}
    return event


def calendar_groups(payload, graph_settings):
    from . import views as v
    mode = payload.get('seriesMode') or 'auto'
    if mode not in ('auto', 'shared', 'per_day'):
        raise ValueError('Choose a shared series or a separate series for each day.')
    zone = ZoneInfo(v.graph_timezone_iana(graph_settings))
    items = payload.get('scheduledOccurrences') or []
    if not items:
        return []
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise ValueError('Scheduled occurrences must be a list of sessions.')
    groups, clocks, numbers = {}, set(), set()
    for item in items:
        start = v.parse_graph_datetime(item.get('startDateTimeUtc'))
        number = int(item.get('sessionNumber') or 0)
        duration = int(item.get('durationMinutes') or payload.get('durationMinutes') or 60)
        if not start or number < 1 or number in numbers or not 15 <= duration <= 1440:
            raise ValueError('Each scheduled session needs a unique number, valid start and duration.')
        numbers.add(number)
        local = start.replace(tzinfo=start.tzinfo or timezone.utc).astimezone(zone)
        day = local.strftime('%A')
        clocks.add((local.strftime('%H:%M'), duration))
        groups.setdefault(day, []).append({**item, 'sessionNumber': number, 'durationMinutes': duration,
                                          'startDateTimeUtc': local.astimezone(timezone.utc).isoformat()})
    if mode == 'shared' and len(clocks) > 1:
        raise ValueError('A shared Teams series requires the same start time and duration on every day. Choose separate series per day.')
    if mode != 'per_day' and len(clocks) <= 1:
        return []
    return [(day, sorted(items, key=lambda item: item['startDateTimeUtc'])) for day, items in groups.items()]


def stored_calendar_series(series):
    from . import views as v
    return v.parse_json_value((series or {}).get('calendar_series'), []) or []


def save_weekday_calendar(payload, graph_settings, series=None):
    """Create/update each weekday master, then read Graph before reporting tracked times.

    The manifest is saved after each Graph write. A partial failure can be retried
    through the existing update endpoint without creating the successful days again.
    """
    from coach_api.views import microsoft_graph_request
    from . import views as v
    series = series or {}
    if not v.has_column(v.LIVE_SESSIONS_TABLE, 'calendar_series'):
        return v.json_error('Apply curriculum migration 0063 before creating separate Teams series.', status=409)
    existing = stored_calendar_series(series)
    combined = {
        'organizerEmail': series.get('organizer_email'),
        'attendees': v.teams_series_email_list(series.get('attendees')),
        'presenters': v.teams_series_email_list(series.get('presenters')),
        'coOrganizers': v.teams_series_email_list(series.get('co_organizers')),
        'recording': series.get('recording'), 'lobbyBypass': series.get('lobby_bypass'),
        'spokenLanguage': series.get('spoken_language'), 'meetingType': series.get('meeting_type'),
        'moduleCatalogueId': series.get('module_catalogue_id'),
        **payload,
    }
    # An existing calendar always belongs to its stored organizer's mailbox.
    organizer = v.clean_str(series.get('organizer_email')) or v.teams_new_meeting_organizer(combined.get('organizerEmail'))
    if not organizer:
        return v.json_error('Organizer email is required.')
    combined['organizerEmail'] = organizer
    if existing:
        # Keep the established day links even if their clocks now happen to match.
        combined['seriesMode'] = 'per_day'
    try:
        groups = calendar_groups(combined, graph_settings)
        if not groups:
            return v.json_error('No weekday sessions were supplied.')
        prepared = []
        zone = ZoneInfo(v.graph_timezone_iana(graph_settings))
        for day, items in groups:
            first = v.parse_graph_datetime(items[0]['startDateTimeUtc'])
            local = first.replace(tzinfo=first.tzinfo or timezone.utc).astimezone(zone).replace(tzinfo=None)
            day_payload = {
                **combined, 'scheduledOccurrences': items,
                'startDateTimeUtc': items[0]['startDateTimeUtc'],
                'localStartDateTime': local.isoformat(),
                'durationMinutes': items[0]['durationMinutes'],
                'repeat': 'weekly' if len(items) > 1 else 'none', 'repeatOccurrences': len(items),
                'transactionId': f"{combined.get('transactionId') or 'TEAMS-' + str(combined.get('moduleCatalogueId') or series.get('id'))}-{day}",
            }
            event_body, attendees, presenters, co_organizers, start, duration, repeat, count = v.teams_event_payload(day_payload, graph_settings)
            event_body['start'] = {'dateTime': local.isoformat(timespec='seconds'), 'timeZone': graph_settings.get('timezone') or 'GMT Standard Time'}
            event_body['end'] = {'dateTime': (local + timedelta(minutes=duration)).isoformat(timespec='seconds'), 'timeZone': event_body['start']['timeZone']}
            span = (v.parse_graph_datetime(items[-1]['startDateTimeUtc']).astimezone(zone).date() - local.date()).days // 7 + 1
            event_body['recurrence'] = v.teams_event_recurrence(repeat, local, span, [day.lower()])
            if event_body['recurrence']:
                event_body['recurrence']['range']['recurrenceTimeZone'] = event_body['start']['timeZone']
            prepared.append((day, day_payload, event_body, attendees, presenters, co_organizers))
        if co_organizers and not v.has_column(v.LIVE_SESSIONS_TABLE, 'co_organizers'):
            return v.json_error('The co-organizers schema must be applied before creating this meeting.', status=409)
    except (TypeError, ValueError, KeyError) as exc:
        return v.json_error(str(exc), status=400)

    owner = quote(organizer, safe='')
    live_id = v.clean_str(series.get('id'))
    manifest = list(existing)
    warnings, settings_applied = [], True
    first_event = None
    tracked_numbers = set()
    try:
        for index, (day, day_payload, body, attendees, presenters, co_organizers) in enumerate(prepared):
            previous = next((item for item in manifest if item.get('day') == day), {})
            # When splitting a legacy calendar, keep its first link for the first day.
            if not previous and not existing and series and index == 0:
                previous = {'eventId': series.get('graph_event_id'), 'joinUrl': series.get('join_url'), 'onlineMeetingId': series.get('online_meeting_id')}
            event_id = v.clean_str(previous.get('eventId'))
            if event_id:
                patch = {key: value for key, value in body.items() if key not in ('transactionId', 'isOnlineMeeting', 'onlineMeetingProvider')}
                event = microsoft_graph_request('PATCH', f'users/{owner}/events/{quote(event_id, safe="")}', payload=patch) or {}
                event = {**event, 'id': event_id}
            else:
                event = microsoft_graph_request('POST', f'users/{owner}/events', payload=body)
                event_id = v.clean_str(event.get('id'))
            if not event_id:
                raise RuntimeError(f'Microsoft Graph did not return the {day} event identifier.')
            if not (event.get('onlineMeeting') or {}).get('joinUrl'):
                event = microsoft_graph_request('GET', f'users/{owner}/events/{quote(event_id, safe="")}')
            join_url = v.clean_str((event.get('onlineMeeting') or {}).get('joinUrl')) or v.clean_str(previous.get('joinUrl'))
            entry = {**previous, 'day': day, 'eventId': event_id, 'joinUrl': join_url, 'verified': False,
                     'sessionNumbers': [item['sessionNumber'] for item in day_payload['scheduledOccurrences']]}
            manifest = [item for item in manifest if item.get('day') != day] + [entry]
            if not live_id:
                # Do not manufacture tracked occurrences before Graph confirms them.
                live_id, _ = v.persist_live_session_series(
                    {**combined, 'scheduledOccurrences': [], 'repeat': 'none'}, event, [], graph_settings,
                    organizer, attendees, presenters, co_organizers=co_organizers, persist_occurrences=False,
                )
            v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], {'calendar_series': v.json_db_value(manifest)})
            if first_event is None:
                first_event = event
            applied, meeting, option_warnings = v.apply_teams_meeting_options(
                organizer, join_url, recording=combined.get('recording') or 'none',
                lobby_bypass=combined.get('lobbyBypass') or 'invited', spoken_language=combined.get('spokenLanguage') or 'en-GB',
                attendees=attendees, presenters=presenters, co_organizers=co_organizers,
                online_meeting_id=previous.get('onlineMeetingId'),
            )
            settings_applied = settings_applied and applied
            entry['onlineMeetingId'] = v.clean_str(meeting.get('id')) or v.clean_str(previous.get('onlineMeetingId'))
            entry['meetingOptionsUrl'] = v.clean_str(meeting.get('meetingOptionsWebUrl'))
            warnings.extend(option_warnings)
            targets = v.teams_shifted_occurrence_targets(day_payload, day_payload['durationMinutes'])
            if day_payload['repeat'] != 'none':
                shift_warnings, _ = v.apply_teams_occurrence_shifts(owner, quote(event_id, safe=''), body['subject'], targets, attendees)
                warnings.extend(shift_warnings)
                query = urlencode({'startDateTime': (min(item['start'] for item in targets) - timedelta(days=7)).isoformat(),
                                   'endDateTime': (max(item['end'] for item in targets) + timedelta(days=7)).isoformat(), '$top': 200})
                instances = (microsoft_graph_request('GET', f'users/{owner}/events/{quote(event_id, safe="")}/instances?{query}') or {}).get('value') or []
            else:
                instances = [event]
            available = [graph_event_utc(item) for item in instances]
            verified = bool(join_url)
            for target in targets:
                match = next((item for item in available if v.teams_calendar_minute_key((item.get('start') or {}).get('dateTime')) == v.teams_calendar_minute_key(target['start'])), None)
                if not match:
                    verified = False
                    warnings.append({'code': 'teams_weekday_session_unverified', 'message': f"{day} session {target['session_number']} could not be verified on Teams. Update the calendar to retry."})
                    continue
                available.remove(match)
                number = target['session_number']
                tracked_numbers.add(number)
                prior = (v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s and session_number = %s', [live_id, number]) or [{}])[0]
                v.authoring_upsert(v.LIVE_SESSION_OCCURRENCES_TABLE, ['live_session_id', 'session_number'], {
                    'id': prior.get('id') or f'OCC-{uuid.uuid4().hex.upper()}', 'live_session_id': live_id, 'session_number': number,
                    'graph_event_id': match.get('id') or event_id,
                    'scheduled_start': v.parse_graph_datetime((match.get('start') or {}).get('dateTime')),
                    'scheduled_end': v.parse_graph_datetime((match.get('end') or {}).get('dateTime')),
                    'join_url': join_url, 'online_meeting_id': entry['onlineMeetingId'],
                    'status': prior.get('status') if prior.get('status') == 'completed' else 'scheduled', 'updated_at': datetime.utcnow(),
                })
                if v.teams_calendar_minute_key((match.get('end') or {}).get('dateTime')) != v.teams_calendar_minute_key(target['end']):
                    verified = False
                    warnings.append({'code': 'teams_weekday_duration_mismatch', 'message': f"{day} session {number} has a different end time on Teams. Update the calendar to retry."})
            entry['verified'] = verified
            v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], {'calendar_series': v.json_db_value(manifest)})

        days = {day for day, _ in groups}
        for old in list(manifest):
            if old['day'] not in days:
                microsoft_graph_request('DELETE', f'users/{owner}/events/{quote(old["eventId"], safe="")}')
                manifest.remove(old)
                v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], {'calendar_series': v.json_db_value(manifest)})
        requested_numbers = {item['sessionNumber'] for _, items in groups for item in items}
        for row in v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_id]):
            if row['session_number'] not in requested_numbers:
                v.update_authoring_rows(v.LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [row['id']], {'status': 'cancelled'})
        main = next(item for item in manifest if item['day'] == groups[0][0])
        v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], {
            'calendar_series': v.json_db_value(manifest), 'graph_event_id': main['eventId'],
            'join_url': main['joinUrl'], 'online_meeting_id': main.get('onlineMeetingId') or '',
            'meeting_options_url': main.get('meetingOptionsUrl') or '',
            'start_datetime': v.parse_graph_datetime(combined.get('startDateTimeUtc')),
            'duration_minutes': combined.get('durationMinutes') or 60, 'repeat_pattern': 'weekly',
            'repeat_occurrences': len(requested_numbers), 'module_title': v.teams_calendar_subject(combined, series),
            'attendees': v.json_db_value(attendees), 'presenters': v.json_db_value(presenters), 'co_organizers': v.json_db_value(co_organizers),
            'warnings': v.json_db_value(warnings), 'updated_at': datetime.utcnow(),
        })
        module_id = combined.get('moduleCatalogueId')
        if module_id and v.authoring_module_exists(module_id):
            saved = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id])[0]
            occurrences = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, "live_session_id = %s and status <> 'cancelled'", [live_id], 'session_number')
            v.attach_teams_meeting_to_module_weeks(module_id, saved, v.live_session_row_to_component_settings(saved), occurrences)
    except RuntimeError as exc:
        return v.json_error('Teams could not finish every weekday series. Update this calendar to retry the remaining work.',
                            status=502, detail=str(exc), liveSessionId=live_id, partial=bool(live_id), calendarSeries=manifest)

    meeting_result = {
        'liveSessionId': live_id, 'eventId': main['eventId'], 'joinUrl': main['joinUrl'],
        'onlineMeetingId': main.get('onlineMeetingId') or '', 'meetingOptionsUrl': main.get('meetingOptionsUrl') or '',
        'webLink': (first_event or {}).get('webLink') or '', 'organizerEmail': organizer,
        'attendees': attendees, 'presenters': presenters, 'coOrganizers': co_organizers,
        'startDateTimeUtc': combined.get('startDateTimeUtc'), 'durationMinutes': combined.get('durationMinutes'),
        'repeat': 'weekly', 'repeatOccurrences': len(requested_numbers), 'trackedOccurrences': len(tracked_numbers),
        'settingsApplied': settings_applied, 'trackingReady': all(item.get('onlineMeetingId') for item in manifest),
        'provider': 'Microsoft Teams', 'calendarSeries': manifest,
    }
    if not series:
        return JsonResponse({'created': True, 'meeting': meeting_result, 'warnings': [item.get('message') or str(item) for item in warnings]}, status=201)
    return JsonResponse({'updated': True, 'meeting': meeting_result, 'warnings': warnings})
