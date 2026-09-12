"""Read-only inventory and PDF verification for missing current training-plan hours.

Never executes repair SQL or calls application endpoints. Private document paths
and downloaded PDFs stay under the ignored .cache directory.
Run from backend: python scripts/audit_training_plan_hours.py [--download]
"""
import argparse
import csv
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import md5, sha256
import json
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))

from config import settings
from learner_api.training_plan_contract import (
    contract_extract_metadata, parse_contract, read_verified_extract, selected_contract,
)

CACHE = ROOT / '.cache' / 'tp-planned-audit'


def source_identity(record):
    return sha256(json.dumps([record.get('azure_path'), str(record.get('fetched_at'))]).encode()).hexdigest()


def valid_hours(value):
    try:
        hours = Decimal(str(value))
        return hours.is_finite() and hours >= 0
    except (InvalidOperation, ValueError):
        return False


def inventory():
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(settings._enrolment_database_url, connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute('''SELECT id, "Username" AS name, "Learner_type" AS kind, aptem_id
                FROM enrolment."Created_users" ORDER BY id''')
            learners = cur.fetchall()
            cur.execute('''SELECT DISTINCT ON ("Learner_id", "Learner_kind")
                id, "Learner_id" AS learner_id, "Learner_kind" AS kind, "Otjh" AS otjh
                FROM enrolment."Training_Plan_Documents" WHERE "Status"='active'
                ORDER BY "Learner_id", "Learner_kind", "Created_at" DESC, id DESC''')
            local = {(r['learner_id'], r['kind']): r for r in cur.fetchall()}
            cur.execute('''SELECT c.id, c.learner_id, c.full_name, c.azure_path,
                c.training_plan_planned_hours, c.document_name AS original_name,
                coalesce(nullif(a.display_name,''),c.document_name) AS document_name,
                c.date, c.fetched_at, c.fully_signed_date, c.raw AS extraction_metadata
                FROM fetching_evidence.aptem_cv_contracts_probe c
                LEFT JOIN "Audit".contract_document_archive a ON a.contract_id=c.id
                WHERE lower(coalesce(nullif(a.display_name,''),c.document_name)) ~ 'training[[:space:]_-]*plan'
                  AND a.archived_at IS NULL AND a.deleted_at IS NULL
                ORDER BY c.learner_id, coalesce(c.fully_signed_date,c.date) DESC NULLS LAST,c.id DESC''')
            candidates = defaultdict(list)
            for record in cur.fetchall():
                candidates[record['learner_id']].append(record)
    current = {key: selected_contract(rows) for key, rows in candidates.items()}
    statuses = []
    for learner in learners:
        own = local.get((learner['id'], learner['kind']))
        aptem = str(learner['aptem_id'] or '').strip()
        plan = current.get(int(aptem)) if aptem.isdigit() else None
        if own:
            otjh = own['otjh']
            otjh = json.loads(otjh) if isinstance(otjh, str) else otjh
            state = 'local-ready' if isinstance(otjh, dict) and valid_hours(otjh.get('plannedTotal')) else 'local-missing-hours'
        elif plan:
            state = 'imported-ready' if valid_hours(plan['training_plan_planned_hours']) else 'imported-missing-hours'
        else:
            state = 'no-current-plan'
        statuses.append({**learner, 'state': state, 'contract_id': plan['id'] if plan and not own else None})
    records = list(current.values())
    result = {'checked_at': datetime.now(timezone.utc).isoformat(), 'learners': statuses, 'contracts': records}
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / 'inventory.json').write_text(json.dumps(result, default=str, indent=2), encoding='utf-8')
    print(json.dumps({'learners': len(learners), 'learner_states': dict(Counter(r['state'] for r in statuses)),
        'current_imported_plans': len(records), 'missing_hours': sum(not valid_hours(r['training_plan_planned_hours']) for r in records)}), flush=True)
    return result


