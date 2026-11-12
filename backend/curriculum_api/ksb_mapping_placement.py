"""Where a KSB mapping sits in the curriculum: its component's module and week.

``curriculum.ksb_mappings`` keeps ``component_id`` (foreign key, RESTRICT) and
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

PLACEMENT_FIELDS = ('module_catalogue_id', 'week_id')

#: What a mapping read through ``relation()`` carries beyond its own columns.
READ_FIELDS = ('module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description')


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
    standards = views.authoring_table_name('standard_ksbs')
    description = ', s.ksb_description' if include_description else ''
    return (
        '(select m.*, c.module_catalogue_id, c.week_id, '
        f"coalesce(s.ksb_code, '') as ksb_code{description} "
        f'from {only}{table} m '
        f'left join {only}{components} c on c.id = m.component_id '
        f'left join {only}{standards} s on s.id = m.standard_ksb_id) as "ksb_mappings"'
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


# standard_ksbs ids -> (code, description), as last read. Reference data:
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
    """``{standard_ksbs.id: (ksb_code, ksb_description)}`` for ``standard_ids``."""
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
        standards = views.authoring_table_name('standard_ksbs')
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
    standards = views.authoring_table_name('standard_ksbs')
    with connection.cursor() as cursor:
        for chunk in _chunks(ids):
            placeholders = ', '.join(['%s'] * len(chunk))
            cursor.execute(
                f"""
                select m.component_id, m.id, m.ksb_id, m.weight, m.classification, m.source_type,
                       m.source_id, m.weight_class, s.ksb_code, s.ksb_description
                from {only}{mappings} m
                left join {only}{standards} s on s.id = m.standard_ksb_id
                where m.component_id in ({placeholders})
                  and lower(coalesce(m.status, '')) not in ('inactive', 'archived')
                order by m.component_id, s.ksb_code, m.id
                """,
                chunk,
            )
            for (component_id, mapping_id, ksb_id, weight, classification, source_type,
                 source_id, weight_class, code, description) in cursor.fetchall():
                items.setdefault(str(component_id), []).append({
                    'id': mapping_id, 'ksb_id': ksb_id or '',
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


def standard_ksb_id_for(ksb_id='', ksb_code='', programme_id='', module_catalogue_id='', source_type='', source_id=''):
    """``standard_ksbs.id`` for a mapping being written, or None when unknown.

    The mapping's own standard decides first: a component in one programme may
    carry a KSB of another standard (ST0596 codes on a Marketing Manager
    module), and the module's profile would point that code at the wrong
    standard -- or at none, failing the NOT NULL. The profile is the fallback
    for a mapping that names no standard (a framework source, or none).
    """
    with connection.cursor() as cursor:
        if ksb_id:
            cursor.execute(f'select standard_ksb_id from {_table("ksb_mappings")} where ksb_id = %s limit 1', [ksb_id])
            found = cursor.fetchone()
            if found:
                return found[0]
        code = (ksb_code or '').strip()
        if not code and ksb_id:
            return None
        reference, version = standard_reference(source_id) if (source_type or 'standard').strip().lower() == 'standard' else ('', '')
        if code and reference:
            cursor.execute(
                f'select id from {_table("standard_ksbs")} where upper(standard_ref) = %s and upper(ksb_code) = upper(%s) '
                f"order by (standard_version = %s) desc, date_updated desc nulls last, id desc limit 1",
                [reference, code, version],
            )
            found = cursor.fetchone()
            if found:
                return found[0]
        # The module's (else the programme's) KSB profile names the standard,
        # e.g. 'standard:st0845-v1-1' -> ST0845.
        profile = ''
        if module_catalogue_id:
            cursor.execute(
                f'''
                select coalesce(nullif(m.ksb_profile_source_id, ''), p.ksb_profile_source_id), m.programme_id
                from {_table("modules")} m
                left join {_table("programmes")} p on p.programme_id = m.programme_id
                where m.module_catalogue_id = %s
                ''',
                [module_catalogue_id],
            )
            found = cursor.fetchone()
            if found:
                profile, programme_id = found[0] or '', programme_id or found[1] or ''
        if not profile and programme_id:
            cursor.execute(f'select ksb_profile_source_id from {_table("programmes")} where programme_id = %s',
                           [programme_id])
            found = cursor.fetchone()
            profile = (found[0] if found else '') or ''
        reference = profile.split(':', 1)[-1].split('-v', 1)[0].upper() if profile else ''
        if not reference:
            return None
        cursor.execute(
            f'select id from {_table("standard_ksbs")} where upper(standard_ref) = %s and upper(ksb_code) = upper(%s) '
            f'order by date_updated desc nulls last, id desc limit 1',
            [reference, code],
        )
        found = cursor.fetchone()
        return found[0] if found else None


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
