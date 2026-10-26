"""Database-free migration graph and router contracts for PMA-G1B-GATE."""

from importlib import import_module

from django.conf import settings
from django.db.migrations.loader import MigrationLoader
from django.test import SimpleTestCase, override_settings

from learner_api.routers import EnrolmentRouter
from migration_validation.safety import ALLOWED_TARGETS, ROLLBACK_TARGETS


class MigrationGraphGateTests(SimpleTestCase):
    databases = set()

    def test_target_families_have_exact_dependencies_and_no_conflicts(self):
        modules = dict(settings.MIGRATION_MODULES)
        # SQLite test settings disable Coach migrations because their physical
        # DDL is PostgreSQL-only.  Graph inspection imports them without running
        # them, so explicitly restore that migration module for this check.
        modules["coach_api"] = "coach_api.migrations"
        with override_settings(MIGRATION_MODULES=modules):
            loader = MigrationLoader(None, ignore_no_migrations=True)

        self.assertEqual(loader.detect_conflicts(), {})
        expected_parents = {
            ("learner_api", "0025_progress_transfer_constraint_repair"): {
                ("learner_api", "0024_activity_timing_drafts")
            },
            ("learner_api", "0026_file_scan_persistence"): {
                ("learner_api", "0025_progress_transfer_constraint_repair")
            },
            ("engagement_api", "0007_feedbackdeliveryquestion_feedbackreviewdelivery"): {
                ("engagement_api", "0006_module_feedback")
            },
            ("coach_api", "0028_legacy_template_hours_defaults"): {
                ("coach_api", "0027_personal_support_template")
            },
        }
        actual_parents = {
            node: set(loader.graph.node_map[node].parents) for node in expected_parents
        }
        self.assertEqual(actual_parents, expected_parents)
        expected_leaves = {
            ("learner_api", "0026_file_scan_persistence"),
            ("engagement_api", "0007_feedbackdeliveryquestion_feedbackreviewdelivery"),
            ("coach_api", "0028_legacy_template_hours_defaults"),
        }
        for app_label, migration_name in expected_leaves:
            self.assertIn(
                (app_label, migration_name),
                loader.graph.leaf_nodes(app_label),
            )

        # M2 recognizes the scanner target, while the executable manifest and
        # explicit write authorization remain separate mandatory gates.
        self.assertIn("learner_api.0026_file_scan_persistence", ALLOWED_TARGETS)

    def test_router_allows_learner_schema_ddl_only_on_default(self):
        router = EnrolmentRouter()
        self.assertTrue(
            router.allow_migrate(
                "default", "learner_api", learner_schema_migration=True
            )
        )
        for alias in ("enrolment", "audit", "audit_clone", "kbc_attendance"):
            with self.subTest(alias=alias):
                self.assertFalse(
                    router.allow_migrate(
                        alias, "learner_api", learner_schema_migration=True
                    )
                )

    def test_rollback_boundaries_match_operation_reversibility(self):
        self.assertEqual(ROLLBACK_TARGETS, {
            "learner_api.0025_progress_transfer_constraint_repair":
                "learner_api.0024_activity_timing_drafts",
            "learner_api.0026_file_scan_persistence":
                "learner_api.0025_progress_transfer_constraint_repair",
            "coach_api.0028_legacy_template_hours_defaults":
                "coach_api.0025_review_source_reconciliation",
            "engagement_api.0007_feedbackdeliveryquestion_feedbackreviewdelivery":
                "engagement_api.0005_merge_learning_policy_event_feedback",
        })
        learner = import_module(
            "learner_api.migrations.0025_progress_transfer_constraint_repair"
        )
        engagement = import_module("engagement_api.migrations.0006_module_feedback")
        self.assertFalse(learner.Migration.operations[0].reversible)
        self.assertFalse(engagement.Migration.operations[0].reversible)

        for name in (
            "coach_api.migrations.0026_migrated_review_revisions",
            "coach_api.migrations.0027_personal_support_template",
            "coach_api.migrations.0028_legacy_template_hours_defaults",
        ):
            with self.subTest(name=name):
                migration = import_module(name)
                self.assertTrue(all(operation.reversible for operation in migration.Migration.operations))

