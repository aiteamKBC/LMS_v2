"""Assessment report time must come from the labelled PDF field."""

from io import BytesIO
from decimal import Decimal
from unittest.mock import patch

from django.test import SimpleTestCase
from reportlab.pdfgen import canvas

from login.assessment_report_hours import report_seconds
from login.management.commands.sync_advanced_admin_report_hours import SOURCE_SQL, _read_report


def _report(*lines):
    stream = BytesIO()
    pdf = canvas.Canvas(stream)
    for index, line in enumerate(lines):
        pdf.drawString(40, 780 - index * 20, line)
    pdf.save()
    return stream.getvalue()


class AssessmentReportHoursTests(SimpleTestCase):
    def test_source_includes_scoped_misc_component_spelling_variant(self):
        self.assertIn('(additional|additioinal)[[:space:]]+job', SOURCE_SQL)
        self.assertIn('|miscellan', SOURCE_SQL)
        self.assertIn('login."Advanced_admin_learner_scope"', SOURCE_SQL)
        self.assertIn('s.aptem_id = e.learner_id::text', SOURCE_SQL)

    def test_reads_the_labelled_hours_and_minutes(self):
        self.assertEqual(report_seconds(_report('Time spent 02:15')), 8100)
        self.assertEqual(report_seconds(_report('Time Spent: 00:30')), 1800)

    def test_ignores_other_numbers_and_accepts_zero(self):
        self.assertIsNone(report_seconds(_report('Planned hours 05:00', 'Score 85')))
        self.assertEqual(report_seconds(_report('Time spent 00:00')), 0)

    def test_rejects_conflicting_report_values(self):
        self.assertIsNone(report_seconds(_report('Time spent 01:00', 'Time spent 02:00')))

    @patch('login.management.commands.sync_advanced_admin_report_hours.download_blob_bytes')
    def test_cache_uses_report_value_even_when_source_minutes_differ(self, download):
        download.return_value = _report('Time spent 02:30')
        evidence_id, fingerprint, seconds, status, differs = _read_report(
            (101, 'private-report.pdf', Decimal('120')))
        self.assertEqual((evidence_id, seconds, status, differs), (101, 9000, 'parsed', True))
        self.assertEqual(len(fingerprint), 32)
        download.assert_called_once_with('fetch-aptem-evidences', 'private-report.pdf',
                                         max_bytes=5 * 1024 * 1024)
