"""Edit the verified original imported meeting, without replacing its calendar.

Shares the imported calendar operation ledger: attempts are committed before
Graph writes, and status checks only read. No meeting creation, mail or forward.
"""
import copy
from datetime import date, datetime, timedelta, timezone
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo
import uuid

from django.core import signing
from django.db import transaction

from . import teams_imported_calendar_update as calendar
from .teams_calendar_actions import eligible, load_module, persist_move, store_snapshot
from .teams_calendar_state import load_calendar_state
from .teams_imported_participants import join_context_oid, text
from .session_overrides import schedule_override

SALT = 'curriculum.imported-meeting-edit.v1'
KIND = 'meeting-edit'
ONLINE_FIELDS = ('id', 'joinWebUrl', 'participants', 'allowedPresenters', 'lobbyBypassSettings',
                 'allowRecording', 'recordAutomatically', 'allowTranscription', 'meetingSpokenLanguageTag')
LOBBIES = {'invited', 'organization', 'organizationExcludingGuests', 'everyone', 'organizer'}


def load_edit(live_id, *, lock=False):
    series, rows, snapshot = load_calendar_state(live_id, lock=lock)
    if series.get('meeting_type') != 'linked-external' or series.get('status') != 'active':
        raise calendar.Blocked('not_active_imported_series', 'Choose an active imported Teams series.')
    module = load_module(series, lock=lock)
    version = calendar.digest([series, rows, module])
    return series, rows, snapshot, module, version


def pending(snapshot):
    return any((snapshot.get(key) or {}).get('status') in {'processing', 'uncertain'}
               for key in (calendar.KEY, 'management'))


def event_state(event):
    # Ignore response-status churn while keeping invitation identity/type.
    normalized = copy.deepcopy(event)
    for key in ('start', 'end'):
        if normalized.get(key):
            normalized[key] = calendar.iso(calendar.event_instant(event, key))
    return calendar.digest([calendar.protected_master(normalized), event.get('recurrence'),
                            event.get('isCancelled'), event.get('seriesMasterId')])


def online_state(meeting):
    value = {key: copy.deepcopy(meeting.get(key)) for key in ONLINE_FIELDS}
    participants = value.get('participants') or {}
    participants['attendees'] = sorted((text(item.get('upn')).casefold(), text(item.get('role')))
                                        for item in participants.get('attendees') or [])
    value['participants'] = participants
    return calendar.digest(value)


def emails(value):
    from .views import teams_attendee_emails
    if not isinstance(value, list) or len(value) > 500:
        raise ValueError('Supply a list of at most 500 email addresses.')
    return teams_attendee_emails(value)


def people(event):
    raw = event.get('attendees')
    if not isinstance(raw, list):
        raise calendar.Blocked('invitation_list_unavailable', 'The complete original invitation list could not be read.')
    addresses = [text((item.get('emailAddress') or {}).get('address')).casefold() for item in raw]
    if any(not address or item.get('type') not in {'required', 'optional', 'resource'}
           for address, item in zip(addresses, raw)) or len(set(addresses)) != len(addresses):
        raise calendar.Blocked('invitation_list_incomplete', 'Some invitations have incomplete identities; they cannot be overwritten.')
    return addresses


def online_path(series, access):
    owner, identity = join_context_oid(series.get('join_url')), text(series.get('online_meeting_id'))
    scopes = set(access.get('scopes') or [])
    if not owner or not identity or not scopes.intersection({'OnlineMeetings.ReadWrite', 'OnlineMeetings.ReadWrite.All'}):
        return None
    return f'users/{quote(owner, safe="")}/onlineMeetings/{quote(identity, safe="")}'


def read_online(client, series, path):
    meeting = client.read(path)
    organizer = (((meeting.get('participants') or {}).get('organizer') or {}).get('identity') or {}).get('user') or {}
    if (meeting.get('id') != series.get('online_meeting_id') or meeting.get('joinWebUrl') != series.get('join_url')
            or text(organizer.get('id')).casefold() != join_context_oid(series.get('join_url')).casefold()):
        raise calendar.Blocked('meeting_identity_mismatch', 'Microsoft returned a different online meeting. No edit is allowed.')
    return meeting


