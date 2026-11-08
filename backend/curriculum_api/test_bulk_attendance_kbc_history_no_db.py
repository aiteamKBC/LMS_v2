"""Run directly with Python: dependency-free tests for the KBC history reader."""
import importlib.util
from contextlib import closing
import json
import sqlite3
from datetime import date
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parent


class JsonResponse:
    def __init__(self, payload, status=200):
        self.status_code = status
        self.content = json.dumps(payload).encode()
        self.headers = {}

    def __setitem__(self, key, value):
        self.headers[key] = value

    def __getitem__(self, key):
        return self.headers[key]


def require_GET(view):
    def wrapped(request):
        if getattr(request, 'method', 'GET') != 'GET':
            return JsonResponse({'detail': 'Method Not Allowed'}, status=405)
        return view(request)
    return wrapped


def require_POST(view):
    def wrapped(request):
        if getattr(request, 'method', 'POST') != 'POST':
            return JsonResponse({'detail': 'Method Not Allowed'}, status=405)
        return view(request)
    return wrapped


class FakePsycopgError(Exception):
    pass


class FakeDatabaseError(Exception):
    pass


def load_module():
    package = ModuleType('curriculum_api')
    package.__path__ = [str(ROOT)]
    sys.modules['curriculum_api'] = package

    directory = ModuleType('curriculum_api.bulk_attendance_learners')
    directory.learner_directory_dsn = lambda: 'synthetic'
    sys.modules[directory.__name__] = directory

    psycopg = ModuleType('psycopg')
    psycopg.Error = FakePsycopgError
    psycopg.OperationalError = FakePsycopgError
    psycopg.connect = MagicMock()
    sys.modules['psycopg'] = psycopg
    rows = ModuleType('psycopg.rows')
    rows.dict_row = object()
    sys.modules['psycopg.rows'] = rows

    django = ModuleType('django')
    http = ModuleType('django.http')
    http.JsonResponse = JsonResponse
    decorators = ModuleType('django.views.decorators.http')
    decorators.require_GET = require_GET
    decorators.require_POST = require_POST
    db = ModuleType('django.db')
    db.DatabaseError = FakeDatabaseError
    sys.modules['django.db'] = db
    sys.modules['django'] = django
    sys.modules['django.http'] = http
    sys.modules['django.views'] = ModuleType('django.views')
    sys.modules['django.views.decorators'] = ModuleType('django.views.decorators')
    sys.modules['django.views.decorators.http'] = decorators

    spec = importlib.util.spec_from_file_location(
        'curriculum_api.bulk_attendance_kbc_history', ROOT / 'bulk_attendance_kbc_history.py',
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec.loader
    spec.loader.exec_module(module)
    return module


history = load_module()


class KbcHistoryTests(unittest.TestCase):
    def setUp(self):
        self.live = patch.object(history, '_live_register', return_value=({}, None)).start()

    def tearDown(self):
        patch.stopall()

    def test_session_date_is_a_calendar_day_for_date_or_timestamp_values(self):
        self.assertEqual(history._session_date(date(2026, 10, 12)), '2026-10-12')
        self.assertEqual(history._session_date('2026-10-12 00:00:00+00'), '2026-10-12')

    def test_month_read_uses_calendar_day_prefix_for_timestamp_shaped_source_dates(self):
        with closing(sqlite3.connect(':memory:')) as database:
            database.row_factory = sqlite3.Row
            database.execute("ATTACH DATABASE ':memory:' AS public")
            database.execute('''CREATE TABLE public.kbc_attendance (
                "key" TEXT, "ID" TEXT, "date" TEXT, module TEXT,
                lecture_name TEXT, "Attendance" INTEGER, attendance_status TEXT
            )''')
            database.executemany('INSERT INTO public.kbc_attendance VALUES (?, ?, ?, ?, ?, ?, ?)', [
                ('oct', '301', '2026-10-12 00:00:00+00', 'Module', 'Lecture 2', 1, None),
                ('nov', '301', '2026-11-01 00:00:00+00', 'Module', 'Lecture 3', 1, None),
            ])
            connection = MagicMock()
            connection.__enter__.return_value = connection
            cursor = connection.cursor.return_value.__enter__.return_value

            def execute(sql, params):
                # The prefix is text, so Postgres needs text bounds; a date
                # parameter fails there with "operator does not exist".
                self.assertFalse(any(isinstance(value, date) for value in params))
                adapted = sql.replace('::text', '').replace('%s', '?')
                result = database.execute(adapted, params)
                cursor.fetchall.return_value = [dict(row) for row in result.fetchall()]

            cursor.execute.side_effect = execute
            with patch.object(history.psycopg, 'connect', return_value=connection):
                records = history.read_kbc_month_attendance(
                    'synthetic', date(2026, 10, 1), date(2026, 11, 1), None,
                )

        self.assertEqual([record['recordKey'] for record in records], ['oct'])
        self.assertEqual(records[0]['sessionDate'], '2026-10-12')

    def test_day_membership_unions_both_sources_without_recent_limits(self):
        request = SimpleNamespace(GET={'date': '2020-01-02'})
        with patch.object(history, 'read_kbc_day_learner_ids', return_value={'301', '302'}) as kbc, \
                patch.object(history, '_live_day_learner_ids', return_value={'302', '303'}) as live:
            response = history.bulk_attendance_day_learners(request)
        self.assertEqual(json.loads(response.content), {
            'date': '2020-01-02', 'learnerIds': ['301', '302', '303'], 'warnings': [],
        })
        kbc.assert_called_once_with('synthetic', date(2020, 1, 2))
        live.assert_called_once_with(date(2020, 1, 2))
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_day_membership_validates_date_and_does_not_hide_source_failure(self):
        for invalid in ['', '2020-02-30', '20200102', '2020-01-02T00:00:00']:
            self.assertEqual(history.bulk_attendance_day_learners(SimpleNamespace(GET={'date': invalid})).status_code, 400)
        with patch.object(history, 'read_kbc_day_learner_ids', return_value={'301'}), \
                patch.object(history, '_live_day_learner_ids', side_effect=FakeDatabaseError):
            response = history.bulk_attendance_day_learners(SimpleNamespace(GET={'date': '2020-01-02'}))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('learnerIds', json.loads(response.content))

    def test_day_sql_includes_unmarked_and_excludes_adjacent_dates(self):
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute("ATTACH DATABASE ':memory:' AS public")
            db.execute('CREATE TABLE public.kbc_attendance ("ID" TEXT, "date" TEXT, "Attendance" INTEGER)')
            db.executemany('INSERT INTO public.kbc_attendance VALUES (?, ?, ?)', [
                ('301', '2020-01-02', 1), ('301', '2020-01-02', 0),
                ('302', '2020-01-02', None), ('303', '2020-01-01', 1), ('304', '2020-01-03', 1),
            ])
            connection = MagicMock()
            connection.__enter__.return_value = connection
            def execute(sql, params=None):
                if sql.startswith('SET LOCAL'):
                    return None
                self.assertTrue(connection.read_only)
                return db.execute(sql.replace('::text', '').replace('%s', '?'), [value.isoformat() for value in params])
            connection.execute.side_effect = execute
            with patch.object(history.psycopg, 'connect', return_value=connection):
                self.assertEqual(history.read_kbc_day_learner_ids('synthetic', date(2020, 1, 2)), {'301', '302'})

    def test_read_is_read_only_and_maps_each_historical_record(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [{
            'recordKey': 'row-1', 'learnerId': '301', 'sessionDate': '2026-10-12',
            'moduleName': 'Project Controls', 'lectureName': 'Lecture 4: Review',
            'attendance_value': 1, 'source_status': 'original',
        }, {
            'recordKey': 'row-2', 'learnerId': '301', 'sessionDate': '2026-10-05',
            'moduleName': 'Project Controls', 'lectureName': 'Lecture 3',
            'attendance_value': 1, 'source_status': 'absent',
        }]

        def execute(_sql, params):
            self.assertTrue(connection.read_only)
            self.assertEqual(params, ['301'])

        cursor.execute.side_effect = execute
        with patch.object(history.psycopg, 'connect', return_value=connection):
            records = history.read_kbc_attendance_history('synthetic', '301')

        self.assertEqual(records[0]['attendance'], 'present')
        self.assertEqual(records[0]['sessionNumber'], 4)
        self.assertEqual(records[1]['attendance'], 'absent')
        sql = cursor.execute.call_args.args[0]
        self.assertIn('FROM public.kbc_attendance', sql)
        self.assertIn('WHERE "ID"::text = %s', sql)
        self.assertNotIn('SELECT *', sql)
        self.assertNotIn('UPDATE ', sql.upper())

    def test_timeout_is_set_per_transaction_not_as_a_pooler_rejected_startup_option(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch.object(history.psycopg, 'connect', return_value=connection) as connect:
            history.read_kbc_attendance_history('synthetic', '301')
        self.assertNotIn('options', connect.call_args.kwargs)
        connection.execute.assert_called_once_with("SET LOCAL statement_timeout = '10s'")

    def test_recent_read_groups_latest_attendance_rows_per_learner(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            {'recordKey': 'a', 'learnerId': '301', 'sessionDate': '2026-10-01', 'moduleName': 'M1',
             'lectureName': 'Lecture 3', 'attendance_value': 1, 'source_status': 'absent'},
            {'recordKey': 'b', 'learnerId': '301', 'sessionDate': '2026-10-08', 'moduleName': 'M1',
             'lectureName': 'Lecture 4', 'attendance_value': 1, 'source_status': 'original'},
            {'recordKey': 'c', 'learnerId': '302', 'sessionDate': '2026-10-08', 'moduleName': 'M2',
             'lectureName': 'Session 1', 'attendance_value': 0, 'source_status': None},
            {'recordKey': 'd', 'learnerId': '302', 'sessionDate': '2026-10-15', 'moduleName': 'M2',
             'lectureName': 'Session 2', 'attendance_value': None, 'source_status': None},
        ]
        with patch.object(history.psycopg, 'connect', return_value=connection) as connect:
            recent = history.read_kbc_recent_attendance('synthetic')

        self.assertNotIn('options', connect.call_args.kwargs)
        self.assertTrue(connection.read_only)
        connection.execute.assert_called_once_with("SET LOCAL statement_timeout = '10s'")
        self.assertEqual([r['attendance'] for r in recent['301']], ['absent', 'present'])
        self.assertEqual([r['attendance'] for r in recent['302']], ['absent', None])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [4])
        self.assertIn('FROM public.kbc_attendance', sql)
        self.assertNotIn('"Attendance" IN (0, 1)', sql)
        self.assertIn('"date" <= CURRENT_DATE', sql)
        self.assertNotIn('UPDATE ', sql.upper())

    def test_recent_endpoint_is_private_and_hides_driver_errors(self):
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_recent_attendance', return_value={'301': []}):
            response = history.bulk_attendance_kbc_recent(SimpleNamespace(method='GET', GET={}))
        self.assertEqual(json.loads(response.content), {'recent': {'301': []}, 'warnings': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')

        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_recent_attendance', side_effect=FakePsycopgError('private-host')):
            response = history.bulk_attendance_kbc_recent(SimpleNamespace(method='GET', GET={}))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())

        with patch.object(history, 'read_kbc_recent_attendance') as read:
            response = history.bulk_attendance_kbc_recent(SimpleNamespace(method='POST', GET={}))
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()

    def test_recent_live_source_does_not_read_legacy_kbc_attendance(self):
        live = {'301': [self._record('live:9', '2026-10-08', 'present', 'live')]}
        self.live.return_value = (live, None)
        with patch.object(history, 'learner_directory_dsn') as dsn, \
             patch.object(history, 'read_kbc_recent_attendance') as read:
            response = history.bulk_attendance_kbc_recent(
                SimpleNamespace(method='GET', GET={'source': 'live'}),
            )
        self.assertEqual(json.loads(response.content)['recent'], live)
        dsn.assert_not_called()
        read.assert_not_called()

    @staticmethod
    def _record(key, day, attendance, source='kbc'):
        return {'recordKey': key, 'learnerId': '301', 'sessionDate': day, 'moduleName': 'M',
                'lectureName': key, 'sessionNumber': None, 'attendance': attendance, 'source': source}

    def test_live_register_wins_on_a_shared_date_and_still_fills_four_slots(self):
        live = {'301': [self._record('live:9', '2026-10-08', 'absent', 'live')]}
        self.live.return_value = (live, None)
        kbc = {'301': [
            self._record('k1', '2026-09-17', 'present'), self._record('k2', '2026-09-24', 'present'),
            self._record('k3', '2026-10-01', 'present'), self._record('k4', '2026-10-08', 'present'),
            self._record('k0', '2026-09-10', 'absent'),
        ]}
        kbc['301'].sort(key=lambda r: r['sessionDate'])
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_recent_attendance', return_value=kbc) as read:
            response = history.bulk_attendance_kbc_recent(SimpleNamespace(method='GET', GET={}))
        read.assert_called_once_with('synthetic', 5)
        recent = json.loads(response.content)['recent']['301']
        self.assertEqual([r['recordKey'] for r in recent], ['k1', 'k2', 'k3', 'live:9'])
        self.assertEqual(recent[-1]['attendance'], 'absent')

    def test_guest_makeup_keeps_same_day_kbc_lecture_and_is_not_a_recent_session(self):
        guest = {**self._record('live:guest', '2026-10-09', 'present', 'live'),
                 'countsAsSession': False, 'makeupForDate': '2026-10-06'}
        self.live.return_value = ({'301': [guest]}, None)
        kbc = {'301': [self._record('k1', '2026-10-09', 'present')]}
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_recent_attendance', return_value=kbc):
            response = history.bulk_attendance_kbc_recent(SimpleNamespace(method='GET', GET={}))
        recent = json.loads(response.content)['recent']['301']
        self.assertEqual([record['recordKey'] for record in recent], ['k1'])
        self.assertEqual([record['recordKey'] for record in history.merge_live_over_kbc(kbc['301'], [guest])],
                         ['k1', 'live:guest'])

    def test_recent_matches_full_history_when_one_live_day_replaces_many_kbc_rows(self):
        # Execute the reader's actual window query against an isolated in-memory
        # fixture. Only PostgreSQL cast/parameter syntax is adapted for SQLite.
        with closing(sqlite3.connect(':memory:')) as database:
            database.row_factory = sqlite3.Row
            database.execute("ATTACH DATABASE ':memory:' AS public")
            database.execute('''CREATE TABLE public.kbc_attendance (
                "key" TEXT, "ID" TEXT, "date" TEXT, module TEXT,
                lecture_name TEXT, "Attendance" INTEGER, attendance_status TEXT
            )''')
            rows = [
                (f'overlap-{n}', '301', '2020-10-08', 'M', f'Lecture {n}', 1, None)
                for n in range(12)
            ]
            rows += [
                (f'{learner}-{day}', learner, f'2020-10-0{day}', 'M', f'Lecture {day}', mark, None)
                for learner, days in [('301', range(1, 5)), ('302', range(1, 5)), ('303', range(1, 3))]
                for day in days
                for mark in [None if day == 4 else 1]
            ]
            database.executemany('INSERT INTO public.kbc_attendance VALUES (?, ?, ?, ?, ?, ?, ?)', rows)
            connection = MagicMock()
            connection.__enter__.return_value = connection
            cursor = connection.cursor.return_value.__enter__.return_value

            def execute(sql, params):
                result = database.execute(sql.replace('::text', '').replace('%s', '?'), params)
                cursor.fetchall.return_value = [dict(row) for row in result.fetchall()]

            cursor.execute.side_effect = execute
            live = {'301': [self._record('live:9', '2020-10-08', 'absent', 'live')]}
            self.live.return_value = (live, None)
            with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
                 patch.object(history.psycopg, 'connect', return_value=connection):
                recent = json.loads(history.bulk_attendance_kbc_recent(
                    SimpleNamespace(method='GET', GET={'source': 'all'}),
                ).content)['recent']
                for learner in ('301', '302', '303'):
                    full = json.loads(history.bulk_attendance_kbc_history(
                        SimpleNamespace(method='GET', GET={'learner_id': learner, 'source': 'all'}),
                    ).content)['records']
                    self.assertEqual(recent[learner], list(reversed(full[:4])))
            self.assertEqual([len(recent[key]) for key in ('301', '302', '303')], [4, 4, 2])
            self.assertEqual(recent['301'][-1]['source'], 'live')
            self.assertIsNone(recent['302'][-1]['attendance'])

    def test_history_merges_live_rows_newest_first_and_reports_partial_reads(self):
        self.live.return_value = ({'301': [self._record('live:9', '2026-10-08', 'absent', 'live')]},
                                  'The live session register could not be read; showing KBC attendance only.')
        kbc = [self._record('k4', '2026-10-08', 'present'), self._record('k3', '2026-10-01', 'present')]
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_attendance_history', return_value=kbc):
            payload = json.loads(history.bulk_attendance_kbc_history(
                SimpleNamespace(method='GET', GET={'learner_id': '301'}),
            ).content)
        self.assertEqual([r['recordKey'] for r in payload['records']], ['live:9', 'k3'])
        self.assertEqual(payload['warnings'], ['The live session register could not be read; showing KBC attendance only.'])

    def test_live_records_need_a_stable_kbc_id_and_a_past_session(self):
        from datetime import date
        policy = sys.modules['curriculum_api.bulk_attendance_live_policy']
        rows = [
            {'id': 1, 'occurrence_id': 'o1', 'live_session_id': 's', 'learner_profile_id': 10, 'attendance_status': 'present'},
            {'id': 2, 'occurrence_id': 'o2', 'live_session_id': 's', 'learner_profile_id': 10, 'attendance_status': 'absent'},
            {'id': 3, 'occurrence_id': 'o1', 'live_session_id': 's', 'learner_profile_id': 11, 'attendance_status': 'present'},
            {'id': 4, 'occurrence_id': 'missing', 'live_session_id': 's', 'learner_profile_id': 10, 'attendance_status': 'present'},
        ]
        occurrences = {
            'o1': {'scheduled_start': date(2026, 10, 8), 'session_number': 3},
            'o2': {'scheduled_start': date(2026, 11, 12), 'session_number': 4},
        }
        records = policy.build_live_records(
            rows, occurrences, {'s': 'Commercial Intelligence'}, {10: '301'},
            lambda value: value, date(2026, 10, 14),
        )
        self.assertEqual(list(records), ['301'])
        self.assertEqual(records['301'], [{
            'recordKey': 'live:1', 'occurrenceId': 'o1', 'learnerId': '301', 'sessionDate': '2026-10-08',
            'moduleName': 'Commercial Intelligence', 'lectureName': 'Commercial Intelligence — Session 3',
            'sessionNumber': 3, 'attendance': 'present', 'source': 'live',
        }])
        titled = policy.build_live_records(
            rows, occurrences, {'s': 'Commercial Intelligence'}, {10: '301'},
            lambda value: value, date(2026, 10, 14), lecture_titles={1: 'Pricing strategy workshop'},
        )
        self.assertEqual(titled['301'][0]['lectureName'], 'Pricing strategy workshop')
        shared = policy.build_live_records(
            [{**rows[0], 'module_title': 'Shared module'}], occurrences,
            {'s': 'Source module'}, {10: '301'}, lambda value: value, date(2026, 10, 14))
        self.assertEqual(shared['301'][0]['moduleName'], 'Shared module')
        self.assertEqual(policy.build_live_records(
            rows, occurrences, {}, {10: '301'}, lambda value: value, date(2026, 10, 14), kbc_id='999',
        ), {})

    @staticmethod
    def _post(body):
        raw = body if isinstance(body, bytes) else json.dumps(body).encode()
        return SimpleNamespace(method='POST', body=raw)

    def test_save_routes_each_change_to_its_own_source(self):
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'save_kbc_attendance', return_value=['k-1']) as kbc, \
             patch.object(history, '_save_live_attendance', return_value=[7, 9]) as live:
            response = history.bulk_attendance_save_attendance(self._post({'changes': [
                {'source': 'live', 'recordKey': 'live:7', 'attendance': 'present'},
                {'source': 'live', 'recordKey': 'live:9', 'attendance': 'Absent'},
                {'source': 'kbc', 'recordKey': 'k-1', 'attendance': 'absent'},
            ]}))
        self.assertEqual(response.status_code, 200)
        live.assert_called_once_with({7: 'present', 9: 'absent'}, actor='')
        kbc.assert_called_once_with('synthetic', {'k-1': 'absent'})
        self.assertEqual(json.loads(response.content), {'updated': ['live:7', 'live:9', 'k-1']})

    def test_live_save_passes_authenticated_actor_not_body_identity(self):
        request = self._post({'changes': [{'source': 'live', 'recordKey': 'live:7', 'attendance': 'present'}],
                              'actor': 'untrusted@example.invalid'})
        request.login_account = SimpleNamespace(email='staff@example.invalid')
        with patch.object(history, '_save_live_attendance', return_value=[7]) as live:
            response = history.bulk_attendance_save_attendance(request)
        self.assertEqual(response.status_code, 200)
        live.assert_called_once_with({7: 'present'}, actor='staff@example.invalid')

    def test_save_rejects_bad_sources_statuses_and_json_without_writing(self):
        for body in (
            {'changes': [{'recordKey': '1234', 'attendance': 'present'}]},
            {'changes': [{'source': 'live', 'recordKey': '1234', 'attendance': 'present'}]},
            {'changes': [{'source': 'kbc', 'recordKey': '', 'attendance': 'present'}]},
            {'changes': [{'source': 'live', 'recordKey': 'live:7', 'attendance': 'late'}]},
            {'changes': []},
            {},
            b'not json',
        ):
            with self.subTest(body=body), \
                 patch.object(history, '_save_live_attendance') as live, \
                 patch.object(history, 'save_kbc_attendance') as kbc:
                response = history.bulk_attendance_save_attendance(self._post(body))
                self.assertEqual(response.status_code, 400)
                live.assert_not_called()
                kbc.assert_not_called()

    def test_save_reports_missing_rows_and_database_failures_as_nothing_saved(self):
        change = {'changes': [{'source': 'live', 'recordKey': 'live:7', 'attendance': 'present'}]}
        with patch.object(history, '_save_live_attendance', side_effect=LookupError([7])):
            self.assertEqual(history.bulk_attendance_save_attendance(self._post(change)).status_code, 404)
        with patch.object(history, '_save_live_attendance', side_effect=FakeDatabaseError('private-host')):
            response = history.bulk_attendance_save_attendance(self._post(change))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())
        self.assertIn('Nothing was changed', response.content.decode())

        kbc_change = {'changes': [{'source': 'kbc', 'recordKey': 'k-1', 'attendance': 'present'}]}
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'save_kbc_attendance', side_effect=FakePsycopgError('private-host')):
            response = history.bulk_attendance_save_attendance(self._post(kbc_change))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())

    def test_save_reports_partial_success_when_live_fails_after_kbc(self):
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'save_kbc_attendance', return_value=['k-1']), \
             patch.object(history, '_save_live_attendance', side_effect=FakeDatabaseError('private-host')):
            response = history.bulk_attendance_save_attendance(self._post({'changes': [
                {'source': 'kbc', 'recordKey': 'k-1', 'attendance': 'present'},
                {'source': 'live', 'recordKey': 'live:7', 'attendance': 'present'},
            ]}))
        payload = json.loads(response.content)
        self.assertEqual(response.status_code, 503)
        self.assertTrue(payload['partial'])
        self.assertEqual(payload['updated'], ['k-1'])
        self.assertIn('were not', payload['error'])

    def test_kbc_write_updates_attendance_by_key_all_or_nothing(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.execute.return_value.fetchall.return_value = [('k-1',), ('k-2',)]
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch.object(history.psycopg, 'connect', return_value=connection) as connect:
            saved = history.save_kbc_attendance('synthetic', {'k-1': 'present', 'k-2': 'absent'})
        self.assertNotIn('options', connect.call_args.kwargs)
        self.assertEqual(saved, ['k-1', 'k-2'])
        sql, rows = cursor.executemany.call_args.args
        self.assertIn('UPDATE public.kbc_attendance', sql)
        self.assertIn('WHERE "key" = %s', sql)
        self.assertEqual(rows, [(1, 1, 'k-1'), (0, 0, 'k-2')])

        connection.execute.return_value.fetchall.return_value = [('k-1',)]
        cursor.executemany.reset_mock()
        with patch.object(history.psycopg, 'connect', return_value=connection):
            with self.assertRaises(LookupError):
                history.save_kbc_attendance('synthetic', {'k-1': 'present', 'gone': 'absent'})
        cursor.executemany.assert_not_called()

    def test_save_rejects_get(self):
        with patch.object(history, '_save_live_attendance') as save:
            response = history.bulk_attendance_save_attendance(SimpleNamespace(method='GET', body=b''))
        self.assertEqual(response.status_code, 405)
        save.assert_not_called()

    def test_endpoint_requires_one_numeric_kbc_learner_id(self):
        with patch.object(history, 'read_kbc_attendance_history') as read:
            response = history.bulk_attendance_kbc_history(SimpleNamespace(method='GET', GET={}))
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()

        with patch.object(history, 'read_kbc_attendance_history') as read:
            response = history.bulk_attendance_kbc_history(
                SimpleNamespace(method='GET', GET={'learner_id': '301,302'}),
            )
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()

    def test_success_is_private_and_returns_only_that_learners_records(self):
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_attendance_history', return_value=[]) as read:
            response = history.bulk_attendance_kbc_history(
                SimpleNamespace(method='GET', GET={'learner_id': '301'}),
            )
        self.assertEqual(json.loads(response.content), {'records': [], 'warnings': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        read.assert_called_once_with('synthetic', '301', '')
        self.live.assert_called_once_with('301')

    def test_history_accepts_directory_email_as_an_old_id_fallback(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [[], [{
            'recordKey': 'legacy-row', 'learnerId': '998', 'sessionDate': '2026-10-12',
            'moduleName': 'Legacy module', 'lectureName': 'Lecture 4',
            'attendance_value': 1, 'source_status': None,
        }]]
        with patch.object(history.psycopg, 'connect', return_value=connection):
            records = history.read_kbc_attendance_history(
                'synthetic', '301', 'fatlinda@example.invalid',
            )

        self.assertEqual([record['recordKey'] for record in records], ['legacy-row'])
        self.assertEqual(cursor.execute.call_count, 2)
        self.assertEqual(cursor.execute.call_args.args[1], ['fatlinda@example.invalid'])

    def test_history_rejects_an_invalid_optional_email(self):
        with patch.object(history, 'read_kbc_attendance_history') as read:
            response = history.bulk_attendance_kbc_history(SimpleNamespace(
                method='GET', GET={'learner_id': '301', 'learner_email': 'not-an-email'},
            ))
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()

    def test_history_live_source_does_not_read_legacy_kbc_attendance(self):
        live = [self._record('live:9', '2026-10-08', 'present', 'live')]
        self.live.return_value = ({'301': live}, None)
        with patch.object(history, 'learner_directory_dsn') as dsn, \
             patch.object(history, 'read_kbc_attendance_history') as read:
            response = history.bulk_attendance_kbc_history(
                SimpleNamespace(method='GET', GET={'learner_id': '301', 'source': 'live'}),
            )
        self.assertEqual(json.loads(response.content)['records'], list(reversed(live)))
        dsn.assert_not_called()
        read.assert_not_called()

    def test_source_failure_does_not_leak_connection_details(self):
        with patch.object(history, 'learner_directory_dsn', return_value='synthetic'), \
             patch.object(history, 'read_kbc_attendance_history', side_effect=FakePsycopgError('private-host')):
            response = history.bulk_attendance_kbc_history(
                SimpleNamespace(method='GET', GET={'learner_id': '301'}),
            )
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-host', response.content.decode())

    def test_endpoint_rejects_writes(self):
        with patch.object(history, 'read_kbc_attendance_history') as read:
            response = history.bulk_attendance_kbc_history(
                SimpleNamespace(method='POST', GET={'learner_id': '301'}),
            )
        self.assertEqual(response.status_code, 405)
        read.assert_not_called()


if __name__ == '__main__':
    unittest.main()
