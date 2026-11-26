"""Finished legacy teaching changes targets, never learner achievement/history."""
from copy import deepcopy
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import review_progress_snapshot as snapshots
from . import training_plan_targets as targets
from .legacy_completed_delivery import (
    APPROVED_MODULE_IDS,
    POLICY_EFFECTIVE_FROM,
    POLICY_VERSION,
    approved_completed_delivery,
)


LEGACY = sorted(APPROVED_MODULE_IDS)[0]
NOW = datetime(2026, 11, 4, 10, tzinfo=timezone.utc)


def component(identifier="C1", *, module_id=LEGACY, week_id="W1", hours=10, **extra):
    return {
        "moduleId": module_id, "weekId": week_id,
        "componentId": identifier, "expectedOtjh": hours, **extra,
    }


def plan(*components):
    return {
        "week": list({(item["moduleId"], item["weekId"]): {
            "moduleId": item["moduleId"], "weekId": item["weekId"],
        } for item in components}.values()),
        "components": list(components),
    }


class CompletedDeliveryPolicyTests(SimpleTestCase):
    def approved(self, **overrides):
        values = dict(source_type="mba-legacy", module_start=None, as_of=POLICY_EFFECTIVE_FROM)
        values.update(overrides)
        return approved_completed_delivery(LEGACY, **values)

    def test_exact_audited_62_modules_are_approved(self):
        self.assertEqual(len(APPROVED_MODULE_IDS), 62)
        for identifier in APPROVED_MODULE_IDS:
            self.assertTrue(approved_completed_delivery(
                identifier, source_type="mba-legacy", module_start=None,
                as_of=POLICY_EFFECTIVE_FROM,
            ))

    def test_source_label_alone_does_not_approve_other_imported_modules(self):
        self.assertFalse(approved_completed_delivery(
            "not-reviewed", source_type="mba-legacy", module_start=None,
            as_of=POLICY_EFFECTIVE_FROM,
        ))

    def test_approved_id_with_a_different_source_is_not_approved(self):
        for source in (None, "", "native", "aptem"):
            with self.subTest(source=source):
                self.assertFalse(self.approved(source_type=source))

    def test_existing_start_date_takes_priority_even_if_future(self):
        self.assertFalse(self.approved(module_start=date(2027, 1, 1)))

    def test_calculation_before_policy_approval_is_not_reinterpreted(self):
        self.assertFalse(self.approved(as_of=date(2026, 11, 3)))

    def test_unspecified_cutoff_cannot_apply_the_policy(self):
        self.assertFalse(self.approved(as_of=None))


