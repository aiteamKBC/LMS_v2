import hashlib
import json
import logging
import calendar
import os
import re
import threading
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from html import escape
from pathlib import Path
from urllib import parse as urllib_parse
from urllib import error as urllib_error
from urllib import request as urllib_request
from urllib.parse import urlparse

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import IntegrityError, connection, transaction
from django.core.serializers.json import DjangoJSONEncoder
from django.http import FileResponse, Http404, HttpResponse, HttpResponseNotModified, JsonResponse
from django.utils.text import get_valid_filename
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from .ksb_coverage import (
    SUPPORTED_CLASSIFICATIONS,
    build_coverage,
    coverage_status,
    float_weight,
    ksb_sort_key,
    ksb_type_from_value,
    normalise_classification as coverage_normalise_classification,
    normalise_code as coverage_normalise_code,
)

logger = logging.getLogger(__name__)


CURRICULUM_SCHEMA = 'curriculum'
TRAINING_MODULE_CATALOGUE_COLUMN = 'module_catalogue_id'
CANONICAL_MODULE_ID_PATTERN = re.compile(r'^MOD-[A-Z0-9][A-Z0-9_-]*$', re.I)
CURRICULUM_CACHE_TTL_SECONDS = 300
_CURRICULUM_CACHE = {}
_CURRICULUM_CACHE_LOCK = threading.Lock()
# Incremented by every invalidation so a factory that is already running cannot
# publish its now-stale result. Process-local, like the cache itself.
_CURRICULUM_CACHE_EPOCH = 0
_TABLE_COLUMNS_CACHE = {}
_TABLE_EXISTS_CACHE = {}
_AUTHORING_TABLES_READY = False
_FREE_PROGRAMME_TABLES_READY = False
_STAFF_PROFILE_TABLES_READY = False
_PROGRAMME_CONFIG_DEDUP_READY = False
_KSB_PROFILE_PROGRAMME_ID_READY = False
_TRAINING_PLAN_CANONICAL_READY = False
_LIVE_SESSIONS_TABLE_READY = False
_LIVE_SESSION_TRACKING_TABLES_READY = False
SUPPORTED_KSB_SOURCE_TYPES = {'standard', 'framework'}
LIVE_SESSIONS_TABLE = 'live_sessions'
LIVE_SESSION_OCCURRENCES_TABLE = 'live_session_occurrences'
LIVE_SESSION_ATTENDANCE_TABLE = 'live_session_attendance'
LIVE_SESSION_ARTIFACTS_TABLE = 'live_session_artifacts'
LIVE_SESSION_RECORDING_EVENTS_TABLE = 'live_session_recording_events'


def invalidate_curriculum_cache():
    global _CURRICULUM_CACHE_EPOCH
    with _CURRICULUM_CACHE_LOCK:
        _CURRICULUM_CACHE.clear()
        # Bumping the epoch discards results from any factory that is mid-flight
        # right now. Without it, a build that started before this write completes
        # afterwards and repopulates the cache with pre-write rows, which would
        # then serve stale authoring data for the rest of the TTL.
        _CURRICULUM_CACHE_EPOCH += 1
    _TABLE_EXISTS_CACHE.clear()


def cached_curriculum_value(key, factory):
    now = datetime.now().timestamp()
    with _CURRICULUM_CACHE_LOCK:
        entry = _CURRICULUM_CACHE.get(key)
        if entry and entry['expires_at'] > now:
            return entry['value']
        epoch = _CURRICULUM_CACHE_EPOCH

    # Build outside the lock: these factories run multi-table queries that can take
    # seconds on a cold database, and holding the lock would serialise every other
    # cached read behind them. An exception propagates without storing anything, so
    # failures are never cached.
    value = factory()

    with _CURRICULUM_CACHE_LOCK:
        # Only publish if no write invalidated the cache while we were building.
        if epoch == _CURRICULUM_CACHE_EPOCH:
            _CURRICULUM_CACHE[key] = {
                'expires_at': datetime.now().timestamp() + CURRICULUM_CACHE_TTL_SECONDS,
                'value': value,
            }
    return value


def reference_json_response(request, payload):
    """JSON response with a validating ETag, for reference data only.

    Suitable for endpoints whose body depends on nothing but the reference tables:
    no per-user, per-role or per-programme variation. The ETag is derived from the
    serialised body, so it changes exactly when the content does — there is no TTL
    to tune and no way to serve content that is newer than its validator.

    ``Cache-Control: private, no-cache`` makes the browser revalidate every time
    and keeps the payload out of shared caches; a match then costs a 304 with no
    body instead of the full response. Deliberately not ``public``: these endpoints
    sit behind authentication, so a shared cache must not retain them.
    """
    body = json.dumps(payload, cls=DjangoJSONEncoder)
    etag = f'"{hashlib.sha256(body.encode()).hexdigest()[:32]}"'
    if_none_match = clean_str(request.headers.get('If-None-Match'))
    if if_none_match and etag in [value.strip() for value in if_none_match.split(',')]:
        response = HttpResponseNotModified()
    else:
        response = HttpResponse(body, content_type='application/json')
    response['ETag'] = etag
    response['Cache-Control'] = 'private, no-cache'
    return response


def rows_as_dicts(cursor):
    columns = [col[0] for col in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def fetch_all(query, params=None):
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


def execute_returning(query, params=None):
    return fetch_all(query, params)


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def table_name(table):
    # PostgreSQL uses the dedicated ``curriculum`` schema; sqlite (tests) keeps
    # the tables in the default schema, so drop the schema qualifier there to
    # stay consistent with authoring_table_name().
    if connection.vendor != 'postgresql':
        return quote_ident(table)
    return f'{quote_ident(CURRICULUM_SCHEMA)}.{quote_ident(table)}'


def column_names(table):
    cache_key = f'{CURRICULUM_SCHEMA}.{table}'
    if cache_key in _TABLE_COLUMNS_CACHE:
        return _TABLE_COLUMNS_CACHE[cache_key]

    if connection.vendor == 'postgresql':
        rows = fetch_all(
            '''
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
            ''',
            [CURRICULUM_SCHEMA, table],
        )
        names = {row['column_name'] for row in rows}
    else:
        with connection.cursor() as cursor:
            cursor.execute(f'pragma table_info({quote_ident(table)})')
            names = {row[1] for row in cursor.fetchall()}
    _TABLE_COLUMNS_CACHE[cache_key] = names
    return names


def has_column(table, column):
    return column in column_names(table)


def table_exists(table):
    # Cached because this runs on hot read paths and the schema does not change
    # under us; invalidate_curriculum_cache() clears it, as does a process restart.
    # A failed probe is deliberately not cached, so a transient error does not
    # pin a table to "missing" for the life of the process.
    cache_key = f'{CURRICULUM_SCHEMA}.{table}'
    if cache_key in _TABLE_EXISTS_CACHE:
        return _TABLE_EXISTS_CACHE[cache_key]
    try:
        if connection.vendor == 'postgresql':
            rows = fetch_all(
                '''
                select 1
                from information_schema.tables
                where table_schema = %s and table_name = %s
                limit 1
                ''',
                [CURRICULUM_SCHEMA, table],
            )
        else:
            rows = fetch_all(
                "select 1 from sqlite_master where type='table' and name = %s limit 1",
                [table],
            )
        exists = bool(rows)
        _TABLE_EXISTS_CACHE[cache_key] = exists
        return exists
    except (Exception, AssertionError):
        logger.debug('Could not check whether table %s exists.', table, exc_info=True)
        return False


def ensure_columns(table, specs):
    missing = {column: definition for column, definition in specs.items() if not has_column(table, column)}
    if not missing:
        return
    with connection.cursor() as cursor:
        for column, definition in missing.items():
            cursor.execute(
                f'alter table {table_name(table)} add column if not exists {quote_ident(column)} {definition}'
            )
    _TABLE_COLUMNS_CACHE.pop(table, None)
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)


def ensure_ksb_profile_programme_id_column():
    global _KSB_PROFILE_PROGRAMME_ID_READY
    _KSB_PROFILE_PROGRAMME_ID_READY = True


def ensure_ksb_profile_identity_columns():
    ensure_ksb_profile_programme_id_column()
    try:
        ensure_columns('ksb_profiles', {
            'ksb_profile_id': 'varchar(128)',
            'programme_ids': 'jsonb',
        })
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute(f'''
                    create unique index if not exists curriculum_ksb_profiles_profile_id_idx
                    on {table_name("ksb_profiles")} ({quote_ident("ksb_profile_id")})
                    where {quote_ident("ksb_profile_id")} is not null and {quote_ident("ksb_profile_id")} <> ''
                ''')
    except Exception as exc:
        logger.warning('Could not ensure KSB profile identity column: %s', exc)


def is_canonical_module_catalogue_id(value):
    return bool(CANONICAL_MODULE_ID_PATTERN.match(clean_str(value)))


def training_row_column_module_catalogue_id(row):
    return clean_str((row or {}).get(TRAINING_MODULE_CATALOGUE_COLUMN))


def training_row_legacy_module_catalogue_id(row):
    meta = (row or {}).get('_meta') or extract_notes_meta((row or {}).get('notes'))
    return clean_str(meta.get(TRAINING_MODULE_CATALOGUE_COLUMN))


def training_row_invalid_explicit_module_catalogue_id(row):
    value = training_row_column_module_catalogue_id(row)
    return value if value and not is_canonical_module_catalogue_id(value) else ''


def training_row_stale_legacy_module_catalogue_id(row):
    column_value = training_row_column_module_catalogue_id(row)
    if column_value:
        return ''
    value = training_row_legacy_module_catalogue_id(row)
    return value if value and not is_canonical_module_catalogue_id(value) else ''


def training_row_module_catalogue_id(row):
    column_value = training_row_column_module_catalogue_id(row)
    if column_value:
        return column_value if is_canonical_module_catalogue_id(column_value) else ''
    legacy_value = training_row_legacy_module_catalogue_id(row)
    return legacy_value if is_canonical_module_catalogue_id(legacy_value) else ''


def canonical_module_link_payload(row, module_catalogue_id):
    module_catalogue_id = clean_str(module_catalogue_id)
    return {'notes': append_notes_meta((row or {}).get('notes'), {TRAINING_MODULE_CATALOGUE_COLUMN: module_catalogue_id})}


def link_training_row_to_catalogue(training_id, module_catalogue_id):
    return False


def ensure_program_config_archive_columns():
    try:
        ensure_columns('programmes', {
            'standard': 'varchar(255)',
            'level': 'varchar(64)',
            'owner': 'varchar(255)',
            'created_by': 'varchar(255)',
            'color': 'varchar(32)',
            'description': 'text',
            'is_active': 'boolean',
            'is_archived': 'boolean',
            'structure_type': 'varchar(32)',
            'ksb_profile_source_id': 'varchar(128)',
        })
    except Exception as exc:
        logger.warning('Could not inspect programme config archive columns: %s', exc)
        return
    updates = {}
    if has_column('programmes', 'is_active'):
        updates['is_active'] = True
    if has_column('programmes', 'is_archived'):
        updates['is_archived'] = False
    if has_column('programmes', 'structure_type'):
        updates['structure_type'] = 'scheduled'
    if updates:
        try:
            update_rows(
                'programmes',
                '(is_active is null or is_archived is null or structure_type is null)',
                [],
                updates,
            )
        except Exception:
            pass


def filtered_payload(table, payload):
    columns = column_names(table)
    return {key: value for key, value in payload.items() if key in columns and value is not None}


def json_body(request):
    try:
        return json.loads(request.body.decode('utf-8') or '{}')
    except (TypeError, ValueError, UnicodeDecodeError):
        return None


COMPONENT_UPLOAD_ROOT = 'curriculum_component_uploads'
COMPONENT_UPLOAD_MAX_BYTES = 80 * 1024 * 1024
COMPONENT_UPLOAD_EXTENSIONS = {
    'podcast': {'.mp3', '.m4a', '.mp4', '.wav', '.aac', '.ogg', '.oga', '.webm'},
    'powerpoint': {'.ppt', '.pptx', '.pps', '.ppsx', '.pdf'},
    'reading': {'.txt', '.doc', '.docx', '.pdf', '.rtf', '.odt'},
    # Assignment briefs are authored like reading material — a written brief or
    # an uploaded document (same document formats as reading).
    'assignment': {'.txt', '.doc', '.docx', '.pdf', '.rtf', '.odt'},
}


def safe_upload_segment(value, fallback):
    text = get_valid_filename(clean_str(value)).strip('._-')
    return text[:96] or fallback


def component_upload_metadata(module_catalogue_id, component_id, component_type, uploaded_file):
    module_catalogue_id = safe_upload_segment(module_catalogue_id, 'module')
    component_id = safe_upload_segment(component_id, 'component')
    component_type = frontend_component_type(component_type)
    original_name = get_valid_filename(uploaded_file.name or 'upload')
    suffix = Path(original_name).suffix.lower()
    allowed = COMPONENT_UPLOAD_EXTENSIONS.get(component_type, set())
    if suffix not in allowed:
        return None, f'{component_type} uploads must use one of: {", ".join(sorted(allowed))}.'
    if uploaded_file.size > COMPONENT_UPLOAD_MAX_BYTES:
        return None, 'File is too large. Maximum upload size is 80 MB.'

    timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
    stem = safe_upload_segment(Path(original_name).stem, 'resource')
    stored_name = f'{stem}-{timestamp}{suffix}'
    relative_path = f'{COMPONENT_UPLOAD_ROOT}/{module_catalogue_id}/{component_id}/{stored_name}'
    saved_path = default_storage.save(relative_path, uploaded_file)
    public_path = saved_path.removeprefix(f'{COMPONENT_UPLOAD_ROOT}/')
    return {
        'fileName': original_name,
        'storedPath': saved_path,
        'url': f'/curriculum_api/curriculum/uploads/{public_path}',
        'size': uploaded_file.size,
        'contentType': uploaded_file.content_type or '',
        'componentType': component_type,
    }, ''


def update_component_upload_settings(component_id, component_type, metadata):
    rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not rows:
        return False
    row = rows[0]
    settings_payload = normalise_component_settings_payload(component_type, parse_json_value(row.get('settings'), {}))
    updates = {
        'uploadedFileName': metadata['fileName'],
        'uploadedFileUrl': metadata['url'],
        'uploadedFileSize': metadata['size'],
        'uploadedFileContentType': metadata['contentType'],
        'uploadSource': 'Device upload',
    }
    if component_type == 'podcast':
        updates.update({'podcastSource': 'Device upload', 'podcastUrl': metadata['url']})
    if component_type == 'powerpoint':
        updates.update({'fileName': metadata['fileName'], 'presentationUrl': metadata['url']})
    if component_type == 'assignment':
        updates.update({'assignmentFileName': metadata['fileName'], 'assignmentFileUrl': metadata['url']})
    authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
        **row,
        'settings': json_db_value({**settings_payload, **updates}),
    })
    invalidate_curriculum_cache()
    return True


def json_error(message, status=400, **extra):
    payload = {'error': message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


TEAMS_REPEAT_VALUES = {'none', 'daily', 'weekdays', 'weekly'}
TEAMS_LOBBY_VALUES = {
    'invited': 'invited',
    'organization': 'organization',
    'organization-excluding-guests': 'organizationExcludingGuests',
    'everyone': 'everyone',
    'organizer': 'organizer',
}


def ensure_live_sessions_table():
    global _LIVE_SESSIONS_TABLE_READY
    if _LIVE_SESSIONS_TABLE_READY:
        return
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(LIVE_SESSIONS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128),
                module_draft_id varchar(255) not null default '',
                module_title varchar(500) not null default '',
                provider varchar(64) not null default 'Microsoft Teams',
                graph_event_id varchar(512),
                join_url text not null default '',
                web_link text not null default '',
                meeting_options_url text not null default '',
                organizer_email varchar(320) not null,
                attendees {json_type},
                presenters {json_type},
                start_datetime timestamp,
                timezone varchar(128) not null default '',
                duration_minutes integer not null default 60,
                repeat_pattern varchar(32) not null default 'none',
                repeat_occurrences integer not null default 1,
                lobby_bypass varchar(64) not null default 'invited',
                recording varchar(64) not null default 'none',
                spoken_language varchar(32) not null default 'en-GB',
                meeting_type varchar(64) not null default 'live-session',
                request_responses boolean not null default true,
                allow_time_proposals boolean not null default true,
                hide_attendees boolean not null default false,
                status varchar(32) not null default 'active',
                warnings {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (module_catalogue_id)
                    references {authoring_table_name(AUTHORING_MODULES_TABLE)} (module_catalogue_id)
                    on delete cascade
            )
        ''')
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_module_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_catalogue_id)'
        )
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_draft_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (module_draft_id)'
        )
        cursor.execute(
            f'create index if not exists curriculum_live_sessions_graph_event_idx '
            f'on {authoring_table_name(LIVE_SESSIONS_TABLE)} (graph_event_id)'
        )
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{LIVE_SESSIONS_TABLE}', None)
    _LIVE_SESSIONS_TABLE_READY = True


def ensure_live_session_tracking_tables():
    global _LIVE_SESSION_TRACKING_TABLES_READY
    if _LIVE_SESSION_TRACKING_TABLES_READY:
        return
    ensure_live_sessions_table()
    live_sessions = authoring_table_name(LIVE_SESSIONS_TABLE)
    occurrences = authoring_table_name(LIVE_SESSION_OCCURRENCES_TABLE)
    attendance = authoring_table_name(LIVE_SESSION_ATTENDANCE_TABLE)
    artifacts = authoring_table_name(LIVE_SESSION_ARTIFACTS_TABLE)
    recording_events = authoring_table_name(LIVE_SESSION_RECORDING_EVENTS_TABLE)
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f"alter table {live_sessions} add column if not exists online_meeting_id text not null default ''")
            cursor.execute(f"alter table {live_sessions} add column if not exists presenters {json_type} not null default '[]'")
        elif 'online_meeting_id' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f"alter table {live_sessions} add column online_meeting_id text not null default ''")
        if connection.vendor != 'postgresql' and 'presenters' not in column_names(LIVE_SESSIONS_TABLE):
            cursor.execute(f"alter table {live_sessions} add column presenters {json_type} not null default '[]'")
        cursor.execute(f'''
            create table if not exists {occurrences} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                session_number integer not null, graph_event_id varchar(512) not null default '',
                scheduled_start timestamp not null, scheduled_end timestamp not null,
                actual_start timestamp, actual_end timestamp, join_url text not null default '',
                attendance_report_id varchar(512) not null default '', participant_count integer not null default 0,
                status varchar(32) not null default 'scheduled', artifacts_synced_at timestamp,
                last_sync_error text not null default '', created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {live_sessions} (id) on delete cascade,
                unique (live_session_id, session_number)
            )
        ''')
        cursor.execute(f'''
            create table if not exists {attendance} (
                id varchar(128) primary key, occurrence_id varchar(128) not null,
                graph_record_id varchar(512) not null default '', email varchar(320) not null default '',
                display_name varchar(500) not null default '', role varchar(64) not null default '',
                total_attendance_seconds integer not null default 0, intervals {json_type}, raw_data {json_type},
                created_at timestamp not null default current_timestamp, updated_at timestamp not null default current_timestamp,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade
            )
        ''')
        cursor.execute(f'''
            create table if not exists {artifacts} (
                id varchar(128) primary key, occurrence_id varchar(128) not null,
                artifact_type varchar(32) not null, graph_artifact_id text not null,
                call_id text not null default '', content_correlation_id text not null default '',
                content_url text not null default '', created_datetime timestamp, end_datetime timestamp,
                metadata {json_type}, created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (occurrence_id) references {occurrences} (id) on delete cascade,
                unique (occurrence_id, artifact_type, graph_artifact_id)
            )
        ''')
        cursor.execute(f'''
            create table if not exists {recording_events} (
                id varchar(128) primary key, live_session_id varchar(128) not null,
                occurrence_id varchar(128) not null default '', artifact_id varchar(128) not null,
                preview_session_id varchar(128) not null, event_type varchar(64) not null,
                viewer_id varchar(255) not null default '', viewer_email varchar(320) not null default '',
                viewer_name varchar(500) not null default '', viewer_role varchar(128) not null default '',
                browser_session_id varchar(128) not null default '', client_event_id varchar(128) not null default '',
                event_time timestamp not null default current_timestamp, video_time_seconds double precision not null default 0,
                previous_video_time_seconds double precision, duration_seconds double precision,
                watched_seconds_delta double precision not null default 0, playback_rate double precision not null default 1,
                volume double precision, muted boolean, skipped boolean not null default false,
                skip_from_seconds double precision, skip_to_seconds double precision, skip_delta_seconds double precision,
                viewport_width integer, viewport_height integer, user_agent text not null default '',
                page_url text not null default '', referrer text not null default '', metadata {json_type},
                created_at timestamp not null default current_timestamp,
                foreign key (live_session_id) references {live_sessions} (id) on delete cascade,
                foreign key (artifact_id) references {artifacts} (id) on delete cascade
            )
        ''')
        cursor.execute(f'create index if not exists curriculum_live_occurrence_series_idx on {occurrences} (live_session_id)')
        cursor.execute(f'create index if not exists curriculum_live_occurrence_start_idx on {occurrences} (scheduled_start)')
        cursor.execute(f'create index if not exists curriculum_live_attendance_occurrence_idx on {attendance} (occurrence_id)')
        cursor.execute(f'create index if not exists curriculum_live_artifact_occurrence_idx on {artifacts} (occurrence_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_artifact_idx on {recording_events} (artifact_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_preview_idx on {recording_events} (preview_session_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_viewer_idx on {recording_events} (viewer_email, viewer_id)')
        cursor.execute(f'create index if not exists curriculum_recording_events_time_idx on {recording_events} (event_time)')
    for table in (LIVE_SESSIONS_TABLE, LIVE_SESSION_OCCURRENCES_TABLE, LIVE_SESSION_ATTENDANCE_TABLE, LIVE_SESSION_ARTIFACTS_TABLE, LIVE_SESSION_RECORDING_EVENTS_TABLE):
        _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)
    _LIVE_SESSION_TRACKING_TABLES_READY = True


def parse_graph_datetime(value):
    raw = clean_str(value)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace('Z', '+00:00'))
    except ValueError:
        return None


def scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences):
    supplied = payload.get('scheduledOccurrences')
    normalized = []
    if isinstance(supplied, list):
        for index, item in enumerate(supplied):
            if not isinstance(item, dict):
                continue
            start = parse_graph_datetime(item.get('startDateTimeUtc'))
            if not start:
                continue
            item_duration = max(15, min(1440, int(item.get('durationMinutes') or duration)))
            normalized.append({
                'session_number': max(1, int(item.get('sessionNumber') or index + 1)),
                'start': start,
                'end': start + timedelta(minutes=item_duration),
            })
    if normalized:
        return sorted(normalized, key=lambda item: (item['session_number'], item['start']))
    count = occurrences if repeat != 'none' else 1
    current = utc_start
    for index in range(count):
        normalized.append({'session_number': index + 1, 'start': current, 'end': current + timedelta(minutes=duration)})
        if repeat == 'daily':
            current += timedelta(days=1)
        elif repeat == 'weekdays':
            current += timedelta(days=1)
            while current.weekday() >= 5:
                current += timedelta(days=1)
        else:
            current += timedelta(days=7)
    return normalized


def persist_live_session_occurrences(live_session_id, payload, event, utc_start, duration, repeat, occurrences):
    ensure_live_session_tracking_tables()
    now = datetime.utcnow()
    join_url = clean_str((event.get('onlineMeeting') or {}).get('joinUrl'))
    rows = scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences)
    for item in rows:
        authoring_upsert(LIVE_SESSION_OCCURRENCES_TABLE, ['live_session_id', 'session_number'], {
            'id': f'OCC-{uuid.uuid4().hex.upper()}',
            'live_session_id': live_session_id,
            'session_number': item['session_number'],
            'graph_event_id': clean_str(event.get('id')),
            'scheduled_start': item['start'],
            'scheduled_end': item['end'],
            'join_url': join_url,
            'status': 'scheduled',
            'created_at': now,
            'updated_at': now,
        })
    return rows


def replace_live_session_occurrences(live_session_id, payload, utc_start, duration, repeat, occurrences, event_id='', join_url=''):
    ensure_live_session_tracking_tables()
    now = datetime.utcnow()
    rows = scheduled_live_session_occurrences(payload, utc_start, duration, repeat, occurrences)
    existing_rows = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id])
    def occurrence_number(row):
        try:
            return int((row or {}).get('session_number') or 0)
        except (TypeError, ValueError):
            return 0
    existing_by_number = {
        occurrence_number(row): row
        for row in existing_rows
        if occurrence_number(row) > 0
    }
    active_numbers = set()
    for item in rows:
        session_number = item['session_number']
        active_numbers.add(session_number)
        existing = existing_by_number.get(session_number) or {}
        authoring_upsert(LIVE_SESSION_OCCURRENCES_TABLE, ['live_session_id', 'session_number'], {
            'id': clean_str(existing.get('id')) or f'OCC-{uuid.uuid4().hex.upper()}',
            'live_session_id': live_session_id,
            'session_number': session_number,
            'graph_event_id': clean_str(event_id),
            'scheduled_start': item['start'],
            'scheduled_end': item['end'],
            'join_url': clean_str(join_url),
            'status': 'scheduled',
            'created_at': existing.get('created_at') or now,
            'updated_at': now,
        })
    if active_numbers:
        stale_ids = [clean_str(row.get('id')) for row in existing_rows if occurrence_number(row) not in active_numbers]
        if stale_ids:
            placeholders = ', '.join(['%s'] * len(stale_ids))
            update_authoring_rows(
                LIVE_SESSION_OCCURRENCES_TABLE,
                f"id in ({placeholders})",
                stale_ids,
                {'status': 'cancelled', 'updated_at': now},
            )
    return rows


def persist_live_session_series(payload, event, warnings, graph_settings, organizer, attendees, presenters, online_meeting_id=''):
    ensure_module_authoring_tables()
    ensure_live_session_tracking_tables()
    module_catalogue_id = clean_str(payload.get('moduleCatalogueId'))
    if module_catalogue_id and not authoring_module_exists(module_catalogue_id):
        module_catalogue_id = ''
    module_draft_id = clean_str(payload.get('moduleDraftId'))
    now = datetime.utcnow()
    supersede_filters = []
    supersede_params = []
    if module_catalogue_id:
        supersede_filters.append('module_catalogue_id = %s')
        supersede_params.append(module_catalogue_id)
    elif module_draft_id:
        supersede_filters.append('module_draft_id = %s')
        supersede_params.append(module_draft_id)
    if supersede_filters:
        update_authoring_rows(
            LIVE_SESSIONS_TABLE,
            f"status = 'active' and ({' or '.join(supersede_filters)})",
            supersede_params,
            {'status': 'superseded', 'updated_at': now},
        )

    live_session_id = f'LIVE-{uuid.uuid4().hex.upper()}'
    start_datetime = None
    start_raw = clean_str(payload.get('startDateTimeUtc'))
    if start_raw:
        try:
            start_datetime = datetime.fromisoformat(start_raw.replace('Z', '+00:00'))
        except ValueError:
            start_datetime = None
    authoring_upsert(LIVE_SESSIONS_TABLE, ['id'], {
        'id': live_session_id,
        'module_catalogue_id': module_catalogue_id or None,
        'module_draft_id': module_draft_id,
        'module_title': clean_str(payload.get('moduleTitle') or payload.get('title')),
        'provider': 'Microsoft Teams',
        'graph_event_id': clean_str(event.get('id')) or None,
        'online_meeting_id': online_meeting_id,
        'join_url': clean_str((event.get('onlineMeeting') or {}).get('joinUrl')),
        'web_link': clean_str(event.get('webLink')),
        'meeting_options_url': clean_str(event.get('_meetingOptionsUrl')),
        'organizer_email': organizer,
        'attendees': json_db_value(attendees),
        'presenters': json_db_value(presenters),
        'start_datetime': start_datetime,
        'timezone': graph_settings.get('timezone') or '',
        'duration_minutes': max(15, min(1440, int(payload.get('durationMinutes') or 60))),
        'repeat_pattern': clean_str(payload.get('repeat')).lower() or 'none',
        'repeat_occurrences': max(1, min(52, int(payload.get('repeatOccurrences') or 1))),
        'lobby_bypass': clean_str(payload.get('lobbyBypass')).lower() or 'invited',
        'recording': clean_str(payload.get('recording')).lower() or 'none',
        'spoken_language': clean_str(payload.get('spokenLanguage')) or 'en-GB',
        'meeting_type': clean_str(payload.get('meetingType')) or 'live-session',
        'request_responses': bool(payload.get('requestResponses', True)),
        'allow_time_proposals': bool(payload.get('allowNewTimeProposals', True)),
        'hide_attendees': bool(payload.get('hideAttendees', False)),
        'status': 'active',
        'warnings': json_db_value(warnings),
        'created_at': now,
        'updated_at': now,
    })
    occurrence_rows = persist_live_session_occurrences(
        live_session_id,
        payload,
        event,
        parse_graph_datetime(payload.get('startDateTimeUtc')) or now,
        max(15, min(1440, int(payload.get('durationMinutes') or 60))),
        clean_str(payload.get('repeat')).lower() or 'none',
        max(1, min(52, int(payload.get('repeatOccurrences') or 1))),
    )
    return live_session_id, len(occurrence_rows)


def link_live_session_series_to_module(module_catalogue_id, payload):
    ensure_live_sessions_table()
    live_session_ids = set()
    for week in payload.get('weekStructure') or []:
        for component in week.get('components') or []:
            settings_payload = component.get('settings') if isinstance(component.get('settings'), dict) else {}
            live_session_id = clean_str(settings_payload.get('teamsLiveSessionId'))
            if live_session_id:
                live_session_ids.add(live_session_id)
    delivery_metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
    metadata_id = clean_str(delivery_metadata.get('teamsLiveSessionId'))
    if metadata_id:
        live_session_ids.add(metadata_id)
    for live_session_id in live_session_ids:
        update_authoring_rows(
            LIVE_SESSIONS_TABLE,
            'id = %s',
            [live_session_id],
            {'module_catalogue_id': module_catalogue_id, 'updated_at': datetime.utcnow()},
        )


def teams_meeting_default_organizer():
    # Client credentials identify the application, not the licensed Microsoft
    # 365 user whose calendar owns the event. Keep that UPN configurable.
    return clean_str(
        os.environ.get('MICROSOFT_TEAMS_ORGANIZER_EMAIL')
        or os.environ.get('MICROSOFT_ORGANIZER_EMAIL')
    )


def teams_attendee_emails(value):
    if isinstance(value, list):
        candidates = value
    else:
        candidates = re.split(r'[\s,;]+', clean_str(value))
    emails = []
    seen = set()
    for item in candidates:
        email = clean_str(item).lower()
        if not email or email in seen:
            continue
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', email):
            raise ValueError(f'Invalid attendee email: {email}')
        seen.add(email)
        emails.append(email)
    return emails


def teams_event_recurrence(repeat, local_start, occurrences):
    if repeat == 'none':
        return None
    start_date = local_start.date().isoformat()
    day_name = local_start.strftime('%A').lower()
    if repeat == 'daily':
        pattern = {'type': 'daily', 'interval': 1}
    elif repeat == 'weekdays':
        pattern = {
            'type': 'weekly',
            'interval': 1,
            'daysOfWeek': ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        }
    else:
        pattern = {'type': 'weekly', 'interval': 1, 'daysOfWeek': [day_name]}
    return {
        'pattern': pattern,
        'range': {
            'type': 'numbered',
            'startDate': start_date,
            'numberOfOccurrences': occurrences,
        },
    }


def teams_event_payload(payload, graph_settings):
    title = clean_str(payload.get('title')) or 'Live session'
    local_start_raw = clean_str(payload.get('localStartDateTime'))
    utc_start_raw = clean_str(payload.get('startDateTimeUtc'))
    try:
        local_start = datetime.fromisoformat(local_start_raw)
    except ValueError as exc:
        raise ValueError('A valid meeting start date and time is required.') from exc
    try:
        utc_start = datetime.fromisoformat(utc_start_raw.replace('Z', '+00:00'))
    except ValueError as exc:
        raise ValueError('A valid UTC meeting start date and time is required.') from exc

    duration = max(15, min(1440, int(payload.get('durationMinutes') or 60)))
    repeat = clean_str(payload.get('repeat')).lower() or 'none'
    if repeat not in TEAMS_REPEAT_VALUES:
        raise ValueError('Unsupported repeat option.')
    occurrences = max(2, min(52, int(payload.get('repeatOccurrences') or 12)))
    attendees = teams_attendee_emails(payload.get('attendees'))
    presenters = teams_attendee_emails(payload.get('presenters'))
    invited_people = list(dict.fromkeys([*presenters, *attendees]))
    details = clean_str(payload.get('details'))
    body_parts = [
        f'<p><strong>{escape(title)}</strong></p>',
        '<p>Created from the KBC LearningOS Module Builder.</p>',
    ]
    if details:
        body_parts.append(f'<p>{escape(details).replace(chr(10), "<br>")}</p>')

    event = {
        'subject': title,
        'body': {'contentType': 'HTML', 'content': ''.join(body_parts)},
        'start': {
            'dateTime': local_start.replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': graph_settings['timezone'],
        },
        'end': {
            'dateTime': (local_start + timedelta(minutes=duration)).replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': graph_settings['timezone'],
        },
        'attendees': [
            {'emailAddress': {'address': email, 'name': email.split('@', 1)[0]}, 'type': 'required'}
            for email in invited_people
        ],
        'isOnlineMeeting': True,
        'onlineMeetingProvider': 'teamsForBusiness',
        'responseRequested': bool(payload.get('requestResponses', True)),
        'allowNewTimeProposals': bool(payload.get('allowNewTimeProposals', True)),
        'hideAttendees': bool(payload.get('hideAttendees', False)),
    }
    transaction_id = clean_str(payload.get('transactionId'))[:255]
    if transaction_id:
        event['transactionId'] = transaction_id
    recurrence = teams_event_recurrence(repeat, local_start, occurrences)
    if recurrence:
        event['recurrence'] = recurrence
    # Return normalized timing too, for the component settings response.
    return event, invited_people, presenters, utc_start, duration, repeat, occurrences


def teams_single_occurrence_payload(title, target, attendees):
    return {
        'subject': title,
        'body': {
            'contentType': 'HTML',
            'content': ''.join([
                f'<p><strong>{escape(title)}</strong></p>',
                '<p>Created from the KBC LearningOS Module Builder.</p>',
            ]),
        },
        'start': {
            'dateTime': target['start'].replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': 'UTC',
        },
        'end': {
            'dateTime': target['end'].replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': 'UTC',
        },
        'attendees': [
            {'emailAddress': {'address': email, 'name': email.split('@', 1)[0]}, 'type': 'required'}
            for email in attendees
        ],
        'isOnlineMeeting': True,
        'onlineMeetingProvider': 'teamsForBusiness',
        'responseRequested': True,
        'allowNewTimeProposals': True,
        'hideAttendees': False,
    }


def teams_calendar_minute_key(value):
    parsed = value if isinstance(value, datetime) else parse_graph_datetime(value)
    if not parsed:
        return ''
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed.replace(second=0, microsecond=0).isoformat(timespec='minutes')


def teams_series_email_list(*values):
    emails = []
    for value in values:
        if isinstance(value, str):
            candidates = parse_json_value(value, [])
            if not isinstance(candidates, list):
                candidates = re.split(r'[\s,;]+', value)
        elif isinstance(value, (list, tuple, set)):
            candidates = value
        else:
            candidates = []
        for candidate in candidates:
            email = clean_str(candidate).lower()
            if email and email not in emails:
                emails.append(email)
    return emails


def teams_online_meeting_owner_id(organizer, join_url=''):
    """Return the organizer object ID required by onlineMeetings Graph routes."""
    configured_id = clean_str(os.environ.get('MICROSOFT_TEAMS_ORGANIZER_ID'))
    if re.fullmatch(r'[0-9a-fA-F-]{36}', configured_id):
        return configured_id
    try:
        decoded_url = urllib_parse.unquote(clean_str(join_url))
        context_values = urllib_parse.parse_qs(urlparse(decoded_url).query).get('context') or []
        if context_values:
            context = json.loads(urllib_parse.unquote(context_values[0]))
            organizer_id = clean_str(context.get('Oid') or context.get('oid'))
            if re.fullmatch(r'[0-9a-fA-F-]{36}', organizer_id):
                return organizer_id
    except (TypeError, ValueError, json.JSONDecodeError):
        pass
    return clean_str(organizer)


def teams_online_meeting_from_join_url(organizer, join_url):
    """Find the onlineMeeting behind a calendar event when permissions allow."""
    if not join_url:
        return {}
    escaped_url = join_url.replace("'", "''")
    query = urllib_parse.urlencode({'$filter': f"joinWebUrl eq '{escaped_url}'"})
    owner_key = urllib_parse.quote(teams_online_meeting_owner_id(organizer, join_url), safe='')
    from coach_api.views import microsoft_graph_request
    response = microsoft_graph_request('GET', f'users/{owner_key}/onlineMeetings?{query}')
    values = response.get('value') if isinstance(response, dict) else []
    return values[0] if values else {}


@csrf_exempt
def curriculum_teams_meeting(request):
    """
    Create a calendar-backed Teams meeting for a Module Builder live session.

    The event endpoint sends real calendar invitations. Meeting-policy options
    that Graph cannot set on a calendar event are returned as a warning and are
    still persisted by the frontend for visibility.
    """
    from coach_api.views import get_graph_settings, has_graph_credentials, microsoft_graph_request

    graph_settings = get_graph_settings()
    default_organizer = teams_meeting_default_organizer()
    if request.method == 'GET':
        return JsonResponse({
            'configured': has_graph_credentials(),
            'defaultOrganizer': default_organizer,
            'timeZone': graph_settings.get('timezone') or 'GMT Standard Time',
        })
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)

    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('A valid JSON body is required.')
    organizer = clean_str(payload.get('organizerEmail')) or default_organizer
    if not organizer:
        return json_error(
            'Organizer email is required. Add it here or configure MICROSOFT_TEAMS_ORGANIZER_EMAIL.',
            status=400,
        )

    try:
        event_payload, attendees, presenters, utc_start, duration, repeat, occurrences = teams_event_payload(payload, graph_settings)
    except (TypeError, ValueError) as exc:
        return json_error(str(exc), status=400)

    owner_key = urllib_parse.quote(organizer, safe='')
    try:
        event = microsoft_graph_request('POST', f'users/{owner_key}/events', payload=event_payload)
    except RuntimeError as exc:
        logger.warning('Unable to create Module Builder Teams event: %s', exc)
        return json_error('Microsoft Teams could not create the meeting.', status=502, detail=str(exc))

    event_id = clean_str(event.get('id'))
    online_meeting = event.get('onlineMeeting') or {}
    join_url = clean_str(online_meeting.get('joinUrl'))
    if event_id and not join_url:
        try:
            event_key = urllib_parse.quote(event_id, safe='')
            event = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}')
            online_meeting = event.get('onlineMeeting') or {}
            join_url = clean_str(online_meeting.get('joinUrl'))
        except RuntimeError:
            pass

    warnings = []
    meeting_options_url = ''
    lobby_choice = clean_str(payload.get('lobbyBypass')).lower() or 'invited'
    if lobby_choice not in TEAMS_LOBBY_VALUES:
        lobby_choice = 'invited'
    recording = clean_str(payload.get('recording')).lower() or 'none'
    spoken_language = clean_str(payload.get('spokenLanguage')) or 'en-GB'
    # Calendar event creation reliably creates the Teams link and invitations.
    # If OnlineMeetings.ReadWrite.All + an application access policy are also
    # present, apply the lobby option to the underlying onlineMeeting.
    graph_meeting = {}
    try:
        graph_meeting = teams_online_meeting_from_join_url(organizer, join_url)
    except RuntimeError as exc:
        logger.warning('Teams event created but onlineMeeting lookup failed: %s', exc)
        warnings.append(
            'The Teams link was created, but its online meeting could not be resolved. '
            'Grant OnlineMeetings.ReadWrite.All and an application access policy to the organizer; '
            'Sync results will retry the lookup.'
        )

    meeting_options_url = clean_str(graph_meeting.get('meetingOptionsWebUrl'))
    meeting_id = clean_str(graph_meeting.get('id'))
    settings_applied = False
    if meeting_id:
        meeting_patch = {
            'lobbyBypassSettings': {
                'scope': TEAMS_LOBBY_VALUES[lobby_choice],
                'isDialInBypassEnabled': False,
            },
            'allowRecording': recording != 'none',
            'recordAutomatically': recording != 'none',
            'allowTranscription': recording == 'record-transcribe',
            'meetingSpokenLanguageTag': spoken_language,
        }
        if presenters:
            presenter_set = set(presenters)
            meeting_patch.update({
                'allowedPresenters': 'roleIsPresenter',
                'participants': {
                    'attendees': [
                        {
                            'upn': email,
                            'role': 'presenter' if email in presenter_set else 'attendee',
                        }
                        for email in attendees
                    ],
                },
            })
        try:
            online_owner_key = urllib_parse.quote(teams_online_meeting_owner_id(organizer, join_url), safe='')
            microsoft_graph_request(
                'PATCH',
                f'users/{online_owner_key}/onlineMeetings/{urllib_parse.quote(meeting_id, safe="")}',
                payload=meeting_patch,
            )
            settings_applied = True
        except RuntimeError as exc:
            logger.warning('Teams meeting created but meeting settings update failed: %s', exc)
            warnings.append(
                'The Teams meeting was created, but its lobby/recording/transcription settings were not applied. '
                'Grant OnlineMeetings.ReadWrite.All and an application access policy to the organizer.'
            )
    elif not any('could not be resolved' in warning for warning in warnings):
        warnings.append(
            'The Teams link was created, but Microsoft Graph has not exposed its online meeting ID yet. '
            'Sync results will retry the lookup.'
        )
    if not join_url:
        warnings.append('Microsoft Graph created the calendar event but has not returned the Teams join URL yet.')

    event['_meetingOptionsUrl'] = meeting_options_url
    try:
        live_session_id, tracked_occurrences = persist_live_session_series(
            payload,
            event,
            warnings,
            graph_settings,
            organizer,
            attendees,
            presenters,
            clean_str(graph_meeting.get('id')),
        )
    except Exception:
        logger.exception('Teams meeting was created, but its live_sessions record could not be saved.')
        return json_error(
            'The Teams meeting was created, but the LMS could not save its live-session record.',
            status=500,
            meetingCreated=True,
            eventId=event_id,
            joinUrl=join_url,
        )

    return JsonResponse({
        'created': True,
        'meeting': {
            'liveSessionId': live_session_id,
            'eventId': event_id,
            'onlineMeetingId': clean_str(graph_meeting.get('id')),
            'joinUrl': join_url,
            'webLink': clean_str(event.get('webLink')),
            'meetingOptionsUrl': meeting_options_url,
            'organizerEmail': organizer,
            'attendees': attendees,
            'presenters': presenters,
            'startDateTimeUtc': utc_start.isoformat(),
            'durationMinutes': duration,
            'repeat': repeat,
            'repeatOccurrences': occurrences if repeat != 'none' else 1,
            'trackedOccurrences': tracked_occurrences,
            'provider': 'Microsoft Teams',
            'trackingReady': bool(meeting_id),
            'settingsApplied': settings_applied,
        },
        'warnings': warnings,
    }, status=201)


def closest_live_occurrence(occurrences, timestamp):
    if not occurrences or not timestamp:
        return None
    comparable_timestamp = timestamp.replace(tzinfo=None)

    def distance(row):
        scheduled = row.get('scheduled_start') or timestamp
        return abs((scheduled.replace(tzinfo=None) - comparable_timestamp).total_seconds())

    return min(
        occurrences,
        key=distance,
    )


def attendance_identity(record):
    identity = record.get('identity') if isinstance(record.get('identity'), dict) else {}
    for key in ('user', 'guest', 'phone', 'encrypted'):
        value = identity.get(key)
        if isinstance(value, dict):
            display_name = clean_str(value.get('displayName') or value.get('name'))
            identity_id = clean_str(value.get('id'))
            if display_name or identity_id:
                return display_name, identity_id
    return '', ''


def attendance_display_name(record):
    if not isinstance(record, dict):
        return ''
    display_name, _identity_id = attendance_identity(record)
    if display_name:
        return display_name
    for key in ('displayName', 'participantDisplayName', 'name'):
        display_name = clean_str(record.get(key))
        if display_name:
            return display_name
    email = clean_str(record.get('emailAddress') or record.get('email')).lower()
    if email and '@' in email:
        local = email.split('@', 1)[0]
        return ' '.join(part.capitalize() for part in re.split(r'[._-]+', local) if part)
    return ''


def attendance_interval_seconds(intervals):
    total = 0
    for interval in intervals if isinstance(intervals, list) else []:
        if not isinstance(interval, dict):
            continue
        start = parse_graph_datetime(interval.get('joinDateTime'))
        end = parse_graph_datetime(interval.get('leaveDateTime'))
        if start and end and end >= start:
            total += int((end - start).total_seconds())
    return total


@csrf_exempt
def curriculum_teams_meeting_schedule(request, live_session_id):
    """Update the calendar-backed Teams event when the module schedule shifts."""
    from coach_api.views import get_graph_settings, has_graph_credentials, microsoft_graph_request

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)

    payload = json_body(request)
    if not isinstance(payload, dict):
        return json_error('A valid JSON body is required.')
    series = series_rows[0]
    organizer = clean_str(payload.get('organizerEmail') or series.get('organizer_email'))
    event_id = clean_str(payload.get('eventId') or series.get('graph_event_id'))
    if not organizer or not event_id:
        return json_error('This Teams meeting is missing organizer or calendar event identifiers.', status=409)

    graph_settings = get_graph_settings()
    title = clean_str(payload.get('title') or series.get('module_title') or 'Live session')
    local_start_raw = clean_str(payload.get('localStartDateTime'))
    utc_start_raw = clean_str(payload.get('startDateTimeUtc'))
    try:
        local_start = datetime.fromisoformat(local_start_raw)
        utc_start = datetime.fromisoformat(utc_start_raw.replace('Z', '+00:00'))
    except ValueError as exc:
        return json_error('A valid meeting start date and time is required.', status=400, detail=str(exc))

    duration = max(15, min(1440, int(payload.get('durationMinutes') or series.get('duration_minutes') or 60)))
    repeat = clean_str(payload.get('repeat') or series.get('repeat_pattern')).lower() or 'none'
    if repeat not in TEAMS_REPEAT_VALUES:
        return json_error('Unsupported repeat option.', status=400)
    occurrences = max(1, min(52, int(payload.get('repeatOccurrences') or series.get('repeat_occurrences') or 1)))
    event_patch = {
        'subject': title,
        'start': {
            'dateTime': local_start.replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': graph_settings.get('timezone') or series.get('timezone') or 'GMT Standard Time',
        },
        'end': {
            'dateTime': (local_start + timedelta(minutes=duration)).replace(second=0, microsecond=0).isoformat(timespec='seconds'),
            'timeZone': graph_settings.get('timezone') or series.get('timezone') or 'GMT Standard Time',
        },
    }
    recurrence = teams_event_recurrence(repeat, local_start, max(2, occurrences))
    event_patch['recurrence'] = recurrence if repeat != 'none' else None

    owner_key = urllib_parse.quote(organizer, safe='')
    event_key = urllib_parse.quote(event_id, safe='')
    try:
        event = microsoft_graph_request('PATCH', f'users/{owner_key}/events/{event_key}', payload=event_patch)
        if not isinstance(event, dict):
            event = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}')
    except RuntimeError as exc:
        logger.warning('Unable to update Module Builder Teams event schedule: %s', exc)
        return json_error('Microsoft Teams could not update the meeting schedule.', status=502, detail=str(exc))

    warnings = []
    supplied_occurrences = payload.get('scheduledOccurrences') if isinstance(payload.get('scheduledOccurrences'), list) else []
    if len(supplied_occurrences) > 1:
        target_occurrences = []
        for index, item in enumerate(supplied_occurrences):
            if not isinstance(item, dict):
                continue
            start = parse_graph_datetime(item.get('startDateTimeUtc'))
            if not start:
                continue
            try:
                item_duration = max(15, min(1440, int(item.get('durationMinutes') or duration)))
            except (TypeError, ValueError):
                item_duration = duration
            try:
                session_number = max(1, int(item.get('sessionNumber') or index + 1))
            except (TypeError, ValueError):
                session_number = index + 1
            target_occurrences.append({
                'session_number': session_number,
                'start': start,
                'end': start + timedelta(minutes=item_duration),
            })
        if target_occurrences:
            instance_start = (min(item['start'] for item in target_occurrences) - timedelta(days=7)).isoformat()
            instance_end = (max(item['end'] for item in target_occurrences) + timedelta(days=7)).isoformat()
            instance_query = urllib_parse.urlencode({
                'startDateTime': instance_start,
                'endDateTime': instance_end,
            })
            try:
                instance_response = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}/instances?{instance_query}')
                instances = instance_response.get('value') if isinstance(instance_response, dict) else []
                instances = sorted(instances, key=lambda item: clean_str((item.get('start') or {}).get('dateTime')))
                target_by_key = {
                    teams_calendar_minute_key(target['start']): target
                    for target in target_occurrences
                }
                invited_people = teams_series_email_list(series.get('presenters'), series.get('attendees'))
                paired_instances = []
                for index, target in enumerate(sorted(target_occurrences, key=lambda item: item['session_number'])):
                    if index >= len(instances):
                        break
                    paired_instances.append((instances[index], target))
                for instance, target in reversed(paired_instances):
                    instance_id = clean_str(instance.get('id'))
                    if not instance_id:
                        continue
                    current_key = teams_calendar_minute_key((instance.get('start') or {}).get('dateTime'))
                    target_key = teams_calendar_minute_key(target['start'])
                    if current_key and current_key == target_key:
                        continue
                    instance_key = urllib_parse.quote(instance_id, safe='')
                    try:
                        microsoft_graph_request('PATCH', f'users/{owner_key}/events/{instance_key}', payload={
                            'start': {'dateTime': target['start'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                            'end': {'dateTime': target['end'].replace(second=0, microsecond=0).isoformat(timespec='seconds'), 'timeZone': 'UTC'},
                        })
                    except RuntimeError as exc:
                        microsoft_graph_request(
                            'POST',
                            f'users/{owner_key}/events',
                            payload=teams_single_occurrence_payload(title, target, invited_people),
                        )
                        microsoft_graph_request('DELETE', f'users/{owner_key}/events/{instance_key}')
                        warnings.append({
                            'code': 'teams_shifted_occurrence_recreated',
                            'message': 'Microsoft Teams could not move a recurring occurrence across the series boundary, so it was recreated on the wizard date and the old occurrence was removed.',
                            'detail': str(exc),
                        })
                instance_response = microsoft_graph_request('GET', f'users/{owner_key}/events/{event_key}/instances?{instance_query}')
                instances = instance_response.get('value') if isinstance(instance_response, dict) else []
                for instance in instances:
                    instance_id = clean_str(instance.get('id'))
                    current_key = teams_calendar_minute_key((instance.get('start') or {}).get('dateTime'))
                    if instance_id and current_key and current_key not in target_by_key:
                        microsoft_graph_request('DELETE', f'users/{owner_key}/events/{urllib_parse.quote(instance_id, safe="")}')
            except RuntimeError as exc:
                logger.warning('Unable to update individual Teams event instances: %s', exc)
                warnings.append({
                    'code': 'teams_individual_occurrences_not_updated',
                    'message': 'Microsoft Teams updated the meeting series, but could not update shifted individual sessions.',
                    'detail': str(exc),
                })

    join_url = clean_str((event.get('onlineMeeting') or {}).get('joinUrl')) or clean_str(series.get('join_url'))
    occurrence_rows = replace_live_session_occurrences(
        live_session_id,
        payload,
        utc_start,
        duration,
        repeat,
        occurrences,
        event_id=event_id,
        join_url=join_url,
    )
    update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
        'module_title': title,
        'start_datetime': utc_start,
        'duration_minutes': duration,
        'repeat_pattern': repeat,
        'repeat_occurrences': occurrences if repeat != 'none' else 1,
        'join_url': join_url,
        'web_link': clean_str(event.get('webLink')) or clean_str(series.get('web_link')),
        'updated_at': datetime.utcnow(),
    })
    return JsonResponse({
        'updated': True,
        'meeting': {
            'liveSessionId': live_session_id,
            'eventId': event_id,
            'joinUrl': join_url,
            'webLink': clean_str(event.get('webLink')) or clean_str(series.get('web_link')),
            'startDateTimeUtc': utc_start.isoformat(),
            'durationMinutes': duration,
            'repeat': repeat,
            'repeatOccurrences': occurrences if repeat != 'none' else 1,
            'trackedOccurrences': len(occurrence_rows),
        },
        'warnings': warnings,
    })


def upsert_live_session_artifact(occurrence, artifact_type, artifact):
    graph_id = clean_str(artifact.get('id'))
    if not graph_id:
        return False
    authoring_upsert(LIVE_SESSION_ARTIFACTS_TABLE, ['occurrence_id', 'artifact_type', 'graph_artifact_id'], {
        'id': f'ART-{uuid.uuid4().hex.upper()}',
        'occurrence_id': occurrence['id'],
        'artifact_type': artifact_type,
        'graph_artifact_id': graph_id,
        'call_id': clean_str(artifact.get('callId')),
        'content_correlation_id': clean_str(artifact.get('contentCorrelationId')),
        'content_url': clean_str(
            artifact.get('transcriptContentUrl') if artifact_type == 'transcript'
            else artifact.get('recordingContentUrl')
        ),
        'created_datetime': parse_graph_datetime(artifact.get('createdDateTime')),
        'end_datetime': parse_graph_datetime(artifact.get('endDateTime')),
        'metadata': json_db_value(artifact),
    })
    return True


@csrf_exempt
def curriculum_teams_meeting_artifacts(request, live_session_id):
    """Read the tracked lecture plan or pull completed artifacts from Graph."""
    from coach_api.views import has_graph_credentials, microsoft_graph_request

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    series = series_rows[0]
    occurrences = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'live_session_id = %s',
        [live_session_id],
        'session_number asc',
    )
    if request.method == 'GET':
        for occurrence in occurrences:
            occurrence['attendance'] = authoring_fetch_all(
                LIVE_SESSION_ATTENDANCE_TABLE, 'occurrence_id = %s', [occurrence['id']], 'display_name asc'
            )
            for attendance in occurrence['attendance']:
                attendance['intervals'] = parse_json_value(attendance.get('intervals'), [])
                attendance['raw_data'] = parse_json_value(attendance.get('raw_data'), {})
                if not clean_str(attendance.get('display_name')):
                    attendance['display_name'] = attendance_display_name({
                        **attendance['raw_data'],
                        'emailAddress': attendance.get('email') or attendance['raw_data'].get('emailAddress'),
                    })
            occurrence['artifacts'] = authoring_fetch_all(
                LIVE_SESSION_ARTIFACTS_TABLE, 'occurrence_id = %s', [occurrence['id']], 'artifact_type asc'
            )
            for artifact in occurrence['artifacts']:
                artifact['metadata'] = parse_json_value(artifact.get('metadata'), {})
        return JsonResponse({'series': series, 'occurrences': occurrences})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    if not has_graph_credentials():
        return json_error('Microsoft Graph credentials are not configured.', status=503)
    organizer = clean_str(series.get('organizer_email'))
    meeting_id = clean_str(series.get('online_meeting_id'))
    join_url = clean_str(series.get('join_url'))
    if organizer and not meeting_id and join_url:
        try:
            graph_meeting = teams_online_meeting_from_join_url(organizer, join_url)
        except RuntimeError as exc:
            logger.warning('Unable to backfill onlineMeeting ID for %s: %s', live_session_id, exc)
            return json_error(
                'The Teams meeting exists, but Microsoft Graph cannot resolve it for tracking. '
                'Grant OnlineMeetings.Read.All and an application access policy to the organizer, then retry.',
                status=409,
                detail=str(exc),
            )
        meeting_id = clean_str(graph_meeting.get('id'))
        if meeting_id:
            update_authoring_rows(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id], {
                'online_meeting_id': meeting_id,
                'meeting_options_url': clean_str(graph_meeting.get('meetingOptionsWebUrl')) or series.get('meeting_options_url'),
                'updated_at': datetime.utcnow(),
            })
    if not organizer or not meeting_id:
        return json_error(
            'The Teams meeting exists, but its online meeting ID is not available yet. '
            'Grant OnlineMeetings.Read.All and an application access policy to the organizer, then retry.',
            status=409,
        )
    owner_key = urllib_parse.quote(teams_online_meeting_owner_id(organizer, join_url), safe='')
    meeting_key = urllib_parse.quote(meeting_id, safe='')
    base = f'users/{owner_key}/onlineMeetings/{meeting_key}'
    errors = []
    synced = {'attendanceReports': 0, 'attendanceRecords': 0, 'transcripts': 0, 'recordings': 0}
    now = datetime.utcnow()

    try:
        response = microsoft_graph_request('GET', f'{base}/attendanceReports')
        for report in response.get('value') or []:
            report_id = clean_str(report.get('id'))
            report_start = parse_graph_datetime(report.get('meetingStartDateTime'))
            occurrence = closest_live_occurrence(occurrences, report_start)
            if not occurrence or not report_id:
                continue
            report_key = urllib_parse.quote(report_id, safe='')
            detail = microsoft_graph_request('GET', f'{base}/attendanceReports/{report_key}?$expand=attendanceRecords')
            records = detail.get('attendanceRecords') or []
            update_authoring_rows(LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', [occurrence['id']], {
                'attendance_report_id': report_id,
                'participant_count': int(detail.get('totalParticipantCount') or len(records)),
                'actual_start': parse_graph_datetime(detail.get('meetingStartDateTime')),
                'actual_end': parse_graph_datetime(detail.get('meetingEndDateTime')),
                'status': 'completed',
                'artifacts_synced_at': now,
                'last_sync_error': '',
            })
            for record in records:
                display_name, identity_id = attendance_identity(record)
                display_name = display_name or attendance_display_name(record)
                graph_record_id = clean_str(record.get('id') or identity_id or record.get('emailAddress'))
                stable_key = graph_record_id or uuid.uuid4().hex
                authoring_upsert(LIVE_SESSION_ATTENDANCE_TABLE, ['id'], {
                    'id': f'ATT-{uuid.uuid5(uuid.NAMESPACE_URL, occurrence["id"] + stable_key).hex.upper()}',
                    'occurrence_id': occurrence['id'],
                    'graph_record_id': graph_record_id,
                    'email': clean_str(record.get('emailAddress')).lower(),
                    'display_name': display_name,
                    'role': clean_str(record.get('role')),
                    'total_attendance_seconds': attendance_interval_seconds(record.get('attendanceIntervals')),
                    'intervals': json_db_value(record.get('attendanceIntervals') or []),
                    'raw_data': json_db_value(record),
                })
                synced['attendanceRecords'] += 1
            synced['attendanceReports'] += 1
    except RuntimeError as exc:
        errors.append(f'Attendance: {exc}')

    for artifact_type, endpoint in (('transcript', 'transcripts'), ('recording', 'recordings')):
        try:
            response = microsoft_graph_request('GET', f'{base}/{endpoint}')
            for artifact in response.get('value') or []:
                timestamp = (
                    parse_graph_datetime(artifact.get('endDateTime'))
                    or parse_graph_datetime(artifact.get('createdDateTime'))
                )
                occurrence = closest_live_occurrence(occurrences, timestamp)
                if occurrence and upsert_live_session_artifact(occurrence, artifact_type, artifact):
                    synced[f'{artifact_type}s'] += 1
                    update_authoring_rows(
                        LIVE_SESSION_OCCURRENCES_TABLE,
                        'id = %s',
                        [occurrence['id']],
                        {'artifacts_synced_at': now, 'last_sync_error': ''},
                    )
        except RuntimeError as exc:
            errors.append(f'{artifact_type.title()}: {exc}')

    try:
        from learner_api.teams_attendance import sync_verified_teams_attendance_reporting

        synced['reportingRows'] = sync_verified_teams_attendance_reporting(
            module_refs=[clean_str(series.get('module_catalogue_id'))],
        )
    except Exception as exc:
        logger.exception('Unable to refresh the learner attendance reporting table.')
        errors.append(f'Attendance reporting: {exc}')

    return JsonResponse({'synced': synced, 'errors': errors, 'partial': bool(errors)}, status=207 if errors else 200)


@require_GET
def curriculum_teams_meeting_artifact_content(request, live_session_id, artifact_id):
    """Proxy a tracked transcript or recording without exposing a Graph token."""
    from coach_api.views import get_graph_settings, microsoft_graph_token

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    series = series_rows[0]
    occurrences = authoring_fetch_all(
        LIVE_SESSION_OCCURRENCES_TABLE,
        'live_session_id = %s',
        [live_session_id],
    )
    occurrence_ids = {clean_str(row.get('id')) for row in occurrences}
    artifacts = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE, 'id = %s', [artifact_id])
    artifact = artifacts[0] if artifacts else None
    if not artifact or clean_str(artifact.get('occurrence_id')) not in occurrence_ids:
        return json_error('Meeting artifact not found.', status=404)

    artifact_type = clean_str(artifact.get('artifact_type')).lower()
    endpoint = 'transcripts' if artifact_type == 'transcript' else 'recordings' if artifact_type == 'recording' else ''
    if not endpoint:
        return json_error('Unsupported meeting artifact.', status=400)

    organizer = clean_str(series.get('organizer_email'))
    meeting_id = clean_str(series.get('online_meeting_id'))
    join_url = clean_str(series.get('join_url'))
    owner_id = teams_online_meeting_owner_id(organizer, join_url)
    graph_artifact_id = clean_str(artifact.get('graph_artifact_id'))
    if not owner_id or not meeting_id or not graph_artifact_id:
        return json_error('The meeting artifact is missing its Graph identifiers.', status=409)

    path = (
        f'users/{urllib_parse.quote(owner_id, safe="")}/onlineMeetings/'
        f'{urllib_parse.quote(meeting_id, safe="")}/{endpoint}/'
        f'{urllib_parse.quote(graph_artifact_id, safe="")}/content'
    )
    graph_settings = get_graph_settings()
    url = f'{graph_settings["base_url"].rstrip("/")}/{path}'
    graph_request = urllib_request.Request(
        url,
        headers={
            'Authorization': f'Bearer {microsoft_graph_token()}',
            'Accept': 'text/vtt' if artifact_type == 'transcript' else 'video/mp4',
        },
        method='GET',
    )
    try:
        graph_response = urllib_request.urlopen(graph_request, timeout=45)
    except urllib_error.HTTPError as exc:
        detail = exc.read().decode('utf-8', errors='ignore')
        logger.warning('Unable to fetch Teams %s content: %s %s', artifact_type, exc.code, detail)
        return json_error(f'Microsoft Graph could not return the {artifact_type} content.', status=exc.code)
    except urllib_error.URLError as exc:
        logger.warning('Unable to fetch Teams %s content: %s', artifact_type, exc)
        return json_error(f'Microsoft Graph could not return the {artifact_type} content.', status=502)

    content_type = graph_response.headers.get('Content-Type') or ('text/vtt' if artifact_type == 'transcript' else 'video/mp4')
    filename = f'{live_session_id}-{artifact_type}.{"vtt" if artifact_type == "transcript" else "mp4"}'
    if artifact_type == 'recording':
        return FileResponse(
            graph_response,
            as_attachment=clean_str(request.GET.get('preview')).lower() not in {'1', 'true', 'yes'},
            filename=filename,
            content_type=content_type,
        )
    content = graph_response.read()
    graph_response.close()
    response = HttpResponse(content, content_type=content_type)
    response['Content-Disposition'] = f'inline; filename="{filename}"'
    return response


def safe_float(value, default=0.0):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number or number in (float('inf'), float('-inf')):
        return default
    return number


def parse_client_event_time(value):
    parsed = parse_graph_datetime(value)
    if not parsed:
        return datetime.utcnow()
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


@csrf_exempt
def curriculum_teams_recording_events(request, live_session_id, artifact_id):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    ensure_live_session_tracking_tables()
    series_rows = authoring_fetch_all(LIVE_SESSIONS_TABLE, 'id = %s', [live_session_id])
    if not series_rows:
        return json_error('Live session series not found.', status=404)
    occurrences = authoring_fetch_all(LIVE_SESSION_OCCURRENCES_TABLE, 'live_session_id = %s', [live_session_id])
    occurrence_by_id = {clean_str(row.get('id')): row for row in occurrences}
    artifacts = authoring_fetch_all(LIVE_SESSION_ARTIFACTS_TABLE, 'id = %s', [artifact_id])
    artifact = artifacts[0] if artifacts else None
    occurrence_id = clean_str((artifact or {}).get('occurrence_id'))
    if not artifact or occurrence_id not in occurrence_by_id:
        return json_error('Meeting recording not found.', status=404)
    if clean_str(artifact.get('artifact_type')).lower() != 'recording':
        return json_error('Only recording artifacts can receive recording tracking events.', status=400)

    viewer = payload.get('viewer') if isinstance(payload.get('viewer'), dict) else {}
    browser = payload.get('browser') if isinstance(payload.get('browser'), dict) else {}
    preview_session_id = clean_str(payload.get('previewSessionId'))[:128] or uuid.uuid4().hex
    events = payload.get('events') if isinstance(payload.get('events'), list) else []
    if not events:
        return json_error('No recording events were supplied.', status=400)

    now = datetime.utcnow()
    saved = 0
    for event in events[:200]:
        if not isinstance(event, dict):
            continue
        event_type = clean_str(event.get('type') or event.get('eventType'))[:64]
        if not event_type:
            continue
        video_time = max(0.0, safe_float(event.get('videoTimeSeconds') if 'videoTimeSeconds' in event else event.get('videoTime'), 0.0))
        previous_video_time = event.get('previousVideoTimeSeconds') if 'previousVideoTimeSeconds' in event else event.get('previousVideoTime')
        previous_video_time = None if previous_video_time is None else max(0.0, safe_float(previous_video_time, 0.0))
        skip_from = event.get('skipFromSeconds') if 'skipFromSeconds' in event else event.get('skipFrom')
        skip_to = event.get('skipToSeconds') if 'skipToSeconds' in event else event.get('skipTo')
        skip_from = None if skip_from is None else max(0.0, safe_float(skip_from, 0.0))
        skip_to = None if skip_to is None else max(0.0, safe_float(skip_to, 0.0))
        skip_delta = None
        if skip_from is not None and skip_to is not None:
            skip_delta = skip_to - skip_from
        metadata = event.get('metadata') if isinstance(event.get('metadata'), dict) else {}
        insert_row(LIVE_SESSION_RECORDING_EVENTS_TABLE, {
            'id': clean_str(event.get('id'))[:128] or uuid.uuid4().hex,
            'live_session_id': live_session_id,
            'occurrence_id': occurrence_id,
            'artifact_id': artifact_id,
            'preview_session_id': preview_session_id,
            'event_type': event_type,
            'viewer_id': clean_str(viewer.get('id'))[:255],
            'viewer_email': clean_str(viewer.get('email')).lower()[:320],
            'viewer_name': clean_str(viewer.get('name'))[:500],
            'viewer_role': clean_str(viewer.get('role'))[:128],
            'browser_session_id': clean_str(browser.get('sessionId') or payload.get('browserSessionId'))[:128],
            'client_event_id': clean_str(event.get('clientEventId') or event.get('id'))[:128],
            'event_time': parse_client_event_time(event.get('eventTime') or event.get('timestamp')) if event.get('eventTime') or event.get('timestamp') else now,
            'video_time_seconds': video_time,
            'previous_video_time_seconds': previous_video_time,
            'duration_seconds': None if event.get('durationSeconds') is None else max(0.0, safe_float(event.get('durationSeconds'), 0.0)),
            'watched_seconds_delta': max(0.0, safe_float(event.get('watchedSecondsDelta'), 0.0)),
            'playback_rate': max(0.0, safe_float(event.get('playbackRate'), 1.0)),
            'volume': None if event.get('volume') is None else max(0.0, min(1.0, safe_float(event.get('volume'), 0.0))),
            'muted': bool_payload(event.get('muted')) if event.get('muted') is not None else None,
            'skipped': bool_payload(event.get('skipped')) or event_type in {'seeked', 'seek_end', 'skip'},
            'skip_from_seconds': skip_from,
            'skip_to_seconds': skip_to,
            'skip_delta_seconds': skip_delta,
            'viewport_width': parse_int(browser.get('viewportWidth'), 0) or None,
            'viewport_height': parse_int(browser.get('viewportHeight'), 0) or None,
            'user_agent': clean_str(browser.get('userAgent') or request.META.get('HTTP_USER_AGENT'))[:1000],
            'page_url': clean_str(browser.get('pageUrl'))[:1000],
            'referrer': clean_str(browser.get('referrer') or request.META.get('HTTP_REFERER'))[:1000],
            'metadata': json.dumps(metadata),
        })
        saved += 1

    return JsonResponse({'saved': saved, 'previewSessionId': preview_session_id})


def require_fields(payload, fields):
    missing = [field for field in fields if payload.get(field) in (None, '')]
    return missing


def clean_str(value):
    return str(value or '').strip()


def programme_structure_type(payload, fallback='scheduled'):
    value = clean_str((payload or {}).get('structureType') or (payload or {}).get('structure_type') or fallback).lower()
    return value if value in {'scheduled', 'free'} else fallback


def now_iso():
    return datetime.utcnow().isoformat()


def insert_row(table, payload):
    values = filtered_payload(table, payload)
    if not values:
        raise ValueError(f'No writable columns found for {table}.')
    columns = list(values.keys())
    placeholders = ', '.join(['%s'] * len(columns))
    query = (
        f'insert into {table_name(table)} '
        f'({", ".join(quote_ident(column) for column in columns)}) '
        f'values ({placeholders}) returning *'
    )
    return execute_returning(query, [values[column] for column in columns])[0]


def update_rows(table, where_sql, where_params, payload):
    values = filtered_payload(table, payload)
    if not values:
        raise ValueError(f'No writable columns found for {table}.')
    assignments = ', '.join(f'{quote_ident(column)} = %s' for column in values)
    query = f'update {table_name(table)} set {assignments} where {where_sql} returning *'
    return execute_returning(query, [*values.values(), *where_params])


def delete_rows(table, where_sql, where_params):
    query = f'delete from {table_name(table)} where {where_sql} returning *'
    return execute_returning(query, where_params)


def append_notes_meta(notes, meta):
    existing = []
    keys = set(meta)
    for line in str(notes or '').splitlines():
        if line.startswith('__') and ':' in line:
            key = line.split(':', 1)[0].strip('_')
            if key in keys:
                continue
        existing.append(line)
    for key, value in meta.items():
        existing.append(f'__{key}: {value}')
    return '\n'.join(line for line in existing if line != '').strip()


def remove_notes_meta(notes, keys):
    blocked = set(keys)
    lines = []
    for line in str(notes or '').splitlines():
        if line.startswith('__') and ':' in line:
            key = line.split(':', 1)[0].strip('_')
            if key in blocked:
                continue
        lines.append(line)
    return '\n'.join(line for line in lines if line != '').strip()


def archive_payload(table, existing_notes=None):
    payload = {}
    if has_column(table, 'status'):
        payload['status'] = 'archived'
    if has_column(table, 'is_archived'):
        payload['is_archived'] = True
    if has_column(table, 'is_active'):
        payload['is_active'] = False
    notes_column = 'notes' if has_column(table, 'notes') else ('Notes' if has_column(table, 'Notes') else None)
    if notes_column:
        payload[notes_column] = append_notes_meta(existing_notes, {'archived': 'true', 'archived_at': now_iso()})
    return payload


def restore_payload(table, existing_notes=None):
    payload = {}
    if has_column(table, 'status'):
        payload['status'] = 'active'
    if has_column(table, 'is_archived'):
        payload['is_archived'] = False
    if has_column(table, 'is_active'):
        payload['is_active'] = True
    notes_column = 'notes' if has_column(table, 'notes') else ('Notes' if has_column(table, 'Notes') else None)
    if notes_column:
        payload[notes_column] = remove_notes_meta(existing_notes, {'archived', 'archived_at'})
    return payload


def parse_json_value(value, fallback):
    if value in (None, ''):
        return fallback
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def parse_int(value, default=0):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def parse_float(value, default=0):
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return default


def component_expected_otjh(component, default=2):
    component = component or {}
    if component.get('expectedOtjh') not in (None, ''):
        return parse_float(component.get('expectedOtjh'), default)
    if component.get('expected_otjh') not in (None, ''):
        return parse_float(component.get('expected_otjh'), default)
    return default


def parse_date(value):
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).strip()).date()
    except ValueError:
        return None


def format_date(value):
    parsed = parse_date(value)
    return parsed.isoformat() if parsed else ''


def calculate_cohort_end_date(start_value, duration_months):
    start = parse_date(start_value)
    months = parse_int(duration_months, 0)
    if not start or months <= 0:
        return None

    # Curriculum convention: a 24 month cohort starting 2026-09-01 ends 2028-08-31.
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return date(year, month, day) - timedelta(days=1)


WEEKDAY_INDEX = {
    'monday': 0,
    'mon': 0,
    'tuesday': 1,
    'tue': 1,
    'wednesday': 2,
    'wed': 2,
    'thursday': 3,
    'thu': 3,
    'friday': 4,
    'fri': 4,
    'saturday': 5,
    'sat': 5,
    'sunday': 6,
    'sun': 6,
}


def parse_delivery_days(value):
    if isinstance(value, list):
        tokens = value
    else:
        tokens = re.split(r'[,/|+&\s]+', str(value or '').lower())
    days = []
    for token in tokens:
        key = str(token).strip().lower()
        if key in WEEKDAY_INDEX and WEEKDAY_INDEX[key] not in days:
            days.append(WEEKDAY_INDEX[key])
    return days


def build_group_schedule(week_days='', start_time='', end_time='', fallback=''):
    """Persist group delivery day and time in one schedule string."""
    days = ', '.join(clean_str(day) for day in week_days if clean_str(day)) if isinstance(week_days, list) else clean_str(week_days)
    start = clean_str(start_time)
    end = clean_str(end_time)
    if days and start and end:
        return f'{days} {start}-{end}'
    if days and start:
        return f'{days} {start}'
    return days or clean_str(fallback)


def schedule_time_parts(value):
    text = clean_str(value)
    match = re.search(r'(\d{1,2}:?\d{2}\s*(?:AM|PM)?)\s*[-–]\s*(\d{1,2}:?\d{2}\s*(?:AM|PM)?)', text, re.I)
    if not match:
        return '', ''
    return clean_str(match.group(1)), clean_str(match.group(2))


def holiday_date_set(holidays):
    dates = set()
    for item in holidays or []:
        if isinstance(item, dict):
            start = parse_date(item.get('startDate') or item.get('start_date') or item.get('date'))
            end = parse_date(item.get('endDate') or item.get('end_date') or item.get('date')) or start
        else:
            start = parse_date(item)
            end = start
        if not start:
            continue
        cursor = start
        while cursor <= end:
            dates.add(cursor)
            cursor += timedelta(days=1)
    return dates


def build_module_session_plan(start_value, number_of_sessions, delivery_days, holidays=None):
    start = parse_date(start_value)
    session_count = parse_int(number_of_sessions, 0)
    days = parse_delivery_days(delivery_days)
    warnings = []

    if not start:
        warnings.append('Set module start date before calculating module end date.')
    if session_count <= 0:
        warnings.append('Set a positive number of sessions before calculating module end date.')
    if not days:
        warnings.append('Set group delivery day/time before calculating module end date.')
    if warnings:
        return {
            'sessions': [],
            'skippedHolidays': [],
            'finalEndDate': '',
            'warnings': warnings,
        }

    selected_holidays = holiday_date_set(holidays)
    sessions = []
    skipped = []
    pending_skipped = []
    cursor = start
    guard_days = max(3650, session_count * 21)
    while len(sessions) < session_count and guard_days > 0:
        if cursor.weekday() in days:
            if cursor in selected_holidays:
                skipped.append(cursor.isoformat())
                pending_skipped.append(cursor.isoformat())
            else:
                sessions.append({
                    'sessionNumber': len(sessions) + 1,
                    'date': cursor.isoformat(),
                    'day': cursor.strftime('%A'),
                    'skippedHolidays': pending_skipped,
                })
                pending_skipped = []
        cursor += timedelta(days=1)
        guard_days -= 1

    if len(sessions) < session_count:
        warnings.append('Could not generate the full session plan from the supplied delivery pattern.')

    return {
        'sessions': sessions,
        'skippedHolidays': skipped,
        'finalEndDate': sessions[-1]['date'] if sessions else '',
        'warnings': warnings,
    }


def slugify(value):
    slug = re.sub(r'[^a-z0-9]+', '-', str(value).lower()).strip('-')
    return slug or 'item'


def unique_prefixed_id(prefix, value='', existing_values=None):
    requested = clean_str(value)
    existing = {clean_str(value) for value in (existing_values or []) if clean_str(value)}
    if re.match(rf'^{re.escape(prefix)}-[A-Z0-9][A-Z0-9_-]*$', requested, re.I):
        return requested if requested not in existing else requested

    while True:
        candidate = f'{prefix}-{datetime.utcnow().strftime("%Y%m%d%H%M%S%f")}'
        if candidate not in existing:
            return candidate


def unique_program_id(value, configs):
    return unique_prefixed_id('PROG', value, [programme_config_id(config) for config in configs if programme_config_id(config)])


def unique_ksb_profile_id(value='', existing_values=None):
    requested = clean_str(value)
    existing = {clean_str(value) for value in (existing_values or []) if clean_str(value)}
    if requested.startswith('PROG-'):
        requested = f'KSBP-{requested.removeprefix("PROG-")}'
    return unique_prefixed_id('KSBP', requested, existing)


def existing_training_meta_ids(key):
    return [
        row.get('_meta', {}).get(key)
        for row in get_training_rows()
        if row.get('_meta', {}).get(key)
    ]


def unique_cohort_id(value=''):
    existing = [detail.get('cohortId') for detail in cohort_authoring_detail_rows() if detail.get('cohortId')]
    return unique_prefixed_id('COHORT', value, existing)


def unique_group_id(value=''):
    existing = [detail.get('id') for detail in group_authoring_detail_rows() if detail.get('id')]
    return unique_prefixed_id('GROUP', value, existing)


def normalise(value):
    return re.sub(r'[^a-z0-9]+', '', str(value).lower())


def truthy(value):
    return str(value).strip().lower() in {'1', 'true', 'yes', 'y', 'on'}


def falsey(value):
    return str(value).strip().lower() in {'0', 'false', 'no', 'n', 'off'}


def is_operational_training_row(row):
    if truthy(row.get('is_archived')):
        return False

    meta = row.get('_meta', {})
    for key in ('hidden', 'is_hidden', 'deleted', 'is_deleted', 'archived', 'is_archived', 'inactive', 'disabled'):
        if key in meta and truthy(meta.get(key)):
            return False

    for key in ('active', 'is_active', 'visible', 'is_visible', 'operational', 'is_operational'):
        if key in meta and falsey(meta.get(key)):
            return False

    return True


def is_archived_program_config(config):
    return bool(config) and (
        truthy(config.get('is_archived'))
        or truthy(config.get('archived'))
        or falsey(config.get('is_active'))
    )


def curriculum_visibility(request):
    if truthy(request.GET.get('include_archived')):
        return 'all'
    visibility = str(request.GET.get('visibility') or 'operational').strip().lower()
    return 'all' if visibility == 'all' else 'operational'


def title_case_status(is_archived, start_value, end_value):
    if is_archived:
        return 'archived'

    today = date.today()
    start = parse_date(start_value)
    end = parse_date(end_value)
    if start and start > today:
        return 'planned'
    if end and end < today:
        return 'completed'
    return 'active'


def delivery_status_for_training_row(row):
    row = row or {}
    if '_meta' not in row:
        row = {**row, '_meta': extract_notes_meta(row.get('notes'))}
    if not is_operational_training_row(row):
        return 'archived'

    today = date.today()
    start = parse_date(row.get('start_date') or row.get('Starting_date_lable'))
    end = parse_date(row.get('end_date'))
    if start and today < start:
        return 'not_started'
    if start and end:
        if start <= today <= end:
            return 'active'
        if today > end:
            return 'completed'
    return 'unknown'


def extract_notes_meta(notes):
    meta = {}
    for line in str(notes or '').splitlines():
        if not line.startswith('__') or ':' not in line:
            continue
        key, value = line.split(':', 1)
        meta[key.strip('_')] = value.strip()
    return meta


def parse_notes_id_list(value):
    if isinstance(value, (list, tuple, set)):
        tokens = value
    else:
        tokens = re.split(r'[|,]+', str(value or ''))
    return [clean_str(token) for token in tokens if clean_str(token)]


def replace_visible_notes_preserving_meta(existing_notes, visible_notes):
    hidden_lines = [line for line in str(existing_notes or '').splitlines() if line.strip().startswith('__')]
    visible_lines = [line for line in str(visible_notes or '').splitlines() if not line.strip().startswith('__')]
    return '\n'.join([*visible_lines, *hidden_lines]).strip()


def visible_notes(notes):
    return '\n'.join(line for line in str(notes or '').splitlines() if not line.strip().startswith('__')).strip()


def codes_from_session_ksb(value):
    entries = parse_json_value(value, [])
    codes = set()
    if not isinstance(entries, list):
        return codes

    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for key in ('knowledgeCodes', 'skillCodes', 'behaviourCodes'):
            codes.update(str(code) for code in entry.get(key, []) if code)
    return codes


def ksb_type_label(type_code):
    return {
        'K': 'Knowledge',
        'S': 'Skill',
        'B': 'Behaviour',
    }.get(str(type_code).upper(), 'Knowledge')


def normalise_ksb_type(value):
    raw = str(value or '').strip().upper()
    if raw in {'K', 'KNOWLEDGE'}:
        return 'K'
    if raw in {'S', 'SKILL', 'SKILLS'}:
        return 'S'
    if raw in {'B', 'BEHAVIOUR', 'BEHAVIOURS', 'BEHAVIOR', 'BEHAVIORS'}:
        return 'B'
    return 'K'


def normalise_ksb_code(value, type_code=''):
    code = str(value or '').strip().upper()
    type_code = normalise_ksb_type(type_code)
    if code.startswith(type_code):
        code = code[1:]
    return re.sub(r'[^0-9.]', '', code)


def full_ksb_code(item):
    type_code = normalise_ksb_type(item.get('type'))
    code = normalise_ksb_code(item.get('code') or item.get('full_code'), type_code)
    return f'{type_code}{code}' if code else ''


def infer_level(name):
    match = re.search(r'\bL(?:evel\s*)?(\d)\b|lv(?:l)?\s*(\d)|level\s*(\d)', str(name), re.I)
    if not match:
        return ''
    level = next(group for group in match.groups() if group)
    return f'L{level}'


def unique(values):
    seen = set()
    result = []
    for value in values:
        if value in (None, '') or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def get_module_session_names(module_row):
    json_names = parse_json_value(module_row.get('session_names_json'), None)
    if isinstance(json_names, list):
        names = [str(name).strip() for name in json_names if str(name).strip()]
        if names:
            return names

    names = []
    for index in range(1, 31):
        value = module_row.get(f'session_name_{index}')
        if value:
            names.append(str(value).strip())
    return names


def get_ksb_profile_for_program(program_name, ksb_profiles):
    program_norm = normalise(program_name)
    if not program_norm:
        return None
    for profile in ksb_profiles:
        candidates = [
            profile.get('name'),
            *ksb_profile_context_ids(profile, 'programme_ids'),
        ]
        for candidate in candidates:
            candidate_norm = normalise(candidate)
            if candidate_norm == program_norm:
                return profile
    return None


def ksb_profile_required_codes(profile):
    if not profile:
        return []
    ksb_items = parse_json_value(profile.get('ksb_items'), [])
    if isinstance(ksb_items, list) and ksb_items:
        return unique([
            coverage_normalise_code(full_ksb_code(item))
            for item in ksb_items
            if isinstance(item, dict)
        ])
    return unique([
        coverage_normalise_code(code)
        for code in [
            *parse_json_value(profile.get('knowledge_codes'), []),
            *parse_json_value(profile.get('skill_codes'), []),
            *parse_json_value(profile.get('behaviour_codes'), []),
        ]
    ])


def ksb_profile_source_id(profile):
    public_id = clean_str((profile or {}).get('id'))
    if public_id.startswith('KSBP-'):
        return public_id
    return clean_str((profile or {}).get('ksb_profile_id')) or unique_ksb_profile_id((profile or {}).get('name') or '')


def ksb_profile_context_ids(profile, key, primary_value=''):
    values = parse_json_value((profile or {}).get(key), [])
    if not isinstance(values, list):
        values = []
    return unique([clean_str(primary_value), *[clean_str(value) for value in values]])


def payload_context_ids(payload, camel_key, snake_key, single_keys=()):
    values = payload.get(camel_key)
    if values is None:
        values = payload.get(snake_key)
    if not isinstance(values, list):
        values = []
    singles = [payload.get(key) for key in single_keys]
    return unique([*[clean_str(value) for value in values], *[clean_str(value) for value in singles]])


def unlink_programmes_from_other_ksb_profiles(active_profile_id, programme_values):
    targets = {normalise(value) for value in programme_values if normalise(value)}
    if not targets:
        return
    for row in get_ksb_profile_rows():
        row_id = clean_str(row.get('id'))
        if row_id == clean_str(active_profile_id):
            continue
        current_context = ksb_profile_context_ids(row, 'programme_ids')
        current_values = unique(current_context)
        if not any(normalise(value) in targets for value in current_values):
            continue
        next_context = [value for value in current_context if normalise(value) not in targets]
        update_rows('ksb_profiles', 'id = %s', [row_id], {
            'programme_ids': json.dumps(next_context),
            'updated_at': datetime.utcnow(),
        })


def cascade_ksb_profile_source_to_programme_modules(programme_values, source_id):
    source_id = clean_str(source_id)
    return set_programme_modules_ksb_source(programme_values, f'profile:{source_id}' if source_id else '')


def set_programme_modules_ksb_source(programme_values, source_value):
    raw_targets = unique([clean_str(value) for value in programme_values if clean_str(value)])
    targets = {normalise(value) for value in raw_targets if normalise(value)}
    source_value = clean_str(source_value)
    if not raw_targets:
        return 0
    ensure_module_authoring_tables()
    if connection.vendor == 'postgresql':
        placeholders = ', '.join(['%s'] * len(raw_targets))
        params = [source_value, datetime.utcnow(), *raw_targets]
        with connection.cursor() as cursor:
            cursor.execute(
                f'''
                update {authoring_table_name(AUTHORING_MODULES_TABLE)}
                set ksb_profile_source_id = %s, updated_at = %s
                where programme_id in ({placeholders})
                   or programme_name in ({placeholders})
                ''',
                [*params, *raw_targets],
            )
            return cursor.rowcount
    updated = 0
    for module in authoring_fetch_all(AUTHORING_MODULES_TABLE):
        module_programme_values = [
            module.get('programme_id'),
            module.get('programme_name'),
        ]
        if not any(normalise(value) in targets for value in module_programme_values):
            continue
        module_id = clean_str(module.get('module_catalogue_id'))
        if not module_id:
            continue
        update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
            'ksb_profile_source_id': source_value,
            'updated_at': datetime.utcnow(),
        })
        updated += 1
    return updated


def program_config_by_id(program_configs):
    configs = {}
    configs_by_name = {}
    for config in program_configs:
        config_id = programme_config_id(config)
        if config_id:
            configs[config_id] = config
        if config.get('name'):
            name_key = normalise(config.get('name'))
            current = configs_by_name.get(name_key)
            if not current or program_config_preference(config) > program_config_preference(current):
                configs_by_name[name_key] = config
    configs.update(configs_by_name)
    return configs


def programme_config_id(config):
    return clean_str((config or {}).get('programme_id') or (config or {}).get('id') or (config or {}).get('program_id'))


def programme_config_key_column():
    for column in ('programme_id', 'id', 'program_id'):
        try:
            if has_column('programmes', column):
                return column
        except Exception:
            continue
    return 'programme_id'


def program_config_preference(config):
    if not config:
        return (-1, 0, 0)
    updated = config.get('updated_at') or config.get('created_at')
    try:
        timestamp = updated.timestamp() if hasattr(updated, 'timestamp') else 0
    except Exception:
        timestamp = 0
    return (
        0 if is_archived_program_config(config) else 1,
        timestamp,
        parse_int(config.get('id'), 0),
    )


def unique_program_configs_for_display(program_configs):
    by_name = {}
    unnamed = []
    for config in program_configs:
        name_key = normalise(config.get('name'))
        if not name_key:
            unnamed.append(config)
            continue
        current = by_name.get(name_key)
        if not current or program_config_preference(config) > program_config_preference(current):
            by_name[name_key] = config
    return [*by_name.values(), *unnamed]


def programme_identity(row, program_configs_by_id):
    meta = row.get('_meta', {})
    program_id = meta.get('program_id')
    row_name = row.get('Program') or 'Unassigned Programme'
    if program_id:
        config = program_configs_by_id.get(str(program_id))
        name = (config or {}).get('name') or row_name
        canonical_config = config or program_configs_by_id.get(normalise(name))
        canonical_source_id = (canonical_config or {}).get('program_id') or program_id
        return {
            'key': f'name:{normalise(name)}',
            'sourceId': canonical_source_id,
            'name': (canonical_config or {}).get('name') or name,
            'config': canonical_config,
        }

    name = row_name
    config = program_configs_by_id.get(normalise(name))
    return {
        'key': f'name:{normalise(config.get("name") if config else name)}',
        'sourceId': config.get('program_id') if config and config.get('program_id') else slugify(name),
        'name': config.get('name') if config and config.get('name') else name,
        'config': config,
    }


def canonical_programme_name(row, program_configs_by_id):
    return programme_identity(row, program_configs_by_id)['name']


def actual_cohort_identity(row, programme_name):
    meta = row.get('_meta', {})
    cohort_name = clean_str(row.get('Cohort_name'))
    if not cohort_name:
        return None
    return {
        'id': clean_str(meta.get('cohort_id')) or f'{slugify(programme_name)}-{slugify(cohort_name)}',
        'name': cohort_name,
    }


def actual_group_identity(row, cohort_id):
    meta = row.get('_meta', {})
    group_name = clean_str(row.get('group_name') or meta.get('group_name'))
    if not group_name:
        return None
    return {
        'id': clean_str(meta.get('group_id')) or f'{cohort_id}-{slugify(group_name)}',
        'name': group_name,
    }


def is_actual_delivery_row(row, program_configs_by_id):
    if not clean_str(row.get('module_name')):
        return False
    identity = programme_identity(row, program_configs_by_id)
    cohort = actual_cohort_identity(row, identity['name'])
    if not cohort:
        return False
    return bool(actual_group_identity(row, cohort['id']))


def authoring_modules_as_training_rows():
    try:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
        group_rows = {clean_str(row.get('group_id')): row for row in authoring_fetch_all(GROUPS_TABLE)}
        cohort_rows = {clean_str(row.get('cohort_id')): row for row in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE)}
    except (Exception, AssertionError):
        logger.debug('Could not build fallback training rows from authoring tables.', exc_info=True)
        return []

    rows = []
    for module in module_rows:
        module_id = clean_str(module.get('module_catalogue_id'))
        group_id = clean_str(module.get('group_id'))
        cohort_id = clean_str(module.get('cohort_id'))
        if not group_id or not cohort_id:
            continue
        group = group_rows.get(group_id) or {}
        cohort = cohort_rows.get(cohort_id) or {}
        programme_id = clean_str(group.get('programme_id') or cohort.get('programme_id') or module.get('programme_id'))
        programme_name = clean_str(group.get('programme_name') or cohort.get('programme_name') or module.get('programme_name') or 'Unassigned programme')
        cohort_name = clean_str(group.get('cohort_name') or cohort.get('cohort_name') or module.get('cohort_name') or 'Unassigned cohort')
        group_name = clean_str(group.get('group_name') or module.get('group_name') or 'Unassigned group')
        meta = {
            'program_id': programme_id,
            'cohort_id': cohort_id,
            'group_id': group_id,
            'group_name': group_name,
            TRAINING_MODULE_CATALOGUE_COLUMN: module_id,
        }
        rows.append({
            'id': module_id,
            'Program': programme_name,
            'Cohort_name': cohort_name,
            'group_name': group_name,
            'module_name': module.get('title') or f'Module {module_id}',
            'status': clean_str(module.get('status') or 'draft').lower(),
            'sessions_number': module.get('sessions_number') or 0,
            'Tutor_name': module.get('tutor_name') or group.get('tutor_name') or '',
            'coach_name': group.get('coach_name') or '',
            'Starting_date_lable': cohort.get('start_date') or module.get('start_date'),
            'start_date': module.get('start_date') or group.get('start_date') or cohort.get('start_date'),
            'end_date': module.get('end_date') or group.get('end_date') or cohort.get('end_date'),
            'session_week_day': group.get('schedule') or '',
            'session_start_time': schedule_time_parts(group.get('schedule'))[0],
            'session_end_time': schedule_time_parts(group.get('schedule'))[1],
            'session_ksb_json': '[]',
            'notes': append_notes_meta(module.get('description') or '', meta),
            'is_archived': clean_str(module.get('status')).lower() == 'archived',
            TRAINING_MODULE_CATALOGUE_COLUMN: module_id,
            'programme_display_order': None,
            'cohort_display_order': None,
            '_meta': meta,
        })
    return rows


def authoring_modules_as_catalogue_rows():
    try:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
        week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE)
    except (Exception, AssertionError):
        logger.debug('Could not build fallback module catalogue rows from authoring tables.', exc_info=True)
        return []

    week_names_by_module = defaultdict(list)
    ordered_weeks = sorted(
        week_rows,
        key=lambda item: (
            clean_str(item.get('module_catalogue_id')),
            parse_int(item.get('display_order'), 0),
            parse_int(item.get('week_number'), 0),
        ),
    )
    for week in ordered_weeks:
        title = week.get('title') or f'Week {week.get("week_number") or ""}'.strip()
        week_names_by_module[clean_str(week.get('module_catalogue_id'))].append(title)

    rows = []
    for module in module_rows:
        module_id = clean_str(module.get('module_catalogue_id'))
        session_names = unique(week_names_by_module.get(module_id) or [])
        rows.append({
            'Module ID': module_id,
            'Module_name': module.get('title') or f'Module {module_id}',
            'Number of sessions': module.get('sessions_number') or len(session_names),
            'Module_colour': module.get('color') or '#6941c6',
            'Notes': module.get('description') or '',
            'session_names_json': json_db_value(session_names),
            'session_ksb_json': '[]',
        })
    return rows


def profile_matches_visible_programmes(profile, programmes):
    candidates = [
        profile.get('name'),
        *ksb_profile_context_ids(profile, 'programme_ids'),
    ]
    candidate_norms = [normalise(candidate) for candidate in candidates if normalise(candidate)]
    if not candidate_norms:
        return False

    for programme in programmes:
        programme_norms = [
            normalise(programme.get('name')),
            normalise(programme.get('standard')),
            normalise(programme.get('sourceId')),
        ]
        for candidate_norm in candidate_norms:
            if any(candidate_norm == value or candidate_norm in value or value in candidate_norm for value in programme_norms if value):
                return True
    return False


def _notes_with_authoring_meta(module_row, programme_row=None, cohort_row=None, group_row=None):
    module_row = module_row or {}
    programme_row = programme_row or {}
    cohort_row = cohort_row or {}
    group_row = group_row or {}
    notes = clean_str(module_row.get('notes'))
    meta = {
        'program_id': module_row.get('programme_id') or programme_row.get('program_id'),
        'cohort_id': module_row.get('cohort_id') or cohort_row.get('cohort_id') or group_row.get('cohort_id'),
        'cohort_end_date': module_row.get('end_date') or cohort_row.get('end_date') or group_row.get('end_date'),
        'group_id': module_row.get('group_id') or group_row.get('group_id'),
        'group_name': module_row.get('group_name') or group_row.get('group_name'),
        'coach_name': group_row.get('coach_name'),
        'module_catalogue_id': module_row.get('module_catalogue_id'),
        'module_color': module_row.get('color') or programme_row.get('color'),
    }
    meta_lines = [f'__{key}:{value}' for key, value in meta.items() if clean_str(value)]
    return '\n'.join([notes, *meta_lines]).strip()


def get_training_rows_from_authoring_tables():
    if not table_exists(AUTHORING_MODULES_TABLE):
        return []

    module_rows = fetch_all(f'''
        select *
        from {table_name(AUTHORING_MODULES_TABLE)}
        order by programme_id, cohort_name nulls last, group_name nulls last, start_date nulls last, title
    ''')
    programme_rows = fetch_all(f'select * from {table_name("programmes")}') if table_exists('programmes') else []
    cohort_rows = fetch_all(f'select * from {table_name("cohorts")}') if table_exists('cohorts') else []
    group_rows = fetch_all(f'select * from {table_name("groups")}') if table_exists('groups') else []

    programmes_by_id = {clean_str(row.get('program_id')): row for row in programme_rows if clean_str(row.get('program_id'))}
    cohorts_by_id = {clean_str(row.get('cohort_id')): row for row in cohort_rows if clean_str(row.get('cohort_id'))}
    groups_by_id = {clean_str(row.get('group_id')): row for row in group_rows if clean_str(row.get('group_id'))}

    rows = []
    for index, module in enumerate(module_rows, start=1):
        programme = programmes_by_id.get(clean_str(module.get('programme_id')), {})
        group = groups_by_id.get(clean_str(module.get('group_id')), {})
        cohort = cohorts_by_id.get(clean_str(module.get('cohort_id') or group.get('cohort_id')), {})
        programme_name = (
            clean_str(module.get('programme_name'))
            or clean_str(programme.get('name'))
            or clean_str(module.get('programme_id'))
            or 'Unassigned Programme'
        )
        cohort_name = clean_str(module.get('cohort_name')) or clean_str(cohort.get('cohort_name'))
        group_name = clean_str(module.get('group_name')) or clean_str(group.get('group_name'))
        start_date = module.get('start_date') or group.get('start_date') or cohort.get('start_date')
        end_date = module.get('end_date') or group.get('end_date') or cohort.get('end_date')
        status = clean_str(module.get('status') or programme.get('status')).lower()
        is_archived = (
            status == 'archived'
            or truthy(module.get('is_archived'))
            or truthy(programme.get('is_archived'))
            or falsey(programme.get('is_active'))
        )
        row = {
            'id': module.get('source_id') or module.get('module_catalogue_id') or index,
            'Program': programme_name,
            'module_name': module.get('title') or module.get('module_catalogue_id') or 'Module',
            'Cohort_name': cohort_name,
            'group_name': group_name,
            'status': clean_str(module.get('status') or programme.get('status') or 'draft').lower(),
            'Starting_date_lable': start_date,
            'start_date': start_date,
            'end_date': end_date,
            'sessions_number': parse_int(module.get('sessions_number'), 0),
            'session_week_day': clean_str(group.get('schedule')) or clean_str(group_name),
            'session_start_time': schedule_time_parts(group.get('schedule'))[0],
            'session_end_time': schedule_time_parts(group.get('schedule'))[1],
            'Tutor_name': group.get('tutor_name') or '',
            'coach_name': group.get('coach_name') or '',
            'notes': _notes_with_authoring_meta(module, programme, cohort, group),
            'is_archived': is_archived,
            'programme_display_order': None,
            'cohort_display_order': None,
            'session_ksb_json': '',
        }
        row['_meta'] = extract_notes_meta(row.get('notes'))
        rows.append(row)
    return rows


def get_training_rows():
    return authoring_modules_as_training_rows()


def get_module_rows():
    if not table_exists('Modules'):
        return authoring_modules_as_catalogue_rows()
    if not table_exists('Modules') and table_exists(AUTHORING_MODULES_TABLE):
        rows = fetch_all(f'''
            select *
            from {table_name(AUTHORING_MODULES_TABLE)}
            order by title, module_catalogue_id
        ''')
        return [
            {
                **row,
                'Module ID': row.get('module_catalogue_id'),
                'Module_name': row.get('title') or row.get('module_catalogue_id') or 'Module',
                'Number of sessions': row.get('sessions_number') or 0,
                'Module_colour': row.get('color') or '#6941c6',
                'Notes': row.get('description') or '',
                'session_ksb_json': '',
            }
            for row in rows
        ]

    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Modules"
        order by "Module_name", "Module ID"
    ''')


def get_ksb_profile_rows():
    if not table_exists('ksb_profiles'):
        return []
    return fetch_all(f'''
        select *
        from {table_name("ksb_profiles")}
        order by is_active desc, name
    ''')


def get_skills_england_ksb_rows():
    if not table_exists('standard_ksbs'):
        return []
    return fetch_all(f'''
        select *
        from {table_name("standard_ksbs")}
        order by standard_ref, standard_version, ksb_type, ksb_code, id
    ''')


def get_program_config_rows_raw():
    return fetch_all(f'''
        select *
        from {table_name("programmes")}
        order by name
    ''')


def update_programme_reference_table(table, old_id, new_id, programme_name):
    if not old_id or not new_id or old_id == new_id:
        return
    try:
        if not table_exists(table) or not has_column(table, 'programme_id'):
            return
        payload = {'programme_id': new_id}
        if has_column(table, 'programme_name'):
            payload['programme_name'] = programme_name
        update_rows(table, f'{quote_ident("programme_id")} = %s', [old_id], payload)
    except Exception:
        logger.debug('Could not reassign %s rows from programme %s to %s.', table, old_id, new_id, exc_info=True)


def merge_duplicate_program_configs_by_name():
    global _PROGRAMME_CONFIG_DEDUP_READY
    if _PROGRAMME_CONFIG_DEDUP_READY:
        return
    _PROGRAMME_CONFIG_DEDUP_READY = True
    try:
        configs = get_program_config_rows_raw()
    except Exception:
        logger.debug('Could not load programme configs for duplicate cleanup.', exc_info=True)
        return

    by_name = defaultdict(list)
    for config in configs:
        name_key = normalise(config.get('name'))
        if name_key:
            by_name[name_key].append(config)

    changed = False
    reference_tables = [
        AUTHORING_MODULES_TABLE,
        GROUPS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE,
    ]
    for duplicates in by_name.values():
        if len(duplicates) <= 1:
            continue
        canonical = max(duplicates, key=program_config_preference)
        canonical_id = clean_str(canonical.get('program_id') or canonical.get('id'))
        canonical_name = clean_str(canonical.get('name'))
        if not canonical_id:
            continue
        for duplicate in duplicates:
            duplicate_id = clean_str(duplicate.get('program_id') or duplicate.get('id'))
            if not duplicate_id or duplicate_id == canonical_id:
                continue
            for table in reference_tables:
                update_programme_reference_table(table, duplicate_id, canonical_id, canonical_name)
            try:
                key_column = programme_config_key_column()
                key_value = duplicate.get(key_column)
                if key_value is not None:
                    delete_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value])
                    changed = True
            except Exception:
                logger.debug('Could not delete duplicate programme config %s.', duplicate_id, exc_info=True)
    if changed:
        invalidate_curriculum_cache()


def get_program_config_rows():
    merge_duplicate_program_configs_by_name()
    return get_program_config_rows_raw()


def get_holiday_rows():
    source_table = holiday_table_name()
    if not source_table:
        return []
    return fetch_all(f'''
        select *
        from {table_name(source_table)}
        order by start_date, label
    ''')


def holiday_table_name():
    if table_exists('holidays'):
        return 'holidays'
    if table_exists('training_plan_holidays'):
        return 'training_plan_holidays'
    return ''


STAFF_PROFILE_TABLES = {
    'coach': 'coaches',
    'tutor': 'tutors',
}

# Legacy table names for staff profiles (may be empty if none).
STAFF_PROFILE_LEGACY_TABLES = {
    # example: 'tutor': 'Tutors',
}

STAFF_PROFILE_ASSIGNMENT_COLUMNS = {
    'coach': 'coach_name',
    'tutor': 'Tutor_name',
}

STAFF_PROFILE_ASSIGNMENT_DB_COLUMNS = {
    'coach': 'assigned_group_ids',
    'tutor': 'assigned_module_ids',
}


def ensure_staff_profile_tables():
    global _STAFF_PROFILE_TABLES_READY
    if _STAFF_PROFILE_TABLES_READY:
        return
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    timestamp_default = 'current_timestamp'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        for role, table in STAFF_PROFILE_TABLES.items():
            assignment_column = STAFF_PROFILE_ASSIGNMENT_DB_COLUMNS[role]
            cursor.execute(f'''
                create table if not exists {table_name(table)} (
                    id varchar(128) primary key,
                    name varchar(255) not null,
                    email varchar(255) not null default '',
                    phone varchar(64) not null default '',
                    job_title varchar(255) not null default '',
                    {assignment_column} {json_type},
                    notes text not null default '',
                    is_archived boolean not null default false,
                    created_at timestamp not null default {timestamp_default},
                    updated_at timestamp not null default {timestamp_default}
                )
            ''')
    for role, table in STAFF_PROFILE_TABLES.items():
        assignment_column = STAFF_PROFILE_ASSIGNMENT_DB_COLUMNS[role]
        stale_assignment_column = 'assigned_module_ids' if role == 'coach' else 'assigned_group_ids'
        ensure_columns(table, {
            'email': "varchar(255) not null default ''",
            'phone': "varchar(64) not null default ''",
            'job_title': "varchar(255) not null default ''",
            'status': "varchar(32) not null default 'active'",
            'specialisms': json_type,
            assignment_column: json_type,
            'notes': "text not null default ''",
            'is_archived': 'boolean not null default false',
            'created_at': f'timestamp not null default {timestamp_default}',
            'updated_at': f'timestamp not null default {timestamp_default}',
        })
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute(f'alter table {table_name(table)} drop column if exists {stale_assignment_column}')
                cursor.execute(f'create index if not exists curriculum_{table}_name_idx on {table_name(table)} (name)')
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.coaches', None)
    _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.tutors', None)
    _STAFF_PROFILE_TABLES_READY = True


def staff_profile_table(role):
    role = clean_str(role).lower()
    table = STAFF_PROFILE_TABLES.get(role)
    if not table:
        raise ValueError('Unsupported staff profile role.')
    ensure_staff_profile_tables()
    return table


def get_staff_profile_rows(role, include_archived=False):
    table = staff_profile_table(role)
    where = '' if include_archived else 'where coalesce(is_archived, false) = false'
    rows = fetch_all(f'''
        select *
        from {table_name(table)}
        {where}
        order by name
    ''')
    if rows or table_exists(table):
        return rows

    legacy_table = STAFF_PROFILE_LEGACY_TABLES.get(role)
    if not legacy_table or not table_exists(legacy_table):
        return []
    return fetch_all(f'''
        select *
        from {table_name(legacy_table)}
        order by name
    ''')


def get_tutor_rows():
    return get_staff_profile_rows('tutor')


def get_coach_rows():
    return get_staff_profile_rows('coach')


def get_tutor_module_rows():
    if not table_exists('Tutors_Modules'):
        return []
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Tutors_Modules"
        order by "Tutor_name", id
    ''')


def get_authoring_module_rows():
    try:
        return authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='programme_id, title')
    except Exception:
        logger.exception('Unable to read module authoring modules for curriculum payload.')
        return []


def build_staff_profiles_from_training(training_rows, column_name, profile_prefix):
    profiles = {}
    for row in training_rows:
        name = clean_str(row.get(column_name))
        if not name or normalise(name) == 'unassigned':
            continue
        key = normalise(name)
        if key in profiles:
            continue
        profiles[key] = {
            'id': f'{profile_prefix}-{slugify(name)}',
            'name': name,
        }
    return sorted(profiles.values(), key=lambda item: item['name'].lower())


def staff_profile_name(profile):
    return clean_str(
        profile.get('name')
        or profile.get('Tutor_name')
        or profile.get('Coach_name')
        or profile.get('email')
    )


def staff_profile_email(profile):
    return clean_str((profile or {}).get('email'))


def staff_assignment_key(value):
    return normalise(value)


def staff_profile_identity_key(name='', email=''):
    email_key = normalise(email)
    if email_key:
        return f'email:{email_key}'
    name_key = staff_assignment_key(name)
    if name_key and name_key != 'unassigned':
        return f'name:{name_key}'
    return ''


def staff_profile_identity_key_for_row(row):
    row = row or {}
    return staff_profile_identity_key(staff_profile_name(row), staff_profile_email(row))


def staff_profile_is_archived(row):
    row = row or {}
    return truthy(row.get('is_archived')) or clean_str(row.get('status')).lower() == 'archived'


def canonical_staff_assignment_name(role, value, include_archived=True):
    assignment = clean_str(value)
    if not assignment or staff_assignment_key(assignment) == 'unassigned':
        return ''
    row = find_staff_profile_row(role, assignment, include_archived=include_archived)
    return staff_profile_name(row) or assignment


def staff_profile_rows_by_identity(role, name='', email='', include_archived=True, exclude_id=''):
    key = staff_profile_identity_key(name, email)
    excluded = clean_str(exclude_id)
    if not key or key == 'unassigned':
        return []
    return [
        row
        for row in get_staff_profile_rows(role, include_archived=include_archived)
        if clean_str(row.get('id')) != excluded and staff_profile_identity_key_for_row(row) == key
    ]


def staff_profile_assignment_ids(role, row):
    column = STAFF_PROFILE_ASSIGNMENT_DB_COLUMNS.get(role)
    if not column:
        return []
    return clean_assignment_ids(as_json_value((row or {}).get(column), []))


def staff_profile_row_preference(role, row):
    row = row or {}
    populated_fields = sum(
        1
        for key in ('email', 'phone', 'job_title', 'notes')
        if clean_str(row.get(key))
    )
    return (
        0 if staff_profile_is_archived(row) else 1,
        len(staff_profile_assignment_ids(role, row)),
        populated_fields,
        str(row.get('updated_at') or row.get('created_at') or ''),
        clean_str(row.get('id')),
    )


def normalize_staff_profile_duplicates(role, rows):
    rows = [row for row in (rows or []) if row]
    if not rows:
        return None, False
    if len(rows) == 1:
        return rows[0], False

    table = staff_profile_table(role)
    assignment_column = STAFF_PROFILE_ASSIGNMENT_DB_COLUMNS.get(role)
    canonical = max(rows, key=lambda row: staff_profile_row_preference(role, row))
    canonical_id = clean_str(canonical.get('id'))
    updates = {}
    changed = False

    merged_assignments = clean_assignment_ids(
        item
        for row in rows
        for item in staff_profile_assignment_ids(role, row)
    )
    current_assignments = staff_profile_assignment_ids(role, canonical)
    if assignment_column and merged_assignments != current_assignments:
        updates[assignment_column] = json_db_value(merged_assignments)

    for field in ('email', 'phone', 'job_title', 'notes'):
        if clean_str(canonical.get(field)):
            continue
        fallback = next((clean_str(row.get(field)) for row in rows if clean_str(row.get(field))), '')
        if fallback:
            updates[field] = fallback

    if updates:
        updates['updated_at'] = datetime.utcnow()
        updated_rows = update_rows(table, 'id = %s', [canonical_id], updates)
        if updated_rows:
            canonical = updated_rows[0]
        changed = True

    for row in rows:
        row_id = clean_str(row.get('id'))
        if not row_id or row_id == canonical_id or staff_profile_is_archived(row):
            continue
        payload = archive_payload(table, row.get('notes'))
        if not payload:
            continue
        payload['updated_at'] = datetime.utcnow()
        update_rows(table, 'id = %s', [row_id], payload)
        changed = True

    fresh = find_staff_profile_row(role, canonical_id, include_archived=True)
    return fresh or canonical, changed


def module_assignment_ids(module):
    values = [
        module.get('id'),
        module.get('moduleId'),
        module.get('moduleCatalogueId'),
        module.get('module_catalogue_id'),
        module.get('deliveryRowId'),
        module.get('delivery_row_id'),
        module.get('deliveryModuleId'),
        module.get('delivery_module_id'),
        module.get('catalogueId'),
        module.get('catalogue_id'),
        module.get('sourceId'),
        module.get('source_id'),
    ]
    ids = set()
    for value in values:
        text = clean_str(value)
        if not text:
            continue
        ids.add(text)
        canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', text, re.IGNORECASE)
        if canonical_match:
            ids.add(canonical_match.group(1))
    return ids


def module_matches_staff_assignment(module, assignment_id):
    requested = clean_str(assignment_id)
    if not requested:
        return False
    candidates = {requested}
    canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', requested, re.IGNORECASE)
    if canonical_match:
        candidates.add(canonical_match.group(1))
    return bool(candidates.intersection(module_assignment_ids(module)))


def staff_name_for_assignment(rows, assignment_column, assignment_ids):
    requested = set(clean_assignment_ids(assignment_ids))
    if not requested:
        return ''
    for row in rows or []:
        if truthy(row.get('is_archived')) or clean_str(row.get('status')).lower() == 'archived':
            continue
        assigned = set(clean_assignment_ids(as_json_value(row.get(assignment_column), [])))
        if requested.intersection(assigned):
            return staff_profile_name(row)
    return ''


def apply_staff_assignments_to_modules(modules, tutor_rows):
    assigned = []
    for module in modules:
        tutor_name = staff_name_for_assignment(tutor_rows, 'assigned_module_ids', module_assignment_ids(module))
        next_module = {**module}
        if tutor_name:
            next_module['tutor'] = tutor_name
            next_module['deliveryMetadata'] = {
                **(next_module.get('deliveryMetadata') or {}),
                'tutor': tutor_name,
            }
        assigned.append(next_module)
    return assigned


def apply_staff_assignments_to_groups(groups, coach_rows):
    assigned = []
    for group in groups:
        coach_name = staff_name_for_assignment(coach_rows, 'assigned_group_ids', [group.get('id'), group.get('groupId')])
        next_group = {**group}
        if coach_name:
            next_group['coach'] = coach_name
        assigned.append(next_group)
    return assigned


def module_in_progress(module):
    status = clean_str(module.get('deliveryStatus') or module.get('status')).lower()
    if status in {'active', 'in_progress', 'in-progress'}:
        return True
    today = date.today()
    start = parse_date(module.get('startDate'))
    end = parse_date(module.get('endDate'))
    return bool(start and end and start <= today <= end)


def profile_module_summary(module):
    return {
        'id': module.get('id'),
        'moduleId': module.get('moduleId'),
        'moduleCatalogueId': module.get('moduleCatalogueId'),
        'deliveryRowId': module.get('deliveryRowId'),
        'name': module.get('name') or '',
        'programmeId': module.get('programmeId') or '',
        'programme': module.get('programme') or '',
        'cohortId': module.get('cohortId') or '',
        'cohort': module.get('cohort') or '',
        'groupId': module.get('groupId') or '',
        'group': module.get('group') or '',
        'startDate': module.get('startDate') or '',
        'endDate': module.get('endDate') or '',
        'status': 'in_progress' if module_in_progress(module) else (module.get('deliveryStatus') or module.get('status') or 'unknown'),
    }


def assigned_modules_for_staff(name, role, modules, stored_ids=None, stored_group_ids=None):
    key = staff_assignment_key(name)
    stored_ids = [clean_str(item) for item in (stored_ids or []) if clean_str(item)]
    stored_group_ids = {clean_str(item) for item in (stored_group_ids or []) if clean_str(item)}
    assigned = []
    for module in modules:
        module_staff = module.get('coach') if role == 'coach' else module.get('tutor')
        matched_by_staff = key and staff_assignment_key(module_staff) == key
        matched_by_stored_id = any(module_matches_staff_assignment(module, item) for item in stored_ids)
        matched_by_group_id = clean_str(module.get('groupId')) in stored_group_ids
        if matched_by_staff or matched_by_stored_id or matched_by_group_id:
            assigned.append(profile_module_summary(module))
    assigned.sort(key=lambda item: (item.get('startDate') or '', item.get('programme') or '', item.get('name') or ''))
    return assigned


def serialize_staff_profile(row, role, modules=None):
    row = row or {}
    name = staff_profile_name(row)
    stored_ids = as_json_value(row.get('assigned_module_ids') or row.get('assignedModuleIds'), []) if role == 'tutor' else []
    stored_group_ids = as_json_value(row.get('assigned_group_ids') or row.get('assignedGroupIds'), []) if role == 'coach' else []
    assigned_modules = assigned_modules_for_staff(name, role, modules or [], stored_ids, stored_group_ids) if role == 'tutor' else []
    active_modules = [module for module in assigned_modules if module.get('status') == 'in_progress']
    profile = {
        'id': row.get('id') or f'{role}-{slugify(name)}',
        'role': role,
        'name': name,
        'email': row.get('email') or '',
        'phone': row.get('phone') or '',
        'jobTitle': row.get('job_title') or row.get('jobTitle') or row.get('role') or '',
        'status': row.get('status') or ('archived' if truthy(row.get('is_archived')) else 'active'),
        'specialisms': as_json_value(row.get('specialisms'), []),
        'notes': row.get('notes') or '',
        'isArchived': truthy(row.get('is_archived')),
        'updatedAt': format_date(row.get('updated_at')),
    }
    if role == 'coach':
        profile.update({
            'assignedGroupIds': [clean_str(item) for item in stored_group_ids if clean_str(item)],
            'storedAssignedGroupIds': [clean_str(item) for item in stored_group_ids if clean_str(item)],
            'groupCount': len([item for item in stored_group_ids if clean_str(item)]),
        })
    else:
        profile.update({
            'assignedModuleIds': [module.get('id') for module in assigned_modules if module.get('id')],
            'storedAssignedModuleIds': stored_ids,
            'assignedModules': assigned_modules,
            'inProgressModules': active_modules,
            'moduleCount': len(assigned_modules),
            'inProgressCount': len(active_modules),
        })
    return profile


def build_staff_profiles(training_rows, profile_rows, role, modules=None):
    column_name = STAFF_PROFILE_ASSIGNMENT_COLUMNS[role]
    modules = modules or enrich_modules_with_authoring(build_modules(get_module_rows(), training_rows, get_program_config_rows()))
    merged = {}
    merged_name_keys = set()
    for row in profile_rows or []:
        serialized = serialize_staff_profile(row, role, modules)
        key = staff_profile_identity_key(serialized.get('name'), serialized.get('email')) or clean_str(serialized['id'])
        merged[key] = serialized
        name_key = staff_assignment_key(serialized.get('name'))
        if name_key:
            merged_name_keys.add(name_key)

    for profile in build_staff_profiles_from_training(training_rows, column_name, role):
        key = staff_profile_identity_key(profile.get('name'), profile.get('email'))
        name_key = staff_assignment_key(profile.get('name'))
        if key in merged or (name_key and name_key in merged_name_keys):
            continue
        merged[key] = serialize_staff_profile(profile, role, modules)
        if name_key:
            merged_name_keys.add(name_key)

    return sorted(
        merged.values(),
        key=lambda item: (item.get('status') == 'archived', item.get('name', '').lower()),
    )


def build_staff_profile_collection(role, visibility='operational'):
    rebuild_staff_profile_assignments_from_authoring()
    training_rows = get_training_rows()
    if visibility != 'all':
        training_rows = [row for row in training_rows if is_operational_training_row(row)]
    profile_rows = get_staff_profile_rows(role, include_archived=visibility == 'all')
    modules = build_modules(
        get_module_rows(),
        training_rows,
        get_program_config_rows(),
        include_unused=visibility == 'all',
    )
    modules = apply_staff_assignments_to_modules(modules, get_tutor_rows())
    return build_staff_profiles(training_rows, profile_rows, role, modules)


def get_curriculum_rows(compact=False):
    rows = {
        'training': get_training_rows(),
        'modules': get_module_rows(),
        'authoring_modules': get_authoring_module_rows(),
        'ksb_profiles': get_ksb_profile_rows(),
        'program_configs': get_program_config_rows(),
    }
    if compact:
        return {
            **rows,
            'holidays': [],
            'tutors': [],
            'coaches': [],
            'tutor_modules': [],
        }
    return {
        **rows,
        'holidays': get_holiday_rows(),
        'tutors': get_tutor_rows(),
        'coaches': get_coach_rows(),
        'tutor_modules': get_tutor_module_rows(),
    }


def build_modules(module_rows, training_rows, program_configs=None, include_unused=False):
    program_configs_by_id = program_config_by_id(program_configs or [])
    module_catalog = {}
    for row in module_rows:
        module_id = row.get('Module ID')
        name = row.get('Module_name') or f'Module {module_id}'
        module_catalog[str(module_id)] = row
        module_catalog[normalise(name)] = row

    modules = []
    for row in training_rows:
        if not clean_str(row.get('module_name')):
            continue
        meta = row.get('_meta', {})
        identity = programme_identity(row, program_configs_by_id)
        programme_name = identity['name']
        programme_id = identity['sourceId']
        cohort = actual_cohort_identity(row, programme_name)
        if not cohort:
            cohort_name = clean_str(row.get('Cohort_name') or row.get('cohort') or row.get('cohort_name') or 'Unassigned cohort')
            cohort = {'id': f'{slugify(programme_name)}-{slugify(cohort_name)}', 'name': cohort_name}
        group = actual_group_identity(row, cohort['id'])
        if not group:
            group_name = clean_str(row.get('group') or row.get('Group_name') or row.get('group_name') or 'Unassigned group')
            group = {'id': f'{cohort["id"]}-{slugify(group_name)}', 'name': group_name}
        cohort_name = cohort['name']
        cohort_id = cohort['id']
        group_name = group['name']
        group_id = group['id']
        catalogue_id = training_row_module_catalogue_id(row)
        invalid_explicit_id = training_row_invalid_explicit_module_catalogue_id(row)
        stale_legacy_id = training_row_stale_legacy_module_catalogue_id(row)
        catalogue = module_catalog.get(str(catalogue_id)) or module_catalog.get(normalise(row.get('module_name')))
        name = row.get('module_name') or (catalogue.get('Module_name') if catalogue else f'Module {row.get("id")}')
        delivery_module_id = clean_str(row.get('id')) or catalogue_id
        canonical_module_id = catalogue_id or delivery_module_id
        session_count = parse_int(row.get('sessions_number'), parse_int((catalogue or {}).get('Number of sessions'), 0))
        ksb_codes = codes_from_session_ksb(row.get('session_ksb_json')) or codes_from_session_ksb((catalogue or {}).get('session_ksb_json'))
        modules.append({
            'id': canonical_module_id,
            'moduleId': canonical_module_id,
            'moduleCatalogueId': catalogue_id,
            'deliveryRowId': row.get('id'),
            'deliveryModuleId': delivery_module_id,
            'legacyModuleId': stale_legacy_id,
            'invalidModuleCatalogueId': invalid_explicit_id,
            'structureId': canonical_module_id,
            'sourceId': catalogue_id,
            'catalogueId': catalogue_id,
            'name': name,
            'programmeId': programme_id,
            'programme': programme_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'groupId': group_id,
            'group': group_name,
            'weeks': session_count,
            'ksbCount': len(ksb_codes),
            'lessons': session_count,
            'quizzes': 0,
            'assignments': 0,
            'status': 'published',
            'authoringStatus': 'published',
            'deliveryStatus': delivery_status_for_training_row(row),
            'author': '',
            'tutor': row.get('Tutor_name') or '',
            'coach': row.get('coach_name') or '',
            'lastUpdated': '',
            'color': meta.get('module_color') or (catalogue or {}).get('Module_colour') or '#6941c6',
            'notes': row.get('notes') or (catalogue or {}).get('Notes') or '',
            'sessionNames': get_module_session_names(catalogue or {}),
            'ksbCodes': sorted(ksb_codes),
        })

    if include_unused:
        used_catalogue_ids = {str(training_row_module_catalogue_id(row)) for row in training_rows if training_row_module_catalogue_id(row)}
        for row in module_rows:
            module_id = str(row.get('Module ID'))
            if module_id in used_catalogue_ids:
                continue
            name = row.get('Module_name') or f'Module {module_id}'
            session_count = parse_int(row.get('Number of sessions'), len(get_module_session_names(row)))
            ksb_codes = codes_from_session_ksb(row.get('session_ksb_json'))
            modules.append({
                'id': f'catalogue-module-{module_id}',
            'sourceId': row.get('Module ID'),
            'sourceType': 'module_catalogue',
            'catalogueId': module_id,
            'name': name,
            'programmeId': '',
            'programme': 'Unassigned',
            'cohortId': '',
            'cohort': '',
            'groupId': '',
            'group': '',
                'weeks': session_count,
                'ksbCount': len(ksb_codes),
                'lessons': session_count,
                'quizzes': 0,
                'assignments': 0,
                'status': 'published',
                'authoringStatus': 'published',
                'deliveryStatus': 'unknown',
                'author': '',
                'tutor': '',
                'coach': '',
                'lastUpdated': '',
                'color': row.get('Module_colour') or '#6941c6',
                'notes': row.get('Notes') or '',
                'sessionNames': get_module_session_names(row),
                'ksbCodes': sorted(ksb_codes),
            })
    return modules


def build_programmes(training_rows, program_configs, ksb_profiles, include_config_only=False):
    configs_by_id = program_config_by_id(program_configs)
    grouped = defaultdict(list)
    group_meta = {}
    order = {}
    free_programme_counts = defaultdict(lambda: {'modules': 0, 'components': 0})
    try:
        for row in free_programme_fetch_all(FREE_PROGRAMME_MODULES_TABLE):
            programme_id = clean_str(row.get('programme_id'))
            if not programme_id:
                continue
            free_programme_counts[programme_id]['modules'] += 1
            free_programme_counts[programme_id]['components'] += parse_int(row.get('component_count'), 0)
    except Exception:
        logger.debug('Free programme counts are not available yet.', exc_info=True)

    cohort_counts_by_programme_id = defaultdict(int)
    cohort_counts_by_programme_name = defaultdict(int)
    try:
        for detail in cohort_authoring_detail_rows():
            if detail_is_archived(detail):
                continue
            programme_id = clean_str(detail.get('programmeId'))
            programme_name = normalise(detail.get('programmeName'))
            if programme_id:
                cohort_counts_by_programme_id[programme_id] += 1
            if programme_name:
                cohort_counts_by_programme_name[programme_name] += 1
    except Exception:
        logger.debug('Cohort counts are not available yet.', exc_info=True)

    display_program_configs = unique_program_configs_for_display(program_configs)
    row_programme_names = set()
    row_programme_source_ids = set()
    for row in training_rows:
        identity = programme_identity(row, configs_by_id)
        row_programme_names.add(normalise(identity['name']))
        row_programme_source_ids.add(clean_str(identity['sourceId']))

    for config in display_program_configs:
        if not config.get('program_id'):
            continue
        if normalise(config.get('name')) in row_programme_names and clean_str(config.get('program_id')) not in row_programme_source_ids:
            continue
        key = f'name:{normalise(config.get("name"))}' if normalise(config.get('name')) else f'id:{config.get("program_id")}'
        grouped[key] = []
        group_meta[key] = {
            'name': config.get('name'),
            'sourceId': config.get('program_id'),
            'config': config,
        }
        order[key] = len(order)

    for config in display_program_configs:
        name = config.get('name')
        program_id = config.get('program_id')
        if name and program_id:
            order.setdefault(f'name:{normalise(name)}', len(order))

    for row in training_rows:
        identity = programme_identity(row, configs_by_id)
        key = identity['key']
        grouped[key].append(row)
        group_meta.setdefault(key, {
            'name': identity['name'],
            'sourceId': identity['sourceId'],
            'config': identity['config'],
        })
        existing_order = order.get(key)
        row_order = row.get('programme_display_order')
        if existing_order is None:
            order[key] = row_order if row_order is not None else len(order)
        elif row_order is not None:
            order[key] = min(existing_order, row_order)

    programme_learner_counts = active_learner_programme_counts()
    programmes = []
    for key, rows in sorted(grouped.items(), key=lambda item: order.get(item[0], 999)):
        meta = group_meta.get(key, {})
        config = meta.get('config')
        name = meta.get('name') or (Counter(row.get('Program') for row in rows if row.get('Program')).most_common(1)[0][0] if rows else 'Unassigned Programme')
        source_id = meta.get('sourceId') or slugify(name)
        profile = get_ksb_profile_for_program(name, ksb_profiles)
        if not profile and rows:
            row_names = unique(row.get('Program') for row in rows)
            profile = next((get_ksb_profile_for_program(row_name, ksb_profiles) for row_name in row_names if get_ksb_profile_for_program(row_name, ksb_profiles)), None)
        operational_rows = [row for row in rows if is_operational_training_row(row)]
        metric_rows = operational_rows if operational_rows else []
        delivery_rows = [row for row in metric_rows if is_actual_delivery_row(row, configs_by_id)]
        module_names = unique(row.get('module_name') for row in delivery_rows)
        cohort_names = unique(row.get('Cohort_name') for row in delivery_rows)
        group_keys = set()
        for row in delivery_rows:
            row_cohort = actual_cohort_identity(row, programme_identity(row, configs_by_id)['name'])
            row_group = actual_group_identity(row, row_cohort['id']) if row_cohort else None
            if row_group:
                group_keys.add(row_group['id'])
        required_ksb_codes = ksb_profile_required_codes(profile)
        ksb_total = len(required_ksb_codes)
        profile_source = f'profile:{ksb_profile_source_id(profile)}' if profile else ''
        config_archived = is_archived_program_config(config)
        archived = (rows and not operational_rows) or (not rows and config_archived)
        standard = (config or {}).get('sub') or (config or {}).get('standard') or (profile.get('name') if profile else name)
        level = (config or {}).get('level') or infer_level(standard) or infer_level(name)
        structure_type = (config or {}).get('structure_type') or 'scheduled'
        free_counts = free_programme_counts.get(clean_str(source_id), {})
        programme_modules_count = parse_int(free_counts.get('modules'), 0) if structure_type == 'free' else len(delivery_rows)
        programme_cohorts_count = (
            cohort_counts_by_programme_id.get(clean_str(source_id))
            or cohort_counts_by_programme_name.get(normalise(name))
            or len(cohort_names)
        )

        programmes.append({
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': standard,
            'level': level,
            'modules': programme_modules_count,
            'groups': len(group_keys),
            'weeks': sum(parse_int(row.get('sessions_number')) for row in delivery_rows),
            'ksbMapped': programme_component_ksb_mapping_count(source_id, required_ksb_codes),
            'ksbTotal': ksb_total,
            'learners': programme_learner_counts.get(normalise(name), 0),
            'cohorts': programme_cohorts_count,
            'lastUpdated': format_date((profile or config or {}).get('updated_at') or (profile or config or {}).get('created_at')),
            'owner': (config or {}).get('owner') or (config or {}).get('created_by') or (profile or {}).get('created_by') or '',
            'color': (config or {}).get('color') or (rows[0].get('_meta', {}).get('cohort_color') if rows else '#6941c6'),
            'description': (config or {}).get('description') or (profile or {}).get('description') or '',
            'structureType': structure_type,
            'ksbProfileSourceId': (config or {}).get('ksb_profile_source_id') or '',
            'freeComponents': parse_int(free_counts.get('components'), 0),
        })
    return programmes


def detail_is_archived(detail):
    return clean_str((detail or {}).get('status')).lower() == 'archived'


def active_learner_programme_counts():
    """Count learners per programme label from the canonical learner table."""
    counts = Counter()
    if connection.vendor != 'postgresql':
        return counts
    try:
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass(%s)", ['\"Learner\".\"learners\"'])
            if cursor.fetchone()[0]:
                cursor.execute(
                    'select programme '
                    'from "Learner"."learners" '
                    "where coalesce(btrim(programme), '') <> ''"
                )
                for (programme_name,) in cursor.fetchall():
                    programme_key = normalise(programme_name)
                    if not programme_key:
                        continue
                    counts[programme_key] += 1
    except Exception as exc:
        logger.warning('Could not count active learners by programme: %s', exc)
    return dict(counts)


def programme_component_ksb_mapping_count(programme_id, required_codes=None):
    """Distinct required KSBs actually mapped to this programme's components."""
    try:
        module_rows, _week_rows, _component_rows, mapping_rows = authoring_scope_data('programme', programme_id)
    except Exception as exc:
        logger.warning('Could not count programme component KSB mappings for %s: %s', programme_id, exc)
        return 0
    module_ids = {clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))}
    required = {coverage_normalise_code(code) for code in (required_codes or []) if coverage_normalise_code(code)}
    mapped = set()
    for row in mapping_rows:
        if clean_str(row.get('module_catalogue_id')) not in module_ids:
            continue
        if not clean_str(row.get('component_id')):
            continue
        code = coverage_normalise_code(row.get('ksb_code'))
        if not code:
            continue
        matched_code = code
        if required and matched_code not in required:
            parent_code = code.split('.', 1)[0]
            if parent_code in required:
                matched_code = parent_code
            else:
                continue
        mapped.add(matched_code)
    return len(mapped)


def active_learner_delivery_counts():
    """Count live learners by their programme/cohort/group delivery labels.

    ``Learner.learners`` is the permanent canonical learner table. Curriculum
    relationships currently carry the same labels rather than learner foreign
    keys, so comparison is deliberately case/whitespace insensitive. Missing
    learner infrastructure is treated as an empty data source (for example in
    local SQLite tests or a curriculum-only deployment).
    """
    if connection.vendor != 'postgresql':
        return {}, {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass(%s)", ['\"Learner\".\"learners\"'])
            if not cursor.fetchone()[0]:
                return {}, {}
            cursor.execute(
                'select programme, cohort, group_name, count(*) '
                'from "Learner"."learners" '
                "where lifecycle_status = 'active' "
                'group by programme, cohort, group_name'
            )
            rows = cursor.fetchall()
    except Exception as exc:
        logger.warning('Could not count active learners for curriculum delivery: %s', exc)
        return {}, {}

    cohort_counts = Counter()
    group_counts = Counter()
    for programme_name, cohort_name, group_name, learner_count in rows:
        programme_key = normalise(programme_name)
        cohort_key = normalise(cohort_name)
        group_key = normalise(group_name)
        count = parse_int(learner_count, 0)
        if programme_key and cohort_key:
            cohort_counts[(programme_key, cohort_key)] += count
        if programme_key and cohort_key and group_key:
            group_counts[(programme_key, cohort_key, group_key)] += count
    return dict(cohort_counts), dict(group_counts)


def build_cohorts_and_groups(training_rows=None, program_configs=None, include_archived=False):
    """Build the cohort/group overview directly from the normalized tables.

    Cohorts come from ``curriculum.cohorts`` and groups from ``curriculum.groups``.
    Module names and session counts are derived from ``curriculum.modules`` keyed
    on the stored canonical group/cohort ids. The ``training_rows`` argument is
    accepted for backwards compatibility with existing callers but is ignored:
    the normalized tables are the only source of truth.
    """
    module_rows = safe_authoring_module_rows()
    cohort_learner_counts, group_learner_counts = active_learner_delivery_counts()
    modules_by_group = defaultdict(list)
    modules_by_cohort = defaultdict(list)
    for module in module_rows:
        group_key = clean_str(module.get('group_id'))
        cohort_key = clean_str(module.get('cohort_id'))
        if group_key:
            modules_by_group[group_key].append(module)
        if cohort_key:
            modules_by_cohort[cohort_key].append(module)

    def module_ids(rows):
        return [module_id for module_id in unique([clean_str(row.get('module_catalogue_id')) for row in rows]) if module_id]

    def module_names(rows):
        return [name for name in unique([clean_str(row.get('title')) for row in rows]) if name]

    def session_total(rows):
        return sum(parse_int(row.get('sessions_number'), 0) for row in rows)

    cohorts = []
    for detail in cohort_authoring_detail_rows():
        if not include_archived and detail_is_archived(detail):
            continue
        cohort_id = clean_str(detail.get('cohortId'))
        if not cohort_id:
            continue
        cohort_modules = modules_by_cohort.get(cohort_id, [])
        stored_module_ids = [module_id for module_id in (detail.get('moduleCatalogueIds') or []) if clean_str(module_id)]
        cohorts.append({
            'id': cohort_id,
            'name': clean_str(detail.get('cohortName')),
            'programme': clean_str(detail.get('programmeName')),
            'programmeId': clean_str(detail.get('programmeId')),
            'startDate': format_date(detail.get('startDate')),
            'endDate': format_date(detail.get('endDate')),
            'durationMonths': parse_int(
                detail.get('durationMonths'),
                infer_duration_months(detail.get('startDate'), detail.get('endDate'), 0),
            ),
            'status': detail.get('status') or 'planned',
            'learners': cohort_learner_counts.get((
                normalise(detail.get('programmeName')),
                normalise(detail.get('cohortName')),
            ), 0),
            'groups': [clean_str(value) for value in (detail.get('groupIds') or []) if clean_str(value)],
            'moduleIds': module_ids(cohort_modules) or stored_module_ids,
            'modules': module_names(cohort_modules),
            'sessions': session_total(cohort_modules),
            'color': detail.get('color') or '#6941c6',
            'holidayIds': [clean_str(value) for value in (detail.get('holidayIds') or []) if clean_str(value)],
            'progress': 0,
            'attendance': 0,
        })

    groups = []
    seen_group_ids = set()
    for detail in group_authoring_detail_rows():
        if not include_archived and detail_is_archived(detail):
            continue
        group_id = clean_str(detail.get('id'))
        if not group_id:
            continue
        seen_group_ids.add(group_id)
        group_modules = modules_by_group.get(group_id, [])
        stored_module_ids = [module_id for module_id in (detail.get('moduleIds') or []) if clean_str(module_id)]
        stored_module_names = [name for name in (detail.get('modules') or []) if clean_str(name)]
        groups.append({
            'id': group_id,
            'name': clean_str(detail.get('name')),
            'cohortId': clean_str(detail.get('cohortId')),
            'cohort': clean_str(detail.get('cohort')),
            'programmeId': clean_str(detail.get('programmeId')),
            'programme': clean_str(detail.get('programme')),
            'learners': group_learner_counts.get((
                normalise(detail.get('programme')),
                normalise(detail.get('cohort')),
                normalise(detail.get('name')),
            ), 0),
            'coach': detail.get('coach') or 'Unassigned',
            'tutor': detail.get('tutor') or 'Unassigned',
            'startDate': format_date(detail.get('startDate')),
            'endDate': format_date(detail.get('endDate')),
            'status': detail.get('status') or 'planned',
            'schedule': detail.get('schedule') or '',
            'color': detail.get('color') or '',
            'mode': detail.get('mode') or 'Live',
            'moduleIds': module_ids(group_modules) or stored_module_ids,
            'modules': module_names(group_modules) or stored_module_names,
            'sessions': session_total(group_modules),
        })

    for group_id, group_modules in modules_by_group.items():
        if not group_id or group_id in seen_group_ids:
            continue
        first_module = group_modules[0] if group_modules else {}
        groups.append({
            'id': group_id,
            'name': clean_str(first_module.get('group_name')) or group_id,
            'cohortId': clean_str(first_module.get('cohort_id')),
            'cohort': clean_str(first_module.get('cohort_name')),
            'programmeId': clean_str(first_module.get('programme_id')),
            'programme': clean_str(first_module.get('programme_name')),
            'learners': group_learner_counts.get((
                normalise(first_module.get('programme_name')),
                normalise(first_module.get('cohort_name')),
                normalise(first_module.get('group_name')),
            ), 0),
            'coach': clean_str(first_module.get('coach_name')) or 'Unassigned',
            'tutor': clean_str(first_module.get('tutor_name')) or 'Unassigned',
            'startDate': format_date(first_module.get('start_date')),
            'endDate': format_date(first_module.get('end_date')),
            'status': 'planned' if clean_str(first_module.get('status')).lower() == 'archived' else (clean_str(first_module.get('status')) or 'planned'),
            'schedule': '',
            'color': clean_str(first_module.get('color')),
            'mode': 'Live',
            'moduleIds': module_ids(group_modules),
            'modules': module_names(group_modules),
            'sessions': session_total(group_modules),
        })

    # Ensure every cohort exposes the ids of its normalized child groups, even
    # when the stored ``group_ids`` array is stale.
    groups_by_cohort = defaultdict(list)
    for group in groups:
        if group['cohortId']:
            groups_by_cohort[group['cohortId']].append(group['id'])
    for cohort in cohorts:
        derived = groups_by_cohort.get(cohort['id'], [])
        cohort['groups'] = unique([*cohort['groups'], *derived]) if cohort['groups'] else derived

    return cohorts, groups


def meaningful_session_names(names):
    clean_names = [clean_str(name) for name in (names or []) if clean_str(name)]
    if not clean_names:
        return []
    if all(re.match(r'^week\s*\d+$', name, re.I) for name in clean_names):
        return []
    return clean_names


def authoring_session_links(module_catalogue_id):
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return []
    try:
        structure = get_authoring_structure_payload(module_catalogue_id)
    except Exception:
        logger.debug('Unable to read authored session links for %s.', module_catalogue_id, exc_info=True)
        return []
    links = []
    for week in (structure or {}).get('weekStructure') or []:
        live_component = next((
            component for component in (week.get('components') or [])
            if normalise_component_type(component.get('type')) == 'live_session'
        ), None)
        links.append({
            'weekId': week.get('id') or '',
            'componentId': (live_component or {}).get('id') or '',
            'title': (live_component or {}).get('title') or week.get('title') or '',
        })
    return links


def authoring_session_links_by_catalogue(module_catalogue_ids):
    module_catalogue_ids = unique([clean_str(value) for value in module_catalogue_ids if clean_str(value)])
    if not module_catalogue_ids:
        return {}
    try:
        placeholders = ','.join(['%s'] * len(module_catalogue_ids))
        week_rows = authoring_fetch_all(
            AUTHORING_WEEKS_TABLE,
            f'module_catalogue_id in ({placeholders})',
            module_catalogue_ids,
            'module_catalogue_id, display_order, week_number, id',
        )
        component_rows = authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            f'module_catalogue_id in ({placeholders})',
            module_catalogue_ids,
            'module_catalogue_id, week_id, display_order, id',
        )
    except Exception:
        logger.debug('Unable to batch read authored session links.', exc_info=True)
        return {}

    live_components_by_week = {}
    for row in component_rows:
        if normalise_component_type(row.get('type')) != 'live_session':
            continue
        week_id = clean_str(row.get('week_id'))
        if week_id and week_id not in live_components_by_week:
            live_components_by_week[week_id] = row

    links_by_catalogue = defaultdict(list)
    for row in week_rows:
        week_id = clean_str(row.get('id'))
        component = live_components_by_week.get(week_id) or {}
        links_by_catalogue[clean_str(row.get('module_catalogue_id'))].append({
            'weekId': week_id,
            'componentId': clean_str(component.get('id')),
            'title': component.get('title') or row.get('title') or '',
        })
    return dict(links_by_catalogue)


def authoring_programme_lookup_key(value):
    return normalise(clean_str(value))


def build_authoring_modules_by_programme(authoring_module_rows):
    modules_by_programme = defaultdict(list)
    seen = defaultdict(set)
    for module in authoring_module_rows or []:
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        for value in (
            module.get('programme_id'),
            module.get('programme_name'),
            f'program-{slugify(module.get("programme_id"))}' if module.get('programme_id') else '',
        ):
            key = authoring_programme_lookup_key(value)
            if key and catalogue_id not in seen[key]:
                modules_by_programme[key].append(module)
                seen[key].add(catalogue_id)
    return modules_by_programme


def matching_authoring_module_for_training_row(row, modules_by_programme, programme_source_id, programme_name):
    meta = row.get('_meta', {})
    lookup_keys = [
        programme_source_id,
        f'program-{slugify(programme_source_id)}' if programme_source_id else '',
        programme_name,
    ]
    candidates = []
    seen = set()
    for value in lookup_keys:
        for module in modules_by_programme.get(authoring_programme_lookup_key(value), []):
            catalogue_id = clean_str(module.get('module_catalogue_id'))
            if catalogue_id and catalogue_id in seen:
                continue
            candidates.append(module)
            if catalogue_id:
                seen.add(catalogue_id)

    if not candidates:
        return None

    training_id = clean_str(row.get('id'))
    catalogue_id = clean_str(meta.get('module_catalogue_id'))
    module_name = normalise(row.get('module_name'))

    exact = next((module for module in candidates if catalogue_id and clean_str(module.get('module_catalogue_id')) == catalogue_id), None)
    if exact:
        return exact

    source_match = next((
        module for module in candidates
        if training_id and clean_str(module.get('source_id')) == training_id
    ), None)
    if source_match:
        return source_match

    title_match = next((module for module in candidates if module_name and normalise(module.get('title')) == module_name), None)
    return title_match or candidates[0]


def build_sessions(training_rows, module_rows, program_configs=None, authoring_module_rows=None, holiday_rows=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
    authoring_modules_by_programme = build_authoring_modules_by_programme(authoring_module_rows or [])
    module_catalog = {}
    for module in module_rows:
        session_names = get_module_session_names(module)
        module_catalog[str(module.get('Module ID'))] = session_names
        module_catalog[normalise(module.get('Module_name'))] = session_names

    authoring_by_id = authoring_catalogue_summaries()
    authoring_by_training_source = {
        clean_str(summary.get('sourceId')): summary
        for summary in authoring_by_id.values()
        if summary.get('sourceType') == 'training_plan' and summary.get('sourceId')
    }
    authoring_by_delivery_signature = defaultdict(list)
    for summary in authoring_by_id.values():
        signature = authoring_summary_delivery_signature(summary)
        if signature:
            authoring_by_delivery_signature[signature].append(summary)

    sessions = []
    session_links_by_catalogue = authoring_session_links_by_catalogue(authoring_by_id.keys())
    for row in training_rows:
        if not clean_str(row.get('module_name')):
            continue
        identity = programme_identity(row, program_configs_by_id)
        program = identity['name']
        programme_source_id = clean_str(row.get('_meta', {}).get('program_id') or identity['sourceId'])
        programme_id = f'program-{slugify(identity["sourceId"])}'
        session_count = parse_int(row.get('sessions_number'), 0)
        if session_count <= 0:
            continue
        start = parse_date(row.get('start_date'))
        meta = row.get('_meta', {})
        delivery_module_id = clean_str(row.get('id'))
        explicit_catalogue_id = training_row_module_catalogue_id(row)
        invalid_explicit_id = training_row_invalid_explicit_module_catalogue_id(row)
        stale_legacy_id = training_row_stale_legacy_module_catalogue_id(row)
        module_id = explicit_catalogue_id or delivery_module_id
        cohort = actual_cohort_identity(row, program)
        if not cohort:
            continue
        group = actual_group_identity(row, cohort['id'])
        if not group:
            continue
        cohort_name = cohort['name']
        cohort_id = cohort['id']
        group_name = group['name']
        group_id = group['id']
        catalogue_session_names = module_catalog.get(explicit_catalogue_id) or module_catalog.get(normalise(row.get('module_name'))) or []
        delivery_signature = module_delivery_signature({
            'programme': program,
            'name': row.get('module_name') or '',
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'groupId': group_id,
            'group': group_name,
        })
        authoring_candidates = [authoring_by_id.get(explicit_catalogue_id)]
        if not invalid_explicit_id:
            authoring_candidates.append(authoring_by_training_source.get(clean_str(row.get('id'))))
        # Temporary compatibility: only use delivery-signature matching for legacy rows
        # without an explicit canonical module link. Remove after all rows are backfilled.
        if not explicit_catalogue_id and not invalid_explicit_id:
            authoring_candidates.extend(authoring_by_delivery_signature.get(delivery_signature, []))
        authoring_summary = best_authoring_summary(authoring_candidates)
        session_names = meaningful_session_names((authoring_summary or {}).get('sessionNames')) or catalogue_session_names
        session_link_catalogue_id = clean_str((authoring_summary or {}).get('catalogueId') or explicit_catalogue_id)
        session_links = session_links_by_catalogue.get(session_link_catalogue_id, [])
        authoring_module = matching_authoring_module_for_training_row(
            row,
            authoring_modules_by_programme,
            programme_source_id,
            program,
        )
        module_title = (authoring_module or {}).get('title') or row.get('module_name') or ''
        ksb_entries = parse_json_value(row.get('session_ksb_json'), [])
        holiday_info = cohort_holiday_details(
            holiday_rows or [],
            meta.get('holiday_ids') or row.get('holiday_ids'),
            row.get('Starting_date_lable') or row.get('start_date'),
            meta.get('cohort_end_date') or row.get('end_date'),
        )
        applied_holidays = holiday_info.get('selectedHolidays') or holiday_info.get('holidaysInRange') or []
        session_plan = build_module_session_plan(
            row.get('start_date'),
            session_count,
            row.get('session_week_day'),
            applied_holidays,
        )
        planned_sessions = session_plan.get('sessions') or []

        for index in range(session_count):
            planned_session = planned_sessions[index] if index < len(planned_sessions) else {}
            session_date = parse_date(planned_session.get('date')) or (start + timedelta(days=index * 7) if start else None)
            ksb_entry = ksb_entries[index] if isinstance(ksb_entries, list) and index < len(ksb_entries) and isinstance(ksb_entries[index], dict) else {}
            title = session_names[index] if index < len(session_names) else f'{module_title or "Session"} #{index + 1}'
            sessions.append({
                'id': f'training-{row.get("id")}-session-{index + 1}',
                'trainingPlanId': row.get('id'),
                'deliveryRowId': row.get('id'),
                'programmeId': programme_id,
                'programmeSourceId': programme_source_id,
                'cohortId': cohort_id,
                'groupId': group_id,
                'moduleId': module_id,
                'deliveryModuleId': delivery_module_id,
                'moduleCatalogueId': (authoring_module or {}).get('module_catalogue_id') or explicit_catalogue_id or meta.get('module_catalogue_id') or '',
                'legacyModuleId': stale_legacy_id,
                'invalidModuleCatalogueId': invalid_explicit_id,
                'weekId': (session_links[index].get('weekId') if index < len(session_links) else '') or f'{module_id}-week-{index + 1}',
                'componentId': (session_links[index].get('componentId') if index < len(session_links) else '') or '',
                'title': title,
                'type': 'Live Session',
                'date': session_date.isoformat() if session_date else '',
                'day': planned_session.get('day') or row.get('session_week_day') or '',
                'startTime': row.get('session_start_time') or '',
                'endTime': row.get('session_end_time') or '',
                'tutor': row.get('Tutor_name') or 'Unassigned',
                'group': group_name,
                'cohort': cohort_name,
                'programme': program,
                'venue': 'LMS',
                'module': module_title,
                'week': index + 1,
                'skippedHolidays': planned_session.get('skippedHolidays') or [],
                'scheduleWarnings': session_plan.get('warnings') or [],
                'status': 'completed' if session_date and session_date < date.today() else 'scheduled',
                'ksbCodes': [
                    *ksb_entry.get('knowledgeCodes', []),
                    *ksb_entry.get('skillCodes', []),
                    *ksb_entry.get('behaviourCodes', []),
                ],
            })
    return sessions


def build_sessions_basic(training_rows, module_rows, program_configs=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
    module_catalog = {}
    for module in module_rows:
        session_names = get_module_session_names(module)
        module_catalog[str(module.get('Module ID'))] = session_names
        module_catalog[normalise(module.get('Module_name'))] = session_names

    sessions = []
    for row in training_rows:
        if not clean_str(row.get('module_name')):
            continue
        identity = programme_identity(row, program_configs_by_id)
        program = identity['name']
        session_count = parse_int(row.get('sessions_number'), 0)
        if session_count <= 0:
            continue
        start = parse_date(row.get('start_date'))
        cohort = actual_cohort_identity(row, program)
        if not cohort:
            continue
        group = actual_group_identity(row, cohort['id'])
        if not group:
            continue
        explicit_catalogue_id = training_row_module_catalogue_id(row)
        delivery_module_id = f'training-module-{row.get("id")}'
        session_names = module_catalog.get(explicit_catalogue_id) or module_catalog.get(normalise(row.get('module_name'))) or []
        ksb_entries = parse_json_value(row.get('session_ksb_json'), [])

        for index in range(session_count):
            session_date = start + timedelta(days=index * 7) if start else None
            ksb_entry = ksb_entries[index] if isinstance(ksb_entries, list) and index < len(ksb_entries) and isinstance(ksb_entries[index], dict) else {}
            sessions.append({
                'id': f'session-{row.get("id")}-{index + 1}',
                'trainingPlanId': row.get('id'),
                'deliveryRowId': row.get('id'),
                'programmeId': f'program-{slugify(identity["sourceId"])}',
                'cohortId': cohort['id'],
                'groupId': group['id'],
                'moduleId': explicit_catalogue_id or delivery_module_id,
                'moduleCatalogueId': explicit_catalogue_id,
                'deliveryModuleId': delivery_module_id,
                'title': session_names[index] if index < len(session_names) else f'{row.get("module_name") or "Session"} #{index + 1}',
                'type': 'Live Session',
                'date': session_date.isoformat() if session_date else '',
                'day': row.get('session_week_day') or '',
                'startTime': row.get('session_start_time') or '',
                'endTime': row.get('session_end_time') or '',
                'tutor': row.get('Tutor_name') or 'Unassigned',
                'group': group['name'],
                'cohort': cohort['name'],
                'programme': program,
                'venue': 'LMS',
                'module': row.get('module_name') or '',
                'week': index + 1,
                'skippedHolidays': row.get('skippedHolidays') or [],
                'scheduleWarnings': row.get('warnings') or [],
                'status': 'completed' if session_date and session_date < date.today() else 'scheduled',
                'ksbCodes': [
                    *ksb_entry.get('knowledgeCodes', []),
                    *ksb_entry.get('skillCodes', []),
                    *ksb_entry.get('behaviourCodes', []),
                ],
            })
    return sessions


def build_sessions_basic(training_rows, module_rows, program_configs=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
    module_catalog = {}
    for module in module_rows:
        session_names = get_module_session_names(module)
        module_catalog[str(module.get('Module ID'))] = session_names
        module_catalog[normalise(module.get('Module_name'))] = session_names

    sessions = []
    for row in training_rows:
        if not clean_str(row.get('module_name')):
            continue
        identity = programme_identity(row, program_configs_by_id)
        program = identity['name']
        session_count = parse_int(row.get('sessions_number'), 0)
        if session_count <= 0:
            continue
        start = parse_date(row.get('start_date'))
        cohort = actual_cohort_identity(row, program)
        if not cohort:
            continue
        group = actual_group_identity(row, cohort['id'])
        if not group:
            continue
        explicit_catalogue_id = training_row_module_catalogue_id(row)
        delivery_module_id = f'training-module-{row.get("id")}'
        session_names = module_catalog.get(explicit_catalogue_id) or module_catalog.get(normalise(row.get('module_name'))) or []
        ksb_entries = parse_json_value(row.get('session_ksb_json'), [])

        for index in range(session_count):
            session_date = start + timedelta(days=index * 7) if start else None
            ksb_entry = ksb_entries[index] if isinstance(ksb_entries, list) and index < len(ksb_entries) and isinstance(ksb_entries[index], dict) else {}
            sessions.append({
                'id': f'session-{row.get("id")}-{index + 1}',
                'trainingPlanId': row.get('id'),
                'deliveryRowId': row.get('id'),
                'programmeId': f'program-{slugify(identity["sourceId"])}',
                'cohortId': cohort['id'],
                'groupId': group['id'],
                'moduleId': explicit_catalogue_id or delivery_module_id,
                'moduleCatalogueId': explicit_catalogue_id,
                'deliveryModuleId': delivery_module_id,
                'title': session_names[index] if index < len(session_names) else f'{row.get("module_name") or "Session"} #{index + 1}',
                'type': 'Live Session',
                'date': session_date.isoformat() if session_date else '',
                'day': row.get('session_week_day') or '',
                'startTime': row.get('session_start_time') or '',
                'endTime': row.get('session_end_time') or '',
                'tutor': row.get('Tutor_name') or 'Unassigned',
                'group': group['name'],
                'cohort': cohort['name'],
                'programme': program,
                'venue': 'LMS',
                'module': row.get('module_name') or '',
                'week': index + 1,
                'skippedHolidays': [],
                'scheduleWarnings': [],
                'status': 'completed' if session_date and session_date < date.today() else 'scheduled',
                'ksbCodes': [
                    *ksb_entry.get('knowledgeCodes', []),
                    *ksb_entry.get('skillCodes', []),
                    *ksb_entry.get('behaviourCodes', []),
                ],
            })
    return sessions


def module_delivery_plan(module, session_count, start):
    delivery_days = module.get('session_week_day') or module.get('week_days') or module.get('delivery_days') or ''
    planned_sessions = build_module_session_plan(start, session_count, delivery_days).get('sessions') if delivery_days else []
    if planned_sessions:
        return planned_sessions
    if not start:
        return []
    return [
        {
            'sessionNumber': index + 1,
            'date': (start + timedelta(days=index * 7)).isoformat(),
            'day': (start + timedelta(days=index * 7)).strftime('%A'),
        }
        for index in range(session_count)
    ]


def build_sessions_from_authoring_modules(authoring_module_rows):
    sessions = []
    for module in authoring_module_rows or []:
        status = clean_str(module.get('status')).lower()
        if status == 'archived':
            continue
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        if not catalogue_id:
            continue
        session_count = parse_int(module.get('sessions_number'), 0)
        if session_count <= 0:
            continue
        start = parse_date(module.get('start_date'))
        if not start:
            continue
        plan = module_delivery_plan(module, session_count, start)
        title = clean_str(module.get('title')) or catalogue_id
        programme_name = clean_str(module.get('programme_name')) or 'Unassigned programme'
        programme_id = clean_str(module.get('programme_id')) or f'program-{slugify(programme_name)}'
        group_name = clean_str(module.get('group_name')) or clean_str(module.get('group_id')) or 'Unassigned group'
        cohort_name = clean_str(module.get('cohort_name')) or clean_str(module.get('cohort_id')) or 'Unassigned cohort'
        start_time = clean_str(module.get('session_start_time')) or '09:00'
        end_time = clean_str(module.get('session_end_time')) or '10:00'
        tutor = clean_str(module.get('tutor_name')) or 'Unassigned'

        for index in range(session_count):
            planned_session = plan[index] if index < len(plan) else {}
            session_date = parse_date(planned_session.get('date')) if planned_session else start + timedelta(days=index * 7)
            if not session_date:
                continue
            sessions.append({
                'id': f'module-{catalogue_id}-session-{index + 1}',
                'trainingPlanId': module.get('source_id') or '',
                'programmeId': programme_id,
                'programmeSourceId': programme_id,
                'cohortId': clean_str(module.get('cohort_id')),
                'groupId': clean_str(module.get('group_id')),
                'moduleId': catalogue_id,
                'moduleCatalogueId': catalogue_id,
                'weekId': f'{catalogue_id}-week-{index + 1}',
                'title': f'{title} #{index + 1}',
                'type': 'Live Session',
                'date': session_date.isoformat(),
                'day': planned_session.get('day') or session_date.strftime('%A'),
                'startTime': start_time,
                'endTime': end_time,
                'tutor': tutor,
                'group': group_name,
                'cohort': cohort_name,
                'programme': programme_name,
                'venue': 'LMS',
                'module': title,
                'week': index + 1,
                'status': 'completed' if session_date < date.today() else 'scheduled',
                'ksbCodes': [],
            })
    return sessions


def prefer_authoring_module_sessions(training_sessions, authoring_sessions):
    authoring_catalogue_ids = {
        clean_str(session.get('moduleCatalogueId'))
        for session in authoring_sessions
        if clean_str(session.get('moduleCatalogueId'))
    }
    filtered_training = [
        session for session in training_sessions
        if clean_str(session.get('moduleCatalogueId')) not in authoring_catalogue_ids
    ]
    return [*authoring_sessions, *filtered_training]


def build_ksb_data(ksb_profiles, modules, training_rows):
    module_names_by_code = defaultdict(set)
    for module in modules:
        for code in module.get('ksbCodes', []):
            module_names_by_code[code].add(module['name'])

    for row in training_rows:
        for code in codes_from_session_ksb(row.get('session_ksb_json')):
            if row.get('module_name'):
                module_names_by_code[code].add(row.get('module_name'))

    frameworks = []
    sets = []
    for profile in ksb_profiles:
        knowledge = parse_json_value(profile.get('knowledge_codes'), [])
        skills = parse_json_value(profile.get('skill_codes'), [])
        behaviours = parse_json_value(profile.get('behaviour_codes'), [])
        items = parse_json_value(profile.get('ksb_items'), [])
        if not isinstance(items, list):
            items = []

        normalised_items = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            type_code = normalise_ksb_type(item.get('type'))
            raw_code = normalise_ksb_code(item.get('code') or item.get('full_code'), type_code)
            if not raw_code:
                continue
            parent_code = normalise_ksb_code(item.get('parentCode') or item.get('parent_code'), type_code)
            full_code = f'{type_code}{raw_code}'
            normalised_items.append({
                **item,
                'type': type_code,
                'code': raw_code,
                'parentCode': parent_code,
                'fullCode': full_code,
                'displayOrder': parse_int(item.get('displayOrder') or item.get('display_order'), index + 1),
            })

        entries = []
        for item in normalised_items:
            code = item['fullCode']
            raw_code = item['code']
            mapped_modules = sorted(module_names_by_code.get(code, []) or module_names_by_code.get(raw_code, []))
            mapped = bool(mapped_modules)
            entries.append({
                'id': item.get('id') or f'{profile.get("id")}-{slugify(code)}',
                'code': code,
                'rawCode': raw_code,
                'fullCode': code,
                'parentCode': f'{item["type"]}{item["parentCode"]}' if item.get('parentCode') else '',
                'parentId': item.get('parentId') or item.get('parent_id'),
                'displayOrder': item.get('displayOrder') or 0,
                'title': item.get('title') or item.get('description') or code,
                'description': item.get('description') or '',
                'type': ksb_type_label(item.get('type')),
                'standard': profile.get('name') or '',
                'activities': [
                    {'activityType': 'Live Session', 'weight': 20 if mapped else 0},
                    {'activityType': 'Workshop', 'weight': 20 if mapped else 0},
                    {'activityType': 'Self-study', 'weight': 10 if mapped else 0},
                    {'activityType': 'Assignment', 'weight': 20 if mapped else 0},
                    {'activityType': 'Quiz', 'weight': 10 if mapped else 0},
                    {'activityType': 'OTJH', 'weight': 10 if mapped else 0},
                    {'activityType': 'Collaboration', 'weight': 5 if mapped else 0},
                    {'activityType': 'Review', 'weight': 5 if mapped else 0},
                ],
                'modules': mapped_modules or ['Not mapped yet'],
                'assessmentMethod': 'Curriculum plan',
                'mappedBy': profile.get('created_by') or '',
                'status': 'mapped' if mapped else 'unmapped',
                'lastUpdated': format_date(profile.get('updated_at')),
            })

        total = len(normalised_items) or len(knowledge) + len(skills) + len(behaviours)
        knowledge_count = sum(1 for item in normalised_items if item.get('type') == 'K') or len(knowledge)
        skill_count = sum(1 for item in normalised_items if item.get('type') == 'S') or len(skills)
        behaviour_count = sum(1 for item in normalised_items if item.get('type') == 'B') or len(behaviours)
        mapped_count = sum(1 for entry in entries if entry['status'] == 'mapped')
        framework_id = ksb_profile_source_id(profile)
        programme_ids = ksb_profile_context_ids(profile, 'programme_ids')
        primary_programme_id = programme_ids[0] if programme_ids else ''
        display_name = profile.get('name') or 'KSB Framework'
        frameworks.append({
            'id': framework_id,
            'profileId': profile.get('id'),
            'ksbProfileId': framework_id,
            'programmeId': primary_programme_id,
            'programmeIds': programme_ids,
            'cohortIds': [],
            'groupIds': [],
            'moduleCatalogueIds': [],
            'name': display_name,
            'standard': profile.get('name') or '',
            'programmeName': display_name,
            'notes': profile.get('description') or '',
            'ifateRef': display_name,
            'level': parse_int(infer_level(display_name).replace('L', ''), 0),
            'totalKsbs': total,
            'knowledgeCount': knowledge_count,
            'skillCount': skill_count,
            'behaviourCount': behaviour_count,
            'modulesCount': len(set().union(*(module_names_by_code.get(entry['code'], set()) for entry in entries))) if entries else 0,
            'mapped': mapped_count,
            'status': 'published' if profile.get('is_active') else 'archived',
            'lastModified': format_date(profile.get('updated_at')),
            'modifiedBy': profile.get('created_by') or '',
            'version': '1.0',
            'programmes': programme_ids,
        })
        sets.append({
            'frameworkId': framework_id,
            'profileId': profile.get('id'),
            'ksbProfileId': framework_id,
            'programmeId': primary_programme_id,
            'programmeIds': programme_ids,
            'cohortIds': [],
            'groupIds': [],
            'moduleCatalogueIds': [],
            'programmeName': display_name,
            'standard': profile.get('name') or '',
            'notes': profile.get('description') or '',
            'status': 'published' if profile.get('is_active') else 'archived',
            'ksbs': entries,
        })
    return frameworks, sets


def build_curriculum_payload(visibility='operational', compact=False):
    logger.info('build_curriculum_payload: running DB build for visibility=%s compact=%s', visibility, compact)
    return build_curriculum_payload_from_rows(get_curriculum_rows(compact=compact), visibility, compact=compact)


def build_curriculum_payload_from_rows(rows, visibility='operational', compact=False):
    training_rows = rows['training'] if visibility == 'all' else [row for row in rows['training'] if is_operational_training_row(row)]
    ksb_profiles = rows['ksb_profiles'] if visibility == 'all' else [profile for profile in rows['ksb_profiles'] if profile.get('is_active')]
    modules = build_modules(
        rows['modules'],
        training_rows,
        rows['program_configs'],
        include_unused=visibility == 'all',
    )
    if not compact:
        modules = enrich_modules_with_authoring(modules)
    modules = apply_staff_assignments_to_modules(modules, rows['tutors'])
    programmes = build_programmes(
        training_rows,
        rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
    )
    cohorts, groups = build_cohorts_and_groups(
        training_rows,
        rows['program_configs'],
        include_archived=visibility == 'all',
    )
    groups = apply_staff_assignments_to_groups(groups, rows['coaches'])
    sessions = [] if compact else build_sessions(training_rows, rows['modules'], rows['program_configs'], rows['holidays'])
    session_count = sum(parse_int(group.get('sessions'), 0) for group in groups) if compact else len(sessions)
    training_sessions = build_sessions(
        training_rows,
        rows['modules'],
        rows['program_configs'],
        rows['authoring_modules'],
        rows.get('holidays', []),
    )
    authoring_sessions = build_sessions_from_authoring_modules(rows['authoring_modules'])
    sessions = prefer_authoring_module_sessions(training_sessions, authoring_sessions)
    visible_ksb_profiles = ksb_profiles if visibility == 'all' else [
        profile for profile in ksb_profiles
        if profile_matches_visible_programmes(profile, programmes)
    ]
    frameworks, ksb_profiles = build_ksb_data(visible_ksb_profiles, modules, training_rows)

    holiday_rows = rows['holidays'] if visibility == 'all' else [
        item for item in rows['holidays']
        if not truthy(item.get('is_archived')) and not truthy(item.get('archived')) and not truthy(extract_notes_meta(item.get('notes')).get('archived'))
    ]

    payload = {
        'schema': CURRICULUM_SCHEMA,
        'visibility': visibility,
        'stats': {
            'programmes': len(programmes),
            'activeProgrammes': len(programmes),
            'cohorts': len(cohorts),
            'groups': len(groups),
            'modules': len(modules),
            'ksbFrameworks': len(frameworks),
            'sessions': session_count,
        },
        'programmes': programmes,
        'modules': modules,
        'ksbFrameworks': frameworks,
        'ksbSets': ksb_profiles,
        'cohorts': cohorts,
        'groups': groups,
        'sessions': sessions,
        'holidays': [] if compact else [serialize_holiday_row(item) for item in holiday_rows],
        'cohortAuthoringDetails': [] if compact else cohort_authoring_detail_rows(),
        'groupAuthoringDetails': [] if compact else group_authoring_detail_rows(),
        'tutors': [] if compact else build_staff_profiles(training_rows, rows['tutors'], 'tutor', modules),
        'coaches': [] if compact else build_staff_profiles(training_rows, rows['coaches'], 'coach', modules),
        'tutorModules': [] if compact else rows['tutor_modules'],
    }
    return payload


def curriculum_collection_response(payload, key, results=None):
    results = payload[key] if results is None else results
    return JsonResponse({
        'schema': payload['schema'],
        'count': len(results),
        'results': results,
    })


def curriculum_results_response(results):
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'count': len(results),
        'results': results,
    })


def module_belongs_to_group(module, group):
    module_group_id = clean_str(module.get('groupId') or module.get('group_id'))
    module_group_name = clean_str(module.get('group') or module.get('groupName') or module.get('group_name'))
    group_module_ids = {
        normalise(item)
        for item in (group.get('moduleIds') or group.get('module_ids') or [])
        if clean_str(item)
    }
    group_module_names = {
        normalise(item)
        for item in (group.get('modules') or group.get('moduleNames') or group.get('module_names') or [])
        if clean_str(item)
    }
    module_ids = [
        module.get('moduleCatalogueId'),
        module.get('module_catalogue_id'),
        module.get('catalogueId'),
        module.get('moduleId'),
        module.get('module_id'),
        module.get('structureId'),
        module.get('id'),
        module.get('sourceId'),
    ]
    if any(normalise(value) in group_module_ids for value in module_ids if clean_str(value)):
        return True
    if module_group_id or module_group_name:
        return (
            (bool(module_group_id) and matches_curriculum_identifier(module_group_id, group.get('id')))
            or (bool(module_group_name) and normalise(module_group_name) == normalise(group.get('name')))
        )
    return (
        bool(module.get('name')) and normalise(module.get('name')) in group_module_names
    )


def normalise_skills_england_type(value):
    raw = clean_str(value).lower()
    if raw.startswith('skill'):
        return 'Skill'
    if raw.startswith('behaviour') or raw.startswith('behavior'):
        return 'Behaviour'
    return 'Knowledge'


def format_skills_england_funding(value):
    raw = clean_str(value).replace('\u0141', '\u00a3')
    if not raw:
        return ''
    digits = re.sub(r'[^0-9]', '', raw)
    if digits:
        return f'\u00a3{int(digits):,}'
    return raw


def skills_england_ksb_sort_key(item):
    code = clean_str(item.get('code') or item.get('ksb_code')).upper()
    match = re.match(r'^([A-Z]+)([0-9.]+)?', code)
    prefix = match.group(1) if match else code
    number = match.group(2) if match else ''
    parts = []
    for part in number.split('.'):
        if part == '':
            continue
        parts.append(int(part) if part.isdigit() else part)
    return (
        {'K': 0, 'S': 1, 'B': 2}.get(prefix[:1], 9),
        prefix,
        parts,
        len(parts),
        code,
    )


def skills_england_standard_id(row):
    return slugify(f'{row.get("standard_ref")}-v{row.get("standard_version")}')


def build_skills_england_standards():
    grouped = {}
    for row in get_skills_england_ksb_rows():
        key = (clean_str(row.get('standard_ref')), clean_str(row.get('standard_version')))
        standard = grouped.setdefault(key, {
            'id': skills_england_standard_id(row),
            'code': row.get('standard_ref') or '',
            'standardRef': row.get('standard_ref') or '',
            'version': row.get('standard_version') or '',
            'name': row.get('standard_title') or 'Untitled standard',
            'status': row.get('status') or '',
            'level': f'Level {row.get("level")}' if row.get('level') else '',
            'levelValue': row.get('level') or '',
            'degree': row.get('degree') or '',
            'route': row.get('route') or '',
            'duration': row.get('typical_duration') or '',
            'minimumHours': row.get('minimum_hours_for_compliance') or '',
            'maxFunding': format_skills_england_funding(row.get('maximum_funding')),
            'larsCode': row.get('lars_code') or '',
            'eqaProvider': row.get('eqa_provider') or '',
            'sourceUrl': row.get('source_url') or '',
            'approvedForDelivery': row.get('approved_for_delivery') or '',
            'dateUpdated': row.get('date_updated') or '',
            'lastSynced': format_date(row.get('updated_at') or row.get('created_at')),
            'knowledge': 0,
            'skills': 0,
            'behaviours': 0,
            'total': 0,
            'ksbs': [],
        })
        ksb_type = normalise_skills_england_type(row.get('ksb_type'))
        bucket = 'knowledge' if ksb_type == 'Knowledge' else ('skills' if ksb_type == 'Skill' else 'behaviours')
        standard[bucket] += 1
        standard['total'] += 1
        standard['ksbs'].append({
            'id': row.get('id'),
            'code': row.get('ksb_code') or '',
            'type': ksb_type,
            'description': row.get('ksb_description') or '',
        })

    standards = []
    for standard in grouped.values():
        standard['ksbs'].sort(key=lambda item: (
            {'Knowledge': 0, 'Skill': 1, 'Behaviour': 2}.get(item['type'], 9),
            skills_england_ksb_sort_key(item),
        ))
        standards.append({
            **standard,
            'sampleKsbs': standard['ksbs'][:3],
        })
    return sorted(standards, key=lambda item: (item['code'], item['version']))


def find_skills_england_standard(identifier):
    ident = clean_str(identifier).lower()
    for standard in build_skills_england_standards():
        candidates = {
            clean_str(standard.get('id')).lower(),
            clean_str(standard.get('code')).lower(),
            slugify(standard.get('name')).lower(),
            slugify(f'{standard.get("code")}-v{standard.get("version")}').lower(),
        }
        if ident in candidates:
            return standard
    return None


@require_GET
def curriculum_standards(request):
    # Reference data: identical for every user and changed only by a standards
    # import, so it revalidates cheaply via ETag. Four curriculum pages fetch this
    # on mount, and each repeat visit now costs a 304 instead of the full list.
    standards = cached_curriculum_value('skills-england-standards', build_skills_england_standards)
    return reference_json_response(request, {
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'standard_ksbs',
        'count': len(standards),
        'results': standards,
    })


@require_GET
def curriculum_standard_detail(request, identifier):
    standard = find_skills_england_standard(identifier)
    if not standard:
        return json_error('Skills England standard not found.', status=404)
    return reference_json_response(request, {
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'standard_ksbs',
        **standard,
    })


def split_ksb_source(source_type='', source_id=''):
    raw_source_id = clean_str(source_id)
    raw_source_type = clean_str(source_type).lower()
    if ':' in raw_source_id:
        prefix, value = raw_source_id.split(':', 1)
        if prefix in {'standard', 'profile', 'framework'}:
            raw_source_type = 'framework' if prefix == 'framework' else prefix
            raw_source_id = value
    if raw_source_type in {'skills_standard', 'skills-england', 'skills_england'}:
        raw_source_type = 'standard'
    if raw_source_type in {'ksb_profile', 'profile'}:
        raw_source_type = 'framework'
    if raw_source_id and not raw_source_type:
        raw_source_type = 'framework'
    return raw_source_type, raw_source_id


def standard_required_ksb_definitions(standard, fallback_id=''):
    if not standard:
        return []
    source_id = standard.get('id') or fallback_id
    return [
        {
            'ksb_id': f'{source_id}:{ksb.get("code")}',
            'code': ksb.get('code'),
            'title': ksb.get('code'),
            'description': ksb.get('description') or '',
            'ksb_type': ksb_type_from_value(ksb.get('type'), ksb.get('code')),
            'source_type': 'standard',
            'source_id': source_id,
        }
        for ksb in standard.get('ksbs') or []
    ]


def standard_required_ksbs(identifier):
    return standard_required_ksb_definitions(find_skills_england_standard(identifier), identifier)


def all_standard_required_ksbs():
    definitions = []
    seen = set()
    for standard in build_skills_england_standards():
        for definition in standard_required_ksb_definitions(standard, standard.get('id')):
            identity = (
                clean_str(definition.get('source_type')).lower(),
                clean_str(definition.get('source_id')).lower(),
                coverage_normalise_code(definition.get('code')),
            )
            if identity in seen:
                continue
            seen.add(identity)
            definitions.append(definition)
    return definitions


def profile_required_ksbs(identifier):
    ident = clean_str(identifier).replace('ksb-', '', 1)
    rows = get_ksb_profile_rows()
    matched = None
    for row in rows:
        row_ids = {
            clean_str(row.get('id')),
            f'ksb-{clean_str(row.get("id"))}',
            clean_str(row.get('ksb_profile_id')),
            slugify(row.get('name') or ''),
            *ksb_profile_context_ids(row, 'programme_ids'),
        }
        if clean_str(identifier) in row_ids or ident in row_ids:
            matched = row
            break
    if not matched:
        return []
    source_id = ksb_profile_source_id(matched)
    items = parse_json_value(matched.get('ksb_items'), [])
    definitions = []
    for item in items if isinstance(items, list) else []:
        type_code = normalise_ksb_type(item.get('type'))
        code = full_ksb_code(item)
        if not code:
            continue
        definitions.append({
            'ksb_id': clean_str(item.get('id')) or f'{source_id}:{code}',
            'code': code,
            'title': item.get('title') or code,
            'description': item.get('description') or item.get('title') or '',
            'ksb_type': ksb_type_from_value(type_code, code),
            'source_type': 'framework',
            'source_id': source_id,
        })
    return definitions


def all_profile_required_ksbs(active_only=True):
    definitions = []
    seen = set()
    for row in get_ksb_profile_rows():
        if active_only and not truthy(row.get('is_active')):
            continue
        for definition in profile_required_ksbs(ksb_profile_source_id(row)):
            identity = (
                clean_str(definition.get('source_type')).lower(),
                clean_str(definition.get('source_id')).lower(),
                coverage_normalise_code(definition.get('code')),
            )
            if identity in seen:
                continue
            seen.add(identity)
            definitions.append(definition)
    return definitions


def required_ksbs_for_source(source_type='', source_id=''):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if source_type == 'standard' and not source_id:
        return all_standard_required_ksbs()
    if source_type in {'framework', 'profile'} and not source_id:
        return all_profile_required_ksbs()
    if source_type == 'standard' and source_id:
        return standard_required_ksbs(source_id)
    if source_type in {'framework', 'profile'} and source_id:
        return profile_required_ksbs(source_id)
    return []


def source_required_ksbs(source_type, source_id, cache=None):
    source_type, source_id = split_ksb_source(source_type, source_id)
    cache = cache if cache is not None else {}
    key = (source_type, source_id)
    if key not in cache:
        cache[key] = required_ksbs_for_source(source_type, source_id)
    return cache[key]


def source_record_exists(source_type, source_id, cache=None):
    return bool(source_required_ksbs(source_type, source_id, cache))


def ksb_exists_in_source(source_type, source_id, code, cache=None):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if not source_type or not source_id:
        return False
    normalised = coverage_normalise_code(code)
    return any(coverage_normalise_code(item.get('code')) == normalised for item in source_required_ksbs(source_type, source_id, cache))


def source_payload_from_mapping(mapping):
    source_type = mapping.get('sourceType') or mapping.get('source_type')
    source_id = mapping.get('sourceId') or mapping.get('source_id')
    source_type, source_id = split_ksb_source(source_type, source_id)
    return source_type, source_id


def source_type_label(source_type):
    return 'Skills England standard' if source_type == 'standard' else 'KSB framework'


def source_display_metadata(source_type='', source_id=''):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if source_type == 'standard' and source_id:
        standard = find_skills_england_standard(source_id)
        if standard:
            name = clean_str(standard.get('name')) or clean_str(standard.get('code')) or source_id
            ref = clean_str(standard.get('code'))
            version = clean_str(standard.get('version'))
            suffix = ' '.join(part for part in [ref, f'v{version}' if version else ''] if part)
            label = f'{name} ({suffix})' if suffix and suffix.lower() not in name.lower() else name
            return {
                'source_name': name,
                'sourceName': name,
                'source_label': label,
                'sourceLabel': label,
            }
    if source_type in {'framework', 'profile'} and source_id:
        ident = clean_str(source_id).replace('ksb-', '', 1)
        matched = next((
            row for row in get_ksb_profile_rows()
            if ident in {
                clean_str(row.get('id')),
                slugify(row.get('name') or ''),
                *ksb_profile_context_ids(row, 'programme_ids'),
            } or ident in {slugify(value) for value in ksb_profile_context_ids(row, 'programme_ids')}
        ), None)
        if matched:
            name = clean_str(matched.get('name')) or source_id
            label = name
            return {
                'source_name': name,
                'sourceName': name,
                'source_label': label,
                'sourceLabel': label,
            }
    fallback_type = source_type_label(source_type) if source_type else ''
    fallback = f'{fallback_type}: {source_id}' if fallback_type and source_id else ''
    return {
        'source_name': fallback,
        'sourceName': fallback,
        'source_label': fallback,
        'sourceLabel': fallback,
    }


def annotate_coverage_sources(coverage):
    cache = {}

    def apply_metadata(item):
        if not isinstance(item, dict):
            return item
        source_type = item.get('source_type') or item.get('sourceType')
        source_id = item.get('source_id') or item.get('sourceId')
        key = (clean_str(source_type), clean_str(source_id))
        if key not in cache:
            cache[key] = source_display_metadata(source_type, source_id)
        item.update(cache[key])
        return item

    for item in coverage.get('items') or []:
        apply_metadata(item)
        for mapping in item.get('mappings') or []:
            apply_metadata(mapping)
    for row in (coverage.get('heatmap') or {}).get('rows') or []:
        apply_metadata(row)
        for module in row.get('modules') or []:
            for mapping in module.get('mappings') or []:
                apply_metadata(mapping)
    return coverage


def source_type_mismatch_message(source_type, source_id):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if source_type == 'standard' and source_id.startswith('ksb-'):
        return 'Framework KSB cannot be submitted using a Standard source.'
    return ''


def component_mapping_identity(component_id, mapping):
    source_type, source_id = source_payload_from_mapping(mapping)
    return (
        clean_str(component_id),
        coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code')),
        source_type,
        source_id,
    )


def duplicate_mapping_query(component_id, identities, exclude_id=''):
    identities = [identity for identity in identities if identity[0] and identity[1]]
    if not identities:
        return []
    clauses = []
    params = []
    for _, code, source_type, source_id in identities:
        clauses.append('(component_id = %s and upper(ksb_code) = %s and coalesce(source_type, %s) = %s and coalesce(source_id, %s) = %s)')
        params.extend([component_id, code, '', source_type, '', source_id])
    where = ' or '.join(clauses)
    if exclude_id:
        where = f'id <> %s and ({where})'
        params = [exclude_id, *params]
    return authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, where, params)


def ensure_authoring_mapping_unique(component_id, mapping, mapping_id=''):
    identity = component_mapping_identity(component_id, mapping)
    if not identity[0] or not identity[1]:
        return
    duplicate = duplicate_mapping_query(component_id, [identity], exclude_id=mapping_id)
    if duplicate:
        raise ValueError('This KSB is already mapped to this component.')


def validate_ksb_mapping_payload(mapping, path='ksbMappings', source_cache=None):
    errors = []
    code = coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode'))
    classification = clean_str(mapping.get('classification') or mapping.get('type')).lower()
    weight_value = mapping.get('weight')
    source_type, source_id = source_payload_from_mapping(mapping)
    if not code:
        errors.append({'path': f'{path}.code', 'message': 'KSB code is required.'})
    if classification not in SUPPORTED_CLASSIFICATIONS:
        errors.append({'path': f'{path}.classification', 'message': 'Classification must be main, secondary, or possible.'})
    try:
        weight = float(weight_value)
    except (TypeError, ValueError):
        weight = None
    if weight is None:
        errors.append({'path': f'{path}.weight', 'message': 'Weight must be numeric.'})
    elif weight <= 0:
        errors.append({'path': f'{path}.weight', 'message': 'Weight must be greater than zero.'})
    if source_type not in SUPPORTED_KSB_SOURCE_TYPES:
        errors.append({'path': f'{path}.sourceType', 'message': 'Source type must be standard or framework.'})
    if not source_id:
        errors.append({'path': f'{path}.sourceId', 'message': 'Source identifier is required.'})
    mismatch_message = source_type_mismatch_message(source_type, source_id) if source_type and source_id else ''
    if mismatch_message:
        errors.append({'path': f'{path}.source', 'message': mismatch_message})
    if source_type in SUPPORTED_KSB_SOURCE_TYPES and source_id and not mismatch_message:
        if not source_record_exists(source_type, source_id, source_cache):
            errors.append({'path': f'{path}.sourceId', 'message': f'Selected {source_type_label(source_type)} source was not found.'})
        elif code and not ksb_exists_in_source(source_type, source_id, code, source_cache):
            errors.append({'path': f'{path}.code', 'message': f'{code} does not belong to the selected {source_type_label(source_type)} source.'})
    return errors


def validate_mapping_duplicates(mappings, path):
    errors = []
    seen = set()
    for index, mapping in enumerate(mappings or []):
        key = component_mapping_identity('component', mapping)[1:]
        if key[0] and key in seen:
            errors.append({'path': f'{path}.{index}.code', 'message': 'This KSB is already mapped to this component.'})
        seen.add(key)
    return errors


def serialize_holiday_row(row):
    return {
        'id': row.get('id'),
        'label': row.get('label'),
        'startDate': format_date(row.get('start_date') or row.get('startDate')),
        'endDate': format_date(row.get('end_date') or row.get('endDate')),
        'type': row.get('type'),
        'color': row.get('color'),
    }


def date_ranges_overlap(left_start, left_end, right_start, right_end):
    left_start = parse_date(left_start)
    left_end = parse_date(left_end) or left_start
    right_start = parse_date(right_start)
    right_end = parse_date(right_end) or right_start
    if not left_start or not left_end or not right_start or not right_end:
        return False
    return left_start <= right_end and right_start <= left_end


def infer_duration_months(start_value, end_value, fallback=0):
    explicit = parse_int(fallback, 0)
    if explicit > 0:
        return explicit
    start = parse_date(start_value)
    end = parse_date(end_value)
    if not start or not end or end < start:
        return 0
    months = (end.year - start.year) * 12 + (end.month - start.month)
    if end.day >= max(1, start.day - 1):
        months += 1
    return max(1, months)


def canonical_programme_id(value='', programme_name=''):
    candidate = clean_str(value)
    if candidate.lower().startswith('program-prog-'):
        return candidate[len('program-'):].upper()
    if re.match(r'^PROG-[A-Z0-9][A-Z0-9_-]*$', candidate, re.I):
        return candidate.upper()
    try:
        configs = get_program_config_rows()
    except (Exception, AssertionError):
        configs = []
    candidate_keys = {candidate, slugify(candidate)}
    if candidate:
        candidate_keys.add(f'program-{slugify(candidate)}')
    programme_key = normalise(programme_name)
    for config in configs:
        config_id = programme_config_id(config)
        if not config_id:
            continue
        config_candidates = {
            config_id,
            slugify(config_id),
            f'program-{slugify(config_id)}',
        }
        if candidate and candidate_keys.intersection(config_candidates):
            return config_id
        if programme_key and programme_key in {normalise(config.get('name')), normalise(config.get('sub'))}:
            return config_id
    return candidate


def cohort_holiday_details(holiday_rows, holiday_ids, start_date, end_date):
    selected_ids = parse_notes_id_list(holiday_ids)
    selected_id_set = {clean_str(item) for item in selected_ids}
    serialized = [serialize_holiday_row(row) for row in (holiday_rows or [])]
    in_range = [
        item for item in serialized
        if date_ranges_overlap(start_date, end_date, item.get('startDate'), item.get('endDate'))
    ]
    selected = [
        item for item in serialized
        if clean_str(item.get('id')) in selected_id_set
    ]
    return {
        'holidayIds': selected_ids,
        'selectedHolidays': selected,
        'holidaysInRange': in_range,
        'summary': {
            'global': len(serialized),
            'inRange': len(in_range),
            'selected': len(selected_ids),
        },
    }


def cohort_authoring_payload(cohort, rows=None, groups=None, holiday_rows=None, extra=None):
    cohort = cohort or {}
    rows = rows or []
    groups = groups or []
    meta = {}
    for row in rows:
        meta.update(row.get('_meta') or extract_notes_meta(row.get('notes')))
    start_date = format_date(cohort.get('startDate') or next((row.get('Starting_date_lable') or row.get('start_date') for row in rows if row), ''))
    end_date = format_date(cohort.get('endDate') or meta.get('cohort_end_date') or next((row.get('end_date') for row in rows if row), ''))
    holiday_info = cohort_holiday_details(
        holiday_rows or [],
        cohort.get('holidayIds') or meta.get('holiday_ids'),
        start_date,
        end_date,
    )
    training_plan_ids = [clean_str(row.get('id')) for row in rows if row.get('id') not in (None, '')]
    module_names = sorted({
        clean_str(row.get('module_name'))
        for row in rows
        if clean_str(row.get('module_name'))
    })
    group_ids = sorted({
        clean_str(group.get('id'))
        for group in groups
        if clean_str(group.get('id'))
    })
    programme_name = clean_str(cohort.get('programme') or next((row.get('Program') for row in rows if row), ''))
    programme_source_id = canonical_programme_id(meta.get('program_id') or meta.get('programme_id') or cohort.get('programmeId'), programme_name)
    if (not programme_source_id or programme_source_id.lower().startswith('program-')) and rows:
        try:
            programme_source_id = canonical_programme_id(programme_identity(rows[0], program_config_by_id(get_program_config_rows())).get('sourceId'), programme_name)
        except (Exception, AssertionError):
            pass
    payload = {
        'cohort_id': clean_str(cohort.get('id') or meta.get('cohort_id')),
        'cohort_name': clean_str(cohort.get('name') or next((row.get('Cohort_name') for row in rows if row), '')),
        'programme_id': programme_source_id or clean_str(cohort.get('programmeId')),
        'programme_name': programme_name,
        'start_date': start_date or None,
        'end_date': end_date or None,
        'duration_months': infer_duration_months(start_date, end_date, meta.get('duration_months')),
        'color': cohort.get('color') or meta.get('cohort_color') or '',
        'status': cohort.get('status') or 'planned',
        'training_plan_ids': json_db_value(training_plan_ids),
        'group_ids': json_db_value(group_ids or cohort.get('groups') or []),
        'module_names': json_db_value(module_names or cohort.get('modules') or []),
        'holiday_ids': json_db_value(holiday_info['holidayIds']),
        'selected_holidays': json_db_value(holiday_info['selectedHolidays']),
        'holidays_in_range': json_db_value(holiday_info['holidaysInRange']),
        'holiday_summary': json_db_value(holiday_info['summary']),
        'notes': next((clean_str(row.get('notes')) for row in rows if clean_str(row.get('notes'))), ''),
        'source_type': 'curriculum_authoring',
        'source_id': training_plan_ids[0] if training_plan_ids else '',
    }
    payload.update(extra or {})
    return payload


def persist_cohort_authoring_detail(cohort, rows=None, groups=None, holiday_rows=None, extra=None):
    payload = cohort_authoring_payload(cohort, rows, groups, holiday_rows, extra)
    if not payload.get('cohort_id'):
        return None
    try:
        return authoring_upsert(COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], payload)
    except (Exception, AssertionError) as exc:
        logger.warning('Could not persist cohort authoring details for %s: %s', payload.get('cohort_id'), exc)
        return None


def serialize_cohort_authoring_detail(row):
    return {
        'cohortId': row.get('cohort_id'),
        'cohortName': row.get('cohort_name'),
        'programmeId': row.get('programme_id'),
        'programmeName': row.get('programme_name'),
        'startDate': format_date(row.get('start_date')),
        'endDate': format_date(row.get('end_date')),
        'durationMonths': parse_int(row.get('duration_months'), 0),
        'color': row.get('color') or '',
        'status': row.get('status') or 'planned',
        'trainingPlanIds': as_json_value(row.get('training_plan_ids'), []),
        'groupIds': as_json_value(row.get('group_ids'), []),
        'moduleNames': as_json_value(row.get('module_names'), []),
        'holidayIds': as_json_value(row.get('holiday_ids'), []),
        'selectedHolidays': as_json_value(row.get('selected_holidays'), []),
        'holidaysInRange': as_json_value(row.get('holidays_in_range'), []),
        'holidaySummary': as_json_value(row.get('holiday_summary'), {}),
        'notes': row.get('notes') or '',
        'sourceType': row.get('source_type') or 'curriculum_authoring',
        'sourceId': row.get('source_id') or '',
        'updatedAt': format_date(row.get('updated_at')),
    }


def cohort_authoring_detail_rows():
    try:
        return [
            serialize_cohort_authoring_detail(row)
            for row in authoring_fetch_all(
                COHORT_AUTHORING_DETAILS_TABLE,
                order_sql='programme_name, cohort_name, start_date',
            )
        ]
    except (Exception, AssertionError) as exc:
        logger.warning('Could not read cohort authoring details: %s', exc)
        return []


def module_row_belongs_to_group(row, group):
    group_id = clean_str(group.get('id') or group.get('groupId') or group.get('group_id'))
    cohort_id = clean_str(group.get('cohortId') or group.get('cohort_id'))
    group_name = normalise(group.get('name') or group.get('groupName') or group.get('group_name'))
    row_group_id = clean_str(row.get('group_id'))
    row_cohort_id = clean_str(row.get('cohort_id'))
    if group_id and row_group_id == group_id:
        return True
    if group_name and normalise(row.get('group_name')) == group_name:
        return not cohort_id or not row_cohort_id or row_cohort_id == cohort_id
    return False


def group_authoring_payload(group, rows=None, module_rows=None, extra=None):
    rows = rows or []
    module_rows = [row for row in (module_rows or []) if module_row_belongs_to_group(row, group)]
    first_row = rows[0] if rows else {}
    meta = extract_notes_meta(first_row.get('notes')) if first_row else {}
    group_id = clean_str(group.get('id') or group.get('groupId') or group.get('group_id') or meta.get('group_id'))
    if not group_id:
        return {}
    existing_group = fetch_group_row(group_id) or {}
    group_name = clean_str(group.get('name') or group.get('groupName') or group.get('group_name') or meta.get('group_name') or group_id)
    cohort_id = clean_str(group.get('cohortId') or group.get('cohort_id') or meta.get('cohort_id'))
    cohort_name = clean_str(group.get('cohort') or group.get('cohortName') or group.get('cohort_name') or first_row.get('Cohort_name'))
    programme_name = clean_str(group.get('programme') or group.get('programmeName') or group.get('programme_name') or first_row.get('Program'))
    programme_id = canonical_programme_id(
        meta.get('program_id') or meta.get('programme_id') or group.get('programmeId') or group.get('programme_id'),
        programme_name,
    )
    if (not programme_id or programme_id.lower().startswith('program-')) and rows:
        try:
            programme_id = canonical_programme_id(programme_identity(rows[0], program_config_by_id(get_program_config_rows())).get('sourceId'), programme_name)
        except (Exception, AssertionError):
            pass
    module_ids = unique([
        row.get('module_catalogue_id')
        for row in module_rows
        if row.get('module_catalogue_id')
    ])
    module_names = unique([
        *[row.get('title') for row in module_rows if row.get('title')],
        *[name for name in (group.get('modules') or []) if name],
    ])
    training_plan_ids = unique([
        *[row.get('id') for row in rows if row.get('id') not in (None, '')],
        *[
            row.get('source_id')
            for row in module_rows
            if row.get('source_id')
        ],
    ])
    payload = {
        'group_id': group_id,
        'group_name': group_name,
        'cohort_id': cohort_id,
        'cohort_name': cohort_name,
        'programme_id': programme_id or clean_str(group.get('programmeId') or group.get('programme_id')),
        'programme_name': programme_name,
        'module_ids': json_db_value(module_ids),
        'module_names': json_db_value(module_names),
        'training_plan_ids': json_db_value(training_plan_ids),
        'coach_name': canonical_staff_assignment_name('coach', group.get('coach') or group.get('coachName') or first_row.get('coach_name') or existing_group.get('coach_name')),
        'tutor_name': canonical_staff_assignment_name('tutor', group.get('tutor') or group.get('tutorName') or first_row.get('Tutor_name') or existing_group.get('tutor_name')),
        'start_date': format_date(group.get('startDate') or first_row.get('start_date')) or None,
        'end_date': format_date(group.get('endDate') or first_row.get('end_date')) or None,
        'schedule': clean_str(group.get('schedule') or existing_group.get('schedule')),
        'color': clean_str(group.get('color') or existing_group.get('color')),
        'status': clean_str(group.get('status') or existing_group.get('status')) or 'planned',
        'notes': clean_str(first_row.get('notes') or group.get('notes')),
        'source_type': 'curriculum_authoring',
        'source_id': training_plan_ids[0] if training_plan_ids else '',
    }
    payload.update(extra or {})
    return payload


def persist_group_authoring_detail(group, rows=None, module_rows=None, extra=None):
    payload = group_authoring_payload(group, rows, module_rows, extra)
    if not payload.get('group_id'):
        return None
    try:
        return authoring_upsert(GROUPS_TABLE, ['group_id'], payload)
    except (Exception, AssertionError) as exc:
        logger.warning('Could not persist group authoring details for %s: %s', payload.get('group_id'), exc)
        return None


def serialize_group_authoring_detail(row):
    return {
        'id': row.get('group_id'),
        'name': row.get('group_name'),
        'cohortId': row.get('cohort_id'),
        'cohort': row.get('cohort_name'),
        'programmeId': row.get('programme_id'),
        'programme': row.get('programme_name'),
        'modules': as_json_value(row.get('module_names'), []),
        'moduleIds': as_json_value(row.get('module_ids'), []),
        'trainingPlanIds': as_json_value(row.get('training_plan_ids'), []),
        'coach': row.get('coach_name') or 'Unassigned',
        'tutor': row.get('tutor_name') or 'Unassigned',
        'startDate': format_date(row.get('start_date')),
        'endDate': format_date(row.get('end_date')),
        'schedule': row.get('schedule') or '',
        'color': row.get('color') or '',
        'status': row.get('status') or 'planned',
        'notes': row.get('notes') or '',
        'sourceType': row.get('source_type') or 'curriculum_authoring',
        'sourceId': row.get('source_id') or '',
        'updatedAt': format_date(row.get('updated_at')),
    }


def group_authoring_detail_rows():
    try:
        return [
            serialize_group_authoring_detail(row)
            for row in authoring_fetch_all(
                GROUPS_TABLE,
                order_sql='programme_name, cohort_name, group_name, start_date',
            )
        ]
    except (Exception, AssertionError) as exc:
        logger.warning('Could not read group authoring details: %s', exc)
        return []


def sync_group_authoring_details_from_modules():
    try:
        module_rows = safe_authoring_module_rows()
        groups_by_id = {}
        for row in module_rows:
            group_id = clean_str(row.get('group_id'))
            group_name = clean_str(row.get('group_name'))
            if not group_id:
                continue
            group = groups_by_id.setdefault(group_id, {
                'id': group_id,
                'name': group_name or group_id,
                'cohortId': clean_str(row.get('cohort_id')),
                'cohort': clean_str(row.get('cohort_name')),
                'programmeId': clean_str(row.get('programme_id')),
                'programme': clean_str(row.get('programme_name')),
                'startDate': format_date(row.get('start_date')),
                'endDate': format_date(row.get('end_date')),
                'mode': 'Live',
                'status': clean_str(row.get('status')) or 'planned',
                'modules': [],
            })
            if row.get('title'):
                group['modules'].append(row.get('title'))
            row_start = parse_date(row.get('start_date'))
            group_start = parse_date(group.get('startDate'))
            if row_start and (not group_start or row_start < group_start):
                group['startDate'] = format_date(row_start)
            row_end = parse_date(row.get('end_date'))
            group_end = parse_date(group.get('endDate'))
            if row_end and (not group_end or row_end > group_end):
                group['endDate'] = format_date(row_end)
        for group in groups_by_id.values():
            group['modules'] = unique(group.get('modules') or [])
            persist_group_authoring_detail(group, [], module_rows)
    except (Exception, AssertionError) as exc:
        logger.warning('Could not sync group authoring details from modules: %s', exc)


def sync_cohort_authoring_details_from_training():
    sync_group_authoring_details_from_modules()


def curriculum_identifier_candidates(value):
    text = clean_str(value)
    candidates = {
        text,
        slugify(text),
    }
    if text:
        candidates.add(f'program-{slugify(text)}')
    return {candidate for candidate in candidates if candidate}


def matches_curriculum_identifier(value, identifier):
    expected = clean_str(identifier)
    return expected in curriculum_identifier_candidates(value)


@require_GET
def curriculum_overview(request):
    visibility = curriculum_visibility(request)
    compact = request.GET.get('compact') in {'1', 'true', 'yes'}
    cache_key = f'overview:{visibility}:{"compact" if compact else "full"}'

    def build_overview():
        return build_curriculum_payload(visibility, compact=compact)

    return JsonResponse(cached_curriculum_value(cache_key, build_overview))


def get_cached_payload(request, compact=False):
    visibility = curriculum_visibility(request)
    cache_key = f'overview:{visibility}:{"compact" if compact else "full"}'
    return cached_curriculum_value(cache_key, lambda: build_curriculum_payload(visibility, compact=compact))


def find_programme(payload, identifier):
    ident = clean_str(identifier)
    fallback = None
    for programme in payload['programmes']:
        exact_candidates = {
            clean_str(programme.get('id')),
            clean_str(programme.get('sourceId')),
            f'program-{slugify(programme.get("sourceId"))}',
        }
        name_candidates = {
            slugify(programme.get('sourceId')),
            slugify(programme.get('name')),
            f'program-{slugify(programme.get("name"))}',
        }
        if ident in exact_candidates:
            return programme
        if not fallback and ident in name_candidates:
            fallback = programme
    return fallback


def rows_for_programme(identifier, visibility='all'):
    curriculum_rows = get_curriculum_rows()
    payload = build_curriculum_payload_from_rows(curriculum_rows, visibility)
    programme = find_programme(payload, identifier)
    if not programme:
        return None, []
    rows = []
    configs_by_id = program_config_by_id(curriculum_rows['program_configs'])
    for row in curriculum_rows['training']:
        identity = programme_identity(row, configs_by_id)
        if (
            clean_str(identity['sourceId']) == clean_str(programme['sourceId'])
            or clean_str(identity['name']) == clean_str(programme['name'])
        ):
            rows.append(row)
    return programme, rows


# LEGACY/UNUSED: superseded by resolve_cohort_row()/resolve_group_row(), which
# read curriculum.cohorts/groups directly by canonical id. The three functions
# below (find_training_rows_by_cohort/group, find_group_with_parent) are no
# longer called by any active Curriculum endpoint and are retained only for
# reference/migration tooling. Do not reintroduce them into request handlers.
def find_training_rows_by_cohort(cohort_id):
    rows = get_training_rows()
    program_configs = get_program_config_rows()
    cohorts, _ = build_cohorts_and_groups(rows, program_configs)
    cohort = next((item for item in cohorts if clean_str(item['id']) == clean_str(cohort_id)), None)
    if not cohort:
        return None, []
    matches = []
    configs_by_id = program_config_by_id(program_configs)
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        candidate = actual_cohort_identity(row, identity['name'])
        if candidate and candidate['id'] == cohort['id']:
            matches.append(row)
    return cohort, matches


def find_training_rows_by_group(group_id):
    rows = get_training_rows()
    program_configs = get_program_config_rows()
    _, groups = build_cohorts_and_groups(rows, program_configs)
    group = next((item for item in groups if clean_str(item['id']) == clean_str(group_id)), None)
    if not group:
        return None, []
    configs_by_id = program_config_by_id(program_configs)
    matches = []
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        cohort = actual_cohort_identity(row, identity['name'])
        candidate = actual_group_identity(row, cohort['id']) if cohort else None
        if candidate and candidate['id'] == group['id']:
            matches.append(row)
    return group, matches


def find_group_with_parent(group_id):
    rows = get_training_rows()
    program_configs = get_program_config_rows()
    cohorts, groups = build_cohorts_and_groups(rows, program_configs)
    group = next((item for item in groups if clean_str(item['id']) == clean_str(group_id)), None)
    if not group:
        return None, None, []
    cohort = next((item for item in cohorts if item['id'] == group['cohortId']), None)
    configs_by_id = program_config_by_id(program_configs)
    training_rows = []
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        row_cohort = actual_cohort_identity(row, identity['name'])
        candidate = actual_group_identity(row, row_cohort['id']) if row_cohort else None
        if candidate and candidate['id'] == group['id']:
            training_rows.append(row)
    return group, cohort, training_rows


def training_row_where_ids(rows):
    ids = [row.get('id') for row in rows if row.get('id') is not None]
    if not ids:
        return None, []
    return f'id in ({", ".join(["%s"] * len(ids))})', ids


def programme_config_by_identifier(identifier):
    ident = clean_str(identifier)
    fallback = None
    for config in get_program_config_rows():
        config_id = programme_config_id(config)
        exact_candidates = {
            config_id,
            clean_str(config.get('programme_id')),
            clean_str(config.get('program_id')),
            clean_str(config.get('id')),
            f'program-{slugify(config_id)}',
        }
        name_candidates = {
            slugify(config_id),
            slugify(config.get('programme_id')),
            slugify(config.get('program_id')),
            slugify(config.get('name')),
            f'program-{slugify(config.get("name"))}',
        }
        if ident in exact_candidates:
            return config
        if not fallback and ident in name_candidates:
            fallback = config
    return fallback


def programme_response(identifier):
    payload = build_curriculum_payload('all')
    programme = find_programme(payload, identifier)
    if not programme:
        return None
    return programme


def ensure_programme_config_for_authoring(programme_name, programme_id=None):
    name = clean_str(programme_name)
    if not name or normalise(name) in {'unassignedprogramme', 'unassigned'}:
        return None

    ensure_program_config_archive_columns()
    configs = get_program_config_rows()
    requested_id = clean_str(programme_id)
    existing = next((
        config for config in configs
        if requested_id and clean_str(config.get('program_id') or config.get('id')) == requested_id
    ), None)
    if not existing:
        existing = next((
            config for config in configs
            if normalise(config.get('name')) == normalise(name)
        ), None)
    now = datetime.utcnow()

    if existing:
        try:
            key_column = programme_config_key_column()
        except Exception:
            key_column = programme_config_key_column()
        key_value = existing.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], {
            'name': name,
            'sub': existing.get('sub') or existing.get('standard') or name,
            'standard': existing.get('standard') or existing.get('sub') or name,
            'is_active': True,
            'is_archived': False,
            'updated_at': now,
        })
        invalidate_curriculum_cache()
        source_id = programme_config_id(existing) or clean_str(key_value)
        return {
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': existing.get('standard') or existing.get('sub') or name,
        }

    source_id = unique_program_id(requested_id or name, configs)
    insert_row('programmes', {
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'name': name,
        'sub': name,
        'standard': name,
        'is_active': True,
        'is_archived': False,
        'color': '#6941c6',
        'description': '',
        'created_at': now,
        'updated_at': now,
    })
    invalidate_curriculum_cache()
    return {'id': source_id, 'sourceId': source_id, 'name': name, 'standard': name}


def module_response(identifier):
    payload = build_curriculum_payload('all')
    ident = clean_str(identifier)
    for module in enrich_modules_with_authoring(payload['modules']):
        identifiers = {
            clean_str(module.get('id')),
            clean_str(module.get('sourceId')),
            clean_str(module.get('catalogueId')),
            *[clean_str(item) for item in (module.get('relatedCatalogueIds') or [])],
        }
        if ident in identifiers:
            return module
    return None


AUTHORING_MODULES_TABLE = 'modules'
AUTHORING_WEEKS_TABLE = 'weeks'
AUTHORING_COMPONENTS_TABLE = 'components'
AUTHORING_KSB_MAPPINGS_TABLE = 'ksb_mappings'
AUTHORING_COMPLETION_TABLE = 'module_completion_criteria'
AUTHORING_ADVANCED_TABLE = 'module_details'
COHORT_AUTHORING_DETAILS_TABLE = 'cohorts'
GROUPS_TABLE = 'groups'
FREE_PROGRAMME_MODULES_TABLE = 'free_programme_modules'
FREE_PROGRAMME_COMPONENTS_TABLE = 'free_programme_components'
AUTHORING_MODULES_TABLE = 'modules'
AUTHORING_WEEKS_TABLE = 'weeks'
AUTHORING_COMPONENTS_TABLE = 'components'
AUTHORING_KSB_MAPPINGS_TABLE = 'ksb_mappings'
AUTHORING_COMPLETION_TABLE = 'module_completion_criteria'
AUTHORING_ADVANCED_TABLE = 'module_details'


def canonical_authoring_id(prefix, value=''):
    return unique_prefixed_id(prefix, value)


def unique_module_catalogue_id(value=''):
    requested = clean_str(value)
    try:
        existing = [row.get('module_catalogue_id') for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)]
    except Exception:
        existing = []
    if re.match(r'^MOD-[A-Z0-9][A-Z0-9_-]*$', requested, re.I) and requested not in existing:
        return requested
    if requested in existing:
        return requested
    return unique_prefixed_id('MOD', '', existing)


def first_clean_payload_value(payload, *keys):
    for key in keys:
        value = clean_str(payload.get(key))
        if value:
            return value
    return ''


def identity_values_overlap(left_values, right_values):
    left = {normalise(value) for value in left_values if normalise(value)}
    right = {normalise(value) for value in right_values if normalise(value)}
    if left and right:
        return bool(left & right)
    return True


def identity_values_match_context(left_values, context_values):
    left = {normalise(value) for value in left_values if normalise(value)}
    context = {normalise(value) for value in context_values if normalise(value)}
    if context and not left:
        return False
    if left and context:
        return bool(left & context)
    return True


def authoring_component_counts_by_catalogue():
    counts = Counter()
    try:
        for row in active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE)):
            catalogue_id = clean_str(row.get('module_catalogue_id'))
            if catalogue_id:
                counts[catalogue_id] += 1
    except Exception:
        logger.debug('Unable to count authoring components by module.', exc_info=True)
    return counts


def find_existing_authoring_catalogue_id_for_payload(payload):
    requested_catalogue_id = first_clean_payload_value(payload, 'catalogueId', 'moduleCatalogueId', 'module_catalogue_id')
    if requested_catalogue_id:
        resolved = resolve_authoring_catalogue_id(requested_catalogue_id)
        if resolved:
            return resolved

    try:
        ensure_module_authoring_tables()
        title = first_clean_payload_value(payload, 'title', 'name')
        if not title:
            return ''

        programme_values = [
            payload.get('programmeId'),
            payload.get('programme_id'),
            payload.get('programmeName'),
            payload.get('programme'),
        ]
        cohort_values = [
            payload.get('cohortId'),
            payload.get('cohort_id'),
            payload.get('cohortName'),
            payload.get('cohort'),
        ]
        group_values = [
            payload.get('groupId'),
            payload.get('group_id'),
            payload.get('groupName'),
            payload.get('group'),
        ]
        component_counts = authoring_component_counts_by_catalogue()
        rows = sorted(
            authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, module_catalogue_id'),
            key=lambda row: (component_counts.get(clean_str(row.get('module_catalogue_id')), 0), row.get('updated_at') or ''),
            reverse=True,
        )
        for row in rows:
            if normalise(row.get('title')) != normalise(title):
                continue
            if not identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values):
                continue
            if not identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values):
                continue
            if not identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values):
                continue
            return clean_str(row.get('module_catalogue_id'))
    except Exception:
        logger.debug('Unable to find existing authoring module for payload.', exc_info=True)
    return ''


def authoring_table_name(table):
    if connection.vendor == 'postgresql':
        return table_name(table)
    return quote_ident(table)


def authoring_json_type():
    return 'jsonb' if connection.vendor == 'postgresql' else 'text'


def ensure_module_authoring_tables():
    global _AUTHORING_TABLES_READY
    if _AUTHORING_TABLES_READY:
        return
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_MODULES_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                programme_id varchar(255),
                programme_name varchar(255),
                cohort_id varchar(255),
                cohort_name varchar(255),
                group_id varchar(255),
                group_name varchar(255),
                tutor_name varchar(255),
                coach_name varchar(255),
                title varchar(500) not null,
                description text,
                color varchar(32),
                sessions_number integer not null default 0,
                start_date date,
                end_date date,
                total_otjh numeric(8,2) not null default 0,
                quality_score integer not null default 0,
                ksb_profile_source_id varchar(128),
                session_week_day varchar(255),
                session_start_time varchar(32),
                session_end_time varchar(32),
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists sessions_number integer not null default 0')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists start_date date')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists end_date date')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists cohort_id varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists cohort_name varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists group_id varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists group_name varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists ksb_profile_source_id varchar(128)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_week_day varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_start_time varchar(32)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists session_end_time varchar(32)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists tutor_name varchar(255)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists coach_name varchar(255)')
        else:
            cursor.execute(f'pragma table_info({quote_ident(AUTHORING_MODULES_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            if 'sessions_number' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column sessions_number integer not null default 0')
            if 'start_date' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column start_date date')
            if 'end_date' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column end_date date')
            if 'cohort_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column cohort_id varchar(255)')
            if 'cohort_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column cohort_name varchar(255)')
            if 'group_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column group_id varchar(255)')
            if 'group_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column group_name varchar(255)')
            if 'ksb_profile_source_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column ksb_profile_source_id varchar(128)')
            if 'session_week_day' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_week_day varchar(255)')
            if 'session_start_time' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_start_time varchar(32)')
            if 'session_end_time' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column session_end_time varchar(32)')
            if 'tutor_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column tutor_name varchar(255)')
            if 'coach_name' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column coach_name varchar(255)')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_WEEKS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128) not null,
                week_number integer not null default 1,
                title varchar(500) not null default '',
                summary text,
                learning_outcomes {json_type},
                display_order integer not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                week_id varchar(128) not null,
                module_catalogue_id varchar(128) not null,
                type varchar(64) not null,
                title varchar(500) not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                display_order integer not null default 0,
                settings_json {json_type},
                live_sessions_link text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                add column if not exists reflection_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                add column if not exists workplace_evidence_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                add column if not exists tutor_validation_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                add column if not exists settings_json {json_type}
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                add column if not exists live_sessions_link text
            ''')
            cursor.execute(f'''
                update {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
                set live_sessions_link = coalesce(
                    nullif(settings_json->>'liveSessionUrl', ''),
                    nullif(settings_json->>'teamsMeetingUrl', '')
                )
                where (live_sessions_link is null or trim(live_sessions_link) = '')
                  and lower(replace(type, '_', '-')) = 'live-session'
                  and coalesce(
                    nullif(settings_json->>'liveSessionUrl', ''),
                    nullif(settings_json->>'teamsMeetingUrl', '')
                  ) is not null
            ''')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} alter column expected_otjh set default 2')
        else:
            cursor.execute(f'pragma table_info({quote_ident(AUTHORING_COMPONENTS_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            if 'reflection_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} add column reflection_required boolean not null default false')
            if 'workplace_evidence_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} add column workplace_evidence_required boolean not null default false')
            if 'tutor_validation_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} add column tutor_validation_required boolean not null default false')
            if 'settings_json' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} add column settings_json {json_type}')
            if 'live_sessions_link' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} add column live_sessions_link text')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128) not null,
                week_id varchar(128),
                component_id varchar(128),
                ksb_id varchar(255),
                ksb_code varchar(64) not null,
                ksb_description text,
                source_type varchar(32),
                source_id varchar(255),
                classification varchar(32) not null default 'secondary',
                weight numeric(5,2) not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                add column if not exists classification varchar(32) not null default 'secondary'
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                add column if not exists weight numeric(5,2) not null default 0
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                add column if not exists source_type varchar(32)
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                add column if not exists source_id varchar(255)
            ''')
            try:
                cursor.execute(f'''
                    create index if not exists curriculum_ksb_mapping_component_lookup_idx
                    on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                    (component_id, ksb_code, source_type, source_id)
                ''')
                cursor.execute(f'''
                    create index if not exists curriculum_ksb_mapping_module_idx
                    on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (module_catalogue_id)
                ''')
                cursor.execute(f'''
                    create index if not exists curriculum_ksb_mapping_week_idx
                    on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (week_id)
                ''')
                cursor.execute(f'''
                    create index if not exists curriculum_ksb_mapping_component_idx
                    on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (component_id)
                ''')
            except Exception:
                logger.warning('Could not create component KSB mapping lookup indexes.', exc_info=True)
            try:
                cursor.execute(f'''
                    select component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''), count(*)
                    from {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                    where component_id is not null and component_id <> ''
                    group by component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, '')
                    having count(*) > 1
                    limit 1
                ''')
                duplicate = cursor.fetchone()
                if duplicate:
                    logger.warning(
                        'Skipping curriculum component KSB unique index because legacy duplicate mappings exist for component %s / KSB %s / source %s:%s.',
                        duplicate[0], duplicate[1], duplicate[2], duplicate[3],
                    )
                else:
                    cursor.execute(f'''
                        create unique index if not exists curriculum_ksb_mapping_component_unique_idx
                        on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                        (component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''))
                        where component_id is not null and component_id <> ''
                    ''')
            except Exception:
                logger.warning('Could not create component KSB mapping unique index.', exc_info=True)
            _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{AUTHORING_KSB_MAPPINGS_TABLE}', None)
        else:
            cursor.execute(f'pragma table_info({quote_ident(AUTHORING_KSB_MAPPINGS_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            if 'classification' not in columns:
                cursor.execute(f"alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} add column classification varchar(32) not null default 'secondary'")
            if 'weight' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} add column weight numeric(5,2) not null default 0')
            if 'source_type' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} add column source_type varchar(32)')
            if 'source_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} add column source_id varchar(255)')
            try:
                cursor.execute(f'''
                    create index if not exists curriculum_ksb_mapping_component_lookup_idx
                    on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                    (component_id, ksb_code, source_type, source_id)
                ''')
                cursor.execute(f'create index if not exists curriculum_ksb_mapping_module_idx on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (module_catalogue_id)')
                cursor.execute(f'create index if not exists curriculum_ksb_mapping_week_idx on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (week_id)')
                cursor.execute(f'create index if not exists curriculum_ksb_mapping_component_idx on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (component_id)')
            except Exception:
                logger.warning('Could not create component KSB mapping lookup indexes.', exc_info=True)
            try:
                cursor.execute(f'''
                    select component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''), count(*)
                    from {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                    where component_id is not null and component_id <> ''
                    group by component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, '')
                    having count(*) > 1
                    limit 1
                ''')
                duplicate = cursor.fetchone()
                if duplicate:
                    logger.warning(
                        'Skipping curriculum component KSB unique index because legacy duplicate mappings exist for component %s / KSB %s / source %s:%s.',
                        duplicate[0], duplicate[1], duplicate[2], duplicate[3],
                    )
                else:
                    cursor.execute(f'''
                        create unique index if not exists curriculum_ksb_mapping_component_unique_idx
                        on {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)}
                        (component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''))
                        where component_id is not null and component_id <> ''
                    ''')
            except Exception:
                logger.warning('Could not create component KSB mapping unique index.', exc_info=True)
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_COMPLETION_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                quizzes_completed_required boolean not null default false,
                checkpoints_completed_required boolean not null default false,
                average_score_required_enabled boolean not null default false,
                average_score_required integer not null default 70,
                total_score_required_enabled boolean not null default false,
                total_score_required integer not null default 100,
                additional_notes text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_ADVANCED_TABLE)} (
                module_catalogue_id varchar(128) primary key,
                background text,
                epa_requirements {json_type},
                professional_qualification_outcomes {json_type},
                intent text,
                learner_benefit text,
                employer_benefit text,
                sequence_purpose text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)} (
                cohort_id varchar(128) primary key,
                cohort_name varchar(500) not null default '',
                programme_id varchar(255),
                programme_name varchar(255),
                start_date date,
                end_date date,
                duration_months integer not null default 0,
                color varchar(32),
                status varchar(32) not null default 'planned',
                training_plan_ids {json_type},
                group_ids {json_type},
                module_names {json_type},
                holiday_ids {json_type},
                selected_holidays {json_type},
                holidays_in_range {json_type},
                holiday_summary {json_type},
                notes text,
                source_type varchar(64) not null default 'training_plan',
                source_id varchar(128),
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(GROUPS_TABLE)} (
                group_id varchar(128) primary key,
                group_name varchar(500) not null default '',
                cohort_id varchar(128) not null default '',
                cohort_name varchar(500) not null default '',
                programme_id varchar(255) not null default '',
                programme_name varchar(255) not null default '',
                module_ids {json_type},
                module_names {json_type},
                coach_name varchar(255),
                tutor_name varchar(255),
                start_date date,
                end_date date,
                schedule varchar(255),
                color varchar(32),
                notes text,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(GROUPS_TABLE)} add column if not exists module_ids {json_type}')
            cursor.execute(f'alter table {authoring_table_name(GROUPS_TABLE)} add column if not exists module_names {json_type}')
            cursor.execute(f'alter table {authoring_table_name(GROUPS_TABLE)} add column if not exists color varchar(32)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id)')
            cursor.execute(f'create index if not exists curriculum_groups_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (cohort_id)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id, cohort_id)')
            cursor.execute(f'''
                update {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)}
                set programme_id = upper(substr(programme_id, length('program-') + 1)),
                    updated_at = current_timestamp
                where lower(programme_id) like 'program-prog-%'
            ''')
        else:
            cursor.execute(f'pragma table_info({quote_ident(GROUPS_TABLE)})')
            group_columns = {row[1] for row in cursor.fetchall()}
            if 'color' not in group_columns:
                cursor.execute(f'alter table {authoring_table_name(GROUPS_TABLE)} add column color varchar(32)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id)')
            cursor.execute(f'create index if not exists curriculum_groups_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (cohort_id)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_cohort_idx on {authoring_table_name(GROUPS_TABLE)} (programme_id, cohort_id)')
            cursor.execute(f'''
                update {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)}
                set programme_id = upper(substr(programme_id, length('program-') + 1)),
                    updated_at = current_timestamp
                where lower(programme_id) like 'program-prog-%'
            ''')
    for table in (AUTHORING_MODULES_TABLE, COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE):
        _TABLE_COLUMNS_CACHE.pop(f'{CURRICULUM_SCHEMA}.{table}', None)
    with connection.cursor() as cursor:
        cursor.execute(f'create index if not exists curriculum_modules_title_idx on {authoring_table_name(AUTHORING_MODULES_TABLE)} (title)')
        cursor.execute(f'create index if not exists curriculum_weeks_module_idx on {authoring_table_name(AUTHORING_WEEKS_TABLE)} (module_catalogue_id)')
        cursor.execute(f'create index if not exists curriculum_components_module_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (module_catalogue_id)')
        cursor.execute(f'create index if not exists curriculum_components_week_idx on {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} (week_id)')
    _AUTHORING_TABLES_READY = True


def ensure_free_programme_tables():
    global _FREE_PROGRAMME_TABLES_READY
    if _FREE_PROGRAMME_TABLES_READY:
        return
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(FREE_PROGRAMME_MODULES_TABLE)} (
                id varchar(128) primary key,
                programme_id varchar(255) not null,
                programme_name varchar(255),
                title varchar(500) not null,
                description text,
                status varchar(32) not null default 'draft',
                color varchar(32),
                display_order integer not null default 0,
                component_count integer not null default 0,
                total_otjh numeric(8,2) not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                free_module_id varchar(128) not null,
                programme_id varchar(255) not null,
                type varchar(64) not null,
                title varchar(500) not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                display_order integer not null default 0,
                settings_json {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists reflection_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists workplace_evidence_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists tutor_validation_required boolean not null default false
            ''')
            cursor.execute(f'''
                alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)}
                add column if not exists settings_json {json_type}
            ''')
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} alter column expected_otjh set default 2')
        else:
            cursor.execute(f'pragma table_info({quote_ident(FREE_PROGRAMME_COMPONENTS_TABLE)})')
            columns = {row[1] for row in cursor.fetchall()}
            if 'reflection_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column reflection_required boolean not null default false')
            if 'workplace_evidence_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column workplace_evidence_required boolean not null default false')
            if 'tutor_validation_required' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column tutor_validation_required boolean not null default false')
            if 'settings_json' not in columns:
                cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} add column settings_json {json_type}')
    _FREE_PROGRAMME_TABLES_READY = True


def authoring_fetch_all(table, where_sql='', params=None, order_sql=''):
    ensure_module_authoring_tables()
    query = f'select * from {authoring_table_name(table)}'
    if where_sql:
        query += f' where {where_sql}'
    if order_sql:
        query += f' order by {order_sql}'
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


def safe_authoring_module_rows():
    try:
        return authoring_fetch_all(AUTHORING_MODULES_TABLE)
    except (Exception, AssertionError):
        logger.debug('Unable to read authoring module rows for relationship sync.', exc_info=True)
        return []


def free_programme_fetch_all(table, where_sql='', params=None, order_sql=''):
    ensure_free_programme_tables()
    query = f'select * from {authoring_table_name(table)}'
    if where_sql:
        query += f' where {where_sql}'
    if order_sql:
        query += f' order by {order_sql}'
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


def authoring_delete(table, where_sql, params=None):
    ensure_module_authoring_tables()
    with connection.cursor() as cursor:
        cursor.execute(f'delete from {authoring_table_name(table)} where {where_sql}', params or [])


def free_programme_delete(table, where_sql, params=None):
    ensure_free_programme_tables()
    with connection.cursor() as cursor:
        cursor.execute(f'delete from {authoring_table_name(table)} where {where_sql}', params or [])


def authoring_upsert(table, key_columns, payload):
    ensure_module_authoring_tables()
    values = {key: value for key, value in payload.items() if value is not None}
    values['updated_at'] = datetime.utcnow()
    if 'created_at' not in values:
        values['created_at'] = datetime.utcnow()
    columns = list(values.keys())
    placeholders = ', '.join(['%s'] * len(columns))
    update_columns = [column for column in columns if column not in set(key_columns) | {'created_at'}]
    if connection.vendor == 'postgresql':
        conflict = ', '.join(quote_ident(column) for column in key_columns)
        assignments = ', '.join(f'{quote_ident(column)} = excluded.{quote_ident(column)}' for column in update_columns)
        query = (
            f'insert into {authoring_table_name(table)} ({", ".join(quote_ident(column) for column in columns)}) '
            f'values ({placeholders}) on conflict ({conflict}) do update set {assignments} returning *'
        )
    else:
        query = (
            f'insert or replace into {authoring_table_name(table)} ({", ".join(quote_ident(column) for column in columns)}) '
            f'values ({placeholders})'
        )
    with connection.cursor() as cursor:
        cursor.execute(query, [values[column] for column in columns])
        if connection.vendor == 'postgresql':
            return rows_as_dicts(cursor)[0]
    where = ' and '.join(f'{quote_ident(column)} = %s' for column in key_columns)
    return authoring_fetch_all(table, where, [values[column] for column in key_columns])[0]


def authoring_bulk_upsert(table, key_columns, payloads, batch_size=100):
    ensure_module_authoring_tables()
    payloads = [payload for payload in payloads if payload]
    if not payloads:
        return
    now = datetime.utcnow()
    all_columns = []
    seen_columns = set()
    for payload in payloads:
        for column in payload.keys():
            if column not in seen_columns:
                all_columns.append(column)
                seen_columns.add(column)
    if 'updated_at' not in seen_columns:
        all_columns.append('updated_at')
        seen_columns.add('updated_at')
    if 'created_at' not in seen_columns:
        all_columns.append('created_at')
        seen_columns.add('created_at')
    update_columns = [column for column in all_columns if column not in set(key_columns) | {'created_at'}]
    quoted_columns = ', '.join(quote_ident(column) for column in all_columns)
    if connection.vendor == 'postgresql':
        conflict = ', '.join(quote_ident(column) for column in key_columns)
        assignments = ', '.join(f'{quote_ident(column)} = excluded.{quote_ident(column)}' for column in update_columns)
        row_placeholder = f'({", ".join(["%s"] * len(all_columns))})'
        prefix = f'insert into {authoring_table_name(table)} ({quoted_columns}) values '
        suffix = f' on conflict ({conflict}) do update set {assignments}'
    else:
        row_placeholder = f'({", ".join(["%s"] * len(all_columns))})'
        prefix = f'insert or replace into {authoring_table_name(table)} ({quoted_columns}) values '
        suffix = ''
    with connection.cursor() as cursor:
        for start in range(0, len(payloads), batch_size):
            batch = payloads[start:start + batch_size]
            values = []
            for payload in batch:
                row = {key: value for key, value in payload.items()}
                row.setdefault('updated_at', now)
                row.setdefault('created_at', now)
                values.extend(row.get(column) for column in all_columns)
            placeholders = ', '.join([row_placeholder] * len(batch))
            cursor.execute(f'{prefix}{placeholders}{suffix}', values)


def free_programme_upsert(table, key_columns, payload):
    ensure_free_programme_tables()
    return authoring_upsert(table, key_columns, payload)


def as_json_value(value, fallback):
    parsed = parse_json_value(value, fallback)
    return parsed if parsed is not None else fallback


def json_db_value(value):
    return json.dumps(value if value is not None else [])


# ---------------------------------------------------------------------------
# Normalized curriculum source-of-truth helpers.
#
# The Curriculum feature reads and writes its cohorts and groups directly from
# the normalized ``curriculum.cohorts`` (COHORT_AUTHORING_DETAILS_TABLE) and
# ``curriculum.groups`` (GROUPS_TABLE) tables. These helpers look entities up by
# their stored canonical id and apply targeted field updates.
# ---------------------------------------------------------------------------

def fetch_cohort_row(cohort_id):
    """Return the raw normalized ``curriculum.cohorts`` row for a canonical id."""
    ident = clean_str(cohort_id)
    if not ident:
        return None
    rows = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [ident])
    return rows[0] if rows else None


def fetch_group_row(group_id):
    """Return the raw normalized ``curriculum.groups`` row for a canonical id."""
    ident = clean_str(group_id)
    if not ident:
        return None
    rows = authoring_fetch_all(GROUPS_TABLE, 'group_id = %s', [ident])
    return rows[0] if rows else None


def resolve_cohort_row(identifier):
    """Look up a cohort row by canonical id first, then fall back to name match.

    Name matching is used only for validation/lookup tolerance (e.g. legacy
    clients passing a name); the returned row always carries its stored
    canonical ``cohort_id``, which is what callers use for updates.
    """
    ident = clean_str(identifier)
    if not ident:
        return None
    row = fetch_cohort_row(ident)
    if row:
        return row
    for candidate in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE):
        if matches_curriculum_identifier(candidate.get('cohort_id'), ident):
            return candidate
    for candidate in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE):
        if normalise(candidate.get('cohort_name')) == normalise(ident):
            return candidate
    return None


def resolve_group_row(identifier):
    """Look up a group row by canonical id first, then fall back to name match."""
    ident = clean_str(identifier)
    if not ident:
        return None
    row = fetch_group_row(ident)
    if row:
        return row
    for candidate in authoring_fetch_all(GROUPS_TABLE):
        if matches_curriculum_identifier(candidate.get('group_id'), ident):
            return candidate
    for candidate in authoring_fetch_all(GROUPS_TABLE):
        if normalise(candidate.get('group_name')) == normalise(ident):
            return candidate
    return None


def update_cohort_fields(cohort_id, fields):
    """Apply a targeted field update to a single normalized cohort row.

    Only the provided columns are written; the canonical ``cohort_id`` and all
    unrelated columns (programme_id, group_ids, dates, status, …) are preserved.
    """
    ident = clean_str(cohort_id)
    if not ident:
        return None
    values = {key: value for key, value in fields.items() if value is not None}
    if not values:
        return fetch_cohort_row(ident)
    values['updated_at'] = datetime.utcnow()
    rows = update_authoring_rows(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [ident], values)
    return rows[0] if rows else fetch_cohort_row(ident)


def update_group_fields(group_id, fields):
    """Apply a targeted field update to a single normalized group row."""
    ident = clean_str(group_id)
    if not ident:
        return None
    values = {key: value for key, value in fields.items() if value is not None}
    if not values:
        return fetch_group_row(ident)
    values['updated_at'] = datetime.utcnow()
    rows = update_authoring_rows(GROUPS_TABLE, 'group_id = %s', [ident], values)
    return rows[0] if rows else fetch_group_row(ident)


def update_authoring_rows(table, where_sql, where_params, payload):
    """Update rows in a ``curriculum`` schema authoring table and return them."""
    ensure_module_authoring_tables()
    columns = [column for column in payload if column in column_names(table)]
    if not columns:
        return authoring_fetch_all(table, where_sql, where_params)
    assignments = ', '.join(f'{quote_ident(column)} = %s' for column in columns)
    params = [payload[column] for column in columns] + list(where_params)
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'update {authoring_table_name(table)} set {assignments} where {where_sql} returning *',
                params,
            )
            return rows_as_dicts(cursor)
        cursor.execute(
            f'update {authoring_table_name(table)} set {assignments} where {where_sql}',
            params,
        )
    return authoring_fetch_all(table, where_sql, where_params)


def json_array_remove(raw_value, target):
    """Remove ``target`` from a JSON-array column value, returning a JSON string."""
    values = as_json_value(raw_value, [])
    if not isinstance(values, list):
        values = []
    target = clean_str(target)
    return json_db_value([value for value in values if clean_str(value) != target])


def json_array_add(raw_value, target):
    """Append ``target`` to a JSON-array column value if absent."""
    values = as_json_value(raw_value, [])
    if not isinstance(values, list):
        values = []
    target = clean_str(target)
    if target and target not in {clean_str(value) for value in values}:
        values = [*values, target]
    return json_db_value(values)


def repair_curriculum_parent_links(programme_id=''):
    """Keep denormalized parent arrays and child links coherent.

    True foreign keys are risky for existing installations because legacy rows
    can pre-date the normalized tables. These guards repair relationships that
    are in scope for a save and clean obvious authoring orphans.
    """
    programme_id = clean_str(programme_id)
    try:
        cohorts = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE)
        groups = authoring_fetch_all(GROUPS_TABLE)
        modules = safe_authoring_module_rows()
        cohort_by_id = {clean_str(row.get('cohort_id')): row for row in cohorts if clean_str(row.get('cohort_id'))}
        group_by_id = {clean_str(row.get('group_id')): row for row in groups if clean_str(row.get('group_id'))}

        for group in groups:
            group_id = clean_str(group.get('group_id'))
            cohort_id = clean_str(group.get('cohort_id'))
            cohort = cohort_by_id.get(cohort_id)
            if not group_id:
                continue
            if not cohort:
                if not programme_id or clean_str(group.get('programme_id')) == programme_id:
                    update_group_fields(group_id, {
                        'cohort_id': '',
                        'cohort_name': '',
                        'programme_id': '',
                        'programme_name': '',
                    })
                continue
            updates = {}
            if clean_str(group.get('cohort_name')) != clean_str(cohort.get('cohort_name')):
                updates['cohort_name'] = clean_str(cohort.get('cohort_name'))
            if clean_str(group.get('programme_id')) != clean_str(cohort.get('programme_id')):
                updates['programme_id'] = clean_str(cohort.get('programme_id'))
            if clean_str(group.get('programme_name')) != clean_str(cohort.get('programme_name')):
                updates['programme_name'] = clean_str(cohort.get('programme_name'))
            if updates:
                update_group_fields(group_id, updates)

        groups = authoring_fetch_all(GROUPS_TABLE)
        group_by_id = {clean_str(row.get('group_id')): row for row in groups if clean_str(row.get('group_id'))}
        group_ids_by_cohort = defaultdict(list)
        module_ids_by_group = defaultdict(list)
        module_names_by_group = defaultdict(list)
        for group in groups:
            group_id = clean_str(group.get('group_id'))
            cohort_id = clean_str(group.get('cohort_id'))
            if group_id and cohort_id and (not programme_id or clean_str(group.get('programme_id')) == programme_id):
                group_ids_by_cohort[cohort_id].append(group_id)

        for module in modules:
            module_id = clean_str(module.get('module_catalogue_id'))
            group_id = clean_str(module.get('group_id'))
            if not module_id or not group_id:
                continue
            group = group_by_id.get(group_id)
            if not group:
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                    'cohort_id': '',
                    'cohort_name': '',
                    'group_id': '',
                    'group_name': '',
                })
                continue
            if programme_id and clean_str(group.get('programme_id')) != programme_id:
                continue
            updates = {}
            for column, group_column in (
                ('group_name', 'group_name'),
                ('cohort_id', 'cohort_id'),
                ('cohort_name', 'cohort_name'),
                ('programme_id', 'programme_id'),
                ('programme_name', 'programme_name'),
            ):
                if clean_str(module.get(column)) != clean_str(group.get(group_column)):
                    updates[column] = clean_str(group.get(group_column))
            if updates:
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], updates)
            module_ids_by_group[group_id].append(module_id)
            if clean_str(module.get('title')):
                module_names_by_group[group_id].append(clean_str(module.get('title')))

        for cohort in cohorts:
            cohort_id = clean_str(cohort.get('cohort_id'))
            if not cohort_id or (programme_id and clean_str(cohort.get('programme_id')) != programme_id):
                continue
            update_cohort_fields(cohort_id, {'group_ids': json_db_value(unique(group_ids_by_cohort.get(cohort_id, [])))})
        for group in groups:
            group_id = clean_str(group.get('group_id'))
            if not group_id or (programme_id and clean_str(group.get('programme_id')) != programme_id):
                continue
            update_group_fields(group_id, {
                'module_ids': json_db_value(unique(module_ids_by_group.get(group_id, []))),
                'module_names': json_db_value(unique(module_names_by_group.get(group_id, []))),
            })

        module_ids = {clean_str(row.get('module_catalogue_id')) for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)}
        week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE)
        week_ids = {clean_str(row.get('id')) for row in week_rows if clean_str(row.get('module_catalogue_id')) in module_ids}
        authoring_delete(AUTHORING_WEEKS_TABLE, "coalesce(module_catalogue_id, '') <> '' and module_catalogue_id not in (select module_catalogue_id from " + authoring_table_name(AUTHORING_MODULES_TABLE) + ")")
        authoring_delete(AUTHORING_COMPONENTS_TABLE, "coalesce(module_catalogue_id, '') <> '' and module_catalogue_id not in (select module_catalogue_id from " + authoring_table_name(AUTHORING_MODULES_TABLE) + ")")
        authoring_delete(AUTHORING_COMPONENTS_TABLE, "coalesce(week_id, '') <> '' and week_id not in (select id from " + authoring_table_name(AUTHORING_WEEKS_TABLE) + ")")
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, "coalesce(module_catalogue_id, '') <> '' and module_catalogue_id not in (select module_catalogue_id from " + authoring_table_name(AUTHORING_MODULES_TABLE) + ")")
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, "coalesce(week_id, '') <> '' and week_id not in (select id from " + authoring_table_name(AUTHORING_WEEKS_TABLE) + ")")
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, "coalesce(component_id, '') <> '' and component_id not in (select id from " + authoring_table_name(AUTHORING_COMPONENTS_TABLE) + ")")
        rebuild_staff_profile_assignments_from_authoring()
    except (Exception, AssertionError):
        logger.warning('Could not repair curriculum parent links.', exc_info=True)


def unassign_authoring_modules_from_group(group_id, keep_catalogue_ids=None):
    """Clear this group's omitted module links from ``curriculum.modules``.

    Module Builder content is preserved; only the delivery relationship columns
    are cleared for modules no longer present in the group's saved draft.
    """
    group_id = clean_str(group_id)
    keep = {clean_str(value) for value in (keep_catalogue_ids or []) if clean_str(value)}
    if not group_id:
        return []
    rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'group_id = %s', [group_id])
    removed = []
    for row in rows:
        module_id = clean_str(row.get('module_catalogue_id'))
        if module_id in keep:
            continue
        update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
            'cohort_id': None,
            'cohort_name': '',
            'group_id': None,
            'group_name': '',
        })
        removed.append(module_id)
    if removed:
        for tutor_row in get_tutor_rows():
            remove_staff_profile_assignments(
                'tutor',
                staff_profile_name(tutor_row),
                'assigned_module_ids',
                removed,
            )
    return removed


def normalise_component_type(value):
    return str(value or '').replace('-', '_')


RETIRED_COMPONENT_TYPES = {'workplace_evidence'}


def is_retired_component_type(value):
    return normalise_component_type(value) in RETIRED_COMPONENT_TYPES


def active_component_rows(rows):
    return [row for row in rows if not is_retired_component_type(row.get('type'))]


def active_components_payload(components):
    return [
        component
        for component in (components or [])
        if isinstance(component, dict) and not is_retired_component_type(component.get('type'))
    ]


def without_retired_components(weeks):
    clean_weeks = []
    for week in weeks if isinstance(weeks, list) else []:
        if not isinstance(week, dict):
            clean_weeks.append(week)
            continue
        clean_weeks.append({
            **week,
            'components': active_components_payload(week.get('components')),
        })
    return clean_weeks


def frontend_component_type(value):
    return str(value or '').replace('_', '-')


def display_component_type(value):
    raw = frontend_component_type(value)
    labels = {
        'live-session': 'Live Session',
        'recording-placeholder': 'Recording Placeholder',
        'video': 'Self-study',
        'podcast': 'Self-study',
        'reading': 'Self-study',
        'powerpoint': 'Self-study',
        'quiz': 'Quiz',
        'monthly-ksb-quiz': 'Quiz',
        'assignment': 'Assignment',
        'workshop': 'Workshop',
        'reflection': 'Self-study',
        'checkpoint': 'Quiz',
        'coaching-preparation': 'Self-study',
    }
    return labels.get(raw, clean_str(value).replace('-', ' ').replace('_', ' ').title() or 'Self-study')


def stored_component_type(value):
    label = clean_str(value).lower()
    mapping = {
        'live session': 'live_session',
        'recording placeholder': 'recording_placeholder',
        'video': 'video',
        'podcast': 'podcast',
        'reading': 'reading',
        'reading material': 'reading',
        'powerpoint': 'powerpoint',
        'power point': 'powerpoint',
        'self-study': 'reading',
        'self study': 'reading',
        'quiz': 'quiz',
        'checkpoint': 'checkpoint',
        'checkpoint quiz': 'checkpoint',
        'monthly ksb quiz': 'monthly_ksb_quiz',
        'assignment': 'assignment',
        'reflection': 'reflection',
        'coaching preparation': 'coaching_preparation',
        'workshop': 'workshop',
    }
    return mapping.get(label, normalise_component_type(value) or 'reading')


def normalise_ksb_classification(value):
    return coverage_normalise_classification(value)


def normalise_ksb_weight(value):
    return max(0, parse_float(value, 0))


CONTENT_AUTHORING_STATUSES = {'Draft', 'Ready for QA', 'Needs changes', 'Approved'}


BASE_COMPONENT_SETTINGS = {
    'completionRule': 'Mark complete',
    'evidenceRequired': '-',
    'reflectionPrompt': 'What did you learn? How will you apply this at work? Which KSBs did this develop?',
    'contentStatus': 'Draft',
    'version': '0.1',
}


COMPONENT_SETTINGS_SCHEMA = {
    'live-session': {
        **BASE_COMPONENT_SETTINGS,
        'sessionPurpose': '',
        'sessionDate': '',
        'sessionTime': '',
        'sessionDateTimeUtc': '',
        'durationMinutes': 60,
        'selectedGroupKeys': [],
        'selectedGroupNames': [],
        'liveSessionUrl': '',
        'teamsEventId': '',
        'teamsLiveSessionId': '',
        'teamsMeetingOptionsUrl': '',
        'teamsOrganizerEmail': '',
        'teamsAttendees': [],
        'teamsProvider': '',
        'teamsRepeat': 'none',
        'teamsRepeatOccurrences': 1,
        'teamsLobbyBypass': 'invited',
        'teamsRecording': 'record-transcribe',
        'teamsSpokenLanguage': 'en-GB',
        'teamsMeetingType': 'live-session',
        'teamsRequestResponses': True,
        'teamsAllowTimeProposals': True,
        'teamsHideAttendees': False,
        'preparationInstructions': '',
        'reflectionQuestions': '',
        'attendanceRequired': True,
        'recordingExpected': True,
    },
    'recording-placeholder': {
        **BASE_COMPONENT_SETTINGS,
        'recordingPurpose': '',
        'source': 'MIS allocation',
        'recordingUrl': '',
        'expectedAvailability': 'After live session',
        'captionsExpected': False,
    },
    'video': {
        **BASE_COMPONENT_SETTINGS,
        'sourceType': 'YouTube',
        'provider': 'YouTube',
        'videoUrl': '',
        'embedCode': '',
        'durationMinutes': 10,
        'requiredProgressPercentage': 0,
        'lessonPreview': False,
        'captionsAvailable': False,
        'shortDescription': '',
        'learningBrief': '',
        'lessonContent': '',
        'lessonMaterialLinks': '',
        'lessonMaterialsNotes': '',
        'postWatchTask': '',
        'markersAndQuestions': '',
        'qAndA': '',
    },
    'podcast': {
        **BASE_COMPONENT_SETTINGS,
        'podcastSource': 'External URL',
        'podcastUrl': '',
        'embedCode': '',
        'shortcode': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'durationMinutes': 20,
        'requiredProgressPercentage': 0,
        'listeningFocus': '',
        'podcastReflectionQuestion': '',
        'transcript': '',
    },
    'reading': {
        **BASE_COMPONENT_SETTINGS,
        'difficulty': 'Standard',
        'requirement': 'Required',
        'readingSource': 'Written in LMS',
        'resourceUrl': '',
        'shortDescription': '',
        'readingContent': '',
        'mainLearningOutcomes': '',
        'ksbEvidenceNotes': '',
        'focusSections': '',
        'learnerInstruction': '',
        'keyPointCount': '0',
        'keyPoints': '',
        'glossaryTerms': '',
        'estimatedReadingTime': 20,
        'otjhRationale': '',
        'audioEnabled': False,
        'audioUrl': '',
        'reflectionQuestionCount': '0 qs',
        'readingReflectionPrompts': '',
        'readingEvidenceRequired': '',
        'completionRuleCount': '3 rules',
        'completionConfirmationRequired': True,
        'linkedActivity': '',
        'coachingPrompt': '',
        'requiredReading': True,
    },
    'powerpoint': {
        **BASE_COMPONENT_SETTINGS,
        'fileName': '',
        'presentationUrl': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'slideRange': '',
        'speakerNotes': '',
        'downloadAllowed': True,
    },
    'quiz': {
        **BASE_COMPONENT_SETTINGS,
        'buildMode': 'linked',
        'linkedQuizId': '',
        'linkedActivity': '',
        'numberOfQuestions': 10,
        'passMarkPercentage': 70,
        'attemptsAllowed': 2,
        'affectsKsbProgression': True,
        'completionFeedback': '',
    },
    'monthly-ksb-quiz': {
        **BASE_COMPONENT_SETTINGS,
        'buildMode': 'linked',
        'linkedQuizId': '',
        'linkedActivity': '',
        'numberOfQuestions': 12,
        'passMarkPercentage': 70,
        'attemptsAllowed': 2,
        'affectsKsbProgression': True,
        'monthFocus': '',
    },
    'reflection': {
        **BASE_COMPONENT_SETTINGS,
        'minimumWordCount': 250,
        'learnerGuidance': '',
        'tutorReviewGuidance': '',
    },
    'assignment': {
        **BASE_COMPONENT_SETTINGS,
        'assignmentBrief': '',
        'submissionInstructions': '',
        'dueTiming': 'End of week',
        'markingRubric': '',
        'uploadedFileName': '',
        'uploadedFileUrl': '',
        'uploadedFileSize': 0,
        'uploadedFileContentType': '',
        'uploadSource': '',
        'assignmentFileName': '',
        'assignmentFileUrl': '',
    },
    'checkpoint': {
        **BASE_COMPONENT_SETTINGS,
        'checkpointTitle': '',
        'checkpointQuestions': '',
        'progressReviewLinked': True,
        'monthlyCoachingReviewLinked': True,
    },
    'coaching-preparation': {
        **BASE_COMPONENT_SETTINGS,
        'preparationPrompt': '',
        'evidenceToBring': '',
        'coachDiscussionPoints': '',
        'coachingReviewLinked': True,
    },
}


LEGACY_SETTING_KEYS = {'legacySettings', 'legacySourceType', 'legacyUnsupportedSource', 'shortcode'}


class ModuleAuthoringValidationError(ValueError):
    def __init__(self, errors):
        super().__init__('Module authoring payload is invalid.')
        self.errors = errors


def http_url(value):
    text = clean_str(value)
    if not text:
        return False
    parsed = urlparse(text)
    return parsed.scheme in {'http', 'https'} and bool(parsed.netloc)


def component_resource_url(value):
    text = clean_str(value)
    return text.startswith('/curriculum_api/curriculum/uploads/') or http_url(text)


def host_matches(value, allowed_hosts):
    if not http_url(value):
        return False
    host = (urlparse(clean_str(value)).hostname or '').lower()
    return any(host == allowed or host.endswith(f'.{allowed}') for allowed in allowed_hosts)


def component_settings_defaults(component_type):
    return COMPONENT_SETTINGS_SCHEMA.get(frontend_component_type(component_type), COMPONENT_SETTINGS_SCHEMA['reading'])


def normalise_component_settings_payload(component_type, settings):
    source = dict(settings) if isinstance(settings, dict) else {}
    stored_legacy = as_json_value(source.get('legacySettings'), {})
    if isinstance(stored_legacy, dict):
        source = {**stored_legacy, **source}
    component_type = frontend_component_type(component_type)
    if component_type == 'podcast':
        source['embedCode'] = source.get('embedCode') or source.get('podcastEmbedCode') or ''
        source['shortcode'] = source.get('shortcode') or source.get('podcastShortcode') or ''
        if source.get('podcastSource') == 'Audio File':
            source['podcastSource'] = 'Device upload'
        elif source.get('podcastSource') == 'External Link':
            source['podcastSource'] = 'External URL'
        if source.get('podcastSource') == 'Device upload' and not source.get('podcastUrl'):
            source['podcastUrl'] = source.get('uploadedFileUrl') or ''
    elif component_type == 'reading':
        if source.get('readingSource') == 'Text':
            source['readingSource'] = 'Written in LMS'
        elif source.get('readingSource') == 'File':
            source['readingSource'] = 'LMS resource'
        if source.get('readingSource') == 'LMS resource' and not source.get('resourceUrl'):
            source['resourceUrl'] = source.get('uploadedFileUrl') or ''
    elif component_type == 'assignment':
        source['assignmentBrief'] = source.get('assignmentBrief') or source.get('assignmentContent') or ''
        source['assignmentFileName'] = source.get('assignmentFileName') or source.get('uploadedFileName') or ''
        source['assignmentFileUrl'] = source.get('assignmentFileUrl') or source.get('uploadedFileUrl') or ''
    defaults = component_settings_defaults(component_type)
    allowed = set(defaults.keys()) | LEGACY_SETTING_KEYS
    normalised = dict(defaults)
    legacy = {}
    for key, value in source.items():
        if value is None:
            continue
        if key == 'legacySettings':
            continue
        if key in allowed:
            normalised[key] = value
        elif isinstance(value, (str, int, float, bool, list)):
            legacy[key] = value
    if legacy:
        normalised['legacySettings'] = json.dumps(legacy)
    if frontend_component_type(component_type) == 'video' and (source.get('sourceType') == 'Shortcode' or source.get('provider') == 'Shortcode'):
        normalised['legacySourceType'] = 'Shortcode'
        normalised['legacyUnsupportedSource'] = True
        normalised['sourceType'] = source.get('sourceType') or 'Shortcode'
        normalised['provider'] = source.get('provider') or 'Shortcode'
    return normalised


def validate_component_authoring_payload(component, path):
    errors = []
    component_type = frontend_component_type(component.get('type'))
    settings = normalise_component_settings_payload(component_type, component.get('settings'))
    component['settings'] = settings
    allowed = set(component_settings_defaults(component_type).keys()) | LEGACY_SETTING_KEYS
    title = clean_str(component.get('title'))
    status = clean_str(settings.get('contentStatus') or 'Draft')
    version = clean_str(settings.get('version') or '0.1')

    if not title:
        errors.append({'path': f'{path}.title', 'message': 'Component title is required.'})
    if component_expected_otjh(component) < 0:
        errors.append({'path': f'{path}.expectedOtjh', 'message': 'Expected OTJH cannot be negative.'})
    if parse_int(component.get('points'), 0) < 0:
        errors.append({'path': f'{path}.points', 'message': 'Points cannot be negative.'})
    if status not in CONTENT_AUTHORING_STATUSES:
        errors.append({'path': f'{path}.settings.contentStatus', 'message': 'Status must be Draft, Ready for QA, Needs changes, or Approved.'})
    if not re.match(r'^\d+(?:\.\d+){0,2}$', version):
        errors.append({'path': f'{path}.settings.version', 'message': 'Version must use numbers such as 0.1 or 1.2.0.'})
    if bool_payload(component.get('reflectionRequired')) and not clean_str(settings.get('reflectionPrompt')):
        errors.append({'path': f'{path}.settings.reflectionPrompt', 'message': 'Reflection prompt is required when reflection is enabled.'})
    for key in settings.keys():
        if key not in allowed:
            errors.append({'path': f'{path}.settings.{key}', 'message': f'Unsupported setting "{key}" for {component_type}.'})

    if component_type == 'video':
        source_type = clean_str(settings.get('sourceType') or settings.get('provider') or 'YouTube')
        if source_type == 'Upload file':
            source_type = 'HTML (MP4)'
        if source_type == 'External link':
            source_type = 'External Link'
        if source_type == 'Shortcode':
            if status != 'Draft':
                errors.append({'path': f'{path}.settings.sourceType', 'message': 'Legacy Shortcode sources are preserved but cannot be marked ready or approved in the new Module Builder.'})
            return errors
        video_url = clean_str(settings.get('videoUrl'))
        progress = parse_float(settings.get('requiredProgressPercentage'), 0)
        if progress < 0 or progress > 100:
            errors.append({'path': f'{path}.settings.requiredProgressPercentage', 'message': 'Required progress must be between 0 and 100.'})
        if video_url and source_type == 'YouTube' and not host_matches(video_url, {'youtube.com', 'youtu.be'}):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid YouTube URL.'})
        if video_url and source_type == 'Vimeo' and not host_matches(video_url, {'vimeo.com'}):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid Vimeo URL.'})
        if video_url and source_type in {'External Link', 'HTML (MP4)'} and not http_url(video_url):
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Enter a valid URL.'})
        if status != 'Draft' and source_type == 'Embed' and not clean_str(settings.get('embedCode')):
            errors.append({'path': f'{path}.settings.embedCode', 'message': 'Embed content is required before QA or approval.'})
        if status != 'Draft' and source_type != 'Embed' and not video_url:
            errors.append({'path': f'{path}.settings.videoUrl', 'message': 'Video URL is required before QA or approval.'})

    if component_type == 'recording-placeholder':
        recording_url = clean_str(settings.get('recordingUrl'))
        if recording_url and not http_url(recording_url):
            errors.append({'path': f'{path}.settings.recordingUrl', 'message': 'Enter a valid recording URL.'})
        if status != 'Draft' and not recording_url:
            errors.append({'path': f'{path}.settings.recordingUrl', 'message': 'Recording URL is required before QA or approval.'})

    if component_type == 'podcast':
        source_type = clean_str(settings.get('podcastSource') or 'External URL')
        podcast_url = clean_str(settings.get('podcastUrl'))
        embed_code = clean_str(settings.get('embedCode'))
        progress = parse_float(settings.get('requiredProgressPercentage'), 0)
        if progress < 0 or progress > 100:
            errors.append({'path': f'{path}.settings.requiredProgressPercentage', 'message': 'Required progress must be between 0 and 100.'})
        if source_type not in {'Embed', 'Shortcode'} and podcast_url and not component_resource_url(podcast_url):
            errors.append({'path': f'{path}.settings.podcastUrl', 'message': 'Enter a valid podcast URL.'})
        if status != 'Draft' and source_type == 'Embed' and not embed_code:
            errors.append({'path': f'{path}.settings.embedCode', 'message': 'Embed content is required before QA or approval.'})

    if component_type == 'reading':
        for field, message in [('resourceUrl', 'Enter a valid reading URL.'), ('audioUrl', 'Enter a valid audio URL.')]:
            value = clean_str(settings.get(field))
            if value and not http_url(value):
                errors.append({'path': f'{path}.settings.{field}', 'message': message})

    if component_type == 'powerpoint':
        value = clean_str(settings.get('presentationUrl'))
        if value and not component_resource_url(value):
            errors.append({'path': f'{path}.settings.presentationUrl', 'message': 'Enter a valid presentation URL.'})

    return errors


def validate_module_authoring_payload(payload):
    errors = []
    source_cache = {}
    if not clean_str(payload.get('title') or payload.get('name')):
        errors.append({'path': 'title', 'message': 'Module title is required.'})
    raw_weeks = payload.get('weekStructure')
    if raw_weeks is None:
        raw_weeks = payload.get('weeks')
    # An integer `weeks` is a session count, not a structure. Reject it instead of
    # coercing it to [], which would drop authored weeks without telling anyone.
    if raw_weeks not in (None, '') and not isinstance(raw_weeks, list):
        errors.append({'path': 'weekStructure', 'message': 'Week structure must be a list.'})
        return errors
    weeks = without_retired_components(raw_weeks or [])
    for week_index, week in enumerate(weeks):
        if not isinstance(week, dict):
            errors.append({'path': f'weekStructure.{week_index}', 'message': 'Week must be an object.'})
            continue
        if not clean_str(week.get('title')):
            errors.append({'path': f'weekStructure.{week_index}.title', 'message': f'Week {week_index + 1} needs a title.'})
        components = week.get('components') or []
        if not isinstance(components, list):
            errors.append({'path': f'weekStructure.{week_index}.components', 'message': 'Components must be a list.'})
            continue
        for component_index, component in enumerate(components):
            if not isinstance(component, dict):
                errors.append({'path': f'weekStructure.{week_index}.components.{component_index}', 'message': 'Component must be an object.'})
                continue
            errors.extend(validate_component_authoring_payload(component, f'weekStructure.{week_index}.components.{component_index}'))
            component_mappings = component.get('ksbMappings') or []
            errors.extend(validate_mapping_duplicates(component_mappings, f'weekStructure.{week_index}.components.{component_index}.ksbMappings'))
            for mapping_index, mapping in enumerate(component_mappings):
                if not isinstance(mapping, dict):
                    errors.append({'path': f'weekStructure.{week_index}.components.{component_index}.ksbMappings.{mapping_index}', 'message': 'KSB mapping must be an object.'})
                    continue
                errors.extend(validate_ksb_mapping_payload(mapping, f'weekStructure.{week_index}.components.{component_index}.ksbMappings.{mapping_index}', source_cache))
    return errors


def bool_payload(value):
    if isinstance(value, bool):
        return value
    return truthy(value)


def module_authoring_quality_check(module_payload):
    weeks = module_payload.get('weekStructure') or []
    components = [component for week in weeks for component in (week.get('components') or [])]
    live_sessions = [component for component in components if normalise_component_type(component.get('type')) == 'live_session']
    criteria = module_payload.get('completionCriteria') or {}
    all_mappings = []
    all_mappings.extend(module_payload.get('moduleKsbMappings') or [])
    for week in weeks:
        all_mappings.extend(week.get('ksbMappings') or [])
        for component in week.get('components') or []:
            all_mappings.extend(component.get('ksbMappings') or [])
    criteria_configured = any([
        criteria.get('quizzesCompletedRequired'),
        criteria.get('checkpointsCompletedRequired'),
        criteria.get('averageScoreRequiredEnabled'),
        criteria.get('totalScoreRequiredEnabled'),
        clean_str(criteria.get('additionalNotes')),
    ])
    checklist = [
        {'label': 'weeks defined', 'passed': len(weeks) > 0},
        {'label': 'each week has title', 'passed': all(clean_str(week.get('title')) for week in weeks)},
        {'label': 'each week has at least one component', 'passed': all(len(week.get('components') or []) > 0 for week in weeks)},
        {'label': 'components have OTJH greater than 0', 'passed': bool(components) and all(float(component.get('expectedOtjh') or 0) > 0 for component in components)},
        {'label': 'components have KSB mapping', 'passed': bool(components) and all(len(component.get('ksbMappings') or []) > 0 for component in components)},
        {'label': 'live sessions have recording placeholder where expected', 'passed': all('recordingExpected' in (component.get('settings') or {}) for component in live_sessions)},
        {'label': 'completion criteria configured', 'passed': criteria_configured},
        {'label': 'KSB mappings classified correctly', 'passed': all(normalise_ksb_classification(mapping.get('type') or mapping.get('classification')) in SUPPORTED_CLASSIFICATIONS for mapping in all_mappings)},
        {'label': 'KSB mappings have weights', 'passed': all(normalise_ksb_weight(mapping.get('weight')) > 0 for mapping in all_mappings)},
    ]
    passed = len([item for item in checklist if item['passed']])
    score = round((passed / len(checklist)) * 100) if checklist else 0
    return checklist, score


def default_completion_payload():
    return {
        'quizzesCompletedRequired': False,
        'checkpointsCompletedRequired': False,
        'averageScoreRequiredEnabled': False,
        'averageScoreRequired': 70,
        'totalScoreRequiredEnabled': False,
        'totalScoreRequired': 100,
        'additionalNotes': '',
    }


def completion_response(row):
    if not row:
        return default_completion_payload()
    return {
        'quizzesCompletedRequired': bool(row.get('quizzes_completed_required')),
        'checkpointsCompletedRequired': bool(row.get('checkpoints_completed_required')),
        'averageScoreRequiredEnabled': bool(row.get('average_score_required_enabled')),
        'averageScoreRequired': parse_int(row.get('average_score_required'), 70),
        'totalScoreRequiredEnabled': bool(row.get('total_score_required_enabled')),
        'totalScoreRequired': parse_int(row.get('total_score_required'), 100),
        'additionalNotes': row.get('additional_notes') or '',
    }


def advanced_response(row):
    if not row:
        return {
            'background': '',
            'epaRequirements': [],
            'qualificationOutcomes': [],
            'advancedDetails': {
                'intent': '',
                'learnerBenefit': '',
                'employerBenefit': '',
                'sequencePurpose': '',
            },
        }
    return {
        'background': row.get('background') or '',
        'epaRequirements': as_json_value(row.get('epa_requirements'), []),
        'qualificationOutcomes': as_json_value(row.get('professional_qualification_outcomes'), []),
        'advancedDetails': {
            'intent': row.get('intent') or '',
            'learnerBenefit': row.get('learner_benefit') or '',
            'employerBenefit': row.get('employer_benefit') or '',
            'sequencePurpose': row.get('sequence_purpose') or '',
        },
    }


def mapping_response(row):
    return {
        'id': str(row.get('id')),
        'ksbId': str(row.get('ksb_id') or row.get('ksb_code') or ''),
        'code': row.get('ksb_code') or '',
        'description': row.get('ksb_description') or '',
        'sourceType': row.get('source_type') or '',
        'sourceId': row.get('source_id') or '',
        'type': normalise_ksb_classification(row.get('classification')),
        'classification': normalise_ksb_classification(row.get('classification')),
        'weight': normalise_ksb_weight(row.get('weight')),
    }


def authoring_module_exists(module_catalogue_id):
    rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    return rows[0] if rows else None


def training_module_identifier(training_id):
    return f'training-module-{clean_str(training_id)}'


def training_rows_by_id():
    return cached_curriculum_value(
        'training_rows_by_id',
        lambda: {clean_str(row.get('id')): row for row in get_training_rows() if clean_str(row.get('id'))},
    )


def training_row_by_id(training_id):
    ident = clean_str(training_id).replace('training-module-', '', 1)
    for row in authoring_modules_as_training_rows():
        candidates = {
            clean_str(row.get('id')),
            clean_str(row.get(TRAINING_MODULE_CATALOGUE_COLUMN)),
            clean_str(row.get('_meta', {}).get(TRAINING_MODULE_CATALOGUE_COLUMN)),
        }
        if ident in candidates or clean_str(training_id) in candidates:
            return row
    return None


def catalogue_for_training_row(row):
    catalogue_id = training_row_module_catalogue_id(row)
    module_name = normalise(row.get('module_name'))
    for module in get_module_rows():
        if catalogue_id and clean_str(module.get('Module ID')) == catalogue_id:
            return module
        if module_name and normalise(module.get('Module_name')) == module_name:
            return module
    return None


def authoring_row_for_training_source(training_id):
    return None


def attach_training_source_metadata(module_row, training_id):
    return


def authoring_row_for_training_legacy_ids(row):
    training_id = clean_str(row.get('id'))
    candidate_ids = [
        training_module_identifier(training_id),
        training_id,
        training_row_module_catalogue_id(row),
    ]
    for candidate_id in [item for item in candidate_ids if item]:
        existing = authoring_module_exists(candidate_id)
        if existing:
            if candidate_id in {training_module_identifier(training_id), training_id}:
                attach_training_source_metadata(existing, training_id)
                return authoring_row_for_training_source(training_id) or existing
            return existing
    return None


def ksb_mappings_from_codes(codes, scope):
    return [
        {
            'id': canonical_authoring_id('KSBMAP'),
            'ksbId': code,
            'code': code,
            'description': f'Mapped KSB {code}',
            'type': 'main' if index < 3 else 'secondary',
            'weight': 40 if index < 3 else 20,
        }
        for index, code in enumerate(sorted(codes))
    ]


def imported_training_module_payload(row):
    training_id = clean_str(row.get('id'))
    meta = row.get('_meta') or extract_notes_meta(row.get('notes'))
    catalogue = catalogue_for_training_row(row)
    session_count = max(parse_int(row.get('sessions_number'), parse_int((catalogue or {}).get('Number of sessions'), 1)), 1)
    session_names = get_module_session_names(catalogue or {})
    ksb_codes = codes_from_session_ksb(row.get('session_ksb_json')) or codes_from_session_ksb((catalogue or {}).get('session_ksb_json'))
    module_mappings = ksb_mappings_from_codes(ksb_codes, training_module_identifier(training_id))
    week_structure = []
    module_catalogue_id = unique_module_catalogue_id(training_row_module_catalogue_id(row))
    for index in range(session_count):
        week_id = canonical_authoring_id('WEEK')
        title = session_names[index] if index < len(session_names) else f'Week {index + 1}'
        component_mappings = module_mappings[:2]
        week_structure.append({
            'id': week_id,
            'moduleId': module_catalogue_id,
            'weekNumber': index + 1,
            'title': title or f'Week {index + 1}',
            'summary': '',
            'learningOutcomes': [],
            'ksbMappings': [],
            'components': [
                {
                    'id': canonical_authoring_id('COMP'),
                    'weekId': week_id,
                    'type': 'live-session',
                    'title': title or f'{row.get("module_name") or "Session"} #{index + 1}',
                    'description': 'Placeholder lesson derived from the existing delivery module.',
                    'expectedOtjh': 2,
                    'points': 10,
                    'reflectionRequired': False,
                    'workplaceEvidenceRequired': False,
                    'tutorValidationRequired': False,
                    'ksbMappings': component_mappings,
                    'settings': {'recordingExpected': True},
                }
            ],
        })

    try:
        programme_name = canonical_programme_name(row, program_config_by_id(get_program_config_rows()))
    except Exception:
        programme_name = row.get('Program') or 'Unassigned programme'
    cohort_identity = actual_cohort_identity(row, programme_name)
    group_identity = actual_group_identity(row, cohort_identity['id']) if cohort_identity else None

    return {
        'catalogueId': module_catalogue_id,
        'programmeId': row.get('Program') or programme_name,
        'programmeName': programme_name,
        'cohortId': (cohort_identity or {}).get('id') or '',
        'cohortName': (cohort_identity or {}).get('name') or '',
        'groupId': (group_identity or {}).get('id') or '',
        'groupName': (group_identity or {}).get('name') or '',
        'title': row.get('module_name') or (catalogue or {}).get('Module_name') or f'Module {training_id}',
        'description': visible_notes(row.get('notes') or (catalogue or {}).get('Notes') or ''),
        'status': 'published',
        'sessionsNumber': session_count,
        'startDate': row.get('start_date') or '',
        'endDate': row.get('end_date') or '',
        'declaredTotalOtjh': 0,
        'moduleKsbMappings': module_mappings,
        'completionCriteria': default_completion_payload(),
        'advancedDetails': {},
        'background': '',
        'epaRequirements': [],
        'qualificationOutcomes': [],
        'weekStructure': week_structure,
        'deliveryStatus': delivery_status_for_training_row(row),
        'deliveryMetadata': {
            'cohortId': (cohort_identity or {}).get('id') or '',
            'cohort': (cohort_identity or {}).get('name') or row.get('Cohort_name') or '',
            'groupId': (group_identity or {}).get('id') or '',
            'group': (group_identity or {}).get('name') or row.get('group_name') or meta.get('group_name') or '',
            'tutor': row.get('Tutor_name') or '',
            'coach': row.get('coach_name') or '',
        },
    }


def ensure_canonical_module_for_training_row(row, overrides=None):
    """Resolve or create the canonical authoring module for a delivery row."""
    overrides = overrides or {}
    module_name = clean_str(overrides.get('title') or overrides.get('moduleName') or row.get('module_name'))
    if not module_name:
        return ''
    invalid_explicit_id = training_row_invalid_explicit_module_catalogue_id(row)
    if invalid_explicit_id:
        raise ValueError(f'training_plan {row.get("id")} has invalid explicit module_catalogue_id {invalid_explicit_id}.')
    existing_catalogue_id = training_row_module_catalogue_id(row)
    if existing_catalogue_id:
        if authoring_module_exists(existing_catalogue_id):
            return existing_catalogue_id
        raise ValueError(f'training_plan {row.get("id")} references missing canonical module {existing_catalogue_id}.')

    base_payload = imported_training_module_payload({**row, 'module_name': module_name})
    payload = {
        **base_payload,
        **overrides,
        'title': module_name,
    }
    existing = find_existing_authoring_catalogue_id_for_payload(payload)
    if existing:
        link_training_row_to_catalogue(row.get('id'), existing)
        return existing

    saved = save_module_authoring_structure(payload.get('catalogueId') or '', payload)
    catalogue_id = clean_str(saved.get('catalogueId') or payload.get('catalogueId'))
    if catalogue_id:
        link_training_row_to_catalogue(row.get('id'), catalogue_id)
    return catalogue_id


def resolve_authoring_catalogue_id(identifier):
    ident = clean_str(identifier)
    if not ident:
        return ''
    summaries = authoring_catalogue_summaries()
    if not summaries:
        return ''

    candidates = []

    def add_candidate(summary):
        if summary and summary not in candidates:
            candidates.append(summary)

    for summary in summaries.values():
        summary_identifiers = {
            clean_str(summary.get('catalogueId')),
            clean_str(summary.get('sourceId')),
        }
        if summary.get('sourceId'):
            summary_identifiers.add(training_module_identifier(summary.get('sourceId')))
        if ident in summary_identifiers:
            add_candidate(summary)

    if ident.startswith('training-module-'):
        training_id = ident.replace('training-module-', '', 1)
        row = training_row_by_id(training_id)
        if row:
            meta = row.get('_meta') or extract_notes_meta(row.get('notes'))
            legacy_ids = {
                training_id,
                training_module_identifier(training_id),
                training_row_module_catalogue_id(row),
            }
            try:
                programme_name = canonical_programme_name(row, program_config_by_id(get_program_config_rows()))
            except Exception:
                programme_name = row.get('Program') or 'Unassigned programme'
            cohort_identity = actual_cohort_identity(row, programme_name)
            group_identity = actual_group_identity(row, cohort_identity['id']) if cohort_identity else None
            delivery_signature = '|'.join([
                normalise(programme_name),
                normalise(row.get('module_name')),
                normalise((cohort_identity or {}).get('id') or (cohort_identity or {}).get('name')),
                normalise((group_identity or {}).get('id') or (group_identity or {}).get('name')),
            ])
            for summary in summaries.values():
                summary_identifiers = {
                    clean_str(summary.get('catalogueId')),
                    clean_str(summary.get('sourceId')),
                }
                if summary_identifiers.intersection(legacy_ids):
                    add_candidate(summary)
                    continue
                if delivery_signature and authoring_summary_delivery_signature(summary) == delivery_signature:
                    add_candidate(summary)

    best = best_authoring_summary(candidates)
    return clean_str(best.get('catalogueId')) if best else ''


def ensure_training_module_authoring_structure(module_identifier):
    if not clean_str(module_identifier).startswith('training-module-'):
        return None
    training_id = clean_str(module_identifier).replace('training-module-', '', 1)
    row = training_row_by_id(training_id)
    if not row:
        return None

    source_row = authoring_row_for_training_source(training_id)
    if source_row:
        return get_authoring_structure_payload(source_row.get('module_catalogue_id'))

    existing_catalogue_id = resolve_authoring_catalogue_id(module_identifier)
    if existing_catalogue_id:
        return get_authoring_structure_payload(existing_catalogue_id)

    payload = imported_training_module_payload(row)
    return save_module_authoring_structure(payload['catalogueId'], payload)


def component_builder_settings(row):
    settings = as_json_value(row.get('settings_json'), {})
    settings = settings if isinstance(settings, dict) else {}
    stored_live_link = clean_str(row.get('live_sessions_link'))
    if stored_live_link and not clean_str(settings.get('liveSessionUrl')):
        settings = {**settings, 'liveSessionUrl': stored_live_link}
    return settings


def component_week_label(row):
    week_number = parse_int(row.get('week_number'), 0)
    return f'Week {week_number}' if week_number else (row.get('title') or 'Week 1')


def parse_week_number(value):
    match = re.search(r'\d+', str(value or ''))
    return max(1, parse_int(match.group(0), 1)) if match else 1


def component_context_for_payload(payload):
    ensure_module_authoring_tables()
    module_catalogue_id = clean_str(payload.get('moduleCatalogueId') or payload.get('module_catalogue_id'))
    module_title = clean_str(payload.get('module') or payload.get('moduleTitle') or payload.get('title'))
    programme_name = clean_str(payload.get('programme') or payload.get('programmeName')) or 'Unassigned programme'
    if module_catalogue_id:
        module_row = authoring_module_exists(module_catalogue_id)
    else:
        candidates = authoring_fetch_all(AUTHORING_MODULES_TABLE)
        module_row = next(
            (
                row for row in candidates
                if normalise(row.get('title')) == normalise(module_title)
                and normalise(row.get('programme_name')) == normalise(programme_name)
            ),
            None,
        )
        module_catalogue_id = clean_str((module_row or {}).get('module_catalogue_id'))

    if not module_catalogue_id:
        module_catalogue_id = unique_module_catalogue_id()

    if not module_row:
        authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'programme_id': programme_name,
            'programme_name': programme_name,
            'title': module_title or f'Module {module_catalogue_id}',
            'description': '',
            'status': 'draft',
            'sessions_number': 0,
            'total_otjh': 0,
            'quality_score': 0,
            'source_type': 'component_builder',
        })

    week_number = parse_week_number(payload.get('week') or payload.get('weekLabel') or payload.get('weekNumber'))
    week_rows = authoring_fetch_all(
        AUTHORING_WEEKS_TABLE,
        'module_catalogue_id = %s and week_number = %s',
        [module_catalogue_id, week_number],
    )
    week_id = clean_str(payload.get('weekId') or payload.get('week_id') or (week_rows[0].get('id') if week_rows else ''))
    if not week_id:
        week_id = canonical_authoring_id('WEEK')

    if not week_rows:
        authoring_upsert(AUTHORING_WEEKS_TABLE, ['id'], {
            'id': week_id,
            'module_catalogue_id': module_catalogue_id,
            'week_number': week_number,
            'title': f'Week {week_number}',
            'summary': '',
            'learning_outcomes': json_db_value([]),
            'display_order': week_number - 1,
        })

    return module_catalogue_id, week_id, week_number


def component_builder_response(row, module_by_id=None, week_by_id=None, mappings_by_component=None):
    module_by_id = module_by_id or {}
    week_by_id = week_by_id or {}
    mappings_by_component = mappings_by_component or {}
    component_id = str(row.get('id'))
    module = module_by_id.get(str(row.get('module_catalogue_id')), {})
    week = week_by_id.get(str(row.get('week_id')), {})
    settings = component_builder_settings(row)
    duration = parse_int(settings.get('durationMinutes'), 0) or round(float(row.get('expected_otjh') or 0) * 60)
    expected_otjh = float(row.get('expected_otjh') or 0)
    mapping_rows = mappings_by_component.get(component_id, [])
    ksb_refs = [
        mapping.get('ksb_code') or mapping.get('code')
        for mapping in mapping_rows
        if mapping.get('ksb_code') or mapping.get('code')
    ]
    ksb_mappings = [
        {
            'id': str(mapping.get('id') or ''),
            'ksbId': str(mapping.get('ksb_id') or mapping.get('ksbId') or mapping.get('ksb_code') or mapping.get('code') or ''),
            'code': str(mapping.get('ksb_code') or mapping.get('code') or ''),
            'description': mapping.get('description') or '',
            'type': mapping.get('mapping_type') or mapping.get('type') or 'secondary',
        }
        for mapping in mapping_rows
        if mapping.get('ksb_code') or mapping.get('code')
    ]
    ksb_mappings = [
        {
            'id': str(mapping.get('id') or ''),
            'ksbId': str(mapping.get('ksb_id') or mapping.get('ksb_code') or mapping.get('code') or ''),
            'code': str(mapping.get('ksb_code') or mapping.get('code') or ''),
            'description': mapping.get('ksb_description') or mapping.get('description') or '',
            'sourceType': mapping.get('source_type') or mapping.get('sourceType') or '',
            'sourceId': mapping.get('source_id') or mapping.get('sourceId') or '',
            'type': normalise_ksb_classification(mapping.get('classification') or mapping.get('mapping_type') or mapping.get('type') or 'secondary'),
            'classification': normalise_ksb_classification(mapping.get('classification') or mapping.get('mapping_type') or mapping.get('type') or 'secondary'),
            'weight': parse_float(mapping.get('weight'), 0),
        }
        for mapping in mappings_by_component.get(component_id, [])
        if mapping.get('ksb_code') or mapping.get('code')
    ]
    return {
        'id': component_id,
        'moduleCatalogueId': str(row.get('module_catalogue_id') or ''),
        'moduleId': str(row.get('module_catalogue_id') or ''),
        'weekId': str(row.get('week_id') or ''),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'type': settings.get('displayType') or display_component_type(row.get('type')),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'module': module.get('title') or '',
        'programme': module.get('programme_name') or 'Unassigned programme',
        'week': component_week_label(week),
        'weekTitle': week.get('title') or component_week_label(week),
        'duration': duration,
        'expectedOtjh': expected_otjh,
        'reflectionRequired': bool(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'expectedOtjh': float(row.get('expected_otjh') or 0),
        'points': parse_int(row.get('points'), 0),
        'reflectionRequired': bool_payload(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool_payload(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool_payload(row.get('tutor_validation_required')),
        'ksbRefs': ksb_refs,
        'ksbMappings': ksb_mappings,
        'ksbMappings': ksb_mappings,
        'status': settings.get('componentBuilderStatus') or 'draft',
        'lastEdited': format_date(row.get('updated_at')),
        'contentSections': parse_int(settings.get('contentSections'), 0),
        'quizQuestions': parse_int(settings.get('quizQuestions'), 0) or None,
        'hasResources': bool_payload(settings.get('hasResources')),
        'settings': settings,
        'settings': settings,
    }


def component_builder_rows(module_catalogue_ids=None):
    ensure_module_authoring_tables()
    catalogue_ids = [clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)]
    where_sql = ''
    params = []
    if catalogue_ids:
        where_sql = f'module_catalogue_id in ({", ".join(["%s"] * len(catalogue_ids))})'
        params = catalogue_ids
    component_rows = active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, where_sql, params, 'updated_at desc, display_order, id'))
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, where_sql, params) if catalogue_ids else authoring_fetch_all(AUTHORING_MODULES_TABLE)
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, where_sql, params) if catalogue_ids else authoring_fetch_all(AUTHORING_WEEKS_TABLE)
    mapping_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, where_sql, params) if catalogue_ids else authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE)
    mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    module_by_id = {str(row.get('module_catalogue_id')): row for row in module_rows}
    week_by_id = {str(row.get('id')): row for row in week_rows}
    mappings_by_component = defaultdict(list)
    for row in mapping_rows:
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(row)
    return [
        component_builder_response(row, module_by_id, week_by_id, mappings_by_component)
        for row in component_rows
    ]


def save_component_builder_payload(payload, component_id=None):
    if is_retired_component_type(payload.get('type')):
        raise ModuleAuthoringValidationError([{
            'path': 'type',
            'message': 'This component type has been removed from the module builder.',
        }])
    component_id = canonical_authoring_id('COMP', component_id or payload.get('id'))
    module_catalogue_id, week_id, week_number = component_context_for_payload(payload)
    duration_minutes = max(0, parse_int(payload.get('duration'), 0))
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    existing_row = component_rows[0] if component_rows else {}
    existing_expected_otjh = parse_float(existing_row.get('expected_otjh'), 2)
    expected_otjh = (
        parse_float(payload.get('expectedOtjh') or payload.get('expected_otjh'), existing_expected_otjh)
        if payload.get('expectedOtjh') not in (None, '') or payload.get('expected_otjh') not in (None, '')
        else existing_expected_otjh
    )
    payload_settings = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
    existing_settings = {}
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if component_rows:
        existing_settings = component_builder_settings(component_rows[0])
    incoming_settings = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
    settings = {
        **component_builder_settings(existing_row),
        **payload_settings,
        **existing_settings,
        **incoming_settings,
        'displayType': payload.get('type') or 'Self-study',
        'componentBuilderStatus': clean_str(payload.get('status') or 'draft').lower(),
        'durationMinutes': duration_minutes,
        'contentSections': max(0, parse_int(payload.get('contentSections'), 0)),
        'quizQuestions': max(0, parse_int(payload.get('quizQuestions'), 0)) if payload.get('quizQuestions') not in (None, '') else 0,
        'hasResources': bool_payload(payload.get('hasResources')),
    }
    reflection_required = (
        bool_payload(payload.get('reflectionRequired')) if 'reflectionRequired' in payload
        else bool_payload(payload.get('reflection_required')) if 'reflection_required' in payload
        else bool_payload(existing_row.get('reflection_required'))
    )
    workplace_evidence_required = False
    tutor_validation_required = (
        bool_payload(payload.get('tutorValidationRequired')) if 'tutorValidationRequired' in payload
        else bool_payload(payload.get('tutor_validation_required')) if 'tutor_validation_required' in payload
        else bool_payload(existing_row.get('tutor_validation_required'))
    )
    display_order = parse_int(existing_row.get('display_order'), 0)
    display_order = parse_int((component_rows[0] if component_rows else {}).get('display_order'), 0)
    if not component_rows:
        sibling_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
        display_order = len(sibling_rows)

    with transaction.atomic():
        authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': component_id,
            'week_id': week_id,
            'module_catalogue_id': module_catalogue_id,
            'type': stored_component_type(payload.get('type')),
            'title': payload.get('title') or '',
            'description': payload.get('description') or '',
            'expected_otjh': expected_otjh,
            'points': parse_int(payload.get('points'), 0),
            'reflection_required': reflection_required,
            'workplace_evidence_required': workplace_evidence_required,
            'tutor_validation_required': tutor_validation_required,
            'display_order': display_order,
            'settings_json': json_db_value(settings),
            'live_sessions_link': clean_str(settings.get('liveSessionUrl') or settings.get('teamsMeetingUrl')),
        })
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id])
        mapping_payloads = payload.get('ksbMappings') if isinstance(payload.get('ksbMappings'), list) else []
        if not mapping_payloads:
            mapping_payloads = [
                {
                    'ksbId': clean_str(code).upper(),
                    'code': clean_str(code).upper(),
                    'description': f'Mapped KSB {clean_str(code).upper()}',
                    'type': 'secondary',
                }
                for code in (payload.get('ksbRefs') or [])
            ]
        for mapping in mapping_payloads:
            clean_code = clean_str(mapping.get('code') or mapping.get('ksbId')).upper()
            if clean_code:
                save_authoring_mapping(module_catalogue_id, {
                    'id': canonical_authoring_id('KSBMAP'),
                    'ksbId': mapping.get('ksbId') or clean_code,
                    'code': clean_code,
                    'description': f'Mapped KSB {clean_code}',
                    'type': 'secondary',
                    'weight': 20,
                    'description': mapping.get('description') or f'Mapped KSB {clean_code}',
                    'type': mapping.get('type') or 'secondary',
                }, week_id=week_id, component_id=component_id)

    invalidate_curriculum_cache()
    row = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])[0]
    module = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    week = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'id = %s', [week_id])
    mappings = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id])
    return component_builder_response(
        row,
        {module_catalogue_id: module[0] if module else {}},
        {week_id: week[0] if week else {'week_number': week_number}},
        {component_id: mappings},
    )


def teams_delivery_metadata_from_weeks(weeks):
    for week in weeks or []:
        for component in week.get('components') or []:
            if clean_str(component.get('type')).lower().replace('_', '-') != 'live-session':
                continue
            settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
            live_session_id = clean_str(settings.get('teamsLiveSessionId'))
            event_id = clean_str(settings.get('teamsEventId'))
            join_url = clean_str(settings.get('teamsMeetingUrl') or settings.get('liveSessionUrl'))
            if not (live_session_id or event_id or join_url):
                continue
            return {
                'teamsMeetingUrl': join_url,
                'liveSessionUrl': join_url,
                'teamsLiveSessionId': live_session_id,
                'teamsOnlineMeetingId': clean_str(settings.get('teamsOnlineMeetingId')),
                'teamsEventId': event_id,
                'teamsWebLink': clean_str(settings.get('teamsWebLink')),
                'teamsMeetingOptionsUrl': clean_str(settings.get('teamsMeetingOptionsUrl')),
                'teamsOrganizerEmail': clean_str(settings.get('teamsOrganizerEmail')),
                'teamsAttendees': settings.get('teamsAttendees') or [],
                'teamsPresenters': settings.get('teamsPresenters') or [],
                'teamsStartDateTimeUtc': clean_str(settings.get('teamsStartDateTimeUtc') or settings.get('sessionDateTimeUtc')),
                'teamsDurationMinutes': clean_str(settings.get('teamsDurationMinutes') or settings.get('durationMinutes')),
                'teamsRepeat': clean_str(settings.get('teamsRepeat')),
                'teamsRepeatOccurrences': clean_str(settings.get('teamsRepeatOccurrences')),
                'teamsLobbyBypass': clean_str(settings.get('teamsLobbyBypass')),
                'teamsRecording': clean_str(settings.get('teamsRecording')),
                'teamsSpokenLanguage': clean_str(settings.get('teamsSpokenLanguage')),
                'teamsMeetingType': clean_str(settings.get('teamsMeetingType')),
                'teamsRequestResponses': settings.get('teamsRequestResponses'),
                'teamsAllowTimeProposals': settings.get('teamsAllowTimeProposals'),
                'teamsHideAttendees': settings.get('teamsHideAttendees'),
            }
    return {}


def teams_delivery_metadata_from_live_session(module_catalogue_id):
    ensure_live_session_tracking_tables()
    sessions = authoring_fetch_all(
        LIVE_SESSIONS_TABLE,
        "module_catalogue_id = %s and status = 'active'",
        [module_catalogue_id],
        'updated_at desc, created_at desc',
    )
    if not sessions:
        return {}
    settings = live_session_row_to_component_settings(sessions[0])
    return {
        'teamsMeetingUrl': settings.get('teamsMeetingUrl') or '',
        'liveSessionUrl': settings.get('liveSessionUrl') or '',
        'teamsLiveSessionId': settings.get('teamsLiveSessionId') or '',
        'teamsOnlineMeetingId': settings.get('teamsOnlineMeetingId') or '',
        'teamsEventId': settings.get('teamsEventId') or '',
        'teamsWebLink': settings.get('teamsWebLink') or '',
        'teamsMeetingOptionsUrl': settings.get('teamsMeetingOptionsUrl') or '',
        'teamsOrganizerEmail': settings.get('teamsOrganizerEmail') or '',
        'teamsAttendees': settings.get('teamsAttendees') or [],
        'teamsPresenters': settings.get('teamsPresenters') or [],
        'teamsStartDateTimeUtc': settings.get('teamsStartDateTimeUtc') or '',
        'teamsDurationMinutes': settings.get('teamsDurationMinutes') or '',
        'teamsRepeat': settings.get('teamsRepeat') or '',
        'teamsRepeatOccurrences': settings.get('teamsRepeatOccurrences') or '',
        'teamsLobbyBypass': settings.get('teamsLobbyBypass') or '',
        'teamsRecording': settings.get('teamsRecording') or '',
        'teamsSpokenLanguage': settings.get('teamsSpokenLanguage') or '',
        'teamsMeetingType': settings.get('teamsMeetingType') or '',
        'teamsRequestResponses': settings.get('teamsRequestResponses'),
        'teamsAllowTimeProposals': settings.get('teamsAllowTimeProposals'),
        'teamsHideAttendees': settings.get('teamsHideAttendees'),
    }


def live_session_row_to_component_settings(row):
    start_datetime = row.get('start_datetime')
    start_value = start_datetime.isoformat() if hasattr(start_datetime, 'isoformat') else clean_str(start_datetime)
    join_url = clean_str(row.get('join_url'))
    return {
        'teamsMeetingUrl': join_url,
        'liveSessionUrl': join_url,
        'teamsLiveSessionId': clean_str(row.get('id')),
        'teamsOnlineMeetingId': clean_str(row.get('online_meeting_id')),
        'teamsEventId': clean_str(row.get('graph_event_id')),
        'teamsWebLink': clean_str(row.get('web_link')),
        'teamsMeetingOptionsUrl': clean_str(row.get('meeting_options_url')),
        'teamsOrganizerEmail': clean_str(row.get('organizer_email')),
        'teamsAttendees': as_json_value(row.get('attendees'), []),
        'teamsPresenters': as_json_value(row.get('presenters'), []),
        'teamsStartDateTimeUtc': start_value,
        'sessionDateTimeUtc': start_value,
        'teamsDurationMinutes': parse_int(row.get('duration_minutes'), 60),
        'durationMinutes': parse_int(row.get('duration_minutes'), 60),
        'teamsProvider': clean_str(row.get('provider')) or 'Microsoft Teams',
        'teamsRepeat': clean_str(row.get('repeat_pattern')) or 'none',
        'teamsRepeatOccurrences': parse_int(row.get('repeat_occurrences'), 1),
        'teamsLobbyBypass': clean_str(row.get('lobby_bypass')) or 'invited',
        'teamsRecording': clean_str(row.get('recording')) or 'none',
        'teamsSpokenLanguage': clean_str(row.get('spoken_language')) or 'en-GB',
        'teamsMeetingType': clean_str(row.get('meeting_type')) or 'live-session',
        'teamsRequestResponses': bool(row.get('request_responses')),
        'teamsAllowTimeProposals': bool(row.get('allow_time_proposals')),
        'teamsHideAttendees': bool(row.get('hide_attendees')),
    }


@csrf_exempt
def curriculum_module_teams_meeting_restore(request, module_catalogue_id):
    """Restore the last tracked Teams meeting into a module's live-session components."""
    if request.method not in ('GET', 'POST'):
        return json_error('Method not allowed.', status=405)
    ensure_module_authoring_tables()
    ensure_live_session_tracking_tables()
    requested_id = clean_str(module_catalogue_id)
    resolved_id = resolve_authoring_catalogue_id(requested_id) or requested_id
    if not authoring_module_exists(resolved_id):
        return json_error('Module authoring structure not found.', status=404)

    sessions = authoring_fetch_all(
        LIVE_SESSIONS_TABLE,
        "module_catalogue_id = %s and status = 'active'",
        [resolved_id],
        'updated_at desc, created_at desc',
    )
    if not sessions:
        return json_error('No saved Teams meeting was found for this module.', status=404)

    settings_update = live_session_row_to_component_settings(sessions[0])
    updated_components = 0
    if request.method == 'POST':
        component_rows = active_component_rows(authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            'module_catalogue_id = %s',
            [resolved_id],
            'display_order, id',
        ))
        now = datetime.utcnow()
        for row in component_rows:
            if frontend_component_type(row.get('type')) != 'live-session':
                continue
            current_settings = component_builder_settings(row)
            update_authoring_rows(AUTHORING_COMPONENTS_TABLE, 'id = %s', [row.get('id')], {
                'settings_json': json_db_value({**current_settings, **settings_update}),
                'live_sessions_link': settings_update.get('liveSessionUrl') or '',
                'updated_at': now,
            })
            updated_components += 1
        if updated_components:
            invalidate_curriculum_cache()

    payload = get_authoring_structure_payload(resolved_id)
    return JsonResponse({
        'restored': request.method == 'POST',
        'updatedComponents': updated_components,
        'meeting': settings_update,
        'module': payload,
    })


def get_authoring_structure_payload(module_catalogue_id):
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    if not module_rows:
        return None
    module = module_rows[0]
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'display_order, week_number, id')
    component_rows = active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'display_order, id'))
    mapping_rows = mappings_with_inferred_sources(
        authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'created_at, id'),
        module_rows,
    )
    completion_rows = authoring_fetch_all(AUTHORING_COMPLETION_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    advanced_rows = authoring_fetch_all(AUTHORING_ADVANCED_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])

    mappings_by_week = defaultdict(list)
    mappings_by_component = defaultdict(list)
    module_mappings = []
    for row in mapping_rows:
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(mapping_response(row))
        elif row.get('week_id'):
            mappings_by_week[str(row.get('week_id'))].append(mapping_response(row))
        else:
            module_mappings.append(mapping_response(row))

    components_by_week = defaultdict(list)
    for row in component_rows:
        component_id = str(row.get('id'))
        week_id = str(row.get('week_id'))
        components_by_week[week_id].append({
            'id': component_id,
            'moduleId': module_catalogue_id,
            'weekId': week_id,
            'type': frontend_component_type(row.get('type')),
            'title': row.get('title') or '',
            'description': row.get('description') or '',
            'expectedOtjh': float(row.get('expected_otjh') or 0),
            'points': parse_int(row.get('points'), 0),
            'reflectionRequired': bool(row.get('reflection_required')),
            'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
            'tutorValidationRequired': bool(row.get('tutor_validation_required')),
            'ksbMappings': mappings_by_component.get(component_id, []),
            'settings': component_builder_settings(row),
        })

    weeks = []
    for row in week_rows:
        week_id = str(row.get('id'))
        weeks.append({
            'id': week_id,
            'moduleId': module_catalogue_id,
            'weekNumber': parse_int(row.get('week_number'), len(weeks) + 1),
            'title': row.get('title') or '',
            'summary': row.get('summary') or '',
            'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
            'components': components_by_week.get(week_id, []),
            'ksbMappings': mappings_by_week.get(week_id, []),
        })

    advanced = advanced_response(advanced_rows[0] if advanced_rows else None)
    payload = {
        'id': f'module-{module_catalogue_id}',
        'moduleId': module_catalogue_id,
        'moduleCatalogueId': module_catalogue_id,
        'structureId': module_catalogue_id,
        'catalogueId': module_catalogue_id,
        'programmeId': module.get('programme_id') or module.get('programme_name') or '',
        'programmeName': module.get('programme_name') or 'Unassigned programme',
        'cohortId': module.get('cohort_id') or '',
        'cohort': module.get('cohort_name') or '',
        'groupId': module.get('group_id') or '',
        'group': module.get('group_name') or '',
        'title': module.get('title') or '',
        'description': module.get('description') or '',
        'color': module.get('color') or '#6941c6',
        'status': module.get('status') or 'draft',
        'ksbProfileSourceId': module.get('ksb_profile_source_id') or '',
        'tutor': module.get('tutor_name') or '',
        'coach': module.get('coach_name') or '',
        'sessionsNumber': parse_int(module.get('sessions_number'), len(weeks)),
        'startDate': format_date(module.get('start_date')),
        'endDate': format_date(module.get('end_date')),
        'weeks': len(weeks),
        'totalOtjh': float(module.get('total_otjh') or 0),
        'declaredTotalOtjh': float(module.get('total_otjh') or 0),
        'ksbCount': len({mapping['code'] for mapping in module_mappings + [m for week in weeks for m in week['ksbMappings']] + [m for week in weeks for component in week['components'] for m in component['ksbMappings']]}),
        'lessonCount': len(component_rows),
        'quizCount': len([row for row in component_rows if normalise_component_type(row.get('type')) == 'quiz']),
        'qualityScore': parse_int(module.get('quality_score'), 0),
        'moduleKsbMappings': module_mappings,
        'completionCriteria': completion_response(completion_rows[0] if completion_rows else None),
        'weekStructure': weeks,
        **advanced,
    }
    assigned_tutor = staff_name_for_assignment(get_tutor_rows(), 'assigned_module_ids', module_assignment_ids(payload))
    if assigned_tutor and not payload.get('tutor'):
        payload['tutor'] = assigned_tutor
    if payload.get('cohort') or payload.get('group') or payload.get('cohortId') or payload.get('groupId'):
        payload['deliveryMetadata'] = {
            'cohortId': payload.get('cohortId') or '',
            'cohort': payload.get('cohort') or '',
            'groupId': payload.get('groupId') or '',
            'group': payload.get('group') or '',
            'coach': payload.get('coach') or '',
            'tutor': payload.get('tutor') or '',
            'color': payload.get('color') or '',
        }
    teams_metadata = teams_delivery_metadata_from_weeks(weeks) or teams_delivery_metadata_from_live_session(module_catalogue_id)
    if teams_metadata:
        payload['deliveryMetadata'] = {**(payload.get('deliveryMetadata') or {}), **teams_metadata}
    if module.get('source_type') == 'training_plan' and module.get('source_id'):
        training_row = training_row_by_id(module.get('source_id'))
        if training_row:
            payload['deliveryStatus'] = delivery_status_for_training_row(training_row)
            payload['deliveryMetadata'] = {
                **(payload.get('deliveryMetadata') or {}),
                'cohort': training_row.get('Cohort_name') or '',
                'group': training_row.get('group_name') or training_row.get('_meta', {}).get('group_name') or '',
                'tutor': training_row.get('Tutor_name') or '',
                'coach': training_row.get('coach_name') or '',
            }
    checklist, score = module_authoring_quality_check(payload)
    payload['qualityChecklist'] = checklist
    payload['qualityScore'] = score
    return payload


def structure_payloads_cache_key(module_catalogue_ids, **options):
    """Cache key covering every input that can change get_authoring_structure_payloads().

    The identifier list is cleaned and sorted first, so two requests naming the same
    modules in a different order (or with duplicates, or with surrounding whitespace)
    share one entry — the function's own result is keyed by catalogue id, so order in
    never affects the mapping out.

    Every shaping option is rendered into the key from its actual value rather than
    being summarised by a hand-written label. A caller that adds an option, or flips
    one, gets a different key automatically; there is no constant left to forget to
    update, which is what makes two semantically different requests unable to collide.
    """
    catalogue_ids = sorted(unique([clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)]))
    flags = ','.join(f'{name}={bool(value)}' for name, value in sorted(options.items()))
    # Hash the identifier list: a resolve request can name hundreds of modules, and an
    # unbounded key would sit in the process cache dict for the whole TTL. The joiner is
    # a separator that cannot occur in a cleaned identifier, so [MOD-A, B] and [MOD-AB]
    # cannot hash alike.
    ids_digest = hashlib.sha256(''.join(catalogue_ids).encode()).hexdigest()[:32]
    return f'module-structure-payloads:{flags}:{len(catalogue_ids)}:{ids_digest}'


def get_authoring_structure_payloads(module_catalogue_ids, include_staff=True, include_quality=True, include_extra=True):
    catalogue_ids = unique([clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)])
    if not catalogue_ids:
        return {}
    placeholders = ', '.join(['%s'] * len(catalogue_ids))
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, f'module_catalogue_id in ({placeholders})', catalogue_ids)
    if not module_rows:
        return {}

    found_ids = [clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))]
    placeholders = ', '.join(['%s'] * len(found_ids))
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, f'module_catalogue_id in ({placeholders})', found_ids, 'display_order, week_number, id')
    component_rows = active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, f'module_catalogue_id in ({placeholders})', found_ids, 'display_order, id'))
    mapping_rows = mappings_with_inferred_sources(
        authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, f'module_catalogue_id in ({placeholders})', found_ids, 'created_at, id'),
        module_rows,
    )
    completion_rows = authoring_fetch_all(AUTHORING_COMPLETION_TABLE, f'module_catalogue_id in ({placeholders})', found_ids) if include_extra else []
    advanced_rows = authoring_fetch_all(AUTHORING_ADVANCED_TABLE, f'module_catalogue_id in ({placeholders})', found_ids) if include_extra else []

    week_rows_by_module = defaultdict(list)
    for row in week_rows:
        week_rows_by_module[clean_str(row.get('module_catalogue_id'))].append(row)

    components_by_week = defaultdict(list)
    component_rows_by_module = defaultdict(list)
    mappings_by_week = defaultdict(list)
    mappings_by_component = defaultdict(list)
    module_mappings_by_module = defaultdict(list)
    completion_by_module = {clean_str(row.get('module_catalogue_id')): row for row in completion_rows}
    advanced_by_module = {clean_str(row.get('module_catalogue_id')): row for row in advanced_rows}

    for row in mapping_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(mapping_response(row))
        elif row.get('week_id'):
            mappings_by_week[str(row.get('week_id'))].append(mapping_response(row))
        else:
            module_mappings_by_module[catalogue_id].append(mapping_response(row))

    for row in component_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        component_id = str(row.get('id'))
        week_id = str(row.get('week_id'))
        component = {
            'id': component_id,
            'moduleId': catalogue_id,
            'weekId': week_id,
            'type': frontend_component_type(row.get('type')),
            'title': row.get('title') or '',
            'description': row.get('description') or '',
            'expectedOtjh': float(row.get('expected_otjh') or 0),
            'points': parse_int(row.get('points'), 0),
            'reflectionRequired': bool(row.get('reflection_required')),
            'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
            'tutorValidationRequired': bool(row.get('tutor_validation_required')),
            'ksbMappings': mappings_by_component.get(component_id, []),
            'settings': as_json_value(row.get('settings_json'), {}),
        }
        components_by_week[week_id].append(component)
        component_rows_by_module[catalogue_id].append(row)

    tutor_rows = []
    if include_staff:
        try:
            tutor_rows = get_tutor_rows()
        except Exception:
            logger.debug('Unable to enrich batch authoring structures with tutor assignments.', exc_info=True)

    payloads = {}
    for module in module_rows:
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        if not catalogue_id:
            continue
        weeks = []
        for row in week_rows_by_module.get(catalogue_id, []):
            week_id = str(row.get('id'))
            weeks.append({
                'id': week_id,
                'moduleId': catalogue_id,
                'weekNumber': parse_int(row.get('week_number'), len(weeks) + 1),
                'title': row.get('title') or '',
                'summary': row.get('summary') or '',
                'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
                'components': components_by_week.get(week_id, []),
                'ksbMappings': mappings_by_week.get(week_id, []),
            })
        module_mappings = module_mappings_by_module.get(catalogue_id, [])
        module_components = component_rows_by_module.get(catalogue_id, [])
        payload = {
            'id': f'module-{catalogue_id}',
            'moduleId': catalogue_id,
            'moduleCatalogueId': catalogue_id,
            'structureId': catalogue_id,
            'catalogueId': catalogue_id,
            'programmeId': module.get('programme_id') or module.get('programme_name') or '',
            'programmeName': module.get('programme_name') or 'Unassigned programme',
            'cohortId': module.get('cohort_id') or '',
            'cohort': module.get('cohort_name') or '',
            'groupId': module.get('group_id') or '',
            'group': module.get('group_name') or '',
            'title': module.get('title') or '',
            'description': module.get('description') or '',
            'color': module.get('color') or '#6941c6',
            'status': module.get('status') or 'draft',
            'ksbProfileSourceId': module.get('ksb_profile_source_id') or '',
            'tutor': module.get('tutor_name') or '',
            'coach': module.get('coach_name') or '',
            'sessionsNumber': parse_int(module.get('sessions_number'), len(weeks)),
            'startDate': format_date(module.get('start_date')),
            'endDate': format_date(module.get('end_date')),
            'weeks': len(weeks),
            'totalOtjh': float(module.get('total_otjh') or 0),
            'declaredTotalOtjh': float(module.get('total_otjh') or 0),
            'ksbCount': len({mapping['code'] for mapping in module_mappings + [m for week in weeks for m in week['ksbMappings']] + [m for week in weeks for component in week['components'] for m in component['ksbMappings']]}),
            'lessonCount': len(module_components),
            'quizCount': len([row for row in module_components if normalise_component_type(row.get('type')) == 'quiz']),
            'qualityScore': parse_int(module.get('quality_score'), 0),
            'moduleKsbMappings': module_mappings,
            'weekStructure': weeks,
        }
        if include_extra:
            payload['completionCriteria'] = completion_response(completion_by_module.get(catalogue_id))
            payload.update(advanced_response(advanced_by_module.get(catalogue_id)))
        assigned_tutor = staff_name_for_assignment(tutor_rows, 'assigned_module_ids', module_assignment_ids(payload)) if tutor_rows else ''
        if assigned_tutor and not payload.get('tutor'):
            payload['tutor'] = assigned_tutor
        if payload.get('cohort') or payload.get('group') or payload.get('cohortId') or payload.get('groupId'):
            payload['deliveryMetadata'] = {
                'cohortId': payload.get('cohortId') or '',
                'cohort': payload.get('cohort') or '',
                'groupId': payload.get('groupId') or '',
                'group': payload.get('group') or '',
                'coach': payload.get('coach') or '',
                'tutor': payload.get('tutor') or '',
                'color': payload.get('color') or '',
            }
        teams_metadata = teams_delivery_metadata_from_weeks(weeks)
        if teams_metadata:
            payload['deliveryMetadata'] = {**(payload.get('deliveryMetadata') or {}), **teams_metadata}
        if include_quality:
            checklist, score = module_authoring_quality_check(payload)
            payload['qualityChecklist'] = checklist
            payload['qualityScore'] = score
        payloads[catalogue_id] = payload
    return payloads


def authoring_catalogue_summaries():
    try:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, title')
        week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE)
        component_rows = active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE))
        mapping_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE)
    except Exception:
        logger.exception('Unable to read module authoring catalogue rows.')
        return {}

    summaries = {}
    for row in module_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summaries[catalogue_id] = {
            'catalogueId': catalogue_id,
            'title': row.get('title') or f'Module {catalogue_id}',
            'programmeId': row.get('programme_id') or '',
            'programmeName': row.get('programme_name') or 'Unassigned programme',
            'cohortId': row.get('cohort_id') or '',
            'cohort': row.get('cohort_name') or '',
            'groupId': row.get('group_id') or '',
            'group': row.get('group_name') or '',
            'description': row.get('description') or '',
            'status': row.get('status') or 'draft',
            'sourceType': row.get('source_type') or '',
            'sourceId': row.get('source_id') or '',
            'ksbProfileSourceId': row.get('ksb_profile_source_id') or '',
            'tutor': row.get('tutor_name') or '',
            'coach': row.get('coach_name') or '',
            'sessionsNumber': parse_int(row.get('sessions_number'), 0),
            'startDate': format_date(row.get('start_date')),
            'endDate': format_date(row.get('end_date')),
            'qualityScore': parse_int(row.get('quality_score'), 0),
            'lastUpdated': format_date(row.get('updated_at')),
            'weeks': 0,
            'weekStructure': [],
            'ksbCount': 0,
            'lessonCount': 0,
            'quizCount': 0,
            'sessionNames': [],
            'ksbCodes': set(),
        }

    for row in sorted(week_rows, key=lambda item: (
        parse_int(item.get('display_order'), 9999),
        parse_int(item.get('week_number'), 9999),
        clean_str(item.get('id')),
    )):
        catalogue_id = str(row.get('module_catalogue_id'))
        if catalogue_id in summaries:
            summaries[catalogue_id]['weeks'] += 1
            summaries[catalogue_id]['weekStructure'].append({
                'id': clean_str(row.get('id')),
                'weekNumber': parse_int(row.get('week_number'), summaries[catalogue_id]['weeks']),
                'title': row.get('title') or '',
                'displayOrder': parse_int(row.get('display_order'), summaries[catalogue_id]['weeks'] - 1),
            })

    for row in component_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        if not summary:
            continue
        component_id = clean_str(row.get('id'))
        week_id = clean_str(row.get('week_id'))
        component_type = normalise_component_type(row.get('type'))
        summary['lessonCount'] += 1
        if component_type == 'quiz':
            summary['quizCount'] += 1
        if component_type == 'live_session':
            summary['sessionNames'].append(row.get('title') or '')
        for week in summary['weekStructure']:
            if clean_str(week.get('id')) != week_id:
                continue
            week.setdefault('components', []).append({
                'id': component_id,
                'moduleCatalogueId': catalogue_id,
                'moduleId': catalogue_id,
                'weekId': week_id,
                'type': frontend_component_type(row.get('type')),
                'title': row.get('title') or '',
                'description': row.get('description') or '',
                'expectedOtjh': float(row.get('expected_otjh') or 0),
                'points': parse_int(row.get('points'), 0),
                'reflectionRequired': bool(row.get('reflection_required')),
                'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
                'tutorValidationRequired': bool(row.get('tutor_validation_required')),
                'ksbMappings': [],
                'settings': component_builder_settings(row),
            })
            break

    for row in mapping_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        code = clean_str(row.get('ksb_code'))
        if summary and code:
            summary['ksbCodes'].add(code)

    for summary in summaries.values():
        summary['ksbCount'] = len(summary['ksbCodes'])
        summary['ksbCodes'] = sorted(summary['ksbCodes'])

    try:
        tutor_rows = get_tutor_rows()
        coach_rows = get_coach_rows()
        for summary in summaries.values():
            catalogue_id = clean_str(summary.get('catalogueId'))
            group_id = clean_str(summary.get('groupId'))
            tutor_name = summary.get('tutor') or staff_name_for_assignment(tutor_rows, 'assigned_module_ids', [catalogue_id])
            coach_name = staff_name_for_assignment(coach_rows, 'assigned_group_ids', [group_id])
            if tutor_name:
                summary['tutor'] = tutor_name
            if coach_name and not summary.get('coach'):
                summary['coach'] = coach_name
    except Exception:
        logger.debug('Unable to enrich authoring summaries with staff assignments.', exc_info=True)

    return summaries


def authoring_summary_catalogue_item(summary):
    catalogue_id = summary['catalogueId']
    return {
        'id': f'authoring-module-{catalogue_id}',
        'moduleId': catalogue_id,
        'moduleCatalogueId': catalogue_id,
        'structureId': catalogue_id,
        'sourceId': catalogue_id,
        'catalogueId': catalogue_id,
        'name': summary['title'],
        'programmeId': summary.get('programmeId') or '',
        'programme': summary['programmeName'],
        'cohortId': summary.get('cohortId') or '',
        'cohort': summary.get('cohort') or '',
        'groupId': summary.get('groupId') or '',
        'group': summary.get('group') or '',
        'weeks': summary['weeks'],
        'ksbCount': summary['ksbCount'],
        'lessons': summary['lessonCount'],
        'quizzes': summary['quizCount'],
        'assignments': 0,
        'status': summary['status'],
        'authoringStatus': summary['status'],
        'sourceType': summary.get('sourceType') or 'authoring',
        'ksbProfileSourceId': summary.get('ksbProfileSourceId') or '',
        'deliveryStatus': summary.get('deliveryStatus') or 'unknown',
        'author': '',
        'lastUpdated': summary['lastUpdated'],
        'color': '#6941c6',
        'notes': summary['description'],
        'startDate': summary['startDate'],
        'endDate': summary['endDate'],
        'sessionsNumber': summary['sessionsNumber'],
        'weekStructure': summary.get('weekStructure') or [],
        'sessionNames': summary['sessionNames'],
        'ksbCodes': summary['ksbCodes'],
        'qualityScore': summary['qualityScore'],
        'tutor': summary.get('tutor') or '',
        'coach': summary.get('coach') or '',
        'deliveryMetadata': {
            'cohortId': summary.get('cohortId') or '',
            'cohort': summary.get('cohort') or '',
            'groupId': summary.get('groupId') or '',
            'group': summary.get('group') or '',
            'tutor': summary.get('tutor') or '',
            'coach': summary.get('coach') or '',
            **teams_delivery_metadata_from_weeks(summary.get('weekStructure') or []),
        },
    }


def saved_authoring_catalogue_items():
    items = []
    for summary in authoring_catalogue_summaries().values():
        items.append(authoring_summary_catalogue_item(summary))
    return items


def enrich_curriculum_modules_with_authoring_details(modules):
    module_ids = unique([
        clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
        for module in modules or []
        if clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
    ])
    if not module_ids:
        return modules
    authoring_payloads = get_authoring_structure_payloads(
        module_ids,
        include_staff=False,
        include_quality=False,
        include_extra=False,
    )
    enriched = []
    for module in modules or []:
        module_id = clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
        authoring = authoring_payloads.get(module_id)
        if not authoring:
            enriched.append(module)
            continue
        delivery_metadata = {
            **(module.get('deliveryMetadata') if isinstance(module.get('deliveryMetadata'), dict) else {}),
            **(authoring.get('deliveryMetadata') if isinstance(authoring.get('deliveryMetadata'), dict) else {}),
        }
        enriched.append({
            **module,
            'moduleCatalogueId': authoring.get('catalogueId') or module.get('moduleCatalogueId') or module_id,
            'catalogueId': authoring.get('catalogueId') or module.get('catalogueId') or module_id,
            'structureId': authoring.get('catalogueId') or module.get('structureId') or module_id,
            'name': authoring.get('title') or module.get('name'),
            'notes': authoring.get('description') if authoring.get('description') is not None else module.get('notes'),
            'startDate': authoring.get('startDate') or module.get('startDate'),
            'endDate': authoring.get('endDate') or module.get('endDate'),
            'sessionsNumber': authoring.get('sessionsNumber') or module.get('sessionsNumber'),
            'weeks': authoring.get('weeks') or module.get('weeks'),
            'weekStructure': authoring.get('weekStructure') or module.get('weekStructure') or [],
            'sessionNames': meaningful_session_names(authoring.get('sessionNames')) or module.get('sessionNames') or [],
            'moduleKsbMappings': authoring.get('moduleKsbMappings') or module.get('moduleKsbMappings') or [],
            'ksbCodes': authoring.get('ksbCodes') or module.get('ksbCodes') or [],
            'deliveryMetadata': delivery_metadata,
        })
    return enriched


def module_delivery_signature(module):
    return '|'.join([
        normalise(module.get('programme')),
        normalise(module.get('name') or module.get('title')),
        normalise(module.get('cohortId') or module.get('cohort_id') or module.get('cohort')),
        normalise(module.get('groupId') or module.get('group_id') or module.get('group')),
    ])


def authoring_summary_delivery_signature(summary):
    return '|'.join([
        normalise(summary.get('programmeName')),
        normalise(summary.get('title')),
        normalise(summary.get('cohortId') or summary.get('cohort')),
        normalise(summary.get('groupId') or summary.get('group')),
    ])


def authoring_summary_score(summary):
    return (
        parse_int(summary.get('ksbCount'), 0),
        parse_int(summary.get('qualityScore'), 0),
        parse_int(summary.get('lessonCount'), 0),
        parse_int(summary.get('weeks'), 0),
    )


def best_authoring_summary(candidates):
    candidates = [candidate for candidate in candidates if candidate]
    if not candidates:
        return None
    return max(candidates, key=authoring_summary_score)


def enrich_modules_with_authoring(modules):
    try:
        authoring_by_id = authoring_catalogue_summaries()
        authoring_by_training_source = {
            clean_str(summary.get('sourceId')): summary
            for summary in authoring_by_id.values()
            if summary.get('sourceType') == 'training_plan' and summary.get('sourceId')
        }
        delivery_modules_by_signature = defaultdict(list)
        for module in modules:
            if clean_str(module.get('sourceType')) != 'authoring':
                delivery_modules_by_signature[module_delivery_signature(module)].append(module)
        authoring_by_delivery_signature = defaultdict(list)
        for summary in authoring_by_id.values():
            signature = authoring_summary_delivery_signature(summary)
            if signature:
                authoring_by_delivery_signature[signature].append(summary)

        enriched = []
        seen = set()
        for module in modules:
            invalid_explicit_id = clean_str(module.get('invalidModuleCatalogueId'))
            explicit_catalogue_id = clean_str(module.get('moduleCatalogueId') or module.get('catalogueId'))
            if explicit_catalogue_id and not is_canonical_module_catalogue_id(explicit_catalogue_id):
                invalid_explicit_id = explicit_catalogue_id
                explicit_catalogue_id = ''
            catalogue_id = explicit_catalogue_id or clean_str(module.get('sourceId') or module.get('id'))
            source_key = clean_str(module.get('sourceId')) if module.get('sourceType') == 'training_plan' else ''
            signature = module_delivery_signature(module)
            signature_matches = (
                authoring_by_delivery_signature.get(signature, [])
                if not explicit_catalogue_id and not invalid_explicit_id and len(delivery_modules_by_signature.get(signature, [])) == 1
                else []
            )
            authoring_candidates = [
                authoring_by_id.get(explicit_catalogue_id),
                authoring_by_training_source.get(source_key) if not explicit_catalogue_id and not invalid_explicit_id else None,
                *signature_matches,
            ]
            saved = best_authoring_summary(authoring_candidates)
            if saved:
                authoring_catalogue_id = saved['catalogueId']
                module_source_type = module.get('sourceType') or saved.get('sourceType')
                module_status = module.get('status') or saved['status']
                related_catalogue_ids = unique([
                    clean_str(item)
                    for item in [
                        module.get('catalogueId'),
                        module.get('moduleCatalogueId'),
                        module.get('moduleId'),
                        module.get('sourceId'),
                        module.get('id'),
                        authoring_catalogue_id,
                        *[candidate.get('catalogueId') for candidate in authoring_candidates if candidate],
                        *[candidate.get('sourceId') for candidate in authoring_candidates if candidate],
                    ]
                    if clean_str(item)
                ])
                ksb_codes = unique([
                    *(module.get('ksbCodes') or []),
                    *(saved.get('ksbCodes') or []),
                ])
                session_names = unique([
                    *(module.get('sessionNames') or []),
                    *(saved.get('sessionNames') or []),
                ])
                ksb_count = max(parse_int(saved.get('ksbCount'), 0), len(ksb_codes), parse_int(module.get('ksbCount'), 0))
                module = {
                    **module,
                    'name': saved['title'],
                    'programme': saved['programmeName'] or module.get('programme'),
                    'weeks': saved['weeks'] or module.get('weeks'),
                    'weekStructure': saved.get('weekStructure') or module.get('weekStructure') or [],
                    'ksbCount': ksb_count,
                    'lessons': saved['lessonCount'],
                    'quizzes': saved['quizCount'],
                    'status': module_status,
                    'authoringStatus': saved['status'],
                    'sourceType': module_source_type,
                    'ksbProfileSourceId': saved.get('ksbProfileSourceId') or module.get('ksbProfileSourceId') or '',
                    'deliveryStatus': module.get('deliveryStatus') or saved.get('deliveryStatus') or 'unknown',
                    'notes': saved['description'],
                    'startDate': saved.get('startDate') or module.get('startDate') or '',
                    'endDate': saved.get('endDate') or module.get('endDate') or '',
                    'sessionsNumber': saved.get('sessionsNumber') or module.get('sessionsNumber') or module.get('weeks') or 0,
                    'sessionNames': session_names or module.get('sessionNames') or saved.get('sessionNames') or [],
                    'ksbCodes': ksb_codes,
                    'qualityScore': saved['qualityScore'],
                    'catalogueId': authoring_catalogue_id,
                    'moduleCatalogueId': authoring_catalogue_id,
                    'moduleId': authoring_catalogue_id,
                    'structureId': authoring_catalogue_id,
                    'relatedCatalogueIds': related_catalogue_ids,
                }
                seen.add(authoring_catalogue_id)
                if source_key:
                    seen.add(f'training_plan:{source_key}')
                seen.add(f'signature:{signature}')
            enriched.append(module)
            seen.add(catalogue_id)
        existing_keys = {clean_str(module.get('catalogueId') or module.get('sourceId') or module.get('id')) for module in enriched}
        for catalogue_id, saved in authoring_by_id.items():
            training_source_key = f'training_plan:{clean_str(saved.get("sourceId"))}' if saved.get('sourceType') == 'training_plan' else ''
            signature_key = f'signature:{authoring_summary_delivery_signature(saved)}'
            if catalogue_id in existing_keys or catalogue_id in seen or (training_source_key and training_source_key in seen) or signature_key in seen:
                continue
            enriched.append(authoring_summary_catalogue_item(saved))
        return enriched
    except Exception:
        logger.exception('Unable to enrich curriculum modules with authoring data.')
        return modules


def module_matches_programme(programme, module):
    programme_candidates = {
        normalise(programme.get('id')),
        normalise(programme.get('sourceId')),
        normalise(programme.get('name')),
        normalise(programme.get('standard')),
    }
    module_candidates = {
        normalise(module.get('programmeId')),
        normalise(module.get('programme')),
    }
    return bool(programme_candidates.intersection(module_candidates))


def programme_identifier_looks_exact(identifier):
    ident = clean_str(identifier).lower()
    return ident.startswith('prog-') or ident.startswith('program-prog-')


def training_row_matches_programme_identifier(row, identifier, configs_by_id):
    identity = programme_identity(row, configs_by_id)
    expected = curriculum_identifier_candidates(identifier)
    source_candidates = curriculum_identifier_candidates(identity.get('sourceId'))
    if expected.intersection(source_candidates):
        return True
    if programme_identifier_looks_exact(identifier):
        return False
    return bool(expected.intersection(curriculum_identifier_candidates(identity.get('name'))))


def training_row_delivery_signature(row, configs_by_id):
    if not clean_str(row.get('module_name')):
        return ''
    identity = programme_identity(row, configs_by_id)
    cohort = actual_cohort_identity(row, identity['name'])
    if not cohort:
        return ''
    group = actual_group_identity(row, cohort['id'])
    if not group:
        return ''
    return module_delivery_signature({
        'programme': identity['name'],
        'name': row.get('module_name') or '',
        'cohortId': cohort['id'],
        'cohort': cohort['name'],
        'groupId': group['id'],
        'group': group['name'],
    })


def authoring_row_delivery_signature(row):
    return module_delivery_signature({
        'programme': row.get('programme_name') or row.get('programme_id') or '',
        'name': row.get('title') or '',
        'cohortId': row.get('cohort_id') or '',
        'cohort': row.get('cohort_name') or '',
        'groupId': row.get('group_id') or '',
        'group': row.get('group_name') or '',
    })


def dedupe_authoring_module_rows(module_rows, mapping_rows=None, component_rows=None, week_rows=None):
    mapping_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (mapping_rows or []))
    component_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (component_rows or []))
    week_counts = Counter(clean_str(row.get('module_catalogue_id')) for row in (week_rows or []))
    selected = {}
    order = {}
    for index, row in enumerate(module_rows):
        module_id = clean_str(row.get('module_catalogue_id'))
        signature = authoring_row_delivery_signature(row) or f'id:{module_id}'
        order.setdefault(signature, index)
        score = (
            mapping_counts.get(module_id, 0),
            component_counts.get(module_id, 0),
            week_counts.get(module_id, 0),
            1 if clean_str(row.get('source_type')) == 'training_plan' and clean_str(row.get('source_id')) else 0,
            parse_int(row.get('quality_score'), 0),
        )
        current = selected.get(signature)
        if not current or score > current[0]:
            selected[signature] = (score, row)
    return [item[1] for _, item in sorted(selected.items(), key=lambda pair: order.get(pair[0], 0))]


def is_archived_module_summary(module):
    return (
        clean_str((module or {}).get('status')).lower() == 'archived'
        or clean_str((module or {}).get('authoringStatus')).lower() == 'archived'
        or clean_str((module or {}).get('deliveryStatus')).lower() == 'archived'
    )


def enrich_programmes_with_module_counts(programmes, modules, modules_enriched=False, include_archived=False):
    enriched_modules = modules if modules_enriched else enrich_modules_with_authoring(modules)
    if not include_archived:
        enriched_modules = [module for module in enriched_modules if not is_archived_module_summary(module)]
    enriched_programmes = []
    existing_programme_keys = set()
    for programme in programmes:
        existing_programme_keys.update({
            normalise(programme.get('id')),
            normalise(programme.get('sourceId')),
            normalise(programme.get('name')),
            normalise(programme.get('standard')),
        })
        free_programme_modules = [module for module in enriched_modules if module_matches_programme(programme, module)]
        if not free_programme_modules or clean_str(programme.get('structureType')).lower() == 'free':
            enriched_programmes.append(programme)
            continue

        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in free_programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in free_programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        enriched_programmes.append({
            **programme,
            'modules': len(free_programme_modules),
            'cohorts': max(parse_int(programme.get('cohorts'), 0), len(cohort_keys)),
            'groups': max(parse_int(programme.get('groups'), 0), len(group_keys)),
        })

    module_only_programmes = {}
    for module in enriched_modules:
        programme_name = clean_str(module.get('programme') or module.get('programmeName'))
        if not programme_name or normalise(programme_name) in {'unassignedprogramme', 'unassigned'}:
            continue
        module_programme_id = clean_str(module.get('programmeId') or module.get('programme_id'))
        module_keys = {normalise(programme_name), normalise(module_programme_id)}
        if existing_programme_keys.intersection(module_keys):
            continue
        key = normalise(module_programme_id) or normalise(programme_name)
        module_only_programmes.setdefault(key, {
            'name': programme_name,
            'sourceId': module_programme_id or programme_name,
            'modules': [],
        })['modules'].append(module)

    for item in module_only_programmes.values():
        free_programme_modules = item['modules']
        source_id = item['sourceId']
        programme_name = item['name']
        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in free_programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in free_programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        session_count = sum(parse_int(module.get('weeks') or module.get('sessionsNumber') or module.get('sessions'), 0) for module in free_programme_modules)
        enriched_programmes.append({
            'id': source_id,
            'sourceId': source_id,
            'name': programme_name,
            'standard': programme_name,
            'level': infer_level(programme_name),
            'status': 'planned',
            'modules': len(free_programme_modules),
            'groups': len(group_keys),
            'weeks': session_count,
            'ksbMapped': 0,
            'ksbTotal': 0,
            'learners': 0,
            'cohorts': len(cohort_keys),
            'lastUpdated': max([clean_str(module.get('lastUpdated')) for module in free_programme_modules] or ['']),
            'owner': '',
            'color': clean_str(free_programme_modules[0].get('color')) or '#6941c6',
            'description': '',
            'structureType': 'scheduled',
            'freeComponents': 0,
        })
    return enriched_programmes


def infer_mapping_source_from_module(module, code, cache=None):
    module = module or {}
    cache = cache if cache is not None else {}
    clean_code = coverage_normalise_code(code)
    cache_key = (
        clean_str(module.get('module_catalogue_id')),
        clean_str(module.get('ksb_profile_source_id')),
        clean_str(module.get('programme_name')),
        clean_code,
    )
    if cache_key in cache:
        return cache[cache_key]
    source_cache = cache.setdefault('_source_required', {})
    explicit_type, explicit_id = split_ksb_source('', module.get('ksb_profile_source_id'))
    if explicit_type and explicit_id and ksb_exists_in_source(explicit_type, explicit_id, clean_code, source_cache):
        cache[cache_key] = (explicit_type, explicit_id)
        return cache[cache_key]

    programme_name = clean_str(module.get('programme_name'))
    if not programme_name:
        cache[cache_key] = ('', '')
        return cache[cache_key]

    if '_profile_rows' not in cache:
        cache['_profile_rows'] = get_ksb_profile_rows()
    profile_rows = cache['_profile_rows']
    profile = get_ksb_profile_for_program(programme_name, profile_rows)
    if profile:
        profile_source_id = f'ksb-{profile.get("id")}'
        if ksb_exists_in_source('framework', profile_source_id, clean_code, source_cache):
            cache[cache_key] = ('framework', profile_source_id)
            return cache[cache_key]

    if '_standards' not in cache:
        cache['_standards'] = build_skills_england_standards()
    standards = cache['_standards']
    standard = next((item for item in standards if normalise(item.get('name')) == normalise(programme_name)), None)
    if standard and ksb_exists_in_source('standard', standard.get('id'), clean_code, source_cache):
        cache[cache_key] = ('standard', standard.get('id'))
        return cache[cache_key]

    cache[cache_key] = ('', '')
    return cache[cache_key]


def infer_mapping_source_for_code(module_catalogue_id, code):
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    return infer_mapping_source_from_module(module_rows[0] if module_rows else {}, code)


def mappings_with_inferred_sources(mapping_rows, module_rows):
    module_by_id = {clean_str(row.get('module_catalogue_id')): row for row in module_rows}
    enriched = []
    for row in mapping_rows:
        if clean_str(row.get('source_type')) and clean_str(row.get('source_id')):
            enriched.append(row)
            continue
        source_type, source_id = infer_mapping_source_from_module(
            module_by_id.get(clean_str(row.get('module_catalogue_id')), {}),
            row.get('ksb_code'),
        )
        enriched.append({**row, 'source_type': source_type, 'source_id': source_id} if source_type and source_id else row)
    return enriched


def authoring_mapping_payload(module_catalogue_id, mapping, week_id=None, component_id=None, module_row=None, source_cache=None, enforce_unique=True):
    mapping_id = canonical_authoring_id('KSBMAP', mapping.get('id'))
    source_type, source_id = source_payload_from_mapping(mapping)
    code = coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or '')
    if (not source_type or not source_id) and code:
        if module_row is not None:
            source_type, source_id = infer_mapping_source_from_module(module_row, code, source_cache)
        else:
            source_type, source_id = infer_mapping_source_for_code(module_catalogue_id, code)
    if component_id and enforce_unique:
        ensure_authoring_mapping_unique(component_id, {**mapping, 'sourceType': source_type, 'sourceId': source_id}, mapping_id=mapping_id)
    return {
        'id': mapping_id,
        'module_catalogue_id': module_catalogue_id,
        'week_id': week_id,
        'component_id': component_id,
        'ksb_id': mapping.get('ksbId') or mapping.get('ksb_id') or mapping.get('code'),
        'ksb_code': code,
        'ksb_description': mapping.get('description') or mapping.get('ksbDescription') or '',
        'source_type': source_type,
        'source_id': source_id,
        'classification': normalise_ksb_classification(mapping.get('type') or mapping.get('classification')),
        'weight': normalise_ksb_weight(mapping.get('weight')),
    }


def save_authoring_mapping(module_catalogue_id, mapping, week_id=None, component_id=None, module_row=None, source_cache=None, enforce_unique=True):
    authoring_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], authoring_mapping_payload(
        module_catalogue_id,
        mapping,
        week_id=week_id,
        component_id=component_id,
        module_row=module_row,
        source_cache=source_cache,
        enforce_unique=enforce_unique,
    ))


def save_module_authoring_structure(module_catalogue_id, payload):
    validation_errors = validate_module_authoring_payload(payload)
    if validation_errors:
        raise ModuleAuthoringValidationError(validation_errors)
    ensure_module_authoring_tables()
    module_catalogue_id = unique_module_catalogue_id(module_catalogue_id or payload.get('catalogueId') or payload.get('moduleCatalogueId'))
    existing_module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id]) if module_catalogue_id else []
    existing_module_row = existing_module_rows[0] if existing_module_rows else {}
    # Validation above has already rejected a non-list weekStructure/weeks, so the
    # list form is the only thing that can reach here.
    weeks = without_retired_components(
        payload.get('weekStructure') if payload.get('weekStructure') is not None else payload.get('weeks') or []
    )
    checklist, quality_score = module_authoring_quality_check({**payload, 'weekStructure': weeks})
    all_components = [component for week in weeks for component in (week.get('components') or [])]
    total_otjh = sum(component_expected_otjh(component) for component in all_components)
    # total_otjh is the persisted aggregate used by catalogue/list views.
    # Keep it derived from components so stale frontend payloads cannot pin it to 0.
    declared_total = total_otjh
    programme_name = payload.get('programmeName') or payload.get('programme') or 'Unassigned programme'
    programme = ensure_programme_config_for_authoring(
        programme_name,
        payload.get('programmeId') or payload.get('programme_id'),
    )
    programme_id = (programme or {}).get('sourceId') or payload.get('programmeId') or payload.get('programme_id') or programme_name
    delivery_metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
    cohort_id = clean_str(payload.get('cohortId') or payload.get('cohort_id') or delivery_metadata.get('cohortId') or delivery_metadata.get('cohort_id'))
    cohort_name = clean_str(payload.get('cohortName') or payload.get('cohort_name') or payload.get('cohort') or delivery_metadata.get('cohort'))
    group_id = clean_str(payload.get('groupId') or payload.get('group_id') or delivery_metadata.get('groupId') or delivery_metadata.get('group_id'))
    group_name = clean_str(payload.get('groupName') or payload.get('group_name') or payload.get('group') or delivery_metadata.get('group'))
    tutor_name = canonical_staff_assignment_name('tutor', payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or delivery_metadata.get('tutor'))
    coach_name = canonical_staff_assignment_name('coach', payload.get('coach') or payload.get('coachName') or payload.get('coach_name') or delivery_metadata.get('coach'))
    saved_module_row = None
    with transaction.atomic():
        saved_module_row = authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'cohort_id': cohort_id,
            'cohort_name': cohort_name,
            'group_id': group_id,
            'group_name': group_name,
            'tutor_name': tutor_name,
            'coach_name': coach_name,
            'title': payload.get('title') or payload.get('name') or f'Module {module_catalogue_id}',
            'description': payload.get('description') or '',
            'color': payload.get('color') or delivery_metadata.get('color') or '',
            'status': clean_str(payload.get('status') or 'draft').lower(),
            'sessions_number': payload.get('sessionsNumber') or payload.get('sessions_number') or len(weeks),
            'start_date': payload.get('startDate') or payload.get('start_date') or None,
            'end_date': payload.get('endDate') or payload.get('end_date') or None,
            'total_otjh': declared_total,
            'quality_score': quality_score,
            'source_type': payload.get('sourceType') or payload.get('source_type') or None,
            'source_id': payload.get('sourceId') or payload.get('source_id') or None,
            'ksb_profile_source_id': payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else existing_module_row.get('ksb_profile_source_id'),
            'session_week_day': payload.get('weekDays') or payload.get('sessionWeekDay') or payload.get('session_week_day') or payload.get('deliveryDays') or None,
            'session_start_time': payload.get('startTime') or payload.get('sessionStartTime') or payload.get('session_start_time') or None,
            'session_end_time': payload.get('endTime') or payload.get('sessionEndTime') or payload.get('session_end_time') or None,
            'tutor_name': tutor_name or None,
            'coach_name': coach_name or None,
        })
        link_live_session_series_to_module(module_catalogue_id, {**payload, 'weekStructure': weeks})
        authoring_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])

        mapping_source_cache = {}
        week_payloads = []
        component_payloads = []
        mapping_payloads = []
        for week_index, week in enumerate(weeks):
            week_id = canonical_authoring_id('WEEK', week.get('id'))
            week_payloads.append({
                'id': week_id,
                'module_catalogue_id': module_catalogue_id,
                'week_number': parse_int(week.get('weekNumber') or week.get('week_number'), week_index + 1),
                'title': week.get('title') or f'Week {week_index + 1}',
                'summary': week.get('summary') or '',
                'learning_outcomes': json_db_value(week.get('learningOutcomes') or []),
                'display_order': week_index,
            })
            for mapping in week.get('ksbMappings') or []:
                mapping_payloads.append(authoring_mapping_payload(
                    module_catalogue_id,
                    mapping,
                    week_id=week_id,
                    module_row=saved_module_row,
                    source_cache=mapping_source_cache,
                ))
            for component_index, component in enumerate(week.get('components') or []):
                component_id = canonical_authoring_id('COMP', component.get('id'))
                component_settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
                component_payloads.append({
                    'id': component_id,
                    'week_id': week_id,
                    'module_catalogue_id': module_catalogue_id,
                    'type': normalise_component_type(component.get('type')),
                    'title': component.get('title') or '',
                    'description': component.get('description') or '',
                    'expected_otjh': component_expected_otjh(component),
                    'points': parse_int(component.get('points'), 0),
                    'reflection_required': bool_payload(component.get('reflectionRequired')),
                    'workplace_evidence_required': False,
                    'tutor_validation_required': bool_payload(component.get('tutorValidationRequired')),
                    'display_order': component_index,
                    'settings_json': json_db_value(component_settings),
                    'live_sessions_link': clean_str(component_settings.get('liveSessionUrl') or component_settings.get('teamsMeetingUrl')),
                })
                for mapping in component.get('ksbMappings') or []:
                    mapping_payloads.append(authoring_mapping_payload(
                        module_catalogue_id,
                        mapping,
                        week_id=week_id,
                        component_id=component_id,
                        module_row=saved_module_row,
                        source_cache=mapping_source_cache,
                        enforce_unique=False,
                    ))
        for mapping in payload.get('moduleKsbMappings') or []:
            mapping_payloads.append(authoring_mapping_payload(
                module_catalogue_id,
                mapping,
                module_row=saved_module_row,
                source_cache=mapping_source_cache,
            ))
        authoring_bulk_upsert(AUTHORING_WEEKS_TABLE, ['id'], week_payloads)
        authoring_bulk_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], component_payloads)
        authoring_bulk_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], mapping_payloads)

        criteria = payload.get('completionCriteria') or {}
        defaults = default_completion_payload()
        authoring_upsert(AUTHORING_COMPLETION_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'quizzes_completed_required': bool_payload(criteria.get('quizzesCompletedRequired')),
            'checkpoints_completed_required': bool_payload(criteria.get('checkpointsCompletedRequired')),
            'average_score_required_enabled': bool_payload(criteria.get('averageScoreRequiredEnabled')),
            'average_score_required': parse_int(criteria.get('averageScoreRequired'), defaults['averageScoreRequired']),
            'total_score_required_enabled': bool_payload(criteria.get('totalScoreRequiredEnabled')),
            'total_score_required': parse_int(criteria.get('totalScoreRequired'), defaults['totalScoreRequired']),
            'additional_notes': criteria.get('additionalNotes') or '',
        })

        advanced = payload.get('advancedDetails') or {}
        authoring_upsert(AUTHORING_ADVANCED_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'background': payload.get('background') or '',
            'epa_requirements': json_db_value(payload.get('epaRequirements') or []),
            'professional_qualification_outcomes': json_db_value(payload.get('qualificationOutcomes') or []),
            'intent': advanced.get('intent') or '',
            'learner_benefit': advanced.get('learnerBenefit') or '',
            'employer_benefit': advanced.get('employerBenefit') or '',
            'sequence_purpose': advanced.get('sequencePurpose') or '',
        })

    if group_id:
        persist_group_authoring_detail({
            'id': group_id,
            'name': group_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'programmeId': programme_id,
            'programme': programme_name,
            'startDate': payload.get('startDate') or payload.get('start_date') or None,
            'endDate': payload.get('endDate') or payload.get('end_date') or None,
            'schedule': build_group_schedule(
                payload.get('weekDays') or payload.get('deliveryDays') or delivery_metadata.get('weekDays') or delivery_metadata.get('deliveryDays'),
                payload.get('startTime') or payload.get('start_time') or delivery_metadata.get('startTime') or delivery_metadata.get('start_time'),
                payload.get('endTime') or payload.get('end_time') or delivery_metadata.get('endTime') or delivery_metadata.get('end_time'),
                delivery_metadata.get('schedule'),
            ),
            'modules': [payload.get('title') or payload.get('name') or f'Module {module_catalogue_id}'],
        }, [], [saved_module_row] if saved_module_row else [])

    result = get_authoring_structure_payload(module_catalogue_id)
    result['qualityChecklist'] = checklist
    invalidate_curriculum_cache()
    return result


def free_programme_module_id(programme_id, module, index):
    requested = clean_str(module.get('id') or module.get('moduleId') or module.get('catalogueId'))
    if requested:
        return canonical_authoring_id('FREEMOD', requested)
    return canonical_authoring_id('FREEMOD', f'{programme_id}-{index + 1}-{module.get("title") or module.get("name")}')


def free_programme_component_payload(component, index):
    if is_retired_component_type(component.get('type')):
        return None
    requested_display_order = component.get('displayOrder')
    if requested_display_order in (None, ''):
        requested_display_order = component.get('display_order')
    return {
        'id': canonical_authoring_id('FREECOMP', component.get('id')),
        'type': normalise_component_type(component.get('type')),
        'title': component.get('title') or '',
        'description': component.get('description') or '',
        'expected_otjh': component_expected_otjh(component),
        'points': parse_int(component.get('points'), 0),
        'reflection_required': bool_payload(component.get('reflectionRequired') or component.get('reflection_required')),
        'workplace_evidence_required': False,
        'tutor_validation_required': bool_payload(component.get('tutorValidationRequired') or component.get('tutor_validation_required')),
        'display_order': parse_int(requested_display_order, index),
        'settings_json': json_db_value(component.get('settings') or {}),
    }


def free_programme_component_response(row):
    return {
        'id': row.get('id'),
        'moduleId': row.get('free_module_id'),
        'type': frontend_component_type(row.get('type')),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'expectedOtjh': parse_float(row.get('expected_otjh'), 0),
        'points': parse_int(row.get('points'), 0),
        'reflectionRequired': bool(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'settings': as_json_value(row.get('settings_json'), {}),
    }


def free_programme_module_response(row, components):
    module_id = row.get('id')
    module_components = [
        free_programme_component_response(component)
        for component in components
        if clean_str(component.get('free_module_id')) == clean_str(module_id)
        and not is_retired_component_type(component.get('type'))
    ]
    return {
        'id': module_id,
        'programmeId': row.get('programme_id'),
        'programmeName': row.get('programme_name') or '',
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'status': row.get('status') or 'draft',
        'color': row.get('color') or '',
        'displayOrder': parse_int(row.get('display_order'), 0),
        'componentCount': len(module_components),
        'totalOtjh': parse_float(row.get('total_otjh'), 0),
        'components': module_components,
    }


def get_free_programme_modules_payload(programme_id):
    programme_id = clean_str(programme_id)
    modules = free_programme_fetch_all(
        FREE_PROGRAMME_MODULES_TABLE,
        'programme_id = %s',
        [programme_id],
        'display_order, title',
    )
    components = active_component_rows(free_programme_fetch_all(
        FREE_PROGRAMME_COMPONENTS_TABLE,
        'programme_id = %s',
        [programme_id],
        'display_order, title',
    ))
    return [free_programme_module_response(module, components) for module in modules]


def save_free_programme_modules(programme_id, payload):
    programme_id = clean_str(programme_id or payload.get('programmeId') or payload.get('programme_id'))
    if not programme_id:
        raise ValueError('programmeId is required.')
    programme_name = clean_str(payload.get('programmeName') or payload.get('programme_name') or payload.get('programme') or '')
    modules = payload.get('modules') or []
    if not isinstance(modules, list):
        modules = []

    with transaction.atomic():
        free_programme_delete(FREE_PROGRAMME_COMPONENTS_TABLE, 'programme_id = %s', [programme_id])
        free_programme_delete(FREE_PROGRAMME_MODULES_TABLE, 'programme_id = %s', [programme_id])
        for module_index, module in enumerate(modules):
            if not isinstance(module, dict):
                continue
            module_id = free_programme_module_id(programme_id, module, module_index)
            components = active_components_payload(module.get('components') if isinstance(module.get('components'), list) else [])
            total_otjh = sum(component_expected_otjh(component) for component in components if isinstance(component, dict))
            free_programme_upsert(FREE_PROGRAMME_MODULES_TABLE, ['id'], {
                'id': module_id,
                'programme_id': programme_id,
                'programme_name': programme_name,
                'title': module.get('title') or module.get('name') or f'Free module {module_index + 1}',
                'description': module.get('description') or '',
                'status': clean_str(module.get('status') or 'draft').lower(),
                'color': module.get('color') or '',
                'display_order': module_index,
                'component_count': len(components),
                'total_otjh': total_otjh,
            })
            for component_index, component in enumerate(components):
                if not isinstance(component, dict):
                    continue
                component_payload = free_programme_component_payload(component, component_index)
                if not component_payload:
                    continue
                free_programme_upsert(FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], {
                    **component_payload,
                    'free_module_id': module_id,
                    'programme_id': programme_id,
                })

    invalidate_curriculum_cache()
    return get_free_programme_modules_payload(programme_id)


def delete_module_authoring_structure(module_catalogue_id):
    module_catalogue_id = clean_str(module_catalogue_id)
    ensure_module_authoring_tables()
    existing = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    with transaction.atomic():
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_COMPLETION_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_ADVANCED_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    invalidate_curriculum_cache()
    return bool(existing)


def delete_programme_authoring_structure(identifier, programme=None, config=None, rows=None):
    rows = rows or []
    programme_id_candidates = {
        clean_str(identifier),
        clean_str((programme or {}).get('id')),
        clean_str((programme or {}).get('sourceId')),
        clean_str((config or {}).get('program_id')),
        clean_str((config or {}).get('id')),
    }
    programme_id_candidates = {value for value in programme_id_candidates if value and not value.startswith('program-')}
    programme_name_candidates = {
        clean_str((programme or {}).get('name')),
        clean_str((config or {}).get('name')),
        clean_str((config or {}).get('standard')),
    }
    programme_name_candidates = {value for value in programme_name_candidates if value}

    def programme_where_sql(id_column='programme_id', name_column='programme_name'):
        clauses = []
        params = []
        ids = [value for value in programme_id_candidates if value]
        names = [value for value in programme_name_candidates if value]
        if ids:
            placeholders = ', '.join(['%s'] * len(ids))
            clauses.append(f'{quote_ident(id_column)} in ({placeholders})')
            params.extend(ids)
        if names:
            placeholders = ', '.join(['%s'] * len(names))
            clauses.append(f'{quote_ident(name_column)} in ({placeholders})')
            params.extend(names)
        if not clauses:
            return '', []
        return f'({" or ".join(clauses)})', params

    def belongs_to_programme(row):
        row_ids = {
            clean_str(row.get('programme_id')),
            clean_str(row.get('program_id')),
            clean_str(row.get('sourceId')),
        }
        row_names = {
            clean_str(row.get('programme_name')),
            clean_str(row.get('programme')),
            clean_str(row.get('Program')),
            clean_str(row.get('name')),
        }
        if programme_id_candidates.intersection(row_ids):
            return True
        return bool({normalise(value) for value in programme_name_candidates}.intersection(
            {normalise(value) for value in row_names if value}
        ))

    cohort_where, cohort_params = programme_where_sql('programme_id', 'programme_name')
    cohort_rows = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, cohort_where, cohort_params) if cohort_where else []
    cohort_ids = {
        clean_str(row.get('cohort_id') or row.get('cohortId'))
        for row in cohort_rows
    }
    cohort_ids = {value for value in cohort_ids if value}
    group_where, group_params = programme_where_sql('programme_id', 'programme_name')
    if cohort_ids:
        placeholders = ', '.join(['%s'] * len(cohort_ids))
        group_where = f'({group_where} or {quote_ident("cohort_id")} in ({placeholders}))' if group_where else f'{quote_ident("cohort_id")} in ({placeholders})'
        group_params = [*group_params, *cohort_ids]
    group_rows = authoring_fetch_all(GROUPS_TABLE, group_where, group_params) if group_where else []
    group_ids = {
        clean_str(row.get('group_id') or row.get('groupId'))
        for row in group_rows
    }
    group_ids = {value for value in group_ids if value}
    module_ids = {
        training_row_module_catalogue_id(row)
        for row in rows
        if training_row_module_catalogue_id(row)
    }
    module_where, module_params = programme_where_sql('programme_id', 'programme_name')
    if cohort_ids:
        placeholders = ', '.join(['%s'] * len(cohort_ids))
        module_where = f'({module_where} or {quote_ident("cohort_id")} in ({placeholders}))' if module_where else f'{quote_ident("cohort_id")} in ({placeholders})'
        module_params = [*module_params, *cohort_ids]
    if group_ids:
        placeholders = ', '.join(['%s'] * len(group_ids))
        module_where = f'({module_where} or {quote_ident("group_id")} in ({placeholders}))' if module_where else f'{quote_ident("group_id")} in ({placeholders})'
        module_params = [*module_params, *group_ids]
    for module in authoring_fetch_all(AUTHORING_MODULES_TABLE, module_where, module_params) if module_where else []:
        module_id = clean_str(module.get('module_catalogue_id'))
        if module_id:
            module_ids.add(module_id)

    with transaction.atomic():
        if module_ids:
            module_id_list = list(module_ids)
            placeholders = ', '.join(['%s'] * len(module_id_list))
            authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)
            authoring_delete(AUTHORING_COMPONENTS_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)
            authoring_delete(AUTHORING_WEEKS_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)
            authoring_delete(AUTHORING_COMPLETION_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)
            authoring_delete(AUTHORING_ADVANCED_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)
            authoring_delete(AUTHORING_MODULES_TABLE, f'{quote_ident("module_catalogue_id")} in ({placeholders})', module_id_list)

        if group_ids:
            placeholders = ', '.join(['%s'] * len(group_ids))
            authoring_delete(GROUPS_TABLE, f'{quote_ident("group_id")} in ({placeholders})', list(group_ids))
        if cohort_ids:
            placeholders = ', '.join(['%s'] * len(cohort_ids))
            authoring_delete(COHORT_AUTHORING_DETAILS_TABLE, f'{quote_ident("cohort_id")} in ({placeholders})', list(cohort_ids))

        for candidate in programme_id_candidates:
            free_programme_delete(FREE_PROGRAMME_COMPONENTS_TABLE, 'programme_id = %s', [candidate])
            free_programme_delete(FREE_PROGRAMME_MODULES_TABLE, 'programme_id = %s', [candidate])

        if config:
            key_column = programme_config_key_column()
            key_value = config.get(key_column)
            if key_value is not None:
                delete_rows(
                    'programmes',
                    f'{quote_ident(key_column)} = %s',
                    [key_value],
                )

    invalidate_curriculum_cache()
    return {
        'modules': len(module_ids),
        'groups': len(group_ids),
        'cohorts': len(cohort_ids),
        'programmeId': next(iter(programme_id_candidates), clean_str(identifier)),
    }


def update_training_rows(rows, payload):
    return []


def archive_training_rows(rows):
    where_sql, params = training_row_where_ids(rows)
    if not where_sql:
        return []
    return archive_authoring_delivery_rows(rows)


def restore_training_rows(rows):
    where_sql, params = training_row_where_ids(rows)
    if not where_sql:
        return []
    return restore_authoring_delivery_rows(rows)


def row_meta_value(row, key):
    meta = (row or {}).get('_meta') or extract_notes_meta((row or {}).get('notes'))
    return clean_str((row or {}).get(key) or meta.get(key))


def unique_row_values(rows, *keys):
    values = []
    seen = set()
    for row in rows or []:
        for key in keys:
            value = row_meta_value(row, key)
            if value and value not in seen:
                seen.add(value)
                values.append(value)
    return values


def update_authoring_delivery_rows(rows, status):
    updates = []
    updated_at = datetime.utcnow()
    targets = [
        ('modules', 'module_catalogue_id', unique_row_values(rows, TRAINING_MODULE_CATALOGUE_COLUMN), {'status': status, 'updated_at': updated_at}),
        ('groups', 'group_id', unique_row_values(rows, 'group_id'), {'status': status, 'updated_at': updated_at}),
        ('cohorts', 'cohort_id', unique_row_values(rows, 'cohort_id'), {'status': status, 'updated_at': updated_at}),
    ]
    for table, key_column, ids, payload in targets:
        if not ids or not table_exists(table):
            continue
        placeholders = ', '.join(['%s'] * len(ids))
        values = filtered_payload(table, payload)
        if not values:
            continue
        updates.extend(update_rows(table, f'{quote_ident(key_column)} in ({placeholders})', ids, values))
    return updates


def archive_authoring_delivery_rows(rows):
    return update_authoring_delivery_rows(rows, 'archived')


def restore_authoring_delivery_rows(rows):
    return update_authoring_delivery_rows(rows, 'planned')


@require_GET
def curriculum_stats(request):
    return JsonResponse(get_cached_payload(request)['stats'])


@csrf_exempt
def curriculum_preview_cohort_end_date(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    end_date = calculate_cohort_end_date(payload.get('startDate') or payload.get('start_date'), payload.get('durationMonths') or payload.get('duration_months'))
    warnings = []
    if not end_date:
        warnings.append('Set cohort start date and duration months to calculate the end date.')
    return JsonResponse({
        'endDate': format_date(end_date),
        'autoCalculated': bool(end_date),
        'rule': 'add duration months minus one day',
        'warnings': warnings,
    })


@csrf_exempt
def curriculum_preview_module_session_plan(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    plan = build_module_session_plan(
        payload.get('startDate') or payload.get('start_date'),
        payload.get('numberOfSessions') or payload.get('sessionsNumber') or payload.get('weeks'),
        payload.get('deliveryDays') or payload.get('weekDays') or payload.get('delivery_day'),
        payload.get('holidays') or payload.get('linkedHolidays') or [],
    )
    return JsonResponse(plan)


@require_GET
def curriculum_programmes(request):
    visibility = curriculum_visibility(request)
    payload = cached_curriculum_value(
        f'overview:{visibility}:compact',
        lambda: build_curriculum_payload(visibility, compact=True),
    )
    enriched_modules = cached_curriculum_value(
        f'modules:{visibility}:enriched',
        lambda: enrich_modules_with_authoring(payload['modules']),
    )
    programmes = cached_curriculum_value(
        f'programmes:{visibility}:with-module-counts',
        lambda: enrich_programmes_with_module_counts(payload['programmes'], enriched_modules, modules_enriched=True, include_archived=visibility == 'all'),
    )
    return curriculum_collection_response(
        payload,
        'programmes',
        programmes,
    )


@require_GET
def curriculum_programme_tree_detail(request, identifier):
    visibility = curriculum_visibility(request)
    programme_id = clean_str(identifier)
    repair_curriculum_parent_links(programme_id)
    invalidate_curriculum_cache()

    def build_detail_payload():
        return build_curriculum_programme_tree_detail_payload(identifier, visibility)

    payload = cached_curriculum_value(
        f'programme-detail:{visibility}:{clean_str(identifier)}',
        build_detail_payload,
    )
    if not payload:
        return json_error('Programme not found.', status=404)
    return JsonResponse(payload)


def build_curriculum_programme_tree_detail_payload(identifier, visibility):
    curriculum_rows = get_curriculum_rows(compact=True)
    training_rows = curriculum_rows['training'] if visibility == 'all' else [
        row for row in curriculum_rows['training']
        if is_operational_training_row(row)
    ]
    ksb_profiles = curriculum_rows['ksb_profiles'] if visibility == 'all' else [
        profile for profile in curriculum_rows['ksb_profiles']
        if profile.get('is_active')
    ]
    programmes = build_programmes(
        training_rows,
        curriculum_rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
    )
    programme = find_programme({'programmes': programmes}, identifier)
    if not programme:
        return None
    repair_curriculum_parent_links(clean_str(programme.get('id') or programme.get('sourceId')))

    configs_by_id = program_config_by_id(curriculum_rows['program_configs'])
    programme_training_rows = [
        row for row in training_rows
        if (
            clean_str(programme_identity(row, configs_by_id)['sourceId']) == clean_str(programme.get('sourceId'))
            or clean_str(programme_identity(row, configs_by_id)['name']) == clean_str(programme.get('name'))
        )
    ]
    # ``build_cohorts_and_groups`` intentionally reads the normalized tables as
    # its source of truth and therefore returns rows for every programme.  A
    # detail response must scope those rows again; otherwise opening one
    # programme can expose unrelated cohorts/groups and inflate every UI count.
    all_cohorts, all_groups = build_cohorts_and_groups(
        programme_training_rows,
        curriculum_rows['program_configs'],
        include_archived=visibility == 'all',
    )
    programme_ids = [value for value in unique([
        programme.get('id'),
        programme.get('sourceId'),
        f'program-{slugify(programme.get("sourceId"))}',
    ]) if clean_str(value)]
    programme_names = [value for value in unique([programme.get('name')]) if clean_str(value)]

    def belongs_to_selected_programme(item):
        return (
            any(matches_curriculum_identifier(item.get('programmeId'), candidate) for candidate in programme_ids)
            or any(matches_curriculum_identifier(item.get('programme'), candidate) for candidate in programme_names)
        )

    cohorts = [cohort for cohort in all_cohorts if belongs_to_selected_programme(cohort)]
    cohort_ids = {cohort['id'] for cohort in cohorts}
    groups = [
        group for group in all_groups
        if group.get('cohortId') in cohort_ids and belongs_to_selected_programme(group)
    ]
    group_ids = {group['id'] for group in groups}

    modules = build_modules(
        curriculum_rows['modules'],
        programme_training_rows,
        curriculum_rows['program_configs'],
        include_unused=False,
    )
    modules = enrich_curriculum_modules_with_authoring_details(modules)
    sessions = build_sessions_basic(programme_training_rows, curriculum_rows['modules'], curriculum_rows['program_configs'])
    module_catalogue_ids = unique([
        module.get('moduleCatalogueId')
        or module.get('catalogueId')
        or module.get('moduleId')
        or module.get('id')
        for module in modules
        if (
            module.get('moduleCatalogueId')
            or module.get('catalogueId')
            or module.get('moduleId')
            or module.get('id')
        )
    ])
    components = component_builder_rows(module_catalogue_ids)

    nested_cohorts = []
    for cohort in cohorts:
        nested_groups = []
        for group in [item for item in groups if item.get('cohortId') == cohort['id']]:
            group_modules = [
                module for module in modules
                if module_belongs_to_group(module, group)
            ]
            nested_groups.append({**group, 'modules': group_modules})
        nested_cohorts.append({**cohort, 'groups': nested_groups})

    return {
        'schema': CURRICULUM_SCHEMA,
        'programme': programme,
        'cohorts': nested_cohorts,
        'flat': {
            'cohorts': cohorts,
            'groups': groups,
            'groupIds': list(group_ids),
            'modules': modules,
            'sessions': sessions,
            'components': components,
        },
    }


@csrf_exempt
def curriculum_programme_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    if request.method == 'DELETE':
        ensure_program_config_archive_columns()
        config = programme_config_by_identifier(identifier)
        programme = programme_response(identifier) if not config else {
            'id': config.get('program_id') or config.get('id') or config.get('programme_id'),
            'sourceId': config.get('program_id') or config.get('id') or config.get('programme_id'),
            'name': config.get('name'),
            'standard': config.get('standard'),
        }
        if not programme and not config:
            return json_error('Programme not found.', status=404)
        deleted = delete_programme_authoring_structure(identifier, programme, config, [])
        return JsonResponse({'deleted': True, 'permanent': True, 'id': identifier, **deleted})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    name = clean_str(payload.get('name'))
    ensure_program_config_archive_columns()
    structure_type = programme_structure_type(payload, (programme_config_by_identifier(identifier) or {}).get('structure_type') or 'scheduled')
    config = programme_config_by_identifier(identifier)
    programme, rows = rows_for_programme(identifier, 'all')
    if not config and not programme:
        return json_error('Programme not found.', status=404)
    if not config and programme:
        source_id = unique_program_id(programme.get('sourceId') or name or programme.get('name'), get_program_config_rows())
        config = insert_row('programmes', {
            'programme_id': source_id,
            'id': source_id,
            'program_id': source_id,
            'name': name or programme.get('name'),
            'sub': payload.get('standard') or programme.get('standard') or name or programme.get('name'),
            'standard': payload.get('standard') or programme.get('standard') or name or programme.get('name'),
            'level': payload.get('level') or programme.get('level'),
            'owner': payload.get('owner') or programme.get('owner') or '',
            'created_by': payload.get('owner') or programme.get('owner') or '',
            'color': payload.get('color') or programme.get('color') or '#6941c6',
            'description': payload.get('description') or programme.get('description') or '',
            'structure_type': structure_type,
            'ksb_profile_source_id': payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or programme.get('ksbProfileSourceId') or '',
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })

    if config:
        updates = {
            'name': name or config.get('name'),
            'sub': payload.get('standard'),
            'standard': payload.get('standard'),
            'level': payload.get('level'),
            'owner': payload.get('owner'),
            'created_by': payload.get('owner'),
            'color': payload.get('color') or config.get('color'),
            'description': payload.get('description'),
            'structure_type': structure_type,
            'ksb_profile_source_id': payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else config.get('ksb_profile_source_id'),
            'updated_at': datetime.utcnow(),
        }
        try:
            key_column = programme_config_key_column()
        except Exception:
            key_column = programme_config_key_column()
        key_value = config.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates)
        if 'ksbProfileSourceId' in payload or 'ksb_profile_source_id' in payload:
            set_programme_modules_ksb_source(
                unique([identifier, key_value, config.get('program_id'), config.get('name'), name]),
                updates.get('ksb_profile_source_id') or '',
            )

        # Propagate the new programme name to the denormalized programme_name
        # carried on child cohorts/groups/modules, keeping the canonical
        # programme_id (and every relationship) unchanged.
        if name and normalise(name) != normalise(config.get('name')):
            propagate_programme_name(clean_str(config.get('program_id') or key_value), name)

    invalidate_curriculum_cache()
    payload_keys = set(payload.keys())
    if payload_keys and payload_keys.issubset({'ksbProfileSourceId', 'ksb_profile_source_id'}):
        return JsonResponse({
            'updated': True,
            'programme': {
                'id': identifier,
                'sourceId': identifier,
                'ksbProfileSourceId': payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') or '',
            },
        })
    return JsonResponse({'updated': True, 'programme': programme_response(identifier) or programme_response(name) or {'id': identifier}})


def propagate_programme_name(programme_id, programme_name):
    """Update denormalized ``programme_name`` on child normalized rows.

    The canonical ``programme_id`` foreign key on each child is never touched;
    only the display name is refreshed so a programme rename stays consistent.
    """
    programme_id = clean_str(programme_id)
    programme_name = clean_str(programme_name)
    if not programme_id or not programme_name:
        return
    for table in (COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE, AUTHORING_MODULES_TABLE):
        try:
            update_authoring_rows(
                table,
                'programme_id = %s',
                [programme_id],
                {'programme_name': programme_name, 'updated_at': datetime.utcnow()},
            )
        except (Exception, AssertionError):
            logger.debug('Could not propagate programme name to %s for %s.', table, programme_id, exc_info=True)


@csrf_exempt
def curriculum_programme_collection(request):
    if request.method == 'GET':
        return curriculum_programmes(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    ensure_program_config_archive_columns()
    name = clean_str(payload.get('name'))
    structure_type = programme_structure_type(payload)
    program_configs = get_program_config_rows()
    explicit_program_id = clean_str(payload.get('programId'))
    existing_config_by_id = next((
        config for config in program_configs
        if explicit_program_id and clean_str(config.get('program_id') or config.get('id')) == explicit_program_id
    ), None)
    existing_config_by_name = next((
        config for config in program_configs
        if normalise(config.get('name')) == normalise(name)
    ), None)
    existing_config = existing_config_by_id or existing_config_by_name
    archived_reuse_program_id = ''
    if existing_config:
        if is_archived_program_config(existing_config):
            archived_reuse_program_id = f'{existing_config.get("program_id") or existing_config.get("id") or slugify(name)}-2'
            existing_config = None
    if existing_config:
        updates = {
            'name': name,
            'sub': payload.get('standard') or payload.get('sub') or existing_config.get('sub') or existing_config.get('standard') or name,
            'standard': payload.get('standard') or existing_config.get('standard') or existing_config.get('sub') or name,
            'level': payload.get('level') or existing_config.get('level'),
            'owner': payload.get('owner') or existing_config.get('owner'),
            'created_by': payload.get('owner') or existing_config.get('created_by'),
            'color': payload.get('color') or existing_config.get('color') or '#6941c6',
            'description': payload.get('description') if 'description' in payload else existing_config.get('description'),
            'structure_type': programme_structure_type(payload, existing_config.get('structure_type') or 'scheduled'),
            'ksb_profile_source_id': payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else existing_config.get('ksb_profile_source_id'),
            'updated_at': datetime.utcnow(),
        }
        try:
            key_column = programme_config_key_column()
        except Exception:
            key_column = programme_config_key_column()
        key_value = existing_config.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates)
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'programme': programme_response(key_value) or programme_response(name) or {'sourceId': key_value, 'name': name}})

    source_id = archived_reuse_program_id or unique_program_id(explicit_program_id or name, program_configs)
    insert_payload = {
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'name': name,
        'sub': payload.get('standard') or payload.get('sub') or name,
        'standard': payload.get('standard') or payload.get('sub') or name,
        'level': payload.get('level') or '',
        'owner': payload.get('owner') or '',
        'created_by': payload.get('owner') or '',
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'structure_type': structure_type,
        'ksb_profile_source_id': payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or '',
        'is_active': True,
        'is_archived': False,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    }
    row = insert_row('programmes', insert_payload)
    invalidate_curriculum_cache()
    source_id = programme_config_id(row) or source_id
    return JsonResponse({'created': True, 'programme': programme_response(source_id) or {'sourceId': source_id, 'name': row.get('name')}}, status=201)


def upsert_programme_for_tree(payload):
    missing = require_fields(payload, ['name'])
    if missing:
        raise ValueError('Programme name is required.')
    ensure_program_config_archive_columns()
    name = clean_str(payload.get('name'))
    requested_id = clean_str(payload.get('id') or payload.get('sourceId') or payload.get('programmeId') or payload.get('programId'))
    structure_type = programme_structure_type(payload)
    config = programme_config_by_identifier(requested_id) if requested_id else None
    if not config:
        config = next((row for row in get_program_config_rows() if normalise(row.get('name')) == normalise(name)), None)
    updates = {
        'name': name,
        'sub': payload.get('standard') or payload.get('sub') or name,
        'standard': payload.get('standard') or payload.get('sub') or name,
        'level': payload.get('level') or '',
        'owner': payload.get('owner') or '',
        'created_by': payload.get('owner') or '',
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'structure_type': structure_type,
        'ksb_profile_source_id': payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or (config or {}).get('ksb_profile_source_id') or '',
        'is_active': True,
        'is_archived': False,
        'updated_at': datetime.utcnow(),
    }
    if config:
        key_column = programme_config_key_column()
        key_value = config.get(key_column)
        update_rows('programmes', f'{quote_ident(key_column)} = %s', [key_value], updates)
        source_id = programme_config_id(config) or clean_str(key_value)
        propagate_programme_name(source_id, name)
        return {
            'id': source_id,
            'sourceId': source_id,
            'name': name,
            'standard': updates['standard'],
            'level': updates['level'],
            'color': updates['color'],
            'description': updates['description'],
            'structureType': structure_type,
            'ksbProfileSourceId': updates.get('ksb_profile_source_id') or '',
        }

    source_id = unique_program_id(requested_id or name, get_program_config_rows())
    row = insert_row('programmes', {
        **updates,
        'programme_id': source_id,
        'id': source_id,
        'program_id': source_id,
        'created_at': datetime.utcnow(),
    })
    source_id = programme_config_id(row) or source_id
    return {
        'id': source_id,
        'sourceId': source_id,
        'name': row.get('name') or name,
        'standard': row.get('standard') or updates['standard'],
        'level': row.get('level') or updates['level'],
        'color': row.get('color') or updates['color'],
        'description': row.get('description') or updates['description'],
        'structureType': structure_type,
        'ksbProfileSourceId': row.get('ksb_profile_source_id') or updates.get('ksb_profile_source_id') or '',
    }


def save_tree_cohort(cohort, programme_id, programme_name, preserve_missing_groups=False):
    name = clean_str(cohort.get('name'))
    if not name:
        raise ValueError('Cohort name is required.')
    cohort_id = unique_cohort_id(cohort.get('id') or cohort.get('cohortId') or cohort.get('sourceId'))
    duration_months = cohort.get('durationMonths') or 24
    end_date = cohort.get('endDate') or format_date(calculate_cohort_end_date(cohort.get('startDate'), duration_months))
    existing = fetch_cohort_row(cohort_id) or {}
    holiday_ids = parse_notes_id_list(cohort.get('holidayIds') or cohort.get('holiday_ids'))
    group_ids = [clean_str(group.get('id') or group.get('groupId') or group.get('sourceId')) for group in cohort.get('groups') or []]
    if preserve_missing_groups:
        group_ids = unique([*parse_json_value(existing.get('group_ids'), []), *group_ids])
    payload = {
        'id': cohort_id,
        'name': name,
        'programme': programme_name,
        'programmeId': programme_id,
        'startDate': cohort.get('startDate'),
        'endDate': end_date,
        'status': title_case_status(clean_str(existing.get('status')) == 'archived', cohort.get('startDate'), end_date),
        'color': cohort.get('color') or existing.get('color') or '',
        'holidayIds': holiday_ids,
        'groups': group_ids,
    }
    holiday_rows = cohort.get('holidays') or cohort.get('holidayDetails')
    if holiday_rows is None:
        try:
            if not table_exists('holidays'):
                holiday_rows = []
            else:
                holiday_rows = get_holiday_rows()
        except (Exception, AssertionError):
            holiday_rows = []
    row = persist_cohort_authoring_detail(
        payload,
        [],
        [{'id': item} for item in payload['groups'] if item],
        holiday_rows,
        {
            'programme_id': programme_id,
            'programme_name': programme_name,
            'duration_months': parse_int(duration_months, existing.get('duration_months') or 0),
            'source_type': 'module_authoring',
            'source_id': cohort_id,
        },
    )
    if not row:
        raise ValueError(f'Could not save cohort "{name}".')
    return curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(row))


def save_tree_group(group, cohort_row):
    name = clean_str(group.get('name'))
    if not name:
        raise ValueError('Group name is required.')
    group_id = unique_group_id(group.get('id') or group.get('groupId') or group.get('sourceId'))
    cohort = serialize_cohort_authoring_detail(cohort_row)
    existing = fetch_group_row(group_id) or {}
    group_payload = {
        'id': group_id,
        'name': name,
        'cohortId': cohort['cohortId'],
        'cohort': cohort['cohortName'],
        'programmeId': cohort['programmeId'],
        'programme': cohort['programmeName'],
        'coach': canonical_staff_assignment_name('coach', group.get('coach')) if 'coach' in group else clean_str(existing.get('coach_name')),
        'tutor': canonical_staff_assignment_name('tutor', group.get('tutor')) if 'tutor' in group else clean_str(existing.get('tutor_name')),
        'startDate': group.get('startDate') or cohort['startDate'],
        'endDate': group.get('endDate') or cohort['endDate'],
        'schedule': build_group_schedule(group.get('weekDays') or group.get('deliveryDays'), group.get('startTime'), group.get('endTime'), existing.get('schedule')),
        'color': group.get('color') or existing.get('color') or '',
        'status': group.get('status') or existing.get('status') or 'planned',
    }
    previous_cohort_id = clean_str(existing.get('cohort_id'))
    row = persist_group_authoring_detail(group_payload, [], safe_authoring_module_rows(), {'source_type': 'module_authoring', 'source_id': group_id})
    if not row:
        raise ValueError(f'Could not save group "{name}".')
    if previous_cohort_id and previous_cohort_id != cohort['cohortId']:
        previous_cohort = fetch_cohort_row(previous_cohort_id) or {}
        update_cohort_fields(previous_cohort_id, {'group_ids': json_array_remove(previous_cohort.get('group_ids'), group_id)})
    update_cohort_fields(cohort['cohortId'], {'group_ids': json_array_add(cohort_row.get('group_ids'), group_id)})
    sync_group_staff_profile_links(group_id, coach_name=group_payload['coach'], tutor_name=group_payload['tutor'], module_assignment_ids=[])
    return curriculum_group_from_authoring_detail(serialize_group_authoring_detail(row))


def save_tree_group_modules(group, cohort, modules, preserve_missing=False):
    saved_catalogue_ids = set()
    saved_modules = []
    for module in modules or []:
        module_name = clean_str(module.get('moduleName') or module.get('name') or module.get('title'))
        if not module_name:
            raise ValueError('Module name is required for each attachment.')
        requested_catalogue_id = clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId'))
        if requested_catalogue_id and not is_canonical_module_catalogue_id(requested_catalogue_id):
            requested_catalogue_id = ''
        catalogue_id = contentful_catalogue_id_for_attachment(module, group, cohort, module_name, requested_catalogue_id) or unique_module_catalogue_id(requested_catalogue_id or module_name)
        current_structure = get_authoring_structure_payload(catalogue_id) if authoring_module_exists(catalogue_id) else None
        start_date = module.get('startDate') or group.get('startDate') or cohort.get('startDate')
        # `weeks` is overloaded in the attachment payload: the wizard's catalogue
        # shape sends it as an integer session count, while older tree payloads
        # sent it as a list of authored weeks. Only accept the list form as a
        # structure, otherwise an integer silently becomes the week structure and
        # every authored week (and its components) is dropped on save.
        attachment_weeks = attachment_week_structure(module, current_structure)
        session_count = attachment_session_count(module, attachment_weeks)
        session_plan = build_module_session_plan(start_date, session_count, module.get('weekDays') or group.get('schedule'), module.get('holidays') or module.get('linkedHolidays') or [])
        end_date = session_plan.get('finalEndDate') or module.get('endDate') or group.get('endDate') or cohort.get('endDate')
        structure_payload = module_attachment_authoring_payload(
            {
                **module,
                'weekStructure': attachment_weeks,
                'moduleKsbMappings': module.get('moduleKsbMappings') or module.get('ksbMappings') or (current_structure or {}).get('moduleKsbMappings') or [],
            },
            group,
            cohort,
            catalogue_id,
            module_name,
            session_count,
            start_date,
            end_date,
            current_structure,
        )
        structure_payload['weekStructure'] = attachment_weeks
        structure_payload['moduleKsbMappings'] = module.get('moduleKsbMappings') or module.get('ksbMappings') or (current_structure or {}).get('moduleKsbMappings') or []
        if module.get('completionCriteria'):
            structure_payload['completionCriteria'] = module.get('completionCriteria')
        if module.get('advancedDetails'):
            structure_payload['advancedDetails'] = module.get('advancedDetails')
        saved = save_module_authoring_structure(catalogue_id, structure_payload)
        saved_catalogue_ids.add(catalogue_id)
        saved_modules.append(saved)
    removed = [] if preserve_missing else unassign_authoring_modules_from_group(group.get('id'), saved_catalogue_ids)
    group_module_rows = [
        row for row in safe_authoring_module_rows()
        if clean_str(row.get('group_id')) == clean_str(group.get('id'))
    ]
    update_group_fields(group.get('id'), {
        'module_ids': json_db_value(unique([clean_str(row.get('module_catalogue_id')) for row in group_module_rows if row.get('module_catalogue_id')])),
        'module_names': json_db_value(unique([clean_str(row.get('title')) for row in group_module_rows if row.get('title')])),
    })
    for row in group_module_rows:
        sync_module_tutor_profile_links(
            clean_str(row.get('tutor_name')),
            module_assignment_ids(row),
        )
    return saved_modules, removed


def clean_tree_remove_ids(payload, *keys):
    ids = []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            ids.extend(parse_notes_id_list(value))
        elif isinstance(value, (list, tuple, set)):
            ids.extend(value)
    return unique([clean_str(item) for item in ids if clean_str(item)])


@csrf_exempt
def curriculum_programme_tree_save(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        with transaction.atomic():
            programme = upsert_programme_for_tree(payload.get('programme') or payload)
            programme_id = clean_str(programme.get('sourceId') or programme.get('id') or payload.get('programmeId'))
            programme_name = clean_str(programme.get('name') or (payload.get('programme') or {}).get('name'))
            saved_cohorts = []
            saved_groups = []
            saved_modules = []
            saved_cohort_ids = set()
            saved_group_ids = set()
            removed_module_ids = []
            removed_group_ids = []
            removed_cohort_ids = []
            partial_tree = bool_payload(payload.get('partialTree'))
            remove_missing = bool_payload(payload.get('removeMissing')) and bool_payload(payload.get('hydrationComplete'))
            for cohort_payload in payload.get('cohorts') or []:
                cohort = save_tree_cohort(cohort_payload, programme_id, programme_name, preserve_missing_groups=partial_tree)
                saved_cohorts.append(cohort)
                saved_cohort_ids.add(cohort['id'])
                cohort_row = fetch_cohort_row(cohort['id'])
                for group_payload in cohort_payload.get('groups') or []:
                    group = save_tree_group(group_payload, cohort_row)
                    saved_groups.append(group)
                    saved_group_ids.add(group['id'])
                    if not partial_tree or 'modules' in group_payload:
                        modules, removed = save_tree_group_modules(
                            group,
                            cohort,
                            group_payload.get('modules') or [],
                            preserve_missing=partial_tree and bool_payload(group_payload.get('modulesPartial')),
                        )
                        saved_modules.extend(modules)
                        removed_module_ids.extend(removed)

            explicit_module_ids = clean_tree_remove_ids(payload, 'removeModuleIds', 'removedModuleIds', 'deleteModuleIds', 'deletedModuleIds')
            explicit_group_ids = clean_tree_remove_ids(payload, 'removeGroupIds', 'removedGroupIds', 'deleteGroupIds', 'deletedGroupIds')
            explicit_cohort_ids = clean_tree_remove_ids(payload, 'removeCohortIds', 'removedCohortIds', 'deleteCohortIds', 'deletedCohortIds')

            for module_id in explicit_module_ids:
                module_row = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])
                if not module_row or clean_str((module_row[0] or {}).get('programme_id')) != programme_id:
                    continue
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id], {
                    'cohort_id': None,
                    'cohort_name': '',
                    'group_id': None,
                    'group_name': '',
                })
                removed_module_ids.append(module_id)

            for group_id in explicit_group_ids:
                if group_id in saved_group_ids:
                    continue
                group_row = fetch_group_row(group_id) or {}
                if clean_str(group_row.get('programme_id')) != programme_id:
                    continue
                removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
                authoring_delete(GROUPS_TABLE, 'group_id = %s', [group_id])
                removed_group_ids.append(group_id)

            for cohort_id in explicit_cohort_ids:
                if cohort_id in saved_cohort_ids:
                    continue
                cohort_row = fetch_cohort_row(cohort_id) or {}
                if clean_str(cohort_row.get('programme_id')) != programme_id:
                    continue
                for group_row in authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id]):
                    group_id = clean_str(group_row.get('group_id'))
                    if group_id and group_id not in saved_group_ids:
                        removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
                        authoring_delete(GROUPS_TABLE, 'group_id = %s', [group_id])
                        removed_group_ids.append(group_id)
                authoring_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])
                removed_cohort_ids.append(cohort_id)

            if remove_missing:
                for group_row in authoring_fetch_all(GROUPS_TABLE, 'programme_id = %s', [programme_id]):
                    group_id = clean_str(group_row.get('group_id'))
                    if group_id and group_id not in saved_group_ids:
                        removed_module_ids.extend(unassign_authoring_modules_from_group(group_id))
                        authoring_delete(GROUPS_TABLE, 'group_id = %s', [group_id])
                        removed_group_ids.append(group_id)
                for cohort_row in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, 'programme_id = %s', [programme_id]):
                    cohort_id = clean_str(cohort_row.get('cohort_id'))
                    if cohort_id and cohort_id not in saved_cohort_ids:
                        authoring_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])
                        removed_cohort_ids.append(cohort_id)

            repair_curriculum_parent_links(programme_id)
            invalidate_curriculum_cache()
    except ModuleAuthoringValidationError as exc:
        return json_error(str(exc), status=400, validationErrors=exc.errors)
    except ValueError as exc:
        return json_error(str(exc), status=400)
    except Exception as exc:
        logger.exception('Programme tree save failed.')
        return json_error('Unable to save programme tree.', status=500, detail=str(exc))

    return JsonResponse({
        'saved': True,
        'programme': programme,
        'cohorts': saved_cohorts,
        'groups': saved_groups,
        'modules': saved_modules,
        'removedModuleIds': unique(removed_module_ids),
        'removedGroupIds': unique(removed_group_ids),
        'removedCohortIds': unique(removed_cohort_ids),
        'removedMissing': remove_missing,
    })


@csrf_exempt
def curriculum_programme_cohort_collection(request, programme_id):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        programme = find_programme(payload, programme_id)
        if not programme:
            return json_error('Programme not found.', status=404)
        results = [
            cohort for cohort in payload['cohorts']
            if matches_curriculum_identifier(cohort.get('programmeId'), programme.get('id'))
            or matches_curriculum_identifier(cohort.get('programme'), programme.get('name'))
        ]
        return curriculum_collection_response(payload, 'cohorts', results)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    body = json_body(request)
    if body is None:
        return json_error('Invalid JSON body.')
    programme = find_programme(build_curriculum_payload('all'), programme_id)
    if not programme:
        return json_error('Programme not found.', status=404)
    body['programme'] = programme.get('name') or programme_id
    return create_curriculum_cohort(body)


@require_GET
def curriculum_modules(request):
    visibility = curriculum_visibility(request)
    payload = cached_curriculum_value(f'overview:{visibility}:compact', lambda: build_curriculum_payload(visibility, compact=True))
    modules = cached_curriculum_value(
        f'modules:{visibility}:enriched',
        lambda: enrich_modules_with_authoring(payload['modules']),
    )
    # Opt-in slim response: weekStructure is ~94% of this payload, and callers that
    # only need module identity/metadata (pickers, dropdowns, counts) can skip it.
    # Absent the flag the response is unchanged, so existing consumers are unaffected.
    if clean_str(request.GET.get('compact')).lower() in {'1', 'true', 'yes'}:
        modules = [
            {key: value for key, value in module.items() if key != 'weekStructure'}
            for module in modules
        ]
    return curriculum_collection_response(payload, 'modules', modules)


@csrf_exempt
def curriculum_module_collection(request):
    if request.method == 'GET':
        return curriculum_modules(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    module_type = clean_str(payload.get('moduleType') or payload.get('module_type') or payload.get('sourceType') or payload.get('source_type')).lower()
    has_authoring_shape = bool(payload.get('weekStructure') is not None or payload.get('completionCriteria') is not None or payload.get('advancedDetails') is not None)
    is_authoring_request = module_type in {'authoring', 'module_builder', 'builder'} or (payload.get('title') and (not payload.get('name') or has_authoring_shape))
    if is_authoring_request:
        requested_catalogue_id = first_clean_payload_value(payload, 'catalogueId', 'moduleCatalogueId', 'module_catalogue_id')
        module_catalogue_id = find_existing_authoring_catalogue_id_for_payload(payload) or unique_module_catalogue_id(requested_catalogue_id)
        module_payload = {
            'catalogueId': module_catalogue_id,
            'programmeId': payload.get('programmeId') or payload.get('programme') or payload.get('programmeName'),
            'programmeName': payload.get('programmeName') or payload.get('programme') or 'Unassigned programme',
            'title': payload.get('title') or payload.get('name'),
            'description': payload.get('description') or '',
            'color': payload.get('color') or '',
            'status': payload.get('status') or 'draft',
            'sessionsNumber': payload.get('sessionsNumber') or payload.get('sessions_number') or 0,
            'startDate': payload.get('startDate') or payload.get('start_date') or '',
            'endDate': payload.get('endDate') or payload.get('end_date') or '',
            'tutor': payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or '',
            'coach': payload.get('coach') or payload.get('coachName') or payload.get('coach_name') or '',
            'cohortId': payload.get('cohortId') or payload.get('cohort_id') or '',
            'cohortName': payload.get('cohortName') or payload.get('cohort') or payload.get('cohort_name') or '',
            'groupId': payload.get('groupId') or payload.get('group_id') or '',
            'groupName': payload.get('groupName') or payload.get('group') or payload.get('group_name') or '',
            'declaredTotalOtjh': payload.get('totalOtjh') or 0,
            'moduleKsbMappings': payload.get('moduleKsbMappings') or [],
            'completionCriteria': payload.get('completionCriteria') or default_completion_payload(),
            'advancedDetails': payload.get('advancedDetails') or {},
            'background': payload.get('background') or '',
            'epaRequirements': payload.get('epaRequirements') or [],
            'qualificationOutcomes': payload.get('qualificationOutcomes') or [],
            'weekStructure': payload.get('weekStructure') or [],
            'ksbProfileSourceId': payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or '',
        }
        try:
            result = save_module_authoring_structure(module_catalogue_id, module_payload)
        except ModuleAuthoringValidationError as exc:
            return json_error('Module authoring validation failed.', status=400, validationErrors=exc.errors)
        return JsonResponse({'created': True, 'moduleCatalogueId': result.get('catalogueId') or module_catalogue_id, 'module': result}, status=201)

    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    name = clean_str(payload.get('name'))
    programme_values = [
        payload.get('programmeId'),
        payload.get('programme_id'),
        payload.get('programmeName'),
        payload.get('programme'),
    ]
    cohort_values = [
        payload.get('cohortId'),
        payload.get('cohort_id'),
        payload.get('cohortName'),
        payload.get('cohort'),
    ]
    group_values = [
        payload.get('groupId'),
        payload.get('group_id'),
        payload.get('groupName'),
        payload.get('group'),
    ]
    duplicate = next((
        row for row in safe_authoring_module_rows()
        if normalise(row.get('title')) == normalise(name)
        and identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values)
        and identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values)
        and identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values)
    ), None)
    if duplicate:
        return json_error('Module already exists.', status=409)

    module_catalogue_id = unique_module_catalogue_id(payload.get('moduleCatalogueId') or payload.get('catalogueId') or name)
    result = save_module_authoring_structure(module_catalogue_id, {
        'catalogueId': module_catalogue_id,
        'programmeId': payload.get('programmeId') or payload.get('programme_id') or payload.get('programme') or payload.get('programmeName'),
        'programmeName': payload.get('programmeName') or payload.get('programme') or 'Unassigned programme',
        'cohortId': payload.get('cohortId') or payload.get('cohort_id') or '',
        'cohortName': payload.get('cohortName') or payload.get('cohort') or payload.get('cohort_name') or '',
        'groupId': payload.get('groupId') or payload.get('group_id') or '',
        'groupName': payload.get('groupName') or payload.get('group') or payload.get('group_name') or '',
        'title': name,
        'description': payload.get('notes') or payload.get('description') or '',
        'color': payload.get('color') or '',
        'status': payload.get('status') or 'draft',
        'sessionsNumber': payload.get('weeks') or payload.get('sessionsNumber') or 1,
        'startDate': payload.get('startDate') or payload.get('start_date') or '',
        'endDate': payload.get('endDate') or payload.get('end_date') or '',
        'tutor': payload.get('tutor') or payload.get('tutorName') or payload.get('tutor_name') or '',
        'coach': payload.get('coach') or payload.get('coachName') or payload.get('coach_name') or '',
        'weekStructure': payload.get('weekStructure') or [],
        'moduleKsbMappings': payload.get('ksbMappings') or payload.get('moduleKsbMappings') or [],
        'completionCriteria': payload.get('completionCriteria') or default_completion_payload(),
        'advancedDetails': payload.get('advancedDetails') or {},
        'sourceType': payload.get('sourceType') or 'authoring',
        'ksbProfileSourceId': payload.get('ksbProfileSourceId') or payload.get('ksb_profile_source_id') or '',
    })
    return JsonResponse({'created': True, 'moduleCatalogueId': result.get('catalogueId') or module_catalogue_id, 'module': result}, status=201)


@csrf_exempt
def curriculum_module_structure_resolve(request):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    requested_modules = payload.get('modules') or payload.get('identifiers') or []
    if not isinstance(requested_modules, list):
        return json_error('modules must be a list.')

    requested_values = []
    for item in requested_modules:
        if isinstance(item, dict):
            item_identifiers = item.get('identifiers') if isinstance(item.get('identifiers'), list) else []
            requested_values.extend([
                item.get('identifier'),
                item.get('catalogueId'),
                item.get('moduleCatalogueId'),
                item.get('moduleId'),
                item.get('structureId'),
                item.get('sourceId'),
                *item_identifiers,
            ])
        else:
            requested_values.append(item)
    requested_values = unique([clean_str(value) for value in requested_values if clean_str(value)])
    if not requested_values:
        return JsonResponse({'results': []})

    requested_title_keys = unique([normalise(value) for value in requested_values if normalise(value)])
    module_rows = []
    if connection.vendor == 'postgresql':
        clauses = []
        params = []
        placeholders = ', '.join(['%s'] * len(requested_values))
        clauses.append(f'module_catalogue_id in ({placeholders})')
        params.extend(requested_values)
        clauses.append(f'source_id in ({placeholders})')
        params.extend(requested_values)
        if requested_title_keys:
            title_placeholders = ', '.join(['%s'] * len(requested_title_keys))
            clauses.append(f"btrim(lower(regexp_replace(coalesce(title, ''), '\\s+', ' ', 'g'))) in ({title_placeholders})")
            params.extend(requested_title_keys)
        module_rows = authoring_fetch_all(
            AUTHORING_MODULES_TABLE,
            f'({" or ".join(clauses)})',
            params,
            'updated_at desc, title',
        )
    else:
        requested_set = set(requested_values)
        title_set = set(requested_title_keys)
        module_rows = [
            row for row in authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, title')
            if clean_str(row.get('module_catalogue_id')) in requested_set
            or clean_str(row.get('source_id')) in requested_set
            or normalise(row.get('title')) in title_set
        ]
    modules_by_id = {clean_str(row.get('module_catalogue_id')): row for row in module_rows}
    exact_summary_index = {}
    title_summary_index = defaultdict(list)
    for row in module_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        if not catalogue_id:
            continue
        for value in [
            catalogue_id,
            row.get('source_id'),
        ]:
            key = clean_str(value)
            if key:
                exact_summary_index[key] = catalogue_id
        title_key = normalise(row.get('title'))
        if title_key:
            title_summary_index[title_key].append(catalogue_id)

    def display_component_count(module_payload):
        count = 0
        for week in module_payload.get('weekStructure') or []:
            for component in week.get('components') or []:
                description = clean_str(component.get('description'))
                if re.search(r'placeholder lesson derived from the existing (module catalogue|delivery module)', description, re.I):
                    continue
                count += 1
        return count

    requests = []
    candidate_ids_by_request = {}
    for index, item in enumerate(requested_modules):
        if isinstance(item, dict):
            request_id = clean_str(item.get('requestId') or item.get('id') or index)
            item_identifiers = item.get('identifiers') if isinstance(item.get('identifiers'), list) else []
            identifier = clean_str(
                item.get('identifier')
                or item.get('catalogueId')
                or item.get('moduleCatalogueId')
                or item.get('moduleId')
                or item.get('structureId')
                or item.get('sourceId')
            )
            identifiers = [identifier, *[clean_str(value) for value in item_identifiers]]
        else:
            request_id = str(index)
            identifier = clean_str(item)
            identifiers = [identifier]

        candidate_ids = []
        for candidate in unique([value for value in identifiers if clean_str(value)]):
            cleaned_candidate = clean_str(candidate)
            if cleaned_candidate in modules_by_id or CANONICAL_MODULE_ID_PATTERN.match(cleaned_candidate):
                candidate_ids.append(cleaned_candidate)
            summary_id = exact_summary_index.get(cleaned_candidate)
            if summary_id:
                candidate_ids.append(summary_id)
            candidate_ids.extend(title_summary_index.get(normalise(candidate), []))
        requests.append({'requestId': request_id, 'identifier': identifier})
        candidate_ids_by_request[request_id] = unique([candidate_id for candidate_id in candidate_ids if clean_str(candidate_id)])

    structure_ids = unique([
        candidate_id
        for candidate_ids in candidate_ids_by_request.values()
        for candidate_id in candidate_ids
    ])
    # One dict of options drives both the key and the call, so the cached entry can
    # never describe a different shape from the one that was actually built.
    structure_options = {
        'include_staff': False,
        'include_quality': False,
        'include_extra': False,
    }
    structure_payloads = cached_curriculum_value(
        structure_payloads_cache_key(structure_ids, **structure_options),
        lambda: get_authoring_structure_payloads(structure_ids, **structure_options),
    )

    results = []
    for request_item in requests:
        request_id = request_item['requestId']
        identifier = request_item['identifier']
        unique_candidates = {
            candidate_id: structure_payloads.get(candidate_id)
            for candidate_id in candidate_ids_by_request.get(request_id, [])
            if structure_payloads.get(candidate_id)
        }
        module_payload = max(
            unique_candidates.values(),
            key=display_component_count,
            default=None,
        )
        if module_payload:
            component_count = display_component_count(module_payload)
            results.append({
                'requestId': request_id,
                'identifier': identifier,
                'catalogueId': module_payload.get('catalogueId') or '',
                'found': True,
                'componentCount': component_count,
                'hasComponents': component_count > 0,
                'module': module_payload,
            })
        else:
            results.append({
                'requestId': request_id,
                'identifier': identifier,
                'catalogueId': '',
                'found': False,
                'missing': True,
                'componentCount': 0,
                'hasComponents': False,
                'message': 'Module is not available in Module Builder.',
            })

    return JsonResponse({'results': results})


@csrf_exempt
def curriculum_module_structure(request, module_catalogue_id):
    module_catalogue_id = clean_str(module_catalogue_id)
    resolved_catalogue_id = resolve_authoring_catalogue_id(module_catalogue_id) or module_catalogue_id
    if request.method == 'GET':
        try:
            payload = (
                get_authoring_structure_payload(resolved_catalogue_id)
                if resolved_catalogue_id != module_catalogue_id
                else ensure_training_module_authoring_structure(module_catalogue_id)
                if module_catalogue_id.startswith('training-module-')
                else get_authoring_structure_payload(resolved_catalogue_id)
            )
            if payload and module_catalogue_id.startswith('training-module-'):
                link_training_row_to_catalogue(
                    module_catalogue_id.replace('training-module-', '', 1),
                    payload.get('catalogueId') or resolved_catalogue_id,
                )
        except Exception:
            logger.exception('Unable to load module authoring structure for %s.', module_catalogue_id)
            return json_error('Unable to load module authoring structure.', status=500)
        if not payload:
            return json_error('Module authoring structure not found.', status=404)
        return JsonResponse(payload)

    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        if module_catalogue_id.startswith('training-module-'):
            training_id = module_catalogue_id.replace('training-module-', '', 1)
            payload = {
                **payload,
                'sourceType': payload.get('sourceType') or 'training_plan',
                'sourceId': payload.get('sourceId') or training_id,
            }
        result = save_module_authoring_structure(resolved_catalogue_id, payload)
        if module_catalogue_id.startswith('training-module-'):
            link_training_row_to_catalogue(
                module_catalogue_id.replace('training-module-', '', 1),
                result.get('catalogueId') or resolved_catalogue_id,
            )
    except ModuleAuthoringValidationError as exc:
        return json_error('Module authoring validation failed.', status=400, validationErrors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to save module authoring structure for %s.', module_catalogue_id)
        return json_error('Unable to save module authoring structure.', status=500, detail=str(exc))
    return JsonResponse(result)


@csrf_exempt
def curriculum_free_programme_modules(request, programme_id):
    programme_id = clean_str(programme_id)
    if request.method == 'GET':
        try:
            modules = get_free_programme_modules_payload(programme_id)
        except Exception:
            logger.exception('Unable to load free programme modules for %s.', programme_id)
            return json_error('Unable to load free programme modules.', status=500)
        return JsonResponse({'results': modules, 'modules': modules, 'count': len(modules)})

    if request.method not in {'PATCH', 'POST'}:
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    try:
        modules = save_free_programme_modules(programme_id, payload)
    except Exception as exc:
        logger.exception('Unable to save free programme modules for %s.', programme_id)
        return json_error('Unable to save free programme modules.', status=500, detail=str(exc))
    return JsonResponse({'saved': True, 'programmeId': programme_id, 'modules': modules, 'results': modules})


@csrf_exempt
def curriculum_module_settings(request, module_catalogue_id):
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    module_catalogue_id = clean_str(module_catalogue_id)
    existing = get_authoring_structure_payload(module_catalogue_id)
    if not existing:
        existing = {
            'catalogueId': module_catalogue_id,
            'programmeId': payload.get('programmeId') or payload.get('programmeName') or '',
            'programmeName': payload.get('programmeName') or payload.get('programme') or 'Unassigned programme',
            'title': payload.get('title') or payload.get('name') or f'Module {module_catalogue_id}',
            'description': payload.get('description') or '',
            'status': payload.get('status') or 'draft',
            'weekStructure': [],
            'moduleKsbMappings': [],
            'completionCriteria': default_completion_payload(),
            'advancedDetails': {},
            'background': '',
            'epaRequirements': [],
            'qualificationOutcomes': [],
        }
    updates = {
        **existing,
        'programmeId': payload.get('programmeId') or existing.get('programmeId'),
        'programmeName': payload.get('programmeName') or payload.get('programme') or existing.get('programmeName'),
        'title': payload.get('title') or payload.get('name') or existing.get('title'),
        'description': payload.get('description') if 'description' in payload else existing.get('description'),
        'status': payload.get('status') or existing.get('status'),
        'declaredTotalOtjh': payload.get('totalOtjh') if 'totalOtjh' in payload else existing.get('declaredTotalOtjh'),
    }
    try:
        result = save_module_authoring_structure(module_catalogue_id, updates)
    except Exception as exc:
        logger.exception('Unable to update module authoring settings for %s.', module_catalogue_id)
        return json_error('Unable to update module settings.', status=500, detail=str(exc))
    return JsonResponse({'updated': True, 'module': result})


@csrf_exempt
def curriculum_component_collection(request):
    if request.method == 'GET':
        try:
            raw_ids = request.GET.get('module_catalogue_ids') or request.GET.get('moduleCatalogueIds') or ''
            module_catalogue_ids = [clean_str(value) for value in raw_ids.split(',') if clean_str(value)]
            if module_catalogue_ids:
                return curriculum_results_response(component_builder_rows(module_catalogue_ids))
            return curriculum_results_response(cached_curriculum_value('components:builder', component_builder_rows))
        except Exception:
            logger.exception('Unable to load component builder rows.')
            return json_error('Unable to load component builder rows.', status=500)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['title', 'module'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    try:
        component = save_component_builder_payload(payload)
    except ModuleAuthoringValidationError as exc:
        return json_error('Invalid component payload.', status=400, errors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to create component builder component.')
        return json_error('Unable to create component.', status=500, detail=str(exc))
    return JsonResponse({'created': True, 'component': component}, status=201)


@csrf_exempt
def curriculum_component_detail(request, component_id):
    component_id = clean_str(component_id)
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    existing = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not existing:
        return json_error('Component not found.', status=404)

    if request.method == 'DELETE':
        with transaction.atomic():
            authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id])
            authoring_delete(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'id': component_id})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    current = next((item for item in component_builder_rows() if item['id'] == component_id), None)
    merged = {
        **(current or component_builder_response(existing[0])),
        **payload,
        'id': component_id,
    }
    try:
        component = save_component_builder_payload(merged, component_id)
    except ModuleAuthoringValidationError as exc:
        return json_error('Invalid component payload.', status=400, errors=exc.errors)
    except Exception as exc:
        logger.exception('Unable to update component builder component %s.', component_id)
        return json_error('Unable to update component.', status=500, detail=str(exc))
    return JsonResponse({'updated': True, 'component': component})


@csrf_exempt
def curriculum_component_upload(request, component_id):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    component_id = clean_str(component_id)
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return json_error('No file was uploaded.', status=400)

    component_type = frontend_component_type(request.POST.get('componentType') or request.POST.get('type'))
    if component_type not in COMPONENT_UPLOAD_EXTENSIONS:
        return json_error('Uploads are only supported for podcast, PowerPoint and assignment components.', status=400)

    module_catalogue_id = clean_str(request.POST.get('moduleCatalogueId') or request.POST.get('moduleId') or 'module')
    metadata, error = component_upload_metadata(module_catalogue_id, component_id, component_type, uploaded_file)
    if error:
        return json_error(error, status=400)

    saved_to_component = update_component_upload_settings(component_id, component_type, metadata)
    return JsonResponse({
        'uploaded': True,
        'savedToComponent': saved_to_component,
        'componentId': component_id,
        'moduleCatalogueId': module_catalogue_id,
        'file': metadata,
    }, status=201)


@csrf_exempt
def curriculum_week_component_upload(request, component_id):
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    component_id = clean_str(component_id)
    uploaded_file = request.FILES.get('file')
    if not uploaded_file:
        return json_error('No file was uploaded.', status=400)

    component_type = frontend_component_type(request.POST.get('componentType') or request.POST.get('type')) or 'reading'
    if component_type not in COMPONENT_UPLOAD_EXTENSIONS:
        return json_error('Uploads are only supported for reading components.', status=400)

    # Week template components live in their own table (not the module builder's
    # `components` table), and are saved wholesale on the next Save rather than
    # patched row-by-row — so this just stores the file and hands back its
    # metadata; the frontend writes it into the component's own settings and
    # persists it the normal way.
    metadata, error = component_upload_metadata('week-template', component_id, component_type, uploaded_file)
    if error:
        return json_error(error, status=400)

    return JsonResponse({'uploaded': True, 'componentId': component_id, 'file': metadata}, status=201)


@require_GET
def curriculum_uploaded_file(request, path):
    relative_path = f'{COMPONENT_UPLOAD_ROOT}/{path}'
    try:
        absolute_path = Path(default_storage.path(relative_path)).resolve()
        media_root = Path(settings.MEDIA_ROOT).resolve()
        if not str(absolute_path).startswith(str(media_root)):
            raise Http404('File not found.')
        if not absolute_path.exists() or not absolute_path.is_file():
            raise Http404('File not found.')
        return FileResponse(absolute_path.open('rb'), as_attachment=False, filename=absolute_path.name)
    except NotImplementedError:
        if not default_storage.exists(relative_path):
            raise Http404('File not found.')
        return FileResponse(default_storage.open(relative_path, 'rb'), as_attachment=False, filename=Path(relative_path).name)


def authoring_scope_data(scope='', identifier=''):
    ensure_module_authoring_tables()
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
    ident = clean_str(identifier)
    if scope == 'module':
        resolved = resolve_authoring_catalogue_id(ident) or ident
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) == resolved]
    elif scope == 'programme':
        configs_by_id = program_config_by_id(get_program_config_rows())
        programme_training_rows = [
            row for row in get_training_rows()
            if training_row_matches_programme_identifier(row, ident, configs_by_id)
        ]
        training_ids = {clean_str(row.get('id')) for row in programme_training_rows if clean_str(row.get('id'))}
        linked_module_ids = {
            training_row_module_catalogue_id(row)
            for row in programme_training_rows
            if training_row_module_catalogue_id(row)
        }
        unlinked_training_rows = [
            row for row in programme_training_rows
            if not training_row_module_catalogue_id(row)
        ]
        delivery_signatures = {
            signature for signature in (
                training_row_delivery_signature(row, configs_by_id)
                for row in unlinked_training_rows
            )
            if signature
        }
        exact_identifier = programme_identifier_looks_exact(ident)
        if linked_module_ids:
            # Explicit canonical links are authoritative. The source/signature paths
            # below are temporary compatibility for legacy delivery rows that have
            # not yet been backfilled with module_catalogue_id.
            programme_id_candidates = {ident}
            programme_name_candidates = set()
            for row in programme_training_rows:
                identity = programme_identity(row, configs_by_id)
                if clean_str(identity.get('sourceId')):
                    programme_id_candidates.add(clean_str(identity.get('sourceId')))
                if clean_str(identity.get('name')):
                    programme_name_candidates.add(clean_str(identity.get('name')))
            linked_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) in linked_module_ids
            ]
            legacy_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) not in linked_module_ids
                and (
                    (
                        clean_str(row.get('source_type')) == 'training_plan'
                        and clean_str(row.get('source_id')) in {
                            clean_str(item.get('id')) for item in unlinked_training_rows if clean_str(item.get('id'))
                        }
                    )
                    or authoring_row_delivery_signature(row) in delivery_signatures
                )
            ]
            standalone_authoring_rows = [
                row for row in module_rows
                if clean_str(row.get('module_catalogue_id')) not in linked_module_ids
                and not (
                    clean_str(row.get('source_type')) == 'training_plan'
                    and clean_str(row.get('source_id')) in training_ids
                )
                and (
                    any(matches_curriculum_identifier(row.get('programme_id'), candidate) for candidate in programme_id_candidates)
                    or any(normalise(row.get('programme_name')) == normalise(name) for name in programme_name_candidates)
                    or (not exact_identifier and matches_curriculum_identifier(row.get('programme_name'), ident))
                )
            ]
            module_rows = [*linked_rows, *legacy_rows, *standalone_authoring_rows]
        else:
            # Temporary compatibility for older rows. Remove after all delivery rows
            # have a canonical training_plan.module_catalogue_id link.
            module_rows = [
                row for row in module_rows
                if matches_curriculum_identifier(row.get('programme_id'), ident)
                or (not exact_identifier and matches_curriculum_identifier(row.get('programme_name'), ident))
                or (
                    clean_str(row.get('source_type')) == 'training_plan'
                    and clean_str(row.get('source_id')) in training_ids
                )
                or authoring_row_delivery_signature(row) in delivery_signatures
            ]
    elif scope == 'cohort':
        module_rows = [
            row for row in module_rows
            if matches_curriculum_identifier(row.get('cohort_id'), ident)
            or matches_curriculum_identifier(row.get('cohort_name'), ident)
        ]

    module_ids = [clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))]
    if not module_ids:
        return [], [], [], []

    placeholders = ', '.join(['%s'] * len(module_ids))
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, f'module_catalogue_id in ({placeholders})', module_ids)
    component_rows = active_component_rows(authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, f'module_catalogue_id in ({placeholders})', module_ids))
    mapping_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, f'module_catalogue_id in ({placeholders})', module_ids)

    if scope in {'programme', 'cohort'}:
        module_rows = dedupe_authoring_module_rows(module_rows, mapping_rows, component_rows, week_rows)
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))}
        week_rows = [row for row in week_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        component_rows = [row for row in component_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('module_catalogue_id')) in module_ids]

    if scope == 'week':
        week_rows = [row for row in week_rows if clean_str(row.get('id')) == ident]
        week_ids = {clean_str(row.get('id')) for row in week_rows}
        component_rows = [row for row in component_rows if clean_str(row.get('week_id')) in week_ids]
        component_ids = {clean_str(row.get('id')) for row in component_rows}
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('week_id')) in week_ids or clean_str(row.get('component_id')) in component_ids]
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in week_rows}
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
    elif scope == 'component':
        component_rows = [row for row in component_rows if clean_str(row.get('id')) == ident]
        component_ids = {clean_str(row.get('id')) for row in component_rows}
        week_ids = {clean_str(row.get('week_id')) for row in component_rows}
        module_ids = {clean_str(row.get('module_catalogue_id')) for row in component_rows}
        week_rows = [row for row in week_rows if clean_str(row.get('id')) in week_ids]
        module_rows = [row for row in module_rows if clean_str(row.get('module_catalogue_id')) in module_ids]
        mapping_rows = [row for row in mapping_rows if clean_str(row.get('component_id')) in component_ids]

    return module_rows, week_rows, component_rows, mapping_rows


def infer_source_from_scope(module_rows):
    explicit = next((
        (row.get('source_type'), row.get('source_id'))
        for row in module_rows
        if row.get('source_type') in {'standard', 'framework', 'profile'} and row.get('source_id')
    ), None)
    if explicit:
        return split_ksb_source(*explicit)
    programme_name = clean_str((module_rows[0] if module_rows else {}).get('programme_name'))
    if not programme_name:
        return '', ''
    profile = get_ksb_profile_for_program(programme_name, get_ksb_profile_rows())
    if profile:
        return 'framework', f'ksb-{profile.get("id")}'
    standard = next((item for item in build_skills_england_standards() if normalise(item.get('name')) == normalise(programme_name)), None)
    if standard:
        return 'standard', standard.get('id')
    return '', ''


def required_ksbs_for_request(request, module_rows, scope=''):
    source_type, source_id = split_ksb_source(
        request.GET.get('source_type') or request.GET.get('sourceType') or '',
        request.GET.get('source_id') or request.GET.get('sourceId') or '',
    )
    if source_type and not source_id:
        return required_ksbs_for_source(source_type, source_id)
    if not source_type and not source_id and not scope:
        return all_profile_required_ksbs()
    if not source_type or not source_id:
        source_type, source_id = infer_source_from_scope(module_rows)
    if not source_type or not source_id:
        return all_profile_required_ksbs()
    return required_ksbs_for_source(source_type, source_id)


def coverage_response(request, scope='', identifier=''):
    module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data(scope, identifier)
    if identifier and scope in {'module', 'week', 'component', 'programme', 'cohort'} and not module_rows:
        return json_error(f'{scope.title()} not found.', status=404)
    actual_mappings_only = truthy(request.GET.get('actual_mappings') or request.GET.get('actualMappings'))
    if not actual_mappings_only:
        mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    required_ksbs = [] if actual_mappings_only else required_ksbs_for_request(request, module_rows, scope)
    coverage = build_coverage(
        required_ksbs,
        mapping_rows,
        module_rows,
        week_rows,
        component_rows,
        include_mapping_only=actual_mappings_only or not bool(required_ksbs),
    )
    if not actual_mappings_only:
        coverage = annotate_coverage_sources(coverage)
    return JsonResponse({
        'scope': scope or 'all',
        'identifier': identifier,
        **coverage,
    })


def learner_schema_table_exists(table):
    if connection.vendor != 'postgresql':
        return False
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select 1
                from information_schema.tables
                where table_schema = 'Learner' and table_name = %s
                limit 1
                ''',
                [table],
            )
            return bool(cursor.fetchone())
    except Exception:
        return False


def learner_schema_columns(table):
    if connection.vendor != 'postgresql':
        return set()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select column_name
                from information_schema.columns
                where table_schema = 'Learner' and table_name = %s
                ''',
                [table],
            )
            return {row[0] for row in cursor.fetchall()}
    except Exception:
        return set()


def programme_identity_candidates(programme_id):
    candidates = unique([programme_id])
    configs = get_program_config_rows()
    config = next((row for row in configs if clean_str(row.get('program_id')) == clean_str(programme_id)), None)
    if config:
        candidates.extend(unique([config.get('name'), config.get('sub'), config.get('standard')]))
    module_rows = authoring_scope_data('programme', programme_id)[0]
    candidates.extend(unique(row.get('programme_name') for row in module_rows))
    return [value for value in unique(candidates) if value]


def assigned_learners_for_programme(programme_id, lifecycle_status=''):
    if connection.vendor != 'postgresql' or not learner_schema_table_exists('learners'):
        canonical_rows = []
    else:
        canonical_rows = []
        candidates = programme_identity_candidates(programme_id)
        if not candidates:
            return []
        candidate_keys = [normalise(value) for value in candidates if normalise(value)]
        if not candidate_keys:
            return []
        try:
            with connection.cursor() as cursor:
                status_filter = clean_str(lifecycle_status).lower()
                status_sql = "and lower(lifecycle_status) = %s" if status_filter else ''
                params = [candidate_keys]
                if status_filter:
                    params.append(status_filter)
                cursor.execute(
                    f'''
                    select id, full_name, email, programme, programme_status, cohort,
                           group_name, lifecycle_status, coach_name, coach_email,
                           completed_hours, planned_hours, target_hours, progress_hours,
                           progress_variance, otjh_status
                    from "Learner"."learners"
                    where regexp_replace(
                        lower(btrim(coalesce(programme, ''))),
                        '[^a-z0-9]+',
                        '',
                        'g'
                    ) = any(%s)
                      {status_sql}
                    order by lower(full_name), id
                    ''',
                    params,
                )
                canonical_rows = rows_as_dicts(cursor)
        except Exception as exc:
            logger.warning('Could not load assigned learners for programme %s: %s', programme_id, exc)
            canonical_rows = []
    candidates = programme_identity_candidates(programme_id)
    if not candidates:
        return []
    candidate_keys = [normalise(value) for value in candidates if normalise(value)]
    if not candidate_keys:
        return []
    learners = [
        {
            'id': row.get('id'),
            'sourceId': row.get('id'),
            'sourceKind': 'learner',
            'name': row.get('full_name') or '',
            'email': row.get('email') or '',
            'programme': row.get('programme') or '',
            'programmeStatus': row.get('programme_status') or '',
            'cohort': row.get('cohort') or '',
            'group': row.get('group_name') or '',
            'lifecycleStatus': row.get('lifecycle_status') or '',
            'coachName': row.get('coach_name') or '',
            'coachEmail': row.get('coach_email') or '',
            'completedHours': float_weight(row.get('completed_hours') or 0),
            'plannedHours': float_weight(row.get('planned_hours') or 0),
            'targetHours': float_weight(row.get('target_hours') or 0),
            'progressHours': float_weight(row.get('progress_hours') or 0),
            'progressVariance': row.get('progress_variance'),
            'otjhStatus': row.get('otjh_status') or '',
        }
        for row in canonical_rows
    ]
    return sorted(learners, key=lambda row: (normalise(row.get('name') or row.get('email')), str(row.get('id'))))


def learner_progress_ksb_consumption(learner_ids, programme_ksb_codes):
    if not learner_ids or connection.vendor != 'postgresql':
        return {}, []
    if not learner_schema_table_exists('learner_progress_entries') or not learner_schema_table_exists('learner_progress_ksbs'):
        return {}, []
    code_filter = {coverage_normalise_code(code) for code in programme_ksb_codes if coverage_normalise_code(code)}
    totals = defaultdict(lambda: defaultdict(float))
    rows_out = []
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select p.learner_id, p.id as progress_id, p.kind, p.component_ref,
                       p.component_title, p.component_type, p.quiz_ref,
                       p.module_title, p.week_title, p.submitted_at,
                       p.reported_time, p.feedback,
                       max(c.expected_otjh) as planned_otjh,
                       coalesce(max(nullif(c.title, '')), max(nullif(p.component_title, '')), '') as resolved_component_title,
                       k.ksb_code, coalesce(max(m.weight), 0) as weight
                from "Learner"."learner_progress_entries" p
                join "Learner"."learner_progress_ksbs" k on k.progress_id = p.id
                left join curriculum.ksb_mappings m
                  on m.component_id = p.component_ref
                 and upper(m.ksb_code) = upper(k.ksb_code)
                left join curriculum.components c on c.id = p.component_ref
                where p.learner_id = any(%s)
                group by p.learner_id, p.id, p.kind, p.component_ref,
                         p.component_title, p.component_type, p.quiz_ref,
                         p.module_title, p.week_title, p.submitted_at,
                         p.reported_time, p.feedback, k.ksb_code
                order by p.submitted_at desc nulls last, p.id desc
                ''',
                [learner_ids],
            )
            rows = rows_as_dicts(cursor)
    except Exception as exc:
        logger.warning('Could not load learner progress KSB consumption: %s', exc)
        return {}, []
    seen = set()
    for row in rows:
        code = coverage_normalise_code(row.get('ksb_code'))
        if code_filter and code not in code_filter:
            continue
        component_ref = clean_str(row.get('component_ref'))
        dedupe_key = (row.get('learner_id'), component_ref or row.get('progress_id'), code)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        weight = float_weight(row.get('weight') or 0)
        totals[row.get('learner_id')][code] += float(weight or 0)
        rows_out.append({
            'source': 'progress',
            'learnerId': row.get('learner_id'),
            'progressId': row.get('progress_id'),
            'kind': row.get('kind') or '',
            'componentId': component_ref,
            'componentTitle': row.get('resolved_component_title') or row.get('component_title') or '',
            'componentType': row.get('component_type') or '',
            'quizId': row.get('quiz_ref') or '',
            'module': row.get('module_title') or '',
            'week': row.get('week_title') or '',
            'submittedAt': row.get('submitted_at').isoformat() if row.get('submitted_at') else '',
            'plannedOtjh': otjh_number(row.get('planned_otjh')),
            'plannedOtjhSource': 'curriculum_component' if row.get('planned_otjh') is not None else 'not_returned',
            'reportedTime': row.get('reported_time') or '',
            'reflection': row.get('feedback') or '',
            'code': code,
            'weight': weight,
        })
    return {learner_id: dict(code_totals) for learner_id, code_totals in totals.items()}, rows_out


def parse_ksb_weights(value):
    parsed = parse_json_value(value, {})
    if isinstance(parsed, dict):
        direct = parsed.get('ksbWeights') if isinstance(parsed.get('ksbWeights'), dict) else parsed
        return {
            coverage_normalise_code(code): float_weight(weight)
            for code, weight in direct.items()
            if coverage_normalise_code(code)
            and isinstance(weight, (int, float, str))
            and str(weight).strip() != ''
        }
    if isinstance(parsed, list):
        weights = {}
        for item in parsed:
            if not isinstance(item, dict):
                continue
            code = coverage_normalise_code(item.get('code') or item.get('ksbCode') or item.get('ksb_code'))
            if code:
                weights[code] = float_weight(item.get('weight') or item.get('value') or 0)
        return weights
    return {}


def otjh_number(value):
    if value in (None, ''):
        return None
    parsed = float_weight(value)
    if parsed:
        return parsed
    match = re.search(r'\d+(?:\.\d+)?', str(value))
    return float_weight(match.group(0)) if match else None


def reflection_submission_ksb_consumption(learners, programme_ksb_codes):
    if connection.vendor != 'postgresql' or not learner_schema_table_exists('learning_reflection_submissions'):
        return {}, []
    columns = learner_schema_columns('learning_reflection_submissions')
    if 'ksb_weights' not in columns:
        return {}, []
    learner_ids = [
        str(value)
        for row in learners
        for value in (row.get('id'), row.get('sourceId'))
        if value is not None
    ]
    learner_emails = [clean_str(row.get('email')).lower() for row in learners if clean_str(row.get('email'))]
    id_column = next((column for column in ('learner_id', 'learnerId', 'user_id', 'userId') if column in columns), None)
    email_column = next((column for column in ('learner_email', 'learnerEmail', 'email', 'Email') if column in columns), None)
    if not id_column and not email_column:
        return {}, []
    select_columns = ['ksb_weights']
    for optional in (
        'id', id_column, email_column, 'learner_kind', 'learner_name',
        'programme_name', 'activity_type', 'activity_id', 'activity_title',
        'module_title', 'week_title', 'planned_otjh', 'status',
        'learning_reflection', 'submitted_at', 'date_completed',
        'actual_time_hours', 'quality_score', 'full_submission',
    ):
        if optional and optional in columns and optional not in select_columns:
            select_columns.append(optional)
    where_parts = []
    params = []
    if id_column and learner_ids:
        where_parts.append(f'r.{quote_ident(id_column)}::text = any(%s)')
        params.append(learner_ids)
    if email_column and learner_emails:
        where_parts.append(f'lower(btrim(r.{quote_ident(email_column)}::text)) = any(%s)')
        params.append(learner_emails)
    if not where_parts:
        return {}, []
    code_filter = {coverage_normalise_code(code) for code in programme_ksb_codes if coverage_normalise_code(code)}
    learners_by_id = {}
    for row in learners:
        for value in (row.get('id'), row.get('sourceId')):
            if value is not None:
                learners_by_id[str(value)] = row.get('id')
    learners_by_email = {clean_str(row.get('email')).lower(): row.get('id') for row in learners if clean_str(row.get('email'))}
    order_column = 'submitted_at' if 'submitted_at' in columns else ('id' if 'id' in columns else '')
    order_sql = f' order by r.{quote_ident(order_column)} desc' if order_column else ''
    select_sql = ', '.join(f'r.{quote_ident(column)}' for column in select_columns)
    join_sql = ''
    if 'activity_id' in columns:
        select_sql += ', c.expected_otjh as component_expected_otjh'
        join_sql = f' left join curriculum.components c on c.id = r.{quote_ident("activity_id")}'
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f'''
                select {select_sql}
                from "Learner"."learning_reflection_submissions" r
                {join_sql}
                where {' or '.join(where_parts)}
                {order_sql}
                ''',
                params,
            )
            rows = rows_as_dicts(cursor)
    except Exception as exc:
        logger.warning('Could not load learning reflection KSB consumption: %s', exc)
        return {}, []
    totals = defaultdict(lambda: defaultdict(float))
    rows_out = []
    for row in rows:
        learner_id = None
        if id_column:
            learner_id = learners_by_id.get(str(row.get(id_column)))
        if learner_id is None and email_column:
            learner_id = learners_by_email.get(clean_str(row.get(email_column)).lower())
        if learner_id is None:
            continue
        weights = parse_ksb_weights(row.get('ksb_weights'))
        if code_filter:
            weights = {code: weight for code, weight in weights.items() if code in code_filter}
        reflected_planned_otjh = otjh_number(row.get('planned_otjh'))
        component_planned_otjh = otjh_number(row.get('component_expected_otjh'))
        if reflected_planned_otjh is not None:
            planned_otjh = reflected_planned_otjh
            planned_otjh_source = 'learning_reflection_submissions'
        elif component_planned_otjh is not None:
            planned_otjh = component_planned_otjh
            planned_otjh_source = 'curriculum_component'
        else:
            planned_otjh = None
            planned_otjh_source = 'not_returned'
        for code, weight in weights.items():
            totals[learner_id][code] += float(weight or 0)
            rows_out.append({
                'source': 'learning_reflection_submissions',
                'learnerId': learner_id,
                'submissionId': row.get('id'),
                'learnerKind': row.get('learner_kind') or '',
                'learnerName': row.get('learner_name') or '',
                'programme': row.get('programme_name') or '',
                'activityType': row.get('activity_type') or '',
                'activityId': row.get('activity_id') or '',
                'activityTitle': row.get('activity_title') or '',
                'module': row.get('module_title') or '',
                'week': row.get('week_title') or '',
                'plannedOtjh': planned_otjh,
                'plannedOtjhSource': planned_otjh_source,
                'status': row.get('status') or '',
                'reflection': row.get('learning_reflection') or '',
                'submittedAt': row.get('submitted_at').isoformat() if row.get('submitted_at') else '',
                'dateCompleted': row.get('date_completed').isoformat() if row.get('date_completed') else '',
                'actualTimeHours': otjh_number(row.get('actual_time_hours')),
                'actualTimeHoursSource': 'learning_reflection_submissions' if otjh_number(row.get('actual_time_hours')) is not None else 'not_returned',
                'qualityScore': row.get('quality_score'),
                'code': code,
                'weight': weight,
            })
    return {learner_id: dict(code_totals) for learner_id, code_totals in totals.items()}, rows_out


def merge_ksb_totals(*sources):
    merged = defaultdict(lambda: defaultdict(float))
    for source in sources:
        for learner_id, weights in (source or {}).items():
            for code, weight in (weights or {}).items():
                merged[learner_id][coverage_normalise_code(code)] += float(weight or 0)
    return {learner_id: dict(weights) for learner_id, weights in merged.items()}


def learner_consumption_payload(learners, coverage_items, progress_totals, reflection_totals):
    expected = {
        coverage_normalise_code(item.get('code')): float(item.get('raw_total_weight') or item.get('rawTotalWeight') or 0)
        for item in coverage_items
        if coverage_normalise_code(item.get('code'))
    }
    merged = merge_ksb_totals(progress_totals, reflection_totals)
    output = []
    for learner in learners:
        learner_id = learner.get('id')
        weights = merged.get(learner_id, {})
        consumed_total = sum(float(value or 0) for value in weights.values())
        expected_total = sum(expected.values())
        ksb_rows = []
        for code in sorted(set(expected) | set(weights), key=ksb_sort_key):
            expected_weight = expected.get(code, 0)
            consumed_weight = float(weights.get(code, 0) or 0)
            pct = round((consumed_weight / expected_weight) * 100, 1) if expected_weight else (100 if consumed_weight else 0)
            ksb_rows.append({
                'code': code,
                'expectedWeight': float_weight(expected_weight),
                'consumedWeight': float_weight(consumed_weight),
                'cappedConsumedWeight': float_weight(min(consumed_weight, expected_weight) if expected_weight else consumed_weight),
                'progressPercentage': min(pct, 100),
                'rawProgressPercentage': pct,
                'status': 'complete' if expected_weight and consumed_weight >= expected_weight else ('in_progress' if consumed_weight else 'not_started'),
            })
        output.append({
            'learnerId': learner_id,
            'learnerName': learner.get('name') or '',
            'email': learner.get('email') or '',
            'cohort': learner.get('cohort') or '',
            'group': learner.get('group') or '',
            'consumedWeightTotal': float_weight(consumed_total),
            'expectedWeightTotal': float_weight(expected_total),
            'cappedConsumedWeightTotal': float_weight(sum(row['cappedConsumedWeight'] for row in ksb_rows)),
            'progressPercentage': round((sum(row['cappedConsumedWeight'] for row in ksb_rows) / expected_total) * 100, 1) if expected_total else 0,
            'ksbs': ksb_rows,
        })
    return output


def apply_reflection_otjh_to_learners(learners, reflection_rows):
    by_learner = defaultdict(lambda: {'actual': 0.0, 'planned': 0.0, 'seen': set()})
    for row in reflection_rows or []:
        learner_id = row.get('learnerId')
        if learner_id in (None, ''):
            continue
        submission_key = row.get('submissionId') or (
            row.get('learnerId'),
            row.get('activityId'),
            row.get('submittedAt'),
            row.get('dateCompleted'),
        )
        bucket = by_learner[learner_id]
        if submission_key in bucket['seen']:
            continue
        bucket['seen'].add(submission_key)
        if row.get('actualTimeHours') is not None:
            bucket['actual'] += float(row.get('actualTimeHours') or 0)
        if row.get('plannedOtjh') is not None:
            bucket['planned'] += float(row.get('plannedOtjh') or 0)
    for learner in learners:
        bucket = by_learner.get(learner.get('id'))
        if not bucket:
            continue
        if bucket['actual'] or not learner.get('completedHours'):
            learner['completedHours'] = float_weight(bucket['actual'])
        if bucket['planned'] or not learner.get('plannedHours'):
            learner['plannedHours'] = float_weight(bucket['planned'])
    return learners


@require_GET
def curriculum_programme_learner_ksb_impact(request, programme_id):
    module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data('programme', programme_id)
    if not module_rows:
        return json_error('Programme not found.', status=404)
    mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    required_ksbs = required_ksbs_for_request(request, module_rows, 'programme')
    coverage = annotate_coverage_sources(build_coverage(
        required_ksbs,
        mapping_rows,
        module_rows,
        week_rows,
        component_rows,
        include_mapping_only=not bool(required_ksbs),
    ))
    learner_status = clean_str(request.GET.get('learnerStatus') or request.GET.get('status'))
    learners = assigned_learners_for_programme(
        programme_id,
        '' if learner_status.lower() in {'', 'all'} else learner_status,
    )
    learner_ids = [
        int(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id'))
        for row in learners
        if str(row.get('sourceId') if row.get('sourceKind') == 'learner' else row.get('id')).isdigit()
    ]
    programme_codes = [item.get('code') for item in coverage.get('items', [])]
    progress_totals, progress_rows = learner_progress_ksb_consumption(learner_ids, programme_codes)
    reflection_totals, reflection_rows = reflection_submission_ksb_consumption(learners, programme_codes)
    learners = apply_reflection_otjh_to_learners(learners, reflection_rows)
    learner_consumption = learner_consumption_payload(
        learners,
        coverage.get('items', []),
        progress_totals,
        reflection_totals,
    )
    return JsonResponse({
        'scope': 'programme',
        'identifier': programme_id,
        'assignedLearnerCount': len(learners),
        'assignedLearners': learners,
        'programmeCoverage': coverage,
        'learnerKsbConsumption': learner_consumption,
        'consumptionSources': {
            'progress': progress_rows,
            'learningReflectionSubmissions': reflection_rows,
        },
    })


@csrf_exempt
def curriculum_component_ksb_mappings(request, component_id):
    component_id = clean_str(component_id)
    components = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if not components:
        return json_error('Component not found.', status=404)
    component = components[0]
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [component.get('module_catalogue_id')])
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'id = %s', [component.get('week_id')])
    if request.method == 'GET':
        rows = mappings_with_inferred_sources(authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], 'created_at, id'), module_rows)
        coverage = build_coverage([], rows, module_rows, week_rows, components)
        mappings = [mapping for item in coverage['items'] for mapping in item['mappings']]
        return JsonResponse({'componentId': component_id, 'count': len(mappings), 'results': mappings})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    mappings = payload.get('mappings') if isinstance(payload.get('mappings'), list) else [payload]
    mappings = [
        {
            **mapping,
            'sourceType': (
                mapping.get('sourceType') or
                mapping.get('source_type') or
                infer_mapping_source_from_module(module_rows[0] if module_rows else {}, mapping.get('code') or mapping.get('ksbCode'))[0]
            ),
            'sourceId': (
                mapping.get('sourceId') or
                mapping.get('source_id') or
                infer_mapping_source_from_module(module_rows[0] if module_rows else {}, mapping.get('code') or mapping.get('ksbCode'))[1]
            ),
        } if isinstance(mapping, dict) else mapping
        for mapping in mappings
    ]
    errors = []
    errors.extend(validate_mapping_duplicates(mappings, 'mappings'))
    source_cache = {}
    identities = []
    for index, mapping in enumerate(mappings):
        if not isinstance(mapping, dict):
            errors.append({'path': f'mappings.{index}', 'message': 'KSB mapping must be an object.'})
            continue
        errors.extend(validate_ksb_mapping_payload(mapping, f'mappings.{index}', source_cache))
        identities.append((index, component_mapping_identity(component_id, mapping)))
    duplicate_rows = duplicate_mapping_query(component_id, [identity for _, identity in identities])
    duplicate_keys = {
        (
            clean_str(row.get('component_id')),
            coverage_normalise_code(row.get('ksb_code')),
            clean_str(row.get('source_type')),
            clean_str(row.get('source_id')),
        )
        for row in duplicate_rows
    }
    for index, identity in identities:
        if identity in duplicate_keys:
            errors.append({'path': f'mappings.{index}.code', 'message': 'This KSB is already mapped to this component.'})
    if errors:
        return json_error('KSB mapping validation failed.', status=400, validationErrors=errors)
    try:
        with transaction.atomic():
            for mapping in mappings:
                save_authoring_mapping(component.get('module_catalogue_id'), mapping, week_id=component.get('week_id'), component_id=component_id)
    except (IntegrityError, ValueError):
        return json_error('This KSB is already mapped to this component.', status=409)
    invalidate_curriculum_cache()
    rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], 'created_at, id')
    rows = mappings_with_inferred_sources(rows, module_rows)
    coverage = build_coverage([], rows, module_rows, week_rows, components)
    results = [mapping for item in coverage['items'] for mapping in item['mappings']]
    return JsonResponse({'created': True, 'componentId': component_id, 'count': len(results), 'results': results}, status=201)


@csrf_exempt
def curriculum_ksb_mapping_detail(request, mapping_id):
    mapping_id = clean_str(mapping_id)
    rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id])
    if not rows:
        return json_error('KSB mapping not found.', status=404)
    existing = rows[0]
    if request.method == 'DELETE':
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'id': mapping_id})
    if request.method != 'PATCH':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    merged = {
        'id': mapping_id,
        'code': payload.get('code') or existing.get('ksb_code'),
        'ksbId': payload.get('ksbId') or existing.get('ksb_id'),
        'description': payload.get('description') if 'description' in payload else existing.get('ksb_description'),
        'sourceType': payload.get('sourceType') if 'sourceType' in payload else existing.get('source_type'),
        'sourceId': payload.get('sourceId') if 'sourceId' in payload else existing.get('source_id'),
        'classification': payload.get('classification') or payload.get('type') or existing.get('classification'),
        'weight': payload.get('weight') if 'weight' in payload else existing.get('weight'),
    }
    if not merged.get('sourceType') or not merged.get('sourceId'):
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [existing.get('module_catalogue_id')])
        source_type, source_id = infer_mapping_source_from_module(module_rows[0] if module_rows else {}, merged.get('code'))
        merged['sourceType'] = merged.get('sourceType') or source_type
        merged['sourceId'] = merged.get('sourceId') or source_id
    errors = validate_ksb_mapping_payload(merged, 'mapping', {})
    if errors:
        return json_error('KSB mapping validation failed.', status=400, validationErrors=errors)
    source_type, source_id = source_payload_from_mapping(merged)
    try:
        if existing.get('component_id'):
            ensure_authoring_mapping_unique(existing.get('component_id'), merged, mapping_id=mapping_id)
        updated = authoring_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], {
            **existing,
            'id': mapping_id,
            'module_catalogue_id': existing.get('module_catalogue_id'),
            'week_id': existing.get('week_id'),
            'component_id': existing.get('component_id'),
            'ksb_id': merged.get('ksbId'),
            'ksb_code': coverage_normalise_code(merged.get('code')),
            'ksb_description': merged.get('description'),
            'source_type': source_type,
            'source_id': source_id,
            'classification': normalise_ksb_classification(merged.get('classification')),
            'weight': normalise_ksb_weight(merged.get('weight')),
            'updated_at': datetime.utcnow(),
        })
    except (IntegrityError, ValueError):
        return json_error('This KSB is already mapped to this component.', status=409)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'mapping': updated})


@require_GET
def curriculum_ksb_coverage(request):
    return coverage_response(request)


@require_GET
def curriculum_week_ksb_coverage(request, week_id):
    return coverage_response(request, 'week', week_id)


@require_GET
def curriculum_module_ksb_coverage(request, module_catalogue_id):
    return coverage_response(request, 'module', module_catalogue_id)


@require_GET
def curriculum_programme_ksb_coverage(request, programme_id):
    return coverage_response(request, 'programme', programme_id)


@require_GET
def curriculum_cohort_ksb_coverage(request, cohort_id):
    return coverage_response(request, 'cohort', cohort_id)


@require_GET
def curriculum_ksb_trace(request, ksb_id):
    response = coverage_response(request)
    if response.status_code != 200:
        return response
    payload = json.loads(response.content)
    ident = coverage_normalise_code(ksb_id)
    item = next((
        row for row in payload.get('items', [])
        if coverage_normalise_code(row.get('code')) == ident
        or coverage_normalise_code(row.get('ksb_id') or row.get('ksbId')) == ident
    ), None)
    if not item:
        return json_error('KSB trace not found.', status=404)
    return JsonResponse(item)


@require_GET
def curriculum_readiness_validation(request):
    response = coverage_response(request, request.GET.get('scope') or '', request.GET.get('identifier') or '')
    if response.status_code != 200:
        return response
    payload = json.loads(response.content)
    issues = []
    for item in payload.get('items', []):
        raw_weight = item.get('raw_total_weight')
        if item.get('status') == 'missing':
            issues.append({'severity': 'warning', 'code': item.get('code'), 'status': 'missing', 'raw_weight': raw_weight, 'rawWeight': raw_weight, 'message': f'{item.get("code")} is missing.'})
        elif item.get('status') == 'partial':
            issues.append({'severity': 'warning', 'code': item.get('code'), 'status': 'partial', 'raw_weight': raw_weight, 'rawWeight': raw_weight, 'message': f'{item.get("code")} is partially covered at {raw_weight}%'})
        elif item.get('status') == 'over_allocated':
            issues.append({'severity': 'warning', 'code': item.get('code'), 'status': 'over_allocated', 'raw_weight': raw_weight, 'rawWeight': raw_weight, 'message': f'{item.get("code")} is over-allocated at {raw_weight}%'})
    return JsonResponse({
        'ready': not issues,
        'canSaveDraft': True,
        'issues': issues,
        'summary': payload.get('summary'),
    })


@csrf_exempt
def curriculum_module_component_detail(request, module_catalogue_id, component_id):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)
    module_catalogue_id = clean_str(module_catalogue_id)
    component_id = clean_str(component_id)
    ensure_module_authoring_tables()
    with transaction.atomic():
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s and component_id = %s', [module_catalogue_id, component_id])
        authoring_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and id = %s', [module_catalogue_id, component_id])
    invalidate_curriculum_cache()
    return JsonResponse({'deleted': True, 'moduleCatalogueId': module_catalogue_id, 'componentId': component_id})


@csrf_exempt
def curriculum_module_week_detail(request, module_catalogue_id, week_id):
    if request.method != 'DELETE':
        return json_error('Method not allowed.', status=405)
    module_catalogue_id = clean_str(module_catalogue_id)
    week_id = clean_str(week_id)
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
    component_ids = [str(row.get('id')) for row in component_rows]
    with transaction.atomic():
        if component_ids:
            placeholders = ', '.join(['%s'] * len(component_ids))
            authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, f'module_catalogue_id = %s and component_id in ({placeholders})', [module_catalogue_id, *component_ids])
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
        authoring_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
        authoring_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s and id = %s', [module_catalogue_id, week_id])
    invalidate_curriculum_cache()
    return JsonResponse({'deleted': True, 'moduleCatalogueId': module_catalogue_id, 'weekId': week_id})


@csrf_exempt
def curriculum_module_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    ident = clean_str(identifier)
    if ident.startswith('training-module-'):
        return json_error('Delivery module rows are not available. Use the module catalogue record instead.', status=404)

    existing_authoring = authoring_module_exists(ident) if not ident.startswith('catalogue-module-') else None
    if existing_authoring:
        if request.method == 'DELETE':
            delete_module_authoring_structure(ident)
            invalidate_curriculum_cache()
            return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        current = get_authoring_structure_payload(ident)
        current_delivery_metadata = current.get('deliveryMetadata') if isinstance(current.get('deliveryMetadata'), dict) else {}
        result = save_module_authoring_structure(ident, {
            **current,
            'catalogueId': ident,
            'programmeId': payload.get('programmeId') or current.get('programmeId'),
            'programmeName': payload.get('programmeName') or payload.get('programme') or current.get('programmeName') or current.get('programme'),
            'title': payload.get('title') or payload.get('name') or current.get('title') or current.get('name'),
            'description': payload.get('description') if 'description' in payload else payload.get('notes') if 'notes' in payload else current.get('description'),
            'color': payload.get('color') or current.get('color') or '',
            'status': payload.get('status') or current.get('status') or 'draft',
            'sessionsNumber': payload.get('sessionsNumber') or payload.get('weeks') or current.get('sessionsNumber') or len(current.get('weekStructure') or []),
            'startDate': payload.get('startDate') or payload.get('start_date') or current.get('startDate') or '',
            'endDate': payload.get('endDate') or payload.get('end_date') or current.get('endDate') or '',
            'tutor': payload.get('tutor') if 'tutor' in payload else current.get('tutor') or '',
            'coach': payload.get('coach') if 'coach' in payload else current.get('coach') or '',
            'cohortId': payload.get('cohortId') or current.get('cohortId') or '',
            'cohortName': payload.get('cohortName') or payload.get('cohort') or current.get('cohort') or '',
            'groupId': payload.get('groupId') or current.get('groupId') or '',
            'groupName': payload.get('groupName') or payload.get('group') or current.get('group') or '',
            'weekDays': payload.get('weekDays') or current.get('weekDays') or current_delivery_metadata.get('weekDays') or '',
            'startTime': payload.get('startTime') or current.get('startTime') or current_delivery_metadata.get('startTime') or '',
            'endTime': payload.get('endTime') or current.get('endTime') or current_delivery_metadata.get('endTime') or '',
            'moduleKsbMappings': payload.get('ksbMappings') if 'ksbMappings' in payload else payload.get('moduleKsbMappings') or current.get('moduleKsbMappings') or [],
            'ksbProfileSourceId': payload.get('ksbProfileSourceId') if 'ksbProfileSourceId' in payload else payload.get('ksb_profile_source_id') if 'ksb_profile_source_id' in payload else current.get('ksbProfileSourceId') or '',
            'completionCriteria': payload.get('completionCriteria') or current.get('completionCriteria') or default_completion_payload(),
            'advancedDetails': payload.get('advancedDetails') or current.get('advancedDetails') or {},
            'weekStructure': payload.get('weekStructure') or current.get('weekStructure') or [],
        })
        return JsonResponse({'updated': True, 'module': result})

    if request.method == 'DELETE' and delete_module_authoring_structure(ident.replace('catalogue-module-', '', 1)):
        return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})
    return json_error('Module not found.', status=404)


@require_GET
def curriculum_ksb_frameworks(request):
    return curriculum_collection_response(get_cached_payload(request, compact=True), 'ksbFrameworks')


@csrf_exempt
def curriculum_ksb_framework_collection(request):
    if request.method == 'GET':
        return curriculum_ksb_frameworks(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    name = clean_str(payload.get('name'))
    duplicate = next((row for row in get_ksb_profile_rows() if normalise(row.get('name')) == normalise(name)), None)
    if duplicate:
        return json_error('KSB framework already exists.', status=409)
    programme_id = canonical_programme_id(payload.get('programmeId') or payload.get('programme_id'), payload.get('programmeName') or payload.get('programme'))
    existing_profile_ids = [row.get('ksb_profile_id') for row in get_ksb_profile_rows()]
    ksb_profile_id = unique_ksb_profile_id(payload.get('ksbProfileId') or payload.get('ksb_profile_id') or programme_id, existing_profile_ids)
    row = insert_row('ksb_profiles', {
        'id': ksb_profile_id,
        'name': name,
        'ksb_profile_id': ksb_profile_id,
        'programme_ids': json.dumps(unique([
            programme_id,
            payload.get('programmeName'),
            payload.get('programme'),
            *payload_context_ids(payload, 'programmeIds', 'programme_ids', ('programmeId', 'programme_id')),
        ])),
        'description': payload.get('description') or '',
        'knowledge_codes': json.dumps(payload.get('knowledgeCodes') or []),
        'skill_codes': json.dumps(payload.get('skillCodes') or []),
        'behaviour_codes': json.dumps(payload.get('behaviourCodes') or []),
        'ksb_items': json.dumps(payload.get('ksbItems') or []),
        'is_active': True,
        'created_by': payload.get('createdBy') or '',
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'framework': row}, status=201)


@csrf_exempt
def curriculum_ksb_framework_detail(request, identifier):
    if request.method not in {'GET', 'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    ensure_ksb_profile_identity_columns()
    ident = clean_str(identifier).replace('ksb-', '', 1)
    rows = fetch_all(
        f'''
        select *
        from {table_name("ksb_profiles")}
        where cast(id as text) = %s or ksb_profile_id = %s
        ''',
        [ident, clean_str(identifier)],
    )
    if not rows:
        rows = [
            row for row in get_ksb_profile_rows()
            if clean_str(identifier) in ksb_profile_context_ids(row, 'programme_ids')
            or ident in ksb_profile_context_ids(row, 'programme_ids')
            or slugify(identifier) in {slugify(value) for value in ksb_profile_context_ids(row, 'programme_ids')}
        ][:1]
    if not rows:
        return json_error('KSB framework not found.', status=404)
    profile_id = clean_str(rows[0].get('id'))
    framework_source_id = ksb_profile_source_id(rows[0])
    if request.method == 'GET':
        payload = get_cached_payload(request)
        framework_id = framework_source_id
        framework = next((item for item in payload.get('ksbFrameworks', []) if item.get('id') == framework_id), None)
        ksb_set = next((item for item in payload.get('ksbSets', []) if item.get('frameworkId') == framework_id), None)
        if not framework:
            return json_error('KSB framework not found.', status=404)
        return JsonResponse({**framework, 'definitions': (ksb_set or {}).get('ksbs', [])})
    if request.method == 'DELETE':
        delete_rows('ksb_profiles', 'id = %s', [profile_id])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    should_sync_programme_links = any(key in payload for key in ('programmeIds', 'programme_ids', 'programmeId', 'programme_id', 'programmeName', 'programme'))
    linked_programme_values = []
    if should_sync_programme_links:
        next_programme_id = canonical_programme_id(
            payload.get('programmeId') or payload.get('programme_id'),
            payload.get('programmeName') or payload.get('programme'),
        )
        next_programme_values = payload_context_ids(payload, 'programmeIds', 'programme_ids', ('programmeId', 'programme_id'))
        affected_programme_values = unique([
            next_programme_id,
            payload.get('programmeName'),
            payload.get('programme'),
            *next_programme_values,
        ])
        unlink_programmes_from_other_ksb_profiles(profile_id, affected_programme_values)
        linked_programme_values = unique([
            next_programme_id,
            payload.get('programmeName'),
            payload.get('programme'),
            *next_programme_values,
        ])
    updates = {
        'name': payload.get('name'),
        'ksb_profile_id': unique_ksb_profile_id(payload.get('ksbProfileId') or payload.get('ksb_profile_id'), [row.get('ksb_profile_id') for row in get_ksb_profile_rows() if clean_str(row.get('id')) != profile_id]) if any(key in payload for key in ('ksbProfileId', 'ksb_profile_id')) else None,
        'programme_ids': json.dumps(unique([
            canonical_programme_id(payload.get('programmeId') or payload.get('programme_id'), payload.get('programmeName') or payload.get('programme')),
            payload.get('programmeName'),
            payload.get('programme'),
            *payload_context_ids(payload, 'programmeIds', 'programme_ids', ('programmeId', 'programme_id')),
        ])) if any(key in payload for key in ('programmeIds', 'programme_ids', 'programmeId', 'programme_id', 'programmeName', 'programme')) else None,
        'description': payload.get('description'),
        'knowledge_codes': json.dumps(payload.get('knowledgeCodes')) if 'knowledgeCodes' in payload else None,
        'skill_codes': json.dumps(payload.get('skillCodes')) if 'skillCodes' in payload else None,
        'behaviour_codes': json.dumps(payload.get('behaviourCodes')) if 'behaviourCodes' in payload else None,
        'ksb_items': json.dumps(payload.get('ksbItems')) if 'ksbItems' in payload else None,
        'is_active': payload.get('isActive'),
        'updated_at': datetime.utcnow(),
    }
    if updates.get('ksb_profile_id'):
        updates['id'] = updates['ksb_profile_id']
    update_rows('ksb_profiles', 'id = %s', [profile_id], updates)
    if should_sync_programme_links and linked_programme_values:
        cascade_ksb_profile_source_to_programme_modules(linked_programme_values, framework_source_id)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


@require_GET
def curriculum_ksb_sets(request):
    return curriculum_collection_response(get_cached_payload(request, compact=True), 'ksbSets')


@require_GET
def curriculum_cohorts(request):
    payload = get_cached_payload(request)
    programme_id = request.GET.get('programme_id') or request.GET.get('programmeId') or request.GET.get('programme')
    results = payload['cohorts']
    if programme_id:
        expected = {
            clean_str(programme_id),
            slugify(programme_id),
            f'program-{slugify(programme_id)}',
        }
        results = [
            cohort for cohort in results
            if expected.intersection({
                clean_str(cohort.get('programmeId')),
                clean_str(cohort.get('programme')),
                slugify(cohort.get('programme')),
            })
        ]
    return curriculum_collection_response(payload, 'cohorts', results)


def curriculum_cohort_from_authoring_detail(detail):
    detail = detail or {}
    return {
        'id': detail.get('cohortId') or detail.get('id') or detail.get('cohort_id'),
        'name': detail.get('cohortName') or detail.get('name') or detail.get('cohort_name') or '',
        'programmeId': detail.get('programmeId') or detail.get('programme_id') or '',
        'programme': detail.get('programmeName') or detail.get('programme') or detail.get('programme_name') or '',
        'startDate': detail.get('startDate') or detail.get('start_date') or '',
        'endDate': detail.get('endDate') or detail.get('end_date') or '',
        'durationMonths': detail.get('durationMonths') or detail.get('duration_months') or 0,
        'color': detail.get('color') or '',
        'holidayIds': detail.get('holidayIds') or detail.get('holiday_ids') or [],
        'status': detail.get('status') or 'planned',
    }


def curriculum_group_from_authoring_detail(detail):
    detail = detail or {}
    return {
        'id': detail.get('id') or detail.get('groupId') or detail.get('group_id'),
        'name': detail.get('name') or detail.get('groupName') or detail.get('group_name') or '',
        'cohortId': detail.get('cohortId') or detail.get('cohort_id') or '',
        'cohort': detail.get('cohort') or detail.get('cohortName') or detail.get('cohort_name') or '',
        'programmeId': detail.get('programmeId') or detail.get('programme_id') or '',
        'programme': detail.get('programme') or detail.get('programmeName') or detail.get('programme_name') or '',
        'coach': detail.get('coach') or detail.get('coach_name') or '',
        'tutor': detail.get('tutor') or detail.get('tutor_name') or '',
        'startDate': detail.get('startDate') or detail.get('start_date') or '',
        'endDate': detail.get('endDate') or detail.get('end_date') or '',
        'schedule': detail.get('schedule') or '',
        'color': detail.get('color') or '',
        'mode': detail.get('mode') or 'Live',
        'status': detail.get('status') or 'planned',
        'modules': detail.get('modules') or detail.get('module_names') or [],
        'moduleIds': detail.get('moduleIds') or detail.get('module_ids') or [],
    }


def find_authoring_cohort(identifier):
    ident = clean_str(identifier)
    for detail in cohort_authoring_detail_rows():
        cohort = curriculum_cohort_from_authoring_detail(detail)
        if matches_curriculum_identifier(cohort.get('id'), ident) or matches_curriculum_identifier(cohort.get('name'), ident):
            return cohort
    return None


def find_authoring_group(identifier):
    ident = clean_str(identifier)
    for detail in group_authoring_detail_rows():
        group = curriculum_group_from_authoring_detail(detail)
        if matches_curriculum_identifier(group.get('id'), ident) or matches_curriculum_identifier(group.get('name'), ident):
            return group
    return None


def update_authoring_delivery_metadata(cohort=None, group=None):
    cohort = cohort or {}
    group = group or {}
    cohort_id = clean_str(cohort.get('id') or cohort.get('cohortId'))
    group_id = clean_str(group.get('id') or group.get('groupId'))

    try:
        if cohort_id:
            for stored_group in authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id]):
                authoring_upsert(GROUPS_TABLE, ['group_id'], {
                    **stored_group,
                    'cohort_name': cohort.get('name') or stored_group.get('cohort_name') or '',
                    'programme_id': cohort.get('programmeId') or stored_group.get('programme_id') or '',
                    'programme_name': cohort.get('programme') or stored_group.get('programme_name') or '',
                })
            for module in authoring_fetch_all(AUTHORING_MODULES_TABLE, 'cohort_id = %s', [cohort_id]):
                authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                    **module,
                    'cohort_name': cohort.get('name') or module.get('cohort_name') or '',
                    'programme_id': cohort.get('programmeId') or module.get('programme_id') or '',
                    'programme_name': cohort.get('programme') or module.get('programme_name') or '',
                })

        if group_id:
            for module in authoring_fetch_all(AUTHORING_MODULES_TABLE, 'group_id = %s', [group_id]):
                authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
                    **module,
                    'group_name': group.get('name') or module.get('group_name') or '',
                    'cohort_id': group.get('cohortId') or module.get('cohort_id') or '',
                    'cohort_name': group.get('cohort') or module.get('cohort_name') or '',
                    'programme_id': group.get('programmeId') or module.get('programme_id') or '',
                    'programme_name': group.get('programme') or module.get('programme_name') or '',
                })
    except (Exception, AssertionError) as exc:
        logger.warning('Could not update authoring delivery metadata: %s', exc)


def create_curriculum_cohort(payload):
    """Create a cohort directly in ``curriculum.cohorts`` (normalized only)."""
    missing = require_fields(payload, ['name', 'programme'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    programme = clean_str(payload.get('programme'))
    programme_id = canonical_programme_id(
        payload.get('programmeId') or payload.get('programme_id') or payload.get('programId') or payload.get('program_id'),
        programme,
    )
    name = clean_str(payload.get('name'))
    cohort_id = unique_cohort_id(payload.get('id') or payload.get('cohortId') or payload.get('cohort_id'))
    duration_months = payload.get('durationMonths') or 24
    end_date = payload.get('endDate') or format_date(calculate_cohort_end_date(payload.get('startDate'), duration_months))
    holiday_ids = parse_notes_id_list(payload.get('holidayIds') or payload.get('holiday_ids'))

    # A cohort with the same canonical id, or the same name within the same
    # programme, is treated as the same cohort. Rather than failing the save,
    # update it in place and report created=False — mirroring the idempotent
    # programme create handler. This keeps wizard re-saves and retries safe:
    # a POST that repeats an already-persisted cohort (e.g. because the freshly
    # minted id was not written back into the client draft) updates the stored
    # row instead of forking a duplicate or dying with a user-facing 409.
    duplicate = next((
        detail for detail in cohort_authoring_detail_rows()
        if (
            clean_str(detail.get('cohortId')) == clean_str(cohort_id)
            or (
                normalise(detail.get('programmeId') or detail.get('programmeName')) in {normalise(programme_id), normalise(programme)}
                and normalise(detail.get('cohortName')) == normalise(name)
            )
        )
    ), None)
    if duplicate:
        existing_id = clean_str(duplicate.get('cohortId')) or cohort_id
        updates = {
            'cohort_name': name,
            'programme_id': programme_id or None,
            'programme_name': programme or None,
            'start_date': payload.get('startDate') or None,
            'end_date': end_date or None,
            'duration_months': parse_int(duration_months, duplicate.get('durationMonths') or 0),
            'color': payload.get('color') or None,
            'status': title_case_status(
                normalise(duplicate.get('status')) == 'archived',
                payload.get('startDate'),
                end_date,
            ),
        }
        if 'holidayIds' in payload or 'holiday_ids' in payload:
            updates['holiday_ids'] = json_db_value(holiday_ids)
        update_cohort_fields(existing_id, updates)
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'cohort': curriculum_cohort_from_authoring_detail({
            'cohortId': existing_id,
            'cohortName': name,
            'programmeId': programme_id,
            'programmeName': programme,
            'startDate': payload.get('startDate'),
            'endDate': end_date,
            'durationMonths': duration_months,
            'color': payload.get('color') or '',
            'holidayIds': holiday_ids,
            'status': updates['status'],
        })})

    cohort = {
        'id': cohort_id,
        'name': name,
        'programme': programme,
        'programmeId': programme_id,
        'startDate': payload.get('startDate'),
        'endDate': end_date,
        'status': title_case_status(False, payload.get('startDate'), end_date),
        'color': payload.get('color') or '',
        'holidayIds': holiday_ids,
        'groups': [],
        'modules': [],
    }
    persist_cohort_authoring_detail(
        cohort,
        [],
        [],
        payload.get('holidays') or payload.get('holidayDetails') or payload.get('linkedHolidays') or get_holiday_rows(),
        {'source_type': 'module_authoring', 'source_id': cohort_id},
    )
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'cohort': curriculum_cohort_from_authoring_detail({
        'cohortId': cohort_id,
        'cohortName': name,
        'programmeId': programme_id,
        'programmeName': programme,
        'startDate': payload.get('startDate'),
        'endDate': end_date,
        'durationMonths': duration_months,
        'color': payload.get('color') or '',
        'holidayIds': holiday_ids,
        'status': cohort['status'],
    })}, status=201)


@csrf_exempt
def curriculum_cohort_collection(request):
    if request.method == 'GET':
        return curriculum_cohorts(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    return create_curriculum_cohort(payload)


@csrf_exempt
def curriculum_cohort_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    # Look the cohort up by its stored canonical id in curriculum.cohorts. This
    # row is the only source of truth; updates target it in place so the
    # canonical cohort_id and every unrelated column are preserved.
    cohort_row = resolve_cohort_row(identifier)
    if not cohort_row:
        return json_error('Cohort not found.', status=404)
    cohort_id = clean_str(cohort_row.get('cohort_id'))

    if request.method == 'DELETE':
        for stored_group in authoring_fetch_all(GROUPS_TABLE, 'cohort_id = %s', [cohort_id]):
            stored_group_id = clean_str(stored_group.get('group_id'))
            if not stored_group_id:
                continue
            unassign_authoring_modules_from_group(stored_group_id)
            authoring_delete(GROUPS_TABLE, 'group_id = %s', [stored_group_id])
        authoring_delete(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': True, 'id': cohort_id})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    duration_months = payload.get('durationMonths')
    start_date = payload.get('startDate') if 'startDate' in payload else format_date(cohort_row.get('start_date'))
    computed_end = (
        format_date(calculate_cohort_end_date(start_date, duration_months))
        if duration_months else ''
    )
    end_date = payload.get('endDate') or computed_end or format_date(cohort_row.get('end_date'))

    # Build a targeted update: only columns explicitly present in the payload
    # (or derived from them) are written. programme_id / group_ids / source_type
    # are never rebuilt from name-derived data.
    updates = {}
    if 'name' in payload and clean_str(payload.get('name')):
        updates['cohort_name'] = clean_str(payload.get('name'))
    if 'startDate' in payload:
        updates['start_date'] = payload.get('startDate') or None
    if end_date:
        updates['end_date'] = end_date or None
    if duration_months is not None:
        updates['duration_months'] = parse_int(duration_months, cohort_row.get('duration_months') or 0)
    if 'color' in payload and clean_str(payload.get('color')):
        updates['color'] = payload.get('color')
    if 'holidayIds' in payload or 'holiday_ids' in payload:
        updates['holiday_ids'] = json_db_value(parse_notes_id_list(
            payload.get('holidayIds') if 'holidayIds' in payload else payload.get('holiday_ids')
        ))
    # Programme reassignment is only honoured when an explicit canonical id or a
    # resolvable programme name is supplied; otherwise the stored parent stands.
    explicit_programme_id = clean_str(payload.get('programmeId') or payload.get('programme_id'))
    if explicit_programme_id or clean_str(payload.get('programme')):
        resolved = canonical_programme_id(explicit_programme_id, clean_str(payload.get('programme')))
        if resolved:
            updates['programme_id'] = resolved
            if clean_str(payload.get('programme')):
                updates['programme_name'] = clean_str(payload.get('programme'))
    updates['status'] = title_case_status(
        clean_str(cohort_row.get('status')) == 'archived',
        start_date,
        end_date,
    )

    update_cohort_fields(cohort_id, updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': cohort_id})


@require_GET
def curriculum_groups(request):
    payload = get_cached_payload(request)
    cohort_id = request.GET.get('cohort_id') or request.GET.get('cohortId') or request.GET.get('cohort')
    results = payload['groups']
    if cohort_id:
        results = [
            group for group in results
            if matches_curriculum_identifier(group.get('cohortId'), cohort_id)
            or matches_curriculum_identifier(group.get('cohort'), cohort_id)
        ]
    return curriculum_collection_response(payload, 'groups', results)


def create_curriculum_group(payload):
    """Create a group directly in ``curriculum.groups`` (normalized only).

    The parent cohort is resolved from ``curriculum.cohorts`` and the new group
    inherits the cohort's stored canonical programme_id/cohort_id. The cohort's
    ``group_ids`` array is updated to include the new group.
    """
    missing = require_fields(payload, ['name', 'cohortId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    cohort_row = resolve_cohort_row(payload.get('cohortId'))
    if not cohort_row:
        return json_error('Parent cohort not found.', status=404)

    cohort_id = clean_str(cohort_row.get('cohort_id'))
    cohort_name = clean_str(cohort_row.get('cohort_name'))
    programme_id = clean_str(cohort_row.get('programme_id'))
    programme = clean_str(cohort_row.get('programme_name'))
    group_name = clean_str(payload.get('name'))
    group_id = unique_group_id(payload.get('id') or payload.get('groupId') or payload.get('group_id'))
    requested_schedule = build_group_schedule(
        payload.get('weekDays'),
        payload.get('startTime'),
        payload.get('endTime'),
    )

    duplicate = next((
        detail for detail in group_authoring_detail_rows()
        if (
            clean_str(detail.get('id')) == clean_str(group_id)
            or (
                clean_str(detail.get('cohortId')) == cohort_id
                and normalise(detail.get('name')) == normalise(group_name)
            )
        )
    ), None)
    if duplicate:
        existing_id = clean_str(duplicate.get('id')) or group_id
        updates = {
            'group_name': group_name,
            'cohort_id': cohort_id,
            'cohort_name': cohort_name,
            'programme_id': programme_id,
            'programme_name': programme,
            'coach_name': canonical_staff_assignment_name('coach', payload.get('coach')) if 'coach' in payload else clean_str(duplicate.get('coach')),
            'tutor_name': canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else clean_str(duplicate.get('tutor')),
            'start_date': payload.get('startDate') or format_date(cohort_row.get('start_date')),
            'end_date': payload.get('endDate') or format_date(cohort_row.get('end_date')),
            'schedule': requested_schedule if any(key in payload for key in ('weekDays', 'startTime', 'endTime')) else clean_str(duplicate.get('schedule')),
            'color': clean_str(payload.get('color')) if 'color' in payload else clean_str(duplicate.get('color')),
            'status': clean_str(duplicate.get('status')) or 'planned',
        }
        update_group_fields(existing_id, updates)
        update_cohort_fields(cohort_id, {'group_ids': json_array_add(cohort_row.get('group_ids'), existing_id)})
        module_assignment_ids = [
            clean_str(row.get('module_catalogue_id'))
            for row in safe_authoring_module_rows()
            if clean_str(row.get('group_id')) == existing_id and row.get('module_catalogue_id')
        ]
        sync_group_staff_profile_links(
            existing_id,
            coach_name=updates['coach_name'],
            tutor_name=updates['tutor_name'],
            module_assignment_ids=module_assignment_ids,
            previous_coach_name=clean_str(duplicate.get('coach')),
        )
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'group': curriculum_group_from_authoring_detail({
            'id': existing_id,
            'name': group_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'programmeId': programme_id,
            'programme': programme,
            'coach': updates['coach_name'],
            'tutor': updates['tutor_name'],
            'startDate': updates['start_date'],
            'endDate': updates['end_date'],
            'schedule': updates['schedule'],
            'color': updates.get('color') or '',
            'status': updates['status'],
            'modules': parse_notes_id_list(duplicate.get('modules') or duplicate.get('moduleNames')),
        })})

    group = {
        'id': group_id,
        'name': group_name,
        'cohortId': cohort_id,
        'cohort': cohort_name,
        'programmeId': programme_id,
        'programme': programme,
        'coach': canonical_staff_assignment_name('coach', payload.get('coach')),
        'tutor': canonical_staff_assignment_name('tutor', payload.get('tutor')),
        'startDate': payload.get('startDate') or format_date(cohort_row.get('start_date')),
        'endDate': payload.get('endDate') or format_date(cohort_row.get('end_date')),
        'schedule': requested_schedule,
        'color': payload.get('color') or '',
        'status': 'planned',
        'modules': [payload.get('moduleName')] if clean_str(payload.get('moduleName')) else [],
    }
    persist_group_authoring_detail(group, [], safe_authoring_module_rows(), {'source_type': 'module_authoring', 'source_id': group_id})
    # Link the group to its cohort by extending the cohort's group_ids array,
    # without touching any other cohort column.
    update_cohort_fields(cohort_id, {'group_ids': json_array_add(cohort_row.get('group_ids'), group_id)})
    sync_group_staff_profile_links(
        group_id,
        coach_name=group['coach'],
        tutor_name=group['tutor'],
        module_assignment_ids=[],
    )
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'group': curriculum_group_from_authoring_detail({
        'id': group_id,
        'name': group_name,
        'cohortId': cohort_id,
        'cohort': cohort_name,
        'programmeId': programme_id,
        'programme': programme,
        'coach': group['coach'],
        'tutor': group['tutor'],
        'startDate': group['startDate'],
        'endDate': group['endDate'],
        'schedule': group['schedule'],
        'color': group['color'],
        'status': group['status'],
        'modules': group['modules'],
    })}, status=201)


@csrf_exempt
def curriculum_group_collection(request):
    if request.method == 'GET':
        return curriculum_groups(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    return create_curriculum_group(payload)


@csrf_exempt
def curriculum_cohort_group_collection(request, cohort_id):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        results = [
            group for group in payload['groups']
            if matches_curriculum_identifier(group.get('cohortId'), cohort_id)
            or matches_curriculum_identifier(group.get('cohort'), cohort_id)
        ]
        return curriculum_collection_response(payload, 'groups', results)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    payload['cohortId'] = cohort_id
    return create_curriculum_group(payload)


@csrf_exempt
def curriculum_group_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    # Resolve the group by its stored canonical id in curriculum.groups. Updates
    # target this row in place, preserving group_id, cohort_id, programme_id,
    # module relationships, dates, status and any staff assignment not being
    # explicitly changed.
    group_row = resolve_group_row(identifier)
    if not group_row:
        return json_error('Group not found.', status=404)
    group_id = clean_str(group_row.get('group_id'))

    if request.method == 'DELETE':
        cohort_id = clean_str(group_row.get('cohort_id'))
        if cohort_id:
            cohort_row = fetch_cohort_row(cohort_id) or {}
            update_cohort_fields(cohort_id, {'group_ids': json_array_remove(cohort_row.get('group_ids'), group_id)})
        unassign_authoring_modules_from_group(group_id)
        authoring_delete(GROUPS_TABLE, 'group_id = %s', [group_id])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'permanent': True, 'id': group_id})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    previous_coach = clean_str(group_row.get('coach_name'))
    stored_tutor = clean_str(group_row.get('tutor_name'))
    stored_coach = clean_str(group_row.get('coach_name'))

    updates = {}
    if 'name' in payload and clean_str(payload.get('name')):
        updates['group_name'] = clean_str(payload.get('name'))
    if 'tutor' in payload:
        updates['tutor_name'] = canonical_staff_assignment_name('tutor', payload.get('tutor'))
    if 'coach' in payload:
        updates['coach_name'] = canonical_staff_assignment_name('coach', payload.get('coach'))
    if 'startDate' in payload:
        updates['start_date'] = payload.get('startDate') or None
    if 'endDate' in payload:
        updates['end_date'] = payload.get('endDate') or None
    if any(key in payload for key in ('weekDays', 'startTime', 'endTime')):
        updates['schedule'] = build_group_schedule(
            payload.get('weekDays') if 'weekDays' in payload else group_row.get('schedule'),
            payload.get('startTime'),
            payload.get('endTime'),
            group_row.get('schedule'),
        )
    if 'color' in payload:
        updates['color'] = clean_str(payload.get('color'))
    if 'status' in payload and clean_str(payload.get('status')):
        updates['status'] = clean_str(payload.get('status'))
    previous_cohort_id = clean_str(group_row.get('cohort_id'))
    target_cohort = None
    # Parent reassignment only on explicit, resolvable input.
    if clean_str(payload.get('cohortId') or payload.get('cohort_id')):
        target_cohort = resolve_cohort_row(payload.get('cohortId') or payload.get('cohort_id'))
        if target_cohort:
            updates['cohort_id'] = clean_str(target_cohort.get('cohort_id'))
            updates['cohort_name'] = clean_str(target_cohort.get('cohort_name'))
            updates['programme_id'] = clean_str(target_cohort.get('programme_id'))
            updates['programme_name'] = clean_str(target_cohort.get('programme_name'))
    explicit_programme_id = clean_str(payload.get('programmeId') or payload.get('programme_id'))
    if explicit_programme_id and 'programme_id' not in updates:
        resolved = canonical_programme_id(explicit_programme_id, clean_str(payload.get('programme')))
        if resolved:
            updates['programme_id'] = resolved
            if clean_str(payload.get('programme')):
                updates['programme_name'] = clean_str(payload.get('programme'))

    with transaction.atomic():
        updated_group = update_group_fields(group_id, updates) or group_row
        next_cohort_id = clean_str(updated_group.get('cohort_id'))
        if next_cohort_id and next_cohort_id != previous_cohort_id:
            if previous_cohort_id:
                previous_cohort = fetch_cohort_row(previous_cohort_id) or {}
                update_cohort_fields(previous_cohort_id, {'group_ids': json_array_remove(previous_cohort.get('group_ids'), group_id)})
            next_cohort = fetch_cohort_row(next_cohort_id) or {}
            update_cohort_fields(next_cohort_id, {'group_ids': json_array_add(next_cohort.get('group_ids'), group_id)})
            for module in authoring_fetch_all(AUTHORING_MODULES_TABLE, 'group_id = %s', [group_id]):
                update_authoring_rows(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module.get('module_catalogue_id')], {
                    'cohort_id': next_cohort_id,
                    'cohort_name': clean_str(updated_group.get('cohort_name')),
                    'programme_id': clean_str(updated_group.get('programme_id')),
                    'programme_name': clean_str(updated_group.get('programme_name')),
                    'group_name': clean_str(updated_group.get('group_name')),
                })
        repair_curriculum_parent_links(clean_str(updated_group.get('programme_id')))

    if 'coach' in payload or 'tutor' in payload:
        next_group_id = clean_str(updated_group.get('group_id')) or group_id
        module_assignment_ids = [
            clean_str(row.get('module_catalogue_id'))
            for row in safe_authoring_module_rows()
            if clean_str(row.get('group_id')) == next_group_id and row.get('module_catalogue_id')
        ]
        sync_group_staff_profile_links(
            next_group_id,
            coach_name=canonical_staff_assignment_name('coach', payload.get('coach')) if 'coach' in payload else stored_coach,
            tutor_name=canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else stored_tutor,
            module_assignment_ids=module_assignment_ids,
            previous_coach_name=previous_coach,
        )
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': group_id})


def module_attachment_authoring_payload(item, group, cohort, catalogue_id, module_name, session_count, start_date, end_date, current_structure=None, source_type='module_authoring', source_id=''):
    current_structure = current_structure or {}
    schedule = clean_str(item.get('weekDays') or item.get('deliveryDays') or group.get('schedule'))
    explicit_tutor = clean_str(item.get('tutor'))
    explicit_coach = clean_str(item.get('coach'))
    group_tutor = '' if staff_assignment_key(group.get('tutor')) == 'unassigned' else clean_str(group.get('tutor'))
    group_coach = '' if staff_assignment_key(group.get('coach')) == 'unassigned' else clean_str(group.get('coach'))
    return {
        **current_structure,
        'catalogueId': catalogue_id,
        'programmeId': clean_str(item.get('programmeId') or item.get('programme_id') or cohort.get('programmeId') or group.get('programmeId') or ''),
        'programmeName': cohort.get('programme') or group.get('programme') or 'Unassigned programme',
        'cohortId': cohort['id'],
        'cohortName': cohort.get('name') or '',
        'groupId': group['id'],
        'groupName': group.get('name') or '',
        'tutor': explicit_tutor if explicit_tutor and staff_assignment_key(explicit_tutor) != 'unassigned' else group_tutor,
        'coach': explicit_coach if explicit_coach and staff_assignment_key(explicit_coach) != 'unassigned' else group_coach,
        'title': module_name,
        'description': visible_notes(item.get('notes') or current_structure.get('description') or ''),
        'color': item.get('color') or current_structure.get('color') or '',
        'status': item.get('status') or current_structure.get('status') or 'draft',
        'sessionsNumber': session_count,
        'startDate': start_date,
        'endDate': end_date,
        'weekDays': schedule,
        'startTime': item.get('startTime') or '',
        'endTime': item.get('endTime') or '',
        # Prefer a structure the caller authored; fall back to what is stored so a
        # metadata-only reattachment never blanks existing weeks/components.
        'weekStructure': attachment_week_structure(item, current_structure),
        'moduleKsbMappings': item.get('moduleKsbMappings') or item.get('ksbMappings') or current_structure.get('moduleKsbMappings') or [],
        'completionCriteria': current_structure.get('completionCriteria') or default_completion_payload(),
        'advancedDetails': current_structure.get('advancedDetails') or {},
        'background': current_structure.get('background') or '',
        'epaRequirements': current_structure.get('epaRequirements') or [],
        'qualificationOutcomes': current_structure.get('qualificationOutcomes') or [],
        'sourceType': source_type,
        'sourceId': clean_str(source_id or item.get('sourceId') or catalogue_id),
        'ksbProfileSourceId': item.get('ksbProfileSourceId') if 'ksbProfileSourceId' in item else item.get('ksb_profile_source_id') if 'ksb_profile_source_id' in item else current_structure.get('ksbProfileSourceId') or '',
    }


def payload_week_list(value):
    """Return value only when it is a usable list of authored weeks.

    Attachment payloads overload `weeks`: the module catalogue shape carries an
    integer session count, while authored payloads carry a list of week dicts.
    Returning [] for anything that is not a list of dicts keeps an integer from
    being treated as a week structure (which would silently drop every week).
    """
    if not isinstance(value, list):
        return []
    return value if all(isinstance(item, dict) for item in value) else []


def attachment_week_structure(item, current_structure=None):
    """Pick the authored week structure for a module attachment.

    Prefers an explicitly supplied structure, then the legacy `weeks` list form,
    then whatever is already stored. Never invents weeks: a module attached
    without authored content stays an explicit empty structure.
    """
    for candidate in (
        (item or {}).get('weekStructure'),
        (item or {}).get('weeks'),
        (current_structure or {}).get('weekStructure'),
    ):
        weeks = payload_week_list(candidate)
        if weeks:
            return weeks
    return []


def attachment_session_count(item, weeks=None):
    """Resolve the session count for an attachment payload.

    `weeks` may arrive as an integer count or as a list of authored weeks, so the
    count is taken from sessionsNumber first, then an integer `weeks`, then the
    length of the resolved week structure.
    """
    item = item or {}
    explicit = parse_int(item.get('sessionsNumber'), 0)
    if explicit:
        return explicit
    raw_weeks = item.get('weeks')
    if not isinstance(raw_weeks, (list, tuple, dict)):
        counted = parse_int(raw_weeks, 0)
        if counted:
            return counted
    return len(weeks or payload_week_list(raw_weeks))


def module_structure_component_count(structure):
    return sum(len(week.get('components') or []) for week in ((structure or {}).get('weekStructure') or []))


def contentful_catalogue_id_for_attachment(item, group, cohort, module_name, current_catalogue_id=''):
    title_key = normalise(module_name)
    candidate_id = ''
    try:
        component_counts = authoring_component_counts_by_catalogue()
        programme_values = [
            item.get('programmeId'),
            item.get('programme_id'),
            item.get('programme'),
            group.get('programmeId'),
            group.get('programme_id'),
            group.get('programme'),
            cohort.get('programmeId') if cohort else '',
            cohort.get('programme_id') if cohort else '',
            cohort.get('programme') if cohort else '',
        ]
        cohort_values = [
            item.get('cohortId'),
            item.get('cohort_id'),
            item.get('cohort'),
            group.get('cohortId'),
            group.get('cohort_id'),
            cohort.get('id') if cohort else '',
            cohort.get('cohortId') if cohort else '',
            cohort.get('name') if cohort else '',
        ]
        group_values = [
            item.get('groupId'),
            item.get('group_id'),
            item.get('group'),
            group.get('id'),
            group.get('groupId'),
            group.get('name'),
        ]
        candidates = [
            row for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)
            if normalise(row.get('title')) == title_key
            and identity_values_match_context([row.get('programme_id'), row.get('programme_name')], programme_values)
            and identity_values_match_context([row.get('cohort_id'), row.get('cohort_name')], cohort_values)
            and identity_values_match_context([row.get('group_id'), row.get('group_name')], group_values)
        ]
        candidates.sort(
            key=lambda row: (component_counts.get(clean_str(row.get('module_catalogue_id')), 0), row.get('updated_at') or ''),
            reverse=True,
        )
        if candidates:
            candidate_id = clean_str(candidates[0].get('module_catalogue_id'))
    except Exception:
        logger.debug('Unable to resolve contentful catalogue attachment for %s.', module_name, exc_info=True)
    if not candidate_id or candidate_id == current_catalogue_id:
        return current_catalogue_id
    if not current_catalogue_id:
        return candidate_id
    current_structure = get_authoring_structure_payload(current_catalogue_id) if authoring_module_exists(current_catalogue_id) else None
    candidate_structure = get_authoring_structure_payload(candidate_id) if authoring_module_exists(candidate_id) else None
    if module_structure_component_count(candidate_structure) > module_structure_component_count(current_structure):
        return candidate_id
    return current_catalogue_id


@csrf_exempt
def curriculum_group_modules(request, identifier):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        group = next((item for item in payload['groups'] if matches_curriculum_identifier(item.get('id'), identifier)), None)
        if not group:
            return json_error('Group not found.', status=404)
        results = [module for module in payload['modules'] if module_belongs_to_group(module, group)]
        return curriculum_collection_response(payload, 'modules', results)

    if request.method not in {'POST', 'PATCH'}:
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    modules = payload.get('modules') if isinstance(payload.get('modules'), list) else [payload]
    if not isinstance(modules, list):
        return json_error('At least one module is required.', fields=['modules'])

    # Resolve group and parent cohort from the normalized tables only.
    group_row = resolve_group_row(identifier)
    if not group_row:
        return json_error('Group not found.', status=404)
    group = curriculum_group_from_authoring_detail(serialize_group_authoring_detail(group_row))
    cohort_row = resolve_cohort_row(group_row.get('cohort_id'))
    cohort = curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(cohort_row)) if cohort_row else None
    if not cohort:
        return json_error('Parent cohort not found.', status=404)

    # Existing module attachments for this group come from curriculum.modules.
    existing_rows = [row for row in safe_authoring_module_rows() if clean_str(row.get('group_id')) == clean_str(group_row.get('group_id'))]
    existing_names = {normalise(row.get('title')) for row in existing_rows if row.get('title')}
    existing_catalogue_ids = {clean_str(row.get('module_catalogue_id')) for row in existing_rows if row.get('module_catalogue_id')}
    created_rows = []
    skipped = []

    with transaction.atomic():
        created_modules = []
        updated_modules = []
        saved_catalogue_ids = set()
        for item in modules:
            if not isinstance(item, dict):
                return json_error('Each module attachment must be an object.', status=400)
            module_name = clean_str(item.get('moduleName') or item.get('name'))
            if not module_name:
                return json_error('Module name is required for each attachment.', fields=['moduleName'])
            explicit_catalogue_value = clean_str(item.get('moduleCatalogueId'))
            if explicit_catalogue_value and not is_canonical_module_catalogue_id(explicit_catalogue_value):
                return json_error('moduleCatalogueId must be a valid MOD-... canonical module ID.', fields=['moduleCatalogueId'])
            requested_value = clean_str(explicit_catalogue_value or item.get('catalogueId') or item.get('moduleId'))
            requested_catalogue_id = requested_value if is_canonical_module_catalogue_id(requested_value) else ''

            start_date = item.get('startDate') or group.get('startDate') or cohort.get('startDate')
            module_start = parse_date(start_date)
            cohort_start = parse_date(cohort.get('startDate'))
            cohort_end = parse_date(cohort.get('endDate'))
            if module_start and cohort_start and module_start < cohort_start:
                return json_error(
                    f'Module "{module_name}" cannot start before the cohort start date ({format_date(cohort_start)}).',
                    fields=['startDate'],
                    status=400,
                )
            if module_start and cohort_end and module_start > cohort_end:
                return json_error(
                    f'Module "{module_name}" cannot start after the cohort end date ({format_date(cohort_end)}).',
                    fields=['startDate'],
                    status=400,
                )

            delivery_days = item.get('weekDays') or group.get('schedule')
            session_count = attachment_session_count(item)
            session_plan = build_module_session_plan(start_date, session_count, delivery_days, item.get('holidays') or item.get('linkedHolidays') or [])
            end_date = session_plan.get('finalEndDate') or item.get('endDate') or group.get('endDate') or cohort.get('endDate')
            catalogue_id = contentful_catalogue_id_for_attachment(
                item,
                group,
                cohort,
                module_name,
                requested_catalogue_id,
            ) or unique_module_catalogue_id(item.get('catalogueId') or item.get('moduleId') or module_name)
            current_structure = get_authoring_structure_payload(catalogue_id) if authoring_module_exists(catalogue_id) else None
            is_duplicate = (
                bool(requested_catalogue_id and requested_catalogue_id in existing_catalogue_ids)
                or bool(not requested_catalogue_id and normalise(module_name) in existing_names)
            )
            # An attachment that carries authored weeks must persist them here and
            # now; module_attachment_authoring_payload otherwise falls back to the
            # stored structure and the new content would need a manual Save.
            saved = save_module_authoring_structure(catalogue_id, module_attachment_authoring_payload(
                {**item, 'weekStructure': attachment_week_structure(item, current_structure)},
                group,
                cohort,
                catalogue_id,
                module_name,
                session_count,
                start_date,
                end_date,
                current_structure,
            ))
            saved_tutor = clean_str(saved.get('tutor') or saved.get('tutorName') or item.get('tutor') or group.get('tutor') or '')
            saved_coach = clean_str(saved.get('coach') or saved.get('coachName') or item.get('coach') or group.get('coach') or '')
            sync_group_staff_profile_links(
                group['id'],
                coach_name='' if staff_assignment_key(saved_coach) == 'unassigned' else saved_coach,
                tutor_name='' if staff_assignment_key(saved_tutor) == 'unassigned' else saved_tutor,
                module_assignment_ids=clean_assignment_ids([
                    saved.get('id'),
                    saved.get('moduleId'),
                    saved.get('moduleCatalogueId'),
                    saved.get('catalogueId'),
                    saved.get('sourceId'),
                    catalogue_id,
                ]),
            )
            saved_catalogue_ids.add(catalogue_id)
            if is_duplicate:
                skipped.append(module_name)
                updated_modules.append(saved)
            else:
                created_modules.append(saved)
            existing_names.add(normalise(module_name))
            existing_catalogue_ids.add(catalogue_id)

        # PATCH from the structure wizard represents the group's complete
        # module list, so omitted modules should be unassigned. POST is an
        # append-style endpoint used by createGroupModule(); it must not detach
        # existing modules that were not included in the request.
        removed_module_ids = (
            unassign_authoring_modules_from_group(group_row.get('group_id'), saved_catalogue_ids)
            if request.method == 'PATCH'
            else []
        )
        # Refresh only the group's derived module_ids/module_names from
        # curriculum.modules. Coach/tutor/dates/status stay untouched.
        group_module_rows = [
            row for row in safe_authoring_module_rows()
            if clean_str(row.get('group_id')) == clean_str(group_row.get('group_id'))
        ]
        update_group_fields(group_row.get('group_id'), {
            'module_ids': json_db_value(unique([clean_str(row.get('module_catalogue_id')) for row in group_module_rows if row.get('module_catalogue_id')])),
            'module_names': json_db_value(unique([clean_str(row.get('title')) for row in group_module_rows if row.get('title')])),
        })
        repair_curriculum_parent_links(clean_str(group.get('programmeId') or group.get('programme_id')))
        invalidate_curriculum_cache()
        return JsonResponse({
            'updated': True,
            'groupId': identifier,
            'created': created_modules,
            'updatedModules': updated_modules,
            'removedModuleIds': removed_module_ids,
            'skippedDuplicates': skipped,
        })


@require_GET
def curriculum_sessions(request):
    return curriculum_collection_response(get_cached_payload(request), 'sessions')


@csrf_exempt
def curriculum_session_collection(request):
    if request.method == 'GET':
        return curriculum_sessions(request)
    return json_error('Generated sessions are derived from normalized curriculum modules. Create a module/cohort/group allocation first.', status=409)


@csrf_exempt
def curriculum_session_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    module_match = re.match(r'^module-(.+)-session-(\d+)$', clean_str(identifier))
    if module_match:
        module_catalogue_id, week_number = module_match.groups()
        rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        if not rows:
            return json_error('Session not found.', status=404)
        if request.method == 'DELETE':
            return json_error('Individual generated sessions cannot be safely cancelled without updating the parent module allocation.', status=409)
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        current = rows[0]
        updates = {
            **current,
            'session_start_time': payload.get('startTime') if 'startTime' in payload else current.get('session_start_time'),
            'session_end_time': payload.get('endTime') if 'endTime' in payload else current.get('session_end_time'),
            'tutor_name': canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else current.get('tutor_name'),
        }
        if payload.get('date'):
            if int(week_number) != 1:
                return json_error('Only week 1 generated sessions can update start_date directly. Later session dates are calculated from the parent module start date.', status=409)
            updates['start_date'] = payload.get('date')
        authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], updates)
        invalidate_curriculum_cache()
        return JsonResponse({'updated': True, 'id': identifier})

    match = re.match(r'^training-(\d+)-session-(\d+)$', clean_str(identifier))
    if not match:
        return json_error('Session not found.', status=404)
    return json_error('Legacy training-plan sessions are no longer editable in the current curriculum schema.', status=409)


@csrf_exempt
def curriculum_staffing_collection(request):
    if request.method == 'GET':
        payload = get_cached_payload(request)
        assignments = [
            {
                'id': group['id'],
                'groupId': group['id'],
                'group': group['name'],
                'cohort': group['cohort'],
                'programme': group['programme'],
                'tutor': group['tutor'],
                'coach': group['coach'],
                'status': 'unassigned' if group['tutor'] == 'Unassigned' and group['coach'] == 'Unassigned' else 'assigned',
            }
            for group in payload['groups']
        ]
        return JsonResponse({'schema': payload['schema'], 'count': len(assignments), 'results': assignments})
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['groupId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    return update_staffing_assignment(payload.get('groupId'), payload)


@csrf_exempt
def curriculum_staffing_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    payload = {} if request.method == 'DELETE' else json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if request.method == 'DELETE':
        payload = {'tutor': '', 'coach': ''}
    return update_staffing_assignment(identifier, payload)


def update_staffing_assignment(identifier, payload):
    group_row = resolve_group_row(identifier)
    if not group_row:
        return json_error('Group not found for staffing assignment.', status=404)
    group_id = clean_str(group_row.get('group_id'))
    previous_coach = clean_str(group_row.get('coach_name'))

    updates = {}
    if 'tutor' in payload:
        updates['tutor_name'] = canonical_staff_assignment_name('tutor', payload.get('tutor'))
    if 'coach' in payload:
        updates['coach_name'] = canonical_staff_assignment_name('coach', payload.get('coach'))
    update_group_fields(group_id, updates)

    next_tutor = canonical_staff_assignment_name('tutor', payload.get('tutor')) if 'tutor' in payload else clean_str(group_row.get('tutor_name'))
    next_coach = canonical_staff_assignment_name('coach', payload.get('coach')) if 'coach' in payload else clean_str(group_row.get('coach_name'))
    module_assignment_ids = [
        clean_str(row.get('module_catalogue_id'))
        for row in safe_authoring_module_rows()
        if clean_str(row.get('group_id')) == group_id and row.get('module_catalogue_id')
    ]
    sync_group_staff_profile_links(
        group_id,
        coach_name=next_coach,
        tutor_name=next_tutor,
        module_assignment_ids=module_assignment_ids,
        previous_coach_name=previous_coach,
    )
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': group_id})


def staff_profile_payload(role, payload, existing=None):
    existing = existing or {}
    name = clean_str(payload.get('name') if 'name' in payload else existing.get('name'))
    profile = {
        'id': clean_str(existing.get('id') or payload.get('id')) or unique_prefixed_id(role.upper(), payload.get('name')),
        'name': name,
        'email': clean_str(payload.get('email') if 'email' in payload else existing.get('email')),
        'phone': clean_str(payload.get('phone') if 'phone' in payload else existing.get('phone')),
        'job_title': clean_str(
            payload.get('jobTitle') if 'jobTitle' in payload
            else payload.get('job_title') if 'job_title' in payload
            else existing.get('job_title')
        ),
        'notes': clean_str(payload.get('notes') if 'notes' in payload else existing.get('notes')),
        'is_archived': False,
    }
    if role == 'coach':
        assigned_group_ids = staff_payload_list_value(
            payload.get('assignedGroupIds')
            if 'assignedGroupIds' in payload
            else payload.get('assigned_group_ids')
            if 'assigned_group_ids' in payload
            else existing.get('assigned_group_ids')
        )
        profile['assigned_group_ids'] = json_db_value(assigned_group_ids)
    else:
        assigned_module_ids = staff_payload_list_value(
            payload.get('assignedModuleIds')
            if 'assignedModuleIds' in payload
            else payload.get('assigned_module_ids')
            if 'assigned_module_ids' in payload
            else existing.get('assigned_module_ids')
        )
        profile['assigned_module_ids'] = json_db_value(assigned_module_ids)
    return profile


def staff_payload_list_value(value):
    if isinstance(value, list):
        return [clean_str(item) for item in value if clean_str(item)]
    if value is None:
        return []
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith('[') or stripped.startswith('{'):
            parsed = as_json_value(stripped, [])
            return staff_payload_list_value(parsed)
        return [item.strip() for item in re.split(r'[,;]+', stripped) if item.strip()]
    parsed = as_json_value(value, [])
    return staff_payload_list_value(parsed)


def find_staff_profile_row(role, identifier, include_archived=True):
    ident = clean_str(identifier)
    if not ident:
        return None
    rows = get_staff_profile_rows(role, include_archived=include_archived)
    for row in rows:
        if clean_str(row.get('id')) == ident:
            return row
    searchable_rows = [row for row in rows if not staff_profile_is_archived(row)] + [row for row in rows if staff_profile_is_archived(row)]
    email_key = normalise(ident)
    if email_key:
        for row in searchable_rows:
            if normalise(staff_profile_email(row)) == email_key:
                return row
    slug = slugify(ident)
    ident_key = staff_assignment_key(ident)
    for row in searchable_rows:
        name = staff_profile_name(row)
        if slugify(name) == slug or staff_assignment_key(name) == ident_key:
            return row
    return None


def staff_module_training_ids(assignment_ids, modules):
    requested = [clean_str(item) for item in (assignment_ids or []) if clean_str(item)]
    training_ids = set()
    for module in modules or []:
        if any(module_matches_staff_assignment(module, item) for item in requested):
            row_id = clean_str(module.get('deliveryRowId') or module.get('sourceId'))
            if row_id:
                training_ids.add(row_id)
    return training_ids


def clean_assignment_ids(values):
    seen = set()
    result = []
    for value in values or []:
        text = clean_str(value)
        if not text:
            continue
        expanded = [text]
        canonical_match = re.search(r'(MOD-[A-Z0-9][A-Z0-9_-]*)', text, re.IGNORECASE)
        if canonical_match:
            expanded.append(canonical_match.group(1))
        for item in expanded:
            if item in seen:
                continue
            seen.add(item)
            result.append(item)
    return result


def add_staff_profile_assignments(role, staff_name, column, assignment_ids):
    staff_name = clean_str(staff_name)
    if not staff_name or staff_assignment_key(staff_name) == 'unassigned':
        return []
    assignment_ids = clean_assignment_ids(assignment_ids)
    if not assignment_ids:
        return []
    table = staff_profile_table(role)
    if column not in column_names(table):
        return []
    row = find_staff_profile_row(role, staff_name)
    if not row:
        return []
    existing = clean_assignment_ids(as_json_value(row.get(column), []))
    next_values = clean_assignment_ids([*existing, *assignment_ids])
    if next_values == existing:
        return existing
    update_rows(table, 'id = %s', [row.get('id')], {
        column: json_db_value(next_values),
        'updated_at': datetime.utcnow(),
    })
    return next_values


def remove_staff_profile_assignments(role, staff_name, column, assignment_ids):
    staff_name = clean_str(staff_name)
    assignment_ids = set(clean_assignment_ids(assignment_ids))
    if not staff_name or not assignment_ids or staff_assignment_key(staff_name) == 'unassigned':
        return []
    table = staff_profile_table(role)
    if column not in column_names(table):
        return []
    row = find_staff_profile_row(role, staff_name)
    if not row:
        return []
    existing = clean_assignment_ids(as_json_value(row.get(column), []))
    next_values = [item for item in existing if item not in assignment_ids]
    if next_values == existing:
        return existing
    update_rows(table, 'id = %s', [row.get('id')], {
        column: json_db_value(next_values),
        'updated_at': datetime.utcnow(),
    })
    return next_values


def training_row_module_assignment_ids(row, catalogue_id=''):
    row = row or {}
    row_id = clean_str(row.get('id'))
    values = []
    if row_id:
        values.extend([row_id, f'training-module-{row_id}'])
    values.extend([
        catalogue_id,
        row.get(TRAINING_MODULE_CATALOGUE_COLUMN),
        row.get('module_catalogue_id'),
        row.get('moduleId'),
        row.get('module_id'),
    ])
    return clean_assignment_ids(values)


def sync_group_staff_profile_links(group_id, coach_name='', tutor_name='', module_assignment_ids=None, previous_coach_name=''):
    group_id = clean_str(group_id)
    if group_id:
        if previous_coach_name and staff_assignment_key(previous_coach_name) != staff_assignment_key(coach_name):
            remove_staff_profile_assignments('coach', previous_coach_name, 'assigned_group_ids', [group_id])
        add_staff_profile_assignments('coach', coach_name, 'assigned_group_ids', [group_id])
    module_assignment_ids = clean_assignment_ids(module_assignment_ids or [])
    if module_assignment_ids:
        target_key = staff_assignment_key(tutor_name)
        for row in get_tutor_rows():
            row_name = staff_profile_name(row)
            if not target_key or target_key == 'unassigned' or staff_assignment_key(row_name) != target_key:
                remove_staff_profile_assignments('tutor', row_name, 'assigned_module_ids', module_assignment_ids)
    add_staff_profile_assignments('tutor', tutor_name, 'assigned_module_ids', module_assignment_ids)


def sync_module_tutor_profile_links(tutor_name='', module_assignment_ids=None):
    module_assignment_ids = clean_assignment_ids(module_assignment_ids or [])
    if not module_assignment_ids:
        return
    target_key = staff_assignment_key(tutor_name)
    for row in get_tutor_rows():
        row_name = staff_profile_name(row)
        if not target_key or target_key == 'unassigned' or staff_assignment_key(row_name) != target_key:
            remove_staff_profile_assignments('tutor', row_name, 'assigned_module_ids', module_assignment_ids)
    add_staff_profile_assignments('tutor', tutor_name, 'assigned_module_ids', module_assignment_ids)


def rebuild_staff_profile_assignments_from_authoring():
    """Mirror staff assignments from normalized curriculum modules/groups."""
    try:
        ensure_module_authoring_tables()
        ensure_staff_profile_tables()
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
        group_rows = authoring_fetch_all(GROUPS_TABLE)
        valid_group_ids = {clean_str(row.get('group_id')) for row in group_rows if clean_str(row.get('group_id'))}
        tutor_module_ids = defaultdict(list)
        coach_group_ids = defaultdict(list)
        tutor_names = {}
        coach_names = {}
        changed = False

        for module in module_rows:
            module_id = clean_str(module.get('module_catalogue_id'))
            if module_id:
                tutor_key = staff_assignment_key(module.get('tutor_name'))
                if tutor_key and tutor_key != 'unassigned':
                    tutor_names.setdefault(tutor_key, clean_str(module.get('tutor_name')))
                    tutor_module_ids[tutor_key].append(module_id)
            group_id = clean_str(module.get('group_id'))
            coach_key = staff_assignment_key(module.get('coach_name'))
            if coach_key and coach_key != 'unassigned' and group_id and (not valid_group_ids or group_id in valid_group_ids):
                coach_names.setdefault(coach_key, clean_str(module.get('coach_name')))
                coach_group_ids[coach_key].append(group_id)

        for group in group_rows:
            group_id = clean_str(group.get('group_id'))
            coach_key = staff_assignment_key(group.get('coach_name'))
            if coach_key and coach_key != 'unassigned' and group_id:
                coach_names.setdefault(coach_key, clean_str(group.get('coach_name')))
                coach_group_ids[coach_key].append(group_id)

        tutor_table = staff_profile_table('tutor')
        tutor_rows = get_staff_profile_rows('tutor', include_archived=True)
        tutor_by_key = {staff_assignment_key(staff_profile_name(row)): row for row in tutor_rows}
        tutor_ids = [clean_str(row.get('id')) for row in tutor_rows if clean_str(row.get('id'))]
        for key, name in tutor_names.items():
            if key in tutor_by_key:
                continue
            row = insert_row(tutor_table, {
                'id': unique_prefixed_id('TUTOR', name, tutor_ids),
                'name': name,
                'email': '',
                'phone': '',
                'job_title': '',
                'assigned_module_ids': json_db_value([]),
                'notes': '',
                'is_archived': False,
            })
            tutor_ids.append(clean_str(row.get('id')))
            tutor_rows.append(row)
            tutor_by_key[key] = row
            changed = True

        coach_table = staff_profile_table('coach')
        coach_rows = get_staff_profile_rows('coach', include_archived=True)
        coach_by_key = {staff_assignment_key(staff_profile_name(row)): row for row in coach_rows}
        coach_ids = [clean_str(row.get('id')) for row in coach_rows if clean_str(row.get('id'))]
        for key, name in coach_names.items():
            if key in coach_by_key:
                continue
            row = insert_row(coach_table, {
                'id': unique_prefixed_id('COACH', name, coach_ids),
                'name': name,
                'email': '',
                'phone': '',
                'job_title': '',
                'assigned_group_ids': json_db_value([]),
                'notes': '',
                'is_archived': False,
            })
            coach_ids.append(clean_str(row.get('id')))
            coach_rows.append(row)
            coach_by_key[key] = row
            changed = True

        for tutor in tutor_rows:
            key = staff_assignment_key(staff_profile_name(tutor))
            next_ids = clean_assignment_ids(unique(tutor_module_ids.get(key, [])))
            existing = clean_assignment_ids(as_json_value(tutor.get('assigned_module_ids'), []))
            if next_ids != existing:
                update_rows(tutor_table, 'id = %s', [tutor.get('id')], {
                    'assigned_module_ids': json_db_value(next_ids),
                    'updated_at': datetime.utcnow(),
                })
                changed = True

        for coach in coach_rows:
            key = staff_assignment_key(staff_profile_name(coach))
            next_ids = clean_assignment_ids(unique(coach_group_ids.get(key, [])))
            existing = clean_assignment_ids(as_json_value(coach.get('assigned_group_ids'), []))
            if next_ids != existing:
                update_rows(coach_table, 'id = %s', [coach.get('id')], {
                    'assigned_group_ids': json_db_value(next_ids),
                    'updated_at': datetime.utcnow(),
                })
                changed = True
        if changed:
            invalidate_curriculum_cache()
    except (Exception, AssertionError):
        logger.warning('Could not rebuild staff profile assignments from curriculum modules.', exc_info=True)


def sync_staff_profile_module_assignments(role, staff_name, assigned_module_ids=None, previous_name='', clear_missing=False):
    return []


def sync_staff_profile_group_assignments(staff_name, assigned_group_ids=None, previous_name='', clear_missing=False):
    return []


def current_staff_profile_payload(role, identifier):
    row = find_staff_profile_row(role, identifier)
    if not row:
        return None
    payload = build_curriculum_payload('all')
    modules = payload.get('modules') or []
    return serialize_staff_profile(row, role, modules)


@csrf_exempt
def curriculum_staff_profile_collection(request, role):
    if request.method == 'GET':
        visibility = curriculum_visibility(request)
        profiles = cached_curriculum_value(
            f'staff-profiles:{role}:{visibility}:merged',
            lambda: build_staff_profile_collection(role, visibility),
        )
        return curriculum_results_response(profiles)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if not clean_str(payload.get('name')):
        return json_error('Missing required fields.', fields=['name'])

    table = staff_profile_table(role)
    duplicate_rows = staff_profile_rows_by_identity(
        role,
        payload.get('name'),
        payload.get('email'),
        include_archived=True,
    )
    with transaction.atomic():
        duplicate_row, duplicates_changed = normalize_staff_profile_duplicates(role, duplicate_rows)
        if duplicate_row:
            if staff_profile_is_archived(duplicate_row):
                profile_payload = staff_profile_payload(role, payload, duplicate_row)
                restore_updates = {
                    **profile_payload,
                    **restore_payload(table, profile_payload.get('notes')),
                    'updated_at': datetime.utcnow(),
                }
                updated_rows = update_rows(table, 'id = %s', [duplicate_row.get('id')], restore_updates)
                row = updated_rows[0] if updated_rows else duplicate_row
                if role == 'tutor':
                    assignment_ids = as_json_value(profile_payload.get('assigned_module_ids'), [])
                    sync_staff_profile_module_assignments(role, row.get('name'), assignment_ids, clear_missing=False)
                elif role == 'coach':
                    group_assignment_ids = as_json_value(profile_payload.get('assigned_group_ids'), [])
                    sync_staff_profile_group_assignments(row.get('name'), group_assignment_ids, clear_missing=False)
                invalidate_curriculum_cache()
                return JsonResponse({'created': False, 'restored': True, 'profile': current_staff_profile_payload(role, row.get('id'))})
            if duplicates_changed:
                invalidate_curriculum_cache()
            return JsonResponse({'created': False, 'duplicate': True, 'profile': current_staff_profile_payload(role, duplicate_row.get('id'))})

        existing_ids = [row.get('id') for row in get_staff_profile_rows(role, include_archived=True)]
        profile_payload = staff_profile_payload(role, {
            **payload,
            'id': clean_str(payload.get('id')) or unique_prefixed_id(role.upper(), payload.get('name'), existing_ids),
        })
        row = insert_row(table, profile_payload)
        if role == 'tutor':
            assignment_ids = as_json_value(profile_payload.get('assigned_module_ids'), [])
            sync_staff_profile_module_assignments(role, row.get('name'), assignment_ids, clear_missing=False)
        elif role == 'coach':
            group_assignment_ids = as_json_value(profile_payload.get('assigned_group_ids'), [])
            sync_staff_profile_group_assignments(row.get('name'), group_assignment_ids, clear_missing=False)
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'profile': current_staff_profile_payload(role, row.get('id'))}, status=201)


@csrf_exempt
def curriculum_staff_profile_detail(request, role, identifier):
    if request.method not in {'GET', 'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    row = find_staff_profile_row(role, identifier)
    if not row:
        return json_error(f'{role.title()} profile not found.', status=404)
    if request.method == 'GET':
        profile = current_staff_profile_payload(role, row.get('id'))
        return JsonResponse({'schema': CURRICULUM_SCHEMA, 'profile': profile})

    table = staff_profile_table(role)
    if request.method == 'DELETE':
        archived_ids = []
        with transaction.atomic():
            for duplicate in staff_profile_rows_by_identity(
                role,
                staff_profile_name(row),
                staff_profile_email(row),
                include_archived=True,
            ) or [row]:
                if staff_profile_is_archived(duplicate):
                    continue
                update_rows(table, 'id = %s', [duplicate.get('id')], {
                    'status': 'archived',
                    'is_archived': True,
                    'updated_at': datetime.utcnow(),
                })
                archived_ids.append(duplicate.get('id'))
            if role == 'tutor':
                sync_staff_profile_module_assignments(role, staff_profile_name(row), [], previous_name=staff_profile_name(row), clear_missing=True)
            elif role == 'coach':
                sync_staff_profile_group_assignments(staff_profile_name(row), [], previous_name=staff_profile_name(row), clear_missing=True)
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': row.get('id'), 'count': len(archived_ids), 'ids': archived_ids})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if 'name' in payload and not clean_str(payload.get('name')):
        return json_error('Name cannot be blank.', fields=['name'])

    row, duplicates_changed = normalize_staff_profile_duplicates(
        role,
        staff_profile_rows_by_identity(
            role,
            staff_profile_name(row),
            staff_profile_email(row),
            include_archived=True,
        ),
    )
    row = row or find_staff_profile_row(role, identifier, include_archived=True)
    if not row:
        return json_error(f'{role.title()} profile not found.', status=404)
    previous_name = staff_profile_name(row)
    previous_email = staff_profile_email(row)
    requested_name = clean_str(payload.get('name')) if 'name' in payload else previous_name
    requested_email = clean_str(payload.get('email')) if 'email' in payload else previous_email
    if staff_profile_identity_key(requested_name, requested_email) != staff_profile_identity_key(previous_name, previous_email):
        conflicts = staff_profile_rows_by_identity(
            role,
            requested_name,
            requested_email,
            include_archived=True,
            exclude_id=row.get('id'),
        )
        if conflicts:
            if duplicates_changed:
                invalidate_curriculum_cache()
            return json_error(f'{role.title()} profile already exists.', status=409)
    assignment_provided = 'assignedModuleIds' in payload or 'assigned_module_ids' in payload
    group_assignment_provided = 'assignedGroupIds' in payload or 'assigned_group_ids' in payload
    profile_payload = staff_profile_payload(role, payload, row)
    updated_rows = update_rows(table, 'id = %s', [row.get('id')], {
        **profile_payload,
        'updated_at': datetime.utcnow(),
    })
    if role == 'tutor' and assignment_provided:
        sync_staff_profile_module_assignments(
            role,
            profile_payload.get('name'),
            as_json_value(profile_payload.get('assigned_module_ids'), []),
            previous_name=previous_name,
            clear_missing=True,
        )
    elif role == 'coach' and group_assignment_provided:
        sync_staff_profile_group_assignments(
            profile_payload.get('name'),
            as_json_value(profile_payload.get('assigned_group_ids'), []),
            previous_name=previous_name,
            clear_missing=True,
        )
    elif previous_name != profile_payload.get('name'):
        if role == 'tutor':
            sync_staff_profile_module_assignments(role, profile_payload.get('name'), None, previous_name=previous_name)
        elif role == 'coach':
            sync_staff_profile_group_assignments(profile_payload.get('name'), None, previous_name=previous_name)
    invalidate_curriculum_cache()
    profile_id = (updated_rows[0] if updated_rows else row).get('id')
    return JsonResponse({'updated': True, 'profile': current_staff_profile_payload(role, profile_id)})


@require_GET
def curriculum_holidays(request):
    visibility = curriculum_visibility(request)

    def build_holidays():
        rows = get_holiday_rows()
        if visibility != 'all':
            rows = [
                item for item in rows
                if not truthy(item.get('is_archived'))
                and not truthy(item.get('archived'))
                and not truthy(extract_notes_meta(item.get('notes')).get('archived'))
            ]
        return [serialize_holiday_row(item) for item in rows]

    holidays = cached_curriculum_value(f'holidays:{visibility}', build_holidays)
    return curriculum_results_response(holidays)


@csrf_exempt
def curriculum_holiday_collection(request):
    if request.method == 'GET':
        return curriculum_holidays(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    source_table = holiday_table_name()
    if not source_table:
        return json_error('Holiday table not found.', status=404)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['label', 'startDate'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    row = insert_row(source_table, {
        'label': payload.get('label'),
        'start_date': payload.get('startDate'),
        'end_date': payload.get('endDate') or payload.get('startDate'),
        'type': payload.get('type'),
        'color': payload.get('color'),
        'notes': payload.get('notes'),
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
        'is_archived': False,
    })
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'holiday': serialize_holiday_row(row)}, status=201)


@csrf_exempt
def curriculum_holiday_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    source_table = holiday_table_name()
    if not source_table:
        return json_error('Holiday table not found.', status=404)
    rows = fetch_all(f'select * from {table_name(source_table)} where id = %s', [identifier])
    if not rows:
        return json_error('Holiday not found.', status=404)
    if request.method == 'DELETE':
        payload = archive_payload(source_table, rows[0].get('notes'))
        if payload:
            update_rows(source_table, 'id = %s', [identifier], payload)
        else:
            delete_rows(source_table, 'id = %s', [identifier])
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    update_rows(source_table, 'id = %s', [identifier], {
        'label': payload.get('label'),
        'start_date': payload.get('startDate'),
        'end_date': payload.get('endDate'),
        'type': payload.get('type'),
        'color': payload.get('color'),
        'notes': payload.get('notes'),
        'updated_at': datetime.utcnow(),
    })
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


@csrf_exempt
def curriculum_tutors(request):
    return curriculum_staff_profile_collection(request, 'tutor')


@csrf_exempt
def curriculum_coaches(request):
    return curriculum_staff_profile_collection(request, 'coach')


@csrf_exempt
def curriculum_tutor_detail(request, identifier):
    return curriculum_staff_profile_detail(request, 'tutor', identifier)


@csrf_exempt
def curriculum_coach_detail(request, identifier):
    return curriculum_staff_profile_detail(request, 'coach', identifier)


# ---------------------------------------------------------------------------
# Week templates (standalone Week Builder)
#
# Reusable weeks authored outside any module. A template's course_type drives
# the paid/free split: 'paid' templates are scoped to programme + module +
# group (all required at creation); 'free' templates carry none of those. The
# component shape mirrors module authoring components (type + settings + KSBs)
# so a template stays compatible with modules for the future module import.
# ---------------------------------------------------------------------------
WEEK_TEMPLATES_TABLE = 'week_templates'
WEEK_TEMPLATE_COMPONENTS_TABLE = 'week_template_components'
WEEK_TEMPLATE_COURSE_TYPES = {'paid', 'free'}
_WEEK_TEMPLATE_TABLES_READY = False


def ensure_week_template_tables():
    # Mirrors sql/001_week_templates.sql so local/sqlite dev and the test runner
    # have the tables even though Neon is the source of truth in production.
    global _WEEK_TEMPLATE_TABLES_READY
    if _WEEK_TEMPLATE_TABLES_READY:
        return
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(WEEK_TEMPLATES_TABLE)} (
                id varchar(128) primary key,
                title varchar(500) not null default '',
                summary text,
                learning_outcomes {json_type},
                course_type varchar(16) not null default 'paid',
                programme_id varchar(255),
                programme_name varchar(255),
                module_catalogue_id varchar(128),
                group_id varchar(255),
                group_name varchar(255),
                status varchar(32) not null default 'draft',
                ksb_mappings {json_type},
                total_otjh numeric(8,2) not null default 0,
                points integer not null default 0,
                component_count integer not null default 0,
                author varchar(255),
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} (
                id varchar(128) primary key,
                week_template_id varchar(128) not null,
                type varchar(64) not null,
                title varchar(500) not null default '',
                description text,
                expected_otjh numeric(8,2) not null default 2,
                points integer not null default 0,
                reflection_required boolean not null default false,
                workplace_evidence_required boolean not null default false,
                tutor_validation_required boolean not null default false,
                ksb_mappings {json_type},
                settings_json {json_type},
                display_order integer not null default 0,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    _WEEK_TEMPLATE_TABLES_READY = True


def week_template_number(value, default=0):
    try:
        if value in (None, ''):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def week_template_scope_fields(payload, course_type):
    # Paid templates keep their programme/module/group scope; free templates
    # clear it. Empty string (not None) so update_rows actually clears columns
    # when a template switches paid -> free.
    if course_type == 'free':
        return {
            'programme_id': '',
            'programme_name': '',
            'module_catalogue_id': '',
            'group_id': '',
            'group_name': '',
        }
    return {
        'programme_id': clean_str(payload.get('programmeId')),
        'programme_name': clean_str(payload.get('programmeName')),
        'module_catalogue_id': clean_str(payload.get('moduleCatalogueId')),
        'group_id': clean_str(payload.get('groupId')),
        'group_name': clean_str(payload.get('groupName')),
    }


def get_week_template_rows(where_sql='', params=None):
    ensure_week_template_tables()
    query = f'select * from {table_name(WEEK_TEMPLATES_TABLE)}'
    if where_sql:
        query += f' where {where_sql}'
    query += ' order by updated_at desc'
    return fetch_all(query, params or [])


def get_week_template_row(template_id):
    rows = get_week_template_rows('id = %s', [template_id])
    return rows[0] if rows else None


def get_week_template_component_rows(template_id):
    ensure_week_template_tables()
    return fetch_all(
        f'select * from {table_name(WEEK_TEMPLATE_COMPONENTS_TABLE)} '
        f'where week_template_id = %s order by display_order asc',
        [template_id],
    )


def week_template_component_payload(row):
    return {
        'id': row.get('id'),
        'weekTemplateId': row.get('week_template_id'),
        'type': row.get('type'),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'expectedOtjh': week_template_number(row.get('expected_otjh')),
        'points': parse_int(row.get('points'), 0),
        'reflectionRequired': bool(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'ksbMappings': as_json_value(row.get('ksb_mappings'), []),
        'settings': as_json_value(row.get('settings_json'), {}),
        'displayOrder': parse_int(row.get('display_order'), 0),
    }


def week_template_payload(row, components=None):
    return {
        'id': row.get('id'),
        'title': row.get('title') or '',
        'summary': row.get('summary') or '',
        'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
        'courseType': row.get('course_type') or 'paid',
        'programmeId': row.get('programme_id') or '',
        'programmeName': row.get('programme_name') or '',
        'moduleCatalogueId': row.get('module_catalogue_id') or '',
        'groupId': row.get('group_id') or '',
        'groupName': row.get('group_name') or '',
        'status': row.get('status') or 'draft',
        'ksbMappings': as_json_value(row.get('ksb_mappings'), []),
        'totalOtjh': week_template_number(row.get('total_otjh')),
        'points': parse_int(row.get('points'), 0),
        'componentCount': parse_int(row.get('component_count'), 0),
        'author': row.get('author') or '',
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
        'components': [week_template_component_payload(component) for component in (components or [])],
    }


def save_week_template_components(template_id, components):
    # Delete-then-reinsert the whole component list (same approach as the free
    # programme module save). Returns the saved rows in display order.
    ensure_week_template_tables()
    delete_rows(WEEK_TEMPLATE_COMPONENTS_TABLE, 'week_template_id = %s', [template_id])
    saved = []
    for index, component in enumerate(components or []):
        component_id = clean_str(component.get('id')) or unique_prefixed_id('WTC')
        row = insert_row(WEEK_TEMPLATE_COMPONENTS_TABLE, {
            'id': component_id,
            'week_template_id': template_id,
            'type': clean_str(component.get('type')) or 'reading',
            'title': clean_str(component.get('title')),
            'description': clean_str(component.get('description')),
            'expected_otjh': week_template_number(component.get('expectedOtjh')),
            'points': parse_int(component.get('points'), 0),
            'reflection_required': bool(component.get('reflectionRequired')),
            'workplace_evidence_required': bool(component.get('workplaceEvidenceRequired')),
            'tutor_validation_required': bool(component.get('tutorValidationRequired')),
            'ksb_mappings': json_db_value(component.get('ksbMappings') or []),
            'settings_json': json_db_value(component.get('settings') or {}),
            'display_order': index,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })
        saved.append(row)
    return saved


def week_template_component_metrics(components):
    total_otjh = sum(week_template_number(component.get('expectedOtjh')) for component in (components or []))
    points = sum(parse_int(component.get('points'), 0) for component in (components or []))
    return round(total_otjh, 2), points, len(components or [])


def week_template_detail_response(template_id, wrapper_key='weekTemplate', **extra):
    row = get_week_template_row(template_id)
    if not row:
        return json_error('Week template not found.', status=404)
    components = get_week_template_component_rows(template_id)
    payload = {'schema': CURRICULUM_SCHEMA, wrapper_key: week_template_payload(row, components)}
    payload.update(extra)
    return JsonResponse(payload)


@csrf_exempt
def curriculum_week_template_collection(request):
    ensure_week_template_tables()
    if request.method == 'GET':
        conditions = []
        params = []
        course_type = clean_str(request.GET.get('courseType')).lower()
        if course_type in WEEK_TEMPLATE_COURSE_TYPES:
            conditions.append('course_type = %s')
            params.append(course_type)
        for column, param in (
            ('programme_id', 'programmeId'),
            ('module_catalogue_id', 'moduleCatalogueId'),
            ('group_id', 'groupId'),
            ('status', 'status'),
        ):
            value = clean_str(request.GET.get(param))
            if value:
                conditions.append(f'{column} = %s')
                params.append(value)
        rows = get_week_template_rows(' and '.join(conditions), params)
        search = clean_str(request.GET.get('search')).lower()
        if search:
            rows = [row for row in rows if search in clean_str(row.get('title')).lower()]
        results = [week_template_payload(row) for row in rows]
        return curriculum_results_response(results)

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    course_type = clean_str(payload.get('courseType')).lower() or 'paid'
    if course_type not in WEEK_TEMPLATE_COURSE_TYPES:
        return json_error('courseType must be "paid" or "free".', fields=['courseType'])
    if not clean_str(payload.get('title')):
        return json_error('Missing required fields.', fields=['title'])
    if course_type == 'paid':
        missing = [field for field in ('programmeId', 'moduleCatalogueId', 'groupId') if not clean_str(payload.get(field))]
        if missing:
            return json_error('A paid week template needs a programme, module and group.', fields=missing)

    components = payload.get('components') if isinstance(payload.get('components'), list) else []
    total_otjh, points, component_count = week_template_component_metrics(components)
    existing_ids = [row.get('id') for row in get_week_template_rows()]
    template_id = unique_prefixed_id('WT', payload.get('id'), existing_ids)

    insert_row(WEEK_TEMPLATES_TABLE, {
        'id': template_id,
        'title': clean_str(payload.get('title')),
        'summary': clean_str(payload.get('summary')),
        'learning_outcomes': json_db_value(payload.get('learningOutcomes') or []),
        'course_type': course_type,
        **week_template_scope_fields(payload, course_type),
        'status': clean_str(payload.get('status')) or 'draft',
        'ksb_mappings': json_db_value(payload.get('ksbMappings') or []),
        'total_otjh': total_otjh,
        'points': points,
        'component_count': component_count,
        'author': clean_str(payload.get('author')),
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    })
    if components:
        save_week_template_components(template_id, components)
    invalidate_curriculum_cache()
    return week_template_detail_response(template_id, created=True)


@csrf_exempt
def curriculum_week_template_detail(request, identifier):
    if request.method not in {'GET', 'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    row = get_week_template_row(identifier)
    if not row:
        return json_error('Week template not found.', status=404)

    if request.method == 'GET':
        return week_template_detail_response(identifier)

    if request.method == 'DELETE':
        delete_rows(WEEK_TEMPLATE_COMPONENTS_TABLE, 'week_template_id = %s', [identifier])
        delete_rows(WEEK_TEMPLATES_TABLE, 'id = %s', [identifier])
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'id': identifier})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    if 'title' in payload and not clean_str(payload.get('title')):
        return json_error('Title cannot be blank.', fields=['title'])

    course_type = clean_str(payload.get('courseType')).lower() or (row.get('course_type') or 'paid')
    if course_type not in WEEK_TEMPLATE_COURSE_TYPES:
        return json_error('courseType must be "paid" or "free".', fields=['courseType'])

    updates = {'updated_at': datetime.utcnow(), 'course_type': course_type}
    if 'title' in payload:
        updates['title'] = clean_str(payload.get('title'))
    if 'summary' in payload:
        updates['summary'] = clean_str(payload.get('summary'))
    if 'learningOutcomes' in payload:
        updates['learning_outcomes'] = json_db_value(payload.get('learningOutcomes') or [])
    if 'ksbMappings' in payload:
        updates['ksb_mappings'] = json_db_value(payload.get('ksbMappings') or [])
    if 'status' in payload:
        updates['status'] = clean_str(payload.get('status')) or 'draft'
    if 'author' in payload:
        updates['author'] = clean_str(payload.get('author'))
    # Re-apply scope whenever course type is sent (switching to free clears it)
    # or when any scope field is provided.
    if 'courseType' in payload or any(key in payload for key in ('programmeId', 'programmeName', 'moduleCatalogueId', 'groupId', 'groupName')):
        updates.update(week_template_scope_fields(payload, course_type))

    components_provided = isinstance(payload.get('components'), list)
    if components_provided:
        components = payload.get('components')
        total_otjh, points, component_count = week_template_component_metrics(components)
        updates.update({'total_otjh': total_otjh, 'points': points, 'component_count': component_count})

    update_rows(WEEK_TEMPLATES_TABLE, 'id = %s', [identifier], updates)
    if components_provided:
        save_week_template_components(identifier, payload.get('components'))
    invalidate_curriculum_cache()
    return week_template_detail_response(identifier, updated=True)
