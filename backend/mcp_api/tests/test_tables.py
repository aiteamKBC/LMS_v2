"""Step 2: MCP tables -- crypto, model<->DDL agreement, routing, selfcheck guard, cleanup.

DB-free (``SimpleTestCase``): the DB-backed suites cannot start (docs/mcp/README.md),
so the real-database round trip is ``manage.py mcp_selfcheck`` on the test branch.
"""
import re
import string
from datetime import timedelta
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import models
from django.test import SimpleTestCase
from django.utils import timezone

from learner_api.routers import ENROLMENT_DB
from mcp_api import crypto
from mcp_api.management.commands import mcp_cleanup, mcp_selfcheck
from mcp_api.models import McpOAuthClient, McpOAuthCode, McpOAuthToken, McpPendingChange

CREATE_SQL = Path(settings.BASE_DIR) / "sql" / "2026-10-18_mcp_oauth" / "01_create.sql"
MODELS = (McpOAuthClient, McpOAuthCode, McpOAuthToken, McpPendingChange)


def sql_tables():
    """{table name: set of column names} parsed from 01_create.sql."""
    sql = CREATE_SQL.read_text(encoding="utf-8")
    tables = {}
    for name, body in re.findall(r'CREATE TABLE login\."(\w+)" \((.*?)\n\);', sql, re.S):
        # Column definitions are the 4-space-indented lines; constraints and
        # continuation lines are indented further or start with CHECK.
        tables[name] = {
            quoted or bare
            for quoted, bare in re.findall(r'^ {4}(?:"(\w+)"|(id))\s', body, re.M)
        }
    return tables


