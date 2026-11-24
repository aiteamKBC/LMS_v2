"""Deterministic meeting decisions over Python values and explicit pure helpers."""

import re
from ...catalogue.domain.values import clean_str, parse_json_value


def teams_attendee_emails(value):
    if isinstance(value, list):
        candidates = value
    else:
        candidates = re.split(r'[\s,;]+', clean_str(value))
    emails = []
    seen = set()
    for item in candidates:
        email = clean_str(item).lower()
        if not email or email in seen:
            continue
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
            raise ValueError(f'Invalid attendee email: {email}')
        seen.add(email)
        emails.append(email)
    return emails


def teams_series_email_list(*values):
    """The email addresses in a stored invitation list.

    Anything that is not an address is dropped rather than carried through. A
    caller that hands this a JSON *string* it has already exploded into
    characters (``list('["a@b"]')``) would otherwise turn one meeting's roster
    into one "person" per distinct character -- rows that reach Graph as
    invitees and the attendance panel as "28 expected".
    """
    emails = []
    for value in values:
        if isinstance(value, str):
            candidates = parse_json_value(value, [])
            if not isinstance(candidates, list):
                candidates = re.split(r'[\s,;]+', value)
        elif isinstance(value, (list, tuple, set)):
            candidates = value
        else:
            candidates = []
        for candidate in candidates:
            email = clean_str(candidate).lower()
            if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
                continue
            if email not in emails:
                emails.append(email)
    return emails


def teams_newly_invited(stored, invited):
    """Who a save adds to a meeting that already exists.

    Compared case-insensitively against the roster the calendar holds now, so
    moving someone between attendee, presenter and co-organizer does not make
    them new. Order and spelling come from the incoming list.
    """
    was = {clean_str(email).lower() for email in (stored or []) if clean_str(email)}
    added, seen = [], set()
    for email in invited or []:
        key = clean_str(email).lower()
        if not key or key in was or key in seen:
            continue
        seen.add(key)
        added.append(clean_str(email))
    return added


def forward_teams_invitation(request, owner_key, event_ids, recipients, comment=''):
    """Microsoft forwarding is disabled; optional email is sent by the LMS.

    This prevents explicit /forward calls. It does not certify suppression of
    the messages Exchange may generate from an event PATCH.
    """
    if not recipients:
        return []
    return [{'code': 'teams_calendar_mail_disabled',
             'message': 'No Microsoft invitation was requested. Use the LMS email option if you want to email the people added.'}]


def teams_warning_sentence(warnings):
    """Graph's own reasons for a refusal, as one sentence an author can act on.

    Every warning raised on the Teams paths carries a ``message`` saying what
    was not applied and a ``detail`` holding Microsoft's raw error. Both are
    wanted: the message is what the person reads, the detail is the code
    support asks for. Duplicates are collapsed -- one policy refusal arrives
    once per occurrence on a shifted series, and ten copies of a sentence reads
    as ten separate faults.
    """
    seen, parts = set(), []
    for warning in warnings or ():
        if not isinstance(warning, dict):
            text = clean_str(warning)
        else:
            message = clean_str(warning.get('message'))
            detail = clean_str(warning.get('detail'))
            text = f'{message} ({detail})' if message and detail else message or detail
        if text and text not in seen:
            seen.add(text)
            parts.append(text)
    return ' '.join(parts)
