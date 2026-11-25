"""Calendar recurrence arithmetic, bounded occurrence numbering and stable clash identities."""
from __future__ import annotations

from datetime import date
import re
from datetime import timedelta


DEFAULT_PREVIEW_MONTHS = 12


MAX_PREVIEW_MONTHS = 24


RECURRENCE_UNIT_NOUNS = {'days': 'day', 'weeks': 'week', 'months': 'month'}


def add_calendar_months(base, months):
    """Calendar-month arithmetic, day clamped to the target month's length.

    The exact rule already used for cohort end dates (views.calculate_cohort_end_date):
    31 Jan + 1 month lands on 28/29 Feb, never rolls into March. "every 12
    weeks" and "every 3 months" are intentionally NOT the same thing -- weeks
    stays pure +84 days, months always goes through this function.

    Every occurrence clamps against the ANCHOR's own day-of-month, not a
    drifting previous occurrence -- generate_occurrences always calls this as
    ``add_calendar_months(anchor, interval * step)``, so a 31 Jan anchor
    produces Jan 31, Feb 28, Mar 31, Apr 30: March is not stuck at 28 just
    because February clamped.
    """
    month_index = base.month - 1 + months
    year = base.year + month_index // 12
    month = month_index % 12 + 1
    day = min(base.day, _month_length(year, month))
    return date(year, month, day)


def _month_length(year, month):
    if month == 12:
        return (date(year + 1, 1, 1) - date(year, 12, 1)).days
    return (date(year, month + 1, 1) - date(year, month, 1)).days


def _month_bounds(month_key):
    """('2027-03') -> (date(2027,3,1), date(2027,3,31))."""
    year, month = int(month_key[:4]), int(month_key[5:7])
    start = date(year, month, 1)
    end = add_calendar_months(start, 1) - timedelta(days=1)
    return start, end


def recurrence_label(interval, unit):
    noun = RECURRENCE_UNIT_NOUNS.get(unit, unit)
    return f'Every {interval} {noun}{"" if interval == 1 else "s"}'


def generate_occurrence_steps(anchor, interval, unit, window_start, window_end, *, max_count=500, occurrence_limit=None):
    """(occurrence_number, date) pairs for one recurrence rule, bounded to a window.

    ``occurrence_number`` is 1-based, counted from ``anchor`` itself as
    occurrence #1 -- the same numbering ``occurrence_limit`` counts against.
    ``generate_occurrences`` is a thin wrapper around this that keeps its
    original dates-only return shape; anything that also needs the occurrence
    number (e.g. a learner-specific Review instance's identity) calls this
    directly rather than re-deriving it, so there is exactly one place the
    recurrence math lives.

    Never an infinite sequence: capped both by the window and by max_count.
    Jumps close to window_start first rather than iterating from the anchor
    one step at a time, so an old anchor date does not cost one loop
    iteration per elapsed interval.
    """
    if not anchor or interval <= 0 or window_start > window_end:
        return []

    if unit in ('days', 'weeks'):
        step_days = interval * (7 if unit == 'weeks' else 1)
        delta = (window_start - anchor).days
        start_step = max(0, delta // step_days - 1)
        steps = []
        step = start_step
        while len(steps) < max_count:
            if occurrence_limit is not None and step >= occurrence_limit:
                break
            occ = anchor + timedelta(days=step_days * step)
            if occ > window_end:
                break
            if occ >= window_start:
                steps.append((step + 1, occ))
            step += 1
        return steps

    # months: calendar arithmetic, not "interval * 30 days".
    months_between = (window_start.year - anchor.year) * 12 + (window_start.month - anchor.month)
    start_step = max(0, months_between // interval - 1)
    steps = []
    step = start_step
    while len(steps) < max_count:
        if occurrence_limit is not None and step >= occurrence_limit:
            break
        occ = add_calendar_months(anchor, interval * step)
        if occ > window_end:
            break
        if occ >= window_start:
            steps.append((step + 1, occ))
        step += 1
    return steps


def generate_occurrences(anchor, interval, unit, window_start, window_end, *, max_count=500, occurrence_limit=None):
    """RAW occurrence dates for one recurrence rule, bounded to a window.

    ``occurrence_limit``, when given, is the total number of occurrences the
    template ever produces (counted from ``anchor`` as occurrence #1) -- the
    Nth-and-later occurrence is never projected, even if the window would
    otherwise include it. See ``generate_occurrence_steps`` for the
    occurrence-numbered variant.
    """
    return [
        occ for _, occ in generate_occurrence_steps(
            anchor, interval, unit, window_start, window_end,
            max_count=max_count, occurrence_limit=occurrence_limit,
        )
    ]


def clash_signature(pairs):
    """Deterministic identity for one month's raw clash set.

    ``pairs`` is an iterable of (review_id, occurrence_date_iso). Sorted so
    the signature does not depend on projection order, then joined -- if the
    underlying set of raw occurrences ever changes (a template's anchor or
    recurrence edited, a Review added/removed), the signature changes with
    it, and any "keep all" acknowledgement keyed to the old signature stops
    applying on its own.
    """
    return '|'.join(f'{review_id}:{occurrence_date}' for review_id, occurrence_date in sorted(pairs))


_MONTH_RE = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')


_ACTIONS = ('skip', 'keep')
