"""Short-lived shared cache for heavy learner read pages.

The dashboard overview, weekly views and My Learning rebuild every response
from 20-60 database queries. Under load many requests ask for the same learner
at once (a learner's own tabs, refreshes, a coach and the learner together) and
each one repeated the whole build, so they queued on the database together.

``cached_learner_read`` stores a successful JSON response for
``LEARNER_RESPONSE_CACHE_SECONDS`` seconds (unset or 0 = off) in the configured
cache (shared in deployed environments, per-process memory in local development). Only one request
per key builds at a time: the others wait up to ``WAIT_SECONDS`` for its result
instead of starting their own build, then build it themselves.

Safety:
- Apply it *below* the access decorators (``learner_self_or_staff``,
  ``learner_journal_view``) so authorization still runs on every request.
- The key includes the signed-in account and its role, the full path and the
  query string, so one viewer never receives a response built for another.
- Any successful write under the learner's ``/learner_api/.../<kind>/<pk>/``
  paths bumps that learner's version (``LearnerReadCacheMiddleware``), so the
  learner's next read is rebuilt rather than up to 30 s stale.
- The cache is an accelerator only: any cache error falls through to a normal
  build.
"""
from functools import wraps
import hashlib
import logging
import os
import re
import sys
import time

from django.core.cache import cache
from django.http import HttpResponse

log = logging.getLogger(__name__)

# My Learning can legitimately take tens of seconds for unusually large legacy
# catalogues.  Giving up after ten seconds made every duplicate browser fetch
# start the same projection again, queueing several 30-60 second reads.  Keep
# the wait below the build lock while allowing the original request to finish.
WAIT_SECONDS = 60
LOCK_SECONDS = 90
POLL_SECONDS = 0.1
_LEARNER_PATH = re.compile(r'^/learner_api/(?:[^/]+/)+?(?P<kind>[a-z_-]+)/(?P<pk>\d+)(?:/|$)')


def ttl_seconds():
    try:
        # Match the deployed app's short cache window while using runserver.
        # Successful learner writes still invalidate the versioned key below.
        # A local process has no shared cache warmer. Keep a successful read for
        # five minutes; learner writes still bump the version immediately.
        default = '300' if 'runserver' in sys.argv else '0'
        return max(0, int(os.environ.get('LEARNER_RESPONSE_CACHE_SECONDS', default)))
    except ValueError:
        return 0


def _version_key(kind, pk):
    return f'learner-read:v:{kind}:{pk}'


def _version(kind, pk):
    try:
        return cache.get(_version_key(kind, pk)) or 0
    except Exception:
        return 0


def bump_learner(kind, pk):
    try:
        key = _version_key(kind, pk)
        if not cache.add(key, 1, timeout=None):
            cache.incr(key)
    except Exception:
        log.debug('learner read cache bump failed', exc_info=True)


def _key(request, name, kind, pk):
    account = getattr(request, 'login_account', None)
    viewer = f"{getattr(account, 'pk', '')}:{getattr(account, 'role', '')}" if account else 'anon'
    raw = f"{viewer}|{request.get_full_path()}"
    digest = hashlib.sha256(raw.encode()).hexdigest()[:32]
    return f'learner-read:{name}:{kind}:{pk}:{_version(kind, pk)}:{digest}'


def _restore(stored):
    status, content_type, body = stored
    response = HttpResponse(body, status=status, content_type=content_type)
    response['Cache-Control'] = 'private, no-store'
    response['X-Learner-Cache'] = 'hit'
    return response


def cached_learner_read(name):
    def decorator(view):
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            ttl = ttl_seconds()
            kind, pk = kwargs.get('kind'), kwargs.get('pk')
            if not ttl or request.method != 'GET' or kind is None or pk is None:
                return view(request, *args, **kwargs)
            try:
                key = _key(request, name, kind, pk)
                stored = cache.get(key)
                if stored is not None:
                    return _restore(stored)
                lock = key + ':build'
                building = not cache.add(lock, 1, timeout=LOCK_SECONDS)
            except Exception:
                return view(request, *args, **kwargs)

            if building:
                # Another request is building this exact response: wait for it
                deadline = time.monotonic() + WAIT_SECONDS
                while time.monotonic() < deadline:
                    time.sleep(POLL_SECONDS)
                    try:
                        stored = cache.get(key)
                    except Exception:
                        break
                    if stored is not None:
                        return _restore(stored)
                    # A failed builder stores no response but releases its lock
                    # in ``finally``.  Notice that release immediately and let
                    # exactly one waiter take over.  Previously every waiter
                    # slept for the full minute even after the 503, then rebuilt
                    # the same large catalogue independently.
                    try:
                        if cache.get(lock) is None and cache.add(lock, 1, timeout=LOCK_SECONDS):
                            building = False
                            break
                    except Exception:
                        break
                if building:
                    return view(request, *args, **kwargs)

            try:
                response = view(request, *args, **kwargs)
                if response.status_code == 200 and not getattr(response, 'streaming', False):
                    cache.set(key, (200, response.get('Content-Type', 'application/json'),
                                    response.content), timeout=ttl)
                return response
            finally:
                try:
                    cache.delete(lock)
                except Exception:
                    pass
        return wrapped
    return decorator


class LearnerReadCacheMiddleware:
    """Successful writes to a learner's learner_api paths invalidate their cached reads."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if request.method not in ('GET', 'HEAD', 'OPTIONS') and 200 <= response.status_code < 400:
            match = _LEARNER_PATH.match(request.path)
            if match:
                bump_learner(match['kind'], int(match['pk']))
        return response
