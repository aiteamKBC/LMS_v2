"""Read-contract and payload-size regressions; no database or live services."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import gzip
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.core.cache.backends.locmem import LocMemCache
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from login.api_gate import ApiSessionGateMiddleware
from curriculum_api import views


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
        with composition_fixture(views, 'get_training_rows', return_value=[]), \
                composition_fixture(views, 'get_program_config_rows', return_value=[]), \
                composition_fixture(views, 'get_ksb_profile_rows', return_value=[]), \
                composition_fixture(views, 'get_cached_curriculum_rows', side_effect=AssertionError('unused catalogue')), \
                composition_fixture(views, 'build_programmes', return_value=[programme]) as build:
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

    def test_sets_are_empty_and_read_nothing(self):
        # A KSB set was one stored KSB profile; curriculum.ksb_profiles was
        # removed, so every variant of the list answers [] without a read.
        with composition_fixture(views, 'fetch_all', side_effect=AssertionError('no read')), \
             composition_fixture(views, 'get_cached_payload', side_effect=AssertionError('overview not needed')), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=AssertionError('nothing to cache')):
            for url in ('/ksb-sets/', '/ksb-sets/?visibility=all', '/ksb-sets/?view=summary',
                        '/ksb-sets/?view=summary&visibility=all'):
                body = json.loads(views.curriculum_ksb_sets(RequestFactory().get(url)).content)
                self.assertEqual(body, {'schema': views.CURRICULUM_SCHEMA, 'count': 0, 'results': []})
        self.assertEqual(views.get_ksb_profile_rows(), [])

    def test_definitions_are_not_found_and_read_nothing(self):
        # A KSB set was one stored KSB profile; none are stored any more
        # (curriculum.ksb_profiles was removed), so no id has definitions.
        with composition_fixture(views, 'fetch_all', side_effect=AssertionError('no read')),              composition_fixture(views, 'get_ksb_profile_rows', side_effect=AssertionError('no read')):
            for url in ('/definitions/', '/definitions/?visibility=all'):
                response = views.curriculum_ksb_set_definitions(RequestFactory().get(url), 'KSBP-ONE')
                self.assertEqual(response.status_code, 404)

    def test_library_summary_size_does_not_grow_with_definition_text(self):
        source = profile()
        source['ksb_items'] = [{'code': f'K{i}', 'type': 'K', 'description': 'Long definition ' * 200} for i in range(1000)]
        full = json.dumps(views.build_ksb_data([source], [], [])[1]).encode()
        summary = json.dumps(views.build_ksb_data([source], [], [], summary_only=True)[1]).encode()
        self.assertLess(len(summary), 1000)
        self.assertLess(len(summary), len(full) / 100)


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
                {'id': 'C4', 'module_catalogue_id': 'MOD-ONE', 'week_id': 'W2', 'type': 'quiz', 'expected_otjh': 10, 'status': 'inactive'},
                {'id': 'C5', 'module_catalogue_id': 'MOD-TWO', 'type': 'workplace_evidence', 'expected_otjh': 10},
            ],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'K1'},
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'K1'},
                # archive_state: normalized lifecycle rows archive via status;
                # legacy deletion flags are not archive state on these reads.
                {'module_catalogue_id': 'MOD-ONE', 'ksb_code': 'S1', 'status': 'inactive'},
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

        with composition_fixture(views, 'authoring_fetch_all', side_effect=fetch), \
             composition_fixture(views, 'live_authoring_rows_sql', return_value=('', [])):
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
        # W1/W2 are authoritative; legacy weeks_number=3 is not a live week.
        self.assertEqual(lean[0]['weeks'], 2)
        component_columns = next(columns for table, columns in columns_read if table == views.AUTHORING_COMPONENTS_TABLE)
        self.assertNotIn('description', component_columns)
        self.assertNotIn('settings_json', component_columns)
        self.assertNotIn('reflection_question', component_columns)

    def test_module_source_skips_other_sections_but_keeps_assignments_and_visibility(self):
        rows = {key: [] for key in ('training', 'modules', 'authoring_modules', 'ksb_profiles', 'program_configs')}
        rows['authoring_modules'] = [{'module_catalogue_id': 'MOD-OLD', 'status': 'archived'}]
        modules = [{'id': 'MOD-ONE', 'moduleCatalogueId': 'MOD-ONE'}, {'id': 'MOD-OLD', 'moduleCatalogueId': 'MOD-OLD'}]
        with ExitStack() as stack:
            stack.enter_context(composition_fixture(views, 'build_modules', return_value=modules))
            programmes = stack.enter_context(composition_fixture(views, 'build_programmes', return_value=[]))
            assignments = stack.enter_context(composition_fixture(views, 'attach_module_assignment_counts'))
            for name in ('build_cohorts_and_groups', 'build_ksb_data', 'enrich_modules_with_authoring'):
                stack.enter_context(composition_fixture(views, name, side_effect=AssertionError('unneeded section')))
            result = views.build_curriculum_payload_from_rows(rows, compact=True, module_list=True)
        self.assertEqual([row['id'] for row in result['modules']], ['MOD-ONE'])
        assignments.assert_called_once_with(result['modules'])
        self.assertFalse(programmes.call_args.kwargs['include_learner_counts'])

    def test_module_endpoint_preserves_filters_and_compresses_without_changing_json(self):
        modules = [{'id': str(i), 'programmeId': 'P1' if i < 3 else 'P2', 'name': 'A long title ' * 100} for i in range(10)]
        with composition_fixture(views, 'cached_curriculum_value', return_value=modules):
            plain = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&programme_id=P1'))
            compressed = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&programme_id=P1', HTTP_ACCEPT_ENCODING='gzip'))
        self.assertEqual(json.loads(plain.content)['count'], 3)
        self.assertEqual(gzip.decompress(compressed.content), plain.content)
        self.assertLess(len(compressed.content), len(plain.content) / 3)

    def test_compact_endpoint_uses_separate_list_cache_and_force_reaches_source(self):
        with composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()) as cached, \
             composition_fixture(views, 'get_cached_curriculum_rows', return_value={}) as rows, \
             composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={'modules': []}) as source, \
             composition_fixture(views, 'enrich_modules_with_authoring', return_value=[]) as enrich, \
             composition_fixture(views, 'build_curriculum_payload', side_effect=AssertionError('no overview')):
            response = views.curriculum_modules(RequestFactory().get('/modules/?compact=true&visibility=all', HTTP_CACHE_CONTROL='no-cache'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cached.call_args.args[0], 'modules:all:list-v3')
        self.assertTrue(cached.call_args.kwargs['force'])
        rows.assert_called_once_with(compact=True, force=True)
        source.assert_called_once_with({}, 'all', compact=True, module_list=True)
        enrich.assert_called_once_with([], include_programme_deleted=True, list_only=True)

    def test_compact_list_rebuilds_cache_from_before_free_course_fields(self):
        stale = [{'id': 'MOD-FREE', 'catalogueId': 'MOD-FREE', 'name': 'Independent course'}]
        current = [{**stale[0], 'isFreeCourse': True, 'isForSale': True, 'price': '25.00', 'currency': 'GBP'}]
        isolated_cache = LocMemCache('catalogue-free-course-contract', {})
        epoch = 731
        old_key = views.shared_curriculum_cache_key('modules:operational:list-v2', epoch)
        isolated_cache.set(old_key, stale)
        with composition_fixture(views, 'cache', isolated_cache), \
             patch.dict(views.cache_state._CURRICULUM_CACHE, {}, clear=True), \
             composition_fixture(views, 'shared_curriculum_epoch', return_value=epoch), \
             composition_fixture(views, 'get_cached_curriculum_rows', return_value={}), \
             composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={'modules': stale}), \
             composition_fixture(views, 'enrich_modules_with_authoring', return_value=current) as enrich:
            first = views.curriculum_modules(RequestFactory().get('/modules/?compact=true'))
            repeated = views.curriculum_modules(RequestFactory().get('/modules/?compact=true'))
        self.assertEqual(first.status_code, 200)
        row = json.loads(first.content)['results'][0]
        self.assertIs(row.get('isFreeCourse'), True)
        self.assertEqual((row['isForSale'], row['price'], row['currency']), (True, '25.00', 'GBP'))
        self.assertEqual(repeated.content, first.content)
        enrich.assert_called_once()
        isolated_cache.clear()

    def test_delivery_scope_never_builds_modules_or_ksb_library(self):
        with composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kw: factory()), \
             composition_fixture(views, 'get_training_rows', side_effect=AssertionError('unused training read')), \
             composition_fixture(views, 'get_program_config_rows', side_effect=AssertionError('unused programme read')), \
             composition_fixture(views, 'build_cohorts_and_groups', return_value=([{'id': 'C'}], [{'id': 'G'}])) as build, \
             composition_fixture(views, 'get_cached_payload', side_effect=AssertionError('no overview')):
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
