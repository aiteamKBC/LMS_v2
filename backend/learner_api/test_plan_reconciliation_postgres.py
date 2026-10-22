"""Opt-in disposable-branch integration runner. Never use manage.py test.

Read a provider-verified JSON envelope from stdin containing connection_url,
project_id, branch_id and parent_id. No credentials are written or printed.
No migration, table provisioning, repair or inherited-row mutation is performed.
"""
import sys
from pathlib import Path

# Direct execution must not shadow Python's stdlib selectors with our package.
sys.path[0] = str(Path(__file__).resolve().parent.parent)

import copy
import hashlib
import json
import os
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

PROJECT = 'green-term-97168878'
PARENT = 'br-raspy-sky-abvs8lq9'
BRANCH = 'br-aged-band-abmyv3yi'
BACKEND = Path(__file__).resolve().parent.parent
RUN = 'f01f02-pg-' + uuid4().hex


def bootstrap(envelope):
    assert envelope['project_id'] == PROJECT
    assert envelope['parent_id'] == PARENT
    assert envelope['branch_id'] == BRANCH and BRANCH != PARENT
    url = urlsplit(envelope['connection_url'])
    host = url.hostname.replace('-pooler.', '.')
    assert url.scheme in ('postgres', 'postgresql') and url.path == '/neondb'
    direct = urlunsplit(url._replace(netloc=url.netloc.replace(url.hostname, host)))
    # Only this child endpoint can be opened, including during Django startup.
    import psycopg
    from psycopg.conninfo import conninfo_to_dict
    original_connect = psycopg.connect

    def safe_connect(conninfo='', **kwargs):
        params = conninfo_to_dict(conninfo, **{k: v for k, v in kwargs.items()
                                             if k in ('host', 'dbname', 'user', 'password', 'port')})
        assert params.get('host') == host and params.get('dbname') == 'neondb', 'Unapproved database'
        return original_connect(conninfo, **kwargs)

    psycopg.connect = safe_connect
    with psycopg.connect(direct, options='-c default_transaction_read_only=on') as conn:
        row = conn.execute("SELECT current_database(),current_setting('neon.branch_id',true),"
                           "current_setting('transaction_read_only')").fetchone()
        assert row == ('neondb', BRANCH, 'on'), 'Identity preflight failed'
    sys.path.insert(0, str(BACKEND))
    sys.argv = [sys.argv[0], 'shell']  # existing app-ready warmup exclusion
    # Process-only test configuration. Local environment files are not loaded.
    for key in ('DATABASE_URL', 'Database_url', 'DATABASEURL', 'ENROLMENT_DATABASE_URL', 'security_Database_url'):
        os.environ[key] = direct
    for key in ('AUDIT_DATABASE_URL', 'AUDIT_CLONE_DATABASE_URL', 'LASR-ADUTIOD-CLNE',
                'KBC_ATTENDANCE_DATABASE_URL', 'CACHE_URL', 'REDIS_URL'):
        os.environ[key] = ''
    for key in ('DB_POOL', 'DJANGO_USE_SQLITE', 'READ_MODEL_OUTBOX_ENABLED',
                'READ_MODEL_DUAL_WRITE_ENABLED', 'USE_SECURITY_TEST_BRANCH',
                'CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP'):
        os.environ[key] = 'false'
    os.environ.update(DJANGO_SETTINGS_MODULE='config.settings', RUN_APP_ON_TEST_BRANCH='1',
                      DJANGO_SECRET_KEY='synthetic-integration-only', DJANGO_DEBUG='false',
                      DB_CONN_MAX_AGE='0', DB_CONNECT_TIMEOUT='15', AZURE_MAIL_SEND_ENABLED='false')
    original_read = Path.read_text
    def read_without_env(path, *args, **kwargs):
        return '' if path.name.startswith('.env') else original_read(path, *args, **kwargs)
    def reject_external(event, args):
        if event == 'socket.connect' and args[1][0] in ('127.0.0.1', '::1'):
            return  # asyncio's local wakeup pair; no external transport
        if event in ('socket.connect', 'subprocess.Popen', 'os.system'):
            raise RuntimeError('External transport forbidden during integration')
    sys.addaudithook(reject_external)
    import django
    with patch.object(Path, 'read_text', read_without_env):
        django.setup()
    from django.conf import settings
    from django.db import connections, router
    from learner_api.models import LearnerProfile
    assert set(settings.DATABASES) == {'default', 'enrolment'}
    for alias in connections:
        cfg = connections[alias].settings_dict
        assert cfg['HOST'] == host and cfg['NAME'] == 'neondb'
        with connections[alias].cursor() as cur:
            cur.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
            assert cur.fetchone() == ('neondb', BRANCH)
            cur.execute("SET statement_timeout='20s'")
            cur.execute("SET lock_timeout='8s'")
    assert router.db_for_write(LearnerProfile) == 'enrolment'
    print(json.dumps({'preflight': 'PASS', 'project': PROJECT, 'parent': PARENT,
                      'branch': BRANCH, 'database': 'neondb', 'aliases': list(connections),
                      'router_learner_write': 'enrolment', 'env_files_loaded': False}), flush=True)
    return connections


