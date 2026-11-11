"""The bulk register's new-database path: KBC rows through kbc_sync, learners from the LMS.

No database: the cursor is a recording fake, so these pin the SQL shape, the
parameters and the transaction settings, not live Postgres behaviour.
"""
import json
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import bulk_attendance_kbc_history as history
from . import bulk_attendance_kbc_source as source
from . import bulk_attendance_learners as directory

COLUMNS = ['recordKey', 'learnerId', 'sessionDate', 'moduleName', 'lectureName',
           'attendance_value', 'source_status']


class FakeCursor:
    def __init__(self, results=()):
        self.results = list(results)
        self.executed = []
        self.many = []
        self.description = None
        self._rows = []

    def execute(self, sql, params=None):
        self.executed.append((' '.join(sql.split()), params))
        columns, rows = self.results.pop(0) if self.results else ([], [])
        self.description = [(name,) for name in columns]
        self._rows = rows

    def executemany(self, sql, params):
        self.many.append((' '.join(sql.split()), list(params)))

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


def fake_cursor_context(cursor, calls):
    @contextmanager
    def context(*, read_only):
        calls.append(read_only)
        yield cursor
    return context


class LinkDetectionTests(SimpleTestCase):
    def tearDown(self):
        source._linked = None

    def test_sqlite_is_never_the_new_database_and_the_answer_is_kept(self):
        source._linked = None
        self.assertFalse(source.on_new_database())
        self.assertIs(source._linked, False)

    def test_kbc_dsn_uses_the_link_only_when_it_exists(self):
        with patch.object(history, 'on_new_database', return_value=True), \
             patch.object(history, 'learner_directory_dsn') as direct:
            self.assertEqual(history.kbc_dsn(), source.NEW_DATABASE)
        direct.assert_not_called()
        with patch.object(history, 'on_new_database', return_value=False), \
             patch.object(history, 'learner_directory_dsn', return_value='direct-dsn'):
            self.assertEqual(history.kbc_dsn(), 'direct-dsn')


class NewDatabaseCursorTests(SimpleTestCase):
    def _run(self, *, read_only, outer):
        cursor = FakeCursor()
        connection = MagicMock(in_atomic_block=outer)
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(source, 'connections', {'enrolment': connection, 'default': connection}), \
             patch.object(source.transaction, 'atomic') as atomic:
            with source.new_database_cursor(read_only=read_only) as yielded:
                self.assertIs(yielded, cursor)
        atomic.assert_called_once()
        return [sql for sql, _ in cursor.executed]

    def test_a_read_is_read_only_with_the_limit_in_one_round_trip(self):
        self.assertEqual(self._run(read_only=True, outer=False),
                         ["SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '10s'"])

    def test_a_write_keeps_the_limit_but_not_read_only(self):
        self.assertEqual(self._run(read_only=False, outer=False),
                         ["SET LOCAL statement_timeout = '10s'"])

    def test_inside_a_callers_transaction_nothing_is_changed(self):
        self.assertEqual(self._run(read_only=True, outer=True), [])


class LinkedReadTests(SimpleTestCase):
    def setUp(self):
        self.calls = []

    def _with(self, cursor):
        return patch.object(history, 'new_database_cursor', fake_cursor_context(cursor, self.calls))

    def test_history_reads_the_link_by_id_then_email_only_without_an_id_match(self):
        cursor = FakeCursor([(COLUMNS, []), (COLUMNS, [('k1', '301', '2026-10-01', 'M', 'Lecture 2', 1, None)])])
        with self._with(cursor):
            records = history.read_kbc_attendance_history(source.NEW_DATABASE, '301', 'a@example.invalid')
        self.assertEqual([record['recordKey'] for record in records], ['k1'])
        self.assertEqual(records[0]['attendance'], 'present')
        self.assertEqual(records[0]['sessionNumber'], 2)
        (first_sql, first_params), (second_sql, second_params) = cursor.executed
        self.assertIn('FROM kbc_sync.kbc_attendance', first_sql)
        self.assertIn('"ID"::text = %s', first_sql)
        self.assertEqual(first_params, ['301'])
        self.assertIn('lower(trim("Email")) = %s', second_sql)
        self.assertEqual(second_params, ['a@example.invalid'])
        self.assertEqual(self.calls, [True])

    def test_history_without_an_email_stops_after_the_id_read(self):
        cursor = FakeCursor([(COLUMNS, [])])
        with self._with(cursor):
            self.assertEqual(history.read_kbc_attendance_history(source.NEW_DATABASE, '301'), [])
        self.assertEqual(len(cursor.executed), 1)

    def test_month_compares_real_dates_so_the_filter_runs_at_the_source(self):
        cursor = FakeCursor([(COLUMNS, [('k1', '301', '2026-10-12', 'M', 'L', 0, None)])])
        with self._with(cursor):
            records = history.read_kbc_month_attendance(
                source.NEW_DATABASE, date(2026, 10, 1), date(2026, 11, 1), ['301'])
        sql, params = cursor.executed[0]
        self.assertIn('"date" >= %s AND "date" < %s', sql)
        self.assertNotIn('substr(', sql)
        self.assertEqual(params, [date(2026, 10, 1), date(2026, 11, 1), ['301']])
        self.assertEqual(records[0]['attendance'], 'absent')

    def test_recent_groups_linked_rows_by_learner(self):
        cursor = FakeCursor([(COLUMNS, [
            ('a', '301', '2026-10-01', 'M', 'L1', 1, None),
            ('b', '302', '2026-10-02', 'M', 'L1', 0, None),
            ('c', '301', '2026-10-08', 'M', 'L2', None, 'absent'),
        ])])
        with self._with(cursor):
            recent = history.read_kbc_recent_attendance(source.NEW_DATABASE, 4)
        self.assertEqual({key: [r['recordKey'] for r in rows] for key, rows in recent.items()},
                         {'301': ['a', 'c'], '302': ['b']})
        self.assertIn('FROM kbc_sync.kbc_attendance', cursor.executed[0][0])
        self.assertEqual(cursor.executed[0][1], [4])

    def test_day_membership_reads_the_link(self):
        cursor = FakeCursor([(['ID'], [('301',), (' 302 ',)])])
        with self._with(cursor):
            ids = history.read_kbc_day_learner_ids(source.NEW_DATABASE, date(2026, 10, 14))
        self.assertEqual(ids, {'301', '302'})
        self.assertIn('FROM kbc_sync.kbc_attendance', cursor.executed[0][0])


