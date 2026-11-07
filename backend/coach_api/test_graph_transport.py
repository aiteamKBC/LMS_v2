"""Synthetic transport responses only: no Django, database, network or sleeps."""
import io
import json
from datetime import datetime, timezone
from email.message import Message
from unittest import TestCase, main
from unittest.mock import Mock
from urllib import error, request

from coach_api.graph_transport import html_error_details, read_graph_response, retry_after_seconds


def failure(status, retry_after=None, body=b'<h2>Application Request Queue Full</h2>'):
    headers = Message()
    if retry_after is not None:
        headers['Retry-After'] = str(retry_after)
    return error.HTTPError('https://graph.microsoft.com/v1.0/users/OWNER/events', status, 'upstream failure', headers, io.BytesIO(body))


class GraphTransportTests(TestCase):
    def call(self, sequence, method='POST', path='users/OWNER/events', body=None):
        payload = body if body is not None else {'transactionId': 'SYNTHETIC-TRANSACTION', 'attendees': []}
        req = request.Request('https://graph.microsoft.com/v1.0/' + path,
                              data=json.dumps(payload).encode() if method != 'GET' else None,
                              headers={'Authorization': 'Bearer synthetic', 'Prefer': 'outlook.send-invitations="none"'}, method=method)
        self.opener, self.sleep = Mock(side_effect=sequence), Mock()
        return read_graph_response(req, opener=self.opener, sleep=self.sleep, clock=lambda: 100, jitter=lambda: 0)

    def test_busy_create_recovers_on_a_fresh_connection_with_the_same_identity_and_payload(self):
        self.assertEqual(self.call([failure(503, 1), io.BytesIO(b'{"id":"SAVED"}')]), b'{"id":"SAVED"}')
        self.sleep.assert_called_once_with(1)
        first, second = [call.args[0] for call in self.opener.call_args_list]
        self.assertIsNot(first, second)
        self.assertEqual(first.data, second.data)
        self.assertEqual(first.full_url, second.full_url)
        self.assertEqual(dict(first.header_items()), dict(second.header_items()))
        self.assertEqual(json.loads(second.data)['transactionId'], 'SYNTHETIC-TRANSACTION')

    def test_read_retries_without_a_creation_key(self):
        self.assertEqual(self.call([failure(429, 0), io.BytesIO(b'{}')], method='GET'), b'{}')

    def test_retry_after_longer_than_worker_budget_is_not_shortened(self):
        with self.assertRaises(error.HTTPError):
            self.call([failure(503, 120)])
        self.assertEqual(self.opener.call_count, 1)
        self.sleep.assert_not_called()

    def test_forbidden_and_bad_requests_do_not_retry(self):
        for status in (400, 401, 403, 404, 409):
            with self.subTest(status=status), self.assertRaises(error.HTTPError):
                self.call([failure(status)])
            self.assertEqual(self.opener.call_count, 1)
            self.sleep.assert_not_called()

    def test_unidentified_creates_forwards_options_and_cancellations_do_not_retry(self):
        for method, path, body in [('POST', 'users/OWNER/events', {}),
            ('POST', 'users/OWNER/events/E/forward', None), ('POST', 'users/OWNER/events/E/cancel', None),
            ('PATCH', 'users/OWNER/onlineMeetings/M', None), ('DELETE', 'users/OWNER/events/E', None)]:
            with self.subTest(path=path), self.assertRaises(error.HTTPError):
                self.call([failure(503)], method=method, path=path, body=body)
            self.assertEqual(self.opener.call_count, 1)

    def test_attempts_are_bounded_and_an_unconfirmed_write_stays_uncertain(self):
        with self.assertRaises(error.HTTPError) as raised:
            self.call([failure(503), failure(503), failure(503)])
        self.assertEqual(self.opener.call_count, 3)
        self.assertEqual(self.sleep.call_count, 2)
        self.assertTrue(raised.exception.graph_write_uncertain)

    def test_earlier_ambiguous_write_is_not_erased_by_a_later_validation_error(self):
        with self.assertRaises(error.HTTPError) as raised:
            self.call([failure(503), failure(400)])
        self.assertTrue(raised.exception.graph_write_uncertain)

    def test_body_timeout_retries_the_same_identified_create(self):
        response = Mock()
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        response.read.side_effect = TimeoutError('synthetic timeout')
        self.assertEqual(self.call([response, io.BytesIO(b'{}')]), b'{}')
        self.assertEqual(self.opener.call_count, 2)

    def test_http_date_header_uses_utc_and_invalid_values_use_backoff(self):
        now = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
        self.assertEqual(retry_after_seconds({'Retry-After': 'Fri, 30 Oct 2026 12:00:04 GMT'}, now), 4)
        self.assertIsNone(retry_after_seconds({'Retry-After': '-1'}, now))

    def test_upstream_html_is_not_a_user_message(self):
        code, message = html_error_details('<HTML><BODY><h2>Application Request Queue Full</h2></BODY></HTML>', 503)
        self.assertEqual(code, 'ApplicationRequestQueueFull')
        self.assertNotIn('<', message)
        self.assertNotIn('BODY', message)


if __name__ == '__main__':
    main()
