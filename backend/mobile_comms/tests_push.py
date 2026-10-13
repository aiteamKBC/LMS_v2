from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import Mock
import requests
from .push import FcmSender

class PushTransportTests(TestCase):
    def setUp(self):
        self.sender = object.__new__(FcmSender)
        self.sender.project_id = 'synthetic-project'
        self.sender.credentials = SimpleNamespace(valid=True, token='synthetic')
        self.sender.http = Mock()
        self.notice = SimpleNamespace(pk=123, account_id=41, body='You have a new KBC message.', category='private_messages')

    def result(self, status, body, headers=None):
        self.sender.http.post.return_value = SimpleNamespace(status_code=status, json=lambda:body, headers=headers or {})
        return self.sender.send('synthetic-device', self.notice)

    def test_minimum_payload_and_accepted_result(self):
        result=self.result(200, {'name':'projects/synthetic/messages/123'})
        self.assertEqual(result.state,'sent')
        sent=self.sender.http.post.call_args.kwargs
        self.assertFalse(sent['allow_redirects'])
        self.assertEqual(sent['json']['message']['data'],{'accountId':'41','notificationId':'123','screen':'notifications'})
        self.assertEqual(sent['json']['message']['android']['ttl'],'600s')

    def test_unregistered_device_is_retired(self):
        self.assertEqual(self.result(404,{'error':{'details':[{'errorCode':'UNREGISTERED'}]}}).state,'invalid-device')

    def test_config_failure_is_not_claimed_delivered(self):
        self.assertEqual(self.result(403,{'error':{'status':'PERMISSION_DENIED'}}).state,'configuration-error')

    def test_provider_backoff(self):
        self.assertEqual(self.result(429,{}, {'Retry-After':'120'}).retry_seconds,120)

    def test_invalid_payload_is_not_retried_forever(self):
        self.assertEqual(self.result(400,{}).state,'rejected')

    def test_network_error_is_retryable(self):
        self.sender.http.post.side_effect=requests.Timeout()
        self.assertEqual(self.sender.send('synthetic',self.notice).state,'retry')

    def test_validate_only_cannot_deliver(self):
        self.result(200,{'name':'test'})
        self.sender.send('synthetic',self.notice,validate_only=True)
        self.assertTrue(self.sender.http.post.call_args.kwargs['json']['validate_only'])
