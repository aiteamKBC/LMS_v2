import json
import logging
import calendar
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import IntegrityError, connection, transaction
from django.http import FileResponse, Http404, JsonResponse
from django.utils.text import get_valid_filename
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from .ksb_coverage import (
    SUPPORTED_CLASSIFICATIONS,
    build_coverage,
    coverage_status,
    float_weight,
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
_TABLE_COLUMNS_CACHE = {}
_AUTHORING_TABLES_READY = False
_FREE_PROGRAMME_TABLES_READY = False
_TRAINING_PLAN_CANONICAL_READY = False
SUPPORTED_KSB_SOURCE_TYPES = {'standard', 'framework'}


def invalidate_curriculum_cache():
    _CURRICULUM_CACHE.clear()


def cached_curriculum_value(key, factory):
    now = datetime.now().timestamp()
    entry = _CURRICULUM_CACHE.get(key)
    if entry and entry['expires_at'] > now:
        return entry['value']

    value = factory()
    _CURRICULUM_CACHE[key] = {
        'expires_at': now + CURRICULUM_CACHE_TTL_SECONDS,
        'value': value,
    }
    return value


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
    return f'{quote_ident(CURRICULUM_SCHEMA)}.{quote_ident(table)}'


def column_names(table):
    cache_key = f'{CURRICULUM_SCHEMA}.{table}'
    if cache_key in _TABLE_COLUMNS_CACHE:
        return _TABLE_COLUMNS_CACHE[cache_key]

    rows = fetch_all(
        '''
        select column_name
        from information_schema.columns
        where table_schema = %s and table_name = %s
        ''',
        [CURRICULUM_SCHEMA, table],
    )
    names = {row['column_name'] for row in rows}
    _TABLE_COLUMNS_CACHE[cache_key] = names
    return names


def has_column(table, column):
    return column in column_names(table)


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


def ensure_training_plan_canonical_module_column():
    global _TRAINING_PLAN_CANONICAL_READY
    if _TRAINING_PLAN_CANONICAL_READY:
        return
    try:
        ensure_columns('Training_plan', {
            TRAINING_MODULE_CATALOGUE_COLUMN: 'varchar(128)',
        })
        if connection.vendor == 'postgresql':
            with connection.cursor() as cursor:
                cursor.execute(f'''
                    create index if not exists curriculum_training_plan_module_catalogue_idx
                    on {table_name("Training_plan")} ({quote_ident(TRAINING_MODULE_CATALOGUE_COLUMN)})
                ''')
    except Exception as exc:
        logger.warning('Could not ensure Training_plan canonical module column: %s', exc)
    _TRAINING_PLAN_CANONICAL_READY = True


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
    payload = {
        'notes': append_notes_meta((row or {}).get('notes'), {
            TRAINING_MODULE_CATALOGUE_COLUMN: module_catalogue_id,
        }),
    }
    if has_column('Training_plan', TRAINING_MODULE_CATALOGUE_COLUMN):
        payload[TRAINING_MODULE_CATALOGUE_COLUMN] = module_catalogue_id
    return payload


def link_training_row_to_catalogue(training_id, module_catalogue_id):
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id:
        return False
    try:
        rows = fetch_all(f'select * from {table_name("Training_plan")} where id = %s', [training_id])
    except Exception:
        logger.debug('Could not read Training_plan row %s to link canonical module.', training_id, exc_info=True)
        return False
    if not rows:
        return False
    row = rows[0]
    row['_meta'] = extract_notes_meta(row.get('notes'))
    current = training_row_module_catalogue_id(row)
    if current:
        return current == module_catalogue_id
    try:
        update_rows('Training_plan', 'id = %s', [training_id], canonical_module_link_payload(row, module_catalogue_id))
        return True
    except Exception:
        logger.debug('Could not link Training_plan row %s to %s.', training_id, module_catalogue_id, exc_info=True)
        return False


def ensure_program_config_archive_columns():
    try:
        ensure_columns('training_plan_program_configs', {
            'status': 'varchar(32)',
            'is_active': 'boolean',
            'is_archived': 'boolean',
            'structure_type': 'varchar(32)',
        })
    except Exception as exc:
        logger.warning('Could not inspect programme config archive columns: %s', exc)
        return
    updates = {}
    if has_column('training_plan_program_configs', 'status'):
        updates['status'] = 'active'
    if has_column('training_plan_program_configs', 'is_active'):
        updates['is_active'] = True
    if has_column('training_plan_program_configs', 'is_archived'):
        updates['is_archived'] = False
    if has_column('training_plan_program_configs', 'structure_type'):
        updates['structure_type'] = 'scheduled'
    if updates:
        try:
            update_rows(
                'training_plan_program_configs',
                '(status is null or is_active is null or is_archived is null or structure_type is null)',
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
    cursor = start
    guard_days = max(3650, session_count * 21)
    while len(sessions) < session_count and guard_days > 0:
        if cursor.weekday() in days:
            if cursor in selected_holidays:
                skipped.append(cursor.isoformat())
            else:
                sessions.append({
                    'sessionNumber': len(sessions) + 1,
                    'date': cursor.isoformat(),
                    'day': cursor.strftime('%A'),
                })
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
    if re.match(rf'^{re.escape(prefix)}-\d{{14,}}[A-Z0-9]*$', requested) and requested not in existing:
        return requested

    while True:
        candidate = f'{prefix}-{datetime.utcnow().strftime("%Y%m%d%H%M%S%f")}'
        if candidate not in existing:
            return candidate


def unique_program_id(value, configs):
    return unique_prefixed_id('PROG', value, [config.get('program_id') for config in configs if config.get('program_id')])


def existing_training_meta_ids(key):
    return [
        row.get('_meta', {}).get(key)
        for row in get_training_rows()
        if row.get('_meta', {}).get(key)
    ]


def unique_cohort_id(value=''):
    return unique_prefixed_id('COHORT', value, existing_training_meta_ids('cohort_id'))


def unique_group_id(value=''):
    return unique_prefixed_id('GROUP', value, existing_training_meta_ids('group_id'))


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
        or clean_str(config.get('status')).lower() == 'archived'
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
    best = None
    best_score = 0
    for profile in ksb_profiles:
        candidates = [profile.get('programme_name'), profile.get('name')]
        score = 0
        for candidate in candidates:
            candidate_norm = normalise(candidate)
            if not candidate_norm:
                continue
            if candidate_norm == program_norm:
                score = max(score, 3)
            elif candidate_norm in program_norm or program_norm in candidate_norm:
                score = max(score, 2)
        if score > best_score:
            best = profile
            best_score = score
    return best


def program_config_by_id(program_configs):
    configs = {}
    configs_by_name = {}
    for config in program_configs:
        if config.get('program_id'):
            configs[str(config.get('program_id'))] = config
        if config.get('name'):
            name_key = normalise(config.get('name'))
            current = configs_by_name.get(name_key)
            if not current or program_config_preference(config) > program_config_preference(current):
                configs_by_name[name_key] = config
    configs.update(configs_by_name)
    return configs


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
    if program_id:
        config = program_configs_by_id.get(str(program_id))
        return {
            'key': f'id:{program_id}',
            'sourceId': program_id,
            'name': config.get('name') if config else (row.get('Program') or 'Unassigned Programme'),
            'config': config,
        }

    name = row.get('Program') or 'Unassigned Programme'
    config = program_configs_by_id.get(normalise(name))
    return {
        'key': f'id:{config.get("program_id")}' if config and config.get('program_id') else f'name:{normalise(name)}',
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


def profile_matches_visible_programmes(profile, programmes):
    candidates = [
        profile.get('programme_name'),
        profile.get('name'),
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


def get_training_rows():
    ensure_training_plan_canonical_module_column()
    rows = fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Training_plan"
        order by programme_display_order nulls last, "Program", cohort_display_order nulls last, "Cohort_name", start_date, id
    ''')
    for row in rows:
        row['_meta'] = extract_notes_meta(row.get('notes'))
    return rows


def get_module_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Modules"
        order by "Module_name", "Module ID"
    ''')


def get_ksb_profile_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".ksb_profiles
        order by is_active desc, name
    ''')


def get_skills_england_ksb_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".skills_england_ksbs
        order by standard_ref, standard_version, ksb_type, ksb_code, id
    ''')


def get_program_config_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".training_plan_program_configs
        order by name
    ''')


def get_holiday_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".training_plan_holidays
        order by start_date, label
    ''')


def get_tutor_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".tutor_profiles
        order by name
    ''')


def get_coach_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}".coach_profiles
        order by name
    ''')


