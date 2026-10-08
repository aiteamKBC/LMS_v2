"""Hermetic checks for PDFs built from saved Inclusion screening content."""

from io import BytesIO

from django.test import SimpleTestCase
from pypdf import PdfReader

from login.inclusion_report_pdf import build_inclusion_report_pdf


class InclusionReportPdfTests(SimpleTestCase):
    def test_pdf_contains_saved_sections_and_synthetic_learner_identity(self):
        report = {
            'reportHeader': {
                'learnerName': 'Sample Learner', 'learnerEmail': 'sample@example.invalid',
                'programme': 'Sample Programme', 'organisation': 'Example Organisation',
                'overallRiskLevel': 'Low', 'generatedAt': '2026-10-07',
            },
            'overview': {'overallScore': 127, 'overallMaxScore': 600},
            'riskRoadmap': [{'label': 'Digital access', 'score': 23, 'maxScore': 100,
                             'riskLevel': 'Low'}],
            'executiveSummary': 'Saved summary wording.',
            'keyFindings': [{'area': 'Online participation', 'finding': 'Saved finding.',
                             'recommendedResponse': 'Saved response.', 'riskLevel': 'Low'}],
            'supportPlan': {'digitalSupport': ['Saved support step.']},
            'priorityActions': [{'priority': 'Low', 'owner': 'Coach',
                                 'action': 'Saved action.', 'due': 'Within 2 weeks'}],
            'reviewTimeline': {'initialReview': 'Within 2 weeks'},
            'managerBrief': {'recommendedNextStep': 'Saved next step.'},
            'professionalNote': 'Saved professional note.',
        }

        pdf = build_inclusion_report_pdf(report)
        self.assertTrue(pdf.startswith(b'%PDF'))
        text = '\n'.join(page.extract_text() or '' for page in PdfReader(BytesIO(pdf)).pages)
        for phrase in ('Sample Learner', '127 / 600', 'Digital access',
                       'Saved summary wording.', 'Saved support step.',
                       'Saved action.', 'Saved next step.', 'Saved professional note.'):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
