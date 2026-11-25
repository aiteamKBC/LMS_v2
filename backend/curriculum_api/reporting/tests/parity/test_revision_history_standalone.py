"""Frozen-source parity for revision rules/readers; stdlib and synthetic values only.

The legacy composition module is parsed, never imported. Only the reviewed
function definitions enter its synthetic namespace. No Django or settings load.
"""
import ast
from contextlib import contextmanager
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
SNAPSHOT = json.loads((ROOT / 'reporting/tests/fixtures/legacy_snapshots/revision_history_snapshot.json').read_text(encoding='utf-8'))
NOW = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)


class Rows:
    """A synthetic cursor with observed SQL; no driver or connection capability."""
    vendor = 'postgresql'

    def __init__(self, rows=(), columns=(), failure=False):
        self.rows = rows
        self.description = [(c,) for c in columns]
        self.failure = failure
        self.calls = []

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, query, params=None):
        self.calls.append((query, deepcopy(params)))
        if self.failure:
            raise ValueError('synthetic unavailable store')

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


def namespace(original):
    ns = dict(json=json, hashlib=hashlib, re=re, Decimal=Decimal, date=date,
              datetime=datetime, timedelta=timedelta, timezone=timezone,
              __package__='curriculum_api', _AVAILABLE={}, logger=Mock(), connection=Rows())
    for item in SNAPSHOT['constants'].values():
        exec(compile(item['source'], '<original-contract>', 'exec'), ns)
    if original:
        sources = [item['source'] for item in SNAPSHOT['functions'].values()]
    else:
        tree = ast.parse((ROOT / 'versioning.py').read_text(encoding='utf-8-sig'))
        sources = [ast.unparse(n) for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in SNAPSHOT['functions']]
    for source in sources:
        exec(compile(source, '<original>' if original else '<current-wrapper>', 'exec'), ns)
    return ns


