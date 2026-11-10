"""Real PDF exports from the backend-only image layout; no live services."""
from io import BytesIO
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import SimpleTestCase
from pypdf import PdfReader

from . import recordings_pdf as pdf
from .recordings_calendar_media import calendar_context, calendar_record


class PackagedEvidencePdfTests(SimpleTestCase):
    def test_transcript_and_report_export_without_a_frontend_checkout(self):
        record = calendar_record(calendar_context('coach@example.invalid', 'synthetic-event',
            '2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z'))
        analysis = {'id': 'synthetic-report', 'learnerName': 'Synthetic learner',
                    'report': {'executive_summary': 'Synthetic saved report evidence.'}}
        evidence = {'transcript': {'content': 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Synthetic speaker>Verified transcript evidence</v>'}}
        packaged_logo = Path(pdf.__file__).resolve().parents[1] / 'curriculum_api' / 'templates' / 'kbc-logo.png'
        with TemporaryDirectory(prefix='lms-pdf-image-') as folder:
            image = Path(folder) / 'app'
            logo = image / 'curriculum_api' / 'templates' / 'kbc-logo.png'
            logo.parent.mkdir(parents=True)
            (image / 'coach_api').mkdir()
            shutil.copyfile(packaged_logo, logo)
            self.assertFalse((Path(folder) / 'frontend').exists())
            with patch.object(pdf, '__file__', str(image / 'coach_api' / 'recordings_pdf.py')), \
                    patch('socket.socket', side_effect=AssertionError('Network forbidden')):
                for kind, selected, expected in (
                    ('transcript', None, 'Verified transcript evidence'),
                    ('analysis', analysis, 'Synthetic saved report evidence.'),
                ):
                    with self.subTest(kind=kind):
                        content = pdf._render(record, evidence, selected, kind)
                        self.assertTrue(content.startswith(b'%PDF-'))
                        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
                        self.assertIn(expected, text)
