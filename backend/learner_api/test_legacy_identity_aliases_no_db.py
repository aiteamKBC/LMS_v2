"""Synthetic identity and source-reader regressions; no database or network."""
import ast
from copy import deepcopy
import hashlib
import logging
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api.legacy_identity_aliases import plan_aliases


def state():
    return {
        'learners': [{'id': 1, 'aptem_id': 101, 'enrolment_id': 11, 'email': 'work@example.test',
                      'account_id': 11, 'account_email': 'work@example.test', 'account_aptem_id': '101'}],
        'identities': [{'id': 10, 'learner_id': 1, 'enrolment_id': 11, 'source_system': 'old_lms',
                        'source_learner_id': '21', 'source_payload': {'learner_email': 'work@example.test'},
                        'deleted_at': None}],
        'aliases': [dict(aptem_id=101, aptem_email='work@example.test', canonical_lms_id=21,
                         lms_learner_id=21, lms_email='work@example.test', is_primary=True, match_basis='primary'),
                    dict(aptem_id=101, aptem_email='work@example.test', canonical_lms_id=21,
                         lms_learner_id=22, lms_email=' Personal@Example.Test ',
                         is_primary=False, match_basis='manual_user_confirmed')],
    }


class AliasPlanTests(unittest.TestCase):
    def test_copies_secondary_identity_without_changing_primary_and_is_idempotent(self):
        data = state()
        before = deepcopy(data)
        plan = plan_aliases(data)
        self.assertEqual([p['resolution'] for p in plan], ['already_present', 'insert'])
        self.assertEqual(plan[1]['source_payload']['source_email'], 'personal@example.test')
        self.assertEqual(data, before)
        data['identities'].append(dict(id=12, learner_id=1, enrolment_id=11, source_system='old_lms',
            source_learner_id='22', source_payload=plan[1]['source_payload'], deleted_at=None))
        self.assertEqual([p['resolution'] for p in plan_aliases(data)], ['already_present'] * 2)

    def test_primary_source_email_is_added_without_destroying_original_email(self):
        data = state()
        data['aliases'][0]['lms_email'] = 'original@example.test'
        item = plan_aliases(data)[0]
        self.assertEqual(item['resolution'], 'add_source_email')
        self.assertEqual(item['source_payload']['learner_email'], 'work@example.test')
        self.assertEqual(item['source_payload']['source_email'], 'original@example.test')
        data['identities'][0]['source_payload'] = item['source_payload']
        self.assertEqual(plan_aliases(data)[0]['resolution'], 'already_present')

    def test_primary_with_unknown_source_email_is_not_overwritten(self):
        data = state()
        data['identities'][0]['source_payload']['source_email'] = 'unknown@example.test'
        self.assertEqual(plan_aliases(data)[0]['reason'], 'existing_source_email_conflict')

    def test_source_id_cannot_be_claimed_by_another_learner(self):
        data = state()
        data['identities'].append({**data['identities'][0], 'id': 99, 'learner_id': 2,
                                   'source_learner_id': '22'})
        self.assertEqual(plan_aliases(data)[1]['reason'], 'existing_source_conflict_or_deleted')

    def test_duplicate_email_across_learners_is_rejected_case_insensitively(self):
        data = state()
        data['learners'].append({**data['learners'][0], 'id': 2, 'aptem_id': 102,
                                 'email': 'PERSONAL@example.test'})
        self.assertEqual(plan_aliases(data)[1]['reason'], 'email_owner_conflict')

    def test_conflicting_legacy_source_owners_are_not_guessed(self):
        data = state()
        data['aliases'].append({**data['aliases'][1], 'aptem_id': 102})
        self.assertEqual(plan_aliases(data)[1]['reason'], 'legacy_source_owner_conflict')

    def test_deleted_identity_is_not_resurrected(self):
        data = state()
        data['identities'].append({**data['identities'][0], 'id': 12,
                                   'source_learner_id': '22', 'deleted_at': '2026-01-01'})
        self.assertEqual(plan_aliases(data)[1]['reason'], 'existing_source_conflict_or_deleted')

    def test_missing_learner_and_duplicate_canonical_aptem_are_reviewed(self):
        data = state()
        data['learners'] = []
        self.assertEqual(plan_aliases(data)[1]['reason'], 'no_canonical_learner')
        data = state()
        data['learners'].append({**data['learners'][0], 'id': 2})
        self.assertEqual(plan_aliases(data)[1]['reason'], 'ambiguous_canonical_learner')

    def test_wrong_enrolment_owner_cannot_authorize_alias(self):
        data = state()
        data['learners'][0]['account_aptem_id'] = '102'
        self.assertEqual(plan_aliases(data)[1]['reason'], 'enrolment_owner_mismatch')

    def test_unenrolled_historical_learner_keeps_null_enrolment(self):
        data = state()
        data['learners'][0].update(enrolment_id=None, account_id=None, account_email=None, account_aptem_id=None)
        item = plan_aliases(data)[1]
        self.assertEqual(item['resolution'], 'insert')
        self.assertIsNone(item['enrolment_id'])

    def test_missing_primary_and_canonical_email_mismatch_are_rejected(self):
        data = state()
        data['identities'] = []
        self.assertEqual(plan_aliases(data)[1]['reason'], 'primary_identity_missing_or_ambiguous')
        data = state()
        data['aliases'][1]['aptem_email'] = 'other@example.test'
        self.assertEqual(plan_aliases(data)[1]['reason'], 'canonical_email_mismatch')


class SourceReaderTests(unittest.TestCase):
    def setUp(self):
        self.scope = dict(settings=SimpleNamespace(KBC_LMS_API_KEY='synthetic', KBC_LMS_SCHEMA_URL='https://example.test'),
                          _endpoint_label=lambda value: value, logger=logging.getLogger(__name__),
                          hashlib=hashlib, _remember=lambda key, fn: fn(),
                          _read_identity=Mock(return_value=[{'id': 5, 'activities': [], 'results': []}]))
        path = Path(__file__).with_name('subject_source.py')
        node = next(n for n in ast.parse(path.read_text(encoding='utf-8')).body
                    if isinstance(n, ast.FunctionDef) and n.name == 'read_learner')
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), self.scope)
        self.cursor = Mock()

    def test_each_canonical_alias_fetch_uses_its_own_exact_email(self):
        self.cursor.fetchall.return_value = [(99, '21', 'work@example.test', True),
                                            (99, '22', 'personal@example.test', False)]
        result = self.scope['read_learner'](self.cursor, 101, 'work@example.test')
        self.assertEqual(len(result['groups']), 1)
        self.assertEqual([c.args[2:4] for c in self.scope['_read_identity'].call_args_list],
                         [(21, 'work@example.test'), (22, 'personal@example.test')])

    def test_canonical_id_equal_to_alias_id_does_not_grant_primary_email_fallback(self):
        self.cursor.fetchall.return_value = [(22, '21', 'work@example.test', True),
                                            (22, '22', 'personal@example.test', False)]
        self.scope['read_learner'](self.cursor, 101, 'work@example.test')
        self.assertEqual(self.scope['_read_identity'].call_args_list[1].args[3], 'personal@example.test')

    def test_wrong_owner_or_invalid_external_id_prevents_fetch(self):
        for rows in ([(99, '21', 'work@example.test', True), (100, '22', 'personal@example.test', False)],
                     [(99, 'invalid', 'work@example.test', True)]):
            self.cursor.fetchall.return_value = rows
            self.assertIsNone(self.scope['read_learner'](self.cursor, 101, 'work@example.test'))
        self.scope['_read_identity'].assert_not_called()


if __name__ == '__main__':
    unittest.main()
