"""Build consistent source labels and annotate coverage documents."""


def source_display_metadata(
    source_type='',
    source_id='',
    *,
    clean_str,
    find_skills_england_standard,
    get_ksb_profile_rows,
    ksb_profile_context_ids,
    slugify,
    source_type_label,
    split_ksb_source,
):
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


def annotate_coverage_sources(coverage, *, clean_str, source_display_metadata):
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


def coverage_source_payload(source_type, source_id, origin, required_count, *, source_display_metadata):
    """What the required set was read from, named on the response."""
    payload = {
        'type': source_type,
        'id': source_id,
        'origin': origin,
        'required_count': required_count,
        'requiredCount': required_count,
    }
    payload.update(source_display_metadata(source_type, source_id) if source_id else {})
    return payload
