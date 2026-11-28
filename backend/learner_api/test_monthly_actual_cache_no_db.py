from contextlib import nullcontext
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import monthly_actual_cache as cache


def summary(october, november):
    return {
        'months': [
            {'month': '2026-10', 'actual_hours': october, 'row_count': 4,
             'planned_hours': 8, 'estimated_hours': 0, 'snapshot_digest': 'oct',
             'submitted_hours': 0, 'not_accepted_hours': 0,
             'total_actual_hours': october, 'verification_hours': 0},
            {'month': '2026-11', 'actual_hours': november, 'row_count': 3,
             'planned_hours': 0, 'estimated_hours': 0, 'snapshot_digest': 'nov',
             'submitted_hours': 0, 'not_accepted_hours': 0,
             'total_actual_hours': november, 'verification_hours': 0},
        ],
        'training_plan_totals': {'accepted_hours': october + november, 'planned_hours': 580},
    }


class MonthlyActualPayloadTests(SimpleTestCase):
    def test_uses_canonical_month_states_without_recalculating_hours(self):
        computed = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)
        result = cache.build_payloads(summary(15.50388888888889, 7.5),
                                      summary(15.50388888888889, 7.5), computed_at=computed)
        self.assertEqual(result['2026-10']['seconds'], 55814)
        self.assertEqual(result['2026-11']['seconds'], 27000)
        self.assertEqual(result['2026-10']['summary']['views']['standard']['snapshot_digest'], 'oct')
        self.assertEqual(result['2026-11']['summary']['totals']['journal']['accepted_hours'],
                         23.003888888888888)

    def test_refuses_to_cache_disagreeing_accepted_hours_policies(self):
        with self.assertRaisesRegex(ValueError, 'disagree'):
            cache.build_payloads(summary(8, 5), summary(8, 7.5),
                                 computed_at=datetime.now(timezone.utc))


class MonthlyActualWriterTests(SimpleTestCase):
    def test_refresh_updates_only_existing_selected_target_rows(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.side_effect = [(True,), ('read committed',)]
        cursor.fetchall.return_value = [(41, '2026-10'), (42, '2026-11')]
        cursor.rowcount = 1
        connection = SimpleNamespace(cursor=lambda: cursor)
        with patch.object(cache, 'connections', {'enrolment': connection}), \
             patch.object(cache.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(cache, '_owner_for_profile', return_value=(678, {'id': 1109, 'programme_id': 'P'})), \
             patch.object(cache, '_canonical_summaries', return_value=(summary(15.50388888888889, 7.5),
                                                                        summary(15.50388888888889, 7.5))):
            result = cache.refresh_learner(1109)
        self.assertEqual(result['updated'], 2)
        updates = [call for call in cursor.execute.call_args_list
                   if 'SET actual_seconds_total=' in call.args[0]]
        self.assertEqual([call.args[1][0] for call in updates], [55814, 27000])
        self.assertEqual([call.args[1][-2:] for call in updates], [[41, 1109], [42, 1109]])

    def test_completed_hours_uses_canonical_metrics_and_two_decimal_snapshot(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.side_effect = [(True,), (Decimal('18.20'),)]
        connection = SimpleNamespace(cursor=lambda: cursor)
        with patch.object(cache, 'connections', {'enrolment': connection}), \
             patch.object(cache.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(cache, '_owner_for_profile', return_value=(678, {'id': 1109})), \
             patch.object(cache.canonical, 'metrics', return_value={
                 'otjh': {'completed_actual': 23.2017}}):
            result = cache.sync_completed_hours(1109)
        self.assertEqual(result['after'], Decimal('23.20'))
        update = next(call for call in cursor.execute.call_args_list
                      if 'SET completed_hours=' in call.args[0])
        self.assertEqual(update.args[1], [Decimal('23.20'), 1109])
