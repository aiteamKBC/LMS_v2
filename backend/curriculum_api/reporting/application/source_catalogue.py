"""Resolve programme and mapping KSB sources and assemble standard definitions."""


def build_skills_england_standards(
    *,
    clean_str,
    format_date,
    format_skills_england_funding,
    get_skills_england_ksb_rows,
    normalise_skills_england_type,
    skills_england_ksb_sort_key,
    skills_england_standard_id,
):
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


def _skills_england_standard_index(*, build_skills_england_standards, clean_str, slugify):
    """``{identifier: standard}`` for every name a standard answers to; the
    first standard (in build order) keeps a shared identifier."""
    index = {}
    for standard in build_skills_england_standards():
        for candidate in (
            clean_str(standard.get('id')).lower(),
            clean_str(standard.get('code')).lower(),
            slugify(standard.get('name')).lower(),
            slugify(f'{standard.get("code")}-v{standard.get("version")}').lower(),
        ):
            index.setdefault(candidate, standard)
    return index


def find_skills_england_standard(identifier, *, _skills_england_standard_index, clean_str):
    return _skills_england_standard_index().get(clean_str(identifier).lower())


def standard_required_ksbs(
    identifier,
    *,
    find_skills_england_standard,
    standard_required_ksb_definitions,
):
    return standard_required_ksb_definitions(find_skills_england_standard(identifier), identifier)


def all_standard_required_ksbs(
    *,
    build_skills_england_standards,
    clean_str,
    coverage_normalise_code,
    standard_required_ksb_definitions,
):
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


def required_ksbs_for_source(
    source_type='',
    source_id='',
    *,
    all_standard_required_ksbs,
    split_ksb_source,
    standard_required_ksbs,
):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if source_type == 'standard' and not source_id:
        return all_standard_required_ksbs()
    if source_type == 'standard' and source_id:
        return standard_required_ksbs(source_id)
    # 'framework'/'profile' sources were KSB profiles, which no longer exist.
    return []


def source_required_ksbs(
    source_type,
    source_id,
    cache=None,
    *,
    required_ksbs_for_source,
    split_ksb_source,
):
    source_type, source_id = split_ksb_source(source_type, source_id)
    cache = cache if cache is not None else {}
    key = (source_type, source_id)
    if key not in cache:
        cache[key] = required_ksbs_for_source(source_type, source_id)
    return cache[key]


def source_record_exists(source_type, source_id, cache=None, *, source_required_ksbs):
    return bool(source_required_ksbs(source_type, source_id, cache))


def ksb_exists_in_source(
    source_type,
    source_id,
    code,
    cache=None,
    *,
    coverage_normalise_code,
    source_required_ksbs,
    split_ksb_source,
):
    source_type, source_id = split_ksb_source(source_type, source_id)
    if not source_type or not source_id:
        return False
    normalised = coverage_normalise_code(code)
    return any(coverage_normalise_code(item.get('code')) == normalised for item in source_required_ksbs(source_type, source_id, cache))


def programme_row_ksb_source(
    programme_id,
    *,
    clean_str,
    get_program_config_rows,
    normalise,
    programme_config_identity,
    programme_config_ksb_source,
    programme_identifier_looks_exact,
):
    """The KSB source stored on the programme row itself.

    `curriculum.programmes.ksb_profile_source_id` is what the Programme form
    writes and what `set_programme_modules_ksb_source` cascades onto every
    module underneath, so it is the authority for any scope inside that
    programme. Nothing on the coverage path used to read it: a programme whose
    name no longer matched an entry in a profile's `programme_ids` fell all the
    way through to the union of every profile without saying so.
    """
    ident = clean_str(programme_id)
    ident_key = normalise(ident)
    if not ident_key:
        return '', ''
    rows = get_program_config_rows()
    # Resolve the stored ID before considering display names, irrespective of
    # row ordering. Another programme can legitimately be named like this ID.
    for row in rows:
        if ident_key == normalise(programme_config_identity(row)):
            return programme_config_ksb_source(row)
    if programme_identifier_looks_exact(ident):
        return '', ''
    for row in rows:
        if ident_key == normalise(row.get('name')):
            return programme_config_ksb_source(row)
    return '', ''


def infer_source_from_scope(
    module_rows,
    scope='',
    identifier='',
    *,
    active_ksb_profiles,
    build_skills_england_standards,
    clean_str,
    get_ksb_profile_for_program,
    get_ksb_profile_rows,
    normalise,
    normalise_ksb_profile_source_value,
    programme_row_ksb_source,
    scope_programme_id,
    split_ksb_source,
):
    """Which KSB source this scope's required set comes from, and how it was
    arrived at. Most explicit first, so a stored source always beats a name that
    happens to match one."""
    stored_type, stored_id = programme_row_ksb_source(scope_programme_id(module_rows, scope, identifier))
    if stored_type and stored_id:
        return stored_type, stored_id, 'programme'
    explicit = next((
        (row.get('source_type'), row.get('source_id'))
        for row in module_rows
        if row.get('source_type') in {'standard', 'framework', 'profile'} and row.get('source_id')
    ), None)
    if explicit:
        return (*split_ksb_source(*explicit), 'module')
    # The copy the programme cascaded onto its modules, for a module whose
    # programme row has since lost (or never carried) the value.
    cascaded = next((
        normalise_ksb_profile_source_value(row.get('ksb_profile_source_id'))
        for row in module_rows
        if clean_str(row.get('ksb_profile_source_id'))
    ), '')
    if cascaded:
        return (*split_ksb_source('', cascaded), 'module')
    programme_name = clean_str((module_rows[0] if module_rows else {}).get('programme_name'))
    if not programme_name:
        return '', '', ''
    # Active profiles only, as the programme card's label reads them: an
    # archived profile still listing this name is a leftover link, not a source.
    profile = get_ksb_profile_for_program(programme_name, active_ksb_profiles(get_ksb_profile_rows()))
    if profile:
        return 'framework', f'ksb-{profile.get("id")}', 'programme-name'
    standard = next((item for item in build_skills_england_standards() if normalise(item.get('name')) == normalise(programme_name)), None)
    if standard:
        return 'standard', standard.get('id'), 'programme-name'
    return '', '', ''


