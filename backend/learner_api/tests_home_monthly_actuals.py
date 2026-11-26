"""Home and Monthly Logs share accepted programme hours, without write effects."""
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical, home_progress, monthly_actuals


class HomeMonthlyActualsTests(SimpleTestCase):
    def setUp(self):
        self.owner = {'id': 70, 'enrolment_id': 7, 'programme_id': 'P'}
        self.home = {'otjh': {'actual': 12, 'planned': 20, 'submitted': 1.25,
                             'percent': 60, 'missingPlannedActivities': 0},
                     'activities': {'completed': 4, 'total': 10},
                     'lectures': {'completed': 2, 'total': 3}}
        self.saved = {'training_plan_totals': {'accepted_hours': 7.5, 'planned_hours': 100}}
        self.snapshot = self.enterContext(patch.object(monthly_actuals, 'monthly_snapshot', return_value=self.saved))
        self.entries = self.enterContext(patch.object(canonical, 'entries_for', side_effect=AssertionError('Unexpected ledger read')))
        self.attendance = self.enterContext(patch('learner_api.monthly_log_attendance.read_rows', return_value=[]))
        self.refresh = self.enterContext(patch.object(monthly_actuals, 'refresh', side_effect=AssertionError('No request-side refresh')))

    def test_saved_total_preserves_plan_submitted_and_counts_without_source_reads(self):
        before = deepcopy(self.home)
        result = home_progress.apply_monthly_home_hours(self.home, self.owner)
        self.assertEqual(result, {**before, 'otjh': {**before['otjh'], 'actual': 7.5, 'percent': 37.5}})
        self.assertEqual(self.home, before)
        self.snapshot.assert_called_once_with(self.owner)
        self.entries.assert_not_called()
        self.attendance.assert_not_called()
        self.refresh.assert_not_called()

    def test_zero_is_valid_and_unknown_plan_stays_unknown(self):
        self.saved['training_plan_totals']['accepted_hours'] = 0
        self.home['otjh']['planned'] = None
        result = home_progress.apply_monthly_home_hours(self.home, self.owner)
        self.assertEqual((result['otjh']['actual'], result['otjh']['planned'], result['otjh']['percent']), (0, None, None))
        self.entries.assert_not_called()

    def test_invalidated_snapshot_reuses_ledger_and_deduplicates_attendance_by_occurrence(self):
        self.snapshot.return_value = None
        records = [
            {'id': 1, 'accepted': True, 'actual_seconds': 9000, 'attendance_occurrence_id': 'A'},
            {'id': 2, 'accepted': True, 'actual_seconds': 3600},
            {'id': 3, 'accepted': False, 'actual_seconds': 7200},
        ]
        before = deepcopy(records)
        self.attendance.return_value = [
            {'source_ref': 'attendance:A', 'actual_hours': 2.5},
            {'source_ref': 'attendance:B', 'actual_hours': 2.5},
        ]
        result = home_progress.apply_monthly_home_hours(self.home, self.owner, records=records)
        self.assertEqual(result['otjh']['actual'], 6)
        self.assertEqual(result['otjh']['percent'], 30)
        self.assertEqual(records, before)
        self.entries.assert_not_called()
        self.attendance.assert_called_once()
        self.refresh.assert_not_called()

    def test_fallback_loads_only_verified_owner_when_no_ledger_was_supplied(self):
        self.snapshot.return_value = None
        self.entries.side_effect = None
        self.entries.return_value = [{'accepted': True, 'actual_seconds': 712}]
        result = home_progress.apply_monthly_home_hours(self.home, self.owner)
        self.assertEqual(result['otjh']['actual'], round(712 / 3600, 4))
        self.entries.assert_called_once_with(self.owner, monthly_summary=True)

    def test_cache_miss_keeps_precomputed_canonical_hours_without_requery_or_top_up(self):
        self.snapshot.return_value = None
        before = deepcopy(self.home)
        metrics = {'otjh': {'completed_actual': 12, 'planned': 20}}
        self.attendance.return_value = [{'source_ref': 'attendance:A', 'actual_hours': 2.5}]
        result = home_progress.apply_monthly_home_hours(
            self.home, self.owner, records=[], canonical_metrics=metrics)
        self.assertEqual(result, before)
        self.entries.assert_not_called()
        self.attendance.assert_not_called()
        self.refresh.assert_not_called()

    def test_empty_supplied_ledger_is_not_reloaded_or_replaced_with_previous_total(self):
        self.snapshot.return_value = None
        result = home_progress.apply_monthly_home_hours(self.home, self.owner, records=[])
        self.assertEqual(result['otjh']['actual'], 0)
        self.entries.assert_not_called()

    def test_unknown_actual_without_snapshot_does_not_invent_zero(self):
        self.snapshot.return_value = None
        self.home['otjh'].update(actual=None, percent=None)
        result = home_progress.apply_monthly_home_hours(self.home, self.owner)
        self.assertIsNone(result['otjh']['actual'])
        self.entries.assert_not_called()
        self.attendance.assert_not_called()

    def test_projection_failure_remains_visible_without_fallback_write(self):
        self.snapshot.return_value = None
        self.attendance.side_effect = RuntimeError('unavailable')
        with self.assertRaisesRegex(RuntimeError, 'unavailable'):
            home_progress.apply_monthly_home_hours(self.home, self.owner, records=[])
        self.refresh.assert_not_called()

    def test_home_both_learner_types_use_snapshot_without_separate_live_credit_top_up(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                source = SimpleNamespace(pk=7, _canonical_profile=self.owner)
                metrics = {'otjh': {'actual': 12, 'planned': 20},
                           'programme': {'status': 'ready'}}
                with patch.object(home_progress, 'connections', {'enrolment': MagicMock()}), \
                     patch.object(home_progress, 'rows', return_value=[]), \
                     patch.object(home_progress, '_group_dates', return_value=(date(2026, 1, 1), None, 'learner')), \
                     patch.object(home_progress, 'lecture_register', return_value=[]), \
                     patch('learner_api.module_progress.canonical_module_progress', return_value=[{'completed': 2, 'total': 3}]), \
                     patch('learner_api.live_session_progress.read_live_credits', side_effect=AssertionError('No programme top-up')):
                    result = home_progress.read_home_progress(source, kind, [], [], [], [], date(2026, 11, 22),
                                                             canonical_metrics=metrics, canonical_records=[])
                self.assertEqual(result['otjh']['actual'], 7.5)
                self.assertEqual(result['otjh']['percent'], 37.5)
                self.assertEqual(result['activities'], {'completed': 2, 'total': 3})
                self.assertEqual(metrics['otjh']['actual'], 12)
