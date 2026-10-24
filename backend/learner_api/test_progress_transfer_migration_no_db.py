"""Exercise migration execution with the real database router, without a DB."""
from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

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
        original = self.execute_migration('0021_progress_transfer', alias='enrolment')
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


class ProgressTransferConstraintRepairTests(SimpleTestCase):
    module = import_module('learner_api.migrations.0025_progress_transfer_constraint_repair')

    def constraint(self, key):
        return self.module._base_expected()[key].copy()

    def contract(self, state):
        requests = {
            'progress_transfer_requests_pkey': self.constraint('request_pk'),
        }
        items = {
            'progress_transfer_items_pkey': self.constraint('item_pk'),
            'progress_transfer_items_enrolment_id_module_id_key': self.constraint('item_unique'),
        }
        if state in {'intermediate', 'repaired'}:
            requests[self.module.PARENT_UNIQUE] = self.constraint('parent_unique')
            items[self.module.COMPOSITE_FK] = self.constraint('composite_fk')
        if state in {'legacy', 'intermediate'}:
            items[self.module.WEAK_FK] = self.constraint('weak_fk')
        return {'requests': requests, 'items': items}

    def editor(self, *, alias='default', vendor='postgresql', counts=(0, 0, 0)):
        editor = MagicMock()
        cursor = MagicMock()
        cursor.fetchone.return_value = counts
        editor.connection = SimpleNamespace(alias=alias, vendor=vendor)
        editor.connection.cursor = MagicMock()
        editor.connection.cursor.return_value.__enter__.return_value = cursor
        return editor

    def test_legacy_contract_is_repaired_in_safe_order(self):
        editor = self.editor()
        with patch.object(
            self.module,
            '_read_contract',
            side_effect=[self.contract('legacy'), self.contract('intermediate'), self.contract('repaired')],
        ):
            self.module.install(None, editor)
        self.assertEqual(
            [call.args[0] for call in editor.execute.call_args_list],
            [
                self.module.ADD_PARENT_UNIQUE,
                self.module.ADD_COMPOSITE_FK,
                self.module.VALIDATE_COMPOSITE_FK,
                self.module.DROP_WEAK_FK,
            ],
        )

    def test_exact_repaired_contract_is_idempotent(self):
        editor = self.editor()
        with patch.object(self.module, '_read_contract', return_value=self.contract('repaired')):
            self.module.install(None, editor)
        editor.execute.assert_not_called()

    def test_integrity_violation_fails_before_ddl(self):
        editor = self.editor(counts=(0, 1, 0))
        with patch.object(self.module, '_read_contract', return_value=self.contract('legacy')):
            with self.assertRaisesRegex(RuntimeError, 'mismatch'):
                self.module.install(None, editor)
        editor.execute.assert_not_called()

    def test_same_named_divergent_constraint_is_rejected(self):
        contract = self.contract('legacy')
        contract['requests'][self.module.PARENT_UNIQUE] = self.constraint('request_pk')
        with self.assertRaisesRegex(RuntimeError, 'partial or divergent'):
            self.module._classify_contract(contract)

    def test_equivalent_constraint_under_different_name_is_rejected(self):
        contract = self.contract('legacy')
        contract['requests']['surprise_parent_unique'] = self.constraint('parent_unique')
        with self.assertRaisesRegex(RuntimeError, 'unexpected name'):
            self.module._classify_contract(contract)

    def test_unsupported_targets_never_execute_ddl(self):
        sqlite_editor = self.editor(vendor='sqlite')
        self.module.install(None, sqlite_editor)
        sqlite_editor.execute.assert_not_called()
        for alias in ('enrolment', 'audit', 'audit_clone'):
            with self.subTest(alias=alias):
                editor = self.editor(alias=alias)
                with self.assertRaisesRegex(RuntimeError, 'canonical'):
                    self.module.install(None, editor)
                editor.execute.assert_not_called()
