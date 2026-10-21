from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .attendance import _summarize_attendance
from .parallel_attendance import apply_parallel_attendance


class ParallelAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
        self.source = SimpleNamespace(id=12, email='learner@example.test')
        self.row = {
            'session_id': 'g1-session-1', 'occurrence_id': 'g1-session-1',
            'source': 'microsoft-teams', 'module_catalogue_id': 'module-g1',
            'session_number': 1, 'session_date': (self.now - timedelta(days=14)).date(),
            'scheduled_start': self.now - timedelta(days=14, hours=1),
            'scheduled_end': self.now - timedelta(days=14),
            'attendance_status': 'absent', 'learner_email': self.source.email,
            'minutes_late': 0, 'catchup_completed': False, 'updated_at': None,
        }
        self.alternatives = {'g1-session-1': [{'id': 'g2-session-1'}]}
        self.evidence = {
            'occurrence_id': 'g2-session-1', 'learner_email': self.source.email,
            'attendance_status': 'present', 'attendance_report_id': 'report-2',
            'enrolment_id': 12,
        }

    def project(self, rows=None, evidence=None, records=(), alternatives=None):
        return apply_parallel_attendance(
            rows if rows is not None else [self.row], self.source,
            alternatives=self.alternatives if alternatives is None else alternatives,
            evidence=[self.evidence] if evidence is None else evidence,
            records=records, now=self.now,
        )

    def test_verified_alternative_counts_once_and_preserves_original_evidence(self):
        original = deepcopy(self.row)
        rows = self.project()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['attendance_status'], 'absent')
        self.assertEqual(rows[0]['effective_attendance'], 1)
        self.assertEqual(rows[0]['recovery_occurrence_id'], 'g2-session-1')
        self.assertEqual(rows[0]['session_id'], original['session_id'])
        self.assertEqual(self.row, original)
        summary = _summarize_attendance(rows, now=self.now, overview_only=True)
        self.assertEqual(summary, {'present': 1, 'sessions': 1})

    def test_case_file_reason_names_the_attended_group_and_is_searchable(self):
        from coach_api.attendance_projection import project_register
        rows = self.project(alternatives={
            'g1-session-1': [{'id': 'g2-session-1', 'group': 'G2', 'dateIso': '2026-10-08'}],
        })
        result = project_register(rows, {'search': 'G2'}, now=self.now)
        self.assertEqual(result['pagination']['total'], 1)
        self.assertEqual(result['sessions'][0]['reason'], 'Attended with group G2 on 08 Oct 2026')
        self.assertEqual(result['sessions'][0]['date'], '2026-10-06')
        self.assertEqual(result['sessions'][0]['status'], 'present')
        self.assertEqual(result['summary']['sessions'], 1)

    def test_reason_uses_date_of_attended_alternative_not_an_unattended_option(self):
        alternatives = {'g1-session-1': [
            {'id': 'g3-session-1', 'group': 'G3', 'dateIso': '2026-10-09'},
            {'id': 'g2-session-1', 'group': 'G2', 'dateIso': '2026-10-08'},
        ]}
        self.assertEqual(self.project(alternatives=alternatives)[0]['absence_reason'],
                         'Attended with group G2 on 08 Oct 2026')

    def test_group_reason_preserves_existing_reason_and_handles_missing_group_name(self):
        original = {**self.row, 'absence_reason': 'Previously reported absence'}
        row = self.project(rows=[original])[0]
        self.assertEqual(row['absence_reason'], 'Previously reported absence; Attended with another group')
        self.assertEqual(original['absence_reason'], 'Previously reported absence')

    def test_reason_is_not_added_without_verified_alternative_attendance(self):
        rows = self.project(evidence=[])
        self.assertNotIn('absence_reason', rows[0])

    def test_no_report_absence_or_another_learner_cannot_recover(self):
        for changes in (
            {'attendance_report_id': ''}, {'attendance_status': 'absent'},
            {'learner_email': 'other@example.test'}, {'occurrence_id': 'other-session'},
            {'enrolment_id': 99},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.project(evidence=[{**self.evidence, **changes}]), [self.row])

    def test_present_future_and_cancelled_originals_are_unchanged(self):
        for changes in (
            {'attendance_status': 'present'},
            {'scheduled_start': self.now + timedelta(days=1)},
            {'attendance_status': 'cancelled'},
            {'occurrence_status': 'cancelled'},
            {'effective_attendance': 1, 'effective_attendance_status': 'made_up'},
        ):
            row = {**self.row, **changes}
            with self.subTest(changes=changes):
                self.assertEqual(self.project(rows=[row]), [row])

    def test_saved_register_presence_counts_and_absence_overrides_teams(self):
        saved = {**self.evidence, 'source': 'live-register', 'attendance_report_id': ''}
        self.assertEqual(self.project(evidence=[], records=[saved])[0]['effective_attendance'], 1)
        saved['attendance_status'] = 'absent'
        self.assertEqual(self.project(records=[saved]), [self.row])

    def test_alternative_already_in_plan_is_not_counted_twice(self):
        other = {**self.row, 'session_id': 'g2-session-1', 'occurrence_id': 'g2-session-1',
                 'attendance_status': 'present'}
        self.assertEqual(self.project(rows=[self.row, other]), [self.row, other])

    def test_one_alternative_cannot_cover_two_originals(self):
        other = {**self.row, 'session_id': 'duplicate', 'occurrence_id': 'duplicate'}
        alternatives = {**self.alternatives, 'duplicate': [{'id': 'g2-session-1'}]}
        self.assertEqual(self.project(rows=[self.row, other], alternatives=alternatives), [self.row, other])

    def test_selected_session_cannot_reuse_another_assigned_delivery(self):
        alternatives = {'g1-session-1': [{'id': 'g2-session-1', 'moduleCatalogueId': 'module-g2'}]}
        with patch('learner_api.parallel_attendance.assigned_module_ids', return_value=['module-g1', 'module-g2']):
            self.assertEqual(self.project(alternatives=alternatives), [self.row])

    def test_selected_session_reads_saved_alternative_decision(self):
        saved = {**self.evidence, 'source': 'live-register', 'attendance_status': 'absent'}
        with patch('learner_api.parallel_attendance._live_register_rows', return_value=[saved]) as reader:
            self.assertEqual(self.project(), [self.row])
        reader.assert_called_once_with(self.source, occurrence_ids={'g2-session-1'})

    def test_second_alternative_still_only_recovers_one_original(self):
        alternatives = {'g1-session-1': [{'id': 'g2-session-1'}, {'id': 'g3-session-1'}]}
        rows = self.project(alternatives=alternatives, evidence=[
            self.evidence, {**self.evidence, 'occurrence_id': 'g3-session-1'},
        ])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['effective_attendance'], 1)

    def test_reader_scopes_evidence_to_matched_occurrences_and_learner(self):
        with patch('learner_api.parallel_attendance.completed_alternatives_by_occurrence',
                   return_value=self.alternatives) as matched, \
             patch('learner_api.parallel_attendance.fetch_verified_teams_attendance_rows',
                   return_value=[self.evidence]) as fetched:
            rows = apply_parallel_attendance([self.row], self.source, now=self.now)
        matched.assert_called_once_with({'g1-session-1'}, at=self.now)
        fetched.assert_called_once_with(
            learner_emails=[self.source.email], occurrence_ids=['g2-session-1'],
            parallel_delivery_guests={'g2-session-1': {self.source.email}},
        )
        self.assertEqual(rows[0]['effective_attendance'], 1)

    def test_canonical_register_exposes_credit_without_adding_the_guest_session(self):
        from .attendance_lectures import lecture_register
        with patch('learner_api.parallel_attendance.completed_alternatives_by_occurrence',
                   return_value=self.alternatives), \
             patch('learner_api.parallel_attendance.fetch_verified_teams_attendance_rows',
                   return_value=[self.evidence]), \
             patch('learner_api.attendance_confirmation.read_confirmations', return_value={}), \
             patch('learner_api.recorded_attendance.saved_delivery_mode', return_value='live'):
            rows = lecture_register(self.source, scheduled=[self.row], records=[], apply_adjustments=False)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['effective_attendance_status'], 'made_up')
        self.assertEqual(_summarize_attendance(rows, now=self.now, overview_only=True),
                         {'present': 1, 'sessions': 1})


