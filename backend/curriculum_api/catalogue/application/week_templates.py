"""Week-template payloads, list selection and revision/read sequencing.

No HTTP handling, persistence, provisioning or provider imports.
"""

from curriculum_api.catalogue.domain.content_values import component_coach_validation as _default_component_coach_validation
from curriculum_api.catalogue.domain.read_contracts import LEGACY_REFLECTION_QUESTION_SETTING as _default_LEGACY_REFLECTION_QUESTION_SETTING
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN as _default_WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def list_week_template_payloads(get_filter, *, clean_str, WEEK_TEMPLATE_COURSE_TYPES, get_week_template_rows, week_template_payload):
    conditions = []
    params = []
    course_type = clean_str(get_filter('courseType')).lower()
    if course_type in WEEK_TEMPLATE_COURSE_TYPES:
        conditions.append('course_type = %s')
        params.append(course_type)
    for column, param in (
        ('programme_id', 'programmeId'),
        ('module_catalogue_id', 'moduleCatalogueId'),
        ('group_id', 'groupId'),
        ('status', 'status'),
    ):
        value = clean_str(get_filter(param))
        if value:
            conditions.append(f'{column} = %s')
            params.append(value)
    rows = get_week_template_rows(' and '.join(conditions), params)
    search = clean_str(get_filter('search')).lower()
    if search:
        rows = [row for row in rows if search in clean_str(row.get('title')).lower()]
    results = [week_template_payload(row) for row in rows]
    return results


def save_week_template_components(
    template_id,
    components,
    *,
    LEGACY_REFLECTION_QUESTION_SETTING,
    WEEK_TEMPLATE_COMPONENTS_TABLE,
    WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
    clean_str,
    datetime,
    delete_rows,
    ensure_week_template_tables,
    insert_row,
    json_db_value,
    parse_int,
    payload_coach_validation,
    payload_reflection_question,
    unique_prefixed_id,
    week_template_number,
    lock_record_row,
    WEEK_TEMPLATES_TABLE,
    get_week_template_component_rows,
    occupied_template_component_ids,
    update_rows,
    replace_template_mappings,
    delete_template_components,
):
    # Preserve existing child identities; release mappings before removed children.
    ensure_week_template_tables()
    lock_record_row(WEEK_TEMPLATES_TABLE, 'id = %s', [template_id])
    existing = {row['id']: row for row in get_week_template_component_rows(template_id)}
    incoming_ids = [clean_str(component.get('id')) for component in components or [] if component.get('id')]
    occupied = occupied_template_component_ids(incoming_ids)
    kept = set()
    saved = []
    for index, component in enumerate(components or []):
        component_id = clean_str(component.get('id')) or unique_prefixed_id('WTC')
        component_settings = component.get('settings') if isinstance(component.get('settings'), dict) else {}
        reflection_question = payload_reflection_question(component, component_settings)
        component_settings = {**component_settings, LEGACY_REFLECTION_QUESTION_SETTING: reflection_question}
        if component_id in kept:
            raise ValueError('Duplicate template component identity.')
        kept.add(component_id)
        values = {
            'id': component_id,
            'week_template_id': template_id,
            'type': clean_str(component.get('type')) or 'reading',
            'title': clean_str(component.get('title')),
            'description': clean_str(component.get('description')),
            'expected_otjh': week_template_number(component.get('expectedOtjh')),
            'points': parse_int(component.get('points'), 0),
            'reflection_required': bool(component.get('reflectionRequired')),
            WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN: reflection_question,
            'workplace_evidence_required': bool(component.get('workplaceEvidenceRequired')),
            'tutor_validation_required': bool(component.get('tutorValidationRequired')),
            'coach_validation_required': payload_coach_validation(component),
            'settings_json': json_db_value(component_settings),
            'display_order': index,
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        }
        if component_id in existing:
            values.pop('created_at')
            update_rows(WEEK_TEMPLATE_COMPONENTS_TABLE, 'id = %s and week_template_id = %s',
                        [component_id, template_id], values)
        else:
            # A copied template gets independent component and mapping identities.
            if component_id in occupied:
                component_id = unique_prefixed_id('WTC')
                values['id'] = component_id
            insert_row(WEEK_TEMPLATE_COMPONENTS_TABLE, values)
        if 'ksbMappings' in component:
            replace_template_mappings(component_id, component.get('ksbMappings') or [])
        saved.append(values)
    removed = sorted(set(existing) - kept)
    delete_template_components(template_id, removed)
    return saved


