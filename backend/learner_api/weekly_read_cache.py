"""Reuse selected facts inside an explicitly scoped, read-only learner projection."""
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from functools import wraps
from inspect import signature
import re


_reads = ContextVar('student_weekly_read_cache', default=None)


class _Identity:
    def __init__(self, value):
        self.value = value

    def __hash__(self):
        return id(self.value)

    def __eq__(self, other):
        return isinstance(other, _Identity) and self.value is other.value


@contextmanager
def weekly_read_scope():
    # Every invocation owns its cache, including nested reads and failures.
    token = _reads.set({})
    try:
        yield
    finally:
        _reads.reset(token)


def _key(value):
    if value is None or isinstance(value, (str, bytes, int, float, bool)):
        return (type(value), value)
    if isinstance(value, (list, tuple)):
        return (type(value), tuple(_key(item) for item in value))
    if isinstance(value, dict):
        return (dict, frozenset((_key(k), _key(v)) for k, v in value.items()))
    if isinstance(value, (set, frozenset)):
        return (type(value), frozenset(_key(item) for item in value))
    # Source model instances must never share facts just because their PKs match.
    return (type(value), _Identity(value))


def reuse_weekly_read(read):
    """No caching outside the explicitly installed, read-only projection scope."""
    parameters = signature(read)

    @wraps(read)
    def wrapped(*args, **kwargs):
        cache = _reads.get()
        if cache is None:
            return read(*args, **kwargs)
        bound = parameters.bind(*args, **kwargs)
        bound.apply_defaults()
        sql = bound.arguments.get('sql')
        if sql is not None and (not re.match(r'\s*(SELECT|WITH)\b', sql, re.I)
                or re.search(r'\b(INSERT|UPDATE|DELETE|MERGE|nextval|setval)\b|FOR\s+SHARE', sql, re.I)):
            cache.clear()
            return read(*args, **kwargs)
        key = (read, _key(bound.arguments))
        if key not in cache:
            value = read(*args, **kwargs)
            # Bound the number of distinct facts held by one projection.
            if len(cache) >= 128:
                return value
            cache[key] = deepcopy(value)
        return deepcopy(cache[key])

    return wrapped
