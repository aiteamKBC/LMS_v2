"""Assemble single and batched module structures through explicit legacy read contracts.

Storage scope, schema guards and delivery projections remain owned by their
existing adapters; this module does not import views, Django or providers.
"""
from collections import defaultdict

from curriculum_api.catalogue.application.authoring_metadata import advanced_response as _default_advanced_response
from curriculum_api.catalogue.application.authoring_metadata import completion_response as _default_completion_response
from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.content_values import component_coach_validation as _default_component_coach_validation
from curriculum_api.catalogue.domain.content_values import otjh_hours_from_minutes as _default_otjh_hours_from_minutes
from curriculum_api.catalogue.domain.content_values import otjh_rounded_minutes as _default_otjh_rounded_minutes
from curriculum_api.catalogue.domain.hierarchy_values import module_archive_parent_markers as _default_module_archive_parent_markers
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import unique as _default_unique
from curriculum_api.weekly_schedule import module_week_boundary_mode


def load_stored_module_structure(
    stored_catalogue_id, resolved_catalogue_id, *, force=False,
    curriculum_read_scope, cached_curriculum_value,
    read_module_structure_with_revision, structure_payload_with_revision,
    get_authoring_structure_payload,
):
    """Read an ordinary module structure and the revision of that same payload.

    Only resolved stored targets use the existing write-invalidated cache.
    Missing targets are rechecked; explicit cache bypass keeps conflict recovery
    current. Training alias provisioning remains in the legacy outer handler.
    """
    with curriculum_read_scope(targeted_child_reads=True):
        if stored_catalogue_id:
            # Stamp inside the factory: a cached payload must retain its own
            # revision, never acquire the current revision of a newer structure.
            return cached_curriculum_value(
                f'module-structure:{resolved_catalogue_id}',
                lambda: read_module_structure_with_revision(resolved_catalogue_id),
                force=force,
            )
        return structure_payload_with_revision(
            lambda: get_authoring_structure_payload(resolved_catalogue_id),
            resolved_catalogue_id,
        )


