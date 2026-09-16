"""Reconcile cancellations from Microsoft; no Microsoft mutation or email path."""
import json
import time
from contextlib import contextmanager
from datetime import datetime, timezone

import httpx
from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .teams_cancellation_checks import CalendarStateError, cancellation_plan


@contextmanager
def calendar_reader():
    from coach_api.views import get_graph_settings, microsoft_graph_token

    settings = get_graph_settings()
    base = settings['base_url'].rstrip('/')
    if base != 'https://graph.microsoft.com/v1.0':
        raise CalendarStateError('The configured Microsoft calendar endpoint is not supported.')
    token = microsoft_graph_token()
    deadline = time.monotonic() + 30
    with httpx.Client(base_url=base + '/', headers={'Authorization': f'Bearer {token}'}, follow_redirects=False) as client:
        def read(path):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise CalendarStateError('Calendar verification took too long. Retry; no cancellation changes were applied.')
            response = client.get(path, timeout=min(10, remaining))
            if response.status_code == 404:
                # Only a missing event is cancellation evidence. A missing user,
                # inaccessible mailbox, failed pagination or permission is not.
                if '/events/' in path and '/instances' not in path:
                    code = response.json().get('error', {}).get('code')
                    if code == 'ErrorItemNotFound':
                        return None
            if response.status_code != 200:
                raise CalendarStateError(f'Microsoft calendar status could not be verified (HTTP {response.status_code}).')
            return response.json()
        yield read


def load_calendar_state(live_id, *, lock=False):
    from . import views as v

    with connection.cursor() as cursor:
        cursor.execute("SELECT to_regclass('curriculum.teams_calendar_sync_state')")
        if not cursor.fetchone()[0]:
            raise CalendarStateError('Calendar status sync is not configured. Apply backend/sql/teams_calendar_sync_state.sql.')
        if lock:
            cursor.execute('SELECT id FROM curriculum.live_sessions WHERE id = %s FOR UPDATE', [live_id])
            cursor.execute('SELECT id FROM curriculum.live_session_occurrences WHERE live_session_id = %s FOR UPDATE', [live_id])
        cursor.execute('SELECT snapshot FROM curriculum.teams_calendar_sync_state WHERE live_session_id = %s', [live_id])
        saved = cursor.fetchone()
    series = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id], ensure_tables=False)
    if not series:
        raise LookupError('Calendar not found.')
    rows = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_id],
                                'session_number asc', ensure_tables=False)
    item = dict(series[0])
    item['calendar_series'] = v.parse_json_value(item.get('calendar_series'), []) or []
    snapshot = saved[0] if saved else {}
    if isinstance(snapshot, str):
        snapshot = json.loads(snapshot)
    return item, rows, snapshot


def state_signature(series, rows):
    """Avoid overwriting a save or an attendance import made during Graph reads."""
    series_fields = ('id', 'status', 'updated_at', 'graph_event_id', 'calendar_series', 'organizer_email', 'join_url')
    row_fields = ('id', 'updated_at', 'status', 'graph_event_id', 'scheduled_start', 'scheduled_end',
                  'join_url', 'actual_start', 'attendance_report_id', 'participant_count')
    return json.dumps([[series.get(key) for key in series_fields],
                       [[row.get(key) for key in row_fields] for row in rows]], sort_keys=True, default=str)


def reconcile_calendar(live_id):
    from . import views as v

    series, rows, snapshot = load_calendar_state(live_id)
    if series.get('status') != 'active':
        return {'changed': False, 'seriesStatus': series.get('status'), 'cancelledSessions': [], 'errors': []}
    if not rows:
        raise CalendarStateError('No stored sessions are available to verify this calendar.')
    signature = state_signature(series, rows)
    with calendar_reader() as read:
        plan = cancellation_plan(series, rows, snapshot, read)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with transaction.atomic():
        current, current_rows, current_snapshot = load_calendar_state(live_id, lock=True)
        if state_signature(current, current_rows) != signature or current_snapshot != snapshot:
            raise CalendarStateError('This calendar changed during verification. Retry the status check.')
        with connection.cursor() as cursor:
            for occurrence_id in plan['cancelledIds']:
                cursor.execute("""UPDATE curriculum.live_session_occurrences
                                  SET status = 'cancelled', updated_at = %s
                                  WHERE id = %s AND live_session_id = %s AND status = 'scheduled'""",
                               [now, occurrence_id, live_id])
            if plan['seriesCancelled']:
                cursor.execute("UPDATE curriculum.live_sessions SET status = 'cancelled', updated_at = %s WHERE id = %s AND status = 'active'", [now, live_id])
            cursor.execute("""INSERT INTO curriculum.teams_calendar_sync_state (live_session_id, snapshot, checked_at)
                              VALUES (%s, %s::jsonb, %s)
                              ON CONFLICT (live_session_id) DO UPDATE
                              SET snapshot = EXCLUDED.snapshot, checked_at = EXCLUDED.checked_at""",
                           [live_id, json.dumps(plan['snapshot']), datetime.now(timezone.utc)])
    changed = bool(plan['cancelledIds'] or plan['seriesCancelled'])
    if changed:
        v.invalidate_curriculum_cache()
    return {'changed': changed, 'seriesStatus': 'cancelled' if plan['seriesCancelled'] else 'active',
            'cancelledSessions': [row['session_number'] for row in rows if row['id'] in plan['cancelledIds']],
            'errors': plan['errors']}


@transaction.non_atomic_requests
@require_role('admin', 'staff')
@require_POST
def sync_calendar_state(request, live_session_id):
    try:
        result = reconcile_calendar(live_session_id)
        return JsonResponse(result, status=207 if result['errors'] else 200)
    except LookupError:
        return JsonResponse({'error': 'Calendar not found.'}, status=404)
    except CalendarStateError as exc:
        return JsonResponse({'error': str(exc)}, status=409)
    except (httpx.HTTPError, ValueError, RuntimeError):
        return JsonResponse({'error': 'Microsoft calendar status could not be verified. No cancellation was inferred.'}, status=502)
