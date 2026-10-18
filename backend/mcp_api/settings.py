"""Environment-backed settings for the MCP server.

Read per call rather than at import, like ``login.api_gate._enabled``, so tests
and local runs can toggle them without reloading Django settings.
"""
import os

from django.conf import settings

_ENABLED_VALUES = {"1", "true", "yes", "on"}

#: The one scope this server grants: act as the signed-in staff member in the
#: curriculum area.
SCOPE = "lms.curriculum"

#: Hosts that may use plain http, and only on a development or test-branch server.
LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1"})


def mcp_enabled():
    """Whether the MCP and OAuth endpoints exist at all. Off unless set."""
    return os.environ.get("MCP_ENABLED", "0").strip().lower() in _ENABLED_VALUES


def public_base_url():
    """The public origin advertised in OAuth metadata, without a trailing slash."""
    return os.environ.get("MCP_PUBLIC_BASE_URL", "").strip().rstrip("/")


def allowed_redirect_hosts():
    """Hosts a client may register redirect URIs on (exact match, lower case)."""
    raw = os.environ.get("MCP_ALLOWED_REDIRECT_HOSTS", "claude.ai,claude.com,chatgpt.com")
    return frozenset(host.strip().lower() for host in raw.split(",") if host.strip())


def allowed_origins():
    """Browser origins allowed to call /mcp/ besides MCP_PUBLIC_BASE_URL (MCP_ALLOWED_ORIGINS)."""
    raw = os.environ.get("MCP_ALLOWED_ORIGINS", "")
    return frozenset(o.strip().rstrip("/") for o in raw.split(",") if o.strip())


def loopback_http_allowed():
    """Plain-http loopback redirects are for Inspector on a dev/branch server only."""
    return bool(settings.DEBUG or getattr(settings, "RUN_APP_ON_TEST_BRANCH", False))


def _seconds(name, default):
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def access_ttl():
    return _seconds("MCP_ACCESS_TTL", 3600)


def refresh_ttl():
    return _seconds("MCP_REFRESH_TTL", 2_592_000)


def code_ttl():
    return _seconds("MCP_CODE_TTL", 300)
