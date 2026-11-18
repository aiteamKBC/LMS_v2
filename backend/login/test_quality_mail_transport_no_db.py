from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from . import email_azure as mail


class QualityMailTransportTests(SimpleTestCase):
    def test_dedicated_app_is_used_for_the_quality_send(self):
        config = {'tenant_id': 'quality-tenant', 'client_id': 'quality-client',
                  'client_secret': 'synthetic-secret', 'sender': 'quality@example.test', 'enabled': True}
        with patch.object(mail, '_access_token', return_value='quality-token') as token, \
             patch.object(mail.httpx, 'post', return_value=Mock(status_code=202)) as post:
            result = mail.send_mail(to='respondent@example.test', subject='Follow up', html_body='Hello',
                configuration=config, redact_logs=True)
        self.assertTrue(result[0])
        token.assert_called_once_with(configuration=config)
        self.assertTrue(post.call_args.args[0].endswith('/users/quality@example.test/sendMail'))
        self.assertEqual(post.call_args.kwargs['headers']['Authorization'], 'Bearer quality-token')

    def test_app_credentials_and_rotated_secrets_do_not_share_a_cached_token(self):
        default = {'tenant_id': 'login-tenant', 'client_id': 'login-client', 'client_secret': 'login-secret',
                   'sender': 'system@example.test', 'enabled': True}
        quality = {**default, 'client_id': 'quality-client', 'client_secret': 'quality-secret'}
        response = Mock(status_code=200)
        response.json.side_effect = [
            {'access_token': 'login-token', 'expires_in': 3600},
            {'access_token': 'quality-token', 'expires_in': 3600},
            {'access_token': 'rotated-quality-token', 'expires_in': 3600},
        ]
        with patch.object(mail, 'mail_config', return_value=default), \
             patch.object(mail, '_token_cache', {'value': None, 'expires_at': 0}), \
             patch.object(mail, '_application_token_caches', {}), \
             patch.object(mail.httpx, 'post', return_value=response) as post:
            self.assertEqual(mail._access_token(), 'login-token')
            self.assertEqual(mail._access_token(configuration=quality), 'quality-token')
            self.assertEqual(mail._access_token(), 'login-token')
            self.assertEqual(mail._access_token(configuration=quality), 'quality-token')
            self.assertEqual(mail._access_token(configuration={**quality, 'client_secret': 'rotated-secret'}), 'rotated-quality-token')
            self.assertEqual(post.call_count, 3)
            self.assertEqual([call.kwargs['data']['client_id'] for call in post.call_args_list],
                             ['login-client', 'quality-client', 'quality-client'])

    def test_quality_sender_and_reply_to_do_not_change_the_configured_default(self):
        config = {'sender': 'system@example.test'}
        with patch.object(mail, 'mail_config', return_value=config), \
             patch.object(mail, 'is_configured', return_value=True), \
             patch.object(mail, '_access_token', return_value='synthetic-token'), \
             patch.object(mail.httpx, 'post', return_value=Mock(status_code=202)) as post:
            for options, sender in [({}, 'system@example.test'),
                ({'sender_mailbox': 'quality@example.test', 'reply_to': 'quality@example.test', 'redact_logs': True}, 'quality@example.test')]:
                result = mail.send_mail(to='respondent@example.test', subject='Follow up', html_body='Hello', **options)
                self.assertTrue(result[0])
                self.assertTrue(post.call_args.args[0].endswith(f'/users/{sender}/sendMail'))
                message = post.call_args.kwargs['json']['message']
                if options:
                    self.assertEqual(message['replyTo'], [{'emailAddress': {'address': sender}}])
                else:
                    self.assertNotIn('replyTo', message)
        self.assertEqual(config['sender'], 'system@example.test')

    def test_private_feedback_does_not_leak_into_transport_logs(self):
        with patch.object(mail, 'is_configured', return_value=False), \
             patch.object(mail, 'missing_settings', return_value=['AZURE_MAIL_SENDER']), \
             self.assertLogs('login.email', level='WARNING') as logs:
            mail.send_mail(to='PRIVATE@example.test', subject='PRIVATE subject',
                html_body='PRIVATE body', redact_logs=True)
        self.assertNotIn('PRIVATE', '\n'.join(logs.output))
