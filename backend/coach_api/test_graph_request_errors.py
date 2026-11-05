"""The real Graph adapter with synthetic responses and no external effects."""
import io
import json
from email.message import Message
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from django.test import SimpleTestCase

from . import views
from .graph_transport import GraphRequestError


class GraphRequestRecoveryTests(SimpleTestCase):
    def call(self, responses, method='POST'):
        with patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
             patch.object(views, 'microsoft_graph_token', return_value='synthetic-token'), \
             patch.object(views, 'metric_event'), \
             patch.object(views.urllib_request, 'urlopen', side_effect=responses) as opened, \
             patch('coach_api.graph_transport.time.sleep'), patch('coach_api.graph_transport.random.random', return_value=0):
            self.opened = opened
            return views.microsoft_graph_request(method, 'users/OWNER/events',
                payload={'transactionId': 'SYNTHETIC', 'attendees': []} if method == 'POST' else None)

    def refusal(self, status=503):
        headers = Message()
        headers['request-id'] = 'SYNTHETIC-REFERENCE'
        return HTTPError('https://graph.microsoft.com/v1.0/users/OWNER/events', status, 'busy', headers,
                         io.BytesIO(b'<!DOCTYPE HTML><HTML><BODY><h2>Application Request Queue Full</h2></BODY></HTML>'))

    def test_transient_create_uses_one_identity_and_returns_the_confirmed_calendar(self):
        self.assertEqual(self.call([self.refusal(), io.BytesIO(b'{"id":"SAVED"}')]), {'id': 'SAVED'})
        requests = [item.args[0] for item in self.opened.call_args_list]
        self.assertEqual(len(requests), 2)
        self.assertEqual(requests[0].data, requests[1].data)
        self.assertEqual(json.loads(requests[1].data)['transactionId'], 'SYNTHETIC')

    def test_exhausted_service_error_preserves_uncertainty_and_drops_raw_html(self):
        with self.assertRaises(GraphRequestError) as raised:
            self.call([self.refusal(), self.refusal(), self.refusal()])
        error = raised.exception
        self.assertEqual(error.status_code, 503)
        self.assertTrue(error.uncertain)
        self.assertEqual(error.request_id, 'SYNTHETIC-REFERENCE')
        self.assertIn('ApplicationRequestQueueFull', str(error))
        self.assertNotIn('<HTML>', str(error))
        self.assertNotIn('<!DOCTYPE', str(error))

    def test_read_failure_cannot_be_mistaken_for_an_uncertain_creation(self):
        with self.assertRaises(GraphRequestError) as raised:
            self.call([self.refusal(), self.refusal(), self.refusal()], method='GET')
        self.assertFalse(raised.exception.uncertain)

    def test_validation_error_is_definitive_and_is_not_retried(self):
        response = HTTPError('https://graph.microsoft.com/v1.0/users/OWNER/events', 400, 'invalid', Message(),
            io.BytesIO(b'{"error":{"code":"ErrorInvalidRequest","message":"Invalid synthetic date."}}'))
        with self.assertRaises(GraphRequestError) as raised:
            self.call([response])
        self.assertEqual(self.opened.call_count, 1)
        self.assertFalse(raised.exception.uncertain)
        self.assertIn('ErrorInvalidRequest', str(raised.exception))
