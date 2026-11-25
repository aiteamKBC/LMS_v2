"""Enrich normalized rows using explicit lookup and cache capabilities."""


def project_rows(
    table, rows, columns, *, requested=None, excluded=None, DERIVED_COLUMNS, RELATION_TABLES, _lifecycle_fields,
    _project_components, _project_ksb_mappings, _wanted, is_normalised, uses_status_lifecycle,
):
    """Add the legacy keys the code still reads to rows of the normalised schema.

    ``columns`` is the table's real column set; ``requested`` the caller's
    narrowed column list (None for ``select *``); ``excluded`` its exclusions.
    Mutates and returns ``rows``. A no-op on the legacy schema.
    """
    if not rows or table not in RELATION_TABLES:
        return rows
    columns = set(columns or ())
    if not is_normalised(table, columns):
        return rows
    requested = set(requested) if requested else None
    # Keys the read relation already supplied are left alone: only what is
    # still missing (components' ksb_mappings JSON, rows read another way) is derived.
    present = set(rows[0])
    want = lambda key: key not in present and _wanted(key, columns, requested, excluded)  # noqa: E731

    if uses_status_lifecycle(table, columns) and 'status' in rows[0]:
        lifecycle_keys = [key for key in ('is_programme_deleted', 'deleted_at', 'deleted_by',
                                          'deleted_via_parent', 'is_archived', 'is_active') if want(key)]
        if lifecycle_keys:
            for row in rows:
                for key, value in _lifecycle_fields(table, row).items():
                    if key in lifecycle_keys:
                        row.setdefault(key, value)

    derived = [key for key in DERIVED_COLUMNS.get(table, ()) if want(key)]
    if not derived:
        return rows
    if table == 'ksb_mappings':
        _project_ksb_mappings(rows, derived)
    elif table == 'components':
        _project_components(rows, derived)
    elif table == 'weeks':
        for row in rows:
            for key in derived:
                if key == 'library_state':
                    row.setdefault(key, '')
                else:
                    row.setdefault(key, None if key == 'detached_at' else '')
    return rows


def standard_ksb_texts(
    standard_ids, *, STANDARD_TEXTS_TTL_SECONDS, _STANDARD_TEXTS, _STANDARD_TEXTS_LOCK, _chunks, _internal,
    connection, time,
):
    """``{ksb_standard_definitions.id: (ksb_code, ksb_description)}`` for ``standard_ids``."""
    wanted = {value for value in standard_ids if value is not None}
    if not wanted:
        return {}
    with _STANDARD_TEXTS_LOCK:
        if time.monotonic() - _STANDARD_TEXTS['read_at'] > STANDARD_TEXTS_TTL_SECONDS:
            _STANDARD_TEXTS.update(read_at=time.monotonic(), rows={})
        known = _STANDARD_TEXTS['rows']
        missing = wanted - known.keys()
    if missing:
        found = {}
        with connection.cursor() as cursor:
            for chunk in _chunks(missing):
                cursor.execute(f'select id, ksb_code, ksb_description from {_internal("ksb_standard_definitions")} where id = any(%s)', [chunk])
                found.update({sid: (code, description) for sid, code, description in cursor.fetchall()})
        with _STANDARD_TEXTS_LOCK:
            known.update(found)
    return {value: known[value] for value in wanted if value in known}


def _project_ksb_mappings(rows, derived, *, _chunks, _internal, connection, standard_ksb_texts):
    placements, standards = {}, {}
    if {'module_catalogue_id', 'week_id'} & set(derived):
        component_ids = {str(row.get('component_id')) for row in rows if row.get('component_id')}
        with connection.cursor() as cursor:
            for chunk in _chunks(component_ids):
                cursor.execute(f'select id, module_catalogue_id, week_id from {_internal("components")} where id = any(%s)', [chunk])
                placements.update({cid: (module_id, week_id) for cid, module_id, week_id in cursor.fetchall()})
    if {'ksb_code', 'ksb_description'} & set(derived):
        standards = standard_ksb_texts(row.get('standard_ksb_id') for row in rows)
    identifiers = {}
    if 'ksb_id' in derived:
        with connection.cursor() as cursor:
            for chunk in _chunks({r.get('standard_ksb_id') for r in rows if r.get('standard_ksb_id')}):
                cursor.execute(f'select s.id,{standard_ksb_compatibility_id_sql("s")} from {_internal("ksb_standard_definitions")} s where s.id=any(%s)', [chunk])
                identifiers.update(cursor.fetchall())
    for row in rows:
        module_id, week_id = placements.get(str(row.get('component_id')), (None, None))
        code, description = standards.get(row.get('standard_ksb_id'), ('', ''))
        values = {'ksb_id': identifiers.get(row.get('standard_ksb_id'), ''),
                  'module_catalogue_id': module_id or '', 'week_id': week_id,
                  'ksb_code': code or '', 'ksb_description': description}
        for key in derived:
            row.setdefault(key, values[key])


def component_mapping_items(component_ids, *, _chunks, _internal, active_condition, connection):
    """``{component_id: [mapping item, ...]}`` in the shape of the old JSON copy."""
    items = {}
    ids = [str(value) for value in component_ids if value]
    if not ids:
        return items
    with connection.cursor() as cursor:
        for chunk in _chunks(ids):
            cursor.execute(
                f'''
                select m.component_id, m.id, {standard_ksb_compatibility_id_sql("s")}, m.weight, m.classification, m.source_type,
                       m.source_id, m.weight_class, s.ksb_code, s.ksb_description, m.standard_ksb_id
                from {_internal("ksb_mappings")} m
                left join {_internal("ksb_standard_definitions")} s on s.id = m.standard_ksb_id
                where m.component_id = any(%s) and {active_condition("m")}
                order by m.component_id, s.ksb_code, m.id
                ''',
                [chunk],
            )
            for (component_id, mapping_id, ksb_id, weight, classification, source_type,
                 source_id, weight_class, code, description, *official_id) in cursor.fetchall():
                items.setdefault(component_id, []).append({
                    'id': mapping_id, 'ksb_id': ksb_id or '',
                    **({'standard_ksb_id': official_id[0]} if official_id else {}),
                    'weight': float(weight) if weight is not None else None,
                    'ksb_code': code or '', 'source_id': source_id or '',
                    'description': description or '', 'source_type': source_type or '',
                    'weight_class': weight_class or '', 'classification': classification or '',
                })
    return items


def _project_components(rows, derived, *, component_mapping_items):
    if 'ksb_mappings' in derived:
        items = component_mapping_items({row.get('id') for row in rows})
        for row in rows:
            row.setdefault('ksb_mappings', items.get(str(row.get('id')), []))
    for row in rows:
        for key in derived:
            if key == 'ksb_mappings':
                continue
            row.setdefault(key, None if key == 'detached_at' else '')

from curriculum_api.canonical_read_sql import standard_ksb_compatibility_id_sql, standard_source_sql, ksb_physical_table