def get_tutor_module_rows():
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Tutors_Modules"
        order by "Tutor_name", id
    ''')


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


def get_curriculum_rows(compact=False):
    rows = {
        'training': get_training_rows(),
        'modules': get_module_rows(),
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
        programme_id = f'program-{slugify(identity["sourceId"])}'
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
        delivery_module_id = f'training-module-{row.get("id")}'
        canonical_module_id = catalogue_id or delivery_module_id
        session_count = parse_int(row.get('sessions_number'), parse_int((catalogue or {}).get('Number of sessions'), 0))
        ksb_codes = codes_from_session_ksb(row.get('session_ksb_json')) or codes_from_session_ksb((catalogue or {}).get('session_ksb_json'))
        modules.append({
            'id': delivery_module_id,
            'moduleId': canonical_module_id,
            'moduleCatalogueId': catalogue_id,
            'deliveryRowId': row.get('id'),
            'deliveryModuleId': delivery_module_id,
            'legacyModuleId': stale_legacy_id,
            'invalidModuleCatalogueId': invalid_explicit_id,
            'structureId': canonical_module_id,
            'sourceId': row.get('id'),
            'sourceType': 'training_plan',
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

    display_program_configs = unique_program_configs_for_display(program_configs)
    row_programme_names = set()
    row_programme_source_ids = set()
    for row in training_rows:
        identity = programme_identity(row, configs_by_id)
        row_programme_names.add(normalise(identity['name']))
        row_programme_source_ids.add(clean_str(identity['sourceId']))

    if include_config_only:
        for config in display_program_configs:
            if not config.get('program_id'):
                continue
            if normalise(config.get('name')) in row_programme_names and clean_str(config.get('program_id')) not in row_programme_source_ids:
                continue
            key = f'id:{config.get("program_id")}'
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
            order.setdefault(f'id:{program_id}', len(order))

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
        ksb_items = profile.get('ksb_items') if profile else []
        ksb_items = parse_json_value(ksb_items, [])
        ksb_total = len(ksb_items) if isinstance(ksb_items, list) and ksb_items else (
            len(parse_json_value(profile.get('knowledge_codes'), [])) +
            len(parse_json_value(profile.get('skill_codes'), [])) +
            len(parse_json_value(profile.get('behaviour_codes'), []))
            if profile else 0
        )
        config_archived = is_archived_program_config(config)
        archived = (rows and not operational_rows) or (not rows and config_archived)
        status_rows = operational_rows or rows
        start_dates = [parse_date(row.get('Starting_date_lable')) for row in status_rows]
        end_dates = [parse_date(row.get('_meta', {}).get('cohort_end_date') or row.get('end_date')) for row in status_rows]
        start_dates = [value for value in start_dates if value]
        end_dates = [value for value in end_dates if value]
        computed_status = title_case_status(archived, min(start_dates) if start_dates else None, max(end_dates) if end_dates else None)
        config_status = clean_str((config or {}).get('status')).lower()
        status = 'archived' if archived else (config_status or computed_status)
        standard = (config or {}).get('sub') or (config or {}).get('standard') or (profile.get('name') if profile else name)
        level = (config or {}).get('level') or infer_level(standard) or infer_level(name)
        structure_type = (config or {}).get('structure_type') or 'scheduled'
        free_counts = free_programme_counts.get(clean_str(source_id), {})
        programme_modules_count = parse_int(free_counts.get('modules'), 0) if structure_type == 'free' else len(delivery_rows)

        programmes.append({
            'id': f'program-{slugify(source_id)}',
            'sourceId': source_id,
            'name': name,
            'standard': standard,
            'level': level,
            'status': status,
            'modules': programme_modules_count,
            'groups': len(group_keys),
            'weeks': sum(parse_int(row.get('sessions_number')) for row in delivery_rows),
            'ksbMapped': ksb_total,
            'ksbTotal': ksb_total,
            'learners': 0,
            'cohorts': len(cohort_names),
            'lastUpdated': format_date((profile or config or {}).get('updated_at') or (profile or config or {}).get('created_at')),
            'owner': (config or {}).get('owner') or (config or {}).get('created_by') or (profile or {}).get('created_by') or '',
            'color': (config or {}).get('color') or (rows[0].get('_meta', {}).get('cohort_color') if rows else '#6941c6'),
            'description': (config or {}).get('description') or (profile or {}).get('description') or '',
            'structureType': structure_type,
            'freeComponents': parse_int(free_counts.get('components'), 0),
        })
    return programmes


def build_cohorts_and_groups(training_rows, program_configs=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
    cohorts_map = {}
    groups_map = {}

    for row in training_rows:
        identity = programme_identity(row, program_configs_by_id)
        program = identity['name']
        meta = row.get('_meta', {})
        cohort_identity = actual_cohort_identity(row, program)
        if not cohort_identity:
            continue
        cohort_name = cohort_identity['name']
        cohort_id = cohort_identity['id']
        group_identity = actual_group_identity(row, cohort_id)
        group_name = group_identity['name'] if group_identity else ''
        group_id = group_identity['id'] if group_identity else ''
        module_name = clean_str(row.get('module_name'))
        session_count = parse_int(row.get('sessions_number'), 0) if module_name and group_identity else 0

        cohort = cohorts_map.setdefault(cohort_id, {
            'id': cohort_id,
            'name': cohort_name,
            'programme': program,
            'programmeId': f'program-{slugify(identity["sourceId"])}',
            'startDate': format_date(row.get('Starting_date_lable') or row.get('start_date')),
            'endDate': format_date(meta.get('cohort_end_date') or row.get('end_date')),
            'status': title_case_status(row.get('is_archived'), row.get('Starting_date_lable'), meta.get('cohort_end_date') or row.get('end_date')),
            'learners': 0,
            'groups': [],
            'modules': set(),
            'sessions': 0,
            'color': meta.get('cohort_color') or '#6941c6',
            'holidayIds': parse_notes_id_list(meta.get('holiday_ids')),
        })
        if module_name and group_identity:
            cohort['modules'].add(module_name)
            cohort['sessions'] += session_count

        if group_identity:
            group = groups_map.setdefault(group_id, {
                'id': group_id,
                'name': group_name,
                'cohortId': cohort_id,
                'cohort': cohort_name,
                'programmeId': f'program-{slugify(identity["sourceId"])}',
                'programme': program,
                'learners': 0,
                'coach': row.get('coach_name') or meta.get('coach_name') or 'Unassigned',
                'tutor': row.get('Tutor_name') or 'Unassigned',
                'startDate': format_date(row.get('start_date')),
                'endDate': format_date(row.get('end_date')),
                'status': title_case_status(row.get('is_archived'), row.get('start_date'), row.get('end_date')),
                'schedule': '',
                'mode': 'Live',
                'modules': set(),
                'sessions': 0,
            })
            if module_name:
                group['modules'].add(module_name)
                group['sessions'] += session_count
            if not group['schedule']:
                group['schedule'] = f'{row.get("session_week_day") or "TBD"} {row.get("session_start_time") or ""}-{row.get("session_end_time") or ""}'.strip()

    cohorts = []
    for cohort in cohorts_map.values():
        cohort_groups = [group for group in groups_map.values() if group['cohortId'] == cohort['id']]
        cohort['groups'] = [group['id'] for group in cohort_groups]
        cohort['modules'] = [name for name in cohort['modules'] if name]
        cohort['progress'] = 0
        cohort['attendance'] = 0
        cohorts.append(cohort)

    groups = []
    for group in groups_map.values():
        group['modules'] = [name for name in group['modules'] if name]
        groups.append(group)

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


def build_sessions(training_rows, module_rows, program_configs=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
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
        programme_id = f'program-{slugify(identity["sourceId"])}'
        session_count = parse_int(row.get('sessions_number'), 0)
        if session_count <= 0:
            continue
        start = parse_date(row.get('start_date'))
        meta = row.get('_meta', {})
        delivery_module_id = f'training-module-{row.get("id")}'
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
        ksb_entries = parse_json_value(row.get('session_ksb_json'), [])

        for index in range(session_count):
            session_date = start + timedelta(days=index * 7) if start else None
            ksb_entry = ksb_entries[index] if isinstance(ksb_entries, list) and index < len(ksb_entries) and isinstance(ksb_entries[index], dict) else {}
            title = session_names[index] if index < len(session_names) else f'{row.get("module_name") or "Session"} #{index + 1}'
            sessions.append({
                'id': f'training-{row.get("id")}-session-{index + 1}',
                'trainingPlanId': row.get('id'),
                'deliveryRowId': row.get('id'),
                'programmeId': programme_id,
                'cohortId': cohort_id,
                'groupId': group_id,
                'moduleId': module_id,
                'deliveryModuleId': delivery_module_id,
                'moduleCatalogueId': explicit_catalogue_id,
                'legacyModuleId': stale_legacy_id,
                'invalidModuleCatalogueId': invalid_explicit_id,
                'weekId': (session_links[index].get('weekId') if index < len(session_links) else '') or f'{module_id}-week-{index + 1}',
                'componentId': (session_links[index].get('componentId') if index < len(session_links) else '') or '',
                'title': title,
                'type': 'Live Session',
                'date': session_date.isoformat() if session_date else '',
                'day': row.get('session_week_day') or '',
                'startTime': row.get('session_start_time') or '',
                'endTime': row.get('session_end_time') or '',
                'tutor': row.get('Tutor_name') or 'Unassigned',
                'group': group_name,
                'cohort': cohort_name,
                'programme': program,
                'venue': 'LMS',
                'module': row.get('module_name') or '',
                'week': index + 1,
                'status': 'completed' if session_date and session_date < date.today() else 'scheduled',
                'ksbCodes': [
                    *ksb_entry.get('knowledgeCodes', []),
                    *ksb_entry.get('skillCodes', []),
                    *ksb_entry.get('behaviourCodes', []),
                ],
            })
    return sessions


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
        framework_id = f'ksb-{profile.get("id")}'
        frameworks.append({
            'id': framework_id,
            'profileId': profile.get('id'),
            'name': profile.get('name') or profile.get('programme_name') or 'KSB Framework',
            'standard': profile.get('name') or '',
            'programmeName': profile.get('programme_name') or '',
            'notes': profile.get('description') or '',
            'ifateRef': profile.get('programme_name') or '',
            'level': parse_int(infer_level(profile.get('programme_name')).replace('L', ''), 0),
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
            'programmes': [profile.get('programme_name')] if profile.get('programme_name') else [],
        })
        sets.append({
            'frameworkId': framework_id,
            'profileId': profile.get('id'),
            'programmeId': f'program-{slugify(profile.get("programme_name") or profile.get("name"))}',
            'programmeName': profile.get('programme_name') or profile.get('name') or 'Programme',
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
    programmes = build_programmes(
        training_rows,
        rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
    )
    cohorts, groups = build_cohorts_and_groups(training_rows, rows['program_configs'])
    sessions = [] if compact else build_sessions(training_rows, rows['modules'], rows['program_configs'])
    session_count = sum(parse_int(group.get('sessions'), 0) for group in groups) if compact else len(sessions)
    visible_ksb_profiles = ksb_profiles if visibility == 'all' else [
        profile for profile in ksb_profiles
        if profile_matches_visible_programmes(profile, programmes)
    ]
    frameworks, ksb_sets = build_ksb_data(visible_ksb_profiles, modules, training_rows)

    holiday_rows = rows['holidays'] if visibility == 'all' else [
        item for item in rows['holidays']
        if not truthy(item.get('is_archived')) and not truthy(item.get('archived')) and not truthy(extract_notes_meta(item.get('notes')).get('archived'))
    ]

    payload = {
        'schema': CURRICULUM_SCHEMA,
        'visibility': visibility,
        'stats': {
            'programmes': len(programmes),
            'activeProgrammes': len([item for item in programmes if item['status'] == 'active']),
            'cohorts': len(cohorts),
            'groups': len(groups),
            'modules': len(modules),
            'ksbFrameworks': len(frameworks),
            'sessions': session_count,
        },
        'programmes': programmes,
        'modules': modules,
        'ksbFrameworks': frameworks,
        'ksbSets': ksb_sets,
        'cohorts': cohorts,
        'groups': groups,
        'sessions': sessions,
        'holidays': [] if compact else [serialize_holiday_row(item) for item in holiday_rows],
        'cohortAuthoringDetails': [] if compact else cohort_authoring_detail_rows(),
        'tutors': [] if compact else build_staff_profiles_from_training(training_rows, 'Tutor_name', 'tutor'),
        'coaches': [] if compact else build_staff_profiles_from_training(training_rows, 'coach_name', 'coach'),
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
    group_module_names = {normalise(item) for item in (group.get('modules') or [])}
    return (
        (bool(module_group_id) and matches_curriculum_identifier(module_group_id, group.get('id')))
        or (bool(module_group_name) and normalise(module_group_name) == normalise(group.get('name')))
        or (bool(module.get('name')) and normalise(module.get('name')) in group_module_names)
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
    standards = build_skills_england_standards()
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'skills_england_ksbs',
        'count': len(standards),
        'results': standards,
    })


@require_GET
def curriculum_standard_detail(request, identifier):
    standard = find_skills_england_standard(identifier)
    if not standard:
        return json_error('Skills England standard not found.', status=404)
    return JsonResponse({
        'schema': CURRICULUM_SCHEMA,
        'sourceTable': 'skills_england_ksbs',
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
    return raw_source_type, raw_source_id


def standard_required_ksbs(identifier):
    standard = find_skills_england_standard(identifier)
    if not standard:
        return []
    source_id = standard.get('id') or identifier
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


def profile_required_ksbs(identifier):
    ident = clean_str(identifier).replace('ksb-', '', 1)
    rows = get_ksb_profile_rows()
    matched = None
    for row in rows:
        row_ids = {
            clean_str(row.get('id')),
            f'ksb-{clean_str(row.get("id"))}',
            clean_str(row.get('programme_id')),
            slugify(row.get('name') or ''),
            slugify(row.get('programme_name') or ''),
        }
        if clean_str(identifier) in row_ids or ident in row_ids:
            matched = row
            break
    if not matched:
        return []
    source_id = f'ksb-{matched.get("id")}'
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


def required_ksbs_for_source(source_type='', source_id=''):
    source_type, source_id = split_ksb_source(source_type, source_id)
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
    try:
        configs = get_program_config_rows()
    except (Exception, AssertionError):
        configs = []
    candidate_keys = {candidate, slugify(candidate)}
    if candidate:
        candidate_keys.add(f'program-{slugify(candidate)}')
    programme_key = normalise(programme_name)
    for config in configs:
        config_id = clean_str(config.get('program_id'))
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
        'source_type': 'training_plan',
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
        'sourceType': row.get('source_type') or 'training_plan',
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


def sync_cohort_authoring_details_from_training():
    try:
        training_rows = get_training_rows()
        program_configs = get_program_config_rows()
        holiday_rows = get_holiday_rows()
        cohorts, groups = build_cohorts_and_groups(training_rows, program_configs)
        configs_by_id = program_config_by_id(program_configs)
        for cohort in cohorts:
            cohort_rows = []
            for row in training_rows:
                identity = programme_identity(row, configs_by_id)
                candidate = actual_cohort_identity(row, identity['name'])
                if candidate and candidate['id'] == cohort['id']:
                    cohort_rows.append(row)
            cohort_groups = [group for group in groups if group.get('cohortId') == cohort.get('id')]
            persist_cohort_authoring_detail(cohort, cohort_rows, cohort_groups, holiday_rows)
    except (Exception, AssertionError) as exc:
        logger.warning('Could not sync cohort authoring details: %s', exc)


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
    if not compact:
        sync_cohort_authoring_details_from_training()
    cache_key = f'overview:{visibility}:{"compact" if compact else "full"}'
    return JsonResponse(cached_curriculum_value(cache_key, lambda: build_curriculum_payload(visibility, compact=compact)))


def get_cached_payload(request):
    visibility = curriculum_visibility(request)
    return cached_curriculum_value(f'overview:{visibility}', lambda: build_curriculum_payload(visibility))


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
        exact_candidates = {
            clean_str(config.get('program_id')),
            clean_str(config.get('id')),
            f'program-{slugify(config.get("program_id"))}',
        }
        name_candidates = {
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


def ensure_programme_config_for_authoring(programme_name, programme_id=None, status='planned'):
    name = clean_str(programme_name)
    if not name or normalise(name) in {'unassignedprogramme', 'unassigned'}:
        return None

    ensure_program_config_archive_columns()
    configs = get_program_config_rows()
    requested_id = clean_str(programme_id)
    existing = next((
        config for config in configs
        if (requested_id and clean_str(config.get('program_id') or config.get('id')) == requested_id)
        or normalise(config.get('name')) == normalise(name)
    ), None)
    now = datetime.utcnow()

    if existing:
        try:
            key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
        except Exception:
            key_column = 'program_id' if existing_config.get('program_id') else 'id'
        key_value = existing.get(key_column)
        update_rows('training_plan_program_configs', f'{quote_ident(key_column)} = %s', [key_value], {
            'name': name,
            'sub': existing.get('sub') or existing.get('standard') or name,
            'standard': existing.get('standard') or existing.get('sub') or name,
            'status': existing.get('status') or status,
            'is_active': True,
            'is_archived': False,
            'updated_at': now,
        })
        invalidate_curriculum_cache()
        return programme_response(key_value) or programme_response(name)

    source_id = unique_program_id(requested_id or name, configs)
    insert_row('training_plan_program_configs', {
        'program_id': source_id,
        'name': name,
        'sub': name,
        'standard': name,
        'status': status,
        'is_active': True,
        'is_archived': False,
        'color': '#6941c6',
        'description': '',
        'created_at': now,
        'updated_at': now,
    })
    invalidate_curriculum_cache()
    return programme_response(source_id) or {'sourceId': source_id, 'name': name}


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


AUTHORING_MODULES_TABLE = 'module_authoring_modules'
AUTHORING_WEEKS_TABLE = 'module_authoring_weeks'
AUTHORING_COMPONENTS_TABLE = 'module_authoring_components'
AUTHORING_KSB_MAPPINGS_TABLE = 'module_authoring_ksb_mappings'
AUTHORING_COMPLETION_TABLE = 'module_authoring_completion_criteria'
AUTHORING_ADVANCED_TABLE = 'module_authoring_advanced_details'
COHORT_AUTHORING_DETAILS_TABLE = 'cohort_authoring_details'
FREE_PROGRAMME_MODULES_TABLE = 'free_programme_modules'
FREE_PROGRAMME_COMPONENTS_TABLE = 'free_programme_components'


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


def find_existing_authoring_catalogue_id_for_payload(payload):
    requested_catalogue_id = first_clean_payload_value(payload, 'catalogueId', 'moduleCatalogueId', 'module_catalogue_id')
    if requested_catalogue_id:
        resolved = resolve_authoring_catalogue_id(requested_catalogue_id)
        if resolved:
            return resolved

    try:
        ensure_module_authoring_tables()
        source_type = first_clean_payload_value(payload, 'sourceType', 'source_type').lower()
        source_id = first_clean_payload_value(payload, 'sourceId', 'source_id', 'importedFromTrainingPlanId', 'imported_from_training_plan_id')
        if source_type == 'training_plan' and source_id:
            training_row = training_row_by_id(source_id)
            if training_row:
                linked_catalogue_id = training_row_module_catalogue_id(training_row)
                if linked_catalogue_id and authoring_module_exists(linked_catalogue_id):
                    return linked_catalogue_id
            rows = authoring_fetch_all(
                AUTHORING_MODULES_TABLE,
                'source_type = %s and source_id = %s',
                [source_type, source_id],
                'updated_at desc, module_catalogue_id',
            )
            if rows:
                return clean_str(rows[0].get('module_catalogue_id'))

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
        rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, module_catalogue_id')
        for row in rows:
            if normalise(row.get('title')) != normalise(title):
                continue
            if not identity_values_overlap([row.get('programme_id'), row.get('programme_name')], programme_values):
                continue
            if not identity_values_overlap([row.get('cohort_id'), row.get('cohort_name')], cohort_values):
                continue
            if not identity_values_overlap([row.get('group_id'), row.get('group_name')], group_values):
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
                title varchar(500) not null,
                description text,
                status varchar(32) not null default 'draft',
                sessions_number integer not null default 0,
                start_date date,
                end_date date,
                total_otjh numeric(8,2) not null default 0,
                quality_score integer not null default 0,
                source_type varchar(64),
                source_id varchar(128),
                imported_from_training_plan_id varchar(128),
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
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists source_type varchar(64)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists source_id varchar(128)')
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column if not exists imported_from_training_plan_id varchar(128)')
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
            if 'source_type' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column source_type varchar(64)')
            if 'source_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column source_id varchar(128)')
            if 'imported_from_training_plan_id' not in columns:
                cursor.execute(f'alter table {authoring_table_name(AUTHORING_MODULES_TABLE)} add column imported_from_training_plan_id varchar(128)')
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
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} alter column expected_otjh set default 2')
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
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                update {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)}
                set programme_id = upper(substr(programme_id, length('program-') + 1)),
                    updated_at = current_timestamp
                where lower(programme_id) like 'program-prog-%'
            ''')
        else:
            cursor.execute(f'''
                update {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)}
                set programme_id = upper(substr(programme_id, length('program-') + 1)),
                    updated_at = current_timestamp
                where lower(programme_id) like 'program-prog-%'
            ''')
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
            cursor.execute(f'alter table {authoring_table_name(FREE_PROGRAMME_COMPONENTS_TABLE)} alter column expected_otjh set default 2')
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


