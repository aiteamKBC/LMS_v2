"""England and Wales bank-holiday calendar.

`curriculum.holidays` is a cohort-break authoring table ("Summer Break 26"),
not an authoritative calendar, so this feature keeps its own cached dataset in
``Last_audit.bank_holidays_england_wales``, seeded from the official gov.uk
``bank-bank-holidays.json`` division ``england-and-wales`` by the
``setup_actual_hours_review`` management command.

Two rules from the contract shape this module:

* a request never makes a live network call — the calendar is read from the
  cached table;
* a year with no cached data is **unavailable**, not "an ordinary day": the
  lookup returns ``None`` and the caller raises a blocking
  ``bank_holiday_calendar_unavailable`` finding.
"""

from __future__ import annotations

from django.db import DatabaseError

from .tables import BANK_HOLIDAY_TABLE


class BankHolidayCalendar:
    """Lookup over an explicit set of dates and the years it actually covers."""

    def __init__(self, holidays_by_date: dict, covered_years: set, data_version: str | None = None):
        self._holidays = dict(holidays_by_date)
        self._years = set(covered_years)
        self.data_version = data_version

    @property
    def covered_years(self) -> set:
        return set(self._years)

    def is_holiday(self, day):
        """``True`` / ``False`` / ``None`` when the year is not covered."""
        if day is None:
            return False
        if day.year not in self._years:
            return None
        return day in self._holidays

    def title(self, day) -> str | None:
        return self._holidays.get(day)


EMPTY_CALENDAR = BankHolidayCalendar({}, set())


def load_calendar(cursor, years=None) -> BankHolidayCalendar:
    """Read the cached calendar. A missing table reads as "unavailable" rather
    than crashing the scan — every affected row then carries a blocking finding."""
    conditions = []
    params: list = []
    if years:
        conditions.append("extract(year from holiday_date) = any(%s)")
        params.append([int(year) for year in years])
    where = f"where {' and '.join(conditions)}" if conditions else ""
    try:
        cursor.execute(
            f"""select holiday_date, title, data_version from {BANK_HOLIDAY_TABLE} {where}""",
            params,
        )
        rows = cursor.fetchall()
    except DatabaseError:
        return EMPTY_CALENDAR

    holidays = {row[0]: row[1] for row in rows}
    version = next((row[2] for row in rows if row[2]), None)
    covered = {day.year for day in holidays}
    return BankHolidayCalendar(holidays, covered, version)
