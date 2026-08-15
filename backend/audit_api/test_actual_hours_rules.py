"""Boundary tests for the Actual Hours rules.

Pure functions only — no database, no clock, no timezone dependence on the
machine running them. Every contract boundary gets an exact-value test and a
just-outside-value test.
"""

import datetime
from decimal import Decimal

from django.test import SimpleTestCase

from .actual_hours import journal_hours, rules
from .actual_hours.service import ServiceError, base_fingerprint


MONDAY = datetime.date(2026, 6, 15)      # BST
SATURDAY = datetime.date(2026, 6, 20)
SUNDAY = datetime.date(2026, 6, 21)
WINTER_MONDAY = datetime.date(2026, 1, 12)   # GMT


def _time(text):
    return datetime.time.fromisoformat(text)


class ConversionTests(SimpleTestCase):
    def test_round_trip_at_every_rule_boundary(self):
        for seconds in (60, 768, 840, 1740, 1999, 2640, 3480, 766, 900,
                        1740 - 766, 1740 + 766, 1740 - 900, 1740 + 900):
            hours = rules.seconds_to_hours(seconds)
            self.assertEqual(rules.hours_to_seconds(hours), seconds, f"{seconds}s did not round-trip")

    def test_conversion_is_decimal_not_float(self):
        self.assertIsInstance(rules.seconds_to_hours(1740), Decimal)

    def test_media_minutes_to_seconds(self):
        self.assertEqual(rules.minutes_to_seconds(Decimal("12.5")), 750)
        self.assertIsNone(rules.minutes_to_seconds(None))
        self.assertIsNone(rules.minutes_to_seconds(0))

    def test_none_values_stay_none(self):
        self.assertIsNone(rules.hours_to_seconds(None))
        self.assertIsNone(rules.seconds_to_hours(None))


class SourceCategoryTests(SimpleTestCase):
    def test_reporting_method_drives_the_category(self):
        self.assertEqual(rules.source_category("System", "09:00:00-09:30:00"), rules.SOURCE_TIMESTAMPED)
        self.assertEqual(rules.source_category("Input", "Input"), rules.SOURCE_INPUT)
        self.assertEqual(rules.source_category("Attendance", "attended"), rules.SOURCE_ATTENDANCE)

    def test_label_is_the_fallback_only(self):
        self.assertEqual(rules.source_category(None, "10:00:00-10:29:00"), rules.SOURCE_TIMESTAMPED)
        self.assertEqual(rules.source_category(None, "Input"), rules.SOURCE_INPUT)
        self.assertEqual(rules.source_category("", "something else"), rules.SOURCE_OTHER)


class WorkingTimeTests(SimpleTestCase):
    def _codes(self, start, end, day=MONDAY, holiday=False):
        findings = rules.working_time_findings(day, _time(start), _time(end), holiday_status=holiday)
        return {finding.code for finding in findings}

    def test_start_boundaries(self):
        self.assertEqual(self._codes("09:00:00", "09:30:00"), set())
        self.assertIn(rules.CODE_START_BEFORE_HOURS, self._codes("08:59:59", "09:30:00"))
        self.assertEqual(self._codes("16:59:59", "17:00:00"), set())
        self.assertIn(rules.CODE_START_AT_OR_AFTER_CLOSE, self._codes("17:00:00", "17:00:30"))
        self.assertIn(rules.CODE_START_AT_OR_AFTER_CLOSE, self._codes("17:00:01", "17:30:00"))

    def test_end_boundaries(self):
        self.assertEqual(self._codes("16:00:00", "17:00:00"), set())
        self.assertIn(rules.CODE_END_AFTER_CLOSE, self._codes("16:00:00", "17:00:01"))
        self.assertIn(rules.CODE_END_NOT_AFTER_START, self._codes("10:00:00", "10:00:00"))
        self.assertIn(rules.CODE_END_NOT_AFTER_START, self._codes("10:00:00", "09:59:59"))

    def test_weekend_and_bank_holiday(self):
        self.assertIn(rules.CODE_WEEKEND, self._codes("10:00:00", "10:30:00", day=SATURDAY))
        self.assertIn(rules.CODE_WEEKEND, self._codes("10:00:00", "10:30:00", day=SUNDAY))
        self.assertIn(rules.CODE_BANK_HOLIDAY, self._codes("10:00:00", "10:30:00", holiday=True))

    def test_unavailable_calendar_is_blocking_not_ignored(self):
        findings = rules.working_time_findings(MONDAY, _time("10:00:00"), _time("10:30:00"),
                                               holiday_status=None)
        codes = {finding.code: finding.severity for finding in findings}
        self.assertEqual(codes.get(rules.CODE_CALENDAR_UNAVAILABLE), rules.SEVERITY_BLOCKING)

    def test_gmt_and_bst_dates_behave_identically(self):
        self.assertEqual(self._codes("09:00:00", "09:30:00", day=WINTER_MONDAY), set())
        self.assertEqual(self._codes("09:00:00", "09:30:00", day=MONDAY), set())

    def test_missing_timestamp_is_blocking(self):
        findings = rules.working_time_findings(MONDAY, None, _time("10:00:00"), holiday_status=False)
        self.assertEqual([finding.code for finding in findings], [rules.CODE_MISSING_TIMESTAMP])

    def test_elapsed_seconds_is_not_clamped(self):
        self.assertEqual(rules.elapsed_seconds(_time("13:37:01"), _time("14:04:23")), 1642)
        self.assertEqual(rules.elapsed_seconds(_time("10:00:00"), _time("09:59:00")), -60)
        self.assertIsNone(rules.elapsed_seconds(None, _time("10:00:00")))