class CompletedDeliveryResolverTests(SimpleTestCase):
    def resolve(self, detail=None, *, module_rows=None, weeks=None, as_of=NOW):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            module_rows if module_rows is not None else [(LEGACY, None, "mba-legacy")],
            weeks if weeks is not None else [("W1", LEGACY), ("W2", LEGACY)],
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(targets, "connections", {"default": connection}):
            result = targets.resolve_training_plan_week_starts(
                detail if detail is not None else plan(component()), as_of=as_of,
            )
        return result, cursor

    def test_verified_curriculum_weeks_are_wholly_due_without_fake_dates(self):
        result, _ = self.resolve()
        self.assertEqual(result.completed_weeks, frozenset({(LEGACY, "W1"), (LEGACY, "W2")}))
        self.assertEqual(result.starts, {})
        self.assertEqual(result.reasons, [])

    def test_only_requested_module_ids_are_read_with_bound_parameters(self):
        _, cursor = self.resolve()
        for call in cursor.execute.call_args_list:
            self.assertEqual(call.args[1], [LEGACY])
            self.assertNotIn(LEGACY, call.args[0])

    def test_plan_cannot_self_approve_a_new_imported_module(self):
        detail = plan(component(module_id="unapproved"))
        detail["legacyCompletedDelivery"] = {"moduleIds": ["unapproved"]}
        result, _ = self.resolve(
            detail, module_rows=[("unapproved", None, "mba-legacy")],
            weeks=[("W1", "unapproved")],
        )
        self.assertFalse(result.completed_weeks)
        self.assertIn("module_has_no_start_date", {r["code"] for r in result.reasons})

    def test_same_name_or_source_cannot_replace_an_approved_identity(self):
        result, _ = self.resolve(module_rows=[(LEGACY, None, "native")])
        self.assertFalse(result.completed_weeks)
        self.assertTrue(result.reasons)

    def test_dated_module_keeps_curriculum_partial_first_week_rule(self):
        result, _ = self.resolve(module_rows=[(LEGACY, date(2026, 11, 5), "mba-legacy")])
        self.assertFalse(result.completed_weeks)
        self.assertEqual(result.starts, {"W1": date(2026, 11, 5), "W2": date(2026, 11, 9)})

    def test_unknown_week_in_approved_module_is_still_rejected(self):
        result, _ = self.resolve(plan(component(week_id="missing")))
        self.assertIn("week_not_found_in_authoritative_module_schedule", {r["code"] for r in result.reasons})

    def test_week_belonging_to_another_module_is_not_approved(self):
        result, _ = self.resolve(weeks=[("W1", "OTHER")])
        self.assertNotIn((LEGACY, "W1"), result.completed_weeks)
        self.assertTrue(result.reasons)

    def test_missing_module_row_does_not_gain_approval_from_plan_id(self):
        result, _ = self.resolve(module_rows=[])
        self.assertFalse(result.completed_weeks)
        self.assertTrue(result.reasons)

    def test_missing_plan_identity_remains_an_error(self):
        result, _ = self.resolve(plan(component(week_id="")))
        self.assertIn("week_has_no_authoritative_curriculum_identity", {r["code"] for r in result.reasons})

    def test_approval_does_not_apply_to_an_earlier_calculation(self):
        result, _ = self.resolve(as_of=date(2026, 11, 3))
        self.assertFalse(result.completed_weeks)
        self.assertTrue(result.reasons)

    def test_no_cutoff_keeps_the_existing_read_contract(self):
        result, _ = self.resolve(as_of=None)
        self.assertFalse(result.completed_weeks)

    def test_lookup_error_is_not_hidden_by_approval(self):
        connection = MagicMock()
        connection.cursor.side_effect = DatabaseError("synthetic unavailable database")
        with patch.object(targets, "connections", {"default": connection}):
            result = targets.resolve_training_plan_week_starts(plan(component()), as_of=NOW)
        self.assertFalse(result.completed_weeks)
        self.assertEqual(result.reasons[0]["code"], "authoritative_week_schedule_lookup_failed")