class RevisionParity(unittest.TestCase):
    exercised = set()

    @classmethod
    def tearDownClass(cls):
        missing = set(SNAPSHOT['functions']) - cls.exercised
        print('Revision functions compared:', len(cls.exercised), '/', len(SNAPSHOT['functions']), 'uncovered:', sorted(missing))
        if missing:
            raise AssertionError('Uncompared owners: ' + repr(missing))

    def setUp(self):
        self.old, self.new = namespace(True), namespace(False)

    def compare(self, name, *args, raises=False, **kwargs):
        def invoke(ns, arguments, keywords):
            try:
                result = ns[name](*arguments, **keywords)
                return ('return', type(result).__name__, result)
            except Exception as exc:
                return ('raise', type(exc).__name__, str(exc))
        old_args, new_args = deepcopy(args), deepcopy(args)
        expected = invoke(self.old, old_args, deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT['functions'][name]['owner'])
        with patch.object(owner, name, wraps=getattr(owner, name)) as called:
            actual = invoke(self.new, new_args, deepcopy(kwargs))
        self.assertGreater(called.call_count, 0, name)
        self.assertEqual(actual, expected, name)
        self.assertEqual(old_args, new_args, name)
        self.assertEqual(self.old['_AVAILABLE'], self.new['_AVAILABLE'])
        self.assertEqual(self.old['connection'].calls, self.new['connection'].calls)
        self.assertEqual(self.old['logger'].mock_calls, self.new['logger'].mock_calls)
        if not raises:
            self.assertEqual(actual[0], 'return', actual)
        self.exercised.add(name)
        return actual[2]

    def rows(self, rows=(), columns=(), vendor='postgresql', failure=False):
        for ns in (self.old, self.new):
            ns['connection'] = Rows(rows, columns, failure)
            ns['connection'].vendor = vendor
            ns['_AVAILABLE'].clear()

    def test_normalization_empty_malformed_and_unicode_values(self):
        for value in (None, '', 0, False, ' \t\u2002A\u3000', '[]', '{}', '[1]', '{"x":1}', 'broken', [], {}):
            for name in ('clean', 'as_list', 'as_dict', 'parse_json_column'):
                self.compare(name, value)
        for value in (Decimal('2.00'), NOW, date(2026, 11, 21), {1: (Decimal('1.5'), NOW)}, object()):
            # A generic object has identity-bearing repr; use a deterministic
            # unknown-driver value instead in that final case.
            if type(value) is object:
                value = complex(1, 2)
            self.compare('jsonable', value)

    def test_metadata_allowlist_size_limits_and_url_secrets(self):
        for value in (None, [], {'password': 'synthetic', 'note': 'allowed'},
                      {'filename': 'https://files.example.test/a?secret=synthetic#token', 'row_count': 3},
                      {'note': 'x' * 500}, {key: 'x' * 200 for key in self.old['METADATA_KEYS']}):
            self.compare('safe_metadata', value)
        self.assertEqual(self.compare('safe_metadata', {'filename': '/a?signature=synthetic'}), {'filename': '/a'})

    def test_recursive_redaction_and_display_privacy(self):
        value = {'items': ['/a?sig=synthetic', 'https://example.test/a#secret', None, {'b': ('/b?x=1',)}]}
        self.compare('strip_credentials', value)
        for value in (None, '', {'n': Decimal('2')}, 'synthetic secret'):
            self.compare('redacted', value)
        for ns in (self.old, self.new):
            ns['REDACTED_COLUMNS']['synthetic'] = {'secret'}
        self.assertEqual(self.compare('audit_display_value', 'synthetic', 'secret.child', 'value'), 'redacted:hidden')
        self.compare('audit_display_value', 'synthetic', 'url', '/a?sig=synthetic')

    def test_snapshot_shape_nulls_settings_and_unknown_entities(self):
        for entity in ('component', 'module', 'week', 'unknown'):
            for row in (None, {}, {'id': 'C', 'title': 'Synthetic', 'expected_otjh': Decimal('2.0'),
                                  'settings_json': '{"version":"0.1","url":"/a?sig=synthetic"}',
                                  'ksb_mappings': '["K1"]', 'extra': 'ignored'}):
                self.compare('build_snapshot', entity, row)
        for value in (None, [], {'version': '0.1', 'url': '/a'}):
            self.compare('logged_settings', value)
            self.compare('logged_view', 'component', {'settings_json': value})
        self.compare('logged_view', 'component', None)

    def test_diff_fields_text_limits_reverts_and_duplicates(self):
        for value in (None, '', 1, ['x'] * 200, 'x' * 201):
            self.compare('short', value)
        for value in (None, [' A@EXAMPLE.TEST ', 'a@example.test'], 'a@example.test,b@example.test', '["a@example.test"]'):
            self.compare('people_in', value)
        for field in ('title', 'description', 'settings.contentHtml', 'settings.version'):
            self.compare('is_text_field', field, '', 'new')
            self.compare('change_entry', field, '', 'new')
        for before, after in ((None, None), ({'title': 'A'}, {'title': 'B'}),
                              ({'settings_json': {'version': '1', 'updatedAt': 1}}, {'settings_json': {'version': '2', 'updatedAt': 2}}),
                              ({'_context': {'name': 'A'}}, {'_context': {'name': 'B'}})):
            self.compare('diff_snapshots', before, after)
        self.compare('diff_settings', {'version': '1'}, {'version': '2', 'lastEdited': 3})
        early = [{'field': 'title', 'from': 'A', 'to': 'B'}]
        late = [{'field': 'title', 'from': 'B', 'to': 'A'}, {'field': '', 'from': 1, 'to': 2}]
        self.assertEqual(self.compare('merge_changes', early, late), [])

    def test_ancestry_names_are_historical_and_registries_are_inputs(self):
        snapshot = {'programme_id': ' P ', 'programme_name': 'Old programme', 'cohort_id': 'C', 'group_id': 'G',
                    'module_catalogue_id': 'M', 'week_id': 'W', 'component_id': 'X', 'title': 'Title',
                    'settings_json': {'version': '0.1', 'contentStatus': 'Draft'}}
        for entity in ('programme', 'cohort', 'group', 'module', 'week', 'component', 'ksb_mapping', 'module_details', 'unknown'):
            self.compare('entity_facts', entity, snapshot)
            self.compare('context_for', entity, snapshot, {'M': {'programme_name': 'Historical', 'module_name': 'Old'}})
        for ns in (self.old, self.new):
            ns['ENTITY_CONTEXT_FIELDS']['synthetic'] = ('programme_name',)
        self.compare('context_for', 'synthetic', snapshot, {})
        self.compare('snapshot_title', snapshot, ('title', 'absent', 'programme_name'), join=' / ')
        self.compare('snapshot_title', snapshot, '')

    def test_file_events_and_lifecycle_precedence(self):
        for before, after in (('', 'a.pdf'), ('a.pdf', ''), ('a.pdf', 'b.pdf'), ('', '')):
            change = [{'field': 'settings.uploadedFileName', 'from': before, 'to': after}]
            action = self.compare('resolve_file_action', change)
            self.compare('file_metadata', action, {'settings_json': {'uploadedFileName': after, 'uploadedFileContentType': 'application/pdf', 'uploadedFileSize': 12}},
                         {'settings_json': {'uploadedFileName': before}})
        for entity in ('module', 'unknown'):
            for state in ({}, {'status': 'archived'}, {'deleted_at': NOW}, {'is_archived': True}):
                self.compare('snapshot_archived', state, entity)
                for previous in (None, {'snapshot': {}}, {'snapshot': {'status': 'archived'}}):
                    for fields in ([], [{'field': 'week_number'}], [{'field': 'programme_id'}], [{'field': 'title'}]):
                        self.compare('resolve_action', entity, state, previous, fields)

    def test_unknown_origins_and_context_only_changes(self):
        for item in ({}, {'created_at': NOW, 'updated_at': NOW + timedelta(microseconds=30)},
                     {'created_at': NOW, 'updated_at': NOW + timedelta(seconds=1)},
                     {'created_at': ' x ', 'updated_at': 'x'}, {'created_at': None, 'updated_at': 'x'}):
            self.compare('looks_newly_created', item)
        self.compare('strip_context', {'_context': {'name': 'renamed'}, 'title': 'unchanged'})
        self.compare('strip_context', None)

    def test_store_availability_positive_only_cache_and_reset(self):
        for vendor in ('postgresql', 'sqlite'):
            self.rows([(True,)], vendor=vendor)
            self.compare('qualified', 'record_revisions')
            self.assertTrue(self.compare('history_available'))
            self.compare('history_available')
            self.assertEqual(len(self.new['connection'].calls), 1)
            self.compare('reset_availability')
            self.rows([(False,)], vendor=vendor)
            self.assertFalse(self.compare('history_available'))
            self.rows(failure=True, vendor=vendor)
            self.assertFalse(self.compare('history_available'))

    def test_metadata_capability_query_and_cache(self):
        self.rows([(5,)])
        self.assertTrue(self.compare('metadata_columns_available'))
        self.compare('metadata_columns_available')
        self.rows([(0,)])
        self.assertFalse(self.compare('metadata_columns_available'))
        self.rows([(i, c) for i, c in enumerate(self.old['METADATA_COLUMNS'])], vendor='sqlite')
        self.assertTrue(self.compare('metadata_columns_available'))
        self.rows(failure=True)
        self.assertFalse(self.compare('metadata_columns_available'))

    def test_latest_revision_deduplication_json_and_both_dialects(self):
        columns = ('entity_id', 'id', 'revision_no', 'snapshot')
        for vendor in ('postgresql', 'sqlite'):
            self.rows([('E', 1, 1, '{}'), ('E', 2, 2, '{"title":"Newest"}'), ('E', 3, 1, '{}')], columns, vendor)
            for ns in (self.old, self.new):
                ns['metadata_columns_available'] = lambda: False
            result = self.compare('latest_revisions', 'module', [' E ', 'E', None, ''])
            self.assertEqual(result['E']['id'], 2)
            self.compare('latest_revisions', 'module', [])

    def test_ancestry_query_deduplication_empty_and_failure(self):
        self.rows([('M', 'Old module', 'P', 'Old programme', None, None, 'G', 'Old group')],
                  ('module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name'))
        self.compare('resolve_ancestry', ['M', ' M ', '', None])
        self.compare('resolve_ancestry', [])
        self.rows(failure=True)
        self.assertEqual(self.compare('resolve_ancestry', ['M']), {})

    def test_publish_count_read_empty_and_failure(self):
        self.rows([(3,)])
        self.assertEqual(self.compare('module_publish_count', 'M'), 3)
        self.rows()
        self.assertEqual(self.compare('module_publish_count', 'M'), 0)
        self.rows(failure=True)
        self.compare('module_publish_count', 'M', raises=True)


