"""Actual-source parity for membership composition, refresh events and video paths.

No Django startup or I/O. Only function definitions are compiled;
the approved reader ports are synthetic. Pure application/domain imports are real.
"""
import ast
import builtins
import copy
from contextlib import nullcontext
import hashlib
import importlib
import importlib.util
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import overview_composition_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative, prior=False):
    from curriculum_api.catalogue.tests.parity.read_entry_oracle import restore_tree
    parsed = restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8-sig')), relative)
    return oracle.restore_tree(parsed, relative) if prior else parsed


def functions(relative, prior=False):
    return [copy.deepcopy(n) for n in tree(relative, prior).body if isinstance(n, ast.FunctionDef)]


class ReviewedBindings(ast.NodeTransformer):
    """Normalize only the reviewed facade bindings, never control flow or SQL."""
    def visit_ImportFrom(self, node):
        if node.level == 1 and not node.module and [a.name for a in node.names] == ['views']:
            return None
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        if node.module == 'curriculum_api.video_uploads' and [a.name for a in node.names] == ['stored_video_path']:
            node.module = 'curriculum_api.catalogue.infrastructure.video_paths'
        if node.module == 'curriculum_api.read_model' and any(a.name.startswith('enqueue_') for a in node.names):
            node.module = 'curriculum_api.catalogue.infrastructure.home_read_model'
        if node.module == 'curriculum_api.learner_status_counts' and [a.name for a in node.names] == ['status_counts']:
            node.module = 'curriculum_api.directory.infrastructure.membership_runtime'
        return node

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id == 'views':
            return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
        return self.generic_visit(node)


