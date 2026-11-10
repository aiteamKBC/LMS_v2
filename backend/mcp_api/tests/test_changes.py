"""Step 5: preview -> apply, DB-free.

Real tokens come from the OAuth flow on the in-memory store (``test_oauth``);
``login."Mcp_pending_changes"`` is replaced by an in-memory manager below. The
write tool here is test-only and touches nothing but a Python dict. The
real-database run is ``mcp_selfcheck --mode changes``.
"""
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase
from django.utils import timezone

from mcp_api import changes, ratelimit
from mcp_api.changes import Validation, WriteTool, payload_hash, register_write_tool, unregister_write_tool
from mcp_api.tests.test_oauth import Row
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import ToolError


class PendingQuerySet:
    def __init__(self, rows):
        self._rows = list(rows)

    @staticmethod
    def _match(row, key, value):
        if key == "pk":
            key = "id"
        if key.endswith("__isnull"):
            return (getattr(row, key[:-8]) is None) == value
        if key.endswith("__gt"):
            return getattr(row, key[:-4]) > value
        return getattr(row, key) == value

    def filter(self, **lookups):
        return PendingQuerySet(r for r in self._rows if all(self._match(r, k, v) for k, v in lookups.items()))

    def select_for_update(self):
        return self

    def order_by(self, field):
        reverse = field.startswith("-")
        return PendingQuerySet(sorted(self._rows, key=lambda r: getattr(r, field.lstrip("-")), reverse=reverse))

    def __getitem__(self, item):
        return self._rows[item]

    def __iter__(self):
        return iter(self._rows)

    def first(self):
        return self._rows[0] if self._rows else None


class PendingManager:
    def __init__(self):
        self.rows = []

    def create(self, **values):
        row = Row(pk=values["id"], applied_at=None, cancelled_at=None, result=None,
                  created_at=timezone.now(), **values)
        self.rows.append(row)
        return row

    def select_for_update(self):
        return PendingQuerySet(self.rows)

    def filter(self, **lookups):
        return PendingQuerySet(self.rows).filter(**lookups)


class RenameTool(WriteTool):
    """Test-only: 'renames' something in a Python dict. Never touches the LMS."""

    name = "test_rename"
    description = "Test only."
    input_schema = {"type": "object", "properties": {
        "title": {"type": "string", "minLength": 1, "maxLength": 50},
    }, "required": ["title"], "additionalProperties": False}

    def __init__(self, world):
        self.world = world

    def validate(self, request, arguments):
        title = arguments["title"].strip()
        errors = ["The title can't be 'bad'."] if title == "bad" else []
        if self.world.get("locked"):
            errors.append("The module is locked.")
        warnings = ["Similar title exists."] if title == "dup" else []
        return Validation({"title": title + self.world.get("suffix", "")}, errors, warnings)

    def preview(self, request, payload):
        return {"summary": f"Rename the module to '{payload['title']}'.", "details": {"title": payload["title"]}}

    def apply(self, request, payload, progress):
        self.world.setdefault("applied", []).append(payload["title"])
        progress.done("Renamed the module")
        if self.world.get("fail_after_first"):
            raise ToolError("The LMS refused the second step.")
        if self.world.get("crash"):
            raise RuntimeError("boom")
        progress.done("Updated the week titles")
        return {"summary": f"Module renamed to '{payload['title']}'.", "result": {"title": payload["title"]},
                "links": ["https://lms.example.com/curriculum/modules/M1"]}


class ChangesTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.enterContext(mock.patch.object(changes.transaction, "atomic", mock.MagicMock()))
        self.world = {}
        register_write_tool(RenameTool(self.world))
        self.addCleanup(unregister_write_tool, "test_rename")

    def propose(self, title="New name", token=None):
        response = self.post(rpc("tools/call", {"name": "test_rename", "arguments": {"title": title}}), token=token)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def apply(self, preview_id, token=None, tool_name="apply_change"):
        response = self.post(rpc("tools/call", {"name": tool_name, "arguments": {"preview_id": preview_id}}),
                             token=token)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def text(self, result):
        return result["content"][0]["text"]

    def preview_id(self, title="New name"):
        return self.propose(title)["structuredContent"]["preview_id"]


