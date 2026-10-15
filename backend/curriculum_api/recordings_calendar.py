"""Compare a staff-selected existing LMS organizer calendar; never write Graph or DB."""
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_role
from .session_results import read, unavailable
from .recordings_calendar_policy import compare_calendar


@require_GET
@require_role('admin', 'staff')
def calendar_matches(request):
    try:
        start_day = date.fromisoformat(request.GET.get('start', ''))
        end_day = date.fromisoformat(request.GET.get('end', ''))
        zone_name = request.GET.get('timeZone', '')
        zone = ZoneInfo(zone_name)
        if not 0 <= (end_day - start_day).days <= 30:
            raise ValueError()
    except (ValueError, ZoneInfoNotFoundError):
        return JsonResponse({'error': 'Choose a valid calendar period of at most 31 days and time zone.'}, status=400)
    try:
        accounts = sorted({row['organizer_email'].strip().lower() for row in read(
            "SELECT DISTINCT organizer_email FROM curriculum.live_sessions WHERE status='active' AND btrim(organizer_email)<>''")})
        account = getattr(request, 'login_account', None)
        own_email = str(getattr(account, 'email', '') or '').strip().lower()
        if getattr(account, 'role', '') != 'admin':
            accounts = [value for value in accounts if value == own_email]
        owner = str(request.GET.get('mailbox') or '').strip().lower()
        if not owner:
            owner = own_email if own_email in accounts else accounts[0] if len(accounts) == 1 else ''
        if owner and owner not in accounts:
            return JsonResponse({'error': 'Choose an existing LMS calendar account.'}, status=400)
        payload = {'start': start_day.isoformat(), 'end': end_day.isoformat(), 'timeZone': zone_name,
                   'mailbox': owner, 'accounts': accounts, 'matched': [], 'unmatched': []}
        if not owner:
            response = JsonResponse({**payload, 'status': 'choose'})
            response['Cache-Control'] = 'private, no-store'
            return response
        start = datetime.combine(start_day, datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
        end = datetime.combine(end_day + timedelta(days=1), datetime.min.time(), tzinfo=zone).astimezone(timezone.utc)
        rows = read('''SELECT o.id,s.module_catalogue_id,COALESCE(NULLIF(o.join_url,''),s.join_url) AS join_url,
                o.scheduled_start,o.scheduled_end,
                CASE WHEN s.status='cancelled' THEN 'cancelled' ELSE o.status END AS status
            FROM curriculum.live_session_occurrences o JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            WHERE s.status NOT IN ('deleted','superseded','failed') AND o.scheduled_start>=%s AND o.scheduled_start<%s''',
            [start.replace(tzinfo=None), end.replace(tzinfo=None)])
        series = read("SELECT join_url FROM curriculum.live_sessions WHERE status NOT IN ('deleted','superseded','failed')")
        from coach_api.views import microsoft_graph_request, get_graph_settings
        from .session_graph import collection
        from .teams_weekly_calendar import graph_event_utc
        query = urlencode({'startDateTime': start.isoformat(), 'endDateTime': end.isoformat(), '$top': 100,
                           '$select': 'id,subject,start,end,onlineMeeting,onlineMeetingUrl,body,isCancelled'})
        events = collection(microsoft_graph_request, f'users/{quote(owner, safe="")}/calendarView?{query}', get_graph_settings()['base_url'])
        comparison = compare_calendar([graph_event_utc(event) for event in events], rows, series, start, end, zone_name)
        from .recordings_external import event_reference
        for item in comparison['unmatched']:
            event_id, first, last = item.pop('eventId'), item.pop('startsAt'), item.pop('endsAt')
            if event_id:
                item['recordingsReference'] = event_reference(owner, event_id, first, last)
        response = JsonResponse({**payload, **comparison, 'status': 'verified'})
        response['Cache-Control'] = 'private, no-store'
        return response
    except DatabaseError:
        return unavailable()
    except (RuntimeError, ValueError):
        return JsonResponse({'error': 'The selected Teams calendar could not be verified. Retry; saved LMS rows are not proof of a calendar match.'}, status=503)
