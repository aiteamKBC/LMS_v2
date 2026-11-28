"""Synthetic business cases; use dummy database backends and mocked storage."""
from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.utils import timezone as django_timezone

from curriculum_api.bulk_attendance_live_policy import merge_live_over_kbc
from learner_api.attendance_rules import attendance_outcome
from learner_api.live_attendance_reporting import delivery_timeline, project_live_attendance


class LiveAttendanceReportingTests(TestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 28, 12, tzinfo=timezone.utc)
        self.switch = self.now - timedelta(days=7)
        self.timeline = ('live', [(self.switch, 'lazy')])
        self.enterContext(django_timezone.override('Europe/London'))

    def row(self, key, status='present', *, at=None, **extra):
        at = at or self.switch - timedelta(days=1)
        return {'session_id': key, 'recordKey': key, 'session_date': at.date(),
                'sessionDate': at.date().isoformat(), 'scheduled_end': at,
                'attendance_status': status, **extra}

    def counts(self, rows, timeline=None):
        rows = project_live_attendance(rows, timeline or self.timeline, now=self.now)
        outcomes = [attendance_outcome(row, self.now) for row in rows]
        return sum(status == 'present' and counted for status, counted in outcomes), sum(
            counted for _, counted in outcomes)

    def test_switch_freezes_twenty_out_of_twenty_four_then_adds_live_visits(self):
        before = [self.row(str(i), 'present' if i < 20 else 'absent') for i in range(24)]
        after = [self.row('new-absence', 'absent', at=self.switch + timedelta(days=1))]
        self.assertEqual(self.counts(before + after), (20, 24))
        after.append(self.row('new-visit', at=self.switch + timedelta(days=2)))
        self.assertEqual(self.counts(before + after), (21, 25))

    def test_recorded_from_start_has_no_absence_target_but_gets_live_attendance(self):
        timeline = ('lazy', [])
        self.assertEqual(self.counts([self.row('absent', 'absent')], timeline), (0, 0))
        self.assertEqual(self.counts([self.row('absent', 'absent'), self.row('visit', 'late')], timeline), (1, 1))

    def test_watched_recording_does_not_replace_live_absence_or_increase_recorded_target(self):
        row = self.row('watched', 'absent', raw_attendance_status='absent',
                       effective_attendance=1, effective_attendance_status='recorded',
                       final_outcome='recorded', attendance_basis='recorded')
        self.assertEqual(self.counts([row]), (0, 1))
        self.assertEqual(self.counts([row], ('lazy', [])), (0, 0))

    def test_verified_live_catchup_still_counts_as_attended(self):
        row = self.row('recovered', 'absent', effective_attendance=1,
                       effective_attendance_status='made_up', final_outcome='made_up')
        self.assertEqual(self.counts([row]), (1, 1))
        self.assertEqual(self.counts([row], ('lazy', [])), (1, 1))

    def test_repeated_switches_preserve_each_recorded_period(self):
        first, second, third = [self.switch + timedelta(days=i) for i in range(3)]
        timeline = ('live', [(first, 'lazy'), (second, 'live'), (third, 'lazy')])
        rows = [self.row('before', 'absent', at=first - timedelta(hours=1)),
                self.row('recorded-absence', 'absent', at=first + timedelta(hours=1)),
                self.row('live-absence', 'absent', at=second + timedelta(hours=1)),
                self.row('recorded-again', 'absent', at=third + timedelta(hours=1)),
                self.row('recorded-visit', at=third + timedelta(hours=2))]
        self.assertEqual(self.counts(rows, timeline), (1, 3))

    def test_session_not_due_at_switch_adds_no_absence(self):
        row = self.row('ongoing-at-switch', 'absent', at=self.switch + timedelta(hours=1),
                       scheduled_start=self.switch - timedelta(hours=1))
        self.assertEqual(self.counts([row]), (0, 0))
        row['attendance_status'] = 'present'
        self.assertEqual(self.counts([row]), (1, 1))

    def test_pending_request_does_not_freeze_live_target(self):
        self.assertEqual(self.counts([self.row('live-absence', 'absent')], ('live', [])), (0, 1))

    def test_future_active_cancelled_and_unmarked_do_not_count(self):
        rows = [self.row('future', at=self.now + timedelta(days=1)),
                self.row('active', at=self.now + timedelta(hours=1), scheduled_start=self.now - timedelta(hours=1)),
                self.row('cancelled', occurrence_status='cancelled'),
                self.row('cancelled-series', live_session_status='cancelled'),
                self.row('unmarked', 'unmarked')]
        self.assertEqual(self.counts(rows), (0, 0))

    def test_excluded_live_absence_still_supersedes_same_day_kbc_history(self):
        day = self.switch.date()
        old = self.row('kbc', 'absent', at=datetime.combine(day, datetime.min.time(), timezone.utc))
        live = self.row('live', 'absent', at=self.switch + timedelta(hours=1))
        projected = project_live_attendance([old, live], self.timeline, now=self.now)
        merged = merge_live_over_kbc(projected[:1], projected[1:])
        self.assertEqual([row['recordKey'] for row in merged], ['live'])
        self.assertFalse(attendance_outcome(merged[0], self.now)[1])

    def test_date_only_kbc_uses_business_timezone(self):
        at = datetime(2026, 7, 1, 22, 30, tzinfo=timezone.utc)
        row = {'session_date': (at + timedelta(days=1)).date(), 'attendance_status': 'absent'}
        self.assertEqual(self.counts([row], ('live', [(at, 'lazy')])), (0, 0))

    def test_saved_correction_can_confirm_live_attendance(self):
        row = self.row('corrected', raw_attendance_status='absent',
                       effective_attendance=1, effective_attendance_status='present')
        self.assertEqual(self.counts([row], ('lazy', [])), (1, 1))

    def test_does_not_mutate_recording_or_attendance_evidence(self):
        row = self.row('recording', 'absent', effective_attendance=1, final_outcome='recorded')
        original = dict(row)
        self.counts([row])
        self.assertEqual(row, original)

    def test_naive_schedule_instants_are_utc(self):
        row = self.row('naive', 'absent', at=(self.switch + timedelta(hours=1)).replace(tzinfo=None))
        self.assertEqual(self.counts([row]), (0, 0))


