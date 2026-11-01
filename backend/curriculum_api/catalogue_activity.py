"""Small, read-only teaching-date facts for the Module Builder catalogue.

No structure loads, schema repair, Graph calls, or per-module queries. Dates
are evidence of teaching, independent of publication and learner completion.
"""
from datetime import date, datetime, timedelta, timezone as utc_timezone

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from django.views.decorators.http import require_GET

from login.permissions import require_access
from . import views


CANCELLED = {'cancelled', 'canceled'}
DATE_KEYS = ('sessionDateTimeUtc', 'teamsStartDateTimeUtc', 'sessionDate')


def teaching_day(value):
    if isinstance(value, datetime):
        instant = value
    elif isinstance(value, date):
        return value.isoformat()
    else:
        text = str(value or '').strip()
        if not text:
            return ''
        try:
            if len(text) == 10:
                day = parse_date(text)
                return day.isoformat() if day else ''
            instant = parse_datetime(text)
        except (ValueError, TypeError):
            return ''
    if not instant:
        return ''
    if timezone.is_naive(instant):
        instant = timezone.make_aware(instant, utc_timezone.utc)
    return timezone.localtime(instant, timezone.get_default_timezone()).date().isoformat()


def source_label(value):
    source = str(value or '').strip().lower()
    if source == 'mba-legacy':
        return 'old_lms'
    if source in {'module_authoring', 'authoring', 'training_plan'}:
        return 'new_lms'
    return 'unknown'


def catalogue_facts(modules, components, series):
    series_by_id = {str(row['id']): row for row in series}
    last_dates = {}

    def keep(module_id, value):
        day = teaching_day(value)
        if day:
            last_dates[module_id] = max(last_dates.get(module_id, ''), day)

    for row in series:
        if str(row.get('status') or '').lower() in CANCELLED:
            continue
        # A series with cancelled occurrences must not fall back to its old
        # start date and manufacture another teaching session.
        last = row.get('last_live_end') or row.get('last_live_start')
        if not row.get('occurrence_count'):
            last = row.get('start_datetime')
            if last:
                instant = last if isinstance(last, datetime) else parse_datetime(str(last))
                if instant:
                    last = instant + timedelta(minutes=max(0, int(row.get('duration_minutes') or 0)))
        keep(str(row['module_catalogue_id']), last)

    for row in components:
        bound_series = series_by_id.get(str(row.get('teamsLiveSessionId') or ''))
        if bound_series and str(bound_series.get('status') or '').lower() in CANCELLED:
            continue
        if str(row.get('occurrence_status') or '').lower() in CANCELLED:
            continue
        if bound_series and bound_series.get('occurrence_count') and not (
            bound_series.get('last_live_end') or bound_series.get('last_live_start')
        ):
            continue
        for key in DATE_KEYS:
            if teaching_day(row.get(key)):
                keep(str(row['module_catalogue_id']), row[key])
                break

    # A shared calendar has one owner, but every explicitly linked copy uses
    # its dates. Keep each copy's own start and provenance.
    modules_by_id = {str(row['module_catalogue_id']): row for row in modules}
    def last_date(module_id, seen):
        if module_id in seen:
            return last_dates.get(module_id, '')
        linked = str(modules_by_id.get(module_id, {}).get('teams_shared_source_module_id') or '')
        return max(last_dates.get(module_id, ''), last_date(linked, seen | {module_id}) if linked else '')

    return {str(row['module_catalogue_id']): {
        'source': source_label(row.get('source_type')),
        'startDate': teaching_day(row.get('start_date')),
        'lastLiveDate': last_date(str(row['module_catalogue_id']), set()),
    } for row in modules}


