"""Frozen-source and pure-policy parity; no Django or application settings."""
import ast
from copy import deepcopy
from datetime import date, datetime, timedelta
import hashlib
import importlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).parents[1]
FIXTURE = ROOT / 'tests/fixtures/template_schedule_boundary.json'
SNAPSHOT = json.loads(FIXTURE.read_text(encoding='utf-8'))
assert hashlib.sha256(FIXTURE.read_bytes()).hexdigest() == '9fdde161b75b5ae957e79ae05fea97750bef181fdbff152f73620687cbefdb3c'


def normalized(node):
    class Bindings(ast.NodeTransformer):
        def visit_Attribute(self, value):
            if isinstance(value.value, ast.Name) and value.value.id in ('curriculum_views', 'reviews', 'review_types'):
                return ast.copy_location(ast.Name(id=value.attr, ctx=value.ctx), value)
            return self.generic_visit(value)

        def visit_Name(self, value):
            if value.id == '_template_actor': value.id = '_actor'
            return value

        def visit_FunctionDef(self, value):
            # The only new argument is the existing cache invalidation callback
            # supplied by API composition. The command still calls it once at
            # the same position outside its transaction.
            pairs = [(a, d) for a, d in zip(value.args.kwonlyargs, value.args.kw_defaults)
                     if a.arg != 'invalidate_curriculum_cache']
            value.args.kwonlyargs = [a for a, _ in pairs]
            value.args.kw_defaults = [d for _, d in pairs]
            self.generic_visit(value)
            if value.body and isinstance(value.body[0], ast.Expr) and isinstance(value.body[0].value, ast.Constant) and isinstance(value.body[0].value.value, str):
                value.body = value.body[1:]
            return value
    return ast.dump(Bindings().visit(deepcopy(node)), include_attributes=False)


def frozen_domain(module_name):
    """Execute the actual old definitions with only their reviewed pure closure."""
    from curriculum_api.catalogue.domain import values
    from learner_api.constants import PROGRAMME_STATUS_CHOICES
    from types import SimpleNamespace
    namespace = {'date': date, 'datetime': datetime, 'timedelta': timedelta, 're': re,
                 'curriculum_views': SimpleNamespace(**vars(values), PROGRAMME_STATUS_CHOICES=PROGRAMME_STATUS_CHOICES)}
    allowed = {entry['name'] for entry in SNAPSHOT['symbols'] if entry['owner'] == 'domain.' + module_name}
    for source in SNAPSHOT['sources'].values():
        tree = ast.parse(source)
        nodes = [n for n in tree.body if getattr(n, 'name', None) in allowed or
                 isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in allowed]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), '<original-review-domain>', 'exec'), namespace)
    return namespace


