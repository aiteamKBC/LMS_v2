"""Prepare KSB/free-course payloads, identities and shared-course ownership.

Existing source reads and ID generation are explicit; persistence stays with callers."""

from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.content_validation import component_expected_otjh as _default_component_expected_otjh
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight as _default_normalise_ksb_weight
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight_class as _default_normalise_ksb_weight_class
from curriculum_api.catalogue.domain.values import bool_payload as _default_bool_payload
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def authoring_mapping_payload(
    module_catalogue_id,
    mapping,
    week_id=None,
    component_id=None,
    module_row=None,
    source_cache=None,
    enforce_unique=True,
    *,
    archive_state,
    canonical_authoring_id,
    coverage_normalise_code,
    ensure_authoring_mapping_unique,
    infer_mapping_source_for_code,
    infer_mapping_source_from_module,
    legacy_weight_class_from_classification,
    normalise_ksb_classification,
    normalise_ksb_weight=_default_normalise_ksb_weight,
    normalise_ksb_weight_class=_default_normalise_ksb_weight_class,
    source_payload_from_mapping,
):
    mapping_id = canonical_authoring_id('KSBMAP', mapping.get('id'))
    source_type, source_id = source_payload_from_mapping(mapping)
    code = coverage_normalise_code(mapping.get('code') or mapping.get('ksbCode') or mapping.get('ksb_code') or '')
    if (not source_type or not source_id) and code:
        if module_row is not None:
            source_type, source_id = infer_mapping_source_from_module(module_row, code, source_cache)
        else:
            source_type, source_id = infer_mapping_source_for_code(module_catalogue_id, code)
    if component_id and enforce_unique:
        ensure_authoring_mapping_unique(component_id, {**mapping, 'sourceType': source_type, 'sourceId': source_id}, mapping_id=mapping_id)
    return {
        'id': mapping_id,
        'module_catalogue_id': module_catalogue_id,
        'week_id': week_id,
        'component_id': component_id,
        'standard_ksb_id': mapping.get('standard_ksb_id') or mapping.get('standardKsbId'),
        'ksb_id': mapping.get('ksbId') or mapping.get('ksb_id') or mapping.get('code') or mapping.get('ksb_code'),
        'ksb_code': code,
        'ksb_description': mapping.get('description') or mapping.get('ksbDescription') or '',
        'source_type': source_type,
        'source_id': source_id,
        'classification': normalise_ksb_classification(mapping.get('type') or mapping.get('classification')),
        'weight': normalise_ksb_weight(mapping.get('weight')),
        'weight_class': normalise_ksb_weight_class(
            mapping.get('weight_class') if 'weight_class' in mapping else mapping.get('weightClass'),
            legacy_weight_class_from_classification(mapping.get('type') or mapping.get('classification')),
        ),
        'status': archive_state.ACTIVE,
    }


def normalise_component_ksb_mappings(
    module_catalogue_id,
    mappings,
    week_id=None,
    component_id=None,
    module_row=None,
    source_cache=None,
    enforce_unique=False,
    *,
    authoring_mapping_payload,
    clean_str=_default_clean_str,
    component_ksb_mapping_json_item,
    coverage_normalise_code,
):
    json_items = []
    projection_payloads = []
    seen = set()
    source_cache = source_cache if source_cache is not None else {}
    for mapping in mappings or []:
        if not isinstance(mapping, dict):
            continue
        payload = authoring_mapping_payload(
            module_catalogue_id,
            mapping,
            week_id=week_id,
            component_id=component_id,
            module_row=module_row,
            source_cache=source_cache,
            enforce_unique=enforce_unique,
        )
        key = (
            clean_str(payload.get('component_id')),
            coverage_normalise_code(payload.get('ksb_code')),
            clean_str(payload.get('source_type')),
            clean_str(payload.get('source_id')),
        )
        if not key[1] or key in seen:
            continue
        seen.add(key)
        json_items.append(component_ksb_mapping_json_item(payload))
        projection_payloads.append(payload)
    return json_items, projection_payloads