def free_programme_upsert(table, key_columns, payload):
    ensure_free_programme_tables()
    return authoring_upsert(table, key_columns, payload)


def as_json_value(value, fallback):
    parsed = parse_json_value(value, fallback)
    return parsed if parsed is not None else fallback


def json_db_value(value):
    return json.dumps(value if value is not None else [])


def normalise_component_type(value):
    return str(value or '').replace('-', '_')


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
        'workplace-evidence': 'Assignment',
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
        'workplace evidence': 'workplace_evidence',
        'evidence task': 'workplace_evidence',
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
    'workplace-evidence': {
        **BASE_COMPONENT_SETTINGS,
        'evidenceInstructions': '',
        'acceptedEvidenceTypes': 'Document, image, video, witness statement',
        'assessmentChecklist': '',
        'minimumDescriptionWords': 100,
    },
    'assignment': {
        **BASE_COMPONENT_SETTINGS,
        'assignmentBrief': '',
        'submissionInstructions': '',
        'dueTiming': 'End of week',
        'markingRubric': '',
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
    source = settings if isinstance(settings, dict) else {}
    defaults = component_settings_defaults(component_type)
    allowed = set(defaults.keys()) | LEGACY_SETTING_KEYS
    normalised = dict(defaults)
    legacy = {}
    for key, value in source.items():
        if value is None:
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
    if bool_payload(component.get('workplaceEvidenceRequired')) and not clean_str(settings.get('evidenceInstructions') or settings.get('evidenceRequired')):
        errors.append({'path': f'{path}.settings.evidenceInstructions', 'message': 'Evidence instructions are required when workplace evidence is enabled.'})
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
        podcast_url = clean_str(settings.get('podcastUrl'))
        progress = parse_float(settings.get('requiredProgressPercentage'), 0)
        if progress < 0 or progress > 100:
            errors.append({'path': f'{path}.settings.requiredProgressPercentage', 'message': 'Required progress must be between 0 and 100.'})
        if podcast_url and not component_resource_url(podcast_url):
            errors.append({'path': f'{path}.settings.podcastUrl', 'message': 'Enter a valid podcast URL.'})

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
    weeks = payload.get('weekStructure') or payload.get('weeks') or []
    if not isinstance(weeks, list):
        errors.append({'path': 'weekStructure', 'message': 'Week structure must be a list.'})
        return errors
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


def training_row_by_id(training_id):
    rows = fetch_all(f'select * from {table_name("Training_plan")} where id = %s', [training_id])
    if not rows:
        return None
    row = rows[0]
    row['_meta'] = extract_notes_meta(row.get('notes'))
    return row


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
    rows = authoring_fetch_all(
        AUTHORING_MODULES_TABLE,
        'source_type = %s and source_id = %s',
        ['training_plan', clean_str(training_id)],
        'updated_at desc',
    )
    return rows[0] if rows else None


def attach_training_source_metadata(module_row, training_id):
    catalogue_id = clean_str(module_row.get('module_catalogue_id'))
    if not catalogue_id:
        return
    authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
        **module_row,
        'module_catalogue_id': catalogue_id,
        'source_type': module_row.get('source_type') or 'training_plan',
        'source_id': module_row.get('source_id') or clean_str(training_id),
        'imported_from_training_plan_id': module_row.get('imported_from_training_plan_id') or clean_str(training_id),
    })


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
        'sourceType': 'training_plan',
        'sourceId': training_id,
        'importedFromTrainingPlanId': training_id,
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
        raise ValueError(f'Training_plan {row.get("id")} has invalid explicit module_catalogue_id {invalid_explicit_id}.')
    existing_catalogue_id = training_row_module_catalogue_id(row)
    if existing_catalogue_id:
        if authoring_module_exists(existing_catalogue_id):
            return existing_catalogue_id
        raise ValueError(f'Training_plan {row.get("id")} references missing canonical module {existing_catalogue_id}.')

    base_payload = imported_training_module_payload({**row, 'module_name': module_name})
    payload = {
        **base_payload,
        **overrides,
        'title': module_name,
        'sourceType': 'training_plan',
        'sourceId': clean_str(row.get('id')),
        'importedFromTrainingPlanId': clean_str(row.get('id')),
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
            clean_str(summary.get('importedFromTrainingPlanId')),
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
                    clean_str(summary.get('importedFromTrainingPlanId')),
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
    return settings if isinstance(settings, dict) else {}


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
    ksb_refs = [
        mapping.get('ksb_code') or mapping.get('code')
        for mapping in mappings_by_component.get(component_id, [])
        if mapping.get('ksb_code') or mapping.get('code')
    ]
    ksb_mappings = [
        {
            'id': str(mapping.get('id') or ''),
            'ksbId': str(mapping.get('ksb_id') or mapping.get('ksb_code') or mapping.get('code') or ''),
            'code': str(mapping.get('ksb_code') or mapping.get('code') or ''),
            'description': mapping.get('description') or '',
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
        'type': settings.get('displayType') or display_component_type(row.get('type')),
        'module': module.get('title') or '',
        'programme': module.get('programme_name') or 'Unassigned programme',
        'week': component_week_label(week),
        'weekTitle': week.get('title') or component_week_label(week),
        'duration': duration,
        'expectedOtjh': expected_otjh,
        'ksbRefs': ksb_refs,
        'ksbMappings': ksb_mappings,
        'status': settings.get('componentBuilderStatus') or 'draft',
        'lastEdited': format_date(row.get('updated_at')),
        'contentSections': parse_int(settings.get('contentSections'), 0),
        'quizQuestions': parse_int(settings.get('quizQuestions'), 0) or None,
        'hasResources': bool_payload(settings.get('hasResources')),
    }


def component_builder_rows():
    ensure_module_authoring_tables()
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, order_sql='updated_at desc, display_order, id')
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE)
    mapping_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE)
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
    component_id = canonical_authoring_id('COMP', component_id or payload.get('id'))
    module_catalogue_id, week_id, week_number = component_context_for_payload(payload)
    duration_minutes = max(0, parse_int(payload.get('duration'), 0))
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    existing_expected_otjh = parse_float((component_rows[0] if component_rows else {}).get('expected_otjh'), 2)
    expected_otjh = (
        parse_float(payload.get('expectedOtjh') or payload.get('expected_otjh'), existing_expected_otjh)
        if payload.get('expectedOtjh') not in (None, '') or payload.get('expected_otjh') not in (None, '')
        else existing_expected_otjh
    )
    settings = {
        'displayType': payload.get('type') or 'Self-study',
        'componentBuilderStatus': clean_str(payload.get('status') or 'draft').lower(),
        'durationMinutes': duration_minutes,
        'contentSections': max(0, parse_int(payload.get('contentSections'), 0)),
        'quizQuestions': max(0, parse_int(payload.get('quizQuestions'), 0)) if payload.get('quizQuestions') not in (None, '') else 0,
        'hasResources': bool_payload(payload.get('hasResources')),
    }
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
            'reflection_required': bool_payload(payload.get('reflectionRequired')),
            'workplace_evidence_required': bool_payload(payload.get('workplaceEvidenceRequired')),
            'tutor_validation_required': bool_payload(payload.get('tutorValidationRequired')),
            'display_order': display_order,
            'settings_json': json_db_value(settings),
        })
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id])
        for index, code in enumerate(payload.get('ksbRefs') or []):
            clean_code = clean_str(code).upper()
            if clean_code:
                save_authoring_mapping(module_catalogue_id, {
                    'id': canonical_authoring_id('KSBMAP'),
                    'ksbId': clean_code,
                    'code': clean_code,
                    'description': f'Mapped KSB {clean_code}',
                    'type': 'secondary',
                    'weight': 20,
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


def get_authoring_structure_payload(module_catalogue_id):
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    if not module_rows:
        return None
    module = module_rows[0]
    week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'display_order, week_number, id')
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'display_order, id')
    mapping_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id], 'created_at, id')
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
            'settings': as_json_value(row.get('settings_json'), {}),
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
        'status': module.get('status') or 'draft',
        'sourceType': module.get('source_type') or '',
        'sourceId': module.get('source_id') or '',
        'importedFromTrainingPlanId': module.get('imported_from_training_plan_id') or '',
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
    if payload.get('cohort') or payload.get('group') or payload.get('cohortId') or payload.get('groupId'):
        payload['deliveryMetadata'] = {
            'cohortId': payload.get('cohortId') or '',
            'cohort': payload.get('cohort') or '',
            'groupId': payload.get('groupId') or '',
            'group': payload.get('group') or '',
        }
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


