"""Actual Development trigger definitions, synthetic data and real application writers.

No remote access. The separate 36-test expanded-proposal suite is retained in full;
its additional database guarantees are not attributed to installed Development.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
import unittest

import psycopg
import test_manual_documents_postgres as base


class InstalledTests(unittest.TestCase):
    setUp = base.DocumentTests.setUp
    create = base.DocumentTests.create
    delete = base.DocumentTests.delete
    ssot = base.DocumentTests.ssot
    read = base.DocumentTests.read
    event = base.DocumentTests.event

    test_document_contract = base.DocumentTests.test_contract_multiple_documents_and_database_ids
    test_document_ownership = base.DocumentTests.test_missing_and_cross_learner_rejected
    test_document_rollback = base.DocumentTests.test_source_identity_conflicts_rollback_new_document
    test_http_auth_and_protection = base.DocumentTests.test_http_auth_and_protected_month_no_storage_effect
    test_http_document_flow = base.DocumentTests.test_http_upload_download_delete_and_storage_failure
    test_learner_coach_parity = base.DocumentTests.test_history_and_coach_learner_parity
    test_canonical_event_writer = base.DocumentTests.test_application_event_writer_and_readers_use_canonical_identity
    test_no_aptem = base.DocumentTests.test_no_aptem_existing_finalization_and_new_writer_supported
    test_event_rollback = base.DocumentTests.test_event_writer_rollback
    test_latest_event_and_snapshots = base.DocumentTests.test_latest_reopened_and_historical_snapshots_unchanged
    test_month_protection = base.DocumentTests.test_month_statuses_reject_creates_and_deletes
    test_mirror_concurrency = base.DocumentTests.test_concurrent_mirror_operations
    test_document_old_new_scope = base.DocumentTests.test_installed_guard_old_new_scope_and_document_month

    def test_no_optional_helper_or_lock_table(self):
        self.assertIsNone(self.db.execute("SELECT to_regprocedure('\"Learner\".lock_journal_month_scopes(bigint[],text[])')").fetchone()[0])
        self.assertIsNone(self.db.execute("SELECT to_regclass('\"Learner\".learner_monthly_locks')").fetchone()[0])

    def test_read_only_deployment_checks_accept_installed_definitions(self):
        self.db.execute("SET neon.branch_id='br-raspy-sky-abvs8lq9'")
        for name in ('preflight_manual_finalization.sql', 'postcheck_manual_finalization.sql'):
            self.db.execute((base.ROOT/'backend/sql/development'/name).read_text(encoding='utf-8'))

    def test_multi_scope_normalization_and_read_committed(self):
        from learner_api.finalization_locks import lock_scopes, normalized
        self.assertEqual(normalized([(2,'2026-02'),(1,'2026-02'),(1,'2026-01'),(1,'2026-01')]),
                         [(1,'2026-01'),(1,'2026-02'),(2,'2026-02')])
        for scope in [(None,'2026-01'),(1,'2026-13'),(True,'2026-01')]:
            with self.assertRaises(ValueError): normalized([scope])
        with self.db.transaction(force_rollback=True), self.db.cursor() as cursor:
            cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            with self.assertRaises(ValueError): lock_scopes(cursor, [(1,'2026-01')])
        with self.db.transaction(), self.db.cursor() as cursor:
            lock_scopes(cursor, [(2,'2026-02'),(1,'2026-01')])
            with psycopg.connect(**base.CONFIG,autocommit=True) as other:
                for owner,month in [(1,'2026-01'),(2,'2026-02')]:
                    self.assertFalse(other.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('canonical-journal-finalization:' || %s::text || ':' || %s,0))",[owner,month]).fetchone()[0])
                self.assertTrue(other.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('canonical-journal-finalization:2:2026-01',0))").fetchone()[0])

    def test_repair_dict_cursor_and_query_adapter_share_installed_key(self):
        from learner_api.finalization_locks import lock_scopes, lock_query
        from psycopg.rows import dict_row
        with self.db.transaction(), self.db.cursor(row_factory=dict_row) as cursor:
            lock_scopes(cursor, [(1,'2026-01')])
            def query(sql, params):
                cursor.execute(sql, params)
                return cursor.fetchall()
            lock_query(query, [(2,'2026-02')], vendor='postgresql')
            with psycopg.connect(**base.CONFIG,autocommit=True) as other:
                for owner,month in [(1,'2026-01'),(2,'2026-02')]:
                    self.assertFalse(other.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('canonical-journal-finalization:' || %s::text || ':' || %s,0))",[owner,month]).fetchone()[0])

    def test_concurrent_finalization_waits_then_rechecks_snapshot(self):
        from learner_api.finalization_events import lock_writer
        from old_otjh.service import ServiceError
        started = Event()
        def write_document():
            with psycopg.connect(**base.CONFIG,autocommit=True) as other:
                other.execute("SET statement_timeout='5s'")
                started.set()
                try:
                    self.create(db=other)
                except ServiceError as error:
                    return error.code
                return 'incorrectly_created'
        with ThreadPoolExecutor(max_workers=1) as pool:
            with self.db.transaction(), self.db.cursor() as cursor:
                lock_writer(cursor,1,'2026-01')
                self.event()
                future = pool.submit(write_document)
                self.assertTrue(started.wait(2))
                with self.assertRaises(TimeoutError): future.result(timeout=.2)
            self.assertEqual(future.result(timeout=5), 'month_finalized')
        self.assertEqual(self.read(), [])

    def test_reopened_event_cannot_bypass_application_signature_guards(self):
        from old_otjh.service import ServiceError
        self.event(); self.event('reopened')
        for table,values in [('learner_monthly_targets',"1,'2026-01','partially_signed'"),
                             ('learner_monthly_targets',"1,'2026-01','locked'"),
                             ('learner_monthly_signatures',"1,'2026-01','learner',true"),
                             ('monthly_audit_signoffs',"'101','2026-01',true")]:
            with self.subTest(table=table,values=values),self.db.transaction(force_rollback=True):
                self.db.execute(f'INSERT INTO "Learner".{table} VALUES({values})')
                before = self.db.execute(f'SELECT to_jsonb(t) FROM "Learner".{table} t').fetchall()
                with self.assertRaises(ServiceError): self.create()
                self.assertEqual(self.db.execute(f'SELECT to_jsonb(t) FROM "Learner".{table} t').fetchall(),before)


if __name__ == '__main__':
    raise SystemExit(not base.main(InstalledTests, installed=True))
