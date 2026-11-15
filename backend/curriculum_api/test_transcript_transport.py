"""Graph's compressed IDs must resolve to exactly the same bounded identity."""
import base64
from contextlib import contextmanager
from io import BytesIO
from unittest import TestCase
from unittest.mock import Mock
from urllib.error import HTTPError
from urllib.request import Request

import msgpack

from .transcript_transport import (
    MAX_ID_BYTES, _lz4_block, normalized_transcript_url, open_transcript,
    transcript_stream, uncompressed_resource_id,
)


def resource_id(identity, *, blocks=1):
    raw = msgpack.packb(identity, use_bin_type=True)
    chunks = [raw[index * len(raw) // blocks:(index + 1) * len(raw) // blocks]
              for index in range(blocks)]
    compressed = []
    for chunk in chunks:
        size = len(chunk)
        length = bytearray([min(size, 15) << 4])
        if size >= 15:
            remaining = size - 15
            while remaining >= 255:
                length.append(255)
                remaining -= 255
            length.append(remaining)
        compressed.append(bytes(length) + chunk)
    envelope = [msgpack.ExtType(98, b''.join(msgpack.packb(len(chunk)) for chunk in chunks)), *compressed]
    return (base64.urlsafe_b64encode(msgpack.packb(envelope)).decode().rstrip('='),
            base64.urlsafe_b64encode(raw).decode().rstrip('='))


class TranscriptIdentityTests(TestCase):
    def setUp(self):
        self.compressed, self.canonical = resource_id(['tenant-test', 'meeting-test', 2026, b'call-test'])
        self.url = 'https://graph.microsoft.com/v1.0/users/owner/onlineMeetings/meeting/transcripts/' + self.compressed + '/content?$format=text/vtt'

    def test_literal_and_multiple_blocks_preserve_serialized_identity(self):
        for count in (1, 2, 3):
            compressed, canonical = resource_id(['meeting-test', 'x' * 600, b'\x00\xff'], blocks=count)
            self.assertEqual(uncompressed_resource_id(compressed), canonical)

    def test_lz4_overlapping_match_and_literals(self):
        self.assertEqual(_lz4_block(b'\x50aaaaa\x01\x00\x10Z', 10), b'aaaaaaaaaZ')

    def test_invalid_blocks_are_bounded(self):
        for block, size in ((b'\xf0', 5), (b'\x50x', 5), (b'\x10x\x00\x00', 5),
                            (b'\x10x\x02\x00', 5), (b'\x1fx\x01\x00\xff', 5),
                            (b'\x10x\x01', 5), (b'\x10x', 2), (b'\x00', 0),
                            (b'\x00', MAX_ID_BYTES + 1), ('wrong-type', 1)):
            with self.subTest(block=block, size=size), self.assertRaises(ValueError):
                _lz4_block(block, size)

    def test_unsupported_malformed_and_oversized_ids_have_no_fallback(self):
        malformed = [None, '', '!', 'x' * (MAX_ID_BYTES + 1), self.canonical]
        for value in ([msgpack.ExtType(99, b'\x01'), b'x'],
                      [msgpack.ExtType(98, msgpack.packb(MAX_ID_BYTES + 1)), b'\x00'],
                      [msgpack.ExtType(98, b'\x01'), b'\x10x'],
                      [msgpack.ExtType(98, b'\x01\x01'), b'\x10x'],
                      [msgpack.ExtType(98, b'\xff'), b'\x10x']):
            malformed.append(base64.urlsafe_b64encode(msgpack.packb(value)).decode())
        for value in malformed:
            with self.subTest(value=str(value)[:30]):
                self.assertIsNone(uncompressed_resource_id(value))

    def test_only_id_changes_and_query_owner_meeting_remain_identical(self):
        self.assertEqual(normalized_transcript_url(self.url), self.url.replace(self.compressed, self.canonical))

    def test_other_hosts_credentials_fragments_ports_and_resources_are_rejected(self):
        for url in (self.url.replace('https:', 'http:'), self.url.replace('graph.microsoft.com', 'other.test'),
                    self.url.replace('graph.microsoft.com', 'graph.microsoft.com:444'),
                    self.url.replace('graph.microsoft.com', 'graph.microsoft.com:bad'),
                    self.url.replace('graph.microsoft.com', 'user@graph.microsoft.com'), self.url + '#secret',
                    self.url.replace('/transcripts/', '/recordings/'), 'https://[bad', None):
            with self.subTest(url=url):
                self.assertIsNone(normalized_transcript_url(url))

    def test_urllib_one_400_retry_keeps_headers_method_timeout_and_closes_failure(self):
        body = BytesIO(b'Invalid transcript id')
        failure = HTTPError(self.url, 400, 'Bad Request', {}, body)
        response = Mock()
        transport = Mock(side_effect=[failure, response])
        request = Request(self.url, headers={'Authorization': 'Bearer synthetic', 'Accept': 'text/vtt'})
        self.assertIs(open_transcript(transport, request, timeout=15), response)
        retry = transport.call_args.args[0]
        self.assertEqual(retry.full_url, self.url.replace(self.compressed, self.canonical))
        self.assertEqual(retry.header_items(), request.header_items())
        self.assertEqual(retry.get_method(), 'GET')
        self.assertEqual(transport.call_args.kwargs, {'timeout': 15})
        self.assertTrue(body.closed)
        self.assertEqual(transport.call_count, 2)

    def test_urllib_success_403_recording_or_post_does_not_retry(self):
        response = Mock()
        transport = Mock(return_value=response)
        self.assertIs(open_transcript(transport, Request(self.url), timeout=10), response)
        transport.assert_called_once()
        for url, code, method in ((self.url, 403, 'GET'), (self.url, 400, 'POST'),
                                  (self.url.replace('/transcripts/', '/recordings/'), 400, 'GET')):
            failure = HTTPError(url, code, 'Rejected', {}, BytesIO())
            transport = Mock(side_effect=failure)
            with self.assertRaises(HTTPError) as caught:
                open_transcript(transport, Request(url, method=method), timeout=10)
            self.assertIs(caught.exception, failure)
            transport.assert_called_once()
            failure.close()

    def test_second_failure_propagates_without_loop(self):
        failures = [HTTPError(self.url, code, 'Rejected', {}, BytesIO()) for code in (400, 400)]
        transport = Mock(side_effect=failures)
        with self.assertRaises(HTTPError) as caught:
            open_transcript(transport, Request(self.url), timeout=10)
        self.assertIs(caught.exception, failures[1])
        self.assertEqual(transport.call_count, 2)
        failures[1].close()

    def test_httpx_closes_rejected_stream_before_single_fallback(self):
        events = []
        headers = {'Authorization': 'Bearer synthetic', 'Accept': 'text/vtt'}
        @contextmanager
        def stream(method, url, *, headers):
            events.append(('open', url, method, headers))
            try:
                yield Mock(status_code=400 if len(events) == 1 else 200)
            finally:
                events.append(('closed', url))
        transport = Mock(stream=stream)
        with transcript_stream(transport, self.url, headers=headers) as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual([event[0] for event in events], ['open', 'closed', 'open'])
            self.assertEqual(events[2][2:], ('GET', headers))
            self.assertEqual(events[2][1], self.url.replace(self.compressed, self.canonical))
        self.assertEqual(len(events), 4)

    def test_httpx_other_response_is_returned_unchanged(self):
        @contextmanager
        def stream(*args, **kwargs):
            yield response
        response = Mock(status_code=403)
        transport = Mock()
        transport.stream.side_effect = stream
        with transcript_stream(transport, self.url, headers={}) as actual:
            self.assertIs(actual, response)
        transport.stream.assert_called_once()
