"""Deployment error and startup tests: every database/transport is a test double."""
import json
import sys
from contextlib import ExitStack, nullcontext
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.apps import apps
from django.core.management import call_command, CommandError
from django.db import ProgrammingError, OperationalError
from django.db.models import QuerySet
from django.test import SimpleTestCase

from coach_api import reconciliation_links as links, reconciliation_schema as schema
from coach_api import review_reconciliation as service
from coach_api import test_native_review_boundary_no_db as boundary
from coach_api.test_review_source_separation import booking, profile, base_event, imported_row


def postgres_error(state="42P01", relation="Coach.review_source_reconciliation", error_type=ProgrammingError):
    message = f'relation "{relation}" does not exist'
    cause = Exception(message)
    cause.sqlstate = state
    cause.diag = SimpleNamespace(message_primary=message)
    error = error_type(message)
    error.__cause__ = cause
    return error


class ReconciliationSchemaTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.db = MagicMock(vendor="postgresql", in_atomic_block=False)
        self.stack.enter_context(patch.object(schema, "connections", {"default": self.db}))

    def test_exact_missing_relation_keeps_all_mapping_reads_empty(self):
        from .review_sources import linked_booking, load_imported_links, booking_for_overlay
        from .models import ImportedReviewInstance
        with patch.object(QuerySet, "_fetch_all", side_effect=postgres_error()), \
             patch.object(QuerySet, "exists", side_effect=postgres_error()):
            self.assertEqual(list(links.active_links()), [])
            self.assertFalse(links.active_links().exists())
            self.assertIsNone(links.for_native("SYNTHETIC-NATIVE"))
            self.assertIsNone(links.for_calendar(booking(review_instance_id="SYNTHETIC-NATIVE")))
            self.assertEqual(links.records_for_key("imported-review:A-401"), [])
            self.assertIsNone(linked_booking(base_event(), []))
            query = MagicMock()
            query.filter.return_value = query
            query.__iter__.return_value = iter(())
            with patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=query), \
                 patch("coach_api.models.ImportedReviewInstance.objects.filter", return_value=query), \
                 patch("learner_api.models.LearnerProfile.objects.filter") as profiles:
                profiles.return_value.first.return_value = None
                for kind in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
                    event = base_event(imported_row(review_type=kind))
                    calendars, overlays = load_imported_links([event])
                    self.assertFalse(any(calendars.values()))
                    self.assertFalse(any(overlays.values()))
                overlay = ImportedReviewInstance(pk=8, learner_id=21, source_review_id=401,
                    owner_email="coach@example.invalid", event_key="imported-review:A-401")
                self.assertIsNone(booking_for_overlay(overlay))

    def test_exact_error_is_not_confused_with_other_relation_or_sql_errors(self):
        for error in (postgres_error(relation="Coach.coach_imported_review_instance"),
                      postgres_error("42501"), postgres_error("42601"),
                      postgres_error("57014", error_type=OperationalError),
                      OperationalError("connection lost"), ProgrammingError("invalid SQL")):
            with self.subTest(error=str(error)), patch.object(QuerySet, "_fetch_all", side_effect=error):
                with self.assertRaises(type(error)):
                    list(links.active_links())
            self.db.cursor.return_value.__enter__.return_value.execute.side_effect = error
            with self.assertRaises(type(error)):
                schema.reconciliation_schema_available()

    def test_missing_probe_rolls_back_savepoint_before_returning_absence(self):
        events = []
        self.db.in_atomic_block = True
        self.db.cursor.return_value.__enter__.return_value.execute.side_effect = postgres_error()
        scope = MagicMock()
        scope.__exit__.side_effect = lambda *args: events.append(args[0]) or False
        with patch.object(schema.transaction, "atomic", return_value=scope):
            self.assertFalse(schema.reconciliation_schema_available())
        self.assertEqual(events, [ProgrammingError])

    def test_feature_operations_require_schema_before_any_mutation(self):
        self.db.cursor.return_value.__enter__.return_value.execute.side_effect = postgres_error()
        with patch.object(service, "require_operator", return_value=SimpleNamespace(pk=990)), \
             patch.object(service, "read_only_databases", return_value=nullcontext()), \
             patch.object(service.transaction, "atomic", return_value=nullcontext()), \
             patch("coach_api.views.lock_learner_calendar") as sequence, \
             patch("coach_api.migrated_initialization.initialize_imported_review") as initialize:
            for func, params in (
                (service.preview, dict(calendar_event_id=1, source_review_id=2)),
                (service.apply, dict(calendar_event_id=1, source_review_id=2, reason="Exact pair")),
                (service.reverse, dict(reconciliation_id=3, reason="Exact reversal")),
            ):
                with self.subTest(operation=func.__name__), self.assertRaises(schema.ReconciliationSchemaNotDeployed) as caught:
                    func(actor_id=990, **params)
                self.assertEqual(caught.exception.code, "RECONCILIATION_SCHEMA_NOT_DEPLOYED")
            sequence.assert_not_called()
            initialize.assert_not_called()

    def test_command_error_has_code_for_preview_apply_and_reverse(self):
        for operation, options in (("preview", {}), ("apply", {"apply": True}), ("reverse", {"reverse": 3})):
            params = {} if operation == "reverse" else dict(calendar_event_id=1, source_review_id=2)
            with patch.object(service, operation, side_effect=schema.ReconciliationSchemaNotDeployed()):
                with self.assertRaises(CommandError) as caught:
                    call_command("reconcile_review_booking", actor_id=990, reason="Synthetic decision",
                                 stdout=StringIO(), **params, **options)
                self.assertEqual(json.loads(str(caught.exception))["code"], schema.ReconciliationSchemaNotDeployed.code)

    def test_absence_does_not_authorize_unprivileged_operator(self):
        with patch("login.models.LoginAccount.objects.filter") as accounts, \
             patch.object(service, "read_only_databases", return_value=nullcontext()), \
             patch.object(service, "require_reconciliation_schema") as required:
            accounts.return_value.first.return_value = None
            for role in ("learner", "staff", "employer", "inactive-admin", "missing"):
                with self.subTest(role=role), self.assertRaises(PermissionError):
                    service.preview(calendar_event_id=1, source_review_id=2, actor_id=9)
                accounts.assert_called_with(pk=9, is_active=True, role="admin")
            required.assert_not_called()


