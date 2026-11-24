"""PostgreSQL summary, declaration and evidence reads; exact legacy SQL contracts."""


def progress_total_rows(learner_ids, code_filter, *, and_not_excluded, connection, rows_as_dicts):
    with connection.cursor() as cursor:
        cursor.execute(
            '''
                select p.learner_id, p.id as progress_id, p.kind,
                       p.component_ref, p.passed, p.submitted_at,
                       k.ksb_code, coalesce(max(k.weight), 0) as weight
                from "Learner"."learner_progress_entries" p
                join "Learner"."learner_progress_ksbs" k on k.progress_id = p.id''' + and_not_excluded('k', connection) + '''
                where p.learner_id = any(%s)
                  -- KSB snapshots are normalised to upper-case on every write.
                  -- Keep the indexed column bare so PostgreSQL can use
                  -- learner_progress_ksbs_code_idx instead of scanning all
                  -- snapshots to evaluate upper(btrim(...)).
                  and k.ksb_code = any(%s)
                group by p.learner_id, p.id, p.kind, p.component_ref,
                         p.passed, p.submitted_at, k.ksb_code
                order by p.submitted_at desc nulls last, p.id desc
                ''',
            [learner_ids, code_filter],
        )
        rows = rows_as_dicts(cursor)
    return rows


def declaration_source_available(*, connection, learner_schema_columns, learner_schema_table_exists):
    if connection.vendor != 'postgresql':
        return False
    if not learner_schema_table_exists('learning_reflection_submissions') or not learner_schema_table_exists('learner_progress_entries'):
        return False
    columns = learner_schema_columns('learning_reflection_submissions')
    if 'ksb_codes' not in columns or 'status' not in columns or 'progress_entry_id' not in columns:
        return False
    return True


def declaration_rows(learner_ids, *, connection, rows_as_dicts):
    with connection.cursor() as cursor:
        cursor.execute(
            '''
                select pe.learner_id, r.ksb_codes
                from "Learner".learning_reflection_submissions r
                join "Learner".learner_progress_entries pe on pe.id = r.progress_entry_id
                where pe.learner_id = any(%s)
                  and r.status in ('submitted_for_tutor_review', 'accepted')
                ''',
            [learner_ids],
        )
        rows = rows_as_dicts(cursor)
    return rows


def evidence_rows(
    ids,
    *,
    connection,
    learner_schema_columns,
    learner_schema_table_exists,
    logger,
    quote_ident,
    rows_as_dicts,
):
    if connection.vendor != 'postgresql':
        return None
    if not learner_schema_table_exists('evidence_files'):
        return None
    columns = learner_schema_columns('evidence_files')
    if 'progress_entry_id' not in columns:
        return None
    optional = [
        column for column in (
            'id', 'original_filename', 'status', 'scan_result', 'section_ref',
            'component_ref', 'uploaded_at', 'content_type', 'size_bytes',
        )
        if column in columns
    ]
    select_sql = ', '.join(f'e.{quote_ident(column)}' for column in ['progress_entry_id'] + optional)
    try:
        with connection.cursor() as cursor:
            # Ask the evidence table which entries it holds files for (a
            # partial index covers it), and keep only those of ours. Sending
            # every progress id instead -- ~60k for one programme, for a table
            # with a few dozen linked files -- was the whole cost of this read.
            cursor.execute(
                'select distinct progress_entry_id::text from "Learner"."evidence_files"'
                ' where progress_entry_id is not null'
            )
            wanted = set(ids)
            ids = [row[0] for row in cursor.fetchall() if row[0] in wanted]
            if not ids:
                return None
            cursor.execute(
                f'''
                select {select_sql}
                from "Learner"."evidence_files" e
                where e.progress_entry_id::text = any(%s)
                order by e.progress_entry_id, {'e.' + quote_ident('uploaded_at') if 'uploaded_at' in columns else 'e.progress_entry_id'}
                ''',
                [list(ids)],
            )
            rows = rows_as_dicts(cursor)
    except Exception as exc:
        logger.warning('Could not load evidence for progress entries: %s', exc)
        return None
    return rows
