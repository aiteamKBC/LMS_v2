"""Frozen-source parity and ownership checks. Run only in isolated Django harness."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export, bind_test_defaults
from .catalogue.application import scope_identity
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views
from .catalogue.tests.parity.cache_ownership_oracle import relocated_source
from .catalogue.application import scope_queries, structure_resolution
from .catalogue.infrastructure import resolution_candidates, scope_reads

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/module_workspace_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_workspace():
    """Execute actual frozen bodies in the existing composition globals, never copies of expectations."""
    with ExitStack() as stack:
        for name, code in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(relocated_source(code), '<pre-workspace-boundary>', 'exec'), namespace)
            source = namespace[name]
            fn = FunctionType(source.__code__, vars(views), name, source.__defaults__)
            fn.__kwdefaults__ = source.__kwdefaults__
            for decorator in reversed(SNAPSHOT['decorators'][name]):
                fn = eval(decorator, vars(views))(fn)
            stack.enter_context(composition_fixture(views, name, fn))
        yield


class WorkspaceParity(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(composition_fixture(views, 'ensure_module_authoring_tables', return_value=None))
        self.enterContext(composition_fixture(views, 'refresh_curriculum_generations', return_value=None))
        self.enterContext(composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()))

    def compare(self, name, *args, **kwargs):
        with original_workspace():
            expected = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT['owners'][name])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as invoked:
            actual = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        invoked.assert_called_once()
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.headers)),
                             (expected.status_code, expected.content, dict(expected.headers)))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_completion_advanced_and_mapping_projections(self):
        for row in (None, {}, {'quizzes_completed_required': True, 'average_score_required': 0,
                              'additional_notes': 'notes'}, {'average_score_required': 'bad'}):
            self.compare('completion_response', row)
        for row in (None, {}, {'background': 'context', 'epa_requirements': '["EPA"]',
                              'professional_qualification_outcomes': ['Outcome'], 'intent': 'Intent'}):
            self.compare('advanced_response', row)
        for row in ({}, {'id': 0, 'ksb_code': 'K1', 'classification': 'main', 'weight': 20},
                    {'id': 'A', 'ksb_id': 'K', 'weight_class': 'possible', 'weight': -1}):
            self.compare('mapping_response', row)
        self.compare('default_completion_payload')

    def test_quality_keeps_empty_and_complete_truth_tables(self):
        for payload in ({}, {'weekStructure': []}, {'weekStructure': [{'title': 'Week', 'components': [
            {'type': 'reading', 'expectedOtjh': 1, 'ksbMappings': [{'type': 'main', 'weight': 1}]}
        ]}], 'completionCriteria': {'additionalNotes': 'Pass'}}):
            self.compare('module_authoring_quality_check', payload)

    def test_settings_schema_and_unknown_values_round_trip(self):
        for kind in (*views.COMPONENT_SETTINGS_SCHEMA, 'unknown'):
            self.compare('component_settings_defaults', kind)
            self.compare('allowed_component_setting_keys', kind)
            for settings in (None, [], {}, {'contentStatus': 'Draft', 'version': '1.0'},
                             {'legacySettings': '{"old": 3}', 'old': 0, 'ignored': None},
                             {'assignmentContent': 'Brief', 'uploadedFileUrl': '/resource',
                              'readingSource': 'File', 'podcastSource': 'Audio File'}):
                self.compare('normalise_component_settings_payload', kind, settings)

    def test_ksb_projection_preserves_items_summary_and_empty_sources(self):
        profiles = [{'id': 'KSBP-SYNTHETIC', 'name': 'Level 4', 'is_active': True,
            'knowledge_codes': ['1'], 'skill_codes': [], 'behaviour_codes': [],
            'ksb_items': [None, {'code': 'K1', 'type': 'knowledge', 'title': 'Know'},
                          {'code': '2', 'type': 'S', 'parentCode': '1'}, {'code': ''}]}]
        for summary in (False, True):
            self.compare('build_ksb_data', [], [], [], summary_only=summary)
            self.compare('build_ksb_data', profiles, [{'name': 'Module', 'ksbCodes': ['K1']}], [], summary_only=summary)

    def test_scope_identity_exact_name_alias_missing_and_duplicates(self):
        programme = {'id': 'PROG-ONE', 'name': 'Shared name'}
        for module in ({}, {'programmeId': 'PROG-ONE'}, {'programmeId': 'PROG-OTHER', 'programme': 'Shared name'},
                       {'programmeId': 'Shared name'}, {'programme': 'Shared name'}):
            self.compare('module_matches_programme', programme, module)
            self.compare('module_matches_visible_programmes', module, [programme])
            self.compare('module_matches_visible_programmes', module, [])
        for ident in ('PROG-ONE', ' program-PROG-ONE ', 'Shared name', '', None):
            self.compare('programme_identifier_looks_exact', ident)
        rows = [{'module_catalogue_id': key, 'programme_id': 'P', 'title': 'Duplicate', 'quality_score': quality}
                for key, quality in [('A', 1), ('B', 20), ('C', 20)]]
        self.compare('authoring_row_delivery_signature', rows[0])
        for mappings in ([], [{'module_catalogue_id': 'A'}]):
            self.compare('dedupe_authoring_module_rows', rows, mappings, [], [])

    def test_training_identity_and_signatures_keep_exact_identifier_precedence(self):
        self.enterContext(composition_fixture(views, 'programme_identity', return_value={'sourceId': 'PROG-ONE', 'name': 'Shared'}))
        self.enterContext(composition_fixture(views, 'actual_cohort_identity', return_value={'id': 'C', 'name': 'Cohort'}))
        self.enterContext(composition_fixture(views, 'actual_group_identity', return_value={'id': 'G', 'name': 'Group'}))
        self.enterContext(bind_test_defaults(scope_identity, programme_identity=views.programme_identity,
                                            actual_cohort_identity=views.actual_cohort_identity,
                                            actual_group_identity=views.actual_group_identity))
        for ident in ('PROG-ONE', 'PROG-OTHER', 'Shared', ''):
            self.compare('training_row_matches_programme_identifier', {}, ident, {})
        self.compare('training_row_delivery_signature', {}, {})
        self.compare('training_row_delivery_signature', {'module_name': 'Module'}, {})

    def fixture_scopes(self):
        modules = [dict(module_catalogue_id='MOD-A', programme_id='PROG-ONE', programme_name='Programme',
                        cohort_id='C', cohort_name='Cohort', group_id='G', group_name='Group', title='A'),
                   dict(module_catalogue_id='MOD-B', programme_id='PROG-TWO', programme_name='Other',
                        cohort_id='C2', cohort_name='Other cohort', group_id='G2', group_name='Group', title='B')]
        for name, value in [('module_index_rows', modules), ('get_program_config_rows', []),
                            ('get_training_rows', []), ('resolve_group_row', {'group_id': 'G', 'group_name': 'Group', 'cohort_id': 'C'})]:
            self.enterContext(composition_fixture(views, name, return_value=value))
        self.enterContext(composition_fixture(views, 'prefetch_authoring_reads', return_value=None))
        self.enterContext(composition_fixture(views, 'resolve_authoring_catalogue_id', side_effect=lambda x: 'MOD-A' if x == 'alias' else x))
        return modules

    def test_scope_selection_all_module_programme_cohort_group_and_missing(self):
        self.fixture_scopes()
        for scope, ident in [('', ''), ('module', 'alias'), ('module', 'missing'), ('programme', 'PROG-ONE'),
                             ('programme', 'Programme'), ('cohort', 'C'), ('group', 'G'), ('group', 'Group')]:
            self.compare('authoring_scope_module_rows', scope, ident)

    def test_stale_programme_name_cannot_override_a_different_canonical_owner(self):
        modules = self.fixture_scopes()
        modules[1]['programme_name'] = 'Programme'
        self.enterContext(composition_fixture(views, 'get_training_rows', return_value=[{'id': 'T', 'module_catalogue_id': 'MOD-A'}]))
        self.enterContext(composition_fixture(views, 'training_row_matches_programme_identifier', return_value=True))
        self.enterContext(composition_fixture(views, 'programme_identity', return_value={'sourceId': 'PROG-ONE', 'name': 'Programme'}))
        with original_workspace():
            old = views.authoring_scope_module_rows('programme', 'PROG-ONE')
        new = views.authoring_scope_module_rows('programme', 'PROG-ONE')
        self.assertEqual({r['module_catalogue_id'] for r in old}, {'MOD-A', 'MOD-B'})
        self.assertEqual([r['module_catalogue_id'] for r in new], ['MOD-A'])
        # The canonical source survives even when the stale name was renamed.
        modules[0]['programme_name'] = 'Old label'
        self.assertEqual([r['module_catalogue_id'] for r in views.authoring_scope_module_rows('programme', 'PROG-ONE')], ['MOD-A'])

    def test_scope_child_reads_projection_order_and_targeted_memo_modes(self):
        rows = [{'module_catalogue_id': 'B', 'id': '2'}, {'module_catalogue_id': 'A', 'id': '1'}]
        read = self.enterContext(composition_fixture(views, 'authoring_fetch_all', return_value=rows))
        for targeted in (False, True):
            with views.curriculum_read_scope(targeted_child_reads=targeted):
                self.compare('authoring_child_rows_for_modules', views.AUTHORING_COMPONENTS_TABLE, ['B', 'A', 'A'], columns=('id',))
        read.reset_mock()
        self.assertEqual(self.compare('authoring_child_rows_for_modules', 'unused', []), [])
        read.assert_not_called()

    def test_scope_data_week_component_deduplication_and_empty(self):
        modules = self.fixture_scopes()
        weeks = [{'id': 'W', 'module_catalogue_id': 'MOD-A', 'status': 'active'}]
        components = [{'id': 'C', 'week_id': 'W', 'module_catalogue_id': 'MOD-A', 'type': 'reading', 'status': 'active'}]
        mappings = [{'id': 'K', 'component_id': 'C', 'week_id': 'W', 'module_catalogue_id': 'MOD-A', 'ksb_code': 'K1'}]
        children = {views.AUTHORING_WEEKS_TABLE: weeks, views.AUTHORING_COMPONENTS_TABLE: components, views.AUTHORING_KSB_MAPPINGS_TABLE: mappings}
        self.enterContext(composition_fixture(views, 'authoring_child_rows_for_modules', side_effect=lambda table, *a, **kw: deepcopy(children[table])))
        self.enterContext(composition_fixture(views, 'week_scope_module_ids', return_value={'MOD-A'}))
        for scope, ident in [('module', 'MOD-A'), ('module', 'missing'), ('week', 'W'), ('component', 'C'),
                             ('programme', 'PROG-ONE'), ('group', 'G'), ('cohort', 'C')]:
            self.compare('authoring_scope_data', scope, ident)
        with self.assertRaisesRegex(ValueError, 'programme scope'):
            views.authoring_scope_data('module', 'MOD-A', stats_only=True)

    def resolver(self, modules, structures):
        self.enterContext(composition_fixture(views, 'authoring_fetch_all', return_value=modules))
        self.enterContext(composition_fixture(views, 'get_authoring_structure_payloads', return_value=structures))
        self.enterContext(composition_fixture(views, 'structure_payloads_cache_key', return_value='synthetic'))

    def test_resolver_http_invalid_inputs_and_empty_no_reads(self):
        reader = self.enterContext(composition_fixture(views, 'authoring_fetch_all', side_effect=AssertionError('No reads')))
        for request in (self.factory.get('/resolve/'), self.factory.post('/resolve/', 'invalid', content_type='application/json'),
                        self.factory.post('/resolve/', {'modules': 3}, content_type='application/json'),
                        self.factory.post('/resolve/', {'modules': []}, content_type='application/json')):
            self.compare('curriculum_module_structure_resolve', request)
        reader.assert_not_called()

    def test_resolver_exact_alias_title_ambiguity_missing_and_placeholder_counts(self):
        modules = [{'module_catalogue_id': key, 'source_id': alias, 'title': title, 'status': 'active'}
                   for key, alias, title in [('MOD-A', 'old-a', 'Shared'), ('MOD-B', '', 'Shared'), ('MOD-C', '', 'Unique')]]
        structures = {key: {'catalogueId': key, 'weekStructure': [{'components': comps}]} for key, comps in [
            ('MOD-A', [{'description': 'real'}, {'description': 'Placeholder lesson derived from the existing delivery module.'}]),
            ('MOD-B', [{}, {}, {}]), ('MOD-C', [])]}
        self.resolver(modules, structures)
        request = self.factory.post('/resolve/', {'modules': ['MOD-A', 'old-a', 'Shared', 'Unique', 'missing',
            {'requestId': 'multi', 'identifiers': ['MOD-A', 'Shared']}, 'MOD-NONE']}, content_type='application/json')
        response = self.compare('curriculum_module_structure_resolve', request)
        results = json.loads(response.content)['results']
        self.assertEqual([r.get('catalogueId') for r in results[:2]], ['MOD-A', 'MOD-A'])
        self.assertEqual(results[0]['componentCount'], 1)
        self.assertTrue(results[2]['ambiguous'])
        self.assertFalse(results[3]['hasComponents'])
        self.assertTrue(results[-1]['missing'])

    def test_resolver_sql_predicate_order_and_params_match_frozen_source(self):
        self.resolver([], {})
        request = self.factory.post('/resolve/', {'identifiers': [' MOD-A ', 'Some  Title', 'MOD-A']}, content_type='application/json')
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')):
            with original_workspace():
                old = views.curriculum_module_structure_resolve(request)
                calls = views.authoring_fetch_all.call_args_list[:]
            views.authoring_fetch_all.reset_mock()
            with patch.object(resolution_candidates, 'read_resolution_candidates', wraps=resolution_candidates.read_resolution_candidates) as reader:
                actual = views.curriculum_module_structure_resolve(request)
            reader.assert_called_once()
            self.assertEqual(views.authoring_fetch_all.call_args_list, calls)
            self.assertEqual(actual.content, old.content)

    def test_library_http_filters_paging_and_errors(self):
        read = self.enterContext(composition_fixture(views, 'library_component_rows', return_value=[{'id': 'SYNTHETIC'}]))
        for query in ('', '?page=0&pageSize=1&types=reading&programmeIds=P', '?ids=A,B&detail=1'):
            self.compare('curriculum_component_library', self.factory.get('/library/'+query))
        read.side_effect = ValueError('synthetic private failure')
        response = self.compare('curriculum_component_library', self.factory.get('/library/'))
        self.assertNotIn(b'private', response.content)
        self.compare('curriculum_component_library', self.factory.post('/library/'))

    def test_module_collection_compact_full_forced_filters_and_visibility(self):
        payload = {'schema': 'curriculum', 'modules': [
            {'id': 'MOD-A', 'name': 'A', 'programmeId': 'P', 'cohortId': 'C', 'groupId': 'G', 'status': 'active'},
            {'id': 'MOD-B', 'name': 'B', 'programmeId': 'OTHER', 'status': 'inactive'}]}
        self.enterContext(composition_fixture(views, 'get_cached_curriculum_rows', return_value={}))
        for name in ('build_curriculum_payload', 'build_curriculum_payload_from_rows'):
            self.enterContext(composition_fixture(views, name, return_value=payload))
        self.enterContext(composition_fixture(views, 'enrich_modules_with_authoring', side_effect=lambda rows, **kw: rows))
        for query in ('', '?compact=1', '?force=1', '?visibility=all', '?programme=P&cohort=C&group=G&status=active'):
            self.compare('curriculum_modules', self.factory.get('/modules/'+query))
