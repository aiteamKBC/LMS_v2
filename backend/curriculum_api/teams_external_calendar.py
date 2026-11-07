"""Attach an imported calendar's existing occurrences to authored delivery dates.

This module never writes to Microsoft or changes an occurrence. Attendance and
artifacts remain attached to their original occurrence identities.
"""
from datetime import datetime, timedelta, timezone
import json
from zoneinfo import ZoneInfo


OFF_CALENDAR = {'cancelled', 'canceled', 'declined', 'deleted', 'removed', 'superseded', 'failed'}


def text(value):
    return str(value or '').strip()


def meeting_settings(settings):
    """Recover older meeting metadata before deciding which calendar owns it."""
    settings = settings if isinstance(settings, dict) else {}
    legacy = settings.get('legacySettings')
    if isinstance(legacy, str):
        try:
            legacy = json.loads(legacy)
        except (TypeError, ValueError):
            legacy = {}
    return {**(legacy if isinstance(legacy, dict) else {}), **settings}


def external_main_calendar(settings_list=(), series=None):
    """Whether main delivery already uses a meeting the LMS must not replace.

    A pasted link without a tracked series still names an existing meeting.
    Additional meetings have their own owner and never prevent a main booking.
    """
    series = series or {}
    if text(series.get('meeting_type')) == 'linked-external':
        return True
    for raw in settings_list:
        settings = meeting_settings(raw)
        if text(settings.get('extraTeamsMeetingUrl')) or text(settings.get('teamsMeetingScope')).lower() == 'additional':
            continue
        override = text(settings.get('liveSessionLinkOverride'))
        if override and override != text(series.get('join_url')):
            return True
        if not series and (override or text(settings.get('liveSessionUrl')) or text(settings.get('teamsMeetingUrl'))):
            return True
    return False


def instant(value):
    if not value:
        return None
    if not isinstance(value, datetime):
        value = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return value.replace(tzinfo=value.tzinfo or timezone.utc)


def external_calendar_settings(settings, series, planned, occurrences, claimed, time_zone):
    """Return delivery fields for one MAIN component of a linked external series.

    Match the current week's date, not the component's obsolete session number.
    A pasted override for a different meeting must never acquire this series'
    identity. An absent or ambiguous occurrence remains visibly unconfirmed.
    """
    join_url = text(settings.get('liveSessionLinkOverride')) or text(series.get('join_url'))
    if not join_url or join_url != text(series.get('join_url')):
        return None
    zone = ZoneInfo(time_zone)
    day = text((planned or {}).get('date'))[:10]
    matches = []
    for row in occurrences:
        if text(row.get('status')).lower() in OFF_CALENDAR:
            continue
        if text(row.get('join_url')) != join_url:
            continue
        start = instant(row.get('scheduled_start'))
        if start and start.astimezone(zone).date().isoformat() == day:
            matches.append(row)
    # Two deliveries on one date are legitimate. Their local clock can
    # disambiguate them; never resolve a duplicate simply by list position.
    if len(matches) > 1 and text((planned or {}).get('startTime')):
        at_clock = [row for row in matches if instant(row.get('scheduled_start')).astimezone(zone).strftime('%H:%M')
                    == text(planned['startTime'])[:5]]
        if len(at_clock) == 1:
            matches = at_clock
    matched = matches[0] if len(matches) == 1 and text(matches[0].get('id')) not in claimed else None
    result = {
        'liveSessionUrl': join_url, 'teamsMeetingUrl': join_url,
        'teamsLiveSessionId': text(series.get('id')),
        'teamsMeetingType': 'linked-external', 'sessionTimeZone': time_zone,
        'teamsOccurrenceId': '', 'teamsSessionNumber': 0, 'teamsEventId': '',
        'teamsOnlineMeetingId': '', 'teamsStartDateTimeUtc': '',
        'sessionDateTimeUtc': '', 'sessionDate': day,
        'sessionDay': '', 'sessionTime': text((planned or {}).get('startTime')),
        'teamsCalendarBinding': 'ambiguous' if matches else 'missing',
    }
    if day:
        planned_start = datetime.fromisoformat(day + 'T' + (result['sessionTime'] or '00:00')).replace(tzinfo=zone)
        result['sessionDay'] = planned_start.strftime('%A')
        if result['sessionTime']:
            result['sessionDateTimeUtc'] = planned_start.astimezone(timezone.utc).isoformat()
    if not matched:
        return result
    start = instant(matched.get('scheduled_start'))
    end = instant(matched.get('scheduled_end'))
    local = start.astimezone(zone)
    result.update({
        'teamsOccurrenceId': text(matched.get('id')),
        'teamsSessionNumber': int(matched.get('session_number') or 0),
        'teamsEventId': text(matched.get('graph_event_id')),
        'teamsOnlineMeetingId': text(matched.get('online_meeting_id')) or text(series.get('online_meeting_id')),
        'teamsStartDateTimeUtc': start.astimezone(timezone.utc).isoformat(),
        'sessionDateTimeUtc': start.astimezone(timezone.utc).isoformat(),
        'sessionDate': local.date().isoformat(), 'sessionDay': local.strftime('%A'),
        'sessionTime': local.strftime('%H:%M'), 'teamsCalendarBinding': 'matched',
    })
    if end and end > start:
        minutes = int((end - start) / timedelta(minutes=1))
        result.update(durationMinutes=minutes, teamsDurationMinutes=minutes)
    claimed.add(text(matched.get('id')))
    return result


