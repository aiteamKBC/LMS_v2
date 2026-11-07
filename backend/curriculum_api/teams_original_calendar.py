"""Use the standard LMS editor against a verified original calendar.

The request keeps the existing series/occurrence IDs and join links. Imported
calendars use their owner's Microsoft access for calendar transport only; the
ordinary application transport remains unchanged outside this request.
"""
from contextvars import ContextVar
from functools import wraps
from urllib.parse import quote, urlsplit
import json

import httpx
from django.core import signing

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from .teams_cancellation_checks import CalendarStateError


_original = ContextVar('curriculum_original_calendar', default=None)


class OriginalCalendarRequired(CalendarStateError):
    """An imported calendar must first enter its verified owner transport."""


def current_calendar():
    return _original.get()


def calendar_authorized(live_id):
    value = current_calendar()
    return bool(value and value.live_id == str(live_id))


def read_original_online(series, access, client):
    """Calendar delegation and online-meeting policy access are independent.

    Use the existing Azure application's read access when the calendar sign-in
    has no OnlineMeetings scope. The ID, join URL and organiser are still proved.
    """
    from .teams_imported_meeting_edit import online_path, read_online
    from .teams_imported_participants import join_context_oid
    from .teams_imported_calendar_update import GraphRefusal
    from coach_api.views import microsoft_graph_request

    path = online_path(series, access)
    if path:
        try:
            return path, read_online(client, series, path)
        except GraphRefusal:
            pass
    owner, identity = join_context_oid(series.get('join_url')), str(series.get('online_meeting_id') or '')
    if not owner or not identity:
        return None, None
    path = 'users/' + quote(owner, safe='') + '/onlineMeetings/' + quote(identity, safe='')
    class ApplicationReader:
        def read(self, target):
            return microsoft_graph_request('GET', target)
    try:
        return path, read_online(ApplicationReader(), series, path)
    except (RuntimeError, httpx.HTTPError):
        return None, None


class OriginalCalendar:
    def __init__(self, series, access, path, client, *, read_only=False):
        from .teams_imported_participants import join_context_oid
        self.live_id = str(series['id'])
        self.access, self.client = access, client
        self.read_only = read_only
        self.saved_prefix = 'users/' + quote(series['organizer_email'], safe='')
        self.original_prefix = path.rsplit('/events/', 1)[0]
        self.online_owner = join_context_oid(series.get('join_url'))
        self.online_id = str(series.get('online_meeting_id') or '')

    def check_application_request(self, method, path):
        if self.read_only and method.upper() not in ('GET', 'HEAD'):
            raise RuntimeError('This calendar status check cannot send a Microsoft update.')
        parts = urlsplit(path).path.strip('/').split('/')
        if any(part in ('events', 'calendar', 'calendars') for part in parts):
            raise RuntimeError('This request names a different calendar.')
        if method.upper() in ('POST', 'PATCH', 'DELETE') and 'onlineMeetings' in parts:
            expected = ['users', quote(self.online_owner, safe=''), 'onlineMeetings', quote(self.online_id, safe='')]
            if not self.online_owner or not self.online_id or parts != expected or method.upper() == 'POST':
                raise RuntimeError('This request does not identify the original online meeting.')

    def path(self, path):
        # Only the verified calendar is translated. Directory lookups and
        # onlineMeeting options continue to use the existing application API.
        if urlsplit(path).scheme or '\\' in path or '..' in path.split('?', 1)[0].split('/'):
            return None
        relative = path.lstrip('/')
        for owner in (self.saved_prefix, self.original_prefix):
            for resource in ('/events', '/calendar', '/calendars'):
                prefix = owner + resource
                if relative == prefix or relative.startswith(prefix + '/') or relative.startswith(prefix + '?'):
                    return self.original_prefix + relative[len(owner):]
        return None

    def request(self, method, path, *, payload=None, headers=None):
        if self.read_only and method.upper() not in ('GET', 'HEAD'):
            raise RuntimeError('This calendar status check cannot send a Microsoft update.')
        mapped = self.path(path)
        if mapped is None:
            raise RuntimeError('The request does not belong to the verified original calendar.')
        # Updating an existing module must never replace its original meeting.
        if method.upper() == 'POST' and mapped.split('?', 1)[0].endswith('/events'):
            raise RuntimeError('Creating a replacement meeting is not part of this original calendar update.')
        response = self.client.client.request(method, mapped, json=payload, headers=headers)
        if response.status_code >= 400:
            raise RuntimeError('Microsoft refused the original calendar request (HTTP %s).' % response.status_code)
        if response.status_code == 204 or not response.content:
            return {}
        value = response.json()
        if not isinstance(value, dict):
            raise RuntimeError('Microsoft returned an unreadable original calendar response.')
        return value

    def read(self, path, *, prefer=''):
        from .teams_cancellation_checks import CalendarStateError
        mapped = self.path(path)
        if mapped is None:
            raise CalendarStateError('The calendar read is outside the verified original calendar.')
        response = self.client.client.get(mapped, headers={'Prefer': prefer} if prefer else None)
        if response.status_code == 404 and '/events/' in mapped and '/instances' not in mapped:
            if response.json().get('error', {}).get('code') == 'ErrorItemNotFound':
                return None
        if response.status_code != 200:
            raise CalendarStateError('Microsoft did not allow reading the original calendar.')
        value = response.json()
        if not isinstance(value, dict):
            raise CalendarStateError('Microsoft returned an unreadable original calendar.')
        return value


