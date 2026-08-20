from __future__ import annotations

import json
import logging
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from config.observability import JsonLogFormatter, RequestObservabilityMiddleware
from config.performance import PerformanceTimingMiddleware


class RequestObservabilityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("config.observability.logger.info")
    def test_server_generates_request_id_and_returns_header(self, log_info):
        middleware = RequestObservabilityMiddleware(lambda _request: HttpResponse("ok", status=201))
        request = self.factory.get("/coach_api/coach/dashboard", HTTP_X_REQUEST_ID="attacker-controlled")

        response = middleware(request)

        self.assertNotEqual(request.request_id, "attacker-controlled")
        self.assertEqual(response["X-Request-ID"], request.request_id)
        event = log_info.call_args.kwargs["extra"]
        self.assertEqual(event["event"], "http_request")
        self.assertEqual(event["status_code"], 201)
        self.assertGreaterEqual(event["latency_ms"], 0)

    def test_json_formatter_uses_safe_allowlist(self):
        record = logging.LogRecord("coach_api", logging.INFO, __file__, 1, "completed", (), None)
        record.request_id = "request-1"
        record.event = "http_request"
        record.authorization = "Bearer must-not-log"

        payload = json.loads(JsonLogFormatter().format(record))

        self.assertEqual(payload["request_id"], "request-1")
        self.assertEqual(payload["event"], "http_request")
        self.assertNotIn("authorization", payload)
        self.assertNotIn("must-not-log", json.dumps(payload))

    @override_settings(DEBUG=False, PERFORMANCE_DIAGNOSTICS=True)
    @patch("config.performance.connections.all", return_value=[])
    def test_production_diagnostics_do_not_expose_query_headers(self, _connections):
        middleware = PerformanceTimingMiddleware(lambda _request: HttpResponse("ok"))
        response = middleware(self.factory.get("/coach_api/coach/dashboard"))

        self.assertNotIn("Server-Timing", response)
        self.assertNotIn("X-DB-Query-Count", response)

    @override_settings(DEBUG=True, PERFORMANCE_DIAGNOSTICS=True)
    @patch("config.performance.connections.all", return_value=[])
    def test_local_diagnostics_keep_query_headers(self, _connections):
        middleware = PerformanceTimingMiddleware(lambda _request: HttpResponse("ok"))
        response = middleware(self.factory.get("/coach_api/coach/dashboard"))

        self.assertIn("Server-Timing", response)
        self.assertEqual(response["X-DB-Query-Count"], "0")

