from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import read_model, views


class CurriculumHomeReadModelTests(SimpleTestCase):
    def test_builder_uses_one_scope_for_both_home_responses(self):
        overview = {
            'schema': 'curriculum',
            'modules': [{'id': 'MOD-1', 'sessionNames': ['One']}],
            'programmes': [{'id': 'PROG-1'}],
        }
        with patch.object(views, 'curriculum_read_scope') as scope, \
             patch.object(views, 'build_curriculum_payload', return_value=overview) as build, \
             patch.object(views, 'compact_module_rows', return_value=[{'id': 'MOD-1'}]), \
             patch.object(views, 'enrich_modules_with_authoring', return_value=[{'id': 'MOD-1'}]), \
             patch.object(views, 'enrich_programmes_with_module_counts', return_value=[{'id': 'PROG-1', 'moduleCount': 1}]):
            payload = read_model.build_curriculum_home('operational')

        scope.assert_called_once_with()
        build.assert_called_once_with('operational', compact=True, force=True)
        self.assertEqual(payload['overview']['modules'], [{'id': 'MOD-1'}])
        self.assertEqual(payload['programmes'], [{'id': 'PROG-1', 'moduleCount': 1}])

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_compact_overview_hit_skips_live_build(self):
        value = SimpleNamespace(
            payload={'overview': {'schema': 'curriculum', 'modules': []}, 'programmes': []},
            stale=False,
        )
        request = RequestFactory().get('/curriculum/overview/?compact=true')
        with patch('curriculum_api.read_model.get_curriculum_home', return_value=value), \
             patch.object(views, 'cached_curriculum_value') as live:
            response = views.curriculum_overview(request)

        self.assertEqual(response['X-LMS-Cache'], 'READ-MODEL-HIT')
        self.assertJSONEqual(response.content, value.payload['overview'])
        live.assert_not_called()

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_programmes_stale_hit_is_served_and_enqueues_refresh(self):
        value = SimpleNamespace(
            payload={
                'overview': {'schema': 'curriculum', 'programmes': []},
                'programmes': [{'id': 'PROG-1', 'moduleCount': 3}],
            },
            stale=True,
        )
        request = RequestFactory().get('/curriculum/programmes/')
        with patch('curriculum_api.read_model.get_curriculum_home', return_value=value), \
             patch('curriculum_api.read_model.enqueue_curriculum_home_refresh') as enqueue, \
             patch.object(views, 'cached_curriculum_value') as live:
            response = views.curriculum_programmes(request)

        self.assertEqual(response['X-LMS-Cache'], 'READ-MODEL-STALE')
        self.assertJSONEqual(response.content, {
            'schema': 'curriculum', 'count': 1,
            'results': [{'id': 'PROG-1', 'moduleCount': 3}],
        })
        enqueue.assert_called_once_with('operational', reason='stale-read')
        live.assert_not_called()

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_overview_miss_preserves_live_response_and_enqueues_refresh(self):
        live_payload = {'schema': 'curriculum', 'modules': [], 'programmes': []}
        request = RequestFactory().get('/curriculum/overview/?compact=true')
        with patch('curriculum_api.read_model.get_curriculum_home', return_value=None), \
             patch('curriculum_api.read_model.enqueue_curriculum_home_refresh') as enqueue, \
             patch.object(views, 'cached_curriculum_value', return_value=live_payload):
            response = views.curriculum_overview(request)

        self.assertEqual(response['X-LMS-Cache'], 'READ-MODEL-MISS')
        self.assertJSONEqual(response.content, live_payload)
        enqueue.assert_called_once_with('operational', reason='missing-read-model')

    @override_settings(READ_MODEL_OUTBOX_ENABLED=True)
    def test_request_scope_queues_one_refresh_pair_for_many_invalidations(self):
        with patch('curriculum_api.read_model.enqueue_all_curriculum_home_refreshes') as enqueue, \
             patch.object(views, 'bump_shared_curriculum_epoch'), \
             patch.object(views, 'write_shared_curriculum_epoch_bump'), \
             patch.object(views.transaction, 'on_commit'):
            views.begin_curriculum_write_scope()
            try:
                views.invalidate_curriculum_cache()
                views.invalidate_curriculum_cache()
            finally:
                views.end_curriculum_write_scope()

        enqueue.assert_called_once_with(reason='curriculum-change')
