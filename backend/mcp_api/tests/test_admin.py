"""Step 11.2 super-admin MCP connection controls: gating, validation and revocation scope."""
import json
import uuid
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from login import permissions
from mcp_api import admin_views

FAMILY = uuid.UUID("11111111-1111-1111-1111-111111111111")


class AdminControlTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(pk=1, role="admin")
        self.accesses = frozenset({"super-admin"})
        self.enterContext(mock.patch.object(permissions, "authenticate_request", side_effect=lambda r: self.account))
        self.enterContext(mock.patch.object(permissions, "_accesses_of", side_effect=lambda a: self.accesses))
        self.revoke = self.enterContext(mock.patch.object(admin_views, "revoke_family", return_value=2))
        self.enterContext(mock.patch.object(admin_views, "event"))
        self.enterContext(mock.patch.object(admin_views.transaction, "atomic", mock.MagicMock()))
        self.tokens = self.enterContext(mock.patch.object(admin_views, "McpOAuthToken"))
        live = self.tokens.objects.filter.return_value
        # values_list(...) is iterated for account ids, or .distinct()-ed for family ids.
        live.filter.return_value.values_list.return_value = mock.MagicMock(
            distinct=mock.Mock(return_value=[FAMILY, uuid.uuid4()]), __iter__=lambda s: iter([1]))

    def post(self, view, body, *args):
        request = self.factory.post("/oauth/admin/revoke", data=json.dumps(body), content_type="application/json")
        request._dont_enforce_csrf_checks = True
        return view(request, *args)

    def test_only_super_admins_get_in(self):
        for role, accesses, status in (("staff", frozenset({"curriculum"}), 403), ("learner", frozenset(), 403)):
            with self.subTest(role=role):
                self.account, self.accesses = SimpleNamespace(pk=2, role=role), accesses
                self.assertEqual(self.post(admin_views.admin_revoke, {"account_id": 5}).status_code, status)
        self.account = None
        self.assertEqual(self.post(admin_views.admin_revoke, {"account_id": 5}).status_code, 401)
        self.revoke.assert_not_called()

    def test_revoke_all_connections_of_an_account(self):
        response = self.post(admin_views.admin_revoke, {"account_id": 5})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.revoke.call_count, 2)
        for call in self.revoke.call_args_list:
            self.assertEqual(call.args[1], "revoked_by_admin")
        self.assertEqual(json.loads(response.content)["revoked_connections"], 2)

    def test_revoke_one_connection(self):
        response = self.post(admin_views.admin_revoke, {"family_id": str(FAMILY)})
        self.assertEqual(response.status_code, 200, response.content)
        self.revoke.assert_called_once_with(FAMILY, "revoked_by_admin")

    def test_bad_requests_change_nothing(self):
        for body in ({}, {"account_id": 5, "family_id": str(FAMILY)}, {"account_id": "5"}, {"family_id": "nope"}):
            with self.subTest(body=body):
                self.assertEqual(self.post(admin_views.admin_revoke, body).status_code, 400)
        self.revoke.assert_not_called()

    def test_reads_need_get_and_writes_need_post(self):
        request = self.factory.get("/oauth/admin/revoke")
        self.assertEqual(admin_views.admin_revoke(request).status_code, 405)
        request = self.factory.post("/oauth/admin/tokens")
        self.assertEqual(admin_views.admin_tokens(request).status_code, 405)

    def test_disable_unknown_client_is_404(self):
        with mock.patch.object(admin_views, "McpOAuthClient") as clients:
            clients.objects.filter.return_value.first.return_value = None
            self.assertEqual(self.post(admin_views.admin_disable_client, {}, "mcp_x").status_code, 404)