def verified_context(series, rows, client):
    path, master = calendar.original_master(series, client)
    if not rows:
        raise calendar.Blocked('no_saved_occurrences', 'No saved session identities are available for this calendar.')
    last = max(calendar.utc_datetime(row['scheduled_end']).date() for row in rows)
    last = max(last, calendar.recurrence_end(master.get('recurrence') or {}, last))
    events = calendar.instances(client, path, master, last)
    return path, master, events, last


def read_edit(live_id, actor, access):
    series, rows, snapshot, module, version = load_edit(live_id)
    if pending(snapshot):
        operation = snapshot.get(calendar.KEY) or {}
        return {**calendar.pending_result(operation), 'addedSessions': []}
    calendar.require_access(access, series)
    with calendar.CalendarClient(access) as client:
        path, master, events, through = verified_context(series, rows, client)
        addresses = people(master)
        meeting_path = online_path(series, access)
        meeting = None
        if meeting_path:
            try:
                meeting = read_online(client, series, meeting_path)
            except calendar.GraphRefusal:
                meeting_path = None
    roles = (meeting or {}).get('participants', {}).get('attendees')
    roles_editable = isinstance(roles, list) and all(text(item.get('upn')) and item.get('role') in
                          {'attendee', 'presenter', 'coorganizer'} for item in roles)
    source = {'kind': KIND, 'liveId': live_id, 'actor': actor, 'version': version,
              'accessMode': access['mode'], 'accessActor': text(access.get('actorId')),
              'calendarKind': access['calendarKind'], 'tenantId': access['tenantId'],
              'path': path, 'master': master, 'events': events, 'through': through.isoformat(),
              'onlinePath': meeting_path, 'online': meeting, 'joinUrl': series['join_url']}
    zone_name = calendar.ZONES.get(text(series.get('timezone')), text(series.get('timezone')) or 'Europe/London')
    by_slot = {}
    for event in events:
        if not event.get('isCancelled'):
            by_slot.setdefault(calendar.event_slot(event), []).append(event)
    return {'status': 'editable', 'sourceToken': signing.dumps(source, salt=SALT, compress=True),
            'organizer': (master.get('organizer') or {}).get('emailAddress', {}).get('address', ''),
            'attendees': addresses, 'joinUrl': series['join_url'], 'timeZone': zone_name,
            'options': {key: meeting.get(key) for key in ONLINE_FIELDS if key not in {'id', 'joinWebUrl', 'participants'}} if meeting else None,
            'rolesEditable': roles_editable,
            'presenters': [item['upn'] for item in roles or [] if item.get('role') == 'presenter'] if roles_editable else [],
            'coOrganizers': [item['upn'] for item in roles or [] if item.get('role') == 'coorganizer'] if roles_editable else [],
            'sessions': [{'sessionNumber': row['session_number'], 'start': calendar.iso(row['scheduled_start']),
                          'end': calendar.iso(row['scheduled_end']), 'editable': eligible(row)
                          and calendar.utc_datetime(row['scheduled_start']) > datetime.now(timezone.utc)
                          and len(by_slot.get((calendar.iso(row['scheduled_start']), calendar.iso(row['scheduled_end'])), [])) == 1}
                         for row in rows],
            'message': 'Original calendar verified. Change only the people, options or future session times you need.'}


