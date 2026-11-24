"""Frozen source and routing parity without Django or infrastructure startup."""
import ast
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import unittest
from functools import wraps
from inspect import signature
from contextlib import contextmanager
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import registry_composition_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.calendar_composition_oracle import restore_tree
    return restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8-sig')), relative)


def original(relative):
    return oracle.restore_tree(tree(relative), relative)


class OwnerImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        if node.module == 'curriculum_api.learning_storage':
            names = {a.name for a in node.names}
            if names <= {'course', 'free_rows', 'free_read_table'}:
                node.module = 'curriculum_api.catalogue.infrastructure.course_storage_reads'
            elif names <= {'upsert', 'update', 'refresh_totals'}:
                node.module = 'curriculum_api.catalogue.infrastructure.course_storage_writes'
        return node


class DirectPricing(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level == 1 and node.module is None and [a.name for a in node.names] == ['views']:
            return None
        return node

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id == 'views':
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)


def storage_scope(prior):
    events = []
    @contextmanager
    def native_scope():
        events.append('enter')
        try:
            yield
        finally:
            events.append('exit')
    env = dict(json=json, re=re, wraps=wraps, signature=signature, connection=object(),
               READ_VIEWS={'modules': 'native_modules'}, TABLES={'modules': ()},
               enabled=Mock(return_value=True), native_only=Mock(return_value=False),
               native_authoring_scope=native_scope, read_table=lambda table, *args: 'READ_' + table)
    source = original('learning_storage.py') if prior else tree('catalogue/infrastructure/course_storage_reads.py')
    wanted = set(oracle.SNAPSHOT['storage']['catalogue.infrastructure.course_storage_reads'])
    wanted |= {'_SQL_PARTS', '_READ_NAMES', '_READ_SOURCE'}
    nodes = [n for n in source.body if getattr(n, 'name', None) in wanted or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in wanted for t in n.targets)]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<reviewed-storage-read-source>', 'exec'), env)
    env['course'] = Mock(return_value={'id': 'synthetic-course'})
    return env, events


class RegistryCompositionContracts(unittest.TestCase):
    def test_frozen_evidence_and_exact_remaining_source(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'a6b45490d345472910a53a6532ce5a4d064a70ff1814142889822a1e84801036')
        for relative, record in oracle.SNAPSHOT['source_changes'].items():
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree(relative).body], record['after'], relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in original(relative).body], record['order'], relative)

    def test_all_73_signatures_decorators_and_bodies_preserved(self):
        old = {n.name: n for n in original('views.py').body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(MANIFEST['functions']), 73)
        for name, owner in MANIFEST['functions'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body if getattr(n, 'name', None) == name)
            self.assertEqual(ast.dump(OwnerImports().visit(copy.deepcopy(old[name]))), ast.dump(actual), name)

    def test_storage_sql_and_persistence_bodies_are_unchanged(self):
        old = {n.name: n for n in original('learning_storage.py').body if isinstance(n, ast.FunctionDef)}
        for owner, names in oracle.SNAPSHOT['storage'].items():
            actual = {n.name: n for n in tree(owner.replace('.', '/') + '.py').body if isinstance(n, ast.FunctionDef)}
            for name in names:
                self.assertEqual(ast.dump(old[name]), ast.dump(actual[name]), name)

    def test_pricing_preserves_filters_sql_and_failure_behavior(self):
        old = {n.name: n for n in original('free_course_pricing.py').body if isinstance(n, ast.FunctionDef)}
        for actual in tree('free_course_pricing.py').body:
            if isinstance(actual, ast.FunctionDef):
                self.assertEqual(ast.dump(DirectPricing().visit(copy.deepcopy(old[actual.name]))), ast.dump(actual))

    def test_owners_have_no_reverse_or_forbidden_layer_dependencies(self):
        for module in MANIFEST['modules']:
            for node in ast.walk(tree(module.replace('.', '/') + '.py')):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, 'curriculum_api.views', module)
                    self.assertFalse(node.level == 1 and node.module is None and any(a.name == 'views' for a in node.names), module)
                    if '.infrastructure.' in module:
                        self.assertNotIn('.api.', node.module or '', module)
                    if '.domain.' in module:
                        self.assertFalse(any(x in (node.module or '') for x in ('django', '.infrastructure.', '.api.', 'settings')), module)

    def test_bulk_routing_consumes_generator_once_and_restores_scope(self):
        results = []
        for prior in (True, False):
            env, events = storage_scope(prior)
            consumed = []
            def rows():
                for identity in ('A', 'B', 'A'):
                    consumed.append(identity)
                    yield {'module_catalogue_id': identity}
            def save(payloads):
                events.append(('save', list(payloads)))
                return len(payloads)
            result = env['with_course_storage'](save)(rows())
            self.assertEqual(consumed, ['A', 'B', 'A'])
            self.assertEqual([events[0], events[-1]], ['enter', 'exit'])
            self.assertEqual(result, 3)
            results.append(events)
        self.assertEqual(*results)

    def test_native_scope_and_invalid_request_keep_existing_routing(self):
        for prior in (True, False):
            env, events = storage_scope(prior)
            env['native_only'].return_value = True
            self.assertEqual(env['with_course_storage'](lambda identifier: identifier)('X'), 'X')
            env['enabled'].assert_not_called()
            env['course'].assert_not_called()
            self.assertEqual(events, [])
            env['native_only'].return_value = False
            env['enabled'].return_value = False
            request = type('Request', (), {'method': 'PATCH', 'body': b'{invalid'})()
            self.assertIs(env['with_course_storage'](lambda request: request)(request), request)
            self.assertEqual(events, [])

    def test_sql_routing_preserves_literals_comments_writes_and_aliases(self):
        queries = ["SELECT * FROM curriculum.modules", "SELECT * FROM curriculum.modules m WHERE m.id=%s",
                   "SELECT 'FROM curriculum.modules' FROM curriculum.modules -- FROM curriculum.modules",
                   'UPDATE curriculum.modules SET title=%s', 'DELETE FROM curriculum.modules',
                   'WITH x AS (SELECT * FROM curriculum.modules) SELECT * FROM x',
                   'SELECT $$FROM curriculum.modules$$ FROM curriculum.modules']
        old, _ = storage_scope(True)
        new, _ = storage_scope(False)
        for sql in queries:
            self.assertEqual(old['read_sql'](sql), new['read_sql'](sql), sql)
        self.assertEqual(new['read_sql'](queries[3]), queries[3])
        self.assertIn("'FROM curriculum.modules'", new['read_sql'](queries[2]))


if __name__ == '__main__':
    unittest.main()
