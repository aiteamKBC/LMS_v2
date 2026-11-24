"""Protect finalized months and learner overrides during curriculum propagation."""


def mutable_progress_ids(cursor, component_ids):
    cursor.execute('''SELECT p.id,l.aptem_id,p.reporting_month,j.month,
               coalesce(m.source_preference,'material')
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learners l ON l.id=p.learner_id
        LEFT JOIN "Learner".learner_journal_rows j
          ON j.progress_id=p.id AND j.learner_id=p.learner_id AND j.deleted_at IS NULL
        LEFT JOIN "Learner".ksb_learner_activity_mappings m
          ON m.learner_id=p.learner_id AND m.source_kind='learner_activity' AND m.activity_id=j.activity_id
        WHERE p.deleted_at IS NULL
          AND coalesce(nullif(p.curriculum_component_ref,''),nullif(p.component_ref,''))=ANY(%s)
        ORDER BY p.id,j.id''', [list(component_ids)])
    rows = cursor.fetchall()
    scopes = sorted({(aptem, month) for _, aptem, report_month, journal_month, _ in rows
                     for month in (report_month, journal_month) if aptem is not None and month})
    finalized = set()
    if scopes:
        # Same lock key and ordering as the installed finalization guard.
        keys = sorted(f'manual-journal-finalization:{aptem}:{month}' for aptem, month in scopes)
        cursor.execute('''SELECT pg_advisory_xact_lock(hashtext(scope))
            FROM (SELECT unnest(%s::text[]) AS scope ORDER BY scope) ordered''', [keys])
        cursor.execute('''SELECT DISTINCT ON (aptem_id,report_month) aptem_id,report_month,event_type
            FROM "Learner".manual_month_finalization_events
            WHERE aptem_id=ANY(%s) AND report_month=ANY(%s)
            ORDER BY aptem_id,report_month,id DESC''',
            [sorted({s[0] for s in scopes}), sorted({s[1] for s in scopes})])
        finalized = {(aptem, month) for aptem, month, event in cursor.fetchall() if event == 'finalized'}
    protected = {pid for pid, aptem, report_month, journal_month, preference in rows
                 if preference == 'learner' or (aptem, report_month) in finalized
                 or (aptem, journal_month) in finalized}
    allowed = sorted({row[0] for row in rows} - protected)
    if allowed:
        cursor.execute('SELECT id FROM "Learner".learner_progress_entries WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [allowed])
        cursor.fetchall()
    return allowed
