"""Material account isolation and backup downloads; no DB or live services."""
import importlib.util
import io
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api import material_storage

spec = importlib.util.spec_from_file_location('backup', Path(__file__).resolve().parents[1] / 'scripts/backup_source_materials.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class MaterialStorageTests(unittest.TestCase):
    def test_dedicated_account_does_not_repoint_existing_backups(self):
        settings = SimpleNamespace(AZURE_STORAGE_ACCOUNT='evidence', AZURE_STORAGE_KEY='test-old',
            AZURE_MATERIALS_STORAGE_ACCOUNT='materials', AZURE_MATERIALS_STORAGE_KEY='test-new',
            AZURE_MATERIALS_SAS_TTL_MINUTES=15)
        row = {'material_blob_container': 'private', 'material_blob_name': 'file one.pdf'}
        with patch.object(material_storage, 'generate_blob_sas', return_value='test-token') as sas:
            self.assertIn('https://evidence.', material_storage.read_url(row, settings))
            self.assertEqual(sas.call_args.kwargs['account_key'], 'test-old')
            row['material_blob_account'] = 'materials'
            self.assertIn('https://materials.', material_storage.read_url(row, settings))
            self.assertEqual(sas.call_args.kwargs['account_key'], 'test-new')
            self.assertEqual(str(sas.call_args.kwargs['permission']), 'r')
            row['material_blob_account'] = 'unknown'
            with self.assertRaises(ValueError):
                material_storage.read_url(row, settings)

    def test_drive_links_convert_without_guessing_files_or_hosts(self):
        self.assertEqual(backup.drive_download_url('https://drive.google.com/file/d/file_123/preview'),
                         'https://drive.usercontent.google.com/download?id=file_123&export=download')
        self.assertIn('resourcekey=key', backup.drive_download_url('https://drive.google.com/open?id=file_123&resourcekey=key'))
        self.assertIsNone(backup.drive_download_url('https://drive.google.com/drive/folders/folder'))
        self.assertIsNone(backup.drive_download_url('https://evil.test/file/d/file_123/preview'))
        self.assertIsNone(backup.drive_download_url('https://user:password@drive.google.com/file/d/file_123/preview'))

    def test_private_addresses_and_unapproved_hosts_rejected(self):
        with patch.object(backup.socket, 'getaddrinfo', return_value=[(0,0,0,'',('127.0.0.1',443))]):
            for url in ('https://files.test/file', 'https://other.test/file', 'http://files.test/file'):
                with self.assertRaises(ValueError):
                    backup.validate_url(url, {'files.test'})

    def response(self, mime, chunks):
        response = Mock(is_redirect=False, headers={'Content-Type': mime})
        response.iter_content.return_value = chunks
        context = Mock()
        context.__enter__ = Mock(return_value=response)
        context.__exit__ = Mock(return_value=False)
        return context

    def download(self, mime, chunks, limit=100):
        session = Mock()
        session.get.return_value = self.response(mime, chunks)
        context = Mock()
        context.__enter__ = Mock(return_value=session)
        context.__exit__ = Mock(return_value=False)
        with patch.object(backup, 'validate_url'), patch.object(backup.requests, 'Session', return_value=context):
            output = io.BytesIO()
            result = backup.download('https://files.test/a', {'files.test'}, output, limit)
            return result, output.read()

    def test_pdf_bytes_and_hash_verified(self):
        result, data = self.download('application/pdf', [b'%PDF-example'])
        self.assertEqual(result[1], len(data))
        self.assertEqual(result[2], backup.hashlib.sha256(data).hexdigest())

    def test_login_page_is_not_saved_as_pdf(self):
        for mime, content in [('text/html', b'<html>login'), ('application/pdf', b'<html>login')]:
            with self.assertRaises(ValueError):
                self.download(mime, [content])

    def test_stream_limit_and_empty_files_rejected(self):
        with self.assertRaises(ValueError):
            self.download('application/pdf', [b'%PDF-too-large'], limit=4)
        with self.assertRaises(ValueError):
            self.download('application/pdf', [])

    def test_network_retry_discards_partial_download(self):
        output = io.BytesIO()
        def attempt(*args):
            if output.getvalue():
                self.fail('partial bytes leaked into retry')
            if mock.call_count == 1:
                output.write(b'partial')
                raise backup.requests.ConnectionError()
            return ('video/mp4', 4, 'hash')
        with patch.object(backup, 'download_once', side_effect=attempt) as mock, patch.object(backup.time, 'sleep'):
            self.assertEqual(backup.download('https://files.test/a', {'files.test'}, output, 100)[0], 'video/mp4')
            self.assertEqual(mock.call_count, 2)

    def test_permission_failure_is_not_retried(self):
        response = Mock(status_code=403)
        error = backup.requests.HTTPError(response=response)
        with patch.object(backup, 'download_once', side_effect=error) as mock, patch.object(backup.time, 'sleep') as sleep:
            with self.assertRaises(backup.requests.HTTPError):
                backup.download('https://files.test/a', {'files.test'}, io.BytesIO(), 100)
            self.assertEqual(mock.call_count, 1)
            sleep.assert_not_called()

    def confirmation(self, ident='file_123', action='https://drive.usercontent.google.com/download'):
        return f'''<form id="download-form" action="{action}" method="get">
          <input type="hidden" name="id" value="{ident}">
          <input type="hidden" name="export" value="download">
          <input type="hidden" name="confirm" value="t">
          <input type="hidden" name="uuid" value="example"></form>'''

    def test_drive_confirmation_keeps_exact_file_and_resource_key(self):
        url = 'https://drive.usercontent.google.com/download?id=file_123&export=download&resourcekey=key'
        result = backup.drive_confirmation_url(url, self.confirmation())
        self.assertEqual(backup.parse_qs(backup.urlsplit(result).query),
            {'id':['file_123'], 'export':['download'], 'confirm':['t'], 'uuid':['example'], 'resourcekey':['key']})
        for html in (self.confirmation('other_file'), self.confirmation(action='https://evil.test/download'),
                     self.confirmation(action='https://drive.usercontent.google.com/download?id=other'),
                     '<html>Permission required</html>'):
            self.assertIsNone(backup.drive_confirmation_url(url, html))

    def test_drive_confirmation_page_is_followed_before_writing_video(self):
        url = 'https://drive.usercontent.google.com/download?id=file_123&export=download'
        session = Mock()
        session.get.side_effect = [self.response('text/html', [self.confirmation().encode()]),
                                   self.response('video/mp4', [b'example-video'])]
        context = Mock()
        context.__enter__ = Mock(return_value=session)
        context.__exit__ = Mock(return_value=False)
        with patch.object(backup, 'validate_url'), patch.object(backup.requests, 'Session', return_value=context):
            output = io.BytesIO()
            result = backup.download(url, {'drive.usercontent.google.com'}, output, 100)
            self.assertEqual(result[0], 'video/mp4')
            self.assertEqual(output.read(), b'example-video')
            self.assertIn('confirm=t', session.get.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
