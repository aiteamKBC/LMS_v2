"""Synthetic contact sync/backfill tests on a newly pinned disposable child.

Existing worker code uses synthetic registered scopes only. No production
builders, application startup, migrations, inherited cache writes or live IO.
"""
import sys
from pathlib import Path
sys.path[0] = str(Path(__file__).resolve().parent.parent)

import copy
import ctypes
from ctypes import wintypes
import json
import os
import threading
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

from learner_api import test_identity_reconciliation_postgres as base
from learner_api.services import contact_backfill as backfill, contact_sync as sync

BRANCH = 'br-old-cell-absgg6fn'


class ContactTests(unittest.TestCase):
    row = base.ReconciliationPostgresTests.row

    def setUp(self):
        base.ReconciliationPostgresTests.setUp(self)
        self.prefix = f'f01test.{self.uid}.'
        original = sync.contact_refresh_scopes
        # Exercise all actual publication SQL but never touch inherited cache scopes.
        self.scopes_patch = patch.object(sync, 'contact_refresh_scopes',
            lambda cur, sid: [(self.prefix + model, kind, scope) for model, kind, scope in original(cur, sid)])
        self.scopes_patch.start()
        self.addCleanup(self.scopes_patch.stop)
        self.invalidate = patch.object(sync, 'invalidate_contact_caches').start()
        self.addCleanup(patch.stopall)

    def cleanup(self):
        from django.db import connections
        connections.close_all()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('DELETE FROM public.platform_read_model_outbox WHERE model_key LIKE %s', [self.prefix + '%'])
            conn.execute('DELETE FROM public.platform_read_models WHERE model_key LIKE %s', [self.prefix + '%'])
        base.ReconciliationPostgresTests.cleanup(self)

    def manifest(self):
        with base.psycopg.connect(**base.CONFIG, options='-c default_transaction_read_only=on') as conn:
            conn.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
            with conn.cursor() as cursor:
                result = backfill.prepare_manifest(cursor)
        result['rows'] = [r for r in result['rows'] if r['profile_id'] == self.profile_id]
        self.assertEqual(len(result['rows']), 1)
        return result

    def apply_manifest(self, manifest, **kwargs):
        with base.psycopg.connect(**base.CONFIG) as conn:
            with conn.cursor() as cursor:
                return backfill.run_manifest(cursor, manifest, **kwargs)

    def events(self):
        with base.psycopg.connect(**base.CONFIG) as conn:
            return conn.execute('SELECT model_key,status,payload FROM public.platform_read_model_outbox '
                                'WHERE model_key LIKE %s ORDER BY model_key', [self.prefix + '%']).fetchall()

    def test_preview_commit_replay_and_receipt_guarded_rollback(self):
        manifest = self.manifest()
        before = self.row()
        self.assertEqual(self.apply_manifest(manifest)[0]['status'], 'would_update')
        self.assertEqual(self.row(), before)
        receipt = self.apply_manifest(manifest, apply=True)
        self.assertEqual(receipt[0]['status'], 'updated')
        self.assertEqual(len(self.events()), 2)
        after = self.row()
        self.assertEqual(self.apply_manifest(manifest, apply=True)[0]['status'], 'already_applied')
        self.assertEqual(len(self.events()), 2)
        self.assertEqual(self.row(), after)
        with self.assertRaises(backfill.IdentityReconciliationError):
            self.apply_manifest(manifest, apply=True, rollback=True)
        self.apply_manifest(manifest, apply=True, rollback=True,
                            receipts={str(self.profile_id): receipt[0]['digest']})
        restored = self.row()
        self.assertEqual({k: v for k, v in before.items() if k != 'updated_at'},
                         {k: v for k, v in restored.items() if k != 'updated_at'})
        self.assertEqual(len(self.events()), 4)

    def test_source_drift_and_corrupt_schema_manifest_abort(self):
        manifest = self.manifest()
        wrong = copy.deepcopy(manifest); wrong['schema_digest'] = 'bad'
        with self.assertRaises(backfill.IdentityReconciliationError):
            self.apply_manifest(wrong, apply=True)
        before = self.row()
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Phone_number"=\'newer\' WHERE id=%s', [self.source_id])
        with self.assertRaises(backfill.IdentityReconciliationError):
            self.apply_manifest(manifest, apply=True)
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])

    def test_profile_drift_and_wrong_uuid_abort(self):
        manifest = self.manifest()
        wrong = copy.deepcopy(manifest); wrong['rows'][0]['uuid'] = str(base.uuid4())
        with self.assertRaises(backfill.IdentityReconciliationError):
            self.apply_manifest(wrong, apply=True)
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET phone_number=\'edited\' WHERE id=%s', [self.profile_id])
        before = self.row()
        with self.assertRaises(backfill.IdentityReconciliationError):
            self.apply_manifest(manifest, apply=True)
        self.assertEqual(self.row(), before)

    def test_atomic_source_profile_and_durable_events(self):
        from django.db import connections, transaction
        with transaction.atomic():
            with connections['default'].cursor() as cursor:
                cursor.execute('UPDATE enrolment."Created_users" SET "Username"=\'Newest name\',"Phone_number"=\'456\' WHERE id=%s', [self.source_id])
            result = sync.sync_contacts_in_transaction(self.source_id, using='default')
            self.assertEqual(result.status, 'updated')
            self.invalidate.assert_not_called()
        self.invalidate.assert_called_once()
        self.assertEqual((self.row()['full_name'], self.row()['phone_number']), ('Newest name', '456'))
        self.assertEqual(len(self.events()), 2)
        self.assertTrue(all(r[1] == 'pending' and r[2] == {'reason': 'verified-contact-change'} for r in self.events()))

    def test_contact_only_writer_commits_and_preserves_other_source_fields(self):
        from django.db import connections
        user = NS(pk=self.source_id, uuid=self.uid, username='Edited name', phone_number='789',
                  _state=NS(db='enrolment'))
        def save(*, using, update_fields):
            self.assertEqual(using, 'enrolment')
            self.assertEqual(set(update_fields), {'username', 'phone_number'})
            with connections[using].cursor() as cursor:
                cursor.execute('UPDATE enrolment."Created_users" SET "Username"=%s,"Phone_number"=%s WHERE id=%s',
                               [user.username, user.phone_number, user.pk])
        user.save = save
        result = sync.save_verified_contact_fields(user, {'username': user.username, 'phone_number': user.phone_number})
        self.assertEqual(result.status, 'updated')
        self.assertEqual((self.row()['full_name'], self.row()['phone_number']), ('Edited name', '789'))
        self.assertEqual(len(self.events()), 2)

    def test_contact_only_writer_rolls_back_on_conflict_and_rejects_stale_uuid(self):
        from django.db import connections, DatabaseError
        user = NS(pk=self.source_id, uuid=self.uid, _state=NS(db='enrolment'))
        def save(**kwargs):
            with connections['enrolment'].cursor() as cursor:
                cursor.execute('UPDATE enrolment."Created_users" SET "Phone_number"=\'new\' WHERE id=%s', [self.source_id])
        user.save = save
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET email=%s WHERE id=%s', ['conflict-' + self.email, self.profile_id])
        with self.assertRaises(DatabaseError):
            sync.save_verified_contact_fields(user, ['phone_number'])
        with base.psycopg.connect(**base.CONFIG) as conn:
            self.assertEqual(conn.execute('SELECT "Phone_number" FROM enrolment."Created_users" WHERE id=%s', [self.source_id]).fetchone()[0], '123')
        user.uuid = base.uuid4()
        user.save = Mock()
        with self.assertRaises(DatabaseError):
            sync.save_verified_contact_fields(user, ['phone_number'])
        user.save.assert_not_called()
        self.assertEqual(self.events(), [])

    def test_manifest_rejects_autocommit_and_different_database_identity(self):
        manifest = self.manifest()
        with base.psycopg.connect(**base.CONFIG, autocommit=True) as conn:
            with conn.cursor() as cursor, self.assertRaises(backfill.IdentityReconciliationError) as caught:
                backfill.run_manifest(cursor, manifest, apply=True)
            self.assertEqual(caught.exception.code, 'transaction_required')
        wrong = copy.deepcopy(manifest); wrong['branch_id'] = 'wrong-branch'
        with self.assertRaises(backfill.IdentityReconciliationError) as caught:
            self.apply_manifest(wrong, apply=True)
        self.assertEqual(caught.exception.code, 'manifest_database_mismatch')

    def test_publication_failure_rolls_back_source_profile_and_events(self):
        from django.db import connections, transaction, DatabaseError
        before = self.row()
        original = sync.publish_contact_refresh
        def fail(cursor, sid):
            original(cursor, sid)
            cursor.execute('SELECT 1/0')
        with self.assertRaises(DatabaseError), patch.object(sync, 'publish_contact_refresh', fail):
            with transaction.atomic():
                with connections['default'].cursor() as cursor:
                    cursor.execute('UPDATE enrolment."Created_users" SET "Phone_number"=\'456\' WHERE id=%s', [self.source_id])
                sync.sync_contacts_in_transaction(self.source_id, using='default')
        self.assertEqual(self.row(), before)
        self.assertEqual(self.events(), [])
        self.invalidate.assert_not_called()
        with base.psycopg.connect(**base.CONFIG) as conn:
            self.assertEqual(conn.execute('SELECT "Phone_number" FROM enrolment."Created_users" WHERE id=%s', [self.source_id]).fetchone()[0], '123')

    def test_unmatched_source_preserved_without_creation(self):
        from django.db import transaction
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET enrolment_id=NULL WHERE id=%s', [self.profile_id])
        before = self.row()
        with transaction.atomic():
            self.assertEqual(sync.sync_contacts_in_transaction(self.source_id, using='default').status, 'unlinked_preserved')
        self.assertEqual(self.row(), before)
        self.assertEqual(len(self.events()), 2)

    def test_conflict_rolls_back_source_and_rejects_other_worker_database(self):
        from django.db import connections, transaction, DatabaseError
        with base.psycopg.connect(**base.CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET email=%s WHERE id=%s', ['different-' + self.email, self.profile_id])
        before = self.row()
        with self.assertRaises(DatabaseError), transaction.atomic():
            sync.sync_contacts_in_transaction(self.source_id, using='default')
        self.assertEqual(self.row(), before)
        with transaction.atomic(using='enrolment'):
            with patch.dict(connections['default'].settings_dict, HOST='unapproved.invalid'):
                with self.assertRaises(DatabaseError):
                    sync.sync_contacts_in_transaction(self.source_id, using='enrolment')

    def test_existing_worker_retry_and_recovery_with_fresh_builder(self):
        from django.db import transaction
        from django.utils import timezone
        from read_models import worker, registry
        from read_models.models import ReadModelEvent
        key = self.prefix + 'learner.home'
        with transaction.atomic():
            sync.sync_contacts_in_transaction(self.source_id, using='default')
        def build(_):
            with base.psycopg.connect(**base.CONFIG) as conn:
                return {'name': conn.execute('SELECT full_name FROM "Learner".learners WHERE id=%s', [self.profile_id]).fetchone()[0]}
        builder = Mock(side_effect=RuntimeError('synthetic retry'))
        registry.register(registry.ReadModelSpec(key, 'learner', 1, 30, builder))
        # Do not purge or claim other workloads on the inherited child.
        with patch.object(worker, 'purge_processed_events'), patch.object(worker.logger, 'exception'):
            self.assertEqual(worker.process_once(model_key=key)['failed'], 1)
            event = ReadModelEvent.objects.get(model_key=key)
            self.assertEqual((event.status, event.attempts), ('retry', 1))
            ReadModelEvent.objects.filter(pk=event.pk).update(available_at=timezone.now())
            builder.side_effect = build
            self.assertEqual(worker.process_once(model_key=key)['completed'], 1)
        event.refresh_from_db()
        self.assertEqual(event.status, 'processed')
        with base.psycopg.connect(**base.CONFIG) as conn:
            payload = conn.execute('SELECT payload FROM public.platform_read_models WHERE model_key=%s', [key]).fetchone()[0]
            # Real Learner AppConfig registers psycopg JSON text compatibility.
            self.assertEqual(json.loads(payload) if isinstance(payload, str) else payload, {'name': 'Fresh source'})

    def test_concurrent_source_edit_makes_captured_backfill_abort(self):
        manifest = self.manifest()
        before = self.row()
        done = threading.Event()
        results = []
        def apply_old():
            try:
                self.apply_manifest(manifest, apply=True)
                results.append('unexpected_success')
            except backfill.IdentityReconciliationError as exc:
                results.append(exc.code)
            finally:
                done.set()
        with base.psycopg.connect(**base.CONFIG) as writer:
            writer.execute('UPDATE enrolment."Created_users" SET "Phone_number"=\'concurrent\' WHERE id=%s', [self.source_id])
            thread = threading.Thread(target=apply_old)
            thread.start()
            self.assertFalse(done.wait(0.5))
            writer.commit()
        thread.join(30)
        self.assertFalse(thread.is_alive())
        self.assertEqual(results, ['manifest_value_drift'])
        self.assertEqual(self.row(), before)


def configure(envelope):
    from django.conf import settings
    original = settings.configure
    def minimal(self, **kwargs):
        kwargs['INSTALLED_APPS'] = ['read_models']
        kwargs['DATABASES']['enrolment'] = copy.deepcopy(kwargs['DATABASES']['default'])
        kwargs['CACHES'] = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
        original(**kwargs)
    base.BRANCH = BRANCH
    with patch.object(type(settings), 'configure', minimal):
        base.psycopg, base.CONFIG = base.bootstrap(envelope)
    from learner_api.services import identity_reconciliation
    base.service = identity_reconciliation


if __name__ == '__main__':
    try:
        if sys.stdin.isatty() and os.name == 'nt':
            import msvcrt
            handle = msvcrt.get_osfhandle(sys.stdin.fileno()); mode = wintypes.DWORD()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)) or not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError('Private stdin unavailable')
        print('READY_FOR_PRIVATE_STDIN', flush=True)
        configure(json.loads(sys.stdin.readline()))
        before = base.fingerprint()
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(base.ReconciliationPostgresTests)
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(ContactTests))
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        intact = base.fingerprint() == before
        print(json.dumps(dict(tests=result.testsRun, failures=len(result.failures), errors=len(result.errors),
                              inherited_source_profiles_unchanged=intact, branch=BRANCH)), flush=True)
        sys.exit(0 if intact and result.wasSuccessful() else 1)
    except Exception as exc:
        import traceback
        print(json.dumps(dict(status='FAIL', error_type=type(exc).__name__,
                              locations=[(Path(f.filename).name, f.name, f.lineno) for f in traceback.extract_tb(exc.__traceback__)[-4:]])), flush=True)
        sys.exit(2)
