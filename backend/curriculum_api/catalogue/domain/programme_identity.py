"""Programme identity and display selection rules over supplied plain values.

Normalization and archive predicates retain the existing caller implementations.
No ORM, settings, SQL, legacy views or provider imports.
"""
from datetime import datetime

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def programme_config_identity(config, *, clean_str=_default_clean_str):
    """The canonical id of a programme config row.

    curriculum.programmes keys on `programme_id`; `program_id` and `id` are
    legacy aliases that no longer exist as columns. Reading only the aliases
    yields '' for every row, which previously let the dedup routine delete a
    row without first reassigning its children.
    """
    return clean_str(
        (config or {}).get('programme_id')
        or (config or {}).get('program_id')
        or (config or {}).get('id')
    )


def programme_identity(
    row,
    program_configs_by_id,
    *,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    slugify=_default_slugify,
):
    meta = row.get('_meta', {})
    program_id = meta.get('program_id')
    row_name = row.get('Program') or 'Unassigned Programme'
    if program_id:
        config = program_configs_by_id.get(str(program_id))
        name = (config or {}).get('name') or row_name
        canonical_config = config or program_configs_by_id.get(normalise(name))
        canonical_source_id = programme_config_identity(canonical_config, clean_str=clean_str) or program_id
        return {
            'key': f'id:{clean_str(canonical_source_id)}' if clean_str(canonical_source_id) else f'name:{normalise(name)}',
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


def program_config_preference(
    config,
    *,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
    is_archived_program_config,
):
    if not config:
        return (-1, 0, 0)
    updated = config.get('updated_at') or config.get('created_at')
    try:
        if hasattr(updated, 'timestamp'):
            timestamp = updated.timestamp()
        else:
            updated_text = clean_str(updated)
            if updated_text.endswith('Z'):
                updated_text = f'{updated_text[:-1]}+00:00'
            timestamp = datetime.fromisoformat(updated_text).timestamp() if updated_text else 0
    except Exception:
        timestamp = 0
    return (
        0 if is_archived_program_config(config) else 1,
        timestamp,
        parse_int(config.get('id'), 0),
    )


def unique_program_configs_for_display(
    program_configs,
    *,
    normalise=_default_normalise,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
    is_archived_program_config,
):
    active = []
    active_names = set()
    archived_by_name = {}
    archived_unnamed = []
    for config in program_configs:
        if not is_archived_program_config(config):
            active.append(config)
            active_name = normalise(config.get('name'))
            active_names.add(active_name)
            archived_by_name.pop(active_name, None)
            continue
        name_key = normalise(config.get('name'))
        if not name_key:
            archived_unnamed.append(config)
            continue
        if name_key in active_names:
            continue
        current = archived_by_name.get(name_key)
        if not current or program_config_preference(config, clean_str=clean_str, parse_int=parse_int, is_archived_program_config=is_archived_program_config) > program_config_preference(current, clean_str=clean_str, parse_int=parse_int, is_archived_program_config=is_archived_program_config):
            archived_by_name[name_key] = config
    return [*active, *archived_by_name.values(), *archived_unnamed]
