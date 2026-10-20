"""The KSB design figures outlive the learner ttl; failures never do.

Synthetic rows only; nothing here reaches a database.
"""
from contextlib import ExitStack
from unittest.mock import patch

from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase

from . import cache_scope, views


class ProgrammeKsbDesignCacheTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        views._CURRICULUM_CACHE.clear()
        self.addCleanup(cache.clear)
        self.addCleanup(views._CURRICULUM_CACHE.clear)
        self.epochs = {'#global': 7, '#bumps': 2, '*': 1, 'P1': 1}
        self.modules = [{'module_catalogue_id': 'M1'}]
        self.mappings = [
            {'module_catalogue_id': 'M1', 'component_id': 'C1', 'ksb_code': code, 'weight': weight}
            for code, weight in [('K1', 10), ('K2', 20)]
        ]
        self.scope_reads = []
        stack = self.enterContext(ExitStack())

        def scope(*args, **kwargs):
            self.scope_reads.append(args)
            return self.modules, [], [], self.mappings

        self.scope = stack.enter_context(patch.object(views, 'authoring_scope_data', side_effect=scope))
        for name, value in (
            ('infer_source_from_scope', ('', '', '')),
            ('required_ksbs_for_resolved_source', []),
            ('assigned_learners_for_programme', [{'id': 1}]),
        ):
            stack.enter_context(patch.object(views, name, return_value=value))
        stack.enter_context(patch.object(views, 'mappings_with_inferred_sources', side_effect=lambda rows, modules: rows))
        self.progress = stack.enter_context(patch.object(views, 'learner_progress_ksb_totals', return_value={1: {'K1': 10}}))
        stack.enter_context(patch.object(views, 'shared_curriculum_epoch', return_value=7))
        stack.enter_context(patch.object(cache_scope, 'scope_epochs', side_effect=lambda: dict(self.epochs)))
        stack.enter_context(patch.object(cache_scope, 'programme_ids', return_value=frozenset({'P1'})))

    def test_learner_progress_is_recomputed_while_the_design_is_read_once(self):
        first = views.programme_learner_ksb_progress('P1')
        self.progress.return_value = {1: {'K1': 10, 'K2': 20}}
        second = views.programme_learner_ksb_progress('P1')
        self.assertEqual(first['learnerKsbProgressPercentage'], 33)
        self.assertEqual(second['learnerKsbProgressPercentage'], 100)
        self.assertEqual(self.progress.call_count, 2)
        self.assertEqual(len(self.scope_reads), 1)
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1', 'K2']), 2)
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1', 'K2']), 2)
        self.assertEqual(len(self.scope_reads), 2)

    def test_the_required_set_keys_the_mapped_count(self):
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1', 'K2']), 2)
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1']), 1)
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['k2', 'K1']), 2)
        self.assertEqual(len(self.scope_reads), 2)

    def test_a_programme_save_retires_the_design(self):
        views.programme_learner_ksb_progress('P1')
        self.mappings.append({'module_catalogue_id': 'M1', 'component_id': 'C2', 'ksb_code': 'K3', 'weight': 30})
        self.epochs['P1'] = 2
        result = views.programme_learner_ksb_progress('P1')
        self.assertEqual(result['learnerKsbCodesTotal'], 3)
        self.assertEqual(len(self.scope_reads), 2)

    def test_a_failed_read_is_answered_as_before_and_never_cached(self):
        self.scope.side_effect = RuntimeError('database unavailable')
        with self.assertLogs('curriculum_api.views', level='WARNING') as logs:
            self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1']), 0)
            failed = views.programme_learner_ksb_progress('P1')
        self.assertEqual(failed['learnerKsbCodesTotal'], 0)
        self.assertTrue(any('Could not count programme component KSB mappings' in line for line in logs.output))
        self.assertTrue(any('Could not load authoring scope for programme KSB progress' in line for line in logs.output))

        def scope(*args, **kwargs):
            self.scope_reads.append(args)
            return self.modules, [], [], self.mappings

        self.scope.side_effect = scope
        self.assertEqual(views.programme_component_ksb_mapping_count('P1', ['K1']), 1)
        self.assertEqual(views.programme_learner_ksb_progress('P1')['learnerKsbCodesTotal'], 2)

    def test_a_coverage_failure_keeps_its_own_message_and_is_not_cached(self):
        with patch.object(views, 'build_coverage', side_effect=RuntimeError('bad coverage')), \
                self.assertLogs('curriculum_api.views', level='WARNING') as logs:
            self.assertEqual(views.programme_learner_ksb_progress('P1')['learnerKsbCodesTotal'], 0)
        self.assertTrue(any('Could not build coverage for programme KSB progress' in line for line in logs.output))
        self.assertEqual(views.programme_learner_ksb_progress('P1')['learnerKsbCodesTotal'], 2)

    def test_a_forced_ksb_stats_read_builds_the_design_afresh(self):
        def stats(identifier, visibility):
            return {
                'programmeId': 'P1',
                'ksbMapped': views.programme_component_ksb_mapping_count('P1', ['K1', 'K2']),
                **views.programme_learner_ksb_progress('P1'),
            }

        with patch.object(views, 'build_programme_ksb_stats', side_effect=stats):
            views.curriculum_programme_ksb_stats(RequestFactory().get('/ksb-stats/'), 'P1')
            self.assertEqual(len(self.scope_reads), 2)
            views.curriculum_programme_ksb_stats(RequestFactory().get('/ksb-stats/', HTTP_CACHE_CONTROL='no-cache'), 'P1')
            self.assertEqual(len(self.scope_reads), 4)
        # And the flag does not outlive the forced request.
        views.programme_component_ksb_mapping_count('P1', ['K1', 'K2'])
        self.assertEqual(len(self.scope_reads), 4)
