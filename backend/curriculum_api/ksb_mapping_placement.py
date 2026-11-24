"""Where a KSB mapping sits in the curriculum: its component's module and week.

``curriculum.ksb_component_mappings`` keeps ``component_id`` (foreign key, RESTRICT) and
``standard_ksb_id``. Its module and week are its component's, and its code and
description its standard KSB's. A write that scopes mappings by module or week
therefore scopes them through their component, and a read that wants the
placement or the code joins them from there.
"""
from __future__ import annotations

import re
import threading
import time
import uuid
from datetime import datetime, timezone

from django.db import connection
from .canonical_read_sql import standard_ksb_compatibility_id_sql, standard_source_sql

PLACEMENT_FIELDS = ('module_catalogue_id', 'week_id')

#: What a mapping read through ``relation()`` carries beyond its own columns.
READ_FIELDS = ('module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description', 'ksb_id')


def _only():
    """``only`` before a table on PostgreSQL (these tables have no inheritance,
    so it reads exactly the same rows); nothing elsewhere."""
    return 'only ' if connection.vendor == 'postgresql' else ''


def where(module_ids=None, week_id=None, component_ids=None):
    """``(where_sql, params)`` selecting mappings by placement.

    ``module_ids`` is one id or a list; ``week_id`` narrows to one week;
    ``component_ids`` narrows to those components (and is enough on its own).
    Every argument given must match.
    """
    from . import views
    if isinstance(module_ids, str):
        module_ids = [module_ids]
    module_ids = [views.clean_str(value) for value in (module_ids or []) if views.clean_str(value)]
    component_ids = [views.clean_str(value) for value in (component_ids or []) if views.clean_str(value)]
    week_id = views.clean_str(week_id)

    clauses, params = [], []
    owner, owner_params = [], []
    if module_ids:
        owner.append(f'c.module_catalogue_id in ({", ".join(["%s"] * len(module_ids))})')
        owner_params += module_ids
    if week_id:
        owner.append('c.week_id = %s')
        owner_params.append(week_id)
    if owner:
        components = views.authoring_table_name(views.AUTHORING_COMPONENTS_TABLE)
        clauses.append(f'component_id in (select c.id from {components} c where {" and ".join(owner)})')
        params += owner_params
    if component_ids:
        clauses.append(f'component_id in ({", ".join(["%s"] * len(component_ids))})')
        params += component_ids
    return ' and '.join(clauses) or '1 = 0', params


def relation(*, include_description=True):
    """FROM text for a read that wants each mapping with its placement and code.

    ``module_catalogue_id`` / ``week_id`` come from the component and
    ``ksb_code`` / ``ksb_description`` from the standard KSB; the mapping's own
    columns are unchanged. ``include_description=False`` leaves the description
    out: it is the standard's text repeated on every mapping (2.5 MB of a 6 MB
    programme read), so a caller that needs it attaches it afterwards
    (``attach_descriptions``).
    """
    from . import views
    only = _only()
    table = views.authoring_table_name(views.AUTHORING_KSB_MAPPINGS_TABLE)
    components = views.authoring_table_name(views.AUTHORING_COMPONENTS_TABLE)
    standards = views.authoring_table_name('ksb_standard_definitions')
    description = ', s.ksb_description' if include_description else ''
    return (
        f'(select m.*, {standard_ksb_compatibility_id_sql("s")} as ksb_id, c.module_catalogue_id, c.week_id, '
        f"coalesce(s.ksb_code, '') as ksb_code{description} "
        f'from {only}{table} m '
        f'left join {only}{components} c on c.id = m.component_id '
        f'left join {only}{standards} s on s.id = m.standard_ksb_id '
        f'where m.component_id is not null) as "ksb_mappings"'
    )


def read_source(table):
    """FROM text for a hand-written read of ``table``: mappings through
    ``relation()`` (placement and code by key), any other table as itself."""
    from . import views
    if table == views.AUTHORING_KSB_MAPPINGS_TABLE:
        return relation()
    return views.authoring_table_name(table)


def read_columns(table):
    """The columns a read through ``read_source(table)`` can select."""
    from . import views
    columns = set(views.column_names(table))
    if table == views.AUTHORING_KSB_MAPPINGS_TABLE:
        columns |= set(READ_FIELDS)
    return columns


def can_select(table, column):
    """Whether a read through ``read_source(table)`` can select ``column``."""
    from . import views
    if views.has_column(table, column):
        return True
    return column in READ_FIELDS and table == views.AUTHORING_KSB_MAPPINGS_TABLE


