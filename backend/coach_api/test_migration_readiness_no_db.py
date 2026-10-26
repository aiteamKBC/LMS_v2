"""Database-free source-contract checks for Coach migrations 0026-0028."""

from importlib import import_module
from types import SimpleNamespace
from unittest.mock import MagicMock

from django.db import models
from django.test import SimpleTestCase


class CoachMigrationReadinessTests(SimpleTestCase):
    def test_revision_table_contract_is_explicit(self):
        migration = import_module("coach_api.migrations.0026_migrated_review_revisions")
        operation = migration.Migration.operations[0]
        fields = dict(operation.fields)
        constraints = {constraint.name: constraint for constraint in operation.options["constraints"]}

        self.assertEqual(operation.options["db_table"], 'Coach"."coach_migrated_review_revision')
        self.assertIsInstance(fields["snapshot"], models.JSONField)
        self.assertIsInstance(fields["pdf_bytes"], models.BinaryField)
        self.assertTrue(fields["pdf_bytes"].null)
        self.assertEqual(fields["pdf_sha256"].max_length, 64)
        self.assertIs(fields["overlay"].remote_field.on_delete, models.PROTECT)
        self.assertEqual(
            set(constraints),
            {"coach_migrated_revision_unique", "coach_migrated_revision_positive"},
        )
        unique = constraints["coach_migrated_revision_unique"]
        self.assertEqual(tuple(unique.fields), ("overlay", "number"))
        positive = constraints["coach_migrated_revision_positive"]
        self.assertEqual(positive.condition.children, [("number__gte", 1)])

    def test_psp_constraint_replacement_is_exact_and_reversible(self):
        migration = import_module("coach_api.migrations.0027_personal_support_template")
        remove, alter, add = migration.Migration.operations
        self.assertEqual(remove.name, "coach_migrated_template_family_valid")
        self.assertEqual(add.constraint.name, "coach_migrated_template_family_valid")
        expected = ["MCM", "PR", "PR_SKILLS_RADAR", "PSP"]
        self.assertEqual(add.constraint.condition.children, [("review_family__in", expected)])
        self.assertEqual([value for value, _label in alter.field.choices], expected)

    def test_legacy_defaults_change_only_missing_defaults(self):
        migration = import_module("coach_api.migrations.0028_legacy_template_hours_defaults")
        cursor = MagicMock()
        cursor.fetchall.return_value = [("expected_otjh",), ("counts_towards_otjh",)]
        connection = SimpleNamespace(vendor="postgresql")
        connection.cursor = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        editor = SimpleNamespace(connection=connection)

        migration.supply_legacy_defaults(None, editor)

        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn("column_default IS NULL", statements[0])
        self.assertEqual(
            statements[1:],
            [
                'ALTER TABLE "Coach".coach_migrated_review_template '
                'ALTER COLUMN "expected_otjh" SET DEFAULT 0',
                'ALTER TABLE "Coach".coach_migrated_review_template '
                'ALTER COLUMN "counts_towards_otjh" SET DEFAULT false',
            ],
        )
        self.assertFalse(any("UPDATE" in statement.upper() for statement in statements))

    def test_legacy_defaults_noop_when_columns_are_absent_or_already_defaulted(self):
        migration = import_module("coach_api.migrations.0028_legacy_template_hours_defaults")
        cursor = MagicMock()
        cursor.fetchall.return_value = []
        connection = SimpleNamespace(vendor="postgresql")
        connection.cursor = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        migration.supply_legacy_defaults(None, SimpleNamespace(connection=connection))
        self.assertEqual(cursor.execute.call_count, 1)

    def test_0028_reverse_preserves_compatibility_defaults(self):
        migration = import_module("coach_api.migrations.0028_legacy_template_hours_defaults")
        operation = migration.Migration.operations[0]
        self.assertIs(operation.reverse_code, operation.noop)
