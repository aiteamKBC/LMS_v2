"""Video handoff regressions: synthetic bytes, temporary storage, fake databases/HTTP."""
import copy
import hashlib
import io
import tempfile
import uuid
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.core.files.base import ContentFile
from django.http import JsonResponse
from django.test import SimpleTestCase
from django.utils import timezone

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_oauth import Row
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import describe, REGISTRY, ToolError
from mcp_api.tools import read, video

MP4 = b'\x00\x00\x00\x20ftypisom' + b'\x00' * 64
FILE = {"download_url": "https://files.example.com/video.mp4?temporary=synthetic", "file_id": "file-1",
        "file_name": "Lesson.mp4", "mime_type": "video/mp4"}
ARGS = {"programme_id": "P1", "module_id": "M1", "component_id": "V1", "file": FILE}
MODULE = {"moduleCatalogueId": "M1", "programmeId": "P1", "cohortId": "C1", "groupId": "G1",
          "title": "Marketing", "status": "draft", "weekStructure": [
              {"id": "W1", "title": "Week one", "components": [
                  {"id": "V1", "title": "Lesson", "type": "video",
                   "settings": {"videoUrl": "https://example.com/original.mp4", "expectedOtjh": 2}},
              ]},
          ]}


class VideoPendingManager(PendingManager):
    def create(self, **values):
        fields = {"applied_at": None, "cancelled_at": None, "result": None, "created_at": timezone.now(), **values}
        row = Row(pk=fields["id"], **fields)
        self.rows.append(row)
        return row


class VideoTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_VIDEO_UPLOADS_ENABLED": "1", "BUNNY_STREAM_ENABLED": "1"}))
        self.pending = VideoPendingManager()
        fake_model = SimpleNamespace(objects=self.pending)
        self.enterContext(mock.patch.object(changes, "McpPendingChange", fake_model))
        self.enterContext(mock.patch.object(video, "McpPendingChange", fake_model))
        self.module = copy.deepcopy(MODULE)
        self.component = self.module["weekStructure"][0]["components"][0]
        self.post_count = 0
        self.calls = []
        self.downloads = []
        self.bytes = MP4
        self.upload_error = None
        self.saved_response = None
        self.media = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(mock.patch.object(read, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(video, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(video, "public_response", self.response))
        self.store_file = self.enterContext(mock.patch.object(video.upload_storage, "store", side_effect=self.store_bytes))
        self.delete_file = self.enterContext(mock.patch.object(video.upload_storage, "delete", side_effect=self.delete_bytes))
        self.enterContext(mock.patch.object(video.upload_storage, "local_copy", side_effect=self.local_copy))
        self.latest = self.enterContext(mock.patch.object(video, "_latest_import", return_value=SimpleNamespace(
            pk="job-1", status="queued", error="", source_at_start=self.component["settings"]["videoUrl"])))

    @contextmanager
    def response(self, url):
        self.downloads.append(url)
        yield io.BytesIO(self.bytes)

    def store_bytes(self, stream, relative, content_type):
        path = self.media / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(stream.read())
        return relative

    def delete_bytes(self, relative):
        (self.media / relative).unlink(missing_ok=True)

    def local_copy(self, relative):
        path = self.media / relative
        return (path if path.is_file() else None), lambda: None

    def api(self, request, method, path, *, query=None, json_body=None, uploaded_file=None):
        self.calls.append((method, path))
        if path.endswith('/programmes/'):
            return 200, {"results": [
                {"id": "P1", "name": "Marketing", "status": "active"},
                {"id": "P2", "name": "Marketing", "status": "active"},
            ]}
        if path.endswith('/modules/M1/structure/'):
            return 200, self.module
        if method == 'POST' and path.endswith('/videos/module/M1/V1/'):
            self.post_count += 1
            if self.upload_error:
                raise self.upload_error
            data = b''.join(uploaded_file.chunks())
            self.assertEqual(data, MP4)
            self.assertEqual(json_body["programme_id"], "P1")
            self.assertEqual(json_body["cohort_id"], "C1")
            self.assertEqual(json_body["group_id"], "G1")
            digest = hashlib.sha256(data).hexdigest()
            settings = {"videoUrl": f"/curriculum_api/curriculum/uploads/videos/module/M1/V1/{digest}.mp4",
                        "sourceType": "HTML (MP4)", "provider": "Upload file"}
            self.component["settings"].update(settings)
            self.latest.return_value.source_at_start = settings['videoUrl']
            return 202, (self.saved_response if self.saved_response is not None else
                         {"savedSettings": settings, "import": {"id": "job-1", "status": "queued"}})
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, name=video.NAME, arguments=None, token=None):
        response = self.post(rpc("tools/call", {"name": name, "arguments": ARGS if arguments is None else arguments}), token=token)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def preview(self):
        result = self.run_tool()
        self.assertFalse(result.get("isError"), result)
        return result["structuredContent"]["preview_id"]

    def apply(self, pid):
        return self.run_tool("apply_change", {"preview_id": pid})

    def pending_row(self, pid):
        return self.pending.filter(pk=uuid.UUID(pid)).first()

    def error(self, arguments=None):
        result = self.run_tool(arguments=arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]


class VideoPreviewTests(VideoTestCase):
    def test_preview_stages_bytes_without_changing_the_component_or_exposing_the_url(self):
        before = copy.deepcopy(self.module)
        result = self.run_tool()
        self.assertFalse(result.get("isError"), result)
        self.assertEqual(self.module, before)
        self.assertEqual(self.post_count, 0)
        self.assertNotIn(FILE["download_url"], str(result))
        self.assertNotIn(video.STAGE_ROOT, str(result))
        self.assertEqual(len(self.pending.rows), 2)  # closed staging ledger + user preview
        ledger = self.pending.rows[0]
        self.assertEqual(ledger.tool, video.STAGE_TOOL)
        self.assertIsNotNone(ledger.cancelled_at)
        self.assertEqual(self.pending.rows[1].payload["stage"]["size"], len(MP4))
        listing = self.run_tool("list_my_pending_changes", {})
        self.assertEqual(len(listing["structuredContent"]["pending"]), 1)

    def test_file_input_is_advertised_to_chatgpt(self):
        self.assertEqual(describe(REGISTRY[video.NAME])["_meta"], {"openai/fileParams": ["file"]})

    def test_video_flag_off_refuses_before_any_io(self):
        with mock.patch.dict('os.environ', {"MCP_VIDEO_UPLOADS_ENABLED": "0"}):
            self.assertIn("not enabled", self.error())
        self.assertEqual(self.calls, [])
        self.assertEqual(self.downloads, [])
        self.store_file.assert_not_called()

    def test_wrong_programme_with_the_same_name_is_refused(self):
        self.assertIn("does not belong", self.error({**ARGS, "programme_id": "P2"}))
        self.assertEqual(self.downloads, [])

    def test_published_module_is_refused(self):
        self.module["status"] = "published"
        self.assertIn("draft module", self.error())
        self.assertEqual(self.downloads, [])

    def test_non_video_and_missing_components_are_refused(self):
        for component_type in ('quiz', 'reading'):
            self.component["type"] = component_type
            self.assertIn("existing video component", self.error())
        self.assertIn("existing video component", self.error({**ARGS, "component_id": "missing"}))
        self.assertEqual(self.downloads, [])

    def test_extra_fields_and_local_paths_are_refused(self):
        self.assertIn("not a recognised input", self.error({**ARGS, "provider": "invented"}))
        for url in ("C:/Videos/lesson.mp4", "file:///C:/Videos/lesson.mp4", "http://example.com/video.mp4"):
            with self.subTest(url=url):
                self.assertIn("file-transfer", self.error({**ARGS, "file": {**FILE, "download_url": url}}))
        self.assertEqual(self.downloads, [])

    def test_invalid_video_bytes_never_reach_storage(self):
        for data in (b'<html>Sign in</html>', b'OggS' + b'\0' * 64, b''):
            self.bytes = data
            self.error()
        self.store_file.assert_not_called()
        self.delete_file.assert_not_called()

    def test_oversize_transfer_is_bounded(self):
        with mock.patch.object(video, 'MAX_VIDEO_BYTES', 8):
            self.assertIn("300 MB", self.error())
        self.store_file.assert_not_called()

    def test_failed_storage_keeps_a_closed_cleanup_ledger_and_no_preview(self):
        self.store_file.side_effect = RuntimeError('private storage details')
        message = self.error()
        self.assertNotIn('private storage details', message)
        self.assertEqual(len(self.pending.rows), 1)
        self.assertIsNotNone(self.pending.rows[0].cancelled_at)
        self.delete_file.assert_called_once()

    def test_account_without_curriculum_access_cannot_start_a_transfer(self):
        self.store.accesses[self.staff.pk] = frozenset()
        response = self.post(rpc('tools/call', {"name": video.NAME, "arguments": ARGS}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.downloads, [])

    def test_existing_token_is_refused_when_the_account_is_outside_the_pilot(self):
        with mock.patch.dict('os.environ', {'MCP_PILOT_ACCOUNT_IDS': '999999'}):
            response = self.post(rpc('tools/call', {"name": video.NAME, "arguments": ARGS}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.downloads, [])


class VideoApplyTests(VideoTestCase):
    def test_apply_uses_existing_upload_contract_once_and_preserves_other_settings(self):
        pid = self.preview()
        stage = self.pending_row(pid).payload['stage']
        result = self.apply(pid)
        self.assertFalse(result.get('isError'), result)
        self.assertEqual(result['structuredContent']['result']['bunny_status'], 'queued')
        self.assertEqual(self.component['settings']['provider'], 'Upload file')
        self.assertEqual(self.component['settings']['expectedOtjh'], 2)
        self.assertFalse((self.media / stage['path']).exists())
        again = self.apply(pid)
        self.assertTrue(again['structuredContent']['already_applied'])
        self.assertEqual(self.post_count, 1)

    def test_other_account_cannot_apply_the_upload(self):
        pid = self.preview()
        _client, body = self.tokens(self.store.account(email='other@example.com'))
        result = self.run_tool('apply_change', {'preview_id': pid}, token=body['access_token'])
        self.assertTrue(result['isError'])
        self.assertEqual(self.post_count, 0)

    def test_source_or_scope_changes_cancel_the_preview_before_upload(self):
        for change in ('source', 'scope', 'week'):
            with self.subTest(change=change):
                self.module = copy.deepcopy(MODULE)
                self.component = self.module['weekStructure'][0]['components'][0]
                pid = self.preview()
                if change == 'source':
                    self.component['settings']['videoUrl'] = 'https://example.com/new.mp4'
                elif change == 'scope':
                    self.module['groupId'] = 'G2'
                else:
                    self.module['weekStructure'][0]['id'] = 'W2'
                self.assertTrue(self.apply(pid)['isError'])
        self.assertEqual(self.post_count, 0)

    def test_missing_or_modified_staged_bytes_are_refused(self):
        for missing in (True, False):
            with self.subTest(missing=missing):
                pid = self.preview()
                path = self.media / self.pending_row(pid).payload['stage']['path']
                if missing:
                    path.unlink()
                else:
                    path.write_bytes(MP4 + b'changed')
                self.assertTrue(self.apply(pid)['isError'])
        self.assertEqual(self.post_count, 0)

    def test_disabled_or_expired_preview_never_saves(self):
        pid = self.preview()
        self.pending_row(pid).expires_at = timezone.now() - timedelta(seconds=1)
        self.assertTrue(self.apply(pid)['isError'])
        pid = self.preview()
        with mock.patch.dict('os.environ', {'MCP_VIDEO_UPLOADS_ENABLED': '0'}):
            self.assertTrue(self.apply(pid)['isError'])
        self.assertEqual(self.post_count, 0)

    def test_unconfirmed_save_is_reported_as_unknown_not_as_unsaved(self):
        pid = self.preview()
        self.upload_error = dispatch.DispatchError('The LMS response was unavailable.', 500)
        result = self.apply(pid)
        self.assertTrue(result['isError'])
        self.assertEqual(self.pending_row(pid).result['status'], 'unknown')
        self.assertIn('may have been saved', result['content'][0]['text'])
        self.assertNotIn('before anything was saved', result['content'][0]['text'])
        self.assertTrue(self.apply(pid)['isError'])
        self.assertEqual(self.post_count, 1)

    def test_mismatched_saved_source_response_is_not_reported_as_success(self):
        pid = self.preview()
        self.saved_response = {'savedSettings': {'videoUrl': '/some-other-file.mp4',
                                                'sourceType': 'HTML (MP4)', 'provider': 'Upload file'}}
        result = self.apply(pid)
        self.assertTrue(result['isError'])
        self.assertEqual(self.pending_row(pid).result['status'], 'unknown')
        self.assertNotIn('Done.', result['content'][0]['text'])

    def test_status_does_not_start_a_transfer_and_remains_readable_after_publish(self):
        pid = self.preview()
        self.apply(pid)
        self.module['status'] = 'published'
        self.calls.clear()
        self.downloads.clear()
        result = self.run_tool('get_video_import_status', {k: ARGS[k] for k in video.DESTINATION})
        self.assertFalse(result.get('isError'), result)
        self.assertTrue(result['structuredContent']['lms_source_recorded'])
        self.assertEqual(result['structuredContent']['bunny_status'], 'queued')
        self.assertEqual(self.downloads, [])
        self.assertTrue(all(method == 'GET' for method, _path in self.calls))
        self.assertEqual(self.post_count, 1)

    def test_status_does_not_report_an_old_copy_as_the_current_video(self):
        pid = self.preview()
        self.apply(pid)
        self.latest.return_value.status = 'ready'
        self.component['settings']['videoUrl'] = 'https://example.com/replacement.mp4'
        result = self.run_tool('get_video_import_status', {k: ARGS[k] for k in video.DESTINATION})
        self.assertEqual(result['structuredContent']['bunny_status'], 'source_changed')
        self.assertIsNone(result['structuredContent']['import_id'])


class VideoDispatchTests(SimpleTestCase):
    def test_existing_video_endpoint_accepts_the_forwarded_file_and_scope(self):
        from curriculum_api import video_imports

        account = SimpleNamespace(pk=5, role='staff')
        uploaded = ContentFile(MP4, name='Lesson.mp4')
        scope = {'programme_id': 'P1', 'cohort_id': 'C1', 'group_id': 'G1'}
        component = MODULE['weekStructure'][0]['components'][0]
        asset = SimpleNamespace(id='job-1', status='queued', error='', library_id='123',
                                video_id='', collection_id='', source_at_start='/saved.mp4')
        saved = {'videoUrl': '/saved.mp4', 'sourceType': 'HTML (MP4)', 'provider': 'Upload file'}
        with mock.patch.object(dispatch, 'refusal_for', return_value=None), \
                mock.patch.object(video_imports, 'enabled', return_value=True), \
                mock.patch.object(video_imports, 'target', return_value=({}, [component], scope)), \
                mock.patch.object(video_imports, 'save_mp4', return_value=(asset, saved)) as save, \
                mock.patch.object(video_imports.transaction, 'on_commit') as on_commit:
            status, data = dispatch.call_api(SimpleNamespace(login_account=account), 'POST',
                                             '/curriculum_api/curriculum/videos/module/M1/V1/',
                                             json_body={'title': 'Lesson', **scope}, uploaded_file=uploaded)
        self.assertEqual(status, 202)
        self.assertEqual(data['savedSettings'], saved)
        self.assertEqual(data['import']['status'], 'queued')
        save.assert_called_once_with('module', 'M1', component, scope, uploaded, title='Lesson')
        on_commit.assert_called_once_with(video_imports.wake_worker)

    def test_video_file_is_forwarded_as_a_stream_with_the_authenticated_identity(self):
        account = SimpleNamespace(pk=5, role='staff')
        uploaded = ContentFile(MP4, name='Lesson.mp4')
        seen = {}

        def view(request):
            seen.update(account=request.login_account, uploaded=request.FILES['file'], title=request.POST['title'])
            return JsonResponse({'savedSettings': {'sourceType': 'HTML (MP4)'}})

        match = SimpleNamespace(func=view, args=(), kwargs={}, route='component-video')
        with mock.patch.object(dispatch, 'refusal_for', return_value=None), \
                mock.patch.object(dispatch, 'resolve', return_value=match):
            status, _data = dispatch.call_api(SimpleNamespace(login_account=account), 'POST',
                                             '/curriculum_api/curriculum/videos/module/M1/V1/',
                                             json_body={'title': 'Lesson'}, uploaded_file=uploaded)
        self.assertEqual(status, 200)
        self.assertIs(seen['account'], account)
        self.assertIs(seen['uploaded'], uploaded)
        self.assertEqual(seen['title'], 'Lesson')

    def test_files_cannot_be_sent_to_other_endpoints(self):
        with self.assertRaises(dispatch.DispatchError):
            dispatch.call_api(SimpleNamespace(login_account=None), 'GET',
                              '/curriculum_api/curriculum/programmes/', uploaded_file=ContentFile(MP4))

    def test_video_post_without_a_file_cannot_retry_a_source_import(self):
        with mock.patch.object(dispatch, 'resolve') as resolve:
            with self.assertRaisesRegex(dispatch.DispatchError, 'MP4 file'):
                dispatch.call_api(SimpleNamespace(login_account=None), 'POST',
                                  '/curriculum_api/curriculum/videos/module/M1/V1/', json_body={})
        resolve.assert_not_called()


class VideoCleanupTests(SimpleTestCase):
    def test_cleanup_only_deletes_expired_stages_owned_by_the_row_account(self):
        valid = {'path': 'mcp_video_staging/5/' + 'a' * 32 + '.mp4'}
        wrong_owner = {'path': 'mcp_video_staging/6/' + 'b' * 32 + '.mp4'}
        rows = mock.Mock()
        rows.iterator.return_value = [
            {'account_id': 5, 'payload': {'stage': valid}},
            {'account_id': 5, 'payload': {'stage': wrong_owner}},
            {'account_id': 5, 'payload': {'stage': {'path': '../other.mp4'}}},
        ]
        model = mock.Mock()
        model.objects.filter.return_value.values.return_value = rows
        now = timezone.now()
        with mock.patch.object(video, 'McpPendingChange', model), \
                mock.patch.object(video.upload_storage, 'delete') as delete:
            self.assertEqual(video.cleanup_expired_video_previews(now, dry_run=True), 1)
            delete.assert_not_called()
            self.assertEqual(video.cleanup_expired_video_previews(now), 1)
            delete.assert_called_once_with(valid['path'])
        model.objects.filter.assert_called_with(tool__in=[video.NAME, video.STAGE_TOOL], expires_at__lt=now)

    def test_private_download_address_is_refused_before_connecting(self):
        request = SimpleNamespace(login_account=SimpleNamespace(pk=5))
        address = [(2, 1, 6, '', ('127.0.0.1', 443))]
        with mock.patch('socket.getaddrinfo', return_value=address), \
                mock.patch('urllib3.HTTPSConnectionPool') as pool, \
                mock.patch.object(video.upload_storage, 'delete') as delete:
            with self.assertRaises(ToolError):
                video._stage(FILE, request)
        pool.assert_not_called()
        delete.assert_not_called()