class CompletedDeliveryCalculationTests(SimpleTestCase):
    def calculate(self, detail=None, *, progress=None, starts=None, completed=None, reasons=None, as_of=NOW, **kwargs):
        detail = detail if detail is not None else plan(component(), component("C2", week_id="W2", hours=20))
        resolution = targets.WeekScheduleResolution(
            starts or {}, reasons or [],
            frozenset(completed if completed is not None else {(LEGACY, "W1"), (LEGACY, "W2")}),
        )
        return targets.calculate_training_plan_targets(
            detail, progress=progress or [], as_of=as_of,
            week_schedule=resolution, **kwargs,
        )

    def test_all_finished_content_is_due_and_total_is_unchanged(self):
        result = self.calculate()
        self.assertEqual(result["status"], "resolved")
        self.assertEqual(result["targetComponents"], result["totalComponents"])
        self.assertEqual(result["targetOtjHours"], result["totalPlannedOtjHours"])
        self.assertEqual(result["targetOtjHours"], 30)

    def test_finishing_teaching_does_not_award_learner_completion(self):
        self.assertEqual(self.calculate()["completedComponents"], 0)

    def test_earned_completion_still_uses_saved_learner_progress(self):
        result = self.calculate(progress=[{"kind": "component", "componentId": "C1"}])
        self.assertEqual(result["completedComponents"], 1)

    def test_failed_activity_stays_unachieved(self):
        result = self.calculate(progress=[{"kind": "component", "componentId": "C1", "passed": False}])
        self.assertEqual(result["completedComponents"], 0)

    def test_quiz_stays_zero_otj_and_deduplicated(self):
        quiz = dict(isQuiz=True, quizMeta={"quizId": 12})
        result = self.calculate(plan(component("A", hours=99, **quiz), component("B", hours=99, **quiz)))
        self.assertEqual(result["totalComponents"], 1)
        self.assertEqual(result["targetOtjHours"], 0)

    def test_conflicting_quiz_placements_are_still_rejected(self):
        quiz = dict(isQuiz=True, quizMeta={"quizId": 12})
        result = self.calculate(plan(component("A", **quiz), component("B", week_id="W2", **quiz)))
        self.assertEqual(result["status"], "unresolved")
        self.assertIn("logical_component_has_multiple_target_weeks", {r["code"] for r in result["unresolvedReasons"]})

    def test_mixed_plan_keeps_future_native_content_out_of_target(self):
        detail = plan(component(), component("N", module_id="NATIVE", week_id="NW", hours=7))
        result = self.calculate(detail, starts={"NW": date(2026, 12, 1)})
        self.assertEqual(result["targetComponents"], 1)
        self.assertEqual(result["targetOtjHours"], 10)
        self.assertEqual(result["totalPlannedOtjHours"], 17)

    def test_mixed_plan_keeps_due_native_content_in_target(self):
        detail = plan(component(), component("N", module_id="NATIVE", week_id="NW", hours=7))
        result = self.calculate(detail, starts={"NW": date(2026, 10, 1)})
        self.assertEqual(result["targetOtjHours"], 17)
        self.assertEqual(result["currentWeek"]["moduleId"], "NATIVE")

    def test_completed_delivery_does_not_fabricate_current_week(self):
        self.assertIsNone(self.calculate()["currentWeek"])

    def test_valid_schedule_date_wins_over_a_completed_week_hint(self):
        result = self.calculate(plan(component()), starts={"W1": date(2026, 12, 1)})
        self.assertEqual(result["targetComponents"], 0)
        self.assertNotIn("legacyCompletedDelivery", result)

    def test_unapproved_missing_week_still_blocks_all_targets(self):
        result = self.calculate(completed={(LEGACY, "W1")})
        self.assertEqual(result["status"], "unresolved")
        self.assertIsNone(result["targetComponents"])

    def test_week_approval_is_scoped_to_its_module(self):
        result = self.calculate(completed={("OTHER", "W1"), ("OTHER", "W2")})
        self.assertEqual(result["status"], "unresolved")

    def test_missing_component_identity_is_not_bypassed(self):
        self.assertEqual(self.calculate(plan(component(None)))["status"], "unresolved")

    def test_missing_component_week_is_not_bypassed(self):
        self.assertEqual(self.calculate(plan(component(week_id="")))["status"], "unresolved")

    def test_other_resolution_errors_are_not_suppressed(self):
        result = self.calculate(reasons=[{"code": "authoritative_week_schedule_lookup_failed"}])
        self.assertEqual(result["status"], "unresolved")

    def test_review_hours_are_added_separately_once(self):
        result = self.calculate(planned_review_otj_hours=12, target_review_otj_hours=3)
        self.assertEqual(result["totalPlannedOtjHours"], 42)
        self.assertEqual(result["targetOtjHours"], 33)

    def test_policy_provenance_is_saved_without_fake_week_dates(self):
        result = self.calculate()
        self.assertEqual(result["legacyCompletedDelivery"], {
            "policyVersion": POLICY_VERSION,
            "effectiveFrom": POLICY_EFFECTIVE_FROM.isoformat(),
            "moduleIds": [LEGACY], "weekCount": 2,
        })

    def test_ordinary_plan_payload_does_not_gain_policy_metadata(self):
        result = self.calculate(plan(component()), starts={"W1": date(2026, 10, 1)}, completed=set())
        self.assertNotIn("legacyCompletedDelivery", result)

    def test_retries_do_not_mutate_the_plan_or_progress(self):
        detail = plan(component())
        progress = [{"kind": "component", "componentId": "C1"}]
        before = deepcopy((detail, progress))
        self.assertEqual(self.calculate(detail, progress=progress), self.calculate(detail, progress=progress))
        self.assertEqual((detail, progress), before)

    def test_runtime_passes_snapshot_cutoff_to_the_resolver(self):
        resolved = targets.WeekScheduleResolution({}, [], frozenset({(LEGACY, "W1")}))
        detail = plan(component())
        with patch.object(targets, "resolve_training_plan_week_starts", return_value=resolved) as resolve:
            targets.calculate_training_plan_targets(detail, progress=[], as_of=NOW)
        resolve.assert_called_once_with(detail, as_of=NOW)


