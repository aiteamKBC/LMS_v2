"""Programme identity, placement matching and archive visibility over supplied values."""

from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.programme_identity import programme_identity
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import falsey as _default_falsey
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_date as _default_parse_date
from curriculum_api.catalogue.domain.values import parse_float as _default_parse_float
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import slugify as _default_slugify
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.domain.values import truthy as _default_truthy
from curriculum_api.catalogue.domain.values import unique as _default_unique
from datetime import datetime as _default_datetime
import re


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


def parse_required_otjh(value, *, clean_str=_default_clean_str, parse_float=_default_parse_float):
    """Off-the-job hours a learner must complete for the programme.

    Returns None for a blank or unparseable entry so the column stays NULL: the
    review step distinguishes "no target set" from a target of zero hours, and
    treating a cleared field as 0 would report every programme as already met.
    """
    text = clean_str(value)
    if not text:
        return None
    hours = parse_float(text, -1)
    if hours < 0:
        return None
    return round(hours, 2)


def payload_required_otjh(payload, existing=None, *, parse_required_otjh=parse_required_otjh):
    """Resolve required_otjh for a write, leaving it untouched when unsent.

    An absent key must not wipe a stored target, so callers that pass this into
    update_rows also pass allow_null_columns=['required_otjh'] — that lets an
    explicitly emptied field clear the column while an omitted one is dropped.
    """
    payload = payload or {}
    for key in ('requiredOtjh', 'required_otjh'):
        if key in payload:
            return parse_required_otjh(payload.get(key))
    if existing is None:
        return None
    return parse_required_otjh((existing or {}).get('required_otjh'))


def curriculum_row_effectively_deleted(
    row, *, programme_deleted_row,
):
    """Is this curriculum row archived -- directly, or through an ancestor?

    ``status`` is the archive record. Parent-driven archiving needs no join: the
    cascade sets the child row's own status (and history records the ancestor),
    so a row archived with its programme reads as archived here too.

    This is the predicate the parent-link repair uses to decide what it may
    touch and what it may point at. It never *changes* archive state --
    restoring is a separate, explicit operation (``restore_soft_delete_payload``).
    """
    return programme_deleted_row(row)


def is_operational_training_row(row, *, falsey=_default_falsey, programme_deleted_row, truthy=_default_truthy):
    if programme_deleted_row(row):
        return False

    meta = row.get('_meta', {})
    for key in ('hidden', 'is_hidden', 'deleted', 'is_deleted', 'is_programme_deleted', 'archived', 'is_archived', 'inactive', 'disabled'):
        if key in meta and truthy(meta.get(key)):
            return False

    for key in ('active', 'is_active', 'visible', 'is_visible', 'operational', 'is_operational'):
        if key in meta and falsey(meta.get(key)):
            return False

    return True


def title_case_status(is_archived, start_value, end_value, *, date, parse_date=_default_parse_date):
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


def get_module_session_names(module_row, *, parse_json_value=_default_parse_json_value):
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


def programme_config_for_programme(
    program_configs,
    programme,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    preferred_program_config_by_name,
    programme_config_identity=_default_programme_config_identity,
):
    programme_ids = {
        clean_str(programme.get('id')),
        clean_str(programme.get('sourceId')),
    }
    programme_ids = {value for value in programme_ids if value}
    programme_name = normalise(programme.get('name'))
    for config in program_configs or []:
        if programme_config_identity(config) in programme_ids:
            return config
    if programme_name:
        return preferred_program_config_by_name(program_configs or [], programme.get('name'))
    return None


def is_placeholder_programme_id(
    value,
    *,
    PLACEHOLDER_PROGRAMME_IDS,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
):
    """True when `value` is a client placeholder rather than a real programme id."""
    candidate = clean_str(value).lower()
    if not candidate:
        return True
    if candidate in PLACEHOLDER_PROGRAMME_IDS:
        return True
    # The display placeholder arrives spaced and capitalised ("Unassigned
    # programme"); compare on the normalised form so it is recognised too.
    if normalise(candidate) in PLACEHOLDER_PROGRAMME_IDS:
        return True
    return candidate.startswith('local-')


def module_row_belongs_to_group(row, group, *, clean_str=_default_clean_str, normalise=_default_normalise):
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


