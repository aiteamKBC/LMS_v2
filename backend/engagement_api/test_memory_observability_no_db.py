from __future__ import annotations

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.conf import settings
from django.http import HttpResponse, StreamingHttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import resolve

from config.observability import RequestObservabilityMiddleware
from engagement_api import observability, views


ENABLED = override_settings(
    ENGAGEMENT_MEMORY_OBSERVABILITY=True,
    ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_EVENTS_PER_MINUTE=240,
    ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_REQUESTS_PER_MINUTE=120,
    ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_PRIORITY_REQUESTS_PER_MINUTE=30,
    ENGAGEMENT_MEMORY_OBSERVABILITY_PSS_INTERVAL_SECONDS=15,
)


def _payloads(log_info):
    return [json.loads(call.args[0]) for call in log_info.call_args_list]


def _activate(request):
    request._engagement_memory_observability_active = True
    return request


class EngagementRequestTelemetryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        observability._reset_state_for_tests()

    @override_settings(ENGAGEMENT_MEMORY_OBSERVABILITY=False)
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.observability._read_process_memory")
    def test_disabled_state_skips_memory_and_logging(self, read_memory, log_info):
        response = HttpResponse("ok")
        middleware = observability.EngagementMemoryObservabilityMiddleware(lambda _request: response)

        result = middleware(self.factory.get("/engagement_api/learner-analytics/?token=secret"))

        self.assertIs(result, response)
        read_memory.assert_not_called()
        log_info.assert_not_called()

    def test_default_settings_do_not_register_engagement_middleware(self):
        self.assertFalse(settings.ENGAGEMENT_MEMORY_OBSERVABILITY)
        self.assertNotIn(
            "engagement_api.observability.EngagementMemoryObservabilityMiddleware",
            settings.MIDDLEWARE,
        )

    @override_settings(ENGAGEMENT_MEMORY_OBSERVABILITY=False)
    def test_disabled_diagnostic_contexts_reuse_noop_without_inspecting_files(self):
        class ExplodingIterable:
            def __iter__(self):
                raise AssertionError("disabled telemetry inspected uploads")

        request = self.factory.get("/engagement_api/learner-analytics/")
        first = observability.analytics_build(request)
        second = observability.analytics_build(request)
        ai_context = observability.ai_flashcard_invocation(
            request, ExplodingIterable(), max_files=10
        )

        self.assertIs(first, second)
        self.assertIs(first, ai_context)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.observability._read_process_memory")
    def test_non_engagement_request_is_untouched_when_enabled(self, read_memory, log_info):
        response = HttpResponse("ok")
        middleware = observability.EngagementMemoryObservabilityMiddleware(lambda _request: response)

        result = middleware(self.factory.get("/learner_api/dashboard/?token=secret"))

        self.assertIs(result, response)
        read_memory.assert_not_called()
        log_info.assert_not_called()

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory")
    @mock.patch("engagement_api.observability.logger.info")
    def test_route_template_and_payload_are_sanitized(self, log_info, read_memory):
        read_memory.side_effect = [
            {"rss_kib": 100, "pss_kib": 80, "peak_rss_kib": 110},
            {"rss_kib": 112, "pss_kib": 85, "peak_rss_kib": 120},
        ]

        def respond(request):
            request.resolver_match = SimpleNamespace(
                route="engagement_api/flash-cards/decks/<int:pk>/",
                view_name="flash-card-deck-detail",
            )
            return HttpResponse("safe", status=201)

        middleware = observability.EngagementMemoryObservabilityMiddleware(respond)
        request = self.factory.get(
            "/engagement_api/flash-cards/decks/481/?learnerId=77&token=top-secret"
        )
        request.request_id = "attacker-supplied"

        response = middleware(request)
        payload = _payloads(log_info)[0]
        encoded = json.dumps(payload)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(payload["route_template"], "engagement_api/flash-cards/decks/<int:pk>/")
        self.assertEqual(payload["rss_delta_kib"], 12)
        self.assertEqual(payload["pss_delta_kib"], 5)
        self.assertEqual(payload["memory_scope"], "process")
        self.assertEqual(payload["interpretation"], "correlation_only")
        self.assertNotIn("481", encoded)
        self.assertNotIn("learnerId", encoded)
        self.assertNotIn("top-secret", encoded)
        self.assertNotEqual(payload["request_id"], "attacker-supplied")

    @ENABLED
    @mock.patch("config.observability.logger.info")
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_existing_request_id_is_shared_with_engagement_event(
        self, engagement_log, _read_memory, _request_log
    ):
        def respond(request):
            request.resolver_match = SimpleNamespace(
                route="engagement_api/learner-analytics/",
                view_name="learner-analytics",
            )
            return HttpResponse("ok")

        middleware = RequestObservabilityMiddleware(
            observability.EngagementMemoryObservabilityMiddleware(respond)
        )
        response = middleware(self.factory.get("/engagement_api/learner-analytics/"))
        payload = _payloads(engagement_log)[0]

        self.assertEqual(response["X-Request-ID"], payload["request_id"])

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_actual_url_resolution_logs_template_not_concrete_identifier(
        self, log_info, _read_memory
    ):
        path = "/engagement_api/flash-cards/decks/481/"
        request = self.factory.get(path + "?learnerId=77")
        request.resolver_match = resolve(path)
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        middleware(request)
        payload = _payloads(log_info)[0]

        self.assertEqual(
            payload["route_template"],
            "engagement_api/flash-cards/decks/<int:pk>/",
        )
        self.assertNotIn("481", json.dumps(payload))
        self.assertNotIn("learnerId", json.dumps(payload))

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_streaming_response_is_not_consumed_for_size(self, log_info, _read_memory):
        response = StreamingHttpResponse(iter((b"one", b"two")))
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: response
        )

        result = middleware(self.factory.get("/engagement_api/points/me/"))
        payload = _payloads(log_info)[0]

        self.assertIs(result, response)
        self.assertNotIn("response_size_bytes", payload)
        self.assertEqual(list(result.streaming_content), [b"one", b"two"])

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info", side_effect=RuntimeError("log down"))
    def test_logging_failure_never_breaks_response(self, _log_info, _read_memory):
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        response = middleware(self.factory.get("/engagement_api/points/me/"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"ok")

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_failed_request_is_logged_then_reraised(self, log_info, _read_memory):
        def fail(_request):
            raise RuntimeError("synthetic failure")

        middleware = observability.EngagementMemoryObservabilityMiddleware(fail)

        with self.assertRaisesMessage(RuntimeError, "synthetic failure"):
            middleware(self.factory.get("/engagement_api/learner-analytics/"))

        payload = _payloads(log_info)[0]
        self.assertEqual(payload["outcome"], "exception")
        self.assertEqual(payload["status_code"], 500)

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_aborted_request_is_logged_then_propagated(self, log_info, _read_memory):
        class SyntheticAbort(BaseException):
            pass

        def abort(_request):
            raise SyntheticAbort()

        middleware = observability.EngagementMemoryObservabilityMiddleware(abort)

        with self.assertRaises(SyntheticAbort):
            middleware(self.factory.get("/engagement_api/learner-analytics/"))

        self.assertEqual(_payloads(log_info)[0]["outcome"], "exception")

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_pss_sampling_is_cadence_limited(self, _log_info, read_memory):
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )
        request = self.factory.get("/engagement_api/learner-analytics/")

        middleware(request)
        middleware(request)

        self.assertEqual(
            [call.kwargs["include_pss"] for call in read_memory.call_args_list],
            [True, True, False, False],
        )

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_overlapping_request_never_waits_for_pss_sampler(self, _log_info):
        first_pss_read = threading.Event()
        release_first = threading.Event()
        call_lock = threading.Lock()
        pss_calls = 0

        def read_memory(*, include_pss):
            nonlocal pss_calls
            if include_pss:
                with call_lock:
                    pss_calls += 1
                    call_number = pss_calls
                if call_number == 1:
                    first_pss_read.set()
                    release_first.wait(timeout=2)
            return {}

        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        with mock.patch(
            "engagement_api.observability._read_process_memory",
            side_effect=read_memory,
        ):
            with ThreadPoolExecutor(max_workers=2) as executor:
                first = executor.submit(
                    middleware,
                    self.factory.get("/engagement_api/learner-analytics/"),
                )
                self.assertTrue(first_pss_read.wait(timeout=1))
                second = executor.submit(
                    middleware,
                    self.factory.get("/engagement_api/learner-analytics/"),
                )
                self.assertEqual(second.result(timeout=1).status_code, 200)
                release_first.set()
                self.assertEqual(first.result(timeout=1).status_code, 200)

        self.assertEqual(pss_calls, 2)  # before/after belong to one request only

    @ENABLED
    @mock.patch(
        "engagement_api.observability._read_process_memory",
        side_effect=RuntimeError("procfs unavailable"),
    )
    @mock.patch("engagement_api.observability.logger.info")
    def test_sampler_exception_omits_memory_without_breaking_request(
        self, log_info, _read_memory
    ):
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        response = middleware(self.factory.get("/engagement_api/learner-analytics/"))
        payload = _payloads(log_info)[0]

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("pss_before_kib", payload)
        self.assertNotIn("rss_before_kib", payload)
        self.assertEqual(payload["memory_scope"], "process")

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_concurrent_requests_obey_process_log_cap(self, log_info, _read_memory):
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        with override_settings(ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_EVENTS_PER_MINUTE=5):
            with ThreadPoolExecutor(max_workers=8) as executor:
                list(executor.map(
                    lambda _: middleware(self.factory.get("/engagement_api/points/me/")),
                    range(24),
                ))

        self.assertEqual(log_info.call_count, 5)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_rate_limit_reports_previous_window_drops_within_next_cap(self, log_info):
        with override_settings(ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_EVENTS_PER_MINUTE=2):
            with mock.patch(
                "engagement_api.observability.time.monotonic",
                side_effect=[1.0, 2.0, 3.0, 61.0],
            ):
                for _ in range(4):
                    observability._emit("synthetic")

        payloads = _payloads(log_info)
        self.assertEqual(len(payloads), 4)  # two events in each fixed window
        self.assertEqual(payloads[2]["event"], "engagement_telemetry_dropped")
        self.assertEqual(payloads[2]["dropped_events"], 1)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_telemetry_message_is_json_under_debug_true_and_false(self, log_info):
        formatter = logging.Formatter(
            settings.LOGGING["formatters"]["engagement_telemetry"]["format"]
        )
        for debug in (True, False):
            with self.subTest(debug=debug), override_settings(DEBUG=debug):
                observability._reset_state_for_tests()
                observability._emit("synthetic")
                message = log_info.call_args.args[0]
                record = logging.LogRecord(
                    "engagement_api.memory", logging.INFO, __file__, 1, message, (), None
                )
                rendered = formatter.format(record)
                self.assertEqual(json.loads(rendered)["event"], "synthetic")

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory", return_value={})
    @mock.patch("engagement_api.observability.logger.info")
    def test_request_memory_overhead_is_bounded_before_procfs_reads(self, log_info, read_memory):
        middleware = observability.EngagementMemoryObservabilityMiddleware(
            lambda _request: HttpResponse("ok")
        )

        with override_settings(ENGAGEMENT_MEMORY_OBSERVABILITY_MAX_REQUESTS_PER_MINUTE=3):
            for _ in range(12):
                middleware(self.factory.get("/engagement_api/points/me/"))

        self.assertEqual(read_memory.call_count, 6)  # before + after for three requests
        self.assertEqual(log_info.call_count, 3)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_unapproved_fields_are_dropped(self, log_info):
        request = self.factory.get("/engagement_api/learner-analytics/")
        observability._emit(
            "synthetic",
            request,
            route_template="engagement_api/learner-analytics/",
            learner_id="77",
            token="secret",
            query_string="programme=private",
            sql="select private",
        )

        encoded = json.dumps(_payloads(log_info)[0])
        self.assertNotIn("learner_id", encoded)
        self.assertNotIn("secret", encoded)
        self.assertNotIn("programme=", encoded)
        self.assertNotIn("select private", encoded)


class LearnerAnalyticsTelemetryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        observability._reset_state_for_tests()

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.views.staff_error", return_value=None)
    @mock.patch("engagement_api.views.cache")
    def test_cache_hit_logs_only_safe_hit_and_response_size(
        self, cache, _staff_error, log_info
    ):
        cache.get.return_value = [{"id": "synthetic", "name": "Synthetic"}]

        request = _activate(self.factory.get("/", {"programme": "private-filter"}))
        response = views.learner_analytics(request)
        payload = _payloads(log_info)[0]

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["event"], "engagement_learner_analytics_cache")
        self.assertEqual(payload["cache_outcome"], "hit")
        self.assertEqual(payload["scope_kind"], "programme")
        self.assertEqual(len(payload["scope_tag"]), 24)
        self.assertGreater(payload["response_size_bytes"], 0)
        self.assertNotIn("private-filter", json.dumps(payload))

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.views.staff_error", return_value=None)
    @mock.patch("engagement_api.views.cache")
    @mock.patch("coach_api.views.fetch_all_learner_profiles")
    def test_empty_cached_value_is_a_hit_and_skips_build(
        self, fetch_profiles, cache, _staff_error, log_info
    ):
        cache.get.return_value = []

        response = views.learner_analytics(_activate(self.factory.get("/")))
        payload = _payloads(log_info)[0]

        self.assertEqual(json.loads(response.content), {"learners": []})
        self.assertEqual(payload["cache_outcome"], "hit")
        fetch_profiles.assert_not_called()

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.views.staff_error", return_value=None)
    @mock.patch("engagement_api.views.cache")
    @mock.patch("coach_api.views.fetch_all_learner_profiles", return_value=[])
    def test_cache_miss_logs_build_start_end_and_aggregate_counts(
        self, fetch_profiles, cache, _staff_error, log_info
    ):
        cache.get.return_value = None

        response = views.learner_analytics(_activate(self.factory.get("/")))
        payloads = _payloads(log_info)
        by_event = {payload["event"]: payload for payload in payloads}

        self.assertEqual(response.status_code, 200)
        fetch_profiles.assert_called_once_with(programme=None, cohort=None)
        build_end = by_event["engagement_learner_analytics_build_completed"]
        self.assertEqual(build_end["cache_outcome"], "miss")
        self.assertEqual(build_end["concurrent_builders_at_start"], 1)
        self.assertEqual(build_end["builder_scope"], "process")
        self.assertEqual(build_end["scope_kind"], "all")
        self.assertEqual(build_end["profile_rows"], 0)
        self.assertEqual(build_end["learner_rows"], 0)
        self.assertGreater(build_end["response_size_bytes"], 0)

    @ENABLED
    def test_concurrent_builder_count_is_process_local_and_balanced(self):
        barrier = threading.Barrier(2)
        events = []
        events_lock = threading.Lock()

        def capture(event, _request=None, **fields):
            with events_lock:
                events.append((event, fields))

        def build():
            request = _activate(self.factory.get("/"))
            with observability.analytics_build(request):
                barrier.wait(timeout=2)

        with mock.patch("engagement_api.observability._emit", side_effect=capture):
            with ThreadPoolExecutor(max_workers=2) as executor:
                list(executor.map(lambda _: build(), range(2)))

        completions = [fields for event, fields in events if event.endswith("build_completed")]
        self.assertEqual(len(completions), 2)
        self.assertEqual(
            max(row["concurrent_builders_at_start"] for row in completions), 2
        )
        self.assertTrue(all(row["builder_scope"] == "process" for row in completions))

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_every_build_is_counted_even_when_request_was_not_sampled(self, log_info):
        request = self.factory.get("/")

        with observability.analytics_build(
            request, programme="private-programme", cohort="private-cohort"
        ):
            pass

        payload = _payloads(log_info)[0]
        self.assertEqual(payload["event"], "engagement_learner_analytics_build_completed")
        self.assertEqual(payload["concurrent_builders_at_start"], 1)
        self.assertEqual(payload["builder_scope"], "process")
        self.assertEqual(payload["scope_kind"], "both")
        self.assertNotIn("private-programme", json.dumps(payload))
        self.assertNotIn("private-cohort", json.dumps(payload))

    @ENABLED
    def test_scope_tag_is_stable_across_worker_pids_and_non_reversible(self):
        with mock.patch("engagement_api.observability.os.getpid", return_value=101):
            first_kind, first_tag = observability._analytics_scope("Programme A", "Cohort 1")
        with mock.patch("engagement_api.observability.os.getpid", return_value=202):
            second_kind, second_tag = observability._analytics_scope("Programme A", "Cohort 1")
        _, different_tag = observability._analytics_scope("Programme A", "Cohort 2")

        self.assertEqual(first_kind, "both")
        self.assertEqual(second_kind, "both")
        self.assertEqual(first_tag, second_tag)
        self.assertNotEqual(first_tag, different_tag)
        self.assertNotIn("Programme", first_tag)
        self.assertNotIn("Cohort", first_tag)

    @ENABLED
    def test_scope_kind_covers_all_filter_combinations(self):
        cases = (
            (None, None, "all"),
            ("programme", None, "programme"),
            (None, "cohort", "cohort"),
            ("programme", "cohort", "both"),
        )
        for programme, cohort, expected in cases:
            with self.subTest(expected=expected):
                kind, _tag = observability._analytics_scope(programme, cohort)
                self.assertEqual(kind, expected)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_builder_counter_balances_after_exception(self, log_info):
        request = self.factory.get("/")

        with self.assertRaisesMessage(RuntimeError, "synthetic build failure"):
            with observability.analytics_build(request):
                raise RuntimeError("synthetic build failure")
        with observability.analytics_build(request):
            pass

        payloads = _payloads(log_info)
        self.assertEqual(payloads[0]["outcome"], "exception")
        self.assertEqual(payloads[1]["concurrent_builders_at_start"], 1)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info", side_effect=RuntimeError("down"))
    def test_builder_logging_failure_does_not_replace_view_result(self, _log_info):
        result = None
        with observability.analytics_build(self.factory.get("/")):
            result = "preserved"
        self.assertEqual(result, "preserved")


class AiFlashcardTelemetryTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        observability._reset_state_for_tests()
        self.staff = SimpleNamespace(role="staff")

    @ENABLED
    @mock.patch("engagement_api.observability._read_process_memory")
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.ai.generate_flashcards")
    @mock.patch("engagement_api.ai.extract_text_from_files")
    @mock.patch("engagement_api.permissions.authenticate_request")
    def test_upload_logs_counts_bucket_duration_without_filename(
        self, authenticate, extract, generate, log_info, read_memory
    ):
        authenticate.return_value = self.staff
        upload = SimpleUploadedFile("learner-private-name.txt", b"source material")
        extract.return_value = ("source material", [upload.name], [])
        generate.return_value = [{
            "question": "Q", "answer": "A", "category": "C", "difficulty": "easy",
        }]
        read_memory.side_effect = [
            {"rss_kib": 100, "peak_rss_kib": 120},
            {"rss_kib": 108, "peak_rss_kib": 128},
        ]
        request = self.factory.post(
            "/engagement_api/flash-cards/ai/generate/",
            {"files": upload, "topic": "Synthetic"},
        )
        _activate(request)

        response = views.generate_flashcards_view(request)
        payload = _payloads(log_info)[0]
        encoded = json.dumps(payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["event"], "engagement_ai_flashcards_invocation_completed")
        self.assertEqual(payload["submitted_file_count"], 1)
        self.assertEqual(payload["processed_file_count"], 1)
        self.assertEqual(payload["submitted_size_bucket"], "under_1_mib")
        self.assertEqual(payload["processed_size_bucket"], "under_1_mib")
        self.assertEqual(payload["rss_delta_kib"], 8)
        self.assertEqual(payload["memory_scope"], "process")
        self.assertEqual(payload["interpretation"], "correlation_only")
        self.assertGreaterEqual(payload["extraction_duration_ms"], 0)
        self.assertNotIn(upload.name, encoded)
        self.assertNotIn("source material", encoded)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.ai.extract_text_from_files", side_effect=ValueError("too large"))
    @mock.patch("engagement_api.permissions.authenticate_request")
    def test_rejected_upload_is_counted_without_breaking_error_contract(
        self, authenticate, _extract, log_info
    ):
        authenticate.return_value = self.staff
        upload = SimpleUploadedFile("private.pdf", b"invalid")
        request = self.factory.post(
            "/engagement_api/flash-cards/ai/generate/",
            {"files": upload},
        )
        _activate(request)

        response = views.generate_flashcards_view(request)
        payload = _payloads(log_info)[0]

        self.assertEqual(response.status_code, 400)
        self.assertEqual(payload["outcome"], "rejected")
        self.assertEqual(payload["submitted_file_count"], 1)

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch(
        "engagement_api.ai.generate_flashcards",
        side_effect=RuntimeError("quota exceeded"),
    )
    @mock.patch("engagement_api.permissions.authenticate_request")
    def test_provider_error_preserves_existing_status_contract(
        self, authenticate, _generate, log_info
    ):
        authenticate.return_value = self.staff
        request = self.factory.post(
            "/engagement_api/flash-cards/ai/generate/",
            data=json.dumps({"topic": "Synthetic"}),
            content_type="application/json",
        )
        _activate(request)

        response = views.generate_flashcards_view(request)
        payload = _payloads(log_info)[0]

        self.assertEqual(response.status_code, 429)
        self.assertEqual(payload["outcome"], "provider_error")
        self.assertNotIn("quota exceeded", json.dumps(payload))

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch(
        "engagement_api.ai.extract_text_from_files",
        side_effect=RuntimeError("synthetic extractor crash"),
    )
    @mock.patch("engagement_api.permissions.authenticate_request")
    def test_unexpected_extraction_failure_is_not_replaced_by_telemetry(
        self, authenticate, _extract, log_info
    ):
        authenticate.return_value = self.staff
        upload = SimpleUploadedFile("private.pdf", b"invalid")
        request = _activate(self.factory.post(
            "/engagement_api/flash-cards/ai/generate/",
            {"files": upload},
        ))

        with self.assertRaisesMessage(RuntimeError, "synthetic extractor crash"):
            views.generate_flashcards_view(request)

        payload = _payloads(log_info)[0]
        self.assertEqual(payload["outcome"], "exception")
        self.assertNotIn("synthetic extractor crash", json.dumps(payload))

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_unexpected_file_size_property_exception_is_contained(self, log_info):
        class ExplodingSize:
            @property
            def size(self):
                raise RuntimeError("private size failure")

        request = _activate(self.factory.post("/engagement_api/flash-cards/ai/generate/"))
        result = None
        with observability.ai_flashcard_invocation(
            request, [ExplodingSize()], max_files=1
        ):
            result = HttpResponse("preserved")

        payload = _payloads(log_info)[0]
        self.assertEqual(result.content, b"preserved")
        self.assertEqual(payload["submitted_size_bucket"], "unknown")
        self.assertEqual(payload["processed_size_bucket"], "unknown")
        self.assertNotIn("private size failure", json.dumps(payload))

    @ENABLED
    @mock.patch(
        "engagement_api.observability._input_size_bucket",
        side_effect=RuntimeError("telemetry finalizer failed"),
    )
    @mock.patch("engagement_api.observability.logger.info")
    @mock.patch("engagement_api.ai.generate_flashcards")
    @mock.patch("engagement_api.permissions.authenticate_request")
    def test_finalizer_failure_never_replaces_successful_api_response(
        self, authenticate, generate, log_info, _size_bucket
    ):
        authenticate.return_value = self.staff
        generate.return_value = [{
            "question": "Q", "answer": "A", "category": "C", "difficulty": "easy",
        }]
        request = _activate(self.factory.post(
            "/engagement_api/flash-cards/ai/generate/",
            data=json.dumps({"topic": "Synthetic"}),
            content_type="application/json",
        ))

        response = views.generate_flashcards_view(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["cards"], generate.return_value)
        log_info.assert_not_called()

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info")
    def test_submitted_and_processed_size_buckets_are_distinct(self, log_info):
        files = [SimpleNamespace(size=900 * 1024) for _ in range(12)]
        request = _activate(self.factory.post("/engagement_api/flash-cards/ai/generate/"))

        with observability.ai_flashcard_invocation(request, files, max_files=10):
            pass

        payload = _payloads(log_info)[0]
        self.assertEqual(payload["submitted_file_count"], 12)
        self.assertEqual(payload["processed_file_count"], 10)
        self.assertEqual(payload["submitted_size_bucket"], "10_to_100_mib")
        self.assertEqual(payload["processed_size_bucket"], "1_to_10_mib")

    @ENABLED
    @mock.patch("engagement_api.observability.logger.info", side_effect=RuntimeError("down"))
    def test_ai_logging_failure_does_not_replace_result(self, _log_info):
        request = _activate(self.factory.post("/engagement_api/flash-cards/ai/generate/"))
        result = None
        with observability.ai_flashcard_invocation(request, [], max_files=10):
            result = "preserved"
        self.assertEqual(result, "preserved")

    def test_input_size_buckets_are_bounded_and_do_not_read_content(self):
        mib = 1024 * 1024
        cases = (
            (0, "none"),
            (mib - 1, "under_1_mib"),
            (mib, "1_to_10_mib"),
            (10 * mib, "10_to_100_mib"),
            (100 * mib, "100_to_500_mib"),
            (500 * mib, "500_mib_or_more"),
        )
        for size, expected in cases:
            with self.subTest(size=size):
                self.assertEqual(
                    observability._input_size_bucket([SimpleNamespace(size=size)]),
                    expected,
                )