def download(record):
    from azure.storage.blob import BlobServiceClient

    path = CACHE / 'tmp' / 'pdfs' / f"contract-{record['id']}.pdf"
    version_path = path.with_suffix('.source')
    identity = source_identity(record)
    if path.exists() and version_path.exists() and version_path.read_text() == identity:
        return path
    location = urlsplit(str(record.get('azure_path') or ''))
    container, blob = unquote(location.path).lstrip('/').split('/', 1)
    if location.scheme != 'az' or location.query or location.fragment or container != 'contracts' or not blob.startswith('aptem_cv_contracts_probe/'):
        raise ValueError('Unsupported contract location')
    if any(part in {'', '.', '..'} for part in blob.replace('\\', '/').split('/')):
        raise ValueError('Unsupported contract location')
    options = {'connection_timeout': 5, 'read_timeout': 15, 'retry_total': 0}
    with BlobServiceClient.from_connection_string(os.environ['AZURE_STORAGE_CONNECTION_STRING']) as service:
        client = service.get_blob_client(container=container, blob=blob)
        if client.get_blob_properties(**options).size > 30 * 1024 * 1024:
            raise ValueError('Oversized contract')
        data = client.download_blob(max_concurrency=1, **options).readall()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    version_path.write_text(identity)
    return path


def verify(record, path):
    import pymupdf

    data = path.read_bytes()
    months = parse_contract(data) or read_verified_extract(data, contract_extract_metadata(record.get('extraction_metadata')))
    result = {'contract_id': record['id'], 'learner_id': record['learner_id'], 'name': record['full_name'],
              'sha256': sha256(data).hexdigest(), 'source_identity': source_identity(record),
              'status': 'verified' if months else 'needs-review'}
    if months:
        result['planned_hours'] = str(sum(Decimal(str(m['planned'])) for m in months.values()))
        result['activity_count'] = sum(len(m['activities']) for m in months.values())
    with pymupdf.open(stream=data, filetype='pdf') as document:
        texts = [p.get_text() for p in document]
        result['pages'] = len(document)
        result['total_pages'] = [i+1 for i, text in enumerate(texts) if 'Total' in text and '(hr)' in text]
        result['has_text'] = any(len(text.strip()) > 100 for text in texts)
    return result


def download_and_verify(record):
    return verify(record, download(record))


