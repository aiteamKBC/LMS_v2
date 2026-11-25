"""Assemble module catalogue reads and enrich delivery records with authoring data.

Readers and compatibility rules are supplied by the composition boundary.
Compatibility callers retain their existing defaults. Programme detail supplies
one authoritative normalized snapshot instead of embedded config content.
"""
from collections import defaultdict
from ..domain.module_selection import structure_ksb_codes

from curriculum_api.catalogue.application.module_projection import curriculum_module_from_authoring_payload as _default_curriculum_module_from_authoring_payload
from curriculum_api.catalogue.application.scope_identity import authoring_summary_delivery_signature as _default_authoring_summary_delivery_signature
from curriculum_api.catalogue.application.scope_identity import module_delivery_signature as _default_module_delivery_signature
from curriculum_api.catalogue.application.scope_identity import programme_identifier_looks_exact as _default_programme_identifier_looks_exact
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_json_list as _default_programme_config_json_list
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity as _default_programme_config_identity
from curriculum_api.catalogue.domain.ranking import best_authoring_summary as _default_best_authoring_summary
from curriculum_api.catalogue.domain.session_identity import meaningful_session_names as _default_meaningful_session_names
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import unique as _default_unique


def programme_authoring_module_rows(
    programme,
    config=None,
    *,
    module_rows=None,
    clean_str=_default_clean_str,
    normalise=_default_normalise,
    programme_config_identity=_default_programme_config_identity,
    programme_deleted_row,
    programme_identifier_looks_exact=_default_programme_identifier_looks_exact,
    row_has_deleted_at,
    safe_module_index_rows,
):
    programme_ids = {
        clean_str(programme.get('id')),
        clean_str(programme.get('sourceId')),
        clean_str(programme_config_identity(config)),
    }
    programme_ids = {value for value in programme_ids if value}
    programme_names = {normalise(programme.get('name')), normalise((config or {}).get('name'))}
    programme_names = {value for value in programme_names if value}
    rows = []
    # The shared index projection: callers read ids, names and schedule fields,
    # never ksb_remap_report.
    for row in (safe_module_index_rows() if module_rows is None else module_rows):
        if row_has_deleted_at(row) or programme_deleted_row(row):
            continue
        row_programme_id = clean_str(row.get('programme_id'))
        row_programme_name = normalise(row.get('programme_name'))
        if row_programme_id and row_programme_id in programme_ids:
            rows.append(row)
            continue
        # A module that names another programme by id is that programme's, even
        # while it still carries a name this one answers to. Two programmes may
        # share a name, and a rename that has not reached the children leaves
        # them holding the old one -- which is how this programme's page came to
        # list another programme's modules.
        if row_programme_id and programme_identifier_looks_exact(row_programme_id):
            continue
        if row_programme_name and row_programme_name in programme_names:
            rows.append(row)
    return rows


def programme_authoring_modules(
    programme,
    config=None,
    *,
    module_rows=None,
    child_rows=None,
    payloads_by_id=None,
    CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
    clean_str=_default_clean_str,
    curriculum_module_from_authoring_payload=_default_curriculum_module_from_authoring_payload,
    format_date=_default_format_date,
    get_authoring_structure_payloads,
    programme_authoring_module_rows,
):
    rows = programme_authoring_module_rows(programme, config) if module_rows is None else module_rows
    modules = []
    # One batched read for the whole programme. The per-module reader issues seven
    # queries each, so a 122-module programme spent 854 round trips (~105s) here.
    # get_authoring_structure_payloads() returns the identical payload in seven
    # queries total -- the two are compared field by field before this swap.
    if payloads_by_id is None:
        payloads_by_id = get_authoring_structure_payloads(
            [clean_str(row.get('module_catalogue_id')) for row in rows],
            component_columns=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
            **({'child_rows': child_rows} if child_rows is not None else {}),
        )
    for row in rows:
        module_id = clean_str(row.get('module_catalogue_id'))
        payload = payloads_by_id.get(module_id) if module_id else None
        if payload:
            modules.append(curriculum_module_from_authoring_payload(payload))
        else:
            modules.append(curriculum_module_from_authoring_payload({
                'moduleCatalogueId': module_id,
                'title': row.get('title') or '',
                'programmeId': row.get('programme_id') or '',
                'programmeName': row.get('programme_name') or '',
                'cohortId': row.get('cohort_id') or '',
                'cohort': row.get('cohort_name') or '',
                'groupId': row.get('group_id') or '',
                'group': row.get('group_name') or '',
                'sessionsNumber': row.get('sessions_number') or 0,
                'startDate': format_date(row.get('start_date')),
                'endDate': format_date(row.get('end_date')),
                'weekDays': row.get('session_week_day') or '',
                'startTime': row.get('session_start_time') or '',
                'endTime': row.get('session_end_time') or '',
                'tutor': row.get('tutor_name') or '',
                'description': row.get('description') or '',
            }))
    return modules


