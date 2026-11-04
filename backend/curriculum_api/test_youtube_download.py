"""Exercise cleanup, timeouts and safe downloader boundaries without networking."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from .bunny_stream import VideoImportError
from . import youtube_download as youtube

URL = 'https://www.youtube.com/watch?v=abcdefghijk'
MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64


class YouTubeDownloadTests(unittest.TestCase):
    def test_temporary_file_lives_until_upload_finishes_then_is_removed(self):
        paths = []
        def downloaded(url, directory, limit):
            path = directory / 'video.mp4'
            path.write_bytes(MP4)
            paths.append(path)
            return path
        with patch.object(youtube, '_run_download', side_effect=downloaded):
            with youtube.download_youtube(URL, 1000) as stream:
                self.assertEqual(stream.read(), MP4)
                self.assertTrue(paths[0].exists())
            self.assertFalse(paths[0].parent.exists())

    def test_upload_failure_also_removes_temporary_source(self):
        paths = []
        def downloaded(url, directory, limit):
            path = directory / 'video.mp4'
            path.write_bytes(MP4)
            paths.append(path)
            return path
        with patch.object(youtube, '_run_download', side_effect=downloaded):
            with self.assertRaisesRegex(VideoImportError, 'Bunny unavailable'):
                with youtube.download_youtube(URL, 1000):
                    raise VideoImportError('Bunny unavailable')
        self.assertFalse(paths[0].parent.exists())

    def test_partial_download_failure_removes_temporary_files(self):
        paths = []
        def fail(url, directory, limit):
            paths.append(directory)
            (directory / 'video.mp4.part').write_bytes(MP4)
            raise VideoImportError('Download refused')
        with patch.object(youtube, '_run_download', side_effect=fail):
            with self.assertRaises(VideoImportError):
                with youtube.download_youtube(URL, 1000):
                    self.fail('A failed download must not reach Bunny')
        self.assertFalse(paths[0].exists())

    def test_oversized_final_file_is_refused_and_removed(self):
        paths = []
        def downloaded(url, directory, limit):
            path = directory / 'video.mp4'
            path.write_bytes(MP4)
            paths.append(path)
            return path
        with patch.object(youtube, '_run_download', side_effect=downloaded):
            with self.assertRaisesRegex(VideoImportError, '300 MB'):
                with youtube.download_youtube(URL, 4):
                    self.fail('An oversized video must not reach Bunny')
        self.assertFalse(paths[0].exists())

    def test_child_never_receives_storage_or_database_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'video.mp4').write_bytes(MP4)
            (directory / 'result.json').write_text(json.dumps({'file': 'video.mp4'}))
            child = Mock(returncode=0)
            child.poll.return_value = 0
            with patch.dict(os.environ, {'BUNNY_STREAM_API_KEY': 'synthetic', 'DATABASE_URL': 'synthetic'}), \
                 patch.object(youtube.shutil, 'which', return_value='node'), \
                 patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
                 patch.object(youtube.subprocess, 'Popen', return_value=child) as spawn:
                self.assertEqual(youtube._run_download(URL, directory, 1000), directory / 'video.mp4')
            options = spawn.call_args.kwargs
            self.assertNotIn('BUNNY_STREAM_API_KEY', options['env'])
            self.assertNotIn('DATABASE_URL', options['env'])
            self.assertNotIn('shell', options)
            self.assertEqual(options['stdout'], subprocess.DEVNULL)

    def test_timeout_stops_downloader_before_temp_cleanup(self):
        child = Mock(returncode=1)
        child.wait.side_effect = subprocess.TimeoutExpired('downloader', 1)
        with tempfile.TemporaryDirectory() as temporary, \
             patch.object(youtube.shutil, 'which', return_value='node'), \
             patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
             patch.object(youtube.subprocess, 'Popen', return_value=child), \
             patch.object(youtube, '_stop_process') as stop:
            with self.assertRaisesRegex(VideoImportError, 'timed out'):
                youtube._run_download(URL, Path(temporary), 1000)
        stop.assert_called_with(child)

    def test_provider_errors_do_not_leak_signed_urls(self):
        extractor = Mock()
        extractor.extract_info.side_effect = Exception('Sign in to confirm you are not a bot https://example.invalid/?secret=private')
        with tempfile.TemporaryDirectory() as temporary, \
             patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
             patch('yt_dlp.YoutubeDL') as factory:
            factory.return_value.__enter__.return_value = extractor
            youtube._worker(URL, Path(temporary), 1000, 'node')
            result = json.loads((Path(temporary) / 'result.json').read_text())
        self.assertIn('refused automated downloading', result['error'])
        self.assertNotIn('private', result['error'])
        self.assertNotIn('https://', result['error'])

    def test_extractor_rejects_live_streams_and_oversized_partial_media(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
             patch('yt_dlp.YoutubeDL') as factory:
            directory = Path(temporary)
            youtube._worker(URL, directory, 10, 'node')
            options = factory.call_args.args[0]
            with self.assertRaisesRegex(VideoImportError, 'livestream'):
                options['match_filter']({'is_live': True})
            (directory / 'video.mp4.part').write_bytes(MP4)
            with self.assertRaisesRegex(VideoImportError, '300 MB'):
                options['progress_hooks'][0]({})
            self.assertTrue(options['noplaylist'])
            self.assertFalse(options['skip_unavailable_fragments'])


if __name__ == '__main__':
    unittest.main()
