"""Actual original/new Review policies and source contracts, without Django."""
import ast
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
import hashlib
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/instance_boundary.json').read_text())
ORIGINAL = ast.parse(FIXTURE['source'])
OWNERS = FIXTURE['owners']


def find(tree, name):
    return next(n for n in tree.body if getattr(n, 'name', None) == name or
                isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == name)


def normalize(node):
    class Bindings(ast.NodeTransformer):
        def visit_Attribute(self, n):
            if isinstance(n.value, ast.Name) and n.value.id in ('curriculum_views', 'reviews', 'review_types', 'review_schedule'):
                return ast.copy_location(ast.Name(id=n.attr, ctx=n.ctx), n)
            return self.generic_visit(n)

        def visit_ImportFrom(self, n):
            if ((n.module == 'review_pdf' and n.level == 1) or
                    (n.module == 'domain.pdf_policy' and n.level == 2)):
                # The same availability function now belongs to the pure policy.
                assert [(a.name, a.asname) for a in n.names] == [('pdf_availability', None)]
                n.module, n.level = 'curriculum_api.review_pdf', 0
            return n

        def visit_Call(self, n):
            # Inline ONLY the two extracted read expressions for source parity.
            for entry in FIXTURE['query_extractions'].values():
                if ast.dump(n) == ast.dump(ast.parse(entry['replacement'], mode='eval').body):
                    return self.visit(ast.parse(entry['previous'], mode='eval').body)
            return self.generic_visit(n)
    return ast.dump(Bindings().visit(deepcopy(node)))


