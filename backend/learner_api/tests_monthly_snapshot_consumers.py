"""Monthly screen contracts using synthetic snapshots; no external services."""
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from learner_api import dashboard_tabs, monthly_actuals
from coach_api import monthly_logs, monthly_focus, otjh_ksb


class MonthlySnapshotConsumerTests(SimpleTestCase):
    def setUp(self):
        self.owner = {'id': 70, 'enrolment_id': 7, 'programme_id': 'P', 'end_date': '2027-01-31'}
        def month(actual, target):
            return dict(actual_hours=actual, training_plan_target=target, row_count=3,
                        not_accepted_hours=1.5, submitted_hours=1, verification_hours=.5)
        self.saved = {'months': {'2026-10': month(2.5, 10), '2026-11': month(0, 20),
                                 '2027-01': month(0, 10)},
                      'training_plan_totals': {'accepted_hours': 2.5, 'planned_hours': 40},
                      'unallocated_activities': []}
        self.targets = {key: value['training_plan_target'] for key, value in self.saved['months'].items()}
        self.read = self.enterContext(patch.object(monthly_actuals, 'snapshot', return_value=self.saved))
        self.refresh = self.enterContext(patch.object(monthly_actuals, 'refresh', side_effect=AssertionError('No request-side refresh')))

    def test_no_verified_owner_never_reads_storage(self):
        self.assertIsNone(monthly_actuals.monthly_snapshot({}))
        self.read.assert_not_called()

    def test_target_selection_change_rejects_mixed_generation(self):
        self.assertIsNone(monthly_actuals.monthly_snapshot(self.owner, targets={'2026-10': 99}))
        self.assertIs(monthly_actuals.monthly_snapshot(self.owner, targets=self.targets), self.saved)

    def test_dashboard_chart_uses_cached_months_without_readding_attendance(self):
        before = deepcopy(self.saved)
        with patch.object(dashboard_tabs.canonical, 'metrics_from_records', side_effect=AssertionError('No aggregation')):
            result = dashboard_tabs.monthly_hours(self.owner, object(), self.targets,
                current_month='2026-11', signed_months=['2026-09'], attendance=object())
        self.assertEqual([row['month'] for row in result['months']], ['2026-09','2026-10','2026-11'])
        self.assertEqual(result['months'][1], {'month':'2026-10','actual_hours':2.5,
            'not_accepted_hours':1.5,'submitted_hours':1,'verification_hours':.5,'training_plan_target':10})
        self.assertEqual(result['months'][2]['actual_hours'], 0)
        self.assertIsNone(result['months'][0]['training_plan_target'])
        self.assertEqual(result['training_plan_totals'], self.saved['training_plan_totals'])
        self.assertEqual(self.saved, before)
        self.refresh.assert_not_called()

    def test_dashboard_cache_miss_preserves_live_hours_instead_of_zero(self):
        self.read.return_value = None
        records = [{'id': 1, 'accepted': True, 'actual_seconds': 3600, 'reporting_month': '2026-10'},
                   {'id': 2, 'accepted': False, 'actual_seconds': 900, 'reporting_month': '2026-10'}]
        with patch.object(dashboard_tabs.canonical, 'metrics_from_records', return_value={'otjh':{'actual':1,'planned':10}}):
            result = dashboard_tabs.monthly_hours(self.owner, records, {'2026-10':10}, current_month='2026-10')
        self.assertEqual(result['months'][0]['actual_hours'], 1)
        self.assertEqual(result['months'][0]['not_accepted_hours'], .25)
        self.refresh.assert_not_called()

    def test_coach_year_uses_stored_activity_counts_and_keeps_unallocated_evidence(self):
        self.saved['unallocated_activities'] = [{'id': 2, 'title': 'Synthetic evidence', 'actual_hours': 0}]
        with patch.object(monthly_logs, 'query', side_effect=AssertionError('No activity query')), \
             patch.object(monthly_logs, 'pending_hour_records', side_effect=AssertionError('No pending query')):
            rows = monthly_logs.year_activities(self.owner)
        self.assertEqual(rows[0], {'month':'2026-10','activities':3,'accepted_hours':2.5})
        self.assertEqual(rows[-1]['unallocated_activities'], self.saved['unallocated_activities'])
        self.assertEqual(sum(row['accepted_hours'] for row in rows), 2.5)

    def test_unallocated_time_with_unknown_acceptance_keeps_full_canonical_path(self):
        self.saved['unallocated_activities'] = [{'id':2,'actual_hours':1}]
        self.assertIsNone(monthly_actuals.allocated_months(self.owner))

    def test_coach_otjh_keeps_accepted_and_unaccepted_separate(self):
        with patch.object(otjh_ksb.canonical, 'query', side_effect=AssertionError('No activity query')), \
             patch.object(otjh_ksb, 'pending_hour_records', side_effect=AssertionError('No pending query')):
            rows = otjh_ksb.read_hour_totals(self.owner)
        self.assertEqual(rows[0], {'month':'2026-10','completed':2.5,'submitted':1.5})
        self.assertEqual(rows[1]['completed'], 0)

    def test_monthly_focus_reads_stored_month_without_loading_progress(self):
        context = SimpleNamespace(source=SimpleNamespace(pk=7), profile=SimpleNamespace(lifecycle_status='active'))
        with patch.object(monthly_focus.canonical_learning, 'require_profile', return_value=self.owner), \
             patch.object(monthly_focus.canonical_learning, 'targets_for', return_value={'2026-10':10}), \
             patch.object(monthly_focus.canonical_learning, 'entries_for', side_effect=AssertionError('No activity query')), \
             patch.object(monthly_focus, 'read_monthly', side_effect=AssertionError('No dashboard aggregation')), \
             patch.object(monthly_focus.django_timezone, 'localdate', return_value=date(2026, 11, 25)), \
             patch.object(monthly_focus, 'read_month_activities', return_value=([], [])), \
             patch.object(monthly_focus, 'read_month_lectures', return_value=[]), \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=[]):
            result = monthly_focus.read_monthly_focus(context, '2026-10')
        self.assertEqual(result['summary']['achievedHours'], 2.5)
        self.assertEqual(result['summary']['requiredHours'], 10)

    def test_monthly_focus_future_or_missing_month_uses_shared_dashboard_fallback(self):
        context = SimpleNamespace(source=SimpleNamespace(pk=7), kind='commercial', request=object(),
                                  profile=SimpleNamespace(lifecycle_status='active'))
        for month in ('2026-09', '2027-01'):
            with self.subTest(month=month), \
                 patch.object(monthly_focus.canonical_learning, 'require_profile', return_value=self.owner), \
                 patch.object(monthly_focus, 'read_monthly', return_value={
                     'summary': {'requiredHours': 12, 'achievedHours': 0}}) as shared, \
                 patch.object(monthly_focus.django_timezone, 'localdate', return_value=date(2026, 11, 25)), \
                 patch.object(monthly_focus, 'read_month_activities', return_value=([], [])), \
                 patch.object(monthly_focus, 'read_month_lectures', return_value=[]), \
                 patch('learner_api.calendar.coaching_events_for_learner', return_value=[]):
                result = monthly_focus.read_monthly_focus(context, month)
            self.assertEqual(result['summary']['requiredHours'], 12)
            self.assertEqual(result['summary']['achievedHours'], 0)
            shared.assert_called_once_with(context.source, context.kind, self.owner, context.profile, context.request)
        self.refresh.assert_not_called()

    def test_monthly_board_uses_the_same_cached_accepted_total_for_both_contracts(self):
        from .test_dashboard_monthly_no_db import MonthlyProjectionTests
        fixture = MonthlyProjectionTests().fixture
        # The board still needs activity records to render its content; those
        # records must not cause a second addition to the saved actual total.
        self.saved['months'] = {'2026-10': {**self.saved['months']['2026-10'], 'training_plan_target':50}}
        for version in ('', '&version=2'):
            with self.subTest(version=version):
                result, *_ = fixture('?month=2026-10'+version, records=[
                    {'accepted':True,'reporting_month':'2026-10','actual_seconds':9000}],
                    attendance_hours=[{'accepted':True,'reporting_month':'2026-10','actual_hours':7.5}])
                self.assertEqual(result['summary']['achievedHours'], '2.5 hrs' if version else 2.5)
