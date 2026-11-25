"""Remove proven, untracked recurring filler between reviewed module sessions."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from .teams_calendar_checks import event_instant, utc_datetime, read_calendar_instances
from .weekly_schedule import module_week_boundary_mode


def prune_study_week_fillers(request, owner, master_id, module_id, targets, graph_settings, existing_rows=(), *, allow_delete=True, allow_uninvited_delete=False):
    from . import views as v
    module = v.authoring_module_exists(module_id) if module_id else None
    if not module or not targets:
        return set(), []
    removed = set()
    failure = {'code': 'study_week_calendar_unverified',
               'message': 'Microsoft has not confirmed the holiday-week calendar. New invitations remain pending; retry the schedule update.',
               'detail': ''}
    try:
        zone = ZoneInfo(v.graph_timezone_iana(graph_settings))
        wanted = {utc_datetime(item['start']) for item in targets}
        wanted_dates = {instant.astimezone(zone).date() for instant in wanted}
        # A partial schedule payload alone cannot prove that an LMS week has
        # no Live. Read the authored main-calendar components as well.
        links = v.authoring_session_links_by_catalogue([module_id]).get(module_id, [])
        authored_dates = {str(link.get('date') or '')[:10] for link in links
                          if not link.get('additionalMeeting') and link.get('meetingScope') == 'main' and link.get('date')}
        if module_week_boundary_mode(module) != 'calendar' and (not authored_dates or not {day.isoformat() for day in wanted_dates}.issubset(authored_dates)):
            return removed, []
        first, last = min(wanted_dates), max(wanted_dates)
        tracked_ids = {str(row['graph_event_id']) for row in existing_rows or () if row.get('graph_event_id')}
        tracked_starts = {utc_datetime(row['scheduled_start']) for row in existing_rows or () if row.get('scheduled_start')}
        query = urlencode({'startDateTime': (min(wanted) - timedelta(days=7)).isoformat(),
                           'endDateTime': (max(wanted) + timedelta(days=7)).isoformat(), '$top': 200})
        base = f'users/{owner}/events/{quote(master_id, safe="")}'

        def read_candidates():
            candidates = []
            for event in read_calendar_instances(request, base + '/instances?' + query):
                instant = event_instant(event, 'start')
                identity = str(event.get('id') or '')
                day = instant.astimezone(zone).date()
                if (event.get('isCancelled') or instant <= datetime.now(timezone.utc)
                        or not first <= day <= last or day in wanted_dates or day.isoformat() in authored_dates or instant in wanted
                        or instant in tracked_starts or identity in tracked_ids
                        or event.get('type') == 'exception'):
                    continue
                # Only an actual occurrence of THIS master is safe to retire.
                # Missing provider identity is a visible failure, never a guess.
                if not identity or event.get('type') != 'occurrence' or event.get('seriesMasterId') != master_id:
                    raise ValueError('Unproven recurrence padding')
                candidates.append(identity)
            return candidates

        candidates = read_candidates()
        if candidates and not allow_delete:
            # A failed initial creation may retry silently before anyone has
            # been invited. Require the actual master to prove that nobody
            # would receive a cancellation; omitted attendees are not proof.
            master = request('GET', base + '?$select=id,attendees') if allow_uninvited_delete else None
            if not isinstance(master, dict) or master.get('id') != master_id or master.get('attendees') != []:
                return removed, [{**failure, 'detail': 'Cancelling the extra calendar meetings sends attendee notifications. Review the dates and enable notifications for that schedule update.'}]
        for identity in candidates:
            request('DELETE', f'users/{owner}/events/{quote(identity, safe="")}')
            removed.add(identity)
        if removed and read_candidates():
            return removed, [failure]
        return removed, []
    except (RuntimeError, ValueError, TypeError, KeyError):
        # Existing create/update paths persist these warnings and do not publish
        # invitations until verification succeeds. A retry keeps the same master.
        return removed, [failure]
