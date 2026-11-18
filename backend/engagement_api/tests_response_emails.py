"""Outbound feedback email contracts. All storage and network calls are mocked."""
from contextlib import nullcontext
import base64
import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase
from django.db import DatabaseError
from django.utils import timezone

from . import permissions, response_emails as emails


def response(**changes):
    return SimpleNamespace(**{
        'pk': 1, 'id': 1, 'form': SimpleNamespace(anonymous_responses=False, form_type='post_lecture'),
        'status': 'completed', 'learner_id': '17', 'learner_name': 'Example Learner',
        'employer_review_delivery': None, 'event_recipient_id': None, 'rsvp_recipient_id': None,
        **changes,
    })


class ResponseEmailTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.response = response()
        self.account = SimpleNamespace(pk=9, role='staff', display_name='Example Staff')
        self.recipient = {'name': 'Example Learner', 'email': 'learner@example.test'}
        self.payload = {'requestId': str(uuid4()), 'subject': 'Following up', 'body': 'Thank you for your feedback.',
                        'expectedRecipient': self.recipient['email']}
        self.entries = {}
        self.manager = MagicMock()
        self.manager.select_related.return_value.get.return_value = self.response
        self.manager.select_for_update.return_value.get.return_value = self.response
        self.store = MagicMock()
        self.store.filter.side_effect = self._filter
        self.store.create.side_effect = self._create
        patches = [
            patch.object(emails.FeedbackResponse, 'objects', self.manager),
            patch.object(emails.FeedbackResponseEmail, 'objects', self.store),
            patch.object(emails.transaction, 'atomic', return_value=nullcontext()),
            patch.object(emails, 'recipient_for_response', return_value=(self.recipient, '')),
            patch.object(emails, '_send', return_value=(True, None)),
            patch.object(emails, 'authenticate_request', return_value=self.account),
            patch.object(permissions, 'authenticate_request', return_value=self.account),
            patch('httpx.post', side_effect=AssertionError('Unexpected live email request')),
            patch.object(emails, 'close_response_ticket', return_value='closed'),
        ]
        self.mocks = [item.start() for item in patches]
        for item in patches:
            self.addCleanup(item.stop)
        self.send = self.mocks[4]
        self.close_ticket = self.mocks[-1]
        self.store.select_for_update.return_value.get.side_effect = lambda pk: self.entries[pk]
        self.manager.get.return_value = self.response
        self.store.get.side_effect = self._get_entry

    def _get_entry(self, pk, response_id):
        entry = self.entries.get(pk)
        if entry is None or entry.response_id != response_id:
            raise emails.FeedbackResponseEmail.DoesNotExist()
        return entry

    def _filter(self, **kwargs):
        query = MagicMock()
        if 'pk' in kwargs:
            query.first.return_value = self.entries.get(kwargs['pk'])
        else:
            query.order_by.return_value = list(self.entries.values())
        return query

    def _create(self, **kwargs):
        entry = SimpleNamespace(**kwargs, response_id=kwargs['response'].pk,
            pk=kwargs['id'], created_at=timezone.now(), sent_at=None, error='', save=MagicMock(),
            ticket_close_status='not_required', ticket_close_error='')
        self.entries[entry.id] = entry
        return entry

    def call(self, payload=None, method='POST', csrf=True):
        request = self.factory.get('/') if method == 'GET' else self.factory.post(
            '/', json.dumps(payload if payload is not None else self.payload), content_type='application/json')
        request._dont_enforce_csrf_checks = csrf
        return emails.response_emails(request, pk=1)

    def test_authentication_and_role_are_checked_before_reading_respondent(self):
        for account, status in [(None, 401), (SimpleNamespace(role='learner'), 403),
                                (SimpleNamespace(role='employer'), 403)]:
            with patch.object(permissions, 'authenticate_request', return_value=account):
                for method in ('GET', 'POST'):
                    self.assertEqual(self.call(method=method).status_code, status)
        self.manager.select_related.assert_not_called()
        self.send.assert_not_called()

    def test_csrf_is_required_for_sending(self):
        self.assertEqual(self.call(csrf=False).status_code, 403)
        self.send.assert_not_called()

    def test_staff_and_admin_can_read_context_and_response_scoped_history(self):
        for role in ('staff', 'admin'):
            self.account.role = role
            result = self.call(method='GET')
            self.assertEqual(result.status_code, 200)
            self.assertEqual(result['Cache-Control'], 'private, no-store')
            data = json.loads(result.content)
            self.assertEqual(data['sender'], emails.QUALITY_MAILBOX)
            self.assertEqual(data['replyTo'], emails.QUALITY_MAILBOX)
            self.assertEqual(data['recipient'], self.recipient)
            self.store.filter.assert_called_with(response=self.response)
        self.send.assert_not_called()

    def test_email_claim_is_committed_before_send_and_retry_does_not_send_twice(self):
        def send(entry):
            self.assertIs(self.entries[entry.id], entry)
            self.assertEqual(entry.status, 'sending')
            self.assertEqual(entry.sender_email, emails.QUALITY_MAILBOX)
            self.assertEqual(entry.recipient_email, self.recipient['email'])
            return True, None
        self.send.side_effect = send
        for _ in range(2):
            result = self.call()
            self.assertIn(result.status_code, (200, 201))
            self.assertEqual(json.loads(result.content)['email']['status'], 'sent')
        self.send.assert_called_once()
        self.store.create.assert_called_once()

    def test_retry_identity_cannot_be_reused_for_another_message_actor_or_response(self):
        self.call()
        for changed in ({'subject': 'Other'}, {'body': 'Different'}):
            self.assertEqual(self.call(self.payload | changed).status_code, 409)
        self.account.pk = 99
        self.assertEqual(self.call().status_code, 409)
        self.account.pk = 9
        self.response.pk = 2
        self.assertEqual(self.call().status_code, 409)
        self.send.assert_called_once()

    def test_client_cannot_override_recipient_sender_or_reply_address(self):
        for key in ('to', 'from', 'replyTo', 'learnerId'):
            self.assertEqual(self.call(self.payload | {key: 'other@example.test'}).status_code, 400)
        self.assertEqual(self.call(self.payload | {'expectedRecipient': 'other@example.test'}).status_code, 409)
        self.send.assert_not_called()

    def test_validation_rejects_invalid_requests_without_sending(self):
        for changes in ({'subject': ''}, {'subject': 'Header\nInjection'}, {'subject': 's' * 256},
                        {'body': ''}, {'body': 'x' * 10001}, {'requestId': 'bad'}, {'requestId': []}):
            self.assertEqual(self.call(self.payload | changes).status_code, 400)
        self.send.assert_not_called()

    def test_anonymous_response_does_not_expose_history_or_send(self):
        with patch.object(emails, 'recipient_for_response', return_value=(None, 'Anonymous feedback.')):
            data = json.loads(self.call(method='GET').content)
            self.assertIsNone(data['recipient'])
            self.assertEqual(data['emails'], [])
            self.assertEqual(self.call().status_code, 409)
        self.store.filter.assert_not_called()
        self.send.assert_not_called()

    def test_rejected_send_is_recorded_and_same_request_does_not_resend(self):
        self.send.return_value = False, 'graph 403: PRIVATE provider detail'
        data = json.loads(self.call().content)['email']
        self.assertEqual(data['status'], 'failed')
        self.assertNotIn('PRIVATE', data['error'])
        self.call()
        self.send.assert_called_once()

    def test_timeout_or_exception_is_unknown_and_never_automatically_resent(self):
        self.send.side_effect = RuntimeError('PRIVATE transport detail')
        data = json.loads(self.call().content)['email']
        self.assertEqual(data['status'], 'unknown')
        self.assertIn('Sent Items', data['error'])
        self.assertNotIn('PRIVATE', data['error'])
        self.call()
        self.send.assert_called_once()

    def test_missing_configuration_is_a_visible_failure(self):
        self.send.return_value = False, 'not-configured'
        data = json.loads(self.call().content)['email']
        self.assertEqual(data['status'], 'failed')
        self.assertIsNone(data['sentAt'])

    def test_missing_response_and_unavailable_history_are_visible_errors(self):
        self.manager.select_related.return_value.get.side_effect = emails.FeedbackResponse.DoesNotExist
        self.assertEqual(self.call(method='GET').status_code, 404)
        self.manager.select_related.return_value.get.side_effect = DatabaseError('PRIVATE connection info')
        result = self.call(method='GET')
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('PRIVATE', result.content.decode())
        self.send.assert_not_called()

    def test_a_persisted_sending_claim_is_not_sent_again(self):
        self.call()
        entry = next(iter(self.entries.values()))
        entry.status, entry.sent_at = 'sending', None
        self.send.reset_mock()
        result = self.call()
        self.assertEqual(json.loads(result.content)['email']['status'], 'sending')
        self.send.assert_not_called()

    def test_only_an_accepted_send_closes_the_same_response_ticket_once(self):
        result = json.loads(self.call().content)['email']
        self.assertEqual(result['qualityTicket']['status'], 'closed')
        self.close_ticket.assert_called_once_with(self.response, actor_name='Example Staff')
        self.call()
        self.close_ticket.assert_called_once()
        self.send.assert_called_once()

    def test_rejected_unknown_and_unconfigured_messages_do_not_close_tickets(self):
        for detail in ('graph 403', 'unknown', 'not-configured'):
            self.payload['requestId'] = str(uuid4())
            self.send.return_value = False, detail
            data = json.loads(self.call().content)['email']
            self.assertEqual(data['qualityTicket']['status'], 'not_required')
        self.close_ticket.assert_not_called()

    def test_ticket_sync_failure_keeps_mail_sent_and_retries_without_resending(self):
        self.close_ticket.side_effect = [RuntimeError('PRIVATE connection details'), 'closed']
        data = json.loads(self.call().content)['email']
        self.assertEqual(data['status'], 'sent')
        self.assertEqual(data['qualityTicket']['status'], 'failed')
        self.assertNotIn('PRIVATE', data['qualityTicket']['error'])
        self.assertEqual(json.loads(self.call(method='GET').content)['emails'][0]['qualityTicket']['status'], 'failed')
        data = json.loads(self.call().content)['email']
        self.assertEqual(data['qualityTicket']['status'], 'closed')
        self.send.assert_called_once()

    def retry_close(self, method='POST', csrf=True, response_id=1):
        request = self.factory.generic(method, '/')
        request._dont_enforce_csrf_checks = csrf
        entry = next(iter(self.entries.values()))
        return emails.retry_ticket_close(request, pk=response_id, email_id=entry.id)

    def test_dedicated_retry_closes_ticket_without_sending_mail(self):
        self.close_ticket.side_effect = [RuntimeError('offline'), 'closed']
        self.call()
        self.assertEqual(self.retry_close(csrf=False).status_code, 403)
        self.assertEqual(self.retry_close(method='GET').status_code, 405)
        self.assertEqual(self.retry_close(response_id=2).status_code, 404)
        for account, status in [(None, 401), (SimpleNamespace(role='learner'), 403),
                                (SimpleNamespace(role='employer'), 403)]:
            with patch.object(permissions, 'authenticate_request', return_value=account):
                self.assertEqual(self.retry_close().status_code, status)
        data = json.loads(self.retry_close().content)['email']
        self.assertEqual(data['qualityTicket']['status'], 'closed')
        self.send.assert_called_once()
        self.assertEqual(self.close_ticket.call_count, 2)

    def test_retry_endpoint_requires_accepted_mail_and_never_closes_historical_mail(self):
        self.send.return_value = False, 'unknown'
        self.call()
        self.assertEqual(self.retry_close().status_code, 409)
        entry = next(iter(self.entries.values()))
        entry.status = 'sent'  # Historical rows default to not_required.
        self.assertEqual(self.retry_close().status_code, 200)
        self.close_ticket.assert_not_called()


