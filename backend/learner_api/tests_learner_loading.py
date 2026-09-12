"""Database-free regressions for compact learner reads."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json

from django.test import SimpleTestCase, RequestFactory

from . import learner_detail as detail
from .tests import ScriptedConnection, ScriptedCursor


class CompactLearnerLoadingTests(SimpleTestCase):
    def test_dashboard_identity_reads_dates_without_loading_plan_or_progress(self):
        source = SimpleNamespace(id=125, username='Learner', email='learner@example.test', phone_number='',
                                 programme='Programme', programme_status='Active', cohort='', group='', employer='',
                                 employer_id=None, learner_type='apprenticeship', aptem_id=None, start_date='2026-09-01',
                                 end_date=None, practical_period_end_date='2027-09-01', apprenticeship_end_date=None)
        model = MagicMock()
        model.all_learners.only.return_value.get.return_value = source
        with patch.object(detail, 'SOURCE_MODELS', {'apprenticeship': model}), \
                patch.object(detail, 'access_gate', return_value={'blocked': False}), \
                patch.object(detail, 'build_learner_detail') as graph:
            response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'apprenticeship', 125)
        payload = json.loads(response.content)
        self.assertEqual(payload['programmeStartDate'], '2026-09-01')
        self.assertEqual(payload['programmeEndDate'], '2027-09-01')
        self.assertNotIn('components', payload)
        self.assertNotIn('learning_plan', model.all_learners.only.call_args.args)
        graph.assert_not_called()

    def build(self, compact, refreshed_ksbs):
        component = {"module": "Module", "week": None, "component": "Reading",
                     "expectedOtjh": None, "contentHtml": None, "hasReadingContent": True,
                     "reflectionRequired": False, "ksbMappingCount": 0}
        profile = SimpleNamespace(ksbs=[])
        with ExitStack() as stack:
            for name in ("advance_learner", "hydrate_source_training_plan", "_apply_cohort_schedule",
                         "persist_live_otjh_snapshot", "_apply_live_otjh_snapshot"):
                stack.enter_context(patch.object(detail, name))
            resolve = stack.enter_context(patch.object(detail, "_active_profile_for_source", return_value=profile))
            stack.enter_context(patch("learner_api.active_users.refresh_learner_ksb_snapshot", return_value=refreshed_ksbs))
            stack.enter_context(patch.object(detail, "to_learner_detail", return_value={
                "modules": ["Module"], "week": [], "components": [component], "quizAttempts": [{"grade": 1}]}))
            stack.enter_context(patch.object(detail, "get_training_plan", return_value=[]))
            stack.enter_context(patch.object(detail, "access_gate", return_value={"blocked": False}))
            stack.enter_context(patch.object(detail, "_resolve_from_master", side_effect=lambda m, w, c, **kw: (m, w, c)))
            stack.enter_context(patch.object(detail, "_annotate_otjh", return_value=([component], 0)))
            stack.enter_context(patch.object(detail, "_append_week_quizzes", side_effect=lambda w, c, **kw: (w, c)))
            stack.enter_context(patch.object(detail, "_live_otjh_snapshot", return_value={}))
            result = detail.build_learner_detail(SimpleNamespace(programme=""), 125, compact=compact)
        return result, resolve.call_count

    def test_compact_payload_preserves_required_nulls_false_zero_and_progress(self):
        result, calls = self.build(True, [])
        component = result["components"][0]
        self.assertNotIn("contentHtml", component)
        self.assertIsNone(component["expectedOtjh"])
        self.assertIsNone(component["week"])
        self.assertIs(component["reflectionRequired"], False)
        self.assertEqual(component["ksbMappingCount"], 0)
        self.assertEqual(result["quizAttempts"], [{"grade": 1}])
        self.assertEqual(calls, 1)

    def test_refresh_still_reloads_a_changed_ksb_assignment(self):
        _, calls = self.build(True, [{"code": "K1"}])
        self.assertEqual(calls, 2)

    def test_existing_full_response_keeps_nullable_fields(self):
        result, _ = self.build(False, [])
        self.assertIn("contentHtml", result["components"][0])

    def test_selected_reading_stays_scoped_to_assigned_modules_and_parameterized(self):
        cursor = ScriptedCursor([[("C1", "<p>Selected reading</p>")]])
        selected = "C1' OR true --"
        with patch.object(detail, "connections", {"enrolment": ScriptedConnection(cursor)}), \
                patch.object(detail, "get_training_plan", return_value=[{"moduleId": "M1"}]), \
                patch.object(cursor, "execute", wraps=cursor.execute) as execute:
            result = detail._reading_content(SimpleNamespace(), selected)
        sql, params = execute.call_args.args
        self.assertNotIn(selected, sql)
        self.assertIn("c.module_catalogue_id=ANY(%s)", sql)
        for table in ("c", "m", "w"):
            self.assertIn(f"{table}.deleted_at IS NULL OR {table}.deleted_via_parent IS NOT NULL", sql)
        self.assertEqual(params, [selected, ["M1"]])
        self.assertEqual(result, {"componentId": "C1", "contentHtml": "<p>Selected reading</p>"})

    def test_unassigned_reading_is_not_returned(self):
        cursor = ScriptedCursor([[]])
        with patch.object(detail, "connections", {"enrolment": ScriptedConnection(cursor)}), \
                patch.object(detail, "get_training_plan", return_value=[{"moduleId": "M1"}]):
            self.assertIsNone(detail._reading_content(SimpleNamespace(), "C2"))

    def test_empty_assignment_needs_no_content_query(self):
        with patch.object(detail, "get_training_plan", return_value=[]):
            self.assertIsNone(detail._reading_content(SimpleNamespace(), "C1"))
