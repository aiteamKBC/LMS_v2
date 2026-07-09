import json
import logging
import calendar
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

logger = logging.getLogger(__name__)


CURRICULUM_SCHEMA = 'curriculum'
CURRICULUM_CACHE_TTL_SECONDS = 30
_CURRICULUM_CACHE = {}
_TABLE_COLUMNS_CACHE = {}
_AUTHORING_TABLES_READY = False


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
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


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


def ensure_program_config_archive_columns():
    ensure_columns('training_plan_program_configs', {
        'status': 'varchar(32)',
        'is_active': 'boolean',
        'is_archived': 'boolean',
    })
    updates = {}
    if has_column('training_plan_program_configs', 'status'):
        updates['status'] = 'active'
    if has_column('training_plan_program_configs', 'is_active'):
        updates['is_active'] = True
    if has_column('training_plan_program_configs', 'is_archived'):
        updates['is_archived'] = False
    if updates:
        try:
            update_rows(
                'training_plan_program_configs',
                '(status is null or is_active is null or is_archived is null)',
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


def json_error(message, status=400, **extra):
    payload = {'error': message}
    payload.update(extra)
    return JsonResponse(payload, status=status)


def require_fields(payload, fields):
    missing = [field for field in fields if payload.get(field) in (None, '')]
    return missing


def clean_str(value):
    return str(value or '').strip()


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
    for config in program_configs:
        if config.get('program_id'):
            configs[str(config.get('program_id'))] = config
        if config.get('name'):
            configs[normalise(config.get('name'))] = config
    return configs


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


def get_curriculum_rows():
    return {
        'training': get_training_rows(),
        'modules': get_module_rows(),
        'ksb_profiles': get_ksb_profile_rows(),
        'program_configs': get_program_config_rows(),
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
            continue
        group = actual_group_identity(row, cohort['id'])
        if not group:
            continue
        cohort_name = cohort['name']
        cohort_id = cohort['id']
        group_name = group['name']
        group_id = group['id']
        catalogue_id = meta.get('module_catalogue_id')
        catalogue = module_catalog.get(str(catalogue_id)) or module_catalog.get(normalise(row.get('module_name')))
        name = row.get('module_name') or (catalogue.get('Module_name') if catalogue else f'Module {row.get("id")}')
        session_count = parse_int(row.get('sessions_number'), parse_int((catalogue or {}).get('Number of sessions'), 0))
        ksb_codes = codes_from_session_ksb(row.get('session_ksb_json')) or codes_from_session_ksb((catalogue or {}).get('session_ksb_json'))
        modules.append({
            'id': f'training-module-{row.get("id")}',
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
        used_catalogue_ids = {str(row.get('_meta', {}).get('module_catalogue_id')) for row in training_rows if row.get('_meta', {}).get('module_catalogue_id')}
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

    if include_config_only:
        for config in program_configs:
            if not config.get('program_id'):
                continue
            key = f'id:{config.get("program_id")}'
            grouped[key] = []
            group_meta[key] = {
                'name': config.get('name'),
                'sourceId': config.get('program_id'),
                'config': config,
            }
            order[key] = len(order)

    for config in program_configs:
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
        group_keys = {
            actual_group_identity(row, actual_cohort_identity(row, programme_identity(row, configs_by_id)['name'])['id'])['id']
            for row in delivery_rows
            if actual_cohort_identity(row, programme_identity(row, configs_by_id)['name'])
            and actual_group_identity(row, actual_cohort_identity(row, programme_identity(row, configs_by_id)['name'])['id'])
        }
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

        programmes.append({
            'id': f'program-{slugify(source_id)}',
            'sourceId': source_id,
            'name': name,
            'standard': standard,
            'level': level,
            'status': status,
            'modules': len(delivery_rows),
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
        })
    deduped = {}
    order_keys = []

    def programme_score(programme):
        status_score = {
            'active': 3,
            'planned': 2,
            'draft': 1,
            'published': 3,
        }.get(clean_str(programme.get('status')).lower(), 0)
        delivery_score = (
            parse_int(programme.get('cohorts')) * 1000
            + parse_int(programme.get('groups')) * 100
            + parse_int(programme.get('modules')) * 10
            + parse_int(programme.get('weeks'))
        )
        return delivery_score * 10 + status_score

    for programme in programmes:
        dedupe_key = normalise(programme.get('name')) or clean_str(programme.get('sourceId')) or clean_str(programme.get('id'))
        if dedupe_key not in deduped:
            deduped[dedupe_key] = programme
            order_keys.append(dedupe_key)
        elif programme_score(programme) > programme_score(deduped[dedupe_key]):
            deduped[dedupe_key] = programme

    return [deduped[key] for key in order_keys]


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


def build_sessions(training_rows, module_rows, program_configs=None):
    program_configs_by_id = program_config_by_id(program_configs or [])
    module_catalog = {}
    for module in module_rows:
        module_catalog[str(module.get('Module ID'))] = get_module_session_names(module)
        module_catalog[normalise(module.get('Module_name'))] = get_module_session_names(module)

    sessions = []
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
        module_id = f'training-module-{row.get("id")}'
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
        session_names = module_catalog.get(meta.get('module_catalogue_id')) or module_catalog.get(normalise(row.get('module_name'))) or []
        ksb_entries = parse_json_value(row.get('session_ksb_json'), [])

        for index in range(session_count):
            session_date = start + timedelta(days=index * 7) if start else None
            ksb_entry = ksb_entries[index] if isinstance(ksb_entries, list) and index < len(ksb_entries) and isinstance(ksb_entries[index], dict) else {}
            title = session_names[index] if index < len(session_names) else f'{row.get("module_name") or "Session"} #{index + 1}'
            sessions.append({
                'id': f'training-{row.get("id")}-session-{index + 1}',
                'trainingPlanId': row.get('id'),
                'programmeId': programme_id,
                'cohortId': cohort_id,
                'groupId': group_id,
                'moduleId': module_id,
                'weekId': f'{module_id}-week-{index + 1}',
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


def build_curriculum_payload(visibility='operational'):
    logger.info('build_curriculum_payload: running DB build for visibility=%s', visibility)
    rows = get_curriculum_rows()
    training_rows = rows['training'] if visibility == 'all' else [row for row in rows['training'] if is_operational_training_row(row)]
    ksb_profiles = rows['ksb_profiles'] if visibility == 'all' else [profile for profile in rows['ksb_profiles'] if profile.get('is_active')]
    modules = build_modules(
        rows['modules'],
        training_rows,
        rows['program_configs'],
        include_unused=visibility == 'all',
    )
    programmes = build_programmes(
        training_rows,
        rows['program_configs'],
        ksb_profiles,
        include_config_only=visibility == 'all',
    )
    cohorts, groups = build_cohorts_and_groups(training_rows, rows['program_configs'])
    sessions = build_sessions(training_rows, rows['modules'], rows['program_configs'])
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
            'sessions': len(sessions),
        },
        'programmes': programmes,
        'modules': modules,
        'ksbFrameworks': frameworks,
        'ksbSets': ksb_sets,
        'cohorts': cohorts,
        'groups': groups,
        'sessions': sessions,
        'holidays': [serialize_holiday_row(item) for item in holiday_rows],
        'tutors': build_staff_profiles_from_training(training_rows, 'Tutor_name', 'tutor'),
        'coaches': build_staff_profiles_from_training(training_rows, 'coach_name', 'coach'),
        'tutorModules': rows['tutor_modules'],
    }
    return payload


def curriculum_collection_response(payload, key, results=None):
    results = payload[key] if results is None else results
    return JsonResponse({
        'schema': payload['schema'],
        'count': len(results),
        'results': results,
    })


def module_belongs_to_group(module, group):
    module_group_id = clean_str(module.get('groupId') or module.get('group_id'))
    return bool(module_group_id) and matches_curriculum_identifier(module_group_id, group.get('id'))


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


def serialize_holiday_row(row):
    return {
        'id': row.get('id'),
        'label': row.get('label'),
        'startDate': format_date(row.get('start_date')),
        'endDate': format_date(row.get('end_date')),
        'type': row.get('type'),
        'color': row.get('color'),
    }


def matches_curriculum_identifier(value, identifier):
    expected = clean_str(identifier)
    candidates = {
        clean_str(value),
        slugify(value),
    }
    return expected in candidates


@require_GET
def curriculum_overview(request):
    visibility = curriculum_visibility(request)
    return JsonResponse(cached_curriculum_value(f'overview:{visibility}', lambda: build_curriculum_payload(visibility)))


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
    payload = build_curriculum_payload(visibility)
    programme = find_programme(payload, identifier)
    if not programme:
        return None, []
    rows = []
    configs_by_id = program_config_by_id(get_program_config_rows())
    for row in get_training_rows():
        identity = programme_identity(row, configs_by_id)
        if (
            clean_str(identity['sourceId']) == clean_str(programme['sourceId'])
            or clean_str(identity['name']) == clean_str(programme['name'])
        ):
            rows.append(row)
    return programme, rows


def find_training_rows_by_cohort(cohort_id):
    rows = get_training_rows()
    cohorts, _ = build_cohorts_and_groups(rows, get_program_config_rows())
    cohort = next((item for item in cohorts if clean_str(item['id']) == clean_str(cohort_id)), None)
    if not cohort:
        return None, []
    matches = []
    configs_by_id = program_config_by_id(get_program_config_rows())
    for row in rows:
        identity = programme_identity(row, configs_by_id)
        candidate = actual_cohort_identity(row, identity['name'])
        if candidate and candidate['id'] == cohort['id']:
            matches.append(row)
    return cohort, matches


def find_training_rows_by_group(group_id):
    rows = get_training_rows()
    _, groups = build_cohorts_and_groups(rows, get_program_config_rows())
    group = next((item for item in groups if clean_str(item['id']) == clean_str(group_id)), None)
    if not group:
        return None, []
    configs_by_id = program_config_by_id(get_program_config_rows())
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
    _, training_rows = find_training_rows_by_group(group_id)
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
        key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
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
    for module in payload['modules']:
        if ident in {clean_str(module.get('id')), clean_str(module.get('sourceId')), clean_str(module.get('catalogueId'))}:
            return module
    return None


AUTHORING_MODULES_TABLE = 'module_authoring_modules'
AUTHORING_WEEKS_TABLE = 'module_authoring_weeks'
AUTHORING_COMPONENTS_TABLE = 'module_authoring_components'
AUTHORING_KSB_MAPPINGS_TABLE = 'module_authoring_ksb_mappings'
AUTHORING_COMPLETION_TABLE = 'module_authoring_completion_criteria'
AUTHORING_ADVANCED_TABLE = 'module_authoring_advanced_details'


def canonical_authoring_id(prefix, value=''):
    return unique_prefixed_id(prefix, value)


def unique_module_catalogue_id(value=''):
    requested = clean_str(value)
    if re.match(r'^MOD-\d{14,}[A-Z0-9]*$', requested):
        return requested
    try:
        existing = [row.get('module_catalogue_id') for row in authoring_fetch_all(AUTHORING_MODULES_TABLE)]
    except Exception:
        existing = []
    return unique_prefixed_id('MOD', '', existing)


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
                expected_otjh numeric(8,2) not null default 0,
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
        cursor.execute(f'''
            create table if not exists {authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)} (
                id varchar(128) primary key,
                module_catalogue_id varchar(128) not null,
                week_id varchar(128),
                component_id varchar(128),
                ksb_id varchar(255),
                ksb_code varchar(64) not null,
                ksb_description text,
                classification varchar(32) not null default 'secondary',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
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
    _AUTHORING_TABLES_READY = True


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


def authoring_delete(table, where_sql, params=None):
    ensure_module_authoring_tables()
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
        'self-study': 'reading',
        'self study': 'reading',
        'quiz': 'quiz',
        'assignment': 'assignment',
        'workshop': 'workshop',
    }
    return mapping.get(label, normalise_component_type(value) or 'reading')


def normalise_ksb_classification(value):
    classification = clean_str(value).lower()
    return classification if classification in {'main', 'secondary', 'practice'} else 'secondary'


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
        {'label': 'KSB mappings classified correctly', 'passed': all(normalise_ksb_classification(mapping.get('type') or mapping.get('classification')) in {'main', 'secondary', 'practice'} for mapping in all_mappings)},
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
        'type': normalise_ksb_classification(row.get('classification')),
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
    meta = row.get('_meta') or extract_notes_meta(row.get('notes'))
    catalogue_id = clean_str(meta.get('module_catalogue_id'))
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
    meta = row.get('_meta') or extract_notes_meta(row.get('notes'))
    candidate_ids = [
        training_module_identifier(training_id),
        training_id,
        clean_str(meta.get('module_catalogue_id')),
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
    module_catalogue_id = unique_module_catalogue_id(meta.get('module_catalogue_id'))
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
                    'expectedOtjh': 1.5,
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


def ensure_training_module_authoring_structure(module_identifier):
    if not clean_str(module_identifier).startswith('training-module-'):
        return None
    training_id = clean_str(module_identifier).replace('training-module-', '', 1)
    row = training_row_by_id(training_id)
    if not row:
        return None

    existing = authoring_row_for_training_source(training_id) or authoring_row_for_training_legacy_ids(row)
    if existing:
        return get_authoring_structure_payload(clean_str(existing.get('module_catalogue_id')))

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
    ksb_refs = [
        mapping.get('ksb_code') or mapping.get('code')
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
        'duration': duration,
        'ksbRefs': ksb_refs,
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
    settings = {
        'displayType': payload.get('type') or 'Self-study',
        'componentBuilderStatus': clean_str(payload.get('status') or 'draft').lower(),
        'durationMinutes': duration_minutes,
        'contentSections': max(0, parse_int(payload.get('contentSections'), 0)),
        'quizQuestions': max(0, parse_int(payload.get('quizQuestions'), 0)) if payload.get('quizQuestions') not in (None, '') else 0,
        'hasResources': bool_payload(payload.get('hasResources')),
    }
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
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
            'expected_otjh': round(duration_minutes / 60, 2) if duration_minutes else 0,
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

    for summary in summaries.values():
        summary['ksbCount'] = len(summary['ksbCodes'])
        summary['ksbCodes'] = sorted(summary['ksbCodes'])
        if summary.get('sourceType') == 'training_plan' and summary.get('sourceId'):
            training_row = training_row_by_id(summary['sourceId'])
            if training_row:
                summary['deliveryStatus'] = delivery_status_for_training_row(training_row)

    return summaries


def authoring_summary_catalogue_item(summary):
    catalogue_id = summary['catalogueId']
    return {
        'id': f'authoring-module-{catalogue_id}',
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


def enrich_modules_with_authoring(modules):
    try:
        authoring_by_id = authoring_catalogue_summaries()
        authoring_by_training_source = {
            clean_str(summary.get('sourceId')): summary
            for summary in authoring_by_id.values()
            if summary.get('sourceType') == 'training_plan' and summary.get('sourceId')
        }
        enriched = []
        seen = set()
        for module in modules:
            catalogue_id = clean_str(module.get('catalogueId') or module.get('sourceId') or module.get('id'))
            source_key = clean_str(module.get('sourceId')) if module.get('sourceType') == 'training_plan' else ''
            saved = authoring_by_training_source.get(source_key) or authoring_by_id.get(catalogue_id)
            if saved:
                authoring_catalogue_id = saved['catalogueId']
                module = {
                    **module,
                    'name': saved['title'],
                    'programme': saved['programmeName'] or module.get('programme'),
                    'weeks': saved['weeks'] or module.get('weeks'),
                    'ksbCount': saved['ksbCount'],
                    'lessons': saved['lessonCount'],
                    'quizzes': saved['quizCount'],
                    'status': saved['status'],
                    'authoringStatus': saved['status'],
                    'sourceType': saved.get('sourceType') or module.get('sourceType'),
                    'deliveryStatus': module.get('deliveryStatus') or saved.get('deliveryStatus') or 'unknown',
                    'notes': saved['description'],
                    'startDate': saved['startDate'],
                    'endDate': saved['endDate'],
                    'sessionsNumber': saved['sessionsNumber'],
                    'qualityScore': saved['qualityScore'],
                    'catalogueId': authoring_catalogue_id,
                }
                seen.add(authoring_catalogue_id)
                if source_key:
                    seen.add(f'training_plan:{source_key}')
            enriched.append(module)
            seen.add(catalogue_id)
        existing_keys = {clean_str(module.get('catalogueId') or module.get('sourceId') or module.get('id')) for module in enriched}
        for catalogue_id, saved in authoring_by_id.items():
            training_source_key = f'training_plan:{clean_str(saved.get("sourceId"))}' if saved.get('sourceType') == 'training_plan' else ''
            if catalogue_id in existing_keys or catalogue_id in seen or (training_source_key and training_source_key in seen):
                continue
            enriched.append(authoring_summary_catalogue_item(saved))
        return enriched
    except Exception:
        logger.exception('Unable to enrich curriculum modules with authoring data.')
        return modules


def save_authoring_mapping(module_catalogue_id, mapping, week_id=None, component_id=None):
    mapping_id = canonical_authoring_id('KSBMAP', mapping.get('id'))
    authoring_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], {
        'id': mapping_id,
        'module_catalogue_id': module_catalogue_id,
        'week_id': week_id,
        'component_id': component_id,
        'ksb_id': mapping.get('ksbId') or mapping.get('ksb_id') or mapping.get('code'),
        'ksb_code': mapping.get('code') or mapping.get('ksbCode') or '',
        'ksb_description': mapping.get('description') or mapping.get('ksbDescription') or '',
        'classification': normalise_ksb_classification(mapping.get('type') or mapping.get('classification')),
    })


def save_module_authoring_structure(module_catalogue_id, payload):
    module_catalogue_id = unique_module_catalogue_id(module_catalogue_id or payload.get('catalogueId') or payload.get('moduleCatalogueId'))
    weeks = payload.get('weekStructure') or payload.get('weeks') or []
    checklist, quality_score = module_authoring_quality_check({**payload, 'weekStructure': weeks})
    all_components = [component for week in weeks for component in (week.get('components') or [])]
    total_otjh = sum(float(component.get('expectedOtjh') or component.get('expected_otjh') or 0) for component in all_components)
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
                    'expected_otjh': component.get('expectedOtjh') or 0,
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
    return curriculum_collection_response(get_cached_payload(request), 'programmes')


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
    modules = [
        module for module in payload['modules']
        if matches_curriculum_identifier(module.get('programmeId'), programme.get('id'))
        or normalise(module.get('programme')) == normalise(programme.get('name'))
    ]
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
    if 'status' in payload:
        ensure_program_config_archive_columns()
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
            'is_active': False if status_value == 'archived' else (True if status_value in {'active', 'planned', 'draft', 'published'} else None),
            'is_archived': True if status_value == 'archived' else (False if status_value in {'active', 'planned', 'draft', 'published'} else None),
            'updated_at': datetime.utcnow(),
        }
        key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
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

    name = clean_str(payload.get('name'))
    program_configs = get_program_config_rows()
    explicit_program_id = clean_str(payload.get('programId'))
    existing_config = None if explicit_program_id else next((
        config for config in program_configs
        if normalise(config.get('name')) == normalise(name)
    ), None)
    if existing_config:
        ensure_program_config_archive_columns()
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
            'is_active': status_value != 'archived',
            'is_archived': status_value == 'archived',
            'updated_at': datetime.utcnow(),
        }
        key_column = 'program_id' if has_column('training_plan_program_configs', 'program_id') else 'id'
        key_value = existing_config.get(key_column)
        update_rows('training_plan_program_configs', f'{quote_ident(key_column)} = %s', [key_value], updates)
        invalidate_curriculum_cache()
        return JsonResponse({'created': False, 'programme': programme_response(key_value) or programme_response(name) or {'sourceId': key_value, 'name': name}})

    source_id = unique_program_id(explicit_program_id or name, program_configs)
    insert_payload = {
        'program_id': source_id,
        'name': name,
        'sub': payload.get('standard') or payload.get('sub') or name,
        'color': payload.get('color') or '#6941c6',
        'description': payload.get('description') or '',
        'status': payload.get('status') or 'planned',
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
    payload = get_cached_payload(request)
    return curriculum_collection_response(payload, 'modules', enrich_modules_with_authoring(payload['modules']))


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
        module_catalogue_id = unique_module_catalogue_id(payload.get('catalogueId'))
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
        result = save_module_authoring_structure(module_catalogue_id, module_payload)
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
    if request.method == 'GET':
        try:
            payload = ensure_training_module_authoring_structure(module_catalogue_id) if module_catalogue_id.startswith('training-module-') else get_authoring_structure_payload(module_catalogue_id)
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
        result = save_module_authoring_structure(module_catalogue_id, payload)
    except Exception as exc:
        logger.exception('Unable to save module authoring structure for %s.', module_catalogue_id)
        return json_error('Unable to save module authoring structure.', status=500, detail=str(exc))
    return JsonResponse(result)


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
            return curriculum_collection_response(get_cached_payload(request), 'components', component_builder_rows())
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
    programme_id = clean_str(payload.get('programmeId') or payload.get('programme_id') or payload.get('programId') or payload.get('program_id'))
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
    update_training_rows(rows, updates)
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
        results = [
            module for module in payload['modules']
            if module_belongs_to_group(module, group)
        ]
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
    created_rows = []
    skipped = []

    for item in modules:
        if not isinstance(item, dict):
            return json_error('Each module attachment must be an object.', status=400)
        module_name = clean_str(item.get('moduleName') or item.get('name'))
        if not module_name:
            return json_error('Module name is required for each attachment.', fields=['moduleName'])
        if normalise(module_name) in existing_names:
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
            'module_catalogue_id': item.get('catalogueId') or item.get('moduleId') or '',
            'module_color': item.get('color') or '',
            'module_end_auto': 'true' if session_plan.get('finalEndDate') and not item.get('endDate') else 'false',
            'skipped_holidays': ','.join(session_plan.get('skippedHolidays') or []),
        })
        row = insert_row('Training_plan', {
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
        })
        created_rows.append(row)
        existing_names.add(normalise(module_name))

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
