"""The holiday calendar on the current curriculum database: ``calendar_holidays``.

One table holds both halves of the calendar, told apart by ``source_kind``:

``england_official``
    England and Wales bank holidays as GOV.UK publishes them, one date each.
    ``source_record_id`` is the feed's own key (``england-and-wales:YYYY-MM-DD``)
    and ``id`` is ``england:<source_record_id>``. Kept current by
    ``england_holidays.run_sync``.
``local``
    This organisation's own closure periods, authored on the Holidays page.
    ``source_record_id`` is the number the page and the cohorts know the
    holiday by; ``id`` is ``local:<number>``.

A cohort's holiday choices live in ``cohort_calendar_holidays`` (selected /
excluded), keyed to ``calendar_holidays.id`` with ``ON DELETE RESTRICT``.

Everything outside this module speaks the holidays' own ids (the
``source_record_id``) and the two row shapes the separate tables had:
``title``/``holiday_date``/``division`` for a bank holiday,
``label``/``start_date``/``end_date``/``type`` for an authored closure. This
module turns one into the other.

In use only on PostgreSQL where ``calendar_holidays`` exists and the separate
``england_holidays`` / ``holidays`` tables do not (the SQLite test schema keeps
those).
"""
from __future__ import annotations

from datetime import datetime, timezone

from django.db import connection, transaction

OFFICIAL = 'england_official'
LOCAL = 'local'
OFFICIAL_CATEGORY = 'bank-holidays'
from .catalogue.infrastructure import database_reads
from .catalogue.infrastructure.holiday_reads import authored_holiday_table_name
from .catalogue.domain.values import format_date

from .catalogue.infrastructure.holiday_reads import ENGLAND_HOLIDAYS_TABLE
from .catalogue.infrastructure.holiday_reads import CALENDAR_HOLIDAYS_TABLE as TABLE
CHOICES_TABLE = 'cohort_calendar_holidays'


def _ref(table):
    return f'"curriculum"."{table}"'


from .catalogue.infrastructure.holiday_reads import calendar_in_use as in_use


def _now():
    return datetime.now(timezone.utc)


# --- reading ------------------------------------------------------------------

_COLUMNS = ('id, source_kind, source_record_id, label, start_date, end_date, category, color, notes, '
            'is_archived, division, bunting, fetched_at, created_at, updated_at')


def _shape(record):
    from .catalogue.infrastructure.holiday_store import _shape as implementation
    return implementation(
        record, OFFICIAL=OFFICIAL,
    )


def rows(kind=None):
    from .catalogue.infrastructure.holiday_store import rows as implementation
    return implementation(
        kind, OFFICIAL=OFFICIAL, TABLE=TABLE, _COLUMNS=_COLUMNS, _ref=_ref, _shape=_shape,
        connection=connection,
    )


def local_row(identifier):
    from .catalogue.infrastructure.holiday_store import local_row as implementation
    return implementation(
        identifier, LOCAL=LOCAL, TABLE=TABLE, _COLUMNS=_COLUMNS, _ref=_ref, _shape=_shape,
        connection=connection,
    )


def official_exists(identifier):
    from .catalogue.infrastructure.holiday_store import official_exists as implementation
    return implementation(
        identifier, OFFICIAL=OFFICIAL, TABLE=TABLE, _ref=_ref, connection=connection,
    )


# --- authored closures --------------------------------------------------------

def create_local(fields):
    from .catalogue.infrastructure.holiday_store import create_local as implementation
    return implementation(
        fields, LOCAL=LOCAL, TABLE=TABLE, _now=_now, _ref=_ref, connection=connection,
        local_row=local_row, transaction=transaction,
    )


_LOCAL_COLUMNS = {'label': 'label', 'type': 'category', 'color': 'color', 'notes': 'notes',
                  'start_date': 'start_date', 'end_date': 'end_date', 'is_archived': 'is_archived'}


def update_local(identifier, updates):
    from .catalogue.infrastructure.holiday_store import update_local as implementation
    return implementation(
        identifier, updates, LOCAL=LOCAL, TABLE=TABLE, _LOCAL_COLUMNS=_LOCAL_COLUMNS, _now=_now,
        _ref=_ref, connection=connection,
    )


def archive_local(identifier):
    from .catalogue.infrastructure.holiday_store import archive_local as implementation
    return implementation(
        identifier, update_local=update_local,
    )


# --- the GOV.UK mirror --------------------------------------------------------

def stored_official():
    from .catalogue.infrastructure.holiday_store import stored_official as implementation
    return implementation(
        OFFICIAL=OFFICIAL, TABLE=TABLE, _ref=_ref, connection=connection,
        format_date=format_date,
    )


def apply_official(incoming, added, changed, removed, division, now=None):
    from .catalogue.infrastructure.holiday_store import apply_official as implementation
    return implementation(
        incoming, added, changed, removed, division, now, CHOICES_TABLE=CHOICES_TABLE,
        OFFICIAL=OFFICIAL, OFFICIAL_CATEGORY=OFFICIAL_CATEGORY, TABLE=TABLE, _now=_now, _ref=_ref,
        connection=connection, transaction=transaction,
    )


def last_fetched():
    from .catalogue.infrastructure.holiday_store import last_fetched as implementation
    return implementation(
        OFFICIAL=OFFICIAL, TABLE=TABLE, _ref=_ref, connection=connection,
    )


# --- a cohort's choices ---------------------------------------------------------

def cohort_choices(cohort_ids=None):
    from .catalogue.infrastructure.holiday_store import cohort_choices as implementation
    return implementation(
        cohort_ids, CHOICES_TABLE=CHOICES_TABLE, TABLE=TABLE, _ref=_ref, connection=connection,
    )


from .catalogue.infrastructure.placement_reads import CHOICE_FIELDS


from .catalogue.infrastructure.placement_reads import attach_cohort_choices


def _id_list(value):
    from .catalogue.infrastructure.holiday_store import _id_list as implementation
    return implementation(
        value,
    )


def store_cohort_choices(payload, rows):
    from .catalogue.infrastructure.holiday_store import store_cohort_choices as implementation
    def invalidate(*args, **kwargs):
        from .catalogue.infrastructure.placement_reads import invalidate as operation
        return operation(*args, **kwargs)
    return implementation(
        payload, rows, CHOICES_TABLE=CHOICES_TABLE, TABLE=TABLE, _id_list=_id_list, _ref=_ref,
        cohort_choices=cohort_choices, connection=connection, in_use=in_use, invalidate=invalidate,
    )


def release_cohorts(where_sql, params):
    from .catalogue.infrastructure.holiday_store import release_cohorts as implementation
    return implementation(
        where_sql, params, CHOICES_TABLE=CHOICES_TABLE, _ref=_ref, connection=connection,
        in_use=in_use,
    )
