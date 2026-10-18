"""Step 4: the /mcp/ endpoint, per-call context, dispatcher, registry, limits, PII guard.

DB-free: tokens are minted through the real OAuth views on the in-memory store
from ``test_oauth``. The real-database run is ``mcp_selfcheck --mode transport``.
"""
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from curriculum_api import versioning
from mcp_api import dispatch, pii, protocol, ratelimit, views
from mcp_api import schema as json_schema
from mcp_api.tests.test_oauth import BASE, FakeManager, OAuthTestCase
from mcp_api.tools import REGISTRY, ToolError, ToolResult, tool, unregister


def rpc(method, params=None, id_=1):
    message = {"jsonrpc": "2.0", "method": method}
    if id_ is not None:
        message["id"] = id_
    if params is not None:
        message["params"] = params
    return message


class TransportTestCase(OAuthTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.object(views, "McpOAuthToken", SimpleNamespace(objects=FakeManager(self.store.tokens))))
        self.client_id, self.body = self.tokens()
        self.access = self.body["access_token"]
        self.seen = {}

        @tool("test_whoami", "Who am I (test only).", {"type": "object", "properties": {
            "note": {"type": "string", "maxLength": 20},
        }, "additionalProperties": False})
        def whoami(request, arguments):
            self.seen.update(actor=versioning.current_actor(), source=versioning.current_source(),
                             account=request.login_account)
            return ToolResult("You are signed in.", {"ok": True})

        self.addCleanup(unregister, "test_whoami")

    def post(self, message, token=None, path="/mcp/", **headers):
        token = self.access if token is None else token
        if token:
            headers["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        return self.client.post(path, json.dumps(message) if not isinstance(message, str) else message,
                                content_type="application/json", **headers)

    def call(self, name, arguments=None):
        response = self.post(rpc("tools/call", {"name": name, "arguments": arguments or {}}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]


class ProtocolTests(TransportTestCase):
    def test_initialize(self):
        result = self.post(rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                              "clientInfo": {"name": "t", "version": "1"}})).json()["result"]
        self.assertEqual(result["protocolVersion"], "2025-06-18")
        self.assertEqual(result["serverInfo"]["name"], "kbc-lms")
        self.assertEqual(result["capabilities"], {"tools": {"listChanged": False}})
        self.assertEqual(result["instructions"], protocol.INSTRUCTIONS)

    def test_unknown_protocol_version_gets_the_latest(self):
        result = self.post(rpc("initialize", {"protocolVersion": "1999-01-01"})).json()["result"]
        self.assertEqual(result["protocolVersion"], protocol.SUPPORTED_PROTOCOL_VERSIONS[0])

    def test_instructions_cover_4_8(self):
        text = protocol.INSTRUCTIONS
        for phrase in ("programme > cohort > group", "programme > module > week > component",
                       "look items up first", "ask the user", "preview", "apply_change",
                       "list_standard_ksbs", "Markdown"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_initialized_notification_is_202_without_body(self):
        response = self.post(rpc("notifications/initialized", id_=None))
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.content, b"")

    def test_ping_and_tools_list(self):
        self.assertEqual(self.post(rpc("ping")).json()["result"], {})
        tools = self.post(rpc("tools/list")).json()["result"]["tools"]
        self.assertEqual([t["name"] for t in tools], ["test_whoami"])
        self.assertEqual(tools[0]["annotations"],
                         {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True})
        self.assertIn("inputSchema", tools[0])

    def test_no_tools_registered_outside_tests(self):
        self.assertEqual(set(REGISTRY), {"test_whoami"})

    def test_invalid_json_unknown_method_and_batch(self):
        bad = self.post("{not json")
        self.assertEqual((bad.status_code, bad.json()["error"]["code"]), (400, protocol.PARSE_ERROR))
        unknown = self.post(rpc("resources/list")).json()
        self.assertEqual(unknown["error"]["code"], protocol.METHOD_NOT_FOUND)
        batch = self.post([rpc("ping"), rpc("ping", id_=2)])
        self.assertEqual((batch.status_code, batch.json()["error"]["code"]), (400, protocol.INVALID_REQUEST))
        not_rpc = self.post({"method": "ping", "id": 1})
        self.assertEqual(not_rpc.json()["error"]["code"], protocol.INVALID_REQUEST)

    def test_unknown_tool(self):
        response = self.post(rpc("tools/call", {"name": "nope"})).json()
        self.assertEqual(response["error"]["code"], protocol.INVALID_PARAMS)

    def test_unsupported_protocol_header(self):
        response = self.post(rpc("ping"), HTTP_MCP_PROTOCOL_VERSION="1999-01-01")
        self.assertEqual(response.status_code, 400)

    def test_route_without_slash(self):
        self.assertEqual(self.post(rpc("ping"), path="/mcp").json()["result"], {})


