"""No database, credentials, Django setup or live HTTP calls."""
import io
import unittest
from unittest.mock import Mock, patch

import requests

from curriculum_api.bunny_stream import BunnyStream, VideoImportError, is_bunny_url, playback_url, video_title
from curriculum_api.video_sources import _drive_confirmation, _public_target, download_url, download_video, source_url, validate_video, youtube_url

VIDEO_ID = 'c1c2c3c4-1234-5678-abcd-123456789abc'
MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64


def response(data, status=200):
    result = Mock(status_code=status)
    result.json.return_value = data
    return result


class BunnyTransportTests(unittest.TestCase):
    def setUp(self):
        self.http = Mock()
        self.client = BunnyStream('798153', 'synthetic-library-key', self.http)

    def test_collection_uses_existing_programme_and_does_not_create_one(self):
        self.http.request.return_value = response({'items': [
            {'guid': 'ME', 'name': 'Marketing Excutive Level 4'},
            {'guid': 'PCP', 'name': 'Project Controls Professional Level 6'},
        ]})
        self.assertEqual(self.client.collection('PROG-ME-L4', 'Marketing Executive Level 4'), 'ME')
        self.assertEqual(self.client.collection('PROG-PCP-L6', 'Project Controls Professional Level 6'), 'PCP')
        self.assertTrue(all(call.args[0] == 'GET' for call in self.http.request.call_args_list))

    def test_ambiguous_collection_is_refused(self):
        self.http.request.return_value = response({'items': [
            {'guid': 'A', 'name': 'Example'}, {'guid': 'B', 'name': 'Example'}]})
        with self.assertRaises(VideoImportError):
            self.client.collection('UNKNOWN', 'Example')

    def test_missing_collection_is_refused(self):
        self.http.request.return_value = response({'items': []})
        with self.assertRaises(VideoImportError):
            self.client.collection('UNKNOWN', '')

    def test_upload_sends_bytes_and_never_follows_redirects_with_key(self):
        self.http.request.return_value = response({'success': True})
        stream = io.BytesIO(MP4)
        self.client.upload(VIDEO_ID, stream)
        args, kwargs = self.http.request.call_args
        self.assertEqual(args[0], 'PUT')
        self.assertIs(kwargs['data'], stream)
        self.assertFalse(kwargs['allow_redirects'])
        self.assertEqual(kwargs['headers']['Content-Type'], 'application/octet-stream')

    def test_api_failure_never_exposes_upstream_text(self):
        for status in (401, 403, 429, 500):
            with self.subTest(status=status):
                self.http.request.return_value = response({'message': 'private upstream secret'}, status)
                with self.assertRaises(VideoImportError) as caught:
                    self.client.video(VIDEO_ID)
                self.assertNotIn('secret', str(caught.exception))
                self.http.request.return_value.close.assert_called_once()

    def test_success_false_is_not_reported_as_uploaded(self):
        self.http.request.return_value = response({'success': False})
        with self.assertRaises(VideoImportError):
            self.client.upload(VIDEO_ID, io.BytesIO(MP4))

    def test_timeout_is_not_blindly_retried(self):
        self.http.request.side_effect = requests.Timeout('sensitive address')
        with self.assertRaises(VideoImportError) as caught:
            self.client.create('asset', 'Lesson', 'collection')
        self.assertNotIn('sensitive', str(caught.exception))
        self.http.request.assert_called_once()

    def test_retry_search_requires_exact_import_marker(self):
        self.http.request.return_value = response({'items': [
            {'guid': 'wrong', 'title': 'Copy [LMS:asset] Lesson'},
            {'guid': VIDEO_ID, 'title': '[LMS:asset] Lesson'},
        ]})
        self.assertEqual(self.client.find_import('asset')['guid'], VIDEO_ID)

    def test_create_starts_with_module_name_and_keeps_programme_collection(self):
        self.http.request.return_value = response({'guid': VIDEO_ID})
        self.client.create('asset', 'Introduction', 'PCP', scope={
            'module_title': 'Managing Successful Programmes: Project Controls for Transformational Change'})
        self.assertEqual(self.http.request.call_args.kwargs['json'], {
            'title': 'MSP — Introduction [LMS:asset]', 'collectionId': 'PCP'})

    def test_new_title_can_be_recovered_after_a_lost_create_response(self):
        self.http.request.return_value = response({'items': [
            {'guid': 'wrong', 'title': 'MSP — Introduction [LMS:asset] copy'},
            {'guid': VIDEO_ID, 'title': 'MSP — Introduction [LMS:asset]'},
        ]})
        self.assertEqual(self.client.find_import('asset')['guid'], VIDEO_ID)

    def test_renaming_does_not_move_video_or_replace_metadata(self):
        self.http.request.return_value = response({'success': True})
        self.client.rename(VIDEO_ID, 'asset', 'Introduction', {'module_title': 'MSP'})
        self.assertEqual(self.http.request.call_args.kwargs['json'], {'title': 'MSP — Introduction [LMS:asset]'})

    def test_title_format_is_idempotent_and_handles_other_module_names(self):
        scope = {'module_title': 'Project Planning'}
        title = video_title('asset', 'Introduction', scope)
        self.assertEqual(title, 'Project Planning — Introduction [LMS:asset]')
        self.assertEqual(video_title('asset', title, scope), title)
        self.assertEqual(video_title('asset', '[LMS:asset] Introduction', scope), title)

    def test_unassigned_template_uses_its_saved_title(self):
        self.assertEqual(video_title('asset', 'Introduction', {'template_title': 'Week One'}),
                         'Week One — Introduction [LMS:asset]')

    def test_metadata_carries_scope_without_secrets_or_source_url(self):
        self.http.request.return_value = response({'success': True})
        self.client.metadata(VIDEO_ID, {'programme_id': 'PCP', 'cohort_id': 'C1', 'group_id': 'G1'}, 'Lesson')
        data = self.http.request.call_args.kwargs['json']
        self.assertEqual({x['property']: x['value'] for x in data['metaTags']}, {
            'lms.programme_id': 'PCP', 'lms.cohort_id': 'C1', 'lms.group_id': 'G1', 'lms.title': 'Lesson'})


