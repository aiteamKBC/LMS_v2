"""Prepare verified delivery inputs for the existing overview projection."""


def _build_curriculum_payload_from_rows(
    rows,
    visibility='operational',
    compact=False,
    *,
    home_summary=False,
    module_list=False,
    delivery_source=None,
    programme_list=False,
    learner_profiles=False,
    CURRICULUM_SCHEMA,
    attach_module_assignment_counts,
    authoring_session_links_by_catalogue,
    build_cohorts_and_groups,
    build_ksb_data,
    build_modules,
    build_programmes,
    build_sessions_from_authoring_modules,
    build_staff_profiles,
    clean_str,
    cohort_authoring_detail_rows,
    cohort_selected_holidays_by_id,
    curriculum_sessions_from_rows,
    enrich_modules_with_authoring,
    format_date,
    get_holiday_rows,
    group_authoring_detail_rows,
    group_tutor_from_module_names,
    is_archived_module_summary,
    is_operational_training_row,
    module_authoring_row_is_archived,
    parse_date,
    programme_deleted_row,
    serialize_cohort_authoring_detail,
    serialize_group_authoring_detail,
    staff_assignment_key
):
    from curriculum_api.catalogue.application.overview import build_curriculum_payload_from_rows as query
    session_builder = curriculum_sessions_from_rows
    cohort_details = cohort_authoring_detail_rows
    group_details = group_authoring_detail_rows
    if '_delivery_rows' in rows and (not (module_list or programme_list)):
        from functools import partial
        from curriculum_api.catalogue.application.delivery_reads import group_details_from_rows
        from curriculum_api.catalogue.application.overview import required_delivery_source
        from curriculum_api.catalogue.application.session_calendar import required_curriculum_sessions
        verified_delivery = required_delivery_source(rows, compact=compact, read_holidays=get_holiday_rows, serialize_cohort=serialize_cohort_authoring_detail, project_groups=partial(group_details_from_rows, serialize_group_authoring_detail=serialize_group_authoring_detail, clean_str=clean_str, format_date=format_date, group_tutor_from_module_names=group_tutor_from_module_names, staff_assignment_key=staff_assignment_key))
        delivery_source = verified_delivery if delivery_source is None else delivery_source
        cohort_details = lambda: verified_delivery['cohorts']
        group_details = lambda: verified_delivery['groups']
        session_builder = partial(required_curriculum_sessions, read_links=authoring_session_links_by_catalogue, select_holidays=cohort_selected_holidays_by_id, build_authored_sessions=build_sessions_from_authoring_modules, clean_str=clean_str, parse_date=parse_date)
    return query(
        rows,
        visibility,
        compact=compact,
        home_summary=home_summary,
        module_list=module_list,
        delivery_source=delivery_source,
        programme_list=programme_list,
        learner_profiles=learner_profiles,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        attach_module_assignment_counts=attach_module_assignment_counts,
        build_cohorts_and_groups=build_cohorts_and_groups,
        build_ksb_data=build_ksb_data,
        build_modules=build_modules,
        build_programmes=build_programmes,
        build_staff_profiles=build_staff_profiles,
        cohort_authoring_detail_rows=cohort_details,
        curriculum_sessions_from_rows=session_builder,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        group_authoring_detail_rows=group_details,
        is_archived_module_summary=is_archived_module_summary,
        is_operational_training_row=is_operational_training_row,
        module_authoring_row_is_archived=module_authoring_row_is_archived,
        programme_deleted_row=programme_deleted_row,
    )
