"""Actual old/current cache scheduling and moved-source contracts; no framework I/O."""
import ast
import copy
from contextlib import nullcontext
from datetime import datetime
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import cache_composition_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.overview_composition_oracle import restore_tree
    return restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8-sig')), relative)


def original():
    return oracle.restore_tree(tree('views.py'), 'views.py')


class AbsoluteImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        return node


def definitions(source, names):
    return [copy.deepcopy(n) for n in source.body if isinstance(n, (ast.FunctionDef, ast.ClassDef)) and n.name in names]


class InjectGuard(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.module == 'config.management_safety':
            assert [a.name for a in node.names] == ['reconciliation_command']
            return None
        return node


def scheduler(prior):
    """Execute the actual definitions with explicit synthetic thread/connection ports."""
    events = []
    env = dict(_CURRICULUM_WARM_LOCK=nullcontext(), _CURRICULUM_WARM_RUNNING=False,
               _CURRICULUM_WARM_REQUESTED=False, CURRICULUM_WARM_ENABLED=True,
               CURRICULUM_WARM_DELAY_SECONDS=2, datetime=datetime,
               reconciliation_command=Mock(return_value=False), logger=Mock(),
               time=SimpleNamespace(sleep=Mock(side_effect=lambda delay: events.append(('sleep', delay)))),
               connections=SimpleNamespace(close_all=Mock(side_effect=lambda: events.append('close'))),
               warm_curriculum_caches=Mock(side_effect=lambda: events.append('payload')),
               warm_programme_detail_sections=Mock(side_effect=lambda: events.append('sections')),
               threading=SimpleNamespace(Thread=Mock()))
    src = original() if prior else tree('catalogue/infrastructure/cache_warming.py')
    nodes = definitions(src, {'schedule_curriculum_warm', '_curriculum_warm_loop'})
    compiled = InjectGuard().visit(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(ast.fix_missing_locations(compiled), '<actual-cache-worker>', 'exec'), env)
    def run():
        if prior:
            return env['_curriculum_warm_loop']()
        return env['_curriculum_warm_loop'](warm_curriculum_caches=env['warm_curriculum_caches'],
            warm_programme_detail_sections=env['warm_programme_detail_sections'], delay_seconds=2)
    def schedule():
        if prior:
            return env['schedule_curriculum_warm']()
        return env['schedule_curriculum_warm'](enabled=env['CURRICULUM_WARM_ENABLED'], run_warm_loop=run)
    return env, events, run, schedule


class CacheCompositionContracts(unittest.TestCase):
    def test_frozen_evidence_and_restoration(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '1c7fe8caf0419d0dfd3df3743328fb7e51b14a6dc9a0482095ecd46985bb14b9')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            current = tree(relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'])
            restored = oracle.restore_tree(current, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body], entry['order'])

    def test_all_moved_functions_classes_and_remaining_bodies(self):
        old = {n.name: n for n in original().body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}
        for name, owner in {**MANIFEST['functions'], **MANIFEST['classes']}.items():
            actual = definitions(tree(owner.replace('.', '/') + '.py'), {name})[0]
            self.assertEqual(ast.dump(AbsoluteImports().visit(copy.deepcopy(old[name]))), ast.dump(actual), name)
        for actual in tree('views.py').body:
            if isinstance(actual, ast.FunctionDef) and actual.name not in {
                    'schedule_curriculum_warm', '_curriculum_warm_loop', 'warm_curriculum_caches'}:
                self.assertEqual(ast.dump(old[actual.name]), ast.dump(actual), actual.name)

    def test_no_reverse_or_forbidden_layer_imports(self):
        for owner in MANIFEST['modules']:
            for node in ast.walk(tree(owner.replace('.', '/') + '.py')):
                if not isinstance(node, ast.ImportFrom):
                    continue
                module = node.module or ''
                self.assertNotEqual(module, 'curriculum_api.views')
                self.assertFalse(module == 'curriculum_api' and any(a.name == 'views' for a in node.names))
                if '.domain.' in owner or '.application.' in owner:
                    self.assertFalse(module.startswith(('django', 'psycopg')) or '.infrastructure.' in module or '.api.' in module, (owner, module))
                if '.infrastructure.' in owner:
                    self.assertNotIn('.api.', module, (owner, module))

    def test_disabled_or_reconciliation_does_not_start_worker(self):
        for prior in (True, False):
            for reconcile in (False, True):
                env, events, run, schedule = scheduler(prior)
                env['CURRICULUM_WARM_ENABLED'] = reconcile
                env['reconciliation_command'].return_value = reconcile
                self.assertFalse(schedule())
                env['threading'].Thread.assert_not_called()
                self.assertFalse(env['_CURRICULUM_WARM_RUNNING'])
                self.assertEqual(events, [])

    def test_schedule_coalesces_with_same_thread_contract(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            self.assertTrue(schedule())
            self.assertTrue(schedule())
            self.assertTrue(env['_CURRICULUM_WARM_REQUESTED'])
            self.assertTrue(env['_CURRICULUM_WARM_RUNNING'])
            thread = env['threading'].Thread
            thread.assert_called_once()
            self.assertEqual(thread.call_args.kwargs['name'], 'curriculum-cache-warm')
            self.assertIs(thread.call_args.kwargs['daemon'], True)
            self.assertTrue(callable(thread.call_args.kwargs['target']))
            thread.return_value.start.assert_called_once_with()

    def test_start_failure_allows_later_schedule(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            env['threading'].Thread.return_value.start.side_effect = RuntimeError('synthetic thread failure')
            self.assertFalse(schedule())
            self.assertFalse(env['_CURRICULUM_WARM_RUNNING'])
            self.assertTrue(env['_CURRICULUM_WARM_REQUESTED'])
            env['threading'].Thread.return_value.start.side_effect = None
            self.assertTrue(schedule())

    def test_worker_preserves_order_and_connection_cleanup(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            schedule()
            run()
            self.assertEqual(events, [('sleep', 2), 'payload', 'sections', 'close'])
            self.assertFalse(env['_CURRICULUM_WARM_RUNNING'])
            self.assertFalse(env['_CURRICULUM_WARM_REQUESTED'])

    def test_write_during_warm_requests_another_pass(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            def payload():
                events.append('payload')
                if env['warm_curriculum_caches'].call_count == 1:
                    self.assertTrue(schedule())
            env['warm_curriculum_caches'].side_effect = payload
            schedule()
            run()
            self.assertEqual(events, [('sleep', 2), 'payload', 'sections', 'close'] * 2)
            env['threading'].Thread.assert_called_once()

    def test_payload_and_section_errors_keep_cleanup_and_release_latch(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            env['warm_curriculum_caches'].side_effect = ValueError('payload failed')
            env['warm_programme_detail_sections'].side_effect = ValueError('section failed')
            schedule()
            run()
            self.assertEqual(events, [('sleep', 2), 'close'])
            self.assertEqual(env['logger'].warning.call_count, 2)
            self.assertFalse(env['_CURRICULUM_WARM_RUNNING'])

    def test_base_exception_is_reraised_and_releases_latch(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            env['warm_programme_detail_sections'].side_effect = KeyboardInterrupt
            schedule()
            with self.assertRaises(KeyboardInterrupt):
                run()
            env['connections'].close_all.assert_called_once_with()
            self.assertFalse(env['_CURRICULUM_WARM_RUNNING'])

    def test_reconciliation_worker_guard_has_no_effects(self):
        for prior in (True, False):
            env, events, run, schedule = scheduler(prior)
            env['reconciliation_command'].return_value = True
            run()
            self.assertEqual(events, [])
            env['warm_curriculum_caches'].assert_not_called()

    def test_payload_warm_keys_values_and_guard_match_original(self):
        results = []
        for prior in (True, False):
            events = []
            def cache(key, factory):
                result = factory()
                events.append((key, result))
                return result
            ports = dict(reconciliation_command=Mock(return_value=False), curriculum_read_scope=nullcontext,
                cached_curriculum_value=cache, build_curriculum_payload=Mock(return_value={'modules': ['M'], 'programmes': ['P']}),
                enrich_modules_with_authoring=Mock(return_value=['ENRICHED']),
                enrich_programmes_with_module_counts=Mock(return_value=['COUNTED']))
            src = original() if prior else tree('catalogue/application/cache_warming.py')
            nodes = InjectGuard().visit(ast.Module(body=definitions(src, {'warm_curriculum_caches'}), type_ignores=[]))
            env = dict(ports)
            exec(compile(ast.fix_missing_locations(nodes), '<actual-cache-payload>', 'exec'), env)
            env['warm_curriculum_caches'](**({} if prior else ports))
            results.append((events, [ports[name].call_args_list for name in (
                'build_curriculum_payload', 'enrich_modules_with_authoring', 'enrich_programmes_with_module_counts')]))
            self.assertEqual(len(events), 6)
            ports['reconciliation_command'].return_value = True
            env['warm_curriculum_caches'](**({} if prior else ports))
            self.assertEqual(len(events), 6)
        self.assertEqual(*results)


if __name__ == '__main__':
    unittest.main()
