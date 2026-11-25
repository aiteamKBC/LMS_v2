"""Guarded programme deletion: reusable-content detachment and foreign-key-safe ordering.

Explicit capabilities are supplied at the existing views composition seam.
No legacy views, application settings or provider runtime is imported here.
"""


def unhook_programme_reusables(
    plan,
    removed,
    *,
    DETACHED_PARENT_SENTINEL,
    WEEK_TEMPLATES_TABLE,
    curriculum_in_clause,
    curriculum_where_any,
    datetime,
    has_column,
    table_exists,
    update_rows,
):
    """Keep the quizzes and week templates of a dying programme, unhooked from it.

    Quizzes are already standalone rows carrying learner attempts, and their
    questions and answers hang off them by ``ON DELETE CASCADE`` - a cascade
    that from here on simply never fires for a programme delete.
    """
    child = plan.get('childIds') or {}
    week_ids = child.get('weekIds') or []

    def count(table, rows):
        if rows:
            removed[table] = removed.get(table, 0) + len(rows)

    # Quizzes: unhook from the programme and week, keep the quiz.
    if table_exists('quizzes'):
        clauses = [curriculum_in_clause('programme_id', plan.get('candidates') or [])]
        if week_ids:
            clauses.append(curriculum_in_clause('week_id', week_ids))
        where_sql, params = curriculum_where_any(clauses)
        if where_sql:
            updates = {}
            if has_column('quizzes', 'week_id'):
                updates['week_id'] = DETACHED_PARENT_SENTINEL
            if has_column('quizzes', 'programme_id'):
                updates['programme_id'] = DETACHED_PARENT_SENTINEL
            if updates:
                count('quizzes', update_rows('quizzes', where_sql, params, updates))

    # Week templates are reusable by definition; unhook rather than delete.
    template_ids = child.get('weekTemplateIds') or []
    if template_ids and table_exists(WEEK_TEMPLATES_TABLE):
        where_sql, params = curriculum_where_any([curriculum_in_clause('id', template_ids)])
        if where_sql:
            updates = {'updated_at': datetime.utcnow()}
            for column in ('programme_id', 'programme_name', 'group_id', 'group_name', 'module_catalogue_id'):
                if has_column(WEEK_TEMPLATES_TABLE, column):
                    updates[column] = DETACHED_PARENT_SENTINEL
            count(WEEK_TEMPLATES_TABLE, update_rows(WEEK_TEMPLATES_TABLE, where_sql, params, updates))


def permanently_delete_programme_structure(
    plan,
    force_content=False,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    LIVE_SESSIONS_TABLE,
    calendar_holidays,
    curriculum_in_clause,
    curriculum_where_any,
    delete_rows,
    group_coaches,
    invalidate_curriculum_cache,
    log_curriculum_storage,
    programme_config_key_column,
    refuse_if_programme_owns_content,
    table_exists,
    unhook_programme_reusables,
):
    """Delete an archived programme that no longer owns authored content.

    The order is dictated by the foreign keys migration 0038 added (children
    first, ON DELETE RESTRICT). That ordering is exactly what a hand-written
    ``delete from curriculum.programmes`` cannot supply, which is why Postgres
    answers it with ``cohorts_programme_id_fkey``.

    Authored content is *not* deleted by the normal path: a programme that still
    owns weeks or components is refused whole (``refuse_if_programme_owns_content``).
    ``force_content=True`` is an explicit destructive override used only by the
    forced-delete flow; it removes components and weeks before their modules.
    Quizzes
    and week templates are kept, unhooked from it (``unhook_programme_reusables``);
    the delivery scaffolding - the programme, cohorts, groups, modules, live
    sessions and link rows - is what actually goes. Deleting a live session
    still takes its occurrences, attendance, artifacts and recording events with
    it by cascade.

    The link tables are cleared explicitly first, because a link may point at
    this programme's module from a quiz that belongs to another programme.

    ``ksb_mappings`` is still wiped, and that loses nothing: since 0042 a
    component owns its mappings in its own ``ksb_mappings`` JSONB column and
    that table is a projection of it (``component_ksb_mappings_from_row``
    prefers the JSONB).

    Learner accounts, progress and enrolment rows are never touched. The
    training-plan tables that reference this content are RESTRICT-guarded and
    surface through ``plan['blockers']`` before anything is deleted.
    """
    candidates = plan.get('candidates') or []
    child = plan.get('childIds') or {}
    removed = {}
    if not candidates:
        return removed

    def wipe(table, clauses):
        where_sql, params = curriculum_where_any(clauses)
        if not where_sql or not table_exists(table):
            return
        # Links that reference these rows with RESTRICT go first, as in
        # authoring_delete: a cohort's holiday choices, a group's coaches.
        if table == COHORT_AUTHORING_DETAILS_TABLE:
            calendar_holidays.release_cohorts(where_sql, params)
        if table == GROUPS_TABLE:
            group_coaches.release_groups(where_sql, params)
        rows = delete_rows(table, where_sql, params)
        log_curriculum_storage('hard_delete', table, rows=rows)
        if rows:
            removed[table] = len(rows)

    programme_clause = curriculum_in_clause('programme_id', candidates)
    module_clause = curriculum_in_clause('module_catalogue_id', child.get('moduleIds'))
    week_clause = curriculum_in_clause('week_id', child.get('weekIds'))
    component_clause = curriculum_in_clause('component_id', child.get('componentIds'))

    # Refuse before anything is written, then unhook what is kept.
    if not force_content:
        refuse_if_programme_owns_content(plan)
    unhook_programme_reusables(plan, removed)

    # Mappings are placed by component; the plan's componentIds already hold
    # every component of the programme's modules and weeks.
    wipe(AUTHORING_KSB_MAPPINGS_TABLE, [component_clause])
    wipe('quiz_component_links', [component_clause])
    wipe('quiz_course_links', [module_clause, week_clause])
    if force_content:
        # Authored content is explicitly opted into deletion here. Components
        # must go before weeks, and both must go before their parent modules.
        wipe(AUTHORING_COMPONENTS_TABLE, [
            curriculum_in_clause('id', child.get('componentIds')),
        ])
        wipe(AUTHORING_WEEKS_TABLE, [
            curriculum_in_clause('id', child.get('weekIds')),
        ])
    # Notification history is retained; its RESTRICT FK may refuse this delete.
    wipe('module_completion_criteria', [module_clause])
    wipe('module_details', [module_clause])
    wipe(LIVE_SESSIONS_TABLE, [module_clause])
    wipe('free_programme_components', [programme_clause])
    wipe('free_programme_modules', [programme_clause])
    wipe(AUTHORING_MODULES_TABLE, [
        curriculum_in_clause('module_catalogue_id', child.get('moduleIds')),
    ])
    wipe(GROUPS_TABLE, [curriculum_in_clause('group_id', child.get('groupIds'))])
    wipe(COHORT_AUTHORING_DETAILS_TABLE, [
        curriculum_in_clause('cohort_id', child.get('cohortIds')),
    ])
    wipe('programmes', [curriculum_in_clause(programme_config_key_column(), candidates)])

    invalidate_curriculum_cache()
    return removed