class TimestampedReadingQuizTests(SimpleTestCase):
    def band(self, seconds):
        return rules.classify_timestamped_reading_quiz(seconds).band

    def test_boundaries(self):
        self.assertEqual(self.band(59), rules.BAND_BELOW_MINIMUM)
        self.assertEqual(self.band(60), rules.BAND_BELOW_NORMAL)
        self.assertEqual(self.band(767), rules.BAND_BELOW_NORMAL)
        self.assertEqual(self.band(768), rules.BAND_NORMAL)
        self.assertEqual(self.band(1999), rules.BAND_NORMAL)
        self.assertEqual(self.band(2000), rules.BAND_LONG_TAIL)
        self.assertEqual(self.band(3480), rules.BAND_LONG_TAIL)
        self.assertEqual(self.band(3481), rules.BAND_EXCESSIVE)

    def test_zero_and_negative_are_blocking(self):
        self.assertEqual(self.band(0), rules.BAND_BELOW_MINIMUM)
        self.assertEqual(self.band(-120), rules.BAND_BELOW_MINIMUM)

    def test_reference_is_1740_and_is_never_a_value(self):
        self.assertEqual(rules.READING_QUIZ_REFERENCE_SECONDS, 1740)
        classification = rules.classify_timestamped_reading_quiz(1740)
        self.assertEqual(classification.reference_seconds, 1740)
        self.assertIsNone(classification.finding())


class InputReadingQuizTests(SimpleTestCase):
    def band(self, seconds):
        return rules.classify_input_reading_quiz(seconds).band

    def test_boundaries(self):
        self.assertEqual(self.band(59), rules.BAND_BELOW_MINIMUM)
        self.assertEqual(self.band(839), rules.BAND_BELOW_NORMAL)
        self.assertEqual(self.band(840), rules.BAND_NORMAL)
        self.assertEqual(self.band(2640), rules.BAND_NORMAL)
        self.assertEqual(self.band(2641), rules.BAND_LONG_TAIL)
        self.assertEqual(self.band(3480), rules.BAND_LONG_TAIL)
        self.assertEqual(self.band(3481), rules.BAND_EXCESSIVE)

    def test_proposal_must_be_whole_minutes(self):
        self.assertEqual(rules.validate_input_reading_proposal(1740), 1740)
        with self.assertRaises(rules.ProposalError):
            rules.validate_input_reading_proposal(1741)
        with self.assertRaises(rules.ProposalError):
            rules.validate_input_reading_proposal(30)
        with self.assertRaises(rules.ProposalError):
            rules.validate_input_reading_proposal(3540)

    def test_existing_seconds_are_classified_not_rewritten(self):
        # A genuine stored value with seconds still classifies; nothing rounds it.
        self.assertEqual(self.band(1741), rules.BAND_NORMAL)


