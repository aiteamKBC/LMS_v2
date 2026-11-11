"""Restore a scoped assignment's submitted hours from matching saved input.

Dry-run by default. No Django startup, schema changes or external integrations.
Only an accepted learner input matching its dated entries and progress claim can
replace a field demonstrably copied from the verified session timer. Closed
approvals, unlinked/ambiguous records and staff corrections remain untouched.
"""
import argparse
from collections import Counter
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from learner_api.activity_hours_repair import approved_seconds, instant  # noqa: E402
from scripts.repair_missing_activity_hours import database_url  # noqa: E402

HISTORY = 'assignment_input_hours_repairs'
READ_SQL = '''
SELECT to_jsonb(s) AS submission,l.id AS profile_id,l.full_name AS learner_name,
    l.cohort AS profile_cohort,c.cohort_name AS catalogue_cohort,u."Cohort" AS enrolment_cohort,
    (u.id IS NOT NULL AND nullif(btrim(l.email),'') IS NOT NULL
     AND lower(btrim(l.email))=lower(btrim(u."Email"))
     AND (nullif(ltrim(u.aptem_id::text,'0'),'') IS NULL
          OR ltrim(u.aptem_id::text,'0')=ltrim(l.aptem_id::text,'0'))) AS identity_valid,
    EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id) AS transfer_active,
    EXISTS(SELECT 1 FROM "Learner".learner_activity_reporting_segments seg
      JOIN "Learner".learner_progress_entries p ON p.id=seg.progress_id AND p.learner_id=seg.learner_id
      WHERE p.learner_id=l.id AND p.component_ref=s.activity_id AND p.deleted_at IS NULL) AS has_segments,
    (SELECT count(*) FROM "Learner".learning_reflection_submissions other
      WHERE other.learner_id=s.learner_id AND other.learner_kind=s.learner_kind
        AND other.activity_id=s.activity_id AND other.activity_type='assignment'
        AND other.status IN ('accepted','partial')) AS accepted_submissions,
    coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id)
      FROM "Learner".learner_progress_entries p WHERE p.learner_id=l.id
        AND p.component_ref=s.activity_id AND p.deleted_at IS NULL),'[]'::jsonb) AS progress,
    ARRAY(SELECT report_month FROM "Learner".learner_monthly_signatures
          WHERE learner_id=l.id AND review_confirmed IS TRUE
      UNION SELECT report_month FROM "Learner".learner_monthly_locks
          WHERE learner_id=l.id AND locked_at IS NOT NULL AND unlocked_at IS NULL
      UNION SELECT report_month FROM "Learner".monthly_audit_signoffs
          WHERE learner_id=l.aptem_id::text AND review_confirmed IS TRUE
      UNION SELECT report_month FROM (
          SELECT DISTINCT ON (report_month) report_month,event_type
          FROM "Learner".manual_month_finalization_events WHERE aptem_id=l.aptem_id
          ORDER BY report_month,id DESC) f WHERE event_type='finalized') AS protected_months
FROM "Learner".learning_reflection_submissions s
LEFT JOIN "Learner".learners l ON l.enrolment_id::text=s.learner_id AND l.learner_type=s.learner_kind
LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
LEFT JOIN curriculum.cohorts c ON c.cohort_id=l.cohort_id
WHERE s.activity_type='assignment' AND s.activity_id=%s ORDER BY s.id
'''


def serial(value):
    def encode(value):
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, datetime):
            # Match PostgreSQL to_jsonb's fractional-second representation.
            return re.sub(r'(\.\d*?)0+(?=[+-]\d{2}:\d{2}$|$)', r'\1', value.isoformat())
        return value.isoformat() if hasattr(value, 'isoformat') else str(value)
    return json.loads(json.dumps(value, default=encode))


def digest(value):
    return hashlib.sha256(json.dumps(serial(value), sort_keys=True).encode()).hexdigest()


