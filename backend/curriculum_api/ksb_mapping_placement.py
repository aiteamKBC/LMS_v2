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