def authoring_catalogue_summaries():
    try:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, order_sql='updated_at desc, title')
        week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE)
        component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE)
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
            'importedFromTrainingPlanId': row.get('imported_from_training_plan_id') or '',
            'sessionsNumber': parse_int(row.get('sessions_number'), 0),
            'startDate': format_date(row.get('start_date')),
            'endDate': format_date(row.get('end_date')),
            'qualityScore': parse_int(row.get('quality_score'), 0),
            'lastUpdated': format_date(row.get('updated_at')),
            'weeks': 0,
            'ksbCount': 0,
            'lessonCount': 0,
            'quizCount': 0,
            'sessionNames': [],
            'ksbCodes': set(),
        }

    for row in week_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        if catalogue_id in summaries:
            summaries[catalogue_id]['weeks'] += 1

    for row in component_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        if not summary:
            continue
        component_type = normalise_component_type(row.get('type'))
        summary['lessonCount'] += 1
        if component_type == 'quiz':
            summary['quizCount'] += 1
        if component_type == 'live_session':
            summary['sessionNames'].append(row.get('title') or '')

    for row in mapping_rows:
        catalogue_id = str(row.get('module_catalogue_id'))
        summary = summaries.get(catalogue_id)
        code = clean_str(row.get('ksb_code'))
        if summary and code:
            summary['ksbCodes'].add(code)

    training_source_ids = unique([
        clean_str(summary.get('sourceId')).replace('training-module-', '', 1)
        for summary in summaries.values()
        if summary.get('sourceType') == 'training_plan' and summary.get('sourceId')
    ])
    training_rows_by_id = {}
    if training_source_ids:
        try:
            placeholders = ','.join(['%s'] * len(training_source_ids))
            for row in fetch_all(f'select * from {table_name("Training_plan")} where id in ({placeholders})', training_source_ids):
                row['_meta'] = extract_notes_meta(row.get('notes'))
                row_id = clean_str(row.get('id'))
                training_rows_by_id[row_id] = row
                training_rows_by_id[f'training-module-{row_id}'] = row
        except Exception:
            logger.debug('Unable to batch read Training_plan rows for authoring summaries.', exc_info=True)

    for summary in summaries.values():
        summary['ksbCount'] = len(summary['ksbCodes'])
        summary['ksbCodes'] = sorted(summary['ksbCodes'])
        if summary.get('sourceType') == 'training_plan' and summary.get('sourceId'):
            training_row = training_rows_by_id.get(clean_str(summary['sourceId']))
            if training_row:
                summary['deliveryStatus'] = delivery_status_for_training_row(training_row)

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
        'deliveryStatus': summary.get('deliveryStatus') or 'unknown',
        'author': '',
        'lastUpdated': summary['lastUpdated'],
        'color': '#6941c6',
        'notes': summary['description'],
        'startDate': summary['startDate'],
        'endDate': summary['endDate'],
        'sessionsNumber': summary['sessionsNumber'],
        'sessionNames': summary['sessionNames'],
        'ksbCodes': summary['ksbCodes'],
        'qualityScore': summary['qualityScore'],
    }


def saved_authoring_catalogue_items():
    items = []
    for summary in authoring_catalogue_summaries().values():
        items.append(authoring_summary_catalogue_item(summary))
    return items


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
                    'ksbCount': ksb_count,
                    'lessons': saved['lessonCount'],
                    'quizzes': saved['quizCount'],
                    'status': module_status,
                    'authoringStatus': saved['status'],
                    'sourceType': module_source_type,
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


