"""Canonical preference/reminder identity; all storage and email are mocked."""
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse
from html import unescape
import re

from django.core import signing
from django.core.management.base import CommandError
from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from . import attendance_mode as mode
from .management.commands import send_attendance_reminders as reminders


class CanonicalAttendanceTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(id=12, username='Synthetic learner',
            email='learner@example.invalid', learner_type='apprenticeship')
        self.connection = MagicMock()
        self.cur = self.connection.cursor.return_value.__enter__.return_value
        self.enterContext(patch.object(mode, 'connections', {'enrolment': self.connection}))
        self.enterContext(patch.object(mode.transaction, 'atomic', return_value=nullcontext()))
        self.profiles = self.enterContext(patch.object(mode.LearnerProfile, 'objects'))
        self.profiles.filter.return_value.values_list.return_value = [91]
        self.state = {'learner_id': 91, 'mode': 'live', 'requested_mode': 'lazy',
            'status': 'pending', 'request_id': 'synthetic-request', 'email_sent': True,
            'manager_email': 'manager@example.invalid', 'updated_at': timezone.now()}
        self.send = self.enterContext(patch.object(mode, 'send_mail', return_value=(True, '')))

    def test_read_missing_preference_keeps_live_default_using_canonical_id(self):
        with patch.object(mode, '_ready', return_value=True), \
             patch.object(mode, '_state', return_value=None) as read, \
             patch.object(mode, '_manager', return_value=''):
            result = mode.read_mode(self.source, 'apprenticeship')
        read.assert_called_once_with(self.cur, 91)
        self.assertTrue(result['available'])
        self.assertTrue(result['remindersEnabled'])
        self.assertEqual(result['mode'], 'live')

    def test_missing_or_ambiguous_profiles_make_reads_unavailable(self):
        for ids in ([], [91, 92]):
            self.profiles.filter.return_value.values_list.return_value = ids
            self.assertFalse(mode.read_mode(self.source, 'apprenticeship')['available'])
        self.connection.cursor.assert_not_called()

    def test_email_token_binds_enrolment_and_canonical_profile(self):
        self.assertTrue(mode._send_request(self.source, 'apprenticeship', self.state))
        html = self.send.call_args.kwargs['html_body']
        url = unescape(re.search(r'href="([^"]+)"', html).group(1))
        token = parse_qs(urlparse(url).query)['token'][0]
        data = signing.loads(token, salt=mode.SALT)
        self.assertEqual((data['learner'], data['profile']), (12, 91))
        self.assertEqual(self.cur.execute.call_args.args[1], [True, 91, 'synthetic-request'])

    def test_changed_identity_cannot_send_request_for_another_profile(self):
        self.profiles.filter.return_value.values_list.return_value = [92]
        with self.assertRaises(ValueError):
            mode._send_request(self.source, 'apprenticeship', self.state)
        self.send.assert_not_called()
        self.cur.execute.assert_not_called()

    def review(self, decision, *, profile=91, legacy=False):
        data = {'learner': 12, 'kind': 'apprenticeship', 'request': 'synthetic-request'}
        if not legacy:
            data['profile'] = profile
        token = signing.dumps(data, salt=mode.SALT)
        request = RequestFactory().post('/', {'token': token, 'decision': decision})
        request._dont_enforce_csrf_checks = True
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = self.source
        with patch.object(mode, 'SOURCE_MODELS', {'apprenticeship': model}), \
             patch.object(mode, '_state', return_value=self.state) as read, \
             patch.object(mode, '_manager', return_value='manager@example.invalid'), \
             patch.object(mode, 'render', side_effect=lambda req, template, context, status: HttpResponse(status=status)):
            response = mode.review_attendance_mode(request)
        return response, read

    def test_approval_and_rejection_update_canonical_preference(self):
        for decision, saved_mode, status in [('approve', 'lazy', 'approved'), ('decline', 'live', 'declined')]:
            response, read = self.review(decision)
            self.assertEqual(response.status_code, 200)
            read.assert_called_once_with(self.cur, 91, lock=True)
            self.assertEqual(self.cur.execute.call_args.args[1], [saved_mode, status, 91])
        self.send.assert_not_called()

    def test_legacy_token_still_resolves_canonical_preference(self):
        response, read = self.review('approve', legacy=True)
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(self.cur, 91, lock=True)

    def test_changed_profile_and_ambiguous_identity_reject_token_without_write(self):
        response, read = self.review('approve', profile=92)
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()
        self.profiles.filter.return_value.values_list.return_value = [91, 92]
        response, read = self.review('approve')
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()
        self.cur.execute.assert_not_called()

    def test_replayed_token_cannot_update_active_preference(self):
        self.state.update(status='approved', request_id=None)
        response, _ = self.review('approve')
        self.assertEqual(response.status_code, 400)
        self.cur.execute.assert_not_called()

    def run_reminders(self, *, enabled=True):
        lecture = {'id': 'session:1', 'title': 'Synthetic lecture', 'date': timezone.localdate().isoformat(),
                   'status': 'absent', 'catchupStatus': '', 'absenceReport': None}
        sources = MagicMock()
        sources.all_learners.filter.return_value = [self.source]
        with patch.object(reminders, 'EnrolmentUser', sources), \
             patch.object(reminders, 'connections', {'enrolment': self.connection}), \
             patch.object(reminders, 'is_configured', return_value=True), \
             patch.object(reminders, 'read_workspace', return_value={
                 'mode': {'available': True, 'remindersEnabled': True}, 'lectures': [lecture, lecture]}), \
             patch.object(reminders, '_state', return_value={'mode': 'live' if enabled else 'lazy'}) as state, \
             patch.object(reminders, 'send_mail', return_value=(True, '')) as send:
            reminders.Command().handle(learner_id=[12], send=True)
        return send, state

    def test_duplicate_reminder_claims_send_once_and_use_canonical_id(self):
        self.cur.fetchone.side_effect = [(91,), None]
        send, state = self.run_reminders()
        send.assert_called_once()
        for call in self.cur.execute.call_args_list:
            self.assertEqual(call.args[1][0], 91)
            self.assertIn('ON CONFLICT DO NOTHING', call.args[0])
        self.assertEqual(state.call_count, 2)
        state.assert_called_with(self.cur, 91, lock=True)

    def test_mode_change_under_lock_prevents_reminder(self):
        send, state = self.run_reminders(enabled=False)
        send.assert_not_called()
        self.cur.fetchone.assert_not_called()
        state.assert_called_once_with(self.cur, 91, lock=True)

    def test_ambiguous_reminder_identity_stops_before_claim_or_email(self):
        self.profiles.filter.return_value.values_list.return_value = [91, 92]
        with self.assertRaises(CommandError):
            self.run_reminders()
        self.cur.execute.assert_not_called()
