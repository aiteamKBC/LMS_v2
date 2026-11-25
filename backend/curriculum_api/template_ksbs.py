"""Canonical reusable-template mappings; never a learner achievement source."""
from decimal import Decimal, InvalidOperation
import re
import uuid
from functools import wraps


def authoring_transaction(function):
    """Roll back the whole authoring request before reporting invalid mappings."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        from django.db import transaction
        from django.http import JsonResponse
        try:
            with transaction.atomic():
                return function(*args, **kwargs)
        except ValueError as exc:
            return JsonResponse({'error': str(exc)}, status=400)
    return wrapped


def items(cursor, component_ids):
    ids = list(component_ids)
    if not ids:
        return {}
    cursor.execute('''SELECT m.template_component_id,m.id,d.id,d.standard_ref,
        d.standard_version,d.ksb_code,d.ksb_description,m.classification,m.weight,
        m.weight_class FROM curriculum.ksb_component_mappings m
        JOIN curriculum.ksb_standard_definitions d ON d.id=m.standard_ksb_id
        WHERE m.template_component_id=ANY(%s) AND m.status='active'
        ORDER BY m.template_component_id,d.ksb_code,m.id''', [ids])
    result = {}
    for owner, mid, sid, ref, version, code, description, classification, weight, weight_class in cursor.fetchall():
        result.setdefault(owner, []).append({
            'id': mid, 'standardKsbId': sid, 'standard_ksb_id': sid,
            'code': code, 'ksb_code': code, 'description': description,
            'sourceType': 'standard', 'sourceId': f"{ref.lower()}-v{version.replace('.', '-')}",
            'classification': classification, 'weight': float(weight), 'weightClass': weight_class,
        })
    return result


def resolve(cursor, mappings, *, standard=None):
    """Validate every item before any write; exact identities, no latest fallback."""
    result = {}
    for mapping in mappings:
        if not isinstance(mapping, dict):
            raise ValueError('KSB mappings must be objects.')
        source_type = str(mapping.get('sourceType') or mapping.get('source_type') or 'standard').lower()
        if source_type != 'standard':
            raise ValueError('Template KSB mappings require official standards.')
        sid = mapping.get('standardKsbId') or mapping.get('standard_ksb_id')
        source = str(mapping.get('sourceId') or mapping.get('source_id') or '')
        match = re.fullmatch(r'(?:standard:)?(st\d+)-v(\d+(?:-\d+)*)', source, re.I)
        pair = (match[1].upper(), match[2].replace('-', '.')) if match else standard
        if source and not match:
            raise ValueError('KSB mapping requires an official versioned standard.')
        if standard and pair and pair != standard:
            raise ValueError('KSB mapping is incompatible with the destination standard.')
        code = str(mapping.get('code') or mapping.get('ksb_code') or '').strip().upper()
        if sid:
            try:
                sid = int(str(sid))
            except (ValueError, TypeError):
                raise ValueError('Official KSB identity must be an integer.') from None
            cursor.execute('SELECT id,standard_ref,standard_version,ksb_code FROM curriculum.ksb_standard_definitions WHERE id=%s', [sid])
        elif pair and code:
            cursor.execute('''SELECT id,standard_ref,standard_version,ksb_code
                FROM curriculum.ksb_standard_definitions
                WHERE standard_ref=%s AND standard_version=%s AND ksb_code=%s''', [*pair, code])
        else:
            raise ValueError('KSB mapping requires an official identity or exact standard and code.')
        found = cursor.fetchall()
        if len(found) != 1:
            raise ValueError('Official KSB definition not found.')
        sid, ref, version, official_code = found[0]
        if (pair and pair != (ref, version)) or (code and code != official_code):
            raise ValueError('KSB identity does not match its standard or code.')
        try:
            weight = Decimal(str(mapping.get('weight')))
        except (InvalidOperation, ValueError, TypeError):
            raise ValueError('KSB weight must be positive.') from None
        if not weight.is_finite() or weight <= 0 or weight > Decimal('999.99'):
            raise ValueError('KSB weight must be positive.')
        classification = mapping.get('classification') or 'secondary'
        weight_class = mapping.get('weightClass') or mapping.get('weight_class') or 'soft'
        if weight_class not in {'hard', 'soft', 'possible'}:
            raise ValueError('Invalid KSB weight class.')
        value = (sid, classification, weight, weight_class, f"{ref.lower()}-v{version.replace('.', '-')}")
        if sid in result and result[sid] != value:
            raise ValueError('Conflicting duplicate KSB mapping.')
        result[sid] = value
    return list(result.values())


def replace(cursor, component_id, mappings, *, standard=None):
    """Called inside the template transaction, after locking its header row."""
    desired = resolve(cursor, mappings, standard=standard)
    cursor.execute('''SELECT id FROM curriculum.week_template_components
        WHERE id=%s FOR UPDATE''', [component_id])
    if not cursor.fetchone():
        raise ValueError('Template component not found.')
    cursor.execute('''UPDATE curriculum.ksb_component_mappings SET status='inactive',updated_at=now()
        WHERE template_component_id=%s AND status='active'
          AND NOT (standard_ksb_id=ANY(%s::bigint[]))''', [component_id, [r[0] for r in desired]])
    for sid, classification, weight, weight_class, source in desired:
        cursor.execute('''INSERT INTO curriculum.ksb_component_mappings
            (id,component_id,template_component_id,standard_ksb_id,classification,weight,
             weight_class,source_type,source_id,status,created_at,updated_at)
            VALUES (%s,NULL,%s,%s,%s,%s,%s,'standard',%s,'active',now(),now())
            ON CONFLICT (template_component_id,standard_ksb_id) DO UPDATE SET
                classification=excluded.classification,weight=excluded.weight,
                weight_class=excluded.weight_class,source_type=excluded.source_type,
                source_id=excluded.source_id,status='active',updated_at=now()''',
            [f'KSBMAP-{uuid.uuid4().hex}', component_id, sid, classification, weight, weight_class, source])
