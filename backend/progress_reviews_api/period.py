"""12-week Progress Review period calculation.

Progress Review PPTX generation reuses the review cadence already implemented
for the coach calendar
(coach_api.views.TIMETABLE_PROGRESS_REVIEW_INTERVAL / iterate_generated_schedule_dates)
rather than inventing a second notion of "when the reviews fall" for the same
learner — the generated calendar and the PPTX pack must always agree on review
numbering and dates. Imported lazily inside functions (not at module import
time) because coach_api.views is a very large module and learner_api.calendar
already imports from it the same way for the same reason.

Vocabulary used throughout this app:
  review date            the date the review meeting itself falls/fell on.
  review window           the 12 weeks being reviewed: by default the 12 weeks
                          immediately before, and including, the review date.
  action period           the following 12 weeks, up to and including the
                          next review date — what the review's actions apply to.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, timedelta
from typing import Iterator, Optional


def _interval() -> timedelta:
    from coach_api.views import TIMETABLE_PROGRESS_REVIEW_INTERVAL
    return TIMETABLE_PROGRESS_REVIEW_INTERVAL


@dataclass(frozen=True)
class ReviewPeriod:
    review_number: Optional[int]
    review_date: date
    review_period_start: date
    review_period_end: date
    action_period_start: date
    action_period_end: date

    def to_dict(self) -> dict:
        return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in asdict(self).items()}


def generated_review_dates(
    start_date: date,
    end_date: date,
    *,
    range_start: Optional[date] = None,
    range_end: Optional[date] = None,
) -> Iterator[tuple]:
    """Yield (review_number, review_date) for every review this programme
    generates, in the same order and values the coach calendar generates them.

    `start_date`/`end_date` are the learner's programme start/planned-end
    dates; the first review always falls 12 weeks after `start_date`.
    """
    from coach_api.views import iterate_generated_schedule_dates
    yield from iterate_generated_schedule_dates(
        start_date, end_date, _interval(), range_start=range_start, range_end=range_end,
    )


def build_review_period(
    review_date: date,
    *,
    review_number: Optional[int] = None,
    window_start: Optional[date] = None,
    window_end: Optional[date] = None,
) -> ReviewPeriod:
    """The window/action-period dates for one review date.

    `window_start`/`window_end` let a caller supply an explicit review window
    instead of the default "previous 12 weeks" (the spec's "Review window
    equals the previous 12 weeks unless a specific review window is supplied").
    """
    interval = _interval()
    period_end = window_end or review_date
    period_start = window_start or (period_end - interval + timedelta(days=1))
    action_start = period_end + timedelta(days=1)
    action_end = period_end + interval
    return ReviewPeriod(
        review_number=review_number,
        review_date=review_date,
        review_period_start=period_start,
        review_period_end=period_end,
        action_period_start=action_start,
        action_period_end=action_end,
    )


def iter_review_periods(
    programme_start: date,
    programme_end: Optional[date],
    *,
    today: Optional[date] = None,
) -> Iterator[ReviewPeriod]:
    """Every review period this programme generates, past and future.

    Powers `GET /api/progress-reviews/{learner_id}/periods`. `programme_end`
    falling back to `today` (or one full interval past start, whichever is
    later) means a learner with no planned end date still gets at least their
    next upcoming review listed.
    """
    horizon = programme_end or max(today or programme_start, programme_start + _interval())
    for number, review_date in generated_review_dates(programme_start, horizon):
        yield build_review_period(review_date, review_number=number)


def resolve_review_period(
    *,
    programme_start: date,
    programme_end: Optional[date],
    today: date,
    review_date: Optional[date] = None,
    last_completed_review_date: Optional[date] = None,
    window_start: Optional[date] = None,
    window_end: Optional[date] = None,
) -> ReviewPeriod:
    """Pick the review period automatically when the caller does not name one.

    Priority, matching the spec ("Use learner programme start date, last
    completed review date, or selected review date"):

      1. An explicit `review_date` (or an explicit `window_start`/`window_end`)
         always wins outright.
      2. Otherwise, if the learner has a `last_completed_review_date`, the
         period is the next generated review date after it — not simply
         "+12 weeks", so a review that landed a few days off the generated
         schedule doesn't drift the whole sequence.
      3. Otherwise, the latest generated review date that has already been
         reached (<= today) — "the review this active learner is currently
         due for". If none has been reached yet (a learner still in their
         first 12 weeks), falls back to the first generated date so there is
         always a period to preview, even if it is still in the future.
    """
    if review_date is not None or window_start is not None or window_end is not None:
        target = review_date or (window_end or today)
        return build_review_period(target, window_start=window_start, window_end=window_end)

    horizon = programme_end or max(today, programme_start + _interval())

    if last_completed_review_date is not None:
        for number, target_date in generated_review_dates(programme_start, horizon):
            if target_date > last_completed_review_date:
                return build_review_period(target_date, review_number=number)
        # Every generated date is already accounted for; nothing new is due
        # yet. Preview the next one anyway, computed on the same cadence.
        next_number, next_date = None, last_completed_review_date + _interval()
        return build_review_period(next_date, review_number=next_number)

    chosen = None
    first = None
    for number, target_date in generated_review_dates(programme_start, horizon):
        if first is None:
            first = (number, target_date)
        if target_date <= today:
            chosen = (number, target_date)
        else:
            break
    number, target_date = chosen or first or (1, programme_start + _interval())
    return build_review_period(target_date, review_number=number)
