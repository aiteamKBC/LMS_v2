"""Run directly: isolated settings, mocked HTTP, no database or live services."""
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import quote
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
settings.configure(KBC_LMS_SCHEMA_URL='https://source.example/wp-json/kbc-lms/v1/schema', KBC_LMS_API_KEY='')
from learner_api.subject_content import build_material, original_is_pdf, _cache


class PdfFallbackTests(unittest.TestCase):
    def setUp(self):
        _cache.clear()
        self.url = 'https://source.example/wp-json/kbc-lms/v1/material/10/view?attachment_id=9&token=synthetic'
        self.stored = {'title': 'Lecture PPT', '_source': {'activity_id': 10},
                       'reading_url': 'https://view.officeapps.live.com/op/embed.aspx?src=' + quote(self.url, safe='')}
        self.network = patch('socket.socket', side_effect=AssertionError('No live network'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def test_schema_outage_recovers_pdf_from_verified_bytes(self):
        response = MagicMock()
        response.headers = {'Content-Type': 'application/pdf'}
        response.read.return_value = b'%PDF-'
        response.__enter__.return_value = response
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = response
            for _ in range(2):
                result = build_material(self.stored, None, pdf_checker=original_is_pdf)
                self.assertEqual(result['media'][0]['kind'], 'pdf')
                self.assertEqual(result['media'][0]['attachment_id'], '9')
                self.assertEqual(result['media'][0]['url'], self.url)
            opener.return_value.open.assert_called_once()
            response.read.assert_called_with(5)

    def test_untrusted_sources_are_never_probed(self):
        with patch('urllib.request.build_opener') as opener:
            for url in ('https://other.example/file', 'http://source.example/file',
                        'https://source.example/admin?attachment_id=9',
                        'https://user:pass@source.example/wp-json/kbc-lms/v1/material/10/view?attachment_id=9'):
                self.assertFalse(original_is_pdf(url))
            opener.assert_not_called()

    def test_html_and_ppt_are_not_misclassified_as_pdf(self):
        for mime, signature in [('text/html', b'<html'), ('application/pdf', b'<html'),
                                ('application/vnd.ms-powerpoint', b'PK123')]:
            _cache.clear()
            response = MagicMock()
            response.headers = {'Content-Type': mime}
            response.read.return_value = signature
            response.__enter__.return_value = response
            with patch('urllib.request.build_opener') as opener:
                opener.return_value.open.return_value = response
                self.assertFalse(original_is_pdf(self.url))

    def test_upstream_failure_does_not_invent_a_pdf(self):
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.side_effect = OSError('Unavailable')
            result = build_material(self.stored, None, pdf_checker=original_is_pdf)
            self.assertEqual(result['media'][0]['kind'], 'document')


if __name__ == '__main__':
    unittest.main()
