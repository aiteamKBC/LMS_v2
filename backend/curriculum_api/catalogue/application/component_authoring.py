"""Component authoring context and persistence orchestration; existing transaction boundaries are preserved.

Named capabilities are supplied by the existing composition seam during migration.
No application settings, legacy views or provider runtime is imported here.
"""

from curriculum_api.catalogue.domain.content_validation import stored_component_type as _default_stored_component_type
from curriculum_api.catalogue.domain.content_values import parse_week_number as _default_parse_week_number
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import normalise as _default_normalise


def component_context_for_payload(
    payload,
    *,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    ModuleAuthoringValidationError,
    archive_state,
    authoring_fetch_all,
    authoring_module_exists,
    authoring_upsert,
    canonical_authoring_id,
    clean_str=_default_clean_str,
    ensure_module_authoring_tables,
    json_db_value,
    normalise=_default_normalise,
    parse_week_number=_default_parse_week_number,
    retained_live_component_ids,
    stored_component_type=_default_stored_component_type,
    unique_module_catalogue_id,
):
    ensure_module_authoring_tables()
    module_catalogue_id = clean_str(payload.get('moduleCatalogueId') or payload.get('module_catalogue_id'))
    module_title = clean_str(payload.get('module') or payload.get('moduleTitle') or payload.get('title'))
    programme_name = clean_str(payload.get('programme') or payload.get('programmeName')) or 'Unassigned programme'
    if module_catalogue_id:
        module_row = authoring_module_exists(module_catalogue_id)
    else:
        candidates = authoring_fetch_all(AUTHORING_MODULES_TABLE)
        module_row = next(
            (
                row for row in candidates
                if normalise(row.get('title')) == normalise(module_title)
                and normalise(row.get('programme_name')) == normalise(programme_name)
            ),
            None,
        )
        module_catalogue_id = clean_str((module_row or {}).get('module_catalogue_id'))

    if (module_row or {}).get('source_type') == 'free_course' and stored_component_type(payload.get('type')) == 'live_session':
        if clean_str(payload.get('id')) not in retained_live_component_ids(module_row):
            raise ModuleAuthoringValidationError([{'path': 'type', 'message': 'Free courses contain self-study content only.'}])

    if not module_catalogue_id:
        module_catalogue_id = unique_module_catalogue_id()

    if not module_row:
        authoring_upsert(AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_catalogue_id,
            'programme_id': programme_name,
            'title': module_title or f'Module {module_catalogue_id}',
            'description': '',
            # modules.status is the lifecycle (active/inactive), not draft/published.
            'status': archive_state.ACTIVE,
            'sessions_number': 0,
            'quality_score': 0,
            'source_type': 'component_builder',
        })

    week_number = parse_week_number(payload.get('week') or payload.get('weekLabel') or payload.get('weekNumber'))
    week_rows = authoring_fetch_all(
        AUTHORING_WEEKS_TABLE,
        'module_catalogue_id = %s and week_number = %s',
        [module_catalogue_id, week_number],
    )
    week_id = clean_str(payload.get('weekId') or payload.get('week_id') or (week_rows[0].get('id') if week_rows else ''))
    if not week_id:
        week_id = canonical_authoring_id('WEEK')

    if not week_rows:
        authoring_upsert(AUTHORING_WEEKS_TABLE, ['id'], {
            'id': week_id,
            'module_catalogue_id': module_catalogue_id,
            'week_number': week_number,
            'title': f'Week {week_number}',
            'summary': '',
            'learning_outcomes': json_db_value([]),
            'display_order': week_number - 1,
        })

    return module_catalogue_id, week_id, week_number


