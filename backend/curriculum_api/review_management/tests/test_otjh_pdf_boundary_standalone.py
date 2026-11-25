"""Pure rules and source parity; no Django setup or database imports."""
import ast
from copy import deepcopy
import importlib
import itertools
import re
import unittest

from curriculum_api.review_management.domain import pdf_policy, otjh_rules
from curriculum_api.review_management.domain.instance_rules import required_signature_roles
from curriculum_api.review_management.tests.otjh_pdf_oracle import (
    ROOT, FIXTURE, SOURCES, compile_original, source_node, normalized,
)


def original_policy():
    ns = {'re': re, 'required_signature_roles': required_signature_roles}
    for module, names in (
        ('review_pdf_presentation', ['IMAGE_PATTERN', 'REVIEW_TYPE_MCM', 'REVIEW_TYPE_APTEM_MCM',
         'REVIEW_TYPE_PROGRESS_REVIEW', 'EXPORTABLE_REVIEW_TYPES', 'review_type_code', 'is_mcm_review', 'programme_dates']),
        ('review_pdf', ['pdf_availability']),
    ):
        tree = ast.Module(body=[source_node(SOURCES[module], name) for name in names], type_ignores=[])
        exec(compile(tree, '<original-pdf-policy>', 'exec'), ns)
    return ns


class OtjhPdfBoundaryTests(unittest.TestCase):
    def test_all_27_declarations_match_frozen_source(self):
        self.assertEqual(len(FIXTURE['owners']), 27)
        for symbol, owner in FIXTURE['owners'].items():
            module, name = symbol.split('.')
            with self.subTest(symbol=symbol):
                old = source_node(SOURCES[module], name)
                new = source_node((ROOT / owner).read_text(), name)
                self.assertEqual(normalized(new), normalized(old))

    def test_dependency_direction_and_pure_domain_imports(self):
        for owner in sorted(set(FIXTURE['owners'].values())):
            tree = ast.parse((ROOT / owner).read_text())
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [node.module or '']
                else:
                    continue
                for name in names:
                    self.assertNotIn(name, ('curriculum_api.views', 'curriculum_api.review_otjh',
                                           'curriculum_api.review_pdf', 'curriculum_api.review_pdf_presentation'))
                    if not owner.startswith('api/'):
                        self.assertFalse(name.startswith('api.') or '.api.' in name)
                    if owner.startswith(('domain/', 'infrastructure/')):
                        self.assertFalse(name.startswith('application.') or '.application.' in name)
                    if owner.startswith('domain/'):
                        self.assertFalse(any(token in name for token in ('django', 'psycopg', 'settings',
                                              'infrastructure', 'application', 'requests', 'reportlab')))
            if owner.startswith('domain/'):
                importlib.import_module('curriculum_api.review_management.' + owner[:-3].replace('/', '.'))

    def test_otjh_flag_and_numeric_values_match_original(self):
        ns = {}
        tree = ast.Module(body=[source_node(SOURCES['review_otjh'], 'template_otjh_hours')], type_ignores=[])
        exec(compile(tree, '<original-hours-rule>', 'exec'), ns)
        rows = [None, {}] + [dict(counts_towards_otjh=flag, expected_otjh=value)
            for flag, value in itertools.product((None, False, True, 0, 1, ''),
                (None, '', 0, -3, 2.125, '2.5', 'bad', 'nan', 'inf'))]
        for row in rows:
            with self.subTest(row=row):
                self.assertEqual(otjh_rules.template_otjh_hours(row), ns['template_otjh_hours'](row))

    def test_export_eligibility_and_saved_signature_requirements_match(self):
        old = original_policy()['pdf_availability']
        signature = dict(required=True, signed=True, signedName='Synthetic coach',
                         signedAt='2026-01-01', signature='data:image/png;base64,AAAA')
        for kind, status, required in itertools.product(
            ('mcm', 'aptem_mcm', 'progress_review', 'induction', None),
            ('completed', 'in-progress', '', None), (True, False)):
            for missing in (None, 'signed', 'signedName', 'signedAt', 'signature'):
                state = dict(signature, required=required)
                if missing:
                    state[missing] = None
                definition = {'template': {'reviewTypeCode': kind}, 'instance': {'status': status},
                              'signatures': {'advisor': state}}
                with self.subTest(kind=kind, status=status, missing=missing, required=required):
                    self.assertEqual(pdf_policy.pdf_availability(definition), old(deepcopy(definition)))

    def test_programme_dates_keep_snapshot_then_learner_then_delivery_precedence(self):
        old = original_policy()['programme_dates']
        for kind, snapshot, learner in itertools.product(('mcm', 'progress_review'),
                (None, {}, {'calculatedFrom': '2026-02-01'}), (None, '2026-03-01')):
            definition = {'template': {'reviewTypeCode': kind}, 'progressSnapshot': snapshot}
            information = {'startDate': '2026-01-01', 'endDate': '2027-01-01',
                           'learnerStartDate': learner, 'learnerEndDate': None}
            self.assertEqual(pdf_policy.programme_dates(definition, information), old(definition, information))


if __name__ == '__main__':
    unittest.main()