class CryptoTests(SimpleTestCase):
    def test_hash_is_deterministic_sha256_hex(self):
        digest = crypto.hash_token("abc")
        self.assertEqual(digest, crypto.hash_token("abc"))
        self.assertEqual(
            digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
        self.assertEqual(len(digest), 64)
        self.assertTrue(set(digest) <= set(string.hexdigits.lower()))
        self.assertNotEqual(digest, crypto.hash_token("abd"))

    def test_new_token_is_long_urlsafe_and_unique(self):
        tokens = {crypto.new_token() for _ in range(200)}
        self.assertEqual(len(tokens), 200)
        for token in tokens:
            self.assertEqual(len(token), 64)  # 48 bytes, base64url, no padding
            self.assertRegex(token, r"^[A-Za-z0-9_-]+$")


class ModelSchemaTests(SimpleTestCase):
    def test_sql_defines_exactly_the_four_tables(self):
        self.assertEqual(
            set(sql_tables()),
            {"Mcp_oauth_clients", "Mcp_oauth_codes", "Mcp_oauth_tokens", "Mcp_pending_changes"},
        )

    def test_models_are_unmanaged_and_match_the_sql_columns(self):
        tables = sql_tables()
        for model in MODELS:
            with self.subTest(model=model.__name__):
                self.assertIs(model._meta.managed, False)
                schema, table = model._meta.db_table.split('"."')
                self.assertEqual(schema, "login")
                self.assertEqual(
                    {f.column for f in model._meta.concrete_fields}, tables[table]
                )

    def test_hash_columns_hold_a_sha256_hex_digest(self):
        for model, field in (
            (McpOAuthCode, "code_hash"),
            (McpOAuthToken, "access_hash"),
            (McpOAuthToken, "refresh_hash"),
            (McpPendingChange, "payload_hash"),
        ):
            with self.subTest(field=f"{model.__name__}.{field}"):
                self.assertEqual(model._meta.get_field(field).max_length, 64)

    def test_no_reverse_accessor_is_added_to_login_account(self):
        from login.models import LoginAccount

        names = {rel.name for rel in LoginAccount._meta.related_objects}
        self.assertFalse({n for n in names if n.startswith("mcp")})


class EnrolmentRoutingTests(SimpleTestCase):
    """mcp_api is not in the router's app labels, so the models pin the alias."""

    def test_querysets_target_the_enrolment_alias(self):
        for model in MODELS:
            with self.subTest(model=model.__name__):
                self.assertEqual(model.objects.all().db, ENROLMENT_DB)

    def test_save_and_delete_target_the_enrolment_alias(self):
        row = McpOAuthClient(client_id="c", client_name="n")
        with mock.patch.object(models.Model, "save") as save:
            row.save()
        self.assertEqual(save.call_args.kwargs["using"], ENROLMENT_DB)
        with mock.patch.object(models.Model, "delete") as delete:
            row.delete()
        self.assertEqual(delete.call_args.kwargs["using"], ENROLMENT_DB)

    def test_an_explicit_alias_still_wins(self):
        row = McpOAuthClient(client_id="c", client_name="n")
        with mock.patch.object(models.Model, "save") as save:
            row.save(using="default")
        self.assertEqual(save.call_args.kwargs["using"], "default")


BRANCH_URL = "postgresql://u@ep-test-branch-pooler.eu-west-2.aws.neon.tech/db"
GOOD_ENV = {
    "USE_SECURITY_TEST_BRANCH": "1",
    "SECURITY_TEST_BRANCH_ID": "br-test",
    "security_Database_url": BRANCH_URL,
}


def fake_settings(run_app=True, host="ep-test-branch.eu-west-2.aws.neon.tech"):
    return SimpleNamespace(
        RUN_APP_ON_TEST_BRANCH=run_app,
        USE_SECURITY_TEST_BRANCH=False,
        DATABASES={ENROLMENT_DB: {"HOST": host}},
    )


class SelfcheckGuardTests(SimpleTestCase):
    """Every refusal happens before the database is touched."""

    def guard(self, environ, settings_=None, branch_id="br-test"):
        branch_id_of = mock.Mock(return_value=branch_id)
        with mock.patch.object(mcp_selfcheck, "settings", settings_ or fake_settings()):
            try:
                return mcp_selfcheck.assert_test_branch(environ, branch_id_of), branch_id_of
            except CommandError as exc:
                exc.branch_id_of = branch_id_of
                raise

    def assertRefused(self, message, environ, settings_=None, branch_id="br-test", queried=False):
        with self.assertRaisesRegex(CommandError, message) as caught:
            self.guard(environ, settings_, branch_id)
        self.assertEqual(caught.exception.branch_id_of.called, queried)

    def test_passes_on_the_test_branch(self):
        branch_id, branch_id_of = self.guard(GOOD_ENV)
        self.assertEqual(branch_id, "br-test")
        branch_id_of.assert_called_once_with(ENROLMENT_DB)

    def test_refuses_without_the_opt_in(self):
        env = {**GOOD_ENV, "USE_SECURITY_TEST_BRANCH": ""}
        self.assertRefused("USE_SECURITY_TEST_BRANCH", env)

    def test_refuses_when_settings_did_not_build_the_branch(self):
        self.assertRefused("RUN_APP_ON_TEST_BRANCH", GOOD_ENV, fake_settings(run_app=False))

    def test_refuses_without_an_expected_branch_id(self):
        env = {**GOOD_ENV, "SECURITY_TEST_BRANCH_ID": " "}
        self.assertRefused("SECURITY_TEST_BRANCH_ID", env)

    def test_refuses_without_a_branch_url(self):
        env = {k: v for k, v in GOOD_ENV.items() if k != "security_Database_url"}
        self.assertRefused("security_Database_url", env)

    def test_refuses_when_enrolment_is_another_host(self):
        self.assertRefused(
            "not the test branch host", GOOD_ENV, fake_settings(host="ep-production.neon.tech")
        )

    def test_refuses_when_connected_to_another_branch(self):
        self.assertRefused("expected 'br-test'", GOOD_ENV, branch_id="br-production", queried=True)


class CleanupTests(SimpleTestCase):
    def test_retention_windows(self):
        self.assertEqual(mcp_cleanup.CODE_RETENTION, timedelta(days=1))
        self.assertEqual(mcp_cleanup.TOKEN_RETENTION, timedelta(days=90))
        self.assertEqual(mcp_cleanup.PENDING_CHANGE_RETENTION, timedelta(days=30))

    def test_querysets_target_the_enrolment_alias(self):
        now = timezone.now()
        for _table, stale in mcp_cleanup.STALE:
            with self.subTest(stale=stale.__name__):
                self.assertEqual(stale(now).db, ENROLMENT_DB)

    def run_cleanup(self, *args):
        querysets = [mock.Mock(**{"count.return_value": 2, "delete.return_value": (2, {})})
                     for _ in mcp_cleanup.STALE]
        stale = tuple((table, mock.Mock(return_value=qs))
                      for (table, _), qs in zip(mcp_cleanup.STALE, querysets))
        out = StringIO()
        with mock.patch.object(mcp_cleanup, "STALE", stale):
            call_command("mcp_cleanup", *args, stdout=out)
        return querysets, out.getvalue()

    def test_dry_run_counts_and_deletes_nothing(self):
        querysets, out = self.run_cleanup("--dry-run")
        for qs in querysets:
            qs.delete.assert_not_called()
        self.assertIn("Dry run", out)

    def test_run_deletes_each_table(self):
        querysets, out = self.run_cleanup()
        for qs in querysets:
            qs.delete.assert_called_once_with()
        self.assertIn("Mcp_oauth_tokens: 2 deleted", out)
