from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from login.api_gate import rule_for

from . import event_rsvp_views
from .event_emails import render_email
from .event_rsvp import rsvp_link, save_rsvp


class EventRsvpSecurityTests(SimpleTestCase):
    @mock.patch('engagement_api.event_rsvp.frontend_base_url', return_value='https://lms.example.test')
    def test_rsvp_link_uses_fragment_bearer_token(self, _frontend_base_url):
        self.assertEqual(rsvp_link('private-token'), 'https://lms.example.test/event-rsvp#token=private-token')

    def test_only_public_rsvp_routes_are_ungated(self):
        self.assertIsNone(rule_for('/engagement_api/feedback/public-rsvp/'))
        self.assertIsNone(rule_for('/engagement_api/feedback/public-rsvp/csrf/'))
        self.assertIsNotNone(rule_for('/engagement_api/feedback/events/4/rsvp/'))

    def test_unknown_token_returns_safe_error(self):
        request = RequestFactory().post(
            '/engagement_api/feedback/public-rsvp/',
            data='{"action":"read","token":"unknown"}', content_type='application/json',
        )
        with mock.patch.object(event_rsvp_views, 'recipient_for_token', return_value=None):
            response = event_rsvp_views.public_access(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn(b'invalid or has expired', response.content)


class EventEmailRenderingTests(SimpleTestCase):
    def test_plain_copy_is_rendered_and_html_escaped(self):
        event = SimpleNamespace(title='<Workshop>', date='2 Oct', time='10:00', location='Room & Hall')
        copy = {
            'subject': 'Invite: {{event_title}}',
            'body': 'Hello {{recipient_name}}\n\nMeet at {{event_location}}.',
            'buttonText': 'Reply now',
        }
        with mock.patch('engagement_api.event_emails.event_email_content', return_value=copy):
            subject, text, html = render_email(event, '<Alex>', 'https://example.test/?a=1&b=2', 'event_rsvp')
        self.assertEqual(subject, 'Invite: <Workshop>')
        self.assertIn('Hello <Alex>', text)
        self.assertIn('&lt;Alex&gt;', html)
        self.assertIn('Room &amp; Hall', html)
        self.assertIn('a=1&amp;b=2', html)


class EventRsvpBookingTests(SimpleTestCase):
    def recipient(self, old_status='no_response'):
        event = SimpleNamespace(pk=9)
        campaign = SimpleNamespace(event=event, event_id=9)
        return SimpleNamespace(
            campaign=campaign, learner_id='17', recipient_name='Synthetic Learner',
            recipient_email='learner@example.test', rsvp_status=old_status, save=mock.Mock(),
        )

    def test_yes_creates_booking_and_increments_intent_count(self):
        recipient = self.recipient()
        booking_manager = mock.Mock()
        booking_manager.select_for_update.return_value.filter.return_value.first.return_value = None
        event_manager = mock.Mock()
        event_manager.select_for_update.return_value.get.return_value = recipient.campaign.event
        with mock.patch('engagement_api.event_rsvp.EventBooking') as booking_type, \
             mock.patch('engagement_api.event_rsvp.Event.objects', event_manager):
            booking_type.objects = booking_manager
            booking = booking_type.return_value
            changed = save_rsvp.__wrapped__(recipient, 'yes')
        self.assertTrue(changed)
        self.assertEqual(recipient.rsvp_status, 'yes')
        self.assertEqual(booking.status, 'booked')
        booking.save.assert_called_once()
        event_manager.filter.return_value.update.assert_called_once()

    def test_maybe_cancels_existing_booking_without_losing_rsvp_state(self):
        recipient = self.recipient('yes')
        booking = SimpleNamespace(status='booked', save=mock.Mock())
        booking_manager = mock.Mock()
        booking_manager.select_for_update.return_value.filter.return_value.first.return_value = booking
        event_manager = mock.Mock()
        event_manager.select_for_update.return_value.get.return_value = recipient.campaign.event
        with mock.patch('engagement_api.event_rsvp.EventBooking.objects', booking_manager), \
             mock.patch('engagement_api.event_rsvp.Event.objects', event_manager):
            save_rsvp.__wrapped__(recipient, 'maybe')
        self.assertEqual(recipient.rsvp_status, 'maybe')
        self.assertEqual(booking.status, 'cancelled')
        event_manager.filter.return_value.update.assert_called_once()
