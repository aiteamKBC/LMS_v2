"""Import verified LMS-owned meeting people/roles; Microsoft is read-only.

Imported calendars keep their existing original-owner editor. This endpoint
never imports dates, changes meeting identities, or sends invitations/mail.
"""
from datetime import datetime, timezone
from types import SimpleNamespace
from urllib.parse import quote

import httpx
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST
from login.permissions import require_role

from .teams_calendar_state import calendar_reader, load_calendar_state
from .teams_cancellation_checks import CalendarStateError
from .teams_imported_calendar_update import Blocked, digest
from .teams_imported_meeting_edit import confirmed_roles, people, presenter_labels, read_online
from .teams_imported_participants import join_context_oid
from .teams_weekly_calendar import stored_calendar_series


def read_people(series, read):
    """Every weekday root must agree before a shared form can represent it."""
    roots = list(stored_calendar_series(series))
    if not roots:
        roots = [{'eventId': series.get('graph_event_id'), 'joinUrl': series.get('join_url'),
                  'onlineMeetingId': series.get('online_meeting_id')}]
    result = None
    for root in roots:
        owner = str(series.get('organizer_email') or '').strip()
        event_id, link, meeting_id = (root.get(key) for key in ('eventId', 'joinUrl', 'onlineMeetingId'))
        if not owner or not event_id or not link or not meeting_id or not join_context_oid(link):
            raise CalendarStateError('The saved meeting identities are incomplete. No people or roles were imported.')
        event = read(f'users/{quote(owner, safe="")}/events/{quote(event_id, safe="")}'
                     '?$select=id,type,isOrganizer,isCancelled,organizer,onlineMeeting,attendees')
        if (not isinstance(event, dict) or event.get('id') != event_id or event.get('isOrganizer') is not True
                or event.get('type') not in {'seriesMaster', 'singleInstance'} or event.get('isCancelled')
                or (event.get('onlineMeeting') or {}).get('joinUrl') != link
                or str(((event.get('organizer') or {}).get('emailAddress') or {}).get('address') or '').casefold() != owner.casefold()):
            raise CalendarStateError('Microsoft did not verify the saved organiser event. No people or roles were imported.')
        meeting = read_online(SimpleNamespace(read=read), {'online_meeting_id': meeting_id, 'join_url': link},
                              f'users/{quote(join_context_oid(link), safe="")}/onlineMeetings/{quote(meeting_id, safe="")}')
        roles = confirmed_roles(meeting)
        if roles is None:
            raise CalendarStateError('Microsoft did not return complete meeting roles. Saved values were preserved.')
        current = {
            'attendees': sorted(people(event)),
            'presenters': sorted(presenter_labels(roles, series.get('presenters'))),
            'coOrganizers': sorted({item['upn'].strip().lower() for item in roles if item['role'] == 'coorganizer'}),
        }
        if result is not None and current != result:
            raise CalendarStateError('The weekday meetings have different people or roles in Teams. Review them separately; nothing was imported.')
        result = current
    return result


def refresh_people(live_id):
    from . import views as v

    series, rows, _snapshot = load_calendar_state(live_id)
    if series.get('status') != 'active' or series.get('meeting_type') == 'linked-external':
        raise CalendarStateError('Use the original calendar editor for imported meetings; only active LMS calendars can be refreshed here.')
    before = digest([series, rows])
    with calendar_reader() as read:
        values = read_people(series, read)
    with transaction.atomic():
        current, current_rows, _snapshot = load_calendar_state(live_id, lock=True)
        if digest([current, current_rows]) != before:
            raise CalendarStateError('The saved meeting changed during the Teams read. Retry; nothing was imported.')
        updates = {}
        for column, key in (('attendees', 'attendees'), ('presenters', 'presenters'), ('co_organizers', 'coOrganizers')):
            if sorted(v.teams_series_email_list(current.get(column))) != values[key]:
                updates[column] = v.json_db_value(values[key])
        if updates:
            v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id],
                                    {**updates, 'updated_at': datetime.now(timezone.utc)})
    if updates:
        v.invalidate_curriculum_cache(content_scope=series.get('module_catalogue_id'))
    elevated = set(values['presenters'] + values['coOrganizers'])
    return {'form': {'organizerEmail': series['organizer_email'], **values,
                     'attendees': [email for email in values['attendees'] if email not in elevated]},
            'changed': bool(updates), 'message': 'People and roles refreshed from Teams. Session dates, settings and join links are unchanged.'}


@never_cache
@require_role('admin', 'staff')
@require_POST
def teams_people_refresh(request, live_session_id):
    try:
        return JsonResponse(refresh_people(live_session_id))
    except LookupError:
        return JsonResponse({'error': 'Calendar not found.'}, status=404)
    except (CalendarStateError, Blocked) as exc:
        return JsonResponse({'error': str(exc)}, status=409)
    except (httpx.HTTPError, DatabaseError, RuntimeError, ValueError, TypeError, AttributeError):
        return JsonResponse({'error': 'People and roles could not be refreshed from Teams. Retry; the displayed form was preserved.'}, status=502)