def enrich_programmes_with_module_counts(programmes, modules, modules_enriched=False):
    enriched_modules = modules if modules_enriched else enrich_modules_with_authoring(modules)
    enriched_programmes = []
    existing_programme_keys = set()
    for programme in programmes:
        existing_programme_keys.update({
            normalise(programme.get('id')),
            normalise(programme.get('sourceId')),
            normalise(programme.get('name')),
            normalise(programme.get('standard')),
        })
        programme_modules = [module for module in enriched_modules if module_matches_programme(programme, module)]
        if not programme_modules or clean_str(programme.get('structureType')).lower() == 'free':
            enriched_programmes.append(programme)
            continue

        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        enriched_programmes.append({
            **programme,
            'modules': len(programme_modules),
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
        programme_modules = item['modules']
        source_id = item['sourceId']
        programme_name = item['name']
        cohort_keys = {
            normalise(module.get('cohortId') or module.get('cohort'))
            for module in programme_modules
            if normalise(module.get('cohortId') or module.get('cohort'))
        }
        group_keys = {
            normalise(module.get('groupId') or module.get('group'))
            for module in programme_modules
            if normalise(module.get('groupId') or module.get('group'))
        }
        session_count = sum(parse_int(module.get('weeks') or module.get('sessionsNumber') or module.get('sessions'), 0) for module in programme_modules)
        enriched_programmes.append({
            'id': f'program-{slugify(source_id)}',
            'sourceId': source_id,
            'name': programme_name,
            'standard': programme_name,
            'level': infer_level(programme_name),
            'status': 'planned',
            'modules': len(programme_modules),
            'groups': len(group_keys),
            'weeks': session_count,
            'ksbMapped': 0,
            'ksbTotal': 0,
            'learners': 0,
            'cohorts': len(cohort_keys),
            'lastUpdated': max([clean_str(module.get('lastUpdated')) for module in programme_modules] or ['']),
            'owner': '',
            'color': clean_str(programme_modules[0].get('color')) or '#6941c6',
            'description': '',
            'structureType': 'scheduled',
            'freeComponents': 0,
        })
    return enriched_programmes


def save_authoring_mapping(module_catalogue_id, mapping, week_id=None, component_id=None):
    mapping_id = canonical_authoring_id('KSBMAP', mapping.get('id'))
    source_type, source_id = source_payload_from_mapping(mapping)
    if component_id:
        ensure_authoring_mapping_unique(component_id, mapping, mapping_id=mapping_id)
    authoring_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], {
        'id': mapping_id,
        'module_catalogue_id': module_catalogue_id,
        'week_id': week_id,
        'component_id': component_id,
        'ksb_id': mapping.get('ksbId') or mapping.get('ksb_id') or mapping.get('code'),
        'ksb_code': coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or ''),
        'ksb_description': mapping.get('description') or mapping.get('ksbDescription') or '',
        'source_type': source_type,
        'source_id': source_id,
        'classification': normalise_ksb_classification(mapping.get('type') or mapping.get('classification')),
        'weight': normalise_ksb_weight(mapping.get('weight')),
    })


def save_module_authoring_structure(module_catalogue_id, payload):
    validation_errors = validate_module_authoring_payload(payload)
    if validation_errors:
        raise ModuleAuthoringValidationError(validation_errors)
    module_catalogue_id = unique_module_catalogue_id(module_catalogue_id or payload.get('catalogueId') or payload.get('moduleCatalogueId'))
    weeks = payload.get('weekStructure') or payload.get('weeks') or []
    checklist, quality_score = module_authoring_quality_check({**payload, 'weekStructure': weeks})
    all_components = [component for week in weeks for component in (week.get('components') or [])]
    total_otjh = sum(component_expected_otjh(component) for component in all_components)
    declared_total = payload.get('declaredTotalOtjh')
    if declared_total in (None, ''):
        declared_total = total_otjh
    programme_name = payload.get('programmeName') or payload.get('programme') or 'Unassigned programme'
    programme = ensure_programme_config_for_authoring(
        programme_name,
        payload.get('programmeId') or payload.get('programme_id'),
        payload.get('status') or 'planned',
    )
    programme_id = (programme or {}).get('sourceId') or payload.get('programmeId') or payload.get('programme_id') or programme_name
    delivery_metadata = payload.get('deliveryMetadata') if isinstance(payload.get('deliveryMetadata'), dict) else {}
    cohort_id = clean_str(payload.get('cohortId') or payload.get('cohort_id') or delivery_metadata.get('cohortId') or delivery_metadata.get('cohort_id'))
    cohort_name = clean_str(payload.get('cohortName') or payload.get('cohort_name') or payload.get('cohort') or delivery_metadata.get('cohort'))
    group_id = clean_str(payload.get('groupId') or payload.get('group_id') or delivery_metadata.get('groupId') or delivery_metadata.get('group_id'))
    group_name = clean_str(payload.get('groupName') or payload.get('group_name') or payload.get('group') or delivery_metadata.get('group'))

    with transaction.atomic():
        authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'cohort_id': cohort_id,
            'cohort_name': cohort_name,
            'group_id': group_id,
            'group_name': group_name,
            'title': payload.get('title') or payload.get('name') or f'Module {module_catalogue_id}',
            'description': payload.get('description') or '',
            'status': clean_str(payload.get('status') or 'draft').lower(),
            'sessions_number': payload.get('sessionsNumber') or payload.get('sessions_number') or len(weeks),
            'start_date': payload.get('startDate') or payload.get('start_date') or None,
            'end_date': payload.get('endDate') or payload.get('end_date') or None,
            'total_otjh': declared_total,
            'quality_score': quality_score,
            'source_type': payload.get('sourceType') or payload.get('source_type') or None,
            'source_id': payload.get('sourceId') or payload.get('source_id') or None,
            'imported_from_training_plan_id': payload.get('importedFromTrainingPlanId') or payload.get('imported_from_training_plan_id') or None,
        })
        authoring_delete(AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
        authoring_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])

        for week_index, week in enumerate(weeks):
            week_id = canonical_authoring_id('WEEK', week.get('id'))
            authoring_upsert(AUTHORING_WEEKS_TABLE, ['id'], {
                'id': week_id,
                'module_catalogue_id': module_catalogue_id,
                'week_number': parse_int(week.get('weekNumber') or week.get('week_number'), week_index + 1),
                'title': week.get('title') or f'Week {week_index + 1}',
                'summary': week.get('summary') or '',
                'learning_outcomes': json_db_value(week.get('learningOutcomes') or []),
                'display_order': week_index,
            })
            for mapping in week.get('ksbMappings') or []:
                save_authoring_mapping(module_catalogue_id, mapping, week_id=week_id)
            for component_index, component in enumerate(week.get('components') or []):
                component_id = canonical_authoring_id('COMP', component.get('id'))
                authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
                    'id': component_id,
                    'week_id': week_id,
                    'module_catalogue_id': module_catalogue_id,
                    'type': normalise_component_type(component.get('type')),
                    'title': component.get('title') or '',
                    'description': component.get('description') or '',
                    'expected_otjh': component_expected_otjh(component),
                    'points': parse_int(component.get('points'), 0),
                    'reflection_required': bool_payload(component.get('reflectionRequired')),
                    'workplace_evidence_required': bool_payload(component.get('workplaceEvidenceRequired')),
                    'tutor_validation_required': bool_payload(component.get('tutorValidationRequired')),
                    'display_order': component_index,
                    'settings_json': json_db_value(component.get('settings') or {}),
                })
                for mapping in component.get('ksbMappings') or []:
                    save_authoring_mapping(module_catalogue_id, mapping, week_id=week_id, component_id=component_id)
        for mapping in payload.get('moduleKsbMappings') or []:
            save_authoring_mapping(module_catalogue_id, mapping)

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
        'workplace_evidence_required': bool_payload(component.get('workplaceEvidenceRequired') or component.get('workplace_evidence_required')),
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
    components = free_programme_fetch_all(
        FREE_PROGRAMME_COMPONENTS_TABLE,
        'programme_id = %s',
        [programme_id],
        'display_order, title',
    )
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
            components = module.get('components') if isinstance(module.get('components'), list) else []
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


def update_training_rows(rows, payload):
    where_sql, params = training_row_where_ids(rows)
    if not where_sql:
        return []
    return update_rows('Training_plan', where_sql, params, payload)


def archive_training_rows(rows):
    where_sql, params = training_row_where_ids(rows)
    if not where_sql:
        return []
    payload = archive_payload('Training_plan', rows[0].get('notes') if rows else '')
    if not payload:
        payload = {'notes': append_notes_meta(rows[0].get('notes') if rows else '', {'archived': 'true', 'archived_at': now_iso()})}
    return update_rows('Training_plan', where_sql, params, payload)


def restore_training_rows(rows):
    where_sql, params = training_row_where_ids(rows)
    if not where_sql:
        return []
    payload = restore_payload('Training_plan', rows[0].get('notes') if rows else '')
    if not payload:
        return []
    return update_rows('Training_plan', where_sql, params, payload)


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
        lambda: enrich_programmes_with_module_counts(payload['programmes'], enriched_modules, modules_enriched=True),
    )
    return curriculum_collection_response(
        payload,
        'programmes',
        programmes,
    )


@require_GET
def curriculum_programme_tree_detail(request, identifier):
    payload = get_cached_payload(request)
    programme = find_programme(payload, identifier)
    if not programme:
        return json_error('Programme not found.', status=404)

    cohorts = [
        cohort for cohort in payload['cohorts']
        if matches_curriculum_identifier(cohort.get('programmeId'), programme.get('id'))
        or matches_curriculum_identifier(cohort.get('programme'), programme.get('name'))
    ]
    cohort_ids = {cohort['id'] for cohort in cohorts}
    groups = [group for group in payload['groups'] if group.get('cohortId') in cohort_ids]
    group_ids = {group['id'] for group in groups}
    enriched_modules = enrich_modules_with_authoring(payload['modules'])
    modules = [
        module for module in payload['modules']
        if matches_curriculum_identifier(module.get('programmeId'), programme.get('id'))
        or normalise(module.get('programme')) == normalise(programme.get('name'))
    ]
    modules = [
        module for module in enriched_modules
        if module_matches_programme(programme, module)
    ] or modules
    sessions = [
        session for session in payload['sessions']
        if matches_curriculum_identifier(session.get('programmeId'), programme.get('id'))
        or normalise(session.get('programme')) == normalise(programme.get('name'))
    ]

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

    return JsonResponse({
        'schema': payload['schema'],
        'programme': programme,
        'cohorts': nested_cohorts,
        'flat': {
            'cohorts': cohorts,
            'groups': groups,
            'groupIds': list(group_ids),
            'modules': modules,
            'sessions': sessions,
        },
    })


