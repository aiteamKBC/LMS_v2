"""Read-only classification for a separately authorized legacy inventory.

The caller must supply an exhaustive source-qualified booking enumeration and
independently verified Graph identities. Local URLs/events alone never certify
global exclusivity. This module performs no provider or database I/O.
"""
from collections import defaultdict


def classify_bookings(rows, *, provider_identities=None, exhaustive=False):
    """Return privacy-safe counts and opaque local conflict groups.

    Rows are dictionaries with source_review_id, calendar_event_id,
    graph_event_id and meeting_link. Provider identities map calendar IDs to
    (tenant UUID, organizer UUID, onlineMeeting ID) supplied by a verified
    resolver. Duplicates are reported even if local link representations differ.
    """
    identities = provider_identities or {}
    bookings = list(rows)
    groups = {key: defaultdict(set) for key in ('source', 'calendar', 'event', 'link', 'provider')}
    unresolved = set()
    malformed = set()
    for ordinal, row in enumerate(bookings):
        if not isinstance(row, dict):
            malformed.add(ordinal)
            continue
        source = row.get('source_review_id')
        calendar = row.get('calendar_event_id')
        if not isinstance(source, int) or source <= 0 or not isinstance(calendar, int) or calendar <= 0:
            malformed.add(ordinal)
            continue
        groups['source'][source].add(calendar)
        groups['calendar'][calendar].add(source)
        for kind, field in (('event', 'graph_event_id'), ('link', 'meeting_link')):
            value = row.get(field)
            if isinstance(value, str) and value.strip():
                groups[kind][value].add(source)
        provider = identities.get(calendar)
        if (not isinstance(provider, tuple) or len(provider) != 3
                or any(not isinstance(part, str) or not part.strip() for part in provider)):
            unresolved.add(calendar)
        else:
            groups['provider'][provider].add(source)
    conflicts = {kind: tuple(sorted((tuple(sorted(owners)) for owners in values.values()
                                      if len(owners) > 1)))
                 for kind, values in groups.items()}
    return {
        'booking_count': len(bookings),
        'resolved_count': len(bookings) - len(unresolved) - len(malformed),
        'unresolved_count': len(unresolved),
        'malformed_count': len(malformed),
        'conflict_counts': {kind: len(groups) for kind, groups in conflicts.items()},
        'conflicts': conflicts,
        'complete': bool(exhaustive and not unresolved and not malformed
                         and not any(conflicts.values())),
    }