def read_catalogue_facts():
    flags = ('deleted_at', 'is_programme_deleted', 'library_state')
    where, params = views.live_authoring_rows_sql(views.AUTHORING_MODULES_TABLE, flags)
    modules = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, where, params,
        ensure_tables=False, columns=['module_catalogue_id', 'start_date', 'source_type', 'status', 'teams_shared_source_module_id', *flags])
    modules = [row for row in modules if not views.programme_deleted_row(row)
               and str(row.get('status') or '').lower() != 'archived']
    components, series = [], []
    # Bound SQL parameters even for a large catalogue; never a read per card.
    ids = [str(row['module_catalogue_id']) for row in modules]
    for offset in range(0, len(ids), 400):
        batch = ids[offset:offset + 400]
        slots = ','.join(['%s'] * len(batch))
        live_table = views.authoring_table_name(views.LIVE_SESSIONS_TABLE)
        occurrences = views.authoring_table_name(views.LIVE_SESSION_OCCURRENCES_TABLE)
        series.extend(views.fetch_all(f'''
            SELECT s.id, s.module_catalogue_id, s.status, s.start_datetime, s.duration_minutes,
                COUNT(o.id) AS occurrence_count,
                MAX(CASE WHEN lower(coalesce(o.status, '')) NOT IN ('cancelled','canceled')
                    THEN o.scheduled_start END) AS last_live_start,
                MAX(CASE WHEN lower(coalesce(o.status, '')) NOT IN ('cancelled','canceled')
                    THEN coalesce(o.scheduled_end, o.scheduled_start) END) AS last_live_end
            FROM {live_table} s LEFT JOIN {occurrences} o ON o.live_session_id = s.id
            WHERE s.module_catalogue_id IN ({slots})
            GROUP BY s.id, s.module_catalogue_id, s.status, s.start_datetime, s.duration_minutes
        ''', batch))
        table = views.AUTHORING_COMPONENTS_TABLE
        conditions, values = views.live_authoring_rows_sql(table, flags)
        # Qualify optional visibility flags after adding the occurrence join.
        for flag in flags:
            conditions = conditions.replace(views.quote_ident(flag), f'c.{views.quote_ident(flag)}')
        week_conditions, week_values = views.live_authoring_rows_sql(views.AUTHORING_WEEKS_TABLE, flags)
        for flag in flags:
            week_conditions = week_conditions.replace(views.quote_ident(flag), f'w.{views.quote_ident(flag)}')
        for alias, table_name in [('c', table), ('w', views.AUTHORING_WEEKS_TABLE)]:
            if views.has_column(table_name, 'library_state'):
                conditions += ((' AND ' if conditions else '')
                               + f"lower(trim(coalesce({alias}.library_state, ''))) <> 'library'")
        def setting(key):
            if connection.vendor == 'postgresql':
                return f"c.settings_json ->> '{key}'"
            return f"json_extract(c.settings_json, '$.{key}')"
        projection = ', '.join(f'{setting(key)} AS {views.quote_ident(key)}'
                               for key in (*DATE_KEYS, 'teamsLiveSessionId'))
        components.extend(views.fetch_all(f'''
            SELECT DISTINCT c.module_catalogue_id, {projection}, o.status AS occurrence_status
            FROM {views.authoring_table_name(table)} c
            JOIN {views.authoring_table_name(views.AUTHORING_WEEKS_TABLE)} w
              ON w.id = c.week_id AND w.module_catalogue_id = c.module_catalogue_id
            LEFT JOIN {occurrences} o ON o.id = {setting('teamsOccurrenceId')}
            WHERE c.module_catalogue_id IN ({slots}) AND c.type IN ('live_session','live-session')
            {('AND ' + conditions) if conditions else ''}
            {('AND ' + week_conditions) if week_conditions else ''}
        ''', [*batch, *values, *week_values]))
    return catalogue_facts(modules, components, series)


@require_GET
@require_access('curriculum')
def catalogue_activity(request):
    try:
        payload = {'modules': read_catalogue_facts()}
    except DatabaseError:
        return JsonResponse({'error': 'Module activity could not be verified. Try again or view all modules.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'no-store'
    return response
