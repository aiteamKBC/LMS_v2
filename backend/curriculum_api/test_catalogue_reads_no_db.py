"""Read-contract and payload-size regressions; no database or live services."""
import gzip
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import ApiSessionGateMiddleware
from . import views


def profile(identifier='KSBP-ONE', active=True):
    return {
        'id': identifier, 'name': 'Synthetic standard', 'is_active': active,
        'programme_ids': ['PROG-ONE', 'PROG-TWO'], 'standard_source_id': 'standard-1',
        'ksb_items': [
            {'code': 'K1', 'type': 'Knowledge', 'description': 'Explain the method'},
            {'code': 'S1.1', 'parentCode': 'S1', 'type': 'Skill', 'description': 'Apply the method'},
            {'code': 'B1', 'type': 'Behaviour', 'description': 'Act professionally'},
            {'code': 'invalid', 'type': 'K'}, None,
        ],
    }


class ProgrammeStatsReadTests(SimpleTestCase):
    def test_stats_preserve_values_without_unrelated_programme_learner_counts(self):
        programme = {'id': 'P1', 'sourceId': 'P1', **{
            field: index + 1 for index, field in enumerate(views.PROGRAMME_KSB_STAT_FIELDS)
        }}
        with patch.object(views, 'get_training_rows', return_value=[]), \
                patch.object(views, 'get_program_config_rows', return_value=[]), \
                patch.object(views, 'get_ksb_profile_rows', return_value=[]), \
                patch.object(views, 'get_cached_curriculum_rows', side_effect=AssertionError('unused catalogue')), \
                patch.object(views, 'build_programmes', return_value=[programme]) as build:
            result = views.build_programme_ksb_stats('P1', 'all')
        self.assertEqual(result, {'programmeId': 'P1', **{
            field: programme[field] for field in views.PROGRAMME_KSB_STAT_FIELDS
        }})
        self.assertEqual(build.call_count, 2)
        self.assertTrue(all(not call.kwargs['include_learner_counts'] for call in build.call_args_list))
        self.assertTrue(all(not call.kwargs['include_structure_counts'] for call in build.call_args_list))
        self.assertEqual(build.call_args.kwargs['only_stats_for_ids'], {'P1'})


