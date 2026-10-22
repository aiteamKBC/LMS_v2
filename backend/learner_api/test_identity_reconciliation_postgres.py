"""Opt-in synthetic integration on one pinned disposable Neon child only.

Private stdin envelope: project_id, branch_id, parent_id, connection_url.
Minimal Django settings: read-model app only; no project settings, signals, provisioning or env.
Fixtures use explicit random IDs (no sequence increments) and are cleaned up.
"""
import sys
from pathlib import Path

sys.path[0] = str(Path(__file__).resolve().parent.parent)

import ctypes
import json
import os
import threading
import unittest
from unittest.mock import patch
from urllib.parse import unquote, urlsplit
from uuid import uuid4

PROJECT = "green-term-97168878"
PARENT = "br-raspy-sky-abvs8lq9"
BRANCH = "br-shiny-surf-abijxb4p"


def bootstrap(envelope):
    if (envelope["project_id"], envelope["parent_id"], envelope["branch_id"]) != (PROJECT, PARENT, BRANCH):
        raise RuntimeError("Unapproved disposable branch")
    import psycopg
    url = urlsplit(envelope["connection_url"])
    if url.scheme not in {"postgres", "postgresql"} or url.path != "/neondb":
        raise RuntimeError("Unapproved database")
    cfg = dict(host=url.hostname.replace("-pooler.", "."), dbname="neondb", user=unquote(url.username),
               password=unquote(url.password), port=url.port or 5432, sslmode="require", connect_timeout=15)
    # Only open the supplied child endpoint; server-side identity must agree.
    with psycopg.connect(**cfg, options="-c default_transaction_read_only=on") as conn:
        if conn.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone() != ("neondb", BRANCH):
            raise RuntimeError("Server branch verification failed")
    from django.conf import settings
    settings.configure(SECRET_KEY="synthetic-only", INSTALLED_APPS=['read_models'], USE_TZ=True,
                       DATABASES={"default": {"ENGINE": "django.db.backends.postgresql", "NAME": cfg["dbname"],
                                  "HOST": cfg["host"], "PORT": cfg["port"], "USER": cfg["user"], "PASSWORD": cfg["password"],
                                  "OPTIONS": {"sslmode": "require", "connect_timeout": 15}, "CONN_MAX_AGE": 0}})
    import django
    django.setup()  # Read-model registry only; no project provisioning.
    return psycopg, cfg


