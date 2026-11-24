"""Frozen-source SQL/cache parity; explicit fake connection, no Django import."""
import ast
import copy
from contextvars import Context
import hashlib
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import database_reads_oracle as oracle
from curriculum_api.catalogue.infrastructure import storage_context

SNAPSHOT = oracle.SNAPSHOT


class FakeConnection:
    vendor = 'postgresql'

    def __init__(self, rows=(), columns=('value',), error=False):
        self.rows = rows
        self.description = [(name,) for name in columns]
        self.calls = []
        self.error = error

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, query, params):
        self.calls.append((query, copy.deepcopy(params)))
        if self.error:
            raise RuntimeError('synthetic read failure')

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


def namespace(original=False):
    path = ROOT / 'catalogue/infrastructure/database_reads.py'
    tree = ast.parse(path.read_text(encoding='utf-8'))
    replaced = []
    kept = []
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module in {'django.db', 'curriculum_api'}:
            replaced.append((node.module, [(a.name, a.asname) for a in node.names]))
        else:
            kept.append(node)
    assert replaced == [('django.db', [('connection', None)]), ('curriculum_api', [('schema_gate', None)])]
    env = {'__name__': 'synthetic_database_reads', '__package__': 'curriculum_api.catalogue.infrastructure',
           'connection': FakeConnection(), 'schema_gate': SimpleNamespace(table_exists=lambda table: True)}
    exec(compile(ast.Module(body=kept, type_ignores=[]), str(path), 'exec'), env)
    if original:
        env['__package__'] = 'curriculum_api'
        for entry in SNAPSHOT['owned'].values():
            exec(compile(entry['old'], '<original-views>', 'exec'), env)
    return env