def membership(prior, rows, targets):
    """Compile the actual old/new adapters with identical explicit read ports."""
    trace = []
    def lineages(scope, ids):
        trace.append(('lineages', scope, list(ids)))
        return {key: copy.deepcopy(targets.get(key, {'found': False})) for key in ids}
    def facts(ids, profile_ids=None):
        trace.append(('facts', set(ids), profile_ids))
        return copy.deepcopy(rows)
    def candidates(identifier):
        trace.append(('candidates', identifier))
        return [identifier]
    views = SimpleNamespace(curriculum_read_scope=lambda **kw: nullcontext(),
        scope_programme_identifier=lambda lineage: str(lineage.get('programmeId') or '').strip(),
        programme_identity_candidates=candidates)
    safe = {'curriculum_api.directory.application.status_queries',
            'learner_api.learning_plans.application.module_membership',
            'learner_api.learning_plans.domain.membership_policy'}
    def importer(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 1 and name == '' and tuple(fromlist) == ('views',):
            return SimpleNamespace(views=views)
        if level == 0 and name in safe:
            return builtins.__import__(name, globals, locals, fromlist, level)
        raise AssertionError(('Unexpected dependency', name, fromlist, level))
    nodes = functions('learner_status_counts.py', True) if prior else (
        functions('directory/domain/membership_values.py') + functions('directory/infrastructure/membership_runtime.py'))
    env = dict(vars(views), __builtins__={**vars(builtins), '__import__': importer}, json=json)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-membership-composition>', 'exec'), env)
    env.update(placement_lineages=lineages, learner_facts=facts)
    return env, trace


TARGET = dict(found=True, programmeId='P', cohortId='C', groupId='G',
              moduleCatalogueId='M', learnerRosterMode='inherited')


def fact(identifier, **changes):
    return dict({'id': identifier, 'enrolment_id': identifier + 100,
                 'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G',
                 'status': 'active', 'explicit': False, 'module_ids': [], 'ambiguous': False}, **changes)


class OverviewCompositionContracts(unittest.TestCase):
    def test_frozen_source_and_exact_restoration(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '51bd8ad60bfdcb5eccce25c8061ed0d04d34b9d61d8dd74bec8dd667186ba677')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            current = tree(relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'], relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in oracle.restore_tree(current, relative).body], entry['order'], relative)

    def test_relocated_function_bodies_only_change_reviewed_bindings(self):
        groups = {'views.py': {'curriculum_api.' + owner: [name for name, module in MANIFEST['functions'].items() if module == owner]
                              for owner in set(MANIFEST['functions'].values())}, **oracle.SNAPSHOT['extra_moves']}
        for relative, owners in groups.items():
            old = {n.name: n for n in functions(relative, True)}
            for owner, names in owners.items():
                current = {n.name: n for n in functions(owner.removeprefix('curriculum_api.').replace('.', '/') + '.py')}
                for name in names:
                    if name not in old:
                        continue  # Constants are checked independently below.
                    expected = ReviewedBindings().visit(copy.deepcopy(old[name]))
                    self.assertEqual(ast.dump(expected), ast.dump(current[name]), (relative, name))

    def test_relocated_constants_are_exact(self):
        for relative, owners in oracle.SNAPSHOT['extra_moves'].items():
            old = {t.id:n for n in tree(relative, True).body if isinstance(n, ast.Assign)
                   for t in n.targets if isinstance(t, ast.Name)}
            for owner, names in owners.items():
                current = {t.id:n for n in tree(owner.removeprefix('curriculum_api.').replace('.', '/') + '.py').body
                           if isinstance(n, ast.Assign) for t in n.targets if isinstance(t, ast.Name)}
                for name in set(names) & old.keys():
                    self.assertEqual(ast.dump(old[name]), ast.dump(current[name]), name)

    def test_remaining_entry_bodies_preserve_control_flow_and_payloads(self):
        for relative in ('views.py', 'read_model.py', 'video_uploads.py'):
            original = {n.name:n for n in functions(relative, True)}
            for actual in functions(relative):
                self.assertEqual(ast.dump(ReviewedBindings().visit(original[actual.name])),
                                 ast.dump(ReviewedBindings().visit(actual)), (relative, actual.name))

    def test_no_reverse_or_forbidden_dependency(self):
        owners = list(MANIFEST['modules']) + [name.removeprefix('curriculum_api.')
                    for groups in oracle.SNAPSHOT['extra_moves'].values() for name in groups]
        for owner in owners:
            for node in ast.walk(tree(owner.replace('.', '/') + '.py')):
                if not isinstance(node, ast.ImportFrom):
                    continue
                module = node.module or ''
                self.assertNotEqual(module, 'curriculum_api.views')
                self.assertFalse(module == 'curriculum_api' and any(n.name == 'views' for n in node.names))
                if '.domain.' in owner:
                    self.assertFalse(module.startswith(('django', 'psycopg')) or '.infrastructure.' in module or '.api.' in module)
                if '.infrastructure.' in owner:
                    self.assertNotIn('.api.', module)

    def compare_membership(self, name, rows, targets, *args):
        outcomes = []
        for prior in (True, False):
            env, trace = membership(prior, rows, targets)
            result = env[name](*copy.deepcopy(args))
            outcomes.append((result, trace))
        self.assertEqual(outcomes[0], outcomes[1])
        self.assertIs(type(outcomes[0][0]), type(outcomes[1][0]))
        return outcomes[1][0]

    def test_inherited_direct_sibling_manual_and_ambiguous_membership(self):
        rows = [fact(1), fact(2, explicit=True, module_ids=['OTHER']),
                fact(3, programme_id='OUTSIDE', explicit=True, module_ids=['M'], status='Withdrawn'),
                fact(4, explicit=True, module_ids=['M'], ambiguous=True),
                fact(5, programme_id='OUTSIDE', module_ids=['M'], ambiguous=True)]
        for mode, expected in [('inherited', {'101', '103', '104'}), ('manual', {'103'})]:
            result = self.compare_membership('module_member_enrolment_ids', rows,
                {'M': {**TARGET, 'learnerRosterMode': mode}}, 'M')
            self.assertEqual(result, expected)

    def test_registration_bridges_duplicate_profiles_and_batch_order(self):
        rows = [fact(i, enrolment_id=value) for i, value in enumerate((None, 0, '', False, 101, '101', '0', -2))]
        rows += [rows[4].copy()]
        result = self.compare_membership('module_member_enrolment_ids_by_module', rows,
            {'M': TARGET}, [' M ', 'M', '', None, 'missing'])
        self.assertEqual(result, {'M': {'101', '0', '-2'}, 'missing': set()})
        self.assertEqual(list(result), ['M', 'missing'])

    def test_missing_target_and_existing_empty_membership_are_distinct(self):
        self.assertIsNone(self.compare_membership('module_member_enrolment_ids', [], {}, 'missing'))
        self.assertEqual(self.compare_membership('module_member_enrolment_ids', [], {'M': TARGET}, 'M'), set())
        self.assertEqual(self.compare_membership('status_counts', [], {}, 'module', ['missing']), {'missing': None})
        self.assertEqual(self.compare_membership('status_counts', [], {'M': TARGET}, 'module', ['M']),
                         {'M': {'total': 0, 'statuses': {}}})

    def test_status_labels_deduplication_and_no_lifecycle_filter(self):
        rows = [fact(1, status=' On_Break '), fact(2, status='withdrawn'), fact(3, status='')]
        result = self.compare_membership('status_counts', rows + [rows[0]], {'M': TARGET}, 'module', ['M'])
        self.assertEqual(result, {'M': {'total': 3, 'statuses': {'on break': 1, 'unknown': 1, 'withdrawn': 1}}})

    def test_synthetic_34_direct_plus_four_inherited_distribution(self):
        rows = [fact(i, explicit=True, module_ids=['M']) for i in range(34)] + [fact(i) for i in range(34, 38)]
        self.assertEqual(len(self.compare_membership('module_member_enrolment_ids', rows, {'M': TARGET}, 'M')), 38)
        self.assertEqual(len(self.compare_membership('module_member_enrolment_ids', rows,
            {'M': {**TARGET, 'learnerRosterMode': 'manual'}}, 'M')), 34)

    def test_python_whitespace_and_identifier_scope_are_preserved(self):
        rows = [fact(1, programme_id='\u2003P\u0085'), fact(2, cohort_id=' C '), fact(3, group_id=' G ')]
        self.assertEqual(self.compare_membership('module_member_enrolment_ids', rows, {'M': TARGET}, 'M'), {'101'})

    def test_home_lookup_refresh_contract_and_no_short_circuit(self):
        outcomes = []
        for prior in (True, False):
            env = dict(settings=SimpleNamespace(CURRICULUM_HOME_READ_MODEL_TTL_SECONDS=0),
                       enqueue_read_model_event=Mock(side_effect=[True, False]), get_read_model=Mock(return_value='snapshot'))
            relative = 'read_model.py' if prior else 'catalogue/infrastructure/home_read_model.py'
            nodes = [copy.deepcopy(n) for n in tree(relative, prior).body if isinstance(n, (ast.FunctionDef, ast.Assign))]
            exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-home-read-model>', 'exec'), env)
            self.assertEqual(env['get_curriculum_home'](' ALL '), 'snapshot')
            self.assertFalse(env['enqueue_curriculum_home_refresh']('invalid', reason='ignored'))
            self.assertTrue(env['enqueue_all_curriculum_home_refreshes'](reason='x' * 140, using='synthetic'))
            self.assertEqual(env['enqueue_read_model_event'].call_count, 2)
            self.assertEqual(env['get_read_model'].call_args.kwargs['cache_ttl'], 1)
            self.assertEqual(len(env['enqueue_read_model_event'].call_args.kwargs['payload']['reason']), 120)
            outcomes.append((env['get_read_model'].call_args_list, env['enqueue_read_model_event'].call_args_list))
        self.assertEqual(*outcomes)

    def test_video_paths_preserve_valid_scope_and_reject_arbitrary_paths(self):
        prefix = '/curriculum_api/curriculum/uploads/'
        sources = [prefix+'videos/module/M/C/abc.mp4', prefix+'videos/free_course/F/C/a-b.mp4',
                   prefix+'../secret.mp4', prefix+'videos/module/M/C/abc.mp4?token=x',
                   'https://invalid.example/video.mp4', '', prefix+'videos/module/M/C/\u0645.mp4']
        outputs = []
        for prior in (True, False):
            env = dict(re=re, upload_storage=SimpleNamespace(UPLOAD_URL_PREFIX=prefix))
            relative = 'video_uploads.py' if prior else 'catalogue/infrastructure/video_paths.py'
            nodes = [copy.deepcopy(n) for n in tree(relative, prior).body if isinstance(n, ast.Assign)
                     or isinstance(n, ast.FunctionDef) and n.name == 'stored_video_path']
            exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual-video-path>', 'exec'), env)
            outputs.append([env['stored_video_path'](s) for s in sources])
        self.assertEqual(*outputs)
        self.assertEqual(outputs[1][2:], [None] * 5)


if __name__ == '__main__':
    unittest.main()
