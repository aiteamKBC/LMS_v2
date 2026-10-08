"""Video first-byte regressions: synthetic media, no Django setup/DB/network."""
import ast
import asyncio
from functools import lru_cache
import mimetypes
from pathlib import Path
import re
import sys
import threading
import unittest
from unittest.mock import Mock, patch
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8', DATABASES={})
from django.http import FileResponse, Http404, HttpResponse
from django.test import AsyncRequestFactory, RequestFactory, override_settings
from curriculum_api import upload_storage
from learner_api import evidence_storage, media_proxy
from azure.core.pipeline.transport import HttpResponse as AzureHttpResponse, HttpTransport
from azure.storage.blob import BlobServiceClient
from requests.structures import CaseInsensitiveDict


@lru_cache(maxsize=1)
def uploaded_view():
    # Exercise the real file-serving functions without importing the large
    # curriculum view module, its models, app startup or database configuration.
    path = Path(__file__).resolve().parents[1] / 'curriculum_api' / 'views.py'
    names = {'curriculum_uploaded_file', 'parse_byte_range'}
    nodes = [node for node in ast.parse(path.read_text(encoding='utf-8-sig')).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    for node in nodes:
        node.decorator_list = []
    namespace = dict(upload_storage=upload_storage, COMPONENT_UPLOAD_ROOT='curriculum_uploads',
                     Path=Path, clean_str=lambda value: str(value or '').strip(),
                     FileResponse=FileResponse, HttpResponse=HttpResponse, Http404=Http404,
                     mimetypes=mimetypes)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)
    return namespace['curriculum_uploaded_file']


class VideoStreamingTests(unittest.TestCase):
    def consume_first(self, response, asgi):
        if asgi:
            async def first():
                iterator = aiter(response)
                try:
                    return await anext(iterator)
                finally:
                    await iterator.aclose()
            return asyncio.run(first())
        return next(iter(response))

    def test_remote_videos_send_the_first_chunk_before_reading_the_rest(self):
        for provider in ('drive', 'legacy'):
            for asgi in (False, True):
                with self.subTest(provider=provider, asgi=asgi):
                    request = (AsyncRequestFactory() if asgi else RequestFactory()).get('/', headers={'Range': 'bytes=0-'})
                    upstream = Mock(status=206, headers={'Content-Type': 'video/mp4', 'Content-Length': '6',
                                                        'Content-Range': 'bytes 0-5/6'})
                    upstream.read.side_effect = [b'one', b'two', b'']
                    opener = '_open_google_drive_file' if provider == 'drive' else '_open_legacy_attachment'
                    with patch.object(media_proxy, opener, return_value=upstream), \
                            patch.object(media_proxy, '_legacy_attachment_upload_path', return_value=''):
                        response = (media_proxy.google_drive_media(request, 'example12345') if provider == 'drive'
                                    else media_proxy.legacy_attachment_media(request, '12'))
                    try:
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore', Warning)
                            self.assertEqual(self.consume_first(response, asgi), b'one')
                        self.assertEqual(upstream.read.call_count, 1, 'The server buffered the rest before first byte')
                        self.assertEqual(response.status_code, 206)
                        self.assertEqual(response['Content-Range'], 'bytes 0-5/6')
                    finally:
                        response.close()
                    upstream.close.assert_called()

    def test_archived_videos_stream_incrementally_on_both_server_interfaces(self):
        for route in ('upload', 'legacy', 'legacy-local'):
            for asgi in (False, True):
                with self.subTest(route=route, asgi=asgi):
                    consumed = []
                    closed = []
                    def chunks():
                        try:
                            for chunk in (b'one', b'two'):
                                consumed.append(chunk)
                                yield chunk
                        finally:
                            closed.append(True)
                    request = (AsyncRequestFactory() if asgi else RequestFactory()).get('/', headers={'Range': 'bytes=0-5'})
                    mime = '' if route == 'legacy-local' else 'video/mp4'
                    opened = [(iter([b'o']), 6, mime), (chunks(), 6, mime)]
                    with patch.object(upload_storage, 'open_stream', side_effect=opened), \
                            patch.object(media_proxy, '_legacy_attachment_upload_path', return_value='lecture.mp4'):
                        response = (uploaded_view()(request, 'lecture.mp4') if route == 'upload'
                                    else media_proxy.legacy_attachment_media(request, '12'))
                    try:
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore', Warning)
                            self.assertEqual(self.consume_first(response, asgi), b'one')
                        self.assertEqual(consumed, [b'one'])
                        self.assertEqual(response.status_code, 206)
                        self.assertEqual(response['Content-Length'], '6')
                        self.assertEqual(response['Content-Range'], 'bytes 0-5/6')
                    finally:
                        response.close()
                    self.assertTrue(closed)

    def test_uploaded_video_preserves_suffix_ranges_and_invalid_range_status(self):
        payload = b'0123456789'
        def open_stream(_path, offset=0, length=None):
            return iter([payload[offset:offset + length]]), len(payload), 'video/mp4'
        with patch.object(upload_storage, 'open_stream', side_effect=open_stream):
            for header, status, expected in [('bytes=-3', 206, b'789'), ('bytes=7-', 206, b'789'),
                                              ('bytes=10-', 416, None), ('', 200, payload)]:
                with self.subTest(header=header):
                    response = uploaded_view()(RequestFactory().get('/', HTTP_RANGE=header), 'lecture.mp4')
                    self.assertEqual(response.status_code, status)
                    if expected is not None:
                        self.assertEqual(b''.join(response), expected)
                    else:
                        self.assertEqual(response['Content-Range'], 'bytes */10')
                    response.close()


