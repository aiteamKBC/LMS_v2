"""Environment-backed settings for the MCP server.

Read per call rather than at import, like ``login.api_gate._enabled``, so tests
and local runs can toggle them without reloading Django settings.
"""
import os

_ENABLED_VALUES = {"1", "true", "yes", "on"}


def mcp_enabled():
    """Whether the MCP and OAuth endpoints exist at all. Off unless set."""
    return os.environ.get("MCP_ENABLED", "0").strip().lower() in _ENABLED_VALUES


def public_base_url():
    """The public origin advertised in OAuth metadata, without a trailing slash."""
    return os.environ.get("MCP_PUBLIC_BASE_URL", "").strip().rstrip("/")