def options_patch(source, edits):
    meeting = source.get('online')
    relevant = set(edits) & {'recording', 'lobby', 'language', 'presenters', 'coOrganizers'}
    if not relevant:
        return {}
    if not meeting or not source.get('onlinePath'):
        raise calendar.Blocked('meeting_options_unavailable', 'Online meeting write access was not verified; invitation changes can be saved separately.')
    result = {}
    if 'recording' in edits:
        if edits['recording'] not in {'none', 'record', 'record-transcribe'}:
            raise ValueError('Choose a valid recording option.')
        result.update(allowRecording=edits['recording'] != 'none', recordAutomatically=edits['recording'] != 'none',
                      allowTranscription=edits['recording'] == 'record-transcribe')
    if 'lobby' in edits:
        if edits['lobby'] not in LOBBIES:
            raise ValueError('Choose a valid lobby option.')
        result['lobbyBypassSettings'] = {**(meeting.get('lobbyBypassSettings') or {}), 'scope': edits['lobby']}
    if 'language' in edits:
        if edits['language'] not in {'en-GB', 'en-US', 'ar-EG', 'fr-FR'}:
            raise ValueError('Choose a valid spoken language.')
        result['meetingSpokenLanguageTag'] = edits['language']
    if set(edits) & {'presenters', 'coOrganizers'}:
        entries = (meeting.get('participants') or {}).get('attendees')
        if not isinstance(entries, list) or any(not text(item.get('upn')) or item.get('role') not in
                                                {'attendee', 'presenter', 'coorganizer'} for item in entries):
            raise calendar.Blocked('roles_incomplete', 'The complete role list was not returned. Existing roles will not be overwritten.')
        co = set(emails(edits.get('coOrganizers', [item['upn'] for item in entries if item.get('role') == 'coorganizer'])))
        presenters = set(emails(edits.get('presenters', [item['upn'] for item in entries if item.get('role') == 'presenter']))) - co
        existing = {text(item['upn']).casefold(): item for item in entries}
        calendar_people = emails(edits['attendees']) if 'attendees' in edits else list(existing)
        roster = list(dict.fromkeys([*calendar_people, *sorted(co | presenters)]))
        result['participants'] = {'attendees': [{**existing.get(email, {'upn': email}),
                'role': 'coorganizer' if email in co else 'presenter' if email in presenters else 'attendee'} for email in roster]}
        result['allowedPresenters'] = 'roleIsPresenter' if co or presenters else 'organizer'
    return {key: value for key, value in result.items() if value != meeting.get(key)}


def move_commands(source, edits, rows, module, zone_name):
    from . import views as v
    changes = edits.get('sessions') or []
    if not isinstance(changes, list) or len(changes) > 52:
        raise ValueError('Choose at most 52 future session edits.')
    by_number = {row['session_number']: row for row in rows}
    seen, commands = set(), []
    zone = ZoneInfo(zone_name)
    closed = v.holiday_date_set([*v.module_cohort_selected_holidays(module),
                                *(v.parse_json_value(module.get('session_holidays'), []) or [])]) if changes else set()
    for item in changes:
        if not isinstance(item, dict):
            raise ValueError('Supply valid session edits.')
        number = item.get('sessionNumber')
        if not isinstance(number, int) or isinstance(number, bool) or number in seen or number not in by_number:
            raise ValueError('Choose each session only once from this calendar.')
        seen.add(number)
        row = by_number[number]
        if not eligible(row) or calendar.utc_datetime(row['scheduled_start']) <= datetime.now(timezone.utc):
            raise ValueError('Historical, cancelled or attended sessions cannot be moved.')
        start = calendar.utc_datetime(item.get('start'))
        duration = item.get('durationMinutes')
        if start is None or start <= datetime.now(timezone.utc) or not isinstance(duration, int) or isinstance(duration, bool) or not 15 <= duration <= 1440:
            raise ValueError('Choose a future start time and a valid duration.')
        exception = schedule_override(start, duration, zone)
        if date.fromisoformat(exception['date']) in closed:
            raise ValueError('The new date falls on a selected holiday. Choose an open date.')
        matches = [event for event in source['events'] if not event.get('isCancelled') and calendar.event_slot(event) ==
                   (calendar.iso(row['scheduled_start']), calendar.iso(row['scheduled_end']))]
        if len(matches) != 1:
            raise calendar.Blocked('occurrence_not_identified', 'The saved session does not identify one original calendar occurrence.')
        event = matches[0]
        # A fresh detail read supplies the occurrence ETag before review.
        end = start + timedelta(minutes=duration)
        if calendar.event_slot(event) == (calendar.iso(start), calendar.iso(end)):
            continue
        commands.append({'type': 'move', 'path': source['path'] + '/instances', 'eventId': event['id'],
                         'sessionNumber': number, 'occurrenceId': row['id'], 'exception': exception,
                         'start': calendar.iso(start), 'end': calendar.iso(end),
                         'patch': {'start': {'dateTime': calendar.iso(start), 'timeZone': 'UTC'},
                                   'end': {'dateTime': calendar.iso(end), 'timeZone': 'UTC'}}})
    proposed = {row['session_number']: (calendar.utc_datetime(row['scheduled_start']), calendar.utc_datetime(row['scheduled_end'])) for row in rows}
    for command in commands:
        proposed[command['sessionNumber']] = (calendar.utc_datetime(command['start']), calendar.utc_datetime(command['end']))
    ordered = [proposed[row['session_number']] for row in sorted(rows, key=lambda row: calendar.utc_datetime(row['scheduled_start']))]
    for previous, following in zip(ordered, ordered[1:]):
        if following[0] < previous[1] or following[0].astimezone(zone).date() <= previous[0].astimezone(zone).date():
            raise ValueError('A move cannot overlap or cross the neighbouring session date.')
    return commands


