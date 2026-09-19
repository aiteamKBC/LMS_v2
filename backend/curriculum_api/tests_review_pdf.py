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

    def test_review_type_classification_not_display_name_controls_export(self):
        definition = sample_definition()
        definition['template']['name'] = 'Monthly learning catch-up'
        self.assertTrue(pdf_availability(definition)['available'])
        # A Review Type with no signed export still has no PDF at all.
        # (Progress Review gained one -- see ProgressReviewPdfTests.)
        definition['template']['reviewTypeCode'] = 'induction'
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

    def test_meeting_summary_section_shows_a_placeholder_when_the_instance_has_none(self):
        # The Review Instance owns no meeting-summary field today -- this is
        # a presentation-only requirement matching the reference PDF, not a
        # dependency on the separate coach_meeting_summaries/CoachCalendarEvent
        # AI-summary feature.
        definition = sample_definition()
        self.assertNotIn('meetingSummary', definition)
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, SAMPLE_INFORMATION)))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertIn('Meeting Summary', text)
        self.assertIn('No Summary Generated', text)

    def test_meeting_summary_section_renders_a_saved_summary_when_present(self):
        definition = sample_definition()
        definition['meetingSummary'] = 'Agreed to focus on time management next month.'
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, SAMPLE_INFORMATION)))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertIn('Meeting Summary', text)
        self.assertIn('Agreed to focus on time management next month.', text)
        self.assertNotIn('No Summary Generated', text)

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


def progress_review_definition(snapshot=None, rag_history=None):
    """The same signed shape, classified as the canonical Progress Review type
    and carrying the snapshot a coach froze."""
    definition = sample_definition()
    definition['template'] = {'name': 'Progress Review', 'reviewTypeCode': 'progress_review'}
    definition['progressSnapshot'] = snapshot
    definition['ragHistory'] = rag_history if rag_history is not None else []
    return definition


def saved_snapshot(**overrides):
    snapshot = {
        'calculationMethod': 'planned_hours',
        'calculatedFrom': '2024-10-18',
        'calculatedAt': '2026-09-16T14:35:02',
        'calculatedBy': 'coach@example.test',
        'weeksElapsed': 100,
        'programmeProgress': {'actual': 28, 'expected': 56, 'planned': 100, 'actualPercent': 28.0,
                              'expectedPercent': 56.0, 'variancePercent': -28.0, 'varianceDirection': 'below'},
        'offTheJobHours': {'actual': 64, 'expected': 41, 'planned': 100, 'actualPercent': 64.0,
                           'expectedPercent': 41.0, 'variancePercent': 23.0, 'varianceDirection': 'above'},
    }
    snapshot.update(overrides)
    return snapshot


#: What the learner's CURRENT figures might be by the time an old review is
#: reopened -- none of these numbers may ever appear in an export of a review
#: that was signed against the snapshot above.
LATER_LIVE_FIGURES = ('90%', '80%', '65%')

PROGRESS_INFORMATION = {
    **SAMPLE_INFORMATION,
    # The cohort delivery window the enrolment row carries...
    'startDate': '2024-10-01', 'endDate': '2027-10-01',
    # ...and the learner's own dates, which a Progress Review must state.
    'learnerStartDate': '2024-10-18', 'learnerEndDate': '2027-10-17',
}


