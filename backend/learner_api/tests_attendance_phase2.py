"""Phase 2 regressions: synthetic identities, no database or external calls."""
from datetime import date, datetime, timedelta, timezone as utc
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from .attendance_lectures import attendance_read_contract, lecture_register
from .tests_attendance_lectures import register_row


class AttendanceReadContractTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 20, 12, tzinfo=utc.utc)
        self.source = SimpleNamespace(id=901, email='synthetic@example.test')
        self.profile_id = 42
        self.rows = []
        for target, value in [
            ('learner_api.attendance_lectures.lecture_register', self.rows),
            ('coach_api.models.CoachManualAttendance.objects', None),
            ('coach_api.models.CoachAbsenceReport.objects', None),
            ('learner_api.attendance_lectures.timezone.now', self.now),
        ]:
            mock = patch(target, return_value=value).start()
            self.addCleanup(patch.stopall)
            if target.endswith('lecture_register'):
                self.register = mock
            elif 'Manual' in target:
                self.manual = mock
                mock.filter.return_value = []
            elif 'Absence' in target:
                self.reports = mock
                mock.filter.return_value.order_by.return_value = []

    def read(self):
        return attendance_read_contract(self.source, learner_profile_id=self.profile_id)

    def test_distinct_identities_and_manual_scope(self):
        payload = self.read()
        self.assertEqual((payload['learner_profile_id'], payload['enrolment_id']), (42, 901))
        self.register.assert_called_once_with(self.source, learner_profile_id=42)
        self.manual.filter.assert_called_once_with(learner_id=42)
        self.reports.filter.assert_called_once_with(learner_id=901)

    def test_recovered_absence_and_report_keep_raw_meaning(self):
        row = register_row(learner_id=901, effective_attendance=1, effective_attendance_status='made_up')
        self.rows.append(row)
        from .attendance_lectures import report_id
        self.reports.filter.return_value.order_by.return_value = [SimpleNamespace(
            id=71, attendance_id=report_id(row), status='approved')]
        payload = self.read()
        self.assertEqual(payload['summary']['present'], 1)
        self.assertEqual(payload['summary']['absent'], 0)
        item = payload['history'][0]
        self.assertEqual((item['rawStatus'], item['effectiveStatus'], item['status']), ('absent', 'made_up', 'present'))
        self.assertEqual(item['absenceReport']['id'], '71')

    def test_future_source_and_manual_do_not_count(self):
        self.rows.append(register_row(session_date=date(2026, 9, 21), attendance_status='present'))
        self.manual.filter.return_value = [SimpleNamespace(id=8, module_name='Module',
            session_title='Manual', session_date=date(2026, 9, 21), status='present')]
        payload = self.read()
        self.assertEqual(len(payload['history']), 2)
        self.assertEqual(payload['summary']['totalCounted'], 0)
        self.assertEqual(payload['recentAttendance'], [])

    def test_last_four_uses_instants_and_stable_ids_without_date_deduplication(self):
        for key, hour in [('a', 9), ('b', 10), ('c', 10), ('d', 11), ('e', 8)]:
            self.rows.append(register_row(session_id=key, session_date=date(2026, 9, 19),
                scheduled_start=datetime(2026, 9, 19, hour, tzinfo=utc.utc), attendance_status='present'))
        payload = self.read()
        self.assertEqual([row['sourceId'] for row in payload['recentAttendance']], ['d', 'c', 'b', 'a'])
        self.assertEqual(payload['summary']['totalCounted'], 5)

    def test_module_title_is_separate_from_type_and_session_title(self):
        self.rows.append(register_row(module_title='Data Foundations', session_type='live_session', session_title='Lecture 2'))
        item = self.read()['history'][0]
        self.assertEqual((item['module'], item['sessionType'], item['sessionTitle']), ('Data Foundations', 'live_session', 'Lecture 2'))


class RegisterIdentityTests(SimpleTestCase):
    @patch('learner_api.models.LearnerProfile.objects')
    @patch('learner_api.attendance_lectures._apply_coach_source_adjustments')
    @patch('learner_api.attendance_confirmation.read_confirmations', return_value={})
    @patch('learner_api.attendance_lectures._apply_completed_catchups', side_effect=lambda rows, _: rows)
    @patch('learner_api.attendance_lectures.read_native_occurrences', return_value=[])
    def test_profile_is_resolved_from_enrolment_not_numeric_coincidence(self, schedule, catchups, confirmations, adjustments, profiles):
        profiles.filter.return_value.values_list.return_value = [42]
        lecture_register(SimpleNamespace(id=901), records=[register_row()])
        profiles.filter.assert_called_once_with(enrolment_id=901)
        self.assertEqual(adjustments.call_args.args[1], 42)

    @patch('learner_api.attendance_confirmation.read_confirmations', return_value={})
    @patch('learner_api.attendance_lectures.read_native_occurrences', return_value=[])
    def test_cancelled_occurrence_is_excluded_when_schedule_omits_it(self, schedule, confirmations):
        rows = lecture_register(SimpleNamespace(id=901), records=[register_row(source='microsoft-teams')], apply_adjustments=False)
        self.assertEqual(rows, [])

    @patch('coach_api.models.CoachAttendanceSourceAdjustment.objects')
    def test_corrected_source_retains_raw_status_and_session_type(self, objects):
        from .attendance_lectures import _apply_coach_source_adjustments
        objects.filter.return_value = [SimpleNamespace(source='kbc-attendance',
            source_id='record', is_deleted=False, session_date=None, module_name='Correct module',
            session_title='Correct title', status='present', updated_at=None)]
        row = _apply_coach_source_adjustments([register_row(session_id='record', session_type='KBC attendance')], 42)[0]
        self.assertEqual(row['raw_attendance_status'], 'absent')
        self.assertEqual(row['effective_attendance_status'], 'present')
        self.assertEqual(row['session_type'], 'KBC attendance')
        objects.filter.assert_called_once_with(learner_id=42)
