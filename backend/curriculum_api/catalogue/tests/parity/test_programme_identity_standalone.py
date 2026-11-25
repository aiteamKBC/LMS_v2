"""Standalone identity parity using original functions and AST-only helper closure."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import itertools
import json
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/programme_identity_snapshot.json').read_text())
SPEC = importlib.util.spec_from_file_location('identity_policy', ROOT / 'domain/programme_identity.py')
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)
OLD = {'datetime': datetime, 're': re}


def extracted(path, names, env):
    tree = _read_dependencies.source_tree(path)
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    assert {n.name for n in nodes} == set(names)
    assert all(not n.decorator_list for n in nodes)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<source-only-helper-closure>', 'exec'), env)


# Explicitly load only the required pure definitions, never module imports/setup.
constants = _read_dependencies.source_tree(ROOT.parent / 'curriculum_names.py')
OLD['INACTIVE_STATUSES'] = ast.literal_eval(next(n.value for n in constants.body
    if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'INACTIVE_STATUSES' for t in n.targets)))
extracted(ROOT.parent / 'curriculum_names.py', ['is_inactive'], OLD)
extracted(ROOT.parent / 'archive_state.py', ['row_inactive'], OLD)
OLD['archive_state'] = SimpleNamespace(row_inactive=OLD['row_inactive'])
extracted(ROOT.parent / 'views.py', ['clean_str', 'normalise', 'slugify', 'parse_int', 'truthy',
          'row_has_deleted_at', 'is_archived_program_config', 'programme_config_id'], OLD)
# This helper is now a legacy wrapper with a relative import. Keep the old
# oracle independent by loading its actual frozen pre-extraction definition.
hierarchy_snapshot = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/hierarchy_preparation_snapshot.json').read_text())
exec(compile(hierarchy_snapshot['program_config_by_id']['source'], '<original-program-config-index>', 'exec'), OLD)
for source in SNAPSHOT['functions'].values():
    exec(compile(source, '<frozen-original-policy>', 'exec'), OLD)


def result(fn, *args, **kwargs):
    try:
        return ('value', fn(*args, **kwargs))
    except Exception as error:
        return ('error', type(error), str(error))


class ProgrammeIdentityParity(unittest.TestCase):
    def compare(self, name, *args):
        before = deepcopy(args)
        expected = result(OLD[name], *args)
        actual = result(getattr(POLICY, name), *args,
                        **{key: OLD[key] for key in SNAPSHOT['dependencies'][name]})
        self.assertEqual(actual, expected)
        self.assertEqual(args, before)
        if actual[0] == 'value':
            return actual[1]

    def test_id_alias_precedence_and_whitespace(self):
        for values in itertools.product([None, '', 0, '  ', ' P\u2003'], repeat=3):
            self.compare('programme_config_identity', dict(zip(['programme_id','program_id','id'], values)))
        self.assertEqual(self.compare('programme_config_identity', {'programme_id':' P ', 'program_id':'Q', 'id':'R'}), 'P')
        self.assertEqual(self.compare('programme_config_identity', {'program_id':'Q', 'id':'R'}), 'Q')
        self.compare('programme_config_identity', None)

    def test_identity_id_name_rename_and_unassigned(self):
        configs = OLD['program_config_by_id']([
            {'programme_id':'P', 'program_id':'LEGACY', 'name':'Renamed Alpha'},
            {'programme_id':'Q','name':'Old Alpha'},
        ])
        rows = [{}, {'Program':'Old Alpha'}, {'Program':'Renamed Alpha'},
                {'Program':'Old Alpha', '_meta':{'program_id':'P'}},
                {'Program':'Old Alpha', '_meta':{'program_id':'missing'}},
                {'Program':'\u2003Old Alpha\t'}, {'Program':'???'},
                {'Program':'Old Alpha','_meta':{'program_id':0}}]
        for row in rows:
            value = self.compare('programme_identity', row, configs)
            if value['config'] is not None:
                self.assertTrue(any(value['config'] is c for c in configs.values()))
        self.assertEqual(self.compare('programme_identity', rows[3], configs)['sourceId'], 'P')

    def test_malformed_inputs_preserve_errors(self):
        for row in (None, [], '', {'_meta':None}, {'_meta':[]}, {'Program':['x']}):
            self.compare('programme_identity', row, {})
        for configs in (None, [None], ['bad']):
            self.compare('unique_program_configs_for_display', configs)

    def test_preference_timestamp_status_and_id(self):
        dates = [None, '', 'bad', '2026-01-02T03:04:05Z',
                 '2026-01-02T05:04:05+02:00', datetime(2026,1,2,tzinfo=timezone.utc)]
        for status, date, ident in itertools.product(['active','archived','inactive','DRAFT'], dates, ['2','bad',0]):
            self.compare('program_config_preference', {'id':ident,'status':status,'updated_at':date})
        self.compare('program_config_preference', None)

    def test_display_active_duplicates_archived_selection_and_ties(self):
        active = {'id':1,'name':'Alpha','status':'active'}
        same = {'id':2,'name':'A-l-p-h-a','status':'active'}
        archived = {'id':3,'name':'Alpha','status':'archived'}
        first = {'id':4,'name':'Beta','status':'archived','updated_at':'bad','marker':'first'}
        tied = dict(first, marker='second')
        unnamed = {'id':5,'name':'','status':'inactive'}
        for records in itertools.permutations([active,same,archived,first]):
            self.compare('unique_program_configs_for_display', list(records))
        output = self.compare('unique_program_configs_for_display', [archived,first,tied,unnamed,active,same])
        self.assertEqual(output, [active,same,first,unnamed])
        self.assertIs(output[2], first)
        self.assertEqual(self.compare('unique_program_configs_for_display', []), [])

    def test_archival_predicate_and_normalization_are_preserved(self):
        for marker in ({'deleted_at':'date'}, {'archived':'yes'}, {'status':' INACTIVE '},
                       {'archived':'false'}, {'is_active':False}):
            self.compare('unique_program_configs_for_display', [dict(name='Name', **marker), {'name':'Name','status':'active'}])

    def test_original_rule_bodies_preserved_except_internal_bindings(self):
        class RestoreInternalCalls(ast.NodeTransformer):
            def visit_Call(self, node):
                self.generic_visit(node)
                if isinstance(node.func, ast.Name) and node.func.id in ('programme_config_identity', 'program_config_preference'):
                    expected = {'programme_config_identity': {'clean_str'},
                                'program_config_preference': {'clean_str', 'parse_int', 'is_archived_program_config'}}[node.func.id]
                    assert {k.arg for k in node.keywords} == expected
                    assert all(isinstance(k.value, ast.Name) and k.value.id == k.arg for k in node.keywords)
                    node.keywords = []
                return node
        tree = _read_dependencies.source_tree(ROOT / 'domain/programme_identity.py')
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                original = ast.parse(SNAPSHOT['functions'][node.name]).body[0]
                restored = RestoreInternalCalls().visit(deepcopy(node))
                self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in restored.body])

    def test_no_outward_imports_and_compatible_wrappers(self):
        tree=_read_dependencies.source_tree(ROOT / 'domain/programme_identity.py')
        self.assertEqual([ast.unparse(n) for n in ast.walk(tree) if isinstance(n,(ast.Import,ast.ImportFrom))],
                         ['from datetime import datetime'])
        wrappers={n.name:n for n in _read_dependencies.source_tree(ROOT.parent / 'views.py').body if isinstance(n,ast.FunctionDef)}
        for name, source in SNAPSHOT['functions'].items():
            self.assertEqual(ast.dump(wrappers[name].args), ast.dump(ast.parse(source).body[0].args))
            self.assertEqual(wrappers[name].body[1].module, 'catalogue.domain.programme_identity')
            call=wrappers[name].body[2].value
            self.assertEqual({k.arg:ast.unparse(k.value) for k in call.keywords},
                             {key:key for key in SNAPSHOT['dependencies'][name]})


if __name__ == '__main__': unittest.main()
