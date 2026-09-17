"""Phase 3: sync_coach_meeting_snapshots' polling window and failure isolation.

    python manage.py test coach_api.tests_sync_coach_meeting_snapshots_command

The command is the primary, cron-friendly path for the Teams-attendance ->
in-progress transition (see coach_api.views
.apply_teams_attendance_status_transition and COACH_OPERATIONS.md). These
tests pin: the --recent window actually includes a meeting currently in
progress (not just ones that already ended), excludes far-future/old/
cancelled/not-scheduled rows, and one record's Graph failure never stops the
rest of the batch.
"""
from datetime import date, time, timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from coach_api.management.commands.sync_coach_meeting_snapshots import Command
from coach_api.models import CoachCalendarEvent


class RecentWindowTestCase(TestCase):
    def setUp(self):
        self.command = Command()
        self.now = timezone.now()

    def _event(self, *, offset_minutes, duration_minutes=30, status=CoachCalendarEvent.STATUS_SCHEDULED, event_type='mcr', meeting_link='https://teams.microsoft.com/meet/x', suffix='a'):
        scheduled_at = self.now + timedelta(minutes=offset_minutes)
        return CoachCalendarEvent.objects.create(
            event_key=f'{event_type}:{700}:1:{suffix}', event_type=event_type,
            owner_email='coach@example.com', owner_name='Coach',
            learner_id=700, learner_name='Learner', learner_email='learner@example.com',
            scheduled_date=scheduled_at.date(), scheduled_time=scheduled_at.time(),
            target_date=scheduled_at.date(), duration_minutes=duration_minutes,
            status=status, meeting_link=meeting_link,
        )

    def test_currently_in_progress_meeting_is_matched(self):
        # Started 5 minutes ago, ends in 25 -- still running right now.
        record = self._event(offset_minutes=-5, duration_minutes=30, suffix='inprogress')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertIn(record.pk, [r.pk for r in matched])

    def test_meeting_starting_within_lead_window_is_matched(self):
        # Starts in 5 minutes -- within the 10-minute lead window.
        record = self._event(offset_minutes=5, duration_minutes=30, suffix='leading')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertIn(record.pk, [r.pk for r in matched])

    def test_meeting_far_in_the_future_is_not_matched(self):
        record = self._event(offset_minutes=120, duration_minutes=30, suffix='future')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertNotIn(record.pk, [r.pk for r in matched])

    def test_recently_ended_meeting_is_still_matched(self):
        # Ended 30 minutes ago -- well within the 24h lookback.
        record = self._event(offset_minutes=-60, duration_minutes=30, suffix='ended')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertIn(record.pk, [r.pk for r in matched])

    def test_meeting_completed_months_ago_is_not_matched(self):
        record = self._event(
            offset_minutes=-60 * 24 * 90, duration_minutes=30,
            status=CoachCalendarEvent.STATUS_COMPLETED, suffix='old',
        )
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertNotIn(record.pk, [r.pk for r in matched])

    def test_cancelled_meeting_is_never_matched(self):
        record = self._event(offset_minutes=-5, status=CoachCalendarEvent.STATUS_CANCELLED, suffix='cancelled')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertNotIn(record.pk, [r.pk for r in matched])

    def test_not_scheduled_meeting_is_never_matched(self):
        record = self._event(offset_minutes=-5, status=CoachCalendarEvent.STATUS_NOT_SCHEDULED, suffix='notsched')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertNotIn(record.pk, [r.pk for r in matched])

    def test_meeting_with_no_teams_link_is_never_matched(self):
        record = self._event(offset_minutes=-5, meeting_link='', suffix='nolink')
        matched = self.command._matching_records(
            sync_all=False, sync_recent=True, event_key='', owner_email='', limit=0,
            lookback_hours=24, lead_minutes=10,
        )
        self.assertNotIn(record.pk, [r.pk for r in matched])


class FailureIsolationTestCase(TestCase):
    """One record's Graph failure must not stop the rest of the batch."""

    def setUp(self):
        self.now = timezone.now()

    def _event(self, suffix):
        scheduled_at = self.now - timedelta(minutes=5)
        return CoachCalendarEvent.objects.create(
            event_key=f'mcr:800:1:{suffix}', event_type='mcr',
            owner_email='coach@example.com', owner_name='Coach',
            learner_id=800, learner_name='Learner', learner_email='learner@example.com',
            scheduled_date=scheduled_at.date(), scheduled_time=scheduled_at.time(),
            target_date=scheduled_at.date(), duration_minutes=30,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_link='https://teams.microsoft.com/meet/x',
        )

    def test_one_failed_record_does_not_stop_the_others(self):
        from io import StringIO

        broken = self._event('broken')
        healthy = self._event('healthy')

        def fake_snapshot(record):
            if record.pk == broken.pk:
                return None, {"detail": "Microsoft Graph could not resolve this Teams meeting.", "code": "coach_online_meeting_unresolved"}, 409
            return (
                {
                    "attendance": {"records": [], "reportCount": 0, "tracker": []},
                    "artifacts": [], "attendanceReports": [], "attendanceTracker": {},
                    "errors": [], "partial": False,
                },
                None, 200,
            )

        with patch('coach_api.management.commands.sync_coach_meeting_snapshots.fetch_coach_meeting_graph_snapshot', side_effect=fake_snapshot), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.coach_meeting_snapshot_tables_ready', return_value=True), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.persist_coach_meeting_snapshots', return_value={"stored": True}), \
             patch('coach_api.management.commands.sync_coach_meeting_snapshots.apply_teams_attendance_status_transition', return_value=False):
            out = StringIO()
            from django.core.management import call_command
            call_command('sync_coach_meeting_snapshots', '--recent', stdout=out)

        output = out.getvalue()
        self.assertIn('Skipped', output)
        self.assertIn(broken.event_key, output)
        self.assertIn('Stored', output)
        self.assertIn(healthy.event_key, output)
        self.assertIn('stored=1', output)
        self.assertIn('skipped=1', output)
