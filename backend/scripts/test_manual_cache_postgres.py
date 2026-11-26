"""Current-contract cache closure: real journal, SSOT, calculation and cache SQL.

Only base.main's fresh verified local PostgreSQL is writable. Captured catalog
columns and trigger bodies are fixtures, not migrations. Empty KSB/attendance
providers isolate this journal-hours scenario; no hours calculation is mocked.
"""
import json
import unittest
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
from psycopg import sql
import test_manual_documents_postgres as base
from test_manual_compatibility_postgres import CompatibilityTests
from test_manual_revision_postgres import DDL as REVISION_DDL


class CacheTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        CompatibilityTests.setUpClass()
        capture = json.loads((base.ROOT/'backend/scripts/fixtures/manual_cache_installed.json').read_text())
        with psycopg.connect(**base.CONFIG, autocommit=True) as db:
            for table in capture['columns']:
                qualified = sql.Identifier(table['schema'], table['name'])
                db.execute(sql.SQL('CREATE TABLE IF NOT EXISTS {} ()').format(qualified))
                for column in table['columns']:
                    db.execute(sql.SQL('ALTER TABLE {} ADD COLUMN IF NOT EXISTS {} {}').format(
                        qualified, sql.Identifier(column['name']), sql.SQL(column['type'])))
            for table in ('learner_activity_sources','learner_monthly_targets'):
                db.execute(sql.SQL('CREATE SEQUENCE {} START 1000').format(sql.Identifier('Learner',table+'_fixture_seq')))
                db.execute(sql.SQL("ALTER TABLE {} ALTER COLUMN id SET DEFAULT nextval({})").format(
                    sql.Identifier('Learner',table),sql.Literal('"Learner".'+table+'_fixture_seq')))
            db.execute('''ALTER TABLE enrolment."Created_users" ADD COLUMN "Email" text;
                CREATE TABLE "Learner".progress_transfer_requests(enrolment_id bigint);
                CREATE TABLE "Learner".learning_reflection_submissions(
                    id bigint,learner_id bigint,learner_kind text,component_ref text,progress_entry_id bigint,
                    status text,actual_time_hours numeric,submitted_at timestamptz,activity_type text,
                    activity_title text,module_title text,ksb_codes jsonb,full_submission jsonb);
                CREATE SCHEMA "Last_audit";
                CREATE TABLE "Last_audit".activities(activity_id bigint,configured_duration_min numeric,
                    quiz_id bigint,reading_type text,reading_iframe_url text,reading_text_body text)''')
            revision = REVISION_DDL.split('CREATE TABLE "Learner".manual_activity_hours_revision',1)[1].split('INSERT INTO "Learner".learners',1)[0]
            db.execute('CREATE TABLE "Learner".manual_activity_hours_revision'+revision)
            for definition in capture['functions'].values():
                db.execute(definition)
            for trigger in capture['triggers']:
                db.execute(sql.SQL('DROP TRIGGER IF EXISTS {} ON {}').format(
                    sql.Identifier(trigger['tgname']),sql.Identifier('Learner',trigger['relname'])))
                db.execute(trigger['ddl'])

    def setUp(self):
        self.db = psycopg.connect(**base.CONFIG,autocommit=True)
        self.addCleanup(self.db.close)
        self.db.execute('''TRUNCATE "Learner".manual_activity_hours_revision,
            "Learner".manual_activity_documents,"Learner".learner_activity_documents,
            "Learner".learner_journal_rows,"Learner".learner_progress_entries,
            "Learner".learner_activity_sources,"Learner".manual_month_finalization_events,
            "Learner".learner_monthly_targets,"Learner".learner_monthly_signatures RESTART IDENTITY''')
        self.db.execute('''UPDATE "Learner".learners SET full_name='Synthetic learner',email='synthetic@example.invalid';
            UPDATE enrolment."Created_users" SET "Email"='synthetic@example.invalid';
            INSERT INTO "Learner".learner_progress_entries
                (id,learner_id,source_system,component_ref,component_type,kind,component_title,
                 actual_seconds,accepted,reporting_month,source_payload)
            VALUES(100,1,'journal','journal:11','reading_quiz','reading_quiz','Reading',3600,true,'2026-01','{}'),
                  (101,1,'journal','journal:12','reading_quiz','reading_quiz','Reading',7200,true,'2026-02','{}'),
                  (200,2,'journal','journal:22','reading_quiz','reading_quiz','Reading',10800,true,'2026-01','{}');
            INSERT INTO "Learner".learner_activity_sources(id,learner_id,source_system,canonical_progress_id)
            VALUES(100,1,'journal',100),(101,1,'journal',101),(200,2,'journal',200);
            INSERT INTO "Learner".learner_journal_rows
                (id,learner_id,aptem_id,progress_id,source_id,month,category,title,actual_hours,accepted)
            VALUES(11,1,101,100,100,'2026-01','reading+quiz','Reading',1,true),
                  (12,1,101,101,101,'2026-02','reading+quiz','Reading',2,true),
                  (22,2,202,200,200,'2026-01','reading+quiz','Reading',3,true);
            INSERT INTO "Learner".learner_monthly_targets
                (learner_id,report_month,month_status,target_hours,updated_at)
            VALUES(1,'2026-01','open',10,now()),(1,'2026-02','open',10,now()),(2,'2026-01','open',10,now())''')
        for target, kwargs in [
            ('learner_api.canonical_learning.official_progress_relation',dict(return_value='(SELECT NULL::bigint AS progress_id,NULL::text AS ksb_code,0 AS position WHERE false)')),
            ('learner_api.attendance_otjh.apply',dict(side_effect=lambda owner, records, query: records)),
            ('learner_api.monthly_logs.attendance_rows',dict(return_value=[])),
            ('learner_api.current_learning.subject_attempt_rows',dict(return_value=[])),
        ]:
            mocker=patch(target,**kwargs); mocker.start(); self.addCleanup(mocker.stop)

    def refresh(self, owner=1):
        from learner_api.monthly_actual_cache import refresh_learner
        return refresh_learner(owner)

    def cache(self):
        return self.db.execute('''SELECT learner_id,report_month,actual_seconds_total
            FROM "Learner".learner_monthly_targets ORDER BY learner_id,report_month''').fetchall()

    def event(self, reopen=False):
        from django.db import transaction
        from old_otjh import repository
        with transaction.atomic(using='enrolment'):
            repository.finalize({'aptem_id':101},'2026-01',None if reopen else 'synthetic-hash',1,
                                SimpleNamespace(id=9),'Review' if reopen else None)

    def propose(self):
        self.db.execute('''INSERT INTO "Learner".manual_activity_hours_revision
            (row_id,learner_id,selected_month,category,previous_actual_hours,proposed_actual_hours,
             proposed_by,base_fingerprint,rule_version)
            VALUES(11,1,'2026-01','reading+quiz',1,0.5,'named:proposer','synthetic','v')''')

    def approve(self):
        from django.db import connections,transaction
        from audit_api.actual_hours.journal_hours import decide
        from audit_api.actual_hours.auth import Auditor
        with transaction.atomic(using='enrolment'),connections['enrolment'].cursor() as cursor:
            return decide(cursor,learner_id=1,month='2026-01',actor=Auditor('user:9','Approver','django'),approve=True)

    def test_refresh_uses_real_canonical_calculation_for_both_views(self):
        self.refresh(); self.refresh(2)
        self.assertEqual(self.cache(),[(1,'2026-01',3600),(1,'2026-02',7200),(2,'2026-01',10800)])
        from learner_api.monthly_actual_cache import _owner_for_profile,_canonical_summaries
        from django.db import connections
        with connections['enrolment'].cursor() as cursor:
            enrolment,owner=_owner_for_profile(1,cursor)
        standard,journal=_canonical_summaries(enrolment,owner)
        self.assertEqual([m['actual_hours'] for m in standard['months']],[1,2])
        self.assertEqual([m['actual_hours'] for m in journal['months']],[1,2])

    def test_finalize_reopen_revision_refresh(self):
        self.refresh(); self.refresh(2)
        self.event()
        self.assertEqual(self.cache()[0],(1,'2026-01',3600))
        self.refresh()
        self.assertEqual(self.cache()[0],(1,'2026-01',3600))
        self.event(reopen=True)
        self.assertIsNone(self.cache()[0][2])
        self.propose(); self.approve()
        # Current reads recompute from SSOT before the durable worker runs.
        from learner_api.monthly_actual_cache import _canonical_summaries,refresh_invalidated
        from learner_api.canonical_learning import require_profile
        standard,journal=_canonical_summaries(10,require_profile(10))
        self.assertEqual(standard['months'][0]['actual_hours'],.5)
        self.assertEqual(journal['months'][0]['actual_hours'],.5)
        self.assertEqual(refresh_invalidated()['failed'],0)
        self.assertEqual(self.cache(),[(1,'2026-01',1800),(1,'2026-02',7200),(2,'2026-01',10800)])

    def finalize_with_current_actuals(self):
        # The signing path refreshes under its transaction before finalizing.
        # Signature image transport is outside this hours test.
        from learner_api.monthly_actual_cache import require_actuals_for_signing
        from django.db import transaction
        with transaction.atomic(using='enrolment'):
            require_actuals_for_signing(1,'2026-01')
            self.event()

    def race(self, held, waiting):
        from django.db import connections,transaction
        started=Event()
        def worker():
            try:
                with connections['enrolment'].cursor() as cursor: cursor.execute("SET statement_timeout='5s'")
                started.set()
                return waiting()
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic(using='enrolment'):
                held()
                future=pool.submit(worker); self.assertTrue(started.wait(2))
                with self.assertRaises(TimeoutError): future.result(timeout=.2)
            return future.result(timeout=5)

    def test_approval_then_concurrent_finalization_freezes_recomputed_value(self):
        self.refresh(); self.refresh(2); self.propose()
        self.race(self.approve,self.finalize_with_current_actuals)
        self.assertEqual(self.cache()[0],(1,'2026-01',1800))
        self.assertEqual(self.cache()[2],(2,'2026-01',10800))
        self.refresh()
        self.assertEqual(self.cache()[0],(1,'2026-01',1800))

    def test_reopening_then_concurrent_approval_and_worker(self):
        self.refresh(); self.refresh(2); self.propose(); self.event()
        self.assertEqual(self.race(lambda:self.event(reopen=True),self.approve)['decided'],1)
        from learner_api.monthly_actual_cache import refresh_invalidated
        self.assertEqual(refresh_invalidated()['failed'],0)
        self.assertEqual(self.cache(),[(1,'2026-01',1800),(1,'2026-02',7200),(2,'2026-01',10800)])

    def test_finalization_then_concurrent_reopening_preserves_event_order(self):
        self.refresh(); self.refresh(2)
        self.race(self.event,lambda:self.event(reopen=True))
        self.assertEqual(self.db.execute('''SELECT event_type FROM
            "Learner".manual_month_finalization_events ORDER BY id''').fetchall(),[('finalized',),('reopened',)])
        self.assertIsNone(self.cache()[0][2])
        self.refresh()
        self.assertEqual(self.cache()[0],(1,'2026-01',3600))

    def test_finalization_rollback_restores_open_cache(self):
        from django.db import transaction
        self.refresh(); before=self.cache()
        with self.assertRaisesRegex(RuntimeError,'rollback'),transaction.atomic(using='enrolment'):
            self.event(); raise RuntimeError('rollback')
        self.assertEqual(self.cache(),before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".manual_month_finalization_events').fetchone()[0],0)

    def test_other_finalized_month_and_other_learner_remain_unchanged(self):
        from old_otjh import repository
        from django.db import transaction
        self.refresh(); self.refresh(2)
        with transaction.atomic(using='enrolment'):
            repository.finalize({'aptem_id':101},'2026-02','other-month-hash',1,SimpleNamespace(id=9))
        self.propose(); self.approve()
        self.assertEqual(self.cache(),[(1,'2026-01',None),(1,'2026-02',7200),(2,'2026-01',10800)])
        self.refresh()
        self.assertEqual(self.cache(),[(1,'2026-01',1800),(1,'2026-02',7200),(2,'2026-01',10800)])

    def test_historical_approval_removal_metadata_is_not_rewritten(self):
        self.propose(); self.approve()
        self.db.execute('''UPDATE "Learner".manual_activity_hours_revision
            SET approval_removed_by='historical:actor',approval_removed_by_source='historical',
                approval_removed_at='2020-01-01' ''')
        before=self.db.execute('''SELECT * FROM "Learner".manual_activity_hours_revision
            ORDER BY revision_id''').fetchone()
        self.propose(); self.approve()
        self.assertEqual(self.db.execute('''SELECT * FROM "Learner".manual_activity_hours_revision
            ORDER BY revision_id''').fetchone(),before)

    def test_unaccepted_revision_keeps_canonical_accepted_total_zero(self):
        self.db.execute('UPDATE "Learner".learner_journal_rows SET accepted=false WHERE id=11')
        self.refresh(); self.propose(); self.approve(); self.refresh()
        self.assertEqual(self.cache()[0],(1,'2026-01',0))
        self.assertEqual(self.db.execute('''SELECT actual_seconds,accepted FROM
            "Learner".learner_progress_entries WHERE id=100''').fetchone(),(1800,False))

    def test_approval_and_reopen_rollback_preserve_cache_and_history(self):
        from django.db import transaction
        self.refresh(); self.refresh(2); self.propose()
        before=self.cache()
        with self.assertRaisesRegex(RuntimeError,'rollback'),transaction.atomic(using='enrolment'):
            self.approve(); self.refresh(); raise RuntimeError('rollback')
        self.assertEqual(self.cache(),before)
        self.assertEqual(self.db.execute('SELECT status FROM "Learner".manual_activity_hours_revision').fetchone()[0],'pending')
        self.event(); before=self.cache()
        with self.assertRaisesRegex(RuntimeError,'rollback'),transaction.atomic(using='enrolment'):
            self.event(reopen=True); raise RuntimeError('rollback')
        self.assertEqual(self.cache(),before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM "Learner".manual_month_finalization_events').fetchone()[0],1)

    def test_finalization_racing_approval_rechecks_after_lock(self):
        from django.db import connections,transaction
        self.refresh(); self.propose()
        started=Event()
        def worker():
            from audit_api.actual_hours.service import ServiceError
            try:
                with connections['enrolment'].cursor() as cursor: cursor.execute("SET statement_timeout='5s'")
                started.set()
                try: return self.approve()
                except ServiceError as error: return error.code
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic(using='enrolment'):
                self.event()
                future=pool.submit(worker); self.assertTrue(started.wait(2))
                with self.assertRaises(TimeoutError): future.result(timeout=.2)
            self.assertEqual(future.result(timeout=5),'month_finalized')
        self.assertEqual(self.cache()[0],(1,'2026-01',3600))


if __name__=='__main__':
    raise SystemExit(not base.main(CacheTests,installed=True))
