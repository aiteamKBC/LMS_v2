"""New quality PDFs and legacy preservation; synthetic data, SQLite and no network."""
from copy import deepcopy
from io import BytesIO
import json
from uuid import uuid4
from unittest.mock import patch

from django.test import SimpleTestCase
from PIL import Image
from pypdf import PdfReader

from . import quality_review_pdf as pdf, quality_review_store as store
from .quality_feedback_catalog import defaults
from .quality_form_definition import default_definition, clean_answers, clean_definition, definition_for
from .quality_review_template import template
from .test_quality_reviews import snapshot
from .test_quality_form_builder import QualityDefinitionStorageTests
from .test_quality_feedback_library import answers


def completed(kind='FORM_PORTFOLIO_SAMPLING'):
    definition = default_definition(kind)
    return {**snapshot(), 'id': str(uuid4()), 'version': 1, 'status': 'completed',
        'pdfLayoutVersion': 2, 'reviewType': kind, 'definition': definition,
        'form': answers(definition), 'updatedAt': '2026-11-07T12:00:00Z',
        'reviewer': {'id': 'staff:1', 'name': 'Synthetic Reviewer'}}


def text_of(content):
    return '\n'.join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)


class PortfolioDefinitionTests(SimpleTestCase):
    def test_portfolio_reuses_all_seventeen_existing_criteria_and_five_screenshot_sections(self):
        definition = default_definition('FORM_PORTFOLIO_SAMPLING')
        original = template()
        self.assertEqual(definition['title'], 'Portfolio Sampling Feedback Form')
        self.assertEqual(definition['ratings'], original['ratings'])
        self.assertEqual(len(definition['sections']), 9)
        for section, old in zip(definition['sections'], original['sections']):
            self.assertEqual({key: section[key] for key in ('id', 'title', 'screenshots')},
                             {key: old[key] for key in ('id', 'title', 'screenshots')})
            self.assertEqual([(q['id'], q['text']) for q in section['criteria']],
                             [(q['id'], q['text']) for q in old['criteria']])
        self.assertEqual(sum(len(s['criteria']) for s in definition['sections']), 17)
        self.assertEqual(sum(s['screenshots'] for s in definition['sections']), 5)
        self.assertIn('Kent Business College', definition['purpose'])
        self.assertEqual(clean_definition(definition)['purpose'], definition['purpose'])
        clean_answers(answers(definition), 'completed', definition)
        self.assertNotIn('purpose', definition_for(snapshot()))


class LayoutStorageTests(SimpleTestCase):
    setUp = QualityDefinitionStorageTests.setUp

    def save(self, value=None, expected=0):
        return store.save_review(value or snapshot(), expected=expected, request_id=str(uuid4()), actor='staff:1')

    def test_new_review_layout_is_server_owned_and_survives_later_saves(self):
        value = snapshot()
        value['pdfLayoutVersion'] = 999
        saved = self.save(value)
        self.assertEqual(saved['pdfLayoutVersion'], 3)
        changed = snapshot()
        changed['pdfLayoutVersion'] = 1
        newer = self.save(changed, expected=1)
        self.assertEqual(newer['pdfLayoutVersion'], 3)
        self.assertEqual(store.read_revision(saved['id'], 1), saved)

    def test_existing_review_keeps_old_layout_and_immutable_pdf_on_save(self):
        legacy = self.save(completed())
        legacy.pop('pdfLayoutVersion')
        for table in ('review', 'revision'):
            self.db.execute(f'UPDATE {table} SET payload=?', [json.dumps(legacy)])
        store.save_document(legacy, b'%PDF-immutable-legacy')
        changed = deepcopy(legacy)
        changed['pdfLayoutVersion'] = 2
        newer = self.save(changed, expected=1)
        self.assertNotIn('pdfLayoutVersion', newer)
        self.assertEqual(store.read_revision(legacy['id'], 1), legacy)
        self.assertEqual(bytes(store.read_document(legacy['id'], 1)['content']), b'%PDF-immutable-legacy')
        # A pre-existing completed revision with no PDF must still use the old
        # renderer, rather than acquiring the new presentation on first export.
        old_completed = completed()
        old_completed.pop('pdfLayoutVersion')
        with patch('coach_api.quality_review_pdf_layout.render') as new_render:
            self.assertNotIn('QUALITY ASSURANCE', text_of(pdf._render(old_completed, {})))
            new_render.assert_not_called()

    def test_existing_version_two_review_keeps_its_layout_on_later_saves(self):
        older = self.save(completed())
        older['pdfLayoutVersion'] = 2
        for table in ('review', 'revision'):
            self.db.execute(f'UPDATE {table} SET payload=?', [json.dumps(older)])
        store.save_document(older, b'%PDF-immutable-version-two')
        changed = deepcopy(older)
        changed['pdfLayoutVersion'] = 3
        newer = self.save(changed, expected=1)
        self.assertEqual(newer['pdfLayoutVersion'], 2)
        self.assertEqual(store.read_revision(older['id'], 1), older)
        self.assertEqual(bytes(store.read_document(older['id'], 1)['content']), b'%PDF-immutable-version-two')


class QualityLayoutPdfTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def test_all_forms_export_all_answers_selected_descriptors_and_branded_pages(self):
        for row, layout in ((row, layout) for row in defaults() for layout in (2, 3)):
            with self.subTest(form=row['reviewType'], layout=layout):
                review = completed(row['reviewType'])
                review['pdfLayoutVersion'] = layout
                review['form']['actions'] = [{'action': 'Follow up <safely> & review',
                    'outcome': 'Improved learner impact', 'supportedBy': 'Synthetic Coach', 'dueDate': 'Next review'}]
                before = deepcopy(review)
                document = PdfReader(BytesIO(pdf._render(review, {})))
                text = ' '.join(' '.join(p.extract_text() for p in document.pages).split())
                for expected in (review['definition']['title'], 'Review at a glance', 'Rating reference guide',
                                 'Synthetic Learner', 'Synthetic Reviewer', 'Follow up <safely> & review', 'Next review'):
                    self.assertIn(expected, text)
                for section in review['definition']['sections']:
                    self.assertIn(section['title'], text)
                    for question in section['criteria']:
                        self.assertIn(' '.join(question['text'].split()), text)
                        if question['type'] == 'rating':
                            self.assertIn('Observed evidence at 12:30.', text)
                            self.assertIn(' '.join((question.get('descriptors') or review['definition']['ratings'])['green'].split()), text)
                self.assertTrue(document.pages[0].images)
                for index, page in enumerate(document.pages, 1):
                    self.assertIn(f'Page {index}', page.extract_text())
                self.assertEqual(review, before)

    def test_long_evidence_actions_images_and_original_attachment_names_survive_page_breaks(self):
        review = completed()
        review['form']['criteria']['progress-1']['evidence'] = 'Observed learning & impact. ' * 210 + 'FINAL EVIDENCE WORDS'
        review['form']['criteria']['progress-2'] = {'rating': 'na', 'evidence': ''}
        review['form']['actions'] = [{'action': 'Agreed action. ' * 150 + 'FINAL ACTION WORDS',
            'outcome': 'Planned impact. ' * 130 + 'FINAL OUTCOME WORDS', 'supportedBy': 'Coach', 'dueDate': ''}]
        image_id, file_id = str(uuid4()), str(uuid4())
        image = BytesIO()
        Image.new('RGB', (600, 1100), '#EEE8F6').save(image, format='JPEG')
        review['form']['images'] = {'progress': [image_id]}
        review['form']['attachments'] = {'evidence': [file_id]}
        files = [{'id': file_id, 'section': 'evidence', 'filename': 'Portfolio <review> & evidence.pdf',
                  'size': 2048, 'preview': image.getvalue()}]
        for layout in (2, 3):
            with self.subTest(layout=layout):
                review['pdfLayoutVersion'] = layout
                before = deepcopy(review)
                document = PdfReader(BytesIO(pdf._render(review, {image_id: {'content': image.getvalue()}}, files)))
                text = '\n'.join(p.extract_text() for p in document.pages)
                for expected in ('FINAL EVIDENCE WORDS', 'FINAL ACTION WORDS', 'FINAL OUTCOME WORDS',
                                 'Portfolio <review> & evidence.pdf', 'Not recorded', 'Supporting screenshot 1',
                                 'Not applicable - no additional evidence recorded.'):
                    self.assertIn(expected, text)
                self.assertGreaterEqual(sum(len(page.images) for page in document.pages), 3)
                for page in document.pages:
                    if not page.images:
                        self.assertGreater(len(page.extract_text()), 250, 'Do not leave a page with only an orphaned heading.')
                self.assertEqual(review, before)

    def test_typed_false_zero_checklists_and_no_ratings_export_without_fabricated_grade(self):
        review = completed()
        definition = review['definition']
        definition['sections'] = [{'id': 'context', 'title': 'Session context', 'screenshots': False, 'criteria': [
            {'id': 'confirmed', 'text': 'Confirmed?', 'type': 'boolean'},
            {'id': 'count', 'text': 'Count', 'type': 'number'},
            {'id': 'topics', 'text': 'Topics', 'type': 'checklist', 'options': ['First', 'Second']},
        ]}]
        review['definition'] = clean_definition(definition)
        review['form'].update(criteria={}, answers={'confirmed': False, 'count': 0, 'topics': ['First', 'Second']})
        text = text_of(pdf._render(review, {}))
        for expected in ('No', '0', 'First, Second', 'This form contains no rated criteria.'):
            self.assertIn(expected, text)

    def test_existing_stored_pdf_bytes_are_returned_without_rendering(self):
        for layout in (None, 2, 3):
            review = completed()
            if layout is None:
                review.pop('pdfLayoutVersion')
            else:
                review['pdfLayoutVersion'] = layout
            with patch.object(store, 'read_document', return_value={'content': b'%PDF-immutable-existing'}), \
                    patch.object(pdf, 'review_pdf') as render, patch.object(store, 'save_document') as write:
                self.assertEqual(pdf.stored_review_pdf(review), b'%PDF-immutable-existing')
                render.assert_not_called()
                write.assert_not_called()

    def test_refined_summary_uses_the_correct_action_plural_without_changing_version_two(self):
        review = completed()
        review['pdfLayoutVersion'] = 3
        action = {'action': 'Follow up', 'outcome': 'Learner impact', 'supportedBy': 'Coach', 'dueDate': 'Next review'}
        for count, expected in ((0, '0 follow-up actions'), (1, '1 follow-up action'), (2, '2 follow-up actions')):
            with self.subTest(count=count):
                review['form']['actions'] = [deepcopy(action) for _ in range(count)]
                document = PdfReader(BytesIO(pdf._render(review, {})))
                text = ' '.join(document.pages[0].extract_text().split())
                self.assertIn(expected, text)
                if count == 1:
                    self.assertNotIn('1 follow-up actions', text)
        review['pdfLayoutVersion'] = 2
        review['form']['actions'] = [action]
        self.assertIn('1 follow-up actions', text_of(pdf._render(review, {})))

    def test_refined_long_section_repeats_its_escaped_title_only_on_continuation_pages(self):
        review = completed()
        review['pdfLayoutVersion'] = 3
        section = review['definition']['sections'][0]
        section['title'] = 'Learner <support> & progress in workplace practice ' * 3
        review['definition']['sections'] = [section]
        review['form']['criteria'] = {key: value for key, value in review['form']['criteria'].items() if key.startswith('progress-')}
        review['form']['criteria']['progress-1']['evidence'] = 'Extended observed evidence. ' * 200 + 'FINAL OBSERVATION'
        document = PdfReader(BytesIO(pdf._render(review, {})))
        texts = [' '.join(page.extract_text().split()) for page in document.pages]
        self.assertNotIn('(continued)', texts[1])
        continued = [text for text in texts[2:] if 'Extended observed evidence.' in text]
        self.assertTrue(continued)
        for text in continued:
            self.assertIn(section['title'].strip() + ' (continued)', text)
        self.assertIn('FINAL OBSERVATION', ' '.join(texts))

    def test_continuation_header_resets_when_a_page_starts_with_a_new_section(self):
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm
        from reportlab.platypus import PageBreak
        from .quality_review_pdf_layout import ReviewDocTemplate, heading, paragraph, _fonts
        _fonts()
        output = BytesIO()
        document = ReviewDocTemplate(output, pagesize=A4, topMargin=25 * mm,
            leftMargin=15 * mm, rightMargin=15 * mm, bottomMargin=20 * mm)
        document.build([
            heading('First section', 1, compact=True), paragraph('First observation.'), PageBreak(),
            heading('Second section', 2, compact=True), paragraph('Second observation.'), PageBreak(),
            paragraph('The second section continues here.'),
        ])
        pages = PdfReader(BytesIO(output.getvalue())).pages
        self.assertNotIn('(continued)', pages[1].extract_text())
        self.assertIn('Second section (continued)', pages[2].extract_text())
        self.assertNotIn('First section (continued)', pages[2].extract_text())

    def test_refined_portfolio_uses_fewer_pages_with_all_criteria_actions_and_descriptors(self):
        review = completed()
        for index, answer in enumerate(review['form']['criteria'].values()):
            answer['evidence'] = (f'Observation {index + 1}: The learner explains how workplace learning supports progress. '
                'The coach reviews the evidence and agrees practical next steps with the learner and employer.')
        review['form']['actions'] = [{'action': 'Agree a measurable follow-up target at the next progress review.',
            'outcome': 'The learner explains how their target supports development in the workplace.',
            'supportedBy': 'Synthetic Coach', 'dueDate': 'Next review'}]
        original = PdfReader(BytesIO(pdf._render(review, {})))
        review['pdfLayoutVersion'] = 3
        refined = PdfReader(BytesIO(pdf._render(review, {})))
        self.assertLess(len(refined.pages), len(original.pages))
        text = ' '.join(' '.join(page.extract_text() for page in refined.pages).split())
        for answer in review['form']['criteria'].values():
            self.assertIn(answer['evidence'], text)
        for description in review['definition']['ratings'].values():
            self.assertIn(description, text)
        self.assertIn(review['form']['actions'][0]['outcome'], text)
