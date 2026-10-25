"""Real PDF bytes from synthetic evidence; no network or production database."""
from copy import deepcopy
from io import BytesIO
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase
from pypdf import PdfReader

from coach_api.recordings_calendar_media import calendar_context, calendar_record
from coach_api.recordings_pdf import evidence_pdf, transcript_turns


def sample():
    return {'state': 'matched', 'transcript': {'content': 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n<v Synthetic Coach>Opening transcript evidence</v>'},
        'analyses': [{'id': 'saved', 'status': 'completed', 'type': 'monthly_coaching', 'learnerName': 'Synthetic Learner',
            'session': {'learner_name': 'Synthetic Learner', 'case_owner': 'Synthetic Coach', 'learner_attended': True,
                'manager_attended': None, 'program_name': 'Synthetic programme', 'aptem_status': 'Awaiting signature'},
            'report': {'executive_summary': 'Saved executive summary.',
                'overall_rating': {'rag': 'Amber', 'average_rating': 3, 'professional_judgement': 'Saved professional judgement.'},
                'strengths': ['Saved strength.'], 'priority_actions': [{'owner': 'Coach', 'action': 'Saved action.', 'due': 'Next month'}],
                'qa': [{'metric': 'Saved QA metric', 'rag': 'Red', 'rating_1_to_5': 1, 'notes': 'Not evidenced.',
                        'evidence': [{'quote': 'First original quote.'}, {'quote': 'Second original quote.', 'timecode': '00:01 - 00:03'}]}]}}]}


class CoachingPdfTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.record = calendar_record(calendar_context('coach@example.invalid', 'event',
            '2026-10-22T09:00:00Z', '2026-10-22T10:00:00Z'))
        self.evidence = sample()

    def test_saved_report_is_a_real_searchable_pdf_with_all_quotes_and_unchanged_outcomes(self):
        before = deepcopy(self.evidence)
        content = evidence_pdf(self.record, self.evidence, kind='analysis', analysis=self.evidence['analyses'][0])
        self.assertTrue(content.startswith(b'%PDF-'))
        pdf = PdfReader(BytesIO(content))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        for expected in ['Coach Workspace Report', 'Learner & Programme', 'Awaiting signature', 'Professional Judgement',
                         'Executive Summary', 'Saved action.', 'Saved QA metric', 'Not evidenced.',
                         'First original quote.', 'Second original quote.', 'Transcript Evidence', 'Manager attendance: Unknown']:
            self.assertIn(expected.casefold(), text.casefold())
        self.assertGreaterEqual(len(pdf.pages), 3)
        self.assertEqual(self.evidence, before)
        self.assertFalse(pdf.is_encrypted)

    def test_full_transcript_pdf_keeps_every_turn_with_timestamps_across_pages(self):
        self.evidence['transcript']['content'] = 'WEBVTT\n\n' + '\n\n'.join(
            f'{index}\n00:01:00.000 --> 00:01:05.000\n<v Synthetic Speaker>Turn {index}: ' + 'Full retained evidence. ' * 10 + '</v>'
            for index in range(75))
        content = evidence_pdf(self.record, self.evidence, kind='transcript')
        pdf = PdfReader(BytesIO(content))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertGreater(len(pdf.pages), 2)
        for index in range(75):
            self.assertIn(f'Turn {index}:', text)
        self.assertIn('00:01:00.000 - 00:01:05.000', text)

    def test_plain_text_and_literal_markup_cannot_execute_or_load_external_assets(self):
        raw = 'First plain paragraph\n\n<script>literal saved content</script>\n\nFinal retained paragraph'
        self.evidence['transcript']['content'] = raw
        pdf = PdfReader(BytesIO(evidence_pdf(self.record, self.evidence, kind='transcript')))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertIn('literal saved content', text)
        self.assertIn('Final retained paragraph', text)
        self.assertNotIn('/JavaScript', str(pdf.trailer))

    def test_a_single_long_transcript_turn_splits_without_losing_the_final_words(self):
        self.evidence['transcript']['content'] = 'Long retained paragraph. ' * 1500 + 'FINAL VERIFIED TRANSCRIPT WORDS'
        pdf = PdfReader(BytesIO(evidence_pdf(self.record, self.evidence, kind='transcript')))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertGreater(len(pdf.pages), 1)
        self.assertIn('FINAL VERIFIED TRANSCRIPT WORDS', text)

    def test_missing_evidence_never_becomes_a_fabricated_report_or_empty_pdf(self):
        with self.assertRaises(ValueError):
            evidence_pdf(self.record, {'transcript': None}, kind='transcript')
        with self.assertRaises(ValueError):
            evidence_pdf(self.record, self.evidence, kind='analysis', analysis={'report': None})

    def test_vtt_parser_retains_the_last_turn_without_requiring_a_closing_voice_tag(self):
        turns = transcript_turns('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Speaker>First\n\n2\n00:00:03.000 --> 00:00:04.000\n<v Speaker>Last')
        self.assertEqual([row[2] for row in turns], ['First', 'Last'])
