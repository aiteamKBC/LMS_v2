"""UTC timestamp serialization for existing meeting response fields."""

from datetime import datetime, timezone
from ...catalogue.domain.values import clean_str


LIVE_SESSION_INSTANT_FIELDS = (
    'scheduled_start', 'scheduled_end', 'actual_start', 'actual_end',
    'artifacts_synced_at', 'created_at', 'updated_at', 'start_datetime',
)


def utc_iso_value(value):
    """A stored live-session timestamp as an instant that names its offset.

    The occurrence tables are `timestamp without time zone` holding UTC, so a
    plain `isoformat()` hands the browser `2026-12-12T09:00:00` -- which
    JavaScript reads as the *reader's own* local time. A viewer in Cairo then
    sees every meeting two hours early and every date reads as out of sync,
    while the identical data looks right in London. Stamping the offset leaves
    nothing to guess: the reader's calendar renders the instant in whatever zone
    that reader is in, exactly as Teams itself does.
    """
    if isinstance(value, datetime):
        stamped = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return stamped.astimezone(timezone.utc).isoformat()
    return clean_str(value)


def stamp_live_session_instants(row):
    """Return `row` with its UTC timestamp columns carrying an explicit offset."""
    if not isinstance(row, dict):
        return row
    for field in LIVE_SESSION_INSTANT_FIELDS:
        if isinstance(row.get(field), datetime):
            row[field] = utc_iso_value(row[field])
    return row