class AuthTests(TransportTestCase):
    def assertChallenged(self, response):
        self.assertEqual(response.status_code, 401)
        self.assertIn('resource_metadata="https://lms.example.com/.well-known/oauth-protected-resource"',
                      response["WWW-Authenticate"])

    def test_401_variants(self):
        self.assertChallenged(self.post(rpc("ping"), token=""))
        self.assertChallenged(self.post(rpc("ping"), token="not-a-real-token"))
        self.store.tokens[0].expires_at = timezone.now() - timedelta(seconds=1)
        self.assertChallenged(self.post(rpc("ping")))

    def test_revoked_token(self):
        self.client.post("/oauth/revoke", {"token": self.access})
        self.assertChallenged(self.post(rpc("ping")))

    def test_origin_check(self):
        self.assertEqual(self.post(rpc("ping"), HTTP_ORIGIN="https://evil.example").status_code, 403)
        self.assertEqual(self.post(rpc("ping"), HTTP_ORIGIN=BASE).status_code, 200)
        with mock.patch.dict("os.environ", {"MCP_ALLOWED_ORIGINS": "http://localhost:6274"}):
            self.assertEqual(self.post(rpc("ping"), HTTP_ORIGIN="http://localhost:6274").status_code, 200)

    def test_last_used_is_recorded(self):
        self.post(rpc("ping"))
        self.assertIsNotNone(self.store.tokens[0].last_used_at)


class ContextTests(TransportTestCase):
    def test_actor_and_source_set_during_the_call(self):
        result = self.call("test_whoami")
        self.assertNotIn("isError", result)
        self.assertEqual(result["structuredContent"], {"ok": True})
        self.assertEqual(self.seen["actor"]["email"], self.staff.email)
        self.assertEqual(self.seen["source"], "mcp:Claude")
        self.assertIs(self.seen["account"], self.staff)

    def direct(self, tool_name):
        """Call the view with no middleware, so only our own finally can clear the context."""
        request = RequestFactory().post(
            "/mcp/", json.dumps(rpc("tools/call", {"name": tool_name})), content_type="application/json",
            HTTP_AUTHORIZATION=f"Bearer {self.access}",
        )
        versioning.set_actor(None)
        versioning.set_source("")
        response = views.mcp_endpoint(request)
        return request, response

    def test_context_is_cleared_after_the_call(self):
        request, response = self.direct("test_whoami")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.seen["actor"]["email"], self.staff.email)
        self.assertEqual(versioning.current_actor(), versioning.NO_ACTOR)
        self.assertEqual(versioning.current_source(), "")
        self.assertIsNone(request.login_account)

    def test_context_is_cleared_when_the_tool_crashes(self):
        @tool("test_crash", "Crashes.", {"type": "object"})
        def crash(request, arguments):
            raise RuntimeError("secret internals")
        self.addCleanup(unregister, "test_crash")

        with self.assertLogs("mcp_api", level="ERROR"):
            request, response = self.direct("test_crash")
        result = json.loads(response.content)["result"]
        self.assertTrue(result["isError"])
        self.assertEqual(result["content"][0]["text"], protocol.GENERIC_FAILURE)
        self.assertNotIn("secret internals", response.content.decode())
        self.assertEqual(versioning.current_actor(), versioning.NO_ACTOR)
        self.assertEqual(versioning.current_source(), "")

    def test_context_is_cleared_when_dispatch_itself_raises(self):
        with mock.patch.object(protocol, "handle", side_effect=RuntimeError("boom")), \
                self.assertLogs("mcp_api", level="ERROR"):
            request, response = self.direct("test_whoami")
        self.assertEqual(json.loads(response.content)["error"]["code"], protocol.INTERNAL_ERROR)
        self.assertEqual(versioning.current_actor(), versioning.NO_ACTOR)

    def test_source_label_is_sanitised_and_capped(self):
        from mcp_api.context import source_label
        self.assertEqual(source_label("Claude <script>"), "mcp:Claude script")
        self.assertEqual(len(source_label("x" * 100)), 32)


