import copy
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.http import JsonResponse
from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, override_settings

from login.api_gate import ApiSessionGateMiddleware
from . import home_summary, views


def source_data():
    programmes = [
        {'id': 'P1', 'sourceId': 'canonical-P1', 'name': 'Alpha', 'ksbTotal': 2},
        {'id': 'P2', 'name': 'Beta', 'ksbTotal': 0, 'ksbProfileSourceId': 'profile-2'},
        {'id': 'P3', 'name': 'Empty', 'ksbTotal': 0},
    ]
    return {
        'programmes': programmes,
        'modules': [
            {'id': 'delivery-1', 'moduleCatalogueId': 'M/1', 'name': 'First', 'programmeId': 'p1', 'programme': 'Alpha', 'weeks': 4, 'ksbCount': 0, 'tutor': ' TBC ', 'status': ' Draft ', 'lastUpdated': '2026-10-01'},
            {'id': 'M2', 'name': 'Second', 'programmeId': 'canonical-P1', 'weeks': 8, 'ksbCount': 1, 'tutor': 'Tutor', 'status': 'published', 'lastUpdated': '2026-10-12'},
            {'id': 'M3', 'name': 'Third', 'programme': ' beta ', 'ksbCount': 0, 'tutor': 'not assigned', 'status': 'draft', 'lastUpdated': '2026-10-02'},
        ],
        'cohorts': [
            {'id': 'C1', 'programmeId': 'P1', 'status': ' ACTIVE '},
            {'id': 'C2', 'programme': 'Beta', 'status': 'completed'},
        ],
        'groups': [
            {'id': 'G1', 'programmeId': 'P1', 'cohortId': 'C1', 'coach': ''},
            {'id': 'G2', 'cohortId': 'c1', 'coach': 'unassigned'},
            {'id': 'G3', 'programme': 'Beta', 'coach': 'Coach'},
        ],
    }


class HomeProjectionTests(SimpleTestCase):
    def test_preserves_counts_priority_inputs_links_and_programme_matching(self):
        source = source_data()
        before = copy.deepcopy(source)
        result = home_summary.project_home_summary(source, source['programmes'])
        self.assertEqual(result['stats'], {'programmes': 3, 'activeCohorts': 1, 'groups': 3, 'openIssues': 9})
        self.assertEqual(result['attentionCounts'], {
            'programme-ksb-source': 1, 'module-mapping': 2, 'draft-content': 2,
            'group-coach': 2, 'module-tutor': 2,
        })
        self.assertEqual([item['id'] for item in result['continueModules']], ['M3', 'M/1'])
        self.assertEqual(result['programmeFocus'], [
            {'programme': {'id': 'canonical-P1', 'name': 'Alpha'}, 'issues': ['1 mapping gap', '1 without tutor', '2 without coach'], 'issueCount': 3},
            {'programme': {'id': 'P3', 'name': 'Empty'}, 'issues': ['No KSB source', 'No modules', 'No delivery setup'], 'issueCount': 3},
            {'programme': {'id': 'P2', 'name': 'Beta'}, 'issues': ['1 mapping gap', '1 without tutor'], 'issueCount': 2},
        ])
        self.assertEqual(source, before)

    def test_published_fallback_sort_handles_offsets_invalid_dates_and_stable_ties(self):
        source = {'modules': [
            {'id': 'invalid', 'status': 'published', 'lastUpdated': 'invalid'},
            {'id': 'first', 'status': 'published', 'lastUpdated': '2026-10-02T10:00:00+02:00'},
            {'id': 'tie', 'status': 'published', 'lastUpdated': '2026-10-02T08:00:00Z'},
            {'id': 'newest', 'status': 'published', 'lastUpdated': '2026-10-02T09:00:00Z'},
        ]}
        result = home_summary.project_home_summary(source, [])
        self.assertEqual([item['id'] for item in result['continueModules']], ['newest', 'first', 'tie', 'invalid'])

    def test_response_size_is_bounded_and_does_not_expose_full_source_fields(self):
        source = source_data()
        source['modules'] = [{**source['modules'][0], 'id': f'M{i}', 'notes': 'x' * 3000, 'weekStructure': ['secret-content']} for i in range(1000)]
        source['programmes'] = [{'id': f'P{i}', 'name': f'Programme {i}', 'description': 'x' * 3000} for i in range(100)]
        result = home_summary.project_home_summary(source, source['programmes'])
        serialized = json.dumps(result)
        self.assertEqual(len(result['continueModules']), 5)
        self.assertEqual(len(result['programmeFocus']), 6)
        self.assertLess(len(serialized.encode()), 4000)
        self.assertNotIn('weekStructure', serialized)
        self.assertNotIn('notes', serialized)
        self.assertNotIn('description', serialized)
        self.assertEqual(result['stats']['programmes'], 100)
        self.assertEqual(result['attentionCounts']['module-mapping'], 1000)

    def test_empty_summary_has_real_zero_counts(self):
        result = home_summary.project_home_summary({}, [])
        self.assertEqual(result['stats'], {'programmes': 0, 'activeCohorts': 0, 'groups': 0, 'openIssues': 0})
        self.assertEqual(result['continueModules'], [])
        self.assertEqual(result['programmeFocus'], [])


