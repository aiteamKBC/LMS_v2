"""MCP over Streamable HTTP in stateless JSON mode: one JSON-RPC request, one JSON reply.

No SSE and no session id. Batch arrays are refused. ``handle`` takes the parsed
body and returns ``(http_status, body_or_None, tool_name)``; the view in ``views.py`` owns
authentication, the per-call context and logging.
"""
import logging

from . import pii, ratelimit
from . import schema as json_schema
from .dispatch import DispatchError
from .tools import REGISTRY, ToolError, ToolResult, list_tools

logger = logging.getLogger("mcp_api")

#: Newest first. An unsupported requested version is answered with the newest.
SUPPORTED_PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")

SERVER_INFO = {"name": "kbc-lms", "title": "Kent Business College LMS", "version": "1.0.0"}

INSTRUCTIONS = """\
You are connected to the Kent Business College LMS as the signed-in staff member, in the curriculum area.

How the curriculum is organised:
- Delivery: programme > cohort > group.
- Content: programme > module > week > component (a component is one item in a week, such as a lesson, a quiz or a file).

How to work:
- Always look items up first and use the ids the tools return. Never guess or invent an id.
- If a name matches more than one item, or the request is unclear, ask the user which one they mean before doing anything.
- Every change is a preview first. Show the user the preview and wait for them to confirm it. Only then call apply_change with that preview_id. Never apply a change the user has not confirmed.
- Never invent KSB codes. Use list_standard_ksbs to get the programme's applied standard and use only the codes it returns.
- Write all content (lesson text, explanations) in Markdown, not HTML.
- You can create and edit drafts only. You cannot publish, delete or archive anything, and you cannot see learner records."""

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

GENERIC_FAILURE = "Something went wrong in the LMS while doing that. Please try again later."


def error(id_, code, message, status=200):
    return status, {"jsonrpc": "2.0", "id": id_, "error": {"code": code, "message": message}}


def result(id_, value):
    return 200, {"jsonrpc": "2.0", "id": id_, "result": value}


def text_result(summary, data=None, *, is_error=False):
    body = {"content": [{"type": "text", "text": summary}]}
    if data is not None:
        body["structuredContent"] = data
    if is_error:
        body["isError"] = True
    return body


def negotiate(requested):
    return requested if requested in SUPPORTED_PROTOCOL_VERSIONS else SUPPORTED_PROTOCOL_VERSIONS[0]


def handle(request, message, account_id):
    """Answer one parsed JSON-RPC message. Returns ``(http_status, body, tool_name)``."""
    if isinstance(message, list):
        return (*error(None, INVALID_REQUEST, "Batch requests are not supported.", 400), None)
    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or not isinstance(message.get("method"), str):
        return (*error(message.get("id") if isinstance(message, dict) else None,
                       INVALID_REQUEST, "Invalid JSON-RPC request.", 400), None)

    method = message["method"]
    params = message.get("params") or {}
    if "id" not in message:
        # A notification (notifications/initialized and friends): accepted, no reply.
        return 202, None, None
    id_ = message["id"]
    if not isinstance(params, dict):
        return (*error(id_, INVALID_PARAMS, "params must be an object."), None)

    if method == "initialize":
        return (*result(id_, {
            "protocolVersion": negotiate(params.get("protocolVersion")),
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": INSTRUCTIONS,
        }), None)
    if method == "ping":
        return (*result(id_, {}), None)
    if method == "tools/list":
        return (*result(id_, {"tools": list_tools()}), None)
    if method == "tools/call":
        name = params.get("name")
        tool_ = REGISTRY.get(name) if isinstance(name, str) else None
        if tool_ is None:
            return (*error(id_, INVALID_PARAMS, f"Unknown tool: {name!r}."), None)
        return (*result(id_, call_tool(request, tool_, params.get("arguments"), account_id)), tool_.name)
    return (*error(id_, METHOD_NOT_FOUND, f"Method not found: {method}."), None)


def call_tool(request, tool_, arguments, account_id):
    """Run one tool. Always returns a tool result; failures become ``isError`` text."""
    arguments = {} if arguments is None else arguments
    problem = json_schema.validate(arguments, tool_.input_schema)
    if problem:
        return text_result(f"{problem} Please correct the input and try again.", is_error=True)
    try:
        ratelimit.check(account_id, "calls")
        if tool_.rate_bucket:
            ratelimit.check(account_id, tool_.rate_bucket)
        outcome = tool_.handler(request, arguments)
        if not isinstance(outcome, ToolResult):
            raise TypeError(f"{tool_.name} returned {type(outcome).__name__}, not ToolResult")
        data = pii.guard(outcome.data)
        return text_result(outcome.summary, data)
    except (ratelimit.RateLimited, ToolError, DispatchError) as exc:
        return text_result(str(exc), is_error=True)
    except pii.PiiLeak as exc:
        logger.error("MCP tool %s returned personal data at %s; refused.", tool_.name, exc.path)
        return text_result(GENERIC_FAILURE, is_error=True)
    except Exception:
        # The traceback goes to the log; the client never sees one.
        logger.exception("MCP tool %s failed", tool_.name)
        return text_result(GENERIC_FAILURE, is_error=True)
