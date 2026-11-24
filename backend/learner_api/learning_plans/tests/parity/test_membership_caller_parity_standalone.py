"""Source caller parity, not Django/SQL/HTTP integration.

Run directly with python -I -B. Only reviewed function definitions are compiled;
only their explicitly listed imports are removed. Readers/context/ORM are
synthetic doubles. The production policy body is never rewritten or copied.
"""
import ast
import builtins
import hashlib
import json
from collections import Counter, defaultdict
from contextlib import nullcontext
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from learner_api.learning_plans.domain.membership_policy import members_for_lineages as new_policy
from learner_api.learning_plans.application import module_membership
from curriculum_api.directory.application import status_queries
from curriculum_api.directory.domain.placement import scope_programme_identifier as placement_identifier
from curriculum_api.catalogue.domain.values import clean_str, normalise

SOURCES = {
    name: ast.parse((BACKEND / 'curriculum_api' / name).read_text(encoding='utf-8'))
    for name in ('views.py', 'learner_status_counts.py', 'attendance_membership.py')
}
# Follow the current direct exports; do not reconstruct a former implementation.
SOURCES['learner_status_counts.py'] = ast.Module(body=[
    node for relative in ('directory/domain/membership_values.py', 'directory/infrastructure/membership_runtime.py')
    for node in ast.parse((BACKEND / 'curriculum_api' / relative).read_text(encoding='utf-8')).body
    if isinstance(node, ast.FunctionDef)
], type_ignores=[])
# Frozen before Phase 1C: never regenerate this oracle from integrated code.
SNAPSHOT_BYTES = (Path(__file__).resolve().parents[1] / 'fixtures/legacy_snapshots/membership_preintegration_snapshot.json').read_bytes()
assert hashlib.sha256(SNAPSHOT_BYTES.replace(b'\r\n', b'\n')).hexdigest() == '24c360f42bbc158624275b853222d2fe2476cdb201b89fe264bea6764c593e51'
SNAPSHOT = json.loads(SNAPSHOT_BYTES)
SOURCES['preintegration'] = ast.parse('\n\n'.join(v['source'] for v in SNAPSHOT.values()))
SAFE_BUILTINS = {name: getattr(builtins, name) for name in (
    'str', 'int', 'set', 'frozenset', 'dict', 'list', 'enumerate', 'all', 'any', 'sorted', 'sum')}


def source_function(file, name, env, imports=()):
    matches = [n for n in SOURCES[file].body if isinstance(n, ast.FunctionDef) and n.name == name]
    assert len(matches) == 1
    original = matches[0]
    assert not original.decorator_list and not original.returns
    assert not original.args.defaults and not original.args.kw_defaults
    assert all(a.annotation is None for a in original.args.args)
    actual = [n for n in ast.walk(original) if isinstance(n, (ast.Import, ast.ImportFrom))]
    assert [ast.unparse(n) for n in actual] == list(imports), (name, actual)
    node = deepcopy(original)
    node.body = [n for n in node.body if not isinstance(n, (ast.Import, ast.ImportFrom))]
    # Only reviewed top-level import statements may be removed, no body rewrites.
    expected = deepcopy(original)
    for n in list(expected.body):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            expected.body.remove(n)
    assert ast.dump(node) == ast.dump(expected)
    assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(node))
    env['__builtins__'] = SAFE_BUILTINS
    exec(compile(ast.Module(body=[node], type_ignores=[]), file + ':' + name, 'exec'), env)
    return env[name]


HELPERS = {'clean_str': clean_str, 'normalise': normalise}
HELPERS['scope_programme_identifier'] = lambda lineage: placement_identifier(lineage, clean_str=HELPERS['clean_str'])
OLD = source_function('preintegration', 'members_for_lineages', {
    'defaultdict': defaultdict, 'views': SimpleNamespace(**HELPERS)}, ('from . import views',))
TARGET = dict(found=True, programmeId='P', cohortId='C', groupId='G',
              moduleCatalogueId='M', learnerRosterMode='inherited')


def fact(profile=1, bridge=101, **changes):
    return dict({'id': profile, 'enrolment_id': bridge, 'programme_id': 'P',
                 'cohort_id': 'C', 'group_id': 'G', 'status': 'inactive'}, **changes)


