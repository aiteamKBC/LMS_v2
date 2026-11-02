"""Official planned hours are never written by learner page loads.

Database and network are prohibited: the learner profile is an in-memory
recorder, and every read around the hours snapshot is mocked. This proves the
snapshot persistence path never stores planned_hours; it does not prove the
whole GET stack is write-free.
"""
import json
from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import learner_detail as reader


class RecordingProfile:
    """A learner profile that keeps its values and records every save."""

    def __init__(self, planned_hours, **values):
        self.id = 1
        self.ksbs = ["K1"]
        self.start_date = None
        self.training_plan_progress = []
        self.planned_hours = planned_hours
        self.completed_hours = values.get("completed_hours", Decimal("0"))
        self.target_hours = values.get("target_hours", Decimal("0"))
        self.progress_hours = values.get("progress_hours", Decimal("0"))
        self.progress_variance = values.get("progress_variance")
        self.otjh_status = values.get("otjh_status", "")
        self.saves = []

    def save(self, update_fields=None):
        self.saves.append(list(update_fields or []))

    @property
    def saved_fields(self):
        return {field for fields in self.saves for field in fields}


def snapshot(planned, **overrides):
    """The snapshot shape _live_otjh_snapshot returns, with a derived planned total."""
    values = {
        "planned_hours": planned, "completed_hours": "12", "target_hours": "20",
        "progress_hours": "-8", "progress_variance": -0.4, "otjh_status": "At risk",
    }
    values.update(overrides)
    return {
        **values,
        "plannedHours": values["planned_hours"], "completedHours": values["completed_hours"],
        "targetHours": values["target_hours"], "progressHours": values["progress_hours"],
        "progressVariance": str(values["progress_variance"]), "otjhStatus": values["otjh_status"],
        "currentModule": None, "currentWeek": None, "componentsTargetToDate": 0,
    }


class PersistSnapshotKeepsOfficialPlannedHoursTests(SimpleTestCase):
    def test_official_value_survives_a_different_derived_total(self):
        profile = RecordingProfile(Decimal("288"))
        reader.persist_live_otjh_snapshot(profile, snapshot("300"))
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)

    def test_null_stays_null_and_is_never_saved_as_zero(self):
        profile = RecordingProfile(None)
        reader.persist_live_otjh_snapshot(profile, snapshot("0"))
        self.assertIsNone(profile.planned_hours)
        self.assertNotIn("planned_hours", profile.saved_fields)

    def test_a_real_zero_stays_zero_and_is_not_replaced(self):
        profile = RecordingProfile(Decimal("0"))
        reader.persist_live_otjh_snapshot(profile, snapshot("150"))
        self.assertEqual(profile.planned_hours, Decimal("0"))
        self.assertNotIn("planned_hours", profile.saved_fields)

    def test_the_other_snapshot_columns_are_still_persisted_unchanged(self):
        profile = RecordingProfile(Decimal("288"))
        changed = reader.persist_live_otjh_snapshot(profile, snapshot("300"))
        self.assertEqual(changed, ["completed_hours", "target_hours", "progress_hours",
                                   "progress_variance", "otjh_status"])
        self.assertEqual(profile.saves, [changed])
        self.assertEqual((profile.completed_hours, profile.target_hours, profile.otjh_status),
                         ("12", "20", "At risk"))

    def test_a_matching_snapshot_saves_nothing(self):
        profile = RecordingProfile(Decimal("288"), completed_hours="12", target_hours="20",
                                   progress_hours="-8", progress_variance=-0.4, otjh_status="At risk")
        self.assertEqual(reader.persist_live_otjh_snapshot(profile, snapshot("300")), [])
        self.assertEqual(profile.saves, [])

    def test_no_profile_writes_nothing(self):
        self.assertEqual(reader.persist_live_otjh_snapshot(None, snapshot("300")), [])


def live_snapshot_inputs(stack, *, review_planned):
    """Mock the inputs of the real _live_otjh_snapshot, keeping its arithmetic."""
    for name, value in (
        ("_review_otjh_hours", (review_planned, 0)),
        ("completed_hours_from_progress", "12"),
        ("_cumulative_week_target", 20.0),
        ("_week_target_rows", []),
        ("week_by_elapsed_time", None),
        ("_week_component_count_rows", []),
        ("target_by_elapsed_time", 0),
    ):
        stack.enter_context(patch.object(reader, name, return_value=value))


