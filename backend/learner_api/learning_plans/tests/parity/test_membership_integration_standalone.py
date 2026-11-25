"""DB-free reader/guard integration. No real reader, ORM or writer is imported.

--preintegration verifies the conditional gate before production is edited.
Default mode executes the actual application delegate and spies on the policy.
Guard bodies are compiled intact; a sentinel at profile_for stops ALL work
after the membership gate. Proceed means permission to reach that boundary,
never successful persistence. Snapshot integrity is checked by the parity helper.
"""
import ast
import builtins
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from learner_api.learning_plans.tests.parity import test_membership_caller_parity_standalone as parity
from learner_api.learning_plans.domain import membership_policy
from learner_api.learning_plans.application import module_membership
from learner_api.learning_plans import public as learner_plans

PRE = '--preintegration' in sys.argv
if PRE:
    sys.argv.remove('--preintegration')
IMPORT = 'from learner_api.learning_plans.domain.membership_policy import members_for_lineages'
GUARDS = ('_module_members', '_assign_module', '_unassign_module')
CURRENT_GUARDS = ast.parse((BACKEND / 'curriculum_api/learner_assignments.py').read_text(encoding='utf-8'))


def node(name, baseline=True):
    if baseline:
        return ast.parse(parity.SNAPSHOT[name]['source']).body[0]
    tree = parity.SOURCES['learner_status_counts.py'] if name == 'module_member_enrolment_ids' else CURRENT_GUARDS
    return deepcopy(next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name))


def compile_intact(definition, env, importer):
    # Full function including local imports. The hook supplies synthetic legacy
    # data dependencies and imports the real application/domain implementations.
    env['__builtins__'] = {**parity.SAFE_BUILTINS, '__import__': importer}
    exec(compile(ast.Module(body=[definition], type_ignores=[]), '<intact source>', 'exec'), env)
    return env[definition.name]


def reader(variant, facts, targets):
    env, trace = parity.callers(parity.OLD if variant == 'old' else parity.new_policy,
                                facts, targets)
    env['learner_plans'] = learner_plans
    definition = node('module_member_enrolment_ids', baseline=variant != 'actual')
    if variant == 'binding_candidate':
        definition.body.insert(1, ast.parse(IMPORT).body[0])
    imported = []

    def importer(name, globals=None, locals=None, fromlist=(), level=0):
        if level == 1 and name == '' and tuple(fromlist) == ('views',):
            return SimpleNamespace(views=env['views'])
        if level == 0 and name == 'learner_api.learning_plans.domain.membership_policy' and tuple(fromlist) == ('members_for_lineages',):
            imported.append(name)
            return builtins.__import__(name, globals, locals, fromlist, level)
        if level == 0 and name == 'learner_api.learning_plans.application.module_membership' and tuple(fromlist) == ('module_member_enrolment_ids',):
            imported.append(name)
            return builtins.__import__(name, globals, locals, fromlist, level)
        raise AssertionError(('Unapproved import', name, fromlist, level))

    return compile_intact(definition, env, importer), trace, imported


class Proceed(BaseException):
    pass


def guard_outcome(name, read, learner_id, target=None, baseline=False, cache=None):
    boundary = []

    def stop(learner):
        boundary.append(learner.pk)
        raise Proceed()

    env = {'module_plan_rows': SimpleNamespace(profile_for=stop)}

    def importer(name, globals=None, locals=None, fromlist=(), level=0):
        assert (name, tuple(fromlist), level) == ('learner_status_counts', ('module_member_enrolment_ids',), 1)
        return SimpleNamespace(module_member_enrolment_ids=read)

    compile_intact(node('_module_members', baseline), env, importer)
    guard = compile_intact(node(name, baseline), env, importer)
    args = [SimpleNamespace(pk=learner_id), target if target is not None else {'id': 'M', 'moduleIds': ['M']}]
    if name == '_assign_module':
        args.append({})
    args.append({} if cache is None else cache)
    try:
        result = guard(*args)
    except Proceed:
        return ('proceed', boundary)
    except Exception as exc:
        return ('error', type(exc).__name__, str(exc))
    assert result is False and not boundary
    return ('skip', [])


def outcome(read):
    try:
        value = read('M')
        return ('value', type(value), value)
    except Exception as exc:
        return ('error', type(exc), str(exc))