class ReconciliationPostgresTests(unittest.TestCase):
    def setUp(self):
        self.source_id = 1_000_000_000 + uuid4().int % 900_000_000
        self.profile_id = 5_000_000_000_000 + uuid4().int % 1_000_000_000
        self.uid = uuid4()
        self.email = "f01-" + uuid4().hex + "@example.test"
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('''INSERT INTO enrolment."Created_users"
                (id,uuid,"Username","Email","Phone_number","Learner_type") OVERRIDING SYSTEM VALUE
                VALUES (%s,%s,'Fresh source',%s,'123','commercial')''', [self.source_id, self.uid, self.email])
            conn.execute('''INSERT INTO "Learner".learners
                (id,enrolment_id,uuid,full_name,email,phone_number,learner_type,lifecycle_status)
                OVERRIDING SYSTEM VALUE VALUES (%s,%s,%s,'Old profile',%s,'old','commercial','inactive')''',
                         [self.profile_id, self.source_id, self.uid, self.email])
        self.addCleanup(self.cleanup)
        if type(self) is ReconciliationPostgresTests:
            from learner_api.services import contact_sync
            original = contact_sync.contact_refresh_scopes
            self.identity_scope_prefix = f'f01identity.{self.uid}.'
            scoped = patch.object(contact_sync, 'contact_refresh_scopes',
                lambda cur, sid: [(self.identity_scope_prefix + model, kind, scope)
                                  for model, kind, scope in original(cur, sid)])
            scoped.start(); self.addCleanup(scoped.stop)

    def cleanup(self):
        from django.db import connections
        connections.close_all()
        with psycopg.connect(**CONFIG) as conn:
            if hasattr(self, 'identity_scope_prefix'):
                conn.execute('DELETE FROM public.platform_read_model_outbox WHERE model_key LIKE %s', [self.identity_scope_prefix + '%'])
                conn.execute('DELETE FROM public.platform_read_models WHERE model_key LIKE %s', [self.identity_scope_prefix + '%'])
            # Only this test's explicit synthetic IDs; never inherited records.
            conn.execute('DELETE FROM "Learner".learners WHERE id=%s AND uuid=%s', [self.profile_id, self.uid])
            conn.execute('DELETE FROM enrolment."Created_users" WHERE id=%s AND uuid=%s', [self.source_id, self.uid])

    def call(self, **kwargs):
        return service.reconcile_identity(self.source_id, self.profile_id, self.uid, using="default", **kwargs)

    def row(self):
        with psycopg.connect(**CONFIG, options="-c default_transaction_read_only=on") as conn:
            value = conn.execute('SELECT to_jsonb(l) FROM "Learner".learners l WHERE id=%s', [self.profile_id]).fetchone()[0]
            return json.loads(value) if isinstance(value, str) else value

    def test_01_preview_apply_replay_and_preserve_other_fields(self):
        before = self.row()
        self.assertEqual(self.call().status, "would_update")
        self.assertEqual(self.row(), before)
        self.assertEqual(self.call(apply=True).status, "updated")
        after = self.row()
        self.assertEqual(after["full_name"], "Fresh source")
        self.assertEqual(after["phone_number"], "123")
        self.assertEqual({k: v for k, v in before.items() if k not in {"full_name", "phone_number", "updated_at"}},
                         {k: v for k, v in after.items() if k not in {"full_name", "phone_number", "updated_at"}})
        self.assertEqual(self.call(apply=True).status, "unchanged")
        self.assertEqual(self.row(), after)

    def test_02_missing_link_preserved(self):
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('UPDATE "Learner".learners SET enrolment_id=NULL WHERE id=%s', [self.profile_id])
        before = self.row()
        with self.assertRaises(service.IdentityReconciliationError) as caught:
            self.call(apply=True)
        self.assertEqual(caught.exception.code, "profile_identity_conflict")
        self.assertEqual(self.row(), before)

    def test_03_uuid_and_email_conflicts_refused(self):
        before = self.row()
        with self.assertRaises(service.IdentityReconciliationError):
            service.reconcile_identity(self.source_id, self.profile_id, uuid4(), using="default", apply=True)
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Email"=%s WHERE id=%s',
                         ["changed-" + self.email, self.source_id])
        with self.assertRaises(service.IdentityReconciliationError) as caught:
            self.call(apply=True)
        self.assertEqual(caught.exception.code, "identity_review_required")
        self.assertEqual(self.row(), before)

    def test_04_real_database_failure_rolls_back_updated_projection(self):
        before = self.row()
        original = service._reconcile_locked
        def fail_after_update(cursor, *args, **kwargs):
            original(cursor, *args, **kwargs)
            cursor.execute("SELECT 1/0")
        with patch.object(service, "_reconcile_locked", fail_after_update):
            with self.assertRaises(service.IdentityReconciliationError) as caught:
                self.call(apply=True)
        self.assertEqual(caught.exception.code, "database_error")
        self.assertNotIn("division", str(caught.exception))
        self.assertEqual(self.row(), before)
        self.assertEqual(self.call(apply=True).status, "updated")

    def test_05_missing_profile_never_created(self):
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('DELETE FROM "Learner".learners WHERE id=%s', [self.profile_id])
        with self.assertRaises(service.IdentityReconciliationError) as caught:
            self.call(apply=True)
        self.assertEqual(caught.exception.code, "missing_profile")
        with psycopg.connect(**CONFIG) as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM "Learner".learners WHERE enrolment_id=%s',
                                          [self.source_id]).fetchone()[0], 0)

    def test_06_apprenticeship_empty_phone_and_name_fallback(self):
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('UPDATE enrolment."Created_users" SET "Learner_type"=\'apprenticeship\', '
                         '"Username"=NULL,"Phone_number"=NULL WHERE id=%s', [self.source_id])
            conn.execute('UPDATE "Learner".learners SET learner_type=\'apprenticeship\' WHERE id=%s', [self.profile_id])
        self.call(apply=True)
        self.assertEqual((self.row()["full_name"], self.row()["phone_number"]), (self.email, ""))

    def test_07_fresh_read_waits_for_concurrent_source_commit(self):
        from django.db import connections
        done = threading.Event()
        started = threading.Event()
        results = []
        def reconcile():
            started.set()
            try:
                results.append(self.call(apply=True))
            except Exception as exc:
                results.append(type(exc).__name__)
            finally:
                connections.close_all()
                done.set()
        with psycopg.connect(**CONFIG) as writer:
            writer.execute('UPDATE enrolment."Created_users" SET "Username"=\'Newest source\' WHERE id=%s', [self.source_id])
            thread = threading.Thread(target=reconcile)
            thread.start()
            self.assertTrue(started.wait(5))
            self.assertFalse(done.wait(0.5))
            writer.commit()
        thread.join(25)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(results), 1)
        self.assertEqual(getattr(results[0], "status", results[0]), "updated")
        self.assertEqual(self.row()["full_name"], "Newest source")

    def test_08_unique_id_uuid_and_link_constraints(self):
        for column, value in (("id", self.profile_id), ("uuid", self.uid), ("enrolment_id", self.source_id)):
            with self.subTest(column=column), psycopg.connect(**CONFIG) as conn:
                # Attempt a second synthetic profile using one duplicate stable key.
                vals = dict(id=self.profile_id + 1, uuid=uuid4(), enrolment_id=None)
                vals[column] = value
                with self.assertRaises(psycopg.errors.UniqueViolation):
                    conn.execute('''INSERT INTO "Learner".learners (id,uuid,enrolment_id,full_name,email,lifecycle_status)
                        OVERRIDING SYSTEM VALUE VALUES (%s,%s,%s,'Duplicate',%s,'inactive')''',
                                 [vals["id"], vals["uuid"], vals["enrolment_id"], "duplicate-" + self.email])
                conn.rollback()

    def test_09_refuse_outer_transaction_and_report_command_failure(self):
        from django.db import transaction
        from django.core.management.base import CommandError
        from learner_api.management.commands.reconcile_learner_identity import Command
        with transaction.atomic():
            with self.assertRaises(service.IdentityReconciliationError) as caught:
                self.call(apply=True)
            self.assertEqual(caught.exception.code, "outer_transaction_not_allowed")
        with self.assertRaises(CommandError) as caught:
            Command().handle(source_id=self.source_id, profile_id=self.profile_id,
                             expected_uuid=str(uuid4()), database="default", apply=True)
        self.assertIn("source_identity_conflict", str(caught.exception))
        self.assertNotIn(self.email, str(caught.exception))

    def test_10_commit_and_connection_failures_report_no_success(self):
        from django.db import DatabaseError, connections
        connection = connections["default"]
        before = self.row()
        with patch.object(connection, "_commit", side_effect=DatabaseError("private commit detail")):
            with self.assertRaises(service.IdentityReconciliationError) as caught:
                self.call(apply=True)
        self.assertEqual(caught.exception.code, "database_error")
        self.assertNotIn("private", str(caught.exception))
        self.assertEqual(self.row(), before)
        with patch.object(connection, "get_autocommit", side_effect=DatabaseError("private connection detail")):
            with self.assertRaises(service.IdentityReconciliationError) as caught:
                self.call(apply=True)
        self.assertEqual(caught.exception.code, "database_error")
        self.assertNotIn("private", str(caught.exception))

    def test_11_missing_source_preserves_dangling_profile(self):
        # The existing schema permits dangling enrolment links; retain that row.
        with psycopg.connect(**CONFIG) as conn:
            conn.execute('DELETE FROM enrolment."Created_users" WHERE id=%s', [self.source_id])
        before = self.row()
        with self.assertRaises(service.IdentityReconciliationError) as caught:
            self.call(apply=True)
        self.assertEqual(caught.exception.code, "missing_source")
        self.assertEqual(self.row(), before)

    def test_12_command_defaults_to_preview(self):
        from io import StringIO
        from learner_api.management.commands.reconcile_learner_identity import Command
        output = StringIO()
        command = Command(stdout=output)
        options = vars(command.create_parser("manage.py", "reconcile_learner_identity").parse_args([
            "--source-id", str(self.source_id), "--profile-id", str(self.profile_id),
            "--expected-uuid", str(self.uid), "--database", "default"]))
        before = self.row()
        command.handle(**options)
        self.assertIn("would_update", output.getvalue())
        self.assertNotIn(self.email, output.getvalue())
        self.assertEqual(self.row(), before)


