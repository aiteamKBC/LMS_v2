import datetime
import io

from django.test import SimpleTestCase
from pypdf import PdfReader

from .report_pdf import build_assessment_report_pdf, format_time_spent, template_for_date


class AssessmentReportPdfTests(SimpleTestCase):
    def test_brand_cutoff_and_minutes_match_aptem_rules(self):
        self.assertEqual(template_for_date(datetime.date(2025, 6, 15)), 'ibis')
        self.assertEqual(template_for_date(datetime.date(2025, 6, 16)), 'kent')
        self.assertEqual(format_time_spent(95), '01:35')

    def test_builds_a_real_readable_pdf_with_multiline_sections(self):
        pdf = build_assessment_report_pdf({
            'learner_name': 'Alex Learner',
            'activity_name': 'Marketing activity',
            'evidence_name': 'Assignment.pdf',
            'time_spent': 95,
            'result': 'Accepted',
            'assessor': 'Tutor Name',
            'date': '08/09/2026',
            'criteria': 'Knowledge: <b>K1</b>\nSkills: S2',
            'comments': '<p><strong>Strong</strong> workplace evidence.</p><script>removed</script>',
            'evidence_date': datetime.date(2025, 7, 1),
        })
        self.assertTrue(pdf.startswith(b'%PDF'))
        text = '\n'.join(page.extract_text() or '' for page in PdfReader(io.BytesIO(pdf)).pages)
        self.assertIn('Alex Learner', text)
        self.assertIn('01:35', text)
        self.assertIn('Knowledge:', text)
        self.assertIn('Strong workplace evidence.', text)
        self.assertNotIn('<script>', text)
