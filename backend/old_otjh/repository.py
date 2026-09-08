"""Parameterized SQL only; reads never provision or copy source data."""
import base64
import json
import re
from datetime import date
from contextlib import contextmanager

from django.db import connections, transaction

DB = 'enrolment'
VERSION = 'old-otjh-transition-v1'
CUTOFF = '2026-08'
TRANSITIONS = '"Audit".learner_transitions'
EVENTS = '"Audit".learner_transition_events'
SIGNOFFS = '"Audit".monthly_audit_signoffs'
FINALIZATIONS = 'structured_manual_activities.manual_month_finalization_events'
ROWS = 'structured_manual_activities.manual_learner_activities'
DOCS = 'structured_manual_activities.manual_activity_documents'


def query(sql, params=()):
    with connections[DB].cursor() as cursor:
        cursor.execute(sql, params)
        if cursor.description is None:
            return []
        columns = [col[0] for col in cursor.description]
        result = [dict(zip(columns, row)) for row in cursor.fetchall()]
        # The project registers text loaders for json/jsonb in AppConfig.ready.
        for row in result:
            for key in ('required_months', 'metadata'):
                if isinstance(row.get(key), str):
                    row[key] = json.loads(row[key])
        return result


def student(learner_id):
    rows = query('SELECT id, "Email" AS email, "Username" AS name, '
                 '"Programme" AS programme, aptem_id '
                 'FROM enrolment."Created_users" WHERE id=%s', [learner_id])
    return rows[0] if rows else None


def linked_learners(aptem_id):
    return query('SELECT id FROM enrolment."Created_users" '
                 "WHERE ltrim(btrim(aptem_id), '0')=%s LIMIT 2", [str(aptem_id)])


def historical_learner(aptem_id):
    return query('SELECT aptem_id, learner_id, learner_name, learner_email, '
                 'programme_name, programme_status, coach_email, coach_name, planned_hours_monthly '
                 'FROM "Last_audit".learners WHERE aptem_id=%s LIMIT 2', [aptem_id])


def staff(staff_id):
    result = query('SELECT id, "Email" AS email, "Access" AS access '
                   'FROM enrolment."Staff_users" WHERE id=%s', [staff_id])
    return result[0] if result else None


def coach_learners(email, is_admin, page, page_size=25):
    where = "btrim(c.aptem_id) ~ '^[0-9]+$' AND l.aptem_id > 0"
    params = []
    if not is_admin:
        where += ' AND lower(btrim(l.coach_email))=%s'
        params.append(email)
    base = ('FROM enrolment."Created_users" c JOIN "Last_audit".learners l '
            "ON ltrim(btrim(c.aptem_id), '0')=l.aptem_id::text WHERE " + where)
    total = query('SELECT count(*) AS n ' + base, params)[0]['n']
    rows = query('SELECT l.aptem_id AS id, l.learner_name AS name, l.programme_name AS programme '
                 + base + ' ORDER BY lower(l.learner_name), c.id LIMIT %s OFFSET %s',
                 [*params, page_size, (page - 1) * page_size])
    return {'learners': rows, 'total': total, 'page': page, 'page_size': page_size}


def source_months(aptem_id):
    return query(f'''SELECT month, count(*) AS row_count,
        coalesce(sum(planned_hours),0) AS planned_hours,
        coalesce(sum(actual_hours) FILTER (WHERE accepted),0) AS actual_hours,
        coalesce(sum(actual_hours) FILTER (WHERE NOT accepted),0) AS not_accepted_hours
        , coalesce(sum(actual_hours),0) AS total_actual_hours
        FROM {ROWS} WHERE aptem_id=%s AND deleted_at IS NULL
        AND month ~ '^[0-9]{{4}}-(0[1-9]|1[0-2])$' AND month<=%s
        GROUP BY month ORDER BY month''', [aptem_id, CUTOFF])


def transition(learner_id, lock=False):
    rows = query(f'SELECT * FROM {TRANSITIONS} WHERE learner_id=%s'
                 + (' FOR UPDATE' if lock else ''), [learner_id])
    return rows[0] if rows else None


