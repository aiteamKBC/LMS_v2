from unittest.mock import MagicMock

from django.test import SimpleTestCase

from .student_activity_data import read_activity_sources


class ActivityLineageTests(SimpleTestCase):
    def test_maps_only_unambiguous_exported_ids_and_passes_learner_scope(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('one', 'MOD-1', 500, '10'), ('one', 'MOD-1', 500, '10'),
            ('ambiguous', 'MOD-1', 500, '20'), ('ambiguous', 'MOD-1', 600, '20'),
            ('invalid', 'MOD-1', 500, None)]
        self.assertEqual(read_activity_sources(cursor, [600, 500], ['MOD-1']), {
            'one': {'module_id': 'MOD-1', 'group_id': 500, 'activity_id': 10}})
        self.assertEqual(cursor.execute.call_args.args[1], [[500, 600], ['MOD-1']])

    def test_no_assigned_modules_cannot_create_links(self):
        cursor = MagicMock()
        self.assertEqual(read_activity_sources(cursor, [500], []), {})
        cursor.execute.assert_not_called()