@csrf_exempt
def curriculum_programme_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)

    if request.method == 'DELETE':
        programme, rows = rows_for_programme(identifier, 'all')
        config = programme_config_by_identifier(identifier)
        if not programme and not config:
            return json_error('Programme not found.', status=404)
        if truthy(request.GET.get('permanent')) or truthy(request.GET.get('hard_delete')):
            has_operational_rows = any(is_operational_training_row(row) for row in rows)
            is_archived = (
                clean_str((programme or {}).get('status')).lower() == 'archived'
                or is_archived_program_config(config)
                or (bool(rows) and not has_operational_rows)
            )
            if not is_archived or has_operational_rows:
                return json_error('Archive the programme before permanently deleting it.', status=409)

            where_sql, params = training_row_where_ids(rows)
            if where_sql:
                delete_rows('Training_plan', where_sql, params)
            if config:
                key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
                key_value = config.get(key_column)
                if key_value is not None:
                    delete_rows(
                        'training_plan_program_configs',
                        f'{quote_ident(key_column)} = %s',
                        [key_value],
                    )
            invalidate_curriculum_cache()
            return JsonResponse({'deleted': True, 'permanent': True, 'id': identifier})
        if rows:
            archive_training_rows(rows)
        if config:
            ensure_program_config_archive_columns()
            archive_updates = archive_payload('training_plan_program_configs')
            if has_column('training_plan_program_configs', 'status'):
                archive_updates['status'] = 'archived'
            if has_column('training_plan_program_configs', 'updated_at'):
                archive_updates['updated_at'] = datetime.utcnow()
            key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
            key_value = config.get(key_column)
            if archive_updates:
                update_rows(
                    'training_plan_program_configs',
                    f'{quote_ident(key_column)} = %s',
                    [key_value],
                    archive_updates,
                )
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'archived': True, 'id': identifier})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')

    name = clean_str(payload.get('name'))
    status_value = clean_str(payload.get('status')).lower() if 'status' in payload else None
    ensure_program_config_archive_columns()
    structure_type = programme_structure_type(payload, (programme_config_by_identifier(identifier) or {}).get('structure_type') or 'scheduled')
    config = programme_config_by_identifier(identifier)
    programme, rows = rows_for_programme(identifier, 'all')
    if not config and not programme:
        return json_error('Programme not found.', status=404)
    if not config and programme:
        source_id = unique_program_id(programme.get('sourceId') or name or programme.get('name'), get_program_config_rows())
        config = insert_row('training_plan_program_configs', {
            'program_id': source_id,
            'name': name or programme.get('name'),
            'sub': payload.get('standard') or programme.get('standard') or name or programme.get('name'),
            'standard': payload.get('standard') or programme.get('standard') or name or programme.get('name'),
            'level': payload.get('level') or programme.get('level'),
            'status': payload.get('status') or programme.get('status') or 'active',
            'owner': payload.get('owner') or programme.get('owner') or '',
            'created_by': payload.get('owner') or programme.get('owner') or '',
            'color': payload.get('color') or programme.get('color') or '#6941c6',
            'description': payload.get('description') or programme.get('description') or '',
            'structure_type': structure_type,
            'is_active': payload.get('status') != 'archived',
            'is_archived': payload.get('status') == 'archived',
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })

    if config:
        if 'status' in payload:
            config = programme_config_by_identifier(identifier) or config
        updates = {
            'name': name or config.get('name'),
            'sub': payload.get('standard'),
            'standard': payload.get('standard'),
            'level': payload.get('level'),
            'status': status_value,
            'owner': payload.get('owner'),
            'created_by': payload.get('owner'),
            'color': payload.get('color') or config.get('color'),
            'description': payload.get('description'),
            'structure_type': structure_type,
            'is_active': False if status_value == 'archived' else (True if status_value in {'active', 'planned', 'draft', 'published'} else None),
            'is_archived': True if status_value == 'archived' else (False if status_value in {'active', 'planned', 'draft', 'published'} else None),
            'updated_at': datetime.utcnow(),
        }
        try:
            key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
        except Exception:
            key_column = 'program_id' if existing_config.get('program_id') else 'id'
        key_value = config.get(key_column)
        update_rows('training_plan_program_configs', f'{quote_ident(key_column)} = %s', [key_value], updates)

    if rows and name:
        update_training_rows(rows, {'Program': name})
    if rows and clean_str(payload.get('status')).lower() == 'archived':
        archive_training_rows(rows)
    elif rows and status_value in {'active', 'planned', 'draft', 'published'}:
        restore_training_rows(rows)

    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'programme': programme_response(identifier) or programme_response(name) or {'id': identifier}})


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
        existing_response = programme_response(existing_config.get('program_id') or existing_config.get('id') or name)
        if not is_archived_program_config(existing_config) and clean_str((existing_response or {}).get('status')).lower() != 'archived':
            if existing_config_by_id:
                key_value = existing_config.get('program_id') or existing_config.get('id') or explicit_program_id
                return JsonResponse({'created': False, 'programme': existing_response or {'sourceId': key_value, 'name': existing_config.get('name') or name}})
            return json_error('Programme already exists.', status=409)
        if is_archived_program_config(existing_config) or clean_str((existing_response or {}).get('status')).lower() == 'archived':
            archived_reuse_program_id = f'{existing_config.get("program_id") or existing_config.get("id") or slugify(name)}-2'
            existing_config = None
    if existing_config:
        status_value = clean_str(payload.get('status') or existing_config.get('status') or 'planned').lower()
        updates = {
            'name': name,
            'sub': payload.get('standard') or payload.get('sub') or existing_config.get('sub') or existing_config.get('standard') or name,
            'standard': payload.get('standard') or existing_config.get('standard') or existing_config.get('sub') or name,
            'level': payload.get('level') or existing_config.get('level'),
            'status': status_value,
            'owner': payload.get('owner') or existing_config.get('owner'),
            'created_by': payload.get('owner') or existing_config.get('created_by'),
            'color': payload.get('color') or existing_config.get('color') or '#6941c6',
            'description': payload.get('description') if 'description' in payload else existing_config.get('description'),
            'structure_type': programme_structure_type(payload, existing_config.get('structure_type') or 'scheduled'),
            'is_active': status_value != 'archived',
            'is_archived': status_value == 'archived',
            'updated_at': datetime.utcnow(),
        }
        try:
            key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
        except Exception:
            key_column = 'program_id' if existing_config.get('program_id') else 'id'
        key_value = existing_config.get(key_column)
        update_rows('training_plan_program_configs', f'{quote_ident(key_column)} = %s', [key_value], updates)
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'programme': programme_response(key_value) or programme_response(name) or {'sourceId': key_value, 'name': name}})

    source_id = archived_reuse_program_id or unique_program_id(explicit_program_id or name, program_configs)
    insert_payload = {
        'program_id': source_id,
        'name': name,
        'sub': payload.get('standard') or payload.get('sub') or name,
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'status': payload.get('status') or 'planned',
        'structure_type': structure_type,
        'is_active': True,
        'is_archived': False,
        'created_at': datetime.utcnow(),
        'updated_at': datetime.utcnow(),
    }
    row = insert_row('training_plan_program_configs', insert_payload)
    invalidate_curriculum_cache()
    source_id = row.get('program_id') or row.get('id') or source_id
    return JsonResponse({'created': True, 'programme': programme_response(source_id) or {'sourceId': source_id, 'name': row.get('name')}}, status=201)


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
            'status': payload.get('status') or 'draft',
            'sessionsNumber': payload.get('sessionsNumber') or payload.get('sessions_number') or 0,
            'startDate': payload.get('startDate') or payload.get('start_date') or '',
            'endDate': payload.get('endDate') or payload.get('end_date') or '',
            'declaredTotalOtjh': payload.get('totalOtjh') or 0,
            'moduleKsbMappings': payload.get('moduleKsbMappings') or [],
            'completionCriteria': payload.get('completionCriteria') or default_completion_payload(),
            'advancedDetails': payload.get('advancedDetails') or {},
            'background': payload.get('background') or '',
            'epaRequirements': payload.get('epaRequirements') or [],
            'qualificationOutcomes': payload.get('qualificationOutcomes') or [],
            'weekStructure': payload.get('weekStructure') or [],
            'sourceType': payload.get('sourceType') or payload.get('source_type') or 'authoring',
            'sourceId': payload.get('sourceId') or payload.get('source_id') or None,
            'importedFromTrainingPlanId': payload.get('importedFromTrainingPlanId') or payload.get('imported_from_training_plan_id') or None,
        }
        try:
            result = save_module_authoring_structure(module_catalogue_id, module_payload)
            if clean_str(module_payload.get('sourceType')).lower() == 'training_plan' and module_payload.get('sourceId'):
                link_training_row_to_catalogue(module_payload.get('sourceId'), result.get('catalogueId') or module_catalogue_id)
        except ModuleAuthoringValidationError as exc:
            return json_error('Module authoring validation failed.', status=400, validationErrors=exc.errors)
        return JsonResponse({'created': True, 'moduleCatalogueId': result.get('catalogueId') or module_catalogue_id, 'module': result}, status=201)

    missing = require_fields(payload, ['name'])
    if missing:
        return json_error('Missing required fields.', fields=missing)

    name = clean_str(payload.get('name'))
    duplicate = next((row for row in get_module_rows() if normalise(row.get('Module_name')) == normalise(name)), None)
    if duplicate:
        return json_error('Module already exists.', status=409)

    row = insert_row('Modules', {
        'Module_name': name,
        'Number of sessions': parse_int(payload.get('weeks'), 1),
        'Module_colour': payload.get('color') or '#6941c6',
        'Notes': payload.get('notes') or '',
        'session_ksb_json': json.dumps(payload.get('ksbMappings') or []),
    })
    invalidate_curriculum_cache()
    source_id = row.get('Module ID') or row.get('id') or row.get('Module_name')
    return JsonResponse({'created': True, 'module': module_response(source_id) or row}, status=201)


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
                'importedFromTrainingPlanId': payload.get('importedFromTrainingPlanId') or training_id,
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
        return json_error('Uploads are only supported for podcast and PowerPoint components.', status=400)

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
            module_rows = [*linked_rows, *legacy_rows]
        else:
            # Temporary compatibility for older rows. Remove after all delivery rows
            # have a canonical Training_plan.module_catalogue_id link.
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
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, f'module_catalogue_id in ({placeholders})', module_ids)
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


def required_ksbs_for_request(request, module_rows):
    source_type, source_id = split_ksb_source(
        request.GET.get('source_type') or request.GET.get('sourceType') or '',
        request.GET.get('source_id') or request.GET.get('sourceId') or '',
    )
    if not source_type or not source_id:
        source_type, source_id = infer_source_from_scope(module_rows)
    return required_ksbs_for_source(source_type, source_id)


