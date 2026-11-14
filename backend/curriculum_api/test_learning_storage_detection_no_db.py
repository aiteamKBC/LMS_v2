"""DB-free tests for historical native-authoring capability detection."""
from unittest.mock import MagicMock

from django.test import SimpleTestCase

from . import learning_storage


class NativeStorageCapabilityTests(SimpleTestCase):
    def setUp(self):
        learning_storage.reset()
        self.addCleanup(learning_storage.reset)

    def database(self, ready):
        database = MagicMock()
        database.vendor = "postgresql"
        database.alias = "default"
        database.settings_dict = {
            "HOST": "synthetic", "PORT": "5432", "NAME": "isolated",
        }
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (ready,)
        return database, cursor

    def test_detection_checks_columns_and_views_not_a_constraint_name(self):
        database, cursor = self.database(True)
        self.assertTrue(learning_storage.enabled(database))
        sql, params = cursor.execute.call_args.args
        self.assertIn("information_schema.columns", sql)
        self.assertIn("required_views", sql)
        self.assertNotIn("pg_constraint", sql)
        self.assertNotIn("free_courses_native_storage", sql)
        flat = [str(value) for value in params[:-1]]
        self.assertIn("content_ref", flat)
        self.assertIn("storage_version", flat)
        self.assertEqual(set(params[-1]), set(learning_storage.NATIVE_VIEWS.values()))

    def test_positive_result_is_cached_per_database(self):
        database, _cursor = self.database(True)
        self.assertTrue(learning_storage.enabled(database))
        self.assertTrue(learning_storage.enabled(database))
        self.assertEqual(database.cursor.call_count, 1)

    def test_missing_capability_stays_disabled_without_requerying_immediately(self):
        database, _cursor = self.database(False)
        self.assertFalse(learning_storage.enabled(database))
        self.assertFalse(learning_storage.enabled(database))
        self.assertEqual(database.cursor.call_count, 1)

    def test_non_postgresql_database_is_never_native(self):
        database = MagicMock(vendor="sqlite")
        self.assertFalse(learning_storage.enabled(database))
        database.cursor.assert_not_called()