class VideoSourceTests(unittest.TestCase):
    def test_embed_source_is_unwrapped_without_changing_query(self):
        self.assertEqual(source_url({'embedCode': '<iframe src="https://example.com/a.mp4?x=1&amp;y=2"></iframe>'}),
                         'https://example.com/a.mp4?x=1&y=2')

    def test_drive_preview_becomes_download(self):
        self.assertEqual(download_url('https://drive.google.com/file/d/abc123456789/preview'),
                         'https://drive.google.com/uc?export=download&id=abc123456789')

    def test_youtube_watch_embed_short_and_mobile_links_select_one_video(self):
        expected = 'https://www.youtube.com/watch?v=abcdefghijk'
        for url in ('https://www.youtube.com/watch?v=abcdefghijk&list=PLAYLIST',
                    'https://youtu.be/abcdefghijk?t=3', 'https://m.youtube.com/watch?v=abcdefghijk',
                    'https://www.youtube-nocookie.com/embed/abcdefghijk',
                    'https://www.youtube.com/shorts/abcdefghijk'):
            with self.subTest(url=url):
                self.assertEqual(download_url(url), expected)

    def test_youtube_playlist_redirect_and_lookalike_host_are_not_accepted(self):
        for url in ('https://youtube.com/playlist?list=PL1', 'https://youtube.com/redirect?q=http://127.0.0.1',
                    'https://youtube.com/watch?v=invalid', 'https://name:password@youtube.com/watch?v=abcdefghijk'):
            with self.subTest(url=url), self.assertRaises(VideoImportError):
                youtube_url(url)
        self.assertEqual(youtube_url('https://youtube.com.attacker.invalid/watch?v=abcdefghijk'), '')

    def test_youtube_download_yields_verified_bytes_without_fetching_the_watch_page(self):
        from contextlib import nullcontext
        with patch('curriculum_api.youtube_download.download_youtube', return_value=nullcontext(io.BytesIO(MP4))) as downloader, \
             patch('curriculum_api.video_sources.public_response') as public:
            with download_video('https://youtu.be/abcdefghijk') as stream:
                self.assertEqual(stream.read(), MP4)
        self.assertEqual(downloader.call_args.args[0], 'https://www.youtube.com/watch?v=abcdefghijk')
        public.assert_not_called()

    def test_credentials_and_unsupported_schemes_are_rejected(self):
        for url in ('file:///etc/passwd', 'ftp://example.com/video', 'https://user:secret@example.com/video'):
            with self.subTest(url=url), self.assertRaises(VideoImportError):
                download_url(url)

    def test_all_resolved_addresses_must_be_public(self):
        with patch('curriculum_api.video_sources.socket.getaddrinfo', return_value=[
            (2, 1, 6, '', ('8.8.8.8', 443)), (2, 1, 6, '', ('127.0.0.1', 443))]):
            with self.assertRaises(VideoImportError):
                _public_target('https://example.com/video')

    def test_private_ipv6_is_rejected(self):
        with patch('curriculum_api.video_sources.socket.getaddrinfo', return_value=[(10, 1, 6, '', ('::1', 443, 0, 0))]):
            with self.assertRaises(VideoImportError):
                _public_target('https://example.com/video')

    def test_nonstandard_port_is_rejected(self):
        with self.assertRaises(VideoImportError):
            _public_target('https://example.com:8000/video')

    def test_download_confirmation_cannot_redirect_to_arbitrary_host(self):
        page = '<form id="download-form" action="http://127.0.0.1/file"><input name="id" value="x"></form>'
        self.assertEqual(_drive_confirmation(page), '')

    def test_html_named_mp4_is_not_a_video(self):
        with self.assertRaises(VideoImportError):
            validate_video(io.BytesIO(b'<html>sign in</html>'))
        self.assertEqual(validate_video(io.BytesIO(MP4)), len(MP4))

    def test_empty_and_oversized_uploads_are_rejected(self):
        with self.assertRaises(VideoImportError):
            validate_video(io.BytesIO())
        with patch('curriculum_api.video_sources.MAX_VIDEO_BYTES', 10), self.assertRaises(VideoImportError):
            validate_video(io.BytesIO(MP4))

    def test_stream_download_is_bounded_and_not_returned_on_failure(self):
        from contextlib import contextmanager
        @contextmanager
        def upstream(_):
            yield Mock(headers={'Content-Type': 'video/mp4'}, read=Mock(side_effect=[MP4, b'']))
        with patch('curriculum_api.video_sources.public_response', upstream), patch('curriculum_api.video_sources.MAX_VIDEO_BYTES', 10):
            with self.assertRaisesRegex(VideoImportError, '300 MB'):
                with download_video('https://example.com/a.mp4'):
                    self.fail('Oversized source must not be yielded')

    def test_bunny_parser_only_recognises_exact_embed_host_and_path(self):
        self.assertTrue(is_bunny_url(playback_url('798153', VIDEO_ID)))
        self.assertFalse(is_bunny_url(f'https://iframe.mediadelivery.net.attacker.test/embed/798153/{VIDEO_ID}'))


if __name__ == '__main__':
    unittest.main()