def group_tutor_from_module_names(names, *, clean_str=_default_clean_str, unique=_default_unique):
    """Collapse the tutor names on a group's modules into one group-level label.

    A group is normally taught by one tutor, so a single distinct name is
    reported as-is. When modules disagree the group is genuinely split, so
    surface that rather than silently picking the first name.
    """
    distinct = unique([clean_str(name) for name in (names or []) if clean_str(name)])
    if not distinct:
        return 'Unassigned'
    if len(distinct) == 1:
        return distinct[0]
    return f'{distinct[0]} +{len(distinct) - 1}'


def curriculum_identifier_candidates(value, *, clean_str=_default_clean_str, slugify=_default_slugify):
    text = clean_str(value)
    candidates = {
        text,
        slugify(text),
    }
    if text:
        candidates.add(f'program-{slugify(text)}')
    return {candidate for candidate in candidates if candidate}


def compact_module_list_rows(
    modules, *, COMPACT_MODULE_LIST_FIELDS,
):
    """Project module dicts onto COMPACT_MODULE_LIST_FIELDS.

    Whitelist-driven: the key set above is the contract, and a field added to a
    module row later stays out of this response until somebody puts it in that
    set deliberately.

    Copies rather than edits: full consumers can share the source dictionaries.
    The compact endpoint also has its own list-only builder/cache, which avoids
    constructing component edit payloads while retaining this exact contract.
    """
    return [
        {
            **{
                key: value for key, value in module.items()
                if key in COMPACT_MODULE_LIST_FIELDS
            },
            'sessionNamesCount': len(module.get('sessionNames') or []),
        }
        for module in modules
    ]


def find_programme(payload, identifier, *, clean_str=_default_clean_str, slugify=_default_slugify):
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


def programme_identifier_candidates(
    identifier,
    programme=None,
    config=None,
    *,
    clean_str=_default_clean_str,
    programme_config_identity=_default_programme_config_identity,
):
    """Every id a child row may legitimately carry for this programme."""
    values = {
        clean_str(identifier),
        clean_str(programme_config_identity(config)),
        clean_str((programme or {}).get('sourceId')),
        clean_str((programme or {}).get('id')),
    }
    return sorted(value for value in values if value)


def module_archive_parent_markers(module_row, module_catalogue_id, *, clean_str=_default_clean_str):
    """Which ``deleted_via_parent`` markers belong to this module's archive.

    A module archived on its own stamps its children with its own catalogue id,
    which is what ``restore_rows_via_parent`` matches. A module that came here on
    a programme's cascade did not stamp anything: that cascade wrote the
    *programme* id onto the module and onto every week and component under it, so
    matching on the catalogue id alone would report an archived programme's
    modules as empty. Whatever marker the module itself carries is therefore
    accepted alongside its own id.
    """
    markers = {clean_str(module_catalogue_id)}
    via_parent = clean_str((module_row or {}).get('deleted_via_parent'))
    if via_parent:
        markers.add(via_parent)
    return {marker for marker in markers if marker}