class MediaTests(SimpleTestCase):
    MEDIA = 1800   # 30 minutes

    def test_timestamped_boundaries(self):
        band = lambda seconds: rules.classify_timestamped_media(seconds, self.MEDIA).band
        self.assertEqual(band(self.MEDIA - 766), rules.BAND_NORMAL)
        self.assertEqual(band(self.MEDIA - 767), rules.BAND_BELOW_NORMAL)
        self.assertEqual(band(self.MEDIA + 766), rules.BAND_NORMAL)
        self.assertEqual(band(self.MEDIA + 767), rules.BAND_LONG_TAIL)
        self.assertEqual(band(2 * self.MEDIA), rules.BAND_LONG_TAIL)
        self.assertEqual(band(2 * self.MEDIA + 1), rules.BAND_EXCESSIVE)

    def test_one_minute_floor_applies_only_when_needed(self):
        short_media = 300   # 5 minutes: media - 766 is negative
        classification = rules.classify_timestamped_media(120, short_media)
        self.assertEqual(classification.normal_min, rules.MINIMUM_DURATION_SECONDS)
        self.assertEqual(classification.band, rules.BAND_NORMAL)
        self.assertEqual(rules.classify_timestamped_media(59, short_media).band, rules.BAND_BELOW_MINIMUM)

    def test_empty_long_tail_interval_is_not_invented(self):
        # media + 766 >= 2 * media  =>  no long-tail interval exists at all.
        media = 700
        self.assertGreaterEqual(media + rules.TIMESTAMPED_MEDIA_TOLERANCE_SECONDS, 2 * media)
        for seconds in range(media, 2 * media + 1, 97):
            self.assertNotEqual(rules.classify_timestamped_media(seconds, media).band, rules.BAND_LONG_TAIL)
        self.assertEqual(rules.classify_timestamped_media(2 * media + 1, media).band, rules.BAND_EXCESSIVE)

    def test_missing_media_duration_is_unclassifiable_not_invented(self):
        classification = rules.classify_timestamped_media(1200, None)
        self.assertEqual(classification.band, rules.BAND_UNCLASSIFIABLE)
        self.assertIsNone(classification.reference_seconds)
        self.assertEqual(classification.finding().code, rules.CODE_MISSING_MEDIA_DURATION)

    def test_input_media_boundaries(self):
        band = lambda seconds: rules.classify_input_media(seconds, self.MEDIA).band
        self.assertEqual(band(self.MEDIA + 900), rules.BAND_NORMAL)
        self.assertEqual(band(self.MEDIA + 901), rules.BAND_LONG_TAIL)
        self.assertEqual(band(2 * self.MEDIA), rules.BAND_LONG_TAIL)
        self.assertEqual(band(2 * self.MEDIA + 1), rules.BAND_EXCESSIVE)

    def test_permitted_offsets(self):
        self.assertEqual(rules.permitted_media_offsets(self.MEDIA),
                         [-900, -600, -300, 0, 300, 600, 900])
        # 10-minute media: -15m would be negative, -10m would be under a minute.
        self.assertEqual(rules.permitted_media_offsets(600), [-300, 0, 300, 600, 900])
        self.assertEqual(rules.permitted_media_offsets(None), [])

    def test_input_media_proposal_validation(self):
        self.assertEqual(rules.validate_input_media_proposal(self.MEDIA + 300, self.MEDIA), 2100)
        for invalid in (self.MEDIA + 120, self.MEDIA + 1200, self.MEDIA - 1200):
            with self.assertRaises(rules.ProposalError):
                rules.validate_input_media_proposal(invalid, self.MEDIA)

    def test_media_proposal_without_media_duration_is_refused(self):
        with self.assertRaises(rules.ProposalError):
            rules.validate_input_media_proposal(1800, None)


class OverlapTests(SimpleTestCase):
    def test_half_open_semantics(self):
        a, b = _time("10:00:00"), _time("10:30:00")
        c, d = _time("10:30:00"), _time("11:00:00")
        self.assertFalse(rules.intervals_overlap(a, b, c, d))          # touching
        self.assertTrue(rules.intervals_overlap(a, b, _time("10:29:59"), d))
        self.assertTrue(rules.intervals_overlap(a, b, a, b))           # duplicate
        self.assertTrue(rules.intervals_overlap(a, b, _time("10:05:00"), _time("10:10:00")))  # contained
        self.assertTrue(rules.is_duplicate_interval(a, b, a, b))
        self.assertFalse(rules.is_duplicate_interval(a, b, a, d))


