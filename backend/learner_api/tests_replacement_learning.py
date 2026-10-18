"""Integration boundary checks with all database/source reads replaced."""
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase

from .replacement_learning import annotate_replacement_learning


class ReplacementLearningReadTests(SimpleTestCase):
    def test_unassigned_and_unowned_courses_do_not_load_source_records(self):
        component = {'componentId': 'C1', 'moduleId': 'M1'}
        with patch('learner_api.replacement_learning.read_replacement_courses', return_value={}) as links, \
             patch('django.db.connections') as connections, \
             patch('learner_api.canonical_learning.source_subjects') as history:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            self.assertEqual(annotate_replacement_learning([component], 12), [component])
            links.assert_called_once_with(cursor, [{'id': 'M1'}], 12)
            history.assert_not_called()
            cursor.execute.assert_not_called()

    def test_owned_source_uses_canonical_completion_and_only_effective_components(self):
        component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading'}
        other = {'componentId': 'OTHER', 'moduleId': 'M2', 'type': 'reading'}
        with patch('learner_api.replacement_learning.read_replacement_courses', return_value={'current:M1': 'legacy:50'}), \
             patch('django.db.connections') as connections, \
             patch('learner_api.canonical_learning.source_subjects') as history:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('C1', {'legacySettings': {'sourceLessonId': 7}})]
            history.return_value = {'activities': [{'group_id': 50, 'catalogue_kind': 'material', 'source_activity_id': 7,
                'activity_id': 'catalogue:50:material:7', 'completed': True}]}
            result = annotate_replacement_learning([component, other], 12)
            self.assertTrue(result[0]['previousLearning']['completed'])
            self.assertEqual(result[1], other)
            self.assertEqual(cursor.execute.call_args.args[1], [['C1'], ['M1']])
            self.assertEqual(history.call_args.args[0], 12)
            self.assertEqual(history.call_args.kwargs, {'include_totals': False, 'course_ids': ['50']})
            self.assertEqual(history.call_args.args[1]([1]), {'activities': [1]})

    def test_no_components_never_opens_a_database_cursor(self):
        with patch('django.db.connections') as connections:
            self.assertEqual(annotate_replacement_learning([], 12), [])
            connections.__getitem__.assert_not_called()
