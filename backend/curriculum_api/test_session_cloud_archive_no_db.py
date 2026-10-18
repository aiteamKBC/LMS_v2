"""Pure transfer-selection tests; all Graph, SharePoint and Azure I/O is mocked."""

import unittest
from contextlib import nullcontext
from unittest.mock import Mock, patch

from curriculum_api.session_cloud_archive import EDGE_BYTES, copy_matched_recording, verify_existing_recording


class CloudArchiveTests(unittest.TestCase):
    def setUp(self):
        self.video = b'a' * EDGE_BYTES + b'b' * EDGE_BYTES
        self.item = {'id': 'DRIVE-1', 'name': 'session.mp4', 'size': len(self.video),
                     'createdDateTime': '2026-10-09T07:47:32Z', 'file': {}}
        self.artifact = {'created_datetime': '2026-10-09T07:47:58Z'}
        self.source = 'https://tenant.sharepoint.com/private-download?opaque=secret'
        self.graph_get = Mock(side_effect=lambda method, path: (
            {'value': [self.item]} if '/children?' in path else
            {'id': 'DRIVE-1', 'size': len(self.video), '@microsoft.graph.downloadUrl': self.source}))
        self.transport = Mock()
        def response_for(_method, url, *, headers):
            requested = headers['Range'].removeprefix('bytes=')
            start, end = map(int, requested.split('-'))
            response = Mock(status_code=206,
                            headers={'Content-Range': f'bytes {start}-{end}/{len(self.video)}'})
            data = self.video[start:end + 1]
            if url == self.source and getattr(self, 'wrong_source', False):
                data = b'x' * len(data)
            response.iter_bytes.return_value = [data]
            return nullcontext(response)
        self.transport.stream.side_effect = response_for
        self.client_patch = patch('curriculum_api.session_cloud_archive.httpx.Client',
                                  return_value=nullcontext(self.transport))
        self.client_patch.start(); self.addCleanup(self.client_patch.stop)
        def source_response(request, *, timeout):
            start, end = map(int, request.headers['Range'].removeprefix('bytes=').split('-'))
            data = self.video[start:end + 1]
            if getattr(self, 'wrong_source', False):
                data = b'x' * len(data)
            response = Mock(status=206,
                            headers={'Content-Range': f'bytes {start}-{end}/{len(self.video)}'})
            response.geturl.return_value = self.source
            response.read.return_value = data
            return nullcontext(response)
        self.source_patch = patch('curriculum_api.session_cloud_archive.urlopen',
                                  side_effect=source_response)
        self.source_patch.start(); self.addCleanup(self.source_patch.stop)
        self.blob = Mock()
        self.blob.exists.return_value = False
        self.blob.get_blob_properties.return_value.size = len(self.video)
        self.blob.download_blob.side_effect = lambda *, offset, length, **_kwargs: Mock(
            readall=Mock(return_value=self.video[offset:offset + length]))

    def copy(self):
        return copy_matched_recording(
            self.artifact, 'organizer@example.invalid',
            'https://graph.microsoft.com/v1.0/recordings/REC/content', 'synthetic-token',
            self.blob, graph_get=self.graph_get,
            graph_base='https://graph.microsoft.com/v1.0', drive_cache={})

    def test_unique_matching_source_is_copied_and_verified(self):
        self.assertTrue(self.copy())
        self.blob.upload_blob_from_url.assert_called_once()
        self.assertEqual(self.blob.upload_blob_from_url.call_args.args, (self.source,))
        self.assertFalse(self.blob.upload_blob_from_url.call_args.kwargs['overwrite'])
        self.assertEqual(self.transport.stream.call_count, 2)

    def test_wrong_source_bytes_never_copies(self):
        self.wrong_source = True
        self.assertFalse(self.copy())
        self.blob.upload_blob_from_url.assert_not_called()

    def test_ambiguous_same_size_and_time_never_copies(self):
        self.graph_get.side_effect = lambda method, path: {'value': [
            self.item, {**self.item, 'id': 'DRIVE-2'}]}
        self.assertFalse(self.copy())
        self.blob.upload_blob_from_url.assert_not_called()

    def test_untrusted_download_url_never_copies(self):
        self.source = 'https://example.invalid/media'
        self.assertFalse(self.copy())
        self.blob.upload_blob_from_url.assert_not_called()

    def test_incorrect_azure_bytes_cannot_be_marked_ready(self):
        self.blob.download_blob.side_effect = lambda **kwargs: Mock(readall=Mock(return_value=b'x' * EDGE_BYTES))
        with self.assertRaisesRegex(ValueError, 'archived recording bytes'):
            self.copy()

    def test_orphaned_blob_is_reused_only_when_graph_bytes_match(self):
        self.blob.exists.return_value = True
        self.assertTrue(verify_existing_recording(
            self.blob, 'https://graph.microsoft.com/v1.0/recordings/REC/content', 'synthetic-token'))
        self.assertEqual(self.transport.stream.call_count, 3)
        self.blob.get_blob_properties.return_value.size -= 1
        self.assertFalse(verify_existing_recording(
            self.blob, 'https://graph.microsoft.com/v1.0/recordings/REC/content', 'synthetic-token'))

    def test_small_orphaned_recording_can_be_verified(self):
        self.video = b'small video'
        self.blob.get_blob_properties.return_value.size = len(self.video)
        self.assertTrue(verify_existing_recording(
            self.blob, 'https://graph.microsoft.com/v1.0/recordings/REC/content', 'synthetic-token'))


if __name__ == '__main__':
    unittest.main()
