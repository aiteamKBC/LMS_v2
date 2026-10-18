"""Private course videos stream through the Drive API, and nothing else does."""
import io
import json
import os
import socket
import tempfile
import urllib.error
from unittest.mock import Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from learner_api import google_drive_api as drive, media_proxy
from learner_api.management.commands.authorize_google_drive import Command as AuthorizeCommand

CONFIGURED = {drive.CLIENT_ID_ENV: 'client.apps.googleusercontent.com',
              drive.CLIENT_SECRET_ENV: 'synthetic-secret', drive.REFRESH_TOKEN_ENV: 'synthetic-refresh'}
FILE_ID = 'SyntheticDriveFile_123-abc'


def video(status=206):
    upstream = Mock(status=status, headers={'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-1/10', 'Content-Length': '2'})
    upstream.read.side_effect = [b'ok', b'']
    return upstream


def token_response(value='access-1', expires_in=3600):
    response = Mock()
    response.read.return_value = json.dumps({'access_token': value, 'expires_in': expires_in}).encode()
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    return response


class DriveProxyRoutingTests(SimpleTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(socket, 'socket', side_effect=AssertionError('Network prohibited')).start()
        patch.dict(os.environ, CONFIGURED).start()
        self.linked = patch.object(drive, 'is_course_linked', return_value=True).start()
        self.api = patch.object(drive, 'open_file').start()
        self.anonymous = patch.object(media_proxy, '_open_google_drive_file').start()

    def get(self):
        request = RequestFactory().get(f'/learner_api/media/google-drive/{FILE_ID}/', HTTP_RANGE='bytes=0-1')
        return media_proxy.google_drive_media(request, file_id=FILE_ID)

    def test_a_course_video_streams_through_the_api_with_its_range(self):
        self.api.return_value = video()
        response = self.get()
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response['Content-Range'], 'bytes 0-1/10')
        self.assertEqual(b''.join(response.streaming_content), b'ok')
        self.api.assert_called_once_with(FILE_ID, 'bytes=0-1')
        self.anonymous.assert_not_called()

    def test_a_file_that_is_not_course_content_never_uses_the_account(self):
        self.linked.return_value = False
        self.anonymous.return_value = video(200)
        self.assertEqual(self.get().status_code, 200)
        self.api.assert_not_called()
        self.anonymous.assert_called_once_with(FILE_ID, 'bytes=0-1')

    def test_without_credentials_nothing_changes(self):
        patch.dict(os.environ, {drive.REFRESH_TOKEN_ENV: ''}).start()
        self.anonymous.return_value = video(200)
        self.assertEqual(self.get().status_code, 200)
        self.linked.assert_not_called()
        self.api.assert_not_called()

    def test_an_api_refusal_falls_back_to_the_anonymous_path(self):
        for failure in (urllib.error.HTTPError('u', 403, 'Forbidden', {}, io.BytesIO()), urllib.error.URLError('down'), KeyError('access_token')):
            with self.subTest(failure=type(failure).__name__):
                self.api.side_effect = failure
                self.anonymous.reset_mock()
                self.anonymous.side_effect = urllib.error.HTTPError('u', 404, 'Not Found', {}, io.BytesIO())
                self.assertEqual(self.get().status_code, 404)
                self.anonymous.assert_called_once()


class DriveApiTransportTests(SimpleTestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(socket, 'socket', side_effect=AssertionError('Network prohibited')).start()
        patch.dict(os.environ, CONFIGURED).start()
        patch.dict(drive._token, {'value': '', 'expires_at': 0.0}).start()
        self.urlopen = patch.object(drive.urllib.request, 'urlopen').start()

    def test_the_token_is_reused_until_it_expires(self):
        self.urlopen.side_effect = [token_response(), video(), video()]
        drive.open_file(FILE_ID)
        drive.open_file(FILE_ID, 'bytes=5-')
        requests = [call.args[0] for call in self.urlopen.call_args_list]
        self.assertEqual(len(requests), 3)  # one token exchange, two file reads
        self.assertIn(b'grant_type=refresh_token', requests[0].data)
        self.assertEqual(requests[1].get_header('Authorization'), 'Bearer access-1')
        self.assertEqual(requests[2].get_header('Range'), 'bytes=5-')
        self.assertIn(f'/files/{FILE_ID}?alt=media&supportsAllDrives=true', requests[1].full_url)

    def test_a_rejected_token_is_refreshed_once(self):
        unauthorised = urllib.error.HTTPError('u', 401, 'Unauthorized', {}, io.BytesIO())
        self.urlopen.side_effect = [token_response('old'), unauthorised, token_response('new'), video()]
        drive.open_file(FILE_ID)
        self.assertEqual(self.urlopen.call_args_list[3].args[0].get_header('Authorization'), 'Bearer new')

    def test_access_denied_is_not_retried(self):
        self.urlopen.side_effect = [token_response(), urllib.error.HTTPError('u', 404, 'Not Found', {}, io.BytesIO())]
        with self.assertRaises(urllib.error.HTTPError):
            drive.open_file(FILE_ID)
        self.assertEqual(self.urlopen.call_count, 2)


class CourseLinkTests(SimpleTestCase):
    def test_matches_live_components_by_their_video_fields(self):
        with patch('curriculum_api.models.ModuleAuthoringComponent.objects') as components:
            components.filter.return_value.filter.return_value.exists.return_value = True
            self.assertTrue(drive.is_course_linked(FILE_ID))
        components.filter.assert_called_once_with(deleted_at__isnull=True)
        condition = components.filter.return_value.filter.call_args.args[0]
        self.assertEqual(sorted(child[0] for child in condition.children),
                         ['settings_json__embedCode__regex', 'settings_json__videoUrl__regex'])
        self.assertTrue(all(child[1] == FILE_ID for child in condition.children))

    def test_an_unreadable_curriculum_fails_closed(self):
        with patch('curriculum_api.models.ModuleAuthoringComponent.objects') as components:
            components.filter.side_effect = DatabaseError('offline')
            self.assertFalse(drive.is_course_linked(FILE_ID))


class SaveRefreshTokenTests(SimpleTestCase):
    def saved(self, original):
        with tempfile.NamedTemporaryFile('w', delete=False, encoding='utf-8', newline='', suffix='.env') as handle:
            handle.write(original)
        self.addCleanup(os.unlink, handle.name)
        AuthorizeCommand()._save(handle.name, 'new-token')
        with open(handle.name, encoding='utf-8', newline='') as handle:
            return handle.read()

    def test_appends_once_and_replaces_only_its_own_line(self):
        self.assertEqual(self.saved('A=1\r\nB=2\r\n'), f'A=1\r\nB=2\r\n{drive.REFRESH_TOKEN_ENV}=new-token\r\n')
        self.assertEqual(self.saved(f'A=1\r\n{drive.REFRESH_TOKEN_ENV}=old\r\nB=2'),
                         f'A=1\r\n{drive.REFRESH_TOKEN_ENV}=new-token\r\nB=2')
        self.assertEqual(self.saved('A=1'), f'A=1\n{drive.REFRESH_TOKEN_ENV}=new-token\n')