class ResponseEmailRecipientTests(SimpleTestCase):
    def test_commercial_and_apprentice_learner_lookup_uses_all_learners(self):
        for learner_type in ('commercial', 'apprenticeship'):
            learner = SimpleNamespace(email='learner@example.test', username='Example', learner_type=learner_type)
            with patch.object(emails.EnrolmentUser.all_learners, 'filter') as learners:
                learners.return_value.first.return_value = learner
                recipient, reason = emails.recipient_for_response(response())
                self.assertEqual(recipient['email'], learner.email)
                self.assertEqual(reason, '')
                learners.assert_called_once_with(pk=17)

    def test_employer_and_event_respondents_are_never_addressed_as_the_related_learner(self):
        cases = [
            (response(form=SimpleNamespace(anonymous_responses=False, form_type='post_progress_review_employer'),
                employer_review_delivery=SimpleNamespace(employer_email='employer@example.test', employer_name='Employer')), 'employer@example.test'),
            (response(event_recipient_id=3, event_recipient=SimpleNamespace(attendee_email='guest@example.test', attendee_name='Guest')), 'guest@example.test'),
            (response(rsvp_recipient_id=4, rsvp_recipient=SimpleNamespace(recipient_email='rsvp@example.test', recipient_name='RSVP guest')), 'rsvp@example.test'),
        ]
        with patch.object(emails.EnrolmentUser.all_learners, 'filter') as learners:
            for item, expected in cases:
                self.assertEqual(emails.recipient_for_response(item)[0]['email'], expected)
            learners.assert_not_called()

    def test_anonymous_incomplete_and_invalid_address_are_unavailable(self):
        for item in (response(form=SimpleNamespace(anonymous_responses=True)), response(status='in_progress'),
                     response(learner_id='guest:7'), response(learner_id='')):
            self.assertIsNone(emails.recipient_for_response(item)[0])

    def test_body_is_escaped_sender_reply_to_are_fixed_and_sent_items_are_kept(self):
        entry = SimpleNamespace(recipient_email='learner@example.test', subject='Follow up', body='<script>bad</script>')
        with patch.object(emails.email_azure, 'is_configured', return_value=True), \
             patch.object(emails, 'quality_mail_config', return_value=None), \
             patch.object(emails.email_azure, 'send_mail', return_value=(True, None)) as send:
            self.assertEqual(emails._send(entry), (True, None))
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs['sender_mailbox'], emails.QUALITY_MAILBOX)
        self.assertEqual(kwargs['reply_to'], emails.QUALITY_MAILBOX)
        self.assertTrue(kwargs['save_to_sent'])
        self.assertTrue(kwargs['redact_logs'])
        self.assertNotIn('<script>', kwargs['html_body'])
        self.assertIn('&lt;script&gt;', kwargs['html_body'])