class DatabaseReadSourceParity(unittest.TestCase):
    def test_frozen_evidence_and_exact_moved_functions(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'd19c65b90140fe55813ad5a6e1088ce5163fb395ac4736e477092be7aa7a5de0')
        tree = ast.parse((ROOT / 'catalogue/infrastructure/database_reads.py').read_text())
        functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['owned'].items():
            expected = entry['old'].replace('from .catalogue.infrastructure.schema_reads', 'from .schema_reads')
            expected = expected.replace('from .free_course_contract', 'from curriculum_api.free_course_contract')
            self.assertEqual(ast.dump(functions[name]), ast.dump(ast.parse(expected).body[0]), name)
        for rel, entry in SNAPSHOT['source_changes'].items():
            tree = ast.parse((ROOT / rel).read_text(encoding='utf-8-sig'))
            restored = oracle.restore_tree(tree, rel)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body], entry['order'], rel)

    def test_source_exports_cache_identity_and_no_reverse_view_dependencies(self):
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        exports = next(n for n in tree.body if isinstance(n, ast.ImportFrom)
                       and n.module == 'catalogue.infrastructure.database_reads')
        names = {a.name for a in exports.names}
        self.assertTrue(set(SNAPSHOT['owned']) <= names)
        self.assertTrue({'_TABLE_COLUMNS_CACHE', '_TABLE_EXISTS_CACHE', '_LEARNER_SCHEMA_COLUMNS'} <= names)
        for path in ('database_reads.py', 'storage_context.py'):
            source = (ROOT / 'catalogue/infrastructure' / path).read_text()
            imports = [n for n in ast.walk(ast.parse(source)) if isinstance(n, (ast.Import, ast.ImportFrom))]
            self.assertFalse(any('views' in ast.unparse(n) or 'application' in ast.unparse(n) for n in imports))
        ksb = (ROOT / 'ksb_mapping_placement.py').read_text().split('# Writes:')[0]
        self.assertNotIn('from . import views', ksb)

    def test_exact_query_parameters_results_and_exception_parity(self):
        for original in (True, False):
            env = namespace(original)
            db = FakeConnection([(1, 'x'), (2, None)], ('id', 'value'))
            env['connection'] = db
            self.assertEqual(env['fetch_all']('select synthetic where id = %s', [3]),
                             [{'id': 1, 'value': 'x'}, {'id': 2, 'value': None}])
            self.assertEqual(db.calls, [('select synthetic where id = %s', [3])])
            db.error = True
            with self.assertRaisesRegex(RuntimeError, 'synthetic read failure'):
                env['fetch_all']('select synthetic')
            self.assertEqual(db.calls[-1][1], [])
            for vendor in ('postgresql', 'sqlite'):
                db.vendor = vendor
                self.assertEqual(env['table_name']('a"b'), '"curriculum"."a""b"' if vendor == 'postgresql' else '"a""b"')
                self.assertEqual(env['authoring_table_name']('modules'), env['table_name']('modules'))
            self.assertEqual(env['curriculum_in_clause']('id', ['', None, ' X ', 'X', 0]),
                             ('"id" in (%s, %s)', [' X ', 'X']))

    def test_schema_cache_fill_reuse_native_scope_and_missing_tables(self):
        for original in (True, False):
            env = namespace(original)
            db = FakeConnection([('modules', 'module_catalogue_id'), ('modules', 'status')], ('table_name', 'column_name'))
            env['connection'] = db
            self.assertEqual(env['column_names']('modules'), {'module_catalogue_id', 'status'})
            self.assertEqual(env['column_names']('modules'), {'module_catalogue_id', 'status'})
            self.assertEqual(len(db.calls), 1)
            db.rows, db.description = [('id',)], [('column_name',)]
            self.assertEqual(env['column_names']('unknown'), {'id'})
            self.assertEqual(db.calls[-1][1], ['curriculum', 'unknown'])
            self.assertTrue(env['_TABLE_COLUMNS_LISTED'])
            self.assertTrue(env['has_column']('modules', 'status'))
            with storage_context.native_authoring_scope():
                # The native contract is pure data; no schema probe takes place.
                from curriculum_api.free_course_contract import COLUMNS
                table = next(iter(COLUMNS))
                count = len(db.calls)
                self.assertEqual(env['column_names'](table), {n for n, _ in COLUMNS[table]})
                self.assertEqual(len(db.calls), count)

    def test_learner_cache_success_failure_ttl_and_reset_parity(self):
        for original in (True, False):
            env = namespace(original)
            db = FakeConnection([(1,)])
            env['connection'] = db
            self.assertTrue(env['learner_schema_table_exists']('synthetic'))
            self.assertTrue(env['learner_schema_table_exists']('synthetic'))
            self.assertEqual(len(db.calls), 1)
            self.assertTrue(env['learner_relation_exists']('synthetic'))
            db.rows = [('id',)]
            clock = SimpleNamespace(monotonic=lambda: 10)
            env['time'] = clock
            self.assertEqual(env['learner_schema_columns']('synthetic'), {'id'})
            db.rows = [('new_id',)]
            self.assertEqual(env['learner_schema_columns']('synthetic'), {'id'})
            clock.monotonic = lambda: 311
            self.assertEqual(env['learner_schema_columns']('synthetic'), {'new_id'})
            env['reset_learner_schema_cache']()
            self.assertEqual(env['_LEARNER_SCHEMA_COLUMNS'], {})
            db.error = True
            # Both wrapper layouts delegate to the current schema reader.
            # Their failure contract must stay consistent after the fix.
            from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
            for name in ('learner_schema_table_exists', 'learner_schema_columns'):
                with self.assertRaises(CatalogueReadUnavailable):
                    env[name]('missing')
            with self.assertRaises(RuntimeError):
                env['learner_relation_exists']('missing')

    def test_storage_scope_nested_and_exception_restoration(self):
        self.assertFalse(storage_context.native_only())
        with self.assertRaises(ValueError), storage_context.native_authoring_scope():
            self.assertTrue(storage_context.native_only())
            with storage_context.native_authoring_scope():
                self.assertTrue(storage_context.native_only())
            self.assertTrue(storage_context.native_only())
            raise ValueError('synthetic')
        self.assertFalse(storage_context.native_only())

    def test_storage_context_does_not_leak_between_requests(self):
        isolated = Context()
        with storage_context.native_authoring_scope():
            self.assertTrue(storage_context.native_only())
            self.assertFalse(isolated.run(storage_context.native_only))
        self.assertFalse(isolated.run(storage_context.native_only))

    def test_read_scope_retains_memo_key_and_missing_probe_semantics(self):
        from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
        for original in (True, False):
            env = namespace(original)
            db = FakeConnection([])
            env['connection'] = db
            with curriculum_read_scope():
                self.assertFalse(env['learner_schema_table_exists']('missing'))
                self.assertFalse(env['learner_schema_table_exists'](table='missing'))
                self.assertEqual(len(db.calls), 1)
            self.assertFalse(env['learner_schema_table_exists']('missing'))
            self.assertEqual(len(db.calls), 2)


if __name__ == '__main__':
    unittest.main()
