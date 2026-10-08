"""Hermetic bulk-query and canonical-projection regressions, synthetic evidence."""
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api.tests_attendance_lectures import register_row
from . import attendance_group as group


class AttendanceGroupBulkTests(SimpleTestCase):
    def load(self, count):
        profiles = [SimpleNamespace(id=i, _caseload_source=SimpleNamespace(
            id=900+i, username='Synthetic learner', email=f'learner{i}@example.test', aptem_id=100+i))
            for i in range(1, count+1)]
        evidence = [register_row(learner_id=p._caseload_source.id, session_id=f'kbc-{day}',
                                session_date=date(2026, 9, day), attendance_status='present' if day % 2 else 'absent')
                    for p in profiles for day in range(1, 7)]
        cursor = MagicMock()
        models = [group.CoachAbsenceReport, group.LiveSessionAbsence,
                  group.CoachManualAttendance, group.CoachAttendanceSourceAdjustment]
        with ExitStack() as stack:
            kbc = stack.enter_context(patch.object(group, 'fetch_kbc_attendance_rows_bulk', return_value=evidence))
            teams = stack.enter_context(patch.object(group, 'fetch_verified_teams_attendance_rows', return_value=[]))
            stack.enter_context(patch.object(group, 'connections', {'enrolment': MagicMock()}))
            group.connections['enrolment'].cursor.return_value.__enter__.return_value = cursor
            stack.enter_context(patch.object(group.canonical, 'dict_rows', side_effect=[[], []]))
            stack.enter_context(patch.object(group.canonical.timezone, 'now', return_value=datetime(2026, 9, 20, tzinfo=timezone.utc)))
            managers = [stack.enter_context(patch.object(model, 'objects')) for model in models]
            for manager in managers:
                manager.filter.return_value.__iter__.return_value = []
                manager.filter.return_value.values_list.return_value = []
            result = group.group_contracts(profiles)
            # No per-learner database calls are allowed by SimpleTestCase. Bulk
            # transports must each be invoked once regardless of group size.
            kbc.assert_called_once()
            teams.assert_called_once()
            self.assertEqual(cursor.execute.call_count, 2)
            for manager in managers:
                manager.filter.assert_called_once()
        return result, evidence

    def test_query_count_is_constant_for_one_and_twenty_learners(self):
        for count in (1, 20):
            with self.subTest(count=count):
                result, _ = self.load(count)
                self.assertEqual(len(result), count)
                for contract in result.values():
                    self.assertEqual(contract['summary']['sessions'], 6)
                    self.assertEqual(contract['summary']['present'], 3)
                    self.assertEqual(contract['summary']['absent'], 3)
                    self.assertEqual(contract['summary']['attendanceRate'], 50)
                    self.assertEqual(group.compact_recent(contract), [
                        {'date': f'2026-09-{day:02d}', 'status': 'present' if day % 2 else 'absent'}
                        for day in (6, 5, 4, 3)])

    def test_compact_summary_and_recent_match_full_canonical_contract(self):
        bulk, evidence = self.load(1)
        with patch.object(group.canonical, 'lecture_register', return_value=evidence), \
                patch.object(group.CoachManualAttendance, 'objects') as manual, \
                patch.object(group.CoachAbsenceReport, 'objects') as reports:
            manual.filter.return_value = []
            reports.filter.return_value.order_by.return_value = []
            full = group.canonical.attendance_read_contract(SimpleNamespace(id=901), learner_profile_id=1)
        self.assertEqual(bulk['1']['summary'], full['summary'])
        self.assertEqual(group.compact_recent(bulk['1']), group.compact_recent(full))

    def test_empty_group_does_not_query_evidence(self):
        with patch.object(group, 'fetch_kbc_attendance_rows_bulk') as kbc:
            self.assertEqual(group.group_contracts([]), {})
            kbc.assert_not_called()

    def test_preloaded_register_preserves_recovery_corrections_confirmations_and_manual_counts(self):
        now = datetime(2026, 9, 20, 12, tzinfo=timezone.utc)
        source = SimpleNamespace(id=901)
        scheduled = [register_row(source='microsoft-teams', session_id=key,
            session_date=date(2026, 9, 10+i), attendance_status=status,
            scheduled_start=now-timedelta(days=10-i), scheduled_end=now-timedelta(days=10-i, hours=-1))
            for i, (key, status) in enumerate([
                ('catchup', 'unmarked'), ('alternative', 'absent'), ('confirmed', 'absent'),
                ('corrected', 'absent'), ('deleted', 'present')])]
        scheduled.append(register_row(source='microsoft-teams', session_id='future',
            attendance_status='present', session_date=date(2026, 9, 21),
            scheduled_start=now+timedelta(days=1), scheduled_end=now+timedelta(days=1, hours=1)))
        records = [register_row(source='microsoft-teams', session_id='guest',
            eligibility_reason='approved_recovery_guest', attendance_status='present')]
        targets = {str(group.canonical.report_id(scheduled[1])): 'guest'}
        confirmations = {'teams:confirmed-2026-09-12': {'seconds': 600, 'submitted_at': now}}
        def correction(key, **extra):
            return SimpleNamespace(source='microsoft-teams', source_id=key, is_deleted=False,
                session_date=None, module_name='', session_title='', status='', updated_at=now, **extra)
        corrected = correction('corrected')
        corrected.status = 'present'
        deleted = correction('deleted')
        deleted.is_deleted = True
        adjustments = {('microsoft-teams', row.source_id): row for row in [corrected, deleted]}
        manual = [SimpleNamespace(id='manual', session_date=date(2026, 9, 19), status='absent',
                                  module_name='Manual module', session_title='Manual session')]
        with ExitStack() as stack:
            stack.enter_context(patch.object(group.canonical.timezone, 'now', return_value=now))
            stack.enter_context(patch.object(group.canonical, 'combined_attendance_rows', return_value=records))
            stack.enter_context(patch.object(group.canonical, 'read_native_occurrences', return_value=scheduled))
            stack.enter_context(patch.object(group.canonical, '_approved_alternative_targets', return_value=targets))
            stack.enter_context(patch.object(group.canonical, '_completed_catchup_occurrences', return_value={'catchup'}))
            stack.enter_context(patch('learner_api.attendance_confirmation.read_confirmations', return_value=confirmations))
            manager = stack.enter_context(patch.object(group.CoachAttendanceSourceAdjustment, 'objects'))
            manager.filter.return_value = [corrected, deleted]
            regular = group.canonical.lecture_register(source, learner_profile_id=1)
            # These must never be called again with preloaded evidence.
            for name in ('combined_attendance_rows', 'read_native_occurrences',
                         '_approved_alternative_targets', '_completed_catchup_occurrences'):
                stack.enter_context(patch.object(group.canonical, name, side_effect=AssertionError('per-learner read')))
            manager.filter.side_effect = AssertionError('per-learner correction query')
            preloaded = group.canonical.lecture_register(source, learner_profile_id=1, records=records,
                preloaded={'scheduled': scheduled, 'targets': targets, 'completed': {'catchup'},
                           'confirmations': confirmations, 'adjustments': adjustments})
            self.assertEqual(preloaded, regular)
            full = group.canonical.attendance_read_contract(source, learner_profile_id=1,
                register=regular, manual_rows=manual, compact=True)
            compact = group.canonical.attendance_read_contract(source, learner_profile_id=1,
                register=preloaded, manual_rows=manual, compact=True)
            self.assertEqual(compact['summary'], full['summary'])
            self.assertEqual(compact['summary']['present'], 4)
            self.assertEqual(compact['summary']['absent'], 1)
            self.assertEqual(compact['summary']['sessions'], 5)
            self.assertEqual(group.compact_recent(compact), group.compact_recent(full))
