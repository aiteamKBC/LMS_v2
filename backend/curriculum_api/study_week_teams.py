"""Remove only proven, untracked recurrence padding in opted-in holiday weeks."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo

from .teams_calendar_checks import event_instant, utc_datetime
from .weekly_schedule import module_week_boundary_mode


def prune_study_week_fillers(request, owner, master_id, module_id, targets, graph_settings, existing_rows=(), *, allow_delete=True):
    from . import views as v
    module = v.authoring_module_exists(module_id) if module_id else None
    if not module or module_week_boundary_mode(module) != 'calendar' or not targets:
        return set(), []
    removed = set()
    failure = {'code': 'study_week_calendar_unverified',
               'message': 'Microsoft has not confirmed the holiday-week calendar. New invitations remain pending; retry the schedule update.',
               'detail': ''}
    try:
        plan = v.module_session_plan_for_weeks(module, v.module_stored_week_count(module))
        closed = set()
        for week in plan.get('weeks') or []:
            if not week.get('holidayWeek'):
                continue
            cursor, end = v.parse_date(week['startDate']), v.parse_date(week['endDate'])
            while cursor <= end:
                closed.add(cursor)
                cursor += timedelta(days=1)
        if not closed:
            return set(), []
        zone = ZoneInfo(v.graph_timezone_iana(graph_settings))
        wanted = {utc_datetime(item['start']) for item in targets}
        tracked_ids = {str(row['graph_event_id']) for row in existing_rows or () if row.get('graph_event_id')}
        tracked_starts = {utc_datetime(row['scheduled_start']) for row in existing_rows or () if row.get('scheduled_start')}
        query = urlencode({'startDateTime': (min(wanted) - timedelta(days=7)).isoformat(),
                           'endDateTime': (max(wanted) + timedelta(days=7)).isoformat(), '$top': 200})
        base = f'users/{owner}/events/{quote(master_id, safe="")}'

        def read_candidates():
            response = request('GET', base + '/instances?' + query)
            if not isinstance(response, dict) or not isinstance(response.get('value'), list):
                raise ValueError('Invalid provider calendar response')
            if response.get('@odata.nextLink'):
                raise ValueError('Incomplete provider calendar')
            candidates = []
            for event in response.get('value') or []:
                instant = event_instant(event, 'start')
                identity = str(event.get('id') or '')
                if (event.get('isCancelled') or instant <= datetime.now(timezone.utc)
                        or instant.astimezone(zone).date() not in closed or instant in wanted
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
            return removed, [failure]
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
