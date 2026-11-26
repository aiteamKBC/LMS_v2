"""Monthly snapshot contracts; isolated mocks, no database or external services."""
from copy import deepcopy
from datetime import datetime, timezone as utc
from types import SimpleNamespace
from unittest.mock import patch, Mock

from django.test import SimpleTestCase

from . import monthly_actuals as actuals, monthly_logs
from .management.commands.listen_monthly_actuals import consume, notification_ids


class MonthlyActualSnapshotTests(SimpleTestCase):
    def setUp(self):
        self.owner = {'id': 70, 'enrolment_id': 7, 'programme_id': 'P'}
        self.at = datetime(2026, 11, 21, tzinfo=utc.utc)
        self.values = dict(row_count=2, planned_hours=5, estimated_hours=0,
            not_accepted_hours=1, total_actual_hours=3, snapshot_digest='unchanged-digest',
            submitted_hours=1, verification_hours=0)
        self.meta = {'version': actuals.VERSION, 'complete': True, 'valid_until': None,
            'seconds': 7200, 'computed_at': self.at.isoformat(),
            'unallocated': {'standard': [], 'journal': []},
            'totals': {key: {'accepted_hours': 2, 'planned_hours': 9} for key in ('journal', 'standard')},
            'views': {key: dict(self.values) for key in ('journal', 'standard')}}
        self.target = dict(id=10, learner_id=70, report_month='2026-10', target_hours=9,
            actual_seconds_total=7200, actual_updated_at=self.at, actual_summary=self.meta)
        self.enterContext(patch.object(actuals, 'storage_available', return_value=True))
        self.read = self.enterContext(patch.object(actuals, 'selected_targets', return_value=[self.target]))

    def test_stored_seconds_are_read_without_loading_or_recalculating_activities(self):
        with patch.object(actuals.canonical, 'entries_for') as entries, patch.object(actuals, 'refresh') as refresh:
            result = actuals.snapshot(self.owner, now=self.at)
        self.assertEqual(result['months']['2026-10']['actual_hours'], 2)
        self.assertEqual(result['months']['2026-10']['training_plan_target'], 9)
        self.assertEqual(result['months']['2026-10']['snapshot_digest'], 'unchanged-digest')
        self.read.assert_called_once_with(self.owner)
        entries.assert_not_called()
        refresh.assert_not_called()

    def test_zero_is_initialised_but_null_is_not(self):
        self.target['actual_seconds_total'] = 0
        self.meta['seconds'] = 0
        self.assertEqual(actuals.snapshot(self.owner, now=self.at)['months']['2026-10']['actual_hours'], 0)
        self.target['actual_seconds_total'] = None
        self.assertIsNone(actuals.snapshot(self.owner, now=self.at))

    def test_independent_total_edit_does_not_reuse_stale_programme_totals(self):
        self.target['actual_seconds_total'] = 3600
        self.assertIsNone(actuals.snapshot(self.owner, now=self.at))

    def test_invalidated_or_incomplete_snapshots_fall_back_without_scheduling(self):
        with patch.object(actuals, 'refresh') as refresh:
            for meta in (None, {}, {**self.meta, 'version': 0}, {**self.meta, 'complete': False},
                         {**self.meta, 'views': {}}):
                with self.subTest(meta=meta):
                    self.target['actual_summary'] = meta
                    self.assertIsNone(actuals.snapshot(self.owner, now=self.at))
        refresh.assert_not_called()

    def test_expired_attendance_is_a_read_miss_and_never_a_timer(self):
        self.meta['valid_until'] = self.at.isoformat()
        self.assertIsNone(actuals.snapshot(self.owner, now=self.at))
        self.meta['valid_until'] = self.at.replace(hour=1).isoformat()
        self.assertIsNotNone(actuals.snapshot(self.owner, now=self.at))

    def test_mixed_projection_generations_are_not_combined(self):
        second = {**deepcopy(self.target), 'id': 11, 'report_month': '2026-11',
                  'actual_updated_at': self.at.replace(hour=1)}
        self.read.return_value = [self.target, second]
        self.assertIsNone(actuals.snapshot(self.owner, now=self.at))

    def test_unallocated_activity_is_preserved_once_without_guessing_a_month(self):
        item = {'id': 9, 'title': 'Synthetic unallocated activity', 'actual_hours': 1,
                'actual_hours_recorded': True}
        self.meta['unallocated']['standard'] = [item]
        with actuals._perspective(False):
            result = actuals.snapshot(self.owner, now=self.at)
        self.assertEqual(result['unallocated_activities'], [item])
        self.assertEqual(list(result['months']), ['2026-10'])

    def test_reporting_perspectives_keep_their_own_planned_values(self):
        self.meta['views']['journal']['planned_hours'] = 7
        with actuals._perspective(False):
            self.assertEqual(actuals.snapshot(self.owner, now=self.at)['months']['2026-10']['planned_hours'], 5)
        with actuals._perspective(True):
            self.assertEqual(actuals.snapshot(self.owner, now=self.at)['months']['2026-10']['planned_hours'], 7)

    def test_unmigrated_schema_does_not_read_new_columns(self):
        with patch.object(actuals, 'storage_available', return_value=False):
            self.assertIsNone(actuals.snapshot(self.owner, now=self.at))
        self.read.assert_not_called()

    def test_summary_keeps_signatures_roles_locks_and_future_rules(self):
        learner = {'id': 7, 'name': 'Synthetic learner', 'programme': 'Synthetic programme',
            '_canonical_profile': self.owner, '_view_as': True, '_profile': {'coach_name': 'Synthetic coach'}}
        signature = {'report_month': '2026-10', 'signer_role': 'learner', 'signed_at': '2026-11-01',
                     'signer_name': 'Synthetic learner', 'url': 'data:image/png;base64,synthetic'}
        saved = actuals.snapshot(self.owner, now=self.at)
        with patch.object(actuals, 'snapshot', return_value=saved), \
                patch.object(actuals.canonical, 'signatures_for', return_value=[signature]), \
                patch.object(actuals.timezone, 'localdate', return_value=self.at.date()), \
                patch.object(monthly_logs, 'lock_states', side_effect=lambda _id, months, **_kw: {
                    month: {'locked': True, 'locked_at': '2026-11-01', 'unlocked_at': None, 'unlocked_by': None}
                    for month in months}):
            result = actuals.summary(learner, include_open=True, ensure_month='2027-01')
            self.assertEqual([m['month'] for m in result['months']], ['2026-10'])
            self.assertTrue(result['read_only'])
            state = result['months'][0]
            self.assertEqual(state['status'], 'complete')
            self.assertTrue(state['locked'])
            self.assertEqual(state['student_signature']['signer_name'], 'Synthetic learner')
            self.assertEqual(state['actual_hours'], 2)
            self.assertEqual(state['row_count'], 2)
            self.assertEqual(state['snapshot_digest'], 'unchanged-digest')
            future = actuals.summary(learner, include_open=True, include_future=True, ensure_month='2027-01')
            self.assertEqual(future['months'][-1]['month'], '2027-01')
            self.assertEqual(future['months'][-1]['actual_hours'], 0)
            self.assertIsNone(future['months'][-1]['training_plan_target'])

    def test_summary_entry_point_uses_snapshot_before_activity_queries(self):
        learner = {'_canonical_profile': self.owner}
        expected = {'months': [], 'read_only': False}
        with patch.object(actuals, 'summary', return_value=expected), \
                patch.object(monthly_logs.canonical, 'entries_for') as entries:
            self.assertEqual(monthly_logs.summary_data(learner), expected)
        entries.assert_not_called()

    def test_no_canonical_identity_never_uses_a_stored_summary(self):
        with patch.object(actuals, 'snapshot') as snapshot:
            self.assertIsNone(actuals.summary({'id': 7}))
        snapshot.assert_not_called()

    def test_persisted_summary_matches_the_full_response_including_unallocated_and_pending_hours(self):
        from . import monthly_log_attendance, monthly_log_sources
        owner = self.owner
        learner = {'id': 7, 'name': 'Synthetic learner', 'programme': 'Synthetic programme',
            '_canonical_profile': owner, '_view_as': False, '_profile': {'coach_name': 'Synthetic coach'}}
        records = [
            dict(id=1, accepted=True, actual_seconds=3600, reporting_month='2026-10', ksbs=[]),
            dict(id=2, accepted=False, actual_seconds=1800, reporting_month='2026-10', ksbs=[], activity_status='submitted'),
            dict(id=3, accepted=True, actual_seconds=900, reporting_month='', ksbs=[]),
        ]
        rows = [{**monthly_log_sources.row(f"canonical:{r['id']}", '2026-10-01', 'Synthetic', 'Reading',
                    hours=r['actual_seconds'] / 3600, planned=2),
                 'progress_id': r['id'], 'accepted': r['accepted'], 'reporting_month': r['reporting_month'],
                 'actual_hours_recorded': True} for r in records]
        targets = {'2026-10': 9}
        locks = {'2026-10': {'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}}
        with patch.object(actuals.canonical, 'entries_for', return_value=records), \
                patch.object(actuals.canonical, 'rows_for', return_value=rows), \
                patch.object(actuals.canonical, 'targets_for', return_value=targets), \
                patch.object(actuals.canonical, 'signatures_for', return_value=[]), \
                patch.object(monthly_log_attendance, 'read_rows', return_value=[]), \
                patch.object(monthly_logs, 'additional_attendance', return_value=[]), \
                patch.object(monthly_logs, 'lock_states', return_value=locks), \
                patch.object(actuals.timezone, 'localdate', return_value=self.at.date()):
            states, totals, complete, _records, unallocated = actuals.project(owner, targets, journal=False)
            self.assertTrue(complete)
            self.assertEqual(states['2026-10']['actual_hours'], 1)
            self.assertEqual(states['2026-10']['not_accepted_hours'], .5)
            self.assertEqual(totals['accepted_hours'], 1.25)
            with patch.object(actuals, 'summary', return_value=None):
                original = monthly_logs.summary_data(learner, include_open=True)
            self.target['actual_seconds_total'] = 3600
            self.meta['seconds'] = 3600
            self.meta['views']['standard'] = {key: states['2026-10'][key] for key in actuals.MONTH_FIELDS}
            self.meta['totals']['standard'] = totals
            self.meta['unallocated']['standard'] = unallocated
            with actuals._perspective(False):
                cached = actuals.summary(learner, include_open=True)
            self.assertEqual(cached, original)


class MonthlyActualEventTests(SimpleTestCase):
    def test_notifications_are_explicit_bounded_positive_ids(self):
        self.assertEqual(notification_ids('[2,1,2]'), [1, 2])
        for value in ('null', '{}', '[]', '[true]', '[0]', '[-1]', '["1"]', '[1.2]', '[9223372036854775808]', '['):
            with self.subTest(value=value), self.assertRaises(ValueError):
                notification_ids(value)
        with self.assertRaises(ValueError):
            notification_ids(str(list(range(1, 202))))

    def test_event_only_refreshes_its_identified_profiles_once(self):
        refresh = Mock()
        self.assertEqual(consume(SimpleNamespace(payload='[70,80,70]'), using='isolated', refresh_one=refresh), (2, 0))
        self.assertEqual([call.args for call in refresh.call_args_list], [(70,), (80,)])
        self.assertTrue(all(call.kwargs == {'using': 'isolated'} for call in refresh.call_args_list))

    def test_failed_event_does_not_start_a_retry_or_global_recovery(self):
        refresh = Mock(side_effect=[RuntimeError('synthetic failure'), 1])
        with self.assertLogs('learner_api.management.commands.listen_monthly_actuals', level='ERROR'):
            result = consume(SimpleNamespace(payload='[70,80]'), using='isolated', refresh_one=refresh)
        self.assertEqual(result, (2, 1))
        self.assertEqual(refresh.call_count, 2)
