"""Locate leading general materials using confirmed delivery dates, not titles."""
import json


def week_plan_offset(weeks, sessions):
    by_date = {}
    for session in sessions or []:
        day, number = str(session.get('date') or '')[:10], session.get('weekNumber')
        if day and isinstance(number, int) and number > 0:
            if day in by_date and by_date[day] != number:
                return 0
            by_date[day] = number
    offsets, anchored_weeks = set(), set()
    for index, week in enumerate(weeks or []):
        for component in week.get('components') or []:
            if str(component.get('type') or '').replace('_', '-') != 'live-session':
                continue
            settings = component.get('settings', component.get('settings_json')) or {}
            if isinstance(settings, str):
                try:
                    settings = json.loads(settings)
                except (TypeError, ValueError):
                    continue
            if not isinstance(settings, dict) or settings.get('extraTeamsMeetingUrl') or component.get('additional_meeting'):
                continue
            if settings.get('sessionRescheduled'):
                continue
            confirmed = settings.get('teamsOccurrenceId') or (settings.get('teamsLiveSessionId') and settings.get('teamsSessionNumber'))
            if not confirmed:
                continue
            number = by_date.get(str(settings.get('sessionDate') or '')[:10])
            if number is None:
                return 0
            offsets.add(index + 1 - number)
            anchored_weeks.add(number)
    if len(offsets) != 1 or len(anchored_weeks) < 2:
        return 0
    offset = offsets.pop()
    if offset <= 0 or offset >= len(weeks):
        return 0
    if any(str(component.get('type') or '').replace('_', '-') == 'live-session'
           for week in weeks[:offset] for component in week.get('components') or []):
        return 0
    return offset
