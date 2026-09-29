"""Cache backends that keep the site serving when Redis is not reachable.

Production shares curriculum payloads between workers through Redis. A
developer machine, a restarted container, or a brief network fault leaves the
same configuration pointing at a socket that refuses the connection, and
Django's stock ``RedisCache`` then raises on every single read. Each call sites
already guards itself, so nothing broke -- but every request paid a connect
attempt and wrote a full traceback to the log, which buried the real output and
turned a missing optional dependency into pages of noise.

``ResilientRedisCache`` keeps the Redis behaviour whenever Redis answers. When a
call fails to connect it logs one line, serves that call and the ones that
follow from a process-local cache, and retries Redis after a short cooldown.
That is exactly the pre-Redis behaviour -- a per-process cache and a per-process
epoch -- so a degraded worker serves its own consistent view rather than an
error, and picks the shared view back up as soon as Redis returns.
"""

import logging
import time

from django.core.cache.backends.locmem import LocMemCache
from django.core.cache.backends.redis import RedisCache

logger = logging.getLogger(__name__)

try:  # pragma: no cover - depends on the installed redis package
    from redis.exceptions import ConnectionError as RedisConnectionError
    from redis.exceptions import TimeoutError as RedisTimeoutError

    CONNECTION_ERRORS = (RedisConnectionError, RedisTimeoutError, OSError)
except ImportError:  # pragma: no cover - redis is optional
    CONNECTION_ERRORS = (OSError,)

# Methods that reach the server. ``get_or_set`` and the version helpers are left
# to the base class, which routes them back through these.
PROXIED = (
    'add',
    'get',
    'set',
    'touch',
    'delete',
    'get_many',
    'has_key',
    'incr',
    'set_many',
    'delete_many',
    'clear',
)


class ResilientRedisCache(RedisCache):
    """A Redis cache that falls back to this process while Redis is down."""

    def __init__(self, server, params):
        super().__init__(server, params)
        options = (params or {}).get('OPTIONS') or {}
        # How long to stay on the fallback before trying Redis again. Long
        # enough that a dead server is not reconnected to once per cache call,
        # short enough that a restart is picked up without a deploy.
        self._retry_after = float(options.get('DEGRADED_RETRY_SECONDS', 30))
        self._fallback = LocMemCache('resilient-redis-fallback', params or {})
        self._degraded_until = 0.0

    def _enter_degraded(self, exc):
        first = self._degraded_until <= time.monotonic()
        self._degraded_until = time.monotonic() + self._retry_after
        if first:
            # One line, no traceback: the cause is a refused connection, and the
            # callers above already treat a miss as a miss.
            logger.warning(
                'Cache server unavailable (%s); serving from a process-local '
                'cache for the next %ss.',
                exc,
                int(self._retry_after),
            )

    def _leave_degraded(self):
        if self._degraded_until:
            self._degraded_until = 0.0
            logger.info('Cache server reachable again; resuming the shared cache.')

    def _proxy(self, name, *args, **kwargs):
        if time.monotonic() >= self._degraded_until:
            try:
                value = getattr(super(), name)(*args, **kwargs)
            except CONNECTION_ERRORS as exc:
                self._enter_degraded(exc)
            else:
                self._leave_degraded()
                return value
        return getattr(self._fallback, name)(*args, **kwargs)


def _make_proxy(name):
    def method(self, *args, **kwargs):
        return self._proxy(name, *args, **kwargs)

    method.__name__ = name
    return method


for _name in PROXIED:
    setattr(ResilientRedisCache, _name, _make_proxy(_name))
