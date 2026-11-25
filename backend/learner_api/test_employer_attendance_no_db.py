"""Employer delivery totals from synthetic register and saved recording evidence."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .employer_attendance import project_attendance, read_attendance, read_plan_session_target

NOW = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)


def lecture(identifier, status='absent', **changes):
    return {
        'source': 'microsoft-teams', 'session_id': identifier, 'occurrence_id': identifier,
        'learner_id': 7, 'learner_email': 'learner@example.test', 'learner_name': 'Example learner',
        'session_date': (NOW - timedelta(days=1)).date(), 'attendance_status': status,
        'minutes_late': 0, 'catchup_completed': False, 'updated_at': None,
        **changes,
    }


def recording(completed=False, **changes):
    return {'ready': True, 'completed': completed, **changes}


class EmployerAttendanceTests(SimpleTestCase):
    def project(self, rows, evidence=None, mode='live', target=10):
        return project_attendance(rows, recordings=evidence or {}, session_target=target, mode=mode, now=NOW)

    def test_live_keeps_late_and_completed_catchup_without_counting_unmarked(self):
        result = self.project([
            lecture('late', 'late'), lecture('missed'), lecture('unmarked', 'unmarked'),
            lecture('recovered', effective_attendance_status='present', catchup_completed=True),
        ])
        self.assertEqual(result, {'sessions': 10, 'present': 2, 'absent': 1, 'late': 1, 'attendanceRate': 20})

    def test_recorded_only_counts_completed_against_plan_not_available_recordings(self):
        rows = [lecture(str(i)) for i in range(8)]
        evidence = {str(i): recording(i < 5) for i in range(8)}
        result = self.project(rows, evidence, mode='lazy', target=20)
        self.assertEqual((result['mode'], result['present'], result['sessions'], result['attendanceRate']),
                         ('recorded', 5, 20, 25))
        self.assertEqual(result['recordedTotal'], 8)
        self.assertEqual((result['livePresent'], result['recordedPresent']), (0, 5))

    def test_mixed_six_live_plus_two_recorded_is_eight_of_ten(self):
        rows = [lecture(str(i), 'present' if i < 6 else 'absent') for i in range(10)]
        evidence = {str(i): recording(i in (6, 7)) for i in range(10)}
        result = self.project(rows, evidence)
        self.assertEqual((result['mode'], result['sessions'], result['present'], result['attendanceRate']),
                         ('mixed', 10, 8, 80))
        self.assertEqual((result['livePresent'], result['recordedPresent']), (6, 2))

    def test_live_and_recording_of_the_same_session_never_count_twice(self):
        rows = [lecture('one', 'present'), lecture('one', 'present'), lecture('two')]
        result = self.project(rows, {'one': recording(True), 'two': recording()})
        self.assertEqual((result['sessions'], result['present'], result['attendanceRate']), (10, 1, 10))
        self.assertEqual((result['livePresent'], result['recordedPresent']), (1, 0))

    def test_shared_occurrences_use_source_identity_and_never_match_titles(self):
        rows = [lecture('shared-a', attendance_source_occurrence_id='original'),
                lecture('shared-b', attendance_source_occurrence_id='original'), lecture('other')]
        result = self.project(rows, {'original': recording(True), 'other': recording()})
        self.assertEqual((result['present'], result['sessions']), (1, 10))

    def test_lazy_with_no_watched_recordings_shows_zero_instead_of_missing(self):
        result = self.project([lecture('one')], {'one': recording()}, mode='lazy')
        self.assertEqual((result['mode'], result['present'], result['sessions'], result['attendanceRate']),
                         ('recorded', 0, 10, 0))

    def test_live_attendance_alone_keeps_existing_totals_even_after_a_delivery_preference_change(self):
        rows = [lecture('one', 'present'), lecture('two')]
        self.assertEqual(self.project(rows, {'one': recording(), 'two': recording()}, mode='lazy'),
                         {'sessions': 10, 'present': 1, 'absent': 1, 'late': 0, 'attendanceRate': 10})

    def test_ready_unmarked_recording_is_counted_but_unknown_live_outcomes_are_not(self):
        rows = [lecture('one', 'present'), lecture('two', 'unmarked'), lecture('unknown', 'unmarked')]
        result = self.project(rows, {'two': recording(True)})
        self.assertEqual((result['sessions'], result['present']), (10, 2))

    def test_recorded_register_outcome_counts_without_changing_raw_evidence(self):
        rows = [lecture('one', effective_attendance=1, effective_attendance_status='recorded',
                        attendance_basis='recorded', final_outcome='recorded')]
        original = deepcopy(rows)
        result = self.project(rows)
        self.assertEqual((result['mode'], result['recordedPresent']), ('recorded', 1))
        self.assertEqual(rows, original)

    def test_future_active_cancelled_pending_and_unowned_evidence_cannot_add_credit(self):
        rows = [lecture('past'), lecture('future', session_date=(NOW + timedelta(days=1)).date()),
                lecture('active', scheduled_start=NOW-timedelta(minutes=5), scheduled_end=NOW+timedelta(minutes=5)),
                lecture('cancelled', occurrence_status='cancelled'), lecture('pending')]
        evidence = {key: recording(True) for key in ('past', 'future', 'active', 'cancelled', 'unowned')}
        evidence['pending'] = recording(True, ready=False)
        result = self.project(rows, evidence, mode='lazy')
        self.assertEqual((result['present'], result['sessions']), (1, 10))

    def test_future_completion_does_not_count_and_future_availability_is_excluded(self):
        result = self.project([lecture('one'), lecture('two')], {
            'one': recording(True, completedAt=NOW+timedelta(days=1)),
            'two': recording(True, availableAt=NOW+timedelta(days=1)),
        }, mode='lazy')
        self.assertEqual((result['present'], result['sessions']), (0, 10))

    def test_no_register_stays_unavailable(self):
        self.assertIsNone(self.project([], {'unowned': recording(True)}, mode='lazy'))

    def test_recorded_delivery_with_no_playable_recordings_stays_unavailable(self):
        self.assertIsNone(self.project([lecture('one')], {'one': recording(ready=False)}, mode='lazy'))

    def test_reader_scopes_recording_evidence_to_kind_learner_and_past_occurrences(self):
        rows = [lecture('shared', attendance_source_occurrence_id='original'),
                lecture('future', session_date=(NOW+timedelta(days=1)).date())]
        with patch('learner_api.employer_attendance.timezone.now', return_value=NOW), \
                patch('learner_api.employer_attendance.read_plan_session_target', return_value=24) as target, \
                patch('learner_api.attendance_lectures.lecture_register', return_value=rows), \
                patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='lazy'), \
                patch('curriculum_api.recording_views.recording_completion_evidence',
                      return_value={'original': recording(True)}) as evidence:
            for kind in ('commercial', 'apprenticeship'):
                source = SimpleNamespace(pk=7, id=7)
                result = read_attendance(source, kind)
                target.assert_called_with(source)
                evidence.assert_called_with(kind, 7, {'original'})
                self.assertEqual(result['recordedPresent'], 1)
                self.assertEqual((result['sessions'], result['attendanceRate']), (24, 4.17))

    def test_legacy_attendance_and_new_recordings_never_increase_the_plan_target(self):
        rows = [lecture('legacy', 'present', source='kbc-attendance')]
        rows += [lecture(str(i)) for i in range(7)]
        result = self.project(rows, {str(i): recording(i < 3) for i in range(7)}, target=40)
        self.assertEqual((result['sessions'], result['present'], result['attendanceRate']), (40, 4, 10))
        self.assertEqual((result['livePresent'], result['recordedPresent']), (1, 3))
        self.assertEqual(result['absent'], 4)  # Future plan slots never become absences.

    def test_current_target_changes_without_changing_historical_evidence(self):
        rows = [lecture('live', 'present'), lecture('recorded')]
        evidence = {'recorded': recording(True)}
        original = deepcopy((rows, evidence))
        self.assertEqual(self.project(rows, evidence, target=10)['attendanceRate'], 20)
        self.assertEqual(self.project(rows, evidence, target=20)['attendanceRate'], 10)
        self.assertEqual((rows, evidence), original)

    def test_missing_or_zero_target_does_not_fall_back_to_evidence_counts(self):
        for target in (None, 0):
            self.assertIsNone(self.project([lecture('one', 'present')], target=target))

    def test_historical_credit_cannot_inflate_a_smaller_current_target(self):
        result = self.project([lecture('one', 'present'), lecture('two', 'present')], target=1)
        self.assertEqual((result['sessions'], result['present'], result['attendanceRate'], result['absent']),
                         (1, 2, 200, 0))


class PlanSessionTargetTests(SimpleTestCase):
    def test_current_assigned_modules_use_teaching_sessions_and_configured_fallback(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        source = SimpleNamespace(pk=7)
        with patch('learner_api.employer_attendance.connections', {'enrolment': connection}), \
                patch('learner_api.attendance_assignments.assigned_module_ids', return_value=['M1', 'M2', 'M1']) as ids, \
                patch('curriculum_api.learning_storage.read_sql', side_effect=lambda sql, db: sql), \
                patch('learner_api.training_plan_dashboard.rows', side_effect=[
                    [{'id': 'M1', 'sessions_number': 99}, {'id': 'M2', 'sessions_number': 12}],
                    [{'module_catalogue_id': 'M1', 'title': 'Teaching', 'sessions': 5},
                     {'module_catalogue_id': 'M1', 'title': 'Introduction', 'sessions': 2}],
                ]):
            self.assertEqual(read_plan_session_target(source), 17)
        ids.assert_called_once_with(source)
        self.assertEqual(cursor.execute.call_args_list[1].args[1], [['M1', 'M2']])

    def test_explicit_empty_plan_never_resurrects_historical_sessions(self):
        with patch('learner_api.attendance_assignments.assigned_module_ids', return_value=[]):
            self.assertIsNone(read_plan_session_target(SimpleNamespace(pk=7)))

    def test_no_configured_target_stays_unavailable(self):
        connection = MagicMock()
        with patch('learner_api.employer_attendance.connections', {'enrolment': connection}), \
                patch('learner_api.attendance_assignments.assigned_module_ids', return_value=['M1']), \
                patch('curriculum_api.learning_storage.read_sql', side_effect=lambda sql, db: sql), \
                patch('learner_api.training_plan_dashboard.rows', side_effect=[
                    [{'id': 'M1', 'sessions_number': None}], []]):
            self.assertIsNone(read_plan_session_target(SimpleNamespace(pk=7)))
