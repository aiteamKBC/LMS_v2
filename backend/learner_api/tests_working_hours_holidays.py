"""Exercise the actual read query against isolated, synthetic SQLite tables."""
import json
import sqlite3
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory

from .working_hours_holidays import is_working_hours_holiday, working_hours_holidays


class WorkingHoursHolidayTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.db.execute('CREATE TABLE curriculum.england_holidays (holiday_date TEXT, division TEXT)')
        self.db.execute('CREATE TABLE curriculum.holidays (start_date TEXT, end_date TEXT, is_archived BOOLEAN)')
        self.db.executemany('INSERT INTO curriculum.england_holidays VALUES (?, ?)', [
            ('2026-12-25', 'england-and-wales'), ('2026-08-03', 'scotland')])
        self.db.executemany('INSERT INTO curriculum.holidays VALUES (?, ?, ?)', [
            ('2026-12-28', '2026-12-31', False), ('2026-06-10', None, False),
            ('2026-06-11', '2026-06-12', True)])

        @contextmanager
        def cursor():
            cur = self.db.cursor()
            try:
                yield SimpleNamespace(execute=lambda sql, params: cur.execute(sql.replace('%s', '?'), params), fetchall=cur.fetchall)
            finally:
                cur.close()

        mock = patch('learner_api.working_hours_holidays.connection', SimpleNamespace(cursor=cursor))
        mock.start()
        self.addCleanup(mock.stop)

    def test_official_and_manual_ranges_include_both_endpoints(self):
        for day in (25, 28, 29, 31):
            self.assertTrue(is_working_hours_holiday(date(2026, 12, day)))
        self.assertFalse(is_working_hours_holiday(date(2027, 1, 1)))
        self.assertFalse(is_working_hours_holiday(date(2026, 12, 27)))

    def test_archived_and_other_divisions_do_not_apply(self):
        self.assertFalse(is_working_hours_holiday(date(2026, 6, 11)))
        self.assertFalse(is_working_hours_holiday(date(2026, 8, 3)))
        self.assertTrue(is_working_hours_holiday(date(2026, 6, 10)))

    def test_endpoint_returns_combined_calendar_to_authenticated_users(self):
        request = RequestFactory().get('/learner_api/working-hours/holidays/')
        with patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='learner')):
            response = working_hours_holidays(request)
        self.assertEqual(response.status_code, 200)
        self.assertIn({'start': '2026-12-28', 'end': '2026-12-31'}, json.loads(response.content)['holidays'])

    def test_anonymous_requests_are_denied(self):
        with patch('login.permissions.authenticate_request', return_value=None):
            response = working_hours_holidays(RequestFactory().get('/learner_api/working-hours/holidays/'))
        self.assertEqual(response.status_code, 401)

    def test_database_failure_is_visible_not_an_empty_calendar(self):
        with patch('learner_api.working_hours_holidays.working_hours_holiday_ranges', side_effect=DatabaseError):
            response = working_hours_holidays.__wrapped__(RequestFactory().get('/learner_api/working-hours/holidays/'))
        self.assertEqual(response.status_code, 503)