def bind_calendar(series, rows, master, events, online=None, *, original_path=None):
    """Save proven Graph identifiers only; never move/re-number local history."""
    from . import views as v
    from . import teams_imported_calendar_update as imported
    from .teams_calendar_state import load_calendar_state, state_signature

    if series.get('graph_event_id') and series['graph_event_id'] != master['id']:
        raise imported.Blocked('original_calendar_changed', 'The saved calendar identifies another event. No binding was replaced.')
    by_slot = {}
    for event in events:
        if not event.get('isCancelled') and (event.get('onlineMeeting') or {}).get('joinUrl') == series['join_url']:
            by_slot.setdefault(imported.event_slot(event), []).append(event)
    signature = state_signature(series, rows)
    from .teams_imported_meeting_edit import people
    addresses = people(master)
    verified_fields = {'attendees': addresses}
    roles = (online or {}).get('participants', {}).get('attendees')
    if isinstance(roles, list) and all(item.get('upn') and item.get('role') in ('attendee', 'presenter', 'coorganizer') for item in roles):
        verified_fields['presenters'] = [item['upn'] for item in roles if item['role'] == 'presenter']
        verified_fields['co_organizers'] = [item['upn'] for item in roles if item['role'] == 'coorganizer']
    with transaction.atomic():
        current, current_rows, snapshot = load_calendar_state(series['id'], lock=True)
        if state_signature(current, current_rows) != signature:
            raise imported.Blocked('calendar_changed', 'The saved calendar changed during verification. Retry the update.')
        updates = {'graph_event_id': master['id']} if not current.get('graph_event_id') else {}
        for key, values in verified_fields.items():
            if sorted(v.teams_series_email_list(current.get(key))) != sorted(value.lower() for value in values):
                updates[key] = v.json_db_value(values)
        if updates:
            v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [series['id']], updates)
        for row in current_rows:
            # An explicit different meeting/standalone keeps its own identity.
            if row.get('join_url') != series['join_url'] or row.get('graph_event_id'):
                continue
            slot = (imported.iso(row['scheduled_start']), imported.iso(row['scheduled_end']))
            matches = by_slot.get(slot, [])
            if len(matches) == 1:
                v.update_authoring_rows(v.LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s AND live_session_id = %s',
                                        [row['id'], series['id']], {'graph_event_id': matches[0]['id']})
        if original_path:
            from .teams_calendar_actions import store_snapshot
            binding = {'liveId': str(series['id']), 'joinUrl': series['join_url'], 'organizer': series['organizer_email'],
                       'eventId': master['id'], 'path': original_path}
            if snapshot.get('originalCalendar') != binding:
                store_snapshot(series['id'], {**snapshot, 'originalCalendar': binding})


def saved_binding(series, snapshot, access):
    """Previously proved owner path, usable only for read-only recovery."""
    binding = snapshot.get('originalCalendar') or {}
    path = str(binding.get('path') or '')
    owner_kind = 'group' if path.startswith('groups/') else 'user' if path.startswith('users/') else ''
    if (binding.get('liveId') == str(series['id']) and binding.get('joinUrl') == series.get('join_url')
            and binding.get('organizer') == series.get('organizer_email')
            and binding.get('eventId') == series.get('graph_event_id') and binding.get('eventId')
            and owner_kind == access.get('calendarKind', 'user')
            and path.endswith('/events/' + quote(binding['eventId'], safe=''))
            and len(path.split('/')) == 4 and not urlsplit(path).query):
        return path
    return None


