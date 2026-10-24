"""Raw SQL percent literals must reach PostgreSQL without parameter composition."""
import importlib
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from django.db.backends.postgresql.schema import DatabaseSchemaEditor

migration = importlib.import_module('engagement_api.migrations.0006_module_feedback')


class ModuleFeedbackMigrationTests(unittest.TestCase):
    def editor(self, vendor='postgresql', alias='default'):
        connection = SimpleNamespace(
            vendor=vendor, alias=alias,
            features=SimpleNamespace(can_rollback_ddl=True),
            ops=SimpleNamespace(compose_sql=Mock(side_effect=AssertionError(
                'Literal percent SQL must not enter placeholder composition'))),
        )
        return DatabaseSchemaEditor(connection, collect_sql=True, atomic=False)

    def test_real_postgres_schema_editor_preserves_all_raw_sql_bytes(self):
        with self.editor() as editor:
            migration.install(None, editor)
        self.assertEqual(editor.collected_sql, [migration.SQL])
        self.assertIn("LIKE '%form_type%'", editor.collected_sql[0])
        self.assertIn('DROP CONSTRAINT %I', editor.collected_sql[0])
        editor.connection.ops.compose_sql.assert_not_called()

    def test_sqlite_is_still_a_noop(self):
        with self.editor(vendor='sqlite') as editor:
            migration.install(None, editor)
        self.assertEqual(editor.collected_sql, [])

    def test_other_vendor_or_alias_is_rejected_before_sql(self):
        for vendor, alias in [('mysql', 'default'), ('postgresql', 'enrolment')]:
            with self.subTest(vendor=vendor, alias=alias), self.editor(vendor, alias) as editor:
                with self.assertRaisesRegex(RuntimeError, 'canonical PostgreSQL default'):
                    migration.install(None, editor)
                self.assertEqual(editor.collected_sql, [])


if __name__ == '__main__':
    unittest.main()