class ReconciliationStartupTests(SimpleTestCase):
    def test_command_suppresses_ready_scheduler_loop_and_epoch_even_with_warm_enabled(self):
        from curriculum_api import views
        with patch.object(sys, "argv", ["manage.py", "reconcile_review_booking", "--dry-run"]), \
             patch.object(views, "CURRICULUM_WARM_ENABLED", True), \
             patch.object(views, "schedule_curriculum_warm") as schedule:
            apps.get_app_config("curriculum_api").ready()
            schedule.assert_not_called()
        with patch.object(sys, "argv", ["manage.py", "reconcile_review_booking", "--dry-run"]), \
             patch.object(views, "CURRICULUM_WARM_ENABLED", True), \
             patch.object(views.threading, "Thread") as thread, \
             patch.object(views, "cached_curriculum_value") as cache, \
             patch.object(views, "local_shared_curriculum_epoch") as fallback, \
             patch.object(views, "connection") as db, \
             patch.object(views.time, "sleep") as sleep:
            self.assertFalse(views.schedule_curriculum_warm())
            views._curriculum_warm_loop()
            views.warm_curriculum_caches()
            self.assertFalse(views.ensure_curriculum_epoch_table())
            self.assertEqual(views.shared_curriculum_epoch(), 0)
            for probe in (thread, cache, fallback, db.cursor, sleep):
                probe.assert_not_called()

    def test_inspection_protects_every_alias_before_identity_reads(self):
        from config.management_safety import read_only_databases
        databases = {name: MagicMock(vendor="postgresql", in_atomic_block=False) for name in ("default", "enrolment", "extra")}
        with patch("django.db.connections", databases), patch("django.db.transaction.atomic", side_effect=lambda **kw: nullcontext()):
            with read_only_databases():
                for db in databases.values():
                    db.cursor.return_value.__enter__.return_value.execute.assert_called_once_with("SET TRANSACTION READ ONLY")
            databases["enrolment"].in_atomic_block = True
            with self.assertRaisesRegex(ValueError, "own read-only"):
                with read_only_databases():
                    self.fail("An existing caller transaction must not be silently reused")


class OldSchemaSourceBoundaryTests(boundary.NativeReviewBoundaryTests):
    """Run the actual Coach/Learner Phase 1 paths through the missing-table guard."""

    def setUp(self):
        super().setUp()
        # Replace the parent fixture's empty-query mock with the real compatible
        # queryset and an exact driver failure only for its optional ledger.
        self.stack.enter_context(patch.object(schema.CompatibleReconciliationQuerySet, "filter", QuerySet.filter))
        self.stack.enter_context(patch.object(schema, "connections", {
            "default": SimpleNamespace(vendor="postgresql", in_atomic_block=False),
        }))
        original_fetch = QuerySet._fetch_all
        def fetch(query):
            from .models import ReviewSourceReconciliation
            if query.model is ReviewSourceReconciliation:
                raise postgres_error()
            return original_fetch(query)
        self.stack.enter_context(patch.object(QuerySet, "_fetch_all", fetch))
