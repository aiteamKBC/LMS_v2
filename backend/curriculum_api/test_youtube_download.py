"""Exercise cleanup, timeouts and safe downloader boundaries without networking."""
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

from .bunny_stream import VideoImportError
from . import youtube_download as youtube

URL = 'https://www.youtube.com/watch?v=abcdefghijk'
MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64
COOKIE_VALUE = 'synthetic-youtube-session'


def cookie_export(expires=0, domain='.youtube.com'):
    return ('# Netscape HTTP Cookie File\n# Synthetic browser export\n'
            f'#HttpOnly_{domain}\tTRUE\t/\tTRUE\t{expires}\tSID\t{COOKIE_VALUE}\n')


class YouTubeDownloadTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ))
        os.environ.pop('YOUTUBE_COOKIES_FILE', None)
        self.enterContext(patch('socket.socket.connect', side_effect=AssertionError('External network disabled')))

    def make_cookies(self, content=None):
        private = Path(self.enterContext(tempfile.TemporaryDirectory()))
        source = private / 'youtube.cookies.txt'
        source.write_text(content if content is not None else cookie_export(), encoding='utf-8')
        source.chmod(0o600)
        os.environ['YOUTUBE_COOKIES_FILE'] = str(source)
        return source

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
        self.assertIn('YouTube requires verification', result['error'])
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

    def test_anonymous_download_does_not_load_browser_cookies(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
             patch('yt_dlp.YoutubeDL') as factory:
            directory = Path(temporary)
            self.assertIsNone(youtube._prepare_cookies(directory))
            youtube._worker(URL, directory, 1000, 'node')
            options = factory.call_args.args[0]
            self.assertNotIn('cookiefile', options)
            self.assertNotIn('cookiesfrombrowser', options)

    def test_cookie_export_is_usable_by_downloader_and_isolated_per_attempt(self):
        from yt_dlp.cookies import YoutubeDLCookieJar
        source = self.make_cookies()
        original = source.read_bytes()
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            first_copy = youtube._prepare_cookies(Path(first))
            second_copy = youtube._prepare_cookies(Path(second))
            self.assertNotEqual(first_copy, second_copy)
            self.assertNotEqual(first_copy, source)
            jar = YoutubeDLCookieJar(str(first_copy))
            jar.load()
            cookies = list(jar)
            self.assertEqual(len(cookies), 1)
            self.assertEqual(cookies[0].value, COOKIE_VALUE)
            self.assertEqual(cookies[0].domain, '.youtube.com')
            self.assertNotIn('Synthetic browser export', first_copy.read_text())
            first_copy.write_text('updated by the downloader')
            self.assertEqual(source.read_bytes(), original)
            self.assertIn(COOKIE_VALUE, second_copy.read_text())
        self.assertFalse(first_copy.exists())
        self.assertFalse(second_copy.exists())
        self.assertEqual(source.read_bytes(), original)

    def test_cookie_file_is_used_by_child_then_cleaned_after_upload_failure(self):
        source = self.make_cookies()
        original = source.read_bytes()
        child = Mock(returncode=0)
        child.poll.return_value = 0
        temporary_paths = []

        def run_child(command, **kwargs):
            directory = Path(command[4])
            copied = Path(command[-1])
            temporary_paths.append(copied)
            self.assertEqual(copied.parent, directory)
            self.assertNotEqual(copied, source)
            self.assertNotIn(str(source), command)
            self.assertNotIn(COOKIE_VALUE, ' '.join(command))
            self.assertNotIn('YOUTUBE_COOKIES_FILE', kwargs['env'])
            self.assertNotIn('BUNNY_STREAM_API_KEY', kwargs['env'])
            self.assertNotIn('DATABASE_URL', kwargs['env'])
            extractor = Mock()

            def downloaded(*args, **kwargs):
                (directory / 'video.mp4').write_bytes(MP4)
                copied.write_text('session rotated by downloader')

            extractor.extract_info.side_effect = downloaded
            with patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
                 patch('yt_dlp.YoutubeDL') as factory:
                factory.return_value.__enter__.return_value = extractor
                youtube._worker(URL, directory, 1000, 'node', copied)
                self.assertEqual(factory.call_args.args[0]['cookiefile'], str(copied))
            return child

        with patch.dict(os.environ, {'BUNNY_STREAM_API_KEY': 'synthetic', 'DATABASE_URL': 'synthetic'}), \
             patch.object(youtube.shutil, 'which', return_value='node'), \
             patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
             patch.object(youtube.subprocess, 'Popen', side_effect=run_child):
            with self.assertRaisesRegex(VideoImportError, 'Bunny unavailable'):
                with youtube.download_youtube(URL, 1000) as stream:
                    self.assertEqual(stream.read(), MP4)
                    raise VideoImportError('Bunny unavailable')
        self.assertFalse(temporary_paths[0].parent.exists())
        self.assertEqual(source.read_bytes(), original)

    def test_invalid_cookie_exports_fail_before_child_and_hide_file_contents(self):
        source = self.make_cookies()
        for content in ('not a cookies file: ' + COOKIE_VALUE,
                        cookie_export(domain='.google.com'),
                        cookie_export(domain='.youtube.com.evil.invalid'),
                        cookie_export().replace('\tTRUE\t/', '\tFALSE\t/'),
                        cookie_export().replace('\tSID\t', '\tSID\textra\t'),
                        cookie_export().replace('\t0\t', '\tnot-a-time\t'),
                        '# Netscape HTTP Cookie File\n',
                        cookie_export(int(time.time()) - 60),
                        'x' * (youtube.MAX_COOKIE_BYTES + 1)):
            with self.subTest(content_kind=content[:28]), \
                 tempfile.TemporaryDirectory() as temporary, \
                 patch.object(youtube.shutil, 'which', return_value='node'), \
                 patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
                 patch.object(youtube.subprocess, 'Popen') as spawn:
                source.write_text(content, encoding='utf-8')
                with self.assertRaises(VideoImportError) as raised:
                    youtube._run_download(URL, Path(temporary), 1000)
                self.assertNotIn(COOKIE_VALUE, str(raised.exception))
                self.assertNotIn(str(source), str(raised.exception))
                self.assertEqual(list(Path(temporary).iterdir()), [])
                spawn.assert_not_called()

    def test_cookie_path_must_exist_and_be_outside_application(self):
        source = self.make_cookies()
        for path in ('relative-cookies.txt', str(source.parent / 'absent.txt'),
                     str(source.parent), str(Path(youtube.__file__).resolve())):
            with self.subTest(path_kind=Path(path).name), tempfile.TemporaryDirectory() as temporary:
                os.environ['YOUTUBE_COOKIES_FILE'] = path
                with self.assertRaises(VideoImportError) as raised:
                    youtube._prepare_cookies(Path(temporary))
                self.assertNotIn(path, str(raised.exception))

    def test_posix_cookie_file_permissions_are_enforced(self):
        self.make_cookies()
        for mode in (0o644, 0o640, 0o606, 0o600):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as temporary, \
                 patch.object(youtube.sys, 'platform', 'linux'), \
                 patch.object(youtube.os, 'fstat', return_value=Mock(st_mode=stat.S_IFREG | mode)):
                if mode == 0o600:
                    self.assertTrue(youtube._prepare_cookies(Path(temporary)).exists())
                else:
                    with self.assertRaisesRegex(VideoImportError, 'chmod 600'):
                        youtube._prepare_cookies(Path(temporary))

    def test_failed_cookie_authenticated_download_is_not_reported_as_success(self):
        source = self.make_cookies()
        original = source.read_bytes()
        failures = (
            ('Sign in to confirm you are not a bot', 'refresh the YouTube session'),
            ('HTTP Error 429: Too Many Requests', 'limiting download requests'),
            ('Sign in to access this video', 'requires sign-in'),
        )
        for upstream, expected in failures:
            with self.subTest(upstream=upstream), tempfile.TemporaryDirectory() as temporary, \
                 patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
                 patch('yt_dlp.YoutubeDL') as factory:
                directory = Path(temporary)
                copied = youtube._prepare_cookies(directory)
                extractor = factory.return_value.__enter__.return_value
                extractor.extract_info.side_effect = Exception(upstream + ' ' + COOKIE_VALUE + ' https://example.invalid/?token=private')
                youtube._worker(URL, directory, 1000, 'node', copied)
                result = json.loads((directory / 'result.json').read_text())
                self.assertIn(expected, result['error'])
                self.assertNotIn('file', result)
                self.assertNotIn(COOKIE_VALUE, result['error'])
                self.assertNotIn('https://', result['error'])
        self.assertEqual(source.read_bytes(), original)

    def test_metadata_check_uses_private_session_without_downloading_media(self):
        source = self.make_cookies()
        original = source.read_bytes()
        paths = []
        child = Mock(returncode=0)
        child.poll.return_value = 0

        def run_child(command, **kwargs):
            directory, copied = Path(command[4]), Path(command[7])
            paths.append(directory)
            self.assertEqual(command[8], '--check')
            self.assertNotIn('YOUTUBE_COOKIES_FILE', kwargs['env'])
            with patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
                 patch('yt_dlp.YoutubeDL') as factory:
                extractor = factory.return_value.__enter__.return_value
                extractor.extract_info.return_value = {'id': 'abcdefghijk'}
                youtube._worker(URL, directory, 1000, 'node', copied, check_only=True)
                extractor.extract_info.assert_called_once_with(URL, download=False, ie_key='Youtube')
                self.assertTrue(factory.call_args.args[0]['simulate'])
                self.assertFalse(factory.call_args.args[0]['check_formats'])
                self.assertEqual(factory.call_args.args[0]['cookiefile'], str(copied))
            self.assertFalse(list(directory.glob('video.*')))
            return child

        with patch.object(youtube.shutil, 'which', return_value='node'), \
             patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
             patch.object(youtube.subprocess, 'Popen', side_effect=run_child), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(youtube.main(['--check', URL]), 0)
        self.assertIn('media transfer is not verified', output.getvalue())
        self.assertNotIn(COOKIE_VALUE, output.getvalue())
        self.assertNotIn(str(source), output.getvalue())
        child.wait.assert_any_call(timeout=60)
        self.assertFalse(paths[0].exists())
        self.assertEqual(source.read_bytes(), original)

    def test_metadata_check_rejects_invalid_sources_without_starting_child(self):
        with patch.object(youtube.subprocess, 'Popen') as spawn, \
             patch('sys.stdout', new_callable=io.StringIO):
            for url in ('https://example.invalid/video.mp4', 'https://www.youtube.com/playlist?list=synthetic'):
                self.assertEqual(youtube.main(['--check', url]), 1)
        spawn.assert_not_called()

    def test_metadata_check_failure_does_not_print_success(self):
        with patch.object(youtube, '_run_download', side_effect=VideoImportError('YouTube requires verification.')), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(youtube.main(['--check', URL]), 1)
        self.assertIn('requires verification', output.getvalue())
        self.assertNotIn('metadata accessible', output.getvalue())

    def test_missing_metadata_cannot_pass_check(self):
        with tempfile.TemporaryDirectory() as temporary, \
             patch('imageio_ffmpeg.get_ffmpeg_exe', return_value='ffmpeg'), \
             patch('yt_dlp.YoutubeDL') as factory:
            directory = Path(temporary)
            factory.return_value.__enter__.return_value.extract_info.return_value = None
            youtube._worker(URL, directory, 1000, 'node', check_only=True)
            result = json.loads((directory / 'result.json').read_text())
            self.assertIn('did not return video metadata', result['error'])
            self.assertNotIn('checked', result)

    def test_metadata_check_timeout_kills_child_and_cleans_cookie_copy(self):
        source = self.make_cookies()
        original = source.read_bytes()
        child = Mock(returncode=1)
        child.wait.side_effect = subprocess.TimeoutExpired('downloader', 60)
        with patch.object(youtube.shutil, 'which', return_value='node'), \
             patch.object(youtube.importlib.util, 'find_spec', return_value=True), \
             patch.object(youtube.subprocess, 'Popen', return_value=child) as spawn, \
             patch.object(youtube, '_stop_process') as stop, \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(youtube.main(['--check', URL]), 1)
        self.assertIn('metadata check timed out', output.getvalue())
        self.assertFalse(Path(spawn.call_args.args[0][4]).exists())
        self.assertEqual(source.read_bytes(), original)
        stop.assert_called_with(child)


if __name__ == '__main__':
    unittest.main()
