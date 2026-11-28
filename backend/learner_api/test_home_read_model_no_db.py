from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import read_model
from .overview_week import HOME_SOURCE_FIELDS, overview_week


class LearnerHomeReadModelTests(SimpleTestCase):
    def test_scope_is_kind_and_learner_id(self):
        self.assertEqual(read_model.learner_scope_id('commercial', 499), 'commercial:499')
        self.assertEqual(read_model.parse_learner_scope_id('apprenticeship:12'), ('apprenticeship', 12))
        for invalid in ('', 'staff:12', 'commercial:0', 'commercial:not-a-number'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                read_model.parse_learner_scope_id(invalid)

    @override_settings(LEARNER_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_home_hit_preserves_payload_and_skips_live_projection(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        value = SimpleNamespace(payload={'weekStart': '2026-09-28'}, stale=False)
        request = RequestFactory().get('/?section=home')
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.read_model.get_learner_home', return_value=value), \
             patch('learner_api.overview_week.read_week') as live:
            response = overview_week.__wrapped__.__wrapped__(request, 'commercial', 499)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-LMS-Cache'], 'HIT')
        self.assertJSONEqual(response.content, value.payload)
        model.all_learners.only.assert_not_called()
        live.assert_not_called()

    @override_settings(LEARNER_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_stale_hit_is_served_and_refresh_is_enqueued(self):
        value = SimpleNamespace(payload={'weekStart': '2026-09-28'}, stale=True)
        with patch('learner_api.read_model.get_learner_home', return_value=value), \
             patch('learner_api.read_model.enqueue_learner_home_refresh') as enqueue:
            response = overview_week.__wrapped__.__wrapped__(
                RequestFactory().get('/?section=home'), 'commercial', 499,
            )

        self.assertEqual(response['X-LMS-Cache'], 'STALE')
        enqueue.assert_called_once_with('commercial', 499, reason='stale-read')

    @override_settings(LEARNER_HOME_SHARED_READ_MODEL_ENABLED=True)
    def test_miss_preserves_live_payload_and_enqueues_refresh(self):
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        source = model.all_learners.only.return_value.get.return_value
        request = RequestFactory().get('/?section=home')
        with patch.dict('learner_api.overview_week.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.read_model.get_learner_home', return_value=None), \
             patch('learner_api.overview_week.read_week', return_value={'homeProgress': {}}) as live, \
             patch('learner_api.read_model.enqueue_learner_home_refresh') as enqueue:
            response = overview_week.__wrapped__.__wrapped__(request, 'commercial', 499)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-LMS-Cache'], 'MISS')
        self.assertJSONEqual(response.content, {'homeProgress': {}})
        model.all_learners.only.assert_called_once_with(*HOME_SOURCE_FIELDS)
        live.assert_called_once_with(source, home_kind='commercial')
        enqueue.assert_called_once_with('commercial', 499, reason='missing-read-model')

    def test_builder_uses_the_same_live_home_projection(self):
        model = MagicMock()
        source = model.all_learners.only.return_value.get.return_value
        with patch.dict('learner_api.learner_detail.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.overview_week.read_week', return_value={'homeProgress': {}}) as build:
            payload = read_model.build_learner_home('commercial:499')

        self.assertEqual(payload, {'homeProgress': {}})
        build.assert_called_once_with(source, home_kind='commercial')
