"""Import verified meeting people/roles; Microsoft is read-only.

Imported invitation lists keep their existing original-owner reader. Explicit
online-meeting roles can also be checked by the existing scheduled worker.
Neither path imports dates, changes meeting identities, or sends invitations.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
import logging
import time
from types import SimpleNamespace
from urllib.parse import quote

import httpx
from django.core.cache import cache
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods
from login.permissions import require_role

from .teams_calendar_state import calendar_reader, load_calendar_state
from .teams_cancellation_checks import CalendarStateError
from .teams_imported_calendar_update import Blocked, digest
from .teams_imported_meeting_edit import confirmed_roles, people, presenter_labels, read_online
from .teams_meeting_options_policy import stored_email_list
from .teams_imported_participants import join_context_oid
from .teams_weekly_calendar import stored_calendar_series

CHECK_SECONDS = 300
log = logging.getLogger(__name__)


def sync_info(live_id):
    return cache.get(f'teams-people-sync:{live_id}') or {'status': 'never', 'checkedAt': None}


@contextmanager
def people_sync_lock(live_id):
    """One manual/automatic reader per series, across serving processes."""
    key = 'curriculum:teams-people:' + str(live_id)
    with connection.cursor() as cursor:
        cursor.execute('SELECT pg_try_advisory_lock(hashtextextended(%s, 0))', [key])
        acquired = cursor.fetchone()[0]
    if not acquired:
        raise CalendarStateError('People sync is already running for this meeting. Wait, then retry.')
    try:
        yield
    finally:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_advisory_unlock(hashtextextended(%s, 0))', [key])


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
        imported = series.get('meeting_type') == 'linked-external'
        if not owner or (not imported and not event_id) or not link or not meeting_id or not join_context_oid(link):
            raise CalendarStateError('The saved meeting identities are incomplete. No people or roles were imported.')
        event = None if imported else read(f'users/{quote(owner, safe="")}/events/{quote(event_id, safe="")}'
                     '?$select=id,type,isOrganizer,isCancelled,organizer,onlineMeeting,attendees')
        if not imported and (not isinstance(event, dict) or event.get('id') != event_id or event.get('isOrganizer') is not True
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
            # Imported group calendars can require an interactive delegated
            # calendar sign-in. The worker reads explicit online-meeting roles
            # using the existing app policy; it never impersonates that user or
            # infers/replaces their original calendar invitation list.
            'attendees': sorted(stored_email_list(series.get('attendees'))) if imported else sorted(people(event)),
            'presenters': sorted(presenter_labels(roles, series.get('presenters'))),
            'coOrganizers': sorted({item['upn'].strip().lower() for item in roles if item['role'] == 'coorganizer'}),
        }
        if result is not None and current != result:
            raise CalendarStateError('The weekday meetings have different people or roles in Teams. Review them separately; nothing was imported.')
        result = current
    return result


def _refresh_people(live_id):
    from . import views as v

    series, rows, _snapshot = load_calendar_state(live_id)
    if series.get('status') != 'active':
        raise CalendarStateError('Only active Teams meetings can be refreshed.')
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


def refresh_people(live_id, *, automatic=False):
    """The button and existing session worker enter this same service."""
    with people_sync_lock(live_id):
        info = sync_info(live_id)
        if automatic and time.time() - info.get('attemptEpoch', 0) < CHECK_SECONDS:
            return {'skipped': True}
        checked = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        state = {'attemptEpoch': time.time(), 'checkedAt': checked, 'status': 'failed',
                 'message': 'The latest Teams role check failed. Saved roles were kept; retry Sync.',
                 'lastSuccessAt': info.get('lastSuccessAt')}
        try:
            result = _refresh_people(live_id)
        except Exception:
            cache.set(f'teams-people-sync:{live_id}', state, 86400)
            raise
        cache.set(f'teams-people-sync:{live_id}', {**state, 'status': 'synced',
                  'lastSuccessAt': checked, 'message': 'People and roles are synced with Teams.'}, 86400)
        return result


def saved_people(live_id):
    series, _rows, _snapshot = load_calendar_state(live_id)
    elevated = set(stored_email_list(series.get('presenters')) + stored_email_list(series.get('co_organizers')))
    return {'form': {'organizerEmail': series.get('organizer_email') or '',
                     'attendees': [email for email in stored_email_list(series.get('attendees')) if email not in elevated],
                     'presenters': stored_email_list(series.get('presenters')), 'coOrganizers': stored_email_list(series.get('co_organizers'))},
            'syncInfo': sync_info(live_id)}


def sync_due_people(*, limit=10, series_ids=()):
    """Bounded role phase of the existing worker; no new thread/job/queue."""
    with connection.cursor() as cursor:
        cursor.execute('''SELECT s.id FROM curriculum.live_sessions s
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            WHERE s.status='active' AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
              AND coalesce(s.online_meeting_id,'')<>'' AND coalesce(s.join_url,'')<>''
              AND (%s OR s.id=ANY(%s)) ORDER BY s.id''', [not bool(series_ids), list(series_ids)])
        ids = [row[0] for row in cursor.fetchall()]
    # Oldest checks first so a bounded worker pass cannot starve later series.
    statuses = cache.get_many([f'teams-people-sync:{identity}' for identity in ids])
    ids.sort(key=lambda identity: statuses.get(f'teams-people-sync:{identity}', {}).get('attemptEpoch', 0))
    checked = failed = 0
    deadline = time.monotonic() + 30
    for identity in ids:
        if checked + failed >= max(1, min(limit, 100)) or time.monotonic() >= deadline:
            break
        if time.time() - statuses.get(f'teams-people-sync:{identity}', {}).get('attemptEpoch', 0) < CHECK_SECONDS:
            continue
        try:
            result = refresh_people(identity, automatic=True)
            checked += not result.get('skipped', False)
        except Exception as error:
            failed += 1
            log.warning('Teams people sync needs retry (%s); saved people and session jobs are preserved.', type(error).__name__)
    return {'checked': checked, 'failed': failed}


@never_cache
@require_role('admin', 'staff')
@require_http_methods(['GET', 'POST'])
def teams_people_refresh(request, live_session_id):
    try:
        return JsonResponse(saved_people(live_session_id) if request.method == 'GET' else refresh_people(live_session_id))
    except LookupError:
        return JsonResponse({'error': 'Calendar not found.'}, status=404)
    except (CalendarStateError, Blocked) as exc:
        return JsonResponse({'error': str(exc)}, status=409)
    except (httpx.HTTPError, DatabaseError, RuntimeError, ValueError, TypeError, AttributeError):
        return JsonResponse({'error': 'People and roles could not be refreshed from Teams. Retry; the displayed form was preserved.'}, status=502)