def get_authoring_structure_payload(
    module_catalogue_id,
    include_archived=False,
    *,
    source_rows=None,
    AUTHORING_ADVANCED_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    GROUPS_TABLE,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
    advanced_response=_default_advanced_response,
    annotate_archive_state,
    apply_module_session_plan_to_weeks,
    apply_shared_teams_settings_to_weeks,
    as_json_value=_default_as_json_value,
    attach_curriculum_names,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    completion_response=_default_completion_response,
    component_builder_settings,
    component_coach_validation=_default_component_coach_validation,
    component_ksb_mapping_api_item,
    component_ksb_mappings_from_row,
    component_reflection_question,
    delivery_status_for_training_row,
    format_date=_default_format_date,
    free_course_price_payload,
    frontend_component_type=_default_frontend_component_type,
    is_retired_component_type=_default_is_retired_component_type,
    lookup_free_course_prices,
    mapping_response,
    mappings_with_inferred_sources,
    module_archive_event_bounds,
    module_archive_parent_markers=_default_module_archive_parent_markers,
    module_authoring_quality_check,
    module_delivery_row,
    module_delivery_week_count,
    module_stored_week_count,
    module_week_starts_on,
    module_weekly_schedule,
    normalise_component_type=_default_normalise_component_type,
    normalise_ksb_profile_source_value,
    otjh_hours_from_minutes=_default_otjh_hours_from_minutes,
    otjh_rounded_minutes=_default_otjh_rounded_minutes,
    parse_int=_default_parse_int,
    parse_json_value=_default_parse_json_value,
    programme_deleted_row,
    row_in_module_archive,
    teams_delivery_metadata_from_live_session,
    teams_delivery_metadata_from_weeks,
    training_row_by_id,
):
    """The module's authored structure.

    ``include_archived`` is for reading a module that is *in* the archive. The
    archive cascade soft-deletes every week, component and mapping under the
    module, so the ``active_*`` filters below -- correct for every live read --
    return the module with an empty week list. The archive view has to show what
    is actually sitting inside it, which is the set a restore would bring back;
    see ``row_in_module_archive``. Nothing else about the payload changes, so the
    archive renders the same shape the builder does.
    """
    def owned_rows(table, order=''):
        if source_rows is not None:
            return source_rows[table]
        return authoring_fetch_all(table, 'module_catalogue_id = %s', [module_catalogue_id], order)

    module_rows = owned_rows(AUTHORING_MODULES_TABLE)
    if not module_rows:
        return None
    # Source rows are the stored row only. On the normalised schema the
    # programme / cohort / group / tutor names are read by id, so put them on a
    # copy (the raw rows stay as read: the revision fingerprints them). Without
    # this the builder showed "Unassigned programme" and no tutor for every
    # module. A no-op where the row already carries the names.
    module = attach_curriculum_names(AUTHORING_MODULES_TABLE, [dict(module_rows[0])])[0]
    group_rows = authoring_fetch_all(GROUPS_TABLE, 'group_id = %s', [module.get('group_id')]) if module.get('group_id') else []
    group_row = group_rows[0] if group_rows else {}
    # Read through the group's pattern, so every screen shows the days and clock
    # this module is actually delivered on rather than a stale copy of them.
    delivery_module = module_delivery_row(module, group_row)
    group_coach_name = clean_str(group_row.get('coach_name'))
    is_programme_deleted = programme_deleted_row(module) or programme_deleted_row(group_row)
    stored_week_rows = owned_rows(AUTHORING_WEEKS_TABLE, 'display_order, week_number, id')
    stored_component_rows = owned_rows(AUTHORING_COMPONENTS_TABLE, 'display_order, id')
    stored_mapping_rows = owned_rows(AUTHORING_KSB_MAPPINGS_TABLE, 'created_at, id')
    if include_archived:
        # The type and library exclusions stay: a retired component type and a
        # detached library row are not this module's content either way, and a
        # restore does not make them so.
        # Provenance (archive time, reason, parent) comes from history on the
        # normalised schema; read on copies so cached rows stay as they were.
        module = annotate_archive_state(AUTHORING_MODULES_TABLE, [dict(module)], key_column='module_catalogue_id')[0]
        stored_week_rows = annotate_archive_state(AUTHORING_WEEKS_TABLE, [dict(row) for row in stored_week_rows])
        stored_component_rows = annotate_archive_state(AUTHORING_COMPONENTS_TABLE, [dict(row) for row in stored_component_rows])
        stored_mapping_rows = annotate_archive_state(AUTHORING_KSB_MAPPINGS_TABLE, [dict(row) for row in stored_mapping_rows])
        markers = module_archive_parent_markers(module, module_catalogue_id)
        bounds = module_archive_event_bounds(module)
        week_rows = [
            row for row in stored_week_rows
            if row_in_module_archive(row, markers, bounds)
        ]
        component_rows = [
            row for row in stored_component_rows
            if not is_retired_component_type(row.get('type'))
            and row_in_module_archive(row, markers, bounds)
        ]
        mapping_source_rows = [
            row for row in stored_mapping_rows if row_in_module_archive(row, markers, bounds)
        ]
    else:
        week_rows = active_week_rows(stored_week_rows)
        component_rows = active_component_rows(stored_component_rows)
        mapping_source_rows = active_mapping_rows(stored_mapping_rows)
    mapping_rows = mappings_with_inferred_sources(mapping_source_rows, module_rows)
    completion_rows = owned_rows(AUTHORING_COMPLETION_TABLE)
    advanced_rows = owned_rows(AUTHORING_ADVANCED_TABLE)

    mappings_by_week = defaultdict(list)
    mappings_by_component = defaultdict(list)
    module_mappings = []
    for row in mapping_rows:
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(mapping_response(row))
        elif row.get('week_id'):
            mappings_by_week[str(row.get('week_id'))].append(mapping_response(row))
        else:
            module_mappings.append(mapping_response(row))

    components_by_week = defaultdict(list)
    for row in component_rows:
        component_id = str(row.get('id'))
        week_id = str(row.get('week_id'))
        component_mappings = [
            component_ksb_mapping_api_item(mapping)
            for mapping in component_ksb_mappings_from_row(row, mappings_by_component.get(component_id, []))
        ]
        components_by_week[week_id].append({
            'id': component_id,
            'moduleId': module_catalogue_id,
            'weekId': week_id,
            'type': frontend_component_type(row.get('type')),
            'title': row.get('title') or '',
            'description': row.get('description') or '',
            'expectedOtjh': float(row.get('expected_otjh') or 0),
            'points': parse_int(row.get('points'), 0),
            'reflectionRequired': bool(row.get('reflection_required')),
            'reflectionQuestion': component_reflection_question(row),
            'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
            'tutorValidationRequired': bool(row.get('tutor_validation_required')),
            'coachValidationRequired': component_coach_validation(row),
            'ksbMappings': component_mappings,
            'settings': component_builder_settings(row),
        })

    weeks = []
    for row in week_rows:
        week_id = str(row.get('id'))
        weeks.append({
            'id': week_id,
            'moduleId': module_catalogue_id,
            'weekNumber': parse_int(row.get('week_number'), len(weeks) + 1),
            'title': row.get('title') or '',
            'summary': row.get('summary') or '',
            'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
            'copiedFromId': clean_str(row.get('copied_from_id')),
            'holidayNoteEnabled': bool(row.get('holiday_note_enabled')),
            'holidayNote': clean_str(row.get('holiday_note')),
            'components': components_by_week.get(week_id, []),
            'ksbMappings': mappings_by_week.get(week_id, []),
        })

    # Live components consume the module's flat plan in display order. A week may
    # therefore consume several dates; its header uses the first one. Content-only
    # weeks retain the legacy one-week/one-session behavior.
    apply_module_session_plan_to_weeks(module, group_row, weeks)
    apply_shared_teams_settings_to_weeks(module, weeks)

    advanced = advanced_response(advanced_rows[0] if advanced_rows else None)
    payload = {
        'id': f'module-{module_catalogue_id}',
        'moduleId': module_catalogue_id,
        'moduleCatalogueId': module_catalogue_id,
        'structureId': module_catalogue_id,
        'catalogueId': module_catalogue_id,
        'programmeId': module.get('programme_id') or module.get('programme_name') or '',
        'programmeName': module.get('programme_name') or 'Unassigned programme',
        'cohortId': module.get('cohort_id') or '',
        'cohort': module.get('cohort_name') or '',
        'groupId': module.get('group_id') or '',
        'group': module.get('group_name') or '',
        'learnerRosterMode': clean_str(module.get('learner_roster_mode') or 'inherited').lower() or 'inherited',
        'teamsSharedSourceModuleId': clean_str(module.get('teams_shared_source_module_id')),
        'ksbRemapReport': parse_json_value(module.get('ksb_remap_report'), {}) or None,
        'title': module.get('title') or '',
        'description': module.get('description') or '',
        'color': module.get('color') or '#6941c6',
        'coverImage': module.get('cover_image_url') or '',
        'status': module.get('status') or 'draft',
        'sourceType': module.get('source_type') or '',
        'isFreeCourse': module.get('source_type') == 'free_course',
        **free_course_price_payload(module, lookup_free_course_prices([module])),
        'sourceId': module.get('source_id') or '',
        'isProgrammeDeleted': is_programme_deleted,
        'ksbProfileSourceId': normalise_ksb_profile_source_value(module.get('ksb_profile_source_id') or ''),
        'tutor': module.get('tutor_name') or '',
        'coach': group_coach_name,
        'sessionsNumber': parse_int(module.get('sessions_number'), len(weeks)),
        'startDate': format_date(module.get('start_date')),
        'endDate': format_date(module.get('end_date')),
        'weeklySchedule': module_weekly_schedule(delivery_module),
        'scheduleMode': module.get('schedule_mode') or 'group',
        'weekStartsOn': module_week_starts_on(module),
        'weekBoundaryMode': module_week_boundary_mode(module),
        'sessionHolidays': parse_json_value(module.get('session_holidays'), []),
        'calendarPolicy': parse_json_value(module.get('calendar_policy'), None),
        'calendarError': module.get('_calendar_error') or '',
        'deliveryWeeks': module_delivery_week_count(module, weeks),
        # The pattern this module actually runs to: its group's, and its own
        # only where the group states none.
        'weekDays': delivery_module.get('session_week_day') or '',
        'startTime': delivery_module.get('session_start_time') or '',
        'endTime': delivery_module.get('session_end_time') or '',
        'weeks': module_stored_week_count(module, len(weeks)),
        'weeksNumber': module_stored_week_count(module, len(weeks)),
        'totalOtjh': otjh_hours_from_minutes(sum(
            otjh_rounded_minutes(row.get('expected_otjh')) for row in component_rows
        )),
        'declaredTotalOtjh': otjh_hours_from_minutes(sum(
            otjh_rounded_minutes(row.get('expected_otjh')) for row in component_rows
        )),
        'ksbCount': len({mapping['code'] for mapping in module_mappings + [m for week in weeks for m in week['ksbMappings']] + [m for week in weeks for component in week['components'] for m in component['ksbMappings']]}),
        'lessonCount': len(component_rows),
        'quizCount': len([row for row in component_rows if normalise_component_type(row.get('type')) == 'quiz']),
        'qualityScore': parse_int(module.get('quality_score'), 0),
        'moduleKsbMappings': module_mappings,
        'completionCriteria': completion_response(completion_rows[0] if completion_rows else None),
        'weekStructure': weeks,
        **advanced,
    }
    if payload.get('cohort') or payload.get('group') or payload.get('cohortId') or payload.get('groupId'):
        payload['deliveryMetadata'] = {
            'cohortId': payload.get('cohortId') or '',
            'cohort': payload.get('cohort') or '',
            'groupId': payload.get('groupId') or '',
            'group': payload.get('group') or '',
            'coach': payload.get('coach') or '',
            'tutor': payload.get('tutor') or '',
            'color': payload.get('color') or '',
            'weeklySchedule': payload.get('weeklySchedule') or [],
            'weekDays': payload.get('weekDays') or '',
            'startTime': payload.get('startTime') or '',
            'endTime': payload.get('endTime') or '',
        }
    teams_metadata = teams_delivery_metadata_from_weeks(weeks) or teams_delivery_metadata_from_live_session(module_catalogue_id)
    if teams_metadata:
        payload['deliveryMetadata'] = {**(payload.get('deliveryMetadata') or {}), **teams_metadata}
    if module.get('source_type') == 'training_plan' and module.get('source_id'):
        training_row = training_row_by_id(module.get('source_id'))
        if training_row:
            payload['deliveryStatus'] = delivery_status_for_training_row(training_row)
            payload['deliveryMetadata'] = {
                **(payload.get('deliveryMetadata') or {}),
                'cohort': training_row.get('Cohort_name') or '',
                'group': training_row.get('group_name') or training_row.get('_meta', {}).get('group_name') or '',
                'tutor': training_row.get('Tutor_name') or '',
                'coach': training_row.get('coach_name') or '',
            }
    checklist, score = module_authoring_quality_check(payload)
    payload['qualityChecklist'] = checklist
    payload['qualityScore'] = score
    return payload