class ProposeTests(ChangesTestCase):
    def test_write_tool_only_previews(self):
        result = self.propose()
        self.assertFalse(result.get("isError"), result)
        data = result["structuredContent"]
        self.assertFalse(data["saved"])
        self.assertEqual(data["expires_in_minutes"], 15)
        self.assertIn("Nothing has been saved yet", self.text(result))
        self.assertIn(data["preview_id"], self.text(result))
        self.assertNotIn("applied", self.world)  # nothing written
        row = self.pending.rows[0]
        self.assertEqual(row.tool, "test_rename")
        self.assertEqual(row.payload, {"title": "New name"})
        self.assertEqual(row.payload_hash, payload_hash({"title": "New name"}))
        self.assertEqual(row.account_id, self.staff.pk)

    def test_validation_errors_store_nothing(self):
        result = self.propose("bad")
        self.assertTrue(result["isError"])
        self.assertIn("can't be 'bad'", self.text(result))
        self.assertEqual(self.pending.rows, [])

    def test_warnings_are_shown(self):
        result = self.propose("dup")
        self.assertIn("Similar title exists.", self.text(result))
        self.assertEqual(result["structuredContent"]["warnings"], ["Similar title exists."])

    def test_write_tools_are_annotated_as_writes(self):
        tools = {t["name"]: t for t in self.post(rpc("tools/list")).json()["result"]["tools"]}
        self.assertFalse(tools["test_rename"]["annotations"]["readOnlyHint"])
        self.assertFalse(tools["apply_change"]["annotations"]["readOnlyHint"])


class ApplyTests(ChangesTestCase):
    def test_apply_writes_once_and_is_idempotent(self):
        pid = self.preview_id()
        first = self.apply(pid)
        self.assertFalse(first.get("isError"), first)
        self.assertIn("Done.", self.text(first))
        self.assertIn("https://lms.example.com/curriculum/modules/M1", self.text(first))
        self.assertEqual(self.world["applied"], ["New name"])
        self.assertEqual(first["structuredContent"]["completed_steps"],
                         [{"step": "Renamed the module"}, {"step": "Updated the week titles"}])
        second = self.apply(pid)
        self.assertFalse(second.get("isError"), second)
        self.assertTrue(second["structuredContent"]["already_applied"])
        self.assertEqual(self.world["applied"], ["New name"])  # no second write

    def test_other_account_gets_not_found(self):
        pid = self.preview_id()
        other = self.store.account(email="other@example.com")
        _client, body = self.tokens(other)
        result = self.apply(pid, token=body["access_token"])
        self.assertTrue(result["isError"])
        self.assertIn("couldn't find that preview", self.text(result))
        self.assertNotIn("applied", self.world)

    def test_unknown_or_malformed_id_is_not_found(self):
        for pid in (str(uuid.uuid4()), "not-a-uuid"):
            result = self.apply(pid)
            self.assertTrue(result["isError"])
            self.assertIn("couldn't find that preview", self.text(result))

    def test_expired_preview_is_refused(self):
        pid = self.preview_id()
        self.pending.rows[0].expires_at = timezone.now() - timedelta(seconds=1)
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        self.assertIn("expired", self.text(result))
        self.assertNotIn("applied", self.world)

    def test_cancel_then_apply_is_refused(self):
        pid = self.preview_id()
        cancelled = self.apply(pid, tool_name="cancel_change")
        self.assertFalse(cancelled.get("isError"), cancelled)
        self.assertIn("Nothing was saved", self.text(cancelled))
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        self.assertIn("cancelled", self.text(result))
        self.assertNotIn("applied", self.world)

    def test_cancel_after_apply_is_refused(self):
        pid = self.preview_id()
        self.apply(pid)
        result = self.apply(pid, tool_name="cancel_change")
        self.assertTrue(result["isError"])
        self.assertIn("already applied", self.text(result))

    def test_tampered_payload_is_refused_and_closed(self):
        pid = self.preview_id()
        self.pending.rows[0].payload = {"title": "Something else"}
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        self.assertIn("could not be verified", self.text(result))
        self.assertIsNotNone(self.pending.rows[0].cancelled_at)
        self.assertNotIn("applied", self.world)

    def test_revalidation_failure_is_refused_and_closed(self):
        pid = self.preview_id()
        self.world["locked"] = True
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        self.assertIn("The module is locked.", self.text(result))
        self.assertIsNotNone(self.pending.rows[0].cancelled_at)
        self.assertNotIn("applied", self.world)

    def test_payload_drift_since_preview_is_refused(self):
        pid = self.preview_id()
        self.world["suffix"] = " (2)"
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        self.assertIn("different from the preview", self.text(result))
        self.assertNotIn("applied", self.world)

    def test_partial_failure_reports_saved_steps_and_cannot_be_reapplied(self):
        pid = self.preview_id()
        self.world["fail_after_first"] = True
        result = self.apply(pid)
        self.assertTrue(result["isError"])
        text = self.text(result)
        self.assertIn("only partly finished", text)
        self.assertIn("Renamed the module", text)
        self.assertIn("Nothing was undone automatically", text)
        row = self.pending.rows[0]
        self.assertIsNotNone(row.applied_at)
        self.assertEqual(row.result["status"], "partial")
        again = self.apply(pid)
        self.assertTrue(again["isError"])
        self.assertIn("did not finish", self.text(again))
        self.assertEqual(self.world["applied"], ["New name"])  # not re-run

    def test_unexpected_crash_is_generic_and_recorded(self):
        pid = self.preview_id()
        self.world["crash"] = True
        with self.assertLogs("mcp_api", "ERROR"):
            result = self.apply(pid)
        text = self.text(result)
        self.assertIn("unexpected error", text)
        self.assertNotIn("boom", text)
        self.assertEqual(self.pending.rows[0].result["status"], "partial")

    def test_applies_count_against_the_write_limit(self):
        limits = {**ratelimit.BUCKETS, "write_applies": (2, 3600, "confirmed changes", "an hour")}
        with mock.patch.dict(ratelimit.BUCKETS, limits):
            ids = [self.preview_id(f"Name {i}") for i in range(3)]
            self.assertFalse(self.apply(ids[0]).get("isError"))
            self.assertFalse(self.apply(ids[1]).get("isError"))
            third = self.apply(ids[2])
        self.assertTrue(third["isError"])
        self.assertIn("limit of 2 confirmed changes", self.text(third))
        self.assertEqual(self.world["applied"], ["Name 0", "Name 1"])


