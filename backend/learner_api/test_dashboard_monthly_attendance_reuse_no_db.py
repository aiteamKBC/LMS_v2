"""Monthly attendance reuse against private SQLite fixtures; no external I/O."""
from unittest.mock import patch

from django.test import SimpleTestCase
from old_otjh import repository
from . import attendance_otjh, dashboard_monthly, monthly_log_attendance
from . import tests_monthly_log_attendance as fixtures


class MonthlyAttendanceReuseTests(SimpleTestCase):
    setUp = fixtures.MonthlyLogAttendanceTests.setUp
    read = fixtures.MonthlyLogAttendanceTests.read
    lecture = fixtures.MonthlyLogAttendanceTests.lecture
    signature = fixtures.MonthlyLogAttendanceTests.signature

    def aggregate(self, *args, **kwargs):
        facts = attendance_otjh.read_bulk([self.owner], repository.query, now=self.now)[self.owner['id']]
        supplement = monthly_log_attendance.read_rows(self.owner, now=self.now)
        return facts, supplement

    def monthly(self):
        return dashboard_monthly.read_monthly(None, 'commercial', self.owner, None, None)

    def readers(self):
        self.enterContext(patch.object(monthly_log_attendance, 'query', repository.query))
        self.enterContext(patch.object(dashboard_monthly, '_read_monthly', side_effect=self.aggregate))
        return self.enterContext(patch.object(repository, '_query_rows',
            side_effect=lambda alias, sql, params: self.read(sql, params)))

    def test_ledger_and_display_read_signed_captures_once_and_keep_first_signature(self):
        self.lecture()
        capture = {'source_system': monthly_log_attendance.SOURCE, 'reporting_month': '2026-10',
                   'source_ref': 'attendance:O1', 'actual_hours': 2, 'accepted': True}
        self.signature(rows=[capture])
        self.signature(rows=[{**capture, 'actual_hours': 99}], ident=2)
        before = list(self.db.iterdump())
        read = self.readers()
        facts, supplement = self.monthly()
        self.assertEqual(facts['frozen_rows'], [capture])
        self.assertEqual(supplement, [capture])
        signature_reads = [call for call in read.call_args_list if 'signature_data' in call.args[1]]
        self.assertEqual(len(signature_reads), 1)
        locks = [call for call in read.call_args_list if 'learner_monthly_locks' in call.args[1]]
        self.assertEqual(len(locks), 1)
        supplement[0]['actual_hours'] = 100
        self.assertEqual(facts['frozen_rows'], [capture])
        self.assertEqual(list(self.db.iterdump()), before)

    def test_next_monthly_request_reads_new_signature_and_other_owner_independently(self):
        self.lecture()
        self.lecture('OTHER', owner=80)
        self.readers()
        _, first = self.monthly()
        self.assertEqual(first[0]['actual_hours'], 2.5)
        self.signature()
        facts, second = self.monthly()
        self.assertEqual(second, [])
        self.assertIn('2026-10', facts['protected'])
        self.owner = {'id': 80}
        facts, other = self.monthly()
        self.assertEqual(facts['protected'], {})
        self.assertEqual([row['source_ref'] for row in other], ['attendance:OTHER'])

    def test_failed_monthly_read_does_not_retain_cached_data_for_retry(self):
        self.lecture()
        self.readers()
        def fail(*args, **kwargs):
            self.aggregate()
            raise RuntimeError('Synthetic interrupted request')
        with patch.object(dashboard_monthly, '_read_monthly', side_effect=fail):
            with self.assertRaisesRegex(RuntimeError, 'Synthetic interrupted request'):
                self.monthly()
        self.signature()
        facts, supplement = self.monthly()
        self.assertEqual(supplement, [])
        self.assertIn('2026-10', facts['protected'])