def free_course_sale_values(
    payload, module_row, is_free_course, *, ModuleAuthoringValidationError, free_course_pricing,
    pricing_values,
):
    """The sale values a module save may store, or a validation error.

    A free course's omitted values keep its stored price (free_course_pricing);
    any other module is never for sale -- asking to sell one is refused rather
    than silently dropped.
    """
    if not is_free_course:
        if payload.get('isForSale') is True:
            raise ModuleAuthoringValidationError([{'path': 'isForSale', 'message': 'Only a free course can be for sale.'}])
        return {'is_for_sale': False, 'price': None, 'currency': 'GBP'}
    try:
        return pricing_values(payload, free_course_pricing.stored(module_row))
    except ValueError as error:
        raise ModuleAuthoringValidationError([{'path': error.args[0], 'message': error.args[1]}]) from error


def free_programme_module_id(
    programme_id,
    module,
    index,
    *,
    FREE_PROGRAMME_MODULES_TABLE,
    clean_str=_default_clean_str,
    free_programme_fetch_all,
    re,
    unique_timestamp_prefixed_id,
):
    requested = clean_str(module.get('id') or module.get('moduleId') or module.get('catalogueId'))
    if re.match(r'^(FREECOURSE|FREEWEEK)-[0-9]{20}$', requested):
        return requested
    existing = [
        row.get('id')
        for row in free_programme_fetch_all(FREE_PROGRAMME_MODULES_TABLE, columns=['id'])
    ]
    return unique_timestamp_prefixed_id('FREEWEEK', existing)


def free_programme_week_payload(
    course_id,
    module,
    index,
    *,
    clean_str=_default_clean_str,
    json_db_value,
    parse_int=_default_parse_int,
    unique_timestamp_prefixed_id,
):
    week = None
    week_structure = module.get('weekStructure') if isinstance(module.get('weekStructure'), list) else module.get('weeks')
    if isinstance(week_structure, list) and week_structure:
        week = next((item for item in week_structure if isinstance(item, dict)), None)
    week = week or {}
    week_number = parse_int(module.get('weekNumber') or module.get('week_number') or week.get('weekNumber') or week.get('week_number'), index + 1)
    course_name = clean_str(module.get('courseName') or module.get('course_name') or module.get('title') or module.get('name'))
    week_title = clean_str(module.get('weekTitle') or module.get('week_title') or week.get('title') or course_name or f'Week {week_number}')
    requested_week_id = clean_str(module.get('weekId') or module.get('week_id') or week.get('id'))
    week_id = requested_week_id or unique_timestamp_prefixed_id('WEEK')
    return {
        'id': week_id,
        'module_catalogue_id': course_id,
        'week_number': week_number,
        'title': week_title,
        'summary': clean_str(week.get('summary') or module.get('description') or ''),
        'learning_outcomes': json_db_value(week.get('learningOutcomes') or week.get('learning_outcomes') or []),
        'display_order': parse_int(module.get('displayOrder') or module.get('display_order'), index),
    }


def free_programme_component_payload(
    component,
    index,
    *,
    bool_payload=_default_bool_payload,
    canonical_authoring_id,
    component_expected_otjh=_default_component_expected_otjh,
    is_retired_component_type=_default_is_retired_component_type,
    json_db_value,
    normalise_component_type=_default_normalise_component_type,
    parse_int=_default_parse_int,
):
    if is_retired_component_type(component.get('type')):
        return None
    requested_display_order = component.get('displayOrder')
    if requested_display_order in (None, ''):
        requested_display_order = component.get('display_order')
    return {
        'id': canonical_authoring_id('FREECOMP', component.get('id')),
        'type': normalise_component_type(component.get('type')),
        'title': component.get('title') or '',
        'description': component.get('description') or '',
        'expected_otjh': component_expected_otjh(component),
        'points': parse_int(component.get('points'), 0),
        'reflection_required': bool_payload(component.get('reflectionRequired') or component.get('reflection_required')),
        'workplace_evidence_required': bool_payload(component.get('workplaceEvidenceRequired') or component.get('workplace_evidence_required')),
        'tutor_validation_required': bool_payload(component.get('tutorValidationRequired') or component.get('tutor_validation_required')),
        'display_order': parse_int(requested_display_order, index),
        'settings_json': json_db_value(component.get('settings') or {}),
    }