def query(sql, params=None, alias='enrolment'):
    with CONNECTIONS[alias].cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else cur.rowcount


def progress_manifest():
    return query('SELECT id,plan_component_id,md5(to_jsonb(p)::text) '
                 'FROM "Learner".learner_progress_entries p '
                 'WHERE plan_component_id IS NOT NULL ORDER BY id')


def new_profile():
    return query('INSERT INTO "Learner".learners(full_name,email,lifecycle_status) '
                 'VALUES(%s,%s,%s) RETURNING id', [RUN, RUN + '-' + uuid4().hex + '@example.invalid', 'active'])[0][0]


def plan():
    return [{'moduleId': RUN + '-M', 'moduleTitle': 'Synthetic module', 'weeks': [
        {'weekId': RUN + '-W1', 'weekTitle': 'One', 'components': [
            {'componentId': RUN + '-C1', 'componentTitle': 'One'},
            {'componentId': RUN + '-C2', 'componentTitle': 'Two'}]},
        {'weekId': RUN + '-W2', 'weekTitle': 'Two', 'components': []}]}]


def tree(pid):
    return [query('SELECT id,position,module_ref,module_title FROM "Learner".learner_training_plan_modules '
                  'WHERE learner_id=%s ORDER BY id', [pid]),
            query('SELECT w.id,w.plan_module_id,w.position,w.week_ref,w.week_title '
                  'FROM "Learner".learner_training_plan_weeks w JOIN "Learner".learner_training_plan_modules m '
                  'ON m.id=w.plan_module_id WHERE m.learner_id=%s ORDER BY w.id', [pid]),
            query('SELECT c.id,c.plan_week_id,c.position,c.component_ref,c.component_title '
                  'FROM "Learner".learner_training_plan_components c JOIN "Learner".learner_training_plan_weeks w '
                  'ON w.id=c.plan_week_id JOIN "Learner".learner_training_plan_modules m ON m.id=w.plan_module_id '
                  'WHERE m.learner_id=%s ORDER BY c.id', [pid])]


def add_progress(pid, cid):
    # No submitted timestamp/session/canonical source: reviewed reward/attendance
    # triggers cannot match existing sessions/policies or inherited activities.
    return query('INSERT INTO "Learner".learner_progress_entries'
                 '(learner_id,entry_order,kind,plan_component_id,module_ref,week_ref,component_ref) '
                 'VALUES(%s,1,%s,%s,%s,%s,%s) RETURNING id',
                 [pid, 'component', cid, RUN + '-M', RUN + '-W1', RUN + '-C1'])[0][0]