def review_edit(live_id, payload, actor, access):
    source = signing.loads(payload.get('sourceToken') or '', salt=SALT, max_age=600)
    if source.get('liveId') != live_id or source.get('actor') != actor or source.get('kind') != KIND:
        raise calendar.Blocked('wrong_review_owner', 'This meeting edit belongs to another account or series.')
    calendar.same_access(source, access)
    series, rows, snapshot, module, version = load_edit(live_id)
    calendar.require_access(access, series)
    if pending(snapshot) or version != source['version']:
        raise calendar.Blocked('calendar_changed', 'The calendar changed or has a pending action. Refresh it before editing.')
    edits = payload.get('changes')
    if not isinstance(edits, dict) or set(edits) - {'attendees', 'presenters', 'coOrganizers', 'recording', 'lobby', 'language', 'sessions'}:
        raise ValueError('Supply only supported meeting edits.')
    if not isinstance(payload.get('notify', False), bool):
        raise ValueError('Choose whether to notify invitees.')
    commands = []
    if 'attendees' in edits or set(edits) & {'presenters', 'coOrganizers'}:
        wanted = emails(edits.get('attendees', people(source['master'])))
        # Explicit elevated roles receive calendar access as well.
        for key in ('presenters', 'coOrganizers'):
            if key in edits:
                wanted = list(dict.fromkeys([*wanted, *emails(edits[key])]))
        existing = {text(item['emailAddress']['address']).casefold(): item for item in source['master']['attendees']}
        if set(wanted) != set(existing):
            attendees = [copy.deepcopy(existing.get(email, {'emailAddress': {'address': email}, 'type': 'required'})) for email in wanted]
            commands.append({'type': 'event', 'path': source['path'], 'patch': {'attendees': attendees}})
        # Removing a calendar invitee also removes their explicit online role.
        # Preserve remaining roles instead of clearing/rebuilding the roster.
        if source.get('online') and 'attendees' in edits:
            roles = (source['online'].get('participants') or {}).get('attendees')
            if isinstance(roles, list) and all(text(item.get('upn')) for item in roles):
                for key, role in (('presenters', 'presenter'), ('coOrganizers', 'coorganizer')):
                    if key not in edits and any(item.get('role') == role and text(item['upn']).casefold() not in wanted for item in roles):
                        edits[key] = [item['upn'] for item in roles if item.get('role') == role and text(item['upn']).casefold() in wanted]
    patch = options_patch(source, edits)
    if patch:
        commands.append({'type': 'online', 'path': source['onlinePath'], 'patch': patch})
    zone_name = calendar.ZONES.get(text(series.get('timezone')), text(series.get('timezone')) or 'Europe/London')
    commands.extend(move_commands(source, edits, rows, module, zone_name))
    if not commands:
        return {'status': 'up_to_date', 'message': 'No meeting changes to save.', 'addedSessions': []}
    with calendar.CalendarClient(access) as client:
        master = client.read(source['path'] + '?' + urlencode({'$select': calendar.MASTER_FIELDS}))
        calendar.verify_master(master, source['joinUrl'])
        if event_state(master) != event_state(source['master']):
            raise calendar.Blocked('calendar_changed', 'Microsoft invitations or dates changed. Refresh before saving.')
        events = calendar.instances(client, source['path'], master, date.fromisoformat(source['through']))
        if calendar.digest(calendar.instance_snapshot(events)) != calendar.digest(calendar.instance_snapshot(source['events'])):
            raise calendar.Blocked('occurrences_changed', 'Microsoft session identities or dates changed. Refresh before editing.')
        for command in commands:
            if command['type'] == 'move':
                command['path'] = source['path'].rsplit('/events/', 1)[0] + '/events/' + quote(command['eventId'], safe='')
            before = read_online(client, series, command['path']) if command['type'] == 'online' else client.read(command['path'])
            if command['type'] == 'move':
                original = next(event for event in source['events'] if event['id'] == command['eventId'])
                if (calendar.event_slot(before) != calendar.event_slot(original) or before.get('isCancelled')
                        or before.get('seriesMasterId') != source['master']['id']
                        or (before.get('onlineMeeting') or {}).get('joinUrl') != source['joinUrl']):
                    raise calendar.Blocked('occurrence_changed', 'The original occurrence changed after reading. Refresh before moving it.')
            if command['type'] == 'online' and online_state(before) != online_state(source['online']):
                raise calendar.Blocked('meeting_changed', 'Microsoft meeting settings changed. Refresh before saving.')
            if command['type'] != 'online' and not text(before.get('@odata.etag')):
                raise calendar.Blocked('missing_concurrency_identity', 'Microsoft did not supply the calendar version needed to edit safely.')
            after = {**before, **command['patch']}
            if command['type'] == 'online' and 'participants' in command['patch']:
                after['participants'] = {**before.get('participants', {}), **command['patch']['participants']}
            command.update(before=before, after=after, attempted=False)
    operation = {key: source[key] for key in ('kind', 'liveId', 'actor', 'version', 'accessMode', 'accessActor', 'calendarKind', 'tenantId', 'path', 'joinUrl', 'through')}
    operation.update(id=uuid.uuid4().hex, commands=commands, status='reviewed', notify=payload.get('notify', False),
                     beforeInstances=calendar.instance_snapshot(source['events']))
    operation['through'] = max([source['through'], *[command['end'][:10] for command in commands if command['type'] == 'move']])
    return {'status': 'ready', 'previewToken': signing.dumps(operation, salt=SALT, compress=True),
            'operationId': operation['id'], 'addedSessions': [],
            'changes': [command['type'] for command in commands],
            'message': 'Review the original meeting edits. Existing links and historical records will be preserved.',
            'notificationScope': 'Microsoft calendar updates will be requested. No LMS schedule email is sent.' if operation['notify'] else
                'The LMS sends no email and requests silent Microsoft calendar updates. Microsoft delivery cannot be guaranteed by this preview.'}


