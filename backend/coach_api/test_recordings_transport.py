from io import BytesIO
import asyncio
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.request import Request

from django.test import SimpleTestCase
from coach_api import recordings_transport as transport


class RecordingTransportTests(SimpleTestCase):
    def setUp(self):
        # Windows builds an internal loopback socketpair for its event loop.
        # Create that before the strict socket guard; all application/provider
        # transport remains forbidden while the regression itself runs.
        self.loop = asyncio.new_event_loop()
        def close_loop():
            self.loop.run_until_complete(self.loop.shutdown_asyncgens())
            self.loop.run_until_complete(self.loop.shutdown_default_executor())
            self.loop.close()
        self.addCleanup(close_loop)
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Live network forbidden')))
        self.enterContext(patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}))
        self.enterContext(patch('coach_api.views.microsoft_graph_token', return_value='synthetic-token'))
        self.open = self.enterContext(patch.object(transport, 'build_opener')).return_value.open
        self.base = 'users/coach/onlineMeetings/meeting'

    def source(self, data=b'\x00\x00\x00\x18ftypisom' + b'0'*52, status=206):
        source = BytesIO(data)
        source.status = status
        source.headers = {'Content-Type': 'video/mp4', 'Content-Length': str(len(data)), 'Content-Range': f'bytes 0-{len(data)-1}/1000', 'ETag': '"test"'}
        self.open.return_value = source
        return source

    def test_probe_reads_only_small_mp4_prefix_and_closes_source(self):
        source = self.source()
        self.assertTrue(transport.recording_accessible(self.base, 'file'))
        self.assertTrue(source.closed)
        request = self.open.call_args.args[0]
        self.assertEqual(request.get_header('Range'), 'bytes=0-63')

    def test_html_or_non_mp4_cannot_be_declared_playable(self):
        self.source(b'<html>not a recording</html>')
        with self.assertRaises(ValueError):
            transport.recording_accessible(self.base, 'file')

    def test_seek_and_download_preserve_status_range_and_stream_cleanup(self):
        source = self.source()
        response = transport.recording_response(self.base, 'file/one+', byte_range='bytes=0-63', preview=True, if_range='"test"')
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], 'bytes 0-63/1000')
        self.assertEqual(response['Accept-Ranges'], 'bytes')
        self.assertTrue(response['Content-Disposition'].startswith('inline'))
        self.assertEqual(len(b''.join(response.streaming_content)), 64)
        self.assertTrue(source.closed)
        self.assertEqual(self.open.call_args.args[0].get_header('If-range'), '"test"')
        self.source(status=200)
        response = transport.recording_response(self.base, 'file')
        self.assertTrue(response['Content-Disposition'].startswith('attachment'))
        response.close()

    def test_invalid_or_multi_ranges_and_arbitrary_paths_are_rejected_before_transport(self):
        for value in ('bytes=5-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'bytes=999999999999999999999999999-'):
            with self.assertRaises(ValueError):
                transport.recording_response(self.base, 'file', byte_range=value)
        with self.assertRaises(ValueError):
            transport.open_source('https://foreign.invalid/video', 'file')
        self.open.assert_not_called()

    def test_unsatisfiable_range_is_honest_416(self):
        self.open.side_effect = HTTPError('https://graph.microsoft.com', 416, 'range', {'Content-Range': 'bytes */1000'}, BytesIO())
        response = transport.recording_response(self.base, 'file', byte_range='bytes=1001-')
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response['Content-Range'], 'bytes */1000')

    def test_asgi_returns_first_chunk_without_buffering_the_entire_recording(self):
        source = self.source(b'x' * 1024 * 1024, status=200)
        response = transport.recording_response(self.base, 'file', asynchronous=True)
        self.assertTrue(response.is_async)
        async def read_first():
            iterator = response.streaming_content
            first = await anext(iterator)
            self.assertEqual(len(first), 256 * 1024)
            self.assertEqual(source.tell(), 256 * 1024)
            await iterator.aclose()
        self.loop.run_until_complete(read_first())
        response.close()
        self.assertTrue(source.closed)

    def test_redirect_strips_app_token_and_keeps_range_only_for_trusted_microsoft_hosts(self):
        request = Request('https://graph.microsoft.com/v1.0/content', headers={'Authorization': 'Bearer synthetic', 'Range': 'bytes=0-63'})
        handler = transport.RecordingRedirect()
        redirected = handler.redirect_request(request, None, 302, '', {}, 'https://college.sharepoint.com/video')
        self.assertIsNone(redirected.get_header('Authorization'))
        self.assertEqual(redirected.get_header('Range'), 'bytes=0-63')
        for target in ('https://foreign.invalid/video', 'http://college.sharepoint.com/video', 'https://college.sharepoint.com.evil.invalid/video'):
            with self.assertRaises(URLError):
                handler.redirect_request(request, None, 302, '', {}, target)