def frozen_domain():
    """Compile original source nodes with the inspected, pure import closure."""
    from curriculum_api.catalogue.domain import values
    from curriculum_api.review_management.domain import template_rules
    ns = {'curriculum_views': values, 'reviews': template_rules, 'deepcopy': deepcopy,
          'datetime': datetime, 'date': date, 'Decimal': Decimal}
    names = {name for name, owner in OWNERS.items() if owner.startswith('domain.')}
    nodes = [n for n in ORIGINAL.body if getattr(n, 'name', None) in names or
             isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<original-instance-policies>', 'exec'), ns)
    return ns


class InstanceBoundaryTests(unittest.TestCase):
    def test_original_source_hash_and_every_extracted_symbol(self):
        self.assertEqual(hashlib.sha256(FIXTURE['source'].encode()).hexdigest(),
                         '0d410ce4c63148235093c4e3d63352f848f2f3f42c8f1255908b4b04f8c0dd6f')
        self.assertEqual(len(OWNERS), 121)
        for name, owner in OWNERS.items():
            with self.subTest(symbol=name):
                old = find(ORIGINAL, name)
                actual = find(ast.parse((ROOT / (owner.replace('.', '/') + '.py')).read_text()), name)
                if name == 'logger':
                    old = deepcopy(old)
                    old.value.args = [ast.Constant('curriculum_api.review_instances')]
                self.assertEqual(normalize(actual), normalize(old))

    def test_exact_sql_extractions_preserve_parameters_and_returns(self):
        tree = ast.parse((ROOT / 'infrastructure/instance_rows.py').read_text())
        for name, helper, argument in (
            ('_save_review_instance_answers_locked', 'find_review_instance_answer_rows', 'field_id'),
            ('record_review_instance_signature', 'find_review_instance_signature_rows', 'role'),
        ):
            with self.subTest(helper=helper):
                node = find(tree, helper)
                self.assertEqual([a.arg for a in node.args.args], ['instance_id', argument])
                self.assertEqual(len(node.body), 2)  # docstring and the exact read
                expected = ast.parse(FIXTURE['query_extractions'][name]['previous'].replace("instance_row.get('id')", 'instance_id'), mode='eval').body
                self.assertEqual(ast.dump(node.body[1].value), ast.dump(expected))

    def test_domain_closure_and_direction(self):
        for owner in sorted(set(OWNERS.values())):
            text = (ROOT / (owner.replace('.', '/') + '.py')).read_text()
            for node in ast.walk(ast.parse(text)):
                if isinstance(node, ast.ImportFrom):
                    names = [node.module or '']
                elif isinstance(node, ast.Import):
                    names = [a.name for a in node.names]
                else:
                    continue
                for name in names:
                    self.assertNotIn(name, ('curriculum_api.views', 'curriculum_api.review_instances'))
                    self.assertNotIn('.api.', name)
                    if owner.startswith('infrastructure.'):
                        self.assertNotIn('.application.', name)
                    if owner.startswith('domain.'):
                        self.assertFalse(any(token in name for token in ('django', 'psycopg', '.infrastructure', '.application', 'settings', 'coach_api')))
            if owner.startswith('domain.'):
                importlib.import_module('curriculum_api.review_management.' + owner)

    def test_signature_roles_and_lifecycle_rejections_match_original(self):
        from curriculum_api.review_management.domain import instance_rules as rules
        old = frozen_domain()
        for value in (None, {}, {'advisor': True}, {'advisor': {'required': True}, 'participant': False},
                      {'employer': {'required': False}, 'referrer': 'yes'}, {'unknown': True}):
            self.assertEqual(rules.required_signature_roles(deepcopy(value)), old['required_signature_roles'](deepcopy(value)))
        for status in (None, '', 'not-scheduled', 'scheduled', 'in-progress', 'awaiting-signature', 'completed', 'unexpected'):
            for name in ('_manual_override_status_rejection', '_complete_review_instance_status_rejection', '_reopen_review_instance_status_rejection'):
                self.assertEqual(getattr(rules, name)(status), old[name](status))

    def test_answer_safe_merge_preserves_nested_and_removed_history(self):
        from curriculum_api.review_management.domain import instance_definitions as policy
        old = frozen_domain()
        prior = [{'id': 'S1', 'fields': [{'id': 'A', 'title': 'Old', 'fieldType': 'text', 'required': True},
                   {'id': 'B', 'fieldType': 'boolean_case_block', 'yesFields': [{'id': 'C', 'fieldType': 'text'}]}]},
                 {'id': 'S2', 'fields': [{'id': 'D', 'fieldType': 'text'}]}]
        live = [{'id': 'S1', 'fields': [{'id': 'A', 'title': 'New', 'fieldType': 'number', 'required': False},
                  {'id': 'NEW', 'fieldType': 'text'}]}]
        originals = deepcopy((prior, live))
        for answered in (None, [], ['A'], ['C'], ['D'], ['A', 'C', 'D'], ['A', 'A']):
            actual = policy.merge_editable_definition_sections(prior, live, answered)
            self.assertEqual(actual, old['merge_editable_definition_sections'](prior, live, answered))
            if answered and 'A' in answered:
                a = policy._field_index(actual)['A']
                self.assertEqual((a['title'], a['fieldType'], a['required']), ('New', 'text', True))
        self.assertEqual((prior, live), originals)

    def test_visible_required_fields_and_respondent_roles(self):
        from curriculum_api.review_management.domain import instance_definitions as policy
        old = frozen_domain()
        sections = [{'fields': [{'id': 'CASE', 'fieldType': 'boolean_case_block', 'required': True,
          'yesFields': [{'id': 'Y', 'fieldType': 'text', 'required': True, 'configuration': {'respondentRoles': ['employer']}}],
          'noFields': [{'id': 'N', 'fieldType': 'text', 'required': True, 'configuration': {'respondentRoles': ['participant']}}]}]}]
        for value in (None, '', 'yes', 'no', 'unexpected'):
            answers = {'CASE': {'answer': value}}
            self.assertEqual(policy._visible_required_unanswered_fields(sections, answers), old['_visible_required_unanswered_fields'](sections, answers))
        for role in ('advisor', 'employer', 'participant', 'unknown', ''):
            self.assertEqual(policy.writable_field_ids_for_role(sections, role), old['writable_field_ids_for_role'](sections, role))

    def test_eligibility_normalization_and_historical_progress_are_unchanged(self):
        from curriculum_api.review_management.domain import instance_rules as rules, instance_definitions as definitions
        old = frozen_domain()
        for statuses in (None, [], ['active'], '["active"]', 'invalid'):
            for status in (None, 'active', '\tactive\u3000', 'inactive'):
                row = {'applicable_statuses': statuses}
                self.assertEqual(rules.learner_is_eligible(row, status), old['learner_is_eligible'](row, status))
        for stored in (None, '', {}, {'total': 12}, {'schemaVersion': 5, 'formulaVersion': 'v5', 'total': 12}):
            row = {'progress_snapshot': deepcopy(stored)}
            self.assertEqual(definitions.review_instance_progress_snapshot(row), old['review_instance_progress_snapshot'](row))
            self.assertEqual(row, {'progress_snapshot': stored})

    def test_manual_and_generated_identities_and_ambiguous_legacy_keys(self):
        from curriculum_api.review_management.domain import occurrence_identity as identity
        old = frozen_domain()
        for number in (None, 0, 1, '1'):
            self.assertEqual(identity.review_calendar_event_key(1, 'T', number), old['review_calendar_event_key'](1, 'T', number))
        self.assertNotEqual(identity.review_calendar_event_key(1, 'T', 1), identity.review_calendar_event_key_manual(1, 'T', 1))
        event = {'source': 'mcr', 'learnerId': '1', 'sequence': 1, 'targetDate': '2026-01-01',
                 'reviewTemplateId': 'T', 'occurrenceNumber': 1, 'eventKey': 'review:1:T:1'}
        record = SimpleNamespace(event_key='mcr:1:1:2026-01-01', review_template_id='', occurrence_number=None, learner_profile_id=1)
        for events in ([event], [event, dict(event, reviewTemplateId='T2')], [dict(event, occurrenceNumber=None)]):
            before, after = deepcopy(events), deepcopy(events)
            self.assertEqual(identity.reconcile_review_event_keys(after, [record]), old['reconcile_review_event_keys'](before, [record]))
            self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
