"""Achievement parity and bounded work; all data sources are synthetic."""
from contextlib import ExitStack, nullcontext
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import views
from .ksb_achievement import achievement_definitions
from .ksb_coverage import build_coverage, normalise_required_definition


class AchievementDefinitionTests(SimpleTestCase):
    def test_definitions_match_full_coverage_with_and_without_an_applied_set(self):
        required = [
            {'code': 'K1', 'sourceType': 'standard', 'sourceId': 'STD', 'description': 'Knowledge'},
            {'code': 'S1', 'sourceType': 'standard', 'sourceId': 'STD', 'description': 'Skill'},
            {'code': 'K1', 'sourceType': 'framework', 'sourceId': 'OLD'},
        ]
        mappings = [
            {'module_catalogue_id': 'M1', 'ksb_code': 'k1', 'source_type': 'standard', 'source_id': 'STD', 'ksb_description': 'Legacy text'},
            {'module_catalogue_id': 'M1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'STD', 'ksb_description': 'Later duplicate'},
            {'module_catalogue_id': 'M2', 'ksb_code': 'B1', 'source_type': 'standard', 'source_id': 'STD'},
            {'module_catalogue_id': '', 'ksb_code': 'K9', 'source_id': 'STD'},
        ]
        for definitions in (required, [], [{'code': ''}]):
            with self.subTest(required=definitions):
                actual = achievement_definitions(definitions, mappings)
                full = build_coverage(definitions, mappings, [], [], [], include_mapping_only=not bool(definitions))
                fields = normalise_required_definition({}).keys()
                self.assertEqual(actual, [{key: row[key] for key in fields} for row in full['items']])


class AchievementReadTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.modules = [{'module_catalogue_id': 'M1'}]
        self.components = [{'id': 'C1', 'module_catalogue_id': 'M1'}]
        self.required = [
            {'code': 'K1', 'source_type': 'standard', 'source_id': 'STD', 'description': 'Knowledge'},
            {'code': 'S1', 'source_type': 'standard', 'source_id': 'STD', 'description': 'Skill'},
            {'code': 'K1', 'source_type': 'framework', 'source_id': 'OLD'},
        ]
        self.learners = [{'id': 7, 'sourceId': 7, 'sourceKind': 'learner', 'name': 'Synthetic learner', 'cohortId': 'H1', 'groupId': 'G1'}]
        base = {'learnerId': 7, 'componentId': 'C1', 'moduleRef': 'M1', 'weekRef': 'W1',
                'componentTitle': 'Activity', 'componentType': 'quiz', 'code': 'K1',
                'countsTowardAchievement': True, 'scopeStatus': 'in_scope', 'weight': 20,
                'submittedAt': '2026-01-02T10:00:00Z'}
        self.progress = [base, {**base, 'code': 'S1', 'countsTowardAchievement': False},
                         {**base, 'code': 'S1', 'scopeStatus': 'out_of_scope'}]
        stack = self.enterContext(ExitStack())
        for name, value in {
            'curriculum_read_scope': nullcontext(),
            'scope_placement_lineage': {'found': True},
            'authoring_scope_data': (self.modules, [], self.components, []),
            'required_ksbs_for_request': self.required,
            'assigned_learners_for_scope': self.learners,
            'learner_progress_ksb_consumption': ({}, self.progress, []),
            'programme_row_ksb_source': ('standard', 'STD'),
            'source_display_metadata': {'sourceLabel': 'Synthetic standard'},
        }.items():
            mock = stack.enter_context(patch.object(views, name, return_value=value))
            setattr(self, name, mock)
        stack.enter_context(patch.object(views, 'mappings_with_inferred_sources', side_effect=lambda rows, modules: rows))
        for name in ('scope_learner_ksb_impact_payload', 'build_coverage', 'reflection_submission_ksb_consumption',
                     'progress_evidence_index', 'learner_activity_plan', 'scope_otjh_summary'):
            stack.enter_context(patch.object(views, name, side_effect=AssertionError(f'Unneeded work: {name}')))

    def test_achievement_preserves_legacy_projection_filters_and_pagination(self):
        full_coverage = build_coverage(self.required, [], self.modules, [], self.components, include_mapping_only=False)
        legacy = {'coverage': full_coverage, 'assignedLearners': self.learners, 'consumptionSources': {'progress': self.progress}}
        for query in ('', '?cohort_id=H1&group_id=G1&module_id=M1&learner_id=7&component_id=C1',
                      '?group_id=OTHER', '?ksb_type=skill', '?search=Knowledge',
                      '?date_from=2026-01-03', '?date_to=2026-01-01', '?ksb_id=standard:STD:K1',
                      '?ksb_page=2&ksb_page_size=1&page_size=1'):
            request = self.factory.get('/achievement/' + query)
            with self.subTest(query=query):
                actual, error = views._achievement_projection(request, 'P1')
                with patch.object(views, 'programme_achievement_inputs', return_value=(legacy, None)):
                    expected, _ = views._achievement_projection(request, 'P1')
                self.assertIsNone(error)
                self.assertEqual(actual, expected)
        self.learner_progress_ksb_consumption.assert_called_with(
            [7], ['K1', 'K1', 'S1'], ['C1'], True,
            restrict_to_components=False, scope='programme', scope_identifier='P1',
        )

    def test_zero_consumption_still_returns_applied_definitions_without_activity_plans(self):
        self.learner_progress_ksb_consumption.return_value = ({}, [], [])
        result, error = views._achievement_projection(self.factory.get('/achievement/'), 'P1')
        self.assertIsNone(error)
        self.assertEqual(result['summary'], {'appliedKsbCount': 2, 'consumedKsbCount': 0, 'learnerCount': 0, 'consumptionCount': 0})
        self.assertEqual([item['code'] for item in result['items']], ['K1', 'S1'])

    def test_missing_programme_keeps_404_and_does_not_read_progress(self):
        self.scope_placement_lineage.return_value = {'found': False}
        self.authoring_scope_data.return_value = ([], [], [], [])
        payload, error = views.programme_achievement_inputs(self.factory.get('/achievement/'), 'MISSING')
        self.assertIsNone(payload)
        self.assertEqual(error.status_code, 404)
        self.learner_progress_ksb_consumption.assert_not_called()

    def test_learner_status_and_profile_ids_use_the_same_canonical_reader(self):
        self.assigned_learners_for_scope.return_value = [{'id': 'external', 'sourceKind': 'learner', 'sourceId': 12}, {'id': 'invalid'}]
        views.programme_achievement_inputs(self.factory.get('/achievement/?learnerStatus=active'), 'P1')
        self.assigned_learners_for_scope.assert_called_once_with('programme', 'P1', 'active', lineage={'found': True})
        self.assertEqual(self.learner_progress_ksb_consumption.call_args.args[0], [12])

    def test_detail_endpoint_uses_the_same_filtered_projection(self):
        import json
        response = views.curriculum_programme_ksb_achievement_consumptions(
            self.factory.get('/achievement/consumptions/?page_size=1'), 'P1', 'standard:STD:K1',
        )
        body = json.loads(response.content)
        self.assertEqual(body['total'], 1)
        self.assertEqual(body['ksb']['code'], 'K1')
        self.assertEqual(body['items'][0]['learner']['id'], 7)
