"""PostgreSQL progress reads; exact SQL and snapshot transport contract."""


def progress_source_available(*, connection, learner_schema_table_exists):
    return (connection.vendor == 'postgresql'
            and learner_schema_table_exists('learner_progress_entries')
            and learner_schema_table_exists('ksb_learner_progress'))


def progress_scope_predicate(component_ids, lineage_column='', scope_ref='', *, PROGRESS_LINEAGE_COLUMN_BY_SCOPE, quote_ident):
    """SQL ``(predicate, params)``: progress entry ``p`` is in the scope.

    The SQL form of learner_progress_ksb_consumption's in-scope test: the
    entry's component is one of ``component_ids``, or its stamped lineage
    column equals ``scope_ref``. Values are compared trimmed, as clean_str does.
    """
    parts = ["btrim(coalesce(p.component_ref, '')) = any(%s)"]
    params = [sorted(component_ids)]
    if lineage_column in PROGRESS_LINEAGE_COLUMN_BY_SCOPE.values() and scope_ref:
        parts.append(f"btrim(coalesce(p.{quote_ident(lineage_column)}, '')) = %s")
        params.append(scope_ref)
    return '(' + ' or '.join(parts) + ')', params


def out_of_scope_progress_count(learner_ids, predicate, predicate_params, *, and_not_excluded, connection):
    """How many consumption rows lie outside the scope, without reading them.

    One row per (entry, KSB code), or one for an entry with no counted KSB --
    the same rows progress_consumption_rows() would have returned for them.
    """
    not_excluded = and_not_excluded('k', connection)
    with connection.cursor() as cursor:
        cursor.execute(
            '''
            select coalesce(sum(greatest(1, codes.n)), 0)
            from "Learner"."learner_progress_entries" p
            cross join lateral (
                select count(distinct k.ksb_code) as n
                from ''' + official_progress_relation() + ''' k
                where k.progress_id = p.id''' + not_excluded + '''
            ) codes
            where p.learner_id = any(%s) and not ''' + predicate,
            [learner_ids, *predicate_params],
        )
        return int(cursor.fetchone()[0] or 0)


def achieved_outcome_predicate(cursor, learner_ids, *, progress_counts_as_achieved):
    """SQL ``(predicate, params)`` keeping entries that count as achieved, or None.

    The (kind, passed) pairs these learners actually have are judged by
    ``progress_counts_as_achieved`` -- the one completion rule -- and only the
    accepted pairs are written into the query, so the rule is never restated in
    SQL. None means no entry counts at all.
    """
    cursor.execute(
        'select distinct p.kind, p.passed from "Learner"."learner_progress_entries" p where p.learner_id = any(%s)',
        [learner_ids],
    )
    pairs = [(kind, passed) for kind, passed in cursor.fetchall()
             if progress_counts_as_achieved(kind=kind, passed=passed)]
    if not pairs:
        return None
    # `is not distinct from`: an ungraded completion leaves `passed` NULL.
    sql = ' or '.join(['(p.kind is not distinct from %s and p.passed is not distinct from %s)'] * len(pairs))
    return f'({sql})', [value for pair in pairs for value in pair]


