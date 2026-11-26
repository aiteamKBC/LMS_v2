"""Protect finalized months and learner overrides during curriculum propagation."""


def _scope_rows(cursor, component_ids):
    cursor.execute('''SELECT p.id,l.aptem_id,p.reporting_month,j.month,
               coalesce(m.source_preference,'material'),p.learner_id
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learners l ON l.id=p.learner_id
        LEFT JOIN "Learner".learner_journal_rows j
          ON j.progress_id=p.id AND j.learner_id=p.learner_id AND j.deleted_at IS NULL
        LEFT JOIN "Learner".ksb_learner_activity_mappings m
          ON m.learner_id=p.learner_id AND m.source_kind='learner_activity' AND m.activity_id=j.activity_id
        WHERE p.deleted_at IS NULL
          AND coalesce(nullif(p.curriculum_component_ref,''),nullif(p.component_ref,''))=ANY(%s)
        ORDER BY p.id,j.id''', [list(component_ids)])
    return cursor.fetchall()


def mutable_progress_ids(cursor, component_ids):
    rows = _scope_rows(cursor, component_ids)
    scopes = {(learner, month) for _, _, report_month, journal_month, _, learner in rows
              for month in (report_month, journal_month) if month}
    finalized = set()
    if scopes:
        from .finalization_locks import lock_scopes
        lock_scopes(cursor, scopes)
        if _scope_rows(cursor, component_ids) != rows:
            raise ValueError('Progress scope changed; retry the entire transaction.')
        cursor.execute('''SELECT DISTINCT ON (learner_id,report_month) learner_id,report_month,event_type
            FROM "Learner".manual_month_finalization_events
            WHERE learner_id=ANY(%s) AND report_month=ANY(%s)
            ORDER BY learner_id,report_month,id DESC''',
            [sorted({s[0] for s in scopes}), sorted({s[1] for s in scopes})])
        finalized = {(learner, month) for learner, month, event in cursor.fetchall() if event == 'finalized'}
        from .finalization_locks import signed_scopes
        finalized.update(signed_scopes(cursor, scopes))
    protected = {pid for pid, aptem, report_month, journal_month, preference, learner in rows
                 if preference == 'learner' or (learner, report_month) in finalized
                 or (learner, journal_month) in finalized}
    allowed = sorted({row[0] for row in rows} - protected)
    if allowed:
        cursor.execute('SELECT id FROM "Learner".learner_progress_entries WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [allowed])
        cursor.fetchall()
        if _scope_rows(cursor, component_ids) != rows:
            raise ValueError('Progress scope changed; retry the entire transaction.')
    return allowed
