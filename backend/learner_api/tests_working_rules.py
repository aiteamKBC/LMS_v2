"""The working rules themselves.

Holidays are injected, so these cover the rule and not the curriculum read: no
database is touched. The scoping itself -- that a holiday reaches only its own
cohort -- is covered by the endpoint tests in tests.py, which patch the
resolver.
"""
import os
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from .working_rules import (
    DeclaredCompletionError,
    learner_holiday_details,
    parse_declared_completion,
    reporting_instant,
    resolve_completion_instants,
    working_rule_failure,
)

UK = ZoneInfo("Europe/London")
UTC = ZoneInfo("UTC")


class WorkingRuleFailureTests(SimpleTestCase):
    def failure(self, instant, holidays=None):
        return working_rule_failure(instant, holiday_details=holidays or {})

    def test_weekday_inside_hours_is_a_working_instant(self):
        self.assertIsNone(self.failure(datetime(2026, 1, 15, 12, 0, tzinfo=UTC)))

    def test_boundaries_follow_07_00_to_19_00(self):
        self.assertIsNotNone(self.failure(datetime(2026, 1, 15, 6, 59, tzinfo=UK)))
        self.assertIsNone(self.failure(datetime(2026, 1, 15, 7, 0, tzinfo=UK)))
        self.assertIsNone(self.failure(datetime(2026, 1, 15, 18, 59, tzinfo=UK)))
        self.assertIsNotNone(self.failure(datetime(2026, 1, 15, 19, 0, tzinfo=UK)))

    def test_british_summer_time_is_applied_not_assumed(self):
        # 06:00 UTC in July is 07:00 BST -- inside hours.
        self.assertIsNone(self.failure(datetime(2026, 7, 15, 6, 0, tzinfo=UTC)))
        self.assertIsNotNone(self.failure(datetime(2026, 7, 15, 5, 59, tzinfo=UTC)))

    def test_a_learner_in_another_time_zone_is_judged_in_uk_terms(self):
        # 23:00 in Sydney on the 16th is 13:00 UK on the 16th: a valid instant.
        sydney = datetime(2026, 1, 16, 23, 0, tzinfo=ZoneInfo("Australia/Sydney"))
        self.assertIsNone(self.failure(sydney))

    def test_weekend_reports_weekend(self):
        saturday = self.failure(datetime(2026, 1, 17, 12, 0, tzinfo=UK))
        self.assertEqual(saturday["reason"], "weekend")
        self.assertEqual(self.failure(datetime(2026, 1, 18, 12, 0, tzinfo=UK))["reason"], "weekend")

    def test_holiday_beats_the_clock_and_names_itself(self):
        holidays = {date(2026, 1, 15): [{"label": "Christmas closure"}]}
        found = self.failure(datetime(2026, 1, 15, 12, 0, tzinfo=UK), holidays)
        self.assertEqual(found["reason"], "holiday")
        self.assertEqual(found["holidayName"], "Christmas closure")
        self.assertIn("Christmas closure", found["message"])

    def test_an_unnamed_holiday_still_refuses_without_inventing_a_name(self):
        holidays = {date(2026, 1, 15): [{"label": ""}]}
        found = self.failure(datetime(2026, 1, 15, 12, 0, tzinfo=UK), holidays)
        self.assertEqual(found["reason"], "holiday")
        self.assertEqual(found["holidayName"], "")

    def test_a_holiday_on_another_day_leaves_this_one_alone(self):
        holidays = {date(2026, 1, 14): [{"label": "Closure"}]}
        self.assertIsNone(self.failure(datetime(2026, 1, 15, 12, 0, tzinfo=UK), holidays))


