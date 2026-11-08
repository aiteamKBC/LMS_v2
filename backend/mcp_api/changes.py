"""Step 5: preview -> apply. No write tool ever writes in the call that proposes it.

A write tool is a ``WriteTool`` subclass registered with ``register_write_tool``.
Calling it runs ``validate`` and ``preview`` only, stores the normalised payload in
``login."Mcp_pending_changes"`` and returns a ``preview_id``. Nothing in the LMS
changes until the user confirms and the model calls ``apply_change(preview_id)``.

``apply_change`` (all checks under a row lock, so two concurrent applies of one
preview cannot both write):

- the preview must belong to the calling account (anything else is "not found",
  so ids cannot be probed), be unexpired (15 minutes) and not cancelled;
- the stored payload must still hash to the stored ``Payload_hash``;
- ``validate`` runs again, because the LMS may have changed since the preview;
- a preview that was already applied returns the stored result and writes nothing
  (idempotent);
- if ``apply`` fails part-way, the steps it finished are recorded and reported with
  what is left to do in the LMS. Nothing is deleted to "undo" -- a half-finished
  change is finished or removed by a person in the LMS. The preview is then closed
  so it cannot be re-applied on top of the partial result.

Confirmed applies count against the ``write_applies`` rate limit (20 an hour).
"""
from __future__ import annotations

import hashlib
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import timedelta

from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.utils import timezone

from .dispatch import DispatchError
from .models import McpPendingChange
from .tools import ToolError, ToolResult, tool

logger = logging.getLogger("mcp_api")

ENROLMENT_DB = "enrolment"
PREVIEW_TTL = timedelta(minutes=15)
LIST_LIMIT = 10

CONFIRM_HINT = (
    "Nothing has been saved yet. Show this preview to the user and ask them to confirm. "
    "Only after they confirm, call apply_change with preview_id {preview_id}. "
    "The preview expires in {minutes} minutes."
)
NOT_FOUND = "I couldn't find that preview. Ask me to prepare the change again."

#: name -> WriteTool instance, for apply_change to find the tool that made a preview.
WRITE_TOOLS = {}


# --- payload hashing ------------------------------------------------------------------

