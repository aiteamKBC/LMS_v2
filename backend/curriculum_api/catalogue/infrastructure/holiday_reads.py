"""Existing normalized and separate-table holiday reads; no sync or writes."""

from curriculum_api.catalogue.application.cohort_calendar import holiday_row_sort_key as _default_holiday_row_sort_key
from curriculum_api.catalogue.domain.holiday_selection import holiday_row_archived as _default_holiday_row_archived
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def _scoped_holiday_rows(
    include_archived=False,
    *,
    calendar_in_use,
    calendar_rows,
    holiday_row_archived=_default_holiday_row_archived,
    holiday_row_sort_key=_default_holiday_row_sort_key,
    table_exists,
    ENGLAND_HOLIDAYS_TABLE,
    fetch_all,
    table_name,
    authored_holiday_table_name,
):
    """The read behind get_holiday_rows(); see there.

    Two sources, one calendar:

    ``curriculum.england_holidays``
        England's bank holidays exactly as GOV.UK publishes them -- one date per
        row, nobody here authors them, and they are kept current by
        ``england_holidays.run_sync`` (see that module).
    ``curriculum.holidays``
        This organisation's own closure periods -- the Christmas shutdown, a
        staff training day, an exam week. These *are* authored here, on the
        Holidays page, and unlike a bank holiday one of them can span a range of
        dates rather than a single day.

    Both are serialized by ``serialize_holiday_row`` into the same start/end
    shape, so everything downstream -- session plans, cohort periods, calendar
    bands -- treats them identically. Which is the point: a delivery day is
    closed or it is not, and why it is closed does not change the arithmetic.

    Archived authored holidays are left out unless asked for: archiving one is
    how a closure period stops shifting future session dates.
    """
    rows = []
    if calendar_in_use():
        # The current curriculum database: both halves live in calendar_holidays,
        # returned in the two shapes with their own ids (see calendar_holidays).
        rows = calendar_rows()
        if not include_archived:
            rows = [row for row in rows if not holiday_row_archived(row)]
        return sorted(rows, key=holiday_row_sort_key)
    if table_exists(ENGLAND_HOLIDAYS_TABLE):
        rows.extend(fetch_all(f'''
            select *
            from {table_name(ENGLAND_HOLIDAYS_TABLE)}
            order by holiday_date, title
        '''))
    authored_table = authored_holiday_table_name()
    if authored_table:
        authored = fetch_all(f'''
            select *
            from {table_name(authored_table)}
            order by start_date, label
        ''')
        if not include_archived:
            authored = [row for row in authored if not holiday_row_archived(row)]
        rows.extend(authored)
    # One order over both sources. The pickers and the cohort range filters read
    # these as a single calendar, so they must not arrive in two runs of dates.
    return sorted(rows, key=holiday_row_sort_key)


def holiday_table_name(*, ENGLAND_HOLIDAYS_TABLE, calendar_holidays, table_exists):
    """The one table holidays come from: ``curriculum.england_holidays``.

    Curriculum used to read authored closure periods out of ``holidays`` (and,
    before that, ``training_plan_holidays``). Neither is consulted any more:
    GOV.UK's published bank holidays are the calendar, loaded by
    sql/2026-09-13_curriculum_england_holidays.sql and kept current by the
    fetch_england_holidays command.

    An environment that has not applied that SQL yet reads as "no holidays"
    rather than falling back to the old table, so a half-migrated database can
    never quietly schedule against closure periods nobody picked.
    """
    if table_exists(ENGLAND_HOLIDAYS_TABLE):
        return ENGLAND_HOLIDAYS_TABLE
    if calendar_holidays.in_use():
        # The current curriculum database keeps the calendar in one table.
        return calendar_holidays.TABLE
    return ''


def authored_holiday_table_name(*, AUTHORED_HOLIDAYS_TABLE='holidays', table_exists=None):
    if table_exists is None:
        from .database_reads import table_exists
    """The table the Holidays page writes to, or '' if it is not provisioned.

    ``training_plan_holidays`` is still accepted as the older name for the same
    thing, because some environments have not been through the rename.
    """
    if table_exists(AUTHORED_HOLIDAYS_TABLE):
        return AUTHORED_HOLIDAYS_TABLE
    if table_exists('training_plan_holidays'):
        return 'training_plan_holidays'
    return ''


def england_holiday_exists(
    identifier,
    *,
    ENGLAND_HOLIDAYS_TABLE,
    calendar_holidays,
    clean_str=_default_clean_str,
    fetch_all,
    table_exists,
    table_name,
):
    if not table_exists(ENGLAND_HOLIDAYS_TABLE):
        return calendar_holidays.in_use() and calendar_holidays.official_exists(identifier)
    rows = fetch_all(
        f'select 1 from {table_name(ENGLAND_HOLIDAYS_TABLE)} where id = %s limit 1',
        [clean_str(identifier)],
    )
    return bool(rows)


ENGLAND_HOLIDAYS_TABLE = 'england_holidays'
CALENDAR_HOLIDAYS_TABLE = 'calendar_holidays'

def calendar_in_use():
    from . import database_reads
    from .holiday_store import in_use as implementation
    return implementation(
        ENGLAND_HOLIDAYS_TABLE=ENGLAND_HOLIDAYS_TABLE, TABLE=CALENDAR_HOLIDAYS_TABLE,
        authored_holiday_table_name=authored_holiday_table_name, connection=database_reads.connection,
        table_exists=database_reads.table_exists,
    )