# ksb_standard_definitions ids -> (code, description), as last read. Reference data:
# changed only by a manual Skills England import, which the curriculum cache
# already lets lag by up to 60 s (views.coverage_entry), so this lags no more.
STANDARD_TEXTS_TTL_SECONDS = 60
_STANDARD_TEXTS = {'read_at': 0.0, 'rows': {}}
_STANDARD_TEXTS_LOCK = threading.Lock()


def _chunks(values, size=2000):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def standard_ksb_texts(standard_ids):
    """``{ksb_standard_definitions.id: (ksb_code, ksb_description)}`` for ``standard_ids``."""
    from django.db import connection
    from . import views
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
        standards = views.authoring_table_name('ksb_standard_definitions')
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


def reset_standard_ksb_texts():
    with _STANDARD_TEXTS_LOCK:
        _STANDARD_TEXTS.update(read_at=0.0, rows={})


def component_items(component_ids):
    """``{component_id: [mapping item, ...]}``: each component's live KSB mappings."""
    from django.db import connection
    from . import views
    items = {}
    ids = [str(value) for value in component_ids if value]
    if not ids:
        return items
    only = _only()
    mappings = views.authoring_table_name(views.AUTHORING_KSB_MAPPINGS_TABLE)
    standards = views.authoring_table_name('ksb_standard_definitions')
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


def attach_component_items(rows):
    """Put each component's KSB items on it as ``ksb_mappings``."""
    items = component_items({row.get('id') for row in rows})
    for row in rows:
        row.setdefault('ksb_mappings', items.get(str(row.get('id')), []))
    return rows


def attach_descriptions(rows):
    """Put each mapping's standard KSB description on it (read once per standard)."""
    texts = standard_ksb_texts(row.get('standard_ksb_id') for row in rows)
    for row in rows:
        row.setdefault('ksb_description', texts.get(row.get('standard_ksb_id'), ('', None))[1])
    return rows


# ---------------------------------------------------------------------------
# Writes: which standard KSB a mapping carries, and which stored row it is.
# ---------------------------------------------------------------------------

def _table(name):
    from . import views
    return f'{_only()}{views.authoring_table_name(name)}'


def standard_reference(source_id):
    """``('ST0596', '1.0')`` for a standard source id (``st0596-v1-0``,
    ``standard:st0596-v1-0``); ``('ST0596', '')`` without a version; ``('', '')``
    for anything else (a framework id such as ``KSBP-...``)."""
    value = (source_id or '').strip().split(':', 1)[-1]
    match = re.fullmatch(r'(st\d+)(?:-v(\d+(?:-\d+)*))?', value, re.IGNORECASE)
    if not match:
        return '', ''
    return match.group(1).upper(), (match.group(2) or '').replace('-', '.')


def standard_ksb_id_for(ksb_id='', ksb_code='', programme_id='', module_catalogue_id='', source_type='', source_id='', standard_ksb_id=None, component_id=''):
    """Resolve an exact version, never silently choosing a newer definition.

    Explicit sources must match the destination programme. A component's actual
    module takes precedence over client-supplied placement information.
    """
    if source_type and source_type.strip().lower() != 'standard':
        return None
    with connection.cursor() as cursor:
        if component_id:
            cursor.execute(f'SELECT module_catalogue_id FROM {_table("components")} WHERE id=%s', [component_id])
            owner = cursor.fetchone()
            if not owner or not owner[0] or (module_catalogue_id and module_catalogue_id != owner[0]):
                return None
            module_catalogue_id = owner[0]
        reference, version = standard_reference(source_id) if (source_type or 'standard').strip().lower() == 'standard' else ('', '')
        if standard_ksb_id is not None:
            try:
                standard_ksb_id = int(str(standard_ksb_id))
            except (ValueError, TypeError):
                return None
            cursor.execute(f'SELECT standard_ref,standard_version,ksb_code FROM {_table("ksb_standard_definitions")} WHERE id=%s', [standard_ksb_id])
            definition = cursor.fetchone()
            if not definition:
                return None
            if source_id and (reference, version) != tuple(definition[:2]):
                return None
            if ksb_code and ksb_code.strip().upper() != definition[2].strip().upper():
                return None
            reference, version, ksb_code = definition
        if source_id and (source_type or 'standard').strip().lower() == 'standard' and not (reference and version):
            return None
        if not reference:
            profile = ''
            if module_catalogue_id:
                cursor.execute(f'''select {standard_source_sql('p')}
                    from {_table("modules")} m left join {_table("programmes")} p on p.programme_id=m.programme_id
                    where m.module_catalogue_id=%s''', [module_catalogue_id])
                found = cursor.fetchone()
                profile = found[0] if found else ''
            if not profile and programme_id:
                cursor.execute(f"select {standard_source_sql('p')} from {_table('programmes')} p where programme_id=%s", [programme_id])
                found = cursor.fetchone()
                profile = found[0] if found else ''
            reference, version = standard_reference(profile)
        if not reference or not version:
            return None
        if module_catalogue_id:
            cursor.execute(f'''select p.standard_ref,p.standard_version
                from {_table("modules")} m join {_table("programmes")} p on p.programme_id=m.programme_id
                where m.module_catalogue_id=%s''', [module_catalogue_id])
            destination = cursor.fetchone()
            if not destination or tuple(destination) != (reference, version):
                return None
        code = (ksb_code or '').strip()
        if code:
            cursor.execute(f'''select id from {_table("ksb_standard_definitions")}
                where upper(standard_ref)=%s and standard_version=%s and upper(ksb_code)=upper(%s)''',
                [reference, version, code])
        elif ksb_id and module_catalogue_id:
            cursor.execute(f'''select distinct s.id from {_table("ksb_mappings")} k
                join {_table("ksb_standard_definitions")} s on s.id=k.standard_ksb_id
                join {_table("components")} c on c.id=k.component_id
                where ({standard_ksb_compatibility_id_sql("s")})=%s and c.module_catalogue_id=%s
                    and upper(s.standard_ref)=%s and s.standard_version=%s''',
                [ksb_id, module_catalogue_id, reference, version])
        else:
            return None
        found = cursor.fetchall()
        return found[0][0] if len(found) == 1 else None