class HomeBuilderTests(SimpleTestCase):
    def test_light_payload_preserves_visible_source_data_and_skips_unused_work(self):
        source = source_data()
        rows = {key: [] for key in ('training', 'modules', 'authoring_modules', 'ksb_profiles', 'program_configs', 'holidays', 'tutors', 'coaches', 'tutor_modules')}
        with patch.object(views, 'build_modules', return_value=source['modules']), \
             patch.object(views, 'build_programmes', return_value=source['programmes']) as programmes, \
             patch.object(views, 'build_cohorts_and_groups', return_value=(source['cohorts'], source['groups'])) as delivery, \
             patch.object(views, 'attach_module_assignment_counts') as assignments, \
             patch.object(views, 'build_ksb_data', return_value=([], [])) as library:
            full = views.build_curriculum_payload_from_rows(rows, compact=True)
            self.assertTrue(programmes.call_args.kwargs['include_learner_counts'])
            self.assertTrue(delivery.call_args.kwargs['include_learner_counts'])
            assignments.assert_called_once()
            library.assert_called_once()
            assignments.reset_mock()
            library.reset_mock()
            light = views.build_curriculum_payload_from_rows(rows, compact=True, home_summary=True)
            self.assertFalse(programmes.call_args.kwargs['include_learner_counts'])
            self.assertFalse(delivery.call_args.kwargs['include_learner_counts'])
            assignments.assert_not_called()
            library.assert_not_called()
        self.assertEqual(home_summary.project_home_summary(full, source['programmes']), home_summary.project_home_summary(light, source['programmes']))

    def test_learner_queries_are_opt_in_for_home_and_still_default_for_other_callers(self):
        with patch.object(views, 'authoring_programme_structure_counts', return_value=({}, {})), \
             patch.object(views, 'active_learner_programme_counts', return_value=({}, {})) as learners:
            views.build_programmes([], [], [], include_learner_counts=False)
            learners.assert_not_called()
            views.build_programmes([], [], [])
            learners.assert_called_once()
        with patch.object(views, 'safe_authoring_module_rows', return_value=[]), \
             patch.object(views, 'cohort_authoring_detail_rows', return_value=[]), \
             patch.object(views, 'group_authoring_detail_rows', return_value=[]), \
             patch.object(views, 'active_learner_delivery_counts', return_value=({}, {})) as learners:
            views.build_cohorts_and_groups(include_learner_counts=False)
            learners.assert_not_called()
            views.build_cohorts_and_groups()
            learners.assert_called_once()

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_live_builder_keeps_module_only_programmes_without_reading_component_content(self):
        source = source_data()
        extra = {'id': 'authoring-only', 'name': 'Authoring only'}
        with patch.object(views, 'get_cached_curriculum_rows', return_value={}) as rows, \
             patch.object(views, 'build_curriculum_payload_from_rows', return_value=source) as overview, \
             patch.object(views, 'enrich_modules_with_authoring', return_value=[]) as enrich, \
             patch.object(views, 'enrich_programmes_with_module_counts', return_value=source['programmes'] + [extra]):
            result = home_summary.build_home_summary('all', force=True)
        self.assertEqual(result['stats']['programmes'], 4)
        rows.assert_called_once_with(compact=True, force=True)
        overview.assert_called_once_with({}, 'all', compact=True, home_summary=True)
        enrich.assert_called_once_with(source['modules'], include_programme_deleted=True, include_content=False)

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_ready_snapshot_skips_source_reads_and_stale_snapshot_requests_refresh(self):
        source = source_data()
        snapshot = SimpleNamespace(payload={'overview': source, 'programmes': source['programmes']}, stale=True)
        with patch('curriculum_api.read_model.get_curriculum_home', return_value=snapshot), \
             patch('curriculum_api.read_model.enqueue_curriculum_home_refresh') as enqueue, \
             patch.object(views, 'cached_curriculum_value') as live:
            request = RequestFactory().get('/curriculum_api/curriculum/home-summary/')
            response = home_summary.curriculum_home_summary(request)
        live.assert_not_called()
        enqueue.assert_called_once_with('operational', reason='stale-read')
        self.assertEqual(response['X-LMS-Cache'], 'READ-MODEL-STALE')
        self.assertJSONEqual(response.content, home_summary.project_home_summary(source, source['programmes']))

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_worker_refresh_is_visible_without_a_new_write_epoch(self):
        source = source_data()
        updated = {**source, 'modules': []}
        snapshots = [
            SimpleNamespace(payload={'overview': source, 'programmes': source['programmes']}, stale=True),
            SimpleNamespace(payload={'overview': updated, 'programmes': source['programmes']}, stale=False),
        ]
        with patch('curriculum_api.read_model.get_curriculum_home', side_effect=snapshots), \
             patch('curriculum_api.read_model.enqueue_curriculum_home_refresh'), \
             patch.object(views, 'cached_curriculum_value') as live:
            request = RequestFactory().get('/curriculum_api/curriculum/home-summary/')
            first = home_summary.curriculum_home_summary(request)
            second = home_summary.curriculum_home_summary(request)
        self.assertNotEqual(first.content, second.content)
        self.assertEqual(second['X-LMS-Cache'], 'READ-MODEL-HIT')
        live.assert_not_called()


