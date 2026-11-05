"""Pure policy tests for complete Review booking intervals in England time."""
from datetime import date, time
from unittest import TestCase

from coach_api.booking_hours import validate_review_duration, validate_review_interval, validate_review_time_precision


class ReviewBookingHoursTests(TestCase):
    def test_allowed_duration_fits_exactly_to_1700_in_gmt_and_bst(self):
        for day in (date(2026, 1, 15), date(2026, 7, 15)):
            for minutes in (15, 30, 45, 60, 90, 120, 480):
                with self.subTest(day=day, minutes=minutes):
                    start_minutes = 17 * 60 - minutes
                    start = time(start_minutes // 60, start_minutes % 60)
                    _, end = validate_review_interval(day, start, minutes)
                    self.assertEqual(end.date(), day)
                    self.assertEqual(end.strftime("%H:%M"), "17:00")

    def test_rejects_before_start_after_close_and_cross_day(self):
        day = date(2026, 3, 12)
        for start, duration in ((time(8, 59), 15), (time(9, 0, 1), 15), (time(9, 0, 0, 1), 15),
                                (time(17, 0), 15), (time(16, 31), 30), (time(23, 30), 60)):
            with self.subTest(start=start, duration=duration), self.assertRaises(ValueError):
                validate_review_interval(day, start, duration)

    def test_selected_date_controls_gmt_bst_conversion_across_dst_change(self):
        winter = validate_review_interval(date(2026, 3, 28), time(9), 60)[0]
        summer = validate_review_interval(date(2026, 3, 30), time(9), 60)[0]
        self.assertEqual(winter.utcoffset().total_seconds(), 0)
        self.assertEqual(summer.utcoffset().total_seconds(), 3600)

    def test_spring_and_autumn_transition_dates_keep_london_wall_time(self):
        spring = validate_review_interval(date(2026, 3, 29), time(9), 60)
        autumn = validate_review_interval(date(2026, 10, 25), time(9), 60)
        self.assertEqual(spring[0].strftime("%H:%M %z"), "09:00 +0100")
        self.assertEqual(autumn[0].strftime("%H:%M %z"), "09:00 +0000")

    def test_duration_rejects_missing_malformed_and_out_of_range_values(self):
        for value in (None, "", "1.5", True, 0, -15, 481):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_review_duration(value)
        self.assertEqual(validate_review_duration("60"), 60)

    def test_review_time_rejects_seconds_and_client_offsets_before_time_parsing(self):
        for value in ("09:00:01", "09:00:00.001", "09:00+01:00"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_review_time_precision(value)
        validate_review_time_precision("09:00")
        validate_review_time_precision("09:00:00")
