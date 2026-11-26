"""Synthetic recovery regression tests; no database, Django startup or HTTP."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from recover_live_legacy_completions import make_plan, completed_refs, verify


def fact(ident, kind='lesson'):
    return {'component_id': ident, 'title': 'Synthetic activity', 'component_kind': kind,
            'post_type': 'stm-quizzes' if kind == 'quiz' else 'stm-lessons', 'material_type': 'text',
            'completed': kind == 'lesson', 'passed': kind == 'quiz', 'started_at': None, 'completed_at': None}


def fixture():
    owner = {'id': 1}
    course = {'id': 50, 'source_course_ref': '50', 'source_course_title': 'Synthetic course', 'curriculum_module_ref': 'M'}
    definition = {'id': 10, 'source_course_id': 50, 'source_activity_id': 'material:10',
                  'deleted_at': None, 'source_position': 0, 'source_activity_title': 'Synthetic activity',
                  'source_activity_type': 'reading', 'curriculum_component_ref': None}
    progress = {'id': 100, 'learner_id': 1, 'entry_order': 1, 'deleted_at': None,
                'accepted': True, 'actual_seconds': 1800, 'activity_status': 'completed',
                'kind': 'reading', 'component_ref': 'journal:1', 'source_system': 'journal',
                'source_activity_id': 'journal:1', 'source_payload': {'original_source_ref': 'la:50:10'}}
    state = {'owner': owner, 'owners': [owner], 'courses': [course], 'definitions': [definition],
             'memberships': [{'id': 1, 'source_course_id': 50, 'deleted_at': None}],
             'progress': [progress], 'sources': [], 'source_routes': [], 'journals': [], 'segments': [],
             'identity': {'id': 2, 'source_learner_id': '3', 'source_payload': {'learner_email': 'learner@example.invalid'}}}
    source = {'course_id': 50, 'source_user_id': 3, 'email': 'learner@example.invalid',
              'timezone': '+00:00', 'facts': {'material:10': fact(10)}}
    return state, {50: source}


class CompletionRecoveryTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        self.state, self.sources = fixture()

    def test_missing_completion_creates_no_accepted_hours_and_does_not_modify_history(self):
        original = deepcopy(self.state)
        self.sources[50]['facts']['quiz:20'] = fact(20, 'quiz')
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(len(plan['progress']), 1)
        self.assertFalse(plan['progress'][0]['row']['accepted'])
        self.assertIs(plan['progress'][0]['row']['passed'], True)
        self.assertIsNone(plan['progress'][0]['row']['actual_seconds'])
        self.assertIsNone(plan['progress'][0]['row']['submitted_at'])
        self.assertEqual(completed_refs(plan['after'][50]), {'material:10', 'quiz:20'})
        self.assertEqual(plan['after'][50]['accepted_hours'], 0.5)
        self.assertEqual(self.state, original)
        self.assertNotIn('completed', plan['definitions'][0]['source_payload']['live_catalogue_recovery'])

    def test_relink_preserves_primary_journal_placement_and_counts_time_once(self):
        self.sources[50]['facts']['material:20'] = fact(20)
        self.state['sources'].append({'id': 2, 'learner_id': 1, 'source_system': 'old_lms',
            'source_activity_id': 'material:20', 'canonical_progress_id': 100, 'completed': True,
            'deleted_at': None, 'source_catalog_activity_id': None, 'source_course_ref': ''})
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(len(plan['relinks']), 1)
        self.assertEqual(len(plan['progress']), 0)
        self.assertEqual([s['row']['source_activity_id'] for s in plan['sources']], ['material:10'])
        self.assertEqual(completed_refs(plan['after'][50]), {'material:10', 'material:20'})
        self.assertEqual(plan['after'][50]['accepted_hours'], 0.5)

    def test_recovery_preserves_explicit_source_quiz_result_without_inventing_scores(self):
        for passed in (True, False, None):
            with self.subTest(passed=passed):
                state, sources = fixture()
                sources[50]['facts']['quiz:20'] = {**fact(20, 'quiz'), 'completed': True, 'passed': passed}
                row = make_plan(state, sources, [50], [])['progress'][0]['row']
                self.assertIs(row['passed'], passed)
                self.assertNotIn('grade', row)
                self.assertNotIn('achieved_score', row)
                self.assertNotIn('total_score', row)
                self.assertIsNone(row['actual_seconds'])

    def test_false_membership_is_removed_only_after_all_links_are_rehomed(self):
        wrong = {**self.state['courses'][0], 'id': 60, 'source_course_ref': '60'}
        self.state['courses'].append(wrong)
        self.state['memberships'].append({'id': 2, 'source_course_id': 60, 'deleted_at': None})
        self.state['definitions'].append({**self.state['definitions'][0], 'id': 20, 'source_course_id': 60,
                                          'source_activity_id': 'material:20'})
        self.state['source_routes'].append({'id': 20, 'source_course_ref': '60'})
        self.state['sources'].append({'id': 2, 'learner_id': 1, 'source_system': 'old_lms',
            'source_activity_id': 'material:20', 'canonical_progress_id': 100, 'completed': True,
            'deleted_at': None, 'source_catalog_activity_id': 20, 'source_course_ref': '60'})
        self.sources[50]['facts']['material:20'] = fact(20)
        plan = make_plan(self.state, self.sources, [50], [60])
        self.assertEqual(plan['memberships'], [2])
        self.assertNotIn(60, plan['after'])
        self.assertEqual(plan['after'][50]['accepted_hours'], 0.5)
        with self.assertRaisesRegex(ValueError, 'another assigned course'):
            make_plan(self.state, self.sources, [50], [])

    def test_deleted_evidence_is_retained_and_not_reactivated(self):
        self.sources[50]['facts']['quiz:20'] = fact(20, 'quiz')
        self.state['progress'].append({**self.state['progress'][0], 'id': 101, 'entry_order': 2,
            'source_system': 'old_lms', 'source_activity_id': 'quiz:20', 'component_ref': 'quiz:20',
            'deleted_at': '2026-01-01', 'source_payload': {}})
        self.state['sources'].append({'id': 2, 'source_system': 'old_lms', 'source_activity_id': 'quiz:20',
            'deleted_at': '2026-01-01', 'canonical_progress_id': 101})
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(len(plan['progress']), 1)
        self.assertEqual(plan['progress'][0]['row']['source_payload']['live_completion_recovery']['retained_source_ids'], [2])
        self.assertFalse(plan['progress'][0]['row']['accepted'])
        self.assertEqual(self.state['progress'][1]['deleted_at'], '2026-01-01')

    def test_unfinished_source_does_not_invent_completion(self):
        self.sources[50]['facts']['material:20'] = {**fact(20), 'completed': False, 'section_id': 5}
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(len(plan['definitions']), 1)
        self.assertEqual(plan['progress'], [])
        self.assertEqual(completed_refs(plan['after'][50]), {'material:10'})

    def test_unstarted_unsectioned_posts_do_not_inflate_the_catalogue(self):
        for ref, post_type in [('material:20', 'page'), ('material:30', 'stm-lessons')]:
            self.sources[50]['facts'][ref] = {**fact(int(ref.split(':')[1])),
                'completed': False, 'section_id': 0, 'post_type': post_type}
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(plan['definitions'], [])
        self.assertEqual(plan['progress'], [])
        self.assertEqual(len(plan['after'][50]['items']), 1)

    def test_quiz_does_not_reuse_a_material_journal_with_the_same_numeric_id(self):
        self.sources[50]['facts']['quiz:10'] = fact(10, 'quiz')
        plan = make_plan(self.state, self.sources, [50], [])
        self.assertEqual(len(plan['progress']), 1)
        self.assertEqual(plan['progress'][0]['row']['source_activity_id'], 'quiz:10')
        self.assertEqual(plan['after'][50]['accepted_hours'], 0.5)

    def test_verification_preserves_composite_key_history_without_json_serializing_keys(self):
        self.state['history'] = [{'progress_id': 100, 'source_row_id': 9, 'historical_component_ref': 'H'}]
        self.state['identities'] = [self.state['identity']]
        plan = make_plan(self.state, self.sources, [50], [])
        after = deepcopy(self.state)
        verify(self.state, after, plan)
        after['history'][0]['historical_component_ref'] = 'different'
        with self.assertRaisesRegex(ValueError, 'Historical history changed'):
            verify(self.state, after, plan)


if __name__ == '__main__':
    unittest.main()