class CompletedDeliverySnapshotTests(SimpleTestCase):
    def snapshot(self, *, profile=None, learner_kind="apprenticeship", actual=37.5):
        detail = plan(component())
        source = SimpleNamespace(learner_type=learner_kind)
        profile = profile or SimpleNamespace(training_plan_progress=[], completed_hours=37.5, ksbs=[])
        resolved = targets.WeekScheduleResolution({}, [], frozenset({(LEGACY, "W1")}))
        live = {'owner': {'id': 101}, 'otjh': {'actual': actual, 'planned': 10},
                'ksb': {'status': 'empty', 'completed': 0, 'total': 0},
                'nativeComponents': detail['components'],
                'historicalComponents': 0, 'retainedComponents': 0,
                'mainActivities': {'nativeComponents': detail['components'],
                                   'historicalComponents': 0, 'retainedComponents': 0},
                'modules': [{'id': 'current:' + LEGACY, 'completed': 0, 'total': 1}]}
        with patch.object(snapshots, "read_live_inputs", return_value=live), \
             patch.object(snapshots, "coach_otjh_target_to_date", return_value=10), \
             patch.object(targets, "resolve_training_plan_week_starts", return_value=resolved):
            return snapshots.build_progress_snapshot(
                source, profile, learner_start_date=date(2025, 1, 1),
                calculated_at=NOW,
            )

    def test_legacy_calculation_records_a_distinct_formula_version(self):
        result = self.snapshot()
        self.assertEqual(result["formulaVersion"], snapshots.TARGET_FORMULA_VERSION)
        self.assertIn('legacyCompletedDelivery', result['targetCalculation'])
        self.assertEqual(result["schemaVersion"], 5)

    def test_actual_hours_and_component_completion_are_not_awarded(self):
        result = self.snapshot()
        self.assertEqual(result["offTheJobHours"]["actual"], 37.5)
        self.assertEqual(result["programmeProgress"]["actual"], 0)
        self.assertEqual(result["programmeProgress"]["expected"], 1)

    def test_both_learner_types_use_the_same_approved_target_rule(self):
        self.assertEqual(self.snapshot(learner_kind="commercial"), self.snapshot())

    def test_missing_actual_hours_still_blocks_calculation(self):
        profile = SimpleNamespace(training_plan_progress=[], completed_hours=None, ksbs=[])
        with self.assertRaises(snapshots.UnavailableCompletedHours):
            self.snapshot(profile=profile, actual=None)

    def test_later_hours_update_is_used_on_next_calculate(self):
        profile = SimpleNamespace(training_plan_progress=[], completed_hours=None, ksbs=[])
        with self.assertRaises(snapshots.UnavailableCompletedHours):
            self.snapshot(profile=profile, actual=None)
        result = self.snapshot(profile=profile, actual=42.75)
        self.assertEqual(result["offTheJobHours"]["actual"], 42.75)
        self.assertEqual(result["programmeProgress"]["actual"], 0)

    def test_zero_actual_hours_is_valid(self):
        profile = SimpleNamespace(training_plan_progress=[], completed_hours=0, ksbs=[])
        self.assertEqual(self.snapshot(profile=profile, actual=0)["offTheJobHours"]["actual"], 0)
