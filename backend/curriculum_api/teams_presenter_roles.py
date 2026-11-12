"""Tutor presenters keep their LMS label and manage rooms as co-organizers.

This policy only supplies roles. It never updates calendars or sends invitations.
Date-only and attendee-only edits keep existing roles until explicitly repaired.
"""

MAX_CO_ORGANIZERS = 10


def _emails(values):
    return list(dict.fromkeys(str(value).strip().casefold() for value in values or () if str(value).strip()))


def roles_changed(presenters, co_organizers, previous_presenters, previous_co_organizers):
    return (set(_emails(presenters)) != set(_emails(previous_presenters))
            or set(_emails(co_organizers)) != set(_emails(previous_co_organizers)))


def presenter_co_organizers(presenters, co_organizers, organizer=''):
    """Retain explicit co-organizers and add presenters without duplicating the owner."""
    owner = str(organizer or '').strip().casefold()
    result = [email for email in _emails([*co_organizers, *presenters]) if email != owner]
    if len(result) > MAX_CO_ORGANIZERS:
        raise ValueError(
            'Teams supports up to 10 co-organizers. Presenters also manage breakout rooms as '
            'co-organizers; reduce the combined list before saving these roles. Nobody was removed.'
        )
    return result
