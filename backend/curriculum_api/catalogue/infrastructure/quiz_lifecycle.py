"""Quiz ownership reads and archive persistence; shared quiz references remain protected.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def archive_module_child_quizzes(
    module_catalogue_id,
    *,
    include_deleted_children=False,
    apply=True,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    _quiz_reference_id,
    archive_state,
    authoring_fetch_all,
    clean_str,
    connection,
    curriculum_row_effectively_deleted,
    datetime,
    fetch_all,
    has_column,
    parse_json_value,
    table_exists,
    table_name,
    update_rows,
):
    """Move quizzes owned only by this module into the Quiz Archive.

    A quiz can be attached through the Module Builder's ``linkedQuizId``, the
    normalised module/course link table, or the older component link table.  A
    shared quiz is not a child of one module, so an active reference from another
    module (or a week template) keeps it live.  Attempts, questions and links are
    deliberately preserved: ``trash`` is the Quiz Workspace's recoverable archive
    state, not a hard delete.
    """
    module_catalogue_id = clean_str(module_catalogue_id)
    if not module_catalogue_id or not table_exists('quizzes'):
        return []

    component_active_sql = ''
    if not include_deleted_children:
        component_active_sql = f' and {archive_state.live_sql()}'
    module_components = authoring_fetch_all(
        AUTHORING_COMPONENTS_TABLE,
        f'module_catalogue_id = %s{component_active_sql}',
        [module_catalogue_id],
    )
    component_ids = [clean_str(row.get('id')) for row in module_components if clean_str(row.get('id'))]
    candidate_ids = set()
    for component in module_components:
        settings = parse_json_value(component.get('settings_json'), {})
        quiz_id = _quiz_reference_id(settings.get('linkedQuizId') if isinstance(settings, dict) else None)
        if quiz_id:
            candidate_ids.add(quiz_id)

    if table_exists('quiz_course_links'):
        course_rows = fetch_all(
            f'select quiz_id from {table_name("quiz_course_links")} where module_catalogue_id = %s',
            [module_catalogue_id],
        )
        candidate_ids.update(
            quiz_id for quiz_id in (_quiz_reference_id(row.get('quiz_id')) for row in course_rows) if quiz_id
        )

    if component_ids and table_exists('quiz_component_links'):
        placeholders = ', '.join(['%s'] * len(component_ids))
        component_link_rows = fetch_all(
            f'select quiz_id from {table_name("quiz_component_links")} where component_id in ({placeholders})',
            component_ids,
        )
        candidate_ids.update(
            quiz_id for quiz_id in (_quiz_reference_id(row.get('quiz_id')) for row in component_link_rows) if quiz_id
        )

    # Legacy quizzes may carry only the module's week id/name metadata.
    week_active_sql = ''
    if not include_deleted_children:
        week_active_sql = f' and {archive_state.live_sql()}'
    module_weeks = authoring_fetch_all(
        AUTHORING_WEEKS_TABLE,
        f'module_catalogue_id = %s{week_active_sql}',
        [module_catalogue_id],
    )
    week_ids = [clean_str(row.get('id')) for row in module_weeks if clean_str(row.get('id'))]
    module_rows = authoring_fetch_all(AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_catalogue_id])
    module_row = module_rows[0] if module_rows else {}
    legacy_clauses = []
    legacy_params = []
    if week_ids:
        placeholders = ', '.join(['%s'] * len(week_ids))
        legacy_clauses.append(f'week_id in ({placeholders})')
        legacy_params.extend(week_ids)
    module_title = clean_str(module_row.get('title'))
    if module_title:
        programme_id = clean_str(module_row.get('programme_id'))
        programme_name = clean_str(module_row.get('programme_name'))
        scope = []
        scope_params = []
        if programme_id:
            scope.extend(['lower(coalesce(programme_id, \'\')) = lower(%s)', 'lower(coalesce(programme, \'\')) = lower(%s)'])
            scope_params.extend([programme_id, programme_id])
        if programme_name:
            scope.extend(['lower(coalesce(programme, \'\')) = lower(%s)', 'lower(coalesce(programme_id, \'\')) = lower(%s)'])
            scope_params.extend([programme_name, programme_name])
        legacy_clauses.append(
            '(lower(coalesce(module, \'\')) = lower(%s)'
            + (f' and ({" or ".join(scope)})' if scope else '')
            + ')'
        )
        legacy_params.append(module_title)
        legacy_params.extend(scope_params)
    if legacy_clauses:
        legacy_rows = fetch_all(
            f'select id from {table_name("quizzes")} where (' + ' or '.join(legacy_clauses) + ')',
            legacy_params,
        )
        candidate_ids.update(
            quiz_id for quiz_id in (_quiz_reference_id(row.get('id')) for row in legacy_rows) if quiz_id
        )

    if not candidate_ids:
        return []

    # Do not report/archive quizzes that are already in the Quiz Archive.
    placeholders = ', '.join(['%s'] * len(candidate_ids))
    current_quizzes = fetch_all(
        f'select id, status from {table_name("quizzes")} where id in ({placeholders})',
        sorted(candidate_ids),
    )
    candidate_ids = {
        quiz_id
        for row in current_quizzes
        for quiz_id in [_quiz_reference_id(row.get('id'))]
        if quiz_id and clean_str(row.get('status')).lower() != 'trash'
    }
    if not candidate_ids:
        return []

    # Preserve quizzes that still have an active owner outside this module.
    shared_ids = set()
    placeholders = ', '.join(['%s'] * len(candidate_ids))
    candidate_params = sorted(candidate_ids)
    if table_exists('quiz_course_links'):
        other_links = fetch_all(
            f'select quiz_id, module_catalogue_id from {table_name("quiz_course_links")} '
            f'where quiz_id in ({placeholders}) and module_catalogue_id <> %s',
            [*candidate_params, module_catalogue_id],
        )
        other_module_ids = {clean_str(row.get('module_catalogue_id')) for row in other_links if clean_str(row.get('module_catalogue_id'))}
        active_other_ids = set()
        if other_module_ids:
            other_placeholders = ', '.join(['%s'] * len(other_module_ids))
            other_modules = authoring_fetch_all(
                AUTHORING_MODULES_TABLE,
                f'module_catalogue_id in ({other_placeholders})',
                sorted(other_module_ids),
            )
            active_other_ids = {
                clean_str(row.get('module_catalogue_id'))
                for row in other_modules
                if not curriculum_row_effectively_deleted(row)
            }
        shared_ids.update(
            quiz_id
            for row in other_links
            if clean_str(row.get('module_catalogue_id')) in active_other_ids
            for quiz_id in [_quiz_reference_id(row.get('quiz_id'))]
            if quiz_id
        )

    # Only the two columns this reads. A ``select *`` here pulled every other
    # module's components (~40k rows) and, on the normalised schema, derived
    # each one's KSB mapping list as well -- an archive of a two-week module
    # took over 100 s.
    if connection.vendor == 'postgresql' and has_column(AUTHORING_COMPONENTS_TABLE, 'settings_json'):
        # Only components that link a quiz can share one; read just that value.
        linked = fetch_all(
            f"select settings_json ->> 'linkedQuizId' as linked_quiz_id "
            f'from {table_name(AUTHORING_COMPONENTS_TABLE)} '
            f'where module_catalogue_id <> %s{component_active_sql} '
            f"and coalesce(settings_json ->> 'linkedQuizId', '') <> ''",
            [module_catalogue_id],
        )
        linked_values = [row.get('linked_quiz_id') for row in linked]
    else:
        other_components = authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            f'module_catalogue_id <> %s{component_active_sql}',
            [module_catalogue_id],
            columns=['id', 'settings_json'],
        )
        linked_values = []
        for component in other_components:
            settings = parse_json_value(component.get('settings_json'), {})
            linked_values.append(settings.get('linkedQuizId') if isinstance(settings, dict) else None)
    for value in linked_values:
        quiz_id = _quiz_reference_id(value)
        if quiz_id in candidate_ids:
            shared_ids.add(quiz_id)
    if table_exists('quiz_component_links'):
        # The same set of other active components, as a subquery rather than
        # tens of thousands of bound ids.
        other_component_links = fetch_all(
            f'select quiz_id from {table_name("quiz_component_links")} '
            f'where quiz_id in ({placeholders}) and component_id in ('
            f'select id from {table_name(AUTHORING_COMPONENTS_TABLE)} '
            f'where module_catalogue_id <> %s{component_active_sql})',
            [*candidate_params, module_catalogue_id],
        )
        shared_ids.update(
            quiz_id for quiz_id in (_quiz_reference_id(row.get('quiz_id')) for row in other_component_links) if quiz_id
        )

    # A Week Builder template is another active owner and must not be broken.
    if table_exists('week_template_components') and has_column('week_template_components', 'settings_json'):
        template_rows = fetch_all(f'select settings_json from {table_name("week_template_components")}')
        for row in template_rows:
            settings = parse_json_value(row.get('settings_json'), {})
            quiz_id = _quiz_reference_id(settings.get('linkedQuizId') if isinstance(settings, dict) else None)
            if quiz_id in candidate_ids:
                shared_ids.add(quiz_id)

    archive_ids = sorted(candidate_ids - shared_ids)
    if not archive_ids or not apply:
        return archive_ids
    placeholders = ', '.join(['%s'] * len(archive_ids))
    update_rows(
        'quizzes',
        f'id in ({placeholders}) and lower(coalesce(status, \'\')) <> \'trash\'',
        archive_ids,
        {'status': 'trash', 'updated_at': datetime.utcnow()},
    )
    return archive_ids
