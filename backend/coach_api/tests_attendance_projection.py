import json
from datetime import date, datetime, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from .attendance_projection import project_register
from .case_file import case_file_section


class AttendanceProjectionTests(SimpleTestCase):
    def rows(self):
        return [{'session_id': str(i), 'session_date': date(2026, 9 if i < 30 else 10, i % 28 + 1),
                 'attendance_status': 'absent' if i % 2 else 'present',
                 'session_title': f'Session {i}', 'absence_reason': 'Transport' if i == 45 else None}
                for i in range(46)]

    def project(self, params):
        return project_register(self.rows(), params, now=datetime(2026, 11, 1, tzinfo=timezone.utc))

    def test_compact_pages_and_canonical_summary(self):
        first = self.project({})
        self.assertEqual(first['summary'], {'sessions': 46, 'present': 23, 'absent': 23,
                                          'attendanceRate': 50, 'outstandingAbsences': 23})
        self.assertEqual(len(first['sessions']), 20)
        self.assertTrue(first['pagination']['hasMore'])
        self.assertEqual(set(first['sessions'][0]), {'id', 'title', 'date', 'status', 'reason'})
        second = self.project({'page': '2'})
        self.assertFalse({r['id'] for r in first['sessions']} & {r['id'] for r in second['sessions']})
        self.assertEqual(len(self.project({'page': '3'})['sessions']), 6)

    def test_filters_cover_entire_history_without_changing_summary(self):
        for params, count in (({'search': 'Transport'}, 1), ({'status': 'absent'}, 23), ({'month': '2026-09'}, 30)):
            with self.subTest(params=params):
                result = self.project(params)
                self.assertEqual(result['pagination']['total'], count)
                self.assertEqual(result['summary'], self.project({})['summary'])

    def test_invalid_pagination(self):
        for params in ({'page': '0'}, {'pageSize': '101'}, {'page': 'wrong'}):
            with self.assertRaises(ValueError):
                self.project(params)

    def test_get_uses_register_without_any_settlement_or_database_write(self):
        # SimpleTestCase forbids database access; every data read is replaced.
        context = SimpleNamespace(profile=SimpleNamespace(id=101), source=SimpleNamespace(id=201), stage_measurements=[])
        request = RequestFactory().get('/coach_api/coach/case-file/101/attendance')
        request.coach_email = 'coach@example.test'
        with patch('coach_api.case_file.CaseFileContext', return_value=context), \
             patch('learner_api.attendance_lectures.lecture_register', return_value=self.rows()) as register, \
             patch('learner_api.catchup_outcomes.sync_catchup_outcomes', side_effect=AssertionError('Mutation path')) as sync:
            response = unwrap(case_file_section)(request, 101, section='attendance')
        self.assertEqual(response.status_code, 200)
        self.assertIn('summary', json.loads(response.content))
        register.assert_called_once_with(context.source, learner_profile_id=101)
        sync.assert_not_called()

    def test_recovery_correction_and_future_eligibility(self):
        rows = self.rows()[:3]
        rows[1]['effective_attendance_status'] = 'present'
        rows[2]['session_date'] = date(2027, 1, 1)
        result = project_register(rows, {}, now=datetime(2026, 11, 1, tzinfo=timezone.utc))
        self.assertEqual(result['summary']['sessions'], 2)
        self.assertEqual(result['summary']['present'], 2)
