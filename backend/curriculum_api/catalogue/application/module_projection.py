"""Build module and placement read payloads from supplied records.

Legacy normalization and delivery read rules are explicit capabilities; this
module performs no database, HTTP, scheduling write or provider operation.
"""

from curriculum_api.catalogue.domain.delivery_identity import actual_cohort_identity as _default_actual_cohort_identity
from curriculum_api.catalogue.domain.delivery_identity import actual_group_identity as _default_actual_group_identity
from curriculum_api.catalogue.domain.hierarchy_values import get_module_session_names as _default_get_module_session_names
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_MODULE_FLAG as _default_WEEK_OUTLINE_MODULE_FLAG
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_WEEK_FLAG as _default_WEEK_OUTLINE_WEEK_FLAG
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def curriculum_module_from_authoring_payload(
    payload,
    *,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
):
    if not isinstance(payload, dict):
        return {}
    catalogue_id = clean_str(
        payload.get('moduleCatalogueId')
        or payload.get('catalogueId')
        or payload.get('moduleId')
        or payload.get('structureId')
        or payload.get('module_catalogue_id')
    )
    week_structure = payload.get('weekStructure') or payload.get('week_structure') or []
    sessions_number = parse_int(payload.get('sessionsNumber') or payload.get('sessions_number'), len(week_structure))
    return {
        **payload,
        'id': catalogue_id or clean_str(payload.get('id')),
        'sourceId': catalogue_id or clean_str(payload.get('sourceId') or payload.get('id')),
        'moduleId': catalogue_id or clean_str(payload.get('moduleId')),
        'moduleCatalogueId': catalogue_id or clean_str(payload.get('moduleCatalogueId')),
        'catalogueId': catalogue_id or clean_str(payload.get('catalogueId')),
        'structureId': catalogue_id or clean_str(payload.get('structureId')),
        'name': payload.get('name') or payload.get('title') or payload.get('moduleName') or '',
        'programmeId': payload.get('programmeId') or payload.get('programme_id') or '',
        'programme': payload.get('programme') or payload.get('programmeName') or payload.get('programme_name') or '',
        'cohortId': payload.get('cohortId') or payload.get('cohort_id') or '',
        'cohort': payload.get('cohort') or payload.get('cohortName') or payload.get('cohort_name') or '',
        'groupId': payload.get('groupId') or payload.get('group_id') or '',
        'group': payload.get('group') or payload.get('groupName') or payload.get('group_name') or '',
        'notes': payload.get('notes') if payload.get('notes') is not None else payload.get('description') or '',
        'sessionsNumber': sessions_number,
        'weeks': parse_int(payload.get('weeks'), sessions_number),
        'weekStructure': week_structure,
    }


def normalise_programme_config_cohort(item, programme, *, clean_str=_default_clean_str):
    if not isinstance(item, dict):
        return {}
    cohort_id = clean_str(item.get('id') or item.get('cohortId') or item.get('cohort_id'))
    return {
        **item,
        'id': cohort_id,
        'name': item.get('name') or item.get('cohortName') or item.get('cohort_name') or cohort_id,
        'programmeId': item.get('programmeId') or item.get('programme_id') or programme.get('sourceId') or programme.get('id'),
        'programme': item.get('programme') or item.get('programmeName') or item.get('programme_name') or programme.get('name'),
    }


def normalise_programme_config_group(item, programme, *, clean_str=_default_clean_str):
    if not isinstance(item, dict):
        return {}
    group_id = clean_str(item.get('id') or item.get('groupId') or item.get('group_id'))
    return {
        **item,
        'id': group_id,
        'name': item.get('name') or item.get('groupName') or item.get('group_name') or group_id,
        'cohortId': item.get('cohortId') or item.get('cohort_id') or '',
        'cohort': item.get('cohort') or item.get('cohortName') or item.get('cohort_name') or '',
        'programmeId': item.get('programmeId') or item.get('programme_id') or programme.get('sourceId') or programme.get('id'),
        'programme': item.get('programme') or item.get('programmeName') or item.get('programme_name') or programme.get('name'),
        'moduleIds': item.get('moduleIds') or item.get('module_ids') or [],
        'modules': item.get('modules') or item.get('moduleNames') or item.get('module_names') or [],
    }


