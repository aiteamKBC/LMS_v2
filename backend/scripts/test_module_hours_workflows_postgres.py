"""Synthetic integration tests; refuses any cluster other than the disposable one.

Reuses the verified target contract runner, not Django's application test runner.
Network HTTP is prohibited. Existing data in shared environments is never used.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from test_module_hours_contract_postgres import prepare, configure, build_suite


def suite():
    from django.db import connection, connections, transaction
    from django.test import RequestFactory
    from curriculum_api import module_hours as hours, module_hours_workflows as workflow

    query = workflow.query
    migration = importlib.import_module('curriculum_api.migrations.0101_module_hours_workflows')
    with transaction.atomic():
        with connection.schema_editor() as editor:
            migration.forwards(None, editor)
        assert query("SELECT to_regclass('curriculum.module_hours_defaults')")[0][0]
        transaction.set_rollback(True)
    assert query("SELECT to_regclass('curriculum.module_hours_defaults')")[0][0] is None
    with connection.schema_editor() as editor:
        migration.forwards(None, editor)
        migration.forwards(None, editor)  # additive DDL retry
    query('''ALTER TABLE login."Login_accounts" ADD COLUMN "Subject_type" text DEFAULT 'staff',
        ADD COLUMN "Subject_id" bigint DEFAULT 10,ADD COLUMN "Role" text DEFAULT 'staff',
        ADD COLUMN "Is_active" boolean DEFAULT true;
        CREATE SCHEMA enrolment;
        CREATE TABLE enrolment."Staff_users"(id bigint PRIMARY KEY,"Access" text,"Access_extra" text);
        INSERT INTO enrolment."Staff_users" VALUES(10,'curriculum',NULL)''')

    class Workflows(unittest.TestCase):
        def setUp(self):
            query('''TRUNCATE curriculum.module_hours_default_revisions,curriculum.module_hours_operation_items,
                curriculum.module_hours_operations,curriculum.module_hours_defaults,
                curriculum.module_hours_targets,curriculum.module_hours_access,curriculum.module_hours_audit''')
            query('UPDATE login."Login_accounts" SET "Is_active"=true,"Role"=\'staff\'')
            query('UPDATE enrolment."Staff_users" SET "Access"=\'curriculum\'')
            hours._PRESENT.clear()
            self.factory = RequestFactory()
            self.actor = SimpleNamespace(id=10, role='staff', subject_type='staff', is_active=True)
            def authenticate(request):
                request.login_account = self.actor
                return self.actor
            def stored(identifier):
                if identifier in {'M1', 'M2'}:
                    return identifier, {'title': 'Synthetic', 'programme_id': 'P1'}
            def lock(identifier):
                query('SELECT 1 FROM curriculum.modules WHERE module_catalogue_id=%s FOR UPDATE', [identifier])
            for name, kwargs in [
                ('login.permissions.authenticate_request', {'side_effect': authenticate}),
                ('login.permissions._accesses_of', {'return_value': {'curriculum'}}),
                ('curriculum_api.module_hours.stored_module', {'side_effect': stored}),
                ('curriculum_api.views.archived_programme_module_edit_error', {'return_value': None}),
                ('curriculum_api.views.lock_module_structure_row', {'side_effect': lock})]:
                p = patch(name, **kwargs); p.start(); self.addCleanup(p.stop)
            with transaction.atomic():
                hours.write_access(10, True, False, 0, 99)

        def call(self, view, data=None, method='POST'):
            request = (self.factory.get('/hours/', data or {}) if method == 'GET' else
                self.factory.post('/hours/', data=json.dumps(data), content_type='application/json',
                                  HTTP_X_REQUESTED_WITH='XMLHttpRequest'))
            response = view(request)
            return response.status_code, json.loads(response.content)

        def preview(self, kind='set_targets', items=None):
            return self.call(workflow.preview, {'operation': kind, 'items': items or [
                {'moduleId': name, 'targetMinutes': 120, 'expectedRevision': 0} for name in ['M1', 'M2']]})

        def confirm(self, preview, key=None):
            return self.call(workflow.confirm, {k: preview[k] for k in ['previewToken', 'fingerprint']} |
                             {'confirmed': True, 'idempotencyKey': key or str(uuid4())})

        def count(self, name):
            return query('SELECT count(*) FROM curriculum.' + name)[0][0]

        def test_preview_does_not_write(self):
            status, result = self.preview()
            self.assertEqual(status, 200)
            self.assertTrue(result['canConfirm'])
            self.assertEqual(self.count('module_hours_targets'), 0)
            self.assertEqual(self.count('module_hours_operations'), 0)

        def test_retired_recovery_bridges_are_not_recreated_by_migration(self):
            query('''CREATE TABLE IF NOT EXISTS curriculum.free_programme_components(id varchar PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS "Learner".subject_activity_attempts(id bigint PRIMARY KEY,source_activity_fk bigint NOT NULL)''')
            bridge = importlib.import_module('learner_api.migrations.0029_free_course_historical_bridges')
            with connection.schema_editor() as editor:
                bridge.install(None, editor)
                bridge.install(None, editor)
            for name in ('free_course_hours_migration', 'free_course_hours_migration_additional', 'free_course_hours_migration_remaining'):
                self.assertIsNone(query('SELECT to_regclass(%s)', ['"Learner".' + name])[0][0])

        def test_canonical_identity_migration_is_additive_and_preserves_ledger(self):
            query('''CREATE TABLE IF NOT EXISTS curriculum.free_courses(id varchar(128) PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS curriculum.free_course_weeks(id varchar(128) PRIMARY KEY,course_id varchar(128));
                CREATE TABLE IF NOT EXISTS curriculum.free_programme_components(id varchar PRIMARY KEY);
                ALTER TABLE curriculum.free_programme_components ADD COLUMN IF NOT EXISTS free_module_id varchar(128);
                ALTER TABLE "Learner".learner_progress_entries ADD COLUMN IF NOT EXISTS learner_id bigint''')
            migration = importlib.import_module('learner_api.migrations.0033_canonical_free_course_ledger_identity')
            before = query('SELECT id,learner_id FROM "Learner".learner_progress_entries ORDER BY id')
            with connection.schema_editor() as editor:
                migration.install(None, editor)
                migration.install(None, editor)
            self.assertEqual(query('SELECT id,learner_id FROM "Learner".learner_progress_entries ORDER BY id'), before)
            self.assertEqual(query('''SELECT count(*) FROM pg_constraint WHERE conrelid='"Learner".learner_progress_entries'::regclass
                AND conname LIKE 'lpe_free_%%' AND convalidated''')[0][0], 3)

        def test_new_storage_enforces_foreign_keys_and_positive_minutes(self):
            from django.db import IntegrityError
            for module, minutes in [('missing', 10), ('M1', 0), ('M1', -1)]:
                with self.assertRaises(IntegrityError), transaction.atomic():
                    query('''INSERT INTO curriculum.module_hours_defaults(id,module_id,module_key,target_minutes,revision,updated_at)
                        VALUES(%s,%s,%s,%s,1,now())''', [str(uuid4()), module, module, minutes])
            self.assertEqual(self.count('module_hours_defaults'), 0)

        def test_atomic_apply_and_replay_by_key_and_nonce(self):
            protected = {table: query('SELECT to_jsonb(t) FROM "Learner".' + table + ' t ORDER BY id')
                         for table in ['learner_progress_entries', 'learner_journal_rows']}
            _, preview = self.preview()
            key = str(uuid4())
            status, result = self.confirm(preview, key)
            self.assertEqual(status, 200, result)
            self.assertEqual(self.count('module_hours_targets'), 2)
            for retry_key in [key, str(uuid4())]:
                status, replay = self.confirm(preview, retry_key)
                self.assertEqual(status, 200, replay)
                self.assertTrue(replay['replayed'])
                self.assertEqual(replay['operationId'], result['operationId'])
            self.assertEqual(self.count('module_hours_operations'), 1)
            for table, rows in protected.items():
                self.assertEqual(query('SELECT to_jsonb(t) FROM "Learner".' + table + ' t ORDER BY id'), rows)

        def test_stale_member_aborts_whole_selection(self):
            _, preview = self.preview()
            with transaction.atomic(): hours.write_target('M2', 90, 0, 10)
            self.assertEqual(self.confirm(preview)[0], 409)
            self.assertEqual(hours.read_target('M1')['revision'], 0)
            self.assertEqual(self.count('module_hours_operations'), 0)

        def test_revocation_inside_transaction(self):
            _, preview = self.preview()
            with transaction.atomic(): hours.write_access(10, False, True, 1, 99)
            self.assertEqual(self.confirm(preview)[0], 403)
            self.assertEqual(self.count('module_hours_targets'), 0)

        def test_live_identity_and_workspace_revocation(self):
            _, preview = self.preview()
            query('UPDATE enrolment."Staff_users" SET "Access"=\'enrolment\'')
            self.assertEqual(self.confirm(preview)[0], 403)
            query('UPDATE enrolment."Staff_users" SET "Access"=\'curriculum\'')
            query('UPDATE login."Login_accounts" SET "Is_active"=false WHERE id=10')
            self.assertEqual(self.confirm(preview)[0], 403)

        def test_no_implicit_manager_power(self):
            with transaction.atomic(): hours.write_access(10, False, True, 1, 99)
            self.assertEqual(self.preview()[0], 403)

        def test_failure_rolls_back_targets_audits_and_operation(self):
            _, preview = self.preview()
            original = hours.write_target
            def fail_second(module, *args):
                if module == 'M2': raise hours.RevisionConflict()
                return original(module, *args)
            with patch.object(hours, 'write_target', side_effect=fail_second):
                self.assertEqual(self.confirm(preview)[0], 409)
            self.assertEqual(self.count('module_hours_targets'), 0)
            self.assertEqual(self.count('module_hours_operations'), 0)
            self.assertEqual(query("SELECT count(*) FROM curriculum.module_hours_audit WHERE kind='target'")[0][0], 0)

        def test_defaults_are_separate_versioned_and_explicitly_applied(self):
            _, preview = self.preview('save_defaults', [
                {'moduleId': 'M1', 'targetMinutes': 180, 'expectedDefaultRevision': 0}])
            self.assertEqual(self.confirm(preview)[0], 200)
            self.assertEqual(self.count('module_hours_targets'), 0)
            status, current = self.call(workflow.defaults, {'moduleId': 'M1'}, 'GET')
            self.assertEqual(status, 200)
            self.assertEqual(len(current['items'][0]['revisions']), 1)
            _, apply = self.preview('apply_defaults', [
                {'moduleId': 'M1', 'expectedRevision': 0, 'expectedDefaultRevision': 1}])
            self.assertEqual(self.confirm(apply)[0], 200)
            self.assertEqual(hours.read_target('M1')['targetMinutes'], 180)

        def test_null_clears_default_and_blocks_application(self):
            _, preview = self.preview('save_defaults', [
                {'moduleId': 'M1', 'targetMinutes': None, 'expectedDefaultRevision': 0}])
            self.assertEqual(self.confirm(preview)[0], 200)
            _, result = self.preview('apply_defaults', [
                {'moduleId': 'M1', 'expectedRevision': 0, 'expectedDefaultRevision': 1}])
            self.assertFalse(result['canConfirm'])
            self.assertEqual(result['items'][0]['reason'], 'missing_default')

        def test_each_blocked_item_has_a_reason(self):
            status, result = self.preview(items=[
                {'moduleId': 'M1', 'targetMinutes': True, 'expectedRevision': 0},
                {'moduleId': 'missing', 'targetMinutes': 120, 'expectedRevision': 0}])
            self.assertEqual(status, 200)
            self.assertEqual([i['reason'] for i in result['items']], ['invalid_minutes', 'module_missing'])
            self.assertIsNone(result['previewToken'])

        def test_duplicate_selection_and_identity_override_rejected(self):
            item = {'moduleId': 'M1', 'targetMinutes': 60, 'expectedRevision': 0}
            self.assertEqual(self.preview(items=[item, item])[0], 400)
            self.assertEqual(self.preview(items=[{**item, 'actor': 20}])[0], 400)

        def test_no_change_does_not_increment_target_revision(self):
            with transaction.atomic(): hours.write_target('M1', 120, 0, 10)
            _, preview = self.preview(items=[{'moduleId': 'M1', 'targetMinutes': 120, 'expectedRevision': 1}])
            self.assertEqual(preview['items'][0]['action'], 'unchanged')
            self.assertEqual(self.confirm(preview)[0], 200)
            self.assertEqual(hours.read_target('M1')['revision'], 1)

        def test_history_creator_only(self):
            _, preview = self.preview(); self.confirm(preview)
            self.assertEqual(len(self.call(workflow.operations, method='GET')[1]['operations']), 1)
            self.actor.id = 20
            self.assertEqual(self.call(workflow.operations, method='GET')[1]['operations'], [])

        def test_history_pages_have_no_overlap_and_cursor_is_owner_scoped(self):
            query('''INSERT INTO curriculum.module_hours_operations
                (id,actor_id,actor_key,idempotency_key,preview_nonce,intent_hash,outcome,created_at)
                SELECT ident,10,10,gen_random_uuid(),gen_random_uuid(),'synthetic',
                    json_build_object('operationId',ident)::text,now()-n*interval '1 second'
                FROM (SELECT gen_random_uuid() ident,n FROM generate_series(1,101) n) rows''')
            status, first = self.call(workflow.operations, method='GET')
            self.assertEqual(status, 200)
            self.assertEqual(len(first['operations']), 100)
            status, second = self.call(workflow.operations, {'before': first['nextCursor']}, 'GET')
            self.assertEqual(status, 200)
            self.assertEqual(len(second['operations']), 1)
            self.assertNotIn(second['operations'][0], first['operations'])
            self.actor.id = 20
            self.assertEqual(self.call(workflow.operations, {'before': first['nextCursor']}, 'GET')[0], 400)

        def test_expiry_tampering_and_actor_binding(self):
            _, preview = self.preview()
            with patch('django.core.signing.time.time', return_value=9999999999):
                self.assertEqual(self.confirm(preview)[0], 409)
            self.assertEqual(self.confirm({**preview, 'fingerprint': 'wrong'})[0], 409)
            self.actor.id = 20
            self.assertEqual(self.confirm(preview)[0], 403)

        def test_concurrent_confirm_applies_once(self):
            _, preview = self.preview(); key = str(uuid4())
            def apply(_):
                try: return self.confirm(preview, key)
                finally: connections.close_all()
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(apply, range(2)))
            self.assertEqual([r[0] for r in results], [200, 200], results)
            self.assertEqual(sum(r[1]['replayed'] for r in results), 1)
            self.assertEqual(self.count('module_hours_operations'), 1)

    return unittest.defaultTestLoader.loadTestsFromTestCase(Workflows)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    config = prepare(args.directory.resolve(), args.port)
    configure(config)
    with patch('requests.sessions.Session.request', side_effect=AssertionError('Live HTTP prohibited')):
        regression = build_suite(config)
        regression.addTests(suite())
        result = unittest.TextTestRunner(verbosity=2).run(regression)
    print(json.dumps({'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
                      'skips': len(result.skipped), 'database': config['dbname']}))
    raise SystemExit(not result.wasSuccessful())
