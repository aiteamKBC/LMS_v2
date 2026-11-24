"""KSB source identity, stored-source precedence and definition projection."""
import re


def skills_england_ksb_sort_key(item, *, clean_str):
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


def skills_england_standard_id(row, *, slugify):
    return slugify(f'{row.get("standard_ref")}-v{row.get("standard_version")}')


def split_ksb_source(source_type='', source_id='', *, clean_str):
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


def standard_required_ksb_definitions(standard, fallback_id='', *, ksb_type_from_value):
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


def source_payload_from_mapping(mapping, *, split_ksb_source):
    source_type = mapping.get('sourceType') or mapping.get('source_type')
    source_id = mapping.get('sourceId') or mapping.get('source_id')
    source_type, source_id = split_ksb_source(source_type, source_id)
    return source_type, source_id


def source_type_label(source_type):
    return 'Skills England standard' if source_type == 'standard' else 'KSB framework'


def scope_programme_id(module_rows, scope='', identifier='', *, clean_str):
    """The programme a coverage request sits under, whatever it was scoped by."""
    if scope == 'programme' and clean_str(identifier):
        return clean_str(identifier)
    return clean_str(next((
        row.get('programme_id') for row in module_rows if clean_str(row.get('programme_id'))
    ), ''))


def programme_config_ksb_source(config, *, normalise_ksb_profile_source_value, split_ksb_source):
    """(source_type, source_id) a programme row stores, or ('', '').

    The one reading of ``curriculum.programmes.ksb_profile_source_id``. Coverage,
    Achievement and the programme card all go through it, so they cannot
    disagree about which source a programme applies.
    """
    stored = normalise_ksb_profile_source_value((config or {}).get('ksb_profile_source_id'))
    return split_ksb_source('', stored) if stored else ('', '')


def active_ksb_profiles(ksb_profiles, *, falsey):
    """The manual profiles still in use. ``is_active = false`` is how a profile is
    archived (2026-10-15_archive_manual_ksb_profiles); a row without the flag
    counts as active."""
    return [
        profile for profile in ksb_profiles or []
        if (profile or {}).get('is_active') is None or not falsey(profile.get('is_active'))
    ]


def get_ksb_profile_for_program(program_name, ksb_profiles, *, ksb_profile_context_ids, ksb_profile_source_id, normalise):
    program_norm = normalise(program_name)
    if not program_norm:
        return None
    for profile in ksb_profiles:
        if not ksb_profile_source_id(profile):
            continue
        candidates = [
            profile.get('name'),
            *ksb_profile_context_ids(profile, 'programme_ids'),
        ]
        for candidate in candidates:
            candidate_norm = normalise(candidate)
            if candidate_norm == program_norm:
                return profile
    return None


def codes_from_session_ksb(value, *, parse_json_value):
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


def normalise_ksb_code(value, type_code='', *, normalise_ksb_type):
    code = str(value or '').strip().upper()
    type_code = normalise_ksb_type(type_code)
    if code.startswith(type_code):
        code = code[1:]
    return re.sub(r'[^0-9.]', '', code)


def full_ksb_code(item, *, normalise_ksb_code, normalise_ksb_type):
    type_code = normalise_ksb_type(item.get('type'))
    code = normalise_ksb_code(item.get('code') or item.get('full_code'), type_code)
    return f'{type_code}{code}' if code else ''


def ksb_profile_required_codes(profile, *, coverage_normalise_code, full_ksb_code, parse_json_value, unique):
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


def ksb_profile_source_id(profile, *, clean_str):
    """Read persisted identity only; generating IDs belongs to creation paths.

    A historical row ID remains a usable identity when no public KSBP ID was
    stored. Names are display values and cannot supply a stable record identity.
    """
    public_id = clean_str((profile or {}).get('id'))
    if public_id.startswith('KSBP-'):
        return public_id
    return clean_str((profile or {}).get('ksb_profile_id')) or public_id


def normalise_ksb_profile_source_value(value, *, clean_str):
    source = clean_str(value)
    if ':' not in source:
        return source
    prefix, source_id = source.split(':', 1)
    if prefix.lower() in {'profile', 'framework'}:
        return clean_str(source_id)
    return source


def ksb_profile_context_ids(profile, key, primary_value='', *, clean_str, parse_json_value, unique):
    values = parse_json_value((profile or {}).get(key), [])
    if not isinstance(values, list):
        values = []
    return unique([clean_str(primary_value), *[clean_str(value) for value in values]])