class SourceAnalyticsTests(SimpleTestCase):
    def test_zero_records(self):
        result = rules.source_analytics(0, 0, 0)
        self.assertEqual(result.status, "no eligible records")
        self.assertIsNone(result.exception_rate)

    def test_exact_expected_distribution_has_no_exceptions(self):
        result = rules.source_analytics(23, 77, 0)
        self.assertEqual(result.expected_timestamped, 23)
        self.assertEqual(result.expected_input, 77)
        self.assertEqual(result.exception_count, 0)
        self.assertEqual(result.status, "within expectation")

    def test_other_sources_count_once(self):
        result = rules.source_analytics(23, 70, 7)
        self.assertEqual(result.exception_count, 100 - 23 - min(70, 77))
        self.assertEqual(result.exception_count, 7)

    def test_threshold_edges(self):
        # 7.5% exactly is within expectation; a hair above is an alert.
        self.assertEqual(rules.source_analytics(23, 77, 0).status, "within expectation")
        heavy = rules.source_analytics(10, 80, 10)
        self.assertEqual(heavy.status, "alert")

    def test_live_baseline_matches_the_documented_figure(self):
        result = rules.source_analytics(26896, 222588, 0)
        self.assertEqual(result.expected_timestamped, 57381)
        self.assertEqual(result.exception_count, 30485)
        self.assertEqual(result.status, "alert")


class LongTailAnalyticsTests(SimpleTestCase):
    def test_zero_denominator_does_not_divide(self):
        result = rules.long_tail_analytics(5, 0, 0, 5)
        self.assertIsNone(result.rate)
        self.assertEqual(result.status, "no classifiable records")

    def test_threshold_edges(self):
        self.assertEqual(rules.long_tail_analytics(1000, 1000, 93, 0).status, "within expected level")
        self.assertEqual(rules.long_tail_analytics(1000, 1000, 94, 0).status, "above expected level")

    def test_blocking_rows_stay_in_the_denominator(self):
        result = rules.long_tail_analytics(18803, 18803, 3318, 0)
        self.assertEqual(str(result.rate), "0.176461")


class FingerprintTests(SimpleTestCase):
    ROW = {
        "learner_id": 1, "kind": "video", "ref": "42", "reporting_method": "System",
        "timestamp_label": "10:00:00-10:30:00", "activity_date": MONDAY,
        "start_time": _time("10:00:00"), "end_time": _time("10:30:00"),
        "actual_hours": Decimal("0.5000"), "media_seconds": 1800,
    }

    def test_stable_for_unchanged_data(self):
        self.assertEqual(base_fingerprint(self.ROW), base_fingerprint(dict(self.ROW)))

    def test_changes_when_the_source_changes(self):
        changed = dict(self.ROW, end_time=_time("10:31:00"))
        self.assertNotEqual(base_fingerprint(self.ROW), base_fingerprint(changed))
        changed_hours = dict(self.ROW, actual_hours=Decimal("0.6000"))
        self.assertNotEqual(base_fingerprint(self.ROW), base_fingerprint(changed_hours))


class ApprovalFingerprintTests(SimpleTestCase):
    """The approval path must rebuild the fingerprint from the SAME shape the
    proposal used, or every media-bearing row would 409 as 'stale'."""

    PROPOSAL_TIME_ROW = {
        # what repository.base_row returns (base columns + joined media)
        "learner_id": 7, "aptem_id": 16456, "kind": "video", "ref": "9001",
        "reporting_method": "System", "timestamp_label": "10:00:00-10:30:00",
        "activity_date": MONDAY, "start_time": _time("10:00:00"), "end_time": _time("10:30:00"),
        "actual_hours": Decimal("0.5000"), "media_seconds": 1800,
    }

    def test_reread_through_the_media_join_matches(self):
        approval_time_row = dict(self.PROPOSAL_TIME_ROW)
        self.assertEqual(base_fingerprint(approval_time_row),
                         base_fingerprint(self.PROPOSAL_TIME_ROW))

    def test_locked_row_without_the_media_join_would_not_match(self):
        # Regression: lock_base_row does not select media, so fingerprinting the
        # locked row alone (media_seconds missing/None) must never be the check.
        locked_only = {key: value for key, value in self.PROPOSAL_TIME_ROW.items()
                       if key != "media_seconds"}
        self.assertNotEqual(base_fingerprint(locked_only),
                            base_fingerprint(self.PROPOSAL_TIME_ROW))

    def test_changed_media_duration_invalidates_the_proposal(self):
        changed = dict(self.PROPOSAL_TIME_ROW, media_seconds=2400)
        self.assertNotEqual(base_fingerprint(changed), base_fingerprint(self.PROPOSAL_TIME_ROW))

    def test_approval_reads_the_row_through_the_join(self):
        import inspect
        from .actual_hours import service as service_module
        source = inspect.getsource(service_module._decide)
        self.assertIn("repository.base_row(", source,
                      "approval must re-read the row through the media join")
        self.assertNotIn('base["media_seconds"] = revision', source,
                         "approval must not graft the proposal snapshot back onto the base row")


