"""Read the stored country calendars without loading provider synchronization.

Missing and expired years keep their existing explicit error semantics.
"""
from datetime import datetime, timedelta, timezone
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name


TABLE = 'country_holiday_calendars'


REFRESH_DAYS = 25


EXPIRY_DAYS = 30


class CalendarUnavailable(ValueError):
    pass


def saved_calendars():
    if not table_exists(TABLE):
        return []
    return fetch_all(f'select * from {table_name(TABLE)} order by country, year')


def _stamp(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return value.replace(tzinfo=value.tzinfo or timezone.utc) if value else None


def cache_status(row):
    stamp = _stamp(row.get('fetched_at'))
    age = datetime.now(timezone.utc) - stamp if stamp else timedelta(days=EXPIRY_DAYS)
    return dict(country=row['country'], year=row['year'], fetchedAt=stamp.isoformat() if stamp else '',
                due=age >= timedelta(days=REFRESH_DAYS), expired=age >= timedelta(days=EXPIRY_DAYS),
                count=len(parse_json_value(row.get('holidays'), [])), message=row.get('last_error') or '')


def holidays_for_period(country, start, end=None):
    """Read only. A missing/expired calendar never silently becomes England."""
    start = parse_date(start)
    end = parse_date(end) or start
    if not start:
        raise CalendarUnavailable('Set delivery dates to select the required holiday years.')
    rows = {int(row['year']): row for row in saved_calendars() if row['country'] == country}
    output = []
    for year in range(start.year, max(start.year, end.year) + 1):
        row = rows.get(year)
        if not row or cache_status(row)['expired']:
            raise CalendarUnavailable(f'Sync {country} public holidays for {year} before planning sessions.')
        output.extend(parse_json_value(row.get('holidays'), []))
    return output