class ListTests(ChangesTestCase):
    def test_lists_only_own_open_unexpired_previews(self):
        keep = self.preview_id("Keep")
        done = self.preview_id("Done")
        self.apply(done)
        self.propose("Old")
        self.pending.rows[-1].expires_at = timezone.now() - timedelta(minutes=1)
        other = self.store.account(email="other@example.com")
        _client, body = self.tokens(other)
        self.propose("Theirs", token=body["access_token"])

        result = self.post(rpc("tools/call", {"name": "list_my_pending_changes", "arguments": {}})).json()["result"]
        items = result["structuredContent"]["pending"]
        self.assertEqual([i["preview_id"] for i in items], [keep])
        self.assertIn("Rename the module to 'Keep'", self.text(result))

    def test_empty_list_message(self):
        result = self.post(rpc("tools/call", {"name": "list_my_pending_changes", "arguments": {}})).json()["result"]
        self.assertEqual(result["structuredContent"], {"pending": []})
        self.assertIn("no changes waiting", self.text(result))


class SelfcheckProductionGuardTests(SimpleTestCase):
    """mcp_selfcheck: production needs --allow-production AND the branch id typed back."""

    def guard(self, options, typed=None, branch="br-holy-band-abhispwg"):
        from mcp_api.management.commands.mcp_selfcheck import assert_safe_target

        asked = []

        def ask(prompt):
            asked.append(prompt)
            return typed

        result = assert_safe_target(options, environ={}, branch_id_of=lambda alias: branch, ask=ask)
        return result, asked

    def test_refuses_without_allow_production(self):
        from django.core.management.base import CommandError

        with self.assertRaisesMessage(CommandError, "--allow-production"):
            self.guard({"allow_production": False})

    def test_refuses_wrong_typed_branch(self):
        from django.core.management.base import CommandError

        with self.assertRaisesMessage(CommandError, "did not match"):
            self.guard({"allow_production": True}, typed="br-something-else")
        with self.assertRaisesMessage(CommandError, "did not match"):
            self.guard({"allow_production": True, "confirm_branch": "nope"})

    def test_accepts_typed_branch_at_prompt_or_flag(self):
        (branch, production), asked = self.guard({"allow_production": True}, typed="br-holy-band-abhispwg")
        self.assertEqual((branch, production), ("br-holy-band-abhispwg", True))
        self.assertEqual(len(asked), 1)
        (branch, production), asked = self.guard(
            {"allow_production": True, "confirm_branch": "br-holy-band-abhispwg"})
        self.assertTrue(production)
        self.assertEqual(asked, [])