class CompletedDeliveryMatchingTests(SimpleTestCase):
    def test_matches_completed_same_number_within_programme_and_cohort(self):
        from . import alternative_recovery as recovery
        now = datetime(2026, 10, 20, 12, tzinfo=timezone.utc)
        original_module = SimpleNamespace(
            module_catalogue_id='M1', title='Business', group_id='G1',
            programme_id='P1', cohort_id='C1', is_programme_deleted=False,
        )
        other_module = SimpleNamespace(
            module_catalogue_id='M2', title='Business copy', group_id='G2',
            programme_id='P1', cohort_id='C1', group_name='Group 2', cohort_name='Cohort',
            is_programme_deleted=False,
        )
        first = SimpleNamespace(id='S1', module_catalogue_id='M1', module_title='Business', status='active')
        second = SimpleNamespace(id='S2', module_catalogue_id='M2', module_title='Business', status='active')
        original = SimpleNamespace(id='O1', live_session_id='S1', session_number=1, status='active')
        target = SimpleNamespace(id='O2', live_session_id='S2', session_number=1, status='active',
                                 scheduled_start=now-timedelta(days=4), scheduled_end=now-timedelta(days=4, hours=-1))
        wrong_number = SimpleNamespace(**{**vars(target), 'id': 'O3', 'session_number': 2})
        cancelled = SimpleNamespace(**{**vars(target), 'id': 'O4', 'status': 'cancelled'})
        candidates = MagicMock()
        candidates.filter.return_value.order_by.return_value = [target, wrong_number, cancelled]
        modules = MagicMock()
        modules.filter.return_value.order_by.return_value = [original_module]
        modules.filter.return_value.exclude.return_value = [original_module, other_module]
        sessions = MagicMock()
        sessions.filter.side_effect = [[first], [first, second]]
        occurrences = MagicMock()
        occurrences.filter.side_effect = [[original], candidates]
        with patch.object(recovery.LiveSessionOccurrence.objects, 'using', return_value=occurrences), \
             patch.object(recovery.LiveSession.objects, 'using', return_value=sessions), \
             patch.object(recovery.ModuleAuthoringModule.objects, 'using', return_value=modules):
            result = recovery.completed_alternatives_by_occurrence(['O1'], at=now)
        self.assertEqual([row['id'] for row in result['O1']], ['O2'])
        self.assertEqual(result['O1'][0]['moduleCatalogueId'], 'M2')
        candidates.filter.assert_called_once_with(scheduled_end__lte=now)
        self.assertIn(
            {'programme_id': 'P1', 'cohort_id': 'C1', 'deleted_at__isnull': True, 'is_programme_deleted': False},
            [call.kwargs for call in modules.filter.call_args_list],
        )
