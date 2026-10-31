"""Database-free regressions for compact learner reads."""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import json

from django.test import SimpleTestCase, RequestFactory

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

from . import learner_detail as detail
from .tests import ScriptedConnection, ScriptedCursor


class CompactLearnerLoadingTests(SimpleTestCase):
    def test_dashboard_identity_reads_dates_without_loading_plan_or_progress(self):
        source = SimpleNamespace(id=125, username='Learner', email='learner@example.test', phone_number='',
                                 programme='Programme', programme_status='Active', cohort='', group='', employer='',
                                 employer_id=None, organization='Example Organization', learner_type='apprenticeship', aptem_id=None, start_date='2026-09-01',
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
        self.assertEqual(payload['organization'], 'Example Organization')
        self.assertNotIn('components', payload)
        self.assertNotIn('learning_plan', model.all_learners.only.call_args.args)
        self.assertNotIn('programme', model.all_learners.only.call_args.args)
        graph.assert_not_called()

    def build(self, compact, refreshed_ksbs, *, read_only=False, quiz_view=False, summary_view=False):
        component = {"module": "Module", "week": None, "component": "Reading",
                     "expectedOtjh": None, "contentHtml": None, "hasReadingContent": True,
                     "reflectionRequired": False, "ksbMappingCount": 0}
        class Profile:
            ksbs = []

            def __init__(self):
                self.progress_reads = 0
                self._progress = [{"kind": "component", "componentId": "C1"}]

            @property
            def training_plan_progress(self):
                self.progress_reads += 1
                return self._progress

        profile = Profile()
        with ExitStack() as stack:
            work = {}
            for name in ("advance_learner", "hydrate_source_training_plan", "_apply_cohort_schedule",
                         "persist_live_otjh_snapshot", "_apply_live_otjh_snapshot"):
                work[name] = stack.enter_context(patch.object(detail, name))
            resolve = stack.enter_context(patch.object(detail, "_active_profile_for_source", return_value=profile))
            refresh_ksbs = stack.enter_context(patch(
                "learner_api.active_users.refresh_learner_ksb_snapshot", return_value=refreshed_ksbs,
            ))
            mapper = stack.enter_context(patch.object(detail, "to_learner_detail", return_value={
                "modules": ["Module"], "week": [], "components": [component], "quizAttempts": [{"grade": 1}]}))
            effective_plan = [{"moduleId": "GROUP-NEW"}]
            stack.enter_context(patch.object(detail, "effective_training_plan", return_value=effective_plan))
            stack.enter_context(patch.object(detail, "access_gate", return_value={"blocked": False}))
            def resolve_master(modules, weeks, components, **options):
                if options.get('resolved_expected_otjh') is not None:
                    options['resolved_expected_otjh'].update({
                        row['componentId']: row.get('expectedOtjh')
                        for row in components if row.get('componentId')
                    })
                return modules, weeks, components

            master = stack.enter_context(patch.object(
                detail, "_resolve_from_master", side_effect=resolve_master,
            ))
            annotate = stack.enter_context(patch.object(
                detail, "_annotate_otjh", return_value=([component], 0),
            ))
            quizzes = stack.enter_context(patch.object(
                detail, "_append_week_quizzes", side_effect=lambda w, c, **kw: (w, c),
            ))
            totals = stack.enter_context(patch.object(detail, "_live_otjh_snapshot", return_value={}))
            stack.enter_context(patch(
                "learner_api.teams_attendance.annotate_attendance_completion",
                side_effect=lambda components, profile: components,
            ))
            stack.enter_context(patch(
                "learner_api.replacement_learning.annotate_replacement_learning",
                side_effect=lambda components, learner_id: components,
            ))
            stack.enter_context(patch(
                "learner_api.live_session_progress.read_live_credits", return_value=[],
            ))
            stack.enter_context(patch(
                "learner_api.live_session_progress.supplement_component_progress",
                side_effect=lambda progress, credits: progress,
            ))
            result = detail.build_learner_detail(
                SimpleNamespace(programme="", attendance_type="Recorded"), 125,
                compact=compact, read_only=read_only or quiz_view,
                quiz_view=quiz_view, summary_view=summary_view,
            )
            if read_only or quiz_view:
                self.assertEqual(resolve.call_args.kwargs, {'heal': False})
                for name in ('advance_learner', 'hydrate_source_training_plan', 'persist_live_otjh_snapshot'):
                    work[name].assert_not_called()
                refresh_ksbs.assert_not_called()
            if summary_view:
                self.assertTrue(master.call_args.kwargs['expected_otjh'])
                self.assertEqual(
                    annotate.call_args.kwargs['resolved_expected_otjh'],
                    master.call_args.kwargs['resolved_expected_otjh'],
                )
                self.assertEqual(profile.progress_reads, 1)
                self.assertIs(
                    mapper.call_args.kwargs['progress'],
                    totals.call_args.kwargs['progress'],
                )
            if quiz_view:
                totals.assert_not_called()
            self.resolved_plan = master.call_args.kwargs["assigned_modules"]
            self.quiz_plan = quizzes.call_args.kwargs["assigned_modules"]
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
        self.assertEqual(result["attendanceType"], "Recorded")
        self.assertEqual(calls, 1)

    def test_refresh_still_reloads_a_changed_ksb_assignment(self):
        _, calls = self.build(True, [{"code": "K1"}])
        self.assertEqual(calls, 2)

    def test_read_only_summary_skips_healing_and_all_write_helpers(self):
        _, calls = self.build(
            True, [{"code": "K1"}], read_only=True, summary_view=True,
        )
        self.assertEqual(calls, 1)

    def test_existing_full_response_keeps_nullable_fields(self):
        result, _ = self.build(False, [])
        self.assertIn("contentHtml", result["components"][0])

    def test_effective_plan_drives_live_components_and_quizzes(self):
        self.build(True, [])
        self.assertEqual(self.resolved_plan, [{"moduleId": "GROUP-NEW"}])
        self.assertEqual(self.quiz_plan, self.resolved_plan)

    def test_selected_reading_stays_scoped_to_assigned_modules_and_parameterized(self):
        cursor = ScriptedCursor([[("C1", "<p>Selected reading</p>")]])
        selected = "C1' OR true --"
        with patch.object(detail, "connections", {"enrolment": ScriptedConnection(cursor)}), \
                patch.object(detail, "effective_training_plan", return_value=[{"moduleId": "M1"}]), \
                patch.object(cursor, "execute", wraps=cursor.execute) as execute:
            result = detail._reading_content(SimpleNamespace(), selected)
        sql, params = execute.call_args.args
        self.assertNotIn(selected, sql)
        self.assertIn("c.module_catalogue_id=ANY(%s)", sql)
        self.assertIn("m.deleted_at IS NULL OR COALESCE(m.deleted_via_parent, '') <> ''", sql)
        # A deleted week or component shows only as an archived module's own history.
        self.assertIn(visible_child_sql("c"), sql)
        self.assertIn(visible_week_sql("w"), sql)
        self.assertEqual(params, [selected, ["M1"]])
        self.assertEqual(result, {"componentId": "C1", "contentHtml": "<p>Selected reading</p>"})

    def test_unassigned_reading_is_not_returned(self):
        cursor = ScriptedCursor([[]])
        with patch.object(detail, "connections", {"enrolment": ScriptedConnection(cursor)}), \
                patch.object(detail, "effective_training_plan", return_value=[{"moduleId": "M1"}]):
            self.assertIsNone(detail._reading_content(SimpleNamespace(), "C2"))

    def test_empty_assignment_needs_no_content_query(self):
        with patch.object(detail, "effective_training_plan", return_value=[]):
            self.assertIsNone(detail._reading_content(SimpleNamespace(), "C1"))

    def test_quiz_read_preserves_requirements_and_results_without_dashboard_work(self):
        result, _ = self.build(True, [], quiz_view=True)
        self.assertIs(result['components'][0]['reflectionRequired'], False)
        self.assertEqual(result['quizAttempts'], [{'grade': 1}])
        self.assertEqual(self.resolved_plan, self.quiz_plan)

    def test_quiz_projection_is_scoped_to_the_requested_learner(self):
        source = SimpleNamespace()
        model = MagicMock()
        model.all_learners.defer.return_value.get.return_value = source
        with patch.object(detail, 'SOURCE_MODELS', {'commercial': model}), patch.object(
            detail, 'build_learner_detail', return_value={'components': []}
        ) as build:
            response = detail.learner_detail.__wrapped__(
                RequestFactory().get('/?content=quiz'), 'commercial', 101,
            )
        self.assertEqual(response.status_code, 200)
        model.all_learners.defer.assert_called_once_with('status', 'programme')
        model.all_learners.defer.return_value.get.assert_called_once_with(pk=101)
        build.assert_called_once_with(source, 101, compact=True, read_only=True, quiz_view=True)

    def test_targeted_quiz_projection_passes_the_quiz_identity(self):
        source = SimpleNamespace(
            _weekly_training_plan=[{'moduleId': 'M1', 'assignmentMode': 'explicit'}],
            _weekly_learning_plan=None,
        )
        query = MagicMock()
        query.get.return_value = source
        model = MagicMock()
        model.all_learners.defer.return_value = query
        with patch.object(detail, 'SOURCE_MODELS', {'commercial': model}), \
             patch('coach_api.weekly_learning.assignment_projection', side_effect=lambda value: value), \
             patch.object(detail, 'build_learner_detail', return_value={'components': []}) as build:
            response = detail.learner_detail.__wrapped__(
                RequestFactory().get('/?content=quiz&quiz_id=77'), 'commercial', 101,
            )
        self.assertEqual(response.status_code, 200)
        model.all_learners.defer.assert_called_once_with(
            'status', 'programme', 'training_plan', 'learning_plan',
        )
        query.get.assert_called_once_with(pk=101)
        build.assert_called_once_with(
            source, 101, compact=True, read_only=True, quiz_view=True, quiz_id=77,
        )

    def test_targeted_quiz_projection_rejects_an_invalid_identity_before_database_read(self):
        model = MagicMock()
        with patch.object(detail, 'SOURCE_MODELS', {'commercial': model}):
            response = detail.learner_detail.__wrapped__(
                RequestFactory().get('/?content=quiz&quiz_id=not-a-number'), 'commercial', 101,
            )
        self.assertEqual(response.status_code, 400)
        model.all_learners.get.assert_not_called()

    def test_summary_projection_is_scoped_and_explicitly_read_only(self):
        source = SimpleNamespace()
        model = MagicMock()
        model.all_learners.defer.return_value.get.return_value = source
        with patch.object(detail, 'SOURCE_MODELS', {'apprenticeship': model}), patch.object(
            detail, 'build_learner_detail', return_value={'components': []}
        ) as build:
            response = detail.learner_detail.__wrapped__(
                RequestFactory().get('/?content=summary'), 'apprenticeship', 202,
            )
        self.assertEqual(response.status_code, 200)
        model.all_learners.defer.assert_called_once_with('status', 'programme')
        model.all_learners.defer.return_value.get.assert_called_once_with(pk=202)
        build.assert_called_once_with(
            source, 202, compact=True, read_only=True, summary_view=True,
        )