def extract(snapshot, recheck=False):
    wanted = [r for r in snapshot['contracts'] if not valid_hours(r['training_plan_planned_hours'])]
    results_path = CACHE / 'extractions.json'
    previous = json.loads(results_path.read_text(encoding='utf-8')) if results_path.exists() else []
    identities = {r['id']: source_identity(r) for r in wanted}
    results = [r for r in previous if r.get('source_identity') == identities.get(r['contract_id'])
               and r['contract_id'] in identities
               and r['status'] == 'verified' and not recheck]
    done = {r['contract_id'] for r in results}
    wanted = [r for r in wanted if r['id'] not in done]
    # Each process owns its PDF parser; PyMuPDF must not be used across threads.
    with ProcessPoolExecutor(max_workers=3) as pool:
        jobs = {pool.submit(download_and_verify, r): r for r in wanted if r['azure_path']}
        for record in wanted:
            if not record['azure_path']:
                results.append({'contract_id': record['id'], 'learner_id': record['learner_id'],
                                'name': record['full_name'], 'status': 'missing-file'})
        for job in as_completed(jobs):
            record = jobs[job]
            try:
                result = job.result()
            except Exception as exc:
                result = {'contract_id': record['id'], 'learner_id': record['learner_id'],
                          'name': record['full_name'], 'status': 'unavailable', 'error': type(exc).__name__}
            results.append(result)
            (CACHE / 'extractions.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
            print(json.dumps({k: v for k, v in result.items() if k not in {'name', 'sha256'}}), flush=True)
    (CACHE / 'extractions.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
    print(json.dumps({'extraction_states': dict(Counter(r['status'] for r in results))}), flush=True)


def report(snapshot):
    """Write reviewable SQL; deliberately has no database execution path."""
    results = {r['contract_id']: r for r in json.loads((CACHE / 'extractions.json').read_text(encoding='utf-8'))}
    reviews_path = ROOT / 'reports' / 'tp-planned-manual-review-2026-09-12.json'
    for reviewed in json.loads(reviews_path.read_text(encoding='utf-8')):
        original = results.get(reviewed['contract_id'])
        if not original or original.get('sha256') != reviewed['sha256']:
            continue
        if 'page_activity_hours' in reviewed:
            total = sum(sum(hours) for hours in reviewed['page_activity_hours'].values())
        else:
            total = sum(reviewed['table_cell_hours']) + reviewed['continuation_activity_hours']
        if Decimal(str(total)) != Decimal(reviewed['planned_hours']) or total != reviewed['printed_total']:
            raise ValueError('Reviewed rows do not match the printed total')
        results[reviewed['contract_id']] = {**original, **reviewed, 'status': 'verified-manually'}

    contracts = {r['id']: r for r in snapshot['contracts']}
    enrolled = {r['contract_id']: r for r in snapshot['learners'] if r['contract_id'] is not None}
    approved, unresolved = [], []
    for record in snapshot['contracts']:
        if valid_hours(record['training_plan_planned_hours']):
            continue
        result = results.get(record['id'], {'contract_id': record['id'], 'status': 'not-checked'})
        if result['status'] not in {'verified', 'verified-manually'}:
            unresolved.append(result)
            continue
        if result.get('source_identity') != source_identity(record):
            raise ValueError('Recheck the changed document version before generating repairs')
        if not valid_hours(result['planned_hours']):
            raise ValueError('Invalid repair total')
        data = (CACHE / 'tmp' / 'pdfs' / f"contract-{record['id']}.pdf").read_bytes()
        if sha256(data).hexdigest() != result['sha256']:
            raise ValueError('Reviewed document bytes have changed')
        approved.append(result)
    approved.sort(key=lambda r: r['contract_id'])

    def quote(value):
        return "'" + str(value).replace("'", "''") + "'" if value is not None else 'NULL'

    values = []
    for result in approved:
        record = contracts[result['contract_id']]
        values.append('    (' + ', '.join([
            str(int(record['id'])), str(int(record['learner_id'])), format(Decimal(result['planned_hours']), '.2f'),
            quote(record['fetched_at']), quote(md5(record['azure_path'].encode()).hexdigest()),
            quote(result['sha256']), quote(result.get('source', 'learning-plan-table')),
        ]) + ')')
    if not values:
        raise ValueError('No verified repairs')
    ctes = '''WITH candidates AS (
    SELECT c.id, c.learner_id, c.date, c.azure_path,
           coalesce(nullif(c.document_name,''),a.display_name,'') AS original_name,
           row_number() OVER (PARTITION BY c.learner_id
               ORDER BY coalesce(c.fully_signed_date,c.date) DESC NULLS LAST,c.id DESC) AS position
    FROM fetching_evidence.aptem_cv_contracts_probe c
    LEFT JOIN "Audit".contract_document_archive a ON a.contract_id=c.id
    WHERE lower(coalesce(nullif(a.display_name,''),c.document_name)) ~ 'training[[:space:]_-]*plan'
      AND a.archived_at IS NULL AND a.deleted_at IS NULL
), current_contracts AS (
    SELECT top.learner_id,
           CASE WHEN nullif(top.azure_path,'') IS NULL AND top.date IS NOT NULL AND duplicate.n=1
                THEN duplicate.id ELSE top.id END AS id
    FROM candidates top
    LEFT JOIN LATERAL (
        SELECT count(*) AS n, min(d.id) AS id FROM candidates d
        WHERE d.learner_id=top.learner_id AND d.position>1 AND nullif(d.azure_path,'') IS NOT NULL
          AND date_trunc('second',d.date)=date_trunc('second',top.date)
          AND regexp_replace(lower(btrim(d.original_name)), '\\.pdf$', '')
              =regexp_replace(lower(btrim(top.original_name)), '\\.pdf$', '')
    ) duplicate ON true
    WHERE top.position=1
), fixes(contract_id, learner_id, hours, fetched_at, path_md5, pdf_sha256, source) AS (
    VALUES
''' + ',\n'.join(values) + '''
), eligible AS (
    SELECT f.* FROM fixes f
    JOIN current_contracts selected ON selected.id=f.contract_id AND selected.learner_id=f.learner_id
    JOIN fetching_evidence.aptem_cv_contracts_probe c ON c.id=f.contract_id AND c.learner_id=f.learner_id
    WHERE c.training_plan_planned_hours IS NULL
      AND c.fetched_at IS NOT DISTINCT FROM f.fetched_at::timestamptz
      AND md5(c.azure_path)=f.path_md5
      AND (c.raw IS NULL OR jsonb_typeof(c.raw::jsonb)='object')
)
'''
    output = ROOT / 'reports'
    output.mkdir(exist_ok=True)
    header = (f'-- Verified current training-plan hours: {len(approved)} contracts.\n'
              '-- Owner runs this single atomic statement in Neon SQL Editor. Not executed by the audit script.\n'
              '-- Re-running skips populated hours, changed document versions, and archived/deleted plans.\n'
              '-- Deploy the matching original-name duplicate selection fix for renamed documents.\n')
    repair = ctes + '''UPDATE fetching_evidence.aptem_cv_contracts_probe c
SET training_plan_planned_hours=e.hours,
    raw=jsonb_set(coalesce(c.raw::jsonb,'{}'::jsonb), '{_training_plan_hours}',
        jsonb_build_object('version',1,'source',e.source,'pdf_sha256',e.pdf_sha256,
                           'planned_hours',e.hours::text,'reviewed_at',now()),true)
FROM eligible e
WHERE c.id=e.contract_id AND c.learner_id=e.learner_id
  AND c.training_plan_planned_hours IS NULL
  AND c.fetched_at IS NOT DISTINCT FROM e.fetched_at::timestamptz
  AND md5(c.azure_path)=e.path_md5
RETURNING c.id AS contract_id,c.learner_id,c.training_plan_planned_hours;
'''
    (output / 'tp-planned-hours-repair-2026-09-12.sql').write_text(header + repair, encoding='utf-8')
    # The preview is the exact same selection, with SELECT instead of UPDATE.
    (CACHE / 'repair-preview.sql').write_text(ctes + 'SELECT contract_id,learner_id,hours FROM eligible ORDER BY contract_id;\n', encoding='utf-8')
    fields = ['contract_id', 'learner_id', 'enrolment_id', 'name', 'planned_hours', 'verification']
    with (output / 'tp-planned-hours-2026-09-12.csv').open('w', newline='', encoding='utf-8-sig') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for result in approved:
            writer.writerow({'contract_id': result['contract_id'], 'learner_id': result['learner_id'],
                'enrolment_id': enrolled.get(result['contract_id'], {}).get('id', ''),
                'name': result['name'], 'planned_hours': format(Decimal(result['planned_hours']), '.2f'),
                'verification': result['status']})
    summary = {'checked_at': snapshot['checked_at'], 'current_plans': len(snapshot['contracts']),
               'learners': len(snapshot['learners']), 'repairs': len(approved),
               'affected_enrolled_learners': sum(r['contract_id'] in enrolled for r in approved),
               'manual_reviews': sum(r['status'] == 'verified-manually' for r in approved), 'unresolved': unresolved}
    (CACHE / 'report-summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true', help='Verify PDFs for missing current plan totals.')
    parser.add_argument('--resume', action='store_true', help='Resume the existing inventory without a database query.')
    parser.add_argument('--recheck', action='store_true', help='Verify previously checked PDFs again.')
    parser.add_argument('--report', action='store_true', help='Write a CSV and repair SQL for manual execution only.')
    args = parser.parse_args()
    snapshot = json.loads((CACHE / 'inventory.json').read_text(encoding='utf-8')) if args.resume else inventory()
    if args.download:
        extract(snapshot, args.recheck)
    if args.report:
        report(snapshot)
