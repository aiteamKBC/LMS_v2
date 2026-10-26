"""Read coach calendars with the existing Azure app; never change Microsoft or LMS data.

The caller must supply a server-authorised coach identity and caseload. Calendar
participants establish associated learners, not booking provenance or attendance.
"""

from datetime import datetime, timedelta, timezone
from time import monotonic
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from curriculum_api.recordings_calendar_policy import event_meeting_key, meeting_key
from curriculum_api.session_graph import collection

FAMILIES = {'mcr': 'MCM', 'progress-review': 'PR', 'student-support': 'SUPPORT'}


def is_lms_cancelled(booking):
    return booking.get('status') == 'cancelled' or booking.get('sync_state') == 'cancelled'


def cancelled_bookings(bookings, learners, *, coach_email, start, end):
    """Read preserved cancellation evidence; never invent the erased session date."""
    roster = {str(row['id']) for row in learners}
    rows = []
    for booking in bookings:
        if (_email(booking.get('owner_email')) != _email(coach_email)
                or str(booking.get('learner_id')) not in roster
                or booking.get('event_type') not in FAMILIES or not is_lms_cancelled(booking)):
            continue
        begin, finish = _booking_times(booking)
        updated = _instant(booking.get('updated_at'))
        if not ((begin and begin < end and finish > start)
                or (not begin and updated and start <= updated < end)):
            continue
        rows.append({'eventKey': booking['event_key'], 'coachEmail': _email(coach_email),
                     'learnerId': str(booking['learner_id']), 'family': FAMILIES[booking['event_type']],
                     'startsAt': begin.isoformat() if begin else None,
                     'endsAt': finish.isoformat() if finish else None,
                     'recordUpdatedAt': updated.isoformat() if updated else None,
                     'dateBasis': 'session' if begin else 'record-updated', 'sources': ['lms']})
    return rows


def _email(value):
    return str(value or '').strip().casefold()


def _instant(value):
    if isinstance(value, datetime):
        result = value
    else:
        try:
            result = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        except (TypeError, ValueError):
            return None
    return result.astimezone(timezone.utc) if result.tzinfo else None


def _window(start, end):
    start, end = _instant(start), _instant(end)
    # Thirty-one local calendar days can include the autumn clock change.
    if not start or not end or not timedelta(0) < end - start <= timedelta(days=31, hours=1):
        raise ValueError('Choose an explicit time-zone range of at most 31 days.')
    return start, end


def load_coach_calendar(coach_email, start, end):
    """GET every page for one authorised mailbox, including recurring occurrences.

    Failure propagates: an inaccessible/incomplete calendar must never become
    an empty calendar and cause bookings to be reported as missing.
    """
    start, end = _window(start, end)
    owner = _email(coach_email)
    if not owner or '@' not in owner:
        raise ValueError('An authorised coach mailbox is required.')
    from .views import get_graph_settings, microsoft_graph_request
    deadline = monotonic() + 30

    query = urlencode({
        'startDateTime': start.isoformat(), 'endDateTime': end.isoformat(),
        '$select': 'id,iCalUId,seriesMasterId,subject,start,end,isCancelled,isAllDay,'
                   'organizer,attendees,onlineMeeting,onlineMeetingUrl,sensitivity',
        '$top': 250,
    })

    def read(method, path):
        # Do not spend minutes draining a slow mailbox. An in-flight Graph
        # call retains its existing 25s transport timeout; never start another
        # page after the read budget. No truncated collection is published.
        if monotonic() >= deadline:
            raise TimeoutError('Coach calendar read budget exceeded.')
        return microsoft_graph_request(method, path, extra_headers={'Prefer': 'outlook.timezone="UTC"'})

    return collection(read, f'users/{quote(owner, safe="")}/calendarView?{query}',
                      get_graph_settings()['base_url'])


def _event_instant(value):
    value = value or {}
    stamp = value.get('dateTime')
    result = _instant(stamp)
    if result:
        return result
    # load_coach_calendar asks Graph for UTC, but retain explicit offsets and
    # named zones for supplied snapshots. Unknown zones are never guessed.
    try:
        aliases = {'GMT Standard Time': 'Europe/London', 'Egypt Standard Time': 'Africa/Cairo'}
        zone = value.get('timeZone')
        zone = ZoneInfo(aliases.get(zone, zone))
        return datetime.fromisoformat(stamp).replace(tzinfo=zone).astimezone(timezone.utc)
    except (TypeError, ValueError, KeyError):
        return None


def _booking_times(booking):
    """CoachCalendarEvent stores UK wall time, independent of the viewer's zone."""
    day, clock = booking.get('scheduled_date'), booking.get('scheduled_time')
    if not day or not clock:
        return None, None
    start = datetime.combine(day, clock, ZoneInfo('Europe/London')).astimezone(timezone.utc)
    return start, start + timedelta(minutes=booking.get('duration_minutes') or 60)