def plan_row(row, component, cohort):
    saved = row['submission']
    if saved['activity_id'] != component or saved['activity_type'] != 'assignment':
        return None, 'different_activity'
    if saved['status'] != 'accepted':
        return None, 'not_accepted'
    content = saved.get('full_submission') or {}
    if not isinstance(content, dict) or content.get('submissionOrigin') != 'learner' or content.get('assignmentTimeSource') != 'input':
        return None, 'input_evidence_unavailable'
    old, entered = approved_seconds(saved.get('actual_time_hours')), approved_seconds(content.get('actualTimeHours'))
    if old == entered and old is not None:
        return None, 'already_matches'
    if old is None or entered is None:
        return None, 'preserve_zero_or_missing_duration'
    if not row.get('identity_valid') or any(str(row.get(key) or '').strip().casefold() != cohort.casefold()
        for key in ('profile_cohort', 'catalogue_cohort', 'enrolment_cohort')):
        return None, 'owner_or_cohort_mismatch'
    if (str(content.get('learnerId')) != saved['learner_id'] or content.get('learnerKind') != saved['learner_kind']
            or content.get('activityId') != component):
        return None, 'payload_owner_mismatch'
    monthly = content.get('monthlyAssignment') or {}
    entries = monthly.get('timeEntries') if isinstance(monthly, dict) else None
    if not isinstance(entries, list) or not entries:
        return None, 'dated_input_unavailable'
    try:
        months = {date.fromisoformat(item['date']).strftime('%Y-%m') for item in entries}
        values = [approved_seconds(item['hours']) for item in entries]
    except (KeyError, TypeError, ValueError):
        return None, 'invalid_dated_input'
    submitted = instant(saved.get('submitted_at'))
    if len(months) != 1 or not submitted or next(iter(months)) > submitted.strftime('%Y-%m'):
        return None, 'date_requires_review'
    if any(value is None for value in values) or sum(values) != entered:
        return None, 'daily_total_differs'
    records = row.get('progress') or []
    involved_months = months | {p.get('reporting_month') for p in records}
    involved_months |= {at.strftime('%Y-%m') for p in records for field in ('submitted_at', 'declared_completed_at')
                       if (at := instant(p.get(field)))}
    if involved_months.intersection(row.get('protected_months', [])):
        return None, 'signed_locked_or_finalized_month'
    if row.get('transfer_active') or row.get('has_segments'):
        return None, 'protected_history'
    if len(records) != 1 or row.get('accepted_submissions') != 1:
        return None, 'ambiguous_or_unlinked_activity'
    progress = records[0]
    if progress['learner_id'] != row['profile_id'] or progress.get('component_ref') != component:
        return None, 'progress_owner_mismatch'
    if progress.get('claimed_seconds') != entered or progress.get('verified_seconds') != old:
        return None, 'timer_overwrite_not_proven'
    if progress.get('reporting_month') and progress['reporting_month'] not in months:
        return None, 'allocation_requires_review'
    metadata = progress.get('source_payload') or {}
    if not isinstance(metadata, dict) or not isinstance(metadata.get(HISTORY, []), list) or metadata.get('retakeTimeChoice'):
        return None, 'progress_history_requires_review'
    stored = progress.get('actual_seconds') is not None
    if stored:
        history = metadata.get('activity_hours_repairs') or []
        if (progress.get('source_system') != 'new_lms' or progress.get('actual_basis') != 'repair:approved_assignment'
                or progress['actual_seconds'] != old or progress.get('accepted') is not True
                or not isinstance(history, list) or not history
                or str(history[-1].get('marking_id')) != str(saved['id'])
                or history[-1].get('after', {}).get('actual_seconds') != old):
            return None, 'preserve_other_recorded_hours'
    elif progress.get('source_system') or progress.get('component_link_source') not in ('direct', 'quiz_ref'):
        return None, 'preserve_other_duration_source'
    return {'submission_id': saved['id'], 'progress_id': progress['id'], 'profile_id': row['profile_id'],
            'old_seconds': old, 'seconds': entered, 'hours': str(content['actualTimeHours']).strip(),
            'update_stored_seconds': stored, 'month': next(iter(months)),
            'evidence_digest': digest(row)}, None


def build_plan(rows, component, cohort):
    changes, skipped = [], Counter()
    for row in rows:
        change, reason = plan_row(row, component, cohort)
        if change:
            changes.append(change)
        else:
            skipped[reason] += 1
    changes.sort(key=lambda value: value['submission_id'])
    return {'changes': changes, 'skipped': dict(skipped), 'fingerprint': digest(changes)}


def summary(plan):
    changes = plan['changes']
    return {'submissions': len(changes), 'learners': len({c['profile_id'] for c in changes}),
            'stored_hour_updates': sum(c['update_stored_seconds'] for c in changes),
            'previous_hours': round(sum(c['old_seconds'] for c in changes) / 3600, 4),
            'corrected_hours': round(sum(c['seconds'] for c in changes) / 3600, 4),
            'skipped': plan['skipped'], 'fingerprint': plan['fingerprint']}


