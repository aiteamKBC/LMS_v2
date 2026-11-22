from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .management.commands.sync_teams_attendance_reporting import Command
from . import teams_attendance


class SyncTeamsAttendanceCommandTests(SimpleTestCase):
    def test_schema_backfill_resolves_group_name_from_the_group_table(self):
        source = open(teams_attendance.__file__, encoding='utf-8').read()
        self.assertIn('group_name = delivery_group.group_name', source)
        self.assertIn('LEFT JOIN curriculum.groups delivery_group', source)
        self.assertNotIn('group_name = module.group_name', source)

    def test_ordinary_sync_repairs_additive_schema_before_publishing(self):
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