def compare_coach_calendar(events, bookings, learners, *, coach_email, start, end, now=None):
    """Match snapshots without writes or inferred completion.

    bookings: CoachCalendarEvent value dictionaries. learners: authorised
    caseload dictionaries with id/email. A participant/time match is only a
    candidate; confirmed identity requires the saved event ID or Teams link.
    """
    start, end = _window(start, end)
    now = _instant(now) if now is not None else datetime.now(timezone.utc)
    if not now:
        raise ValueError('Current time must include a time zone.')
    owner = _email(coach_email)
    if not owner or '@' not in owner:
        raise ValueError('An authorised coach mailbox is required.')
    roster = {str(row['id']): row for row in learners}
    # Keep duplicate addresses ambiguous; never choose an arbitrary learner.
    by_email = {}
    for learner in roster.values():
        address = _email(learner.get('email'))
        if address:
            by_email.setdefault(address, []).append(str(learner['id']))
    scoped = [row for row in bookings if _email(row.get('owner_email')) == owner
              and str(row.get('learner_id')) in roster
              and row.get('event_type') in FAMILIES]
    used, seen, rows = set(), set(), []
    invalid = 0
    for event in events:
        if not isinstance(event, dict):
            invalid += 1
            continue
        begin, finish = _event_instant(event.get('start')), _event_instant(event.get('end'))
        if not begin or not finish or finish <= begin or not event.get('id'):
            invalid += 1
            continue
        if not begin < end or finish <= start:
            continue
        identity = (event['id'], begin)
        if identity in seen:
            continue
        seen.add(identity)
        invited = set()
        for attendee in [event.get('organizer') or {}, *(event.get('attendees') or [])]:
            invited.update(by_email.get(_email((attendee.get('emailAddress') or {}).get('address')), []))
        link = event_meeting_key(event)
        exact = [row for row in scoped if row.get('graph_event_id') == event['id']]
        linked = [row for row in scoped if link and meeting_key(row.get('meeting_link')) == link
                  and _booking_times(row) == (begin, finish)]
        possible = [row for row in scoped if str(row['learner_id']) in invited
                    and _booking_times(row) == (begin, finish)]
        identified = {row['event_key']: row for row in [*exact, *linked]}
        candidates = list(identified.values()) or possible
        # Calendar visibility is independent of an LMS booking or learner match.
        # Every event returned for this authorised coach stays visible by its
        # Microsoft title; matching only enriches it with learner/review evidence.
        used.update(row['event_key'] for row in candidates)
        confirmed = bool(exact or linked) and len(candidates) == 1
        booking = candidates[0] if len(candidates) == 1 else None
        learner_ids = {str(booking['learner_id'])} if confirmed else invited
        if confirmed:
            times_agree = _booking_times(booking) == (begin, finish)
            saved_link = meeting_key(booking.get('meeting_link'))
            links_agree = not (saved_link and link) or saved_link == link
            cancellation_agrees = is_lms_cancelled(booking) == bool(event.get('isCancelled'))
            match = 'matched' if times_agree and links_agree and cancellation_agrees else 'mismatch'
        else:
            match = 'ambiguous' if len(candidates) > 1 or len(invited) > 1 else 'candidate' if booking else 'external'
        rows.append({
            'calendarEventId': event['id'], 'coachEmail': owner,
            'eventKey': booking['event_key'] if confirmed else None,
            'candidateEventKeys': [row['event_key'] for row in candidates] if not confirmed else [],
            'learnerIds': sorted(learner_ids),
            'family': FAMILIES[booking['event_type']] if confirmed else None,
            'title': str(event.get('subject') or '')[:1000],
            'cancellationSources': (['microsoft'] if event.get('isCancelled') else [])
                                   + (['lms'] if confirmed and is_lms_cancelled(booking) else []),
            'startsAt': begin.isoformat(), 'endsAt': finish.isoformat(),
            'phase': 'cancelled' if event.get('isCancelled') else 'ended' if finish <= now
                     else 'upcoming' if begin > now else 'in-progress',
            'match': match,
        })
    missing = []
    for booking in scoped:
        begin, finish = _booking_times(booking)
        if (booking['event_key'] not in used and begin and begin < end and finish > start
                and booking.get('status') != 'cancelled' and booking.get('sync_state') != 'cancelled'):
            missing.append({'eventKey': booking['event_key'], 'learnerId': str(booking['learner_id']),
                            'startsAt': begin.isoformat(), 'endsAt': finish.isoformat()})
    # An incomplete event cannot be safely interpreted as proof of absence.
    return {'meetings': sorted(rows, key=lambda row: (row['startsAt'], row['calendarEventId'])),
            'lmsOnly': [] if invalid else sorted(missing, key=lambda row: row['startsAt']),
            'invalidEvents': invalid, 'complete': not bool(invalid)}