def callers(policy, facts, targets):
    calls = []

    def placements(scope, ids):
        calls.append(('placements', scope, list(ids)))
        return {key: targets.get(key, {'found': False}) for key in ids}

    def read_facts(ids, profile_ids=None):
        calls.append(('facts', set(ids), profile_ids))
        return [f for f in facts if profile_ids is None or f['id'] in profile_ids]

    class Profiles:
        def filter(self, **kwargs):
            calls.append(('profiles', kwargs))
            self.ids = kwargs['id__in']
            return self

        def values(self, *fields):
            assert fields == ('id', 'email', 'full_name')
            return [dict(id=i, email='', full_name='') for i in sorted(self.ids)]

    views = SimpleNamespace(scope_programme_identifier=HELPERS['scope_programme_identifier'],
                            programme_identity_candidates=lambda key: [key],
                            curriculum_read_scope=lambda **kw: nullcontext())
    env = dict(views=views, Counter=Counter, members_for_lineages=policy,
               placement_lineages=placements, learner_facts=read_facts,
               LearnerProfile=SimpleNamespace(objects=Profiles()))
    env.update(vars(views))  # Actual concrete caller now binds these same read ports directly.
    source_function('learner_status_counts.py', 'status_key', env)
    # Execute actual extracted callers with explicit synthetic read capabilities.
    env['counts_for_lineages'] = lambda lineages, facts, candidates: status_queries.counts_for_lineages(
        lineages, facts, candidates, members_for_lineages=policy, status_key=env['status_key'])
    source_function('preintegration', 'module_member_enrolment_ids', env, ('from . import views',))
    env['module_member_enrolment_ids_by_module'] = lambda ids: module_membership.module_member_enrolment_ids_by_module(
        ids, curriculum_read_scope=views.curriculum_read_scope, placement_lineages=placements,
        scope_programme_identifier=views.scope_programme_identifier,
        programme_identity_candidates=views.programme_identity_candidates,
        learner_facts=read_facts, members_for_lineages=policy)
    shared = ('from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope',
              'from curriculum_api.catalogue.infrastructure.catalogue_resolution import programme_identity_candidates',
              'from curriculum_api.catalogue.infrastructure.placement_runtime import scope_programme_identifier',
              'from .learner_status_counts import learner_facts, members_for_lineages, placement_lineages')
    source_function('attendance_membership.py', 'assigned_module_ids_by_profile', env, shared)
    source_function('attendance_membership.py', 'module_roster', env,
                    ('from learner_api.models import LearnerProfile',) + shared)
    return env, calls


