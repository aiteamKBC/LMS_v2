"""Review and attach an existing Microsoft series. Graph transport is GET-only.

Provider identities come from the original meeting, never from the URL text or
the position of a week. No meeting/invitation is created, moved or cancelled.
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote, urlencode, urlsplit

import httpx
from django.core import signing
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_POST

from .teams_external_calendar import external_calendar_settings, instant
from .teams_imported_participants import join_context_oid
from .session_graph import collection

SALT = 'curriculum.existing-teams-series.v1'
OFF = {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
logger = logging.getLogger(__name__)


class LinkError(ValueError):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def text(value):
    return str(value or '').strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def request_values(payload):
    link = text(payload.get('link'))
    try:
        url = urlsplit(link)
        if url.port not in (None, 443):
            raise ValueError()
    except ValueError as exc:
        raise LinkError('Paste a valid original Teams meeting link.', 400) from exc
    if (url.scheme != 'https' or url.hostname not in {'teams.microsoft.com', 'teams.cloud.microsoft'}
            or url.username or url.password or len(link) > 8192):
        raise LinkError('Paste the original https://teams.microsoft.com meeting link.', 400)
    raw = payload.get('weekIds')
    if not isinstance(raw, list) or not raw or len(raw) > 200 or any(not isinstance(x, str) for x in raw):
        raise LinkError('Choose the saved live-session weeks to link.', 400)
    weeks = sorted(set(text(x) for x in raw if text(x)))
    mailbox = text(payload.get('calendarMailbox'))
    if not weeks or len(mailbox) > 254 or any(x in mailbox for x in ('/', '\\', '?', '#')):
        raise LinkError('Check the selected weeks and calendar mailbox.', 400)
    return {'link': link, 'weekIds': weeks, 'calendarMailbox': mailbox}


def module_targets(module_id, week_ids):
    from . import views as v
    resolved = v.resolve_stored_module_catalogue_id(module_id) or module_id
    module = v.authoring_module_exists(resolved)
    if not module:
        raise LinkError('The saved module was not found.', 404)
    if module.get('deleted_at') or module.get('is_programme_deleted'):
        raise LinkError('An archived module cannot be linked.')
    if v.archived_programme_module_edit_error(module, title=module.get('title'),
            programme_id=module.get('programme_id'), programme_name=module.get('programme_name')):
        raise LinkError('This programme is archived.')
    groups = v.authoring_fetch_all(v.GROUPS_TABLE, 'group_id = %s', [module['group_id']]) if module.get('group_id') else []
    group = groups[0] if groups else {}
    weeks = v.active_week_rows(v.authoring_fetch_all(v.AUTHORING_WEEKS_TABLE,
        'module_catalogue_id = %s', [resolved], 'display_order, week_number, id'))
    if not set(week_ids) <= {text(w['id']) for w in weeks}:
        raise LinkError('The selected weeks changed. Save and reopen this module.')
    components = v.active_component_rows(v.authoring_fetch_all(v.AUTHORING_COMPONENTS_TABLE,
        'module_catalogue_id = %s', [resolved], 'display_order, id'))
    slots, _ = v.module_week_delivery_slots(module, group, len(weeks))
    targets = []
    for index, week in enumerate(weeks):
        if text(week['id']) not in week_ids:
            continue
        mains = [row for row in components if row.get('week_id') == week['id']
                 and v.replaceable_live_session(row)
                 and text(v.component_builder_settings(row).get('teamsMeetingScope')).lower() != 'additional']
        for position, row in enumerate(mains):
            planned = slots[index][position] if index < len(slots) and position < len(slots[index]) else {}
            targets.append({'row': row, 'week': week, 'planned': planned})
    if not targets:
        raise LinkError('Save a main live-session component in the selected weeks first.', 400)
    if any(not text(item['planned'].get('date')) for item in targets):
        raise LinkError('Every selected main session needs a saved delivery date before linking.', 400)
    return module, targets


def discover(values, targets):
    """Resolve one exact join URL and a complete, unique original recurrence."""
    from coach_api.views import microsoft_graph_request as graph, get_graph_settings
    from .teams_weekly_calendar import graph_event_utc
    from . import views as v
    link = values['link']
    owner = join_context_oid(link) or values['calendarMailbox'] or v.teams_meeting_default_organizer()
    if not owner:
        raise LinkError('Enter a calendar mailbox that holds the original series.', 400)
    query = urlencode({'$filter': "JoinWebUrl eq '" + link.replace("'", "''") + "'"})
    try:
        meetings = graph('GET', f'users/{quote(owner, safe="")}/onlineMeetings?{query}')
        if isinstance(meetings, dict) and meetings.get('@odata.nextLink'):
            raise LinkError('Microsoft did not return a complete unique online-meeting match.')
        meetings = meetings.get('value') if isinstance(meetings, dict) else None
        if (not isinstance(meetings, list) or len(meetings) != 1 or not text(meetings[0].get('id'))
                or text(meetings[0].get('joinWebUrl')) != link):
            raise LinkError('Microsoft did not identify one online meeting for this exact link.')
        online = meetings[0]
        real_owner = (((online.get('participants') or {}).get('organizer') or {}).get('identity') or {}).get('user') or {}
        if join_context_oid(link) and text(real_owner.get('id')) and text(real_owner['id']).lower() != owner.lower():
            raise LinkError('The meeting organiser differs from the pasted link. Nothing was linked.')
        dates = sorted(text(t['planned']['date']) for t in targets)
        first = datetime.fromisoformat(dates[0]).replace(tzinfo=timezone.utc) - timedelta(days=1)
        last = datetime.fromisoformat(dates[-1]).replace(tzinfo=timezone.utc) + timedelta(days=2)
        if (last - first).days > 550:
            raise LinkError('Review a delivery range of at most 18 months at a time.', 400)
        query = urlencode({'startDateTime': first.isoformat(), 'endDateTime': last.isoformat(),
            '$select': 'id,iCalUId,subject,start,end,organizer,onlineMeeting,seriesMasterId,type,isCancelled,isOrganizer',
            '$top': 100})
        candidates = list(dict.fromkeys(x for x in
            (values['calendarMailbox'], owner, v.teams_meeting_default_organizer()) if x))
        matches, mailbox = [], ''
        for candidate in candidates:
            resource = f'users/{quote(candidate, safe="")}/calendarView'
            paginated = False
            def read_calendar(method, path):
                nonlocal paginated
                if method != 'GET' or unquote(urlsplit(path).path) != unquote(resource):
                    raise RuntimeError('Microsoft changed the calendar resource during pagination.')
                value = graph(method, path)
                paginated = paginated or bool(isinstance(value, dict) and value.get('@odata.nextLink'))
                return value
            try:
                events = collection(read_calendar, f'{resource}?{query}', get_graph_settings()['base_url'])
            except RuntimeError:
                if paginated:
                    raise LinkError('Microsoft returned an incomplete calendar. No session was inferred from a partial result.')
                continue
            found = [e for e in events if not e.get('isCancelled') and text(e.get('seriesMasterId'))
                     and text((e.get('onlineMeeting') or {}).get('joinUrl')) == link]
            if len({text(e['seriesMasterId']) for e in found}) > 1:
                raise LinkError('More than one recurrence uses this link in that calendar. Choose its original mailbox.')
            if found:
                matches, mailbox = found, candidate
                break
        if not matches:
            raise LinkError('The original recurring calendar could not be read. Enter a mailbox holding its invitation, or check Microsoft access.')
        master = graph('GET', f'users/{quote(mailbox, safe="")}/events/{quote(matches[0]["seriesMasterId"], safe="")}')
        if (not isinstance(master, dict) or master.get('isCancelled') or text((master.get('onlineMeeting') or {}).get('joinUrl')) != link
                or text(((master.get('recurrence') or {}).get('pattern') or {}).get('type')).lower() != 'weekly'):
            raise LinkError('The original weekly series could not be verified for this link.')
        organiser = text(((master.get('organizer') or {}).get('emailAddress') or {}).get('address'))
        if not organiser:
            raise LinkError('Microsoft did not return the original organiser.')
        # Calendar copies can have different IDs. Only organizer-owned IDs can
        # later be used by the original-calendar editor.
        owned = master.get('isOrganizer') is True
        rows = []
        for event in matches:
            normalized = graph_event_utc(event)
            start, end = instant((normalized.get('start') or {}).get('dateTime')), instant((normalized.get('end') or {}).get('dateTime'))
            if not start or not end or end <= start:
                raise LinkError('Microsoft returned an invalid occurrence time.')
            rows.append({'id': 'DISCOVERED-' + digest([start, end])[:24], 'session_number': len(rows) + 1,
                'scheduled_start': start, 'scheduled_end': end, 'join_url': link,
                'online_meeting_id': online['id'], 'graph_event_id': text(event.get('id')) if owned else '',
                'status': 'scheduled'})
        if len({(r['scheduled_start'], r['scheduled_end']) for r in rows}) != len(rows):
            raise LinkError('Microsoft returned duplicate occurrence times. Nothing was linked.')
        artifact_owner = text(real_owner.get('id')) or owner
        for resource in ('recordings', 'attendanceReports'):
            graph('GET', f'users/{quote(artifact_owner, safe="")}/onlineMeetings/{quote(online["id"], safe="")}/{resource}?$top=1')
    except LinkError:
        raise
    except (RuntimeError, httpx.HTTPError, ValueError, TypeError, KeyError) as exc:
        raise LinkError('Microsoft could not verify this series and access to its recordings/attendance. No links were changed.', 502) from exc
    try:
        zone = v.calendar_zone(
            text(((master.get('recurrence') or {}).get('range') or {}).get('recurrenceTimeZone'))
            or text((master.get('start') or {}).get('timeZone')) or 'Europe/London').key
    except ValueError as exc:
        raise LinkError('The original calendar time zone could not be verified. No dates were inferred.') from exc
    return {'online': online, 'organizer': organiser, 'masterId': text(master.get('id')) if owned else '',
            'subject': text(master.get('subject')), 'zone': zone, 'rows': sorted(rows, key=lambda r: r['scheduled_start'])}


def review(module_id, values):
    from . import views as v
    module, targets = module_targets(module_id, values['weekIds'])
    series = [r for r in v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE,
        'module_catalogue_id = %s', [module['module_catalogue_id']])
        if text(r.get('status')).lower() not in OFF and text(r.get('meeting_type')) != 'week-additional']
    if len(series) > 1 or (series and text(series[0].get('join_url')) != values['link']):
        raise LinkError('This module already owns a different calendar. Review it instead of replacing its identity.')
    source = discover(values, targets)
    existing = series[0] if series else None
    if existing and existing.get('meeting_type') != 'linked-external':
        raise LinkError('This calendar was created by the LMS. Use Update Teams meeting or Restore Teams data.')
    if existing and text(existing.get('online_meeting_id')) != text(source['online']['id']):
        raise LinkError('The saved online-meeting identity differs from Microsoft. Nothing was replaced.')
    other = [r for r in v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'online_meeting_id = %s', [source['online']['id']])
             if r.get('module_catalogue_id') != module['module_catalogue_id'] and text(r.get('status')).lower() not in OFF]
    if other or text(module.get('teams_shared_source_module_id')):
        raise LinkError('This meeting already has an LMS source module. Use its shared calendar/Restore Teams data rather than importing a second owner.')
    claimed, rows = set(), []
    proof = {'id': text((existing or {}).get('id')) or 'PREVIEW', 'join_url': values['link'],
             'online_meeting_id': source['online']['id']}
    for target in targets:
        settings = external_calendar_settings({}, proof, target['planned'], source['rows'], claimed, source['zone'])
        target['binding'] = settings
        rows.append({'componentId': target['row']['id'], 'weekId': target['week']['id'],
            'title': text(target['week'].get('title')), 'date': text(target['planned']['date']),
            'status': settings['teamsCalendarBinding'],
            'holidays': target['planned'].get('holidays') or target['planned'].get('skippedHolidays') or []})
    matched = sum(r['status'] == 'matched' for r in rows)
    fingerprint = digest([values, [(r['componentId'], r['date'], r['status']) for r in rows],
        source['online']['id'], source['organizer'], source['zone'], source['masterId'], source['rows']])
    result = {'sessions': rows, 'matched': matched, 'unmatched': len(rows) - matched,
              'organizer': source['organizer'], 'timeZone': source['zone'],
              'structureRevision': v.module_structure_revision(module['module_catalogue_id'])}
    return module, targets, source, existing, fingerprint, result


def preview(module_id, payload):
    values = request_values(payload)
    module, _targets, _source, _existing, proof, result = review(module_id, values)
    result['previewToken'] = signing.dumps({'module': module['module_catalogue_id'], 'values': values,
        'proof': proof, 'revision': result['structureRevision']}, salt=SALT, compress=True)
    return result


def apply(module_id, payload):
    from . import views as v
    try:
        token = signing.loads(text(payload.get('previewToken')), salt=SALT, max_age=600)
    except signing.BadSignature as exc:
        raise LinkError('This series review expired. Check the existing series again.') from exc
    if token['module'] != module_id and token['module'] != (v.resolve_stored_module_catalogue_id(module_id) or module_id):
        raise LinkError('This review belongs to another module.')
    module, targets, source, existing, proof, result = review(module_id, token['values'])
    if token['module'] != module['module_catalogue_id'] or token['proof'] != proof:
        raise LinkError('The series or selected dates changed. Check the existing series again.')
    if not result['matched']:
        raise LinkError('No session matches the saved plan. Nothing was linked.')
    series_id = text((existing or {}).get('id')) or 'LIVE-' + digest([module['module_catalogue_id'], source['online']['id']])[:32].upper()
    matched_discovered = {t['binding']['teamsOccurrenceId'] for t in targets}
    target_proof = digest([(t['row']['id'], t['week']['id'], t['planned']) for t in targets])
    with transaction.atomic():
        v.lock_module_structure_row(module['module_catalogue_id'])
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_advisory_xact_lock(hashtext(%s))', ['curriculum:existing-series:' + source['online']['id']])
        current = [r for r in v.authoring_fetch_all(v.LIVE_SESSIONS_TABLE, 'online_meeting_id = %s', [source['online']['id']])
                   if text(r.get('status')).lower() not in OFF]
        if any(r.get('module_catalogue_id') != module['module_catalogue_id'] for r in current):
            raise LinkError('This meeting was linked in another module during review. Nothing was changed.')
        if len(current) > 1 or (current and text(current[0].get('id')) != series_id):
            raise LinkError('The saved meeting identity changed during review.')
        if current:
            existing = current[0]
        module, targets = module_targets(module_id, token['values']['weekIds'])
        if target_proof != digest([(t['row']['id'], t['week']['id'], t['planned']) for t in targets]):
            raise LinkError('The selected plan changed during review. Check the existing series again.')
        old_rows = v.authoring_fetch_all(v.LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [series_id], 'session_number')
        by_time = {(instant(r.get('scheduled_start')), instant(r.get('scheduled_end'))): r for r in old_rows}
        if len(by_time) != len(old_rows):
            raise LinkError('The saved calendar has duplicate occurrence times. Review it before linking.')
        attached_rows = []
        number = max([int(r.get('session_number') or 0) for r in old_rows] or [0])
        for row in source['rows']:
            # Import only occurrences a selected component matched; an unrelated
            # recurrence date must not acquire this module's learners/evidence.
            if row['id'] not in matched_discovered:
                continue
            stored = by_time.get((row['scheduled_start'], row['scheduled_end']))
            if stored and (text(stored.get('join_url')) != token['values']['link']
                    or text(stored.get('status')).lower() in OFF
                    or text(stored.get('online_meeting_id')) not in ('', text(source['online']['id']))):
                raise LinkError('A saved occurrence belongs to another link. Nothing was overwritten.')
            if stored:
                attached_rows.append(stored)
            else:
                number += 1
                attached_rows.append({**row, 'id': 'OCC-' + digest([series_id, row['scheduled_start'], row['scheduled_end']])[:32].upper(),
                    'live_session_id': series_id, 'session_number': number})
        settings_by_id, claimed = {}, set()
        series = existing or {'id': series_id, 'join_url': token['values']['link'], 'online_meeting_id': source['online']['id']}
        for target in targets:
            settings_by_id[target['row']['id']] = {**v.component_builder_settings(target['row']),
                **external_calendar_settings({}, series, target['planned'], attached_rows, claimed, source['zone']),
                'liveSessionLinkOverride': token['values']['link'], 'teamsMeetingScope': 'main',
                'teamsOrganizerEmail': source['organizer']}
        already = existing and all(all(v.component_builder_settings(t['row']).get(k) == value
            for k, value in settings_by_id[t['row']['id']].items()) for t in targets)
        if not already and v.module_structure_revision(module['module_catalogue_id']) != token['revision']:
            raise LinkError('The saved module changed during review. Check the existing series again.')
        if not already:
            now = datetime.utcnow()
            if not existing:
                v.authoring_upsert(v.LIVE_SESSIONS_TABLE, ['id'], {
                    **series, 'module_catalogue_id': module['module_catalogue_id'], 'module_title': source['subject'],
                    'organizer_email': source['organizer'], 'graph_event_id': source['masterId'], 'provider': 'Microsoft Teams',
                    'start_datetime': attached_rows[0]['scheduled_start'], 'timezone': source['zone'],
                    'duration_minutes': int((attached_rows[0]['scheduled_end'] - attached_rows[0]['scheduled_start']).total_seconds() / 60),
                    'repeat_pattern': 'weekly', 'repeat_occurrences': len(attached_rows),
                    'meeting_type': 'linked-external', 'status': 'active', 'created_at': now, 'updated_at': now})
            else:
                all_rows = {row['id']: row for row in [*old_rows, *attached_rows]}
                active_rows = [row for row in all_rows.values() if text(row.get('status')).lower() not in OFF]
                v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s AND module_catalogue_id = %s',
                    [series_id, module['module_catalogue_id']], {
                        'repeat_occurrences': len(active_rows),
                        'start_datetime': min(instant(row['scheduled_start']) for row in active_rows),
                        'updated_at': now,
                    })
            for row in attached_rows:
                if row['id'] not in {r['id'] for r in old_rows}:
                    v.authoring_upsert(v.LIVE_SESSION_OCCURRENCES_TABLE, ['id'], {**row, 'created_at': now, 'updated_at': now})
            for target in targets:
                v.update_authoring_rows(v.AUTHORING_COMPONENTS_TABLE, 'id = %s AND module_catalogue_id = %s',
                    [target['row']['id'], module['module_catalogue_id']], {
                        'settings_json': v.json_db_value(settings_by_id[target['row']['id']]),
                        'live_sessions_link': token['values']['link'], 'updated_at': now})
            with connection.cursor() as cursor:
                # A running worker keeps its lease. Its normal completion path
                # sees requested_at > started_at and queues a follow-up pass,
                # including newly attached occurrences, without a second worker.
                cursor.execute('''INSERT INTO curriculum.session_result_jobs(live_session_id,force_refresh) VALUES (%s,true)
                    ON CONFLICT(live_session_id) DO UPDATE SET
                    state=CASE WHEN session_result_jobs.state='running' THEN 'running' ELSE 'queued' END,
                    requested_at=now(),next_attempt_at=now(),force_refresh=true,last_error='',
                    attempts=CASE WHEN session_result_jobs.state='running' THEN session_result_jobs.attempts ELSE 0 END''', [series_id])
        refreshed_module = v.stamp_revision_after_write(v.get_authoring_structure_payload(module['module_catalogue_id']), module['module_catalogue_id'])
    v.invalidate_curriculum_cache()
    return {**result, 'alreadyLinked': bool(already), 'module': refreshed_module}


@never_cache
@require_POST
def existing_series(request, module_catalogue_id):
    from . import views as v
    payload = v.json_body(request)
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.', status=400)
    try:
        if payload.get('action') not in ('preview', 'apply'):
            raise LinkError('Choose preview or apply.', 400)
        return JsonResponse(preview(module_catalogue_id, payload) if payload['action'] == 'preview'
                            else apply(module_catalogue_id, payload))
    except LinkError as exc:
        return v.json_error(str(exc), status=exc.status)
    except DatabaseError as exc:
        logger.error('Existing-series database verification failed for module %s (%s).',
                     module_catalogue_id, type(exc).__name__)
        return v.json_error('The database result could not be verified. Reopen the module before retrying.', status=502)
