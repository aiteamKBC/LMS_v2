"""Project supplied curriculum/material payloads into audit assets without persisting them."""


def scope_assets_to_ui_material(
    material, source_assets, *, clean, read_json_value,
):
    """Label authored-module assets with their learner-facing material name."""
    assets = []
    for source_asset in source_assets:
        asset = dict(source_asset)
        settings = dict(read_json_value(asset.get('settings'), {}))
        settings.setdefault('sourceModuleTitle', clean(asset.get('module_title')))
        asset['programme_source_id'] = clean(
            source_asset.get('programme_source_id'),
            clean(source_asset.get('programme_id')),
        )
        asset['programme_id'] = clean(material.get('programme_id'))
        asset['programme_name'] = clean(material.get('programme_name'))
        asset['module_title'] = clean(material.get('name'))
        asset['settings'] = settings
        asset['raw_payload'] = {
            'uiMaterialKey': clean(material.get('key')),
            'uiMaterialName': clean(material.get('name')),
            'sourceModuleId': clean(asset.get('module_catalogue_id')),
            'sourceModuleTitle': settings.get('sourceModuleTitle', ''),
        }
        assets.append(asset)
    return assets


def base_asset(
    component, context, raw_payload, imported_from, *, clean, component_settings,
    content_kind_for_component, first_clean, first_value, normalised_component_type, parse_float,
    parse_int, read_json_value,
):
    settings = component_settings(component)
    programme = context.get('programme') if isinstance(context.get('programme'), dict) else {}
    module = context.get('module') if isinstance(context.get('module'), dict) else {}
    week = context.get('week') if isinstance(context.get('week'), dict) else {}
    component_type = normalised_component_type(component)
    programme_id = clean(
        first_value(programme, 'id', 'sourceId', 'source_id', 'programmeId', 'programme_id')
        or context.get('programme_id')
        or first_value(component, 'programmeId', 'programme_id')
        or first_value(module, 'programmeId', 'programme_id')
        or first_value(component, 'programme', 'programmeName', 'programme_name')
        or first_value(module, 'programme', 'programmeName', 'programme_name'),
        'unassigned-programme',
    )
    programme_name = clean(
        first_value(programme, 'name', 'programme', 'programmeName', 'programme_name')
        or context.get('programme_name')
        or first_value(component, 'programme', 'programmeName', 'programme_name')
        or first_value(module, 'programme', 'programmeName', 'programme_name'),
        programme_id,
    )
    return {
        'programme_id': programme_id,
        'programme_source_id': clean(first_value(programme, 'sourceId', 'source_id'), programme_id),
        'programme_name': programme_name,
        'module_catalogue_id': clean(
            first_value(component, 'moduleCatalogueId', 'module_catalogue_id', 'moduleId', 'module_id')
            or first_value(module, 'moduleCatalogueId', 'module_catalogue_id', 'catalogueId', 'id')
            or context.get('module_catalogue_id')
        ),
        'module_title': clean(
            first_value(component, 'module', 'moduleTitle', 'module_title')
            or first_value(module, 'name', 'title', 'moduleTitle', 'module_title')
            or context.get('module_title')
        ),
        'week_id': clean(first_value(component, 'weekId', 'week_id') or first_value(week, 'id', 'weekId', 'week_id') or context.get('week_id')),
        'week_number': parse_int(first_value(component, 'weekNumber', 'week_number') or first_value(week, 'weekNumber', 'week_number')),
        'week_title': clean(
            first_value(component, 'weekTitle', 'week_title', 'week')
            or first_value(week, 'title', 'weekTitle', 'week_title', 'week')
            or context.get('week_title')
        ),
        'component_id': clean(first_value(component, 'id', 'componentId', 'component_id')),
        'component_type': component_type,
        'title': first_clean(component, 'title', 'name', 'componentTitle', fallback=content_kind_for_component(component_type).replace('_', ' ').title()),
        'description': first_clean(component, 'description', 'summary', 'shortDescription'),
        'file_name': first_clean(settings, 'uploadedFileName', 'fileName', 'assignmentFileName'),
        'content_type': first_clean(settings, 'uploadedFileContentType', 'contentType', 'mimeType'),
        'file_size': parse_int(first_value(settings, 'uploadedFileSize', 'fileSize', 'size')),
        'duration_minutes': parse_int(first_value(settings, 'durationMinutes', 'estimatedReadingTime')),
        'expected_otjh': parse_float(first_value(component, 'expectedOtjh', 'expected_otjh')),
        'points': parse_int(first_value(component, 'points')),
        'status': first_clean(settings, 'contentStatus', 'componentBuilderStatus') or first_clean(component, 'status'),
        'ksb_mappings': read_json_value(first_value(component, 'ksbMappings', 'ksb_mappings', fallback=[]), []),
        'settings': settings,
        'raw_component': component,
        'raw_payload': raw_payload if isinstance(raw_payload, dict) else {'payload': raw_payload},
        'imported_from': imported_from,
    }