def canonical_json(payload):
    """The one serialisation that is hashed: sorted keys, no whitespace, UTF-8 kept."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, cls=DjangoJSONEncoder)


def payload_hash(payload):
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def jsonable(payload):
    """Round-trip through JSON so what is hashed is exactly what jsonb stores and returns."""
    return json.loads(canonical_json(payload))


# --- write tool base ------------------------------------------------------------------

@dataclass
class Progress:
    """Sub-steps a multi-call ``apply`` has finished, for partial-failure reporting."""

    steps: list = field(default_factory=list)
    uncertain_steps: list = field(default_factory=list)

    def done(self, label, **data):
        self.steps.append({"step": label, **data})

    def uncertain(self, label):
        self.uncertain_steps.append(label)


@dataclass
class Validation:
    payload: dict
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)


class WriteTool:
    """Subclass, set ``name``/``description``/``input_schema``, implement the three methods.

    - ``validate(request, arguments) -> Validation``: normalise the arguments into the
      payload to store and list problems. Must accept its own normalised payload again
      (it is re-run on that payload before applying) and must not write anything.
    - ``preview(request, payload) -> dict``: ``{"summary": str, "details": dict}`` in
      plain English, with names rather than ids where possible. Must not write.
    - ``apply(request, payload, progress) -> dict``: perform the change through
      ``dispatch.call_api`` only, calling ``progress.done(...)`` after each sub-step.
      Return ``{"summary": str, "result": dict, "links": [str]}``. Raise ``ToolError``
      with a user-facing sentence on failure.
    """

    name = ""
    description = ""
    input_schema = {"type": "object"}

    def propose(self, request, arguments):
        """Prepare a preview; file tools may stage bytes before calling this."""
        return propose(request, self, arguments)

    def validate(self, request, arguments):
        raise NotImplementedError

    def preview(self, request, payload):
        raise NotImplementedError

    def apply(self, request, payload, progress):
        raise NotImplementedError


def register_write_tool(write_tool):
    """Register ``write_tool`` as an MCP tool whose call only ever produces a preview."""
    if not write_tool.name:
        raise ValueError("A write tool needs a name.")

    def propose_handler(request, arguments):
        return write_tool.propose(request, arguments)

    tool(write_tool.name, write_tool.description, write_tool.input_schema, writes=True, idempotent=False,
         file_params=getattr(write_tool, "file_params", ()),
         rate_bucket=getattr(write_tool, "rate_bucket", ""))(
        propose_handler
    )
    WRITE_TOOLS[write_tool.name] = write_tool
    return write_tool


def unregister_write_tool(name):
    from .tools import unregister

    unregister(name)
    WRITE_TOOLS.pop(name, None)


def _bullet(lines):
    return "\n".join(f"- {line}" for line in lines)


def _account(request):
    account = getattr(request, "login_account", None)
    client = getattr(request, "mcp_client", None)
    if account is None or client is None:
        # mcp_call always sets both; reaching here is a programming error.
        raise RuntimeError("write tools run only inside mcp_call")
    return account, client


def propose(request, write_tool, arguments):
    account, client = _account(request)
    check = write_tool.validate(request, arguments)
    if check.errors:
        raise ToolError("I can't prepare this change yet:\n" + _bullet(check.errors))
    payload = jsonable(check.payload)
    preview = write_tool.preview(request, payload)
    summary = preview.get("summary", "")
    stored_preview = {"summary": summary, "details": preview.get("details", {}), "warnings": list(check.warnings)}
    row = McpPendingChange.objects.create(
        id=uuid.uuid4(),
        account_id=account.pk,
        client_id=client.client_id,
        tool=write_tool.name,
        payload=payload,
        payload_hash=payload_hash(payload),
        preview=jsonable(stored_preview),
        expires_at=timezone.now() + PREVIEW_TTL,
    )
    minutes = int(PREVIEW_TTL.total_seconds() // 60)
    text = f"PREVIEW — {summary}"
    if check.warnings:
        text += "\n\nWarnings:\n" + _bullet(check.warnings)
    text += "\n\n" + CONFIRM_HINT.format(preview_id=row.id, minutes=minutes)
    return ToolResult(text, {
        "preview_id": str(row.id),
        "summary": summary,
        "details": stored_preview["details"],
        "warnings": stored_preview["warnings"],
        "expires_in_minutes": minutes,
        "saved": False,
    })


# --- apply / cancel / list --------------------------------------------------------------

def _parse_id(raw):
    try:
        return uuid.UUID(str(raw))
    except (TypeError, ValueError):
        raise ToolError(NOT_FOUND) from None


def _locked_own_row(account, preview_id):
    return (
        McpPendingChange.objects.select_for_update()
        .filter(pk=preview_id, account_id=account.pk)
        .first()
    )


def _close(row, now, result, *, applied):
    if applied:
        row.applied_at = now
    else:
        row.cancelled_at = now
    row.result = jsonable(result)
    row.save(update_fields=["applied_at" if applied else "cancelled_at", "result"])


def _replay(row):
    """A preview that was already applied: return what happened, write nothing."""
    result = row.result or {}
    status = result.get("status")
    if status == "applied":
        return ToolResult(
            "This change was already applied, so nothing was done again.\n" + result.get("summary", ""),
            {**result, "already_applied": True},
        )
    raise ToolError(
        "This change was already attempted and did not finish, so it can't be applied again.\n"
        + result.get("message", "")
    )


def apply_change(request, arguments):
    account, _client = _account(request)
    preview_id = _parse_id(arguments.get("preview_id"))
    now = timezone.now()
    # Refusals that record something (the row is closed) must leave the atomic
    # block normally so the record commits; the error is raised after it.
    refusal = None
    with transaction.atomic(using=ENROLMENT_DB):
        row = _locked_own_row(account, preview_id)
        if row is None:
            raise ToolError(NOT_FOUND)
        if row.applied_at is not None:
            return _replay(row)
        if row.cancelled_at is not None:
            raise ToolError("That preview was cancelled. Ask me to prepare the change again.")
        if row.expires_at <= now:
            raise ToolError("That preview has expired (previews last 15 minutes). Ask me to prepare the change again.")
        write_tool = WRITE_TOOLS.get(row.tool)
        if write_tool is None:
            raise ToolError("That kind of change is no longer available. Nothing was saved.")
        refusal = _refusal(request, row, write_tool, now)
        if refusal is None:
            result = _run_apply(request, row, write_tool, now)
            if result["status"] != "applied":
                refusal = result["message"]
    if refusal is not None:
        raise ToolError(refusal)
    text = "Done. " + result["summary"]
    if result["links"]:
        text += "\n\nOpen in the LMS:\n" + _bullet(result["links"])
    return ToolResult(text, {**result, "preview_id": str(row.pk)})


def _refusal(request, row, write_tool, now):
    """Close the preview and return the user message if it must not be applied; else None."""
    if payload_hash(row.payload) != row.payload_hash:
        logger.error("MCP pending change %s payload hash mismatch; refused.", row.pk)
        _close(row, now, {"status": "refused", "message": "The stored change did not match its preview."},
               applied=False)
        return "This preview could not be verified, so nothing was saved. Ask me to prepare it again."
    recheck = write_tool.validate(request, row.payload)
    if recheck.errors:
        message = "Things changed in the LMS since the preview, so nothing was saved:\n" + _bullet(recheck.errors)
        _close(row, now, {"status": "refused", "message": message}, applied=False)
        return message + "\nAsk me to prepare the change again."
    if jsonable(recheck.payload) != row.payload:
        message = "The change would now be different from the preview you confirmed, so nothing was saved."
        _close(row, now, {"status": "refused", "message": message}, applied=False)
        return message + " Ask me to prepare it again so you can review the new preview."
    return None


def _run_apply(request, row, write_tool, now):
    progress = Progress()
    try:
        # A savepoint: a database error inside apply must not poison the
        # transaction holding this row's lock and the record of what happened.
        with transaction.atomic(using=ENROLMENT_DB):
            outcome = write_tool.apply(request, row.payload, progress)
    except Exception as exc:  # noqa: BLE001 - recorded and reported
        user_facing = isinstance(exc, (ToolError, DispatchError))
        if not user_facing:
            logger.exception("MCP apply of %s (%s) failed", row.tool, row.pk)
        reason = str(exc) if user_facing else "The LMS reported an unexpected error."
        result = _failure_result(reason, progress)
    else:
        result = {
            "status": "applied",
            "summary": outcome.get("summary", ""),
            "result": outcome.get("result", {}),
            "links": list(outcome.get("links", [])),
            "completed_steps": progress.steps,
        }
    _close(row, now, result, applied=True)
    return result


def _failure_result(reason, progress):
    if progress.uncertain_steps:
        return {"status": "unknown", "message":
                f"The save outcome could not be confirmed: {reason}\n"
                + _bullet(progress.uncertain_steps)
                + "\nIt may have been saved. Check its status in the LMS before preparing another change.",
                "completed_steps": progress.steps, "uncertain_steps": progress.uncertain_steps}
    if progress.steps:
        message = (
            f"The change only partly finished: {reason}\n"
            "These steps WERE saved in the LMS:\n" + _bullet(s["step"] for s in progress.steps)
            + "\nPlease finish or remove them in the LMS yourself. Nothing was undone automatically."
        )
        status = "partial"
    else:
        message = f"The change failed before anything was saved: {reason}\nAsk me to prepare it again."
        status = "failed"
    return {"status": status, "message": message, "completed_steps": progress.steps}


def cancel_change(request, arguments):
    account, _client = _account(request)
    preview_id = _parse_id(arguments.get("preview_id"))
    with transaction.atomic(using=ENROLMENT_DB):
        row = _locked_own_row(account, preview_id)
        if row is None:
            raise ToolError(NOT_FOUND)
        if row.applied_at is not None:
            raise ToolError("That change was already applied, so it can't be cancelled here. Change it in the LMS.")
        if row.cancelled_at is not None:
            return ToolResult("That preview was already cancelled.", {"preview_id": str(row.pk), "cancelled": True})
        _close(row, timezone.now(), {"status": "cancelled"}, applied=False)
    return ToolResult("Cancelled. Nothing was saved.", {"preview_id": str(row.pk), "cancelled": True})


def list_my_pending_changes(request, arguments):
    account, _client = _account(request)
    now = timezone.now()
    rows = list(
        McpPendingChange.objects.filter(
            account_id=account.pk, applied_at__isnull=True, cancelled_at__isnull=True, expires_at__gt=now
        ).order_by("-created_at")[:LIST_LIMIT]
    )
    items = [
        {
            "preview_id": str(row.pk),
            "tool": row.tool,
            "summary": (row.preview or {}).get("summary", ""),
            "expires_in_minutes": max(0, int((row.expires_at - now).total_seconds() // 60)),
        }
        for row in rows
    ]
    if not items:
        return ToolResult("You have no changes waiting for confirmation.", {"pending": []})
    text = "Changes waiting for your confirmation:\n" + _bullet(
        f"{item['summary']} (preview_id {item['preview_id']}, expires in {item['expires_in_minutes']} min)"
        for item in items
    )
    return ToolResult(text, {"pending": items})


_ID_SCHEMA = {
    "type": "object",
    "properties": {"preview_id": {"type": "string", "minLength": 1, "maxLength": 64}},
    "required": ["preview_id"],
    "additionalProperties": False,
}

tool(
    "apply_change",
    "Save a change the user has reviewed and confirmed. Pass the preview_id from the preview. "
    "Only call this after the user has said yes to that exact preview.",
    _ID_SCHEMA,
    writes=True,
    idempotent=True,
    rate_bucket="write_applies",
)(apply_change)

tool(
    "cancel_change",
    "Throw away a preview the user does not want. Nothing is saved.",
    _ID_SCHEMA,
    writes=False,
)(cancel_change)

tool(
    "list_my_pending_changes",
    "List the previews you prepared that are still waiting for the user's confirmation (last 10, unexpired).",
    {"type": "object", "properties": {}, "additionalProperties": False},
)(list_my_pending_changes)
