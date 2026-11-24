"""Reflection metadata and SQL reads; no identity inference or projection rules."""


def reflection_columns(*, connection, learner_schema_columns, learner_schema_table_exists):
    if connection.vendor != 'postgresql' or not learner_schema_table_exists('learning_reflection_submissions'):
        return None
    columns = learner_schema_columns('learning_reflection_submissions')
    if 'ksb_weights' not in columns:
        return None
    # Without the progress link there is no sound way to attach a reflection to
    # a Curriculum learner, and guessing from `learner_id` is the defect this
    # replaced. Report nothing rather than something wrong.
    if 'progress_entry_id' not in columns or not learner_schema_table_exists('learner_progress_entries'):
        return None
    return columns


def reflection_rows(profile_ids, scoped_component_ids, columns, *, connection, logger, quote_ident, rows_as_dicts):
    select_columns = ['progress_entry_id', 'ksb_weights']
    for optional in (
        'id', 'learner_kind', 'learner_id', 'learner_name', 'programme_name',
        'activity_type', 'activity_id', 'activity_title', 'module_title',
        'week_title', 'planned_otjh', 'status', 'learning_reflection',
        'submitted_at', 'date_completed', 'actual_time_hours', 'quality_score',
        'component_ref',
    ):
        if optional in columns and optional not in select_columns:
            select_columns.append(optional)
    # The reflection's own view of which component it is about, used only to
    # scope the unlinked-reflection report. Exact curriculum ids, never titles.
    reflection_component_parts = [
        f'r.{quote_ident(column)}'
        for column in ('component_ref', 'activity_id')
        if column in columns
    ]
    reflection_component_sql = (
        f'coalesce({", ".join(reflection_component_parts)})'
        if len(reflection_component_parts) > 1
        else (reflection_component_parts[0] if reflection_component_parts else 'null')
    )
    select_sql = ', '.join(f'r.{quote_ident(column)}' for column in select_columns)
    # Everything below comes from the progress row the reflection points at, or
    # from the component that row is tied to: the learner it belongs to, the
    # outcome the completion rule needs, and the expected OTJH.
    select_sql += (
        ', pe.learner_id as progress_learner_id'
        ', pe.kind as progress_kind'
        ', pe.passed as progress_passed'
        ', pe.component_ref as progress_component_ref'
        ', pe.component_title as progress_component_title'
        ', pe.component_type as progress_component_type'
        ', pe.module_title as progress_module_title'
        ', pe.week_title as progress_week_title'
        ', pe.expected_otjh as progress_expected_otjh'
        ', pe.submitted_at as progress_submitted_at'
        ', c.expected_otjh as component_expected_otjh'
        ', c.title as component_title'
    )
    join_sql = (
        ' left join "Learner"."learner_progress_entries" pe'
        f' on pe.id = r.{quote_ident("progress_entry_id")}'
        ' left join curriculum.components c'
        f' on c.id = coalesce(pe.component_ref, {reflection_component_sql})'
    )
    where_parts = []
    params = []
    if profile_ids:
        where_parts.append('pe.learner_id::text = any(%s)')
        params.append(list(profile_ids))
    if scoped_component_ids and reflection_component_parts:
        where_parts.append(
            f'(r.{quote_ident("progress_entry_id")} is null'
            f' and {reflection_component_sql} = any(%s))'
        )
        params.append(list(scoped_component_ids))
    if not where_parts:
        return None
    order_column = 'submitted_at' if 'submitted_at' in columns else ('id' if 'id' in columns else '')
    order_sql = f' order by r.{quote_ident(order_column)} desc' if order_column else ''
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                f'''
                select {select_sql}
                from "Learner"."learning_reflection_submissions" r
                {join_sql}
                where {' or '.join(where_parts)}
                {order_sql}
                ''',
                params,
            )
            rows = rows_as_dicts(cursor)
    except Exception as exc:
        logger.warning('Could not load learning reflection KSB consumption: %s', exc)
        return None
    return rows
