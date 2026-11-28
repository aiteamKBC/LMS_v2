"""Canonical journal documents; the database alone synchronizes activity SSOT.

Callers authorize their learner/row before reading. Writers run in the caller's
transaction and use the same learner/signing locks and month policy as the
Activity Log. No storage calls, schema repair, or historical reconciliation.
"""
from old_otjh.service import ServiceError

DOCUMENTS = '"Learner".manual_activity_documents'
JOURNAL = '"Learner".learner_journal_rows'
SSOT = '"Learner".learner_activity_documents'
JOIN = f'''{DOCUMENTS} d
    JOIN {JOURNAL} j ON j.id=d.manual_activity_id AND j.learner_id=d.learner_id
    JOIN "Learner".learners l ON l.id=d.learner_id'''


def query(cursor, sql, params=()):
    try:
        cursor.execute(sql, params)
    except Exception as error:
        cause = error.__cause__ or error
        code = getattr(cause, 'sqlstate', None) or getattr(cause, 'pgcode', None)
        if code == '55000':
            raise ServiceError('The document scope or source identity needs review.',
                               'document_sync_review_required', 409) from error
        if code in ('40001', '40P01'):
            raise ServiceError('The month changed concurrently; retry the complete operation.',
                               'record_changed', 409) from error
        raise
    if cursor.description is None:
        return []
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def visible(alias='d'):
    # A preserved SSOT tombstone is not permission to present its manual copy
    # as active. Exact source identities only; split/part2 records are distinct.
    return f'''{alias}.deleted_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM {SSOT} s
        WHERE s.source_document_id='manual-document:' || {alias}.id::text
          AND s.learner_id={alias}.learner_id AND s.deleted_at IS NOT NULL)'''


def read(cursor, *, row_ids=None, learner_id=None, document_id=None):
    conditions = ['j.deleted_at IS NULL', visible()]
    params = []
    for clause, value in [('d.manual_activity_id=ANY(%s)', row_ids),
                          ('d.learner_id=%s', learner_id), ('d.id=%s', document_id)]:
        if value is not None:
            conditions.append(clause)
            params.append(value)
    if not params:
        raise ValueError('Document reads require an owner, row or document scope.')
    return query(cursor, f'''SELECT d.*, l.aptem_id, j.month AS journal_month
        FROM {JOIN} WHERE {' AND '.join(conditions)} ORDER BY d.uploaded_at,d.id''', params)


def writable_row(cursor, row_id, *, learner_id=None):
    rows = query(cursor, f'''SELECT j.id,j.learner_id,j.month,j.category,j.progress_id,
        l.aptem_id,l.enrolment_id FROM {JOURNAL} j
        JOIN "Learner".learners l ON l.id=j.learner_id
        WHERE j.id=%s AND j.deleted_at IS NULL''', [row_id])
    if not rows or (learner_id is not None and rows[0]['learner_id'] != learner_id):
        raise ServiceError('Journal activity not found.', 'not_found', 404)
    row = rows[0]
    from .finalization_locks import lock_scopes
    lock_scopes(cursor, [(row['learner_id'], row['month'])])
    lock_owner(cursor, row)
    fresh = query(cursor, f'''SELECT id,learner_id,month,category,progress_id FROM {JOURNAL}
        WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE''', [row_id,row['learner_id']])
    if not fresh:
        raise ServiceError('Journal activity changed. Reload before saving.', 'record_changed', 409)
    if fresh[0]['month'] != row['month']:
        raise ServiceError('Journal month changed. Reload before saving.', 'record_changed', 409)
    row.update(fresh[0])
    require_writable_month(cursor, row, row['month'])
    return row