def original_calendar_request(view, *, read_only=False):
    """Enter the standard editor only after verifying the original organiser."""
    @wraps(view)
    def wrapped(request, live_session_id, *args, **kwargs):
        from . import views as v
        from . import teams_imported_calendar_update as imported
        from .teams_calendar_state import load_calendar_state
        from .teams_imported_calendar_auth import CalendarConnectionError
        from .teams_imported_meeting_edit import verified_context, load_edit, event_state, online_state, SALT

        if request.method not in (('GET',) if read_only else ('POST', 'PATCH')) or calendar_authorized(live_session_id):
            return view(request, live_session_id, *args, **kwargs)
        values = v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], ensure_tables=False)
        if not values or values[0].get('meeting_type') != 'linked-external':
            return view(request, live_session_id, *args, **kwargs)
        try:
            access = imported.access_for(request, live_session_id)
            series, rows, snapshot = load_calendar_state(live_session_id)
            payload = {} if read_only else json.loads(request.body or b'{}')
            if not isinstance(payload, dict):
                return JsonResponse({'error': 'A JSON object is required.'}, status=400)
            source = None
            if request.method == 'PATCH':
                if not isinstance(payload.get('originalSourceToken'), str) or not payload['originalSourceToken']:
                    raise imported.Blocked('original_calendar_review_required', 'Read the original calendar before saving its changes.')
                source = signing.loads(payload['originalSourceToken'], salt=SALT, max_age=600)
                if source.get('standard') is not True or source.get('liveId') != live_session_id or source.get('actor') != str(request.login_account.pk):
                    raise imported.Blocked('wrong_review_owner', 'The original calendar read belongs to another account or meeting.')
                imported.same_access(source, access)
                if load_edit(live_session_id)[-1] != source.get('version'):
                    raise imported.Blocked('calendar_changed', 'The saved calendar changed. Refresh it and review your edits before saving.')
            if view.__name__ == 'curriculum_teams_meeting_schedule' and any(
                    (snapshot.get(key) or {}).get('status') in ('processing', 'uncertain')
                    for key in (imported.KEY, 'management')):
                raise imported.Blocked('calendar_update_pending', 'Check the previous calendar action before saving another update.')
            imported.require_access(access, series)
            with imported.CalendarClient(access) as client:
                recovery = read_only or view.__name__ == 'sync_calendar_state' or (view.__name__ == 'calendar_action' and payload.get('stage') == 'status')
                previous_path = saved_binding(series, snapshot, access) if recovery else None
                if previous_path:
                    token = _original.set(OriginalCalendar(series, access, previous_path, client, read_only=True))
                    try:
                        return view(request, live_session_id, *args, **kwargs)
                    finally:
                        _original.reset(token)
                path, master, events, _ = verified_context(series, rows, client)
                _, online = read_original_online(series, access, client) if not read_only else (None, None)
                if source and (source.get('path') != path or event_state(source.get('master') or {}) != event_state(master)
                               or (source.get('online') and (not online or online_state(source['online']) != online_state(online)))):
                    raise imported.Blocked('original_calendar_changed', 'Microsoft changed after this form was opened. Refresh the calendar before saving; no edit was sent.')
                if online is None and request.method == 'PATCH' and any(key in payload for key in ('presenters', 'coOrganizers', 'recording', 'lobbyBypass', 'spokenLanguage')):
                    raise imported.Blocked('meeting_roles_unverified', 'Microsoft meeting roles could not be verified. Refresh the original calendar before changing them.')
                if not read_only:
                    bind_calendar(series, rows, master, events, online, original_path=path)
                token = _original.set(OriginalCalendar(series, access, path, client, read_only=read_only))
                try:
                    if request.method == 'PATCH' and not json.loads(request.body or b'{}').get('peopleOnly'):
                        return update_original_schedule(request, live_session_id, access, view, args, kwargs)
                    return view(request, live_session_id, *args, **kwargs)
                finally:
                    _original.reset(token)
        except imported.Blocked as exc:
            return JsonResponse({'error': str(exc), 'code': exc.code, 'connectionRequired': exc.connection_required,
                                 'connectionKind': exc.kind}, status=409)
        except signing.BadSignature:
            return JsonResponse({'error': 'The original calendar read expired or changed. Refresh it before saving.',
                                 'code': 'original_calendar_review_expired'}, status=409)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'A valid original calendar request is required.'}, status=400)
        except CalendarConnectionError as exc:
            return JsonResponse({'error': str(exc), 'code': exc.code, 'connectionRequired': True,
                                 'connectionKind': 'group'}, status=409)
        except imported.GraphRefusal as exc:
            return JsonResponse({'error': 'Microsoft did not allow access to the original calendar. Connect an account allowed to manage it.',
                                 'code': 'original_calendar_access', 'connectionRequired': exc.status_code in (401, 403),
                                 'connectionKind': access.get('calendarKind', 'user')}, status=409)
        except (RuntimeError, httpx.HTTPError):
            return JsonResponse({'error': 'The original calendar could not be verified. No replacement meeting was created.',
                                 'code': 'original_calendar_unavailable'}, status=502)
        except (LookupError, DatabaseError):
            return JsonResponse({'error': 'The saved calendar changed or could not be read. Retry after checking calendar status.'}, status=409)
    return wrapped


