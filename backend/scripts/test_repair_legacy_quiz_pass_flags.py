"""Synthetic, network-free tests for evidence-based pass flag repair."""
from copy import deepcopy
import unittest
from repair_legacy_quiz_pass_flags import plan_flags, verify_preserved


class PassFlagTests(unittest.TestCase):
    def setUp(self):
        self.state = {'owner': {'id': 1}, 'course': {'source_course_ref': '50'},
            'identity': {'source_learner_id': '3', 'source_payload': {'source_email': 'test@example.invalid'}},
            'definitions': [{'id': 10, 'source_activity_id': 'quiz:20', 'deleted_at': None}],
            'sources': [{'learner_id': 1, 'source_system': 'old_lms', 'source_catalog_activity_id': 10,
                'canonical_progress_id': 100, 'source_activity_id': 'quiz:20', 'deleted_at': None}],
            'progress': [{'id': 100, 'learner_id': 1, 'kind': 'quiz', 'source_system': 'old_lms',
                'activity_status': 'passed', 'passed': None, 'deleted_at': None, 'actual_seconds': 123}]}
        self.source = {'course_id': 50, 'source_user_id': 3, 'email': 'test@example.invalid',
            'facts': {'quiz:20': {'passed': True}}}

    def test_confirmed_missing_flag_only_and_no_mutation(self):
        before = deepcopy(self.state)
        self.assertEqual(plan_flags(self.state, self.source)['updates'], [{'id': 100, 'source_ref': 'quiz:20'}])
        self.assertEqual(self.state, before)

    def test_missing_or_failed_source_cannot_award_pass(self):
        for value in (False, None):
            self.source['facts']['quiz:20']['passed'] = value
            self.assertEqual(plan_flags(self.state, self.source)['updates'], [])

    def test_preserve_explicit_results_and_deleted_or_foreign_records(self):
        for key, value in [('passed', False), ('passed', True), ('deleted_at', 'date'), ('learner_id', 2), ('source_system', 'native')]:
            state = deepcopy(self.state)
            state['progress'][0][key] = value
            self.assertEqual(plan_flags(state, self.source)['updates'], [])

    def test_no_title_or_untyped_matching(self):
        self.state['sources'][0]['source_activity_id'] = '20'
        self.assertEqual(plan_flags(self.state, self.source)['updates'], [])

    def test_foreign_deleted_or_native_lineage_cannot_establish_pass(self):
        for key, value in [('learner_id', 2), ('deleted_at', 'date'), ('source_system', 'native'), ('source_catalog_activity_id', 999)]:
            state = deepcopy(self.state)
            state['sources'][0][key] = value
            self.assertEqual(plan_flags(state, self.source)['updates'], [])

    def test_ambiguous_quiz_routes_need_review(self):
        self.state['definitions'].append({'id': 11, 'source_activity_id': 'quiz:21', 'deleted_at': None})
        self.state['sources'].append({**self.state['sources'][0], 'source_catalog_activity_id': 11, 'source_activity_id': 'quiz:21'})
        self.assertEqual(plan_flags(self.state, self.source), {'updates': [], 'unresolved': [100]})

    def test_removed_history_fails_verification(self):
        with self.assertRaises(ValueError):
            verify_preserved({100: self.state['progress'][0]}, {}, {100})

    def test_wrong_source_identity_or_course_rejected(self):
        for key, value in [('source_user_id', 4), ('email', 'other@example.invalid'), ('course_id', 51)]:
            source = {**self.source, key: value}
            with self.assertRaises(ValueError):
                plan_flags(self.state, source)

    def test_verification_rejects_any_history_or_hours_rewrite(self):
        original = {100: self.state['progress'][0]}
        updated = {100: {**original[100], 'passed': True}}
        verify_preserved(original, updated, {100})
        updated[100]['actual_seconds'] = 124
        with self.assertRaises(ValueError):
            verify_preserved(original, updated, {100})

    def test_repaired_flag_is_idempotent(self):
        self.state['progress'][0]['passed'] = True
        self.assertEqual(plan_flags(self.state, self.source)['updates'], [])


if __name__ == '__main__':
    unittest.main()