def reuse_mapping_rows(payloads):
    """Fit ``ksb_mappings`` payloads to UNIQUE (component_id, standard_ksb_id).

    The constraint covers archived rows too. Taking a KSB off a component
    archives its row, and putting it back arrives with a newly minted id, so
    the insert collided with the archived row (500). Each payload now takes
    the id of the row this component already holds for that KSB: the upsert
    then reactivates and updates that row, keeping its history, instead of
    inserting a second one. If another payload in the batch keeps that id as
    its own (its row is being moved to a different KSB), that payload gets a
    new id, so the two never write one row. A KSB listed twice for the same
    component in one batch keeps its first entry, as normalise_component_ksb_mappings
    does for a repeated code. PostgreSQL only (the constraint's home).
    """
    keyed = [payload for payload in payloads if payload.get('component_id') and payload.get('standard_ksb_id') is not None]
    if not keyed or connection.vendor != 'postgresql':
        return payloads
    component_ids = sorted({str(payload['component_id']) for payload in keyed})
    with connection.cursor() as cursor:
        cursor.execute(
            f'select component_id, standard_ksb_id, id from {_table("ksb_mappings")} where component_id = any(%s)',
            [component_ids],
        )
        stored = {(str(component_id), standard_id): str(row_id) for component_id, standard_id, row_id in cursor.fetchall()}
        supplied_ids = [str(payload['id']) for payload in keyed if payload.get('id')]
        cursor.execute(
            f'select id, component_id from {_table("ksb_mappings")} where id = any(%s)',
            [supplied_ids],
        )
        owners = {str(row_id): str(component_id or '') for row_id, component_id in cursor.fetchall()}
    # A copied template (or placed component) must never move the source row.
    payloads = [
        {**payload, 'id': f'KSBMAP-{uuid.uuid4().hex.upper()}'}
        if str(payload.get('id')) in owners
        and owners[str(payload['id'])] != str(payload.get('component_id') or '')
        else payload
        for payload in payloads
    ]
    own_ids = {str(payload.get('id')) for payload in payloads if payload.get('id')}
    seen, result, renamed = set(), [], {}
    for payload in payloads:
        key = (str(payload.get('component_id') or ''), payload.get('standard_ksb_id'))
        if not key[0] or key[1] is None:
            result.append(payload)
            continue
        if key in seen:
            continue
        seen.add(key)
        stored_id = stored.get(key)
        if stored_id and stored_id != str(payload.get('id')):
            if stored_id in own_ids:
                renamed[stored_id] = f'KSBMAP-{datetime.now(timezone.utc):%Y%m%d%H%M%S%f}{uuid.uuid4().hex[:8].upper()}'
            payload = {**payload, 'id': stored_id}
        result.append(payload)
    if renamed:
        # The payload whose own id was taken over keeps its content under a new id.
        result = [
            {**payload, 'id': renamed[str(payload['id'])]}
            if str(payload.get('id')) in renamed and stored.get((str(payload.get('component_id') or ''), payload.get('standard_ksb_id'))) != str(payload['id'])
            else payload
            for payload in result
        ]
    return result
