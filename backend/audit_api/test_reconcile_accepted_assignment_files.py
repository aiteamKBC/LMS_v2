"""Safety checks for the Last_audit assignment reconciliation command."""

from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase

from audit_api.management.commands.reconcile_accepted_assignment_files import Command


class ReconcileAcceptedAssignmentFilesTests(SimpleTestCase):
    def setUp(self):
        self.database = MagicMock()
        self.database.vendor = 'postgresql'
        self.database.settings_dict = {'NAME': 'isolated_test_db'}
        self.cursor = self.database.cursor.return_value.__enter__.return_value
        self.command = Command(stdout=StringIO())

    @patch('audit_api.management.commands.reconcile_accepted_assignment_files.connections')
    def test_preview_reads_only_accepted_files(self, connections):
        connections.__getitem__.return_value = self.database
        self.cursor.fetchone.return_value = (3, 2, 1, 1, 1)

        self.command.handle(apply=False, expect_matching=None, expect_updates=None)

        self.assertEqual(self.cursor.execute.call_count, 1)
        sql = self.cursor.execute.call_args.args[0]
        self.assertIn("lower(btrim(e.evidence_kind)) = 'file'", sql)
        self.assertIn("lower(btrim(e.evidence_status)) = 'accepted'", sql)
        self.assertIn("nullif(btrim(e.file_blob), '') is not null", sql)
        self.assertIn('sum(e.spent_time) / 60', sql)

    @patch('audit_api.management.commands.reconcile_accepted_assignment_files.transaction.atomic')
    @patch('audit_api.management.commands.reconcile_accepted_assignment_files.connections')
    def test_apply_refuses_changed_preview(self, connections, atomic):
        connections.__getitem__.return_value = self.database
        self.cursor.fetchone.return_value = (3, 2, 1, 1, 1)

        with self.assertRaisesMessage(CommandError, 'source changed'):
            self.command.handle(apply=True, expect_matching=4, expect_updates=1)

        atomic.assert_called_once_with(using='enrolment')
        self.assertEqual(self.cursor.execute.call_count, 1)