def coverage_response(request, scope='', identifier=''):
    module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data(scope, identifier)
    if identifier and scope in {'module', 'week', 'component', 'programme', 'cohort'} and not module_rows:
        return json_error(f'{scope.title()} not found.', status=404)
    coverage = build_coverage(required_ksbs_for_request(request, module_rows), mapping_rows, module_rows, week_rows, component_rows)
    return JsonResponse({
        'scope': scope or 'all',
        'identifier': identifier,
        **coverage,
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
        rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], 'created_at, id')
        coverage = build_coverage([], rows, module_rows, week_rows, components)
        mappings = [mapping for item in coverage['items'] for mapping in item['mappings']]
        return JsonResponse({'componentId': component_id, 'count': len(mappings), 'results': mappings})

    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    mappings = payload.get('mappings') if isinstance(payload.get('mappings'), list) else [payload]
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
        training_id = ident.replace('training-module-', '', 1)
        rows = fetch_all(f'select * from {table_name("Training_plan")} where id = %s', [training_id])
        if not rows:
            return json_error('Module not found.', status=404)
        if request.method == 'DELETE':
            archive_training_rows(rows)
            # Delivery archive must not destroy reusable Module Builder authoring content.
            invalidate_curriculum_cache()
            return JsonResponse({'archived': True, 'preservedAuthoring': True, 'id': identifier})
        payload = json_body(request)
        if payload is None:
            return json_error('Invalid JSON body.')
        next_notes = replace_visible_notes_preserving_meta(rows[0].get('notes'), payload.get('notes')) if 'notes' in payload else rows[0].get('notes')
        updates = {
            'module_name': payload.get('name'),
            'sessions_number': payload.get('weeks'),
            'start_date': payload.get('startDate'),
            'end_date': payload.get('endDate'),
            'Tutor_name': payload.get('tutor'),
            'coach_name': payload.get('coach'),
            'session_week_day': payload.get('weekDays'),
            'session_start_time': payload.get('startTime'),
            'session_end_time': payload.get('endTime'),
            'notes': next_notes,
        }
        if 'color' in payload:
            updates['notes'] = append_notes_meta(next_notes, {
                'module_color': payload.get('color') or '',
            })
        requested_catalogue_id = clean_str(payload.get('moduleCatalogueId') or payload.get('catalogueId') or payload.get('moduleId'))
        if requested_catalogue_id:
            linked_payload = canonical_module_link_payload({**rows[0], 'notes': updates.get('notes') or next_notes}, requested_catalogue_id)
            updates.update(linked_payload)
        update_training_rows(rows, updates)
        invalidate_curriculum_cache()
        return JsonResponse({'updated': True, 'module': module_response(identifier) or {'id': identifier}})

    if request.method == 'DELETE' and not ident.startswith('catalogue-module-') and authoring_module_exists(ident):
        delete_module_authoring_structure(ident)
        invalidate_curriculum_cache()
        return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})

    module_id = ident.replace('catalogue-module-', '', 1)
    key_column = 'Module ID' if has_column('Modules', 'Module ID') else 'id'
    rows = fetch_all(f'select * from {table_name("Modules")} where {quote_ident(key_column)} = %s', [module_id])
    if not rows:
        if request.method == 'DELETE' and delete_module_authoring_structure(ident):
            return JsonResponse({'deleted': True, 'deletedAuthoring': True, 'id': identifier})
        return json_error('Module not found.', status=404)

    if request.method == 'DELETE':
        update_rows('Modules', f'{quote_ident(key_column)} = %s', [module_id], archive_payload('Modules', rows[0].get('Notes')))
        delete_module_authoring_structure(ident)
        delete_module_authoring_structure(module_id)
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'deletedAuthoring': True, 'id': identifier})

    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    updates = {
        'Module_name': payload.get('name'),
        'Number of sessions': payload.get('weeks'),
        'Module_colour': payload.get('color'),
        'Notes': payload.get('notes'),
        'session_ksb_json': json.dumps(payload.get('ksbMappings')) if 'ksbMappings' in payload else None,
    }
    update_rows('Modules', f'{quote_ident(key_column)} = %s', [module_id], updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'module': module_response(identifier) or {'id': identifier}})