def component_assets(
    component, context, raw_payload, imported_from='curriculum', *, base_asset, component_settings,
    content_kind_for_component, first_clean, normalised_component_type, primary_source_for_component,
    render_target, stamp_asset,
):
    settings = component_settings(component)
    component_type = normalised_component_type(component)
    kind = content_kind_for_component(component_type)
    source_url, embed_code = primary_source_for_component(component, settings, component_type)
    base = base_asset(component, context, raw_payload, imported_from)
    embed_url, render_mode = render_target(source_url, embed_code, kind)
    assets = [{
        **base,
        'content_kind': kind,
        'source_url': source_url,
        'embed_url': embed_url,
        'embed_code': embed_code,
        'render_mode': render_mode,
    }]
    audio_url = first_clean(settings, 'audioUrl')
    if component_type == 'reading' and audio_url:
        audio_embed_url, audio_render_mode = render_target(audio_url, '', 'audio')
        assets.append({
            **base,
            'content_kind': 'audio',
            'title': f'{base["title"]} audio',
            'source_url': audio_url,
            'embed_url': audio_embed_url,
            'embed_code': '',
            'render_mode': audio_render_mode,
        })
    return [stamp_asset(asset) for asset in assets]


def stamp_asset(
    asset, *, stable_asset_id, timezone,
):
    source_key = stable_asset_id(asset)
    now = timezone.now()
    return {
        **asset,
        'id': source_key,
        'source_key': source_key,
        'imported_at': now,
        'updated_at': now,
    }


def iter_components(
    payload, context=None, *, clean, context_with, first_clean, first_value, is_component_like,
    iter_components,
):
    context = context or {}
    if isinstance(payload, list):
        for item in payload:
            yield from iter_components(item, context)
        return
    if not isinstance(payload, dict):
        return

    if isinstance(payload.get('programme'), dict):
        context = context_with(context, 'programme', payload['programme'])
    elif any(payload.get(key) for key in ('programmeId', 'programme_id', 'programmeName', 'programme_name')):
        context = {
            **context,
            'programme_id': first_clean(payload, 'programmeId', 'programme_id'),
            'programme_name': first_clean(payload, 'programmeName', 'programme_name', 'programme'),
        }

    if isinstance(payload.get('module'), dict):
        context = context_with(context, 'module', payload['module'])
    if isinstance(payload.get('week'), dict):
        context = context_with(context, 'week', payload['week'])

    flat = payload.get('flat')
    if isinstance(flat, dict) and isinstance(flat.get('components'), list):
        modules_by_id = {}
        for module in flat.get('modules') or []:
            module_id = clean(first_value(module, 'moduleCatalogueId', 'catalogueId', 'moduleId', 'id'))
            if module_id:
                modules_by_id[module_id] = module
        for component in flat['components']:
            module_id = clean(first_value(component, 'moduleCatalogueId', 'moduleId', 'module_catalogue_id'))
            item_context = context_with(context, 'module', modules_by_id.get(module_id, {}))
            yield component, item_context
        return

    if is_component_like(payload):
        yield payload, context

    child_context = context
    if any(clean(payload.get(key)) for key in ('moduleCatalogueId', 'catalogueId', 'moduleId', 'module_catalogue_id')):
        child_context = context_with(child_context, 'module', payload)
    if any(clean(payload.get(key)) for key in ('weekId', 'week_id', 'weekNumber', 'week_number')) and not is_component_like(payload):
        child_context = context_with(child_context, 'week', payload)

    for key in ('components', 'items', 'activities', 'lessons', 'resources'):
        if isinstance(payload.get(key), list):
            for child in payload[key]:
                yield from iter_components(child, child_context)
    for key in ('modules', 'courses', 'weeks', 'weekStructure', 'data', 'results', 'programmeStructure'):
        if isinstance(payload.get(key), (list, dict)):
            yield from iter_components(payload[key], child_context)