class ArchitectureContracts(unittest.TestCase):
    def test_exact_original_bodies_and_public_signatures(self):
        current = {n.name: n for n in ast.parse((ROOT / 'versioning.py').read_text(encoding='utf-8')).body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            owner = ROOT.parent / (entry['owner'].replace('.', '/') + '.py')
            new = next(n for n in ast.parse(owner.read_text(encoding='utf-8')).body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body], name)
            self.assertEqual(ast.dump(old.args), ast.dump(current[name].args), name)

    def test_domain_imports_and_capabilities_are_framework_free(self):
        for entry in SNAPSHOT['functions'].values():
            if '.domain.' not in entry['owner']:
                continue
            tree = ast.parse((ROOT.parent / (entry['owner'].replace('.', '/') + '.py')).read_text(encoding='utf-8'))
            self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree)))
            self.assertFalse(set(entry['dependencies']) & {'connection', 'transaction', 'logger', 'settings', 'JsonResponse'})
        self.assertNotIn('django', sys.modules)

    def test_constants_reexport_the_same_registry_objects(self):
        contracts = importlib.import_module('curriculum_api.reporting.domain.revision_contracts')
        namespace = {}
        tree = ast.parse((ROOT / 'versioning.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.ImportFrom) and node.module == 'reporting.domain.revision_contracts':
                for alias in node.names:
                    namespace[alias.name] = getattr(contracts, alias.name)
        self.assertEqual(set(namespace), set(SNAPSHOT['constants']))
        for name in namespace:
            self.assertIs(namespace[name], getattr(contracts, name))

    def test_merge_policy_moved_exactly_and_public_identity_is_preserved(self):
        self.assertEqual((ROOT / 'catalogue/domain/module_merge.py').read_text(encoding='utf-8'), SNAPSHOT['merge_source'])
        public = importlib.import_module('curriculum_api.module_merge')
        owner = importlib.import_module('curriculum_api.catalogue.domain.module_merge')
        for name in ('ModuleMergeConflicts', 'ModuleMergeUnavailable', 'merge_partial_save', 'fingerprint', 'restore_conflicts', '_ABSENT', '_SAME_BASE'):
            self.assertIs(getattr(public, name), getattr(owner, name))

    def test_http_adapter_has_no_sql_literals_and_application_has_no_http(self):
        tree = ast.parse((ROOT / 'reporting/api/history.py').read_text(encoding='utf-8'))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str):
                self.assertFalse(re.search(r'\b(select|group by|order by|where)\b', node.value, re.I), node.value)
        text = (ROOT / 'reporting/application/history_results.py').read_text(encoding='utf-8')
        self.assertNotIn('JsonResponse', text)
        self.assertNotIn('request.GET', text)


if __name__ == '__main__':
    unittest.main(verbosity=2)
