"""Exact quiz fallback regressions; all rows are synthetic and database-free."""
import unittest
from unittest.mock import patch

from learner_api import lms_alias_reconciliation as reconciliation
from learner_api import test_lms_alias_reconciliation_no_db as ownership_tests


class DirectQuizLookupTests(unittest.TestCase):
    setUp = ownership_tests.MembershipActivityOwnershipTests.setUp
    result = ownership_tests.MembershipActivityOwnershipTests.result
    definition = ownership_tests.MembershipActivityOwnershipTests.definition
    candidates = ownership_tests.MembershipActivityOwnershipTests.candidates

    def quiz(self, **changes):
        return {**self.definition(activity='quiz:8'), 'source_activity_kind': 'quiz',
                'curriculum_component_ref': 'COMP-SYNTHETIC',
                'curriculum_module_ref': 'MOD-SYNTHETIC', 'component_type': 'quiz',
                'component_status': 'active', 'component_module_id': 'MOD-SYNTHETIC',
                'component_week_id': 'WEEK-SYNTHETIC', 'linked_quiz_id': 80,
                'linked_quiz_status': 'published', 'linked_quiz_week_id': 'WEEK-SYNTHETIC',
                'historical_only': False, **changes}

    def completed(self, **changes):
        return self.result(**{'activity_type': 'Reading + Quiz', 'reading_viewed': True,
                             'quiz_passed': True, 'quiz_score': 8,
                             'quiz_maximum_score': 10, 'quiz_attempt_number': 2, **changes})

    def test_standalone_quiz_resolves_without_recreating_material(self):
        candidates, stats = self.candidates([self.completed(reading_viewed=False)], [self.quiz()])
        self.assertEqual([c['source_activity_id'] for c in candidates], ['quiz:8'])
        self.assertEqual(candidates[0]['curriculum_component_ref'], 'COMP-SYNTHETIC')
        self.assertEqual(candidates[0]['candidate_kind'], 'quiz')
        self.assertEqual(candidates[0]['quiz_score'], 8)
        self.assertEqual(candidates[0]['quiz_attempt_number'], 2)
        self.assertEqual(stats['unmapped_material_results'], 0)
        self.assertEqual(stats['direct_quiz_results_resolved'], 1)

    def test_missing_payload_quiz_id_preserves_material_and_adds_exact_quiz(self):
        candidates, stats = self.candidates([self.completed()], [self.definition(), self.quiz()])
        self.assertEqual([c['source_activity_id'] for c in candidates], ['material:8', 'quiz:8'])
        self.assertEqual(stats['unmapped_quiz_results'], 0)
        self.assertEqual(stats['direct_quiz_results_resolved'], 1)

    def test_explicit_quiz_metadata_path_is_unchanged(self):
        candidates, stats = self.candidates([self.completed()], [
            {**self.definition(), 'material_quiz_id': '9'},
            self.definition(activity='quiz:9'), self.quiz()])
        self.assertEqual([c['source_activity_id'] for c in candidates], ['material:8', 'quiz:9'])
        self.assertEqual(stats['direct_quiz_results_resolved'], 0)

    def test_conflicting_explicit_quiz_id_is_not_overridden(self):
        candidates, stats = self.candidates([self.completed()], [
            {**self.definition(), 'material_quiz_id': '9'}, self.quiz()])
        self.assertEqual([c['source_activity_id'] for c in candidates], ['material:8'])
        self.assertEqual(stats['ambiguous_mapping_results'], 1)

    def test_unverified_inactive_and_cross_scope_targets_stay_ambiguous(self):
        for changes in (
            {'curriculum_component_ref': None}, {'component_status': 'archived'},
            {'component_type': 'reading'}, {'source_activity_kind': 'material'},
            {'component_module_id': 'OTHER'}, {'curriculum_module_ref': None},
            {'linked_quiz_id': None}, {'linked_quiz_status': 'draft'},
            {'component_week_id': None}, {'linked_quiz_week_id': 'OTHER'},
            {'source_course_id': 6}, {'source_activity_id': 'quiz:9'},
        ):
            with self.subTest(changes=changes):
                candidates, stats = self.candidates([self.completed()], [self.quiz(**changes)])
                self.assertEqual(candidates, [])
                self.assertEqual(stats['direct_quiz_results_resolved'], 0)
                self.assertEqual(stats['ambiguous_mapping_results'], 1)

    def test_duplicate_material_or_quiz_definitions_are_not_bypassed(self):
        for definitions in ([self.quiz(), self.quiz()],
                            [self.definition(), self.definition(), self.quiz()]):
            with self.subTest(definitions=definitions):
                candidates, stats = self.candidates([self.completed()], definitions)
                self.assertEqual(candidates, [])
                self.assertEqual(stats['ambiguous_mapping_results'], 1)

    def test_trashed_and_explicit_historical_targets_stay_historical(self):
        for changes in ({'linked_quiz_status': 'trash'},
                        {'historical_only': True, 'curriculum_component_ref': None}):
            for with_material in (False, True):
                with self.subTest(changes=changes, with_material=with_material):
                    definitions = ([self.definition()] if with_material else []) + [self.quiz(**changes)]
                    candidates, stats = self.candidates([self.completed()], definitions)
                    self.assertFalse(any(c['candidate_kind'] == 'quiz' for c in candidates))
                    self.assertEqual(stats['historical_mapping_results'], 1)
                    self.assertEqual(stats['direct_quiz_results_resolved'], 0)

    def test_cross_module_trash_is_ambiguous_not_assumed_historical(self):
        candidates, stats = self.candidates([self.completed()], [
            self.quiz(component_module_id='OTHER', linked_quiz_status='trash')])
        self.assertEqual(candidates, [])
        self.assertEqual(stats['historical_mapping_results'], 0)
        self.assertEqual(stats['ambiguous_mapping_results'], 1)

    def test_completion_status_alone_cannot_invent_quiz_completion(self):
        for changes in ({'quiz_passed': False}, {'quiz_passed': None},
                        {'activity_type': 'reading'}):
            with self.subTest(changes=changes):
                candidates, stats = self.candidates([self.completed(**changes)], [self.quiz()])
                self.assertEqual(candidates, [])
                self.assertEqual(stats['direct_quiz_results_resolved'], 0)

    def test_combined_material_still_requires_reading_completion(self):
        candidates, stats = self.candidates([self.completed(reading_viewed=False)],
                                             [self.definition(), self.quiz()])
        self.assertEqual([c['source_activity_id'] for c in candidates], ['material:8'])
        self.assertEqual(stats['direct_quiz_results_resolved'], 0)

    def test_direct_lookup_cannot_bypass_owner_alias_or_membership(self):
        for changes in ({'membership_id': None}, {'canonical_learner_id': 2},
                        {'learner_id': 999}, {'course_source_system': 'other'},
                        {'membership_deleted_at': 'historical'}):
            with self.subTest(changes=changes):
                candidates, stats = self.candidates([self.completed(**changes)], [self.quiz()])
                self.assertEqual(candidates, [])
                self.assertEqual(stats['direct_quiz_results_resolved'], 0)

    def test_result_counts_and_candidate_deduplication_remain_distinct(self):
        candidates, stats = self.candidates([
            self.completed(), self.completed(learner_id=100),
            self.completed(learner_id=200, canonical_learner_id=2),
        ], [self.quiz()])
        self.assertEqual(stats['direct_quiz_results_resolved'], 3)
        self.assertEqual([c['learner_id'] for c in candidates], [1, 2])
        self.assertEqual(candidates[0]['source_learner_ids'], ['100', '101'])

    def test_empty_scope_has_zero_mapping_counts_without_queries(self):
        with patch.object(reconciliation, '_rows') as read:
            candidates, stats = reconciliation._completion_candidates(None, {})
        read.assert_not_called()
        self.assertEqual(candidates, [])
        for field in ('direct_quiz_results_resolved', 'historical_mapping_results',
                      'ambiguous_mapping_results'):
            self.assertEqual(stats[field], 0)


if __name__ == '__main__':
    unittest.main()
