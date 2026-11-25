"""Compatibility exports for KSB reads, plus the existing mapping writers."""
from __future__ import annotations
import re
import uuid
from datetime import datetime, timezone
from django.db import connection
from .catalogue.infrastructure.ksb_read_store import (
    PLACEMENT_FIELDS,
    READ_FIELDS,
    STANDARD_TEXTS_TTL_SECONDS,
    _STANDARD_TEXTS,
    _STANDARD_TEXTS_LOCK,
    _only,
    where,
    relation,
    read_source,
    read_columns,
    can_select,
    _chunks,
    standard_ksb_texts,
    reset_standard_ksb_texts,
    component_items,
    attach_component_items,
    attach_descriptions,
)


# ---------------------------------------------------------------------------
# Writes: which standard KSB a mapping carries, and which stored row it is.
# ---------------------------------------------------------------------------

def _table(name):
    from .catalogue.infrastructure.database_reads import authoring_table_name
    return f'{_only()}{authoring_table_name(name)}'


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

from curriculum_api.canonical_read_sql import standard_ksb_compatibility_id_sql, standard_source_sql, ksb_physical_table
