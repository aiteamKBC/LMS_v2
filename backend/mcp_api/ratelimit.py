"""Per-account rate limits for MCP calls, on the shared Django cache.

Fixed windows keyed by account and window number. With ``CACHE_URL`` (Redis) the
counts are shared by every worker; without it they are per worker process. A cache
outage allows the call and logs a warning: the limits protect cost and the
database, and must not take MCP down on their own.
"""
import logging
import time

from django.core.cache import cache

logger = logging.getLogger("mcp_api")

#: bucket -> (limit, window seconds, plain-English unit, plain-English window)
BUCKETS = {
    "calls": (60, 60, "tool calls", "a minute"),
    "write_applies": (20, 3600, "confirmed changes", "an hour"),
    # Book search embeds the query (OpenAI cost, SECURITY_AUDIT A11).
    "book_searches": (10, 60, "book searches", "a minute"),
}


class RateLimited(Exception):
    def __init__(self, bucket):
        limit, _window, unit, period = BUCKETS[bucket]
        super().__init__(
            f"You've hit the limit of {limit} {unit} in {period}. Please wait a minute and try again."
        )


def check(account_id, bucket, now=None):
    """Count one use of ``bucket``; raise RateLimited when it exceeds the limit."""
    limit, window, _unit, _period = BUCKETS[bucket]
    slot = int((now or time.time()) // window)
    key = f"mcp:rl:{bucket}:{account_id}:{slot}"
    try:
        cache.add(key, 0, timeout=window + 5)
        used = cache.incr(key)
    except Exception:  # noqa: BLE001 - see module docstring
        logger.warning("MCP rate limit unavailable for bucket %s; allowing the call.", bucket)
        return
    if used > limit:
        raise RateLimited(bucket)