class KsbSourceReadTests(SimpleTestCase):
    def test_summary_matches_definition_counts_and_keeps_links_without_details(self):
        source = profile()
        full = views.build_ksb_data([source], [], [])[1][0]
        summary = views.build_ksb_data([source], [], [], summary_only=True)[1][0]
        self.assertEqual(summary['ksbCount'], len(full['ksbs']))
        self.assertEqual([summary[k] for k in ('knowledgeCount', 'skillCount', 'behaviourCount')], [1, 1, 1])
        self.assertNotIn('ksbs', summary)
        for key, value in full.items():
            if key != 'ksbs':
                self.assertEqual(summary[key], value)

    def test_legacy_code_lists_without_definitions_still_display_empty(self):
        source = {**profile(), 'ksb_items': [], 'knowledge_codes': ['K1']}
        result = views.build_ksb_data([source], [], [], summary_only=True)[1][0]
        self.assertEqual(result['ksbCount'], 0)
        self.assertEqual(result['knowledgeCount'], 0)

    def test_summary_bypasses_overview_and_preserves_visibility(self):
        with patch.object(views, 'get_ksb_profile_rows', return_value=[profile(), profile('KSBP-OLD', False)]), \
             patch.object(views, 'get_cached_payload', side_effect=AssertionError('overview not needed')), \
             patch.object(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kwargs: factory()) as cached:
            active = views.curriculum_ksb_sets(RequestFactory().get('/ksb-sets/?view=summary'))
            all_sources = views.curriculum_ksb_sets(RequestFactory().get('/ksb-sets/?view=summary&visibility=all', HTTP_CACHE_CONTROL='no-cache'))
        self.assertEqual(json.loads(active.content)['count'], 1)
        self.assertEqual(json.loads(all_sources.content)['count'], 2)
        self.assertEqual(cached.call_args.args[0], 'ksb-source-summaries:all')
        self.assertTrue(cached.call_args.kwargs['force'])

    def test_old_collection_contract_is_unchanged(self):
        payload = {'schema': 'curriculum', 'ksbSets': [{'ksbs': [{'activities': [1]}]}]}
        with patch.object(views, 'get_cached_payload', return_value=payload) as fetch:
            response = views.curriculum_ksb_sets(RequestFactory().get('/ksb-sets/?visibility=all'))
        self.assertEqual(json.loads(response.content)['results'], payload['ksbSets'])
        self.assertTrue(fetch.call_args.kwargs['compact'])

    def test_definitions_read_only_selected_profile_and_keep_hierarchy(self):
        with patch.object(views, 'fetch_all', return_value=[profile()]) as fetch, \
             patch.object(views, 'get_cached_payload', side_effect=AssertionError('no overview')), \
             patch.object(views, 'get_ksb_profile_rows', side_effect=AssertionError('no whole library')):
            response = views.curriculum_ksb_set_definitions(RequestFactory().get('/definitions/?visibility=all'), 'KSBP-ONE')
        self.assertEqual(fetch.call_args.args[1], ['KSBP-ONE', 'KSBP-ONE'])
        entries = json.loads(response.content)['ksbs']
        self.assertEqual(entries[1]['parentCode'], 'S1')
        self.assertEqual(entries[1]['code'], 'S1.1')
        self.assertEqual(entries[0]['description'], 'Explain the method')
        self.assertNotIn('activities', entries[0])
        self.assertNotIn('status', entries[0])

    def test_archived_definitions_need_all_visibility_and_missing_is_404(self):
        with patch.object(views, 'fetch_all', return_value=[profile(active=False)]):
            self.assertEqual(views.curriculum_ksb_set_definitions(RequestFactory().get('/definitions/'), 'KSBP-ONE').status_code, 404)
            self.assertEqual(views.curriculum_ksb_set_definitions(RequestFactory().get('/definitions/?visibility=all'), 'KSBP-ONE').status_code, 200)
        with patch.object(views, 'fetch_all', return_value=[]), patch.object(views, 'get_ksb_profile_rows', return_value=[]):
            self.assertEqual(views.curriculum_ksb_set_definitions(RequestFactory().get('/definitions/'), 'missing').status_code, 404)

    def test_library_summary_size_does_not_grow_with_definition_text(self):
        source = profile()
        source['ksb_items'] = [{'code': f'K{i}', 'type': 'K', 'description': 'Long definition ' * 200} for i in range(1000)]
        full = json.dumps(views.build_ksb_data([source], [], [])[1]).encode()
        summary = json.dumps(views.build_ksb_data([source], [], [], summary_only=True)[1]).encode()
        self.assertLess(len(summary), 1000)
        self.assertLess(len(summary), len(full) / 100)

    def test_summary_cache_follows_write_epoch(self):
        cache.clear()
        self.addCleanup(cache.clear)
        request = RequestFactory().get('/ksb-sets/?view=summary')
        with patch.dict(views._CURRICULUM_CACHE, {}, clear=True), \
             patch.object(views, 'shared_curriculum_epoch', return_value=800) as epoch, \
             patch.object(views, 'get_ksb_profile_rows', side_effect=[[profile()], []]) as read:
            first = views.curriculum_ksb_sets(request)
            self.assertEqual(first.content, views.curriculum_ksb_sets(request).content)
            epoch.return_value = 801
            self.assertEqual(json.loads(views.curriculum_ksb_sets(request).content)['count'], 0)
            self.assertEqual(read.call_count, 2)


