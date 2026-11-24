"""Canonical Progress synchronization for the native Extra Activity store."""
import json
from decimal import Decimal, InvalidOperation

from django.core.serializers.json import DjangoJSONEncoder

from old_otjh.service import ServiceError

from .ksb_definition_links import assigned_definition_ids, attach_definition_ids


SOURCE_SYSTEM = 'extra_activities'


def _json(value):
    return json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True, separators=(',', ':'))


def _payload(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
            return decoded if isinstance(decoded, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _activity_document(activity):
    stored = _payload(activity.get('reflection_payload'))
    document = stored.get('full_submission')
    return document if isinstance(document, dict) else stored


def _reporting_month(activity):
    document = _activity_document(activity)
    monthly = document.get('monthlyAssignment')
    selected = monthly.get('month') if isinstance(monthly, dict) else None
    from .extra_activity_month import valid_activity_month
    return selected if valid_activity_month(selected) else activity['activity_date'].strftime('%Y-%m')


def _source_payload(activity):
    result = {
        'extra_activity_id': str(activity['id']),
        'activity_date': activity['activity_date'].isoformat(),
        'approved_minutes': activity.get('approved_minutes'),
        'reviewed_by': activity.get('reviewed_by') or '',
        'reviewed_at': activity['reviewed_at'].isoformat() if activity.get('reviewed_at') else None,
    }
    if activity.get('source_reflection_id'):
        result['original_source_ref'] = f"reflection:{activity['source_reflection_id']}"
    return result


def _weight(value):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _ksbs(document):
    codes = document.get('ksbCodes') or document.get('ksb_codes') or []
    weights = document.get('ksbWeights') or document.get('ksb_weights') or {}
    if not isinstance(codes, list):
        return []
    if not isinstance(weights, dict):
        weights = {}
    result = []
    seen = set()
    for value in codes:
        code = str(value or '').strip().upper()
        if not code or code in seen:
            continue
        seen.add(code)
        result.append((code, _weight(weights.get(code))))
    return result


def _sync_ksbs(cursor, progress_id, activity_id, learner_id, document):
    expected = [
        {
            'position': position,
            'ksb_code': code,
            'ksb_description': '',
            'source_type': 'extra_activity',
            'source_id': str(activity_id),
            'classification': '',
            'weight': weight,
            'weight_class': '',
        }
        for position, (code, weight) in enumerate(_ksbs(document), 1)
    ]
    cursor.execute('''SELECT position,ksb_code,ksb_definition_id,ksb_description,
            source_type,source_id,classification,weight,weight_class
        FROM "Learner".learner_progress_ksbs
        WHERE progress_id=%s ORDER BY position''', [progress_id])
    columns = ('position', 'ksb_code', 'ksb_definition_id', 'ksb_description',
               'source_type', 'source_id', 'classification', 'weight', 'weight_class')
    current = [dict(zip(columns, row)) for row in cursor.fetchall()]
    definition_ids = assigned_definition_ids(cursor, [learner_id], expected)
    expected = attach_definition_ids(
        expected, learner_id, definition_ids, existing=current,
    )
    if current == expected:
        return False
    cursor.execute('DELETE FROM "Learner".learner_progress_ksbs WHERE progress_id=%s', [progress_id])
    for row in expected:
        cursor.execute('''INSERT INTO "Learner".learner_progress_ksbs
            (progress_id,position,ksb_code,ksb_definition_id,ksb_description,source_type,source_id,
             classification,weight,weight_class)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', [
                progress_id, row['position'], row['ksb_code'], row['ksb_definition_id'],
                row['ksb_description'], row['source_type'], row['source_id'],
                row['classification'], row['weight'], row['weight_class'],
            ])
    return True


def _sync_evidence(cursor, activity, progress_id):
    """Attach this activity's existing uploads without stealing other lineage."""
    section_ref = f"extra:{activity['id']}"
    cursor.execute('''SELECT id,progress_entry_id FROM "Learner".evidence_files
        WHERE learner_profile_id=%s AND learner_kind=%s AND section_ref=%s
        FOR UPDATE''', [activity['learner_id'], activity['learner_kind'], section_ref])
    files = cursor.fetchall()
    if any(link not in (None, progress_id) for _, link in files):
        raise ServiceError('Extra Activity evidence links to different Progress.',
                           'progress_identity_conflict', 409)
    if not any(link is None for _, link in files):
        return False
    cursor.execute('''UPDATE "Learner".evidence_files SET progress_entry_id=%s
        WHERE learner_profile_id=%s AND learner_kind=%s AND section_ref=%s
          AND progress_entry_id IS NULL''', [
            progress_id, activity['learner_id'], activity['learner_kind'], section_ref,
        ])
    return cursor.rowcount > 0


def _existing_progress(cursor, activity):
    source_id = f"extra:{activity['id']}"
    canonical_key = f"extra_activities:{activity['id']}"
    cursor.execute('''SELECT id,learner_id,accepted,actual_seconds,reporting_month,
            activity_status,source_system,source_activity_id,canonical_activity_key,
            source_payload,deleted_at
        FROM "Learner".learner_progress_entries
        WHERE deleted_at IS NULL AND (
            id=%s OR (source_system=%s AND source_activity_id=%s)
            OR canonical_activity_key=%s)
        ORDER BY CASE WHEN id=%s THEN 0 ELSE 1 END,id FOR UPDATE''', [
            activity.get('progress_entry_id'), SOURCE_SYSTEM,
            source_id, canonical_key, activity.get('progress_entry_id'),
        ])
    columns = [item[0] for item in cursor.description]
    rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
    if len(rows) > 1 or any(int(row['learner_id']) != int(activity['learner_id']) for row in rows):
        raise ServiceError('This Extra Activity has conflicting Progress links.',
                           'progress_identity_conflict', 409)
    if not rows and activity.get('progress_entry_id') is not None:
        cursor.execute('''SELECT learner_id,deleted_at FROM "Learner".learner_progress_entries
            WHERE id=%s FOR UPDATE''', [activity['progress_entry_id']])
        linked = cursor.fetchone()
        if linked is not None:
            raise ServiceError('This Extra Activity has conflicting Progress links.',
                               'progress_identity_conflict', 409)
    return rows[0] if rows else None


def sync_locked_activity(cursor, activity, owner):
    """Synchronize one already locked Extra Activity inside the caller transaction."""
    if int(owner['id']) != int(activity['learner_id']) or owner.get('learner_type') != activity.get('learner_kind'):
        raise ServiceError('The canonical learner identity needs review.',
                           'identity_review_required', 409)
    cursor.execute('''SELECT id,enrolment_id,learner_type FROM "Learner".learners
        WHERE id=%s FOR UPDATE''', [activity['learner_id']])
    identity = cursor.fetchall()
    if len(identity) != 1 or int(identity[0][1]) != int(owner['enrolment_id']) \
            or identity[0][2] != owner['learner_type']:
        raise ServiceError('The canonical learner identity needs review.',
                           'identity_review_required', 409)

    existing = _existing_progress(cursor, activity)
    approved = activity['status'] == 'approved'
    if approved and not isinstance(activity.get('approved_minutes'), int):
        raise ServiceError('Approved Extra Activity minutes are invalid.',
                           'invalid_approved_duration', 409)
    if approved and not 1 <= activity['approved_minutes'] <= activity['requested_minutes']:
        raise ServiceError('Approved Extra Activity minutes are invalid.',
                           'invalid_approved_duration', 409)
    seconds = int(activity['approved_minutes'] or 0) * 60 if approved else (
        existing.get('actual_seconds') if existing else None)
    month = _reporting_month(activity)
    desired_status = 'accepted' if approved else activity['status']
    source_id = f"extra:{activity['id']}"
    canonical_key = f"extra_activities:{activity['id']}"
    metadata = _source_payload(activity)

    counted_change = approved and (existing is None or existing.get('accepted') is not True
        or int(existing.get('actual_seconds') or 0) != seconds or existing.get('reporting_month') != month)
    counted_change = counted_change or bool(existing and existing.get('accepted') is True and not approved)
    if counted_change:
        from .manual_time_corrections import require_open_month
        protected = {month}
        if existing and existing.get('reporting_month'):
            protected.add(existing['reporting_month'])
        for target_month in sorted(protected):
            require_open_month(owner, target_month)

    changed = False
    if existing is None:
        if not approved:
            return {'progress_entry_id': None, 'changed': False}
        cursor.execute('''INSERT INTO "Learner".learner_progress_entries (
                learner_id,entry_order,kind,component_title,component_type,submitted_at,
                feed_kind,feed_action,feed_title,feed_detail,feed_occurred_at,
                component_link_status,component_link_source,source_system,source_activity_id,
                canonical_activity_key,activity_status,accepted,actual_seconds,actual_basis,
                reporting_month,reporting_timestamp_label,source_payload)
            SELECT %s,coalesce(max(entry_order),0)+1,'extra_activity',%s,'extra_activity',%s,
                'activity','approved',%s,'',%s,'non_component_activity','none',%s,%s,%s,
                'accepted',true,%s,'extra_activity:coach_approved',%s,'',%s::jsonb
            FROM "Learner".learner_progress_entries WHERE learner_id=%s RETURNING id''', [
                activity['learner_id'], activity['title'],
                activity.get('submitted_at') or activity.get('reviewed_at'), activity['title'],
                activity.get('reviewed_at'), SOURCE_SYSTEM, source_id, canonical_key,
                seconds, month, _json(metadata), activity['learner_id'],
            ])
        progress_id = int(cursor.fetchone()[0])
        existing = {'id': progress_id}
        changed = True
    else:
        progress_id = int(existing['id'])
        if activity.get('progress_entry_id') not in (None, progress_id):
            raise ServiceError('This Extra Activity links to a different Progress entry.',
                               'progress_identity_conflict', 409)
        desired = {
            'accepted': approved,
            'actual_seconds': seconds,
            'reporting_month': month,
            'activity_status': desired_status,
            'source_system': SOURCE_SYSTEM,
            'source_activity_id': source_id,
            'canonical_activity_key': canonical_key,
        }
        needs_update = any(existing.get(key) != value for key, value in desired.items())
        current_metadata = _payload(existing.get('source_payload'))
        needs_update = needs_update or any(current_metadata.get(key) != value
                                           for key, value in metadata.items())
        if needs_update:
            cursor.execute('''UPDATE "Learner".learner_progress_entries SET
                    component_title=%s,component_type='extra_activity',feed_kind='activity',
                    feed_action=%s,feed_title=%s,feed_occurred_at=%s,
                    component_link_status='non_component_activity',component_link_source='none',
                    source_system=%s,source_activity_id=%s,canonical_activity_key=%s,
                    activity_status=%s,accepted=%s,actual_seconds=%s,
                    actual_basis='extra_activity:coach_approved',reporting_month=%s,
                    source_payload=coalesce(source_payload,'{}'::jsonb) || %s::jsonb,
                    ssot_updated_at=CURRENT_TIMESTAMP
                WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''', [
                    activity['title'], 'approved' if approved else activity['status'],
                    activity['title'], activity.get('reviewed_at'), SOURCE_SYSTEM, source_id,
                    canonical_key, desired_status, approved, seconds, month, _json(metadata),
                    progress_id, activity['learner_id'],
                ])
            if cursor.rowcount != 1:
                raise ServiceError('The linked Progress entry changed. Reload and retry.',
                                   'record_changed', 409)
            changed = True

    # A replay of an already-linked approval is a strict no-op. New/changed
    # approvals attach the selected KSBs and existing evidence in the same
    # transaction, while historical linked rows (including Colm's repair) are
    # not silently backfilled merely because a request was retried.
    sync_lineage = changed
    if approved and sync_lineage and _sync_ksbs(
            cursor, progress_id, activity['id'], activity['learner_id'], _activity_document(activity)):
        changed = True
    if approved and sync_lineage and _sync_evidence(cursor, activity, progress_id):
        changed = True
    if activity.get('progress_entry_id') != progress_id:
        cursor.execute('''UPDATE "Learner".extra_activities SET progress_entry_id=%s,
            updated_at=CURRENT_TIMESTAMP WHERE id=%s AND learner_id=%s''',
                       [progress_id, activity['id'], activity['learner_id']])
        if cursor.rowcount != 1:
            raise ServiceError('The Extra Activity changed. Reload and retry.',
                               'record_changed', 409)
        changed = True

    if changed:
        from .progress_cache import bump_learners
        bump_learners([activity['learner_id']])
        from .monthly_actual_cache import refresh_learner, sync_completed_hours
        sync_completed_hours(activity['learner_id'], database='enrolment')
        refresh_learner(activity['learner_id'], database='enrolment')
    return {'progress_entry_id': progress_id, 'changed': changed}
