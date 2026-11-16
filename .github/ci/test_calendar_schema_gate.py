"""Schema release policy tests; no configured Django app or database is opened."""
import contextlib
import copy
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

spec = importlib.util.spec_from_file_location('calendar_schema_gate', Path(__file__).with_name('calendar_schema_gate.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class SchemaPolicyTests(unittest.TestCase):
    def setUp(self):
        self.config = {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'neondb',
                       'HOST': 'ep-example-pooler.eu-west-2.aws.neon.tech',
                       'OPTIONS': {'sslmode': 'require', 'pool': {'min_size': 2}}, 'PASSWORD': 'private'}
        self.now = dt.datetime(2026, 11, 15, 12, tzinfo=dt.timezone.utc)
        self.point = {'id': 'snap-example', 'branch_id': gate.PRODUCTION_BRANCH,
                      'created_at': '2026-11-15T11:00:00Z'}

    def test_direct_tls_connection_without_mutating_service_config(self):
        original = copy.deepcopy(self.config)
        checked = gate.checked_database(self.config, 'ep-example', 'neondb')
        self.assertEqual(checked['HOST'], 'ep-example.eu-west-2.aws.neon.tech')
        self.assertNotIn('pool', checked['OPTIONS'])
        self.assertEqual(self.config, original)

    def test_wrong_endpoint_database_vendor_or_tls_is_rejected(self):
        for field, value in [('HOST', 'ep-other.eu-west-2.aws.neon.tech'), ('NAME', 'another'),
                             ('ENGINE', 'django.db.backends.sqlite3'), ('OPTIONS', {}),
                             ('HOST', 'ep-example.evil.eu-west-2.aws.neon.tech'),
                             ('HOST', 'ep-example.evil.eu-west-2.aws.neon.tech.attacker.com')]:
            with self.subTest(field=field, value=value):
                config = dict(self.config, **{field: value})
                with self.assertRaises(gate.GateError):
                    gate.checked_database(config, 'ep-example', 'neondb')

    def test_empty_runtime_secret_is_rejected_before_importing_django(self):
        with patch.dict(os.environ, {'CALENDAR_GATE_MODE': 'verify', 'CALENDARIFIC_API_KEY': '  '}), \
                self.assertRaisesRegex(gate.GateError, 'key_missing_or_empty'):
            gate.main()

    def test_unknown_gate_mode_cannot_start_a_migration(self):
        with patch.dict(os.environ, {'CALENDAR_GATE_MODE': 'unrestricted'}), \
                self.assertRaisesRegex(gate.GateError, 'invalid_gate_mode'):
            gate.main()

    def test_recent_production_snapshot_metadata_is_accepted(self):
        gate.checked_restore_point(json.dumps(self.point), self.now)

    def test_missing_stale_future_or_other_branch_snapshot_is_rejected(self):
        invalid = ['', '{}', 'null', 'not json']
        for change in ({'created_at': '2026-11-13T12:00:00Z'}, {'created_at': '2026-11-16T12:00:00Z'},
                       {'branch_id': 'development'}, {'id': ''}, {'created_at': '2026-11-15T11:00:00'}):
            invalid.append(json.dumps(dict(self.point, **change)))
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaises(gate.GateError):
                gate.checked_restore_point(raw, self.now)

    def executor(self, names, applied=()):
        executor = Mock()
        executor.loader.applied_migrations = set(applied)
        executor.migration_plan.return_value = [(SimpleNamespace(app_label=app, name=name), backwards)
                                                 for app, name, backwards in names]
        return executor

    def test_only_reviewed_forward_migrations_are_allowed(self):
        names = [('curriculum_api', '0089_module_week_starts_on', False), (*gate.TARGET, False)]
        self.assertEqual(gate.checked_plan(self.executor(names), 'apply'),
                         [(app, name) for app, name, _ in names])

    def test_verify_mode_never_plans_or_applies_missing_schema(self):
        executor = self.executor([(*gate.TARGET, False)])
        with self.assertRaises(gate.GateError):
            gate.checked_plan(executor, 'verify')
        executor.migration_plan.assert_not_called()

    def test_already_applied_with_later_migrations_never_downgrades(self):
        executor = self.executor([], [gate.TARGET, ('curriculum_api', '0091_future')])
        self.assertEqual(gate.checked_plan(executor, 'apply'), [])
        executor.migration_plan.assert_not_called()

    def test_unrelated_reverse_empty_or_duplicate_plan_is_rejected(self):
        invalid = [[], [(*gate.TARGET, True)], [('coach_api', '0001_initial', False), (*gate.TARGET, False)],
                   [('curriculum_api', '0091_future', False), (*gate.TARGET, False)],
                   [(*gate.TARGET, False), (*gate.TARGET, False)]]
        for names in invalid:
            with self.subTest(names=names), self.assertRaises(gate.GateError):
                gate.checked_plan(self.executor(names), 'apply')


class MigrationTransactionTests(unittest.TestCase):
    def setUp(self):
        self.cursor = Mock()
        self.cursor.fetchone.side_effect = [('neondb', False), (True,)]
        self.db = SimpleNamespace(alias='calendar_release', cursor=MagicMock())
        self.db.cursor.return_value.__enter__.return_value = self.cursor
        self.executor = Mock()
        self.executor.loader.applied_migrations = {gate.TARGET}
        self.events = []

        @contextlib.contextmanager
        def atomic(**kwargs):
            self.events.append('begin')
            try:
                yield
            except Exception:
                self.events.append('rollback')
                raise
            else:
                self.events.append('commit')
        self.atomic = atomic

    def run_gate(self, mode='apply', point=''):
        return gate.run_gate(self.db, lambda db: self.executor, self.atomic, mode, point, 'neondb')

    def test_missing_restore_point_prevents_migrate_and_rolls_back(self):
        with patch.object(gate, 'checked_plan', return_value=[gate.TARGET]), self.assertRaises(gate.GateError):
            self.run_gate()
        self.executor.migrate.assert_not_called()
        self.assertEqual(self.events, ['begin', 'rollback'])

    def test_already_applied_schema_verifies_without_snapshot_or_migrate(self):
        with patch.object(gate, 'verify_schema') as verify:
            self.assertEqual(self.run_gate('verify')['applied'], [])
        verify.assert_called_once_with(self.cursor)
        self.executor.migrate.assert_not_called()
        self.assertEqual(self.events, ['begin', 'commit'])

    def test_postcheck_failure_rolls_back_migration(self):
        with patch.object(gate, 'checked_plan', return_value=[gate.TARGET]), \
                patch.object(gate, 'checked_restore_point'), \
                patch.object(gate, 'fingerprint', return_value={'modules': (5, 'unchanged')}), \
                patch.object(gate, 'verify_schema', side_effect=gate.GateError('bad_column')), \
                self.assertRaises(gate.GateError):
            self.run_gate()
        self.executor.migrate.assert_called_once_with([gate.TARGET])
        self.assertEqual(self.events, ['begin', 'rollback'])

    def test_existing_data_change_rolls_back_before_commit(self):
        with patch.object(gate, 'checked_plan', return_value=[gate.TARGET]), \
                patch.object(gate, 'checked_restore_point'), \
                patch.object(gate, 'fingerprint', side_effect=[{'modules': (2, 'a')}, {'modules': (2, 'b')}]), \
                self.assertRaisesRegex(gate.GateError, 'existing_delivery_data_changed'):
            self.run_gate()
        self.assertEqual(self.events, ['begin', 'rollback'])

    def test_wrong_database_replica_or_concurrent_migration_never_applies(self):
        for responses in ([('another', False)], [('neondb', True)], [('neondb', False), (False,)]):
            with self.subTest(responses=responses):
                self.cursor.fetchone.side_effect = responses
                with self.assertRaises(gate.GateError):
                    self.run_gate()
        self.executor.migrate.assert_not_called()

    def test_cache_requires_each_read_insert_update_permission(self):
        # Valid columns and column rights, existing cache, SELECT=yes INSERT=no.
        self.cursor.fetchone.side_effect = [('character varying', 'YES'), (True, True),
                                           ('jsonb', 'YES'), (True, True), ('jsonb', 'YES'), (True, True),
                                           ('curriculum.country_holiday_calendars',), (True,), (False,)]
        with self.assertRaisesRegex(gate.GateError, 'calendar_cache_permissions_missing'):
            gate.verify_schema(self.cursor)


if __name__ == '__main__':
    unittest.main()
