"""Audio first-byte regressions; synthetic upstreams, no database or network."""
import asyncio
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch
import warnings

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8', DATABASES={})
from django.test import AsyncRequestFactory, RequestFactory
from learner_api import media_proxy

def first_chunk(response, asgi):
    if not asgi:
        return next(iter(response))
    async def read():
        stream = aiter(response)
        try:
            return await anext(stream)
        finally:
            await stream.aclose()
    return asyncio.run(read())

class AudioStreamingTests(unittest.TestCase):
    def test_remote_audio_starts_before_the_full_file_is_read(self):
        for provider in ('drive', 'legacy'):
            for asgi in (False, True):
                with self.subTest(provider=provider, asgi=asgi):
                    request = (AsyncRequestFactory() if asgi else RequestFactory()).get('/', HTTP_RANGE='bytes=0-')
                    upstream = Mock(status=206, headers={'Content-Type':'audio/mpeg', 'Content-Length':'6', 'Content-Range':'bytes 0-5/6'})
                    upstream.read.side_effect = [b'one', b'two', b'']
                    opener = '_open_google_drive_file' if provider == 'drive' else '_open_legacy_attachment'
                    with patch.object(media_proxy, opener, return_value=upstream), patch.object(media_proxy, '_legacy_attachment_upload_path', return_value=''):
                        response = (media_proxy.google_drive_media(request, 'example12345') if provider == 'drive' else media_proxy.legacy_attachment_media(request, '12'))
                    try:
                        with warnings.catch_warnings():
                            warnings.simplefilter('ignore', Warning)
                            self.assertEqual(first_chunk(response, asgi), b'one')
                        self.assertEqual(upstream.read.call_count, 1, 'Audio was buffered in full')
                        self.assertEqual(response.status_code, 206)
                        self.assertEqual(response['Content-Range'], 'bytes 0-5/6')
                    finally:
                        response.close()
                    upstream.close.assert_called()

    def test_archived_audio_streams_incrementally_on_both_interfaces(self):
        for asgi in (False, True):
            with self.subTest(asgi=asgi):
                consumed=[]
                def chunks():
                    for part in (b'one',b'two'):
                        consumed.append(part)
                        yield part
                request=(AsyncRequestFactory() if asgi else RequestFactory()).get('/', HTTP_RANGE='bytes=0-5')
                with patch.object(media_proxy.upload_storage,'open_stream',side_effect=[(iter([b'o']),6,'audio/mpeg'),(chunks(),6,'audio/mpeg')]), patch.object(media_proxy,'_legacy_attachment_upload_path',return_value='lecture.mp3'):
                    response=media_proxy.legacy_attachment_media(request,'12')
                try:
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore', Warning)
                        self.assertEqual(first_chunk(response,asgi),b'one')
                    self.assertEqual(consumed,[b'one'])
                    self.assertEqual(response['Content-Length'],'6')
                finally:
                    response.close()
