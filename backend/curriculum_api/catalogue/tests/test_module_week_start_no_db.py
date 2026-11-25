"""Week-boundary contracts without application databases or external services."""
import importlib
import sqlite3
from contextlib import closing
from types import SimpleNamespace

from django.test import SimpleTestCase

from curriculum_api.weekly_schedule import WEEKDAYS, merged_week_starts_on, module_week_starts_on


class ModuleWeekStartContractTests(SimpleTestCase):
    def test_all_seven_days_are_supported_in_both_payload_vocabularies(self):
        for day in WEEKDAYS:
            with self.subTest(day=day):
                self.assertEqual(module_week_starts_on({'weekStartsOn': day}), day)
                self.assertEqual(module_week_starts_on({'week_starts_on': day.lower()}), day)

    def test_unrelated_partial_updates_preserve_the_chosen_day(self):
        self.assertEqual(merged_week_starts_on({'title': 'New title'}, {'week_starts_on': 'Sunday'}), 'Sunday')
        self.assertEqual(merged_week_starts_on({}, {'weekStartsOn': 'Saturday'}), 'Saturday')
        self.assertIsNone(merged_week_starts_on({}, {}))

    def test_an_explicit_clear_is_distinct_from_omission(self):
        for value in (None, ''):
            self.assertIsNone(merged_week_starts_on({'weekStartsOn': value}, {'week_starts_on': 'Sunday'}))

    def test_invalid_days_are_not_silently_replaced_with_monday(self):
        for value in ('Funday', 'Mon', 0, 7, [], {}):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'valid day'):
                module_week_starts_on({'weekStartsOn': value})

    def test_additive_migration_preserves_existing_rows_and_is_repeatable(self):
        migration = importlib.import_module('curriculum_api.migrations.0089_module_week_starts_on')
        with closing(sqlite3.connect(':memory:')) as connection:
            connection.execute('create table modules (module_catalogue_id text primary key, title text, schedule_mode text)')
            connection.execute("insert into modules values ('MOD-KEEP', 'Existing module', 'custom')")
            editor = SimpleNamespace(connection=SimpleNamespace(vendor='sqlite', cursor=lambda: closing(connection.cursor())))
            migration.add_week_starts_on(None, editor)
            migration.add_week_starts_on(None, editor)
            self.assertEqual(connection.execute('select * from modules').fetchall(), [('MOD-KEEP', 'Existing module', 'custom', None)])
