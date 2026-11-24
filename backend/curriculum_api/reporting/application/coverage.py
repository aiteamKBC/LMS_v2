"""Build coverage documents and their requested projections."""


def _coverage_payload_uncached(
    query,
    scope='',
    identifier='',
    *,
    annotate_coverage_sources,
    authoring_scope_data,
    build_coverage,
    coverage_source_payload,
    mappings_with_inferred_sources,
    required_ksbs_for_resolved_source,
    resolve_coverage_source,
    resolve_group_row,
    truthy,
):
    """The coverage document and a plain error outcome, without HTTP objects."""
    summary_only = scope == 'programme' and query.get('view') == 'summary'
    module_rows, week_rows, component_rows, mapping_rows = authoring_scope_data(
        scope, identifier, **({'stats_only': True} if summary_only else {'mapped_components_only': True}),
    )
    if identifier and scope == 'group' and not module_rows:
        # A group that exists but carries no modules yet is empty, not missing.
        # Existence is the groups table, not the module rows.
        if not resolve_group_row(identifier):
            return None, ('Group not found.', 404)
    elif identifier and scope in {'module', 'week', 'component', 'programme', 'cohort'} and not module_rows:
        return None, (f'{scope.title()} not found.', 404)
    actual_mappings_only = truthy(query.get('actual_mappings') or query.get('actualMappings'))
    if not actual_mappings_only:
        mapping_rows = mappings_with_inferred_sources(mapping_rows, module_rows)
    source_type, source_id, source_origin = resolve_coverage_source(module_rows, scope, identifier)
    required_ksbs = [] if actual_mappings_only else required_ksbs_for_resolved_source(source_type, source_id, source_origin)
    if summary_only:
        from ...ksb_coverage import build_coverage_summary
        coverage = build_coverage_summary(
            required_ksbs, mapping_rows, include_mapping_only=actual_mappings_only or not bool(required_ksbs),
        )
    else:
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
    return {
        'scope': scope or 'all',
        'identifier': identifier,
        'source': coverage_source_payload(
            source_type,
            source_id,
            'mappings-only' if actual_mappings_only else source_origin,
            len(required_ksbs),
        ),
        **coverage,
    }, None


def resolve_coverage_source(
    query,
    module_rows,
    scope='',
    identifier='',
    *,
    infer_source_from_scope,
    split_ksb_source,
):
    """(source_type, source_id, origin) for a coverage request.

    `origin` names where the answer came from: 'request', 'programme', 'module'
    or 'programme-name'. 'all-profiles' is the retained response marker when
    no source is identified. With the current standard-backed storage it has
    no required definitions: required_ksbs_for_resolved_source returns [], so
    coverage uses the mappings only. The marker does not trigger a profile read.
    """
    source_type, source_id = split_ksb_source(
        query.get('source_type') or query.get('sourceType') or '',
        query.get('source_id') or query.get('sourceId') or '',
    )
    if source_type or source_id:
        return source_type, source_id, 'request'
    if not scope:
        return '', '', 'all-profiles'
    source_type, source_id, origin = infer_source_from_scope(module_rows, scope, identifier)
    if not source_type or not source_id:
        return '', '', 'all-profiles'
    return source_type, source_id, origin


def coverage_part_mapping(mapping, fields):
    if not isinstance(mapping, dict):
        return mapping
    return {field: mapping[field] for field in fields if field in mapping}


def coverage_part(payload, part, *, COVERAGE_HEATMAP_MAPPING_FIELDS, coverage_part_mapping):
    """The coverage document without the half ``part`` does not read.

    What is dropped is emptied, not removed, so every key keeps its type, and a
    flag says so: ``mappingsOmitted`` (each item's ``mappings`` is ``[]``;
    ``occurrence_count`` still counts them) or ``heatmapOmitted`` (``rows`` is
    ``[]``; ``modules`` stays). The placements the half keeps carry
    COVERAGE_PART_MAPPING_FIELDS only (``placementFieldsOnly``; the heatmap's
    cells the narrower COVERAGE_HEATMAP_MAPPING_FIELDS), and a heatmap
    cell keeps its module id, weight and placements -- the module's name is in
    ``heatmap.modules`` once, not repeated in every row.
    """
    if not isinstance(payload, dict):
        return payload
    if part == 'heatmap':
        payload['items'] = [
            {**item, 'mappings': []} if isinstance(item, dict) and item.get('mappings') else item
            for item in payload.get('items') or []
        ]
        heatmap = payload.get('heatmap')
        if isinstance(heatmap, dict):
            payload['heatmap'] = {**heatmap, 'rows': [
                {**row, 'modules': [
                    {
                        'module_id': cell.get('module_id'),
                        'weight': cell.get('weight'),
                        'mappings': [
                            coverage_part_mapping(mapping, COVERAGE_HEATMAP_MAPPING_FIELDS)
                            for mapping in cell.get('mappings') or []
                        ],
                    } if isinstance(cell, dict) else cell
                    for cell in row.get('modules') or []
                ]} if isinstance(row, dict) else row
                for row in heatmap.get('rows') or []
            ]}
        payload['mappingsOmitted'] = True
    elif part == 'items':
        payload['items'] = [
            {**item, 'mappings': [coverage_part_mapping(mapping) for mapping in item.get('mappings') or []]}
            if isinstance(item, dict) else item
            for item in payload.get('items') or []
        ]
        heatmap = payload.get('heatmap')
        if isinstance(heatmap, dict):
            payload['heatmap'] = {**heatmap, 'rows': []}
        payload['heatmapOmitted'] = True
    payload['placementFieldsOnly'] = True
    payload['view'] = part
    return payload
