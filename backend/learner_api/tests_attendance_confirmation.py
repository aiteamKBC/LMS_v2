"""Attendance credit regressions; no database setup or real writes."""
from contextlib import nullcontext
from datetime import date, datetime, timezone as dt_timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from . import attendance_confirmation as confirmation
from .attendance_lectures import build_lectures, lecture_register
from .absence_reports import _can_report_absence
from .monthly_log_sources import _attendance


class AttendanceConfirmationTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(id=12)
        self.model = MagicMock()
        self.model.all_learners.filter.return_value.only.return_value.first.return_value = self.source
        self.lecture = {'id': 'teams:occ-1-2026-09-14', 'sessionId': 'teams:occ-1',
            'date': '2026-09-14', 'startTime': '10:00', 'startsAt': '2026-09-14T09:00:00+00:00',
            'title': 'Lecture', 'module': 'Business', 'durationMinutes': 120, 'status': 'upcoming',
            'ksbs': ['K1'], 'monthlyLog': {'sourceRef': 'attendance:occ-1', 'month': '2026-09'}}
        for target, value in [
            ('learner_api.attendance_confirmation.SOURCE_MODELS', {'apprenticeship': self.model}),
            ('learner_api.attendance_lectures.read_workspace', {'lectures': [self.lecture]}),
            ('learner_api.attendance_confirmation.timezone.localdate', date(2026, 9, 14)),
        ]:
            mocker = patch(target, value) if target.endswith('SOURCE_MODELS') else patch(target, return_value=value)
            mocker.start()
            self.addCleanup(mocker.stop)

    def submit(self, **body):
        request = RequestFactory().post('/', json.dumps({'lectureId': self.lecture['id'], **body}), content_type='application/json')
        return unwrap(confirmation.confirm_attendance)(request, 'apprenticeship', 12)

    def test_hours_are_resolved_by_server_not_request(self):
        with patch.object(confirmation, 'save_confirmation', return_value={'creditedHours': 2}) as save:
            response = self.submit(durationMinutes=99999, date='2026-09-14', status='completed')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(save.call_args.args, (self.source, self.lecture))
        self.assertEqual(save.call_args.args[1]['durationMinutes'], 120)

    def test_rejects_past_future_unknown_and_ambiguous_lectures(self):
        with patch.object(confirmation, 'save_confirmation') as save:
            for day in ('2026-09-13', '2026-09-15'):
                self.lecture['date'] = day
                self.assertEqual(self.submit(date='2026-09-14').status_code, 409)
            self.assertEqual(self.submit(lectureId='someone-elses-lecture').status_code, 404)
            with patch('learner_api.attendance_lectures.read_workspace', return_value={'lectures': [self.lecture, self.lecture]}):
                self.assertEqual(self.submit().status_code, 404)
            save.assert_not_called()

    def test_unknown_or_invalid_duration_is_never_credited(self):
        with patch.object(confirmation, 'save_confirmation') as save:
            for minutes in (None, 0, -10, float('nan'), float('inf')):
                self.lecture['durationMinutes'] = minutes
                self.assertEqual(self.submit().status_code, 409)
            save.assert_not_called()

    def test_already_confirmed_returns_saved_credit_without_another_write(self):
        self.lecture.update(status='completed', attendanceConfirmed=True, creditedMinutes=120)
        with patch.object(confirmation, 'save_confirmation') as save:
            response = self.submit()
        self.assertTrue(json.loads(response.content)['alreadyRecorded'])
        self.assertEqual(json.loads(response.content)['creditedHours'], 2)
        save.assert_not_called()

    def test_existing_source_attendance_cannot_be_credited_again(self):
        with patch.object(confirmation, 'save_confirmation') as save:
            for status in ('completed', 'late'):
                self.lecture['status'] = status
                self.assertEqual(self.submit().status_code, 409)
            save.assert_not_called()

    def test_staff_and_another_learner_cannot_submit(self):
        with patch('login.permissions._auth_gate_enabled', return_value=True):
            for account, status in [(SimpleNamespace(role='staff'), 403),
                                    (SimpleNamespace(role='learner', subject_id=99), 404), (None, 401)]:
                request = RequestFactory().post('/', '{}', content_type='application/json')
                request._dont_enforce_csrf_checks = True
                with patch('login.permissions.authenticate_request', return_value=account):
                    response = confirmation.confirm_attendance(request, kind='apprenticeship', learner_id=12)
                self.assertEqual(response.status_code, status)

    def test_csrf_is_required_and_get_does_not_write(self):
        with patch.object(confirmation, 'save_confirmation') as save:
            self.assertEqual(confirmation.confirm_attendance(RequestFactory().get('/'), 'apprenticeship', 12).status_code, 405)
            self.assertEqual(confirmation.confirm_attendance(RequestFactory().post('/'), 'apprenticeship', 12).status_code, 403)
            save.assert_not_called()

    def test_atomic_save_persists_full_duration_once_for_exact_learner_and_occurrence(self):
        profile = SimpleNamespace(id=55)
        profiles = MagicMock()
        profiles.objects.using.return_value.select_for_update.return_value.filter.return_value.only.return_value.__getitem__.return_value = [profile]
        model = MagicMock()
        entries = model.objects.using.return_value.filter.return_value
        entries.filter.return_value.first.side_effect = [None, SimpleNamespace(claimed_seconds=7200)]
        entries.aggregate.return_value = {'last': 5}
        with patch.object(confirmation, 'LearnerProfile', profiles), patch.object(confirmation, 'LearnerProgressEntry', model), \
             patch.object(confirmation.transaction, 'atomic', return_value=nullcontext()) as atomic:
            first = confirmation.save_confirmation(self.source, self.lecture)
            second = confirmation.save_confirmation(self.source, self.lecture)
        self.assertEqual((first['creditedHours'], second['creditedHours']), (2, 2))
        self.assertTrue(second['alreadyRecorded'])
        entries.create.assert_called_once()
        values = entries.create.call_args.kwargs
        self.assertEqual((values['learner'], values['claimed_seconds'], values['kind']), (profile, 7200, 'activity_event'))
        self.assertEqual(values['time_tracking_session_ref'], self.lecture['id'])
        self.assertEqual(json.loads(values['time_tracking_calculation'])['sourceRef'], 'attendance:occ-1')
        self.assertEqual(values['feed_detail'], '2 hours credited for the full lecture.')
        profiles.objects.using.return_value.select_for_update.assert_called()
        atomic.assert_called_with(using='enrolment')

    def test_credit_survives_source_refresh_and_does_not_cover_another_occurrence(self):
        from .tests_attendance_lectures import register_row
        record = register_row(source='microsoft-teams', session_id='occ-1', module_catalogue_id='m',
                              session_date=date(2026, 9, 14))
        saved = {self.lecture['id']: {'seconds': 7200, 'submitted_at': timezone.now()}}
        rows = confirmation.apply_confirmations([record, {**record, 'session_id': 'occ-2'}], saved)
        self.assertEqual([r['attendance_status'] for r in rows], ['present', 'absent'])
        self.assertFalse(_can_report_absence(rows[0]))
        lecture = build_lectures(rows, {}, [], [], 'apprenticeship', 12)[0]
        self.assertEqual((lecture['status'], lecture['durationMinutes'], lecture['creditedMinutes']), ('completed', 120, 120))

    def test_today_pending_can_report_but_historical_pending_cannot(self):
        self.assertTrue(_can_report_absence({'attendance_status': 'pending', 'session_date': date(2026, 9, 14)}))
        self.assertFalse(_can_report_absence({'attendance_status': 'pending', 'session_date': date(2026, 9, 13)}))

    def test_same_day_confirmation_counts_before_scheduled_start(self):
        from datetime import time
        from .attendance import _summarize_attendance
        from .tests_attendance_lectures import register_row
        record = register_row(session_date=date(2026, 9, 14), session_start_time=time(18),
                              attendance_status='present', attendance_confirmed=True)
        result = _summarize_attendance([record], now=datetime(2026, 9, 14, 8, tzinfo=dt_timezone.utc))
        self.assertEqual((result['present'], result['attendanceRate']), (1, 100))

    def test_monthly_logs_count_confirmation_once_when_teams_report_arrives(self):
        saved = {self.lecture['id']: {'seconds': 7200, 'details': json.dumps({
            'sourceRef': 'attendance:occ-1', 'startsAt': '2026-09-14T09:00:00Z',
            'date': '2026-09-14', 'title': 'Lecture', 'module': 'Business', 'ksbs': ['K1']})}}
        with patch.object(confirmation, 'read_confirmations', return_value=saved), \
             patch('learner_api.monthly_log_sources.query', return_value=[{
                 'id': 'occ-1', 'scheduled_start': datetime(2026, 9, 14, 9, tzinfo=dt_timezone.utc),
                 'title': 'Lecture', 'seconds': 1800}]):
            rows = _attendance({'id': 12, 'email': 'learner@example.test'})
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['source_ref'], rows[0]['actual_hours']), ('attendance:occ-1', 2))

    def test_cancelled_occurrence_stays_excluded_even_with_confirmation(self):
        from .tests_attendance_lectures import register_row
        record = register_row(source='microsoft-teams', session_id='occ-1')
        with patch('learner_api.attendance_lectures.combined_attendance_rows', return_value=[record]), \
             patch('learner_api.attendance_lectures.read_native_occurrences', return_value=[]), \
             patch.object(confirmation, 'read_confirmations', return_value={self.lecture['id']: {'seconds': 7200}}):
            self.assertEqual(lecture_register(self.source), [])
