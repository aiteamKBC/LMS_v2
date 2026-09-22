"""DB-free regression tests for Progress Review target inputs and calculation."""
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from curriculum_api.review_instances import review_instance_progress_snapshot

from . import learner_detail, review_progress_inputs, review_progress_snapshot
from .training_plan_targets import (
    TARGET_STATUS_RESOLVED,
    TARGET_STATUS_UNRESOLVED,
    WeekScheduleResolution,
    calculate_training_plan_targets,
    derive_week_starts,
)


def component(component_id, week_id, hours=0, **extra):
    return {
        "module": "Module",
        "week": week_id,
        "moduleId": "M1",
        "weekId": week_id,
        "componentId": component_id,
        "expectedOtjh": hours,
        **extra,
    }


def plan(components, weeks=("W1", "W2", "W3")):
    return {
        "week": [
            {"module": "Module", "week": week_id, "moduleId": "M1", "weekId": week_id}
            for week_id in weeks
        ],
        "components": components,
        "totalExpectedOtjh": sum(float(row.get("expectedOtjh") or 0) for row in components),
    }


def schedule(**dates):
    return WeekScheduleResolution(dates, [])


class TrainingPlanTargetTests(SimpleTestCase):
    def calculate(self, detail, *, as_of=date(2026, 9, 8), progress=None, dates=None):
        if dates is None:
            dates = {"W1": date(2026, 9, 1), "W2": date(2026, 9, 8), "W3": date(2026, 9, 15)}
        return calculate_training_plan_targets(
            detail, progress=progress or [], as_of=as_of, week_schedule=schedule(**dates),
        )

    def test_components_and_otj_use_the_same_eligible_weeks(self):
        detail = plan([
            component("C1", "W1", 10), component("C2", "W1", 0),
            component("C3", "W2", 16), component("C4", "W3", 12),
        ])
        result = self.calculate(detail)
        self.assertEqual(result["status"], TARGET_STATUS_RESOLVED)
        self.assertEqual(result["targetComponents"], 3)
        self.assertEqual(result["targetOtjHours"], 26)
        self.assertEqual(result["totalComponents"], 4)
        self.assertEqual(result["totalPlannedOtjHours"], 38)

    def test_week_is_included_on_start_date_and_future_week_is_excluded(self):
        detail = plan([component("C1", "W1", 3), component("C2", "W2", 4)])
        before = self.calculate(detail, as_of=date(2026, 9, 7))
        on_date = self.calculate(detail, as_of=date(2026, 9, 8))
        self.assertEqual(before["targetComponents"], 1)
        self.assertEqual(on_date["targetComponents"], 2)
        self.assertEqual(on_date["targetOtjHours"], 7)

    def test_review_hours_extend_the_same_planned_and_target_otj_universe_once(self):
        result = calculate_training_plan_targets(
            plan([component("C1", "W1", 10), component("C2", "W2", 20)]),
            progress=[], as_of=date(2026, 9, 8),
            week_schedule=schedule(W1=date(2026, 9, 1), W2=date(2026, 9, 15)),
            planned_review_otj_hours=12,
            target_review_otj_hours=3,
        )
        self.assertEqual(result["componentPlannedOtjHours"], 30)
        self.assertEqual(result["reviewPlannedOtjHours"], 12)
        self.assertEqual(result["reviewTargetOtjHours"], 3)
        self.assertEqual(result["totalPlannedOtjHours"], 42)
        self.assertEqual(result["targetOtjHours"], 13)

    def test_early_completion_changes_actual_not_target(self):
        result = self.calculate(
            plan([component("C1", "W1"), component("C2", "W2")]),
            as_of=date(2026, 9, 1),
            progress=[{"componentId": "C2", "kind": "component"}],
        )
        self.assertEqual(result["targetComponents"], 1)
        self.assertEqual(result["completedComponents"], 1)

    def test_mixed_dated_and_undated_modules_are_unresolved_not_partial(self):
        result = calculate_training_plan_targets(
            plan([component("C1", "W1", 3), component("C2", "W2", 4)]),
            progress=[], as_of=date(2026, 9, 20),
            week_schedule=WeekScheduleResolution(
                {"W1": date(2026, 9, 1)},
                [{"code": "module_has_no_start_date", "moduleId": "M1", "weekId": "W2"}],
            ),
        )
        self.assertEqual(result["status"], TARGET_STATUS_UNRESOLVED)
        self.assertIsNone(result["targetComponents"])
        self.assertIsNone(result["targetOtjHours"])

    def test_zero_totals_are_valid_resolved_targets(self):
        result = calculate_training_plan_targets(
            plan([], weeks=("W1",)), progress=[], as_of=date(2026, 9, 8),
            week_schedule=WeekScheduleResolution(
                {}, [{"code": "module_has_no_start_date", "moduleId": "M1", "weekId": "W1"}],
            ),
        )
        self.assertEqual(result["status"], TARGET_STATUS_RESOLVED)
        self.assertEqual(result["targetComponents"], 0)
        self.assertEqual(result["targetOtjHours"], 0)
        self.assertEqual(result["totalPlannedOtjHours"], 0)

    def test_missing_authoritative_week_date_is_explicitly_unresolved(self):
        result = self.calculate(plan([component("C1", "W1")]), dates={})
        self.assertEqual(result["status"], TARGET_STATUS_UNRESOLVED)
        self.assertIn(
            "planned_component_week_date_unresolved",
            {reason["code"] for reason in result["unresolvedReasons"]},
        )

    def test_quiz_identity_matches_progress_and_is_not_double_counted(self):
        quiz = {"isQuiz": True, "type": "quiz", "quizMeta": {"quizId": 42}}
        result = self.calculate(
            plan([
                component("AUTHORED-COMPONENT", "W1", 99, **quiz),
                component(None, "W1", 99, **quiz),
            ]),
            progress=[{"kind": "quiz", "quizId": 42, "passed": True}],
        )
        self.assertEqual(result["totalComponents"], 1)
        self.assertEqual(result["completedComponents"], 1)
        self.assertEqual(result["totalPlannedOtjHours"], 0)

    def test_failed_quiz_is_not_completed(self):
        result = self.calculate(
            plan([component(None, "W1", isQuiz=True, type="quiz", quizMeta={"quizId": 42})]),
            progress=[{"kind": "quiz", "quizId": 42, "passed": False}],
        )
        self.assertEqual(result["totalComponents"], 1)
        self.assertEqual(result["completedComponents"], 0)

    def test_duplicate_quiz_with_different_week_placements_is_unresolved(self):
        quiz = {"isQuiz": True, "type": "quiz", "quizMeta": {"quizId": 42}}
        result = self.calculate(plan([
            component(None, "W1", **quiz),
            component(None, "W2", **quiz),
        ]))
        self.assertEqual(result["status"], TARGET_STATUS_UNRESOLVED)
        self.assertEqual(result["totalComponents"], 1)
        self.assertIn(
            "logical_component_has_multiple_target_weeks",
            {reason["code"] for reason in result["unresolvedReasons"]},
        )

    def test_bst_midnight_uses_the_uk_calendar_date(self):
        result = self.calculate(
            plan([component("C1", "W1", 2)]),
            as_of=datetime(2026, 6, 1, 23, 30, tzinfo=timezone.utc),
            dates={"W1": date(2026, 6, 2)},
        )
        self.assertEqual(result["asOfDate"], "2026-06-02")
        self.assertEqual(result["targetComponents"], 1)

    def test_naive_snapshot_timestamp_is_refused(self):
        with self.assertRaisesMessage(ValueError, "timezone-aware"):
            self.calculate(plan([]), as_of=datetime(2026, 9, 1, 10, 0))

    def test_partial_first_week_and_zero_based_order_follow_curriculum_semantics(self):
        result = derive_week_starts(
            {"M1": date(2026, 9, 3)},
            {"M1": ["W1", "W2", "W3"]},
        )
        self.assertEqual(result.starts, {
            "W1": date(2026, 9, 3),
            "W2": date(2026, 9, 7),
            "W3": date(2026, 9, 14),
        })


