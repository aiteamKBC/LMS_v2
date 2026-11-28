"""One canonical saved-plan mapping query, no learner-by-learner reads."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import attendance_sessions as mapping


class AttendanceSessionMappingTests(SimpleTestCase):
    def test_assignment_union_is_bulk_scoped_and_uses_stable_ids(self):
        for count in (1, 20):
            with self.subTest(count=count), patch.object(mapping, 'connections') as connections:
                cursor = MagicMock()
                connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
                cursor.fetchall.return_value = [('module-a', 'Synthetic module')]
                profiles = [SimpleNamespace(_caseload_source=SimpleNamespace(id=900+i)) for i in range(count)]
                self.assertEqual(mapping.assigned_module_ids(profiles), ['module-a'])
                cursor.execute.assert_called_once()
                sql, params = cursor.execute.call_args.args
                self.assertIn('WHERE id=ANY(%s)', sql)
                self.assertIn('UNION', sql)
                self.assertIn('learner_training_plan_modules', sql)
                self.assertIn('cm.module_catalogue_id=assigned.module_id', sql)
                self.assertEqual(set(params[0]), set(range(900, 900+count)))
                self.assertNotIn('group_name', sql)

    def test_no_sources_does_not_query_or_fall_back_to_names(self):
        with patch.object(mapping, 'connections') as connections:
            self.assertEqual(mapping.assigned_module_ids([SimpleNamespace(_caseload_source=None)]), [])
            connections.__getitem__.assert_not_called()
