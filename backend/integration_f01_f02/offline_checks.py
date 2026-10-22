"""Run from backend: python -B -m integration_f01_f02.offline_checks.

Only standard library and pure safety module. No Django/driver/startup imports.
"""
import ast
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from .safety import Target, Refused, application_lists, audit_event, check_sql, no_command


def approval():
    return dict(project='synthetic-project', branch='br-synthetic-child', parent='br-synthetic-parent',
                host='synthetic.invalid', address='192.0.2.1', port=5432, database='synthetic',
                user='synthetic_runner', run_id='f01f02_'+'a'*32,
                expires=(datetime.now(timezone.utc)+timedelta(hours=1)).isoformat(), approval='offline-only')


class SafetyTests(unittest.TestCase):
    def test_complete_approval(self):
        self.assertEqual(Target.parse(approval()).database, 'synthetic')

    def test_missing_fields(self):
        for key in approval():
            value = approval()
            del value[key]
            with self.subTest(key=key), self.assertRaises(Refused):
                Target.parse(value)

    def test_unknown_fields(self):
        with self.assertRaises(Refused):
            Target.parse({**approval(), 'production_fallback': True})

    def test_parent_target_refused(self):
        value = approval()
        value['branch'] = value['parent']
        with self.assertRaises(Refused):
            Target.parse(value)

    def test_expired_and_naive_approval(self):
        for expiry in ('2000-01-01T00:00:00+00:00', '2099-01-01T00:00:00'):
            with self.subTest(expiry=expiry), self.assertRaises(Refused):
                Target.parse({**approval(), 'expires': expiry})

    def test_pooler_refused(self):
        with self.assertRaises(Refused):
            Target.parse({**approval(), 'host': 'synthetic-pooler.invalid'})

    def test_each_connection_coordinate_pinned(self):
        target = Target.parse(approval())
        kwargs = dict(host=target.host, hostaddr=target.address, port=target.port,
                      dbname=target.database, user=target.user)
        target.connection(kwargs)
        for key in kwargs:
            with self.subTest(key=key), self.assertRaises(Refused):
                target.connection({**kwargs, key: 'different'})

    def test_independent_identity_all_columns_checked(self):
        t = Target.parse(approval())
        row = (t.database,t.user,t.branch,'on',t.project,t.parent,t.host,t.run_id,t.approval)
        t.verify(row)
        for index in range(len(row)):
            bad = list(row)
            bad[index] = 'wrong'
            with self.subTest(index=index), self.assertRaises(Refused):
                t.verify(bad)

    def test_every_environment_file_read_rejected(self):
        for path in ('.env', 'backend/.env', 'frontend/.env.local'):
            with self.subTest(path=path), self.assertRaises(Refused):
                audit_event('open', (path, 'r', 0))

    def test_network_loopback_and_external_denied(self):
        for host in ('127.0.0.1', 'example.invalid', '192.0.2.1'):
            with self.subTest(host=host), self.assertRaises(Refused):
                audit_event('socket.connect', (None, (host, 443)))

    def test_unsafe_imports_and_processes_denied(self):
        for name in ('config.settings', 'config.settings_sqlite_test', 'psycopg2'):
            with self.subTest(name=name), self.assertRaises(Refused):
                audit_event('import', (name,))
        with self.assertRaises(Refused):
            audit_event('subprocess.Popen', ('anything',))

    def test_commands_always_denied(self):
        for command in ('migrate', 'flush', 'apply_login_tables', 'loaddata', 'shell'):
            with self.subTest(command=command), self.assertRaises(Refused):
                no_command(command)

    def test_schema_privilege_and_opaque_sql_denied(self):
        for sql in ('CREATE TABLE x(id int)', 'DROP TABLE x', 'TRUNCATE x', 'ALTER TABLE x ADD y int',
                    'GRANT ALL ON x TO y', 'COPY x TO STDOUT', 'DO $$anything$$',
                    'SET ROLE postgres', 'SELECT 1; DELETE FROM x', 'SELECT 1 --comment'):
            with self.subTest(sql=sql), self.assertRaises(Refused):
                check_sql(sql, writable=True)

    def test_no_write_before_verification(self):
        for sql in ('INSERT INTO x VALUES (%s)', 'UPDATE x SET y=%s', 'DELETE FROM x WHERE id=%s',
                    'WITH x AS (DELETE FROM y RETURNING *) SELECT * FROM x'):
            with self.subTest(sql=sql), self.assertRaises(Refused):
                check_sql(sql)

    def test_scoped_write_after_verification(self):
        check_sql('UPDATE x SET y=%s WHERE id=%s', writable=True)
        check_sql('SELECT current_database()')

    def test_real_lists_are_parsed_not_imported(self):
        lists = application_lists(Path(__file__).resolve().parents[1]/'config/settings.py')
        self.assertIn('login.middleware.LoginSessionMiddleware', lists['MIDDLEWARE'])
        self.assertIn('django.middleware.csrf.CsrfViewMiddleware', lists['MIDDLEWARE'])
        self.assertIn('learner_api', lists['INSTALLED_APPS'])
        self.assertNotIn('django', sys.modules)

    def test_fixture_plan_is_pure_and_namespaced(self):
        from .fixtures import plan
        self.assertEqual(plan('synthetic')[0]['moduleId'], 'synthetic-M')
        from .fixtures import Fixtures
        with self.assertRaises(Refused):
            Fixtures('not-authorized')

    def test_boot_refuses_missing_target_before_driver_import(self):
        from .bootstrap import boot
        with self.assertRaises(Refused):
            boot({}, {})
        self.assertNotIn('psycopg', sys.modules)

    def test_boot_refuses_credentials_before_driver_import(self):
        from .bootstrap import boot
        with self.assertRaises(Refused):
            boot(asdict(Target.parse(approval())), {'connection_url': 'forbidden'})
        self.assertNotIn('psycopg', sys.modules)

    def test_all_infrastructure_parses_and_no_skipped_acceptance(self):
        folder = Path(__file__).parent
        for path in folder.glob('*.py'):
            source = path.read_text(encoding='utf-8')
            tree = ast.parse(source, filename=str(path))
            if path.name.startswith('cases_'):
                for node in ast.walk(tree):
                    if isinstance(node, ast.Attribute):
                        self.assertNotIn(node.attr, ('skip', 'skipIf', 'skipUnless', 'expectedFailure'))


if __name__ == '__main__':
    def offline_guard(event, args):
        audit_event(event, args)
        if event == 'import' and args[0].split('.')[0] in {'django','psycopg','psycopg2','sqlite3'}:
            raise Refused('No database/framework imports in offline validation')
    sys.addaudithook(offline_guard)
    unittest.main(verbosity=2)