class ModuleCatalogueReadTests(SimpleTestCase):
    def authoring_rows(self):
        return {
            views.AUTHORING_MODULES_TABLE: [
                {'module_catalogue_id': 'MOD-ONE', 'title': 'One', 'programme_id': 'PROG-ONE', 'programme_name': 'Programme', 'group_id': 'G1', 'weeks_number': 3, 'sessions_number': 2, 'description': 'Keep notes', 'session_week_day': 'Monday', 'status': 'draft'},
                {'module_catalogue_id': 'MOD-TWO', 'title': 'Two', 'programme_name': 'Programme', 'status': 'published'},
            ],
            views.AUTHORING_WEEKS_TABLE: [{'id': 'W1', 'module_catalogue_id': 'MOD-ONE', 'week_number': 1}, {'id': 'W2', 'module_catalogue_id': 'MOD-ONE', 'week_number': 2}],
            views.AUTHORING_COMPONENTS_TABLE: [
                {'id': 'C1', 'module_catalogue_id': 'MOD-ONE', 'week_id': 'W1', 'type': 'live_session', 'title': 'Shared title', 'expected_otjh': .125, 'description': 'Large body ' * 1000},
                {'id': 'C2', 'module_catalogue_id': 'MOD-ONE', 'week_id': 'W2', 'type': 'live_session', 'title': 'Shared title', 'expected_otjh': .125},
                {'id': 'C3', 'module_catalogue_id': 'MOD-ONE', 'week_id': 'W2', 'type': 'quiz', 'expected_otjh': .5},
                {'id': 'C4', 'module_catalogue_id': 'MOD-ONE', 'week_id': 'W2', 'type': 'quiz', 'expected_otjh': 10, 'deleted_at': '2026-01-01'},
                {'id': 'C5', 'module_catalogue_id': 'MOD-TWO', 'type': 'workplace_evidence', 'expected_otjh': 10},
            ],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'K1'},
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'K1'},
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'S1', 'is_deleted': True},
            ],
            views.GROUPS_TABLE: [{'group_id': 'G1', 'coach_name': 'Coach'}],
        }

    def test_narrow_read_produces_identical_list_and_never_reads_component_bodies(self):
        tables = self.authoring_rows()
        columns_read = []

        def fetch(table, *args, **kwargs):
            columns = kwargs.get('columns')
            columns_read.append((table, columns))
            return [{key: value for key, value in row.items() if not columns or key in columns} for row in tables.get(table, [])]

        with patch.object(views, 'authoring_fetch_all', side_effect=fetch), \
             patch.object(views, 'live_authoring_rows_sql', return_value=('', [])):
            full = views.compact_module_list_rows(views.enrich_modules_with_authoring([]))
            columns_read.clear()
            lean = views.compact_module_list_rows(views.enrich_modules_with_authoring([], list_only=True))
            delivery = [{
                'id': 'delivery-1', 'moduleCatalogueId': 'MOD-ONE', 'programmeId': 'PROG-ONE',
                'programme': 'Programme', 'name': 'One', 'groupId': 'G1', 'assignments': 7,
                'ksbCodes': ['S2'], 'sessionNames': ['Shared title', 'Delivery title'],
                'color': '#123456', 'weeklySchedule': [{'day': 'Monday'}],
            }]
            merged_full = views.compact_module_list_rows(views.enrich_modules_with_authoring(delivery))
            merged_lean = views.compact_module_list_rows(views.enrich_modules_with_authoring(delivery, list_only=True))
        self.assertEqual(lean, full)
        self.assertEqual(merged_lean, merged_full)
        self.assertEqual(merged_lean[0]['id'], 'delivery-1')
        self.assertEqual(merged_lean[0]['assignments'], 7)
        self.assertEqual(merged_lean[0]['ksbCodes'], ['S2', 'K1'])
        self.assertEqual(lean[0]['lessons'], 3)
        self.assertEqual(lean[0]['quizzes'], 1)
        self.assertEqual(lean[0]['ksbCodes'], ['K1'])
        self.assertEqual(lean[0]['notes'], 'Keep notes')
        self.assertEqual(lean[0]['coach'], 'Coach')
        self.assertEqual(lean[0]['weeks'], 3)
        component_columns = next(columns for table, columns in columns_read if table == views.AUTHORING_COMPONENTS_TABLE)
        self.assertNotIn('description', component_columns)
        self.assertNotIn('settings_json', component_columns)
        self.assertNotIn('reflection_question', component_columns)

    def test_module_source_skips_other_sections_but_keeps_assignments_and_visibility(self):
        rows = {key: [] for key in ('training', 'modules', 'authoring_modules', 'ksb_profiles', 'program_configs')}
        rows['authoring_modules'] = [{'module_catalogue_id': 'MOD-OLD', 'status': 'archived'}]
        modules = [{'id': 'MOD-ONE', 'moduleCatalogueId': 'MOD-ONE'}, {'id': 'MOD-OLD', 'moduleCatalogueId': 'MOD-OLD'}]
        with ExitStack() as stack:
            stack.enter_context(patch.object(views, 'build_modules', return_value=modules))
            programmes = stack.enter_context(patch.object(views, 'build_programmes', return_value=[]))
            assignments = stack.enter_context(patch.object(views, 'attach_module_assignment_counts'))
            for name in ('build_cohorts_and_groups', 'build_ksb_data', 'enrich_modules_with_authoring'):
                stack.enter_context(patch.object(views, name, side_effect=AssertionError('unneeded section')))
            result = views.build_curriculum_payload_from_rows(rows, compact=True, module_list=True)
        self.assertEqual([row['id'] for row in result['modules']], ['MOD-ONE'])
        assignments.assert_called_once_with(result['modules'])
        self.assertFalse(programmes.call_args.kwargs['include_learner_counts'])

    def test_module_endpoint_preserves_filters_and_compresses_without_changing_json(self):
        modules = [{'id': str(i), 'programmeId': 'P1' if i < 3 else 'P2', 'name': 'A long title ' * 100} for i in range(10)]
        with patch.object(views, 'cached_curriculum_value', return_value=modules):
            plain = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&programme_id=P1'))
            compressed = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&programme_id=P1', HTTP_ACCEPT_ENCODING='gzip'))
        self.assertEqual(json.loads(plain.content)['count'], 3)
        self.assertEqual(gzip.decompress(compressed.content), plain.content)
        self.assertLess(len(compressed.content), len(plain.content) / 3)

    def test_compact_endpoint_uses_separate_list_cache_and_force_reaches_source(self):
        with patch.object(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()) as cached, \
             patch.object(views, 'get_cached_curriculum_rows', return_value={}) as rows, \
             patch.object(views, 'build_curriculum_payload_from_rows', return_value={'modules': []}) as source, \
             patch.object(views, 'enrich_modules_with_authoring', return_value=[]) as enrich, \
             patch.object(views, 'build_curriculum_payload', side_effect=AssertionError('no overview')):
            response = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&visibility=all', HTTP_CACHE_CONTROL='no-cache'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cached.call_args.args[0], 'modules:all:list-v2')
        self.assertTrue(cached.call_args.kwargs['force'])
        rows.assert_called_once_with(compact=True, force=True)
        source.assert_called_once_with({}, 'all', compact=True, module_list=True)
        enrich.assert_called_once_with([], include_programme_deleted=True, list_only=True)

    def test_delivery_scope_never_builds_modules_or_ksb_library(self):
        with patch.object(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()), \
             patch.object(views, 'get_training_rows', side_effect=AssertionError('unused training read')), \
             patch.object(views, 'get_program_config_rows', side_effect=AssertionError('unused programme read')), \
             patch.object(views, 'build_cohorts_and_groups', return_value=([{'id': 'C'}], [{'id': 'G'}])) as build, \
             patch.object(views, 'get_cached_payload', side_effect=AssertionError('no overview')):
            response = views.curriculum_delivery_scope(RequestFactory().get('/delivery-scope/?visibility=all'))
        self.assertEqual(json.loads(response.content), {'cohorts': [{'id': 'C'}], 'groups': [{'id': 'G'}]})
        build.assert_called_once_with(include_archived=True)

    def test_read_endpoints_keep_staff_gate(self):
        from login import api_gate
        for path in ('delivery-scope/', 'ksb-sets/?view=summary', 'ksb-sets/KSBP-ONE/definitions/'):
            for role, status in ((None, 401), ('learner', 403), ('employer', 403), ('staff', 200)):
                with self.subTest(path=path, role=role), patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'}), \
                     patch.object(api_gate, 'authenticate_request', return_value=SimpleNamespace(role=role) if role else None):
                    response = ApiSessionGateMiddleware(lambda request: JsonResponse({'ok': True}))(RequestFactory().get('/curriculum_api/curriculum/' + path))
                self.assertEqual(response.status_code, status)
