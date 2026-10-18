"""Structured MCP/OAuth events, in the style of ``login.sessions._event``.

Only fields in ``config.observability.SAFE_LOG_FIELDS`` reach the JSON log, and
callers pass only ids, reasons and counts: never a code, token, hash, verifier,
challenge, redirect query or client-supplied text.
"""
import logging

event_log = logging.getLogger("mcp_api.oauth")
call_log = logging.getLogger("mcp_api.calls")


def event(name, *, account_id=None, client=None, **fields):
    if account_id is not None:
        fields["account_id"] = str(account_id)
    if client is not None:
        # The row id, not the public client_id: SAFE_LOG_FIELDS carries entity ids.
        fields["entity_type"] = "mcp_client"
        fields["entity_id"] = str(client.pk)
    event_log.info(name, extra={"event": name, **fields})


def call_event(account_id, client, action, outcome, duration_ms):
    """One line per /mcp/ request: who, which client, which method or tool, result, time.

    Never the arguments or any content.
    """
    call_log.info("mcp.call", extra={
        "event": "mcp.call",
        "account_id": str(account_id),
        "entity_type": "mcp_client",
        "entity_id": str(client.pk),
        "action": str(action)[:64],
        "outcome": outcome,
        "duration_ms": duration_ms,
    })