class CallerParityTests(unittest.TestCase):
    def compare(self, name, facts, targets, *args):
        results, traces = [], []
        for policy in (OLD, new_policy):
            rows, lineages = deepcopy(facts), deepcopy(targets)
            env, calls = callers(policy, rows, lineages)
            results.append(env[name](*deepcopy(args)))
            traces.append(calls)
            self.assertEqual(rows, facts)
            self.assertEqual(lineages, targets)
        self.assertEqual(results[0], results[1])
        self.assertIs(type(results[0]), type(results[1]))
        self.assertEqual(traces[0], traces[1])
        return results[1], traces[1]

    def test_single_bridge_truthiness_and_deduplication(self):
        rows = [fact(i, value) for i, value in enumerate((None, 0, '', False, 101, '101', '0', -2))]
        rows.append({'id': 99, 'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G'})
        result, _ = self.compare('module_member_enrolment_ids', rows, {'M': TARGET}, 'M')
        self.assertEqual(result, {'101', '0', '-2'})

    def test_missing_target_vs_empty(self):
        for targets, expected in (({}, None), ({'M': TARGET}, set())):
            result, calls = self.compare('module_member_enrolment_ids', [], targets, 'M')
            self.assertEqual(result, expected)
            if expected is None:
                self.assertFalse(any(c[0] == 'facts' for c in calls))

    def test_batch_input_order_and_missing_collapse(self):
        result, calls = self.compare('module_member_enrolment_ids_by_module', [fact()],
                                    {'M': TARGET}, [' Z ', 'M', ' M ', '', None, 0])
        self.assertEqual(result, {'M': {'101'}, 'Z': set()})
        self.assertEqual(list(result), ['M', 'Z'])
        self.assertEqual(calls[0], ('placements', 'module', ['M', 'Z']))
        result, calls = self.compare('module_member_enrolment_ids_by_module', [], {}, [])
        self.assertEqual((result, calls), ({}, []))

    def test_counts_profile_dedup_first_fact_and_status_order(self):
        rows = [fact(7, 900, status='On_Hold'), fact('7', 901, status='active'),
                fact(8, 900), fact(9, None, status=None)]
        targets = {'M': TARGET, 'missing': {'found': False}}
        for ordered in (rows, list(reversed(rows))):
            result, _ = self.compare('counts_for_lineages', ordered, targets, targets, ordered, {})
            self.assertEqual(result['M']['total'], 3)
            self.assertIsNone(result['missing'])
            self.assertEqual(list(result['M']['statuses']), sorted(result['M']['statuses']))
            expected = 'on hold' if ordered is rows else 'active'
            self.assertEqual(result['M']['statuses'][expected], 1)

    def test_attendance_profile_identity_not_enrolment(self):
        rows = [fact(7, 700), fact(8, 0), fact(9, None, explicit=True, module_ids=['S'])]
        result, calls = self.compare('assigned_module_ids_by_profile', rows, {'M': TARGET},
                                    ['7', 8, 9, 'bad', '7'], ['M', 'M', 'missing'])
        self.assertEqual(result, {7: {'M'}, 8: {'M'}, 9: set()})
        self.assertIn(('facts', {'M'}, {7, 8, 9}), calls)

    def test_attendance_roster_uses_selected_profile_ids(self):
        rows = [fact(7, 700), fact(7, 701), fact(8, 0),
                fact(9, 900, explicit=True, module_ids=['S'])]
        result, calls = self.compare('module_roster', rows, {'M': TARGET}, ' M ')
        self.assertEqual([r['learner_profile_id'] for r in result], [7, 8])
        self.assertIn(('profiles', {'id__in': {7, 8}}), calls)
        for module in ('', 'missing'):
            result, calls = self.compare('module_roster', rows, {'M': TARGET}, module)
            self.assertEqual(result, [])
            self.assertFalse(any(c[0] == 'profiles' for c in calls))

    def test_policy_index_types_order_and_modes(self):
        rows = [fact(10, 100, programme_id='\tP\u2003'), fact(11, 101, explicit=True, module_ids=['S']),
                fact(12, 102, programme_id='OTHER', explicit=True, module_ids=['M']),
                fact(13, 103, ambiguous=True, explicit=True, module_ids=['M']),
                fact(14, 104, group_id=' G '), fact(15, 105, cohort_id=' C '), {}]
        for mode in ('inherited', ' MANUAL '):
            targets = {'M': {**TARGET, 'learnerRosterMode': mode}, 'absent': {}}
            for ordered in (rows, list(reversed(rows)), rows + [rows[0]]):
                old, new = [p(targets, ordered, {}) for p in (OLD, new_policy)]
                self.assertEqual(old, new)
                self.assertIs(type(new['M']), frozenset)
                self.assertIsNone(new['absent'])
                self.assertEqual([ordered[i].get('id') for i in sorted(old['M'])],
                                 [ordered[i].get('id') for i in sorted(new['M'])])
                self.compare('module_member_enrolment_ids', ordered, targets, 'M')

    def test_malformed_inputs_preserve_exception_types(self):
        cases = [(None, [], {}), ({'M': None}, [], {}), ({'M': TARGET}, None, {}),
                 ({'M': TARGET}, [None], {}), ({'M': TARGET}, [fact(module_ids=[[]])], {}),
                 ({'M': TARGET}, [], {'P': None})]
        for args in cases:
            outcomes = []
            for policy in (OLD, new_policy):
                try:
                    policy(*deepcopy(args))
                except Exception as exc:
                    outcomes.append(type(exc))
                else:
                    self.fail('Expected malformed input to raise')
            self.assertEqual(outcomes[0], outcomes[1])

    def test_empty_policy_and_counts(self):
        self.assertEqual(OLD({}, [], {}), new_policy({}, [], {}))
        result, _ = self.compare('counts_for_lineages', [], {}, {'M': TARGET}, [], {})
        self.assertEqual(result, {'M': {'total': 0, 'statuses': {}}})

    def test_import_boundary(self):
        self.assertFalse(any(n == 'django' or n.startswith('django.') for n in sys.modules))
        tree = ast.parse((BACKEND / 'learner_api/learning_plans/domain/membership_policy.py').read_text(encoding='utf-8'))
        self.assertEqual([ast.unparse(n) for n in ast.walk(tree)
                          if isinstance(n, (ast.Import, ast.ImportFrom))],
                         ['from collections import defaultdict', 'import re'])


if __name__ == '__main__':
    unittest.main()