def get_authoring_structure_payloads(
    module_catalogue_ids,
    include_staff=True,
    include_quality=True,
    include_extra=True,
    component_columns=None,
    child_rows=None,
    *,
    AUTHORING_ADVANCED_TABLE,
    AUTHORING_COMPLETION_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    LIVE_SESSIONS_TABLE,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
    advanced_response=_default_advanced_response,
    apply_module_session_plan_to_weeks,
    apply_shared_teams_settings_to_weeks,
    as_json_value=_default_as_json_value,
    authoring_fetch_all,
    authoring_rows_by_id,
    calendar_unavailable_type,
    clean_str=_default_clean_str,
    cohort_selected_holidays_by_cohort,
    completion_response=_default_completion_response,
    component_coach_validation=_default_component_coach_validation,
    component_ksb_mapping_api_item,
    component_ksb_mappings_from_row,
    component_reflection_question,
    delivery_status_for_training_row,
    display_cohort_holidays,
    ensure_live_session_tracking_tables,
    format_date=_default_format_date,
    free_course_price_payload,
    frontend_component_type=_default_frontend_component_type,
    live_component_rows_paged,
    lookup_free_course_prices,
    mapping_response,
    mappings_with_inferred_sources,
    module_authoring_quality_check,
    module_delivery_row,
    module_delivery_week_count,
    module_stored_week_count,
    module_week_starts_on,
    module_weekly_schedule,
    normalise_component_type=_default_normalise_component_type,
    normalise_ksb_profile_source_value,
    otjh_hours_from_minutes=_default_otjh_hours_from_minutes,
    otjh_rounded_minutes=_default_otjh_rounded_minutes,
    parse_int=_default_parse_int,
    parse_json_value=_default_parse_json_value,
    prefetch_authoring_reads,
    programme_deleted_row,
    teams_delivery_metadata_from_live_session_row,
    teams_delivery_metadata_from_weeks,
    training_row_by_id,
    unique=_default_unique,
):
    catalogue_ids = unique([clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)])
    if not catalogue_ids:
        return {}
    placeholders = ', '.join(['%s'] * len(catalogue_ids))
    # A caller that already read a superset of these modules and their weeks
    # (programme_structure_child_rows) hands them in rather than paying for
    # the same two reads again. Neither read's order reaches the payload except
    # the weeks', which is total, so a filtered slice is the same rows in the
    # same order.
    shared_parents = child_rows is not None and 'modules' in child_rows and 'weeks' in child_rows
    if shared_parents:
        requested_ids = set(catalogue_ids)
        module_rows = [row for row in child_rows['modules'] if clean_str(row.get('module_catalogue_id')) in requested_ids]
    else:
        module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, f'module_catalogue_id in ({placeholders})', catalogue_ids)
    if not module_rows:
        return {}

    found_ids = [clean_str(row.get('module_catalogue_id')) for row in module_rows if clean_str(row.get('module_catalogue_id'))]
    wanted_ids = set(found_ids)
    placeholders = ', '.join(['%s'] * len(found_ids))
    if shared_parents:
        week_rows = active_week_rows([row for row in child_rows['weeks'] if clean_str(row.get('module_catalogue_id')) in wanted_ids])
    else:
        week_rows = active_week_rows(authoring_fetch_all(AUTHORING_WEEKS_TABLE, f'module_catalogue_id in ({placeholders})', found_ids, 'display_order, week_number, id'))
    if child_rows is not None:
        component_rows = active_component_rows([
            row for row in child_rows['components'] if clean_str(row.get('module_catalogue_id')) in wanted_ids
        ])
    elif component_columns is None:
        component_rows = active_component_rows(live_component_rows_paged(found_ids, 'display_order, id'))
    else:
        component_rows = active_component_rows(authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            f'module_catalogue_id in ({placeholders})',
            found_ids,
            'display_order, id',
            columns=component_columns,
        ))
    mapping_rows = mappings_with_inferred_sources(
        active_mapping_rows([
            row for row in child_rows['mappings'] if clean_str(row.get('module_catalogue_id')) in wanted_ids
        ] if child_rows is not None else authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, f'module_catalogue_id in ({placeholders})', found_ids, 'created_at, id')),
        module_rows,
    )
    if include_extra:
        ensure_live_session_tracking_tables()
        shared_source_by_module = {
            clean_str(row.get('module_catalogue_id')): clean_str(row.get('teams_shared_source_module_id'))
            for row in module_rows
            if clean_str(row.get('module_catalogue_id')) and clean_str(row.get('teams_shared_source_module_id'))
        }
        session_lookup_ids = unique([*found_ids, *shared_source_by_module.values()])
        session_placeholders = ', '.join(['%s'] * len(session_lookup_ids))
        # The three reads below in one round trip; each still runs as written.
        prefetch_authoring_reads([
            ((AUTHORING_COMPLETION_TABLE, f'module_catalogue_id in ({placeholders})', found_ids), {}),
            ((AUTHORING_ADVANCED_TABLE, f'module_catalogue_id in ({placeholders})', found_ids), {}),
            ((LIVE_SESSIONS_TABLE, f"module_catalogue_id in ({session_placeholders}) and status = 'active'", session_lookup_ids, 'updated_at desc, created_at desc'), {}),
        ])
    completion_rows = authoring_fetch_all(AUTHORING_COMPLETION_TABLE, f'module_catalogue_id in ({placeholders})', found_ids) if include_extra else []
    advanced_rows = authoring_fetch_all(AUTHORING_ADVANCED_TABLE, f'module_catalogue_id in ({placeholders})', found_ids) if include_extra else []
    # Newest active live session per module, read once for the whole set. The
    # single-module reader falls back to this when a module's weeks carry no
    # Teams metadata, so a batched caller that skipped it would silently lose
    # the meeting details for exactly those modules.
    live_session_by_module = {}
    if include_extra:
        for row in authoring_fetch_all(
            LIVE_SESSIONS_TABLE,
            f"module_catalogue_id in ({session_placeholders}) and status = 'active'",
            session_lookup_ids,
            'updated_at desc, created_at desc',
        ):
            key = clean_str(row.get('module_catalogue_id'))
            # Ordered newest first, so the first row seen for a module is the one
            # the single-module reader would have taken as sessions[0].
            if key and key not in live_session_by_module:
                live_session_by_module[key] = row
        for alias_id, source_id in shared_source_by_module.items():
            if alias_id not in live_session_by_module and source_id in live_session_by_module:
                live_session_by_module[alias_id] = live_session_by_module[source_id]
    group_ids = unique([clean_str(row.get('group_id')) for row in module_rows])
    group_rows_by_id = {}
    if group_ids:
        # Keyed by the primary key, so where the rows come from cannot change
        # what this holds; inside a programme build it is the groups read the
        # cohort/group lists already made.
        group_rows_by_id = {
            clean_str(row.get('group_id')): row
            for row in authoring_rows_by_id(GROUPS_TABLE, 'group_id', group_ids, GROUP_ROWS_ORDER)
        }

    # Every cohort's ticked holidays in one pair of reads, because the session
    # plan below runs per module. Left unsupplied, each module would read its own
    # cohort row and the whole holiday table again -- the per-module cost
    # cohort_selected_holidays_by_cohort() exists to spare a caller planning a
    # page of modules, and the last per-module read in this otherwise batched
    # reader. A 122-module programme paid ~250 round trips for it.
    try:
        holidays_by_cohort = cohort_selected_holidays_by_cohort(
            [clean_str(row.get('cohort_id')) for row in module_rows]
        ) if include_extra else {}
    except ValueError as exc:
        if not isinstance(exc, calendar_unavailable_type()):
            raise
        holidays_by_cohort = display_cohort_holidays([clean_str(row.get('cohort_id')) for row in module_rows])

    week_rows_by_module = defaultdict(list)
    for row in week_rows:
        week_rows_by_module[clean_str(row.get('module_catalogue_id'))].append(row)

    components_by_week = defaultdict(list)
    component_rows_by_module = defaultdict(list)
    mappings_by_week = defaultdict(list)
    mappings_by_component = defaultdict(list)
    module_mappings_by_module = defaultdict(list)
    completion_by_module = {clean_str(row.get('module_catalogue_id')): row for row in completion_rows}
    advanced_by_module = {clean_str(row.get('module_catalogue_id')): row for row in advanced_rows}

    for row in mapping_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        if row.get('component_id'):
            mappings_by_component[str(row.get('component_id'))].append(mapping_response(row))
        elif row.get('week_id'):
            mappings_by_week[str(row.get('week_id'))].append(mapping_response(row))
        else:
            module_mappings_by_module[catalogue_id].append(mapping_response(row))

    for row in component_rows:
        catalogue_id = clean_str(row.get('module_catalogue_id'))
        component_id = str(row.get('id'))
        week_id = str(row.get('week_id'))
        component_mappings = [
            component_ksb_mapping_api_item(mapping)
            for mapping in component_ksb_mappings_from_row(row, mappings_by_component.get(component_id, []))
        ]
        component = {
            'id': component_id,
            'moduleId': catalogue_id,
            'weekId': week_id,
            'type': frontend_component_type(row.get('type')),
            'title': row.get('title') or '',
            'description': row.get('description') or '',
            'expectedOtjh': float(row.get('expected_otjh') or 0),
            'points': parse_int(row.get('points'), 0),
            'reflectionRequired': bool(row.get('reflection_required')),
            'reflectionQuestion': component_reflection_question(row),
            'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
            'tutorValidationRequired': bool(row.get('tutor_validation_required')),
            'coachValidationRequired': component_coach_validation(row),
            'ksbMappings': component_mappings,
            'settings': as_json_value(row.get('settings_json'), {}),
        }
        components_by_week[week_id].append(component)
        component_rows_by_module[catalogue_id].append(row)

    payloads = {}
    free_course_prices = lookup_free_course_prices(module_rows)
    for module in module_rows:
        catalogue_id = clean_str(module.get('module_catalogue_id'))
        if not catalogue_id:
            continue
        weeks = []
        for row in week_rows_by_module.get(catalogue_id, []):
            week_id = str(row.get('id'))
            weeks.append({
                'id': week_id,
                'moduleId': catalogue_id,
                'weekNumber': parse_int(row.get('week_number'), len(weeks) + 1),
                'title': row.get('title') or '',
                'summary': row.get('summary') or '',
                'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
                'copiedFromId': clean_str(row.get('copied_from_id')),
                'holidayNoteEnabled': bool(row.get('holiday_note_enabled')),
                'holidayNote': clean_str(row.get('holiday_note')),
                'components': components_by_week.get(week_id, []),
                'ksbMappings': mappings_by_week.get(week_id, []),
            })
        module_mappings = module_mappings_by_module.get(catalogue_id, [])
        module_components = component_rows_by_module.get(catalogue_id, [])
        module_total_otjh = otjh_hours_from_minutes(sum(
            otjh_rounded_minutes(row.get('expected_otjh'))
            for row in module_components
        ))
        group_row = group_rows_by_id.get(clean_str(module.get('group_id')), {})
        # The days and clock this module is delivered on: its group's first.
        delivery_module = module_delivery_row(module, group_row)
        group_coach_name = clean_str(group_row.get('coach_name'))
        is_programme_deleted = programme_deleted_row(module) or programme_deleted_row(group_row)
        if include_extra:
            # Gated with the other full-detail extras: this rewrites live-session
            # component settings, and the lean caller (resolve) asked not to pay
            # for -- or be changed by -- that. The single-module reader always
            # applies it, so parity holds wherever include_extra is on.
            apply_module_session_plan_to_weeks(
                module,
                group_row,
                weeks,
                holidays=holidays_by_cohort.get(clean_str(module.get('cohort_id'))) or [],
            )
            # A shared duplicate has no live_sessions row of its own. Project
            # the canonical source's links into this response so every Live
            # Session still shows the shared meeting without copying ownership.
            apply_shared_teams_settings_to_weeks(module, weeks)
        payload = {
            'id': f'module-{catalogue_id}',
            'moduleId': catalogue_id,
            'moduleCatalogueId': catalogue_id,
            'structureId': catalogue_id,
            'catalogueId': catalogue_id,
            'programmeId': module.get('programme_id') or module.get('programme_name') or '',
            'programmeName': module.get('programme_name') or 'Unassigned programme',
            'cohortId': module.get('cohort_id') or '',
            'cohort': module.get('cohort_name') or '',
            'groupId': module.get('group_id') or '',
            'group': module.get('group_name') or '',
            'learnerRosterMode': clean_str(module.get('learner_roster_mode') or 'inherited').lower() or 'inherited',
            'teamsSharedSourceModuleId': clean_str(module.get('teams_shared_source_module_id')),
            'ksbRemapReport': parse_json_value(module.get('ksb_remap_report'), {}) or None,
            'title': module.get('title') or '',
            'description': module.get('description') or '',
            'color': module.get('color') or '#6941c6',
            'coverImage': module.get('cover_image_url') or '',
            'status': module.get('status') or 'draft',
            'sourceType': module.get('source_type') or '',
            'isFreeCourse': module.get('source_type') == 'free_course',
            **free_course_price_payload(module, free_course_prices),
            'sourceId': module.get('source_id') or '',
            'isProgrammeDeleted': is_programme_deleted,
            'ksbProfileSourceId': normalise_ksb_profile_source_value(module.get('ksb_profile_source_id') or ''),
            'tutor': module.get('tutor_name') or '',
            'coach': group_coach_name,
            'sessionsNumber': parse_int(module.get('sessions_number'), len(weeks)),
            'startDate': format_date(module.get('start_date')),
            'endDate': format_date(module.get('end_date')),
            'weeklySchedule': module_weekly_schedule(delivery_module),
            'scheduleMode': module.get('schedule_mode') or 'group',
            'weekStartsOn': module_week_starts_on(module),
            'weekBoundaryMode': module_week_boundary_mode(module),
            'sessionHolidays': parse_json_value(module.get('session_holidays'), []),
        'calendarPolicy': parse_json_value(module.get('calendar_policy'), None),
        'calendarError': module.get('_calendar_error') or '',
            'deliveryWeeks': module_delivery_week_count(module, weeks),
            # The group's pattern first; the module's own only where it states none.
            'weekDays': delivery_module.get('session_week_day') or '',
            'startTime': delivery_module.get('session_start_time') or '',
            'endTime': delivery_module.get('session_end_time') or '',
            'weeks': module_stored_week_count(module, len(weeks)),
            'weeksNumber': module_stored_week_count(module, len(weeks)),
            'totalOtjh': module_total_otjh,
            'declaredTotalOtjh': module_total_otjh,
            'ksbCount': len({mapping['code'] for mapping in module_mappings + [m for week in weeks for m in week['ksbMappings']] + [m for week in weeks for component in week['components'] for m in component['ksbMappings']]}),
            'lessonCount': len(module_components),
            'quizCount': len([row for row in module_components if normalise_component_type(row.get('type')) == 'quiz']),
            'qualityScore': parse_int(module.get('quality_score'), 0),
            'moduleKsbMappings': module_mappings,
            'weekStructure': weeks,
        }
        if include_extra:
            payload['completionCriteria'] = completion_response(completion_by_module.get(catalogue_id))
            payload.update(advanced_response(advanced_by_module.get(catalogue_id)))
        if payload.get('cohort') or payload.get('group') or payload.get('cohortId') or payload.get('groupId'):
            payload['deliveryMetadata'] = {
                'cohortId': payload.get('cohortId') or '',
                'cohort': payload.get('cohort') or '',
                'groupId': payload.get('groupId') or '',
                'group': payload.get('group') or '',
                'coach': payload.get('coach') or '',
                'tutor': payload.get('tutor') or '',
                'color': payload.get('color') or '',
                'weeklySchedule': payload.get('weeklySchedule') or [],
            'weekDays': payload.get('weekDays') or '',
                'startTime': payload.get('startTime') or '',
                'endTime': payload.get('endTime') or '',
            }
        teams_metadata = teams_delivery_metadata_from_weeks(weeks) or teams_delivery_metadata_from_live_session_row(
            live_session_by_module.get(catalogue_id)
        )
        if teams_metadata:
            payload['deliveryMetadata'] = {**(payload.get('deliveryMetadata') or {}), **teams_metadata}
        if module.get('source_type') == 'training_plan' and module.get('source_id'):
            training_row = training_row_by_id(module.get('source_id'))
            if training_row:
                payload['deliveryStatus'] = delivery_status_for_training_row(training_row)
                payload['deliveryMetadata'] = {
                    **(payload.get('deliveryMetadata') or {}),
                    'cohort': training_row.get('Cohort_name') or '',
                    'group': training_row.get('group_name') or training_row.get('_meta', {}).get('group_name') or '',
                    'tutor': training_row.get('Tutor_name') or '',
                    'coach': training_row.get('coach_name') or '',
                }
        if include_quality:
            checklist, score = module_authoring_quality_check(payload)
            payload['qualityChecklist'] = checklist
            payload['qualityScore'] = score
        payloads[catalogue_id] = payload
    return payloads
