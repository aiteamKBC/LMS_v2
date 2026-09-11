from datetime import date, timedelta

from django.test import SimpleTestCase

from .period import (
    ReviewPeriod,
    build_review_period,
    iter_review_periods,
    resolve_review_period,
)

TWELVE_WEEKS = timedelta(weeks=12)


class BuildReviewPeriodTests(SimpleTestCase):
    def test_default_window_is_previous_twelve_weeks(self):
        review_date = date(2026, 6, 15)
        period = build_review_period(review_date, review_number=3)

        self.assertEqual(period.review_number, 3)
        self.assertEqual(period.review_date, review_date)
        self.assertEqual(period.review_period_end, review_date)
        self.assertEqual(period.review_period_start, review_date - TWELVE_WEEKS + timedelta(days=1))
        self.assertEqual((period.review_period_end - period.review_period_start).days, 83)

    def test_action_period_is_the_following_twelve_weeks(self):
        review_date = date(2026, 6, 15)
        period = build_review_period(review_date)

        self.assertEqual(period.action_period_start, review_date + timedelta(days=1))
        self.assertEqual(period.action_period_end, review_date + TWELVE_WEEKS)

    def test_explicit_window_overrides_the_default(self):
        review_date = date(2026, 6, 15)
        window_start = date(2026, 1, 1)
        window_end = date(2026, 5, 1)
        period = build_review_period(review_date, window_start=window_start, window_end=window_end)

        self.assertEqual(period.review_period_start, window_start)
        self.assertEqual(period.review_period_end, window_end)
        # Action period is still anchored on the supplied window's end.
        self.assertEqual(period.action_period_start, window_end + timedelta(days=1))

    def test_to_dict_serialises_dates_as_iso_strings(self):
        period = build_review_period(date(2026, 6, 15), review_number=1)
        data = period.to_dict()

        self.assertEqual(data["review_date"], "2026-06-15")
        self.assertIsInstance(data["review_period_start"], str)


class ResolveReviewPeriodTests(SimpleTestCase):
    def setUp(self):
        self.programme_start = date(2025, 1, 1)
        self.programme_end = date(2026, 12, 31)

    def test_explicit_review_date_wins_outright(self):
        chosen = date(2025, 4, 1)
        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=date(2099, 1, 1),
            review_date=chosen,
        )
        self.assertEqual(period.review_date, chosen)
        self.assertIsNone(period.review_number)

    def test_explicit_window_wins_even_without_a_review_date(self):
        window_start = date(2025, 2, 1)
        window_end = date(2025, 4, 1)
        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=date(2025, 5, 1),
            window_start=window_start,
            window_end=window_end,
        )
        self.assertEqual(period.review_period_start, window_start)
        self.assertEqual(period.review_period_end, window_end)
        self.assertEqual(period.review_date, window_end)

    def test_last_completed_review_advances_to_the_next_generated_date(self):
        first_review = self.programme_start + TWELVE_WEEKS
        second_review = first_review + TWELVE_WEEKS

        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=second_review + timedelta(days=1),
            last_completed_review_date=first_review,
        )
        self.assertEqual(period.review_date, second_review)
        self.assertEqual(period.review_number, 2)

    def test_last_completed_review_slightly_off_schedule_still_advances_correctly(self):
        """A review logged a few days late must not shift every later review."""
        first_review = self.programme_start + TWELVE_WEEKS
        second_review = first_review + TWELVE_WEEKS
        logged_late = first_review + timedelta(days=4)

        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=second_review + timedelta(days=10),
            last_completed_review_date=logged_late,
        )
        self.assertEqual(period.review_date, second_review)
        self.assertEqual(period.review_number, 2)

    def test_no_review_completed_yet_picks_the_latest_due_date(self):
        first_review = self.programme_start + TWELVE_WEEKS
        second_review = first_review + TWELVE_WEEKS

        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=second_review + timedelta(days=5),
        )
        self.assertEqual(period.review_date, second_review)
        self.assertEqual(period.review_number, 2)

    def test_brand_new_learner_falls_back_to_the_first_upcoming_review(self):
        """Before any review date has been reached, still return a preview period."""
        period = resolve_review_period(
            programme_start=self.programme_start,
            programme_end=self.programme_end,
            today=self.programme_start + timedelta(days=10),
        )
        self.assertEqual(period.review_date, self.programme_start + TWELVE_WEEKS)
        self.assertEqual(period.review_number, 1)


class IterReviewPeriodsTests(SimpleTestCase):
    def test_yields_every_generated_review_in_order(self):
        programme_start = date(2025, 1, 1)
        programme_end = programme_start + TWELVE_WEEKS * 3

        periods = list(iter_review_periods(programme_start, programme_end))

        self.assertEqual([p.review_number for p in periods], [1, 2, 3])
        self.assertEqual(periods[0].review_date, programme_start + TWELVE_WEEKS)
        self.assertEqual(periods[-1].review_date, programme_start + TWELVE_WEEKS * 3)
        # Each period's window is contiguous with the review before it.
        self.assertEqual(periods[1].review_period_start, periods[0].review_period_end + timedelta(days=1))

    def test_no_programme_end_still_lists_the_next_upcoming_review(self):
        programme_start = date(2025, 1, 1)
        periods = list(iter_review_periods(programme_start, None, today=date(2025, 2, 1)))
        self.assertEqual(len(periods), 1)
        self.assertEqual(periods[0].review_date, programme_start + TWELVE_WEEKS)
