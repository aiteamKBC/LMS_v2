"""Scoped child-table reads, week ownership SQL and grouped KSB read projections."""


from collections import Counter, defaultdict

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def authoring_child_rows_for_modules(
    table,
    module_ids,
    *,
    columns=None,
    exclude_columns=None,
    _CURRICULUM_READ_SCOPE,
    authoring_fetch_all,
    clean_str=_default_clean_str,
):
    """Rows of an authoring child table (weeks/components/mappings) for module ids.

    Inside a curriculum_read_scope() the table is read once in full and filtered
    in memory. build_programmes() asks this question once per programme and the
    union of those asks is the whole table, so N targeted round trips cost more
    than one full read. Outside a scope (single-module/week/component endpoints)
    the targeted query is kept, so one module never pulls the whole table.

    That trade depends entirely on the full read being narrow. It briefly was
    not: with ``select *`` on curriculum.components a single scan moved 39 MB
    and measured 100-175 s, which is why callers must pass ``columns`` or
    ``exclude_columns`` for that table. With settings_json excluded, one shared
    ~16 s read beats a targeted ~17 s read per programme, so the memo earns its
    keep again.

    A scope opened with ``targeted_child_reads`` asks about one scope rather than
    every programme, so the union is not the whole table and the targeted query
    stays the cheaper read. The scoped memo still applies to it: an identical
    module-id set is read once.
    """
    wanted = {clean_str(value) for value in module_ids if clean_str(value)}
    if not wanted:
        return []
    scoped = getattr(_CURRICULUM_READ_SCOPE, 'memo', None) is not None
    if not scoped or getattr(_CURRICULUM_READ_SCOPE, 'targeted_child_reads', False):
        ids = sorted(wanted)
        placeholders = ', '.join(['%s'] * len(ids))
        rows = authoring_fetch_all(
            table, f'module_catalogue_id in ({placeholders})', ids,
            columns=columns, exclude_columns=exclude_columns,
        )
    else:
        rows = [
            row for row in authoring_fetch_all(table, columns=columns, exclude_columns=exclude_columns)
            if clean_str(row.get('module_catalogue_id')) in wanted
        ]
    # Neither read has an ORDER BY, so the same request could list rows in a
    # different order each time (and miss its ETag). Sorted here, not in SQL:
    # order_sql is part of the read memo key, and the full read is shared.
    return sorted(rows, key=lambda row: (clean_str(row.get('module_catalogue_id')), clean_str(row.get('id'))))


def week_scope_module_ids(
    week_id,
    *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_WEEKS_TABLE,
    authoring_table_name,
    clean_str=_default_clean_str,
    connection,
):
    """Module ids that own week ``week_id`` or any component placed in it."""
    with connection.cursor() as cursor:
        cursor.execute(
            f'select module_catalogue_id from {authoring_table_name(AUTHORING_WEEKS_TABLE)} where id = %s'
            f' union select module_catalogue_id from {authoring_table_name(AUTHORING_COMPONENTS_TABLE)} where week_id = %s',
            [week_id, week_id],
        )
        return {clean_str(row[0]) for row in cursor.fetchall() if clean_str(row[0])}


def read_scope_children(
    module_ids,
    *,
    stats_only=False,
    mapped_components_only=False,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    AUTHORING_WEEKS_TABLE,
    COMPONENT_KSB_SCOPE_COLUMNS,
    active_component_rows,
    active_mapping_rows,
    active_week_rows,
    authoring_child_rows_for_modules,
    authoring_fetch_all,
    clean_str,
    database_vendor,
    grouped_scope_rows,
    grouped_component_counts,
):
    # Summary stats use child rows to rank duplicate module deliveries, then
    # weights/source identities only. Preserve all filter flags, without titles,
    # descriptions, schedules or other drill-down metadata.
    deletion_fields = ('status',)
    counts = None
    if stats_only and database_vendor() == 'postgresql':
        week_rows, component_rows, mapping_rows = grouped_scope_rows(module_ids)
        counts = []
        for rows in (mapping_rows, component_rows, week_rows):
            counter = Counter()
            for row in rows:
                counter[clean_str(row.get('module_catalogue_id'))] += row['_stats_count']
            counts.append(counter)
    elif mapped_components_only and database_vendor() == 'postgresql':
        week_rows = active_week_rows(authoring_child_rows_for_modules(AUTHORING_WEEKS_TABLE, module_ids))
        mapping_rows = active_mapping_rows(authoring_child_rows_for_modules(AUTHORING_KSB_MAPPINGS_TABLE, module_ids))
        mapped_ids = sorted({clean_str(row.get('component_id')) for row in mapping_rows if clean_str(row.get('component_id'))})
        component_rows = active_component_rows(authoring_fetch_all(
            AUTHORING_COMPONENTS_TABLE,
            f'module_catalogue_id in ({", ".join(["%s"] * len(module_ids))}) and id = any(%s)',
            [*module_ids, mapped_ids],
            columns=COMPONENT_KSB_SCOPE_COLUMNS,
        )) if mapped_ids else []
        counts = [
            Counter(clean_str(row.get('module_catalogue_id')) for row in mapping_rows),
            grouped_component_counts(module_ids),
            Counter(clean_str(row.get('module_catalogue_id')) for row in week_rows),
        ]
    else:
        week_rows = active_week_rows(authoring_child_rows_for_modules(
            AUTHORING_WEEKS_TABLE, module_ids,
            **({'columns': ('module_catalogue_id', *deletion_fields)} if stats_only else {}),
        ))
        component_rows = active_component_rows(authoring_child_rows_for_modules(
            AUTHORING_COMPONENTS_TABLE, module_ids,
            # Full coverage also excludes component bodies and other large JSON.
            columns=(('module_catalogue_id', 'type', 'status')
                     if stats_only else COMPONENT_KSB_SCOPE_COLUMNS),
        ))
        mapping_rows = active_mapping_rows(authoring_child_rows_for_modules(
            AUTHORING_KSB_MAPPINGS_TABLE, module_ids,
            **({'columns': ('module_catalogue_id', 'component_id', 'ksb_code', 'source_type', 'source_id', 'weight', *deletion_fields)} if stats_only else {}),
        ))

    return week_rows, component_rows, mapping_rows, counts
