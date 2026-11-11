"""Fail-closed plans for adding room permissions to an existing Teams meeting.

The only writable Microsoft resource is onlineMeeting.participants.attendees.
Calendar invitations and mail are never written. Full live rosters are retained;
neither learners nor existing co-organizers are removed or promoted implicitly.
"""
import copy
import hashlib
import json
import re

from .teams_presenter_roles import presenter_co_organizers


class UnsafeRoomPromotion(ValueError):
    """A safe, non-personal reason to leave this meeting unchanged."""


def _text(value):
    return str(value or '').strip().casefold()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def participant_key(item):
    return _text(((item.get('identity') or {}).get('user') or {}).get('id')) or _text(item.get('upn'))


def roster_fingerprint(attendees):
    return fingerprint(sorted((participant_key(item), _text(item.get('upn')), _text(item.get('role')))
                              for item in attendees))


def protected_meeting(meeting):
    # Exclude only the roster we are deliberately changing and transient metadata.
    return {key: value for key, value in meeting.items()
            if key not in {'participants', '@odata.context', '@odata.etag', 'lastModifiedDateTime'}} | {
                'organizer': (meeting.get('participants') or {}).get('organizer'),
            }


def prepare_room_promotion(target, meeting, event, accounts, co_organizers):
    """Plan one meeting, given staff accounts already resolved in the owning tenant."""
    link = target.get('joinUrl')
    if not link or meeting.get('joinWebUrl') != link or (event.get('onlineMeeting') or {}).get('joinUrl') != link:
        raise UnsafeRoomPromotion('meeting_identity_unconfirmed')
    if event.get('isCancelled') is not False:
        raise UnsafeRoomPromotion('calendar_not_active')
    if event.get('hideAttendees') is not True:
        raise UnsafeRoomPromotion('calendar_privacy_unconfirmed')
    if meeting.get('allowBreakoutRooms') is not True:
        raise UnsafeRoomPromotion('breakout_rooms_not_enabled')
    organizer = (meeting.get('participants') or {}).get('organizer') or {}
    owner_id = participant_key(organizer)
    if not target.get('ownerId') or owner_id != _text(target['ownerId']):
        raise UnsafeRoomPromotion('organizer_unconfirmed')
    attendees = (meeting.get('participants') or {}).get('attendees')
    if not isinstance(attendees, list) or any(not isinstance(item, dict) or not participant_key(item)
                                             for item in attendees):
        raise UnsafeRoomPromotion('incomplete_live_roster')
    if len({participant_key(item) for item in attendees}) != len(attendees):
        raise UnsafeRoomPromotion('ambiguous_live_roster')
    if any(_text(item.get('role')) not in {'presenter', 'attendee', 'coorganizer'} for item in attendees):
        raise UnsafeRoomPromotion('unsupported_live_role')
    invited = {_text((item.get('emailAddress') or {}).get('address')) for item in event.get('attendees') or []}
    updated = copy.deepcopy(attendees)
    changes = []
    for account in accounts:
        if account.get('userType') != 'Member' or account.get('accountEnabled') is not True or not account.get('staffVerified'):
            raise UnsafeRoomPromotion('presenter_account_unconfirmed')
        account_id = _text(account.get('id'))
        if account_id == owner_id:
            continue
        aliases = {_text(account.get(key)) for key in ('email', 'mail', 'userPrincipalName')} - {''}
        if not account_id or not aliases.intersection(invited):
            raise UnsafeRoomPromotion('presenter_not_already_invited')
        matches = [i for i, item in enumerate(updated)
                   if participant_key(item) == account_id or _text(item.get('upn')) in aliases]
        if len(matches) != 1:
            raise UnsafeRoomPromotion('presenter_not_in_live_roster')
        index = matches[0]
        held_id = _text(((updated[index].get('identity') or {}).get('user') or {}).get('id'))
        if held_id and held_id != account_id:
            raise UnsafeRoomPromotion('presenter_identity_mismatch')
        if _text(updated[index]['role']) != 'coorganizer':
            changes.append({'id': account_id, 'email': account['email'], 'previousRole': updated[index]['role']})
            updated[index]['role'] = 'coorganizer'
    # A live role-only PATCH changed Microsoft's read-only meetingType from
    # recurring to scheduled while its calendar recurrence stayed intact.
    # Leave such conferences untouched until that behavior is understood;
    # never discover it by mutating every series in a bulk repair.
    if changes and meeting.get('meetingType') != 'scheduled':
        raise UnsafeRoomPromotion('meeting_type_role_update_requires_review')
    if sum(_text(item.get('role')) == 'coorganizer' for item in updated) > 10:
        raise UnsafeRoomPromotion('coorganizer_limit')
    try:
        co = presenter_co_organizers([account['email'] for account in accounts], co_organizers,
                                    target.get('organizerEmail'))
    except ValueError:
        raise UnsafeRoomPromotion('coorganizer_limit') from None
    return {
        'payload': {'participants': {'attendees': updated}} if changes else None,
        'changes': changes, 'coOrganizers': co,
        'beforeRoster': roster_fingerprint(attendees), 'afterRoster': roster_fingerprint(updated),
        'protectedMeeting': fingerprint(protected_meeting(meeting)), 'calendar': fingerprint(event),
    }


def confirm_room_promotion(plan, meeting, event):
    if (fingerprint(protected_meeting(meeting)) != plan['protectedMeeting']
            or fingerprint(event) != plan['calendar']
            or roster_fingerprint((meeting.get('participants') or {}).get('attendees') or []) != plan['afterRoster']):
        raise UnsafeRoomPromotion('microsoft_readback_unconfirmed')


def apply_room_promotion(plan, path, graph_request, read_event):
    """Only this onlineMeeting roster can be patched; never an event or mail endpoint."""
    if not re.fullmatch(r'users/[^/?#]+/onlineMeetings/[^/?#]+', path):
        raise UnsafeRoomPromotion('invalid_meeting_path')
    current = graph_request('GET', path)
    calendar = read_event()
    if (fingerprint(protected_meeting(current)) != plan['protectedMeeting']
            or fingerprint(calendar) != plan['calendar']
            or roster_fingerprint((current.get('participants') or {}).get('attendees') or []) != plan['beforeRoster']):
        raise UnsafeRoomPromotion('concurrent_meeting_change')
    if plan['payload']:
        # Supply only the writable meetingParticipantInfo fields from the full live roster.
        attendees = [{key: copy.deepcopy(item[key]) for key in ('identity', 'upn', 'role') if key in item}
                     for item in plan['payload']['participants']['attendees']]
        graph_request('PATCH', path, payload={'participants': {'attendees': attendees}})
    confirm_room_promotion(plan, graph_request('GET', path), read_event())