class QualityEmailBrandingTests(SimpleTestCase):
    def test_branded_template_preserves_escaped_message_lines_and_reply_details(self):
        entry = SimpleNamespace(subject='Follow-up <example>', body='Hello <b>Example</b>,\r\n\r\nYour feedback & next steps.\nThank you.')
        html, text = emails.render_quality_email(entry)
        self.assertIn('<title>Follow-up &lt;example&gt;</title>', html)
        self.assertIn('Hello &lt;b&gt;Example&lt;/b&gt;,<br><br>Your feedback &amp; next steps.<br>Thank you.', html)
        self.assertNotIn('<b>Example</b>', html)
        self.assertTrue(text.startswith(entry.body))
        self.assertIn(f'src="cid:{emails.email_azure.BRAND_LOGO_CID}"', html)
        self.assertIn('alt="Kent Business College"', html)
        self.assertNotIn('src="http', html)
        self.assertNotIn('<script', html)
        self.assertNotIn('do not reply', html.lower())
        self.assertIn(f'href="mailto:{emails.QUALITY_MAILBOX}"', html)
        self.assertIn(emails.QUALITY_MAILBOX, text)

    def test_logo_is_embedded_in_the_actual_graph_payload_with_the_original_message_contract(self):
        entry = SimpleNamespace(subject='Following up on your feedback', body='Hello Example,\n\nThank you for sharing your feedback.',
                                recipient_email='learner@example.test')
        config = {'tenant_id': 'test-tenant', 'client_id': 'test-client', 'client_secret': 'test-secret',
                  'sender': 'system@example.test', 'enabled': True}
        with patch.object(emails, 'quality_mail_config', return_value=None), \
             patch.object(emails.email_azure, 'mail_config', return_value=config), \
             patch.object(emails.email_azure, '_access_token', return_value='synthetic-token'), \
             patch.object(emails.email_azure.httpx, 'post', return_value=SimpleNamespace(status_code=202)) as post:
            self.assertEqual(emails._send(entry), (True, None))
        payload = post.call_args.kwargs['json']
        message = payload['message']
        self.assertEqual(message['subject'], entry.subject)
        self.assertEqual(message['toRecipients'], [{'emailAddress': {'address': entry.recipient_email}}])
        self.assertEqual(message['replyTo'], [{'emailAddress': {'address': emails.QUALITY_MAILBOX}}])
        self.assertTrue(payload['saveToSentItems'])
        logo, = message['attachments']
        self.assertEqual(logo['contentId'], emails.email_azure.BRAND_LOGO_CID)
        self.assertTrue(logo['isInline'])
        self.assertEqual(logo['contentType'], 'image/png')
        self.assertTrue(base64.b64decode(logo['contentBytes']).startswith(b'\x89PNG'))


