"""Persisted-state parity using disposable PostgreSQL and synthetic storage adapters."""
import copy
import json
from contextlib import contextmanager
from unittest.mock import Mock, patch
import unittest

from django.db import connection, transaction
from psycopg.types.json import Jsonb
from curriculum_api import views
from curriculum_api.catalogue.infrastructure import session_writes
from curriculum_api.test_session_editing_boundary_no_db import MODULE, editing_scope
from curriculum_api.test_holiday_boundary_no_db import request, response

SCHEMA = 'phase1f_session_editing'
TABLES = {'modules', 'weeks', 'components', 'groups'}


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]
    return []


def read(table, where='', params=None, order_sql='', **kwargs):
    assert table in TABLES, table
    return query(f'SELECT * FROM {SCHEMA}.{table}' + (' WHERE ' + where if where else '')
                 + (' ORDER BY ' + order_sql if order_sql else ''), params)


def update(table, where, params, values):
    assert table in TABLES, table
    allowed = {'group_id', 'cohort_id', 'title', 'start_date', 'tutor_name', 'tutor_email', 'coach_name',
               'session_start_time', 'session_end_time', 'updated_at', 'settings_json', 'module_catalogue_id'}
    assert set(values) <= allowed, values.keys()
    if not values:
        return []
    return query(f'UPDATE {SCHEMA}.{table} SET ' + ', '.join(k + ' = %s' for k in values)
                 + ' WHERE ' + where + ' RETURNING *',
                 [Jsonb(v) if isinstance(v, dict) else v for v in values.values()] + list(params))


@contextmanager
def scope(old, events, **extra):
    ports = dict(AUTHORING_MODULES_TABLE='modules', AUTHORING_WEEKS_TABLE='weeks', AUTHORING_COMPONENTS_TABLE='components',
        authoring_fetch_all=Mock(side_effect=read), update_authoring_rows=Mock(side_effect=update),
        authoring_upsert=Mock(side_effect=lambda table, keys, row: update(table, 'module_catalogue_id = %s', [row['module_catalogue_id']], row)),
        update_group_fields=Mock(side_effect=lambda ident, values: update('groups', 'group_id = %s', [ident], values)),
        json_db_value=Mock(side_effect=lambda value: value))
    ports.update(extra)
    with editing_scope(old, events, **ports):
        yield


class SessionEditingPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        query(f'CREATE SCHEMA {SCHEMA}')
        query(f'''CREATE TABLE {SCHEMA}.modules (module_catalogue_id text primary key,
            group_id text, cohort_id text, title text, start_date text, tutor_name text,
            tutor_email text, session_start_time text, session_end_time text, updated_at timestamp)''')
        query(f'CREATE TABLE {SCHEMA}.groups (group_id text primary key, coach_name text)')
        query(f'''CREATE TABLE {SCHEMA}.weeks (id text primary key, module_catalogue_id text,
            week_number integer, display_order integer)''')
        query(f'''CREATE TABLE {SCHEMA}.components (id text primary key, module_catalogue_id text,
            week_id text, type text, display_order integer, settings_json jsonb, updated_at timestamp)''')

    def seed(self):
        for table in TABLES:
            query(f'TRUNCATE {SCHEMA}.{table}')
        for row in [MODULE, {**MODULE, 'module_catalogue_id': 'SECOND', 'group_id': ' G '},
                    {**MODULE, 'module_catalogue_id': 'OTHER', 'group_id': 'OTHER'}]:
            query(f'INSERT INTO {SCHEMA}.modules (' + ', '.join(row) + ') VALUES (' + ', '.join(['%s'] * len(row)) + ')', list(row.values()))
        query(f"INSERT INTO {SCHEMA}.groups VALUES ('G', 'Before'), ('OTHER', 'Other coach')")
        query(f"INSERT INTO {SCHEMA}.weeks VALUES ('W', 'M', 1, 1), ('OW', 'OTHER', 1, 1)")
        for ident, module, week, kind, settings in [('X', 'M', 'W', 'live_session', {}),
                ('B', 'M', 'W', 'live_session', {'teamsLiveSessionId': 'booked', 'teamsSessionNumber': 1, 'sessionDate': '2025-12-01'}),
                ('R', 'M', 'W', 'reading', {'keep': True}), ('OX', 'OTHER', 'OW', 'live_session', {})]:
            query(f'INSERT INTO {SCHEMA}.components VALUES (%s,%s,%s,%s,%s,%s,NULL)',
                  [ident, module, week, kind, 1 if ident == 'X' else 2, Jsonb(settings)])

    def state(self):
        return (query(f'SELECT * FROM {SCHEMA}.modules ORDER BY module_catalogue_id'),
                query(f'SELECT * FROM {SCHEMA}.groups ORDER BY group_id'),
                query(f'SELECT * FROM {SCHEMA}.components ORDER BY id'))

    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_staffing_success_and_delete_keep_scope_identity_and_persisted_fields(self):
        def scenario(old):
            self.seed()
            with scope(old, []):
                result = response(views.curriculum_staffing_detail(request('PATCH', {'tutor': 'Next', 'coach': 'Coach'}), 'G'))
                saved = self.state()
                cleared = response(views.curriculum_staffing_detail(request('DELETE'), 'G'))
            return result, saved, cleared, self.state()
        result, saved, cleared, final = self.compare(scenario)
        self.assertEqual(result[0], 200)
        self.assertEqual([r['tutor_name'] for r in saved[0]], ['Next', 'Before', 'Next'])
        self.assertEqual([r['tutor_name'] for r in final[0]], [None, 'Before', None])
        self.assertEqual(final[1][1]['coach_name'], 'Other coach')

    def test_missing_required_read_does_not_persist_partial_coach_change(self):
        self.seed()
        before = self.state()
        events = []
        with scope(False, events, authoring_fetch_all=Mock(side_effect=RuntimeError('Synthetic failure'))):
            result = views.update_staffing_assignment('G', {'tutor': 'Next', 'coach': 'Changed'})
        self.assertEqual(result.status_code, 503)
        self.assertEqual(self.state(), before)
        self.assertEqual(events, [])

    def test_staffing_respects_callers_outer_rollback_on_late_write_failure(self):
        def scenario(old):
            self.seed()
            before = self.state()
            events = []
            def fail_second(table, where, params, values):
                if params == ['SECOND']:
                    raise ValueError('Synthetic late refusal')
                return update(table, where, params, values)
            with self.assertRaisesRegex(ValueError, 'Synthetic late refusal'):
                with scope(old, events, update_authoring_rows=Mock(side_effect=fail_second)), transaction.atomic():
                    views.update_staffing_assignment('G', {'tutor': 'Next', 'coach': 'Changed'})
            self.assertEqual(self.state(), before)
            self.assertEqual(events, [])
            return self.state()
        self.compare(scenario)

    def test_session_dates_execute_extracted_storage_and_second_save_writes_nothing(self):
        def scenario(old):
            self.seed()
            with scope(old, []):
                first = views.persist_group_module_session_dates([copy.deepcopy(MODULE)], {})
                second = views.persist_group_module_session_dates([copy.deepcopy(MODULE)], {})
            return first, second, self.state()
        with patch.object(session_writes, 'write_session_settings', wraps=session_writes.write_session_settings) as invoked:
            actual = scenario(False)
        invoked.assert_called_once()
        self.assertEqual(actual, scenario(True))
        self.assertEqual(actual[:2], (1, 0))
        by_id = {r['id']: {**r, 'settings_json': json.loads(r['settings_json'])
                           if isinstance(r['settings_json'], str) else r['settings_json']}
                 for r in actual[2][2]}
        self.assertEqual(by_id['B']['settings_json']['sessionDate'], '2025-12-01')
        self.assertEqual(by_id['X']['settings_json']['sessionDate'], '2026-01-05')
        self.assertEqual(by_id['OX']['settings_json'], {})
        self.assertEqual(by_id['R']['settings_json'], {'keep': True})

    def test_session_settings_persistence_obeys_outer_rollback(self):
        for old in (True, False):
            self.seed()
            before = self.state()
            with scope(old, []), transaction.atomic():
                self.assertEqual(views.persist_group_module_session_dates([copy.deepcopy(MODULE)], {}), 1)
                transaction.set_rollback(True)
            self.assertEqual(self.state(), before)

    def test_session_partial_http_edit_preserves_other_fields_and_modules(self):
        def scenario(old):
            self.seed()
            with scope(old, []):
                result = response(views.curriculum_session_detail(request('PATCH', {'startTime': '10:00'}), 'module-M-session-1'))
            return result, self.state()
        result, state = self.compare(scenario)
        self.assertEqual(result, (200, {'updated': True, 'id': 'module-M-session-1'}))
        self.assertEqual(state[0][0]['session_start_time'], '10:00')
        self.assertEqual(state[0][0]['session_end_time'], '11:00')
        self.assertEqual(state[0][1]['session_start_time'], '09:00')