class BlobResponse(AzureHttpResponse):
    def __init__(self, request, payload, start, end):
        super().__init__(request, None)
        self.status_code = 200 if request.method == 'HEAD' else 206
        self.reason = 'OK'
        self.headers = CaseInsensitiveDict({'content-type': 'video/mp4', 'content-length': str(len(payload)),
                                           'etag': '"unchanged"', 'x-ms-blob-type': 'BlockBlob'})
        self.payload = b'' if request.method == 'HEAD' else payload[start:end + 1]
        if request.method != 'HEAD':
            self.headers.update({'content-length': str(len(self.payload)),
                                 'content-range': f'bytes {start}-{end}/{len(payload)}'})
        self.content_type = 'video/mp4'

    def body(self):
        return self.payload

    def stream_download(self, _pipeline, **_kwargs):
        class Body:
            def __init__(self, data):
                self.parts = iter([data])
                self.content_length = len(data)

            def __iter__(self):
                return self

            def __next__(self):
                return next(self.parts)
        return Body(self.payload)


class BlobTransport(HttpTransport):
    """Run the real Azure downloader against synthetic in-memory responses."""
    def __init__(self, payload):
        self.payload = payload
        self.reads = []

    def open(self):
        pass

    def close(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()

    def send(self, request, **_kwargs):
        start, end = 0, len(self.payload) - 1
        if request.method == 'GET':
            requested = request.headers.get('x-ms-range') or request.headers.get('Range')
            if requested:
                match = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
                start, end = int(match[1]), min(int(match[2]) if match[2] else end, end)
            self.reads.append((start, end))
        elif request.method != 'HEAD':
            raise AssertionError('Only read requests are allowed')
        return BlobResponse(request, self.payload, start, end)


class AzureVideoStreamingTests(unittest.TestCase):
    def test_video_bootstrap_is_bounded_and_the_complete_range_is_still_delivered(self):
        payload = bytes(range(256)) * (3 * 1024 * 1024 // 256)
        transport = BlobTransport(payload)
        def service(**kwargs):
            return BlobServiceClient(transport=transport, **kwargs)
        with override_settings(AZURE_STORAGE_ACCOUNT='synthetic', AZURE_STORAGE_KEY='a2V5',
                               AZURE_CURRICULUM_CONTAINER='curriculum-uploads'), \
                patch.object(upload_storage, 'local_path', return_value=None), \
                patch.object(upload_storage, 'blob_name_for', side_effect=str), \
                patch.object(evidence_storage, 'BlobServiceClient', side_effect=service):
            chunks, total, mime = upload_storage.open_stream('lecture.mp4', offset=7, length=len(payload) - 14)
            self.assertEqual(total, len(payload))
            self.assertEqual(mime, 'video/mp4')
            self.assertLessEqual(transport.reads[0][1] - transport.reads[0][0] + 1, 1024 * 1024)
            first = next(chunks)
            self.assertEqual(len(transport.reads), 1, 'First chunk must not wait for another upstream range')
            self.assertEqual(first + b''.join(chunks), payload[7:-7])

    def test_non_video_download_keeps_its_existing_bootstrap_and_content(self):
        payload = b'document' * (3 * 1024 * 1024 // 8)
        transport = BlobTransport(payload)
        def service(**kwargs):
            return BlobServiceClient(transport=transport, **kwargs)
        with override_settings(AZURE_STORAGE_ACCOUNT='synthetic', AZURE_STORAGE_KEY='a2V5',
                               AZURE_CURRICULUM_CONTAINER='curriculum-uploads'), \
                patch.object(upload_storage, 'local_path', return_value=None), \
                patch.object(upload_storage, 'blob_name_for', side_effect=str), \
                patch.object(evidence_storage, 'BlobServiceClient', side_effect=service):
            chunks, total, _mime = upload_storage.open_stream('reading.pdf')
            self.assertEqual(total, len(payload))
            self.assertEqual(transport.reads, [(0, len(payload) - 1)])
            self.assertEqual(b''.join(chunks), payload)


class VideoDisconnectTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_during_read_closes_the_stream_without_reading_ahead(self):
        from config.video_streaming import video_chunks
        started, release, closed = threading.Event(), threading.Event(), threading.Event()
        def chunks():
            try:
                started.set()
                if not release.wait(3):
                    raise AssertionError('Test did not release the simulated socket read')
                yield b'first'
                raise AssertionError('Read ahead after client disconnected')
            finally:
                closed.set()
        stream = video_chunks(AsyncRequestFactory().get('/'), chunks())
        pending = asyncio.create_task(anext(stream))
        try:
            self.assertTrue(await asyncio.to_thread(started.wait, 3))
            pending.cancel()
            await asyncio.sleep(0)
        finally:
            release.set()
        with self.assertRaises(asyncio.CancelledError):
            await pending
        self.assertTrue(closed.is_set())


if __name__ == '__main__':
    unittest.main()