def create_transition(learner, months):
    query(f'''INSERT INTO {TRANSITIONS} (learner_id, aptem_id, required_months)
        VALUES (%s,%s,%s::jsonb) ON CONFLICT (learner_id) DO NOTHING''',
          [learner['id'], learner['aptem_id'], json.dumps(months)])
    return transition(learner['id'], lock=True)


@contextmanager
def atomic():
    with transaction.atomic(using=DB):
        yield


def programme_key(learner):
    return f"otjh-transition:{learner['id']}"


def signatures(learner):
    return query(f'''SELECT id, report_month, signer_role, signer_name,
        signed_at, snapshot_hash, signature_source_document_id AS file_id
        FROM {SIGNOFFS} WHERE learner_id=%s AND programme_key=%s
        AND audit_version=%s AND review_confirmed IS TRUE
        AND coalesce(signature_data,'')<>'' ''',
        [str(learner['aptem_id']), programme_key(learner), VERSION])


def finalizations(aptem_id):
    return query(f'''SELECT DISTINCT ON (report_month)
        id, report_month, event_type, snapshot_hash, row_count, created_at
        FROM {FINALIZATIONS} WHERE aptem_id=%s AND report_month<=%s
        ORDER BY report_month, id DESC''', [aptem_id, CUTOFF])


def pending_revisions(aptem_id):
    return query('''SELECT selected_month AS month, count(*) AS count
        FROM structured_manual_activities.manual_activity_hours_revision
        WHERE aptem_id=%s AND status='pending' GROUP BY selected_month''', [aptem_id])


def month_rows(learner, month):
    import mimetypes
    from audit_api.last_audit_ledger_views import _duration_min_sql
    rows = query(f'''SELECT r.id, r.month, r.category, r.source_ref, r.group_id, r.activity_id, r.title,
        r.activity_date, r.activity_time, r.planned_hours, r.actual_hours, r.timestamp_label,
        r.completion_note, r.accepted, r.updated_at, g.group_name,
        {_duration_min_sql('a')} AS duration_minutes,
        a.raw #> '{{live_lms_component,ksbs}}' AS component_ksbs
        FROM {ROWS} r
        LEFT JOIN "Last_audit".groups g ON g.group_id=r.group_id
        LEFT JOIN "Last_audit".activities a ON a.activity_id=r.activity_id
        WHERE r.aptem_id=%s AND r.month=%s AND r.deleted_at IS NULL
        ORDER BY r.activity_date NULLS LAST, r.id''', [learner['aptem_id'], month])
    docs = query(f'''SELECT d.id, d.manual_activity_id, d.display_name,
        d.content_type, d.size_bytes, d.uploaded_at, d.blob_name FROM {DOCS} d JOIN {ROWS} r
        ON r.id=d.manual_activity_id AND r.aptem_id=d.aptem_id
        WHERE d.aptem_id=%s AND r.month=%s AND d.deleted_at IS NULL
        AND r.deleted_at IS NULL ORDER BY d.id''', [learner['aptem_id'], month])
    for doc in docs:
        blob_name = doc.pop('blob_name', '')
        if not doc.get('content_type') or doc['content_type'] == 'application/octet-stream':
            doc['content_type'] = mimetypes.guess_type(blob_name)[0] or mimetypes.guess_type(doc['display_name'])[0]
    activity_ids = list({r['activity_id'] for r in rows if r['activity_id'] is not None})
    results = query('''SELECT activity_id, group_id, status, video_started,
        video_completed, reading_viewed, quiz_attempted, quiz_passed, quiz_score,
        quiz_maximum_score, quiz_attempt_number, mapped_hours, updated_at
        FROM "Last_audit".activity_results
        WHERE learner_id=%s AND activity_id=ANY(%s)''',
        [learner.get('lms_id'), activity_ids]) if activity_ids and learner.get('lms_id') else []
    evidence_ids = [int(r['source_ref'][3:]) for r in rows
                    if re.fullmatch(r'ev:[0-9]+', r.get('source_ref') or '')]
    evidence = query('''SELECT evidence_id, component_name, ksb_codes
        FROM fetching_evidence.evidence_items
        WHERE learner_id=%s AND evidence_id=ANY(%s)''',
        [learner['aptem_id'], evidence_ids]) if evidence_ids else []
    evidence = {str(e['evidence_id']): e for e in evidence}
    for row in rows:
        item = evidence.get((row.get('source_ref') or '')[3:], {}) if (row.get('source_ref') or '').startswith('ev:') else {}
        row['component_name'] = item.get('component_name')
        row['ksb_codes'] = ksb_codes(item.get('ksb_codes') or row.pop('component_ksbs', None))
        row.pop('component_ksbs', None)
        row['documents'] = [d for d in docs if d['manual_activity_id'] == row['id']]
        row['results'] = [r for r in results if r['activity_id'] == row['activity_id']
                          and (row['group_id'] is None or r['group_id'] == row['group_id'])]
    # Read the original mirrored evidence for previously unlinked assignments.
    # This is a projection, never the legacy INSERT-based attachment backfill.
    missing_docs = [r for r in rows if r['category'] == 'assignment' and not r['documents']]
    source_docs = source_documents(learner, [r['id'] for r in missing_docs])
    for row in missing_docs:
        row['documents'] = [{k: v for k, v in doc.items() if k not in {'container', 'blob_name', 'body', 'row_id'}}
                            for doc in source_docs if doc['row_id'] == row['id']]
    return rows


