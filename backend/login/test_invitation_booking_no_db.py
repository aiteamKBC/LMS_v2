"""Run directly with Python; no database, network, mail or production settings loaded."""
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(INSTALLED_APPS=['login'], DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}, SECRET_KEY='isolated-test', DEFAULT_CHARSET='utf-8')
import django
django.setup()
from login import email_azure, invitations

LINK = 'https://lms.example.net/lms-introduction?token=SIGNED'


def learner_account(**overrides):
    fields = dict(id=7, subject_id=132, subject_type='learner', display_name='Example Learner', email='learner@example.test')
    fields.update(overrides)
    return SimpleNamespace(**fields)


class InvitationEmailTests(unittest.TestCase):
    def test_booking_section_carries_the_case_owner_and_link(self):
        _, html, text = email_azure.invitation_message(display_name='Example Learner', link='https://h/set-password?token=T',
                                                       expires_days=7, booking_owner='Example Coach', booking_link=LINK)
        for body in (html, text):
            self.assertIn('https://h/set-password?token=T', body)
            self.assertIn('Example Coach', body)
            self.assertIn('one-to-one', body)
        self.assertIn(LINK, text)
        self.assertIn('href="https://lms.example.net/lms-introduction?token=SIGNED"', html)
        self.assertIn('Book my LMS introduction', html)
        self.assertNotIn('<style', html.lower())

    def test_without_a_complete_booking_the_invitation_is_unchanged(self):
        plain = email_azure.invitation_message(display_name='A', link='https://h/x', expires_days=7)
        for owner, link in ((None, None), ('Example Coach', None), (None, LINK)):
            self.assertEqual(email_azure.invitation_message(display_name='A', link='https://h/x', expires_days=7,
                                                            booking_owner=owner, booking_link=link), plain)
        self.assertNotIn('one-to-one', plain[1])

    def test_case_owner_name_is_escaped(self):
        _, html, _ = email_azure.invitation_message(display_name='A', link='https://h/x', expires_days=7,
                                                    booking_owner='<b>Coach</b>', booking_link=LINK)
        self.assertNotIn('<b>Coach</b>', html)
        self.assertIn('&lt;b&gt;Coach&lt;/b&gt;', html)


class OneToOneBookingTests(unittest.TestCase):
    def lookup(self, account, found=(SimpleNamespace(pk=132), 'coach@example.test', 'Example Coach'), error=None):
        finder = Mock(side_effect=error, return_value=found)
        with patch('login.lms_introduction.learner_and_owner', finder),                 patch('login.lms_introduction.make_token', return_value='SIGNED'),                 patch.dict('os.environ', {'FRONTEND_URL': 'https://lms.example.net/'}):
            return invitations.one_to_one_booking(account), finder

    def test_learner_gets_a_link_to_book_their_lms_introduction(self):
        result, finder = self.lookup(learner_account())
        self.assertEqual(result, ('Example Coach', LINK))
        finder.assert_called_once()

    def test_staff_invitations_never_look_up_a_booking(self):
        result, finder = self.lookup(learner_account(subject_type='staff'))
        self.assertIsNone(result)
        finder.assert_not_called()

    def test_missing_learner_or_unresolved_case_owner_offers_nothing(self):
        self.assertIsNone(self.lookup(learner_account(), found=(None, '', ''))[0])
        self.assertIsNone(self.lookup(learner_account(), found=(SimpleNamespace(pk=132), '', 'Unknown Owner'))[0])

    def test_lookup_failure_does_not_block_the_invitation(self):
        with self.assertLogs('login', level='ERROR'):
            result, _ = self.lookup(learner_account(), error=RuntimeError('database unavailable'))
        self.assertIsNone(result)

    def test_send_invitation_passes_the_booking_to_the_email(self):
        invitation = SimpleNamespace(save=Mock())
        with patch.object(invitations, 'create_invitation', return_value=(invitation, 'token')), \
                patch.object(invitations, 'one_to_one_booking', return_value=('Example Coach', LINK)), \
                patch.object(invitations.email_azure, 'invitation_message', return_value=('s', 'h', 't')) as message, \
                patch.object(invitations.email_azure, 'send_mail', return_value=(False, 'not sent in tests')), \
                patch.object(invitations, 'record'):
            invitations.send_invitation(learner_account())
        self.assertEqual(message.call_args.kwargs['booking_owner'], 'Example Coach')
        self.assertEqual(message.call_args.kwargs['booking_link'], LINK)


if __name__ == '__main__':
    unittest.main()