def week_template_number(value, default=0):
    try:
        if value in (None, ''):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def week_template_component_payload(
    row,
    *,
    as_json_value=_default_as_json_value,
    week_template_number=week_template_number,
    parse_int=_default_parse_int,
    clean_str=_default_clean_str,
    WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN=_default_WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
    LEGACY_REFLECTION_QUESTION_SETTING=_default_LEGACY_REFLECTION_QUESTION_SETTING,
    component_coach_validation=_default_component_coach_validation,
):
    settings = as_json_value(row.get('settings_json'), {})
    settings = settings if isinstance(settings, dict) else {}
    return {
        'id': row.get('id'),
        'weekTemplateId': row.get('week_template_id'),
        'type': row.get('type'),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'expectedOtjh': week_template_number(row.get('expected_otjh')),
        'points': parse_int(row.get('points'), 0),
        'reflectionRequired': bool(row.get('reflection_required')),
        'reflectionQuestion': (
            clean_str(row.get(WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN))
            or clean_str(settings.get(LEGACY_REFLECTION_QUESTION_SETTING))
        ),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'coachValidationRequired': component_coach_validation(row),
        'ksbMappings': as_json_value(row.get('ksb_mappings'), []),
        'settings': settings,
        'displayOrder': parse_int(row.get('display_order'), 0),
    }


def week_template_payload(
    row,
    components=None,
    *,
    as_json_value=_default_as_json_value,
    week_template_number=week_template_number,
    parse_int=_default_parse_int,
    week_template_component_payload=week_template_component_payload,
):
    return {
        'id': row.get('id'),
        'title': row.get('title') or '',
        'summary': row.get('summary') or '',
        'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
        'courseType': row.get('course_type') or 'paid',
        'programmeId': row.get('programme_id') or '',
        'programmeName': row.get('programme_name') or '',
        'moduleCatalogueId': row.get('module_catalogue_id') or '',
        'groupId': row.get('group_id') or '',
        'groupName': row.get('group_name') or '',
        'status': row.get('status') or 'draft',
        'ksbMappings': ([mapping for component in components
                        for mapping in as_json_value(component.get('ksb_mappings'), [])]
                        if components is not None else row.get('ksb_mappings', [])),
        'totalOtjh': week_template_number(row.get('total_otjh')),
        'points': parse_int(row.get('points'), 0),
        'componentCount': parse_int(row.get('component_count'), 0),
        'author': row.get('author') or '',
        'createdAt': row.get('created_at'),
        'updatedAt': row.get('updated_at'),
        'components': [week_template_component_payload(component) for component in (components or [])],
    }


def week_template_record(
    template_id,
    *,
    after_write=False,
    get_week_template_row,
    get_week_template_component_rows,
    week_template_revision,
    STRUCTURE_REVISION_UNAVAILABLE,
    week_template_payload=week_template_payload,
):
    """A week template with the revision the editor sends back on save.

    The order of the two reads is the whole point, and it differs by caller --
    the reasoning is spelled out in ``structure_payload_with_revision`` and
    ``stamp_revision_after_write``, which this mirrors.

    Reading: revision first. These reads run in autocommit, so whichever is read
    second describes the later state, and a payload carrying a revision it
    predates would certify a stale save as current. Revision first means the
    pair is either exactly consistent or provably stale, and a stale one is
    refused rather than performed.

    ``after_write``: revision last, for a caller that has just written this
    template itself and needs the revision of its own write.
    """
    if after_write:
        row = get_week_template_row(template_id)
        if not row:
            return None
        components = get_week_template_component_rows(template_id)
        revision = week_template_revision(template_id) or STRUCTURE_REVISION_UNAVAILABLE
        return {**week_template_payload(row, components), 'revision': revision}
    revision = week_template_revision(template_id) or STRUCTURE_REVISION_UNAVAILABLE
    row = get_week_template_row(template_id)
    if not row:
        return None
    return {
        **week_template_payload(row, get_week_template_component_rows(template_id)),
        'revision': revision,
    }


def week_template_component_metrics(components):
    total_otjh = sum(week_template_number(component.get('expectedOtjh')) for component in (components or []))
    points = sum(parse_int(component.get('points'), 0) for component in (components or []))
    return round(total_otjh, 2), points, len(components or [])
