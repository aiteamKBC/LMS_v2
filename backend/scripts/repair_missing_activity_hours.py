"""Dry-run first, evidence-only repair of missing activity hours/months.

No Django startup, schema changes, external services or implicit writes. Apply
requires the exact database identity, reviewed plan fingerprint and a private
backup outside this repository. Existing approvals and signed months stay intact.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from learner_api.activity_hours_repair import build_plan, summary  # noqa: E402

READ_SQL = '''
SELECT p.id,p.learner_id,p.kind,p.component_ref,p.component_type,p.quiz_ref,p.passed,
    p.source_system,p.source_activity_id,p.source_attempt_key,p.actual_seconds,p.actual_basis,
    p.reporting_month,p.reporting_started_at,p.reporting_ended_at,p.submitted_at,p.declared_completed_at,
    p.claimed_seconds,p.verified_seconds,p.time_tracking_source,p.accepted,p.deleted_at,
    p.ssot_updated_at,p.source_payload,
    (u.id IS NOT NULL AND nullif(btrim(l.email),'') IS NOT NULL
      AND lower(btrim(l.email))=lower(btrim(u."Email"))
      AND (nullif(ltrim(u.aptem_id::text,'0'),'') IS NULL
           OR ltrim(u.aptem_id::text,'0')=ltrim(l.aptem_id::text,'0'))) AS identity_valid,
    EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id) AS transfer_active,
    EXISTS(SELECT 1 FROM "Learner".learner_activity_reporting_segments seg
           WHERE seg.progress_id=p.id AND seg.learner_id=p.learner_id) AS has_segments,
    EXISTS(SELECT 1 FROM "Learner".learner_progress_entries other
      WHERE other.learner_id=p.learner_id AND other.deleted_at IS NULL
        AND other.source_payload->>'retakeTimeChoice' IN ('keep','new','correct','add','retry')
        AND (other.id=p.id OR (nullif(p.component_ref,'') IS NOT NULL AND other.component_ref=p.component_ref)
             OR (nullif(p.quiz_ref,'') IS NOT NULL AND other.quiz_ref=p.quiz_ref))) AS has_retake_choices,
    EXISTS(SELECT 1 FROM "Learner".learner_progress_entries other
      WHERE other.learner_id=p.learner_id AND other.id<>p.id AND other.deleted_at IS NULL
        AND ((other.accepted IS TRUE AND other.actual_seconds>0)
             OR (coalesce(other.source_system,'')='' AND other.actual_seconds IS NULL
                 AND other.component_link_source IN ('direct','quiz_ref') AND other.submitted_at IS NOT NULL))
        AND ((nullif(p.component_ref,'') IS NOT NULL AND other.component_ref=p.component_ref)
             OR (nullif(p.quiz_ref,'') IS NOT NULL AND other.quiz_ref=p.quiz_ref))) AS other_credit,
    coalesce(src.sources,'[]'::jsonb) AS sources,
    CASE WHEN marking.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',marking.id,'status',marking.status,'actual_time_hours',marking.actual_time_hours,
      'dated_entries',marking.full_submission #> '{monthlyAssignment,timeEntries}') END AS marking,
    ARRAY(SELECT report_month FROM "Learner".learner_monthly_signatures
          WHERE learner_id=l.id AND review_confirmed IS TRUE
      UNION SELECT report_month FROM "Learner".learner_monthly_locks
          WHERE learner_id=l.id AND locked_at IS NOT NULL AND unlocked_at IS NULL
      UNION SELECT report_month FROM "Learner".monthly_audit_signoffs
          WHERE learner_id=l.aptem_id::text AND review_confirmed IS TRUE
      UNION SELECT report_month FROM (
          SELECT DISTINCT ON (report_month) report_month,event_type
          FROM "Learner".manual_month_finalization_events WHERE aptem_id=l.aptem_id
          ORDER BY report_month,id DESC) finalization WHERE event_type='finalized') AS protected_months
FROM "Learner".learner_progress_entries p
JOIN "Learner".learners l ON l.id=p.learner_id AND l.enrolment_id IS NOT NULL
LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object(
    'id',s.id,'learner_id',s.learner_id,'canonical_progress_id',s.canonical_progress_id,
    'source_system',s.source_system,'source_activity_id',s.source_activity_id,'source_attempt_key',s.source_attempt_key,
    'reporting_month',s.reporting_month,'reporting_started_at',s.reporting_started_at,'reporting_ended_at',s.reporting_ended_at)
    ORDER BY s.id) AS sources FROM "Learner".learner_activity_sources s
    WHERE s.canonical_progress_id=p.id AND s.learner_id=p.learner_id AND s.deleted_at IS NULL) src ON TRUE
LEFT JOIN LATERAL(SELECT s.id,s.status,s.actual_time_hours,s.full_submission
    FROM "Learner".learning_reflection_submissions s
    WHERE s.learner_id=l.enrolment_id::text AND s.learner_kind=l.learner_type AND s.activity_type='assignment'
      AND (s.progress_entry_id=p.id OR (nullif(p.component_ref,'') IS NOT NULL AND s.component_ref=p.component_ref))
    ORDER BY s.submitted_at DESC NULLS LAST,s.id DESC LIMIT 1) marking ON TRUE
WHERE p.deleted_at IS NULL AND p.accepted IS TRUE AND (
    (p.actual_seconds>0 AND nullif(p.reporting_month,'') IS NULL
     AND (p.submitted_at IS NULL OR to_char(p.submitted_at AT TIME ZONE 'Europe/London','YYYY-MM')<'2026-10'))
    OR (p.actual_seconds IS NULL AND p.source_system='new_lms'))
ORDER BY p.id
'''


def database_url():
    values = dict(os.environ)
    for line in (BACKEND / '.env').read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    value = next((values.get(key) for key in ('ENROLMENT_DATABASE_URL', 'Database_url', 'DATABASEURL', 'DATABASE_URL')
                  if values.get(key)), None)
    if not value:
        raise ValueError('No enrolment database configured.')
    return value


def apply_plan(connection, plan, rows):
    from psycopg import sql
    from psycopg.types.json import Jsonb
    originals = {row['id']: row for row in rows}
    changed = 0
    for item in plan['changes']:
        before = originals[item['id']]
        metadata = before.get('source_payload') or {}
        if not isinstance(metadata, dict):
            raise ValueError('Non-object source metadata requires a separate review.')
        if 'activity_hours_repairs' in metadata and not isinstance(metadata['activity_hours_repairs'], list):
            raise ValueError('Repair history requires a separate review.')
        history = list(metadata.get('activity_hours_repairs', []))
        history.append({'at': datetime.now(timezone.utc).isoformat(), 'plan': plan['fingerprint'],
                        'before': json.loads(json.dumps(item['before'], default=str)),
                        'after': json.loads(json.dumps(item['after'], default=str)),
                        'evidence': item['evidence'], 'source_ids': item['source_ids'], 'marking_id': item['marking_id']})
        updates = {**item['after'], 'source_payload': Jsonb({**metadata, 'activity_hours_repairs': history})}
        setters = sql.SQL(',').join(sql.SQL('{}=%s').format(sql.Identifier(key)) for key in updates)
        guards = sql.SQL(' AND ').join(sql.SQL('{} IS NOT DISTINCT FROM %s').format(sql.Identifier(key)) for key in item['before'])
        statement = sql.SQL('''UPDATE "Learner".learner_progress_entries SET {},ssot_updated_at=now()
            WHERE id=%s AND learner_id=%s AND accepted IS TRUE AND deleted_at IS NULL
              AND ssot_updated_at IS NOT DISTINCT FROM %s AND {} RETURNING id''').format(setters, guards)
        result = connection.execute(statement, [*updates.values(), item['id'], item['learner_id'],
                                               before.get('ssot_updated_at'), *item['before'].values()]).fetchall()
        if len(result) != 1:
            raise ValueError('A candidate changed; the entire repair was rolled back.')
        verify = connection.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s',
                                    [item['id'], item['learner_id']]).fetchone()
        if any(verify[key] != value for key, value in item['after'].items()):
            raise ValueError('Post-update verification failed; the entire repair was rolled back.')
        changed += 1
    return changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--hostaddr', help='Optional already-verified DNS address; hostname/TLS identity is retained.')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expect-plan')
    parser.add_argument('--backup-file', type=Path)
    args = parser.parse_args()
    dsn = database_url()
    target = urlsplit(dsn)
    if target.hostname != args.expected_host or target.path.lstrip('/') != args.expected_database:
        raise ValueError('Configured database does not match the explicitly verified target.')
    if args.apply and (not args.expect_plan or not args.backup_file):
        raise ValueError('Apply requires the reviewed fingerprint and a private backup path.')
    if args.backup_file and args.backup_file.resolve().is_relative_to(BACKEND.parent):
        raise ValueError('Database backups must be outside the repository.')
    import psycopg
    from psycopg.rows import dict_row
    options = {'hostaddr': args.hostaddr} if args.hostaddr else {}
    with psycopg.connect(dsn, connect_timeout=15, row_factory=dict_row, **options) as connection:
        connection.read_only = not args.apply
        connection.isolation_level = psycopg.IsolationLevel.SERIALIZABLE
        connection.execute("SET LOCAL statement_timeout='30s'")
        connection.execute("SET LOCAL lock_timeout='3s'")
        actual = connection.execute('SELECT current_database() AS name').fetchone()['name']
        if actual != args.expected_database:
            raise ValueError('Connected database does not match the verified target.')
        rows = connection.execute(READ_SQL).fetchall()
        plan = build_plan(rows)
        if not args.apply:
            print(json.dumps({'mode': 'read_only', **summary(plan)}))
            return
        if args.expect_plan != plan['fingerprint']:
            raise ValueError('Evidence changed since dry run; review a fresh plan before applying.')
        if plan['changes']:
            connection.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE',
                               [sorted({item['learner_id'] for item in plan['changes']})]).fetchall()
            connection.execute('SELECT id FROM "Learner".learner_progress_entries WHERE id=ANY(%s) ORDER BY id FOR UPDATE',
                               [[item['id'] for item in plan['changes']]]).fetchall()
            connection.execute('SELECT id FROM "Learner".learner_activity_sources WHERE id=ANY(%s) ORDER BY id FOR SHARE',
                               [sorted({ident for item in plan['changes'] for ident in item['source_ids']})]).fetchall()
            connection.execute('SELECT id FROM "Learner".learning_reflection_submissions WHERE id=ANY(%s) ORDER BY id FOR SHARE',
                               [sorted({item['marking_id'] for item in plan['changes'] if item['marking_id'] is not None})]).fetchall()
        originals = {row['id']: row for row in rows}
        backup = {'database': actual, 'host': target.hostname, 'plan': plan,
                  'before': [{key: originals[item['id']].get(key)
                              for key in {'id', 'learner_id', 'ssot_updated_at', 'source_payload', *item['after']}}
                             for item in plan['changes']]}
        with args.backup_file.open('x', encoding='utf-8') as handle:
            json.dump(backup, handle, default=str, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        changed = apply_plan(connection, plan, rows)
    print(json.dumps({'mode': 'applied', 'verified_updates': changed, **summary(plan)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Connection exceptions can contain credentials. Print only controlled
        # validation messages or the exception class; never connection details.
        print(str(error) if isinstance(error, ValueError) else type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
