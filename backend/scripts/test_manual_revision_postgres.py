"""Exercise revision consumers against a fresh, disposable PostgreSQL cluster.

Run from the repo root: python backend/scripts/test_manual_revision_postgres.py
Never reads application DB credentials or connects to Development/Production.
The fixture models the supplied 28-column contract, not a production snapshot.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from decimal import Decimal, ROUND_HALF_UP
import importlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import psycopg

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))

DDL = '''
CREATE SCHEMA "Learner";
CREATE SCHEMA "Last_audit";
CREATE SCHEMA curriculum;
CREATE TABLE curriculum.programmes(programme_id text PRIMARY KEY, name text);
CREATE TABLE curriculum.coaches(id text PRIMARY KEY, name text, email text);
CREATE TABLE "Learner".learners(
 id bigint PRIMARY KEY, aptem_id bigint, enrolment_id bigint, programme_id text,
 full_name text, email text, start_date date, end_date date, learner_type text, coach_id text);
CREATE TABLE "Learner".manual_month_finalization_events(
 id bigserial PRIMARY KEY, learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
 report_month text NOT NULL, event_type text NOT NULL);
CREATE TABLE "Learner".learner_monthly_targets(learner_id bigint,report_month text,month_status text);
CREATE TABLE "Learner".learner_monthly_signatures(learner_id bigint,report_month text,review_confirmed boolean);
CREATE TABLE "Learner".monthly_audit_signoffs(learner_id text,report_month text,review_confirmed boolean);
CREATE TABLE "Last_audit".activities(
 activity_id bigint PRIMARY KEY, configured_duration_min numeric, quiz_id bigint,
 reading_type text, reading_iframe_url text, reading_text_body text);
CREATE TABLE "Learner".learner_journal_rows(
 id bigint PRIMARY KEY, learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
 aptem_id bigint, month text, category text, title text, activity_id bigint,
 planned_hours numeric, actual_hours numeric, timestamp_label text,
 accepted boolean DEFAULT true, deleted_at timestamptz, updated_by text, updated_at timestamptz,
 UNIQUE(id,learner_id));
CREATE TABLE "Learner".manual_activity_hours_revision(
 revision_id bigserial PRIMARY KEY,
 row_id bigint NOT NULL,
 learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
 selected_month text NOT NULL,
 category text NOT NULL,
 previous_actual_hours numeric,
 proposed_actual_hours numeric,
 previous_planned_hours numeric,
 proposed_planned_hours numeric,
 planned_basis text,
 basis text,
 reference_seconds integer,
 offset_minutes integer NOT NULL DEFAULT 0,
 offset_mode text NOT NULL DEFAULT 'fixed',
 status text NOT NULL DEFAULT 'pending',
 proposed_by text NOT NULL,
 proposed_by_source text,
 proposed_at timestamptz NOT NULL DEFAULT now(),
 decided_by text,
 decided_by_source text,
 decided_at timestamptz,
 base_fingerprint text NOT NULL,
 rule_version text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 approval_removed_by text,
 approval_removed_by_source text,
 approval_removed_at timestamptz,
 FOREIGN KEY(row_id,learner_id) REFERENCES "Learner".learner_journal_rows(id,learner_id)
   ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(proposed_actual_hours IS NULL OR round(proposed_actual_hours*3600)>0),
 CHECK(proposed_actual_hours IS NOT NULL OR proposed_planned_hours IS NOT NULL),
 CHECK(status IN ('pending','approved','rejected','superseded')),
 CHECK(decided_by IS NULL OR decided_by<>proposed_by OR proposed_by_source='workspace'),
 CHECK((status IN ('pending','superseded') AND decided_by IS NULL AND decided_at IS NULL)
    OR (status IN ('approved','rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)));
CREATE UNIQUE INDEX manual_activity_hours_revision_pending_uq
 ON "Learner".manual_activity_hours_revision(row_id) WHERE status='pending';
CREATE INDEX manual_activity_hours_revision_row_id_idx ON "Learner".manual_activity_hours_revision(row_id);
CREATE INDEX manual_hours_revision_learner_idx ON "Learner".manual_activity_hours_revision(learner_id);
CREATE INDEX manual_hours_revision_journal_idx ON "Learner".manual_activity_hours_revision(row_id,learner_id);
CREATE INDEX manual_hours_revision_learner_month_status_idx
 ON "Learner".manual_activity_hours_revision(learner_id,selected_month,status);
INSERT INTO "Learner".learners(id,aptem_id) VALUES(1,101),(2,202);
INSERT INTO "Last_audit".activities VALUES(10,30,NULL,'text',NULL,'synthetic');
'''


class RevisionContractTests(unittest.TestCase):
    def setUp(self):
        self.db = psycopg.connect(**CONFIG, autocommit=True)
        self.addCleanup(self.db.close)
        self.db.execute('TRUNCATE "Learner".manual_activity_hours_revision, "Learner".learner_journal_rows RESTART IDENTITY')
        self.db.execute('''TRUNCATE "Learner".manual_month_finalization_events,
            "Learner".learner_monthly_targets,"Learner".learner_monthly_signatures,
            "Learner".monthly_audit_signoffs''')
        self.db.execute('''INSERT INTO "Learner".learner_journal_rows
            (id,learner_id,aptem_id,month,category,activity_id,planned_hours,actual_hours,timestamp_label)
            VALUES(11,1,101,'2026-01','reading+quiz',10,0,0,''),
                  (22,2,202,'2026-01','reading+quiz',10,0,0,'')''')
        # Component evidence is a separate read-only subsystem. Supply a fixed
        # historical allocation; all revision/journal SQL executes unmocked.
        for name, value in (
            ('learner_hour_context', dict(planned_hours=10, target_hours=10, completed_hours=0,
                                         component_allocation_available=True)),
            ('lms_planned_hours', (Decimal('2'), 1)),
            ('lms_components', []),
        ):
            mocker = patch.object(journal, name, return_value=value)
            mocker.start()
            self.addCleanup(mocker.stop)

    def calculate(self, *, db=None, owner=1, **kwargs):
        with (db or self.db).transaction(), (db or self.db).cursor() as c:
            return journal.calculate(c, learner_id=owner, aptem_id=101 if owner == 1 else 202,
                                     month='2026-01', actor=PROPOSER, offset_mode='fixed', **kwargs)

    def decide(self, *, db=None, owner=1, actor=None, **kwargs):
        with (db or self.db).transaction(), (db or self.db).cursor() as c:
            return journal.decide(c, learner_id=owner, month='2026-01',
                                  actor=actor or APPROVER, **kwargs)

    def pending(self, owner=1):
        with self.db.cursor() as c:
            return journal.pending(c, owner, '2026-01')

    def history(self, owner=1):
        with self.db.cursor() as c:
            return journal.history(c, owner, '2026-01')

    def test_contract_sequence_constraints_and_no_legacy(self):
        columns = self.db.execute("""SELECT column_name FROM information_schema.columns
            WHERE table_schema='Learner' AND table_name='manual_activity_hours_revision'""").fetchall()
        self.assertEqual(len(columns), 28)
        self.assertTrue({'aptem_id','comment','approval_remove_comment','proposed_seconds'}.isdisjoint(c[0] for c in columns))
        sequence = self.db.execute("SELECT pg_get_serial_sequence('\"Learner\".manual_activity_hours_revision','revision_id')").fetchone()[0]
        self.assertEqual(sequence, '"Learner".manual_activity_hours_revision_revision_id_seq')
        self.assertTrue(all(r[0] for r in self.db.execute("""SELECT convalidated FROM pg_constraint
            WHERE conrelid='"Learner".manual_activity_hours_revision'::regclass AND contype='f'""")))
        self.assertIsNone(self.db.execute("SELECT to_regnamespace('structured_manual_activities')").fetchone()[0])
        self.assertEqual(self.calculate()['proposals_created'], 1)
        self.assertEqual(self.pending()[0]['revision_id'], 1)
        self.assertEqual(self.db.execute('SELECT learner_id FROM "Learner".manual_activity_hours_revision').fetchone()[0], 1)

    def test_closed_month_blocks_all_revision_writes_preserving_history(self):
        self.calculate()
        before = self.history()
        closures = [
            ('manual_month_finalization_events', "learner_id,report_month,event_type", "1,'2026-01','finalized'"),
            ('learner_monthly_targets', "learner_id,report_month,month_status", "1,'2026-01','locked'"),
            ('learner_monthly_targets', "learner_id,report_month,month_status", "1,'2026-01','partially_signed'"),
            ('learner_monthly_signatures', "learner_id,report_month,review_confirmed", "1,'2026-01',true"),
            ('monthly_audit_signoffs', "learner_id,report_month,review_confirmed", "'101','2026-01',true"),
        ]
        for table, columns, values in closures:
            with self.subTest(table=table, values=values):
                self.db.execute(f'INSERT INTO "Learner".{table}({columns}) VALUES({values})')
                for operation in (lambda: self.calculate(offset_minutes=5),
                                  lambda: self.decide(approve=True), lambda: self.decide(approve=False)):
                    with self.assertRaises(ServiceError) as error:
                        operation()
                    self.assertEqual(error.exception.status, 409)
                self.assertEqual(self.history(), before)
                self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone()[0], 0)
                self.db.execute(f'TRUNCATE "Learner".{table}')

    def test_finalization_scope_and_latest_reopen(self):
        self.db.execute('''INSERT INTO "Learner".manual_month_finalization_events
            (learner_id,report_month,event_type) VALUES(2,'2026-01','finalized'),(1,'2026-02','finalized')''')
        self.calculate()
        self.db.execute('''INSERT INTO "Learner".manual_month_finalization_events
            (learner_id,report_month,event_type) VALUES(1,'2026-01','finalized'),(1,'2026-01','reopened')''')
        self.assertEqual(self.decide(approve=True)['decided'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".manual_month_finalization_events').fetchone()[0], 4)

    def test_finalization_race_rechecks_before_proposal_or_decision(self):
        from learner_api.finalization_locks import lock_scopes
        self.calculate()
        for action in ('propose', 'approve', 'reject'):
            started = Event()
            def worker():
                with psycopg.connect(**CONFIG, autocommit=True) as other:
                    other.execute("SET statement_timeout='5s'")
                    started.set()
                    try:
                        if action == 'propose':
                            self.calculate(db=other, offset_minutes=5)
                        else:
                            self.decide(db=other, approve=action == 'approve')
                    except ServiceError as error:
                        return error.code
                    return 'unexpected_write'
            before = self.history()
            with self.subTest(action=action), ThreadPoolExecutor(max_workers=1) as pool:
                with self.db.transaction(), self.db.cursor() as cursor:
                    lock_scopes(cursor, [(1,'2026-01')])
                    cursor.execute('''INSERT INTO "Learner".manual_month_finalization_events
                        (learner_id,report_month,event_type) VALUES(1,'2026-01','finalized')''')
                    future = pool.submit(worker)
                    self.assertTrue(started.wait(2))
                    with self.assertRaises(TimeoutError): future.result(timeout=.2)
                self.assertEqual(future.result(timeout=5), 'month_finalized')
            self.assertEqual(self.history(), before)
            self.db.execute('TRUNCATE "Learner".manual_month_finalization_events')
    def test_fk_missing_and_cross_owner_and_parent_restrictions(self):
        insert = '''INSERT INTO "Learner".manual_activity_hours_revision
            (row_id,learner_id,selected_month,category,proposed_actual_hours,proposed_by,base_fingerprint,rule_version)
            VALUES(%s,%s,'2026-01','video',1,'a','hash','v')'''
        for row, owner in [(999,1),(11,999),(11,2)]:
            with self.subTest(row=row, owner=owner), self.assertRaises(psycopg.errors.ForeignKeyViolation):
                self.db.execute(insert, [row,owner])
        self.calculate()
        for sql, error in [
            ('UPDATE "Learner".learner_journal_rows SET learner_id=2 WHERE id=11', psycopg.errors.RestrictViolation),
            ('DELETE FROM "Learner".learner_journal_rows WHERE id=11', psycopg.errors.RestrictViolation),
        ]:
            with self.assertRaises(error):
                self.db.execute(sql)

    def test_unique_pending_idempotency_and_superseding(self):
        self.calculate(fields='actual')
        self.assertEqual(self.calculate(fields='actual')['already_pending'], 1)
        self.assertEqual(self.calculate(fields='actual', offset_minutes=5)['superseded'], 1)
        self.assertEqual([r['status'] for r in self.history()], ['pending','superseded'])
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.db.execute('''INSERT INTO "Learner".manual_activity_hours_revision
                (row_id,learner_id,selected_month,category,proposed_actual_hours,proposed_by,base_fingerprint,rule_version)
                VALUES(11,1,'2026-01','video',1,'a','h','v')''')

    def test_approval_and_isolation(self):
        self.calculate()
        self.calculate(owner=2)
        result = self.decide(approve=True)
        self.assertEqual(result['decided'],1)
        self.assertEqual(self.history()[0]['status'],'approved')
        self.assertEqual(self.db.execute('SELECT actual_hours,planned_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone(), (Decimal('.5'),Decimal('2')))
        self.assertEqual(len(self.pending(2)),1)
        self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".learner_journal_rows WHERE id=22').fetchone()[0],0)

    def test_canonical_owner_wins_over_journal_aptem_and_revision_ids(self):
        self.db.execute('UPDATE "Learner".learner_journal_rows SET aptem_id=202 WHERE id=11')
        self.calculate(fields='actual')
        self.calculate(owner=2,fields='actual')
        other_revision = self.pending(2)[0]['revision_id']
        with self.assertRaises(ServiceError) as error:
            self.decide(approve=True,revision_ids=[other_revision])
        self.assertEqual(error.exception.code,'nothing_pending')
        self.decide(approve=True,revision_ids=[self.pending()[0]['revision_id']])
        self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone()[0],Decimal('.5'))
        self.assertEqual(len(self.pending(2)),1)

    def test_reject_and_retry(self):
        self.calculate()
        self.decide(approve=False)
        self.assertEqual(self.history()[0]['status'],'rejected')
        self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone()[0],0)
        with self.assertRaisesRegex(ServiceError,'nothing pending'):
            self.decide(approve=False)

    def test_two_person_and_permission(self):
        self.calculate()
        with self.assertRaises(ServiceError) as error:
            self.decide(approve=True, actor=PROPOSER)
        self.assertEqual(error.exception.code,'self_approval')
        with self.assertRaises(ServiceError) as error:
            self.decide(approve=True, actor=Auditor('c','C','unsupported'))
        self.assertEqual(error.exception.code,'identity_not_permitted')
        self.assertEqual(len(self.pending()),1)

    def test_planned_only_null_and_preserve_actual(self):
        self.db.execute('UPDATE "Learner".learner_journal_rows SET actual_hours=1.25 WHERE id=11')
        self.calculate(fields='planned')
        p = self.pending()[0]
        self.assertIsNone(p['proposed_actual_hours'])
        self.assertIsNone(p['proposed_seconds'])
        self.decide(approve=True)
        self.assertEqual(self.db.execute('SELECT actual_hours,planned_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone(),(Decimal('1.25'),Decimal('2')))

    def test_actual_only_preserves_planned_and_merge(self):
        self.db.execute('UPDATE "Learner".learner_journal_rows SET planned_hours=1.25 WHERE id=11')
        self.calculate(fields='actual')
        self.decide(approve=True)
        self.assertEqual(self.db.execute('SELECT planned_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone()[0],Decimal('1.25'))
        self.db.execute('UPDATE "Learner".learner_journal_rows SET actual_hours=0 WHERE id=11')
        self.calculate(fields='actual')
        self.calculate(fields='planned')
        self.assertEqual(self.pending()[0]['proposed_actual_hours'],Decimal('.5'))
        self.assertEqual(self.pending()[0]['proposed_planned_hours'],Decimal('2'))

    def test_decimal_rounding_and_positive_seconds(self):
        self.calculate(fields='actual')
        for hours in ['0.00125','0.001249999999999999','0.001250000000000001','1.123456789123456789']:
            value = Decimal(hours)
            self.db.execute('UPDATE "Learner".manual_activity_hours_revision SET proposed_actual_hours=%s',[value])
            seconds = self.pending()[0]['proposed_seconds']
            self.assertIsInstance(seconds,int)
            self.assertEqual(seconds,int((value*3600).quantize(Decimal('1'),rounding=ROUND_HALF_UP)))
        for value in [Decimal('0'),Decimal('-1'),Decimal('0.00001')]:
            with self.assertRaises(psycopg.errors.CheckViolation):
                self.db.execute('UPDATE "Learner".manual_activity_hours_revision SET proposed_actual_hours=%s',[value])

    def test_seconds_to_hours_formula_round_trip(self):
        # Every whole second within the supported 50-hour column limit.
        mismatches = self.db.execute('''SELECT count(*) FROM generate_series(1,180000) s
            WHERE round(round(s::numeric/3600,4)*3600)<>s''').fetchone()[0]
        self.assertEqual(mismatches,0)
        for seconds in (1,59,60,61,1799,1801,179999,180000):
            hours = journal.rules.seconds_to_hours(seconds)
            self.assertEqual(self.db.execute('SELECT round(%s::numeric*3600)::integer',[hours]).fetchone()[0],seconds)

    def test_soft_deleted_history_not_active(self):
        self.calculate()
        self.db.execute('UPDATE "Learner".learner_journal_rows SET deleted_at=now() WHERE id=11')
        self.assertEqual(self.pending(),[])
        self.assertEqual(len(self.history()),1)
        self.assertEqual(self.calculate()['rows_in_month'],0)
        with self.assertRaises(ServiceError):
            self.decide(approve=True)
        self.assertEqual(self.history()[0]['status'],'pending')

    def test_comment_rejected_before_write(self):
        self.calculate()
        for comment in ['reason',' ',False,[],{}]:
            with self.assertRaises(ServiceError) as error:
                self.decide(approve=False,comment=comment)
            self.assertEqual(error.exception.code,'revision_comment_not_supported')
        self.decide(approve=False,comment='')
        self.assertEqual(self.history()[0]['status'],'rejected')

    def test_transaction_rolls_back_partial_approval(self):
        self.db.execute('''INSERT INTO "Learner".learner_journal_rows
            (id,learner_id,aptem_id,month,category,activity_id,actual_hours,planned_hours)
            VALUES(12,1,101,'2026-01','reading+quiz',10,0,0)''')
        self.calculate()
        self.db.execute('UPDATE "Learner".learner_journal_rows SET deleted_at=now() WHERE id=12')
        with self.assertRaises(ServiceError):
            self.decide(approve=True)
        self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".learner_journal_rows WHERE id=11').fetchone()[0],0)
        self.assertTrue(all(r['status']=='pending' for r in self.history()))

    def test_concurrent_calculations_and_decisions(self):
        def run_calculation(_):
            with psycopg.connect(**CONFIG, autocommit=True) as db:
                db.execute("SET statement_timeout='5s'")
                return self.calculate(db=db, fields='actual')
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(run_calculation, range(2)))
        self.assertEqual(sum(r['proposals_created'] for r in results),1)
        def run_decision(_):
            with psycopg.connect(**CONFIG, autocommit=True) as db:
                db.execute("SET statement_timeout='5s'")
                try:
                    return self.decide(db=db,approve=True)['status']
                except ServiceError as error:
                    return error.code
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertCountEqual(executor.map(run_decision,range(2)), ['approved','nothing_pending'])

    def test_api_response_and_identity_resolution(self):
        from django.test import RequestFactory
        from audit_api.actual_hours import views
        from django.db import connections
        factory = RequestFactory()
        # The real HTTP functions use only the disposable database.
        with patch.object(views,'_connection',return_value=connections['default']):
            request = factory.post('/x',data=json.dumps(dict(aptem_id=101,month='2026-01',fields='actual')),content_type='application/json')
            response = views.journal_calculate(request)
            self.assertEqual(response.status_code,200,response.content)
            response = views.journal_summary(factory.get('/x',dict(aptem_id=101,month='2026-01')))
            self.assertEqual(response.status_code,200,response.content)
            payload = json.loads(response.content)
            self.assertEqual(payload['aptem_id'],101)
            self.assertIsInstance(payload['pending'][0]['proposed_actual_hours'],str)
            self.assertIsInstance(payload['pending'][0]['proposed_seconds'],int)
            self.assertNotIn('comment',payload['pending'][0])
            response = views.journal_summary(factory.get('/x',dict(aptem_id=999,month='2026-01')))
            self.assertEqual(response.status_code,409)
            request = factory.post('/x',data=json.dumps(dict(aptem_id=101,month='2026-01',comment='reason')),content_type='application/json')
            self.assertEqual(views.journal_reject(request).status_code,400)

    def test_api_ambiguous_identity_and_decision_contract(self):
        from django.test import RequestFactory
        from audit_api.actual_hours import views
        from django.db import connections
        factory = RequestFactory()
        def request(**changes):
            return factory.post('/x',data=json.dumps(dict(aptem_id=101,month='2026-01',**changes)),
                                content_type='application/json')
        with patch.object(views,'_connection',return_value=connections['default']):
            self.assertEqual(views.journal_calculate(request(fields='planned')).status_code,200)
            response = views.journal_summary(factory.get('/x',dict(aptem_id=101,month='2026-01')))
            payload = json.loads(response.content)['pending'][0]
            self.assertIsNone(payload['proposed_seconds'])
            # Existing serializer emits the string "None" for missing actual
            # hours; this schema migration deliberately preserves that contract.
            self.assertEqual(payload['proposed_actual_hours'],'None')
            approved = views.journal_approve(request(comment=None))
            self.assertEqual(json.loads(approved.content),dict(ok=True,decided=1,skipped_own_proposals=0,status='approved'))
            self.assertEqual(views.journal_calculate(request(fields='actual')).status_code,200)
            rejected = views.journal_reject(request(comment=''))
            self.assertEqual(json.loads(rejected.content)['status'],'rejected')
            self.db.execute('UPDATE "Learner".learners SET aptem_id=101 WHERE id=2')
            try:
                response = views.journal_calculate(request(fields='actual'))
                self.assertEqual(response.status_code,409)
                self.assertEqual(json.loads(response.content)['code'],'identity_review_required')
            finally:
                self.db.execute('UPDATE "Learner".learners SET aptem_id=202 WHERE id=2')

    def test_both_role_adapters_use_same_revision_data(self):
        from learner_api.journal_sources import learner_journal_reads, standard_monthly_reads, table
        from old_otjh import repository
        self.calculate()
        for context in (learner_journal_reads, standard_monthly_reads):
            with context():
                self.assertEqual(table('manual_activity_hours_revision'),'"Learner".manual_activity_hours_revision')
                self.assertEqual(repository.pending_revisions(101),[dict(month='2026-01',count=1)])
        self.db.execute('UPDATE "Learner".learner_journal_rows SET deleted_at=now() WHERE id=11')
        self.assertEqual(repository.pending_revisions(101),[])

    def test_pending_boundary_rejects_ambiguous_external_identity(self):
        from old_otjh import repository
        from old_otjh.service import ServiceError as IdentityError
        self.calculate()
        self.calculate(owner=2)
        self.db.execute('UPDATE "Learner".learners SET aptem_id=101 WHERE id=2')
        try:
            with self.assertRaises(IdentityError) as error:
                repository.pending_revisions(101)
            self.assertEqual(error.exception.code, 'identity_review_required')
        finally:
            self.db.execute('UPDATE "Learner".learners SET aptem_id=202 WHERE id=2')
        self.assertEqual(repository.pending_revisions(101), [dict(month='2026-01',count=1)])

    def test_bulk_monitoring_pending_query(self):
        from old_otjh import monitoring, repository
        self.calculate()
        self.calculate(owner=2)
        actual_query = repository.query
        def source_query(sql, params=()):
            if 'manual_activity_hours_revision' in sql:
                return actual_query(sql,params)
            return []
        with patch.object(monitoring,'cohort_records',return_value=[dict(id=101,enrolment_id=1)]), \
                patch.object(repository,'query',side_effect=source_query), \
                patch.object(monitoring,'assemble',side_effect=lambda *args: args[-1]):
            self.assertEqual(monitoring.load_records(),[dict(aptem_id=101,month='2026-01',count=1)])
            self.db.execute('UPDATE "Learner".learner_journal_rows SET deleted_at=now() WHERE id=11')
            self.assertEqual(monitoring.load_records(),[])

    def test_reconciliation_approved_field_query(self):
        from audit_api.management.commands.reconcile_monthly_logs import Command
        self.calculate()
        self.decide(approve=True)
        self.calculate(owner=2)
        self.decide(owner=2,approve=True)
        # Exercise the command's actual revision SQL; unrelated evidence/KSB
        # readers return empty fixture inputs rather than require those schemas.
        with self.db.cursor() as real:
            class RevisionCursor:
                description = []
                def execute(self,sql,params=()):
                    self.revision = 'manual_activity_hours_revision' in sql
                    if self.revision:
                        real.execute(sql,params)
                        self.description = real.description
                    else:
                        self.description = []
                def fetchall(self):
                    return real.fetchall() if self.revision else []
            cursor = RevisionCursor()
            data = Command()._load(cursor,[101])
            self.assertEqual(data['approved_actual'],{11})
            self.assertEqual(data['approved_planned'],{11})
            self.db.execute('UPDATE "Learner".learner_journal_rows SET deleted_at=now() WHERE id=11')
            data = Command()._load(cursor,[101])
            self.assertEqual(data['approved_actual'],set())
            self.assertEqual(data['approved_planned'],set())


def main():
    global CONFIG, journal, ServiceError, Auditor, PROPOSER, APPROVER
    binaries = [shutil.which(name) for name in ('initdb','pg_ctl')]
    if not all(binaries):
        raise RuntimeError('Local initdb and pg_ctl required; no remote fallback.')
    with tempfile.TemporaryDirectory(prefix='lms-revision-contract-') as temporary:
        directory = Path(temporary)
        data = directory / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0))
            port = sock.getsockname()[1]
        flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        subprocess.run([binaries[0],'-D',str(data),'-U','postgres','-A','trust','--no-locale','-E','UTF8'],
                       check=True,capture_output=True,**flags)
        with (directory/'startup.log').open('wb') as output:
            subprocess.run([binaries[1],'-D',str(data),'-l',str(directory/'server.log'),
                            '-o',f'-h 127.0.0.1 -p {port}','-w','start'],check=True,
                           stdout=output,stderr=output,timeout=60,**flags)
        CONFIG = dict(host='127.0.0.1',port=port,user='postgres',dbname='postgres')
        try:
            with psycopg.connect(**CONFIG,autocommit=True) as db:
                actual, branch = db.execute("SELECT current_setting('data_directory'),current_setting('neon.branch_id',true)").fetchone()
                assert Path(actual).resolve() == data.resolve() and not branch
                print('Verified fresh local PostgreSQL cluster; fixture writes confined to this cluster.',flush=True)
                db.execute(DDL)
            # Import settings with all remote DB aliases disabled, then replace
            # only this process's test configuration before Django initializes.
            os.environ['DJANGO_USE_SQLITE']='true'
            module = importlib.import_module('config.settings_sqlite_test')
            config = {k:getattr(module,k) for k in dir(module) if k.isupper()}
            config['DATABASES'] = {alias:dict(ENGINE='django.db.backends.postgresql',HOST='127.0.0.1',PORT=port,USER='postgres',NAME='postgres') for alias in ('default','enrolment')}
            config['AUDIT_API_REQUIRE_AUTH'] = False
            from django.conf import settings
            settings.configure(**config)
            import django
            django.setup()
            from audit_api.actual_hours import journal_hours as journal
            from audit_api.actual_hours.service import ServiceError
            from audit_api.actual_hours.auth import Auditor
            PROPOSER = Auditor('named:a','A','named-header')
            APPROVER = Auditor('named:b','B','named-header')
            result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RevisionContractTests))
            from django.db import connections
            connections.close_all()
            return result.wasSuccessful()
        finally:
            subprocess.run([binaries[1],'-D',str(data),'-m','fast','-w','stop'],check=True,capture_output=True,timeout=60,**flags)


if __name__ == '__main__':
    raise SystemExit(not main())