class ToolResultTests(TransportTestCase):
    def test_input_validated_before_the_handler(self):
        result = self.call("test_whoami", {"note": "x" * 30})
        self.assertTrue(result["isError"])
        self.assertIn("'note' must be at most 20 characters", result["content"][0]["text"])
        self.assertEqual(self.seen, {})
        result = self.call("test_whoami", {"surprise": 1})
        self.assertIn("'surprise' is not a recognised input", result["content"][0]["text"])

    def test_tool_and_dispatch_errors_are_plain_text(self):
        @tool("test_refuses", "Refuses.", {"type": "object"})
        def refuses(request, arguments):
            raise ToolError("That module is archived. Pick another module.")
        self.addCleanup(unregister, "test_refuses")
        result = self.call("test_refuses")
        self.assertEqual(result["content"][0]["text"], "That module is archived. Pick another module.")
        self.assertTrue(result["isError"])

    def test_rate_limit_trips_at_n_plus_1(self):
        with mock.patch.dict(ratelimit.BUCKETS, {"calls": (2, 60, "tool calls", "a minute")}):
            results = [self.call("test_whoami") for _ in range(3)]
        self.assertNotIn("isError", results[0])
        self.assertNotIn("isError", results[1])
        self.assertTrue(results[2]["isError"])
        self.assertIn("You've hit the limit of 2 tool calls", results[2]["content"][0]["text"])

    def test_tool_specific_bucket(self):
        @tool("test_search", "Searches.", {"type": "object"}, rate_bucket="book_searches")
        def search(request, arguments):
            return ToolResult("ok", {})
        self.addCleanup(unregister, "test_search")
        with mock.patch.dict(ratelimit.BUCKETS, {"book_searches": (1, 60, "book searches", "a minute")}):
            self.assertNotIn("isError", self.call("test_search"))
            self.assertIn("book searches", self.call("test_search")["content"][0]["text"])

    def test_pii_in_a_result_is_refused_in_strict_mode_and_stripped_otherwise(self):
        @tool("test_leaky", "Leaks.", {"type": "object"})
        def leaky(request, arguments):
            return ToolResult("ok", {"items": [{"name": "Group A", "coach": {"contactEmail": "c@x.test"}}]})
        self.addCleanup(unregister, "test_leaky")
        with mock.patch.object(pii, "strict", return_value=True), self.assertLogs("mcp_api", level="ERROR"):
            result = self.call("test_leaky")
        self.assertTrue(result["isError"])
        self.assertNotIn("c@x.test", json.dumps(result))
        with mock.patch.object(pii, "strict", return_value=False), self.assertLogs("mcp_api", level="WARNING"):
            result = self.call("test_leaky")
        self.assertEqual(result["structuredContent"], {"items": [{"name": "Group A", "coach": {}}]})

    def test_one_log_line_per_call_without_arguments(self):
        with self.assertLogs("mcp_api.calls", level="INFO") as logs:
            self.call("test_whoami", {"note": "TOPSECRETNOTE"})
            self.post(rpc("ping"))
        self.assertEqual(len(logs.records), 2)
        first = logs.records[0]
        self.assertEqual((first.event, first.action, first.outcome), ("mcp.call", "test_whoami", "ok"))
        self.assertEqual(first.account_id, str(self.staff.pk))
        self.assertIsInstance(first.duration_ms, int)
        for record in logs.records:
            dumped = json.dumps(record.__dict__, default=str)
            self.assertNotIn("TOPSECRETNOTE", dumped)
            self.assertNotIn(self.access, dumped)


class PiiTests(SimpleTestCase):
    def test_nested_keys_are_found(self):
        obj = {"a": [{"b": {"learner_email": "x"}}, {"Post Code": "y", "DOB": "z", "title": "ok"}]}
        self.assertEqual(sorted(pii.find_pii(obj)),
                         ["result.a[0].b.learner_email", "result.a[1].DOB", "result.a[1].Post Code"])
        with self.assertRaises(pii.PiiLeak):
            pii.assert_no_pii(obj)
        pii.assert_no_pii({"title": "Marketing", "nickname": "x", "description": "y"})

    def test_extra_keys_are_configurable(self):
        with mock.patch.dict("os.environ", {"MCP_PII_EXTRA_KEYS": "uln, aptem_id"}):
            self.assertEqual(pii.find_pii({"ULN": 1, "aptemId": 2}), ["result.ULN", "result.aptemId"])


