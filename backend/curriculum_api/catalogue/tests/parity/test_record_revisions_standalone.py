"""Source fidelity and standalone record-revision contracts; no Django startup."""
import ast
from copy import deepcopy
from functools import lru_cache
import importlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT.parent.parent))
from curriculum_api.catalogue.infrastructure import record_revisions as reader
from curriculum_api.catalogue.application import record_revisions as application
from curriculum_api.catalogue.domain.structure_revision import revision_digest

SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/record_revisions_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


class RecordRevisionContracts(unittest.TestCase):
    def test_extracted_bodies_match_the_actual_original_source(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), entry['new_name'])
            if name == 'record_revision':
                digest = function(ROOT / 'domain/structure_revision.py', 'revision_digest')
                self.assertEqual(ast.dump(old.body[-1]), ast.dump(digest.body[0]))
                self.assertEqual(ast.unparse(new.body[-1]), 'return revision_digest(material)')
                new.body[-1] = digest.body[0]
            if name == 'curriculum_record_revisions':
                source = ast.unparse(new).replace('values_for_kind(kind)', 'request.GET.getlist(kind)')
                new = ast.parse(source).body[0]
                self.assertEqual(ast.dump(new.body[-1].value), ast.dump(old.body[-1].value.args[0]))
                new.body[-1] = old.body[-1]
            with self.subTest(function=name):
                self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_legacy_signatures_decorators_and_bindings(self):
        self.assertEqual(len(SNAPSHOT), 11)
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            call = wrapper.body[-1].value
            if name == 'curriculum_record_revisions':
                self.assertEqual(ast.unparse(call.func), 'JsonResponse')
                call = call.args[0]
            self.assertEqual([ast.unparse(a) for a in call.args],
                ['request.GET.getlist'] if name == 'curriculum_record_revisions' else [a.arg for a in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, {d: d for d in entry['deps']})

    def test_new_modules_import_only_domain_and_have_no_cycles(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            imported = importlib.import_module(module)
            nodes = tree(Path(imported.__file__))
            for node in ast.walk(nodes):
                self.assertNotIsInstance(node, ast.Import)
                if isinstance(node, ast.ImportFrom):
                    self.assertEqual((node.level, node.module), (2, 'domain.structure_revision'))
        self.assertNotIn('django', sys.modules)


class RecordReadParity(unittest.TestCase):
    def compare(self, sources, rows, failure=None):
        import hashlib
        events = []
        def fetch(table, where, params, **kwargs):
            events.append((table, where, deepcopy(params), deepcopy(kwargs)))
            if table == failure:
                raise RuntimeError('synthetic read failure')
            return [{k: deepcopy(v) for k, v in row.items() if k not in kwargs['exclude_columns']} for row in rows[table]]
        deps = dict(authoring_fetch_all=fetch, STRUCTURE_REVISION_VOLATILE_COLUMNS=('created_at', 'updated_at'),
                    logger=Mock(), clean_str=lambda v: str(v or '').strip())
        env = dict(deps, hashlib=hashlib, json=json)
        exec(compile(SNAPSHOT['record_revision']['source'], '<actual-original-record-revision>', 'exec'), env)
        before = deepcopy((sources, rows))
        expected = env['record_revision'](sources)
        original_events = deepcopy(events)
        events.clear()
        actual = reader.record_revision(sources, **deps)
        self.assertEqual(actual, expected)
        self.assertEqual(events, original_events)
        self.assertEqual((sources, rows), before)
        return actual, events

    def test_read_scope_order_timestamps_and_duplicates(self):
        sources = [('header', 'headers', 'id = %s', ['M'], 'id'),
                   ('items', 'items', 'owner = %s', ['M'], 'id')]
        rows = {'headers': [{'id': 'M', 'title': 'محتوى 🙂', 'updated_at': 'a'}],
                'items': [{'id': ' B ', 'value': None}, {'id': 'A', 'value': {'x': ['', 0]}}]}
        revision, events = self.compare(sources, rows)
        self.assertEqual(events[0][3], {'ensure_tables': False, 'exclude_columns': ('created_at', 'updated_at')})
        rows['headers'][0]['updated_at'] = 'b'
        rows['items'].reverse()
        self.assertEqual(self.compare(sources, rows)[0], revision)
        rows['items'].append(deepcopy(rows['items'][0]))
        self.assertNotEqual(self.compare(sources, rows)[0], revision)

    def test_missing_primary_row_empty_child_and_read_error_states(self):
        sources = [('header', 'headers', 'id = %s', ['M'], 'id'), ('items', 'items', '', [], 'id')]
        rows = {'headers': [], 'items': [{'id': 'child'}]}
        self.assertEqual(self.compare(sources, rows), ('', [('headers', 'id = %s', ['M'],
            {'ensure_tables': False, 'exclude_columns': ('created_at', 'updated_at')})]))
        rows = {'headers': [{'id': 'M'}], 'items': []}
        self.assertEqual(len(self.compare(sources, rows)[0]), 32)
        for table in ('headers', 'items'):
            self.assertEqual(self.compare(sources, rows, failure=table)[0], '')
        self.assertEqual(self.compare([], {})[0], revision_digest([]))

    def test_batch_deduplication_retains_kind_and_identifier_order(self):
        calls = []
        kinds = {'programme': object(), 'cohort': object(), 'weekTemplate': object()}
        values = {'programme': [' P ', '', 'P', 'Q'], 'cohort': ['\u3000C\t', 'C', 'missing']}
        result = application.read_record_revisions(lambda k: values.get(k, []),
            CURRICULUM_RECORD_REVISIONS=kinds, unique=lambda xs: list(dict.fromkeys(xs)),
            clean_str=lambda v: str(v or '').strip(),
            curriculum_record_revision=lambda k, v: calls.append((k, v)) or ('' if v == 'missing' else 'rev-'+v))
        self.assertEqual(calls, [('programme', 'P'), ('programme', 'Q'), ('cohort', 'C'), ('cohort', 'missing')])
        self.assertEqual(result, {'revisions': {'programme': {'P': 'rev-P', 'Q': 'rev-Q'},
            'cohort': {'C': 'rev-C', 'missing': ''}}})


if __name__ == '__main__':
    unittest.main()
