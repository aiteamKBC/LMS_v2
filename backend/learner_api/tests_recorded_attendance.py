"""Recorded delivery credit; synthetic data and mocked reads only."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch, MagicMock
import inspect
import json

from django.test import SimpleTestCase

from .recorded_attendance import apply_recorded_attendance, saved_delivery_mode
from .attendance_rules import attendance_outcome
from .attendance import _summarize_attendance
from .attendance_lectures import build_lectures, lecture_totals, lecture_register, _apply_coach_source_adjustments

NOW = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)


def lecture(identifier='OCC-1', **changes):
    return dict(source='microsoft-teams', session_id=identifier, occurrence_id=identifier,
        session_title='Synthetic lecture', session_type='live_session', module_catalogue_id='MOD-TEST',
        module_title='Synthetic module', learner_id=7, learner_email='learner@example.test', learner_name='Learner',
        scheduled_start=NOW-timedelta(days=1, hours=1), scheduled_end=NOW-timedelta(days=1),
        session_date=(NOW-timedelta(days=1)).date(), session_start_time=None, session_end_time=None,
        attendance_status='absent', minutes_late=0, catchup_completed=False, updated_at=None) | changes


class RecordedAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(id=7, learner_type='commercial', attendance_type=None)

    def apply(self, rows, **kwargs):
        return apply_recorded_attendance(rows, self.source, now=NOW, **kwargs)

    def test_live_mode_recording_recovery_does_not_erase_absence(self):
        row = lecture(recovery_method='recorded')
        with patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='live'), \
             patch('curriculum_api.recording_views.fully_watched_occurrences') as watch:
            result = self.apply([row])
        watch.assert_not_called()
        self.assertEqual(attendance_outcome(result[0], NOW), ('absent', True))
        self.assertEqual(result, [row])

    def test_users_mode_not_contract_controls_credit_for_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), \
                 patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='lazy') as mode, \
                 patch('curriculum_api.recording_views.fully_watched_occurrences', return_value={'OCC-1'}) as watch:
                self.source.learner_type = kind
                result = self.apply([lecture()])[0]
                mode.assert_called_once_with(7)
                watch.assert_called_once_with(kind, 7, {'OCC-1'})
                self.assertEqual(attendance_outcome(result, NOW), ('present', True))
                self.assertEqual(result['attendance_status'], 'absent')
                self.assertEqual(result['raw_attendance_status'], 'absent')
                self.assertEqual(result['final_outcome'], 'recorded')
                self.assertFalse(result['catchup_completed'])

    def test_pending_recording_excluded_even_after_complete_absence_report(self):
        for status in ('absent', 'unmarked', 'review', 'pending'):
            with self.subTest(status=status):
                row = lecture(attendance_status=status, effective_attendance=0)
                result = self.apply([row], mode='lazy', watched=set())[0]
                self.assertEqual(attendance_outcome(result, NOW), ('awaiting_recording', False))
                self.assertIsNone(_summarize_attendance([result], now=NOW))
                self.assertEqual(result['raw_attendance_status'], status)

    def test_live_presence_and_recording_count_once(self):
        present = lecture(attendance_status='present', effective_attendance=1)
        with patch('curriculum_api.recording_views.fully_watched_occurrences') as watch:
            result = self.apply([present], mode='lazy')
        watch.assert_not_called()
        summary = _summarize_attendance(result, now=NOW)
        self.assertEqual((summary['present'], summary['sessions']), (1, 1))

    def test_pending_does_not_dilute_percentage_and_watched_counts_once(self):
        result = self.apply([lecture(), lecture('OCC-2'), lecture('OCC-3', attendance_status='present')],
                            mode='lazy', watched={'OCC-1'})
        summary = _summarize_attendance(result, now=NOW)
        self.assertEqual((summary['present'], summary['absent'], summary['sessions'], summary['attendanceRate']), (2, 0, 2, 100))
        lectures = build_lectures(result, {}, [], [], 'commercial', 7)
        self.assertEqual(lecture_totals(lectures)['attended'], 2)
        self.assertEqual(lecture_totals(lectures)['covered'], 0)
        self.assertEqual(next(r for r in lectures if r['sessionId']=='teams:OCC-1')['attendanceBasis'], 'recorded')

    def test_shared_module_uses_source_occurrence_not_projected_id(self):
        row = lecture('OCC-1:SHARED', attendance_source_occurrence_id='OCC-1')
        with patch('curriculum_api.recording_views.fully_watched_occurrences', return_value={'OCC-1'}) as watch:
            result = self.apply([row], mode='lazy')[0]
        watch.assert_called_once_with('commercial', 7, {'OCC-1'})
        self.assertEqual(result['effective_attendance'], 1)
        self.assertEqual(result['session_id'], 'OCC-1:SHARED')

    def test_future_active_cancelled_and_legacy_rows_are_unchanged(self):
        rows = [lecture('FUTURE', scheduled_start=NOW+timedelta(days=1), scheduled_end=NOW+timedelta(days=1,hours=1)),
                lecture('ACTIVE', scheduled_start=NOW-timedelta(minutes=1), scheduled_end=NOW+timedelta(minutes=1)),
                lecture('CANCELLED', occurrence_status='cancelled'), lecture('LEGACY', source='kbc-attendance')]
        with patch('curriculum_api.recording_views.fully_watched_occurrences') as watch:
            self.assertEqual(self.apply(rows, mode='lazy'), rows)
        watch.assert_not_called()

    def test_coach_correction_remains_authoritative(self):
        recorded = self.apply([lecture()], mode='lazy', watched={'OCC-1'})
        adjustment = SimpleNamespace(is_deleted=False,session_date=None,module_name='',session_title='',status='absent',updated_at=NOW)
        result = _apply_coach_source_adjustments(recorded, 2, adjustments={('microsoft-teams','OCC-1'):adjustment})[0]
        self.assertEqual(attendance_outcome(result, NOW), ('absent', True))
        self.assertNotIn('attendance_basis', result)

    def test_saved_mode_uses_active_value_not_pending_request(self):
        cursor = MagicMock()
        db = MagicMock()
        db.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
        for value, expected in [(('live',), 'live'), (('lazy',), 'lazy'), (None,'live')]:
            with self.subTest(value=value), patch('django.db.connections', db), patch('learner_api.attendance_mode._ready', return_value=True):
                cursor.fetchone.return_value = value
                self.assertEqual(saved_delivery_mode(7), expected)
                self.assertEqual(cursor.execute.call_args.args[1], [7])

    def test_canonical_register_applies_delivery_before_coach_adjustments(self):
        with patch('learner_api.attendance_confirmation.read_confirmations',return_value={}), \
             patch('learner_api.recorded_attendance.saved_delivery_mode',return_value='lazy'), \
             patch('curriculum_api.recording_views.fully_watched_occurrences',return_value={'OCC-1'}), \
             patch('learner_api.attendance_lectures._completed_catchup_occurrences',return_value=set()), \
             patch('learner_api.attendance_lectures._apply_coach_source_adjustments',side_effect=lambda rows,*a,**kw:rows):
            result = lecture_register(self.source, records=[], scheduled=[lecture()], learner_profile_id=2)
        self.assertEqual(result[0]['final_outcome'],'recorded')

    def test_session_response_keeps_raw_absence_and_uses_the_same_recording_rule(self):
        from curriculum_api.session_results import learner_results
        self.source.email = 'learner@example.test'
        for mode, watched, expected in [('lazy', set(), 'awaiting_recording'), ('lazy', {'OCC-1'}, 'recorded'), ('live', {'OCC-1'}, None)]:
            with self.subTest(mode=mode, watched=watched):
                sessions = [{'id':'OCC-1', 'startsAt':NOW-timedelta(days=1,hours=1), 'endsAt':NOW-timedelta(days=1),
                    'state':'completed', 'reportReady':True,
                    'attendance':[{'email':self.source.email, 'status':'absent','rawStatus':'absent',
                                   'attendance':0, 'effectiveAttendance':0, 'finalOutcome':'absent'}]}]
                with patch('curriculum_api.session_results.learner_series',return_value=(self.source,{'id':'SERIES'})), \
                     patch('curriculum_api.session_results.result_rows',return_value=sessions), \
                     patch('learner_api.recorded_attendance.saved_delivery_mode',return_value=mode), \
                     patch('curriculum_api.recording_views.fully_watched_occurrences',return_value=watched):
                    response = inspect.unwrap(learner_results)(None,'commercial',7,'SERIES',1)
                result = json.loads(response.content)['sessions'][0]
                self.assertEqual(result['attendanceMode'],mode)
                self.assertEqual(result.get('learningOutcome'),expected)
                self.assertEqual(result['attendance'][0]['rawStatus'],'absent')
