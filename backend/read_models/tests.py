from __future__ import annotations

import json
from io import StringIO
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.core.management import call_command
from django.db import connection, transaction
from django.test import RequestFactory, TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from read_models.models import PerformanceSample, ReadModel, ReadModelEvent
from read_models import repository
from read_models.apps import _database_identity
from read_models.outbox import enqueue_read_model_event
from read_models.registry import ReadModelSpec, register
from read_models.repository import get_read_model, put_read_model
from read_models.worker import claim_events, process_once, purge_processed_events
from system_audit.performance import performance_record, performance_report


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    READ_MODEL_OUTBOX_ENABLED=True,
)
class SharedReadModelTests(TestCase):
    def setUp(self):
        repository._cache_unavailable_until = 0.0
        cache.clear()

    def test_database_identity_accepts_neon_direct_and_pooler_defaults(self):
        direct = {
            "ENGINE": "django.db.backends.postgresql", "NAME": "neondb", "USER": "app",
            "HOST": "ep-example.eu-west-2.aws.neon.tech", "PORT": "5432",
        }
        pooled = {
            "ENGINE": "django.db.backends.postgresql", "NAME": "neondb", "USER": "app",
            "HOST": "ep-example-pooler.eu-west-2.aws.neon.tech", "PORT": "",
        }

        self.assertEqual(_database_identity(direct), _database_identity(pooled))

    def test_upsert_overwrites_one_scoped_row(self):
        first = put_read_model("test.summary", "coach", "7", {"value": 1}, schema_version=1, ttl_seconds=30)
        second = put_read_model("test.summary", "coach", "7", {"value": 2}, schema_version=2, ttl_seconds=30)

        self.assertIsNotNone(first)
        self.assertIsNotNone(second)
        self.assertEqual(ReadModel.objects.count(), 1)
        row = ReadModel.objects.get()
        self.assertEqual((row.payload, row.schema_version), ({"value": 2}, 2))

    def test_deleted_read_model_is_not_served_after_cache_invalidation(self):
        put_read_model("test.deleted", "coach", "7", {"value": 1}, schema_version=1, ttl_seconds=30)
        ReadModel.objects.filter(model_key="test.deleted").delete()
        cache.clear()

        value = get_read_model("test.deleted", "coach", "7", schema_version=1, cache_ttl=30)

        self.assertIsNone(value)

    def test_cache_failure_falls_back_to_persistent_row(self):
        put_read_model("test.cache", "coach", "7", {"value": 1}, schema_version=1, ttl_seconds=30)
        cache.clear()
        with (
            patch("read_models.repository.cache.get", side_effect=ConnectionError("offline")),
            patch("read_models.repository.cache.set") as cache_set,
        ):
            value = get_read_model("test.cache", "coach", "7", schema_version=1, cache_ttl=30)
        self.assertEqual(value.payload, {"value": 1})
        cache_set.assert_not_called()

    def test_cache_circuit_breaker_skips_repeated_unavailable_reads(self):
        put_read_model("test.cache", "coach", "7", {"value": 1}, schema_version=1, ttl_seconds=30)
        cache.clear()
        with patch("read_models.repository.cache.get", side_effect=ConnectionError("offline")) as cache_get:
            first = get_read_model("test.cache", "coach", "7", schema_version=1, cache_ttl=30)
            second = get_read_model("test.cache", "coach", "7", schema_version=1, cache_ttl=30)

        self.assertEqual(first.payload, second.payload)
        cache_get.assert_called_once_with(repository.cache_key("test.cache", "coach", "7", 1))

    def test_read_query_count_is_constant_for_small_and_large_payloads(self):
        query_counts = []
        for scope_id, learner_count in (("small", 1), ("large", 500)):
            put_read_model(
                "test.size", "coach", scope_id,
                {"learners": [{"id": index} for index in range(learner_count)]},
                schema_version=1, ttl_seconds=30,
            )
            cache.clear()
            with CaptureQueriesContext(connection) as queries:
                value = get_read_model(
                    "test.size", "coach", scope_id, schema_version=1, cache_ttl=30,
                )
            self.assertEqual(len(value.payload["learners"]), learner_count)
            query_counts.append(len(queries))

        self.assertEqual(query_counts, [1, 1])

    def test_outbox_event_rolls_back_with_domain_transaction(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                self.assertTrue(enqueue_read_model_event(
                    event_type="changed",
                    model_key="test.rollback",
                    scope_type="coach",
                    scope_id="7",
                ))
                raise RuntimeError("rollback")
        self.assertFalse(ReadModelEvent.objects.exists())

    def test_worker_coalesces_events_for_the_same_scope(self):
        calls = []
        model_key = "test.coalesced"
        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=1,
            ttl_seconds=30,
            builder=lambda scope_id: calls.append(scope_id) or {"scope": scope_id},
        ))
        for reason in ("one", "two"):
            enqueue_read_model_event(
                event_type=reason,
                model_key=model_key,
                scope_type="coach",
                scope_id="7",
            )

        result = process_once(limit=10, worker_id="test-worker")

        self.assertEqual(result, {"claimed": 2, "completed": 2, "failed": 0, "groups": 1})
        self.assertEqual(calls, ["7"])
        self.assertEqual(ReadModel.objects.get(model_key=model_key).payload, {"scope": "7"})
        self.assertEqual(
            set(ReadModelEvent.objects.values_list("status", flat=True)),
            {ReadModelEvent.STATUS_PROCESSED},
        )

    def test_worker_coalesces_same_scope_events_beyond_claim_limit(self):
        calls = []
        model_key = "test.coalesced-across-batches"
        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=1,
            ttl_seconds=30,
            builder=lambda scope_id: calls.append(scope_id) or {"scope": scope_id},
        ))
        for index in range(5):
            enqueue_read_model_event(
                event_type=f"change-{index}",
                model_key=model_key,
                scope_type="coach",
                scope_id="7",
            )

        first = process_once(limit=2, worker_id="test-worker")
        second = process_once(limit=2, worker_id="test-worker")

        self.assertEqual(first, {"claimed": 2, "completed": 2, "failed": 0, "groups": 1})
        self.assertEqual(second, {"claimed": 0, "completed": 0, "failed": 0, "groups": 0})
        self.assertEqual(calls, ["7"])
        self.assertEqual(
            set(ReadModelEvent.objects.values_list("status", flat=True)),
            {ReadModelEvent.STATUS_PROCESSED},
        )

    def test_worker_model_filter_leaves_other_models_pending(self):
        model_key = "test.filtered"
        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=1,
            ttl_seconds=30,
            builder=lambda scope_id: {"scope": scope_id},
        ))
        selected = ReadModelEvent.objects.create(
            event_type="changed", model_key=model_key,
            scope_type="coach", scope_id="selected",
        )
        other = ReadModelEvent.objects.create(
            event_type="changed", model_key="test.other",
            scope_type="coach", scope_id="untouched",
        )

        result = process_once(limit=10, worker_id="filtered-worker", model_key=model_key)

        selected.refresh_from_db()
        other.refresh_from_db()
        self.assertEqual(result, {"claimed": 1, "completed": 1, "failed": 0, "groups": 1})
        self.assertEqual(selected.status, ReadModelEvent.STATUS_PROCESSED)
        self.assertEqual(other.status, ReadModelEvent.STATUS_PENDING)

    def test_worker_keeps_event_created_during_refresh_pending(self):
        calls = []
        model_key = "test.coalesced-watermark"

        def build(scope_id):
            calls.append(scope_id)
            enqueue_read_model_event(
                event_type="arrived-during-refresh",
                model_key=model_key,
                scope_type="coach",
                scope_id=scope_id,
            )
            return {"scope": scope_id}

        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=1,
            ttl_seconds=30,
            builder=build,
        ))
        enqueue_read_model_event(
            event_type="initial",
            model_key=model_key,
            scope_type="coach",
            scope_id="7",
        )

        result = process_once(limit=10, worker_id="test-worker")

        self.assertEqual(result, {"claimed": 1, "completed": 1, "failed": 0, "groups": 1})
        self.assertEqual(calls, ["7"])
        self.assertEqual(
            list(ReadModelEvent.objects.order_by("created_at").values_list("status", flat=True)),
            [ReadModelEvent.STATUS_PROCESSED, ReadModelEvent.STATUS_PENDING],
        )

    @patch("read_models.worker.logger.exception")
    def test_worker_failure_is_retried_without_losing_the_event(self, log_exception):
        model_key = "test.failure"
        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=1,
            ttl_seconds=30,
            builder=lambda _scope_id: (_ for _ in ()).throw(RuntimeError("temporary failure")),
        ))
        enqueue_read_model_event(
            event_type="changed",
            model_key=model_key,
            scope_type="coach",
            scope_id="7",
        )

        result = process_once(limit=10, worker_id="test-worker")

        event = ReadModelEvent.objects.get()
        self.assertEqual(result["failed"], 1)
        self.assertEqual(event.status, ReadModelEvent.STATUS_RETRY)
        self.assertEqual(event.attempts, 1)
        self.assertIn("RuntimeError: temporary failure", event.last_error)
        self.assertFalse(ReadModel.objects.filter(model_key=model_key).exists())
        log_exception.assert_called_once()

    @override_settings(READ_MODEL_WORKER_LEASE_SECONDS=30)
    def test_stale_worker_lease_is_recovered(self):
        event = ReadModelEvent.objects.create(
            event_type="changed",
            model_key="test.lease",
            scope_type="coach",
            scope_id="7",
            status=ReadModelEvent.STATUS_PROCESSING,
            locked_by="stopped-worker",
            locked_at=timezone.now() - timedelta(minutes=2),
        )

        claimed = claim_events(limit=10, worker_id="replacement-worker")

        self.assertEqual([item.pk for item in claimed], [event.pk])
        event.refresh_from_db()
        self.assertEqual(event.status, ReadModelEvent.STATUS_PROCESSING)
        self.assertEqual(event.locked_by, "replacement-worker")

    def test_worker_claims_earliest_available_event_first(self):
        now = timezone.now()
        older_created = ReadModelEvent.objects.create(
            event_type="changed",
            model_key="test.ordering",
            scope_type="coach",
            scope_id="older-created",
            available_at=now - timedelta(minutes=1),
        )
        earlier_available = ReadModelEvent.objects.create(
            event_type="changed",
            model_key="test.ordering",
            scope_type="coach",
            scope_id="earlier-available",
            available_at=now - timedelta(minutes=2),
        )
        ReadModelEvent.objects.filter(pk=older_created.pk).update(
            created_at=now - timedelta(minutes=10),
        )

        claimed = claim_events(limit=1, worker_id="ordering-worker")

        self.assertEqual([item.pk for item in claimed], [earlier_available.pk])

    @override_settings(READ_MODEL_OUTBOX_RETENTION_DAYS=7)
    def test_outbox_cleanup_only_removes_old_processed_events(self):
        old = timezone.now() - timedelta(days=8)
        processed = ReadModelEvent.objects.create(
            event_type="done", model_key="test.cleanup", scope_type="coach", scope_id="1",
            status=ReadModelEvent.STATUS_PROCESSED, processed_at=old,
        )
        dead = ReadModelEvent.objects.create(
            event_type="dead", model_key="test.cleanup", scope_type="coach", scope_id="2",
            status=ReadModelEvent.STATUS_DEAD,
        )
        ReadModelEvent.objects.filter(pk__in=[processed.pk, dead.pk]).update(created_at=old)

        deleted = purge_processed_events(force=True)

        self.assertEqual(deleted, 1)
        self.assertFalse(ReadModelEvent.objects.filter(pk=processed.pk).exists())
        self.assertTrue(ReadModelEvent.objects.filter(pk=dead.pk).exists())

    def test_reconciliation_is_bounded_and_skips_fresh_scopes(self):
        model_key = "test.reconciliation"
        register(ReadModelSpec(
            model_key=model_key,
            scope_type="coach",
            schema_version=2,
            ttl_seconds=30,
            builder=lambda scope_id: {"scope": scope_id},
            scope_source=lambda _limit: ["fresh", "missing-1", "missing-2"],
        ))
        put_read_model(
            model_key, "coach", "fresh", {"value": 1}, schema_version=2, ttl_seconds=30,
        )
        output = StringIO()

        call_command("reconcile_read_models", model=model_key, limit=1, stdout=output)

        self.assertIn("examined=1 enqueued=1", output.getvalue())
        self.assertEqual(
            list(ReadModelEvent.objects.values_list("scope_id", flat=True)),
            ["missing-1"],
        )

        call_command("reconcile_read_models", model=model_key, limit=1, stdout=StringIO())
        self.assertEqual(ReadModelEvent.objects.count(), 1)

    @override_settings(COACH_DASHBOARD_SHARED_READ_MODEL_ENABLED=True)
    @patch("coach_api.dashboard_service.CoachDashboardSnapshot.objects")
    def test_coach_reads_shared_model_before_legacy_snapshot(self, legacy_objects):
        from coach_api.services.dashboard.service import CoachDashboardService

        put_read_model(
            "coach.dashboard", "coach", "coach@example.com", {"learners": [{"id": 7}]},
            schema_version=CoachDashboardService.SCHEMA_VERSION, ttl_seconds=30,
        )

        payload = CoachDashboardService("coach@example.com").build()

        self.assertEqual(payload["learners"], [{"id": 7}])
        self.assertEqual(payload["readModel"]["version"], CoachDashboardService.SCHEMA_VERSION)
        legacy_objects.filter.assert_not_called()

    @override_settings(READ_MODEL_DUAL_WRITE_ENABLED=True)
    @patch("coach_api.dashboard_service.CoachDashboardSnapshot.objects")
    @patch("coach_api.services.dashboard.service.CoachDashboardService.build_live")
    def test_coach_refresh_dual_writes_without_changing_payload_shape(self, build_live, legacy_objects):
        from coach_api.services.dashboard.service import CoachDashboardService
        from django.utils import timezone

        refreshed_at = timezone.now()
        build_live.return_value = {"learners": [{"id": 7}], "errors": {}}
        legacy_objects.update_or_create.return_value = (
            SimpleNamespace(refreshed_at=refreshed_at), True,
        )

        payload = CoachDashboardService("coach@example.com").refresh()

        row = ReadModel.objects.get(model_key="coach.dashboard", scope_id="coach@example.com")
        self.assertEqual(row.payload, {"learners": [{"id": 7}], "errors": {}})
        self.assertEqual(payload["learners"], [{"id": 7}])
        self.assertEqual(set(payload), {"learners", "errors", "readModel"})