class ReviewTargetInputTests(SimpleTestCase):
    def test_projection_uses_learner_window_and_never_reads_completed_hours(self):
        profile = SimpleNamespace(
            id=42,
            programme_id="P1",
            programme_status="Active",
            learner_start_date="2026-01-01",
            learner_end_date="2026-12-31",
            start_date=date(2025, 9, 1),
            end_date=date(2027, 8, 31),
        )
        with patch("curriculum_api.review_otjh.planned_hours", side_effect=[12, 4]) as planned, \
             patch(
                 "curriculum_api.review_otjh.completed_hours",
                 side_effect=AssertionError("Review target projection must not read completed hours"),
             ) as completed:
            result = review_progress_inputs.review_planned_target_hours(
                profile,
                as_of=datetime(2026, 4, 15, 23, 0, tzinfo=timezone.utc),
            )
        self.assertEqual(result, (12, 4))
        self.assertEqual(planned.call_count, 2)
        self.assertEqual(planned.call_args_list[0].args[-2:], (date(2026, 1, 1), date(2026, 12, 31)))
        self.assertEqual(planned.call_args_list[1].args[-2:], (date(2026, 1, 1), date(2026, 4, 16)))
        completed.assert_not_called()

    def test_missing_projection_window_contributes_no_review_hours(self):
        profile = SimpleNamespace(id=42, programme_id="P1", programme_status="Active")
        with patch("curriculum_api.review_otjh.planned_hours") as planned:
            self.assertEqual(
                review_progress_inputs.review_planned_target_hours(
                    profile, as_of=datetime(2026, 4, 15, tzinfo=timezone.utc),
                ),
                (0.0, 0.0),
            )
        planned.assert_not_called()