class PostgresReconciliationTests(unittest.TestCase):
    def setUp(self):
        if globals().get('CONNECTIONS') is None:
            raise RuntimeError('Opt-in disposable-branch preflight is required before any Django transaction')
        from django.db import transaction
        from learner_api.models import LearnerProfile
        self.atomic = transaction.atomic(using='enrolment')
        self.atomic.__enter__()
        self.pid = new_profile()
        self.profile = LearnerProfile.objects.using('enrolment').get(pk=self.pid)
        self.plan = plan()

    def tearDown(self):
        from django.db import transaction
        transaction.set_rollback(True, using='enrolment')
        self.atomic.__exit__(None, None, None)

    def replace(self, value):
        from learner_api.active_users import replace_training_plan
        replace_training_plan(self.profile, value)

    def test_01_identical_replay_stable_ids_and_progress(self):
        self.replace(self.plan)
        before = tree(self.pid)
        progress_id = add_progress(self.pid, before[2][0][0])
        self.replace(self.plan)
        self.assertEqual(tree(self.pid), before)
        self.assertEqual(query('SELECT plan_component_id FROM "Learner".learner_progress_entries WHERE id=%s',
                               [progress_id]), [(before[2][0][0],)])

    def test_02_reorder_rename_and_insert_preserve_ids(self):
        self.replace(self.plan)
        before = tree(self.pid)
        add_progress(self.pid, before[2][0][0])
        self.plan[0]['weeks'].reverse()
        self.plan[0]['weeks'][1]['components'].reverse()
        self.plan[0]['moduleTitle'] = 'Changed synthetic title'
        self.plan.insert(0, {'moduleId': RUN + '-new', 'weeks': []})
        self.replace(self.plan)
        after = tree(self.pid)
        self.assertEqual(after[0][0][0], before[0][0][0])
        self.assertEqual(after[0][0][1], 2)
        for level in (1, 2):
            self.assertEqual([r[0] for r in before[level]], [r[0] for r in after[level]])
        self.assertEqual(after[1][0][2], 2)
        self.assertEqual(after[2][0][2], 2)

    def test_03_linked_removals_are_atomic_refusals(self):
        from django.db import DatabaseError
        self.replace(self.plan)
        before = tree(self.pid)
        add_progress(self.pid, before[2][0][0])
        original = progress_manifest()
        for desired in (None, [], [{'moduleId': RUN + '-replacement'}]):
            with self.assertRaises(DatabaseError):
                self.replace(desired)
            self.assertEqual(tree(self.pid), before)
            self.assertEqual(progress_manifest(), original)

    def test_04_unlinked_removals_and_linked_sibling(self):
        self.replace(self.plan)
        before = tree(self.pid)
        progress_id = add_progress(self.pid, before[2][0][0])
        self.plan[0]['weeks'][0]['components'].pop()
        self.replace(self.plan)
        self.assertEqual(len(tree(self.pid)[2]), 1)
        self.assertEqual(query('SELECT plan_component_id FROM "Learner".learner_progress_entries WHERE id=%s',
                               [progress_id]), [(before[2][0][0],)])

    def test_05_unlinked_full_unassignment(self):
        self.replace(self.plan)
        self.replace([])
        self.assertEqual(tree(self.pid), [[], [], []])

    def test_06_real_sql_failure_rolls_back_prior_updates(self):
        from django.db import DataError
        self.replace(self.plan)
        before = tree(self.pid)
        changed = copy.deepcopy(self.plan)
        changed[0]['moduleTitle'] = 'Should roll back'
        changed[0]['weeks'][0]['components'].append({'componentId': RUN + '-new'})
        def fail_after_insert(execute, sql, params, many, context):
            if sql.startswith('INSERT INTO "Learner"."learner_training_plan_components"'):
                execute(sql, params, many, context)
                # Real PostgreSQL error aborts the transaction after earlier updates.
                context['connection'].connection.execute('SELECT 1/0')
            return execute(sql, params, many, context)
        # psycopg error is raised by the explicit driver call; catch the native
        # class while Django's atomic context executes real savepoint rollback.
        import psycopg
        with CONNECTIONS['enrolment'].execute_wrapper(fail_after_insert):
            with self.assertRaises((DataError, psycopg.errors.DivisionByZero)):
                self.replace(changed)
        self.assertEqual(tree(self.pid), before)

    def test_07_actual_parent_position_uniqueness(self):
        from django.db import IntegrityError, transaction
        self.replace(self.plan)
        before = tree(self.pid)
        with self.assertRaises(IntegrityError):
            with transaction.atomic(using='enrolment'):
                query('INSERT INTO "Learner".learner_training_plan_modules(learner_id,position,module_ref) '
                      'VALUES(%s,1,%s)', [self.pid, RUN + '-duplicate-position'])
        self.assertEqual(tree(self.pid), before)

    def test_08_ambiguous_identity_and_parent_change_fail_closed(self):
        from django.db import DatabaseError
        self.replace(self.plan)
        before = tree(self.pid)
        add_progress(self.pid, before[2][0][0])
        moved = copy.deepcopy(self.plan)
        moved[0]['weeks'][1]['components'] = moved[0]['weeks'][0]['components']
        moved[0]['weeks'][0]['components'] = []
        for desired in ([self.plan[0], self.plan[0]], [{'moduleTitle': 'Synthetic module'}], moved):
            with self.assertRaises(DatabaseError):
                self.replace(desired)
            self.assertEqual(tree(self.pid), before)

    def source(self, training, learning):
        from learner_api.models import EnrolmentUser
        sid = query('INSERT INTO enrolment."Created_users"'
                    '("Username","Email","Learner_type","Training_plan","Learning_plan") '
                    'VALUES(%s,%s,%s,%s::jsonb,%s::jsonb) RETURNING id',
                    [RUN, RUN + '@example.invalid', 'commercial',
                     json.dumps(training) if training is not None else None,
                     json.dumps(learning) if learning is not None else None])[0][0]
        query('UPDATE "Learner".learners SET enrolment_id=%s WHERE id=%s', [sid, self.pid])
        return EnrolmentUser.all_learners.using('enrolment').get(pk=sid)

    def test_09_real_mirror_null_empty_precedence_and_replay(self):
        from learner_api.learning_plan import sync_learning_plan_mirror
        from learner_api.models import EnrolmentUser
        source = self.source([], self.plan)
        self.assertEqual(sync_learning_plan_mirror(source, strict=True), 0)
        self.assertEqual(query('SELECT learning_plan IS NULL,learning_plan=%s::jsonb '
                               'FROM "Learner".learners WHERE id=%s', ['[]', self.pid]), [(False, True)])
        sync_learning_plan_mirror(source, strict=True)
        self.assertEqual(tree(self.pid), [[], [], []])
        query('UPDATE enrolment."Created_users" SET "Training_plan"=NULL,"Learning_plan"=NULL WHERE id=%s',
              [source.pk])
        source = EnrolmentUser.all_learners.using('enrolment').get(pk=source.pk)
        sync_learning_plan_mirror(source, strict=True)
        self.assertEqual(query('SELECT learning_plan IS NULL FROM "Learner".learners WHERE id=%s',
                               [self.pid]), [(True,)])
        # A populated Training_plan still wins over an empty Learning_plan.
        query('UPDATE enrolment."Created_users" SET "Training_plan"=%s::jsonb,"Learning_plan\"=%s::jsonb '
              'WHERE id=%s', [json.dumps(self.plan), '[]', source.pk])
        source = EnrolmentUser.all_learners.using('enrolment').get(pk=source.pk)
        self.assertEqual(sync_learning_plan_mirror(source, strict=True), 1)
        before = tree(self.pid)
        sync_learning_plan_mirror(source, strict=True)
        self.assertEqual(tree(self.pid), before)

    def test_10_final_mirror_write_failure_rolls_back_the_whole_mirror(self):
        from learner_api.learning_plan import sync_learning_plan_mirror
        source = self.source(self.plan, None)
        before = tree(self.pid)
        def fail_legacy_write(execute, sql, params, many, context):
            if sql.startswith('UPDATE "enrolment"."Created_users"'):
                context['connection'].connection.execute('SELECT 1/0')
            return execute(sql, params, many, context)
        import psycopg
        with CONNECTIONS['enrolment'].execute_wrapper(fail_legacy_write):
            with self.assertRaises(psycopg.errors.DivisionByZero):
                sync_learning_plan_mirror(source, strict=True)
        self.assertEqual(tree(self.pid), before)
        self.assertEqual(query('SELECT learning_plan IS NULL FROM "Learner".learners WHERE id=%s',
                               [self.pid]), [(True,)])
        self.assertEqual(query('SELECT count(*) FROM "Learner".learner_free_courses WHERE learner_id=%s',
                               [self.pid]), [(0,)])


