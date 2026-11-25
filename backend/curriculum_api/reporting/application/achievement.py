"""Project applied KSB definitions and effective consumption for reporting."""


def _achievement_projection(
    payload,
    query,
    programme_id,
    *,
    _achievement_query,
    clean_str,
    coverage_normalise_code,
    float_weight,
    ksb_type_family,
    programme_row_ksb_source,
    source_display_metadata,
    split_ksb_source,
):
    source_type, source_id = programme_row_ksb_source(programme_id)
    source_type, source_id = split_ksb_source(source_type, source_id)
    coverage = payload.get('coverage') or {}
    definitions = []
    definition_by_identity = {}
    for item in coverage.get('items') or []:
        code = coverage_normalise_code(item.get('code'))
        item_source_type, item_source_id = split_ksb_source(
            item.get('source_type') or item.get('sourceType') or source_type,
            item.get('source_id') or item.get('sourceId') or source_id,
        )
        # A definition is valid only when it belongs to the currently applied
        # source. Mapping rows from an old source remain visible nowhere here.
        if not code or not source_type or not source_id:
            continue
        if (item_source_type, item_source_id) != (source_type, source_id):
            continue
        identity = f'{item_source_type}:{item_source_id}:{code}'
        definition = {
            'ksbDefinitionId': identity,
            'code': code,
            'type': ksb_type_family(item.get('ksb_type') or item.get('ksbType'), code),
            'description': clean_str(item.get('description') or item.get('title')) or code,
            'sourceType': item_source_type,
            'sourceId': item_source_id,
        }
        if identity not in definition_by_identity:
            definition_by_identity[identity] = definition
            definitions.append(definition)

    learners_by_id = {str(row.get('id')): row for row in payload.get('assignedLearners') or []}
    component_rows = payload.get('coverage', {}).get('components') or []
    component_by_id = {clean_str(row.get('id')): row for row in component_rows if clean_str(row.get('id'))}
    module_by_id = {clean_str(row.get('module_catalogue_id') or row.get('id')): row for row in (payload.get('coverage', {}).get('modules') or [])}
    requested_cohort = _achievement_query(query, 'cohort_id', 'cohort')
    requested_group = _achievement_query(query, 'group_id', 'group')
    requested_module = _achievement_query(query, 'module_id', 'module')
    requested_learner = _achievement_query(query, 'learner_id', 'learner')
    requested_component = _achievement_query(query, 'component_id', 'component')
    requested_type = _achievement_query(query, 'ksb_type', 'type').lower()
    requested_ksb = _achievement_query(query, 'ksb_id', 'ksb')
    search = _achievement_query(query, 'search').lower()
    date_from = _achievement_query(query, 'date_from')
    date_to = _achievement_query(query, 'date_to')
    valid_types = {'knowledge', 'skill', 'behaviour', 'behavior'}
    if requested_type and requested_type not in valid_types:
        requested_type = ''

    # The largest programme has ~130k achieved consumption rows, and every one
    # repeats a handful of learners, modules, weeks, titles, codes and weights.
    # Each distinct value is cleaned once and each learner's cohort/group/name
    # parts are built once (shared, never mutated) instead of once per row: the
    # rows are exactly what the per-row form built.
    cleaned = {}

    def clean(value):
        # Keyed with the type: 1, 1.0 and True are equal keys but clean differently.
        key = (type(value), value)
        try:
            return cleaned[key]
        except KeyError:
            cleaned[key] = result = clean_str(value)
            return result
        except TypeError:  # unhashable; never expected, kept correct anyway
            return clean_str(value)

    codes_seen, weights_seen, learner_parts = {}, {}, {}
    rows = []
    for raw in (payload.get('consumptionSources') or {}).get('progress') or []:
        raw_code = raw.get('code')
        code = codes_seen.get(raw_code)
        if code is None:
            code = codes_seen[raw_code] = coverage_normalise_code(raw_code)
        identity = f'{source_type}:{source_id}:{code}' if code else ''
        definition = definition_by_identity.get(identity)
        if not definition or not raw.get('countsTowardAchievement') or raw.get('scopeStatus') != 'in_scope':
            continue
        raw_learner_id = raw.get('learnerId')
        learner_key = str(raw_learner_id)
        parts_key = (type(raw_learner_id), raw_learner_id)
        parts = learner_parts.get(parts_key)
        if parts is None:
            learner = learners_by_id.get(learner_key, {})
            learner_cohort_id = clean(learner.get('cohortId'))
            learner_group_id = clean(learner.get('groupId'))
            parts = learner_parts[parts_key] = (
                {'id': raw.get('learnerId'), 'name': clean(learner.get('name')) or f"Learner {raw.get('learnerId')}"},
                {'id': learner_cohort_id, 'name': clean(learner.get('cohort'))},
                {'id': learner_group_id, 'name': clean(learner.get('group'))},
                {learner_cohort_id, clean(learner.get('cohort'))},
                {learner_group_id, clean(learner.get('group'))},
            )
        learner_part, cohort_part, group_part, cohort_keys, group_keys = parts
        component_id = clean(raw.get('componentId'))
        component = component_by_id.get(component_id, {})
        module_id = clean(raw.get('moduleRef') or component.get('module_catalogue_id'))
        consumed_at = clean(raw.get('submittedAt'))
        if requested_cohort and requested_cohort not in cohort_keys:
            continue
        if requested_group and requested_group not in group_keys:
            continue
        if requested_module and requested_module != module_id:
            continue
        if requested_learner and requested_learner != learner_key:
            continue
        if requested_component and requested_component != component_id:
            continue
        if requested_ksb and requested_ksb != identity and requested_ksb != code:
            continue
        if requested_type and requested_type not in {definition['type'], 'behavior' if definition['type'] == 'behaviour' else definition['type']}:
            continue
        if search and search not in f"{code} {definition['description']}".lower():
            continue
        if date_from and consumed_at and consumed_at[:10] < date_from:
            continue
        if date_to and consumed_at and consumed_at[:10] > date_to:
            continue
        raw_weight = raw.get('weight') or 0
        weight_key = (type(raw_weight), raw_weight)
        try:
            weight = weights_seen[weight_key]
        except (KeyError, TypeError):
            weight = float_weight(raw_weight)
            try:
                weights_seen[weight_key] = weight
            except TypeError:
                pass
        rows.append({
            'effectiveConsumptionId': f"{raw.get('learnerId')}:{component_id or raw.get('progressId')}:{identity}",
            'learner': learner_part,
            'cohort': cohort_part,
            'group': group_part,
            'module': {'id': module_id, 'title': clean(raw.get('module'))},
            'week': {'id': clean(raw.get('weekRef')), 'title': clean(raw.get('week'))},
            'component': {'id': component_id, 'title': clean(raw.get('componentTitle')), 'type': clean(raw.get('componentType'))},
            'ksb': definition,
            'consumedAt': consumed_at,
            'weight': weight,
        })

    grouped = {definition['ksbDefinitionId']: [] for definition in definitions}
    for row in rows:
        grouped[row['ksb']['ksbDefinitionId']].append(row)
    items = []
    for definition in definitions:
        matches = grouped.get(definition['ksbDefinitionId'], [])
        timestamps = [row['consumedAt'] for row in matches if row['consumedAt']]
        items.append({
            **definition,
            'learnerCount': len({str(row['learner']['id']) for row in matches}),
            'consumptionCount': len(matches),
            'componentCount': len({row['component']['id'] for row in matches if row['component']['id']}),
            'firstConsumedAt': min(timestamps) if timestamps else None,
            'lastConsumedAt': max(timestamps) if timestamps else None,
        })
    # Both tables are paged at the API boundary.  The effective rows are
    # already deduplicated by the canonical progress reader; slicing here keeps
    # the response bounded while preserving stable summary totals.
    ksb_page = max(1, int(query.get('ksb_page') or 1))
    ksb_page_size = min(100, max(1, int(query.get('ksb_page_size') or 25)))
    ksb_start = (ksb_page - 1) * ksb_page_size
    paged_items = items[ksb_start:ksb_start + ksb_page_size]
    return {
        'scope': {'programmeId': programme_id, 'cohortId': requested_cohort or None, 'groupId': requested_group or None, 'moduleId': requested_module or None},
        # Named by the same resolver as the coverage source, so the tab says
        # "Project controls professional (ST0845 v1.1)", not the bare id.
        'appliedSource': {
            'type': source_type,
            'id': source_id,
            'label': (source_display_metadata(source_type, source_id).get('sourceLabel') if source_id else '') or coverage.get('sourceLabel') or source_id,
            'definitionCount': len(definitions),
        },
        'summary': {
            'appliedKsbCount': len(definitions),
            'consumedKsbCount': len({row['ksb']['ksbDefinitionId'] for row in rows}),
            'learnerCount': len({str(row['learner']['id']) for row in rows}),
            'consumptionCount': len(rows),
        },
        'items': paged_items,
        '_allItems': items,
        'ksbPagination': {
            'page': ksb_page,
            'pageSize': ksb_page_size,
            'total': len(items),
            'hasNext': ksb_start + ksb_page_size < len(items),
        },
        'consumptions': rows,
    }, None


def _achievement_query(query, name, *aliases, clean_str):
    for key in (name, *aliases):
        value = clean_str(query.get(key))
        if value:
            return value
    return ''