def lock_owner(cursor, owner):
    # Same order as canonical monthly signing and time corrections.
    query(cursor, 'SELECT id FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [owner['enrolment_id']])
    query(cursor, 'SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [owner['learner_id']])


def require_writable_month(cursor, owner, month):
    from .finalization_locks import lock_scopes
    lock_scopes(cursor, [(owner['learner_id'], month)])
    from .manual_time_corrections import require_open_month
    try:
        require_open_month({'id':owner['learner_id'], 'aptem_id':owner['aptem_id']}, month,
                           query=lambda sql, params: query(cursor,sql,params))
    except ServiceError as error:
        raise ServiceError('This monthly log is protected; no document was changed.', error.code, error.status) from error


def require_sync_identity(cursor, document_id, learner_id, *, allow_missing=False):
    matches = query(cursor, f'''SELECT id,learner_id,source_system,progress_id,container,blob_name FROM {SSOT}
        WHERE source_document_id=%s ORDER BY id FOR UPDATE''', [f'manual-document:{document_id}'])
    if not matches and allow_missing:
        return
    if (len(matches) != 1 or matches[0]['source_system'] != 'journal'
            or matches[0]['learner_id'] != learner_id):
        raise ServiceError('The document source identity needs review before it can be changed.',
                           'document_sync_review_required', 409)
    manual = query(cursor, f'SELECT container,blob_name FROM {DOCUMENTS} WHERE id=%s AND learner_id=%s',
                   [document_id,learner_id])
    if len(manual) != 1 or any(matches[0][key] != manual[0][key] for key in ('container','blob_name')):
        raise ServiceError('The document file identity needs review.', 'document_sync_review_required', 409)
    # Deliberately do not compare or overwrite corrected progress associations.


def create(cursor, row_id, *, learner_id, container, blob_name, display_name,
           content_type=None, size_bytes=None, uploaded_by=None, mirrored=False):
    row = writable_row(cursor,row_id,learner_id=learner_id)
    if not isinstance(container, str) or not container.strip() or not isinstance(blob_name, str) or not blob_name.strip():
        raise ServiceError('A complete file identity is required.', 'invalid_document', 400)
    if mirrored:
        # Idempotency applies to this exact journal association, including its
        # tombstone, never to unrelated files sharing a filename/blob path.
        existing = query(cursor, f'''SELECT id FROM {DOCUMENTS}
            WHERE manual_activity_id=%s AND learner_id=%s AND container=%s AND blob_name=%s
            ORDER BY id''', [row_id,learner_id,container,blob_name])
        if existing:
            require_sync_identity(cursor, existing[0]['id'], learner_id)
            return None
    created = query(cursor, f'''INSERT INTO {DOCUMENTS}
        (manual_activity_id,learner_id,month,container,blob_name,display_name,content_type,size_bytes,uploaded_by)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (learner_id,manual_activity_id,container,blob_name)
        WHERE deleted_at IS NULL DO NOTHING RETURNING *''',
        [row_id,learner_id,row['month'],container,blob_name,display_name,content_type,size_bytes,uploaded_by])
    if not created:
        existing = query(cursor, f'''SELECT * FROM {DOCUMENTS} WHERE learner_id=%s
            AND manual_activity_id=%s AND container=%s AND blob_name=%s AND deleted_at IS NULL''',
            [learner_id,row_id,container,blob_name])
        if len(existing) != 1:
            raise ServiceError('Document changed; retry the complete operation.', 'record_changed', 409)
        require_sync_identity(cursor, existing[0]['id'], learner_id)
        return None if mirrored else existing[0]
    created = created[0]
    # Runs after the DB trigger but before commit: even an identity sequence
    # collision with an alternative source fails atomically, without dual writes.
    require_sync_identity(cursor,created['id'],learner_id)
    return created


def soft_delete(cursor, document_id):
    docs = query(cursor, f'SELECT * FROM {DOCUMENTS} WHERE id=%s AND deleted_at IS NULL', [document_id])
    if not docs:
        raise ServiceError('Document not found.', 'not_found', 404)
    before = docs[0]
    writable_row(cursor,before['manual_activity_id'],learner_id=before['learner_id'])
    docs = query(cursor, f'SELECT * FROM {DOCUMENTS} WHERE id=%s AND deleted_at IS NULL FOR UPDATE', [document_id])
    if not docs:
        raise ServiceError('Document not found.', 'not_found', 404)
    if any(docs[0][key] != before[key] for key in ('manual_activity_id','learner_id')):
        raise ServiceError('Document ownership changed. Reload before saving.', 'record_changed', 409)
    require_sync_identity(cursor,document_id,before['learner_id'],allow_missing=True)
    cursor.execute(f'UPDATE {DOCUMENTS} SET deleted_at=now() WHERE id=%s AND learner_id=%s',
                   [document_id,before['learner_id']])
    require_sync_identity(cursor,document_id,before['learner_id'])
