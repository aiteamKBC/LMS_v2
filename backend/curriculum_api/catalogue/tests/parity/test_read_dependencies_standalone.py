"""Actual closed read imports and frozen-source parity, with no application startup."""
import ast
import calendar
import copy
from datetime import date, datetime, timedelta, timezone
import hashlib
import importlib
import importlib.util
import inspect
import json
from pathlib import Path
import re
import sys
import unittest

spec = importlib.util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def owner_module(name):
    return importlib.import_module('curriculum_api.' + name)


def public_exports():
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
    nodes = [n for n in tree.body if ast.dump(n) in SNAPSHOT['exports']]
    namespace = {'__package__': 'curriculum_api'}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-read-exports>', 'exec'), namespace)
    return namespace


def original_exports():
    namespace = dict(json=json, re=re, calendar=calendar, date=date, datetime=datetime,
                     timedelta=timedelta, timezone=timezone)
    for source in SNAPSHOT['constants'].values():
        exec(compile(source, '<original-constant>', 'exec'), namespace)
    owners = {}
    for name, entry in SNAPSHOT['selection'].items():
        owner = entry['owner']
        if entry['kind'] == 'wrapper' and owner not in owners:
            env = {'__name__': 'original_' + owner,
                   '__package__': 'curriculum_api.' + owner.rsplit('.', 1)[0]}
            exec(compile(SNAPSHOT['owners'][owner]['source'], '<original-owner>', 'exec'), env)
            owners[owner] = env
        fn = ast.parse(SNAPSHOT['functions'][name]['source']).body[0]
        if entry['kind'] == 'wrapper':
            index = next(i for i, node in enumerate(fn.body) if isinstance(node, ast.ImportFrom))
            imp = fn.body[index]
            original_name = '_original_' + name
            namespace[original_name] = owners[owner][name]
            fn.body[index] = ast.Assign(targets=[ast.Name(id=imp.names[0].asname or name, ctx=ast.Store())],
                                    value=ast.Name(id=original_name, ctx=ast.Load()))
        exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), '<original-public-function>', 'exec'), namespace)
    return namespace