class LinkedWriteTests(SimpleTestCase):
    def setUp(self):
        self.calls = []

    def test_save_locks_then_updates_every_key_through_the_link(self):
        cursor = FakeCursor([(['key'], [('k-1',), ('k-2',)])])
        with patch.object(history, 'new_database_cursor', fake_cursor_context(cursor, self.calls)):
            saved = history.save_kbc_attendance(source.NEW_DATABASE, {'k-1': 'present', 'k-2': 'absent'})
        self.assertEqual(saved, ['k-1', 'k-2'])
        self.assertEqual(self.calls, [False])
        lock_sql, lock_params = cursor.executed[0]
        self.assertIn('FROM kbc_sync.kbc_attendance WHERE "key" = ANY(%s) FOR UPDATE', lock_sql)
        self.assertEqual(lock_params, [['k-1', 'k-2']])
        update_sql, rows = cursor.many[0]
        self.assertTrue(update_sql.startswith('UPDATE kbc_sync.kbc_attendance SET "Attendance" = %s'))
        self.assertEqual(rows, [(1, 1, 'k-1'), (0, 0, 'k-2')])

    def test_save_with_a_missing_key_writes_nothing(self):
        cursor = FakeCursor([(['key'], [('k-1',)])])
        with patch.object(history, 'new_database_cursor', fake_cursor_context(cursor, self.calls)):
            with self.assertRaises(LookupError) as raised:
                history.save_kbc_attendance(source.NEW_DATABASE, {'k-1': 'present', 'gone': 'absent'})
        self.assertEqual(raised.exception.args[0], ['gone'])
        self.assertEqual(cursor.many, [])

    def _delete(self, cursor):
        request = RequestFactory().post('/x', data=json.dumps({'source': 'kbc', 'recordKey': 'k-1'}),
                                        content_type='application/json')
        with patch.object(history, 'kbc_dsn', return_value=source.NEW_DATABASE), \
             patch.object(history, 'new_database_cursor', fake_cursor_context(cursor, self.calls)), \
             patch.object(history.psycopg, 'connect') as direct:
            response = history.bulk_attendance_delete_attendance(request)
        direct.assert_not_called()
        return response

    def test_delete_goes_through_the_link(self):
        cursor = FakeCursor([(['key'], [('k-1',)])])
        response = self._delete(cursor)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'deleted': 'k-1'})
        self.assertIn('DELETE FROM kbc_sync.kbc_attendance WHERE "key" = %s RETURNING "key"', cursor.executed[0][0])
        self.assertEqual(self.calls, [False])

    def test_delete_of_a_gone_record_is_404(self):
        self.assertEqual(self._delete(FakeCursor([(['key'], [])])).status_code, 404)