def edit_result(operation):
    status = {'done': 'confirmed', 'failed': 'blocked'}.get(operation.get('status'), 'verification_pending')
    return {'status': status, 'operationId': operation.get('id'), 'message': operation.get('message') or
            ('Meeting edits verified and saved. Existing meeting links and historical records were preserved.' if status == 'confirmed' else
             'The result needs verification. Check status; no attempted request will be resent.'), 'addedSessions': []}


def save_operation(live_id, operation):
    _series, _rows, snapshot = load_calendar_state(live_id, lock=True)
    current = snapshot.get(calendar.KEY) or {}
    if current.get('id') != operation['id']:
        raise calendar.Blocked('operation_changed', 'The saved operation changed. Check its current status.')
    snapshot[calendar.KEY] = operation
    store_snapshot(live_id, snapshot)


def persist_people_options(live_id, operation, master):
    """Save only the fields whose Microsoft writes were verified."""
    from . import views as v
    updates = {}
    for command in operation['commands']:
        if command['type'] == 'event':
            updates['attendees'] = v.json_db_value(people(master))
        elif command['type'] == 'online':
            patch = command['patch']
            if 'participants' in patch:
                roles = patch['participants']['attendees']
                updates['presenters'] = v.json_db_value([item['upn'] for item in roles if item['role'] == 'presenter'])
                updates['co_organizers'] = v.json_db_value([item['upn'] for item in roles if item['role'] == 'coorganizer'])
            if 'recordAutomatically' in patch:
                updates['recording'] = 'record-transcribe' if patch['allowTranscription'] else 'record' if patch['recordAutomatically'] else 'none'
            if 'lobbyBypassSettings' in patch:
                scope = patch['lobbyBypassSettings']['scope']
                updates['lobby_bypass'] = 'organization-excluding-guests' if scope == 'organizationExcludingGuests' else scope
            if 'meetingSpokenLanguageTag' in patch:
                updates['spoken_language'] = patch['meetingSpokenLanguageTag']
    if updates:
        v.update_authoring_rows(v.LIVE_SESSIONS_TABLE, 'id = %s', [live_id],
                                {**updates, 'updated_at': datetime.now(timezone.utc)})