class DeliveryTimelineStorageTests(TestCase):
    def cursor(self, fetches, events=()):
        cursor = MagicMock()
        cursor.fetchone.side_effect = fetches
        cursor.fetchall.return_value = events
        connections = {'enrolment': MagicMock()}
        connections['enrolment'].cursor.return_value.__enter__.return_value = cursor
        self.enterContext(patch('learner_api.live_attendance_reporting.connections', connections))
        return cursor

    def test_queries_one_enrolment_and_uses_first_previous_mode(self):
        at = datetime(2026, 11, 1, tzinfo=timezone.utc)
        cursor = self.cursor([('preferences', 'history'), ('lazy',)], [('live', 'lazy', at)])
        self.assertEqual(delivery_timeline(123), ('live', [(at, 'lazy')]))
        for call in cursor.execute.call_args_list[1:]:
            self.assertEqual(call.args[1], [123])
        self.assertNotIn('requested_mode', str(cursor.execute.call_args_list))

    def test_missing_optional_preferences_default_to_live(self):
        self.cursor([(None, None)])
        self.assertEqual(delivery_timeline(123), ('live', []))

    def test_missing_history_fails_visibly_instead_of_fabricating_a_target(self):
        self.cursor([('preferences', None)])
        with self.assertRaises(DatabaseError):
            delivery_timeline(123)

    def test_legacy_recorded_preference_needs_a_verified_date(self):
        self.cursor([('preferences', 'history'), ('lazy',)])
        with self.assertRaises(DatabaseError):
            delivery_timeline(123)

    def test_recorded_from_start_has_an_initial_recorded_event(self):
        at = datetime(2026, 11, 1, tzinfo=timezone.utc)
        self.cursor([('preferences', 'history'), ('lazy',)], [('lazy', 'lazy', at)])
        self.assertEqual(delivery_timeline(123), ('lazy', [(at, 'lazy')]))


class MigrationTargetTests(TestCase):
    def test_non_postgres_execution_does_not_run_ddl(self):
        from importlib import import_module
        migration = import_module('learner_api.migrations.0028_attendance_mode_history')
        editor = MagicMock()
        editor.connection.vendor = 'sqlite'
        migration.install(None, editor)
        editor.execute.assert_not_called()

    def test_wrong_database_alias_is_rejected_before_ddl(self):
        from importlib import import_module
        migration = import_module('learner_api.migrations.0028_attendance_mode_history')
        editor = MagicMock()
        editor.connection.vendor = 'postgresql'
        editor.connection.alias = 'enrolment'
        with self.assertRaises(RuntimeError):
            migration.install(None, editor)
        editor.execute.assert_not_called()
