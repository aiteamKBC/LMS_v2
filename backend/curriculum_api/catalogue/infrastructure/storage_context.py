"""Request-local free-course storage selection; no framework or I/O."""
from contextlib import contextmanager
from contextvars import ContextVar

_native_only = ContextVar('native_free_course_authoring', default=False)


def native_only():
    return _native_only.get()


@contextmanager
def native_authoring_scope():
    token = _native_only.set(True)
    try:
        yield
    finally:
        _native_only.reset(token)
