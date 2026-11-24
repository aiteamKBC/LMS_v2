"""Exact grouped catalogue and latest-attempt PostgreSQL read contracts."""


def _grouped_rows(
    table,
    fields,
    active,
    ids,
    *,
    AUTHORING_KSB_MAPPINGS_TABLE,
    _STRIP_CHARS,
    can_select,
    fetch_all,
    quote_ident,
    read_source,
    uses_status,
):
    if uses_status(table):
        fields = (*fields, 'status')
    fields = [quote_ident(field) for field in fields if can_select(table, field)]
    selections, groups, params = list(fields), list(fields), []
    if table == AUTHORING_KSB_MAPPINGS_TABLE:
        # Stats only test whether a mapping is component-owned; they never
        # display or resolve its component id. Preserve Python strip rules.
        expression = "case when length(btrim(component_id, %s)) > 0 then 'mapped' else '' end"
        selections.append(expression + ' as component_id')
        groups.append(str(len(selections)))
        params.append(_STRIP_CHARS)
    return active(fetch_all(
        f'select {", ".join(selections)}, count(*) as _stats_count '
        f'from {read_source(table)} '
        f'where module_catalogue_id in ({", ".join(["%s"] * len(ids))}) '
        f'group by {", ".join(groups)}',
        [*params, *ids],
    ))


def progress_outcomes(learner_ids, *, fetch_all):
    return fetch_all('''
        select distinct kind, passed from "Learner"."learner_progress_entries"
        where learner_id = any(%s)
    ''', [learner_ids])


def latest_progress_weights(
    eligible,
    learner_ids,
    codes,
    *,
    _STRIP_CHARS,
    and_not_excluded,
    connection,
    fetch_all,
):
    values = ', '.join(['(%s::text, %s::boolean)'] * len(eligible))
    params = [value for row in eligible for value in (row['kind'], row['passed'])]
    exclusion = and_not_excluded('k', connection)
    sql = f'''
        select learner_id, ksb_code,
               array_agg(weight order by submitted_at desc nulls last, progress_id desc) as weights
        from (
            select facts.*, row_number() over (
                partition by learner_id, component_key,
                             case when component_key is null then progress_id end, ksb_code
                order by submitted_at desc nulls last, progress_id desc
            ) as attempt_rank
            from (
                select p.learner_id, p.id as progress_id, p.submitted_at, k.ksb_code,
                       nullif(btrim(p.component_ref, %s), '') as component_key,
                       coalesce(max(k.weight), 0) as weight
                from "Learner"."learner_progress_entries" p
                join (values {values}) eligible(kind, passed)
                  on p.kind is not distinct from eligible.kind
                 and p.passed is not distinct from eligible.passed
                join "Learner"."learner_progress_ksbs" k on k.progress_id = p.id {exclusion}
                where p.learner_id = any(%s) and k.ksb_code = any(%s)
                group by p.learner_id, p.id, p.submitted_at, p.component_ref, k.ksb_code
            ) facts
        ) attempts
        where attempt_rank = 1
        group by learner_id, ksb_code
    '''
    return fetch_all(sql, [_STRIP_CHARS, *params, learner_ids, codes])
