"""Single, fail-closed switch for every Free Course catalogue writer."""
from __future__ import annotations

from contextlib import contextmanager

from django.conf import settings
from django.db import connection, transaction


FROZEN = "frozen"
LEGACY = "legacy"
CANONICAL = "canonical"
VALID_MODES = frozenset({FROZEN, LEGACY, CANONICAL})
LOCK_NAME = "kbc.free-course-catalogue.writer.v1"


class FreeCourseWriterDisabled(RuntimeError):
    def __init__(self, required, actual):
        self.required = required
        self.actual = actual
        super().__init__(f"The {required} Free Course writer is disabled.")


def current_mode():
    value = str(getattr(settings, "FREE_COURSE_AUTHORING_WRITE_MODE", FROZEN) or "").strip().lower()
    return value if value in VALID_MODES else FROZEN


def require_mode(required):
    actual = current_mode()
    if actual != required:
        raise FreeCourseWriterDisabled(required, actual)
    return actual


def _catalogue_lock():
    if connection.vendor == "postgresql":
        with connection.cursor() as cursor:
            cursor.execute(
                "select pg_advisory_xact_lock(hashtextextended(%s, 0))",
                [LOCK_NAME],
            )


@contextmanager
def writer_transaction(required):
    """Open one atomic, mutually-exclusive catalogue writer transaction."""
    require_mode(required)
    with transaction.atomic():
        _catalogue_lock()
        # Recheck after waiting for a previous writer.  The value is process
        # configuration, but this catches test/runtime overrides at the barrier.
        require_mode(required)
        yield


def canonical_writer_transaction():
    return writer_transaction(CANONICAL)


def legacy_writer_transaction():
    return writer_transaction(LEGACY)
