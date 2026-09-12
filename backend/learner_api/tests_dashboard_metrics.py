"""Database-free regression tests: imported baselines and later LMS progress."""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory

from .dashboard_metrics import programme_totals, ksb_totals, read_planned_hours, learner_metrics
from .student_activity import _direct_progress_otjh
from .attendance import combined_attendance_rows, _summarize_attendance


class DashboardMetricsTests(SimpleTestCase):
    def test_old_and_new_completions_union_by_exact_activity_identity(self):
        old = [{'group_id': 2, 'activity_id': 10, 'status': 'completed'},
               {'group_id': 2, 'activity_id': 11, 'status': 'notstarted'}]
        native = [{'id': 'imported'}, {'id': 'new'}]
        progress = [{'componentId': 'imported', 'kind': 'component'},
                    {'componentId': 'new', 'kind': 'quiz', 'passed': True}]
        result = programme_totals(old, native, progress, {('2', '11')}, {'imported': ('2', '10')})
        self.assertEqual((result['completed'], result['total'], result['percent']), (3, 3, 100))
        self.assertEqual(result['historicalCompleted'], 1)

    def test_failed_and_unfinished_quizzes_never_complete_components(self):
        native = [{'id': 'a'}, {'id': 'b'}, {'id': 'c', 'quiz_id': '9'}]
        progress = [{'componentId': 'a', 'kind': 'component', 'passed': False},
                    {'componentId': 'b', 'kind': 'quiz', 'passed': None},
                    {'quizId': 9, 'kind': 'quiz', 'passed': True}]
        result = programme_totals([], native, progress, set(), {})
        self.assertEqual((result['completed'], result['total']), (1, 3))

    def test_repeated_attempts_do_not_inflate_progress(self):
        result = programme_totals([], [{'id': 'a'}], [{'componentId': 'a', 'kind': 'video'}] * 3, set(), {})
        self.assertEqual((result['completed'], result['total']), (1, 1))

    def test_reading_with_quiz_requires_both(self):
        old = [{'group_id': 1, 'activity_id': 1, 'quiz_id': 9, 'reading_type': 'pdf',
                'quiz_passed': True, 'reading_viewed': False}]
        self.assertEqual(programme_totals(old, [], [], set(), {})['completed'], 0)

    def test_empty_programme_does_not_invent_a_percentage(self):
        self.assertIsNone(programme_totals([], [], [], set(), {})['percent'])

    def test_hour_added_to_accepted_ledger_once(self):
        progress = [{'componentId': 'a', 'kind': 'component', 'claimedSeconds': 3600,
                     'timeTrackingSource': 'component:input', 'expectedOtjh': 10}] * 2
        self.assertEqual(round(1171.34 + _direct_progress_otjh(progress), 2), 1172.34)

    def test_ksb_occurrences_count_again_in_another_component(self):
        native = [{'id': 'a', 'ksb_mappings': [{'code': 'K1'}, {'code': 'S1'}]},
                  {'id': 'b', 'ksb_mappings': [{'code': 'K1'}]}]
        result = ksb_totals(native, [{'componentId': 'a', 'kind': 'component'}])
        self.assertEqual((result['completed'], result['total'], result['percent']), (2, 3, 66.67))

    def test_missing_migrated_ksb_data_stays_unknown(self):
        result = ksb_totals([{'id': 'a', 'ksb_mappings': ['K1']}], [],
                            [{'group_id': 1, 'activity_id': 2, 'ksb_mappings': None}])
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['total'])
        self.assertEqual(result['mappedTotal'], 1)

    def test_historical_and_new_ksb_points_union_with_saved_attempts(self):
        old = [{'group_id': 1, 'activity_id': 2, 'ksb_mappings': ['K1', 'S1'], 'status': 'completed'},
               {'group_id': 1, 'activity_id': 3, 'ksb_mappings': ['K1']}]
        native = [{'id': 'same', 'ksb_mappings': ['K1', 'S1']}, {'id': 'new', 'ksb_mappings': ['B1']}]
        result = ksb_totals(native, [{'componentId': 'new'}], old, {('1', '3')}, {'same': ('1', '2')})
        self.assertEqual((result['completed'], result['total']), (4, 4))
        self.assertEqual(result['historicalCompleted'], 2)
        self.assertEqual(sum(item['total'] for item in result['codes']), 4)

    def test_ksb_completion_survives_repeated_failed_attempt(self):
        progress = [{'componentId': 'a', 'passed': True, 'kind': 'quiz'},
                    {'componentId': 'a', 'passed': False, 'kind': 'quiz'}]
        self.assertEqual(ksb_totals([{'id': 'a', 'ksb_mappings': ['K1']}], progress)['completed'], 1)

    def test_contract_snapshot_is_authoritative_and_can_be_zero(self):
        with patch('learner_api.dashboard_metrics.TrainingPlanDocument.objects') as manager, \
             patch('learner_api.dashboard_metrics.find_contract') as imported:
            query = manager.using.return_value.filter.return_value.order_by.return_value.values.return_value
            query.first.return_value = {'otjh': {'plannedTotal': 0}}
            self.assertEqual(read_planned_hours(SimpleNamespace(pk=125, aptem_id=92), 'commercial', MagicMock()), 0)
            imported.assert_not_called()

    def test_imported_contract_used_when_no_local_document(self):
        with patch('learner_api.dashboard_metrics.TrainingPlanDocument.objects') as manager, \
             patch('learner_api.dashboard_metrics.find_contract', return_value={'training_plan_planned_hours': 867}) as imported:
            manager.using.return_value.filter.return_value.order_by.return_value.values.return_value.first.return_value = None
            self.assertEqual(read_planned_hours(SimpleNamespace(pk=125, aptem_id=92), 'commercial', MagicMock()), 867)
            self.assertEqual(imported.call_args.args[1], 92)

    def test_new_learner_never_reads_imported_contract(self):
        with patch('learner_api.dashboard_metrics.TrainingPlanDocument.objects') as manager, \
             patch('learner_api.dashboard_metrics.find_contract') as imported:
            manager.using.return_value.filter.return_value.order_by.return_value.values.return_value.first.return_value = None
            self.assertIsNone(read_planned_hours(SimpleNamespace(pk=125, aptem_id=None), 'commercial', MagicMock()))
            imported.assert_not_called()

    def test_endpoint_scopes_identity_and_returns_retryable_error(self):
        source = SimpleNamespace(pk=125, aptem_id=92, email='test@example.com')
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.only.return_value.get.return_value = source
        with patch.dict('learner_api.dashboard_metrics.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.dashboard_metrics.read_metrics', side_effect=DatabaseError('offline')):
            response = learner_metrics.__wrapped__.__wrapped__(RequestFactory().get('/'), 'commercial', 125)
        self.assertEqual(response.status_code, 503)
        model.all_learners.only.return_value.get.assert_called_once_with(pk=125)
        self.assertNotIn('offline', response.content.decode())


