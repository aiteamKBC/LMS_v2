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
        self.assertEqual(saved['pdfLayoutVersion'], 2)
        changed = snapshot()
        changed['pdfLayoutVersion'] = 1
        newer = self.save(changed, expected=1)
        self.assertEqual(newer['pdfLayoutVersion'], 2)
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


class QualityLayoutPdfTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))

    def test_all_forms_export_all_answers_selected_descriptors_and_branded_pages(self):
        for row in defaults():
            with self.subTest(form=row['reviewType']):
                review = completed(row['reviewType'])
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
        for layout in (None, 2):
            review = completed()
            if layout is None:
                review.pop('pdfLayoutVersion')
            with patch.object(store, 'read_document', return_value={'content': b'%PDF-immutable-existing'}), \
                    patch.object(pdf, 'review_pdf') as render, patch.object(store, 'save_document') as write:
                self.assertEqual(pdf.stored_review_pdf(review), b'%PDF-immutable-existing')
                render.assert_not_called()
                write.assert_not_called()
