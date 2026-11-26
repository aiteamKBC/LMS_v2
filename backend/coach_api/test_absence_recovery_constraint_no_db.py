"""Execute the deployment recovery CHECK on private, synthetic SQLite rows."""
import importlib
from pathlib import Path
import re
import sqlite3

from django.conf import settings
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, override_settings


MIGRATION_NAME = "0037_allow_pending_absence_catchup"
migration = importlib.import_module(f"coach_api.migrations.{MIGRATION_NAME}")
MANUAL_SQL = (Path(__file__).resolve().parents[1] / "sql" / "attendance_absence_recovery.sql").read_text()


def constraint(sql):
    return re.search(
        r"ADD CONSTRAINT coach_absence_recovery_valid CHECK (\([\s\S]+\))\s*(?:NOT VALID)?;", sql,
    ).group(1)


class AbsenceRecoveryConstraintTests(SimpleTestCase):
    def accepts(self, sql, method, key):
        with sqlite3.connect(":memory:") as database:
            database.execute("CREATE TABLE synthetic_report (recovery_method TEXT NOT NULL, "
                             "catchup_event_key TEXT, CHECK " + constraint(sql) + ")")
            try:
                database.execute("INSERT INTO synthetic_report VALUES (?, ?)", (method, key))
            except sqlite3.IntegrityError:
                return False
            return True

    def test_pending_report_can_be_saved_and_then_linked_to_its_booking(self):
        for source, sql in (("migration", migration.FORWARD_SQL), ("manual setup", MANUAL_SQL)):
            with self.subTest(source=source), sqlite3.connect(":memory:") as database:
                database.execute("CREATE TABLE synthetic_report (recovery_method TEXT NOT NULL, "
                                 "catchup_event_key TEXT, CHECK " + constraint(sql) + ")")
                database.execute("INSERT INTO synthetic_report VALUES ('catch-up', NULL)")
                database.execute("UPDATE synthetic_report SET catchup_event_key='catch-up:synthetic:1'")
                self.assertEqual(database.execute("SELECT * FROM synthetic_report").fetchall(),
                                 [("catch-up", "catch-up:synthetic:1")])

    def test_existing_recovery_plans_remain_valid(self):
        for sql in (migration.FORWARD_SQL, MANUAL_SQL):
            for method, key in (("", None), ("recorded", None), ("catch-up", "catch-up:synthetic:1"),
                                ("alternative", "alternative:synthetic-occurrence")):
                with self.subTest(method=method, key=key):
                    self.assertTrue(self.accepts(sql, method, key))

    def test_empty_or_mismatched_booking_references_are_still_rejected(self):
        for sql in (migration.FORWARD_SQL, MANUAL_SQL):
            for method, key in (("catch-up", ""), ("catch-up", "alternative:synthetic-occurrence"),
                                ("recorded", "catch-up:synthetic:1"), ("", "catch-up:synthetic:1"),
                                ("alternative", "catch-up:synthetic:1"), ("alternative", "alternative:"),
                                ("unknown", None)):
                with self.subTest(method=method, key=key):
                    self.assertFalse(self.accepts(sql, method, key))

    def test_only_newly_permitted_combination_is_a_pending_catchup(self):
        for method in ("", "recorded", "catch-up", "alternative", "unknown"):
            for key in (None, "", "catch-up:synthetic:1", "alternative:", "alternative:synthetic-occurrence"):
                old = self.accepts(migration.REVERSE_SQL, method, key)
                with self.subTest(method=method, key=key):
                    expected = True if (method, key) == ("catch-up", None) else old
                    self.assertEqual(self.accepts(migration.FORWARD_SQL, method, key), expected)
                    self.assertEqual(self.accepts(MANUAL_SQL, method, key), expected)

    def test_migration_follows_the_current_coach_history_without_a_new_leaf_conflict(self):
        modules = {key: value for key, value in settings.MIGRATION_MODULES.items() if key != "coach_api"}
        with override_settings(MIGRATION_MODULES=modules):
            loader = MigrationLoader(None)
        self.assertEqual(loader.graph.leaf_nodes("coach_api"), [("coach_api", MIGRATION_NAME)])
        self.assertNotIn("coach_api", loader.detect_conflicts())
