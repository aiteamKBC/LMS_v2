"""Safe classifications: no network, transcripts, or provider exception leakage."""
import json
from types import SimpleNamespace

import httpx
import openai
from django.test import SimpleTestCase

from .migrated_summary_errors import summary_generation_error


class MigratedSummaryErrorTests(SimpleTestCase):
    def classify(self, exc, expected):
        with self.assertLogs("coach_api.migrated_summary_errors", level="WARNING") as logs:
            result = summary_generation_error(SimpleNamespace(request_id="safe-request-id"), exc)
        self.assertEqual(result["code"], expected)
        self.assertEqual(result["requestId"], "safe-request-id")
        self.assertNotIn("PRIVATE", json.dumps(result) + "\n".join(logs.output))
        return result

    def test_provider_errors_are_categorized_without_raw_messages_or_body(self):
        request = httpx.Request("POST", "https://example.invalid/summary")
        for status, provider_code, expected in (
            (401, "invalid_api_key", "AI_SUMMARY_ACCESS"),
            (403, "permission_denied", "AI_SUMMARY_ACCESS"),
            (429, "insufficient_quota", "AI_SUMMARY_QUOTA"),
            (429, "project_spend_limit_exceeded", "AI_SUMMARY_QUOTA"),
            (429, "rate_limit_exceeded", "AI_SUMMARY_RATE_LIMIT"),
            (500, "server_error", "AI_SUMMARY_SERVICE"),
            (400, "bad_request", "AI_SUMMARY_REQUEST"),
        ):
            with self.subTest(status=status, code=provider_code):
                response = httpx.Response(status, request=request, headers={"x-request-id": "req_safe-provider-id"})
                exc = openai.APIStatusError("PRIVATE key and transcript", response=response,
                                           body={"code": provider_code, "message": "PRIVATE"})
                self.classify(exc, expected)

    def test_transport_failures_have_actionable_safe_messages(self):
        request = httpx.Request("POST", "https://example.invalid/summary")
        self.classify(openai.APITimeoutError(request), "AI_SUMMARY_TIMEOUT")
        self.classify(openai.APIConnectionError(message="PRIVATE", request=request), "AI_SUMMARY_CONNECTION")

    def test_known_internal_validation_and_configuration_errors(self):
        for message, expected in (
            ("OPENAI_API_KEY is not configured.", "AI_SUMMARY_CONFIGURATION"),
            ("The OpenAI client library is not installed on the server.", "AI_SUMMARY_CONFIGURATION"),
            ("The AI service returned an empty meeting summary (finish_reason=length).", "AI_SUMMARY_INVALID_OUTPUT"),
            ("The AI service returned an invalid meeting summary.", "AI_SUMMARY_INVALID_OUTPUT"),
            ("The AI service returned a meeting summary without an overview.", "AI_SUMMARY_INVALID_OUTPUT"),
            ("PRIVATE unknown exception", "AI_SUMMARY_FAILED"),
        ):
            with self.subTest(expected=expected):
                self.classify(RuntimeError(message), expected)

    def test_unknown_provider_fields_do_not_leak_into_logs_or_response(self):
        exc = RuntimeError("PRIVATE")
        exc.status_code = 429
        exc.code = {"PRIVATE": "untrusted"}
        exc.request_id = "PRIVATE\ninjected log"
        self.classify(exc, "AI_SUMMARY_RATE_LIMIT")

    def test_missing_request_id_is_generated_for_follow_up(self):
        request = SimpleNamespace()
        result = summary_generation_error(request, RuntimeError("PRIVATE"))
        self.assertEqual(result["requestId"], request.request_id)
        self.assertTrue(result["requestId"])
