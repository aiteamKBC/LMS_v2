"""Normalized KSB placement queries and reference-text reads."""


def where(
    module_ids=None, week_id=None, component_ids=None, *, AUTHORING_COMPONENTS_TABLE, authoring_table_name,
    clean_str,
):
    """``(where_sql, params)`` selecting mappings by placement.

    ``module_ids`` is one id or a list; ``week_id`` narrows to one week;
    ``component_ids`` narrows to those components (and is enough on its own).
    Every argument given must match.
    """
    if isinstance(module_ids, str):
        module_ids = [module_ids]
    module_ids = [clean_str(value) for value in (module_ids or []) if clean_str(value)]
    component_ids = [clean_str(value) for value in (component_ids or []) if clean_str(value)]
    week_id = clean_str(week_id)

    clauses, params = [], []
    owner, owner_params = [], []
    if module_ids:
        owner.append(f'c.module_catalogue_id in ({", ".join(["%s"] * len(module_ids))})')
        owner_params += module_ids
    if week_id:
        owner.append('c.week_id = %s')
        owner_params.append(week_id)
    if owner:
        components = authoring_table_name(AUTHORING_COMPONENTS_TABLE)
        clauses.append(f'component_id in (select c.id from {components} c where {" and ".join(owner)})')
        params += owner_params
    if component_ids:
        clauses.append(f'component_id in ({", ".join(["%s"] * len(component_ids))})')
        params += component_ids
    return ' and '.join(clauses) or '1 = 0', params


def relation(
    *, include_description=True, AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE, _only,
    authoring_table_name,
):
    """FROM text for a read that wants each mapping with its placement and code.

    ``module_catalogue_id`` / ``week_id`` come from the component and
    ``ksb_code`` / ``ksb_description`` from the standard KSB; the mapping's own
    columns are unchanged. ``include_description=False`` leaves the description
    out: it is the standard's text repeated on every mapping (2.5 MB of a 6 MB
    programme read), so a caller that needs it attaches it afterwards
    (``attach_descriptions``).
    """
    only = _only()
    table = authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)
    components = authoring_table_name(AUTHORING_COMPONENTS_TABLE)
    standards = authoring_table_name('ksb_standard_definitions')
    description = ', s.ksb_description' if include_description else ''
    return (
        f'(select m.*, {standard_ksb_compatibility_id_sql("s")} as ksb_id, c.module_catalogue_id, c.week_id, '
        f"coalesce(s.ksb_code, '') as ksb_code{description} "
        f'from {only}{table} m '
        f'left join {only}{components} c on c.id = m.component_id '
        f'left join {only}{standards} s on s.id = m.standard_ksb_id '
        f'where m.component_id is not null) as "ksb_mappings"'
    )


def standard_ksb_texts(
    standard_ids, *, STANDARD_TEXTS_TTL_SECONDS, _STANDARD_TEXTS, _STANDARD_TEXTS_LOCK, _chunks, _only,
    authoring_table_name, connection, time,
):
    """``{ksb_standard_definitions.id: (ksb_code, ksb_description)}`` for ``standard_ids``."""
    from django.db import connection
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
        standards = authoring_table_name('ksb_standard_definitions')
        with connection.cursor() as cursor:
            for chunk in _chunks(missing):
                placeholders = ', '.join(['%s'] * len(chunk))
                cursor.execute(
                    f'select id, ksb_code, ksb_description from {_only()}{standards} where id in ({placeholders})',
                    chunk,
                )
                found.update({sid: (code, description) for sid, code, description in cursor.fetchall()})
        with _STANDARD_TEXTS_LOCK:
            known.update(found)
    return {value: known[value] for value in wanted if value in known}


def component_items(
    component_ids, *, AUTHORING_KSB_MAPPINGS_TABLE, _chunks, _only, authoring_table_name, connection,
):
    """``{component_id: [mapping item, ...]}``: each component's live KSB mappings."""
    from django.db import connection
    items = {}
    ids = [str(value) for value in component_ids if value]
    if not ids:
        return items
    only = _only()
    mappings = authoring_table_name(AUTHORING_KSB_MAPPINGS_TABLE)
    standards = authoring_table_name('ksb_standard_definitions')
    with connection.cursor() as cursor:
        for chunk in _chunks(ids):
            placeholders = ', '.join(['%s'] * len(chunk))
            cursor.execute(
                f"""
                select m.component_id, m.id, {standard_ksb_compatibility_id_sql("s")}, m.weight, m.classification, m.source_type,
                       m.source_id, m.weight_class, s.ksb_code, s.ksb_description, m.standard_ksb_id
                from {only}{mappings} m
                left join {only}{standards} s on s.id = m.standard_ksb_id
                where m.component_id in ({placeholders})
                  and lower(coalesce(m.status, '')) not in ('inactive', 'archived')
                order by m.component_id, s.ksb_code, m.id
                """,
                chunk,
            )
            for (component_id, mapping_id, ksb_id, weight, classification, source_type,
                 source_id, weight_class, code, description, *official_id) in cursor.fetchall():
                items.setdefault(str(component_id), []).append({
                    'id': mapping_id, 'ksb_id': ksb_id or '',
                    **({'standard_ksb_id': official_id[0]} if official_id else {}),
                    'weight': float(weight) if weight is not None else None,
                    'ksb_code': code or '', 'source_id': source_id or '',
                    'description': description or '', 'source_type': source_type or '',
                    'weight_class': weight_class or '', 'classification': classification or '',
                })
    return items

from curriculum_api.canonical_read_sql import standard_ksb_compatibility_id_sql, standard_source_sql, ksb_physical_table