def concurrency_check():
    """Real separate Django connections: prove B waits for A's profile lock."""
    from django.db import transaction
    from learner_api.models import LearnerProfile
    from learner_api.active_users import replace_training_plan
    pid = new_profile()  # committed fixture, visible to both connections
    errors, pids = [], []
    locked, started, done, release = (threading.Event() for _ in range(4))
    def writer_a():
        try:
            with transaction.atomic(using='enrolment'):
                LearnerProfile.objects.using('enrolment').select_for_update().get(pk=pid)
                pids.append(query('SELECT pg_backend_pid()')[0][0])
                locked.set()
                assert release.wait(12), 'Release timeout'
                replace_training_plan(LearnerProfile(pk=pid), plan())
        except Exception as exc:
            errors.append(type(exc).__name__)
        finally:
            CONNECTIONS.close_all()
    def writer_b():
        try:
            assert locked.wait(8)
            pids.append(query('SELECT pg_backend_pid()')[0][0])
            started.set()
            replace_training_plan(LearnerProfile(pk=pid), plan())
            done.set()
        except Exception as exc:
            errors.append(type(exc).__name__)
        finally:
            CONNECTIONS.close_all()
    a, b = threading.Thread(target=writer_a), threading.Thread(target=writer_b)
    try:
        a.start(); b.start()
        assert started.wait(12), 'Writer B did not start'
        waiting = False
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if query('SELECT cardinality(pg_blocking_pids(%s))', [pids[1]])[0][0] > 0:
                waiting = True
                break
            time.sleep(0.1)
        assert waiting and not done.is_set(), 'Expected real profile-lock contention'
        release.set()
        a.join(25); b.join(25)
        assert not a.is_alive() and not b.is_alive() and not errors and done.is_set(), errors
        before = tree(pid)
        assert list(map(len, before)) == [1, 2, 2]
        replace_training_plan(LearnerProfile(pk=pid), plan())
        assert tree(pid) == before
        print(json.dumps({'concurrent_reconciliation': 'PASS', 'distinct_backends': len(set(pids)) == 2,
                          'observed_pg_blocking_pids': True}), flush=True)
    finally:
        release.set()
        if a.is_alive(): a.join(25)
        if b.is_alive(): b.join(25)
        if a.is_alive() or b.is_alive():
            raise RuntimeError('Workers still running; preserve branch for inspection')
        # Only this run's committed synthetic fixture, after all workers exit.
        assert query('SELECT full_name FROM "Learner".learners WHERE id=%s', [pid]) == [(RUN,)]
        query('DELETE FROM "Learner".learners WHERE id=%s AND full_name=%s', [pid, RUN])