class TemplateScheduleBoundary(unittest.TestCase):
    def test_readiness_adapter_rejects_unreviewed_edits_and_preserves_old_evidence(self):
        from curriculum_api.review_management.tests import source_contracts
        tree = ast.parse((ROOT.parent / 'views.py').read_text(encoding='utf-8-sig'))
        restored = source_contracts.restore_tree(tree, 'curriculum_api/views.py')
        self.assertEqual(source_contracts.fingerprint(restored), source_contracts.BEFORE)
        self.assertIs(source_contracts.restore_tree(restored, 'curriculum_api/views.py'), restored)
        tree.body.append(ast.parse('unexpected = True').body[0])
        with self.assertRaises(AssertionError):
            source_contracts.restore_tree(tree, 'curriculum_api/views.py')

    def test_all_108_source_symbols_preserve_bodies_sql_and_control_flow(self):
        self.assertEqual(len(SNAPSHOT['symbols']), 108)
        originals = {key: ast.parse(value) for key, value in SNAPSHOT['sources'].items()}
        for entry in SNAPSHOT['symbols']:
            with self.subTest(old=entry['old'], symbol=entry['name']):
                def find(tree):
                    return next(n for n in tree.body if getattr(n, 'name', None) == entry['name'] or
                                isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == entry['name'])
                actual = ast.parse((ROOT / (entry['owner'].replace('.', '/') + '.py')).read_text())
                self.assertEqual(normalized(find(originals[entry['old']])), normalized(find(actual)))

    def test_dependency_direction_and_no_legacy_view_import(self):
        graph = {}
        for file in ROOT.rglob('*.py'):
            if 'tests' in file.relative_to(ROOT).parts: continue
            module = file.relative_to(ROOT).with_suffix('').as_posix().replace('/', '.')
            dependencies = set()
            for node in ast.walk(ast.parse(file.read_text())):
                if not isinstance(node, (ast.Import, ast.ImportFrom)): continue
                names = [node.module or ''] if isinstance(node, ast.ImportFrom) else [a.name for a in node.names]
                for name in names:
                    self.assertNotEqual(name, 'curriculum_api.views', file)
                    if module.startswith(('domain.', 'application.', 'infrastructure.')):
                        self.assertNotIn('.api.', name, (file, name))
                    if module.startswith('domain.'):
                        self.assertFalse(any(x in name for x in ('django', '.infrastructure', '.application', 'settings', 'psycopg')), (file, name))
                    if name.startswith('curriculum_api.review_management.'):
                        dependencies.add(name.removeprefix('curriculum_api.review_management.'))
            graph[module] = dependencies
        def visit(node, trail):
            self.assertNotIn(node, trail)
            for dependency in graph.get(node, ()): visit(dependency, trail + [node])
        for module in graph: visit(module, [])

    def test_calendar_months_recurrence_windows_limits_and_clash_identity(self):
        from curriculum_api.review_management.domain import recurrence
        old = frozen_domain('recurrence')
        for anchor in (date(2024, 1, 31), date(2025, 2, 28), date(2026, 11, 24)):
            for unit in ('days', 'weeks', 'months'):
                for interval in (1, 3, 12):
                    for limit in (None, 0, 1, 5):
                        args = (anchor, interval, unit, date(2025, 1, 1), date(2027, 12, 31))
                        kwargs = {'max_count': 15, 'occurrence_limit': limit}
                        with self.subTest(args=args, limit=limit):
                            self.assertEqual(recurrence.generate_occurrence_steps(*args, **kwargs), old['generate_occurrence_steps'](*args, **kwargs))
                            self.assertEqual(recurrence.generate_occurrences(*args, **kwargs), old['generate_occurrences'](*args, **kwargs))
        pairs = [('R2', '2027-01-20'), ('R1', '2027-01-01'), ('R1', '2027-01-01')]
        self.assertEqual(recurrence.clash_signature(pairs), old['clash_signature'](pairs))
        self.assertEqual(recurrence.clash_signature(pairs[::-1]), old['clash_signature'](pairs))

    def test_field_rules_nested_children_roles_and_error_keys(self):
        from curriculum_api.review_management.domain import template_rules
        old = frozen_domain('template_rules')
        fields = [None, {}, {'title': ' Text ', 'fieldType': 'text', 'required': True},
                  {'title': 'Choice', 'fieldType': 'list_item', 'configuration': {'options': [' A ', 'A', '', 'B']}},
                  {'title': 'Display', 'fieldType': 'title_description', 'required': True, 'configuration': {'respondentRoles': ['participant']}},
                  {'title': 'Case', 'fieldType': 'boolean_case_block', 'yesFields': [{'title': 'Child', 'fieldType': 'text', 'configuration': {'respondentRoles': ['employer', 'unknown', 'employer']}}]}]
        for field in fields:
            for depth in (0, 8, 9):
                before, after = {}, {}
                result = old['validate_field_payload'](deepcopy(field), 'sections[0].fields[0]', before, depth=depth)
                actual = template_rules.validate_field_payload(deepcopy(field), 'sections[0].fields[0]', after, depth=depth)
                self.assertEqual((actual, after), (result, before))

    def test_optional_count_hours_recurrence_and_identifier_normalization(self):
        from curriculum_api.review_management.domain import template_rules, classification
        old = frozen_domain('template_rules')
        for name, field in (('validate_occurrence_count', 'occurrenceCount'), ('validate_expected_otjh', 'expectedOtjh')):
            for value in (None, '', ' 2 ', 0, -1, 'bad', 1.5):
                before, after = {}, {}
                self.assertEqual((getattr(template_rules, name)({field: value}, after), after),
                                 (old[name]({field: value}, before), before))
        old_types = frozen_domain('classification')
        for name in ('', None, ' Career\u3000 Review ', 'Career--Review', 'MONTHLY Coaching Meeting'):
            for taken in ([], ['career_review', 'career_review_2']):
                self.assertEqual(classification.generate_review_type_code(name, taken), old_types['generate_review_type_code'](name, taken))


if __name__ == '__main__':
    unittest.main(verbosity=2)