def progress_consumption_rows(learner_ids, codes=None, scope_predicate=None, achieved_only=False, *, achieved_outcome_predicate, and_not_excluded, connection, rows_as_dicts):
    """One row per (progress entry, KSB code), as learner_progress_ksb_consumption reads them.

    One query, one row per progress entry, its KSB codes folded into arrays and
    unfolded here. A plain join repeated every progress column (titles,
    reflection text, lineage) once per KSB code -- ~155k wide rows for one
    programme -- and a separate KSB read still shipped ~120k narrow rows. The
    query runs in well under a second; shipping rows to the app was the cost.
    For the same reason each title arrives once, already resolved (live title,
    else the label stamped on the progress row), rather than both copies.

    Same rows as the grouped join: an entry with no counted KSB keeps one row
    with a NULL code (the LEFT join; its hours still count), weight is the
    largest per (entry, code), codes run in code order within an entry, and
    entries run submitted_at desc nulls last, id desc. ``codes``, when given,
    keeps only entries and KSB rows carrying one of those codes -- for callers
    that read nothing else. ``scope_predicate`` (from progress_scope_predicate)
    keeps only the scope's own entries. ``achieved_only`` keeps only entries
    that count as achieved and leaves the reflection text (``feedback``)
    behind -- for a caller reading neither.
    """
    not_excluded = and_not_excluded('k', connection)
    code_sql = ' and upper(btrim(k.ksb_code)) = any(%s)' if codes is not None else ''
    code_params = [list(codes)] if codes is not None else []
    scope_sql, scope_params = (f' and {scope_predicate[0]}', list(scope_predicate[1])) if scope_predicate else ('', [])
    with connection.cursor() as cursor:
        if achieved_only:
            outcome = achieved_outcome_predicate(cursor, learner_ids)
            if outcome is None:
                return []
            scope_sql += f' and {outcome[0]}'
            scope_params += outcome[1]
        cursor.execute(
            '''
            select p.learner_id, p.id as progress_id, p.kind, p.component_ref,
                   p.component_type, p.quiz_ref, p.submitted_at,
                   p.reported_time, ''' + ("''::text as feedback" if achieved_only else 'p.feedback') + ''', p.passed,
                   p.programme_ref, p.cohort_ref, p.group_ref,
                   p.module_ref, p.week_ref,
                   p.expected_otjh as progress_expected_otjh,
                   c.expected_otjh as component_expected_otjh,
                   coalesce(nullif(c.title, ''), nullif(p.component_title, ''), '') as resolved_component_title,
                   -- The progress row's module_title is a label written when
                   -- the learner completed the activity, so a renamed module
                   -- reads stale and a deleted one reads as though it were
                   -- still in the catalogue. Resolve both live; the stamped
                   -- label only where no live title is left.
                   case when btrim(coalesce(m.title, '')) <> '' then m.title else p.module_title end as live_module_title,
                   case when btrim(coalesce(w.title, '')) <> '' then w.title else p.week_title end as live_week_title,
                   m.module_catalogue_id as live_module_catalogue_id,
                   (m.module_catalogue_id is not null) as module_found,
                   coalesce(m.status in ('inactive', 'archived'), false) as module_deleted,
                   ksb.codes as ksb_codes, ksb.weights as ksb_weights, ksb.classes as ksb_classes
            from "Learner"."learner_progress_entries" p
            left join curriculum.components c on c.id = p.component_ref
            left join curriculum.weeks w on w.id = c.week_id
            left join curriculum.modules m
                   on m.module_catalogue_id = coalesce(c.module_catalogue_id, w.module_catalogue_id)
            left join lateral (
                select array_agg(g.ksb_code order by g.ksb_code) as codes,
                       array_agg(g.weight order by g.ksb_code) as weights,
                       array_agg(g.weight_class order by g.ksb_code) as classes
                from (
                    select k.ksb_code,
                           coalesce(max(k.weight), 0) as weight,
                           coalesce(max(nullif(k.weight_class, '')), 'soft') as weight_class
                    from ''' + official_progress_relation() + ''' k
                    -- Rows the KSB standards migration registered as not
                    -- counting drop out here; the activity and its hours stay.
                    where k.progress_id = p.id''' + not_excluded + code_sql + '''
                    group by k.ksb_code
                ) g
            ) ksb on true
            where p.learner_id = any(%s)''' + (' and ksb.codes is not null' if codes is not None else '') + scope_sql + '''
            order by p.submitted_at desc nulls last, p.id desc
            ''',
            [*code_params, learner_ids, *scope_params],
        )
        entries = rows_as_dicts(cursor)
    rows = []
    for entry in entries:
        codes_of = entry.pop('ksb_codes', None) or []
        weights = entry.pop('ksb_weights', None) or []
        classes = entry.pop('ksb_classes', None) or []
        # LEFT, not inner: a completed component with no KSB snapshot is still
        # off-the-job hours the learner did. See learner_progress_ksb_consumption.
        for ksb_code, weight, weight_class in list(zip(codes_of, weights, classes)) or [(None, 0, 'soft')]:
            rows.append({**entry, 'ksb_code': ksb_code, 'weight': weight, 'weight_class': weight_class})
    return rows

from learner_api.ksb_domain import official_progress_relation