class ScanIdempotencyOrderTests(SimpleTestCase):
    """Findings raised while creating proposals must be collected BEFORE the
    stale-resolution pass, or a re-scan resolves and recreates them forever."""

    def test_resolution_runs_after_the_proposal_loop(self):
        import inspect
        from .actual_hours import service as service_module
        source = inspect.getsource(service_module.run_scan)
        resolve_at = source.index("set status = 'resolved'")
        proposal_at = source.index("CODE_TIMESTAMP_SEMANTICS_UNCONFIRMED")
        self.assertGreater(resolve_at, proposal_at,
                           "the stale-resolution UPDATE must come after the proposal loop")


class JournalReferenceTests(SimpleTestCase):
    """The value the Activity log's Actual column gets, per category."""

    def _row(self, **overrides):
        row = {"id": 1, "category": "reading+quiz", "activity_id": 99,
               "timestamp_label": "input", "actual_hours": Decimal("0.0"),
               "configured_duration_min": None}
        row.update(overrides)
        return row

    def test_reading_quiz_reports_on_the_five_minute_grid(self):
        seconds, basis, reason = journal_hours._reference_seconds(self._row())
        self.assertEqual(seconds, 30 * 60)          # 29-minute reference, snapped
        self.assertEqual(basis, journal_hours.BASIS_REFERENCE)
        self.assertIsNone(reason)
        self.assertEqual(str(rules.seconds_to_hours(seconds)), "0.5000")

    def test_snap_to_grid_rounds_halves_up(self):
        self.assertEqual(rules.snap_to_grid(1740), 1800)     # 29:00 -> 30:00
        self.assertEqual(rules.snap_to_grid(1440), 1500)     # 24:00 -> 25:00
        self.assertEqual(rules.snap_to_grid(1500), 1500)     # already on grid
        self.assertEqual(rules.snap_to_grid(1650), 1800)     # 27:30 -> 30:00
        self.assertIsNone(rules.snap_to_grid(None))

    def test_reading_quiz_with_each_permitted_offset(self):
        expected = {-15: 15, -10: 20, -5: 25, 0: 30, 5: 35, 10: 40, 15: 40}
        for offset in rules.PERMITTED_OFFSET_MINUTES:
            seconds, basis, reason = journal_hours._reference_seconds(self._row(), offset)
            self.assertEqual(seconds, expected[offset] * 60, offset)
            self.assertEqual(basis, journal_hours.BASIS_REFERENCE)
            self.assertIsNone(reason)

    def test_every_reading_quiz_value_ends_on_a_five_minute_boundary(self):
        for offset in rules.PERMITTED_OFFSET_MINUTES:
            seconds, _, _ = journal_hours._reference_seconds(self._row(), offset)
            self.assertEqual(seconds % rules.INPUT_GRID_SECONDS, 0, offset)
            self.assertIn((seconds // 60) % 10, (0, 5), offset)

    def test_reading_quiz_values_never_leave_the_normal_range(self):
        for offset in rules.PERMITTED_OFFSET_MINUTES:
            seconds, _, _ = journal_hours._reference_seconds(self._row(), offset)
            self.assertGreaterEqual(seconds, rules.INPUT_READING_NORMAL_MIN, offset)
            self.assertLessEqual(seconds, rules.INPUT_READING_NORMAL_MAX, offset)

    def test_media_rows_report_the_media_runtime_exactly(self):
        # The activity's own length is the actual hours: no offset, no snapping.
        row = self._row(category="video", configured_duration_min=Decimal("30"))
        for offset in rules.PERMITTED_OFFSET_MINUTES:
            seconds, basis, reason = journal_hours._reference_seconds(row, offset)
            self.assertEqual(seconds, 1800, offset)
            self.assertEqual(basis, journal_hours.BASIS_MEDIA)
            self.assertIsNone(reason)

    def test_odd_media_lengths_keep_their_seconds(self):
        row = self._row(category="audio", configured_duration_min=Decimal("7.35"))
        seconds, basis, _ = journal_hours._reference_seconds(row, 15)
        self.assertEqual(seconds, 441)                     # 7 min 21 s, untouched
        self.assertEqual(basis, journal_hours.BASIS_MEDIA)

    def test_a_media_length_under_a_minute_is_skipped_not_padded(self):
        row = self._row(category="video", configured_duration_min=Decimal("0.5"))
        seconds, basis, reason = journal_hours._reference_seconds(row, 0)
        self.assertIsNone(seconds)
        self.assertIn("under one minute", reason)

    def test_spread_gives_a_row_its_own_offset_from_the_permitted_set(self):
        offsets = {
            journal_hours.row_offset_minutes(self._row(id=row_id, activity_id=row_id),
                                             journal_hours.MODE_SPREAD, 0)
            for row_id in range(1, 200)
        }
        self.assertTrue(offsets.issubset(set(rules.PERMITTED_OFFSET_MINUTES)))
        # A month's worth of rows must not collapse onto one value.
        self.assertGreater(len(offsets), 3)

    def test_spread_is_derived_not_random(self):
        row = self._row(id=4242, activity_id=99)
        first = journal_hours.row_offset_minutes(row, journal_hours.MODE_SPREAD, 0)
        for _ in range(20):
            self.assertEqual(journal_hours.row_offset_minutes(dict(row),
                                                              journal_hours.MODE_SPREAD, 0), first)

    def test_fixed_mode_uses_the_chosen_offset_for_every_row(self):
        for row_id in range(1, 30):
            self.assertEqual(
                journal_hours.row_offset_minutes(self._row(id=row_id), journal_hours.MODE_FIXED, -10),
                -10,
            )

    def test_spread_values_stay_inside_the_normal_reading_range_and_on_the_grid(self):
        for row_id in range(1, 100):
            row = self._row(id=row_id, activity_id=row_id)
            offset = journal_hours.row_offset_minutes(row, journal_hours.MODE_SPREAD, 0)
            seconds, _, reason = journal_hours._reference_seconds(row, offset)
            self.assertIsNone(reason)
            self.assertGreaterEqual(seconds, rules.INPUT_READING_NORMAL_MIN)
            self.assertLessEqual(seconds, rules.INPUT_READING_NORMAL_MAX)
            self.assertEqual(seconds % rules.INPUT_GRID_SECONDS, 0)

    def test_offset_modes_are_validated(self):
        self.assertEqual(journal_hours.validate_offset_mode(None), journal_hours.MODE_SPREAD)
        self.assertEqual(journal_hours.validate_offset_mode("fixed"), journal_hours.MODE_FIXED)
        self.assertEqual(journal_hours.validate_offset_mode("SPREAD"), journal_hours.MODE_SPREAD)
        for invalid in ("random", "jitter", "auto"):
            with self.assertRaises(ServiceError, msg=invalid):
                journal_hours.validate_offset_mode(invalid)

    def test_offsets_outside_the_permitted_set_are_refused(self):
        for invalid in (-20, -7, 1, 3, 16, 100):
            with self.assertRaises(ServiceError, msg=invalid):
                journal_hours.validate_offset_minutes(invalid)
        for valid in rules.PERMITTED_OFFSET_MINUTES:
            self.assertEqual(journal_hours.validate_offset_minutes(valid), valid)
        self.assertEqual(journal_hours.validate_offset_minutes(None), 0)
        self.assertEqual(journal_hours.validate_offset_minutes(""), 0)
        with self.assertRaises(ServiceError):
            journal_hours.validate_offset_minutes("five")

    def test_media_rows_use_the_configured_duration_unsnapped(self):
        # A media length is a real measurement: it keeps its exact seconds.
        row = self._row(category="video", configured_duration_min=Decimal("30.15"))
        seconds, basis, reason = journal_hours._reference_seconds(row)
        self.assertEqual(seconds, 1809)
        self.assertEqual(basis, journal_hours.BASIS_MEDIA)
        self.assertNotEqual(seconds % rules.INPUT_GRID_SECONDS, 0)

    def test_audio_without_a_source_duration_is_never_invented(self):
        # Every audio activity in Last_audit carries configured_duration_min =
        # null, so these rows must be reported as skipped, not filled in.
        seconds, basis, reason = journal_hours._reference_seconds(
            self._row(category="audio", configured_duration_min=None), 10)
        self.assertIsNone(seconds)
        self.assertIsNone(basis)
        self.assertIn("no configured media duration", reason)

    def test_media_row_without_a_duration_is_skipped_not_invented(self):
        seconds, basis, reason = journal_hours._reference_seconds(self._row(category="audio"))
        self.assertIsNone(seconds)
        self.assertIn("no configured media duration", reason)

    def test_a_genuine_time_range_wins_over_the_reference(self):
        row = self._row(category="video", configured_duration_min=Decimal("30"),
                        timestamp_label="10:00:00-10:27:22")
        seconds, basis, reason = journal_hours._reference_seconds(row)
        self.assertEqual(seconds, 1642)
        self.assertEqual(basis, journal_hours.BASIS_ELAPSED)

    def test_a_genuine_time_range_is_never_shifted_by_the_offset(self):
        row = self._row(category="video", configured_duration_min=Decimal("30"),
                        timestamp_label="10:00:00-10:27:22")
        for offset in rules.PERMITTED_OFFSET_MINUTES:
            seconds, basis, _ = journal_hours._reference_seconds(row, offset)
            self.assertEqual(seconds, 1642, offset)
            self.assertEqual(basis, journal_hours.BASIS_ELAPSED)

    def test_a_sub_minute_time_range_is_skipped(self):
        row = self._row(timestamp_label="10:00:00-10:00:30")
        seconds, basis, reason = journal_hours._reference_seconds(row)
        self.assertIsNone(seconds)
        self.assertIn("under one minute", reason)

    def test_only_lms_categories_are_eligible(self):
        self.assertEqual(set(journal_hours.ELIGIBLE_CATEGORIES), {"reading+quiz", "video", "audio"})
        self.assertNotIn("attendance", journal_hours.ELIGIBLE_CATEGORIES)
        self.assertNotIn("assignment", journal_hours.ELIGIBLE_CATEGORIES)

    def test_calculate_never_writes_the_journal_row_itself(self):
        # calculate() may write its own revision table (inserting a proposal,
        # superseding a stale one) but must never touch the report's own row.
        import inspect
        source = inspect.getsource(journal_hours.calculate)
        self.assertIn("insert into", source.lower())
        # The journal row's table is only ever named through the MANUAL_ROWS
        # placeholder — calculate() must not reference it at all.
        self.assertNotIn("{MANUAL_ROWS}", source)
        self.assertNotIn("actual_hours = %s", source)
        # The one statement that writes the report lives in decide().
        decide_source = inspect.getsource(journal_hours.decide)
        self.assertIn("{MANUAL_ROWS}", decide_source)
        self.assertIn("set actual_hours", decide_source)

    def test_two_person_rule_is_skipped_only_for_the_workspace_actor(self):
        import inspect
        source = inspect.getsource(journal_hours.decide)
        self.assertIn("enforces_two_person", source)
        # Default for any identity that does not say otherwise is: enforce it.
        self.assertIn('getattr(actor, "enforces_two_person", True)', source)

    def test_a_stale_pending_proposal_is_superseded_not_left_in_place(self):
        # Recalculating with a different offset has to replace the pending value,
        # and the old proposal is kept as history rather than deleted.
        import inspect
        source = inspect.getsource(journal_hours.calculate)
        self.assertIn("'superseded'", source)
        self.assertNotIn("delete from", source.lower())


class ReadingOnlyTests(SimpleTestCase):
    """Which journal rows the Aptem LMS plan is shared across."""

    def _row(self, **overrides):
        row = {"category": "reading+quiz", "quiz_id": None, "reading_type": "pdf",
               "reading_iframe_url": "https://example.invalid/week-6.pdf",
               "reading_text_body": None}
        row.update(overrides)
        return row

    def test_a_reading_with_no_quiz_counts(self):
        self.assertTrue(journal_hours.is_reading_only(self._row()))
        self.assertTrue(journal_hours.is_reading_only(
            self._row(reading_type="ppt")))
        self.assertTrue(journal_hours.is_reading_only(
            self._row(reading_type=None, reading_text_body="some text")))

    def test_a_row_carrying_a_quiz_does_not_count(self):
        self.assertFalse(journal_hours.is_reading_only(self._row(quiz_id=4321)))

    def test_a_quiz_only_row_does_not_count(self):
        self.assertFalse(journal_hours.is_reading_only(
            self._row(quiz_id=99, reading_type=None, reading_iframe_url=None)))

    def test_a_row_with_no_reading_content_does_not_count(self):
        self.assertFalse(journal_hours.is_reading_only(
            self._row(reading_type=None, reading_iframe_url=None, reading_text_body=None)))

    def test_other_categories_never_count(self):
        for category in ("video", "audio", "attendance", "assignment"):
            self.assertFalse(journal_hours.is_reading_only(self._row(category=category)), category)


class PlannedAllocationTests(SimpleTestCase):
    """Aptem's LMS planned hours shared across the month's reading-only rows."""

    def test_the_parts_add_back_up_to_the_total_exactly(self):
        for total, count in ((Decimal("23"), 22), (Decimal("16"), 7), (Decimal("8"), 3),
                             (Decimal("22"), 19), (Decimal("10"), 9), (Decimal("7"), 13)):
            allocation = journal_hours.planned_allocation(total, list(range(count)))
            self.assertEqual(sum(allocation.values()), total, f"{total}h over {count} rows")
            self.assertEqual(len(allocation), count)

    def test_every_share_is_within_a_rounding_step_of_the_even_split(self):
        total, count = Decimal("23"), 22
        allocation = journal_hours.planned_allocation(total, list(range(count)))
        even = journal_hours.planned_share(total, count)
        for value in allocation.values():
            self.assertLessEqual(abs(value - even), rules.HOURS_QUANTUM)

    def test_nothing_to_share_gives_nothing(self):
        self.assertEqual(journal_hours.planned_allocation(Decimal("23"), []), {})
        self.assertEqual(journal_hours.planned_allocation(Decimal("0"), [1, 2]), {})
        self.assertEqual(journal_hours.planned_allocation(None, [1, 2]), {})
        self.assertIsNone(journal_hours.planned_share(Decimal("23"), 0))
        self.assertIsNone(journal_hours.planned_share(Decimal("0"), 5))

    def test_the_lms_component_filter_is_a_name_match(self):
        # The Aptem plan names these components "…LMS Activity" / "… LMS Progress".
        self.assertEqual(journal_hours.LMS_COMPONENT_PATTERN, "%LMS%")

    def test_the_plan_is_read_from_aptem_not_the_assignments_feed(self):
        # The assignments feed carries "Assignment" components only, so the
        # LMS Activity rows an auditor sees in Aptem are absent from it. The
        # planned pool must come from the fetched plan itself.
        import inspect
        source = inspect.getsource(journal_hours.lms_planned_hours)
        self.assertIn("{APTEM_PLAN}", source)
        self.assertIn("components_json", source)
        self.assertNotIn("learner_assignments", source)
        self.assertIn("end_date", source)      # bucketed by the component's due date
        self.assertEqual(journal_hours.APTEM_PLAN, '"LMS"."Aptem_users"')

    def test_each_button_asks_for_its_own_column(self):
        self.assertEqual(journal_hours.validate_fields(None), journal_hours.FIELD_BOTH)
        self.assertEqual(journal_hours.validate_fields("actual"), journal_hours.FIELD_ACTUAL)
        self.assertEqual(journal_hours.validate_fields("PLANNED"), journal_hours.FIELD_PLANNED)
        for invalid in ("hours", "planned_hours", "all"):
            with self.assertRaises(ServiceError, msg=invalid):
                journal_hours.validate_fields(invalid)

    def test_calculating_one_column_keeps_the_other_pending_value(self):
        # Pressing one button must not throw away what the other one proposed.
        import inspect
        source = inspect.getsource(journal_hours.calculate)
        self.assertIn("merged_actual", source)
        self.assertIn("merged_planned", source)
        self.assertIn("wants_actual", source)
        self.assertIn("wants_planned", source)
        # …and the superseded proposal is kept as history, never deleted.
        self.assertIn("'superseded'", source)
        self.assertNotIn("delete from", source.lower())

    def test_planned_hours_are_only_written_through_approval(self):
        import inspect
        self.assertNotIn("{MANUAL_ROWS}", inspect.getsource(journal_hours.calculate))
        decide_source = inspect.getsource(journal_hours.decide)
        self.assertIn("planned_hours = coalesce(%s, planned_hours)", decide_source)


class NoRandomnessTests(SimpleTestCase):
    """The contract's headline rule, asserted mechanically."""

    def test_production_modules_do_not_import_randomness(self):
        import inspect
        from .actual_hours import repository, rules as rules_module, service
        for module in (rules_module, service, repository, journal_hours):
            source = inspect.getsource(module)
            for banned in ("import random", "random.", "uuid4", "faker", "jitter"):
                self.assertNotIn(banned, source, f"{module.__name__} references {banned}")

    def test_classification_is_deterministic(self):
        first = [rules.classify("video", rules.SOURCE_TIMESTAMPED, seconds, 1800).band
                 for seconds in range(0, 4000, 137)]
        second = [rules.classify("video", rules.SOURCE_TIMESTAMPED, seconds, 1800).band
                  for seconds in range(0, 4000, 137)]
        self.assertEqual(first, second)
