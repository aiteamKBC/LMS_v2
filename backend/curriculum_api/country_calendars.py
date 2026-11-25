"""Shared country/year holiday cache; never writes manual or England data."""
import hashlib
import os
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

import requests
from django.db import transaction

from .calendar_policy import COUNTRIES
from .catalogue.infrastructure.country_calendar_reads import (
    CalendarUnavailable, EXPIRY_DAYS, REFRESH_DAYS, TABLE, _stamp, cache_status, holidays_for_period, saved_calendars,
)


def _views():
    from . import views
    return views


def fetch_holidays(country, year):
    """One request per country/year. Do not log request URLs containing the key."""
    key = os.environ.get('CALENDARIFIC_API_KEY', '').strip()
    if not key:
        raise CalendarUnavailable('Calendarific is not configured on the server.')
    try:
        response = requests.get('https://calendarific.com/api/v2/holidays',
                                params=dict(api_key=key, country=country, year=year, type='national'), timeout=20)
        if response.status_code != 200:
            raise CalendarUnavailable(f'Holiday provider returned HTTP {response.status_code}; no calendar was replaced.')
        body = response.json()
        items = body['response']['holidays']
        if body.get('meta', {}).get('code') != 200 or not isinstance(items, list):
            raise CalendarUnavailable('Holiday provider returned an invalid calendar.')
    except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
        if isinstance(exc, CalendarUnavailable):
            raise
        raise CalendarUnavailable('Could not load public holidays; retry the sync.') from None
    if not items or any(not isinstance(item, dict) for item in items):
        raise CalendarUnavailable('No public holidays returned for this country/year; verify plan coverage.')
    normalized = []
    occurrences = defaultdict(int)
    for item in sorted(items, key=lambda row: (str(row.get('date', {}).get('iso', '')), str(row.get('name', '')))):
        kinds = {str(kind).lower() for kind in item.get('type', [])}
        if not kinds.intersection({'national holiday', 'public holiday', 'bank holiday', 'federal holiday'}):
            continue
        try:
            day = date.fromisoformat(item['date']['iso'][:10])
            label = str(item['name']).strip()
            if day.year != year or not label:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise CalendarUnavailable('Holiday provider returned an invalid dated entry.') from None
        # Free plans have no stable UUID. Canonical name + occurrence number
        # survives date corrections without losing the user's exclusion.
        source_key = str(item.get('urlid') or item.get('canonical_url') or label)
        key = (source_key, label)
        occurrences[key] += 1
        identity = hashlib.sha256(f'{country}:{year}:{source_key}:{label}:{occurrences[key]}'.encode()).hexdigest()[:24]
        normalized.append(dict(id=f'calendarific:{identity}', label=label, startDate=day.isoformat(),
                               endDate=day.isoformat(), source='calendarific', country=country, type='Public holiday'))
    if not normalized:
        raise CalendarUnavailable('No national public holidays returned; verify the provider coverage.')
    return normalized


def ensure_calendar(country, year, *, force=False):
    v = _views()
    country = str(country).upper()
    year = int(year)
    if country == 'GB' or country not in {item[0] for item in COUNTRIES} or not 2000 <= year <= 2100:
        raise CalendarUnavailable('Choose a supported country and year; England uses its existing GOV.UK calendar.')
    if not v.table_exists(TABLE):
        raise CalendarUnavailable('Apply curriculum migration 0090 before importing country calendars.')
    key = f'{country}:{year}'
    # A transaction-level lock coalesces simultaneous first-use requests.
    with transaction.atomic():
        if v.connection.vendor == 'postgresql':
            with v.connection.cursor() as cursor:
                cursor.execute('select pg_advisory_xact_lock(hashtext(%s))', ['holiday-calendar:' + key])
        rows = v.fetch_all(f'select * from {v.table_name(TABLE)} where id = %s', [key])
        existing = rows[0] if rows else None
        if existing and not force and not cache_status(existing)['due']:
            return existing
        holidays = fetch_holidays(country, year)
        with v.connection.cursor() as cursor:
            cursor.execute(f'''insert into {v.table_name(TABLE)} (id, country, year, holidays, fetched_at, last_error)
                values (%s, %s, %s, %s, %s, '') on conflict (id) do update set
                holidays=excluded.holidays, fetched_at=excluded.fetched_at, last_error='' returning *''',
                [key, country, year, v.json_db_value(holidays), datetime.now(timezone.utc)])
            row = v.rows_as_dicts(cursor)[0]
        v.invalidate_curriculum_cache()
        return row


def sync_saved(*, due_only=False):
    """Refresh used calendars only. Failure stays visible; expired data is purged."""
    v = _views()
    results = []
    for row in saved_calendars():
        if due_only and not cache_status(row)['due']:
            continue
        try:
            updated = ensure_calendar(row['country'], row['year'], force=not due_only)
            results.append({**cache_status(updated), 'status': 'ok'})
        except CalendarUnavailable as exc:
            results.append(record_sync_failure(row, exc))
    v.invalidate_curriculum_cache()
    return results


def record_sync_failure(row, error):
    v = _views()
    expired = cache_status(row)['expired']
    with v.connection.cursor() as cursor:
        if expired:
            cursor.execute(f'update {v.table_name(TABLE)} set last_error=%s, holidays=%s where id=%s',
                           [str(error), v.json_db_value([]), row['id']])
        else:
            cursor.execute(f'update {v.table_name(TABLE)} set last_error=%s where id=%s', [str(error), row['id']])
    v.invalidate_curriculum_cache()
    return {**cache_status(row), 'count': 0 if expired else cache_status(row)['count'], 'status': 'error', 'message': str(error)}
