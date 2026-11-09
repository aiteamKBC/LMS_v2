"""Where the bulk attendance register reaches KBC attendance on the new database.

The new database exposes the KBC rows as ``kbc_sync.kbc_attendance`` -- a
postgres_fdw link to the KBC source -- so the register reads and corrects them
through the application's own pooled connection instead of opening a fresh
connection to the old KBC database on every request. The link writes through
to the source table, so its triggers (``lms_attendance_changes``) still fire.

When the link is not provisioned (an older environment, or the SQLite test
settings) callers keep the original direct KBC connection unchanged; see
``bulk_attendance_learners.learner_directory_dsn``.
"""
from contextlib import contextmanager

from django.conf import settings
from django.db import connections, transaction

#: Passed where a DSN is expected, to mean "through the new database's link".
NEW_DATABASE = 'django:kbc_sync'
LINKED_TABLE = 'kbc_sync.kbc_attendance'
STATEMENT_TIMEOUT = '10s'

_linked = None


def _alias():
    # The learner and KBC reads share the enrolment alias; on the new database
    # it is the same physical database as ``default``.
    return 'enrolment' if 'enrolment' in settings.DATABASES else 'default'


def on_new_database():
    """True when ``kbc_sync.kbc_attendance`` is reachable on the app database.

    Answered once per process: the link is provisioned with the database, not
    toggled at runtime. A read error is raised rather than remembered, so a
    transient failure is not cached as "no link".
    """
    global _linked
    if _linked is None:
        connection = connections[_alias()]
        if connection.vendor != 'postgresql':
            _linked = False
        else:
            with connection.cursor() as cursor:
                cursor.execute('SELECT to_regclass(%s) IS NOT NULL', [LINKED_TABLE])
                _linked = bool(cursor.fetchone()[0])
    return _linked


@contextmanager
def new_database_cursor(*, read_only):
    """A cursor in its own transaction, with the register's 10s statement limit.

    Mirrors the direct KBC connection: reads run read-only, a write is all or
    nothing. Inside a caller's transaction neither setting is changed, since
    both would apply to that caller's work too.
    """
    alias = _alias()
    connection = connections[alias]
    outer = connection.in_atomic_block
    with transaction.atomic(using=alias):
        with connection.cursor() as cursor:
            if not outer:
                # One round trip for both settings: each is a full trip to Neon.
                cursor.execute(
                    ('SET TRANSACTION READ ONLY; ' if read_only else '')
                    + f"SET LOCAL statement_timeout = '{STATEMENT_TIMEOUT}'"
                )
            yield cursor


def dict_rows(cursor):
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]