def programme_config_modules(
    config,
    *,
    clean_str=_default_clean_str,
    curriculum_module_from_authoring_payload=_default_curriculum_module_from_authoring_payload,
    get_authoring_structure_payloads,
    programme_config_json_list=_default_programme_config_json_list,
):
    """Compatibility references only: never display embedded config content."""
    from ..domain.programme_scope import module_catalogue_id
    ids = []
    for item in programme_config_json_list(config, 'modules'):
        if isinstance(item, dict):
            identifier = module_catalogue_id(item, clean_str=clean_str) or clean_str(item.get('id') or item.get('sourceId'))
        else:
            identifier = clean_str(item)
        if identifier and identifier not in ids:
            ids.append(identifier)
    if not ids:
        return []
    payloads = get_authoring_structure_payloads(ids)
    return [curriculum_module_from_authoring_payload(payloads[identifier])
            for identifier in ids if payloads.get(identifier)]


def enrich_curriculum_modules_with_authoring_details(
    modules,
    *,
    child_rows=None,
    authoring_payloads=None,
    CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
    clean_str=_default_clean_str,
    get_authoring_structure_payloads,
    meaningful_session_names=_default_meaningful_session_names,
    unique=_default_unique,
):
    module_ids = unique([
        clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
        for module in modules or []
        if clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
    ])
    if not module_ids:
        return modules
    supplied_snapshot = authoring_payloads is not None
    if authoring_payloads is None:
        authoring_payloads = get_authoring_structure_payloads(
            module_ids,
            include_staff=False,
            include_quality=False,
            include_extra=False,
            component_columns=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
            **({'child_rows': child_rows} if child_rows is not None else {}),
        )
    enriched = []
    for module in modules or []:
        module_id = clean_str(module.get('moduleCatalogueId') or module.get('catalogueId') or module.get('moduleId') or module.get('structureId'))
        authoring = authoring_payloads.get(module_id)
        if not authoring:
            enriched.append(module)
            continue
        def authored(key, fallback):
            # An explicit empty/zero value in the normalized snapshot is data,
            # not permission to revive a stale delivery/config value.
            if supplied_snapshot and key in authoring:
                return authoring[key]
            return authoring.get(key) or fallback

        delivery_metadata = {
            **(module.get('deliveryMetadata') if isinstance(module.get('deliveryMetadata'), dict) else {}),
            **(authoring.get('deliveryMetadata') if isinstance(authoring.get('deliveryMetadata'), dict) else {}),
        }
        if supplied_snapshot:
            session_names = meaningful_session_names(
                authoring.get('sessionNames') or [week.get('title') for week in authoring.get('weekStructure') or []]
            )
            ksb_codes = structure_ksb_codes(authoring, clean_str=clean_str, unique=unique)
        else:
            session_names = meaningful_session_names(authoring.get('sessionNames')) or module.get('sessionNames') or []
            ksb_codes = authoring.get('ksbCodes') or module.get('ksbCodes') or []
        enriched.append({
            **module,
            'moduleCatalogueId': authoring.get('catalogueId') or module.get('moduleCatalogueId') or module_id,
            'catalogueId': authoring.get('catalogueId') or module.get('catalogueId') or module_id,
            'structureId': authoring.get('catalogueId') or module.get('structureId') or module_id,
            'name': authored('title', module.get('name')),
            'notes': (authoring.get('description') if authoring.get('description') is not None else module.get('notes')),
            'coverImage': authored('coverImage', module.get('coverImage') or ''),
            'startDate': authored('startDate', module.get('startDate')),
            'endDate': authored('endDate', module.get('endDate')),
            'sessionsNumber': authored('sessionsNumber', module.get('sessionsNumber')),
            'weeklySchedule': authoring.get('weeklySchedule') or [],
            'scheduleMode': authoring.get('scheduleMode') or 'group',
            'sessionHolidays': authoring.get('sessionHolidays') or [],
            'calendarPolicy': authoring.get('calendarPolicy'),
            'weekStartsOn': authoring.get('weekStartsOn'),
        'weekBoundaryMode': authoring.get('weekBoundaryMode'),
            'deliveryWeeks': authoring.get('deliveryWeeks'),
            'weekDays': authored('weekDays', module.get('weekDays') or ''),
            'startTime': authored('startTime', module.get('startTime') or ''),
            'endTime': authored('endTime', module.get('endTime') or ''),
            'weeks': authored('weeks', module.get('weeks')),
            'weekStructure': authored('weekStructure', module.get('weekStructure') or []),
            'sessionNames': session_names,
            'moduleKsbMappings': authored('moduleKsbMappings', module.get('moduleKsbMappings') or []),
            'ksbCodes': ksb_codes,
            'deliveryMetadata': delivery_metadata,
        })
    return enriched


