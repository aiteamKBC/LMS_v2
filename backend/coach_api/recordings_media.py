"""Read-only private archive inventory. Never import media or change attendance."""
from azure.core.exceptions import ResourceNotFoundError
from concurrent.futures import ThreadPoolExecutor
from django.conf import settings
from django.db import connections, router

from .models import CoachCalendarEvent
from .recording_archive import ARTIFACTS_RELATION, blob_columns_ready
from .recordings_calendar import _booking_times, _instant
from .recordings_cache import recent_read


def session_window(record):
    if getattr(record, 'calendar_window', None):
        return record.calendar_window
    values = record if isinstance(record, dict) else {
        key: getattr(record, key, None) for key in ('scheduled_date', 'scheduled_time', 'duration_minutes')}
    return _booking_times(values)


def in_session_window(start, end, window):
    """None means the evidence date is unknown; False means another occurrence."""
    start, end = _instant(start), _instant(end)
    if not start or not end or end <= start or not all(window):
        return None
    return start < window[1] and end > window[0]


def archive_rows(event_keys):
    keys = list(dict.fromkeys(event_keys))
    if not keys:
        return []
    database = router.db_for_read(CoachCalendarEvent) or 'default'
    if not blob_columns_ready(database):
        raise RuntimeError('Coaching archive metadata is unavailable.')
    with connections[database].cursor() as cursor:
        cursor.execute(f'''SELECT event_key,graph_artifact_id,created_datetime,end_datetime,
                                 blob_container,blob_name,blob_size_bytes,blob_uploaded_at,blob_upload_error
                          FROM {ARTIFACTS_RELATION}
                          WHERE event_key=ANY(%s) AND artifact_type='recording'
                          ORDER BY created_datetime,graph_artifact_id''', [keys])
        columns = ('event_key', 'id', 'startsAt', 'endsAt', 'container', 'blob', 'size', 'uploadedAt', 'error')
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def recording_state(row):
    if row.get('error'):
        return 'failed'
    if not row.get('container') or not row.get('blob') or not row.get('uploadedAt') or not row.get('size'):
        return 'pending'
    # Verify the private object, not merely its database row. No video bytes
    # are downloaded and a transient outage is never called "not recorded".
    from curriculum_api.session_archive import storage_client
    try:
        actual = storage_client().get_blob_client(row['container'], row['blob']).get_blob_properties(
            logging_enable=False, connection_timeout=3, read_timeout=5, retry_total=0)
        return 'ready' if actual.size > 0 and actual.size == row['size'] else 'missing'
    except ResourceNotFoundError:
        return 'missing'
    except Exception:
        return 'unavailable'


def recording_summaries(event_keys, *, windows, recent=False, refresh=False, verify=True, inventory=None):
    keys = list(dict.fromkeys(event_keys))
    result = {key: {'state': 'pending', 'recordings': [], 'readyCount': 0} for key in keys}
    eligible = []
    for row in archive_rows(keys) if inventory is None else inventory:
        if row['event_key'] not in result:
            continue
        belongs = in_session_window(row.get('startsAt'), row.get('endsAt'), windows.get(row['event_key'], (None, None)))
        if belongs is False:
            continue
        eligible.append((row, belongs))

    def summarise(item):
        row, belongs = item
        if not belongs:
            state = 'unlinked'
        elif not verify:
            # Calendar snapshots use the worker's verified archive metadata.
            # Details and delivery always perform a fresh private-object check.
            state = 'failed' if row.get('error') else 'ready' if all(row.get(key) for key in ('container', 'blob', 'uploadedAt', 'size')) else 'pending'
        elif recent:
            storage = [settings.AZURE_STORAGE_ACCOUNT, settings.AZURE_STORAGE_KEY]
            state = recent_read('blob', [storage, row], lambda: recording_state(row),
                                refresh=refresh, cache_if=lambda value: value == 'ready')
        else:
            # Detail/download paths always verify the object afresh.
            state = recording_state(row)
        return row['event_key'], {
            'id': row['id'], 'state': state,
            'startsAt': row['startsAt'].isoformat() if row.get('startsAt') else None,
            'endsAt': row['endsAt'].isoformat() if row.get('endsAt') else None,
        }

    # All database work is complete before the bounded provider-only pool.
    if recent and len(eligible) > 1:
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows = list(pool.map(summarise, eligible))
    else:
        rows = [summarise(item) for item in eligible]
    for key, row in rows:
        result[key]['recordings'].append(row)
    for summary in result.values():
        states = [row['state'] for row in summary['recordings']]
        summary['readyCount'] = states.count('ready')
        summary['state'] = ('ready' if summary['readyCount'] else next(
            (state for state in ('unavailable', 'missing', 'failed', 'unlinked', 'pending') if state in states), 'pending'))
    return result
