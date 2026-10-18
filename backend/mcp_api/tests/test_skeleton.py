"""Step 1: the MCP skeleton is invisible while switched off, and exempt from the gate.

Nothing here reaches the database: every request is anonymous (no
``kbc_session`` cookie, so session resolution short-circuits) and the views read
no rows. Hence ``SimpleTestCase``, as in ``login.tests_api_gate``.
"""
from unittest import mock

from django.test import Client, SimpleTestCase

from login.api_gate import STAFF, rule_for

WELL_KNOWN_URLS = (
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-authorization-server",
)


class McpFlagTestCase(SimpleTestCase):
    """Pins ``MCP_ENABLED`` and the API gate per test; both restored afterwards."""

    mcp_enabled = "0"

    def setUp(self):
        # The gate is forced on so a pass proves the exemption, not a test-run
        # default that happens to switch the gate off.
        self.enterContext(mock.patch.dict(
            "os.environ",
            {
                "MCP_ENABLED": self.mcp_enabled,
                "MCP_PUBLIC_BASE_URL": "https://lms.example.com/",
                "API_REQUIRE_AUTH": "1",
            },
            clear=False,
        ))
        self.client = Client()


class FlagOffTests(McpFlagTestCase):
    def test_mcp_endpoint_is_not_found(self):
        for method in ("get", "post", "delete"):
            with self.subTest(method=method):
                self.assertEqual(getattr(self.client, method)("/mcp/").status_code, 404)

    def test_oauth_paths_are_not_found(self):
        self.assertEqual(self.client.get("/oauth/anything").status_code, 404)
        self.assertEqual(self.client.post("/oauth/token").status_code, 404)

    def test_well_known_metadata_is_not_found(self):
        for url in WELL_KNOWN_URLS:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)


class FlagOnTests(McpFlagTestCase):
    mcp_enabled = "1"

    def test_mcp_endpoint_demands_a_bearer_token(self):
        for method in ("get", "post", "delete"):
            with self.subTest(method=method):
                response = getattr(self.client, method)("/mcp/")
                self.assertEqual(response.status_code, 401)
                self.assertEqual(
                    response["WWW-Authenticate"],
                    'Bearer resource_metadata="https://lms.example.com'
                    '/.well-known/oauth-protected-resource"',
                )

    def test_mcp_endpoint_post_needs_no_csrf_token(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post("/mcp/").status_code, 401)

    def test_well_known_metadata_is_a_placeholder(self):
        for url in WELL_KNOWN_URLS:
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 501)
                self.assertEqual(response.json()["code"], "not_implemented")


class GateExemptionTests(SimpleTestCase):
    def test_mcp_paths_are_not_gated(self):
        for path in (
            "/mcp/",
            "/oauth/token",
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-authorization-server",
        ):
            with self.subTest(path=path):
                self.assertIsNone(rule_for(path))

    def test_curriculum_api_rule_is_unchanged(self):
        self.assertEqual(rule_for("/curriculum_api/anything"), ("/curriculum_api/", STAFF))