@override_settings(
    PERFORMANCE_DIAGNOSTICS=True,
    PERFORMANCE_DIAGNOSTIC_ACCOUNT_IDS=frozenset({"42"}),
    PERFORMANCE_SAMPLE_RETENTION_DAYS=14,
)
class PerformanceSampleTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(pk=42, role="staff", subject_type="staff")

    def test_record_derives_route_and_counts_from_sanitized_requests(self):
        request = self.factory.post(
            "/curriculum_api/performance/record/",
            data=json.dumps({
                "runId": "run-1",
                "path": "/learner/progress-reviews/123?private=yes",
                "pageReadyMs": 1200,
                "cold": False,
                "requests": [
                    {"method": "GET", "path": "/learner_api/monthly-logs/123/?email=private", "status": 200,
                     "durationMs": 200, "queryCount": 5, "dbMs": 30, "cacheStatus": "HIT"},
                    {"method": "GET", "path": "/learner_api/monthly-logs/123/", "status": 503,
                     "durationMs": 300, "queryCount": 2, "dbMs": 50},
                    {"method": "POST", "path": "/learner_api/save/", "status": 200, "durationMs": 10},
                ],
            }),
            content_type="application/json",
        )
        request.login_account = self.account

        response = performance_record(request)

        self.assertEqual(response.status_code, 200)
        sample = PerformanceSample.objects.get()
        self.assertNotIn("123", sample.route_path)
        self.assertNotIn("private", json.dumps(sample.request_details))
        self.assertEqual(sample.request_count, 2)
        self.assertEqual(sample.duplicate_get_count, 1)
        self.assertEqual(sample.failed_request_count, 1)
        self.assertEqual(sample.total_query_count, 7)
        self.assertEqual(sample.request_details[0]["cacheStatus"], "HIT")

    def test_non_allowlisted_account_is_refused(self):
        request = self.factory.post(
            "/curriculum_api/performance/record/",
            data="{}",
            content_type="application/json",
        )
        request.login_account = SimpleNamespace(pk=99, role="staff", subject_type="staff")
        self.assertEqual(performance_record(request).status_code, 403)

    @patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"}))
    @patch("login.permissions.authenticate_request")
    def test_report_applies_the_agreed_performance_budget(self, authenticate, _accesses):
        authenticate.return_value = SimpleNamespace(
            pk=42, role="admin", subject_type="staff", is_active=True,
        )
        for ready_ms in (1000, 1100, 1200, 1300, 1400):
            PerformanceSample.objects.create(
                workspace="coach",
                route_path="/workspace/coach",
                page_ready_ms=ready_ms,
                request_count=2,
                request_details=[{
                    "status": 200, "durationMs": 100, "cacheStatus": "HIT",
                }],
            )
        request = self.factory.get("/curriculum_api/performance/report/")

        payload = json.loads(performance_report(request).content)

        self.assertEqual(payload["pages"][0]["pageReadyP95Ms"], 1400)
        self.assertEqual(payload["pages"][0]["cacheHitApiP95Ms"], 100)
        self.assertEqual(payload["pages"][0]["cacheHitRequests"], 5)
        self.assertTrue(payload["pages"][0]["budgetPassed"])