def confirm_edit(live_id, payload, actor, access):
    operation = signing.loads(payload.get('previewToken') or '', salt=SALT, max_age=600)
    if operation.get('kind') != KIND or operation.get('liveId') != live_id or operation.get('actor') != actor:
        raise calendar.Blocked('wrong_review_owner', 'This review belongs to another account or series.')
    calendar.same_access(operation, access)
    if payload.get('acknowledge') is not True:
        raise ValueError('Review and confirm the meeting changes first.')
    with transaction.atomic():
        series, _rows, snapshot, _module, version = load_edit(live_id, lock=True)
        calendar.require_access(access, series)
        previous = snapshot.get(calendar.KEY) or {}
        if previous.get('id') == operation['id']:
            return edit_result(previous)
        if pending(snapshot) or version != operation['version']:
            raise calendar.Blocked('calendar_changed', 'The calendar changed or an action is pending. Refresh before editing.')
        operation.update(status='processing', leaseUntil=(datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat())
        snapshot[calendar.KEY] = operation
        store_snapshot(live_id, snapshot)
    return execute_edit(live_id, operation['id'], actor, access, send=True)


def execute_edit(live_id, operation_id, actor, access, *, send=False):
    series, rows, snapshot, module, version = load_edit(live_id)
    operation = snapshot.get(calendar.KEY) or {}
    if operation.get('kind') != KIND or operation.get('id') != operation_id or operation.get('actor') != actor:
        raise calendar.Blocked('wrong_operation_owner', 'No meeting edit belongs to this account and series.')
    calendar.same_access(operation, access)
    calendar.require_access(access, series)
    if operation.get('status') in {'done', 'failed'}:
        return edit_result(operation)
    if not send and calendar.utc_datetime(operation['leaseUntil']) > datetime.now(timezone.utc) and operation['status'] == 'processing':
        return edit_result(operation)
    try:
        if version != operation['version']:
            raise calendar.Blocked('local_calendar_changed', 'Local calendar data changed. Review the pending edit before applying any more changes.')
        with calendar.CalendarClient(access) as client:
            for command in operation['commands']:
                if command.get('done'):
                    continue
                state = online_state if command['type'] == 'online' else event_state
                current = client.read(command['path'])
                if state(current) == state(command['after']):
                    command['done'] = True
                    continue
                if command['attempted'] or not send:
                    raise calendar.Blocked('verification_pending', 'Microsoft has not confirmed every edit. Status checks never resend requests.')
                if state(current) != state(command['before']):
                    raise calendar.Blocked('calendar_changed_before_send', 'Microsoft data changed after review. No further edit was sent.')
                if command['type'] != 'online' and not text(current.get('@odata.etag')):
                    raise calendar.Blocked('missing_concurrency_identity', 'Microsoft no longer supplies the calendar version for this edit.')
                with transaction.atomic():
                    _s, _r, current_snapshot, _m, current_version = load_edit(live_id, lock=True)
                    saved = current_snapshot.get(calendar.KEY) or {}
                    if saved.get('id') != operation_id or current_version != operation['version'] or any(
                            item.get('attempted') for item in saved.get('commands', []) if item['path'] == command['path']):
                        raise calendar.Blocked('concurrent_edit', 'Another writer already attempted or changed this edit.')
                    command['attempted'] = True
                    save_operation(live_id, operation)
                # Earlier commands in this same reviewed save may change ETags.
                # Match the freshly verified version; never overwrite drift.
                headers = {'If-Match': current['@odata.etag']} if command['type'] != 'online' else {}
                if command['type'] != 'online' and not operation['notify']:
                    headers['Prefer'] = 'outlook.send-invitations="none"'
                response = client.client.patch(command['path'], json=command['patch'], headers=headers)
                if response.status_code not in (200, 204):
                    raise calendar.GraphRefusal(response.status_code)
                current = client.read(command['path'])
                if state(current) != state(command['after']):
                    raise calendar.Blocked('verification_pending', 'Microsoft accepted the edit but has not confirmed its saved values.')
                command['done'] = True
            master = client.read(operation['path'] + '?' + urlencode({'$select': calendar.MASTER_FIELDS}))
            calendar.verify_master(master, operation['joinUrl'])
            events = calendar.instances(client, operation['path'], master, date.fromisoformat(operation['through']))
            expected = copy.deepcopy(operation['beforeInstances'])
            moved_ids = {command['eventId'] for command in operation['commands'] if command['type'] == 'move'}
            for command in operation['commands']:
                if command['type'] == 'move':
                    for item in expected:
                        if item['id'] == command['eventId']:
                            item.update(start=command['start'], end=command['end'])
            actual = calendar.instance_snapshot(events)
            # Graph adds originalStart when a normal occurrence becomes an exception.
            for item in [*expected, *actual]:
                if item['id'] in moved_ids:
                    item.pop('originalStart', None)
            if calendar.digest(sorted(expected, key=lambda item: item['id'])) != calendar.digest(sorted(actual, key=lambda item: item['id'])):
                raise calendar.Blocked('occurrences_changed', 'The calendar occurrence identities or other dates changed. Historical data was preserved; verification is pending.')
        with transaction.atomic():
            current_series, current_rows, current_snapshot, current_module, current_version = load_edit(live_id, lock=True)
            if current_version != operation['version']:
                raise calendar.Blocked('local_calendar_changed', 'The LMS changed during verification; no historical records were overwritten.')
            for command in operation['commands']:
                if command['type'] == 'move':
                    persist_move(current_series, current_rows, current_module, command, current_snapshot)
                    current_module = load_module(current_series, lock=True)
            persist_people_options(live_id, operation, master)
            operation.update(status='done')
            current_snapshot[calendar.KEY] = operation
            store_snapshot(live_id, current_snapshot)
            from .views import invalidate_curriculum_cache
            invalidate_curriculum_cache()
        return edit_result(operation)
    except calendar.GraphRefusal as exc:
        refused = 400 <= exc.status_code < 500 and exc.status_code not in (408, 429)
        operation.update(status='failed' if refused else 'uncertain',
                         message='Microsoft refused a meeting edit. Earlier edits in this review may already be applied; refresh the original meeting before reviewing again.' if refused else
                                 'Microsoft has not confirmed the meeting edit. Check status; no attempted request will be resent.')
        with transaction.atomic():
            save_operation(live_id, operation)
        return edit_result(operation)
    except (calendar.Blocked, calendar.httpx.HTTPError, RuntimeError, ValueError,
            KeyError, TypeError, calendar.DatabaseError):
        attempted = any(command.get('attempted') for command in operation['commands'])
        operation.update(status='uncertain' if attempted else 'failed',
                         message='Some meeting edits could not be confirmed. Check status before another save; no request will be resent.' if attempted else
                                 'The calendar changed or Microsoft refused the edit before sending. Refresh the original meeting and review again.')
        with transaction.atomic():
            save_operation(live_id, operation)
        return edit_result(operation)
