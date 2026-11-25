"""Source/dependency verification for component catalogue extraction; no Django."""
import ast
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/component_catalogue_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class ComponentCatalogueContracts(unittest.TestCase):
    def test_eleven_bodies_preserve_behavior_except_reviewed_corrections(self):
        self.assertEqual(len(SNAPSHOT), 11)
        for name, entry in SNAPSHOT.items():
            source = entry['source']
            if name == 'library_component_where':
                source = source.replace('wanted_origins = wanted_origins & set(LIBRARY_ORIGINS) or set(LIBRARY_ORIGINS)', 'wanted_origins = wanted_origins & set(LIBRARY_ORIGINS) if wanted_origins else set(LIBRARY_ORIGINS)')
                source = source.replace("clauses.append('(' + ' or '.join(", "clauses.append('(' + (' or '.join(").replace("        ) + ')')", "        ) or '1 = 0') + ')')")
            if entry['special'] == 'normalized_ksb':
                source = source.replace('authoring_table_name(table)', 'read_source(table)').replace('if not wanted or not table_exists(table):', 'if not wanted:')
            if entry['special'] == 'missing_week':
                source = source.replace("row.get('title') or 'Week 1'", "row.get('title') or ''")
            if entry['special'] == 'library_page':
                source = source.replace(entry['query_source'],
                    '    component_rows = read_library_component_page(\n'
                    '        search=search, types=types, programme_ids=programme_ids, origins=origins,\n'
                    '        ids=ids, page=page, page_size=page_size, detail=detail,\n    )\n')
                source = source.replace("    wanted_programmes = {clean_str(value) for value in (programme_ids or []) if clean_str(value)}\n", '')
                source = source.replace("        if wanted_programmes and clean_str(module.get('programme_id')) not in wanted_programmes:\n            continue\n", '')
            old = ast.parse(source).body[0]
            new = deepcopy(function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name))
            class Restore(ast.NodeTransformer):
                def visit_Name(self, node):
                    return ast.parse(entry['attrs'][node.id], mode='eval').body if node.id in entry['attrs'] else node
            new = Restore().visit(new)
            with self.subTest(function=name):
                self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_public_signatures_and_wiring_are_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(new.args), ast.dump(old.args))
            self.assertEqual([ast.unparse(d) for d in new.decorator_list], entry['decorators'])
            call = new.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
            for dep in entry['deps'] + [a.arg for a in old.args.kwonlyargs]:
                self.assertEqual(keywords[dep], ast.unparse(ast.parse(entry['bindings'].get(dep, dep), mode='eval').body))
        entry = SNAPSHOT['library_component_rows']
        wrapper = function(ROOT.parent / 'views.py', 'library_component_rows').body[0]
        keywords = {k.arg: ast.unparse(k.value) for k in wrapper.body[-1].value.keywords}
        for dep in entry['page_deps']:
            self.assertEqual(keywords[dep], entry.get('page_bindings', {}).get(dep, dep))

    def test_sql_page_is_unchanged_besides_bound_programme_filter_before_limit(self):
        old = ast.parse('def original():\n' + SNAPSHOT['library_component_rows']['query_source']).body[0]
        new = deepcopy(function(ROOT / 'infrastructure/library_reads.py', 'read_library_component_page'))
        # The only new block is normalized programme selection ahead of paging.
        self.assertEqual(ast.unparse(new.body[2].targets[0]), 'wanted_programmes')
        self.assertEqual(ast.unparse(new.body[3].test), 'wanted_programmes')
        new.body[2:4] = []
        new.body[-1] = ast.Assign(targets=[ast.Name(id='component_rows', ctx=ast.Store())], value=new.body[-1].value)
        self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_import_direction_and_python_strip_set(self):
        for module in {entry['module'] for entry in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for n in ast.walk(tree(path)):
                self.assertNotIsInstance(n, ast.Import)
                if isinstance(n, ast.ImportFrom):
                    self.assertEqual((n.level, n.module), (0, 'collections'))
        node = next(n for n in tree(ROOT / 'infrastructure/library_reads.py').body if isinstance(n, ast.Assign))
        whitespace = ast.literal_eval(node.value)
        self.assertEqual(set(whitespace), {chr(i) for i in range(0x110000) if chr(i).isspace()})


if __name__ == '__main__':
    unittest.main()
