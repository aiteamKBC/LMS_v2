"""Catch-up reminder timing, single delivery and the off-by-default switch (no database)."""
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import IntegrityError
from django.test import SimpleTestCase

from learner_api import catchup_reminders
from learner_api.catchup_reminders import UK

# 14 Oct 2026 10:00 UTC is 11:00 UK (BST).
NOW = datetime(2026, 10, 14, 10, 0, tzinfo=dt_timezone.utc)


def booking(start_uk, **values):
    return SimpleNamespace(
        event_key='catch-up:248:12:2026-10-15', scheduled_date=start_uk.date(), scheduled_time=start_uk.time(),
        learner_email='learner@example.invalid', learner_name='Test Learner', owner_name='Test Coach',
        duration_minutes=30, meeting_link='https://teams.microsoft.com/l/meetup-join/example', **values)


class ReminderTimingTests(SimpleTestCase):
    def kind(self, hours):
        return catchup_reminders.reminder_kind(NOW + timedelta(hours=hours), NOW)

    def test_day_before_and_hour_before_windows(self):
        self.assertEqual(self.kind(23.9), '24h')
        self.assertEqual(self.kind(12.5), '24h')
        self.assertIsNone(self.kind(24.5))
        self.assertIsNone(self.kind(6))
        self.assertEqual(self.kind(0.9), '1h')
        self.assertIsNone(self.kind(-0.1))


class ReminderDeliveryTests(SimpleTestCase):
    def run_send(self, *, sent=True, already=False, create_error=None):
        start = datetime(2026, 10, 15, 9, 0, tzinfo=UK)  # 22 hours after NOW
        row = booking(start)
        events, reminders = MagicMock(), MagicMock()
        events.filter.return_value = [row]
        reminders.filter.return_value.values_list.return_value = (
            [(row.event_key, '24h', start)] if already else [])
        reminders.create.side_effect = create_error
        reminders.create.return_value = SimpleNamespace(pk=7, delete=MagicMock())
        with patch('coach_api.models.CoachCalendarEvent.objects', events), \
                patch('coach_api.models.CatchupReminder.objects', reminders), \
                patch('login.email_azure.is_configured', return_value=True), \
                patch('login.email_azure.send_mail', return_value=(sent, '')) as send:
            accepted = catchup_reminders.send_due_reminders(NOW)
        return accepted, send, reminders

    def test_due_reminder_is_recorded_then_sent_to_the_learner(self):
        accepted, send, reminders = self.run_send()
        self.assertEqual(accepted, 1)
        self.assertEqual(reminders.create.call_args.kwargs['kind'], '24h')
        self.assertEqual(send.call_args.kwargs['to'], 'learner@example.invalid')
        self.assertIn('tomorrow at 09:00', send.call_args.kwargs['subject'])
        reminders.filter.return_value.update.assert_called_once_with(sent=True)

    def test_a_reminder_already_sent_for_this_start_is_not_sent_again(self):
        accepted, send, _reminders = self.run_send(already=True)
        self.assertEqual(accepted, 0)
        send.assert_not_called()

    def test_another_server_that_recorded_it_first_wins(self):
        accepted, send, _reminders = self.run_send(create_error=IntegrityError())
        self.assertEqual(accepted, 0)
        send.assert_not_called()

    def test_a_refused_email_is_freed_for_the_next_run(self):
        accepted, _send, reminders = self.run_send(sent=False)
        self.assertEqual(accepted, 0)
        reminders.create.return_value.delete.assert_called_once()


class ReminderSwitchTests(SimpleTestCase):
    def test_reminders_are_off_unless_enabled(self):
        with patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('CATCHUP_REMINDERS_ENABLED', None)
            self.assertFalse(catchup_reminders.enabled())
            self.assertFalse(catchup_reminders.start_reminders())
        with patch.dict('os.environ', {'CATCHUP_REMINDERS_ENABLED': 'true'}):
            self.assertTrue(catchup_reminders.enabled())

    def test_email_mentions_uk_time_and_the_change_window(self):
        subject, html, text = catchup_reminders.reminder_email(
            booking(datetime(2026, 10, 15, 9, 0, tzinfo=UK)), '1h', datetime(2026, 10, 15, 9, 0, tzinfo=UK))
        self.assertIn('in 1 hour', subject)
        self.assertIn('09:00 (UK time)', text)
        self.assertIn('12 hours', html)
        self.assertIn('https://teams.microsoft.com/l/meetup-join/example', html)
