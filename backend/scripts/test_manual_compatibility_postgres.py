"""Active consumers against seven read-only captured Development triggers.

Uses only base.main's verified fresh temporary cluster. No migrations, remote
writes, blob operations or application database credentials.
"""
import json
from types import SimpleNamespace

import psycopg
import test_manual_documents_postgres as base
from test_installed_finalization_postgres import InstalledTests


class CompatibilityTests(InstalledTests):
    @classmethod
    def setUpClass(cls):
        capture = json.loads((base.ROOT / 'backend/scripts/fixtures/manual_compatibility_installed.json').read_text())
        with psycopg.connect(**base.CONFIG, autocommit=True) as db:
            # Synthetic dependency columns required by the captured cache trigger.
            db.execute('''ALTER TABLE "Learner".learner_monthly_targets
                ADD COLUMN actual_seconds_total bigint,
                ADD COLUMN actual_updated_at timestamptz,
                ADD COLUMN actual_summary jsonb;
                ALTER TABLE "Learner".learner_monthly_signatures
                ADD COLUMN source_system text, ADD COLUMN source_ref text''')
            db.execute(capture['invalidate'])
            for definition in capture['functions'].values():
                db.execute(definition)
            for row in capture['triggers']:
                assert row['tgenabled'] == 'O'
                db.execute(f'DROP TRIGGER IF EXISTS "{row["tgname"]}" ON "Learner"."{row["relname"]}"')
                db.execute(row['definition'])

    test_metadata_preserves_progress = base.DocumentTests.test_metadata_updates_preserve_corrected_progress_and_month
    test_soft_delete_sync = base.DocumentTests.test_soft_delete_propagates_without_physical_delete
    test_tombstone_preserved = base.DocumentTests.test_preserve_existing_ssot_tombstone_and_manual_only_difference
    test_alternative_identity_refused = base.DocumentTests.test_alternative_source_guard_preserves_split_and_prevents_duplicate
    test_mirror_preserves_deleted = base.DocumentTests.test_mirror_retry_never_resurrects_deleted_document
    test_shared_signing_locks = base.DocumentTests.test_signing_and_finalization_locks_are_shared
    test_archive_namespace = base.DocumentTests.test_explicit_archive_never_reinterprets_canonical_ids
    test_attachment_writer = base.DocumentTests.test_actual_auto_attachment_writer
    test_evidence_transfer = base.DocumentTests.test_evidence_transfer_is_atomic_and_uses_canonical_owner
    test_journal_month_move_protection = base.DocumentTests.test_finalized_journal_old_new_scope_and_owner_isolation

    def test_installed_identity_guards(self):
        doc = self.create()
        for sql in ('DELETE FROM "Learner".manual_activity_documents',
                    'UPDATE "Learner".manual_activity_documents SET id=id+100',
                    'UPDATE "Learner".manual_activity_documents SET manual_activity_id=12',
                    'UPDATE "Learner".manual_activity_documents SET learner_id=2'):
            with self.subTest(sql=sql), self.assertRaises(psycopg.Error):
                self.db.execute(sql)
        self.assertEqual(self.read()[0]['id'], doc['id'])

    def test_real_finalization_reopen_invalidates_only_open_owner_cache(self):
        from django.db import transaction
        from old_otjh import repository
        self.db.execute('''INSERT INTO "Learner".learner_monthly_targets
            (learner_id,report_month,month_status,actual_seconds_total,actual_updated_at,actual_summary)
            VALUES(1,'2026-01','open',3600,now(),'{}'),
                  (2,'2026-01','open',7200,now(),'{}')''')
        def values():
            return self.db.execute('''SELECT learner_id,actual_seconds_total
                FROM "Learner".learner_monthly_targets ORDER BY learner_id''').fetchall()
        with transaction.atomic(using='enrolment'):
            repository.finalize({'aptem_id':101}, '2026-01', 'preserved-hash', 1, SimpleNamespace(id=9))
        self.assertEqual(values(), [(1,3600),(2,7200)])
        snapshot = self.db.execute('''SELECT snapshot,snapshot_hash FROM
            "Learner".manual_month_finalization_events ORDER BY id LIMIT 1''').fetchone()
        with transaction.atomic(using='enrolment'):
            repository.finalize({'aptem_id':101}, '2026-01', None, 1, SimpleNamespace(id=9), 'Review')
        self.assertEqual(values(), [(1,None),(2,7200)])
        self.assertEqual(self.db.execute('''SELECT snapshot,snapshot_hash FROM
            "Learner".manual_month_finalization_events ORDER BY id LIMIT 1''').fetchone(), snapshot)
        self.assertEqual(repository.finalizations(101)[0]['event_type'], 'reopened')


if __name__ == '__main__':
    raise SystemExit(not base.main(CompatibilityTests, installed=True))