def get_free_programme_modules_payload(
    programme_id,
    *,
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    active_component_rows,
    adopted_courses,
    clean_str=_default_clean_str,
    free_course_catalogue,
    free_programme_module_response,
):
    programme_id = clean_str(programme_id)
    # One round trip for the three reads (free_course_catalogue.fetch_many).
    course_rows, week_rows, component_rows = free_course_catalogue.fetch_many([
        (FREE_COURSES_TABLE, '', [], 'display_order, course_name, id', None),
        (FREE_PROGRAMME_MODULES_TABLE, '', [], 'display_order, week_number, id', None),
        (FREE_PROGRAMME_COMPONENTS_TABLE, 'programme_id = %s', [programme_id], 'display_order, title, id', None),
    ])
    courses = {clean_str(course.get('id')): course for course in course_rows}
    # Staff consumers retain inactive weeks and their explicit status.
    # Learner reads apply visibility separately; never erase historical weeks.
    modules = week_rows
    components_by_week = {}
    for component in active_component_rows(component_rows):
        components_by_week.setdefault(clean_str(component.get('free_module_id')), []).append(component)
    adopted = adopted_courses()
    return [free_programme_module_response(module, components_by_week.get(clean_str(module.get('id')), []),
                                           courses.get(clean_str(module.get('course_id'))))
            for module in modules if clean_str(module.get('course_id')) not in adopted]


def free_programme_owned_ids(
    programme_id,
    *,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    clean_str=_default_clean_str,
    free_programme_fetch_all,
):
    """Free course + week ids that belong to `programme_id`.

    curriculum.free_courses and curriculum.free_course_weeks carry no
    programme_id column of their own — ownership is only expressed through
    curriculum.free_programme_components.programme_id, which points at both a
    free_module_id (a free_course_weeks row) and a week_id. Resolving through
    the components table is therefore the ONLY way to scope a delete to one
    programme. Deleting these tables unconditionally wipes every programme's
    free courses, which is what previously happened here.
    """
    programme_id = clean_str(programme_id)
    if not programme_id:
        return set(), set()
    components = free_programme_fetch_all(
        FREE_PROGRAMME_COMPONENTS_TABLE, 'programme_id = %s', [programme_id],
    )
    week_ids = {
        clean_str(row.get('free_module_id'))
        for row in components
        if clean_str(row.get('free_module_id'))
    }
    course_ids = set()
    if week_ids:
        placeholders = ', '.join(['%s'] * len(week_ids))
        for row in free_programme_fetch_all(
            FREE_PROGRAMME_MODULES_TABLE, f'id in ({placeholders})', list(week_ids),
            columns=['id', 'course_id'],
        ):
            course_id = clean_str(row.get('course_id'))
            if course_id:
                course_ids.add(course_id)
    # Only drop a course when this programme owns every one of its weeks;
    # a course shared with another programme must survive.
    owned_course_ids = set()
    for course_id in course_ids:
        siblings = free_programme_fetch_all(
            FREE_PROGRAMME_MODULES_TABLE, 'course_id = %s', [course_id], columns=['id'],
        )
        sibling_ids = {clean_str(row.get('id')) for row in siblings if clean_str(row.get('id'))}
        if sibling_ids and sibling_ids.issubset(week_ids):
            owned_course_ids.add(course_id)
    return week_ids, owned_course_ids