class CombinedAttendanceTests(SimpleTestCase):
    def row(self, **changes):
        return {'learner_id': 1, 'enrolment_id': 125, 'learner_name': 'Test',
                'learner_email': 'test@example.com', 'session_date': date(2026, 9, 1),
                'session_id': 'one', 'attendance_status': 'present', 'minutes_late': 0,
                'catchup_completed': False, 'updated_at': None, **changes}

    def test_new_learner_uses_only_teams_and_excludes_other_enrolment(self):
        source = SimpleNamespace(id=125, aptem_id=None, email='test@example.com')
        with patch('learner_api.attendance.fetch_kbc_attendance_rows') as old, \
             patch('learner_api.attendance.fetch_verified_teams_attendance_rows', return_value=[
                 self.row(), self.row(enrolment_id=126)]):
            rows = combined_attendance_rows(source)
        old.assert_not_called()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['learner_id'], 125)

    def test_combines_counts_and_deduplicates_reconnects(self):
        source = SimpleNamespace(id=125, aptem_id=92, email='test@example.com')
        with patch('learner_api.attendance.fetch_kbc_attendance_rows', return_value=[self.row(attendance_status='absent')]), \
             patch('learner_api.attendance.fetch_verified_teams_attendance_rows', return_value=[self.row(), self.row()]):
            summary = _summarize_attendance(combined_attendance_rows(source))
        self.assertEqual((summary['sessions'], summary['present'], summary['attendanceRate']), (2, 1, 50))
        self.assertEqual(summary['source'], 'combined')

    def test_reads_updated_legacy_register_each_time(self):
        source = SimpleNamespace(id=125, aptem_id=92, email='test@example.com')
        with patch('learner_api.attendance.fetch_kbc_attendance_rows', side_effect=[[], [self.row()]]) as old, \
             patch('learner_api.attendance.fetch_verified_teams_attendance_rows', return_value=[]):
            self.assertEqual(len(combined_attendance_rows(source)), 0)
            self.assertEqual(len(combined_attendance_rows(source)), 1)
        self.assertEqual(old.call_count, 2)
