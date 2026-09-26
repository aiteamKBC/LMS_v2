"""Build a separately stored, review-only Monthly Logs reconstruction.

The reconstruction uses the existing formula preview rules, but persists the
result in a distinct table with an explicit ``provisional`` status.  It never
updates manual journal rows, approved revisions, signatures, or KSB history.
"""

from __future__ import annotations

import json
import uuid
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from audit_api.db_source import resolve
from audit_api.management.commands.reconcile_monthly_logs import LEARNERS
from old_otjh import repository as repo


TABLE = 'structured_manual_activities.monthly_log_provisional_rows'
END_MONTH = repo.CUTOFF
ACTOR = 'monthly-log-provisional-reconstruction-2026-08'
FORMULA_RULE = 'formula_reconstruction_v3:timestamps;reading_quiz_29m_snap_5m;media_duration_or_29m_preview;all_missing_actual;deterministic_ksb_preview'


def _has_hours(value):
    try:
        return float(value or 0) > 0
    except (TypeError, ValueError):
        return False


def _codes(value):
    if isinstance(value, list):
        return [str(item).strip().upper() for item in value if str(item).strip()]
    return []


def _month(value):
    if isinstance(value, date):
        return value.strftime('%Y-%m')
    return str(value or '')[:7]


class Command(BaseCommand):
    help = 'Dry-run/apply a review-only formula reconstruction for Monthly Logs.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Persist the provisional reconstruction.')
        parser.add_argument('--aptem-id', action='append', type=int, dest='aptem_ids', help='Limit to one agreed Aptem ID.')
        parser.add_argument('--json', action='store_true', dest='as_json', help='Emit JSON.')

    def handle(self, *args, **options):
        requested = sorted(set(options.get('aptem_ids') or LEARNERS))
        unknown = sorted(set(requested) - set(LEARNERS))
        if unknown:
            raise CommandError(f'Aptem IDs outside the agreed scope: {unknown}')
        report = self._run(requested, apply=bool(options.get('apply')))
        if options.get('as_json'):
            self.stdout.write(json.dumps(report, default=str, ensure_ascii=False, indent=2))
            return
        mode = 'APPLIED' if options.get('apply') else 'DRY-RUN'
        self.stdout.write(f'{mode} provisional Monthly Logs reconstruction ({report["run_id"]})')
        for item in report['students']:
            self.stdout.write(
                f"{item['aptem_id']} {item['learner']}: months={item['months']} "
                f"rows={item['rows']} fields={item['fields']} "
                f"actual={item['actual_fields']} planned={item['planned_fields']} ksb={item['ksb_fields']}"
            )
        self.stdout.write(f"total provisional fields: {report['totals']['fields']}")
        if not options.get('apply'):
            self.stdout.write('No database writes were performed. Re-run with --apply to persist this provisional layer.')

    def _connection_alias(self):
        return resolve('audit')

    def _months(self, cursor, aptem_id, lms_id):
        cursor.execute(f'''SELECT month FROM structured_manual_activities.manual_learner_activities
                           WHERE aptem_id=%s AND deleted_at IS NULL AND month<=%s
                           UNION
                           SELECT to_char(a.activity_date,'YYYY-MM')
                             FROM "Last_audit".activity_results r
                             JOIN "Last_audit".activities a ON a.activity_id=r.activity_id
                            WHERE r.learner_id=%s AND a.activity_date IS NOT NULL
                              AND a.activity_date<=%s::date
                           ORDER BY month''', [aptem_id, END_MONTH, lms_id, f'{END_MONTH}-31'])
        return [row[0] for row in cursor.fetchall() if row[0]]

    def _learner(self, cursor, aptem_id):
        cursor.execute('''SELECT learner_id, learner_name, learner_email, programme_name, coach_email,
                                 coach_name, planned_hours_monthly
                            FROM "Last_audit".learners WHERE aptem_id=%s LIMIT 1''', [aptem_id])
        row = cursor.fetchone()
        if not row:
            return None
        keys = ('lms_id', 'name', 'email', 'programme', 'coach_email', 'coach_name', 'planned_hours_monthly')
        return dict(zip(keys, row), aptem_id=aptem_id)

    def _plan(self, cursor, aptem_ids, run_id):
        plan = {'run_id': run_id, 'students': [], 'rows': []}
        for aptem_id in aptem_ids:
            learner = self._learner(cursor, aptem_id)
            if not learner:
                continue
            months = self._months(cursor, aptem_id, learner['lms_id'])
            student = {'aptem_id': aptem_id, 'learner': LEARNERS[aptem_id], 'months': len(months),
                       'rows': 0, 'fields': 0, 'actual_fields': 0, 'planned_fields': 0, 'ksb_fields': 0}
            for month in months:
                rows = repo.month_rows(learner, month)
                for row in rows:
                    projected = repo._demo_lms_rows(
                        [row], learner, month,
                        formula_note='PROVISIONAL FORMULA RECONSTRUCTION — REVIEW REQUIRED',
                        fill_attendance_missing=True,
                        fill_all_missing_actual=True,
                    )[0]
                    fields = []
                    if not _has_hours(row.get('planned_hours')) and _has_hours(projected.get('planned_hours')):
                        fields.append('planned')
                    if (row.get('actual_pending') or not _has_hours(row.get('actual_hours'))):
                        if _has_hours(projected.get('actual_hours')):
                            fields.append('actual')
                    if not _codes(row.get('ksb_codes')) and _codes(projected.get('ksb_codes')):
                        fields.append('ksb')
                    if not fields:
                        continue
                    source_ref = str(row.get('source_ref') or f"row:{row.get('id')}")
                    payload = {**projected, 'provisional': True,
                               'provisional_fields': sorted(fields),
                               'provisional_source': 'formula_reconstruction'}
                    # The persisted layer is provisional, never the older
                    # presentation-only demo mode used by the preview route.
                    payload.pop('demo_only', None)
                    action = {'aptem_id': aptem_id, 'month': month, 'source_ref': source_ref,
                              'payload': payload, 'fields': sorted(fields), 'formula_rule': FORMULA_RULE}
                    plan['rows'].append(action)
                    student['rows'] += 1
                    student['fields'] += len(fields)
                    student['actual_fields'] += int('actual' in fields)
                    student['planned_fields'] += int('planned' in fields)
                    student['ksb_fields'] += int('ksb' in fields)
            plan['students'].append(student)
        return plan

    def _ensure_table(self, cursor):
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {TABLE} (
            id bigserial PRIMARY KEY,
            run_id uuid NOT NULL,
            aptem_id bigint NOT NULL,
            month text NOT NULL,
            source_ref text NOT NULL,
            payload jsonb NOT NULL,
            provisional_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
            formula_rule text NOT NULL,
            status text NOT NULL DEFAULT 'provisional',
            created_by text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (aptem_id, month, source_ref)
        )''')
        cursor.execute(f'CREATE INDEX IF NOT EXISTS monthly_log_provisional_lookup ON {TABLE}(aptem_id, month, status)')

    def _apply(self, cursor, plan, run_id):
        for item in plan['rows']:
            fields = json.dumps(item['fields'], ensure_ascii=False)
            payload = json.dumps(item['payload'], default=str, ensure_ascii=False)
            cursor.execute(f'''INSERT INTO {TABLE}
                (run_id, aptem_id, month, source_ref, payload, provisional_fields, formula_rule, status, created_by)
                VALUES (%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,'provisional',%s)
                ON CONFLICT (aptem_id, month, source_ref) DO UPDATE SET
                    run_id=EXCLUDED.run_id, payload=EXCLUDED.payload,
                    provisional_fields={TABLE}.provisional_fields || EXCLUDED.provisional_fields,
                    formula_rule=EXCLUDED.formula_rule, status='provisional',
                    updated_at=now()''',
                [run_id, item['aptem_id'], item['month'], item['source_ref'], payload, fields, item['formula_rule'], ACTOR])

    def _run(self, aptem_ids, *, apply):
        run_id = str(uuid.uuid4())
        alias = self._connection_alias()
        conn = connections[alias]
        with transaction.atomic(using=alias):
            with conn.cursor() as cursor:
                plan = self._plan(cursor, aptem_ids, run_id)
                if apply:
                    self._ensure_table(cursor)
                    self._apply(cursor, plan, run_id)
            if not apply:
                transaction.set_rollback(True, using=alias)
        totals = {'fields': sum(item['fields'] for item in plan['students']),
                  'rows': len(plan['rows'])}
        return {'run_id': run_id, 'status': 'applied' if apply else 'dry_run',
                'students': plan['students'], 'totals': totals}