def source_documents(learner, row_ids):
    import mimetypes
    if not row_ids:
        return []
    evidence = query(f'''SELECT r.id AS row_id, r.month, e.evidence_id, e.evidence_name,
        e.file_blob, e.report_blob, e.note_content, e.updated_at AS source_updated_at FROM {ROWS} r
        JOIN fetching_evidence.evidence_items e ON e.learner_id=r.aptem_id AND (
          r.source_ref='ev:' || e.evidence_id::text OR
          r.source_ref='asg:' || e.component_id::text || ':evidence:' || e.evidence_id::text OR
          r.source_ref='asg:' || e.component_id::text)
        WHERE r.aptem_id=%s AND r.id=ANY(%s) AND r.category='assignment' AND r.deleted_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM "Audit".learner_evidence_overrides o
          WHERE o.learner_id=r.aptem_id AND NOT o.is_uploaded AND o.source_evidence_id::text=e.evidence_id::text
          AND (o.deleted_at IS NOT NULL OR o.archived_at IS NOT NULL))
        ORDER BY r.id,e.evidence_id''', [learner['aptem_id'], row_ids])
    # Respect deliberate document deletion from the other system.
    deleted = query(f'''SELECT manual_activity_id, blob_name FROM {DOCS}
        WHERE aptem_id=%s AND manual_activity_id=ANY(%s) AND deleted_at IS NOT NULL''',
        [learner['aptem_id'], row_ids])
    tombstones = {(d['manual_activity_id'], d['blob_name']) for d in deleted}
    result = []
    for item in evidence:
        name = item['evidence_name'] or f"Evidence {item['evidence_id']}"
        for index, kind in enumerate(('file', 'report', 'note')):
            blob = item.get(f'{kind}_blob')
            body = item.get('note_content') if kind == 'note' else None
            if not blob and not str(body or '').strip():
                continue
            if (item['row_id'], blob) in tombstones:
                continue
            extension = re.search(r'\.[A-Za-z0-9]{1,6}$', blob or '')
            stem = re.sub(r'\.[A-Za-z0-9]{1,6}$', '', name)
            label = f"Assessment report - {stem}{extension.group() if extension else '.pdf'}" if kind == 'report' else name
            if kind == 'note':
                label = f'{name} - reflection.txt'
            result.append({'id': -(item['evidence_id'] * 3 + index), 'row_id': item['row_id'], 'month': item['month'],
                'source_evidence_id': item['evidence_id'], 'source_kind': kind, 'display_name': label,
                'source_updated_at': item.get('source_updated_at'),
                'content_type': 'text/plain' if kind == 'note' else mimetypes.guess_type(blob or label)[0],
                'container': 'fetch-aptem-evidences', 'blob_name': blob, 'body': body})
    return result