class ProgressReviewPdfTests(SimpleTestCase):
    def pdf_text(self, definition, information=None):
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, information or PROGRESS_INFORMATION)))
        return '\n'.join(page.extract_text() for page in pdf.pages)

    def test_the_progress_review_type_has_a_signed_export(self):
        definition = progress_review_definition(saved_snapshot())
        self.assertTrue(pdf_availability(definition)['available'])
        response = mcm_pdf_response(definition, PROGRESS_INFORMATION)
        self.assertEqual(response.status_code, 200)
        self.assertIn('Progress-Review-REVI-SAMPLE.pdf', response['Content-Disposition'])

    def test_it_renders_the_saved_snapshot_rather_than_recalculating(self):
        definition = progress_review_definition(saved_snapshot())
        original = deepcopy(definition)
        text = self.pdf_text(definition)
        self.assertIn('Learning Progress', text)
        self.assertIn('Programme progress', text)
        self.assertIn('Off-the-job hours progress', text)
        # Exactly the stored figures, and the stored above/below annotations.
        self.assertIn('28%', text)
        self.assertIn('64%', text)
        self.assertIn('23% above expected (expected 41%)', text)
        self.assertIn('28% below expected (expected 56%)', text)
        for later in LATER_LIVE_FIGURES:
            self.assertNotIn(later, text)
        # Rendering must not mutate what it was handed.
        self.assertEqual(definition, original)

    def test_the_window_it_states_is_the_one_the_snapshot_was_calculated_over(self):
        text = self.pdf_text(progress_review_definition(saved_snapshot()))
        self.assertIn('18/10/2024', text)
        self.assertIn('16/09/2026 15:35 (Europe/London)', text)
        # Never the cohort delivery window the enrolment row also carries.
        self.assertNotIn('01/10/2024', text)

    def test_the_information_block_states_the_learners_own_programme_dates(self):
        text = self.pdf_text(progress_review_definition(saved_snapshot()))
        self.assertIn('Programme Start Date', text)
        self.assertIn('17/10/2027', text)       # the learner's own planned end
        self.assertNotIn('01/10/2027', text)    # not the cohort's

    def test_a_review_completed_without_a_calculation_says_so(self):
        text = self.pdf_text(progress_review_definition(None))
        self.assertIn('No progress snapshot was calculated for this review.', text)

    def test_rag_history_shows_each_reviews_own_recorded_value(self):
        text = self.pdf_text(progress_review_definition(saved_snapshot(), [
            {'reviewInstanceId': 'REVI-2', 'reviewName': 'Progress Review', 'targetDate': '2026-01-03', 'rag': 'Green'},
            {'reviewInstanceId': 'REVI-1', 'reviewName': 'Progress Review', 'targetDate': '2025-04-16', 'rag': ''},
        ]))
        self.assertIn('RAG Status', text)
        self.assertIn('03/01/2026', text)
        self.assertIn('Green', text)
        # A past review that recorded no RAG still appears.
        self.assertIn('16/04/2025', text)
        self.assertIn('None', text)

    def test_it_keeps_the_meeting_summary_section_out_of_a_progress_review(self):
        text = self.pdf_text(progress_review_definition(saved_snapshot()))
        self.assertNotIn('Meeting Summary', text)
        self.assertNotIn('No Summary Generated', text)

    def test_saved_answers_and_signatures_render_the_same_way_they_do_for_an_mcm(self):
        definition = progress_review_definition(saved_snapshot())
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, PROGRESS_INFORMATION)))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertIn('Saved learner answer <not markup>.', text)
        self.assertNotIn('HIDDEN-OLD-ANSWER', text)
        self.assertIn('Participant', pdf.pages[-1].extract_text())

    def test_long_answers_still_paginate_around_the_progress_section(self):
        definition = progress_review_definition(saved_snapshot())
        definition['sections'][0]['fields'][0]['answer'] = 'A long recorded reflection. ' * 1500 + 'END-OF-ANSWER'
        pdf = PdfReader(BytesIO(build_mcm_pdf(definition, PROGRESS_INFORMATION)))
        text = '\n'.join(page.extract_text() for page in pdf.pages)
        self.assertGreater(len(pdf.pages), 3)
        self.assertIn('END-OF-ANSWER', text)
        self.assertIn('Learning Progress', text)

    def test_an_unsigned_progress_review_has_no_export(self):
        definition = progress_review_definition(saved_snapshot())
        definition['instance']['status'] = 'awaiting-signature'
        self.assertFalse(pdf_availability(definition)['available'])
        self.assertEqual(mcm_pdf_response(definition, PROGRESS_INFORMATION).status_code, 409)

    def test_the_mcm_export_still_reads_the_enrolment_window_it_always_has(self):
        """The learner-specific dates are carried alongside, not substituted --
        this export's Information block is unchanged."""
        text = self.pdf_text(sample_definition(), PROGRESS_INFORMATION)
        self.assertIn('01/10/2024', text)
        self.assertNotIn('18/10/2024', text)