def save_component_builder_payload(
    payload,
    component_id=None,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    LEGACY_REFLECTION_QUESTION_SETTING,
    ModuleAuthoringValidationError,
    REFLECTION_QUESTION_COLUMN,
    archive_state,
    authoring_bulk_upsert,
    authoring_fetch_all,
    authoring_soft_delete,
    authoring_upsert,
    bool_payload,
    canonical_authoring_id,
    clean_str,
    component_builder_response,
    component_builder_settings,
    component_coach_validation,
    component_context_for_payload,
    component_ksb_mappings_from_row,
    invalidate_curriculum_cache,
    is_retired_component_type,
    json_db_value,
    normalise_component_ksb_mappings,
    parse_float,
    parse_int,
    partial_read_errors,
    payload_coach_validation,
    payload_reflection_question,
    stored_component_type,
    transaction,
):
    if is_retired_component_type(payload.get('type')):
        raise ModuleAuthoringValidationError([{
            'path': 'type',
            'message': 'This component type has been removed from the module builder.',
        }])
    # Settings merge key by key below, so a missing key keeps the stored value;
    # refused anyway, so a partial read can never be the source of a save.
    partial_errors = partial_read_errors(payload)
    if partial_errors:
        raise ModuleAuthoringValidationError(partial_errors)
    component_id = canonical_authoring_id('COMP', component_id or payload.get('id'))
    module_catalogue_id, week_id, week_number = component_context_for_payload(payload)
    duration_minutes = max(0, parse_int(payload.get('duration'), 0))
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    existing_row = component_rows[0] if component_rows else {}
    existing_expected_otjh = parse_float(existing_row.get('expected_otjh'), 2)
    expected_otjh = (
        parse_float(payload.get('expectedOtjh') or payload.get('expected_otjh'), existing_expected_otjh)
        if payload.get('expectedOtjh') not in (None, '') or payload.get('expected_otjh') not in (None, '')
        else existing_expected_otjh
    )
    payload_settings = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
    existing_settings = {}
    component_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])
    if component_rows:
        existing_settings = component_builder_settings(component_rows[0])
    incoming_settings = payload.get('settings') if isinstance(payload.get('settings'), dict) else {}
    # The question has its own column now. The legacy settings key is kept in
    # step with it so the learner-side readers that still look there agree with
    # the column instead of serving whatever text they were last saved with.
    reflection_question = payload_reflection_question(
        payload,
        {**component_builder_settings(existing_row), **incoming_settings},
    )
    settings = {
        **component_builder_settings(existing_row),
        **payload_settings,
        **existing_settings,
        **incoming_settings,
        LEGACY_REFLECTION_QUESTION_SETTING: reflection_question,
        'displayType': payload.get('type') or 'Self-study',
        'componentBuilderStatus': clean_str(payload.get('status') or 'draft').lower(),
        'durationMinutes': duration_minutes,
        'contentSections': max(0, parse_int(payload.get('contentSections'), 0)),
        'quizQuestions': max(0, parse_int(payload.get('quizQuestions'), 0)) if payload.get('quizQuestions') not in (None, '') else 0,
        'hasResources': bool_payload(payload.get('hasResources')),
    }
    reflection_required = (
        bool_payload(payload.get('reflectionRequired')) if 'reflectionRequired' in payload
        else bool_payload(payload.get('reflection_required')) if 'reflection_required' in payload
        else bool_payload(existing_row.get('reflection_required'))
    )
    workplace_evidence_required = False
    tutor_validation_required = (
        bool_payload(payload.get('tutorValidationRequired')) if 'tutorValidationRequired' in payload
        else bool_payload(payload.get('tutor_validation_required')) if 'tutor_validation_required' in payload
        else bool_payload(existing_row.get('tutor_validation_required'))
    )
    # A payload that says nothing keeps what the row already had, and a row that
    # predates the column counts as on - see component_coach_validation().
    coach_validation_required = payload_coach_validation(payload, component_coach_validation(existing_row))
    display_order = parse_int(existing_row.get('display_order'), 0)
    display_order = parse_int((component_rows[0] if component_rows else {}).get('display_order'), 0)
    if not component_rows:
        sibling_rows = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s and week_id = %s', [module_catalogue_id, week_id])
        display_order = len(sibling_rows)
    module_row = (authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id]) or [{}])[0]
    incoming_mappings = payload.get('ksbMappings') if isinstance(payload.get('ksbMappings'), list) else None
    if incoming_mappings is None and 'ksbRefs' in payload:
        incoming_mappings = [
            {
                'ksbId': clean_str(code).upper(),
                'code': clean_str(code).upper(),
                'description': f'Mapped KSB {clean_str(code).upper()}',
                'type': 'secondary',
                'classification': 'secondary',
                'weight': 20,
                'weightClass': 'soft',
            }
            for code in (payload.get('ksbRefs') or [])
            if clean_str(code)
        ]
    if incoming_mappings is None:
        incoming_mappings = component_ksb_mappings_from_row(existing_row)
    component_ksb_items, mapping_payloads = normalise_component_ksb_mappings(
        module_catalogue_id,
        incoming_mappings,
        week_id=week_id,
        component_id=component_id,
        module_row=module_row,
        enforce_unique=False,
    )
    # ksb_mappings CHECKs weight > 0. The module save validates each mapping
    # before writing; this path did not, so a weightless mapping reached the
    # insert and failed there (500). Refuse it as the module save does.
    weightless = [
        {'path': f'ksbMappings.{index}.weight',
         'message': f"{mapping.get('ksb_code') or 'KSB'}: weight must be greater than zero."}
        for index, mapping in enumerate(mapping_payloads)
        if not (mapping.get('weight') or 0) > 0
    ]
    if weightless:
        raise ModuleAuthoringValidationError(weightless)

    with transaction.atomic():
        authoring_upsert(AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': component_id,
            'week_id': week_id,
            'module_catalogue_id': module_catalogue_id,
            'type': stored_component_type(payload.get('type')),
            'title': payload.get('title') or '',
            'description': payload.get('description') or '',
            'expected_otjh': expected_otjh,
            'points': parse_int(payload.get('points'), 0),
            'ksb_mappings': json_db_value(component_ksb_items),
            'reflection_required': reflection_required,
            REFLECTION_QUESTION_COLUMN: reflection_question,
            'workplace_evidence_required': workplace_evidence_required,
            'tutor_validation_required': tutor_validation_required,
            'coach_validation_required': coach_validation_required,
            'display_order': display_order,
            'settings_json': json_db_value(settings),
            'live_sessions_link': clean_str(settings.get('liveSessionUrl') or settings.get('teamsMeetingUrl')),
            'status': archive_state.ACTIVE,
        })
        authoring_soft_delete(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id], deleted_by='component-save')
        authoring_bulk_upsert(AUTHORING_KSB_MAPPINGS_TABLE, ['id'], mapping_payloads)

    invalidate_curriculum_cache()
    row = authoring_fetch_all(AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])[0]
    module = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    week = authoring_fetch_all(AUTHORING_WEEKS_TABLE, 'id = %s', [week_id])
    mappings = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'component_id = %s', [component_id])
    return component_builder_response(
        row,
        {module_catalogue_id: module[0] if module else {}},
        {week_id: week[0] if week else {'week_number': week_number}},
        {component_id: mappings},
    )
