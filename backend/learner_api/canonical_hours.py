"""Small read-only supplement to stored-hour aggregates for current LMS saves."""
from .current_learning import project_current


def pending_hour_records(owners):
    """Use the learner projection without hydrating a caseload's full history.

    Stored seconds (including zero) remain authoritative. Only direct saves
    without stored seconds or reporting segments can contribute extra hours.
    Attempts and reflection-only rows cannot introduce additional ledger rows.
    """
    from . import canonical_learning as canonical

    owners = {int(owner['id']): owner for owner in owners}
    result = {owner_id: [] for owner_id in owners}
    if not owners:
        return result
    pending = canonical.query('''SELECT p.id,p.learner_id,p.kind,p.component_ref,
        p.component_type,p.quiz_ref,p.passed,p.reported_time,p.submitted_at,
        p.time_tracking_source,p.claimed_seconds,p.verified_seconds,
        p.component_link_source,p.source_system,p.actual_seconds,p.accepted,
        p.reporting_month
        FROM "Learner".learner_progress_entries p
        WHERE p.learner_id=ANY(%s) AND p.deleted_at IS NULL
          AND p.actual_seconds IS NULL AND coalesce(p.source_system,'')=''
          AND p.component_link_source IN ('direct','quiz_ref')
          AND NOT EXISTS (SELECT 1 FROM "Learner".learner_activity_reporting_segments s
                          WHERE s.progress_id=p.id AND s.learner_id=p.learner_id)
        ORDER BY p.id''', [list(owners)])
    if not pending:
        return result
    affected = sorted({int(record['learner_id']) for record in pending})
    # project_current owns retry/replacement policy. Supply its small amount of
    # stored context so a retained import or staff correction suppresses the
    # original direct save exactly as it does on the learner dashboard.
    context = canonical.query('''SELECT id,learner_id,component_ref,actual_basis,
        actual_seconds,source_system,
        jsonb_build_object('original_source_ref',source_payload->>'original_source_ref') AS source_payload
        FROM "Learner".learner_progress_entries
        WHERE learner_id=ANY(%s) AND deleted_at IS NULL
          AND (coalesce(source_system,'')<>'' OR actual_basis='staff:module-progress')''', [affected])
    assignment_owners = sorted({int(record['learner_id']) for record in pending
                                if record.get('component_type') == 'assignment'})
    markings = {}
    if assignment_owners:
        pairs = [(str(owners[key]['enrolment_id']), str(owners[key].get('learner_type') or ''))
                 for key in assignment_owners]
        placeholders = ','.join(['(%s,%s)'] * len(pairs))
        submissions = canonical.query(f'''SELECT learner_id,learner_kind,component_ref,
            status,actual_time_hours
            FROM "Learner".learning_reflection_submissions
            WHERE (learner_id,learner_kind) IN ({placeholders})
              AND activity_type IN ('assignment','extra_activity')
            ORDER BY submitted_at NULLS FIRST,id''', [value for pair in pairs for value in pair])
        for row in submissions:
            if row.get('component_ref'):
                key = (str(row['learner_id']), str(row['learner_kind']))
                markings.setdefault(key, {})[str(row['component_ref'])] = row
    for owner_id in affected:
        owner = owners[owner_id]
        records = [row for row in pending if int(row['learner_id']) == owner_id]
        pending_ids = {row['id'] for row in records}
        records += [row for row in context if int(row['learner_id']) == owner_id]
        decisions = markings.get((str(owner['enrolment_id']), str(owner.get('learner_type') or '')), {})
        result[owner_id] = [row for row in project_current(records, decisions) if row['id'] in pending_ids]
    return result
