"""SQL construction and SELECTs for canonical quality history; no HTTP or writes."""


def trail_query(
    *, ACTIONS, _scope_clause, action_filter, actor_filter, actor_type_filter, datetime, days,
    entity_filter, limit, page, scope, scope_id, search, source_filter,
    system_writes_revision_workspace_clause, timedelta, versioning_ACTOR_TYPES, versioning_ENTITY_TYPES,
    versioning_REVISIONS_TABLE, versioning_SOURCES, versioning_metadata_columns_available,
    versioning_qualified, workspace,
):
    since = datetime.utcnow() - timedelta(days=days)
    where = ['created_at >= %s']
    params = [since]
    # One revision log for the whole LMS, read through a workspace's door. The
    # scoped door at /curriculum/audit-trail must keep showing curriculum and
    # nothing else now that learner, staff and coaching saves land in the same
    # table -- so the workspace narrows the record types rather than the page
    # filtering afterwards and reporting a total that counts what it hid.
    clause, scope_params = system_writes_revision_workspace_clause(workspace)
    where.append(clause)
    params.extend(scope_params)
    if entity_filter and entity_filter != 'all' and entity_filter in versioning_ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity_filter)
    if action_filter and action_filter != 'all' and action_filter in ACTIONS:
        where.append('action = %s')
        params.append(action_filter)
    if actor_filter:
        where.append('lower(actor_email) = %s')
        params.append(actor_filter)
    # Both of these live in columns that only exist once the Phase 2 SQL has
    # run. Offering the filter against a column that is not there would turn one
    # unrecognised query string into a 500, so they are simply not applied until
    # there is something to apply them to -- and the page only offers them when
    # the response says the structured fields are available.
    structured = versioning_metadata_columns_available()
    if structured and source_filter and source_filter != 'all' and source_filter in versioning_SOURCES:
        where.append('source = %s')
        params.append(source_filter)
    if structured and actor_type_filter and actor_type_filter != 'all' and actor_type_filter in versioning_ACTOR_TYPES:
        where.append('actor_type = %s')
        params.append(actor_type_filter)
    # Module scope rides the dedicated index; the wider scopes are answered from
    # the ancestry stored on the snapshot, which is the only place a component
    # records which programme it was under at the time.
    if scope_id and scope == 'module':
        where.append('module_catalogue_id = %s')
        params.append(scope_id)
    elif scope_id and scope in {'programme', 'cohort', 'group'}:
        clause, clause_params = _scope_clause(scope, scope_id)
        where.append(clause)
        params.extend(clause_params)
    # Answered in SQL rather than over the rows that came back, now that the feed
    # is paged: filtering afterwards would search one page and report the result
    # as the whole window, and the count beside it would not agree with it.
    # `context` is not searchable here -- it is derived from the snapshot's
    # ancestry as each event is built, so it is not a column to match on.
    if search:
        where.append(
            '(lower(title) like %s or lower(entity_id) like %s '
            'or lower(actor_name) like %s or lower(actor_email) like %s)'
        )
        params.extend([f'%{search}%'] * 4)

    revisions_table = versioning_qualified(versioning_REVISIONS_TABLE)
    columns = [
        'id', 'entity_type', 'entity_id', 'revision_no', 'action', 'module_catalogue_id', 'parent_id',
        'title', 'version_label', 'content_status', 'changed_fields', 'snapshot', 'actor_name', 'actor_email',
        'reason', 'created_at',
    ]
    if structured:
        columns += ['actor_type', 'triggered_by_email', 'triggered_by_name', 'source', 'metadata']

    # Quality history is canonical-only. Never supplement it from timestamp
    # scans of legacy schemas; those rows cannot be safely reconstructed as
    # Quality revisions.
    hybrid = {
        'since': since,
        'revision_table': revisions_table,
        'revision_where': ' and '.join(where),
        'revision_params': params,
        'revision_columns': columns,
        'workspace': workspace,
        'entity': entity_filter if entity_filter in versioning_ENTITY_TYPES else '',
        'action': action_filter if action_filter in ACTIONS else '',
        'search': search,
        'actor': actor_filter,
        'limit': limit,
        'page': page,
    }
    return hybrid, columns, structured, since


def version_summaries(
    *, curriculum_views_fetch_all, entity_type, limit, module, revisions_table,
    versioning_ENTITY_TYPES,
):
    where = ['1 = 1']
    params = []
    if module:
        where.append('module_catalogue_id = %s')
        params.append(module)
    if entity_type and entity_type != 'all' and entity_type in versioning_ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity_type)

    # One row per versioned record: how many revisions it has and when it last
    # moved. Aggregated in SQL because components run to thousands, and reading
    # every revision back to count them in Python is the one thing this page
    # must not do.
    query = (
        'select entity_type, entity_id, '
        'max(revision_no) as revisions, '
        'max(created_at) as last_change, '
        'min(created_at) as first_change '
        f'from {revisions_table} where {" and ".join(where)} '
        'group by entity_type, entity_id '
        f'order by max(created_at) desc limit {int(limit)}'
    )
    return curriculum_views_fetch_all(query, params)


def record_versions(
    *, curriculum_views_fetch_all, entity_id, entity_type, revisions_table, versions_table,
):
    return curriculum_views_fetch_all(
        'select v.id, v.version_label, v.revision_id, v.content_status, v.note, v.actor_name, '
        'v.actor_email, v.created_at, r.revision_no '
        f'from {versions_table} v join {revisions_table} r on r.id = v.revision_id '
        'where v.entity_type = %s and v.entity_id = %s order by v.created_at desc',
        [entity_type, entity_id],
    )


def history_totals(*, curriculum_views_fetch_all, revisions_table, versions_table):
    return curriculum_views_fetch_all(
        f'select (select count(*) from {revisions_table}) as revisions, '
        f'(select count(*) from {versions_table}) as versions'
    )


def record_revisions(
    *, curriculum_views_fetch_all, entity_id, entity_type, limit, revisions_table,
):
    return curriculum_views_fetch_all(
        'select id, entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, title, '
        'version_label, content_status, changed_fields, actor_name, actor_email, reason, created_at '
        f'from {revisions_table} where entity_type = %s and entity_id = %s '
        f'order by revision_no desc limit {int(limit)}',
        [entity_type, entity_id],
    )


def record_snapshot(
    *, curriculum_views_fetch_all, entity_id, entity_type, revision_number, revisions_table,
):
    return curriculum_views_fetch_all(
        f'select revision_no, snapshot, created_at from {revisions_table} '
        'where entity_type = %s and entity_id = %s and revision_no = %s',
        [entity_type, entity_id, revision_number],
    )
