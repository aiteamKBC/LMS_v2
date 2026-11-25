from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .management.commands.sync_teams_attendance_reporting import Command
from . import teams_attendance


class SyncTeamsAttendanceCommandTests(SimpleTestCase):
    def test_legacy_commands_do_not_restore_removed_columns_or_write_join_view(self):
        from .management.commands.apply_learner_enrolment_id import TARGETS
        from .management.commands.unify_learner_ids import CHILD_COLUMNS
        self.assertNotIn('learner_attendance_details', {row[0] for row in TARGETS})
        self.assertNotIn('verified_teams_attendance', {row[0] for row in TARGETS})
        attendance = [row for row in CHILD_COLUMNS if row[1] in
                      ('learner_attendance_details', 'verified_teams_attendance')]
        self.assertEqual(attendance, [('Learner', 'learner_attendance_details', 'learner_id')])

    def test_schema_validation_reads_canonical_table_and_identity_view(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch.object(teams_attendance, 'connections', {'isolated': connection}), \
             patch.object(teams_attendance, '_ATTENDANCE_SCHEMA_READY_DATABASES', set()):
            teams_attendance.ensure_teams_attendance_reporting_columns('isolated')
            teams_attendance.ensure_teams_attendance_reporting_columns('isolated')
        queries = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(len(queries), 2)
        self.assertTrue(all(query.strip().startswith('SELECT') for query in queries))
        self.assertIn('learner_id', queries[0])
        for removed in ('learner_profile_id', 'enrolment_id', 'learner_name', 'learner_email'):
            self.assertNotIn(removed, queries[0])
        self.assertIn('verified_teams_attendance', queries[1])

    def test_incompatible_schema_is_not_cached_as_ready(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.execute.side_effect = RuntimeError('Missing canonical column')
        ready = set()
        with patch.object(teams_attendance, 'connections', {'isolated': connection}), \
             patch.object(teams_attendance, '_ATTENDANCE_SCHEMA_READY_DATABASES', ready):
            with self.assertRaisesRegex(RuntimeError, 'Missing canonical column'):
                teams_attendance.ensure_teams_attendance_reporting_columns('isolated')
        self.assertNotIn('isolated', ready)

    def test_ordinary_sync_validates_schema_before_publishing(self):
        connection = MagicMock()
        with patch('learner_api.management.commands.sync_teams_attendance_reporting.router.db_for_write',
                   return_value='enrolment'), \
             patch('learner_api.management.commands.sync_teams_attendance_reporting.connections',
                   {'enrolment': connection}), \
             patch('learner_api.management.commands.sync_teams_attendance_reporting.ensure_teams_attendance_reporting_columns') as ensure, \
             patch('learner_api.management.commands.sync_teams_attendance_reporting.sync_verified_teams_attendance_reporting',
                   return_value=7) as sync:
            Command().handle(replace_legacy=False)
        ensure.assert_called_once_with('enrolment')
        sync.assert_called_once_with(all_learners=True)
