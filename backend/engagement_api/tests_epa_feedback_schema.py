"""EPA migration/state checks without connecting to application databases."""
import importlib
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase

from .feedback import FORM_TYPES


class EpaSchemaTests(SimpleTestCase):
    def setUp(self):
        self.migration = importlib.import_module('engagement_api.migrations.0012_epa_review_feedback')

    def test_manual_sql_matches_migration_and_preserves_all_form_types(self):
        script = (Path(__file__).resolve().parents[1] / 'sql/2026-11-07_epa_review_feedback.sql').read_text(encoding='utf-8')
        start = script.index("SET LOCAL lock_timeout = '5s';")
        end = script.index('\n\nCOMMIT;', start)
        self.assertEqual(script[start:end].strip(), self.migration.SQL.strip())
        self.assertIn('BEGIN;', script[:start])
        self.assertNotIn('INSERT INTO', self.migration.SQL)
        for form_type in FORM_TYPES:
            self.assertIn(f"'{form_type}'", self.migration.SQL)

    def test_migration_state_keeps_existing_types_and_adds_epa(self):
        state = MigrationLoader(None).project_state([('engagement_api', '0012_epa_review_feedback')])
        form = state.apps.get_model('engagement_api', 'FeedbackForm')
        self.assertEqual(set(dict(form._meta.get_field('form_type').choices)), FORM_TYPES)

    def test_sql_execution_requires_canonical_postgres_and_skips_sqlite(self):
        for vendor, alias, execute in (('sqlite', 'default', False), ('postgresql', 'default', True)):
            with self.subTest(vendor=vendor):
                schema = SimpleNamespace(connection=SimpleNamespace(vendor=vendor, alias=alias), execute=mock.Mock())
                self.migration.install(None, schema)
                self.assertEqual(schema.execute.called, execute)
        for vendor, alias in (('postgresql', 'enrolment'), ('mysql', 'default')):
            with self.subTest(vendor=vendor, alias=alias):
                schema = SimpleNamespace(connection=SimpleNamespace(vendor=vendor, alias=alias), execute=mock.Mock())
                with self.assertRaises(RuntimeError):
                    self.migration.install(None, schema)
                schema.execute.assert_not_called()
