"""Short-lived read accelerators; callers must authorise and reconcile afresh."""
from hashlib import sha256
import json
import logging
from threading import Lock
from weakref import WeakValueDictionary

from django.conf import settings
from django.core.cache import cache

log = logging.getLogger(__name__)
_locks = WeakValueDictionary()
_lock_guard = Lock()


def recent_read(kind, identity, load, *, refresh=False, cache_if=lambda value: True, timeout=60):
    # Include database identity so environments sharing Redis cannot mix reads.
    digest = sha256(json.dumps([settings.DATABASES, identity], sort_keys=True,
                              default=str).encode()).hexdigest()
    key = f'coaching-recordings:v1:{kind}:{digest}'

    def saved():
        try:
            return cache.get(key)
        except Exception as failure:
            log.warning('Coaching read cache unavailable (%s).', type(failure).__name__)
            return None

    if not refresh:
        value = saved()
        if value is not None:
            return value
    # Duplicate reads coalesce inside a worker. Weak references release idle
    # locks without serialising unrelated coaches or retaining mailbox keys.
    with _lock_guard:
        lock = _locks.setdefault(key, Lock())
    with lock:
        if refresh:
            try:
                cache.delete(key)
            except Exception as failure:
                log.warning('Coaching read cache unavailable (%s).', type(failure).__name__)
        if not refresh:
            value = saved()
            if value is not None:
                return value
        value = load()  # failures never become cached empty calendars
        if cache_if(value):
            try:
                cache.set(key, value, timeout=timeout)
            except Exception as failure:
                log.warning('Coaching read cache unavailable (%s).', type(failure).__name__)
        return value


def recent_calendar(owner, start, end, load, *, refresh=False):
    from .views import get_graph_settings
    return recent_read('calendar', [get_graph_settings(), owner, start, end],
                       lambda: load(owner, start, end), refresh=refresh)