class ReadDependencyContracts(unittest.TestCase):
    def test_unchanged_bodies_and_every_unrelated_views_statement(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '924006cefd2e6b722dcecbaeeeacde523b610925f464a8ecd5b48a45899a68c3')
        restored = oracle.source_tree(ROOT / 'views.py')
        self.assertEqual(hashlib.sha256(ast.dump(restored).encode()).hexdigest(), SNAPSHOT['views_ast_sha256'])
        for owner, entry in SNAPSHOT['owners'].items():
            path = ROOT / (owner.replace('.', '/') + '.py')
            from curriculum_api.catalogue.tests.parity.required_read_assertions import assert_module_contract
            assert_module_contract(self, ast.parse(entry['source']), oracle.source_tree(path))
        for name, entry in SNAPSHOT['selection'].items():
            if entry['kind'] != 'raw':
                continue
            actual = next(n for n in ast.parse((ROOT / (entry['owner'].replace('.', '/') + '.py')).read_text(encoding='utf-8')).body
                          if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(ast.dump(actual), ast.dump(ast.parse(SNAPSHOT['functions'][name]['source']).body[0]))

    def test_reexports_are_actual_owner_objects_and_existing_calls_remain_compatible(self):
        exports = public_exports()
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8'))
        remaining = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['selection'].items():
            self.assertNotIn(name, remaining)
            self.assertIs(exports[name], getattr(owner_module(entry['owner']), name))
            old = ast.parse(SNAPSHOT['functions'][name]['source']).body[0]
            actual = inspect.signature(exports[name])
            expected = [a.arg for a in old.args.posonlyargs + old.args.args]
            expected += [old.args.vararg.arg] if old.args.vararg else []
            expected += [a.arg for a in old.args.kwonlyargs]
            expected += [old.args.kwarg.arg] if old.args.kwarg else []
            self.assertEqual(list(actual.parameters)[:len(expected)], expected, name)
            for parameter in list(actual.parameters.values())[len(expected):]:
                self.assertIs(parameter.kind, inspect.Parameter.KEYWORD_ONLY)
                self.assertIsNot(parameter.default, inspect.Parameter.empty)

    def test_defaults_resolve_to_concrete_leaf_owners_and_keep_explicit_override_contracts(self):
        for owner, entry in SNAPSHOT['owners'].items():
            module = owner_module(owner)
            for name, dependencies in entry['defaults'].items():
                actual = getattr(module, name)
                for dependency, default_name in dependencies.items():
                    self.assertIn(dependency, actual.__kwdefaults__)
                    self.assertIs(actual.__kwdefaults__[dependency], getattr(module, default_name))
                    if dependency in SNAPSHOT['selection']:
                        expected = getattr(owner_module(SNAPSHOT['selection'][dependency]['owner']), dependency)
                        self.assertIs(actual.__kwdefaults__[dependency], expected)
        function = owner_module('catalogue.domain.content_validation').component_expected_otjh
        self.assertEqual(function({'expectedOtjh': '2'}, parse_float=lambda value, default: 17), 17)

    def test_reduced_wrappers_only_drop_verified_concrete_defaults(self):
        from curriculum_api.catalogue.tests.parity.authoring_composition_oracle import restore_tree
        tree = restore_tree(ast.parse((ROOT / 'views.py').read_text(encoding='utf-8')), 'views.py')
        functions = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT['functions'].items():
            if entry['kind'] != 'reduced':
                continue
            expected = ast.parse(entry['source']).body[0]
            expected.body[-1].value.keywords = [k for k in expected.body[-1].value.keywords if k.arg not in entry['dropped']]
            self.assertEqual(ast.dump(functions[name]), ast.dump(expected), name)

    def test_real_import_closure_is_framework_and_side_effect_free(self):
        for owner in SNAPSHOT['owners']:
            module = owner_module(owner)
            self.assertNotIn('views', vars(module))
            self.assertNotIn('settings', vars(module))
        self.assertFalse({'django', 'psycopg', 'psycopg2', 'requests', 'redis'} & set(sys.modules))
        self.assertNotIn('curriculum_api.views', sys.modules)

    def test_frozen_original_semantics_for_normalization_identity_and_projection(self):
        old, new = original_exports(), public_exports()
        cases = []
        for value in (None, '', ' \t\u001f\u2003MOD-X\u3000 ', 0, '0', 'false', 'YES', 'NaN', '3.75', [], {}):
            for name in ('clean_str', 'parse_int', 'parse_float', 'normalise', 'truthy', 'falsey', 'normalise_component_type'):
                cases.append((name, (value,), {}))
        cases += [
            ('parse_json_value', (value, {'missing': True}), {}) for value in (None, '', '[]', '{"x": 0}', 'broken', [], {})
        ]
        cases += [
            ('programme_config_identity', ({'programme_id': ' P ', 'program_id': 'OTHER'},), {}),
            ('programme_identity', ({'Program': 'Synthetic', '_meta': {'program_id': 'P'}}, {'P': {'programme_id': 'P', 'name': 'Saved'}}), {}),
            ('programme_identity', ({'Program': 'Synthetic'}, {}), {}),
            ('curriculum_identifier_candidates', (' MOD-X ',), {}),
            ('module_row_belongs_to_group', ({'group_id': ' G '}, {'group_id': 'G'}), {}),
            ('unique', (['X', '', 'X', None, 'Y'],), {}),
            ('holiday_date_set', ([{'start_date': '2028-01-01', 'end_date': '2028-01-03'}],), {}),
            ('parse_date', ('not-a-date',), {}),
            ('parse_date', ('2028-02-29',), {}),
            ('parse_clock_minutes', ('11:30 PM',), {}),
            ('schedule_day_part', ('Monday 09:00-11:00',), {}),
            ('component_expected_otjh', ({'expectedOtjh': '0.125'},), {}),
            ('component_coach_validation', ({'coachValidation': 'false'},), {}),
            ('component_settings_defaults', ('reading',), {}),
            ('default_completion_payload', (), {}),
            ('advanced_response', ({'x': 1},), {}),
            ('active_components_payload', ([{'type': 'reading'}, {'type': 'unknown'}],), {}),
            ('curriculum_module_from_authoring_payload', ({'catalogueId': 'M', 'title': 'Synthetic', 'weeks': 0},), {}),
        ]
        def outcome(fn, args, kwargs):
            try:
                value = fn(*args, **kwargs)
                return ('return', repr(value) if isinstance(value, float) and value != value else value)
            except Exception as error:
                return ('raise', type(error).__name__, str(error))
        for name, args, kwargs in cases:
            with self.subTest(symbol=name, args=args):
                a, b = copy.deepcopy(args), copy.deepcopy(args)
                ka, kb = copy.deepcopy(kwargs), copy.deepcopy(kwargs)
                self.assertEqual(outcome(old[name], a, ka), outcome(new[name], b, kb))
                self.assertEqual((a, ka), (b, kb))
        self.assertEqual(len(cases), 102)


if __name__ == '__main__':
    unittest.main()