def required_ksbs_for_resolved_source(source_type, source_id, origin, *, required_ksbs_for_source):
    if origin == 'all-profiles':
        # No source on the scope: there are no KSB profiles to fall back on, so
        # coverage is mapping-only.
        return []
    return required_ksbs_for_source(source_type, source_id)


def infer_mapping_source_from_module(
    module,
    code,
    cache=None,
    *,
    build_skills_england_standards,
    clean_str,
    coverage_normalise_code,
    get_ksb_profile_for_program,
    get_ksb_profile_rows,
    ksb_exists_in_source,
    normalise,
    split_ksb_source,
):
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




def mappings_with_inferred_sources(
    mapping_rows,
    module_rows,
    *,
    clean_str,
    infer_mapping_source_from_module,
):
    module_by_id = {clean_str(row.get('module_catalogue_id')): row for row in module_rows}
    # One cache for the whole batch, the way authoring_mapping_payload already
    # threads its `source_cache`. Passing nothing gave every row a fresh cache,
    # and each fresh cache re-read the KSB profiles and the Skills England
    # standards -- whole tables, no where clause -- to answer about one code. A
    # module with thirty unsourced mappings paid for that thirty times over.
    source_cache = {}
    enriched = []
    for row in mapping_rows:
        if clean_str(row.get('source_type')) and clean_str(row.get('source_id')):
            enriched.append(row)
            continue
        source_type, source_id = infer_mapping_source_from_module(
            module_by_id.get(clean_str(row.get('module_catalogue_id')), {}),
            row.get('ksb_code'),
            source_cache,
        )
        enriched.append({**row, 'source_type': source_type, 'source_id': source_id} if source_type and source_id else row)
    return enriched


def applied_standard_name(
    config,
    cache,
    *,
    clean_str,
    find_skills_england_standard,
    programme_config_ksb_source,
):
    """Name of the standard a programme applies, or '' when it applies none.

    Read the way source_display_metadata names a standard, so the programme card
    and the Achievement tab call the same source by the same name. ``cache`` is
    per build, shared with applied_standard_required_codes under its own keys.
    """
    source_type, source_id = programme_config_ksb_source(config)
    if source_type != 'standard' or not source_id:
        return ''
    key = ('name', source_id.lower())
    if key not in cache:
        standard = find_skills_england_standard(source_id) or {}
        cache[key] = clean_str(standard.get('name')) or clean_str(standard.get('code'))
    return cache[key]


def applied_standard_required_codes(
    config,
    cache,
    *,
    clean_str,
    coverage_normalise_code,
    standard_required_ksbs,
    unique,
):
    """Required codes of the standard a programme applies, or None.

    A programme whose ksb_profile_source_id names a standard
    ('standard:st0596-v1-0') is counted against that standard, never against a
    manual profile matched by its name: the name match kept Marketing Executive
    and Marketing Manager on their profiles' counts after both moved to
    standards, and gave 0 to programmes no profile names. None means the
    programme applies no standard (or it is not in standard_ksbs), so the
    caller keeps the profile match. ``cache`` is per build, keyed by standard.
    """
    source = clean_str((config or {}).get('ksb_profile_source_id'))
    if not source.lower().startswith('standard:'):
        return None
    standard_id = clean_str(source.split(':', 1)[1]).lower()
    if standard_id not in cache:
        cache[standard_id] = unique([
            coverage_normalise_code(definition.get('code'))
            for definition in standard_required_ksbs(standard_id)
            if coverage_normalise_code(definition.get('code'))
        ])
    return cache[standard_id] or None


def programme_applied_ksb_profile(
    config,
    ksb_profiles,
    *programme_names,
    active_ksb_profiles,
    clean_str,
    get_ksb_profile_for_program,
    ksb_profile_source_id,
    normalise,
    programme_config_ksb_source,
):
    """The manual KSB profile a programme applies, or None.

    The stored source decides (programme_config_ksb_source):

    - a standard: no manual profile speaks for the programme. Applying a standard
      never unlinks the programme from a profile's ``programme_ids``, so a
      profile still listing it -- archived or not -- is a leftover link. Reading
      it made a programme on ST0845 call itself "Empty KSB profile";
    - a profile: that profile, whatever its state, because the row chose it;
    - nothing: the legacy match by programme name, against active profiles only,
      so an archived profile cannot name a programme by accident.
    """
    source_type, source_id = programme_config_ksb_source(config)
    if source_type == 'standard':
        return None
    ksb_profiles = [profile for profile in ksb_profiles or [] if ksb_profile_source_id(profile)]
    if source_id:
        wanted = normalise(source_id)
        for profile in ksb_profiles or []:
            profile_id = clean_str(profile.get('id'))
            identities = {
                profile_id,
                clean_str(profile.get('ksb_profile_id')),
                ksb_profile_source_id(profile),
                f'ksb-{profile_id}' if profile_id else '',
            }
            if wanted in {normalise(value) for value in identities if value}:
                return profile
        return None
    active = active_ksb_profiles(ksb_profiles)
    for name in programme_names:
        profile = get_ksb_profile_for_program(name, active)
        if profile:
            return profile
    return None
