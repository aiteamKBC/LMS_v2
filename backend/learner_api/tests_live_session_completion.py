"""Verified attendance completes only its assigned component, once, without new hours."""
import copy
import json
from contextlib import nullcontext
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from .active_users import completed_hours_value_from_progress
from .live_session_completion import complete_attended_live_sessions
from . import teams_attendance


def attendance(**overrides):
    return {
        'learner_profile_id': 31, 'enrolment_id': 7,
        'attendance_status': 'present', 'raw_attendance_status': 'present',
        'is_expected': True, 'attendance_report_id': 'REPORT-1',
        'occurrence_id': 'O1', 'session_id': 'O1', 'live_session_id': 'LIVE-1',
        'module_catalogue_id': 'M1', 'session_date': date(2026, 10, 14),
        'actual_start': datetime(2026, 10, 14, 9, tzinfo=timezone.utc),
        'actual_end': datetime(2026, 10, 14, 11, tzinfo=timezone.utc),
        'attended_seconds': 3600, **overrides,
    }


def component(**overrides):
    return {
        'id': 'C1', 'title': 'Live session', 'type': 'live_session',
        'module_catalogue_id': 'M1', 'settings': {'teamsOccurrenceId': 'O1'},
        'reflection_required': True, 'completed': False, **overrides,
    }


