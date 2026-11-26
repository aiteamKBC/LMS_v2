"""Fill missing journal snapshots without replacing historical progress links.

The caller owns the transaction. Finalization uses the installed guard's lock
namespace; progress and journal changes either both commit or both roll back.
"""
import json
from .ksb_definition_links import assigned_definition_ids


def fill_missing_snapshot(cursor, row_id, aptem_id, mappings, *, actor, learner_id=None):
    if learner_id is None and aptem_id is None:
        raise ValueError('Canonical learner identity is required without an Aptem ID.')
    cursor.execute('''SELECT j.learner_id,j.progress_id,j.month,j.activity_id,j.ksb_snapshot,
            coalesce(j.ksb_metadata,'{}'::jsonb),p.reporting_month
        FROM "Learner".learner_journal_rows j
        JOIN "Learner".learners l ON l.id=j.learner_id
        LEFT JOIN "Learner".learner_progress_entries p ON p.id=j.progress_id AND p.learner_id=j.learner_id
        WHERE j.id=%s AND j.deleted_at IS NULL
          AND ((%s::bigint IS NOT NULL AND j.learner_id=%s)
            OR (%s::bigint IS NULL AND j.aptem_id=%s AND l.aptem_id=j.aptem_id
              AND NOT EXISTS(SELECT 1 FROM "Learner".learners other WHERE other.aptem_id=j.aptem_id AND other.id<>j.learner_id)))
''', [row_id, learner_id, learner_id, learner_id, aptem_id])
    row = cursor.fetchone()
    if not row or row[4]:
        return None
    learner_id, progress_id, month, activity_id, _, metadata, progress_month = row
    months = sorted({value for value in (month, progress_month) if value})
    from .finalization_locks import lock_scopes
    lock_scopes(cursor, [(learner_id, target) for target in months])
    cursor.execute('SELECT learner_id,month,progress_id,ksb_snapshot,ksb_metadata,deleted_at FROM "Learner".learner_journal_rows WHERE id=%s FOR UPDATE', [row_id])
    fresh = cursor.fetchone()
    if not fresh or fresh[:3] != (learner_id, month, progress_id) or fresh[5] is not None:
        raise ValueError('Journal scope changed; retry the transaction.')
    if fresh[3]:
        return None
    metadata = fresh[4] or {}
    if progress_id is not None:
        cursor.execute('''SELECT reporting_month FROM "Learner".learner_progress_entries
            WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE''', [progress_id,learner_id])
        if cursor.fetchone() != (progress_month,):
            raise ValueError('Progress scope changed; retry the entire transaction.')
    from .finalization_locks import signed_scopes
    if signed_scopes(cursor, [(learner_id, target) for target in months]):
        raise ValueError('Cannot change KSBs in a signed or locked journal month.')
    for target in months:
        cursor.execute('''SELECT event_type FROM "Learner".manual_month_finalization_events
            WHERE learner_id=%s AND report_month=%s ORDER BY id DESC LIMIT 1''', [learner_id,target])
        event = cursor.fetchone()
        if event and event[0] == 'finalized':
            raise ValueError('Cannot change KSBs in a finalized journal month.')
    cursor.execute('''SELECT ksbs FROM "Learner".ksb_learner_activity_mappings
        WHERE learner_id=%s AND source_kind='learner_activity' AND activity_id=%s
          AND source_preference='learner' FOR UPDATE''', [learner_id,activity_id])
    override = cursor.fetchone()
    desired = override[0] if override else mappings
    if not isinstance(desired, list):
        raise ValueError('Journal KSB snapshot must be an array.')
    normalized = []
    for item in desired:
        item = item if isinstance(item, dict) else {'code': item}
        code = str(item.get('code') or item.get('ksb_code') or '').strip().upper()
        if code:
            normalized.append({**item, 'ksb_code': code})
    resolved = assigned_definition_ids(cursor,[learner_id],normalized)
    if progress_id is not None:
        cursor.execute('''SELECT id FROM "Learner".learner_progress_entries
            WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE''', [progress_id,learner_id])
        if not cursor.fetchone():
            raise ValueError('Journal progress ownership is inconsistent.')
        cursor.execute('''SELECT position,ksb_code FROM "Learner".ksb_learner_progress
            WHERE progress_id=%s ORDER BY position''', [progress_id])
        existing = cursor.fetchall()
        codes = {str(code).strip().upper() for _, code in existing}
        position = max((position for position,_ in existing),default=-1)+1
        for item in normalized:
            code = item['ksb_code']
            if code in codes:
                continue  # Preserve exclusions, unresolved identities and historical snapshots.
            definition = resolved.get((int(learner_id),code))
            supplied = item.get('standardKsbId',item.get('standard_ksb_id'))
            if supplied is not None and str(supplied) != str(definition):
                definition = None
            cursor.execute('''INSERT INTO "Learner".ksb_learner_progress
                (progress_id,position,ksb_code,standard_ksb_id,ksb_description,source_type,source_id,
                 classification,weight_class,legacy_definition_snapshot,is_excluded)
                VALUES(%s,%s,%s,%s,%s,'journal',%s,'','',%s::jsonb,false)''',
                [progress_id,position,code,definition,item.get('description',''),str(row_id),json.dumps(item)])
            codes.add(code)
            position += 1
    cursor.execute('''UPDATE "Learner".learner_journal_rows SET ksb_snapshot=%s::jsonb,
            ksb_metadata=coalesce(ksb_metadata,'{}'::jsonb) || jsonb_build_object(
                'version',%s::bigint,'updated_by',%s::text,'updated_at',now())
        WHERE id=%s AND learner_id=%s''',
        [json.dumps(desired),int(metadata.get('version') or 0)+1,actor,row_id,learner_id])
    return {'learner_id': learner_id, 'snapshot': desired, 'learner_override': bool(override)}