def assets_from_payload(
    payload, imported_from='payload', *, component_assets, iter_components,
):
    assets = []
    seen = set()
    for component, context in iter_components(payload):
        for asset in component_assets(component, context, payload, imported_from):
            if asset['id'] in seen:
                continue
            seen.add(asset['id'])
            assets.append(asset)
    return assets


def assets_from_curriculum_programme(
    programme_identifier, *, ProgrammeAuditNotFound, assets_from_payload,
    curriculum_views_build_curriculum_programme_tree_detail_payload,
):
    payload = curriculum_views_build_curriculum_programme_tree_detail_payload(programme_identifier, 'all')
    if not payload:
        raise ProgrammeAuditNotFound('Programme not found.')
    return assets_from_payload(payload, imported_from='curriculum'), payload


def kbc_wordpress_activity_asset(
    group, activity, *, clean, first_clean, normalise, parse_float, parse_int, render_target,
    stamp_asset,
):
    """Map one WordPress KBC-LMS ``groups[].activities[]`` entry to an asset row.

    The source endpoint is paginated by student (not by programme/material), so
    every activity payload it returns is plain course-material data with no
    student identifiers in it - see ``sync_kbc_wordpress_all_programmes``.
    """
    activity_type = normalise(clean(activity.get('activity_type')))
    video = activity.get('video') if isinstance(activity.get('video'), dict) else None
    audio = activity.get('audio') if isinstance(activity.get('audio'), dict) else None
    reading = activity.get('reading') if isinstance(activity.get('reading'), dict) else None
    quiz = activity.get('quiz') if isinstance(activity.get('quiz'), dict) else None

    if video is not None:
        kind = 'video'
        source_url = clean(video.get('iframe_url'))
        duration = parse_float(video.get('configured_duration_min'))
    elif audio is not None:
        kind = 'audio'
        source_url = clean(audio.get('iframe_url'))
        duration = parse_float(audio.get('configured_duration_min'))
    elif reading is not None:
        kind = 'reading'
        source_url = clean(reading.get('iframe_url'))
        duration = None
    elif quiz is not None:
        kind = 'quiz'
        source_url = ''
        duration = None
    else:
        kind = activity_type or 'activity'
        source_url = ''
        duration = None

    embed_url, render_mode = render_target(source_url, '', kind)
    programme_id = clean(group.get('group_id'))
    programme_name = clean(group.get('group_name'), programme_id)
    component_id = clean(activity.get('activity_id'))

    asset = {
        'programme_id': programme_id,
        'programme_source_id': programme_id,
        'programme_name': programme_name,
        'module_catalogue_id': '',
        'module_title': '',
        'week_id': '',
        'week_number': None,
        'week_title': '',
        'component_id': component_id,
        'component_type': clean(activity.get('activity_type')),
        'content_kind': kind,
        'title': first_clean(activity, 'title', fallback=kind.title()),
        'description': '',
        'source_url': source_url,
        'embed_url': embed_url,
        'embed_code': '',
        'render_mode': render_mode,
        'file_name': '',
        'content_type': '',
        'file_size': None,
        'duration_minutes': parse_int(duration),
        'expected_otjh': None,
        'points': parse_int((quiz or {}).get('maximum_score')),
        'status': '',
        'ksb_mappings': [],
        'settings': {'activity_date': clean(activity.get('activity_date'))},
        'raw_component': activity,
        'raw_payload': {'group_id': group.get('group_id'), 'group_name': group.get('group_name')},
        'imported_from': 'kbc-wordpress',
    }
    return stamp_asset(asset)


def serialise_asset_row(
    row, *, JSON_COLUMNS, read_json_value,
):
    for column in JSON_COLUMNS:
        row[column] = read_json_value(row.get(column), [] if column == 'ksb_mappings' else {})
    for column in ('imported_at', 'updated_at'):
        if row.get(column) is not None and hasattr(row[column], 'isoformat'):
            row[column] = row[column].isoformat()
    if row.get('expected_otjh') is not None:
        row['expected_otjh'] = float(row['expected_otjh'])
    return row