def enrich_modules_with_authoring(
    modules,
    include_programme_deleted=False,
    include_content=True,
    *,
    list_only=False,
    COURSE_PRICING_FIELDS,
    authoring_catalogue_summaries,
    authoring_summary_catalogue_item,
    authoring_summary_delivery_signature=_default_authoring_summary_delivery_signature,
    best_authoring_summary=_default_best_authoring_summary,
    clean_str=_default_clean_str,
    is_canonical_module_catalogue_id,
    logger,
    module_delivery_signature=_default_module_delivery_signature,
    parse_int=_default_parse_int,
    programme_deleted_row,
    unique=_default_unique,
):
    try:
        authoring_by_id = authoring_catalogue_summaries(
            include_programme_deleted=include_programme_deleted, include_content=include_content,
            **({'list_only': True} if list_only else {}),
        )
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
                    # The name is taken from the authoring row, so the id has to
                    # travel with it. A catalogue module (visibility=all builds
                    # one per authoring module) arrives with no programme link at
                    # all, and taking the name alone left it saying "MBA" while
                    # belonging to the programme that had since been renamed --
                    # unattributable by id and miscounted by name.
                    'programmeId': module.get('programmeId') or saved.get('programmeId') or '',
                    'weeks': saved['weeks'] or module.get('weeks'),
                    'weekStructure': saved.get('weekStructure') or module.get('weekStructure') or [],
                    'totalOtjh': saved.get('totalOtjh') or module.get('totalOtjh') or 0,
                    'declaredTotalOtjh': saved.get('declaredTotalOtjh') or saved.get('totalOtjh') or module.get('declaredTotalOtjh') or 0,
                    'ksbCount': ksb_count,
                    'lessons': saved['lessonCount'],
                    'quizzes': saved['quizCount'],
                    'status': module_status,
                    'authoringStatus': saved['status'],
                    'sourceType': module_source_type,
                    'isFreeCourse': saved.get('isFreeCourse', False),
                    **{key: saved.get(key) for key in COURSE_PRICING_FIELDS},
                    'ksbProfileSourceId': saved.get('ksbProfileSourceId') or module.get('ksbProfileSourceId') or '',
                    'deliveryStatus': module.get('deliveryStatus') or saved.get('deliveryStatus') or 'unknown',
                    'notes': saved['description'],
                    'coverImage': saved.get('coverImage') or module.get('coverImage') or '',
                    'createdAt': saved.get('createdAt') or module.get('createdAt') or '',
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
                    'isProgrammeDeleted': programme_deleted_row(module) or programme_deleted_row(saved),
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
