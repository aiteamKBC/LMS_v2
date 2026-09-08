"""Bounded in-memory extraction and attributed historical cards; no DB writes."""
import io
import zipfile
from unittest.mock import patch
from django.test import SimpleTestCase
from .assignment_content import extract_documents, organise_content, load_assignment_content, _cached_extract


def zipped(entries):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return stream.getvalue()


class AssignmentContentTests(SimpleTestCase):
    def tearDown(self):
        _cached_extract.cache_clear()

    def test_extracts_docx_and_text_inside_zip_without_unpacking_paths(self):
        docx = zipped({'word/document.xml': '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>I learned to build a WBS.</w:t></w:r></w:p></w:body></w:document>'''})
        archive = zipped({'folder/answer.docx': docx, '../notes.txt': b'I will review costs next month.'})
        result = extract_documents(archive, 'Assignment.zip')
        self.assertEqual(len(result['documents']), 2)
        self.assertIn('I learned to build a WBS.', result['documents'][0]['text'])
        self.assertIn('I will review costs next month.', result['documents'][1]['text'])

    def test_presentation_is_actual_file_content_not_a_fabricated_export(self):
        pptx = zipped({'ppt/slides/slide1.xml': '''<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><a:t>Project outcomes</a:t><a:t>We reduced waste.</a:t></p:sld>'''})
        result = organise_content({}, extract_documents(pptx, 'Slides.pptx'), [])
        self.assertEqual(len(result['cards']), 8)
        self.assertEqual(result['cards'][7]['sections'][0]['text'], 'Project outcomes\nWe reduced waste.')
        self.assertEqual(result['cards'][0]['sections'], [])
        self.assertNotIn('presentationReviewed', str(result))

    def test_readable_pdf_is_extracted_and_scanned_pdf_is_not_invented(self):
        import fitz
        document = fitz.open()
        document.new_page().insert_text((50, 50), 'I learned to track costs. K2 applies to my work.')
        result = extract_documents(document.tobytes(), 'Answer.pdf')
        document.close()
        self.assertIn('I learned to track costs.', result['documents'][0]['text'])
        document = fitz.open()
        document.new_page()
        blank = extract_documents(document.tobytes(), 'Diagram.pdf')
        document.close()
        self.assertEqual(blank['documents'], [])
        self.assertTrue(blank['notices'])

    def test_maps_original_passages_and_labels_tutor_observations_separately(self):
        original = 'I learned to plan tasks.\n\nThis improved efficiency in the company.\n\nI will review the action plan next month.\n\nK2 and S4 apply.'
        result = organise_content({'evidence_name': 'Report.txt', 'evidence_status': 'Accepted'},
            extract_documents(original.encode(), 'Report.txt'),
            [{'author': 'Tutor', 'message': '<p>Reflection needs further development.</p><p>K3: achieved.</p>'}])
        self.assertEqual(result['cards'][0]['sections'][0]['text'], original)
        self.assertIn('I learned to plan tasks.', result['cards'][3]['sections'][0]['text'])
        self.assertIn('improved efficiency', result['cards'][4]['sections'][0]['text'])
        self.assertIn('action plan', result['cards'][5]['sections'][0]['text'])
        self.assertEqual(result['cards'][2]['sections'][-1]['kind'], 'feedback')
        self.assertNotIn('Reflection needs further development', result['cards'][0]['sections'][0]['text'])
        self.assertEqual(result['cards'][7]['sections'], [])
        self.assertNotIn('qualityScore', result)

    def test_high_compression_entry_is_skipped_with_notice(self):
        result = extract_documents(zipped({'bomb.txt': 'a' * 2_000_000}), 'Large.zip')
        self.assertEqual(result['documents'], [])
        self.assertTrue(result['notices'])

    def test_missing_or_corrupt_file_keeps_feedback_without_fabricating_answer(self):
        result = organise_content({'evidence_status': 'Accepted'}, extract_documents(b'invalid', 'Bad.pdf'),
                                  [{'message': '<p>Good work.</p>'}])
        self.assertEqual(result['cards'][0]['sections'], [])
        self.assertEqual(result['cards'][6]['sections'][-1]['text'], 'Good work.')
        self.assertTrue(result['notices'])

    def test_cached_content_is_refreshed_when_source_revision_changes(self):
        row = {'file_blob': 'private.txt', 'evidence_name': 'Answer.txt', 'source_hash': 'revision1'}
        with patch('learner_api.assignment_content.evidence_storage.download_blob_bytes', return_value=b'Original text') as download:
            load_assignment_content(row, [])
            load_assignment_content(row, [])
            self.assertEqual(download.call_count, 1)
            load_assignment_content({**row, 'source_hash': 'revision2'}, [])
            self.assertEqual(download.call_count, 2)

    def test_failed_download_can_be_retried(self):
        row = {'file_blob': 'retry.txt', 'evidence_name': 'Answer.txt'}
        with patch('learner_api.assignment_content.evidence_storage.download_blob_bytes', side_effect=[RuntimeError('unavailable'), b'Original answer']) as download:
            self.assertTrue(load_assignment_content(row, [])['notices'])
            self.assertTrue(load_assignment_content(row, [])['cards'][0]['sections'])
            self.assertEqual(download.call_count, 2)
