"""Crediting hours for progress imported from the legacy MBA site.

The MBA data records how long a component was *open*, not how long it was
worked on, so it arrives unusable in both directions: quizzes store 0 seconds
because they tracked attempts instead, and a video left open over a weekend
stores days. These cover the rule that turns that into an OTJH figure, because
getting it wrong is not visible in the import output -- it just quietly gives a
learner the wrong hours.
"""
from django.test import SimpleTestCase

from .management.commands.import_mba_progress import (
    DEFAULT_PASSING_GRADE,
    IMPLAUSIBLY_SHORT_SECONDS,
    _completed,
    _credit_seconds,
    _decode,
    _quiz_result,
)

TWO_HOURS = 2 * 3600


class CreditSecondsTests(SimpleTestCase):
    def test_a_plausible_reading_is_kept(self):
        # Within the authored budget and long enough to be real work: this is
        # the only case where MBA's own number survives.
        self.assertEqual(_credit_seconds(3600, TWO_HOURS), (3600, ""))

    def test_an_impossible_reading_is_capped_at_the_authored_hours(self):
        # 69 days on one video is the real value that prompted this.
        self.assertEqual(_credit_seconds(5969139, TWO_HOURS), (TWO_HOURS, "capped"))

    def test_no_recorded_time_still_credits_the_completion(self):
        # Quizzes store exactly 0. The learner passed them; crediting nothing
        # would understate the work as badly as the raw seconds overstate it.
        self.assertEqual(_credit_seconds(0, TWO_HOURS), (TWO_HOURS, "floored"))

    def test_a_few_seconds_reads_as_no_measurement_rather_than_instant_work(self):
        self.assertEqual(_credit_seconds(7, TWO_HOURS), (TWO_HOURS, "floored"))

    def test_the_floor_boundary_is_inclusive_of_real_readings(self):
        # Exactly at the threshold counts as measured, not missing.
        self.assertEqual(
            _credit_seconds(IMPLAUSIBLY_SHORT_SECONDS, TWO_HOURS),
            (IMPLAUSIBLY_SHORT_SECONDS, ""),
        )

    def test_a_component_worth_no_hours_credits_none(self):
        # The bug this guards: treating a zero budget as "no ceiling" let ~1,000
        # components through at their raw wall-clock time and imported 75,000
        # hours. Zero authored hours means the component is not OTJH-bearing.
        self.assertEqual(_credit_seconds(5969139, 0), (0, "uncredited"))

    def test_hours_can_never_exceed_what_the_curriculum_authored(self):
        # The property that makes the total defensible: whatever MBA claims,
        # a component is worth at most what the course author said it was.
        for claimed in (0, 5, 60, 7199, TWO_HOURS, 10**7):
            seconds, _ = _credit_seconds(claimed, TWO_HOURS)
            self.assertLessEqual(seconds, TWO_HOURS)
            self.assertGreaterEqual(seconds, 0)


class CompletionTests(SimpleTestCase):
    def test_the_completed_flag_counts(self):
        self.assertTrue(_completed({"completed": True}))

    def test_the_status_counts_when_the_flag_is_missing(self):
        # Some rows carry one and not the other.
        self.assertTrue(_completed({"status": "completed"}))

    def test_started_but_unfinished_does_not_count(self):
        self.assertFalse(_completed({"visited": True, "status": "in_progress"}))

    def test_nothing_at_all_does_not_count(self):
        for value in ({}, None, "", []):
            self.assertFalse(_completed(value), repr(value))


class DecodeTests(SimpleTestCase):
    """MBA's JSONB columns hold JSON strings containing JSON."""

    def test_a_plain_list_passes_through(self):
        self.assertEqual(_decode([{"a": 1}]), [{"a": 1}])

    def test_a_json_string_is_decoded(self):
        self.assertEqual(_decode('[{"a": 1}]'), [{"a": 1}])

    def test_a_double_encoded_string_is_decoded(self):
        # The actual shape in student_progress.component_progress -- iterating
        # it without this yields single characters.
        self.assertEqual(_decode('"[{\\"a\\": 1}]"'), [{"a": 1}])

    def test_something_that_is_not_json_gives_nothing(self):
        self.assertIsNone(_decode("not json at all"))


class QuizResultTests(SimpleTestCase):
    """Scores as the platform stores them, and passes it would have awarded."""

    def test_a_score_is_converted_to_the_platforms_decimal_scale(self):
        # MBA scores out of 100, the platform stores 0-1 and renders it as a
        # percentage. Importing 85 unconverted displayed as 8500%.
        grade, _ = _quiz_result({"best_score_percent": 85}, 50)
        self.assertEqual(grade, 0.85)

    def test_a_pass_is_judged_against_the_quizs_own_mark(self):
        _, passed = _quiz_result({"best_score_percent": 72, "passed": True}, 70)
        self.assertTrue(passed)

    def test_a_score_under_the_mark_fails_whatever_mba_claimed(self):
        # The reason this exists: MBA flags every completed quiz as passed, so
        # a 5% attempt arrived claiming a pass.
        _, passed = _quiz_result({"best_score_percent": 5, "passed": True}, 70)
        self.assertFalse(passed)

    def test_the_mark_itself_passes(self):
        _, passed = _quiz_result({"best_score_percent": 70, "passed": True}, 70)
        self.assertTrue(passed)

    def test_a_quiz_with_no_authored_mark_uses_the_default(self):
        _, passed = _quiz_result({"best_score_percent": DEFAULT_PASSING_GRADE}, None)
        self.assertTrue(passed)
        _, failed = _quiz_result({"best_score_percent": DEFAULT_PASSING_GRADE - 1}, None)
        self.assertFalse(failed)

    def test_the_last_score_stands_in_when_there_is_no_best(self):
        grade, _ = _quiz_result({"last_score_percent": 60}, 50)
        self.assertEqual(grade, 0.6)

    def test_an_unscored_attempt_keeps_mbas_own_verdict(self):
        # Nothing to judge against; failing it would be inventing a result.
        grade, passed = _quiz_result({"passed": True}, 70)
        self.assertIsNone(grade)
        self.assertTrue(passed)

    def test_a_nonsense_score_does_not_raise(self):
        grade, passed = _quiz_result({"best_score_percent": "n/a", "passed": False}, 70)
        self.assertIsNone(grade)
        self.assertFalse(passed)
