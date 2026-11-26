"""Synthetic recovery checks: connections and HTTP are forbidden."""
import unittest
from unittest.mock import patch

from repair_live_legacy_progress import export_for, verify_identity
from repair_legacy_course_catalogue import catalogue_plan


class LiveRecoveryTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden in tests'))
            guard.start()
            self.addCleanup(guard.stop)

    def test_verified_types_remove_duplicates_but_preserve_pages_and_unmatched_content(self):
        course = {'course_id': 50, 'source_user_id': 10, 'facts': {
            'material:1': {'component_id': 1, 'component_kind': 'lesson', 'post_type': 'stm-lessons'},
            'quiz:2': {'component_id': 2, 'component_kind': 'quiz', 'post_type': 'stm-quizzes'},
            'material:3': {'component_id': 3, 'component_kind': 'lesson', 'post_type': 'page'}}}
        definitions = [dict(id=i, source_activity_id=ref, deleted_at=None, curriculum_component_ref=None)
                       for i, ref in enumerate(('material:1', 'quiz:1', 'quiz:2', 'material:2', 'material:3', 'material:9'))]
        expected, archived, replacements = catalogue_plan(definitions, export_for(course)['curriculum'], [], preserve_unmatched=True)
        self.assertEqual(archived, [1, 3])
        self.assertEqual(replacements, {'quiz:1': 'material:1', 'material:2': 'quiz:2'})
        self.assertEqual(set(expected), {'material:1', 'quiz:2', 'material:3', 'material:9'})

    def test_source_user_and_email_must_both_match(self):
        state = {'identity': {'source_learner_id': '10', 'source_payload': {'learner_email': 'learner@example.invalid'}}}
        source = {'source_user_id': 10, 'email': 'Learner@example.invalid'}
        verify_identity(state, source)
        for invalid in ({**source, 'source_user_id': 11}, {**source, 'email': 'other@example.invalid'}):
            with self.assertRaisesRegex(ValueError, 'identity'):
                verify_identity(state, invalid)


if __name__ == '__main__':
    unittest.main()
