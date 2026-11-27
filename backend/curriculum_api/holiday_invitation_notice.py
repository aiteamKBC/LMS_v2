"""Describe saved holiday invitations without changing their booking or verdict.

Owner decision, 27 November 2026: leave previously communicated holiday
arrangements and invitations in place. This is staff guidance, not permission
to teach on every saved date or an exception to the new-booking holiday rule.
The caller supplies the authoritative whole-week plan and saved calendar zone.
"""
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def staff_notice_allowed(request):
    """Use the real platform session, never a URL parameter or client role hint."""
    from login.sessions import authenticate_request
    from .teams_endpoint_guard import TEAMS_STAFF_ROLES
    account = authenticate_request(request)
    return account is not None and getattr(account, 'role', None) in TEAMS_STAFF_ROLES


def module_holiday_invitation_notice(module, group, holidays, occurrences, time_zone):
    """Reuse the current planner without changing a module or its sync verdict."""
    from . import views
    delivery = views.module_delivery_row(module, group)
    plan = views.module_session_plan_for_weeks(delivery, views.module_stored_week_count(module), holidays=holidays)
    return holiday_invitation_notice(occurrences, plan, time_zone)


def holiday_invitation_notice(occurrences, plan, time_zone):
    try:
        zone = ZoneInfo(time_zone)
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return None
    weeks = []
    for week in plan.get('closedWeeks') or []:
        try:
            start = date.fromisoformat(str(week['startDate']))
            end = date.fromisoformat(str(week['endDate']))
        except (KeyError, TypeError, ValueError):
            continue
        if start <= end:
            weeks.append((start, end, week))
    affected, seen = [], set()
    for row in occurrences:
        # Removed from the plan is not a Microsoft cancellation. Superseded
        # invitations can still be on Teams and need the same staff guidance.
        if str(row.get('status') or '').lower() in ('cancelled', 'canceled', 'declined', 'deleted', 'removed', 'failed'):
            continue
        identifier = str(row.get('id') or '')
        try:
            raw = row['scheduled_start']
            instant = raw if isinstance(raw, datetime) else datetime.fromisoformat(str(raw).replace('Z', '+00:00'))
            instant = instant.replace(tzinfo=instant.tzinfo or timezone.utc).astimezone(timezone.utc)
        except (KeyError, TypeError, ValueError):
            continue
        if not identifier or identifier in seen:
            continue
        local_day = instant.astimezone(zone).date()
        matches = [(start, end, week) for start, end, week in weeks if start <= local_day <= end]
        if not matches:
            continue
        seen.add(identifier)
        affected.append({
            'occurrenceId': identifier,
            'scheduledStart': instant.isoformat().replace('+00:00', 'Z'),
            'localDate': local_day.isoformat(),
            'weekStart': min(start for start, _, _ in matches).isoformat(),
            'weekEnd': max(end for _, end, _ in matches).isoformat(),
            'holidayLabels': sorted({str(h.get('label') or h.get('title') or 'Holiday')
                                    for _, _, week in matches for h in week.get('holidays') or []}),
        })
    if not affected:
        return None
    affected.sort(key=lambda row: (row['scheduledStart'], row['occurrenceId']))
    return {'code': 'existing_holiday_invitations', 'timeZone': zone.key,
            'invitationCount': len(affected), 'invitations': affected}
