"""Run directly with python -I -B; stdlib and pure policy imports only.

The reference compiles selected function definitions from source, never imports
views or learner_status_counts, and removes only the reviewed relative import.
These tests prove policy parity, not SQL/ORM/HTTP or live data equivalence.
"""
import ast
from collections import defaultdict
from copy import deepcopy
import itertools
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
import unittest

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from learner_api.learning_plans.domain.membership_policy import members_for_lineages
from curriculum_api.catalogue.domain.values import clean_str, normalise
from curriculum_api.directory.domain.placement import scope_programme_identifier
from functools import partial


def production_reference():
    # Actual pure owners; the entry point now exports these definitions.
    helpers = {'clean_str': clean_str, 'normalise': normalise,
               'scope_programme_identifier': partial(scope_programme_identifier, clean_str=clean_str)}
    names = {'clean_str', 'normalise', 'scope_programme_identifier'}
    assert set(helpers) == names
    # Frozen original body, never the delegate introduced by convergence.
    snapshot = json.loads((BACKEND / 'curriculum_api/directory/tests/fixtures/legacy_snapshots/progress_membership_snapshot.json').read_text(encoding='utf-8'))
    tree = ast.parse(snapshot['learner_status_counts.py:members_for_lineages']['source'])
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef)
                and n.name == 'members_for_lineages')
    imports = [n for n in node.body if isinstance(n, ast.ImportFrom)]
    assert len(imports) == 1
    assert ast.unparse(imports[0]) == 'from . import views'
    node.body.remove(imports[0])
    assert not node.decorator_list
    assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(node))
    env = {'defaultdict': defaultdict,
           'views': SimpleNamespace(**{key: helpers[key] for key in names})}
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<source policy>', 'exec'), env)
    return env['members_for_lineages']


def lineage(**changes):
    return dict(found=True, programmeId='P', cohortId='C', groupId='G',
                moduleCatalogueId='M', learnerRosterMode='inherited', **changes)


def fact(**changes):
    return {'programme_id': 'P', 'cohort_id': 'C', 'group_id': 'G', **changes}


class MembershipPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.reference = staticmethod(production_reference())

    def check(self, facts, expected, target=None, candidates=None):
        targets = {'M': target if target is not None else lineage()}
        candidates = candidates or {}
        before = deepcopy((targets, facts, candidates))
        result = members_for_lineages(targets, facts, candidates)
        self.assertEqual(result, self.reference(targets, facts, candidates))
        self.assertEqual(result['M'], expected)
        self.assertEqual((targets, facts, candidates), before)
        return result

    def test_inherited_explicit_target_and_explicit_sibling(self):
        self.check([fact(), fact(explicit=True, module_ids=['M']),
                    fact(explicit=True, module_ids=['S']),
                    fact(explicit=True, module_ids=[])], frozenset({0, 1}))

    def test_direct_outside_placement(self):
        self.check([fact(programme_id='OTHER', explicit=True, module_ids=['M'])],
                   frozenset({0}))

    def test_manual_excludes_inherited_and_ambiguous_direct(self):
        target = {**lineage(), 'learnerRosterMode': ' \tMANUAL\n'}
        self.check([fact(), fact(explicit=True, module_ids=['M']),
                    fact(explicit=True, module_ids=['M'], ambiguous=True)],
                   frozenset({1}), target)

    def test_ambiguous_direct_requires_placement(self):
        self.check([fact(explicit=True, module_ids=['M'], ambiguous=True),
                    fact(programme_id='OTHER', explicit=True,
                         module_ids=['M'], ambiguous=True)], frozenset({0}))

    def test_missing_facts_missing_target_and_empty_states(self):
        self.check([], frozenset())
        self.check([{}], frozenset())
        self.check([fact()], None, {})
        self.check([fact()], None, {'found': False})
        self.assertEqual(members_for_lineages({}, [], {}), {})

    def test_programme_strip_but_cohort_and_group_are_exact(self):
        self.check([fact(programme_id='\tP\u00a0'), fact(cohort_id=' C '),
                    fact(group_id='G\t'), fact(programme_id='p')], frozenset({0}),
                   {**lineage(), 'programmeId': '\nP\u2003'})

    def test_optional_lineage_constraints_and_programme_name_fallback(self):
        target = {**lineage(), 'programmeId': '', 'programmeName': ' P ',
                  'cohortId': '', 'groupId': None}
        self.check([{'programme_id': 'P'}, fact(cohort_id='OTHER')],
                   frozenset({0, 1}), target)
        self.check([fact()], frozenset(), {**target, 'programmeName': ''})

    def test_candidate_names_do_not_replace_programme_id(self):
        self.check([fact(programme_id='Marketing')], frozenset(),
                   candidates={'P': ['Marketing', ' MARKETING ']})

    def test_duplicate_module_references_and_profile_ids(self):
        self.check([fact(id=7, explicit=True, module_ids=['M', 'M']),
                    fact(id=7, explicit=True, module_ids=['M'])], frozenset({0, 1}))
        self.check([fact(explicit=True, module_ids=[' M '])], frozenset())

    def test_nonmodule_lineage_keeps_placement_despite_explicit_sibling(self):
        self.check([fact(explicit=True, module_ids=['S'])], frozenset({0}),
                   {**lineage(), 'moduleCatalogueId': ''})

    def test_bridge_and_lifecycle_are_not_profile_policy_filters(self):
        # Bridge omission belongs to module_member_enrolment_ids, not here.
        self.check([fact(enrolment_id=None), fact(enrolment_id=0),
                    fact(enrolment_id=9, lifecycle_status='inactive')],
                   frozenset({0, 1, 2}))

    def test_boolean_truth_table_matches_production(self):
        for placed, explicit, direct, ambiguous, manual in itertools.product((False, True), repeat=5):
            with self.subTest(placed=placed, explicit=explicit, direct=direct,
                              ambiguous=ambiguous, manual=manual):
                f = fact(programme_id='P' if placed else 'OTHER', explicit=explicit,
                         module_ids=['M'] if direct else [], ambiguous=ambiguous)
                effective_placement = placed and not manual
                expected = ((effective_placement and not explicit)
                            or (direct and not ambiguous)
                            or (direct and effective_placement))
                self.check([f], frozenset({0}) if expected else frozenset(),
                           {**lineage(), 'learnerRosterMode': 'manual' if manual else 'inherited'})

    def test_synthetic_34_direct_and_four_inherited_distribution(self):
        facts = ([fact(explicit=True, module_ids=['M']) for _ in range(30)]
                 + [fact(programme_id='OTHER', explicit=True, module_ids=['M']) for _ in range(4)]
                 + [fact() for _ in range(4)])
        self.check(facts, frozenset(range(38)))

    def test_multiple_lineages_and_repeated_candidates_do_not_mutate_or_mix_modes(self):
        targets = {'one': lineage(), 'two': {**lineage(), 'learnerRosterMode': 'manual'},
                   'missing': {'found': False}}
        facts = [fact(), fact(explicit=True, module_ids=['M', 'M'])]
        candidates = {'P': ['Alpha', 'alpha', ' A-lpha ']}
        before = deepcopy((targets, facts, candidates))
        result = members_for_lineages(targets, facts, candidates)
        self.assertEqual(result, self.reference(targets, facts, candidates))
        self.assertEqual(result, {'one': frozenset({0, 1}), 'two': frozenset({1}), 'missing': None})
        self.assertEqual((targets, facts, candidates), before)

    def test_import_closure_is_stdlib_only(self):
        self.assertFalse(any(name == 'django' or name.startswith('django.') for name in sys.modules))
        for relative in ('learner_api/__init__.py', 'learner_api/learning_plans/__init__.py',
                         'learner_api/learning_plans/domain/__init__.py'):
            tree = ast.parse((BACKEND / relative).read_text(encoding='utf-8'))
            self.assertTrue(all(isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant)
                                and isinstance(n.value.value, str) for n in tree.body))
        tree = ast.parse((BACKEND / 'learner_api/learning_plans/domain/membership_policy.py').read_text(encoding='utf-8'))
        imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
        self.assertEqual([ast.unparse(n) for n in imports],
                         ['from collections import defaultdict', 'import re'])


if __name__ == '__main__':
    unittest.main()