def stamp_datetime(value, *, clean_str=_default_clean_str, datetime=_default_datetime):
    """A stored ``deleted_at`` as a datetime, or None when it is not one."""
    if isinstance(value, datetime):
        return value
    text = clean_str(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None


def row_in_module_archive(
    row, markers, bounds=None, *, clean_str, curriculum_row_effectively_deleted, stamp_datetime,
):
    """Would restoring this module bring this child row back?

    A live row is kept -- the caller is reading an archived module, but a child
    that was never soft-deleted is still part of it. A deleted one is kept only
    when its ``deleted_via_parent`` marker is one of this module's, so a
    component deleted by hand before the module was archived stays out: reading
    an archived module must show what a restore returns, not everything the table
    has ever held under that id.

    ``bounds`` (``module_archive_event_bounds``) also requires the row to have
    been archived in the same moment as the module. A module once archived and
    then brought back by a save keeps the children of that earlier archive
    stamped with its id; they belong to no archive the module is in now.
    """
    if not curriculum_row_effectively_deleted(row):
        return True
    if clean_str(row.get('deleted_via_parent')) not in markers:
        return False
    if bounds is None:
        return True
    deleted_at = stamp_datetime(row.get('deleted_at'))
    if deleted_at is None:
        return True
    try:
        return bounds[0] <= deleted_at <= bounds[1]
    except TypeError:
        # Naive against aware: the two stamps came from different writers.
        # Fall back to the marker rather than guess an offset.
        return True


def is_archived_module_summary(
    module, *, clean_str, programme_deleted_row, truthy,
):
    """Is this module out of the active lists?

    The status fields are the delivery side of the answer; the row's own archive
    state (programme_deleted_row) is the authoring side, and it has to be read
    here too: `authoring_catalogue_summaries` reads the module rows without an
    archive filter (the weeks, components and mappings beside it are filtered).
    Without this an archived module went on being counted for its programme's
    card while the programme's own page -- which reads the surviving rows --
    showed none: "3 modules" on the card, "No modules yet" one click later.
    """
    return (
        clean_str((module or {}).get('status')).lower() == 'archived'
        or clean_str((module or {}).get('authoringStatus')).lower() == 'archived'
        or clean_str((module or {}).get('deliveryStatus')).lower() == 'archived'
        or truthy((module or {}).get('isArchived'))
        or programme_deleted_row(module)
    )


def programme_structure_type(payload, fallback='scheduled'):
    value = clean_str((payload or {}).get('structureType') or (payload or {}).get('structure_type') or fallback).lower()
    return value if value in {'scheduled', 'free'} else fallback


def normalise_programme_status(value, default='active'):
    status = clean_str(value).lower()
    # 'inactive' is how the normalised schema records an archived programme.
    if status in {'archived', 'inactive'}:
        return 'archived'
    if status in {'draft', 'active', 'published', 'planned', 'live'}:
        return 'active'
    return default


def programme_status_is_active(status):
    return normalise_programme_status(status, 'active') == 'active'


def programme_status_is_archived(status):
    return normalise_programme_status(status, 'active') == 'archived'


def extract_notes_meta(notes):
    meta = {}
    for line in str(notes or '').splitlines():
        if not line.startswith('__') or ':' not in line:
            continue
        key, value = line.split(':', 1)
        meta[key.strip('_')] = value.strip()
    return meta


def delivery_status_for_training_row(
    row,
    *,
    date,
    extract_notes_meta=extract_notes_meta,
    is_operational_training_row,
    parse_date=_default_parse_date,
):
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


def parse_notes_id_list(value):
    if isinstance(value, (list, tuple, set)):
        tokens = value
    else:
        tokens = re.split(r'[|,]+', str(value or ''))
    return [clean_str(token) for token in tokens if clean_str(token)]


def clean_tree_remove_ids(
    payload,
    *keys,
    clean_str=_default_clean_str,
    parse_notes_id_list=parse_notes_id_list,
    unique=_default_unique,
):
    ids = []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str):
            ids.extend(parse_notes_id_list(value))
        elif isinstance(value, (list, tuple, set)):
            ids.extend(value)
    return unique([clean_str(item) for item in ids if clean_str(item)])


def visible_notes(notes):
    return '\n'.join(line for line in str(notes or '').splitlines() if not line.strip().startswith('__')).strip()


def infer_level(name):
    match = re.search(r'\bL(?:evel\s*)?(\d)\b|lv(?:l)?\s*(\d)|level\s*(\d)', str(name), re.I)
    if not match:
        return ''
    level = next(group for group in match.groups() if group)
    return f'L{level}'


def programme_config_id(config):
    return clean_str((config or {}).get('programme_id') or (config or {}).get('id') or (config or {}).get('program_id'))


def program_config_by_id(
    program_configs,
    *,
    normalise=_default_normalise,
    program_config_preference,
    programme_config_id=programme_config_id,
):
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


def programme_config_json_list(config, key):
    value = (config or {}).get(key)
    parsed = as_json_value(value, [])
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        return list(parsed.values())
    return []


def canonical_programme_name(row, program_configs_by_id):
    return programme_identity(row, program_configs_by_id)['name']


def is_actual_delivery_row(row, program_configs_by_id):
    if not clean_str(row.get('module_name')):
        return False
    identity = programme_identity(row, program_configs_by_id)
    cohort = actual_cohort_identity(row, identity['name'])
    if not cohort:
        return False
    return bool(actual_group_identity(row, cohort['id']))


def matches_curriculum_identifier(value, identifier):
    expected = clean_str(identifier)
    return expected in curriculum_identifier_candidates(value)


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


def programme_summary_is_archived(programme):
    """Whether a programme in the payload is itself archived."""
    programme = programme or {}
    return (
        truthy(programme.get('isArchived'))
        or programme_status_is_archived(programme.get('status'))
    )
