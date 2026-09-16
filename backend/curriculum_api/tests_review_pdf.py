from copy import deepcopy
from io import BytesIO
from inspect import unwrap
from unittest.mock import patch
import base64

from django.http import JsonResponse
from django.test import SimpleTestCase, RequestFactory
from PIL import Image, ImageDraw
from pypdf import PdfReader

from .review_pdf import build_mcm_pdf, pdf_availability, mcm_pdf_response


def sample_definition():
    image = Image.new('RGB', (320, 85), 'white')
    ImageDraw.Draw(image).text((15, 30), 'TEST SIGNATURE - NOT A REAL SIGN-OFF', fill='navy')
    buffer = BytesIO()
    image.save(buffer, format='PNG')
    mark = 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode()
    signature = {'required': True, 'signed': True, 'signedName': 'Sample learner',
                 'signedAt': '2026-09-15T09:30:00', 'signature': mark}
    return {
        'instance': {'id': 'REVI-SAMPLE', 'status': 'completed', 'occurrenceNumber': 1,
                     'targetDate': '2026-09-15', 'completedAt': '2026-09-15T09:30:00'},
        'template': {'name': 'Monthly Coaching Meeting', 'reviewTypeCode': 'mcm'},
        'signatures': {'advisor': {**signature, 'signedName': 'Sample coach'}, 'participant': signature,
                       'employer': {'required': False, 'signed': False}, 'referrer': {'required': False, 'signed': False}},
        'sections': [{'id': 'one', 'title': 'Learning & reflection', 'enabled': True, 'displayOrder': 0, 'fields': [
            {'id': 'answer', 'title': 'What did you learn?', 'fieldType': 'text_multiline', 'answer': 'Saved learner answer <not markup>.'},
            {'id': 'conditional', 'title': 'Any concerns?', 'fieldType': 'boolean_case_block', 'answer': 'no',
             'yesFields': [{'title': 'Hidden branch', 'fieldType': 'text', 'answer': 'HIDDEN-OLD-ANSWER'}],
             'noFields': [{'title': 'Next step', 'fieldType': 'text', 'answer': 'Continue the learning plan.'}]},
        ]}],
    }


SAMPLE_INFORMATION = {'name': 'Sample learner', 'programme': 'Sample programme', 'startDate': '2026-01-01',
                      'endDate': '2027-01-01', 'employer': 'Sample employer', 'manager': 'Sample manager'}


class SignedMcmPdfTests(SimpleTestCase):
    def test_learner_signature_is_needed_even_if_an_old_template_omitted_it(self):
        definition = sample_definition()
        definition['signatures']['participant'] = {'required': False, 'signed': False}
        self.assertFalse(pdf_availability(definition)['available'])
        self.assertEqual(mcm_pdf_response(definition, SAMPLE_INFORMATION).status_code, 409)

    def test_all_required_signatures_and_completed_status_are_needed(self):
        for change in ('coach', 'employer', 'status', 'image', 'date', 'name'):
            with self.subTest(change=change):
                definition = sample_definition()
                if change == 'coach':
                    definition['signatures']['advisor']['signed'] = False
                elif change == 'employer':
                    definition['signatures']['employer']['required'] = True
                elif change == 'status':
                    definition['instance']['status'] = 'awaiting-signature'
                else:
                    key = {'image': 'signature', 'date': 'signedAt', 'name': 'signedName'}[change]
                    definition['signatures']['participant'][key] = None
                self.assertFalse(pdf_availability(definition)['available'])

    def test_mcm_classification_not_display_name_controls_export(self):
        definition = sample_definition()
        definition['template']['name'] = 'Monthly learning catch-up'
        self.assertTrue(pdf_availability(definition)['available'])
        definition['template']['reviewTypeCode'] = 'progress_review'
        self.assertIsNone(pdf_availability(definition))
        self.assertEqual(mcm_pdf_response(definition, {}).status_code, 404)

    def test_export_has_saved_answers_and_signatures_on_a_separate_landscape_page(self):
        definition = sample_definition()
        original = deepcopy(definition)
        response = mcm_pdf_response(definition, SAMPLE_INFORMATION)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        pdf = PdfReader(BytesIO(response.content))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertIn('Saved learner answer <not markup>.', text)
        self.assertIn('Continue the learning plan.', text)
        self.assertNotIn('HIDDEN-OLD-ANSWER', text)
        self.assertIn('Participant', pdf.pages[-1].extract_text())
        self.assertIn('Sample learner', pdf.pages[-1].extract_text())
        self.assertIn('15/09/2026 10:30 (Europe/London)', text)
        self.assertGreaterEqual(len(pdf.pages[-1].images), 2)  # branding and actual saved mark
        self.assertTrue(all(float(page.mediabox.width) > float(page.mediabox.height) for page in pdf.pages))
        self.assertEqual(definition, original)

    def test_invalid_or_remote_signature_never_produces_a_signed_pdf(self):
        for mark in ('https://example.test/signature.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,bm90LWFuLWltYWdl'):
            with self.subTest(mark=mark):
                definition = sample_definition()
                definition['signatures']['participant']['signature'] = mark
                self.assertEqual(mcm_pdf_response(definition, SAMPLE_INFORMATION).status_code, 409)

    def test_long_answers_paginate_without_dropping_content_or_disabled_sections(self):
        definition = sample_definition()
        definition['sections'][0]['fields'][0]['answer'] = 'A long recorded reflection. ' * 1500 + 'END-OF-ANSWER'
        definition['sections'].append({'title': 'Disabled', 'enabled': False, 'fields': [{'title': 'Excluded', 'answer': 'DISABLED-ANSWER'}]})
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, SAMPLE_INFORMATION)))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertGreater(len(pdf.pages), 3)
        self.assertIn('END-OF-ANSWER', text)
        self.assertNotIn('DISABLED-ANSWER', text)

    def test_learner_download_preserves_form_access_denials(self):
        from learner_api.calendar import learner_calendar_event_review_pdf
        request = RequestFactory().get('/review/pdf/')
        for status in (403, 404, 405):
            with self.subTest(status=status), patch('learner_api.calendar.learner_calendar_event_review', return_value=JsonResponse({'error': 'Denied'}, status=status)):
                response = learner_calendar_event_review_pdf.__wrapped__(request, 'commercial', 1, 'other-event')
                self.assertEqual(response.status_code, status)

    def test_learner_download_does_not_accept_a_completed_status_without_the_mark(self):
        from learner_api.calendar import learner_calendar_event_review_pdf
        definition = sample_definition()
        definition['signatures']['participant']['signed'] = False
        with patch('learner_api.calendar.learner_calendar_event_review', return_value=JsonResponse(definition)):
            response = learner_calendar_event_review_pdf.__wrapped__(RequestFactory().get('/review/pdf/'), 'commercial', 1, 'event')
        self.assertEqual(response.status_code, 409)

    def test_coach_cannot_download_another_coachs_instance(self):
        from coach_api.review_pdf import coach_mcm_pdf
        with patch('coach_api.views._authorized_review_instance', return_value=(None, JsonResponse({'detail': 'Not found'}, status=404))):
            response = unwrap(coach_mcm_pdf)(RequestFactory().get('/reviews/other/pdf'), 'other')
        self.assertEqual(response.status_code, 404)

    def test_submitted_answers_cannot_change_behind_a_signature(self):
        from .review_instances import save_review_instance_answers
        for status in ('awaiting-signature', 'completed'):
            with self.subTest(status=status), self.assertRaisesMessage(ValueError, 'Submitted review answers cannot be changed'):
                save_review_instance_answers({'status': status}, {'answer': 'Replacement'})