@require_GET
def curriculum_ksb_frameworks(request):
    return curriculum_collection_response(get_cached_payload(request), 'ksbFrameworks')


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
    row = insert_row('ksb_profiles', {
        'name': name,
        'programme_name': payload.get('programmeName') or payload.get('programme'),
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
    ident = clean_str(identifier).replace('ksb-', '', 1)
    rows = fetch_all(f'select * from {table_name("ksb_profiles")} where id = %s', [ident])
    if not rows:
        return json_error('KSB framework not found.', status=404)
    if request.method == 'GET':
        payload = get_cached_payload(request)
        framework_id = f'ksb-{ident}'
        framework = next((item for item in payload.get('ksbFrameworks', []) if item.get('id') == framework_id), None)
        ksb_set = next((item for item in payload.get('ksbSets', []) if item.get('frameworkId') == framework_id), None)
        if not framework:
            return json_error('KSB framework not found.', status=404)
        return JsonResponse({**framework, 'definitions': (ksb_set or {}).get('ksbs', [])})
    if request.method == 'DELETE':
        update_rows('ksb_profiles', 'id = %s', [ident], archive_payload('ksb_profiles'))
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    updates = {
        'name': payload.get('name'),
        'programme_name': payload.get('programmeName') or payload.get('programme'),
        'description': payload.get('description'),
        'knowledge_codes': json.dumps(payload.get('knowledgeCodes')) if 'knowledgeCodes' in payload else None,
        'skill_codes': json.dumps(payload.get('skillCodes')) if 'skillCodes' in payload else None,
        'behaviour_codes': json.dumps(payload.get('behaviourCodes')) if 'behaviourCodes' in payload else None,
        'ksb_items': json.dumps(payload.get('ksbItems')) if 'ksbItems' in payload else None,
        'is_active': payload.get('isActive'),
        'updated_at': datetime.utcnow(),
    }
    update_rows('ksb_profiles', 'id = %s', [ident], updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


@require_GET
def curriculum_ksb_sets(request):
    return curriculum_collection_response(get_cached_payload(request), 'ksbSets')


@require_GET
def curriculum_cohorts(request):
    sync_cohort_authoring_details_from_training()
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


def create_curriculum_cohort(payload):
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
    duplicate = next((
        row for row in get_training_rows()
        if (
            clean_str(row.get('_meta', {}).get('cohort_id')) == clean_str(cohort_id)
            or (
                not programme_id
                and normalise(row.get('Program')) == normalise(programme)
                and normalise(row.get('Cohort_name')) == normalise(name)
            )
        )
    ), None)
    if duplicate:
        return json_error('Cohort already exists for programme.', status=409)
    duration_months = payload.get('durationMonths') or 24
    end_date = payload.get('endDate') or format_date(calculate_cohort_end_date(payload.get('startDate'), duration_months))
    notes = append_notes_meta(payload.get('notes') or '', {
        'program_id': programme_id,
        'cohort_id': cohort_id,
        'cohort_color': payload.get('color') or '',
        'duration_months': duration_months or '',
        'cohort_end_auto': 'true' if end_date and not payload.get('endDate') else 'false',
        'holiday_ids': '|'.join(parse_notes_id_list(payload.get('holidayIds') or payload.get('holiday_ids'))),
    })
    with transaction.atomic():
        row = insert_row('Training_plan', {
            'Program': programme,
            'Cohort_name': name,
            'Starting_date_lable': payload.get('startDate'),
            'start_date': payload.get('startDate'),
            'end_date': end_date,
            'module_name': payload.get('moduleName'),
            'sessions_number': payload.get('sessionsNumber') or 0,
            'notes': notes,
            'is_archived': False,
        })
        if clean_str(payload.get('moduleName')):
            catalogue_id = ensure_canonical_module_for_training_row(row, {
                'programmeId': programme_id,
                'programmeName': programme,
                'cohortId': cohort_id,
                'cohortName': name,
                'sessionsNumber': payload.get('sessionsNumber') or 0,
                'startDate': payload.get('startDate'),
                'endDate': end_date,
            })
            row[TRAINING_MODULE_CATALOGUE_COLUMN] = catalogue_id
        authoring_cohort = {
            'id': cohort_id,
            'name': name,
            'programme': programme,
            'programmeId': programme_id or f'program-{slugify(programme)}',
            'startDate': payload.get('startDate'),
            'endDate': end_date,
            'status': title_case_status(False, payload.get('startDate'), end_date),
            'color': payload.get('color') or '',
            'holidayIds': parse_notes_id_list(payload.get('holidayIds') or payload.get('holiday_ids')),
            'groups': [],
            'modules': [],
        }
        authoring_row = {
            **row,
            'id': row.get('id'),
            'Program': programme,
            'Cohort_name': name,
            'Starting_date_lable': payload.get('startDate'),
            'start_date': payload.get('startDate'),
            'end_date': end_date,
            'notes': notes,
            '_meta': extract_notes_meta(notes),
        }
        persist_cohort_authoring_detail(
            authoring_cohort,
            [authoring_row],
            [],
            payload.get('holidays') or payload.get('holidayDetails') or payload.get('linkedHolidays') or [],
        )
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'cohort': row}, status=201)


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
    cohort, rows = find_training_rows_by_cohort(identifier)
    if not cohort or not rows:
        return json_error('Cohort not found.', status=404)
    if request.method == 'DELETE':
        archive_training_rows(rows)
        persist_cohort_authoring_detail(cohort, rows, [], [], {'status': 'archived'})
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    duration_months = payload.get('durationMonths')
    computed_end = format_date(calculate_cohort_end_date(payload.get('startDate') or cohort.get('startDate'), duration_months)) if duration_months else ''
    end_date = payload.get('endDate') or computed_end or cohort.get('endDate')
    updates = {
        'Cohort_name': payload.get('name'),
        'Starting_date_lable': payload.get('startDate'),
        'start_date': payload.get('startDate'),
        'end_date': end_date,
    }
    if 'color' in payload or 'durationMonths' in payload or 'holidayIds' in payload or 'holiday_ids' in payload:
        existing_meta = extract_notes_meta(rows[0].get('notes'))
        next_holiday_ids = (
            parse_notes_id_list(payload.get('holidayIds') if 'holidayIds' in payload else payload.get('holiday_ids'))
            if ('holidayIds' in payload or 'holiday_ids' in payload)
            else parse_notes_id_list(existing_meta.get('holiday_ids'))
        )
        updates['notes'] = append_notes_meta(rows[0].get('notes'), {
            'cohort_color': payload.get('color') or cohort.get('color') or '',
            'duration_months': duration_months or '',
            'cohort_end_auto': 'true' if computed_end and not payload.get('endDate') else 'false',
            'holiday_ids': '|'.join(next_holiday_ids),
        })
    updated_rows = update_training_rows(rows, updates)
    next_meta = extract_notes_meta(updates.get('notes') or rows[0].get('notes'))
    authoring_cohort = {
        **cohort,
        'name': payload.get('name') or cohort.get('name'),
        'startDate': payload.get('startDate') or cohort.get('startDate'),
        'endDate': end_date,
        'color': payload.get('color') or cohort.get('color') or next_meta.get('cohort_color') or '',
        'holidayIds': next_holiday_ids if 'next_holiday_ids' in locals() else cohort.get('holidayIds') or parse_notes_id_list(next_meta.get('holiday_ids')),
        'status': title_case_status(False, payload.get('startDate') or cohort.get('startDate'), end_date),
    }
    persist_cohort_authoring_detail(
        authoring_cohort,
        updated_rows or rows,
        [],
        payload.get('holidays') or payload.get('holidayDetails') or payload.get('linkedHolidays') or [],
    )
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


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
    missing = require_fields(payload, ['name', 'cohortId'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    cohort, cohort_rows = find_training_rows_by_cohort(payload.get('cohortId'))
    if not cohort or not cohort_rows:
        return json_error('Parent cohort not found.', status=404)
    group_name = clean_str(payload.get('name'))
    group_id = unique_group_id(payload.get('id') or payload.get('groupId') or payload.get('group_id'))
    duplicate = next((
        row for row in cohort_rows
        if (
            clean_str(row.get('_meta', {}).get('group_id')) == clean_str(group_id)
            or (
                not payload.get('id') and not payload.get('groupId') and not payload.get('group_id') and normalise(row.get('group_name') or row.get('_meta', {}).get('group_name')) == normalise(group_name)
            )
        )
    ), None)
    if duplicate:
        return json_error('Group already exists in cohort.', status=409)
    programme = cohort.get('programme')
    notes = append_notes_meta(payload.get('notes') or '', {
        'program_id': clean_str(payload.get('programmeId') or payload.get('programme_id') or ''),
        'cohort_id': cohort['id'],
        'group_id': group_id,
        'group_name': group_name,
        'group_color': payload.get('color') or '',
    })
    with transaction.atomic():
        row = insert_row('Training_plan', {
            'Program': programme,
            'Cohort_name': cohort.get('name'),
            'group_name': group_name,
            'Tutor_name': payload.get('tutor'),
            'coach_name': payload.get('coach'),
            'start_date': payload.get('startDate') or cohort.get('startDate'),
            'end_date': payload.get('endDate') or cohort.get('endDate'),
            'module_name': payload.get('moduleName'),
            'sessions_number': payload.get('sessionsNumber') or 0,
            'session_week_day': payload.get('weekDays'),
            'session_start_time': payload.get('startTime'),
            'session_end_time': payload.get('endTime'),
            'notes': notes,
            'is_archived': False,
        })
        if clean_str(payload.get('moduleName')):
            catalogue_id = ensure_canonical_module_for_training_row(row, {
                'programmeId': payload.get('programmeId') or cohort.get('programmeId') or '',
                'programmeName': programme,
                'cohortId': cohort['id'],
                'cohortName': cohort.get('name') or '',
                'groupId': group_id,
                'groupName': group_name,
                'sessionsNumber': payload.get('sessionsNumber') or 0,
                'startDate': payload.get('startDate') or cohort.get('startDate'),
                'endDate': payload.get('endDate') or cohort.get('endDate'),
            })
            row[TRAINING_MODULE_CATALOGUE_COLUMN] = catalogue_id
    invalidate_curriculum_cache()
    return JsonResponse({'created': True, 'group': row}, status=201)


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
    group, rows = find_training_rows_by_group(identifier)
    if not group or not rows:
        return json_error('Group not found.', status=404)
    if request.method == 'DELETE':
        archive_training_rows(rows)
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    updates = {
        'group_name': payload.get('name'),
        'Tutor_name': payload.get('tutor'),
        'coach_name': payload.get('coach'),
        'start_date': payload.get('startDate'),
        'end_date': payload.get('endDate'),
        'session_week_day': payload.get('weekDays'),
        'session_start_time': payload.get('startTime'),
        'session_end_time': payload.get('endTime'),
    }
    if 'color' in payload:
        updates['notes'] = append_notes_meta(rows[0].get('notes'), {
            'group_color': payload.get('color') or group.get('color') or '',
        })
    update_training_rows(rows, updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


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
    if not isinstance(modules, list) or not modules:
        return json_error('At least one module is required.', fields=['modules'])

    group, cohort, existing_rows = find_group_with_parent(identifier)
    if not group or not cohort:
        return json_error('Group not found.', status=404)

    existing_names = {normalise(row.get('module_name')) for row in existing_rows if row.get('module_name')}
    existing_catalogue_ids = {training_row_module_catalogue_id(row) for row in existing_rows if training_row_module_catalogue_id(row)}
    created_rows = []
    skipped = []

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
        legacy_requested_id = requested_value if requested_value and not requested_catalogue_id else ''
        if requested_catalogue_id and requested_catalogue_id in existing_catalogue_ids:
            skipped.append(module_name)
            continue
        if not requested_catalogue_id and normalise(module_name) in existing_names:
            skipped.append(module_name)
            continue

        start_date = item.get('startDate') or group.get('startDate') or cohort.get('startDate')
        delivery_days = item.get('weekDays') or group.get('schedule')
        session_count = item.get('sessionsNumber') or item.get('weeks') or 0
        session_plan = build_module_session_plan(start_date, session_count, delivery_days, item.get('holidays') or item.get('linkedHolidays') or [])
        end_date = item.get('endDate') or session_plan.get('finalEndDate') or group.get('endDate') or cohort.get('endDate')
        group_id = group['id']
        notes = append_notes_meta(item.get('notes') or '', {
            'program_id': clean_str(item.get('programmeId') or item.get('programme_id') or ''),
            'cohort_id': cohort['id'],
            'group_id': group_id,
            'group_name': group['name'],
            'module_catalogue_id': requested_catalogue_id,
            'legacy_module_id': legacy_requested_id,
            'module_color': item.get('color') or '',
            'module_end_auto': 'true' if session_plan.get('finalEndDate') and not item.get('endDate') else 'false',
            'skipped_holidays': ','.join(session_plan.get('skippedHolidays') or []),
        })
        insert_payload = {
            'Program': cohort.get('programme') or group.get('programme'),
            'Cohort_name': cohort.get('name'),
            'group_name': group.get('name'),
            'module_name': module_name,
            'sessions_number': session_count,
            'Tutor_name': item.get('tutor') or group.get('tutor'),
            'coach_name': item.get('coach') or group.get('coach'),
            'Starting_date_lable': cohort.get('startDate'),
            'start_date': start_date,
            'end_date': end_date,
            'session_week_day': delivery_days,
            'session_start_time': item.get('startTime'),
            'session_end_time': item.get('endTime'),
            'notes': notes,
            'is_archived': False,
        }
        if requested_catalogue_id and has_column('Training_plan', TRAINING_MODULE_CATALOGUE_COLUMN):
            insert_payload[TRAINING_MODULE_CATALOGUE_COLUMN] = requested_catalogue_id
        with transaction.atomic():
            row = insert_row('Training_plan', insert_payload)
            canonical_catalogue_id = requested_catalogue_id
            module_payload = {
                'programmeId': clean_str(item.get('programmeId') or item.get('programme_id') or ''),
                'programmeName': cohort.get('programme') or group.get('programme') or 'Unassigned programme',
                'cohortId': cohort['id'],
                'cohortName': cohort.get('name') or '',
                'groupId': group_id,
                'groupName': group.get('name') or '',
                'title': module_name,
                'description': visible_notes(item.get('notes') or ''),
                'status': item.get('status') or 'draft',
                'sessionsNumber': session_count,
                'startDate': start_date,
                'endDate': end_date,
                'weekStructure': [],
                'moduleKsbMappings': [],
                'completionCriteria': default_completion_payload(),
                'advancedDetails': {},
                'sourceType': 'training_plan',
                'sourceId': clean_str(row.get('id')),
                'importedFromTrainingPlanId': clean_str(row.get('id')),
            }
            if canonical_catalogue_id and not authoring_module_exists(canonical_catalogue_id):
                save_module_authoring_structure(canonical_catalogue_id, {
                    **module_payload,
                    'catalogueId': canonical_catalogue_id,
                })
            elif not canonical_catalogue_id:
                canonical_catalogue_id = ensure_canonical_module_for_training_row(row, module_payload)
            if canonical_catalogue_id:
                link_training_row_to_catalogue(row.get('id'), canonical_catalogue_id)
                row[TRAINING_MODULE_CATALOGUE_COLUMN] = canonical_catalogue_id
                row['_meta'] = {**extract_notes_meta(row.get('notes')), TRAINING_MODULE_CATALOGUE_COLUMN: canonical_catalogue_id}
        created_rows.append(row)
        existing_names.add(normalise(module_name))
        if canonical_catalogue_id:
            existing_catalogue_ids.add(canonical_catalogue_id)

    invalidate_curriculum_cache()
    return JsonResponse({
        'updated': True,
        'groupId': identifier,
        'created': created_rows,
        'skippedDuplicates': skipped,
    })


@require_GET
def curriculum_sessions(request):
    return curriculum_collection_response(get_cached_payload(request), 'sessions')


@csrf_exempt
def curriculum_session_collection(request):
    if request.method == 'GET':
        return curriculum_sessions(request)
    return json_error('Generated sessions are derived from Training_plan rows. Create a module/cohort/group allocation first.', status=409)


@csrf_exempt
def curriculum_session_detail(request, identifier):
    if request.method not in {'PATCH', 'DELETE'}:
        return json_error('Method not allowed.', status=405)
    match = re.match(r'^training-(\d+)-session-(\d+)$', clean_str(identifier))
    if not match:
        return json_error('Session not found.', status=404)
    training_id, week_number = match.groups()
    rows = fetch_all(f'select * from {table_name("Training_plan")} where id = %s', [training_id])
    if not rows:
        return json_error('Session not found.', status=404)
    if request.method == 'DELETE':
        return json_error('Individual generated sessions cannot be safely cancelled without a stored session row. Archive or update the parent training-plan allocation instead.', status=409)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    updates = {
        'session_start_time': payload.get('startTime'),
        'session_end_time': payload.get('endTime'),
        'Tutor_name': payload.get('tutor'),
    }
    if payload.get('date'):
        if int(week_number) != 1:
            return json_error('Only week 1 generated sessions can update start_date directly. Later session dates are calculated from the parent training-plan start date.', status=409)
        updates['start_date'] = payload.get('date')
    update_training_rows(rows, updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


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
    group, rows = find_training_rows_by_group(identifier)
    if not group or not rows:
        return json_error('Group not found for staffing assignment.', status=404)
    updates = {
        'Tutor_name': payload.get('tutor'),
        'coach_name': payload.get('coach'),
    }
    update_training_rows(rows, updates)
    invalidate_curriculum_cache()
    return JsonResponse({'updated': True, 'id': identifier})


@require_GET
def curriculum_holidays(request):
    return curriculum_collection_response(get_cached_payload(request), 'holidays')


@csrf_exempt
def curriculum_holiday_collection(request):
    if request.method == 'GET':
        return curriculum_holidays(request)
    if request.method != 'POST':
        return json_error('Method not allowed.', status=405)
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    missing = require_fields(payload, ['label', 'startDate'])
    if missing:
        return json_error('Missing required fields.', fields=missing)
    row = insert_row('training_plan_holidays', {
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
    rows = fetch_all(f'select * from {table_name("training_plan_holidays")} where id = %s', [identifier])
    if not rows:
        return json_error('Holiday not found.', status=404)
    if request.method == 'DELETE':
        payload = archive_payload('training_plan_holidays', rows[0].get('notes'))
        if payload:
            update_rows('training_plan_holidays', 'id = %s', [identifier], payload)
        else:
            delete_rows('training_plan_holidays', 'id = %s', [identifier])
        invalidate_curriculum_cache()
        return JsonResponse({'archived': True, 'id': identifier})
    payload = json_body(request)
    if payload is None:
        return json_error('Invalid JSON body.')
    update_rows('training_plan_holidays', 'id = %s', [identifier], {
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


@require_GET
def curriculum_tutors(request):
    return curriculum_collection_response(get_cached_payload(request), 'tutors')


@require_GET
def curriculum_coaches(request):
    return curriculum_collection_response(get_cached_payload(request), 'coaches')
