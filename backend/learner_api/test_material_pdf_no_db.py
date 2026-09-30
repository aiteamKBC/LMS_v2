"""Private PDF delivery on the LMS origin; no database or live transport."""
import ast
import io
from email.message import Message
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure()
from learner_api import material_storage


class MaterialPdfTests(unittest.TestCase):
    def upstream(self, data=b'%PDF-example', status=200, mime='application/pdf'):
        response = io.BytesIO(data)
        response.status = status
        response.headers = Message()
        response.headers['Content-Type'] = mime
        response.headers['Content-Length'] = str(len(data))
        response.headers['Accept-Ranges'] = 'bytes'
        if status == 206:
            response.headers['Content-Range'] = 'bytes 0-4/20'
        return response

    def test_pdf_is_streamed_without_redirect_and_closed_after_response(self):
        upstream = self.upstream()
        with patch.object(material_storage, 'read_url', return_value='https://storage.test/file?sig=private'), \
                patch.object(material_storage.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = upstream
            response = material_storage.pdf_response({}, settings, SimpleNamespace(headers={}))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'application/pdf')
            self.assertNotIn('Location', response)
            self.assertEqual(b''.join(response.streaming_content), b'%PDF-example')
            self.assertEqual(response['X-Frame-Options'], 'SAMEORIGIN')
            response.close()
            self.assertTrue(upstream.closed)

    def test_range_is_forwarded_and_partial_response_preserved(self):
        with patch.object(material_storage, 'read_url', return_value='https://storage.test/file'), \
                patch.object(material_storage.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = self.upstream(b'%PDF-', 206)
            response = material_storage.pdf_response({}, settings, SimpleNamespace(headers={'Range': 'bytes=0-4'}))
            self.assertEqual(opener.return_value.open.call_args.args[0].get_header('Range'), 'bytes=0-4')
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response['Content-Range'], 'bytes 0-4/20')
            self.assertEqual(b''.join(response.streaming_content), b'%PDF-')
            response.close()

    def test_non_pdf_error_page_is_rejected_and_closed(self):
        upstream = self.upstream(b'<html>login</html>', mime='text/html')
        with patch.object(material_storage, 'read_url', return_value='https://storage.test/file'), \
                patch.object(material_storage.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = upstream
            with self.assertRaises(ValueError):
                material_storage.pdf_response({}, settings, SimpleNamespace(headers={}))
            self.assertTrue(upstream.closed)

    def test_source_file_checks_ownership_and_backup_before_streaming(self):
        tree = ast.parse(Path(__file__).with_name('student_activity.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'source_material_file')
        self.assertIn('learner_self_or_staff', ast.unparse(node.decorator_list))
        node.decorator_list = []
        owned = Mock(return_value=(8, {'_source': {'_material_blob_ready': True,
            'material_blob_content_type': 'application/pdf'}}))
        scope = {'__package__': 'learner_api', '_owned_material': owned,
            '_error': lambda message, status: status, 'DatabaseError': RuntimeError}
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'source-file', 'exec'), scope)
        with patch.object(material_storage, 'pdf_response', return_value={}) as stream:
            result = scope['source_material_file'](None, 'learner', 3, 5, 1)
            owned.assert_called_once_with('learner', 3, 5, 1)
            self.assertEqual(result['Cache-Control'], 'private, no-store')
            self.assertEqual(result['Referrer-Policy'], 'no-referrer')
            stream.reset_mock()
            owned.return_value[1]['_source']['_material_blob_ready'] = False
            self.assertEqual(scope['source_material_file'](None, 'learner', 3, 5, 1), 404)
            stream.assert_not_called()
            owned.side_effect = LookupError('Not owned')
            self.assertEqual(scope['source_material_file'](None, 'learner', 3, 5, 1), 404)
            stream.assert_not_called()


if __name__ == '__main__':
    unittest.main()
