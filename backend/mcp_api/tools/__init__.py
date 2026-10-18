"""MCP tool registry.

Each tool is a name, a description written for non-technical staff, a JSON input
schema (checked when the tool is registered, enforced before the handler runs), a
handler ``handler(request, arguments) -> ToolResult`` and whether it writes.

Handlers run inside ``mcp_api.context.mcp_call`` (actor and source set) and talk
to the LMS through ``mcp_api.dispatch.call_api``. Raise ``ToolError`` with a
sentence the user can act on; anything else becomes a generic error and a log line.
"""
from dataclasses import dataclass, field

from .. import schema as json_schema


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    input_schema: dict
    handler: object
    writes: bool = False
    idempotent: bool = True
    rate_bucket: str = ""


@dataclass
class ToolResult:
    """``summary`` is the short human text; ``data`` the structured JSON."""

    summary: str
    data: dict = field(default_factory=dict)


class ToolError(Exception):
    """A failure to show the user as-is: say what went wrong and what to do next."""


REGISTRY = {}


def tool(name, description, input_schema, *, writes=False, idempotent=None, rate_bucket=""):
    """Register a handler as an MCP tool."""
    json_schema.check_schema(input_schema)
    if input_schema.get("type") != "object":
        raise json_schema.SchemaError(f"{name}: a tool's input schema must be an object")

    def decorator(handler):
        if name in REGISTRY:
            raise ValueError(f"MCP tool {name!r} is already registered")
        REGISTRY[name] = Tool(
            name=name,
            description=description,
            input_schema=input_schema,
            handler=handler,
            writes=writes,
            idempotent=(not writes) if idempotent is None else idempotent,
            rate_bucket=rate_bucket,
        )
        return handler

    return decorator


def unregister(name):
    REGISTRY.pop(name, None)


def describe(tool_):
    return {
        "name": tool_.name,
        "description": tool_.description,
        "inputSchema": tool_.input_schema,
        "annotations": {
            "readOnlyHint": not tool_.writes,
            "destructiveHint": False,
            "idempotentHint": tool_.idempotent,
        },
    }


def list_tools():
    return [describe(t) for t in sorted(REGISTRY.values(), key=lambda t: t.name)]