if __name__ == '__main__':
    try:
        if os.name == 'nt' and sys.stdin.isatty():
            import ctypes
            import msvcrt
            handle = msvcrt.get_osfhandle(sys.stdin.fileno())
            mode = ctypes.c_ulong()
            if not ctypes.windll.kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                raise RuntimeError('Cannot disable credential echo')
            if not ctypes.windll.kernel32.SetConsoleMode(handle, mode.value & ~4):
                raise RuntimeError('Cannot disable credential echo')
        print('READY_FOR_PRIVATE_STDIN', flush=True)
        envelope = json.loads(sys.stdin.readline())
        CONNECTIONS = bootstrap(envelope)
        baseline = progress_manifest()
        linked = [(r[0], r[1]) for r in baseline if r[1] is not None]
        assert len(linked) == 911, 'Historical link count drift'
        print(json.dumps({'baseline_links': len(linked), 'baseline_progress_rows': len(baseline),
                          'link_digest': hashlib.sha256(json.dumps(linked).encode()).hexdigest()}), flush=True)
        if envelope.get('preflight_only'):
            print('PREFLIGHT_ONLY: no writes', flush=True)
        else:
            result = unittest.TextTestRunner(verbosity=2).run(
                unittest.defaultTestLoader.loadTestsFromTestCase(PostgresReconciliationTests))
            # Never start concurrency after a failed ordinary integration case.
            if result.wasSuccessful():
                concurrency_check()
            assert progress_manifest() == baseline, 'Inherited progress rows or links changed'
            assert query('SELECT count(*) FROM "Learner".learners WHERE full_name=%s', [RUN]) == [(0,)]
            print(json.dumps({'historical_progress_full_manifest': 'PASS', 'existing_links_preserved': 911,
                              'synthetic_cleanup': 'PASS', 'tests_run': result.testsRun,
                              'failures': len(result.failures), 'errors': len(result.errors)}), flush=True)
            sys.exit(0 if result.wasSuccessful() else 1)
    except Exception as exc:
        # No raw connection strings, credentials, historical payloads or server
        # error strings (which may contain row values) enter the report.
        import traceback
        print(json.dumps({'status': 'BLOCKED_OR_FAIL', 'error_type': type(exc).__name__,
                          'missing_module': getattr(exc, 'name', None),
                          'sqlstate': getattr(exc.__cause__ or exc, 'sqlstate', None),
                          'locations': [(Path(f.filename).name, f.name, f.lineno)
                                        for f in traceback.extract_tb(exc.__traceback__)[-5:]]}), flush=True)
        sys.exit(2)