UNVERIFIED_IDENTITY_KEYS = {
    'teamsLiveSessionId', 'teamsOccurrenceId', 'teamsSessionNumber',
    'teamsEventId', 'teamsOnlineMeetingId', 'teamsStartDateTimeUtc',
    'teamsCalendarSeries', 'teamsWebLink', 'teamsMeetingOptionsUrl',
}


def manual_link_settings(settings, previous=None):
    """A typed URL is not proof that the old meeting's provider IDs still apply.

    Keep authored dates, explicit recording-source links and all unrelated
    fields. Retain a verified identity when its URL is unchanged. An editor
    opened before a manual replacement cannot reintroduce the former IDs.
    """
    incoming = meeting_settings(settings)
    stored = meeting_settings(previous)
    if (text(stored.get('extraTeamsMeetingUrl')) or text(incoming.get('extraTeamsMeetingUrl'))
            or text(incoming.get('teamsMeetingScope') or stored.get('teamsMeetingScope')).lower() == 'additional'):
        return settings
    next_link = text(incoming.get('liveSessionUrl')) or text(incoming.get('teamsMeetingUrl'))
    old_link = text(stored.get('liveSessionUrl')) or text(stored.get('teamsMeetingUrl'))
    # Preserve the existing import/create payload contract on a component's
    # first structural save. Actual manual UI edits are explicitly unverified;
    # changes to an already stored URL are always checked below.
    if (not stored and incoming.get('teamsCalendarBinding') != 'unverified'
            and any(text(incoming.get(key)) for key in ('teamsLiveSessionId', 'teamsOccurrenceId', 'teamsEventId'))):
        return settings
    changed = next_link != old_link
    pending = stored.get('teamsCalendarBinding') == 'unverified'
    if not changed and not pending:
        return settings
    result = {key: value for key, value in incoming.items() if key not in UNVERIFIED_IDENTITY_KEYS}
    legacy = result.get('legacySettings')
    if isinstance(legacy, str):
        try:
            legacy = json.loads(legacy)
        except (TypeError, ValueError):
            legacy = None
    if isinstance(legacy, dict):
        result['legacySettings'] = {key: value for key, value in legacy.items() if key not in UNVERIFIED_IDENTITY_KEYS}
    result.update(liveSessionUrl=next_link, teamsMeetingUrl=next_link,
                  liveSessionLinkOverride=next_link, teamsCalendarBinding='unverified')
    return result


def inherited_main_link(settings_list, series=None):
    """Use a unanimous explicit replacement, otherwise the tracked series link.

    Multiple selected-week replacements do not establish a module default.
    Additional meetings never contribute a main-calendar link.
    """
    main = [settings for settings in settings_list
            if not text(settings.get('extraTeamsMeetingUrl'))
            and text(settings.get('teamsMeetingScope')).lower() != 'additional']
    overrides = {text(settings.get('liveSessionLinkOverride')) for settings in main
                 if text(settings.get('liveSessionLinkOverride'))}
    links = {text(settings.get('liveSessionLinkOverride')) or text(settings.get('liveSessionUrl'))
             or text(settings.get('teamsMeetingUrl')) for settings in main}
    links.discard('')
    if overrides:
        if len(links) != 1:
            raise ValueError('The main weeks use different meeting links. Choose a consistent main meeting link before adding this week.')
        return next(iter(links)), True
    if text((series or {}).get('join_url')):
        return text(series['join_url']), False
    if len(links) > 1:
        raise ValueError('The main weeks use different meeting links. Choose a consistent main meeting link before adding this week.')
    return next(iter(links), ''), bool(links)