class ResolveCompletionInstantsTests(SimpleTestCase):
    def resolve(self, payload, submitted_at, holidays=None):
        with patch("learner_api.working_rules.learner_holiday_details", return_value=holidays or {}):
            return resolve_completion_instants(payload, submitted_at, component_id="C1")

    def test_a_valid_click_declares_nothing_and_explains_nothing(self):
        declared, reason = self.resolve({}, datetime(2026, 1, 15, 12, 0, tzinfo=UK))
        self.assertIsNone(declared)
        self.assertEqual(reason, "")

    def test_an_invalid_click_with_no_declaration_refuses(self):
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve({}, datetime(2026, 1, 18, 22, 0, tzinfo=UK))
        self.assertEqual(caught.exception.reason, "weekend")

    def test_a_valid_declaration_records_why_the_click_failed(self):
        declared, reason = self.resolve(
            {"declaredCompletedAt": "2026-01-16T14:30:00"},
            datetime(2026, 1, 18, 22, 0, tzinfo=UK),
        )
        self.assertEqual(declared.hour, 14)
        self.assertEqual(reason, "weekend")

    def test_an_invalid_declaration_is_refused_however_it_arrived(self):
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(
                {"declaredCompletedAt": "2026-01-17T14:30:00"},
                datetime(2026, 1, 18, 22, 0, tzinfo=UK),
            )
        self.assertEqual(caught.exception.reason, "weekend")

    def test_a_declaration_on_the_learners_own_holiday_is_refused(self):
        holidays = {date(2026, 1, 16): [{"label": "Reading week"}]}
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(
                {"declaredCompletedAt": "2026-01-16T14:30:00"},
                datetime(2026, 1, 18, 22, 0, tzinfo=UK),
                holidays,
            )
        self.assertEqual(caught.exception.reason, "holiday")
        self.assertEqual(caught.exception.holiday_name, "Reading week")

    def test_a_future_declaration_is_refused(self):
        with self.assertRaises(DeclaredCompletionError):
            self.resolve(
                {"declaredCompletedAt": "2026-01-23T14:30:00"},
                datetime(2026, 1, 18, 22, 0, tzinfo=UK),
            )

    def test_unreadable_declaration_is_refused_rather_than_ignored(self):
        with self.assertRaises(DeclaredCompletionError):
            self.resolve(
                {"declaredCompletedAt": "not a date"},
                datetime(2026, 1, 18, 22, 0, tzinfo=UK),
            )

    def test_a_declaration_offered_on_an_already_valid_click_explains_nothing(self):
        declared, reason = self.resolve(
            {"declaredCompletedAt": "2026-01-15T10:00:00"},
            datetime(2026, 1, 15, 12, 0, tzinfo=UK),
        )
        self.assertIsNotNone(declared)
        self.assertEqual(reason, "")


class ParseDeclaredCompletionTests(SimpleTestCase):
    def test_a_bare_picker_value_is_read_as_uk_local_time(self):
        parsed = parse_declared_completion("2026-01-16T14:30")
        self.assertEqual(parsed.astimezone(UK).hour, 14)

    def test_an_offset_is_honoured_when_one_is_given(self):
        parsed = parse_declared_completion("2026-01-16T14:30:00+00:00")
        self.assertEqual(parsed.astimezone(UK).hour, 14)

    def test_blank_is_no_declaration_rather_than_an_error(self):
        self.assertIsNone(parse_declared_completion(""))
        self.assertIsNone(parse_declared_completion(None))


class ReportingInstantTests(SimpleTestCase):
    """OTJH and reporting read the declared instant; audit keeps the click."""

    def test_the_declaration_wins_when_there_is_one(self):
        record = {"submittedAt": "2026-09-29T22:30:00", "declaredCompletedAt": "2026-09-29T14:30:00"}
        self.assertEqual(reporting_instant(record), "2026-09-29T14:30:00")

    def test_the_click_is_used_when_nothing_was_declared(self):
        self.assertEqual(
            reporting_instant({"submittedAt": "2026-09-29T10:30:00", "declaredCompletedAt": ""}),
            "2026-09-29T10:30:00",
        )

    def test_a_record_with_neither_reports_nothing(self):
        self.assertEqual(reporting_instant({}), "")
        self.assertEqual(reporting_instant(None), "")


class HolidayOwnerResolutionTests(SimpleTestCase):
    """A quiz reaches its cohort through its week; a component through its module."""

    def test_a_quiz_is_resolved_through_its_week_not_a_component(self):
        with patch("learner_api.working_rules._module_cohort_for_quiz", return_value="") as by_quiz:
            with patch("learner_api.working_rules._module_cohort_for_component") as by_component:
                self.assertEqual(learner_holiday_details(quiz_id=77), {})
        by_quiz.assert_called_once_with(77)
        by_component.assert_not_called()

    def test_a_component_still_resolves_through_its_module(self):
        with patch("learner_api.working_rules._module_cohort_for_component", return_value="") as by_component:
            with patch("learner_api.working_rules._module_cohort_for_quiz") as by_quiz:
                self.assertEqual(learner_holiday_details("COMP-1"), {})
        by_component.assert_called_once_with("COMP-1")
        by_quiz.assert_not_called()

    def test_work_with_no_cohort_has_no_closures_to_sit_on(self):
        with patch("learner_api.working_rules._module_cohort_for_component", return_value=""):
            self.assertEqual(learner_holiday_details(None), {})