class HomeEndpointTests(SimpleTestCase):
    def test_cached_summary_rebuilds_after_the_existing_shared_write_epoch_changes(self):
        request = RequestFactory().get('/curriculum_api/curriculum/home-summary/')
        cache.clear()
        self.addCleanup(cache.clear)
        with patch.dict(views._CURRICULUM_CACHE, {}, clear=True), \
             patch.object(views, 'shared_curriculum_epoch', return_value=101) as epoch, \
             patch.object(home_summary, 'build_home_summary', side_effect=[{'version': 1}, {'version': 2}]) as build:
            first = home_summary.curriculum_home_summary(request)
            second = home_summary.curriculum_home_summary(request)
            self.assertEqual(first.content, second.content)
            self.assertEqual(build.call_count, 1)
            epoch.return_value = 102
            refreshed = home_summary.curriculum_home_summary(request)
            self.assertJSONEqual(refreshed.content, {'version': 2})
            self.assertEqual(build.call_count, 2)

    def test_failed_build_propagates_instead_of_becoming_a_successful_empty_summary(self):
        request = RequestFactory().get('/curriculum_api/curriculum/home-summary/')
        with patch.object(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kwargs: factory()), \
             patch.object(home_summary, 'build_home_summary', side_effect=RuntimeError('source unavailable')):
            with self.assertRaisesMessage(RuntimeError, 'source unavailable'):
                home_summary.curriculum_home_summary(request)

    def test_endpoint_has_separate_visibility_cache_and_honours_forced_refresh(self):
        request = RequestFactory().get('/curriculum_api/curriculum/home-summary/?visibility=all', HTTP_CACHE_CONTROL='no-cache')
        with patch.object(views, 'cached_curriculum_value', side_effect=lambda key, factory, **kwargs: factory()) as cache, \
             patch.object(home_summary, 'build_home_summary', return_value={'stats': {}}) as build:
            response = home_summary.curriculum_home_summary(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cache.call_args.args[0], 'home-summary:v1:all')
        self.assertTrue(cache.call_args.kwargs['force'])
        build.assert_called_once_with('all', force=True)

    def test_post_is_rejected_without_building(self):
        with patch.object(home_summary, 'build_home_summary') as build:
            response = home_summary.curriculum_home_summary(RequestFactory().post('/curriculum_api/curriculum/home-summary/'))
        self.assertEqual(response.status_code, 405)
        build.assert_not_called()

    def test_existing_staff_gate_protects_summary_before_any_data_is_read(self):
        from login import api_gate
        for role, status in ((None, 401), ('learner', 403), ('employer', 403), ('staff', 200), ('admin', 200)):
            with self.subTest(role=role), patch.dict('os.environ', {'API_REQUIRE_AUTH': '1'}), \
                 patch.object(api_gate, 'authenticate_request', return_value=SimpleNamespace(role=role) if role else None):
                response = ApiSessionGateMiddleware(lambda request: JsonResponse({'ok': True}))(
                    RequestFactory().get('/curriculum_api/curriculum/home-summary/')
                )
            self.assertEqual(response.status_code, status)