def build_modules(
    module_rows,
    training_rows,
    program_configs=None,
    include_unused=False,
    *,
    actual_cohort_identity=_default_actual_cohort_identity,
    actual_group_identity=_default_actual_group_identity,
    clean_str=_default_clean_str,
    codes_from_session_ksb,
    delivery_status_for_training_row,
    format_date=_default_format_date,
    get_module_session_names=_default_get_module_session_names,
    module_stored_week_count,
    normalise=_default_normalise,
    parse_int=_default_parse_int,
    program_config_by_id,
    programme_deleted_row,
    programme_identity=_default_programme_identity,
    slugify=_default_slugify,
    training_row_invalid_explicit_module_catalogue_id,
    training_row_module_catalogue_id,
):
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
        programme_id = identity['sourceId']
        cohort = actual_cohort_identity(row, programme_name)
        if not cohort:
            cohort_name = clean_str(row.get('Cohort_name') or row.get('cohort') or row.get('cohort_name') or 'Unassigned cohort')
            cohort = {'id': f'{slugify(programme_name)}-{slugify(cohort_name)}', 'name': cohort_name}
        group = actual_group_identity(row, cohort['id'])
        if not group:
            group_name = clean_str(row.get('group') or row.get('Group_name') or row.get('group_name') or 'Unassigned group')
            group = {'id': f'{cohort["id"]}-{slugify(group_name)}', 'name': group_name}
        cohort_name = cohort['name']
        cohort_id = cohort['id']
        group_name = group['name']
        group_id = group['id']
        catalogue_id = training_row_module_catalogue_id(row)
        invalid_explicit_id = training_row_invalid_explicit_module_catalogue_id(row)
        catalogue = module_catalog.get(str(catalogue_id)) or module_catalog.get(normalise(row.get('module_name')))
        name = row.get('module_name') or (catalogue.get('Module_name') if catalogue else f'Module {row.get("id")}')
        delivery_module_id = clean_str(row.get('id')) or catalogue_id
        canonical_module_id = catalogue_id or delivery_module_id
        session_count = parse_int(row.get('sessions_number'), parse_int((catalogue or {}).get('Number of sessions'), 0))
        # The delivery row's own week count, kept apart from its session count:
        # a Mon+Thu group runs `session_count` sessions across half as many weeks.
        week_count = module_stored_week_count(row) or session_count
        ksb_codes = codes_from_session_ksb(row.get('session_ksb_json')) or codes_from_session_ksb((catalogue or {}).get('session_ksb_json'))
        start_date = format_date(
            row.get('start_date')
            or row.get('startDate')
            or row.get('Starting_date_lable')
            or (catalogue or {}).get('start_date')
            or (catalogue or {}).get('startDate')
        )
        end_date = format_date(
            row.get('end_date')
            or row.get('endDate')
            or (catalogue or {}).get('end_date')
            or (catalogue or {}).get('endDate')
        )
        modules.append({
            'id': canonical_module_id,
            'moduleId': canonical_module_id,
            'moduleCatalogueId': catalogue_id,
            'deliveryRowId': row.get('id'),
            'deliveryModuleId': delivery_module_id,
            'invalidModuleCatalogueId': invalid_explicit_id,
            'structureId': canonical_module_id,
            'sourceId': catalogue_id,
            'catalogueId': catalogue_id,
            'name': name,
            'programmeId': programme_id,
            'programme': programme_name,
            'cohortId': cohort_id,
            'cohort': cohort_name,
            'groupId': group_id,
            'group': group_name,
            'weeks': week_count,
            'sessionsNumber': session_count,
            'ksbCount': len(ksb_codes),
            'lessons': session_count,
            'quizzes': 0,
            'assignments': 0,
            'status': 'published',
            'authoringStatus': 'published',
            'deliveryStatus': delivery_status_for_training_row(row),
            'startDate': start_date,
            'endDate': end_date,
            'author': '',
            'tutor': row.get('Tutor_name') or '',
            'coach': row.get('coach_name') or '',
            'lastUpdated': '',
            'color': meta.get('module_color') or (catalogue or {}).get('Module_colour') or '#6941c6',
            'notes': row.get('notes') or (catalogue or {}).get('Notes') or '',
            'sessionNames': get_module_session_names(catalogue or {}),
            'ksbCodes': sorted(ksb_codes),
            'isProgrammeDeleted': programme_deleted_row(row),
        })

    if include_unused:
        used_catalogue_ids = {str(training_row_module_catalogue_id(row)) for row in training_rows if training_row_module_catalogue_id(row)}
        for row in module_rows:
            module_id = str(row.get('Module ID'))
            if module_id in used_catalogue_ids:
                continue
            name = row.get('Module_name') or f'Module {module_id}'
            session_count = parse_int(row.get('Number of sessions'), len(get_module_session_names(row)))
            ksb_codes = codes_from_session_ksb(row.get('session_ksb_json'))
            start_date = format_date(row.get('start_date') or row.get('startDate') or row.get('Starting_date_lable'))
            end_date = format_date(row.get('end_date') or row.get('endDate'))
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
                # This module's own count. It used to read `week_count`, left
                # behind by the delivery loop above, so every catalogue module in
                # the payload carried the last delivery row's week count.
                # enrich_modules_with_authoring replaces it with the authored
                # count wherever the module has one.
                'weeks': session_count,
                'sessionsNumber': session_count,
                'ksbCount': len(ksb_codes),
                'lessons': session_count,
                'quizzes': 0,
                'assignments': 0,
                'status': 'published',
                'authoringStatus': 'published',
                'deliveryStatus': 'unknown',
                'startDate': start_date,
                'endDate': end_date,
                'author': '',
                'tutor': '',
                'coach': '',
                'lastUpdated': '',
                'color': row.get('Module_colour') or '#6941c6',
                'notes': row.get('Notes') or '',
                'sessionNames': get_module_session_names(row),
                'ksbCodes': sorted(ksb_codes),
                'isProgrammeDeleted': programme_deleted_row(row),
            })
    return modules


