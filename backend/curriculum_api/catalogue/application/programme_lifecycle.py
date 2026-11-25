"""Programme archive and restore orchestration, retaining cascade ownership and error boundaries.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def soft_delete_programme_authoring_structure(
    identifier,
    programme=None,
    config=None,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    archive_state,
    authoring_soft_delete,
    authoring_table_name,
    clean_str,
    ensure_program_config_archive_columns,
    invalidate_curriculum_cache,
    logger,
    orphan_programme_name_clause,
    programme_config_by_identifier,
    programme_config_identity,
    programme_config_key_column,
    programme_identifier_candidates,
    quote_ident,
    soft_delete_payload,
    update_rows,
):
    """Archive a programme and mark its curriculum children as programme-deleted.

    This is intentionally a soft cascade: no learner, component, week, module,
    group or cohort content is removed. Operational reads already hide rows
    carrying is_programme_deleted, while the data remains inspectable in Neon.
    """
    config = config or programme_config_by_identifier(identifier)
    programme_id = clean_str(programme_config_identity(config) or identifier)
    programme_name = clean_str((programme or {}).get('name') or (config or {}).get('name'))
    # The candidate set the permanent delete plans against, so an archive and a
    # delete can never disagree about which rows belong to this programme: the
    # identifier the caller used is in it, not only the canonical id the config
    # row carries.
    candidates = set(programme_identifier_candidates(identifier, programme, config))
    result = {
        'programmeArchived': False,
        'cohorts': 0,
        'groups': 0,
        'modules': 0,
        'weeks': 0,
        'components': 0,
        'ksbMappings': 0,
    }
    if not candidates:
        return result

    try:
        ensure_program_config_archive_columns()
        if config:
            key_column = programme_config_key_column()
            key_value = config.get(key_column)
            if key_value is not None:
                with archive_state.archive_context('programme-delete'):
                    result['programmeArchived'] = bool(update_rows(
                        'programmes',
                        f'{quote_ident(key_column)} = %s',
                        [key_value],
                        soft_delete_payload('programmes', deleted_by='programme-delete'),
                    ))
    except Exception:
        logger.warning('Could not archive programme %s during soft delete.', identifier, exc_info=True)

    placeholders = ', '.join(['%s'] * len(candidates))
    params = list(candidates)

    def owned_by_programme(table):
        """``programme_id`` match, widened to the rows that only carry the name."""
        orphan_sql, orphan_params = orphan_programme_name_clause(table, programme_name)
        if orphan_sql:
            return f'(programme_id in ({placeholders}) or {orphan_sql})', [*params, *orphan_params]
        return f'programme_id in ({placeholders})', list(params)

    try:
        cohort_where, cohort_params = owned_by_programme(COHORT_AUTHORING_DETAILS_TABLE)
        result['cohorts'] = len(authoring_soft_delete(
            COHORT_AUTHORING_DETAILS_TABLE,
            cohort_where,
            cohort_params,
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))

        group_where, group_params = owned_by_programme(GROUPS_TABLE)
        result['groups'] = len(authoring_soft_delete(
            GROUPS_TABLE,
            group_where,
            group_params,
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))

        result['modules'] = len(authoring_soft_delete(
            AUTHORING_MODULES_TABLE,
            f'''
            programme_id in ({placeholders})
            or group_id in (
                select group_id
                  from {authoring_table_name(GROUPS_TABLE)}
                 where programme_id in ({placeholders})
            )
            ''',
            [*params, *params],
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))

        scoped_modules_sql = f'''
            select module_catalogue_id
              from {authoring_table_name(AUTHORING_MODULES_TABLE)}
             where programme_id in ({placeholders})
                or group_id in (
                    select group_id
                      from {authoring_table_name(GROUPS_TABLE)}
                     where programme_id in ({placeholders})
                )
        '''
        result['weeks'] = len(authoring_soft_delete(
            AUTHORING_WEEKS_TABLE,
            f'''
            module_catalogue_id in (
                {scoped_modules_sql}
            )
            ''',
            [*params, *params],
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))

        scoped_weeks_sql = f'''
            select id
              from {authoring_table_name(AUTHORING_WEEKS_TABLE)}
             where module_catalogue_id in ({scoped_modules_sql})
        '''
        result['components'] = len(authoring_soft_delete(
            AUTHORING_COMPONENTS_TABLE,
            f'''
            module_catalogue_id in (
                {scoped_modules_sql}
            )
            or week_id in (
                {scoped_weeks_sql}
            )
            ''',
            [*params, *params, *params, *params],
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))

        scoped_components_sql = f'''
            select id
              from {authoring_table_name(AUTHORING_COMPONENTS_TABLE)}
             where module_catalogue_id in ({scoped_modules_sql})
                or week_id in ({scoped_weeks_sql})
        '''
        # A mapping hangs off its component only; the scoped components already
        # cover the programme's modules and weeks.
        result['ksbMappings'] = len(authoring_soft_delete(
            AUTHORING_KSB_MAPPINGS_TABLE,
            f'''
            component_id in (
                {scoped_components_sql}
            )
            ''',
            [*params, *params, *params, *params],
            via_parent=programme_id,
            deleted_by='programme-delete',
        ))
    except Exception:
        logger.warning('Could not soft-delete programme children for %s (%s).', identifier, programme_name, exc_info=True)
        raise
    invalidate_curriculum_cache()
    return result


def restore_programme_authoring_structure(
    identifier,
    programme=None,
    config=None,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    RESTORE_NULLABLE_COLUMNS,
    clean_str,
    ensure_module_authoring_tables,
    ensure_program_config_archive_columns,
    invalidate_curriculum_cache,
    logger,
    programme_config_by_identifier,
    programme_config_identity,
    programme_config_key_column,
    quote_ident,
    restore_payload,
    restore_rows_via_parent,
    restore_soft_delete_payload,
    update_rows,
):
    """Bring an archived programme and its cascade-archived children back.

    The mirror image of ``soft_delete_programme_authoring_structure``: the
    programme row loses its archive flags and every child that went down *with
    this programme* is un-marked. Children archived independently keep their own
    state, so restoring is not a way to resurrect unrelated deletions.
    """
    config = config or programme_config_by_identifier(identifier)
    programme_id = clean_str(programme_config_identity(config) or identifier)
    result = {
        'programmeRestored': False,
        'cohorts': 0,
        'groups': 0,
        'modules': 0,
        'weeks': 0,
        'components': 0,
        'ksbMappings': 0,
    }
    if not programme_id:
        return result

    try:
        ensure_program_config_archive_columns()
        if config:
            key_column = programme_config_key_column()
            key_value = config.get(key_column)
            if key_value is not None:
                payload = restore_payload('programmes', config.get('notes'))
                payload.update(restore_soft_delete_payload('programmes'))
                result['programmeRestored'] = bool(update_rows(
                    'programmes',
                    f'{quote_ident(key_column)} = %s',
                    [key_value],
                    payload,
                    allow_null_columns=RESTORE_NULLABLE_COLUMNS,
                ))
    except Exception:
        logger.warning('Could not restore programme %s.', identifier, exc_info=True)
        raise

    try:
        ensure_module_authoring_tables()
        for key, table in (
            ('cohorts', COHORT_AUTHORING_DETAILS_TABLE),
            ('groups', GROUPS_TABLE),
            ('modules', AUTHORING_MODULES_TABLE),
            ('weeks', AUTHORING_WEEKS_TABLE),
            ('components', AUTHORING_COMPONENTS_TABLE),
            ('ksbMappings', AUTHORING_KSB_MAPPINGS_TABLE),
        ):
            result[key] = len(restore_rows_via_parent(table, programme_id))
    except Exception:
        logger.warning('Could not restore programme children for %s.', identifier, exc_info=True)
        raise
    invalidate_curriculum_cache()
    return result