def apply_plan(connection, plan, rows):
    from psycopg.types.json import Jsonb
    originals = {row['submission']['id']: row for row in rows}
    for item in plan['changes']:
        row = originals[item['submission_id']]
        saved, progress = row['submission'], row['progress'][0]
        if digest(row) != item['evidence_digest']:
            raise ValueError('Evidence differs from the reviewed plan.')
        updated = connection.execute('''UPDATE "Learner".learning_reflection_submissions
            SET actual_time_hours=%s WHERE id=%s AND learner_id=%s AND learner_kind=%s
              AND activity_id=%s AND status='accepted' AND actual_time_hours=%s
              AND full_submission=%s RETURNING *''',
            [item['hours'], saved['id'], saved['learner_id'], saved['learner_kind'], saved['activity_id'],
             saved['actual_time_hours'], Jsonb(saved['full_submission'])]).fetchone()
        if updated is None or serial(updated) != {**saved, 'actual_time_hours': item['hours']}:
            raise ValueError('Submission verification failed; the transaction must roll back.')
        metadata = progress.get('source_payload') or {}
        event = {'at': datetime.now(timezone.utc).isoformat(), 'plan': plan['fingerprint'],
                 'reason': 'Restore saved learner input overwritten by the verified session timer.',
                 'submission_id': saved['id'], 'previous_submitted_hours': saved['actual_time_hours'],
                 'submitted_hours': item['hours'], 'previous_actual_seconds': progress.get('actual_seconds'),
                 'seconds': item['seconds']}
        metadata = {**metadata, HISTORY: [*metadata.get(HISTORY, []), event]}
        seconds = item['seconds'] if item['update_stored_seconds'] else None
        basis = 'repair:submitted_assignment_input' if item['update_stored_seconds'] else progress.get('actual_basis')
        updated = connection.execute('''UPDATE "Learner".learner_progress_entries
            SET actual_seconds=%s,actual_basis=%s,source_payload=%s,ssot_updated_at=CURRENT_TIMESTAMP
            WHERE id=%s AND learner_id=%s AND component_ref=%s AND deleted_at IS NULL
              AND actual_seconds IS NOT DISTINCT FROM %s AND actual_basis IS NOT DISTINCT FROM %s
              AND source_payload IS NOT DISTINCT FROM %s AND ssot_updated_at IS NOT DISTINCT FROM %s RETURNING *''',
            [seconds, basis, Jsonb(metadata), progress['id'], row['profile_id'], saved['activity_id'],
             progress.get('actual_seconds'), progress.get('actual_basis'),
             Jsonb(progress['source_payload']) if progress.get('source_payload') is not None else None,
             progress.get('ssot_updated_at')]).fetchone()
        if updated is None:
            raise ValueError('Progress changed; the transaction must roll back.')
        actual = serial(updated)
        expected = {**progress, 'actual_seconds': seconds, 'actual_basis': basis, 'source_payload': metadata,
                    'ssot_updated_at': actual['ssot_updated_at']}
        if actual != expected:
            raise ValueError('Progress verification failed; the transaction must roll back.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--component', required=True)
    parser.add_argument('--cohort', required=True)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--expected-database', required=True)
    parser.add_argument('--hostaddr')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expect-plan')
    parser.add_argument('--expected-count', type=int)
    parser.add_argument('--backup-file', type=Path)
    args = parser.parse_args()
    dsn = database_url()
    target = urlsplit(dsn)
    if target.hostname != args.expected_host or target.path.lstrip('/') != args.expected_database:
        raise ValueError('Configured database differs from the verified target.')
    if args.apply and (not args.expect_plan or not args.expected_count or not args.backup_file):
        raise ValueError('Apply requires the reviewed count, fingerprint and a private backup.')
    if args.backup_file and args.backup_file.resolve().is_relative_to(BACKEND.parent):
        raise ValueError('The backup must be outside the repository.')
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
            raise ValueError('Connected database differs from the verified target.')
        rows = connection.execute(READ_SQL, [args.component]).fetchall()
        plan = build_plan(rows, args.component, args.cohort)
        if not args.apply:
            print(json.dumps({'mode': 'read_only', **summary(plan)}))
            return
        if args.expect_plan != plan['fingerprint'] or len(plan['changes']) != args.expected_count:
            raise ValueError('The proposed correction changed; review a new dry run.')
        for table, ids in (
            ('learners', [c['profile_id'] for c in plan['changes']]),
            ('learning_reflection_submissions', [c['submission_id'] for c in plan['changes']]),
            ('learner_progress_entries', [c['progress_id'] for c in plan['changes']]),
        ):
            # Table names are fixed above, never supplied by the operator.
            connection.execute(f'SELECT id FROM "Learner".{table} WHERE id=ANY(%s) ORDER BY id FOR UPDATE', [ids]).fetchall()
        backup = {'database': actual, 'host': target.hostname, 'component': args.component, 'cohort': args.cohort,
                  'plan': plan, 'rows': rows}
        with args.backup_file.open('x', encoding='utf-8') as handle:
            json.dump(serial(backup), handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        apply_plan(connection, plan, rows)
    print(json.dumps({'mode': 'applied', **summary(plan)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, ValueError) else type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
