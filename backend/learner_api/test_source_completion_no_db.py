"""Owned source completion never implies new accepted hours."""
import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api import journal_sources
from learner_api.test_canonical_learning_no_db import adapter


class SourceCompletionTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {'payload': {'id': 1, 'accepted': False, 'actual_seconds': 0},
             'sources': [{'source_system': 'old_lms', 'source_course_ref': '50',
                          'source_activity_id': 'material:10', 'completed': True}]},
            {'payload': {'id': 2, 'accepted': True, 'actual_seconds': 9000}, 'sources': []},
            {'payload': {'id': 3, 'accepted': False, 'actual_seconds': None},
             'sources': [{'source_system': 'old_lms', 'completed': False}]},
            {'payload': {'id': 4, 'accepted': False, 'actual_seconds': 9000},
             'sources': [{'source_system': 'aptem', 'completed': True}]},
        ]
        self.query = Mock(side_effect=lambda *args: copy.deepcopy(self.rows))
        self.scope = adapter(self.query)
        token = journal_sources._current.set(True)
        self.addCleanup(journal_sources._current.reset, token)

    def read(self):
        with patch.object(journal_sources, 'planned_by_progress', return_value={}):
            return self.scope['entries_for']({'id': 7})

    def test_completed_source_is_visible_without_accepting_or_duplicating_hours(self):
        records = self.read()
        self.assertEqual([r['completed'] for r in records], [True, True, False, False])
        self.assertFalse(records[0]['accepted'])
        self.assertEqual(records[0]['actual_seconds'], 0)
        result = self.scope['metrics_from_records'](records, {})
        self.assertEqual(result['programme']['completed'], 2)
        self.assertEqual(result['otjh']['actual'], 2.5)
        sql, args = self.query.call_args.args
        self.assertEqual(args, [7])
        self.assertIn('s.learner_id=p.learner_id', sql)
        self.assertIn('s.canonical_progress_id=p.id', sql)
        self.assertIn('s.deleted_at IS NULL', sql)

    def test_course_item_shows_completion_and_zero_hours(self):
        items, _, _ = self.scope['recorded_course_items'](
            [{'source_course_ref': '50', 'source_course_title': 'Course'}],
            [{'source_course_ref': '50', 'source_activity_id': 'material:10',
              'source_activity_title': 'Excluded reading', 'source_course_title': 'Course'}], self.read())
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]['completed'])
        self.assertEqual(items[0]['actual'], 0)
        self.assertFalse(items[0]['hours_mapped'])

    def test_coach_context_keeps_its_existing_completion_projection(self):
        journal_sources._current.set(False)
        records = self.read()
        self.assertNotIn('completed', records[0])
        self.assertEqual(self.scope['metrics_from_records'](records, {})['programme']['completed'], 1)


if __name__ == '__main__':
    unittest.main()