class DerivedTotalsDoNotReachTheOfficialFieldTests(SimpleTestCase):
    def test_component_and_review_totals_stay_in_the_response_only(self):
        profile = RecordingProfile(Decimal("288"))
        with ExitStack() as stack:
            live_snapshot_inputs(stack, review_planned=40.0)
            live = reader._live_otjh_snapshot({"totalExpectedOtjh": 200}, profile)
            reader.persist_live_otjh_snapshot(profile, live)
        derived = reader.fmt_hours(240.0)
        self.assertEqual((live["planned_hours"], live["plannedHours"]), (derived, derived))
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)

    def test_coach_live_refresh_keeps_official_value_and_its_snapshot_keys(self):
        profile = RecordingProfile(Decimal("288"))
        detail = {"totalExpectedOtjh": 200, "components": [{"componentId": "C1"}]}
        with ExitStack() as stack:
            live_snapshot_inputs(stack, review_planned=40.0)
            result = reader.refresh_learner_otjh_snapshot(profile, detail=detail)
        self.assertEqual(result["plannedHours"], reader.fmt_hours(240.0))
        self.assertEqual(result["componentsPlanned"], 1)
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)


class SummaryPageLoadTests(SimpleTestCase):
    """GET learner-detail/<kind>/<pk>/?content=summary, through to the profile save."""

    def load_summary(self, profile, *, times=1):
        source = object()
        model = type("Model", (), {"all_learners": type("M", (), {"get": staticmethod(lambda **kw: source)}),
                                   "DoesNotExist": LookupError})
        components = [{"componentId": "C1", "module": "Module", "week": "Week 1",
                       "component": "Reading", "expectedOtjh": 200}]
        responses = []
        with ExitStack() as stack:
            def mock(name, **kwargs):
                return stack.enter_context(patch.object(reader, name, **kwargs))

            # Other GET-side writers are a separate approved slice; mocked here.
            others = [mock(name) for name in ("advance_learner", "hydrate_source_training_plan")]
            mock("effective_training_plan", return_value=[])
            mock("_active_profile_for_source", return_value=profile)
            mock("to_learner_detail", side_effect=lambda *args: {
                "id": "7", "modules": ["Module"], "week": [], "components": [], "componentProgress": []})
            mock("access_gate", return_value={})
            mock("learning_access", return_value={})
            mock("_apply_cohort_schedule")
            mock("_resolve_from_master", return_value=(["Module"], [], components))
            mock("_apply_programme_assignment_template", side_effect=lambda rows, programme: rows)
            mock("_annotate_otjh", side_effect=lambda rows: (rows, 200))
            mock("_append_week_quizzes", side_effect=lambda weeks, rows, **kwargs: (weeks, rows))
            mock("retain_quiz_progress")
            live_snapshot_inputs(stack, review_planned=40.0)
            build = stack.enter_context(patch.object(reader, "build_learner_detail",
                                                     wraps=reader.build_learner_detail))
            stack.enter_context(patch("learner_api.teams_attendance.annotate_attendance_completion",
                                      side_effect=lambda rows, profile: rows))
            stack.enter_context(patch("learner_api.replacement_learning.annotate_replacement_learning",
                                      side_effect=lambda rows, pk: rows))
            stack.enter_context(patch("learner_api.live_session_progress.read_live_credits", return_value=[]))
            stack.enter_context(patch("learner_api.live_session_progress.supplement_component_progress",
                                      side_effect=lambda rows, credits: rows))
            stack.enter_context(patch.dict(reader.SOURCE_MODELS, {"commercial": model}))
            request = RequestFactory().get("/learner_api/learner-detail/commercial/7/", {"content": "summary"})
            for _ in range(times):
                responses.append(reader.learner_detail.__wrapped__(request, "commercial", 7))
        for other in others:
            self.assertEqual(other.call_count, times)
        # The summary path still persists the other snapshot columns.
        self.assertEqual(build.call_args.kwargs, {"compact": True})
        return responses

    def test_summary_keeps_288_and_returns_the_existing_planned_field(self):
        profile = RecordingProfile(Decimal("288"))
        [response] = self.load_summary(profile)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload["plannedHours"], reader.fmt_hours(240.0))
        for key in ("completedHours", "targetHours", "progressHours", "progressVariance", "otjhStatus",
                    "currentModule", "currentWeek", "componentsTargetToDate", "totalExpectedOtjh"):
            self.assertIn(key, payload)
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)
        self.assertIn("completed_hours", profile.saved_fields)

    def test_null_and_zero_survive_a_summary_load(self):
        for official in (None, Decimal("0")):
            with self.subTest(official=official):
                profile = RecordingProfile(official)
                self.load_summary(profile)
                self.assertEqual(profile.planned_hours, official)
                self.assertNotIn("planned_hours", profile.saved_fields)

    def test_repeated_page_loads_never_write_planned_hours(self):
        profile = RecordingProfile(Decimal("288"))
        responses = self.load_summary(profile, times=3)
        self.assertEqual([r.status_code for r in responses], [200, 200, 200])
        self.assertEqual(profile.planned_hours, Decimal("288"))
        self.assertNotIn("planned_hours", profile.saved_fields)
        # The first load stores the other columns; identical reloads store nothing.
        self.assertEqual(len(profile.saves), 1)