class DirectoryTests(SimpleTestCase):
    def _get(self):
        request = RequestFactory().get('/x')
        request.login_account = SimpleNamespace(role='admin')
        return directory.bulk_attendance_learners(request)

    LMS = [{'id': '301', 'name': 'Synthetic One', 'email': 'one@example.invalid', 'programme': 'P',
            'group': 'G', 'endDate': '', 'kbcStatus': 'active'}]

    def test_on_the_new_database_the_list_is_the_lms_learners(self):
        with patch.object(source, 'on_new_database', return_value=True), \
             patch.object(directory, 'read_lms_directory',
                          return_value=(self.LMS, directory.enrolment_maps([]))) as read, \
             patch.object(directory, 'read_learners') as direct, \
             patch.object(directory, '_enrolment_statuses') as statuses, \
             patch.object(directory, '_enrolment_emails') as emails, \
             patch.object(directory, '_enrolment_attendance_modes') as modes:
            response = self._get()
        read.assert_called_once_with()
        direct.assert_not_called()
        # One combined read: the separate enrolment reads are not repeated.
        statuses.assert_not_called()
        emails.assert_not_called()
        modes.assert_not_called()
        payload = json.loads(response.content)
        self.assertEqual(payload['warnings'], [])
        self.assertEqual([(row['id'], row['status'], row['attendanceMode']) for row in payload['learners']],
                         [('301', 'active', 'live')])

    def test_a_failed_combined_read_falls_back_to_the_separate_reads(self):
        from django.db import DatabaseError

        with patch.object(source, 'on_new_database', return_value=True), \
             patch.object(directory, 'read_lms_directory', side_effect=DatabaseError('x')), \
             patch.object(directory, 'read_lms_learners', return_value=self.LMS) as read, \
             patch.object(directory, '_enrolment_statuses', side_effect=DatabaseError('x')), \
             patch.object(directory, '_enrolment_emails', return_value={}), \
             patch.object(directory, '_enrolment_attendance_modes', return_value={}):
            response = self._get()
        read.assert_called_once_with()
        self.assertEqual(json.loads(response.content)['warnings'], [directory.ENROLMENT_STATUS_WARNING])

    def test_the_combined_read_is_one_transaction_with_the_same_rules(self):
        cursor = FakeCursor([
            (['id', 'name', 'email', 'programme', 'group', 'endDate', 'kbcStatus'],
             [('301', 'One', 'one@kbc.invalid', 'P', 'G', None, 'active'),
              ('302', 'Two', 'two@kbc.invalid', 'P', 'G', None, 'active')]),
            (['aptem_id', 'Email', 'Programme_status', 'mode'],
             [('301', 'One@LMS.invalid', 'Withdrawn', 'lazy'),
              ('302', 'two@lms.invalid', 'Active', None),
              ('302', 'other@lms.invalid', 'Active', 'lazy')]),
        ])
        transactions = []
        with patch.object(source, 'new_database_cursor', fake_cursor_context(cursor, transactions)):
            learners, enrolment = directory.read_lms_directory()
        self.assertEqual(transactions, [True])
        self.assertEqual(len(cursor.executed), 2)
        self.assertIn('FROM "Learner".learners l', cursor.executed[0][0])
        self.assertIn('LEFT JOIN "Learner".attendance_preferences p ON p.learner_id = u.id',
                      cursor.executed[1][0])
        self.assertEqual(learners[0]['endDate'], '')
        self.assertEqual(enrolment['statuses'], {'301': 'Withdrawn', '302': 'Active'})
        # An Aptem id with two emails or two modes is ambiguous and left out.
        self.assertEqual(enrolment['emails'], {'301': 'one@lms.invalid'})
        self.assertEqual(enrolment['modes']['byAptem'], {'301': 'lazy'})
        self.assertEqual(enrolment['modes']['byEmail'],
                         {'one@lms.invalid': 'lazy', 'two@lms.invalid': 'live', 'other@lms.invalid': 'lazy'})

    def test_without_the_link_the_direct_directory_is_kept(self):
        with patch.object(source, 'on_new_database', return_value=False), \
             patch.object(directory, 'learner_directory_dsn', return_value=''), \
             patch.object(directory, 'read_lms_learners') as read:
            response = self._get()
        self.assertEqual(response.status_code, 503)
        read.assert_not_called()

    def test_the_lms_list_is_keyed_by_aptem_id_with_curriculum_names(self):
        cursor = FakeCursor([(['id', 'name', 'email', 'programme', 'group', 'endDate', 'kbcStatus'],
                              [('301', ' Synthetic One ', 'one@example.invalid', 'P', 'G', None, 'active')])])
        with patch.object(source, 'new_database_cursor', fake_cursor_context(cursor, [])):
            rows = directory.read_lms_learners()
        self.assertEqual(rows[0]['name'], 'Synthetic One')
        self.assertEqual(rows[0]['endDate'], '')
        sql = cursor.executed[0][0]
        self.assertIn('FROM "Learner".learners l', sql)
        self.assertIn('l.aptem_id IS NOT NULL', sql)
        self.assertIn('coalesce(l.end_date, l.learner_end_date)', sql)
