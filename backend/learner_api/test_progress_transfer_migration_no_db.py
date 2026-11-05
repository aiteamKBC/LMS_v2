"""Exercise migration execution with the real database router, without a DB."""
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock

from django.db.migrations.state import ProjectState
from django.test import SimpleTestCase, override_settings


@override_settings(DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'])
class ProgressTransferMigrationTests(SimpleTestCase):
    def execute_migration(self, name, *, alias='default', vendor='postgresql'):
        module = import_module(f'learner_api.migrations.{name}')
        editor = MagicMock()
        editor.connection = SimpleNamespace(alias=alias, vendor=vendor)
        state = ProjectState()
        for operation in module.Migration.operations:
            operation.database_forwards('learner_api', editor, state, state)
        return editor

    def test_repair_installs_storage_when_original_migration_was_skipped(self):
        original = self.execute_migration('0021_progress_transfer')
        original.execute.assert_not_called()
        repaired = self.execute_migration('0022_install_progress_transfer_storage')
        original_sql = import_module('learner_api.migrations.0021_progress_transfer').SQL
        repaired.execute.assert_called_once_with(original_sql)

    def test_repair_does_not_migrate_external_database_aliases(self):
        for alias in ('enrolment', 'audit', 'audit_clone', 'kbc_attendance'):
            with self.subTest(alias=alias):
                editor = self.execute_migration('0022_install_progress_transfer_storage', alias=alias)
                editor.execute.assert_not_called()

    def test_sqlite_checks_never_execute_postgres_ddl(self):
        editor = self.execute_migration('0022_install_progress_transfer_storage', vendor='sqlite')
        editor.execute.assert_not_called()