class LiveSessionCompletionTests(SimpleTestCase):
    def setUp(self):
        self.profiles = self.enterContext(patch('learner_api.live_session_completion.LearnerProfile.objects'))
        self.profile_query = (self.profiles.using.return_value.select_for_update.return_value
                              .filter.return_value.order_by.return_value.only)
        self.profile_query.return_value = [SimpleNamespace(pk=31, enrolment_id=7, learner_type='apprenticeship')]
        self.sources = self.enterContext(patch('learner_api.live_session_completion.EnrolmentUser.all_learners'))
        self.source_query = self.sources.using.return_value.filter.return_value.only.return_value.first
        self.source_query.return_value = SimpleNamespace(id=7)
        self.read = self.enterContext(patch('learner_api.live_session_completion.read_native_components'))
        self.state = self.enterContext(patch('learner_api.live_session_completion.component_reference_state', return_value=('active', '')))
        self.atomic = self.enterContext(patch('learner_api.live_session_completion.transaction.atomic', side_effect=lambda **_: nullcontext()))
        self.save = self.enterContext(patch('learner_api.live_session_completion.save_progress_record'))
        self.saved = []
        self.components = [component()]

        def read(source, module_refs):
            return [dict(copy.deepcopy(item), completed=any(
                learner == source.id and record['componentId'] == item['id']
                for learner, record in self.saved
            ) or item['completed']) for item in self.components], []

        self.read.side_effect = read
        self.save.side_effect = lambda learner, record, activity: self.saved.append((learner.enrolment_id, record))

    def test_attendance_is_sufficient_even_with_reflection_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.saved.clear()
                self.profile_query.return_value[0].learner_type = kind
                self.assertEqual(complete_attended_live_sessions([attendance()]), 1)
                learner_id, record = self.saved[0]
                self.assertEqual(learner_id, 7)
                self.assertEqual(record['componentId'], 'C1')
                self.assertEqual(record['kind'], 'component')
                self.assertEqual(record['submittedAt'], '2026-10-14T11:00:00+00:00')
                self.assertEqual(record['timeTrackingSource'], 'microsoft_teams_attendance')
                self.assertEqual(json.loads(record['timeTrackingCalculation']), {
                    'sourceRef': 'attendance:O1', 'attendanceReportId': 'REPORT-1', 'attendedSeconds': 3600,
                })
                self.assertEqual(completed_hours_value_from_progress([record]), 0)
        self.profiles.using.assert_called_with('enrolment')
        self.profiles.using.return_value.select_for_update.assert_called_with()

    def test_missing_reports_absence_recovery_and_unassigned_people_do_not_complete(self):
        for override in (
            {'attendance_status': 'absent'}, {'attendance_status': 'unmarked'},
            {'raw_attendance_status': 'absent', 'catchup_completed': True},
            {'is_expected': False}, {'attendance_report_id': ''}, {'actual_end': None},
            {'occurrence_id': ''}, {'enrolment_id': None}, {'learner_profile_id': None},
        ):
            with self.subTest(override=override):
                self.assertEqual(complete_attended_live_sessions([attendance(**override)]), 0)
        self.profiles.using.assert_not_called()
        self.save.assert_not_called()

    def test_repeated_rows_and_later_syncs_append_only_one_completion(self):
        self.assertEqual(complete_attended_live_sessions([attendance(), attendance()]), 1)
        self.assertEqual(complete_attended_live_sessions([attendance()]), 0)
        self.assertEqual(len(self.saved), 1)

    def test_a_previous_manual_completion_and_its_hours_are_preserved(self):
        old = {'kind': 'component', 'componentId': 'C1', 'reportedTime': '45 minutes', 'feedback': 'Existing reflection'}
        self.saved.append((7, old))
        self.assertEqual(complete_attended_live_sessions([attendance()]), 0)
        self.assertEqual(self.saved, [(7, old)])
        self.assertEqual(completed_hours_value_from_progress([old]), .75)
        self.save.assert_not_called()

    def test_only_the_same_occurrence_module_and_component_type_can_complete(self):
        self.components = [component(id='C2', settings={'teamsOccurrenceId': 'O2'}),
                           component(id='C3', module_catalogue_id='M2'),
                           component(id='C4', type='reading'), component()]
        self.assertEqual(complete_attended_live_sessions([attendance()]), 1)
        self.assertEqual([record['componentId'] for _, record in self.saved], ['C1'])
        self.assertEqual(self.read.call_args.kwargs['module_refs'], ['M1'])

    def test_series_match_requires_the_exact_date_and_never_guesses_ambiguous_components(self):
        self.components = [component(settings={'teamsLiveSessionId': 'LIVE-1', 'sessionDate': '2026-10-14'}),
                           component(id='C2', settings={'teamsLiveSessionId': 'LIVE-1', 'sessionDate': '2026-10-21'})]
        self.assertEqual(complete_attended_live_sessions([attendance()]), 1)
        self.assertEqual(self.saved[0][1]['componentId'], 'C1')
        self.saved.clear()
        self.components.append(component(id='DUPLICATE', settings={'teamsLiveSessionId': 'LIVE-1', 'sessionDate': '2026-10-14'}))
        self.assertEqual(complete_attended_live_sessions([attendance()]), 0)

    def test_reassignments_and_deleted_curriculum_do_not_receive_new_completions(self):
        self.components = []
        self.assertEqual(complete_attended_live_sessions([attendance()]), 0)
        self.components = [component()]
        for state in ('deleted', 'unknown'):
            with self.subTest(state=state):
                self.state.return_value = (state, 'module')
                self.assertEqual(complete_attended_live_sessions([attendance()]), 0)
        self.save.assert_not_called()

    def test_stale_learner_identity_cannot_complete_another_enrolment(self):
        self.assertEqual(complete_attended_live_sessions([attendance(enrolment_id=8)]), 0)
        self.read.assert_not_called()
        self.save.assert_not_called()

    def test_different_learners_get_their_own_completion_once(self):
        self.profile_query.return_value.append(SimpleNamespace(pk=32, enrolment_id=8))
        self.source_query.side_effect = [SimpleNamespace(id=7), SimpleNamespace(id=8)]
        self.assertEqual(complete_attended_live_sessions([
            attendance(), attendance(learner_profile_id=32, enrolment_id=8),
        ]), 2)
        self.assertEqual([learner for learner, _ in self.saved], [7, 8])

    def test_persistence_errors_propagate_so_the_synchronizer_can_retry(self):
        self.save.side_effect = DatabaseError('Cannot save completion')
        with self.assertRaisesMessage(DatabaseError, 'Cannot save completion'):
            complete_attended_live_sessions([attendance()])
        self.assertFalse(self.components[0]['completed'])

    def test_normal_report_sync_saves_completion_and_surfaces_persistence_failure(self):
        row = attendance()
        row.update({
            'learner_id': 31, 'learner_name': 'Example Learner', 'learner_email': 'learner@example.test',
            'session_title': 'Live session', 'session_type': 'live_session',
            'session_start_time': row['actual_start'].time(), 'session_end_time': row['actual_end'].time(),
            'minutes_late': 0, 'absence_reason': '', 'catchup_completed': False, 'coach_name': '',
            'module_title': 'Example module', 'group_id': 'G1', 'group_name': 'Example group',
            'eligibility_reason': 'module_assignment', 'source_record_id': 'PARTICIPANT-1',
            'scheduled_start': row['actual_start'], 'scheduled_end': row['actual_end'],
            'first_join_at': row['actual_start'], 'last_leave_at': row['actual_end'],
            'calculated_at': row['actual_end'], 'updated_at': row['actual_end'],
        })
        self.enterContext(patch.object(teams_attendance, 'connections', {'enrolment': MagicMock()}))
        self.enterContext(patch.object(teams_attendance.router, 'db_for_write', return_value='enrolment'))
        self.enterContext(patch.object(teams_attendance, 'fetch_verified_teams_attendance_rows', return_value=[row]))
        self.enterContext(patch.object(teams_attendance, '_verified_occurrence_ids', return_value=['O1']))
        register = self.enterContext(patch.object(teams_attendance, 'upsert_live_session_register'))
        points = self.enterContext(patch.object(teams_attendance, '_award_attendance_points'))

        self.assertEqual(teams_attendance.sync_verified_teams_attendance_reporting(module_refs=['M1']), 1)
        self.assertEqual(len(self.saved), 1)
        register.assert_called_once()
        points.assert_called_once_with([row])

        self.saved.clear()
        points.reset_mock()
        self.save.side_effect = DatabaseError('Cannot save completion')
        with self.assertRaisesMessage(DatabaseError, 'Cannot save completion'):
            teams_attendance.sync_verified_teams_attendance_reporting(module_refs=['M1'])
        points.assert_not_called()
