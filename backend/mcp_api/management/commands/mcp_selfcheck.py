"""Round-trip every MCP table on the Neon test branch -- never anywhere else.

The DB-backed test suites cannot start (see ``docs/mcp/README.md``), so this is the
real-database check for each MCP step, and it rolls the whole run back, so it
leaves nothing behind even when a check fails half-way.

- ``--mode tables`` (default, Step 2): insert, read, update and delete one row per
  table; OK/FAIL per table.
- ``--mode oauth`` (Step 3): register -> code with PKCE -> exchange -> resolve_bearer
  -> refresh rotation -> refresh reuse (family revoked) -> code reuse -> revoke,
  as the first active staff account holding curriculum or super-admin access.
- ``--mode transport`` (Step 4): a real token through ``/mcp/`` with Django's test
  client -- initialize, tools/list, and a test-only tool that confirms the actor is
  the token's account with source ``mcp:*`` during the call and cleared after.
- ``--mode delete-clients --client-name NAME [--confirm]``: delete named test
  clients and their codes, tokens and pending changes. The only mode that commits;
  without ``--confirm`` it only lists what it would delete.

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
from types import SimpleNamespace
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


# --- oauth mode: the Step 3 flow end to end on real rows -------------------------
#
# Steps share one state dict and run in order; a failure skips the rest, since
# each depends on the one before. Plaintext codes and tokens live only in that
# dict for the run and are never printed.

def _curriculum_account():
    """The first active, unlocked staff account that may use MCP, or None."""
    from mcp_api.auth import has_mcp_access, rejection_reason

    now = timezone.now()
    for account in LoginAccount.objects.filter(subject_type="staff", is_active=True).order_by("id")[:200]:
        if has_mcp_access(account) and rejection_reason(account, now, now) is None:
            return account
    return None


def _bearer(access_token):
    from mcp_api.auth import resolve_bearer

    return resolve_bearer(SimpleNamespace(headers={"Authorization": f"Bearer {access_token}"}))


def _expect_invalid_grant(call):
    from mcp_api.oauth import OAuthError

    try:
        call()
    except OAuthError as error:
        _expect(error.error == "invalid_grant", f"expected invalid_grant, got {error.error}")
    else:
        raise AssertionError("expected invalid_grant, the call succeeded")


def oauth_register(state):
    from mcp_api import settings as mcp_settings
    from mcp_api.oauth import register_client

    host = "claude.ai" if "claude.ai" in mcp_settings.allowed_redirect_hosts() else sorted(mcp_settings.allowed_redirect_hosts())[0]
    state["redirect_uri"] = f"https://{host}/mcp-selfcheck/callback"
    state["client"] = register_client({"client_name": "mcp_selfcheck", "redirect_uris": [state["redirect_uri"]]})


def _consent(state):
    from mcp_api.oauth import create_code, pkce_s256

    verifier = new_token()
    code = create_code(state["client"], state["account"], {
        "code_challenge": pkce_s256(verifier),
        "redirect_uri": state["redirect_uri"],
        "scope": "lms.curriculum",
    })
    return code, verifier


def oauth_code_with_pkce(state):
    state["code"], state["verifier"] = _consent(state)
    row = McpOAuthCode.objects.get(code_hash=hash_token(state["code"]))
    _expect(row.used_at is None and row.account_id == state["account"].pk, "code row not as created")


def oauth_exchange(state):
    from mcp_api.oauth import exchange_code

    _expect_invalid_grant(lambda: exchange_code(state["client"], state["code"], state["redirect_uri"], "x" * 43))
    state["code"], state["verifier"] = _consent(state)  # the wrong verifier burned the first code
    state["first"] = exchange_code(state["client"], state["code"], state["redirect_uri"], state["verifier"])
    _expect(McpOAuthCode.objects.get(code_hash=hash_token(state["code"])).used_at is not None, "code not marked used")


def oauth_resolve_bearer(state):
    resolved = _bearer(state["first"]["access_token"])
    _expect(resolved is not None and resolved[0].pk == state["account"].pk, "access token did not resolve")


def oauth_refresh_rotation(state):
    from mcp_api.oauth import refresh

    state["second"] = refresh(state["client"], state["first"]["refresh_token"])
    _expect(_bearer(state["first"]["access_token"]) is None, "rotated access token still works")
    _expect(_bearer(state["second"]["access_token"]) is not None, "new access token does not resolve")


def oauth_refresh_reuse(state):
    from mcp_api.oauth import refresh

    _expect_invalid_grant(lambda: refresh(state["client"], state["first"]["refresh_token"]))
    _expect(_bearer(state["second"]["access_token"]) is None, "family not revoked on reuse")
    live = McpOAuthToken.objects.filter(client=state["client"], revoked_at__isnull=True).count()
    _expect(live == 0, f"{live} token(s) still live after reuse")


def oauth_code_reuse(state):
    from mcp_api.oauth import exchange_code

    code, verifier = _consent(state)
    body = exchange_code(state["client"], code, state["redirect_uri"], verifier)
    _expect_invalid_grant(lambda: exchange_code(state["client"], code, state["redirect_uri"], verifier))
    _expect(_bearer(body["access_token"]) is None, "tokens from a reused code still work")


def oauth_revoke(state):
    from mcp_api.oauth import exchange_code, revoke_token

    code, verifier = _consent(state)
    body = exchange_code(state["client"], code, state["redirect_uri"], verifier)
    revoke_token(body["refresh_token"], state["client"])
    _expect(_bearer(body["access_token"]) is None, "revoked token still works")


OAUTH_STEPS = (
    ("register client", oauth_register),
    ("create code with PKCE", oauth_code_with_pkce),
    ("exchange (wrong verifier refused, right one accepted)", oauth_exchange),
    ("resolve_bearer", oauth_resolve_bearer),
    ("refresh rotation", oauth_refresh_rotation),
    ("refresh reuse revokes the family", oauth_refresh_reuse),
    ("code reuse revokes its tokens", oauth_code_reuse),
    ("revoke", oauth_revoke),
)


# --- transport mode: a real token through /mcp/ via Django's test client ------------
#
# The test-only tool exists only while this command runs. It records what it saw
# in ``state`` and returns no email: the PII guard (strict on the branch) would
# rightly refuse a result carrying one.

SELFCHECK_TOOL = "selfcheck_whoami"


def _mcp_post(state, message):
    return state["http"].post(
        "/mcp/", json.dumps(message), content_type="application/json",
        HTTP_AUTHORIZATION=f"Bearer {state['tokens']['access_token']}",
    )


def transport_mint_token(state):
    from mcp_api.oauth import exchange_code

    oauth_register(state)
    code, verifier = _consent(state)
    state["tokens"] = exchange_code(state["client"], code, state["redirect_uri"], verifier)


def transport_initialize(state):
    response = _mcp_post(state, {"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                 "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                                            "clientInfo": {"name": "mcp_selfcheck", "version": "1"}}})
    _expect(response.status_code == 200, f"initialize returned HTTP {response.status_code}")
    result = response.json()["result"]
    _expect(result["serverInfo"]["name"] == "kbc-lms", "unexpected serverInfo")
    _expect(result["protocolVersion"] == "2025-06-18", "protocol version not negotiated")


def transport_tools_list(state):
    response = _mcp_post(state, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    names = [t["name"] for t in response.json()["result"]["tools"]]
    _expect(SELFCHECK_TOOL in names, f"tools/list returned {names}")


def transport_tools_call(state):
    from curriculum_api import versioning

    response = _mcp_post(state, {"jsonrpc": "2.0", "id": 3, "method": "tools/call",
                                 "params": {"name": SELFCHECK_TOOL, "arguments": {}}})
    result = response.json()["result"]
    _expect(not result.get("isError"), f"tool call failed: {result['content'][0]['text']}")
    seen = state["seen"]
    _expect(seen.get("actor", {}).get("email") == state["account"].email,
            "actor during the call is not the token's account")
    _expect(seen.get("source", "").startswith("mcp:"), f"source during the call was {seen.get('source')!r}")
    _expect(result["structuredContent"] == {"actor_matches": True, "source": seen["source"]},
            "unexpected tool result")
    _expect(versioning.current_actor() == versioning.NO_ACTOR, "actor still set after the call")
    _expect(not versioning.current_source().startswith("mcp:"), "mcp source still set after the call")


TRANSPORT_STEPS = (
    ("mint a real token (register, consent, exchange)", transport_mint_token),
    ("initialize", transport_initialize),
    ("tools/list shows the test tool", transport_tools_list),
    ("tools/call: actor = token account, source mcp:*, cleared after", transport_tools_call),
)


class Command(BaseCommand):
    help = (
        "On the Neon test branch only: round-trip each MCP table (--mode tables), run the "
        "OAuth flow (--mode oauth) or a real token through /mcp/ (--mode transport), then "
        "roll everything back. --mode delete-clients removes named test clients (committed)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--mode", choices=("tables", "oauth", "transport", "delete-clients"), default="tables")
        parser.add_argument("--client-name", action="append", default=[],
                            help="delete-clients: exact client_name to remove (repeatable).")
        parser.add_argument("--confirm", action="store_true", help="delete-clients: actually delete.")

    def handle(self, *args, **options):
        branch_id = assert_test_branch()
        mode = options["mode"]
        self.stdout.write(f"mcp_selfcheck --mode {mode} on Neon branch {branch_id}")
        if mode == "delete-clients":
            self._delete_clients(options["client_name"], options["confirm"])
            return

        run = {"tables": self._tables, "oauth": self._oauth, "transport": self._transport}[mode]
        with transaction.atomic(using=ENROLMENT_DB):
            failures = run()
            # Nothing this run wrote survives it, whatever happened above.
            transaction.set_rollback(True, using=ENROLMENT_DB)

        if failures:
            raise CommandError(f"mcp_selfcheck: {failures} check(s) failed.")
        self.stdout.write(self.style.SUCCESS("mcp_selfcheck: all OK"))

    def _report(self, name, check, ctx):
        try:
            with transaction.atomic(using=ENROLMENT_DB):
                check(ctx)
        except Exception as exc:  # noqa: BLE001 - report the failure, keep the rollback
            self.stdout.write(self.style.ERROR(f"  FAIL {name}: {type(exc).__name__}: {exc}"))
            return False
        self.stdout.write(self.style.SUCCESS(f"  OK   {name}"))
        return True

    def _tables(self):
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
        # Every table is reported, not just the first failure.
        return sum(not self._report(table, check, ctx) for table, check in CHECKS)

    def _steps(self, steps, state):
        for index, (name, step) in enumerate(steps):
            if not self._report(name, step, state):
                skipped = len(steps) - index - 1
                if skipped:
                    self.stdout.write(f"  SKIP {skipped} later step(s)")
                return 1 + skipped
        return 0

    def _account(self):
        account = _curriculum_account()
        if account is None:
            raise CommandError("No active staff account with curriculum or super-admin access on this branch.")
        self.stdout.write(f"  using login account {account.pk}")
        return account

    def _oauth(self):
        return self._steps(OAUTH_STEPS, {"account": self._account()})

    def _transport(self):
        from unittest import mock

        from django.test import Client

        from curriculum_api import versioning
        from mcp_api.tools import ToolResult, tool, unregister

        state = {"account": self._account(), "http": Client(HTTP_HOST="localhost"), "seen": {}}

        @tool(SELFCHECK_TOOL, "Self-check only: reports who the call runs as.", {"type": "object"})
        def whoami(request, arguments):
            state["seen"] = {"actor": versioning.current_actor(), "source": versioning.current_source()}
            matches = state["seen"]["actor"].get("email") == state["account"].email
            return ToolResult("Self-check tool ran.", {"actor_matches": matches, "source": state["seen"]["source"]})

        env = {"MCP_ENABLED": "1", "MCP_PUBLIC_BASE_URL": os.environ.get("MCP_PUBLIC_BASE_URL") or "http://localhost"}
        try:
            # LoginSessionMiddleware returns the connection after every response
            # (close_old_connections). Inside this run's rollback transaction that
            # would close it mid-transaction, so it is stood down for the run --
            # what Django's test client already does for request_finished.
            with mock.patch.dict(os.environ, env), mock.patch("login.middleware.close_old_connections"):
                return self._steps(TRANSPORT_STEPS, state)
        finally:
            unregister(SELFCHECK_TOOL)

    def _delete_clients(self, names, confirm):
        """Remove named test clients and everything that references them. Committed."""
        if not names:
            raise CommandError("Give at least one --client-name.")
        clients = list(McpOAuthClient.objects.filter(client_name__in=names).order_by("id"))
        if not clients:
            self.stdout.write("  no matching clients")
            return
        for client in clients:
            self.stdout.write(f"  client row {client.pk}: {client.client_name!r} created {client.created_at:%Y-%m-%d %H:%M}")
        if not confirm:
            self.stdout.write(self.style.WARNING("Dry run - add --confirm to delete these rows."))
            return
        with transaction.atomic(using=ENROLMENT_DB):
            counts = {
                model.__name__: model.objects.filter(client__in=clients).delete()[0]
                for model in (McpPendingChange, McpOAuthToken, McpOAuthCode)
            }
            counts["McpOAuthClient"] = McpOAuthClient.objects.filter(pk__in=[c.pk for c in clients]).delete()[0]
        self.stdout.write(self.style.SUCCESS(f"  deleted {counts}"))