class OverviewBucketingTests(SimpleTestCase):
    """The learner's own week/month totals bucket where the coach's do."""

    def test_a_corrected_completion_counts_on_the_declared_day(self):
        from .overview_week import completion_day

        row = {"submittedAt": "2026-01-18T22:00:00+00:00",     # Sunday night
               "declaredCompletedAt": "2026-01-16T14:30:00+00:00"}   # Friday
        self.assertEqual(completion_day(row).isoformat(), "2026-01-16")

    def test_an_uncorrected_completion_still_counts_on_the_click(self):
        from .overview_week import completion_day

        self.assertEqual(
            completion_day({"submittedAt": "2026-01-16T14:30:00+00:00"}).isoformat(),
            "2026-01-16",
        )

    def test_a_row_with_no_instant_buckets_nowhere(self):
        from .overview_week import completion_day

        self.assertIsNone(completion_day({}))
        self.assertIsNone(completion_day(None))


class SimulatedClockTests(SimpleTestCase):
    """The test-only clock override, and the locks that keep it off elsewhere.

    The real click here is Sunday 18 Jan 2026 22:00 UK -- a weekend AND outside
    hours -- so "the override was ignored" and "the override was applied" can
    never be confused for one another.
    """

    REAL_CLICK = datetime(2026, 1, 18, 22, 0, tzinfo=UK)
    WORKING_INSTANT = "2026-01-15T14:30:00+00:00"

    def resolve(self, *, on_test_branch, now_value, payload=None):
        # patch.dict restores os.environ on exit, so setting/unsetting the key
        # inside it cannot leak into another test or the developer's shell.
        with patch("learner_api.working_rules.learner_holiday_details", return_value={}):
            with patch.object(settings, "RUN_APP_ON_TEST_BRANCH", on_test_branch, create=True):
                with patch.dict(os.environ, {}, clear=False):
                    if now_value is None:
                        os.environ.pop("TEST_COMPLETION_NOW", None)
                    else:
                        os.environ["TEST_COMPLETION_NOW"] = now_value
                    return resolve_completion_instants(
                        payload or {}, self.REAL_CLICK, component_id="C1",
                    )

    def test_production_ignores_the_variable_even_when_it_is_set(self):
        # The lock that matters: flag off, so the refusal still describes the
        # real click and the variable is never consulted.
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(on_test_branch=False, now_value=self.WORKING_INSTANT)
        self.assertEqual(caught.exception.reason, "weekend")

    def test_test_branch_without_the_variable_is_unchanged(self):
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(on_test_branch=True, now_value=None)
        self.assertEqual(caught.exception.reason, "weekend")

    def test_test_branch_judges_the_forced_instant(self):
        declared, reason = self.resolve(
            on_test_branch=True, now_value=self.WORKING_INSTANT,
        )
        self.assertIsNone(declared)
        self.assertEqual(reason, "")

    def test_a_forced_instant_can_simulate_outside_hours(self):
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(on_test_branch=True, now_value="2026-01-15T22:30:00+00:00")
        self.assertEqual(caught.exception.reason, "outside_working_hours")

    def test_a_declaration_is_still_re_validated_against_the_rules(self):
        # A forced clock does not let an invalid declared instant through.
        with self.assertRaises(DeclaredCompletionError) as caught:
            self.resolve(
                on_test_branch=True,
                now_value="2026-01-15T22:30:00+00:00",
                payload={"declaredCompletedAt": "2026-01-17T14:30:00"},
            )
        self.assertEqual(caught.exception.reason, "weekend")

    def test_a_garbled_value_fails_loud_rather_than_using_the_real_clock(self):
        with self.assertRaises(ImproperlyConfigured):
            self.resolve(on_test_branch=True, now_value="tomorrow-ish")
