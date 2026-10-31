"""Direct identity selector and compatibility parity; no Django/app startup."""
import ast
from copy import deepcopy
import inspect
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from learner_api.selectors import identity as selector
from learner_api.test_canonical_learning_no_db import functions


# Frozen pre-LB-01 functions. This test-only oracle checks exact old/new behavior;
# it is not used by application code and must not follow selector refactors.
LEGACY_SOURCE = """def profile(learner_id):
    records = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id,
        u."Planned_hours" AS programme_planned_hours,
        EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id) AS progress_transfer_active
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=%s''', [learner_id])
    if not records:
        return None
    if len(records) != 1:
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return _validated_profile(records[0])

def _validated_profile(owner):
    email = str(owner.get('email') or '').strip().casefold()
    account_email = str(owner.get('account_email') or '').strip().casefold()
    aptem = str(owner.get('account_aptem_id') or '').strip().lstrip('0')
    if (owner.get('account_record_id') is None or not email or email != account_email
            or (aptem and aptem != str(owner.get('aptem_id') or '').lstrip('0'))):
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner
"""


class IdentityError(Exception):
    def __init__(self, message, code, status):
        super().__init__(message)
        self.code, self.status = code, status


class IdentitySelectorTests(unittest.TestCase):
    def setUp(self):
        self.owner = dict(id=510, enrolment_id=271, aptem_id=3582,
                          account_record_id=271, account_aptem_id='003582',
                          email='learner@example.test', account_email='learner@example.test',
                          learner_type='apprenticeship', extra={'preserve': True})
        self.old_query = Mock()
        self.new_query = Mock()
        self.legacy = {'query': self.old_query, 'ServiceError': IdentityError}
        exec(compile(LEGACY_SOURCE, '<pre-LB-01 identity>', 'exec'), self.legacy)
        self.wrappers = {'query': self.new_query, 'ServiceError': IdentityError}
        functions('canonical_learning.py', self.wrappers,
                  {'profile', '_validated_profile', 'require_profile', 'enabled'})

    def outcome(self, call):
        try:
            return ('return', call())
        except IdentityError as error:
            return ('error', type(error), str(error), error.code, error.status)

    def assert_query_parity_with_training_profile_projection(self):
        new_sql, new_params = self.new_query.call_args.args
        old_sql, old_params = self.old_query.call_args.args
        added = ('l.lifecycle_status,l.programme_status,l.cohort,l.cohort_id,\n'
                 '        l.group_name,l.group_id,')
        resolved_programme = (
            "coalesce(nullif(btrim(programme.name),''),l.programme_id,'') AS programme"
        )
        programme_join = (
            '        LEFT JOIN curriculum.programmes programme '
            'ON programme.programme_id=l.programme_id\n'
        )
        self.assertIn(added, new_sql)
        self.assertIn(resolved_programme, new_sql)
        self.assertIn(programme_join, new_sql)
        normalized = new_sql.replace(added, '')
        normalized = normalized.replace(resolved_programme, 'l.programme')
        normalized = normalized.replace(programme_join, '')
        self.assertEqual(''.join(normalized.split()), ''.join(old_sql.split()))
        self.assertEqual(new_params, old_params)

    def assert_parity(self, changes):
        old = {**deepcopy(self.owner), **changes}
        new = deepcopy(old)
        before = deepcopy(new)
        self.old_query.return_value = [old]
        self.new_query.return_value = [new]
        expected = self.outcome(lambda: self.legacy['profile'](271))
        actual = self.outcome(lambda: self.wrappers['profile'](271))
        self.assertEqual(actual, expected)
        self.assert_query_parity_with_training_profile_projection()
        self.assertEqual(self.new_query.call_count, 1)
        self.assertEqual(new, before)
        if actual[0] == 'return':
            self.assertIs(actual[1], new)
        self.old_query.reset_mock()
        self.new_query.reset_mock()

    def test_email_and_account_validation_match_frozen_behavior(self):
        for changes in ({}, {'account_record_id': None}, {'account_record_id': 0},
                        {'email': None}, {'email': ''}, {'email': '  '},
                        {'account_email': None}, {'account_email': 'other@example.test'},
                        {'email': '  LEARNER@EXAMPLE.TEST ', 'account_email': 'learner@example.test'},
                        {'email': ' STRA\u00dfE@example.test ', 'account_email': 'strasse@example.test'}):
            with self.subTest(changes=changes):
                self.assert_parity(changes)
        unicode_owner = {**self.owner, 'email': ' STRA\u00dfE@example.test ',
                         'account_email': 'strasse@example.test'}
        self.assertIs(selector.validate_profile(unicode_owner, error_type=IdentityError), unicode_owner)
        self.new_query.assert_not_called()

    def test_aptem_edge_cases_preserve_truthiness_and_asymmetric_whitespace(self):
        for account in (None, '', ' ', 0, '0', '000', '003582', 3582, ' 003582 ', '9999'):
            for canonical in (3582, '003582', None, 0, ' 3582 '):
                with self.subTest(account=account, canonical=canonical):
                    self.assert_parity({'account_aptem_id': account, 'aptem_id': canonical})

    def test_learner_types_and_distinct_namespaces_keep_all_fields(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.assert_parity({'learner_type': kind, 'id': 17, 'enrolment_id': 271})

    def test_direct_selector_matches_wrapper_and_passes_enrolment_unchanged(self):
        self.new_query.return_value = [self.owner]
        for enrolment in (271, '271', None, 0, '271 OR 1=1'):
            with self.subTest(enrolment=enrolment):
                self.new_query.reset_mock()
                result = selector.profile_for_enrolment(enrolment, query=self.new_query,
                                                       error_type=IdentityError)
                self.assertIs(result, self.owner)
                self.assertEqual(self.new_query.call_count, 1)
                self.assertEqual(self.new_query.call_args.args[1], [enrolment])
                self.assertNotIn('271 OR 1=1', self.new_query.call_args.args[0])

    def test_exact_sql_parameters_and_single_query_match_original(self):
        self.old_query.return_value = self.new_query.return_value = [self.owner]
        self.assertIs(self.legacy['profile'](271), self.owner)
        self.assertIs(self.wrappers['profile'](271), self.owner)
        self.assert_query_parity_with_training_profile_projection()
        self.assertEqual(self.new_query.call_count, 1)

    def test_empty_and_duplicate_results_preserve_errors_and_query_count(self):
        for rows in ([], [self.owner, self.owner]):
            with self.subTest(rows=len(rows)):
                self.old_query.return_value = self.new_query.return_value = rows
                self.assertEqual(self.outcome(lambda: self.wrappers['profile'](271)),
                                 self.outcome(lambda: self.legacy['profile'](271)))
                self.assert_query_parity_with_training_profile_projection()
                self.assertEqual(self.new_query.call_count, 1)
                self.old_query.reset_mock()
                self.new_query.reset_mock()

    def test_query_failure_propagates_same_exception_without_retry(self):
        error = RuntimeError('synthetic read unavailable')
        self.new_query.side_effect = error
        with self.assertRaises(RuntimeError) as raised:
            self.wrappers['profile'](271)
        self.assertIs(raised.exception, error)
        self.assertEqual(self.new_query.call_count, 1)

    def test_validator_is_pure_and_returns_identical_owner(self):
        before = deepcopy(self.owner)
        self.assertIs(selector.validate_profile(self.owner, error_type=IdentityError), self.owner)
        self.assertIs(self.wrappers['_validated_profile'](self.owner), self.owner)
        self.assertEqual(self.owner, before)
        self.new_query.assert_not_called()

    def test_supplied_error_class_message_code_and_status_are_preserved(self):
        for method in (lambda: selector.validate_profile({}, error_type=IdentityError),
                       lambda: self.wrappers['_validated_profile']({})):
            with self.assertRaises(IdentityError) as raised:
                method()
            self.assertEqual(str(raised.exception), 'The consolidated learner identity needs review.')
            self.assertEqual((raised.exception.code, raised.exception.status),
                             ('identity_review_required', 409))
        self.new_query.assert_not_called()

    def test_wrapper_uses_current_query_binding_without_cache(self):
        self.new_query.return_value = [self.owner]
        self.assertIs(self.wrappers['profile'](271), self.owner)
        replacement = Mock(return_value=[])
        self.wrappers['query'] = replacement
        self.assertIsNone(self.wrappers['profile'](271))
        self.assertIsNone(self.wrappers['profile'](271))
        self.assertEqual(self.new_query.call_count, 1)
        self.assertEqual(replacement.call_count, 2)

    def test_wrapper_supplies_current_error_class(self):
        class ReplacementError(IdentityError):
            pass
        self.wrappers['ServiceError'] = ReplacementError
        self.new_query.return_value = [self.owner, self.owner]
        with self.assertRaises(ReplacementError):
            self.wrappers['profile'](271)
        with self.assertRaises(ReplacementError):
            self.wrappers['_validated_profile']({})

    def test_missing_required_profile_and_enabled_keep_existing_behavior(self):
        self.new_query.return_value = []
        self.assertFalse(self.wrappers['enabled'](271))
        with self.assertRaises(IdentityError) as raised:
            self.wrappers['require_profile'](271)
        self.assertEqual((str(raised.exception), raised.exception.code, raised.exception.status),
                         ('The learner is not linked to the consolidated learning record.',
                          'ssot_identity_required', 409))

    def test_existing_wrapper_signatures_remain_unchanged(self):
        for name in ('profile', '_validated_profile'):
            self.assertEqual(inspect.signature(self.wrappers[name]),
                             inspect.signature(self.legacy[name]))
        self.assertEqual(str(inspect.signature(self.wrappers['require_profile'])), '(learner_id)')
        self.assertEqual(str(inspect.signature(self.wrappers['enabled'])), '(learner_id)')

    def test_selector_module_import_has_no_application_or_io_dependencies(self):
        # Execute the actual module again with runtime I/O explicitly forbidden.
        source = Path(selector.__file__).read_text(encoding='utf-8')
        tree = ast.parse(source)
        imports = {
            alias.name.split('.')[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        } | {
            node.module.split('.')[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }
        self.assertEqual(imports, {'dataclasses', 'enum', 'typing'})
        with patch('builtins.open', side_effect=AssertionError('file I/O forbidden')), \
             patch('socket.socket', side_effect=AssertionError('network forbidden')):
            namespace = {'__name__': selector.__name__}
            exec(compile(tree, selector.__file__, 'exec'), namespace)
        self.assertTrue(callable(namespace['profile_for_enrolment']))
        self.assertTrue(callable(namespace['resolve_many_for_enrolments']))
        self.assertTrue(callable(namespace['validate_profile']))


if __name__ == '__main__':
    unittest.main()