def original_calendar_read(view):
    return original_calendar_request(view, read_only=True)


def update_original_schedule(request, live_id, access, view, args, kwargs):
    """Extend the original calendar without rewriting its historical pattern.

    The shared UI's Update button keeps its usual review. Dates use the existing
    verified extension/import operation; the ordinary people-only save then
    applies changed invitations/options against the dates Microsoft holds.
    """
    from . import teams_imported_calendar_update as imported
    from .teams_calendar_state import load_calendar_state
    from . import views as v
    from .teams_schedule_notice import issue_change_notice, same_schedule
    from .teams_schedule_delivery import send_change_emails
    from .teams_week_meeting import may_send_schedule_email
    from zoneinfo import ZoneInfo

    payload = json.loads(request.body or b'{}')
    actor = str(request.login_account.pk)
    before = v.held_schedule_snapshot(live_id)
    notify = bool(payload.get('notifyAttendees'))
    preview = imported.review(live_id, actor, access, notify_attendees=notify, standard_before=before)
    if preview.get('status') == 'ready':
        result = imported.confirm(live_id, {'previewToken': preview['previewToken'], 'acknowledgeNotifications': True}, actor, access)
    else:
        result = preview
    if result.get('status') not in ('confirmed', 'up_to_date'):
        return JsonResponse({'error': result.get('message') or 'The original calendar update needs verification.',
                             'code': result.get('code') or 'original_calendar_verification_required',
                             'verificationRequired': result.get('status') == 'verification_pending',
                             'connectionRequired': result.get('connectionRequired', False),
                             'connectionKind': result.get('connectionKind', 'user')}, status=409)
    series, rows, snapshot = load_calendar_state(live_id)
    operation = snapshot.get(imported.KEY) or {}
    before = operation.get('standardBefore') or before
    held = [row for row in rows if row.get('status') not in ('cancelled', 'superseded')]
    if not held:
        return JsonResponse({'error': 'No original calendar sessions could be verified.'}, status=409)
    first = imported.utc_datetime(held[0]['scheduled_start'])
    zone = ZoneInfo(imported.ZONES.get(series.get('timezone'), series.get('timezone') or 'Europe/London'))
    original_body = request.body
    request._body = json.dumps({**payload, 'peopleOnly': True, 'eventId': series['graph_event_id'],
        'localStartDateTime': first.astimezone(zone).replace(tzinfo=None).isoformat(),
        'startDateTimeUtc': imported.iso(first), 'repeatOccurrences': len(held),
        'scheduledOccurrences': [{'sessionNumber': row['session_number'], 'startDateTimeUtc': imported.iso(row['scheduled_start']),
            'durationMinutes': int((imported.utc_datetime(row['scheduled_end']) - imported.utc_datetime(row['scheduled_start'])).total_seconds() / 60)} for row in held],
    }).encode()
    try:
        response = view(request, live_id, *args, **kwargs)
    finally:
        request._body = original_body
    if response.status_code != 200:
        body = json.loads(response.content)
        return JsonResponse({**body, 'partial': True, 'calendarUpdateConfirmed': True,
                             'error': 'Calendar dates were confirmed; the invitation/settings update did not finish. ' + str(body.get('error') or 'Check action status before retrying.')}, status=response.status_code)
    body = json.loads(response.content)
    after = v.held_schedule_snapshot(live_id)
    changed = not same_schedule(before, after)
    change_id = str(operation.get('id') or result.get('operationId') or body.get('changeId') or '')
    body.update(announced=notify and changed, changeId=change_id,
                changeNotice=issue_change_notice(live_id, before, after, notice_id=change_id or None))
    if notify and changed and body['changeNotice'] and may_send_schedule_email(request):
        # The ordinary save already invited/emailed the added people. They
        # receive no second change email; the shared notice ledger dedupes retries.
        body['scheduleEmail'] = send_change_emails(live_id, body['changeNotice'], exclude=body.get('addedPeople') or [])
    return JsonResponse(body, status=200)
