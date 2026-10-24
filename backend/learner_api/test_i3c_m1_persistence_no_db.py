"""Database-free contracts for the F06-I3C-M1 scanner persistence foundation."""

from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from importlib import import_module
import inspect
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import uuid

from django.db import models
from django.test import SimpleTestCase

from learner_api import malware_persistence as persistence
from learner_api.malware_lifecycle import ConcurrencyConflict, InvalidTransition, ScanLifecycleState


NOW = datetime(2026, 10, 24, 10, tzinfo=timezone.utc)


class ScannerPersistenceModelAndMigrationTests(SimpleTestCase):
    databases = []

    def setUp(self):
        self.migration = import_module("learner_api.migrations.0026_file_scan_persistence")

    def test_three_schema_qualified_models_and_internal_restrict_foreign_keys(self):
        self.assertEqual(
            {
                persistence.FileScanJob._meta.db_table,
                persistence.FileScanEvent._meta.db_table,
                persistence.FileScanOutbox._meta.db_table,
            },
            {
                'Learner"."file_scan_jobs',
                'Learner"."file_scan_events',
                'Learner"."file_scan_outbox',
            },
        )
        for model in (persistence.FileScanEvent, persistence.FileScanOutbox):
            field = model._meta.get_field("job")
            self.assertIs(field.remote_field.on_delete, models.RESTRICT)
            self.assertEqual(field.db_column, "job_id")

    def test_constraint_and_index_contract_is_named_and_complete(self):
        names = {
            item.name
            for model in (
                persistence.FileScanJob,
                persistence.FileScanEvent,
                persistence.FileScanOutbox,
            )
            for item in (*model._meta.constraints, *model._meta.indexes)
        }
        expected = {
            "file_scan_jobs_state_ck",
            "file_scan_jobs_attempt_ck",
            "file_scan_jobs_actor_idem_uniq",
            "file_scan_jobs_blob_version_uniq",
            "file_scan_jobs_due_idx",
            "file_scan_jobs_lease_idx",
            "file_scan_events_state_uniq",
            "file_scan_events_provider_uniq",
            "file_scan_events_deferred_idx",
            "file_scan_outbox_due_idx",
            "file_scan_outbox_lease_idx",
            "file_scan_outbox_completed_ck",
        }
        self.assertTrue(expected.issubset(names))

    def test_exact_blob_version_and_owner_scoped_idempotency_are_unique(self):
        constraints = {item.name: item for item in persistence.FileScanJob._meta.constraints}
        blob = constraints["file_scan_jobs_blob_version_uniq"]
        self.assertEqual(
            blob.fields,
            (
                "quarantine_account",
                "quarantine_container",
                "quarantine_blob_name",
                "quarantine_version_id",
                "quarantine_etag",
            ),
        )
        self.assertFalse(blob.nulls_distinct)
        owner = constraints["file_scan_jobs_actor_idem_uniq"]
        self.assertEqual(
            owner.fields,
            (
                "requested_by_account_key",
                "canonical_enrolment_id",
                "domain_type",
                "idempotency_key_hash",
            ),
        )

    def test_migration_follows_0025_and_uses_router_hint(self):
        self.assertEqual(
            self.migration.Migration.dependencies,
            [("learner_api", "0025_progress_transfer_constraint_repair")],
        )
        operation = self.migration.Migration.operations[0]
        run_python = operation.database_operations[0]
        self.assertEqual(run_python.hints, {"learner_schema_migration": True})
        self.assertIs(run_python.code, self.migration.install)
        self.assertIs(run_python.reverse_code, self.migration.uninstall)

    def test_postgres_ddl_has_deterministic_fks_checks_and_due_indexes(self):
        sql = "\n".join(self.migration.CREATE_STATEMENTS)
        for fragment in (
            'CREATE TABLE "Learner".file_scan_jobs',
            'CREATE TABLE "Learner".file_scan_events',
            'CREATE TABLE "Learner".file_scan_outbox',
            "file_scan_events_job_fk",
            "file_scan_outbox_job_fk",
            "ON DELETE RESTRICT",
            "file_scan_jobs_blob_version_uniq",
            "NULLS NOT DISTINCT",
            "file_scan_events_provider_uniq",
            "file_scan_outbox_idem_uniq",
            "file_scan_jobs_due_idx",
            "file_scan_outbox_due_idx",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, sql)

    def test_sqlite_gate_executes_no_ddl(self):
        editor = MagicMock()
        editor.connection = SimpleNamespace(vendor="sqlite", alias="default")
        self.migration.install(None, editor)
        self.migration.uninstall(None, editor)
        editor.execute.assert_not_called()

    def test_empty_postgres_install_executes_only_pinned_statements(self):
        editor = MagicMock()
        editor.connection = MagicMock(vendor="postgresql", alias="default")
        cursor = editor.connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (None, None, None)
        with patch.object(self.migration, "_require_target", return_value=True):
            self.migration.install(None, editor)
        self.assertEqual(
            [call.args[0] for call in editor.execute.call_args_list],
            list(self.migration.CREATE_STATEMENTS),
        )

    def test_reverse_refuses_to_destroy_history(self):
        editor = MagicMock()
        editor.connection = MagicMock(vendor="postgresql", alias="default")
        cursor = editor.connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect = [(object(), object(), object()), (1,)]
        with patch.object(self.migration, "_require_target", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "history"):
                self.migration.uninstall(None, editor)
        editor.execute.assert_not_called()