def fingerprint():
    with psycopg.connect(**CONFIG, options="-c default_transaction_read_only=on") as conn:
        return tuple(conn.execute('SELECT count(*),md5(string_agg(md5(to_jsonb(t)::text),\'\' ORDER BY id)) FROM ' + table + ' t').fetchone()
                     for table in ('"Learner".learners', 'enrolment."Created_users"'))


if __name__ == "__main__":
    try:
        if sys.stdin.isatty() and os.name == "nt":
            import msvcrt
            from ctypes import wintypes
            handle = msvcrt.get_osfhandle(sys.stdin.fileno())
            mode = wintypes.DWORD()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)) or not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError("Cannot disable private input echo")
        print("READY_FOR_PRIVATE_STDIN", flush=True)
        psycopg, CONFIG = bootstrap(json.loads(sys.stdin.readline()))
        from learner_api.services import identity_reconciliation as service
        before = fingerprint()
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ReconciliationPostgresTests))
        intact = fingerprint() == before
        print(json.dumps(dict(tests=result.testsRun, failures=len(result.failures), errors=len(result.errors),
                              inherited_rows_unchanged=intact, branch=BRANCH)), flush=True)
        sys.exit(0 if result.wasSuccessful() and intact else 1)
    except Exception as exc:
        # Never render connection exceptions or bound fixture values.
        import traceback
        print(json.dumps(dict(status="BLOCKED_OR_FAIL", error_type=type(exc).__name__,
                              locations=[(Path(f.filename).name, f.name, f.lineno)
                                         for f in traceback.extract_tb(exc.__traceback__)[-4:]])), flush=True)
        sys.exit(2)
