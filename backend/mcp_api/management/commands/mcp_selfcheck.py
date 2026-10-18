"""Round-trip every MCP table on the Neon test branch -- never anywhere else.

The DB-backed test suites cannot start (see ``docs/mcp/README.md``), so this is the
real-database check for each MCP step. It inserts, reads, updates and deletes one
row per table, prints OK/FAIL per table, and rolls the whole run back, so it
leaves nothing behind even when a check fails half-way.

Branch-only guard
-----------------
``settings.USE_SECURITY_TEST_BRANCH`` is only ever true under ``manage.py test``;
for any other command the branch databases are built by
``settings.RUN_APP_ON_TEST_BRANCH`` (the ``runserver_test_branch.sh`` environment).
The command refuses, before writing anything, unless ALL of these hold:

1. ``USE_SECURITY_TEST_BRANCH=1`` is set -- the explicit opt-in;
2. settings actually built the branch databases (one of the two flags above);
3. the ``enrolment`` alias resolves to the host of ``security_Database_url``;
4. the server it is connected to reports ``neon.branch_id`` equal to
   ``SECURITY_TEST_BRANCH_ID``.

Check 4 is the decisive one: a production connection reports a different branch id
whatever the hosts or flags say. The exact invocation is in
``sql/2026-10-18_mcp_oauth/RUNBOOK.md``.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import timedelta
from urllib.parse import urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, connections, transaction
from django.utils import timezone

from learner_api.routers import ENROLMENT_DB
from login.models import LoginAccount
from mcp_api.crypto import hash_token, new_token
from mcp_api.models import McpOAuthClient, McpOAuthCode, McpOAuthToken, McpPendingChange

_TRUE_VALUES = {"1", "true", "yes", "on"}


def _normalised_host(host):
    # settings.py swaps the "-pooler." host for the direct endpoint in branch
    # mode; compare the two forms as the same compute.
    return (host or "").strip().lower().replace("-pooler.", ".")


def connected_branch_id(alias=ENROLMENT_DB):
    with connections[alias].cursor() as cursor:
        cursor.execute("select current_setting('neon.branch_id', true)")
        return cursor.fetchone()[0]


def assert_test_branch(environ=None, branch_id_of=connected_branch_id):
    """Return the verified Neon branch id, or raise CommandError naming the failed check."""
    environ = os.environ if environ is None else environ

    if environ.get("USE_SECURITY_TEST_BRANCH", "").strip().lower() not in _TRUE_VALUES:
        raise CommandError("Refusing: USE_SECURITY_TEST_BRANCH=1 is not set.")
    if not (
        getattr(settings, "RUN_APP_ON_TEST_BRANCH", False)
        or getattr(settings, "USE_SECURITY_TEST_BRANCH", False)
    ):
        raise CommandError(
            "Refusing: settings did not build the test-branch databases "
            "(RUN_APP_ON_TEST_BRANCH is not active). See the RUNBOOK for the invocation."
        )
    expected_id = environ.get("SECURITY_TEST_BRANCH_ID", "").strip()
    if not expected_id:
        raise CommandError("Refusing: SECURITY_TEST_BRANCH_ID is not set.")
    branch_host = _normalised_host(urlparse(environ.get("security_Database_url", "")).hostname)
    if not branch_host:
        raise CommandError("Refusing: security_Database_url is unset or has no host.")
    enrolment_host = _normalised_host((settings.DATABASES.get(ENROLMENT_DB) or {}).get("HOST"))
    if enrolment_host != branch_host:
        raise CommandError(
            f"Refusing: the {ENROLMENT_DB!r} database is not the test branch host."
        )
    actual_id = branch_id_of(ENROLMENT_DB)
    if actual_id != expected_id:
        raise CommandError(
            f"Refusing: connected to Neon branch {actual_id!r}, expected {expected_id!r}."
        )
    return actual_id


def _expect(condition, message):
    if not condition:
        raise AssertionError(message)


def check_clients(ctx):
    client_id = f"mcp-selfcheck-{uuid.uuid4().hex}"
    uris = ["https://claude.ai/api/mcp/auth_callback"]
    McpOAuthClient.objects.create(client_id=client_id, client_name="selfcheck", redirect_uris=uris)
    row = McpOAuthClient.objects.get(client_id=client_id)
    _expect(row.redirect_uris == uris, f"redirect_uris read back as {row.redirect_uris!r}")
    row.disabled_at = ctx["now"]
    row.save(update_fields=["disabled_at"])
    _expect(McpOAuthClient.objects.get(pk=row.pk).disabled_at is not None, "update not persisted")
    row.delete()
    _expect(not McpOAuthClient.objects.filter(client_id=client_id).exists(), "row not deleted")


def check_codes(ctx):
    code_hash = hash_token(new_token())
    McpOAuthCode.objects.create(
        code_hash=code_hash,
        client=ctx["client"],
        account_id=ctx["account_id"],
        code_challenge="selfcheck",
        redirect_uri=ctx["client"].redirect_uris[0],
        scope="mcp",
        expires_at=ctx["now"] + timedelta(minutes=5),
    )
    row = McpOAuthCode.objects.get(code_hash=code_hash)
    _expect(row.account_id == ctx["account_id"], "account_id mismatch")
    row.used_at = ctx["now"]
    row.save(update_fields=["used_at"])
    _expect(McpOAuthCode.objects.get(pk=row.pk).used_at is not None, "update not persisted")
    row.delete()
    _expect(not McpOAuthCode.objects.filter(code_hash=code_hash).exists(), "row not deleted")
    # The CHECK must refuse anything that is not a SHA-256 hex digest.
    try:
        with transaction.atomic(using=ENROLMENT_DB):
            McpOAuthCode.objects.create(
                code_hash="not-a-hash",
                client=ctx["client"],
                account_id=ctx["account_id"],
                code_challenge="selfcheck",
                redirect_uri="x",
                expires_at=ctx["now"],
            )
    except IntegrityError:
        pass
    else:
        raise AssertionError("a non-hash Code_hash was accepted")


def check_tokens(ctx):
    access_hash = hash_token(new_token())
    McpOAuthToken.objects.create(
        access_hash=access_hash,
        refresh_hash=hash_token(new_token()),
        family_id=uuid.uuid4(),
        client=ctx["client"],
        account_id=ctx["account_id"],
        scope="mcp",
        expires_at=ctx["now"] + timedelta(hours=1),
        refresh_expires_at=ctx["now"] + timedelta(days=30),
    )
    row = McpOAuthToken.objects.get(access_hash=access_hash)
    row.revoked_at = ctx["now"]
    row.revoked_reason = "selfcheck"
    row.save(update_fields=["revoked_at", "revoked_reason"])
    _expect(McpOAuthToken.objects.get(pk=row.pk).revoked_reason == "selfcheck", "update not persisted")
    row.delete()
    _expect(not McpOAuthToken.objects.filter(access_hash=access_hash).exists(), "row not deleted")


def check_pending_changes(ctx):
    payload = {"title": "selfcheck", "questions": [{"text": "Q1", "ksb_codes": ["K1"]}]}
    row = McpPendingChange.objects.create(
        account_id=ctx["account_id"],
        client=ctx["client"],
        tool="selfcheck",
        payload=payload,
        payload_hash=hash_token(json.dumps(payload, sort_keys=True)),
        preview={"summary": "selfcheck"},
        expires_at=ctx["now"] + timedelta(minutes=15),
    )
    read = McpPendingChange.objects.get(pk=row.pk)
    _expect(read.payload == payload, f"payload read back as {read.payload!r}")
    read.applied_at = ctx["now"]
    read.result = {"ok": True}
    read.save(update_fields=["applied_at", "result"])
    _expect(McpPendingChange.objects.get(pk=row.pk).result == {"ok": True}, "update not persisted")
    read.delete()
    _expect(not McpPendingChange.objects.filter(pk=row.pk).exists(), "row not deleted")


CHECKS = (
    ("Mcp_oauth_clients", check_clients),
    ("Mcp_oauth_codes", check_codes),
    ("Mcp_oauth_tokens", check_tokens),
    ("Mcp_pending_changes", check_pending_changes),
)


class Command(BaseCommand):
    help = "Insert/read/update/delete one row in each MCP table on the Neon test branch, then roll back."

    def handle(self, *args, **options):
        branch_id = assert_test_branch()
        self.stdout.write(f"mcp_selfcheck on Neon branch {branch_id}")

        failures = 0
        with transaction.atomic(using=ENROLMENT_DB):
            account_id = LoginAccount.objects.order_by("id").values_list("id", flat=True).first()
            if account_id is None:
                raise CommandError("No login account exists to attach test rows to.")
            ctx = {
                "now": timezone.now(),
                "account_id": account_id,
                "client": McpOAuthClient.objects.create(
                    client_id=f"mcp-selfcheck-{uuid.uuid4().hex}",
                    client_name="selfcheck fixture",
                    redirect_uris=["https://claude.ai/api/mcp/auth_callback"],
                ),
            }
            for table, check in CHECKS:
                try:
                    with transaction.atomic(using=ENROLMENT_DB):
                        check(ctx)
                except Exception as exc:  # report every table, not just the first failure
                    failures += 1
                    self.stdout.write(self.style.ERROR(f"  FAIL {table}: {type(exc).__name__}: {exc}"))
                else:
                    self.stdout.write(self.style.SUCCESS(f"  OK   {table}"))
            # Nothing this run wrote survives it, whatever happened above.
            transaction.set_rollback(True, using=ENROLMENT_DB)

        if failures:
            raise CommandError(f"mcp_selfcheck: {failures} table(s) failed.")
        self.stdout.write(self.style.SUCCESS("mcp_selfcheck: all OK"))