class QualityMailConfigurationTests(SimpleTestCase):
    def test_undeclared_quality_settings_preserve_existing_app(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(emails.quality_mail_config())

    def test_quality_settings_are_isolated_from_login_credentials(self):
        env = {'QUALITY_MAIL_TENANT_ID': 'quality-tenant', 'QUALITY_MAIL_CLIENT_ID': 'quality-client',
               'QUALITY_MAIL_CLIENT_SECRET': 'quality-value', 'QUALITY_MAIL_ENABLED': 'true',
               'AZURE_MAIL_CLIENT_ID': 'login-client', 'AZURE_MAIL_CLIENT_SECRET': 'login-value'}
        with patch.dict(os.environ, env, clear=True):
            config = emails.quality_mail_config()
        self.assertEqual(config['tenant_id'], 'quality-tenant')
        self.assertEqual(config['client_id'], 'quality-client')
        self.assertEqual(config['client_secret'], 'quality-value')
        self.assertEqual(config['sender'], emails.QUALITY_MAILBOX)
        self.assertTrue(config['enabled'])

    def test_partial_quality_config_does_not_fall_back_or_reach_mail_transport(self):
        env = {'QUALITY_MAIL_CLIENT_ID': 'quality-client', 'AZURE_MAIL_TENANT_ID': 'login-tenant',
               'AZURE_MAIL_CLIENT_ID': 'login-client', 'AZURE_MAIL_CLIENT_SECRET': 'login-secret',
               'AZURE_MAIL_SENDER': 'system@example.test'}
        with patch.dict(os.environ, env, clear=True), \
             patch.object(emails.email_azure, 'send_mail') as send:
            self.assertEqual(emails._send(SimpleNamespace()), (False, 'not-configured'))
        send.assert_not_called()

    def test_quality_and_global_mail_disable_flags_are_respected(self):
        base = {'QUALITY_MAIL_TENANT_ID': 'quality-tenant', 'QUALITY_MAIL_CLIENT_ID': 'quality-client',
                'QUALITY_MAIL_CLIENT_SECRET': 'quality-value'}
        for disabled in ('QUALITY_MAIL_ENABLED', 'AZURE_MAIL_ENABLED'):
            with patch.dict(os.environ, {**base, disabled: 'false'}, clear=True):
                self.assertFalse(emails.quality_mail_config()['enabled'])


class ResponseEmailPostgreSQLLockTests(SimpleTestCase):
    def test_lock_sql_is_valid_for_schema_qualified_response_tables_without_nullable_joins(self):
        # Compile the real production queryset against the PostgreSQL backend.
        # No connection is opened and no application rows are read or written.
        from django.db.backends.postgresql.base import DatabaseWrapper

        db = DatabaseWrapper({'NAME': 'unused', 'ENGINE': 'django.db.backends.postgresql'},
                             alias='feedback_email_sql_test')
        with patch.object(db, 'get_autocommit', return_value=False), \
             patch.object(db, 'ensure_connection', side_effect=AssertionError('No live database in this test')):
            sql, params = emails._responses_for_send().filter(pk=-1).query.get_compiler(connection=db).as_sql()
        self.assertIn('"Feedback"."feedback_responses"', sql)
        self.assertIn('FOR UPDATE', sql)
        self.assertNotIn('FOR UPDATE OF', sql)
        self.assertNotIn(' JOIN ', sql)
        self.assertEqual(params, (-1,))