class ReviewConsumerTests(SimpleTestCase):
    def test_resolved_assigned_plan_is_used_consistently(self):
        source = object()
        detail = {"modules": [], "week": [], "components": []}
        resolved_plan = [{"moduleId": "assigned-module"}]
        with patch.object(learner_detail, "to_learner_detail", return_value=detail), \
             patch.object(learner_detail, "effective_training_plan", return_value=resolved_plan), \
             patch.object(
                 learner_detail, "_resolve_from_master", return_value=([], [], []),
             ) as resolve, \
             patch.object(learner_detail, "_apply_programme_assignment_template", return_value=[]), \
             patch.object(learner_detail, "_annotate_otjh", return_value=([], 0)), \
             patch.object(learner_detail, "_append_week_quizzes", return_value=([], [])) as append:
            learner_detail.build_otjh_detail(source)
        self.assertEqual(resolve.call_args.kwargs["assigned_modules"], resolved_plan)
        self.assertEqual(append.call_args.kwargs["assigned_modules"], resolved_plan)

    def test_review_records_current_formula_and_stored_actual_source(self):
        detail = plan([component("C1", "W1", 5)], weeks=("W1",))
        resolved = {
            "status": TARGET_STATUS_RESOLVED,
            "asOf": "2026-09-19T09:00:00Z",
            "asOfDate": "2026-09-19",
            "timeZone": "Europe/London",
            "targetComponents": 1,
            "targetOtjHours": 5.0,
            "totalComponents": 1,
            "totalPlannedOtjHours": 5.0,
            "completedComponents": 0,
            "qualifyingWeeks": 1,
            "totalWeeks": 1,
            "unresolvedReasons": [],
            "currentWeek": {"moduleId": "M1", "weekId": "W1", "weekStart": "2026-09-01"},
        }
        profile = SimpleNamespace(training_plan_progress=[], completed_hours=0)
        calculated_at = datetime(2026, 9, 19, 10, 0, tzinfo=ZoneInfo("Europe/London"))
        with patch.object(review_progress_snapshot, "build_otjh_detail", return_value=detail), \
             patch.object(review_progress_snapshot, "review_planned_target_hours", return_value=(0, 0)), \
             patch.object(
                 review_progress_snapshot, "calculate_training_plan_targets", return_value=resolved,
             ) as calculator:
            snapshot = review_progress_snapshot.build_progress_snapshot(
                object(), profile,
                learner_start_date=date(2025, 1, 1),
                calculated_at=calculated_at,
            )
        self.assertEqual(calculator.call_args.kwargs["as_of"], calculated_at.astimezone(timezone.utc))
        self.assertEqual(snapshot["schemaVersion"], 4)
        self.assertEqual(snapshot["formulaVersion"], "stored_completed_hours_and_component_ksb_v4")
        self.assertEqual(snapshot["actualHoursSource"], "learner.completed_hours")
        self.assertEqual(snapshot["calculatedAt"], "2026-09-19T09:00:00Z")

    def test_unversioned_historical_snapshot_is_legacy_without_mutation(self):
        stored = {"calculationMethod": "planned_hours", "programmeProgress": {"actual": 2}}
        interpreted = review_instance_progress_snapshot({"progress_snapshot": stored})
        self.assertEqual(interpreted["schemaVersion"], 1)
        self.assertEqual(interpreted["formulaVersion"], "legacy_unversioned")
        self.assertNotIn("schemaVersion", stored)
