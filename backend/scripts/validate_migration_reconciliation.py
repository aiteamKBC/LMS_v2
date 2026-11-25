"""Disk-loader regressions; optional SELECT-only Development catalog preflight.

Never uses manage.py test, migrate, a migration executor against a database,
or a schema editor connected to Neon. No reports/files are written.
"""
import argparse
import json
import logging.config
import os
from pathlib import Path
import socket
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--development', action='store_true', help='SELECT-only verified Development preflight')
args = parser.parse_args()

from django.db.backends.base.base import BaseDatabaseWrapper

with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Django DB forbidden')), \
     patch.object(logging.config, 'dictConfig'):
    import django
    django.setup()
    from curriculum_api.test_migration_reconciliation_no_db import modules, load, TARGET
    from django.db.migrations.executor import MigrationExecutor
    from django.db.migrations.recorder import MigrationRecorder
    print('Django', django.get_version(), flush=True)
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'curriculum_api.test_migration_reconciliation_no_db',
            'curriculum_api.meetings.tests.test_live_session_register_no_db',
            'curriculum_api.meetings.tests.tests_parallel_attendance_register',
            'curriculum_api.meetings.tests.test_qr_attendance_delete_cleanup_no_db',
        ])
        result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful():
        raise SystemExit(1)
    if args.development:
        from verify_inclusion_canonical_targets import connect_development
        from verify_free_course_my_learning import verify
        connection = connect_development()
        try:
            before = verify(connection)
            # SELECT-only adapter: no schema-editor or execute-DDL method exists.
            class SelectCursor:
                def __enter__(self):
                    self.cursor = connection.cursor()
                    return self
                def __exit__(self, *exc):
                    self.cursor.close()
                def execute(self, sql, params):
                    if not sql.lstrip().startswith('SELECT ') or ';' in sql:
                        raise AssertionError('Only single SELECT statements permitted')
                    self.cursor.execute(sql, params)
                def fetchall(self):
                    return self.cursor.fetchall()
            adapter = SimpleNamespace(vendor='postgresql', alias='default', cursor=SelectCursor)
            for module in modules():
                module.validate(None, SimpleNamespace(connection=adapter))
                print('Catalog PASS:', module.__name__.rsplit('.', 1)[1])
            applied = connection.execute('SELECT app,name FROM django_migrations').fetchall()
            loader = load(applied)
            with patch.object(MigrationRecorder, 'applied_migrations', return_value=dict.fromkeys(applied)):
                loader.check_consistent_history(SimpleNamespace(alias='default'))
            pending = [key for key in loader.graph.forwards_plan(TARGET) if key not in loader.applied_migrations]
            print('Pending target ancestry:', json.dumps(pending))
            # Check each future command against the actual executor planner.
            # This is a disposable Python set, never migration-history writes.
            simulated = set(applied)
            for key in pending:
                executor = object.__new__(MigrationExecutor)
                executor.loader = load(simulated)
                planned = executor.migration_plan([key])
                assert [(m.app_label, m.name, reverse) for m, reverse in planned] == [(*key, False)]
                simulated.add(key)
                simulated.update(executor.loader.disk_migrations[key].replaces)
            print('Singleton execution sequence PASS:', len(pending), 'steps; no unrelated ancestors')
            import importlib
            attempts = importlib.import_module('learner_api.migrations.0030_canonical_free_course_attempts')
            condition = attempts.SQL.split('CHECK (', 1)[1].split(');', 1)[0]
            violations = connection.execute('SELECT count(*) FROM "Learner".subject_activity_attempts WHERE NOT (' + condition + ')').fetchone()[0]
            assert violations == 0, 'Existing attempts violate 0030'
            for table in ('free_course_hours_migration', 'free_course_hours_migration_additional', 'free_course_hours_migration_remaining'):
                columns = dict(connection.execute('''SELECT column_name,data_type FROM information_schema.columns
                    WHERE table_schema='Learner' AND table_name=%s''', [table]).fetchall())
                for field, kind in [('old_progress_id', 'bigint'), ('learner_id', 'bigint'),
                                    ('free_course_id', 'text'), ('free_component_id', 'text'), ('original_progress', 'jsonb')]:
                    assert columns.get(field) == kind, '0029 bridge schema mismatch'
            normalize = lambda value: ''.join(value.lower().replace('(', '').replace(')', '').split())
            definitions = connection.execute('''SELECT conname,pg_get_constraintdef(oid),convalidated
                FROM pg_constraint WHERE conrelid='"Learner".subject_activity_attempts'::regclass
                AND conname IN ('subject_attempt_free_component_fk','subject_attempt_identity_required')''').fetchall()
            expected = {
                'subject_attempt_free_component_fk': 'FOREIGN KEY (free_component_ref) REFERENCES curriculum.free_programme_components(id) ON DELETE RESTRICT',
                'subject_attempt_identity_required': 'CHECK (source_activity_fk IS NOT NULL OR (free_component_ref IS NOT NULL AND source_activity_snapshot IS NOT NULL))',
            }
            assert len(definitions) == 2
            for name, definition, validated in definitions:
                assert validated and normalize(definition) == normalize(expected[name]), '0029 constraint mismatch'
            print('0029 installed constraints/bridge types PASS; 0030 incompatible attempts:', violations)
            missing = connection.execute("""SELECT attendance_status,count(*)
                FROM curriculum.live_session_learner_attendance
                WHERE attendance_basis='teams' AND teams_attendance_status IS NULL
                AND attendance_source_occurrence_id IS NULL GROUP BY attendance_status ORDER BY 1""").fetchall()
            print('Unresolved Teams provenance:', json.dumps(missing))
            after = verify(connection)
            assert before == after, 'Preservation verification changed'
            assert after['historical_records'] == 790 and after['accepted_seconds'] == 205737
            print('Preservation PASS:', json.dumps(after, sort_keys=True))
        finally:
            connection.rollback()
            connection.close()
