"""Application-wide API route contract tests.

These tests deliberately use an unsupported, non-mutating HTTP method.  That
lets every registered endpoint be exercised without creating records, calling
external services, or depending on production data.  Endpoint-specific test
modules continue to cover successful GET/POST/PATCH/DELETE behaviour.
"""

import base64
import json
import re
import threading
from collections import Counter
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connections
from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase
from django.urls import URLPattern, URLResolver, get_resolver, resolve

from config.batch import api_get_batch


API_PREFIXES = (
    "curriculum_api/",
    "coach_api/",
    "quiz_api/",
    "learner_api/",
    "audit_api/",
    "engagement_api/",
    "enrolment_api/",
    "api/chat/",
)

EXPECTED_ENDPOINT_COUNTS = {
    "curriculum_api/": 64,
    "coach_api/": 17,
    "quiz_api/": 13,
    "learner_api/": 31,
    "audit_api/": 5,
    "engagement_api/": 24,
    "enrolment_api/": 6,
    "api/chat/": 8,
}

CONVERTER_EXAMPLES = {
    "int": "1",
    "str": "test",
    "slug": "test",
    "uuid": "00000000-0000-0000-0000-000000000001",
    "path": "file.txt",
}

ROUTE_PARAMETER = re.compile(r"<(?:(\w+):)?(\w+)>")


class EmptyCursor:
    """A DB-API cursor that safely represents an empty isolated database."""

    description = ()
    rowcount = 0
    lastrowid = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, *_args, **_kwargs):
        return self

    def executemany(self, *_args, **_kwargs):
        return self

    def fetchone(self):
        return None

    def fetchall(self):
        return []

    def fetchmany(self, _size=None):
        return []

    def close(self):
        return None

    def __iter__(self):
        return iter(())


def api_routes():
    """Yield every concrete API route and its configured name."""

    def walk(patterns, prefix=""):
        for pattern in patterns:
            route = prefix + str(pattern.pattern)
            if isinstance(pattern, URLResolver):
                yield from walk(pattern.url_patterns, route)
            elif isinstance(pattern, URLPattern) and route.startswith(API_PREFIXES):
                yield route, pattern.name

    yield from walk(get_resolver().url_patterns)


def concrete_path(route):
    """Replace Django path converters with safe representative values."""

    def replace(match):
        converter = match.group(1) or "str"
        return CONVERTER_EXAMPLES.get(converter, "test")

    return "/" + ROUTE_PARAMETER.sub(replace, route)


class EveryApiEndpointContractTests(SimpleTestCase):
    def test_every_api_endpoint_is_named_and_has_a_unique_route(self):
        routes = list(api_routes())
        self.assertTrue(routes, "No API endpoints were discovered.")

        duplicate_routes = [route for route, count in Counter(route for route, _name in routes).items() if count > 1]
        unnamed_routes = [route for route, name in routes if not name]

        self.assertEqual(unnamed_routes, [], f"Unnamed API endpoints: {unnamed_routes}")
        self.assertEqual(duplicate_routes, [], f"Duplicate API routes: {duplicate_routes}")

    def test_every_api_endpoint_resolves_to_its_registered_view(self):
        """Exercise URL resolution for every route without touching any data."""
        for route, name in api_routes():
            path = concrete_path(route)
            with self.subTest(endpoint=name, path=path):
                match = resolve(path)
                self.assertEqual(match.url_name, name)
                self.assertTrue(callable(match.func))

    def test_every_api_endpoint_has_an_isolated_runtime_smoke_check(self):
        """Call every view with no real database or external side effects."""
        failures = []
        self.client.raise_request_exception = False

        with ExitStack() as stack:
            for alias in connections:
                stack.enter_context(patch.object(connections[alias], "cursor", return_value=EmptyCursor()))

            for route, name in api_routes():
                path = concrete_path(route)
                with self.subTest(endpoint=name, path=path):
                    response = self.client.generic("TRACE", path)
                    if response.status_code >= 500:
                        failures.append((name, path, response.status_code))

        self.assertEqual(failures, [], f"Endpoint smoke-check failures: {failures}")

    def test_every_api_application_has_endpoint_coverage(self):
        counts = Counter(
            next(prefix for prefix in API_PREFIXES if route.startswith(prefix))
            for route, _name in api_routes()
        )

        self.assertEqual(counts, Counter(EXPECTED_ENDPOINT_COUNTS))
        for prefix, expected_count in EXPECTED_ENDPOINT_COUNTS.items():
            with self.subTest(application=prefix):
                self.assertEqual(counts[prefix], expected_count)


class ApiGetBatchTests(SimpleTestCase):
    @patch("config.batch.resolve")
    def test_combines_safe_get_requests_and_preserves_responses(self, resolve_route):
        def fake_view(request, item_id=None):
            return JsonResponse({"path": request.path, "itemId": item_id})

        resolve_route.side_effect = lambda path: SimpleNamespace(
            func=fake_view,
            args=(),
            kwargs={"item_id": "7"} if path.endswith("/7/") else {},
        )
        request = RequestFactory().post(
            "/api/batch/",
            data=json.dumps({
                "requests": [
                    {"id": "a", "url": "/coach_api/coach/caseload?summary=1"},
                    {"id": "b", "url": "/learner_api/learners/7/"},
                ]
            }),
            content_type="application/json",
        )

        response = api_get_batch(request)
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(payload["responses"]), 2)
        first_body = json.loads(base64.b64decode(payload["responses"][0]["body"]))
        second_body = json.loads(base64.b64decode(payload["responses"][1]["body"]))
        self.assertEqual(first_body["path"], "/coach_api/coach/caseload")
        self.assertEqual(second_body["itemId"], "7")

    def test_rejects_external_and_non_api_paths(self):
        request = RequestFactory().post(
            "/api/batch/",
            data=json.dumps({
                "requests": [
                    {"id": "external", "url": "https://example.com/learner_api/learners/"},
                    {"id": "admin", "url": "/admin/"},
                    {"id": "recursive", "url": "/coach_api/_batch/"},
                ]
            }),
            content_type="application/json",
        )

        response = api_get_batch(request)
        payload = json.loads(response.content)

        self.assertEqual([item["status"] for item in payload["responses"]], [400, 400, 400])

    @patch("config.batch.resolve")
    def test_executes_child_gets_in_parallel_workers(self, resolve_route):
        barrier = threading.Barrier(2)
        worker_ids = set()

        def synchronized_view(_request):
            worker_ids.add(threading.get_ident())
            barrier.wait(timeout=1)
            return JsonResponse({"ok": True})

        resolve_route.return_value = SimpleNamespace(func=synchronized_view, args=(), kwargs={})
        request = RequestFactory().post(
            "/api/batch/",
            data=json.dumps({
                "requests": [
                    {"id": "a", "url": "/coach_api/coach/caseload"},
                    {"id": "b", "url": "/learner_api/learners/"},
                ]
            }),
            content_type="application/json",
        )

        response = api_get_batch(request)
        payload = json.loads(response.content)

        self.assertEqual([item["status"] for item in payload["responses"]], [200, 200])
        self.assertEqual(len(worker_ids), 2)
