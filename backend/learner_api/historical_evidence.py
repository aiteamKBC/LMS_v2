"""Read the existing audit evidence in a learner-owned library. Never imports or provisions data."""
import json
import logging
import mimetypes
from functools import wraps

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import learner_self_or_staff
from audit_api.evidence_explorer_views import (
    CLASSIFICATIONS, EVIDENCE_ITEMS, EVIDENCE_OVERRIDES, EVIDENCE_REPLACEMENTS,
    evidence_payload, classify_by_hints,
)
from audit_api.manual_ledger_views import MANUAL_DOCS, MANUAL_ROWS, _report_display_name
from old_otjh.repository import ksb_codes
from . import evidence_storage

logger = logging.getLogger(__name__)
ARCHIVES = '"Audit".learner_evidence_overrides'


class EvidenceError(Exception):
    def __init__(self, message, status=404):
        super().__init__(message)
        self.status = status


def response(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            result = JsonResponse(view(request, *args, **kwargs))
        except EvidenceError as error:
            result = JsonResponse({'error': str(error)}, status=error.status)
        except DatabaseError:
            logger.exception('Could not read historical evidence')
            result = JsonResponse({'error': 'Previous evidence could not be loaded. Please retry.'}, status=503)
        result['Cache-Control'] = 'private, no-store'
        result['Vary'] = 'Cookie'
        return result
    return learner_self_or_staff(kwarg='pk')(require_GET(wrapped))


def dict_rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def resolve_aptem(cursor, kind, pk):
    if kind not in {'commercial', 'apprenticeship'}:
        raise EvidenceError('Unknown learner kind.', 400)
    cursor.execute('''SELECT u.aptem_id, lower(btrim(u."Learner_type")) AS kind,
        a."ID" AS verified_id,
        (SELECT count(*) FROM enrolment."Created_users" other
         WHERE ltrim(btrim(other.aptem_id), '0')=ltrim(btrim(u.aptem_id), '0')) AS links
        FROM enrolment."Created_users" u
        LEFT JOIN "LMS"."Aptem_users" a ON a."ID"::text=ltrim(btrim(u.aptem_id), '0')
          AND nullif(lower(btrim(u."Email")), '')=lower(btrim(a."Email"))
        WHERE u.id=%s''', [pk])
    rows = dict_rows(cursor)
    if not rows or rows[0]['kind'] != kind:
        raise EvidenceError('Learner not found.')
    row = rows[0]
    if not str(row['aptem_id'] or '').strip():
        return None
    if not row['verified_id'] or row['links'] != 1:
        raise EvidenceError('The link to your previous evidence needs checking. Please contact your coach.', 409)
    return row['verified_id']


def available_tables(cursor):
    tables = [EVIDENCE_ITEMS, CLASSIFICATIONS, EVIDENCE_OVERRIDES, EVIDENCE_REPLACEMENTS, MANUAL_ROWS, MANUAL_DOCS, ARCHIVES]
    cursor.execute('SELECT ' + ', '.join('to_regclass(%s)' for _ in tables), tables)
    return {table for table, found in zip(tables, cursor.fetchone()) if found}


def source_rows(cursor, aptem_id, tables, source_id=None):
    if EVIDENCE_ITEMS not in tables:
        raise EvidenceError('The previous evidence source is unavailable. Please retry.', 503)
    fields = ['e.evidence_id', 'e.evidence_name', 'e.evidence_kind', 'e.evidence_status',
              'e.hours_type', 'e.spent_time', 'e.component_id', 'e.component_name',
              'e.file_blob', 'e.report_blob', 'e.note_blob', 'e.evidence_type', 'e.needs_manual_review',
              'e.ksb_codes', "left(coalesce(e.note_content,''),240) AS note_preview", 'NULL AS report_month']
    if source_id is not None:
        fields += ['e.note_content', 'e.feedbacks']
    joins = []
    optional = [
        (CLASSIFICATIONS, 'c', [('category', 'content_category'), ('confidence', 'content_confidence'), ('mismatch', 'content_mismatch'), ('reason', 'content_reason'), ('review_status', 'review_status')]),
        (EVIDENCE_OVERRIDES, 'o', [('display_name', 'override_name'), ('category', 'override_category'), ('evidence_date', 'override_date')]),
    ]
    for table, alias, columns in optional:
        if table in tables:
            owner = ' AND o.aptem_id=e.learner_id' if alias == 'o' else ''
            joins.append(f'LEFT JOIN {table} {alias} ON {alias}.evidence_id=e.evidence_id{owner}')
        fields += [f'{alias}.{column} AS {name}' if table in tables else f'NULL AS {name}' for column, name in columns]
    date_fields = ['e.completed_date', 'e.submission_date', 'e.created_date']
    if ARCHIVES in tables:
        joins.append(f'''LEFT JOIN {ARCHIVES} a ON a.learner_id=e.learner_id AND NOT a.is_uploaded
            AND a.source_evidence_id=e.evidence_id''')
        date_fields.insert(0, 'a.evidence_date')
    if EVIDENCE_OVERRIDES in tables:
        date_fields.insert(0, 'o.evidence_date')
    date = f"coalesce({','.join(date_fields)})"
    fields.append(f'{date} AS evidence_date')
    replacement = [('display_name', 'replacement_name'), ('uploaded_at', 'replacement_uploaded_at'), ('container', 'replacement_container'), ('blob_name', 'replacement_blob')]
    if EVIDENCE_REPLACEMENTS in tables:
        joins.append(f'''LEFT JOIN LATERAL (SELECT rp.* FROM {EVIDENCE_REPLACEMENTS} rp
            WHERE rp.evidence_id=e.evidence_id AND rp.aptem_id=e.learner_id AND rp.archived_at IS NULL
            ORDER BY rp.uploaded_at DESC,rp.id DESC LIMIT 1) r ON true''')
    fields += [f'r.{column} AS {name}' if EVIDENCE_REPLACEMENTS in tables else f'NULL AS {name}' for column, name in replacement]
    where, params = ['e.learner_id=%s'], [aptem_id]
    if source_id is not None:
        where.append('e.evidence_id=%s')
        params.append(source_id)
    if ARCHIVES in tables:
        where.append(f'''NOT EXISTS (SELECT 1 FROM {ARCHIVES} archive
            WHERE archive.learner_id=e.learner_id AND NOT archive.is_uploaded
              AND archive.source_evidence_id::text=e.evidence_id::text
              AND (archive.deleted_at IS NOT NULL OR archive.archived_at IS NOT NULL))''')
    cursor.execute(f'''SELECT {', '.join(fields)} FROM {EVIDENCE_ITEMS} e {' '.join(joins)}
        WHERE {' AND '.join(where)} ORDER BY {date} DESC NULLS LAST,e.evidence_id DESC''', params)
    return dict_rows(cursor)


def manual_documents(cursor, aptem_id, tables, row_id=None, *, include_mirrored=False):
    if not {MANUAL_ROWS, MANUAL_DOCS}.issubset(tables):
        return []
    params = [aptem_id]
    target = ''
    if row_id is not None:
        target = 'AND r.id=%s'
        params.append(row_id)
    # Auto-attached copies of the Aptem file/report are already represented by
    # the evidence item. Keep only additional journal documents here.
    dedup = f'''AND NOT EXISTS (SELECT 1 FROM {EVIDENCE_ITEMS} e WHERE e.learner_id=d.aptem_id
        AND d.container='fetch-aptem-evidences' AND d.blob_name IN (e.file_blob,e.report_blob,e.note_blob))''' if EVIDENCE_ITEMS in tables and not include_mirrored else ''
    cursor.execute(f'''SELECT d.id,d.manual_activity_id,d.display_name,d.content_type,d.size_bytes,
        d.container,d.blob_name,d.uploaded_at,r.title,r.category,r.activity_date,r.month
        FROM {MANUAL_DOCS} d JOIN {MANUAL_ROWS} r ON r.id=d.manual_activity_id AND r.aptem_id=d.aptem_id
        WHERE d.aptem_id=%s AND d.deleted_at IS NULL AND r.deleted_at IS NULL {target} {dedup}
        ORDER BY r.activity_date DESC NULLS LAST,r.id,d.id''', params)
    return dict_rows(cursor)


def uploaded_rows(cursor, aptem_id, tables, source_id=None):
    if ARCHIVES not in tables:
        return []
    params = [aptem_id]
    target = ''
    if source_id is not None:
        target = 'AND o.evidence_id=%s'
        params.append(str(source_id))
    fields = ['o.evidence_id', 'o.document_name', 'o.component_name', 'o.evidence_status',
              'o.evidence_date', 'o.azure_container', 'o.azure_blob_name', 'o.source_activity_id',
              'o.source_activity_month', 'o.source_activity_category']
    activity_fields = ['id', 'title', 'category', 'month', 'activity_date', 'completion_note', 'actual_hours', 'planned_hours', 'accepted']
    fields += [f'r.{key} AS activity_{key}' if MANUAL_ROWS in tables else f'NULL AS activity_{key}' for key in activity_fields]
    join = f'LEFT JOIN {MANUAL_ROWS} r ON r.id=o.source_activity_id AND r.aptem_id=o.learner_id AND r.deleted_at IS NULL' if MANUAL_ROWS in tables else ''
    cursor.execute(f'''SELECT {', '.join(fields)} FROM {ARCHIVES} o {join}
        WHERE o.learner_id=%s AND o.is_uploaded AND o.deleted_at IS NULL AND o.archived_at IS NULL {target}
        ORDER BY o.evidence_date DESC,o.evidence_id''', params)
    return dict_rows(cursor)


def project_uploaded(rows):
    items = []
    for row in rows:
        item = {'id': f"uploaded:{row['evidence_id']}", 'source': 'uploaded', 'source_id': row['evidence_id'],
            'name': row['document_name'] or 'Previous evidence', 'component_name': row['component_name'] or '',
            'category': row['source_activity_category'] or classify_by_hints(row['component_name'], row['document_name'], None, 'File')[0],
            'status': row['evidence_status'] or 'Recorded', 'date': row['evidence_date'].isoformat()[:10] if row['evidence_date'] else None,
            'report_month': row['source_activity_month'], 'otjh_hours': 0, 'ksb_codes': [],
            'has_file': bool(row['azure_blob_name']), 'has_report': False, 'has_note': bool(row.get('activity_completion_note')),
            'replaced': False, 'original_has_file': False, 'note_preview': None}
        if row.get('activity_id'):
            activity = {key: row[f'activity_{key}'] for key in ('id', 'title', 'category', 'month', 'activity_date', 'completion_note', 'actual_hours', 'planned_hours', 'accepted')}
            activity.update(documents=[], results=[], timestamp_label='', activity_time=None)
            item['activity'] = activity
        items.append(item)
    return items


def project_source(rows, aptem_id):
    fields = ('name', 'component_name', 'component_id', 'category', 'status', 'date', 'report_month', 'otjh_hours',
              'has_file', 'has_report', 'replaced', 'original_has_file', 'note_preview')
    items = []
    for display, row in zip(evidence_payload(rows, aptem_id)['items'], rows):
        item = {key: display[key] for key in fields}
        item.update(id=f"aptem:{display['evidence_id']}", source='aptem', source_id=display['evidence_id'],
                    has_note=bool(row.get('note_preview') or row.get('note_blob')), ksb_codes=ksb_codes(row.get('ksb_codes')))
        items.append(item)
    return items


def project_manual(documents):
    grouped = {}
    for doc in documents:
        row_id = doc['manual_activity_id']
        if row_id not in grouped:
            date = doc['activity_date'] or doc['uploaded_at']
            grouped[row_id] = {'id': f'audit:{row_id}', 'source': 'audit', 'source_id': row_id,
                'name': doc['title'] or doc['display_name'], 'component_name': '', 'category': doc['category'],
                'status': 'Recorded', 'date': date.isoformat()[:10] if date else None, 'report_month': doc['month'],
                'otjh_hours': 0, 'ksb_codes': [], 'has_file': True, 'has_report': False, 'has_note': False,
                'replaced': False, 'original_has_file': False, 'note_preview': None}
    return list(grouped.values())


@response
def list_historical_evidence(request, kind, pk):
    with connections['enrolment'].cursor() as cursor:
        aptem_id = resolve_aptem(cursor, kind, pk)
        if aptem_id is None:
            return {'items': [], 'total': 0}
        tables = available_tables(cursor)
        items = project_source(source_rows(cursor, aptem_id, tables), aptem_id)
        uploads = uploaded_rows(cursor, aptem_id, tables)
        selected_rows = {row['activity_id'] for row in uploads if row.get('activity_id')}
        uploaded_blobs = {(row['azure_container'], row['azure_blob_name']) for row in uploads if row['azure_blob_name']}
        extra_docs = [doc for doc in manual_documents(cursor, aptem_id, tables)
                      if doc['manual_activity_id'] not in selected_rows and (doc['container'], doc['blob_name']) not in uploaded_blobs]
        items += project_manual(extra_docs) + project_uploaded(uploads)
    items.sort(key=lambda item: (item['date'] or '', item['id']), reverse=True)
    return {'items': items, 'total': len(items)}


def json_list(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return value if isinstance(value, list) else []


def feedback_list(value):
    return [{key: str(row[key]) for key in ('id', 'author', 'date', 'message') if row.get(key) is not None}
            for row in json_list(value) if isinstance(row, dict)]


def load_detail(cursor, kind, pk, source, source_id):
    if source not in {'aptem', 'audit', 'uploaded'}:
        raise EvidenceError('Evidence not found.')
    if source != 'uploaded':
        try:
            source_id = int(source_id)
        except (ValueError, TypeError):
            raise EvidenceError('Evidence not found.')
    aptem_id = resolve_aptem(cursor, kind, pk)
    if aptem_id is None:
        raise EvidenceError('Evidence not found.')
    tables = available_tables(cursor)
    if source == 'uploaded':
        rows = uploaded_rows(cursor, aptem_id, tables, source_id)
        if not rows:
            raise EvidenceError('Evidence not found.')
        row = rows[0]
        docs = []
        if row['azure_container'] and row['azure_blob_name']:
            docs.append({'part': 'file', 'name': row['document_name'] or 'Evidence',
                'container': row['azure_container'], 'blob': row['azure_blob_name'],
                'content_type': mimetypes.guess_type(row['azure_blob_name'])[0]})
        if row.get('activity_id'):
            docs += [{'part': str(d['id']), 'name': d['display_name'], 'container': d['container'],
                      'blob': d['blob_name'], 'content_type': d['content_type']}
                     for d in manual_documents(cursor, aptem_id, tables, row['activity_id'], include_mirrored=True)]
        return project_uploaded(rows)[0], docs, row.get('activity_completion_note'), []
    if source == 'audit':
        docs = manual_documents(cursor, aptem_id, tables, source_id)
        if not docs:
            raise EvidenceError('Evidence not found.')
        return project_manual(docs)[0], [{'part': str(d['id']), 'name': d['display_name'],
            'container': d['container'], 'blob': d['blob_name'], 'content_type': d['content_type']} for d in docs], None, []
    rows = source_rows(cursor, aptem_id, tables, source_id)
    if not rows:
        raise EvidenceError('Evidence not found.')
    row = rows[0]
    item = project_source(rows, aptem_id)[0]
    name = item['name']
    docs = []
    def add(part, blob, label, container='fetch-aptem-evidences'):
        if blob:
            docs.append({'part': part, 'name': label, 'blob': blob, 'container': container,
                         'content_type': mimetypes.guess_type(blob)[0] or mimetypes.guess_type(label)[0]})
    add('file', row.get('replacement_blob') or row['file_blob'], row.get('replacement_name') or name,
        (row.get('replacement_container') or 'evidence-replacements') if row.get('replacement_blob') else 'fetch-aptem-evidences')
    add('report', row['report_blob'], _report_display_name(name, row['report_blob']))
    if row.get('replacement_blob'):
        add('original', row['file_blob'], name)
    if not row.get('note_content'):
        add('note', row.get('note_blob'), f'{name} - note')
    return item, docs, row.get('note_content'), feedback_list(row.get('feedbacks'))


@response
def historical_evidence_detail(request, kind, pk, source, source_id):
    with connections['enrolment'].cursor() as cursor:
        item, docs, note, feedbacks = load_detail(cursor, kind, pk, source, source_id)
    return {'item': item, 'documents': [{k: d[k] for k in ('part', 'name', 'content_type')} for d in docs],
            'note': note, 'feedbacks': feedbacks}


@response
def open_historical_document(request, kind, pk, source, source_id):
    with connections['enrolment'].cursor() as cursor:
        _, docs, _, _ = load_detail(cursor, kind, pk, source, source_id)
    doc = next((d for d in docs if d['part'] == request.GET.get('part')), None)
    if not doc:
        raise EvidenceError('Document not found.')
    if not evidence_storage.azure_configured():
        raise EvidenceError('The document store is unavailable. Please retry.', 503)
    try:
        url = evidence_storage.get_read_sas(doc['container'], doc['blob'])
        download = evidence_storage.get_download_sas(doc['container'], doc['blob'], filename=doc['name'])
    except Exception:
        raise EvidenceError('The document could not be opened. Please retry.', 503)
    return {'url': url, 'download_url': download, 'name': doc['name'], 'content_type': doc['content_type']}
