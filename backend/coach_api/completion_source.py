"""Bounded metadata-only, read-only Coaching Session -> Aptem status adapter.

An explicit component -> cache -> physical occurrence link is required. Dates,
names, titles, completion dates and absent reports never establish that link.
"""
from datetime import timedelta
from .recordings_saved_evidence import source_dsn
from .completion_policy import FAMILIES, completion_state, session_key

MAX_ROWS = 5000


def read_source(since, now, owners, tracked=()):
    import psycopg
    from psycopg.rows import dict_row
    dsn = source_dsn()
    if not dsn:
        raise RuntimeError('completion_source_not_configured')
    if len(tracked) > MAX_ROWS:
        raise ValueError('completion_tracking_limit')
    # Older open tasks are rechecked by exact component ID, not an unbounded
    # historical scan. A missing/deleted link is returned as unverified.
    lower = max(since, now - timedelta(days=31))
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=3,
                          options='-c default_transaction_read_only=on') as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='5000ms'")
            cursor.execute('''SELECT c.id AS component_id,c.component_type,c.status,
                c.updated_at AS component_updated_at,c.learner_id,c.learner_name,c.learner_email,
                s.meeting_id,s.coach_email,s.learner_id AS cache_learner_id,
                s.actual_start_at,s.actual_end_at,s.learner_attended,m.coach_email AS meeting_coach_email,
                m.event_id,m.start_at,m.end_at,m.is_cancelled
                FROM public.aptem_session_components c
                LEFT JOIN public.all_sessions_cache s ON s.component_id=c.id
                LEFT JOIN public.meetings m ON m.id=s.meeting_id
                WHERE c.component_type=ANY(%s) AND
                  ((m.end_at>=%s AND m.end_at<=%s AND lower(trim(s.coach_email))=ANY(%s))
                   OR c.id=ANY(%s)) ORDER BY c.id,s.id LIMIT 5001''',
                [list(FAMILIES), lower, now, list(owners), list(tracked)])
            rows = cursor.fetchall()
            if len(rows) > MAX_ROWS:
                raise ValueError('completion_source_limit')
            cursor.execute('''SELECT count(*) AS unlinked FROM public.aptem_session_components c
                WHERE c.component_type=ANY(%s) AND c.status IN ('Scheduled','In Progress')
                AND c.planned_date BETWEEN %s AND %s AND NOT EXISTS
                  (SELECT 1 FROM public.all_sessions_cache s WHERE s.component_id=c.id AND s.meeting_id IS NOT NULL)''',
                [list(FAMILIES), lower.date(), now.date()])
            unlinked = cursor.fetchone()['unlinked']
    counts = {}
    for row in rows:
        counts[row['component_id']] = counts.get(row['component_id'], 0) + 1
    verified = []
    for row in rows:
        owner = str(row.get('coach_email') or '').strip().lower()
        start, end = row.get('start_at'), row.get('end_at')
        valid = (counts[row['component_id']] == 1 and owner in owners
            and owner == str(row.get('meeting_coach_email') or '').strip().lower()
            and row.get('meeting_id') and row.get('event_id')
            and row.get('learner_id') is not None and row['learner_id'] == row.get('cache_learner_id')
            and start and end and end > start and since <= end <= now
            and row.get('actual_start_at') and abs(start-row['actual_start_at']) <= timedelta(minutes=15)
            and row.get('actual_end_at') and row['actual_end_at'] > start
            and row['actual_start_at'] < end and row.get('is_cancelled') is False)
        if not valid:
            continue
        # A current read of an old cached status is not proof of a current Aptem
        # status. Suppress reminders until the upstream row has been refreshed.
        stamp = row.get('component_updated_at')
        if not stamp:
            continue
        state = completion_state(row['status'])
        if state=='action-required' and row.get('learner_attended') is not True:
            state='unverified'
        if stamp > now + timedelta(minutes=5) or now-stamp > timedelta(hours=24):
            state = 'unverified'
        verified.append({'key': session_key(row['component_id'], row['meeting_id'], owner),
            'component_id': row['component_id'], 'source_meeting_id': str(row['meeting_id']),
            'owner_email': owner, 'learner_name': str(row['learner_name'] or 'Learner')[:255],
            'learner_email': str(row.get('learner_email') or '').strip().lower(),
            'family': FAMILIES[row['component_type']], 'event_id': row['event_id'],
            'starts_at': start, 'ends_at': end, 'state': state, 'source_status': row['status'],
            'source_updated_at': stamp, 'checked_at': now})
    return {'sessions': verified, 'unlinked': unlinked, 'withheld':len(rows)-len(verified)}