class DispatchTests(SimpleTestCase):
    def setUp(self):
        self.request = SimpleNamespace(login_account=SimpleNamespace(pk=5, role="staff"))

    def test_not_allowlisted_is_refused(self):
        with self.assertRaisesRegex(dispatch.DispatchError, "not available"):
            dispatch.call_api(self.request, "GET", "/curriculum_api/curriculum/programmes/")

    def test_forbidden_keys_are_rejected_not_stripped(self):
        for payload in (
            {"removeMissing": True},
            {"weeks": [{"deletedComponentIds": [1]}]},
            {"module": {"hydrationComplete": True}},
            {"permanent": False},
            {"removeQuestionIds": []},
            {"quiz": {"status": "Published"}},
        ):
            with self.subTest(payload=payload):
                self.assertIsNotNone(dispatch.forbidden_key(payload))
                with mock.patch.object(dispatch, "ALLOWED_CALLS", (("POST", r"/quiz_api/x/"),)), \
                        self.assertRaisesRegex(dispatch.DispatchError, "may not publish, delete"):
                    dispatch.call_api(self.request, "POST", "/quiz_api/x/", json_body=payload)
        self.assertIsNone(dispatch.forbidden_key({"status": "draft", "title": "Removal of barriers"}))

    def test_refusal_for_is_honoured_and_the_view_never_runs(self):
        view = mock.Mock()
        with mock.patch.object(dispatch, "ALLOWED_CALLS", (("GET", r"/curriculum_api/x/"),)), \
                mock.patch.object(dispatch, "refusal_for", return_value=JsonResponse({}, status=403)) as refusal, \
                mock.patch.object(dispatch, "resolve", return_value=SimpleNamespace(func=view, args=(), kwargs={}, route="x")):
            with self.assertRaises(dispatch.DispatchError) as caught:
                dispatch.call_api(self.request, "GET", "/curriculum_api/x/")
        self.assertEqual(caught.exception.status, 403)
        self.assertIn("permission", str(caught.exception))
        refusal.assert_called_once_with("/curriculum_api/x/", self.request.login_account, method="GET")
        view.assert_not_called()

    def run_view(self, response, method="POST", body=None):
        seen = {}

        def view(sub, **kwargs):
            seen.update(sub=sub, kwargs=kwargs)
            return response

        match = SimpleNamespace(func=view, args=(), kwargs={"pk": "7"}, route="x/<pk>/")
        with mock.patch.object(dispatch, "ALLOWED_CALLS", ((method, r"/quiz_api/x/\d+/"),)), \
                mock.patch.object(dispatch, "refusal_for", return_value=None), \
                mock.patch.object(dispatch, "resolve", return_value=match):
            result = dispatch.call_api(self.request, method, "/quiz_api/x/7/", json_body=body)
        return result, seen

    def test_sub_request_runs_as_the_account(self):
        (status, data), seen = self.run_view(JsonResponse({"id": 7}), body={"title": "Quiz"})
        self.assertEqual((status, data), (200, {"id": 7}))
        sub = seen["sub"]
        self.assertIs(sub.login_account, self.request.login_account)
        self.assertTrue(sub._dont_enforce_csrf_checks)
        self.assertEqual(json.loads(sub.body), {"title": "Quiz"})
        self.assertEqual(seen["kwargs"], {"pk": "7"})

    def test_errors_map_to_plain_english(self):
        with self.assertRaisesRegex(dispatch.DispatchError, "doesn't exist"):
            self.run_view(JsonResponse({}, status=404))
        with self.assertRaisesRegex(dispatch.DispatchError, "did not accept that: Title is required"):
            self.run_view(JsonResponse({"error": "Title is required"}, status=400))
        with self.assertLogs("mcp_api", level="ERROR"), \
                self.assertRaisesRegex(dispatch.DispatchError, "Something went wrong"):
            self.run_view(JsonResponse({"trace": "internals"}, status=500))


class SchemaTests(SimpleTestCase):
    SCHEMA = {"type": "object", "required": ["title"], "additionalProperties": False, "properties": {
        "title": {"type": "string", "minLength": 1},
        "points": {"type": "integer", "minimum": 0},
        "kind": {"enum": ["single_choice", "true_false"]},
        "codes": {"type": "array", "items": {"type": "string"}, "maxItems": 2},
    }}

    def problem(self, value):
        return json_schema.validate(value, self.SCHEMA)

    def test_valid(self):
        self.assertIsNone(self.problem({"title": "T", "points": 1, "kind": "true_false", "codes": ["K1"]}))

    def test_problems(self):
        self.assertEqual(self.problem({}), "'title' is required.")
        self.assertEqual(self.problem({"title": "T", "points": True}), "'points' must be a whole number.")
        self.assertEqual(self.problem({"title": "T", "points": -1}), "'points' must be at least 0.")
        self.assertIn("must be one of", self.problem({"title": "T", "kind": "essay"}))
        self.assertEqual(self.problem({"title": "T", "codes": [1]}), "'codes[0]' must be text.")
        self.assertIn("at most 2", self.problem({"title": "T", "codes": ["a", "b", "c"]}))
        self.assertEqual(json_schema.validate([], self.SCHEMA), "The input must be an object.")

    def test_unsupported_keywords_are_refused_at_registration(self):
        with self.assertRaises(json_schema.SchemaError):
            json_schema.check_schema({"type": "object", "properties": {"x": {"type": "string", "pattern": "^a"}}})
        with self.assertRaises(json_schema.SchemaError):
            tool("bad", "x", {"type": "string"})

    def test_duplicate_tool_names_are_refused(self):
        @tool("test_dupe", "x", {"type": "object"})
        def first(request, arguments):
            return ToolResult("", {})
        self.addCleanup(unregister, "test_dupe")
        with self.assertRaises(ValueError):
            tool("test_dupe", "x", {"type": "object"})(first)