class ScannerPersistenceServiceTests(SimpleTestCase):
    databases = []

    def job(self, **overrides):
        values = {
            "pk": uuid.UUID("11111111-1111-1111-1111-111111111111"),
            "id": uuid.UUID("11111111-1111-1111-1111-111111111111"),
            "lifecycle_state": "scan_pending",
            "state_version": 2,
            "attempt_count": 0,
            "retry_limit": 2,
            "lease_owner": None,
            "lease_expires_at": None,
        }
        values.update(overrides)
        return SimpleNamespace(**values)

    def test_pending_job_key_is_hashed_and_scoped_by_owner(self):
        existing = self.job(
            canonical_learner_kind="apprenticeship",
            requested_by_role="learner",
            original_filename="synthetic.pdf",
            content_type="application/pdf",
            size_bytes=40,
        )
        repository = MagicMock()
        repository.get_or_create.return_value = (existing, False)
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
        ):
            job, created = persistence.create_pending_scan_job(
                domain_type="evidence",
                canonical_learner_kind="apprenticeship",
                canonical_enrolment_id=41,
                requested_by_account_key="account-a",
                requested_by_role="learner",
                client_idempotency_key="never-store-this-key",
                original_filename="synthetic.pdf",
                content_type="application/pdf",
                size_bytes=40,
                expires_at=NOW + timedelta(hours=2),
                now=NOW,
            )
        self.assertIs(job, existing)
        self.assertFalse(created)
        kwargs = repository.get_or_create.call_args.kwargs
        self.assertEqual(kwargs["requested_by_account_key"], "account-a")
        self.assertEqual(kwargs["canonical_enrolment_id"], 41)
        self.assertNotEqual(kwargs["idempotency_key_hash"], "never-store-this-key")
        self.assertNotIn("never-store-this-key", repr(kwargs))

    def test_exact_provider_redelivery_is_noop_and_conflict_is_rejected(self):
        durable = SimpleNamespace(
            job_id=self.job().pk,
            provider_event_fingerprint="a" * 64,
        )
        repository = MagicMock()
        repository.filter.return_value.first.return_value = durable
        manager = MagicMock()
        manager.using.return_value = repository
        common = dict(
            job=self.job(),
            event_kind="provider_delivery",
            disposition="applied",
            occurred_at=NOW,
            provider="defender",
            provider_event_id="event-1",
            provider_event_fingerprint="a" * 64,
            payload_sha256="b" * 64,
        )
        with patch.object(persistence.FileScanEvent, "objects", manager):
            event, created = persistence.append_scan_event(**common)
            self.assertIs(event, durable)
            self.assertFalse(created)
            with self.assertRaises(persistence.ProviderReplayConflict):
                persistence.append_scan_event(
                    **{**common, "provider_event_fingerprint": "c" * 64}
                )
        repository.create.assert_not_called()

    def test_provider_event_identity_cannot_cross_job_ownership(self):
        durable = SimpleNamespace(
            job_id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            provider_event_fingerprint="a" * 64,
        )
        repository = MagicMock()
        repository.filter.return_value.first.return_value = durable
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanEvent, "objects", manager),
            self.assertRaises(persistence.ProviderReplayConflict),
        ):
            persistence.append_scan_event(
                job=self.job(),
                event_kind="provider_delivery",
                disposition="applied",
                occurred_at=NOW,
                provider="defender",
                provider_event_id="event-1",
                provider_event_fingerprint="a" * 64,
                payload_sha256="b" * 64,
            )

    def test_stale_state_version_fails_compare_and_set(self):
        repository = MagicMock()
        repository.select_for_update.return_value.get.return_value = self.job()
        repository.filter.return_value.update.return_value = 0
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            self.assertRaises(ConcurrencyConflict),
        ):
            persistence.apply_validated_lifecycle_transition(
                job_id=self.job().pk,
                target_state=ScanLifecycleState.SCANNING,
                expected_version=2,
                occurred_at=NOW,
            )

    def test_clean_transition_requires_durable_authoritative_event(self):
        repository = MagicMock()
        repository.select_for_update.return_value.get.return_value = self.job()
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            self.assertRaisesRegex(persistence.PersistencePolicyError, "authoritative"),
        ):
            persistence.apply_validated_lifecycle_transition(
                job_id=self.job().pk,
                target_state=ScanLifecycleState.CLEAN_VERIFIED,
                expected_version=2,
                occurred_at=NOW,
            )

    def test_successful_transition_appends_event_and_outbox_in_one_atomic_scope(self):
        job = self.job()
        repository = MagicMock()
        repository.select_for_update.return_value.get.return_value = job
        repository.filter.return_value.update.return_value = 1
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()) as atomic,
            patch.object(persistence, "append_scan_event") as append_event,
            patch.object(persistence, "enqueue_outbox_operation") as enqueue,
        ):
            updated = persistence.apply_validated_lifecycle_transition(
                job_id=job.pk,
                target_state=ScanLifecycleState.SCANNING,
                expected_version=2,
                occurred_at=NOW,
                outbox_operations=("submit_scan",),
            )
        atomic.assert_called_once_with(using="enrolment")
        self.assertEqual(updated.lifecycle_state, "scanning")
        self.assertEqual(updated.state_version, 3)
        append_event.assert_called_once()
        enqueue.assert_called_once()

    def test_invalid_and_terminal_transitions_remain_immutable(self):
        for current, target in (
            ("pending_upload", ScanLifecycleState.CLEAN_VERIFIED),
            ("infected", ScanLifecycleState.SCAN_PENDING),
            ("expired", ScanLifecycleState.SCAN_PENDING),
        ):
            repository = MagicMock()
            repository.select_for_update.return_value.get.return_value = self.job(
                lifecycle_state=current,
                state_version=4,
            )
            manager = MagicMock()
            manager.using.return_value = repository
            event_manager = MagicMock()
            event_manager.using.return_value.filter.return_value.first.return_value = object()
            with (
                self.subTest(current=current, target=target),
                patch.object(persistence.FileScanJob, "objects", manager),
                patch.object(persistence.FileScanEvent, "objects", event_manager),
                patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
                self.assertRaises(InvalidTransition),
            ):
                persistence.apply_validated_lifecycle_transition(
                    job_id=self.job().pk,
                    target_state=target,
                    expected_version=4,
                    occurred_at=NOW,
                    authoritative_event_id=8,
                )

    def test_concurrent_lease_and_retry_exhaustion_fail_closed(self):
        repository = MagicMock()
        repository.select_for_update.return_value.filter.return_value.filter.return_value.filter.return_value.first.return_value = None
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            self.assertRaises(persistence.LeaseConflict),
        ):
            persistence.acquire_scan_job_lease(
                job_id=self.job().pk,
                worker_id="worker-a",
                now=NOW,
                duration=timedelta(minutes=1),
            )

        exhausted = self.job(attempt_count=3, retry_limit=2)
        repository = MagicMock()
        repository.select_for_update.return_value.filter.return_value.filter.return_value.filter.return_value.first.return_value = exhausted
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanJob, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            self.assertRaises(persistence.RetryExhausted),
        ):
            persistence.acquire_scan_job_lease(
                job_id=exhausted.pk,
                worker_id="worker-a",
                now=NOW,
                duration=timedelta(minutes=1),
            )

    def test_lease_duration_is_bounded(self):
        for duration in (timedelta(seconds=4), timedelta(minutes=16)):
            with self.subTest(duration=duration), self.assertRaises(persistence.PersistencePolicyError):
                persistence.acquire_scan_job_lease(
                    job_id=self.job().pk,
                    worker_id="worker-a",
                    now=NOW,
                    duration=duration,
                )

    def test_due_work_query_is_bounded_and_filters_retry_budget(self):
        repository = MagicMock()
        repository.filter.return_value = repository
        repository.order_by.return_value = repository
        sentinel = object()
        repository.__getitem__.return_value = sentinel
        manager = MagicMock()
        manager.using.return_value = repository
        with patch.object(persistence.FileScanJob, "objects", manager):
            result = persistence.due_scan_jobs(now=NOW, limit=25)
        self.assertIs(result, sentinel)
        self.assertEqual(repository.__getitem__.call_args.args[0], slice(None, 25, None))
        filter_text = " ".join(repr(call) for call in repository.filter.call_args_list)
        self.assertIn("attempt_count__lte", filter_text)
        self.assertIn("expires_at__gt", filter_text)
        self.assertIn("lease_expires_at__lte", filter_text)

    def test_outbox_operation_is_version_idempotent(self):
        job = self.job()
        durable = SimpleNamespace(
            job_id=job.pk,
            job_state_version=2,
            operation="submit_scan",
        )
        repository = MagicMock()
        repository.get_or_create.return_value = (durable, False)
        manager = MagicMock()
        manager.using.return_value = repository
        with patch.object(persistence.FileScanOutbox, "objects", manager):
            row, created = persistence.enqueue_outbox_operation(
                job=job,
                job_state_version=2,
                operation="submit_scan",
                available_at=NOW,
            )
        self.assertIs(row, durable)
        self.assertFalse(created)
        key = repository.get_or_create.call_args.kwargs["idempotency_key"]
        self.assertRegex(key, r"^[0-9a-f]{64}$")

    def test_outbox_completion_and_dead_letter_require_the_active_lease(self):
        for operation, expected_status in (
            (persistence.complete_outbox_operation, "completed"),
            (persistence.dead_letter_outbox_operation, "dead"),
        ):
            row = SimpleNamespace(
                pk=7,
                status="processing",
                lease_owner="worker-a",
                lease_expires_at=NOW + timedelta(minutes=1),
                last_error_code=None,
                updated_at=NOW,
                completed_at=None,
            )
            repository = MagicMock()
            repository.select_for_update.return_value.get.return_value = row
            repository.filter.return_value.update.return_value = 1
            manager = MagicMock()
            manager.using.return_value = repository
            kwargs = {
                "outbox_id": 7,
                "worker_id": "worker-a",
                "now": NOW,
            }
            if expected_status == "dead":
                kwargs["error_category"] = "raw database password=secret"
            with (
                self.subTest(operation=operation.__name__),
                patch.object(persistence.FileScanOutbox, "objects", manager),
                patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            ):
                updated = operation(**kwargs)
            self.assertEqual(updated.status, expected_status)
            self.assertIsNone(updated.lease_owner)
            if expected_status == "completed":
                self.assertEqual(updated.completed_at, NOW)
            else:
                self.assertEqual(updated.last_error_code, "internal_error")

        unowned = SimpleNamespace(status="processing", lease_owner="worker-b")
        repository = MagicMock()
        repository.select_for_update.return_value.get.return_value = unowned
        manager = MagicMock()
        manager.using.return_value = repository
        with (
            patch.object(persistence.FileScanOutbox, "objects", manager),
            patch.object(persistence.transaction, "atomic", return_value=nullcontext()),
            self.assertRaises(persistence.LeaseConflict),
        ):
            persistence.complete_outbox_operation(
                outbox_id=7,
                worker_id="worker-a",
                now=NOW,
            )

    def test_diagnostics_are_allowlisted_and_event_history_is_append_only(self):
        raw = "syntax error near Learner.file_scan_jobs password=secret"
        self.assertEqual(persistence.sanitize_failure_category(raw), "internal_error")
        self.assertNotIn(raw, persistence.SANITIZED_FAILURE_CATEGORIES)
        event = persistence.FileScanEvent()
        event._state.adding = False
        with self.assertRaises(persistence.AppendOnlyHistoryError):
            event.save()
        with self.assertRaises(persistence.AppendOnlyHistoryError):
            persistence.FileScanEvent.objects.none().update(disposition="rejected")


class ScannerContainmentBoundaryTests(SimpleTestCase):
    databases = []

    def test_m1_is_not_imported_by_upload_or_download_request_modules(self):
        root = Path(__file__).resolve().parent.parent
        request_modules = (
            root / "learner_api" / "evidence.py",
            root / "learner_api" / "reflection_submissions.py",
            root / "learner_api" / "support_ticket_files.py",
            root / "enrolment_api" / "learner_uploads.py",
            root / "login" / "advanced_admin_assignment_uploads.py",
        )
        for path in request_modules:
            with self.subTest(path=path.name):
                self.assertNotIn("malware_persistence", path.read_text(encoding="utf-8"))

    def test_i3b_scanner_remains_fail_closed(self):
        from learner_api import malware_scanning

        source = inspect.getsource(malware_scanning.ensure_scanner_ready)
        self.assertIn("raise ScannerUnavailable", source)
        with self.assertRaises(malware_scanning.ScannerUnavailable):
            malware_scanning.ensure_scanner_ready()