class IntegrationTests(unittest.TestCase):
    def test_source_scope_and_oracle_independence(self):
        original, actual = node('module_member_enrolment_ids'), node('module_member_enrolment_ids', False)
        # The old oracle stays immutable. Compare the extracted orchestration
        # statements with the original scope body, not a rewritten expectation.
        old_scope = next(n for n in original.body if isinstance(n, ast.With))
        new_scope = next(n for n in actual.body if isinstance(n, ast.With))
        # Only the binding moved from views to the concrete read owner.
        self.assertEqual(ast.unparse(old_scope.items[0].context_expr.func), 'views.curriculum_read_scope')
        self.assertEqual(ast.unparse(new_scope.items[0].context_expr.func), 'curriculum_read_scope')
        expected_scope = deepcopy(old_scope.items[0])
        expected_scope.context_expr.func = ast.Name(id='curriculum_read_scope', ctx=ast.Load())
        self.assertEqual(ast.dump(expected_scope), ast.dump(new_scope.items[0]))
        app = ast.parse(Path(module_membership.__file__).read_text(encoding='utf-8'))
        function = next(n for n in app.body if isinstance(n, ast.FunctionDef))
        class PolicyReference(ast.NodeTransformer):
            # Explicitly reverse only the injected dependency names for this
            # structural equivalence assertion; runtime tests use actual code.
            def visit_Name(self, value):
                names = {'read_lineages': 'placement_lineages', 'read_facts': 'learner_facts'}
                if value.id in names:
                    return ast.copy_location(ast.Name(id=names[value.id], ctx=value.ctx), value)
                attrs = {'programme_identifier': 'scope_programme_identifier',
                         'programme_candidates': 'programme_identity_candidates'}
                if value.id in attrs:
                    return ast.copy_location(ast.Attribute(value=ast.Name(id='views', ctx=ast.Load()),
                                                           attr=attrs[value.id], ctx=value.ctx), value)
                return value
            def visit_Attribute(self, value):
                if isinstance(value.value, ast.Name) and value.value.id == 'membership_policy' and value.attr == 'members_for_lineages':
                    return ast.copy_location(ast.Name(id='members_for_lineages', ctx=ast.Load()), value)
                return self.generic_visit(value)
        extracted = PolicyReference().visit(deepcopy(function))
        self.assertEqual([ast.dump(n) for n in old_scope.body],
                         [ast.dump(n) for n in extracted.body[1:]])
        call = new_scope.body[0].value
        self.assertIsInstance(new_scope.body[0], ast.Return)
        self.assertEqual(ast.unparse(call.func), 'learner_plans.module_member_enrolment_ids')
        self.assertEqual([k.arg for k in call.keywords],
                         ['read_lineages', 'read_facts', 'programme_identifier', 'programme_candidates'])
        self.assertNotIn(IMPORT, parity.SNAPSHOT['module_member_enrolment_ids']['source'])
        class CompatibilityReference(ast.NodeTransformer):
            names = {
                'clean_text': '_s',
                'effective_module_ids': '_effective_plan_ids',
                'synchronize_compatibility_plan': 'sync_learning_plan_mirror',
            }
            def visit_Attribute(self, value):
                if isinstance(value.value, ast.Name) and value.value.id == 'learner_plans':
                    return ast.copy_location(
                        ast.Attribute(
                            value=ast.Name(id='plans', ctx=ast.Load()),
                            attr=self.names[value.attr],
                            ctx=value.ctx,
                        ),
                        value,
                    )
                return self.generic_visit(value)
        for name in GUARDS:
            actual = node(name, False)
            self.assertFalse(any(isinstance(item, ast.Name) and item.id == 'plans'
                                 for item in ast.walk(actual)))
            normalized = CompatibilityReference().visit(deepcopy(actual))
            self.assertEqual(ast.dump(node(name)), ast.dump(normalized))

    def test_reader_and_both_guard_decisions(self):
        f, target = parity.fact, parity.TARGET
        cases = [
            ('inherited', [f()], target, 101, True),
            ('empty', [], target, 101, False),
            ('missing', [f()], {}, 101, False),
            ('direct', [f(explicit=True, module_ids=['M'])], target, 101, True),
            ('sibling', [f(explicit=True, module_ids=['S'])], target, 101, False),
            ('explicit_null_row', [f(explicit=True, module_ids=[])], target, 101, False),
            ('outside', [f(programme_id='X', explicit=True, module_ids=['M'])], target, 101, True),
            ('manual_inherited', [f()], {**target, 'learnerRosterMode': 'manual'}, 101, False),
            ('manual_direct', [f(explicit=True, module_ids=['M'])], {**target, 'learnerRosterMode': 'manual'}, 101, True),
            ('ambiguous_inside', [f(explicit=True, ambiguous=True, module_ids=['M'])], target, 101, True),
            ('ambiguous_outside', [f(programme_id='X', explicit=True, ambiguous=True, module_ids=['M'])], target, 101, False),
            ('manual_ambiguous', [f(explicit=True, ambiguous=True, module_ids=['M'])], {**target, 'learnerRosterMode': 'manual'}, 101, False),
            ('missing_bridge', [f(bridge=None)], target, 101, False),
            ('numeric_zero', [f(bridge=0)], target, 0, False),
            ('text_zero', [f(bridge='0')], target, 0, True),
            ('duplicates', [f(), f(), f(profile=2)], target, '101', True),
            ('profile_not_bridge', [f(profile=101, bridge=999)], target, 101, False),
            ('bridge_not_profile', [f(profile=101, bridge=999)], target, 999, True),
            ('whitespace', [f(programme_id='\tP\u2003')], target, 101, True),
            ('cohort_exact', [f(cohort_id=' C ')], target, 101, False),
            ('group_exact', [f(group_id=' G ')], target, 101, False),
        ]
        for label, rows, lineage, pk, member in cases:
            with self.subTest(case=label):
                variants = [reader(v, deepcopy(rows), {'M': deepcopy(lineage)}) for v in ('old', 'new', 'actual')]
                results = [outcome(r) for r, _, _ in variants]
                self.assertEqual(results[0], results[1])
                self.assertEqual(results[0], results[2])
                self.assertEqual(variants[0][1], variants[1][1])
                self.assertEqual(variants[0][1], variants[2][1])
                for guard in ('_assign_module', '_unassign_module'):
                    decisions = [guard_outcome(guard, r, pk, baseline=i == 0)
                                 for i, (r, _, _) in enumerate(variants)]
                    self.assertEqual(decisions[0], decisions[1])
                    self.assertEqual(decisions[0], decisions[2])
                    skip = member if guard == '_assign_module' else not member
                    self.assertEqual(decisions[0][0], 'skip' if skip else 'proceed')

    def test_errors_are_not_proceed_or_skip(self):
        for rows in ([None], [parity.fact(module_ids=[[]])]):
            reads = [reader(v, rows, {'M': parity.TARGET})[0] for v in ('old', 'new', 'actual')]
            self.assertEqual(outcome(reads[0]), outcome(reads[1]))
            self.assertEqual(outcome(reads[0]), outcome(reads[2]))
            for name in ('_assign_module', '_unassign_module'):
                results = [guard_outcome(name, r, 101, baseline=i == 0) for i, r in enumerate(reads)]
                self.assertEqual(results[0], results[1])
                self.assertEqual(results[0], results[2])
                self.assertEqual(results[0][0], 'error')

    def test_cached_membership_avoids_reader(self):
        def forbidden(_):
            raise AssertionError('Reader should not be called for cached membership')
        for name in ('_assign_module', '_unassign_module'):
            old = guard_outcome(name, forbidden, 101, baseline=True, cache={'_moduleMembers': {'101'}})
            new = guard_outcome(name, forbidden, 101, cache={'_moduleMembers': {'101'}})
            self.assertEqual(old, new)
            self.assertNotEqual(new[0], 'error')

    def test_real_import_and_spy_invocation(self):
        read, _, imports = reader('binding_candidate' if PRE else 'actual', [parity.fact()], {'M': parity.TARGET})
        with patch.object(membership_policy, 'members_for_lineages', wraps=parity.new_policy) as spy:
            self.assertEqual(read('M'), {'101'})
            spy.assert_called_once()
            self.assertEqual(spy.call_args.args[1][0]['id'], 1)
        self.assertEqual(imports, ['learner_api.learning_plans.domain.membership_policy'] if PRE else [])

    def test_import_closure(self):
        self.assertFalse(any(n == 'django' or n.startswith('django.') for n in sys.modules))
        for relative in ('learner_api/__init__.py', 'learner_api/learning_plans/__init__.py', 'learner_api/learning_plans/domain/__init__.py'):
            tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8'))
            self.assertTrue(all(isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str) for n in tree.body))
        tree = ast.parse(Path(membership_policy.__file__).read_text(encoding='utf-8'))
        self.assertEqual([ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))], ['from collections import defaultdict', 'import re'])


if __name__ == '__main__':
    unittest.main()