def ksb_codes(value):
    """Only explicit codes in the source mapping; never infer from titles."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            value = [value]
    if isinstance(value, dict):
        value = [item for key in ('K', 'S', 'B')
                 if isinstance(value.get(key), list) for item in value[key]]
    if not isinstance(value, list):
        return []
    codes = []
    for item in value:
        code = str(item.get('code', '') if isinstance(item, dict) else item).strip().upper()
        if re.fullmatch(r'[KSB][0-9]+(?:\.[0-9]+)?', code) and code not in codes:
            codes.append(code)
    return codes


def activity_row(learner, month, row_id):
    rows = query(f'''SELECT id, month, title, category, source_ref, group_id, activity_id
        FROM {ROWS} WHERE id=%s AND aptem_id=%s AND month=%s
        AND deleted_at IS NULL''', [row_id, learner['aptem_id'], month])
    return rows[0] if rows else None


def activity_parts(learner, row):
    from .content import resolve, validate_parts
    return validate_parts(resolve(learner, [row], companions=True)[row['id']]['parts'])


def content_review(learner, rows):
    from .content import review
    return review(learner, rows)


def report_profile(learner):
    # Only the authenticated Aptem identity and an exact programme match; no
    # name-based cross-person matching and no arbitrary choice between dates.
    contracts = query('''SELECT DISTINCT program_start_date AS start_date, planned_end_date
        FROM fetching_evidence.aptem_cv_contracts_probe WHERE learner_id=%s
        AND (lower(btrim(current_programme))=lower(btrim(%s))
             OR lower(btrim(program_name))=lower(btrim(%s)))
        AND program_start_date IS NOT NULL LIMIT 2''',
        [learner['aptem_id'], learner['programme'], learner['programme']])
    profile = dict(contracts[0]) if len(contracts) == 1 else {'start_date': None, 'planned_end_date': None}
    profile['first_evidence_date'] = None
    if not profile['start_date']:
        return profile
    # Same first-evidence definition as the audit report: after programme start,
    # excluding welcome material, deleted/archived records, including overrides.
    candidates = query('''SELECT coalesce(o.evidence_date::text, item->>'created_date') AS evidence_date
        FROM fetching_evidence.learner_evidence e
        CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.evidence)='array'
            THEN e.evidence ELSE '[]'::jsonb END) item
        LEFT JOIN "Audit".learner_evidence_overrides o
            ON o.learner_id=e.learner_id AND o.is_uploaded=false
            AND o.source_evidence_id::text=item->>'id'
        WHERE e.learner_id=%s AND o.deleted_at IS NULL AND o.archived_at IS NULL
          AND ltrim(lower(coalesce(item->>'name',''))) NOT LIKE 'welcome%%'
          AND ltrim(lower(coalesce(item->>'component_name',''))) NOT LIKE 'welcome%%'
        UNION ALL SELECT evidence_date::text FROM "Audit".learner_evidence_overrides
        WHERE learner_id=%s AND is_uploaded=true AND deleted_at IS NULL AND archived_at IS NULL
          AND ltrim(lower(coalesce(document_name,''))) NOT LIKE 'welcome%%'
          AND ltrim(lower(coalesce(component_name,''))) NOT LIKE 'welcome%%' ''',
        [learner['aptem_id'], learner['aptem_id']])
    dates = []
    for item in candidates:
        try:
            value = date.fromisoformat(str(item['evidence_date'])[:10])
            if value >= date.fromisoformat(str(profile['start_date'])[:10]):
                dates.append(value)
        except (ValueError, TypeError):
            continue
    profile['first_evidence_date'] = min(dates) if dates else None
    return profile


def document(learner, doc_id):
    result = query(f'''SELECT d.id, d.container, d.blob_name, d.display_name,
        d.content_type, r.month FROM {DOCS} d JOIN {ROWS} r
        ON r.id=d.manual_activity_id AND r.aptem_id=d.aptem_id
        WHERE d.id=%s AND d.aptem_id=%s AND d.deleted_at IS NULL
        AND r.deleted_at IS NULL''', [doc_id, learner['aptem_id']])
    return result[0] if result else None


def save_signature(learner, month, role, name, file_id, digest):
    url = f'/audit_api/old-otjh/signatures/{file_id}/'
    query(f'''INSERT INTO {SIGNOFFS} (learner_id, programme_key, report_month,
        signer_role, signer_name, review_confirmed, signature_data, signed_at,
        snapshot_hash, audit_version, signature_source_type,
        signature_source_document_id, updated_at)
        VALUES (%s,%s,%s,%s,%s,true,%s,now(),%s,%s,'transition',%s,now())
        ON CONFLICT (learner_id,programme_key,report_month,signer_role)
        DO UPDATE SET signer_name=excluded.signer_name, review_confirmed=true,
        signature_data=excluded.signature_data, signed_at=excluded.signed_at,
        snapshot_hash=excluded.snapshot_hash, audit_version=excluded.audit_version,
        signature_source_type=excluded.signature_source_type,
        signature_source_document_id=excluded.signature_source_document_id,
        updated_at=now()''', [str(learner['aptem_id']), programme_key(learner), month,
                             role, name, url, digest, VERSION, file_id])


def save_learner_signature(learner, name, image_bytes):
    # Store only the learner's newly confirmed, server-sanitized PNG capture.
    # Monthly signoffs retain their own immutable image and audit history.
    image = 'data:image/png;base64,' + base64.b64encode(image_bytes).decode('ascii')
    saved = query('''UPDATE enrolment."Created_users"
        SET "Learner_signature"=%s, "Learner_signature_name"=%s,
            "Learner_signature_saved_at"=now()
        WHERE id=%s AND ltrim(btrim(aptem_id), '0')=%s RETURNING id''',
        [image, name, learner['id'], str(learner['aptem_id'])])
    if len(saved) != 1:
        from .service import identity_error
        identity_error()


def signature_owner(file_id):
    rows = query(f'''SELECT t.learner_id, s.report_month, s.signer_role,
        s.signature_source_document_id AS file_id FROM {SIGNOFFS} s
        JOIN {TRANSITIONS} t ON s.learner_id=t.aptem_id::text
        AND s.programme_key=('otjh-transition:' || t.learner_id::text)
        WHERE s.audit_version=%s AND s.signature_source_document_id=%s
        AND s.review_confirmed IS TRUE AND coalesce(s.signature_data,'')<>'' ''',
        [VERSION, file_id])
    # A bulk capture can belong to several months, but never several learners
    # or signing roles. The file endpoint still authorizes the owner and month.
    owners = {(row['learner_id'], row['signer_role']) for row in rows}
    return rows[0] if rows and len(owners) == 1 else None


def event(transition_id, month, kind, account, actor_role, metadata=None):
    query(f'''INSERT INTO {EVENTS} (transition_id, report_month, event_type,
        actor_id, actor_role, metadata) VALUES (%s,%s,%s,%s,%s,%s::jsonb)''',
        [transition_id, month, kind, account.id, actor_role, json.dumps(metadata or {}, default=str)])


def finalize(learner, month, digest, row_count, account, reason=None, metadata=None):
    # The existing table requires snapshot for finalized events. Only a digest
    # and scope metadata are stored: never copies of the source records.
    snapshot = {'schema': VERSION, 'aptem_id': learner['aptem_id'], 'month': month,
                'digest': digest, **(metadata or {})}
    query(f'''INSERT INTO {FINALIZATIONS} (aptem_id,report_month,event_type,
        snapshot_hash,snapshot,row_count,actor,reason)
        VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s,%s)''',
        [learner['aptem_id'], month, 'reopened' if reason else 'finalized', digest,
         json.dumps(snapshot), row_count, f'login:{account.id}', reason])


def set_completed(transition_id, complete):
    rows = query(f'''UPDATE {TRANSITIONS} SET completed_at=
        CASE WHEN %s THEN coalesce(completed_at,now()) ELSE NULL END,
        updated_at=now() WHERE id=%s RETURNING completed_at''', [complete, transition_id])
    return rows[0]['completed_at'] if rows else None
