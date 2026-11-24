"""Existing revision SQL and actor facets; no timestamp-derived history or persistence."""


def _scope_clause(
    scope, scope_id, *, connection, versioning_CONTEXT_KEY,
):
    """Match a programme / cohort / group id against the snapshot's own ancestry.

    Scoping reads the snapshot rather than joining back to the live records on
    purpose: it answers "what changed under this programme *at the time*", and a
    module that has since moved elsewhere must still appear under the programme
    it was in when the change happened.
    """
    column = {'programme': 'programme_id', 'cohort': 'cohort_id', 'group': 'group_id'}[scope]
    if connection.vendor == 'postgresql':
        # Either the entity's own column or the ancestry recorded beside it.
        return (
            f"(snapshot ->> '{column}' = %s or snapshot -> '{versioning_CONTEXT_KEY}' ->> '{column}' = %s)",
            [scope_id, scope_id],
        )
    # sqlite keeps the snapshot as text, so this is a containment test. Only the
    # local suites run this branch; Postgres answers it properly above.
    return ('snapshot like %s', [f'%"{column}": "{scope_id}"%'])


def revision_actors(
    since, workspace='', entity='', action='', source='', actor_type='', *, ACTIONS,
    curriculum_views_clean_str, curriculum_views_fetch_all, system_writes_revision_workspace_clause,
    versioning_ACTOR_TYPES, versioning_ENTITY_TYPES, versioning_REVISIONS_TABLE, versioning_SOURCES,
    versioning_metadata_columns_available, versioning_qualified,
):
    """Who has changed anything in this window, for the filter.

    Scoped to one workspace and the active non-person filters, because the count travels: it is both the "Who"
    filter's label and the Changes column on the People list. One revision log
    now holds every workspace's saves, so an unscoped count against a scoped
    door reported changes the door itself will not show -- a person with three
    coaching saves and no curriculum ones appeared in Curriculum Studio's list
    as having changed three things there.
    """
    revisions_table = versioning_qualified(versioning_REVISIONS_TABLE)
    where = ['created_at >= %s', 'coalesce(actor_email, %s) <> %s']
    params = [since, '', '']
    clause, scope_params = system_writes_revision_workspace_clause(workspace)
    where.append(clause)
    params.extend(scope_params)
    if entity and entity != 'all' and entity in versioning_ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity)
    if action and action != 'all' and action in ACTIONS:
        where.append('action = %s')
        params.append(action)
    if versioning_metadata_columns_available():
        if source and source != 'all' and source in versioning_SOURCES:
            where.append('source = %s')
            params.append(source)
        if actor_type and actor_type != 'all' and actor_type in versioning_ACTOR_TYPES:
            where.append('actor_type = %s')
            params.append(actor_type)
    try:
        rows = curriculum_views_fetch_all(
            'select actor_email, max(actor_name) as actor_name, count(*) as changes '
            f'from {revisions_table} where {" and ".join(where)} '
            'group by actor_email order by count(*) desc limit 100',
            params,
        )
    except Exception:
        return []
    return [
        {
            'email': curriculum_views_clean_str(row.get('actor_email')),
            'name': curriculum_views_clean_str(row.get('actor_name')),
            'changes': int(row.get('changes') or 0),
        }
        for row in rows
    ]


def latest_revision_by_entity(
    keys, *, connection, curriculum_views_clean_str, curriculum_views_fetch_all,
    versioning_REVISIONS_TABLE, versioning_qualified,
):
    """The newest revision for each (type, id), in one read."""
    if not keys:
        return {}
    revisions_table = versioning_qualified(versioning_REVISIONS_TABLE)
    clauses = ' or '.join(['(entity_type = %s and entity_id = %s)'] * len(keys))
    params = [value for key in keys for value in key]
    columns = (
        'entity_type, entity_id, id, revision_no, action, module_catalogue_id, parent_id, '
        'title, version_label, content_status, actor_name, created_at'
    )
    if connection.vendor == 'postgresql':
        query = (
            f'select distinct on (entity_type, entity_id) {columns} from {revisions_table} '
            f'where {clauses} order by entity_type, entity_id, revision_no desc'
        )
    else:
        query = f'select {columns} from {revisions_table} where {clauses} order by revision_no'
    rows = curriculum_views_fetch_all(query, params)
    result = {}
    for row in rows:
        key = (curriculum_views_clean_str(row.get('entity_type')), curriculum_views_clean_str(row.get('entity_id')))
        existing = result.get(key)
        if existing and int(existing.get('revision_no') or 0) >= int(row.get('revision_no') or 0):
            continue
        result[key] = row
    return result


def named_version_counts(
    keys, *, curriculum_views_clean_str, curriculum_views_fetch_all, versioning_VERSIONS_TABLE,
    versioning_qualified,
):
    if not keys:
        return {}
    versions_table = versioning_qualified(versioning_VERSIONS_TABLE)
    clauses = ' or '.join(['(entity_type = %s and entity_id = %s)'] * len(keys))
    params = [value for key in keys for value in key]
    query = (
        f'select entity_type, entity_id, count(*) as total from {versions_table} '
        f'where {clauses} group by entity_type, entity_id'
    )
    try:
        rows = curriculum_views_fetch_all(query, params)
    except Exception:
        return {}
    return {
        (curriculum_views_clean_str(row.get('entity_type')), curriculum_views_clean_str(row.get('entity_id'))):
            int(row.get('total') or 0)
        for row in rows
    }