def module_rows_with_week_outline(
    modules,
    *,
    WEEK_OUTLINE_MODULE_FLAG=_default_WEEK_OUTLINE_MODULE_FLAG,
    WEEK_OUTLINE_WEEK_FLAG=_default_WEEK_OUTLINE_WEEK_FLAG,
):
    """The modules with each ``weekStructure`` week reduced to its own fields.

    Drops only the week's ``components`` -- the key, not its value: an empty
    list would say the week has none. The week is marked ``componentsOmitted``
    and the module ``weekStructureOutline``. Copies rather than edits: the
    module dicts come from shared, cached builders.
    """
    projected = []
    for module in modules:
        weeks = module.get('weekStructure')
        if not isinstance(weeks, list):
            projected.append(module)
            continue
        projected.append({
            **module,
            'weekStructure': [
                {
                    **{key: value for key, value in week.items() if key != 'components'},
                    WEEK_OUTLINE_WEEK_FLAG: True,
                } if isinstance(week, dict) else week
                for week in weeks
            ],
            WEEK_OUTLINE_MODULE_FLAG: True,
        })
    return projected


def compact_module_rows(modules, *, COMPACT_MODULE_OMITTED_KEYS):
    """The compact projection of a list of module dicts.

    `weekStructure` is ~94% of an enriched module, and `sessionNames` -- the
    title of every authored week and live session on it, ~60 strings for a
    34-week module -- is most of what is left. No caller of a compact response
    renders either: the four that touch `sessionNames` read `.length` off it as a
    fallback for a week or lesson count, which `sessionNamesCount` answers.

    Copies rather than edits. The payload this projects is the *cached* one, held
    under `overview:<visibility>:compact` and handed unchanged to
    curriculum_programmes(), curriculum_modules(), the KSB endpoints and the cache
    warmer -- and enrich_modules_with_authoring() reads `sessionNames` off those
    same dicts. Stripping the key in place, or inside build_curriculum_payload(),
    would take it away from them too.
    """
    return [
        {
            **{
                key: value for key, value in module.items()
                if key not in COMPACT_MODULE_OMITTED_KEYS
            },
            'sessionNamesCount': len(module.get('sessionNames') or []),
        }
        for module in modules
    ]
