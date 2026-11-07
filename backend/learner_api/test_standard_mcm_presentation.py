import io
from copy import deepcopy
from unittest.mock import patch

from django.test import SimpleTestCase
from pptx import Presentation

from .standard_mcm_presentation import TEMPLATE_PATH, FORMAT, build_standard_deck, SLOTS


def sections(count=8):
    layouts = [1, 2, 3, 4, 5, 6, 2] + [2] * (count - 8) + [7]
    return [{'title': 'Learner Monthly Coaching Meeting' if i == 0 else f'{i}. My learning', 'templateSlide': layout,
             'body': '\n\n'.join(f'Column {j + 1}\nMy original learning and workplace example.' for j in range(len(SLOTS[layout][1]))),
             'notes': f'Full original source {i}: ' + 'My original account. ' * 500} for i, layout in enumerate(layouts)]


class StandardMcmTests(SimpleTestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            self.enterContext(patch(target, side_effect=AssertionError('No external access permitted')))

    def test_original_template_geometry_artwork_and_notes_are_retained_for_eight_to_twelve_slides(self):
        reference = Presentation(str(TEMPLATE_PATH))
        for count in (8, 9, 10, 12):
            source = sections(count); before = deepcopy(source)
            result = Presentation(io.BytesIO(build_standard_deck(source)))
            self.assertEqual(len(result.slides), count)
            self.assertEqual((result.slide_width, result.slide_height), (reference.slide_width, reference.slide_height))
            for data, slide in zip(source, result.slides):
                original = reference.slides[data['templateSlide'] - 1]
                self.assertEqual([(s.shape_id, s.left, s.top, s.width, s.height, s.shape_type) for s in slide.shapes],
                                 [(s.shape_id, s.left, s.top, s.width, s.height, s.shape_type) for s in original.shapes])
                self.assertIn(data['notes'], slide.notes_slide.notes_text_frame.text)
                self.assertIn(data['title'], '\n'.join(s.text for s in slide.shapes if s.has_text_frame))
            self.assertEqual(source, before)

    def test_manual_slides_can_exceed_automatic_ceiling_without_changing_saved_sources(self):
        source = sections(12) + [{'title': 'My extra example', 'body': 'My own additional explanation.', 'notes': 'Full additional account'}]
        result = Presentation(io.BytesIO(build_standard_deck(source)))
        self.assertEqual(len(result.slides), 13)
        self.assertIn('My own additional explanation.', result.slides[-1].notes_slide.notes_text_frame.text)

    def test_column_overflow_continues_without_truncation_or_mutating_saved_sections(self):
        # Full visible text is now required; the previous highlight-only ceiling
        # must not reject or discard the learner's account.
        for layout in SLOTS:
            words = [f'word{i}' for i in range(550)]
            source = [{'title': 'Full monthly account', 'templateSlide': layout,
                       'body': 'My learning\n' + ' '.join(words), 'notes': 'Original notes'}]
            before = deepcopy(source)
            deck = Presentation(io.BytesIO(build_standard_deck(source)))
            self.assertGreater(len(deck.slides), 1)
            text = '\n'.join(s.text for slide in deck.slides for s in slide.shapes if s.has_text_frame)
            for word in words:
                self.assertEqual(text.split().count(word), 1)
            self.assertNotIn('\u2026', text)
            self.assertEqual(source, before)
            self.assertIn('Original notes', deck.slides[0].notes_slide.notes_text_frame.text)

    def test_long_manual_slide_and_selected_reference_keep_all_words(self):
        from .test_presentation_template import PresentationTemplateTests
        words = [f'word{i}' for i in range(500)]
        source = [{'title': 'My complete account', 'body': ' '.join(words), 'notes': 'Full source notes'}]
        for reference in (None, PresentationTemplateTests().reference()):
            deck = Presentation(io.BytesIO(build_standard_deck(source, reference, {'coverSlide': 1, 'contentSlide': 2})))
            self.assertGreater(len(deck.slides), 1)
            text = ' '.join(s.text for slide in deck.slides for s in slide.shapes if s.has_text_frame)
            for word in words:
                self.assertEqual(text.split().count(word), 1)
            self.assertNotIn('Original body', text)
            self.assertNotIn('PRIVATE ORIGINAL NOTES', '\n'.join(s.notes_slide.notes_text_frame.text for s in deck.slides))

    def test_fourteen_lines_continue_beyond_the_narrow_resources_card(self):
        # Native PowerPoint renders these 14 lines at about 250pt, exceeding
        # the resource card's 241pt usable height despite nominal 13pt text.
        lines = [f'Activity line {i + 1}' for i in range(14)]
        source = [{'title': 'Resources and evidence', 'templateSlide': 5,
                   'body': 'Evidence\nMy evidence.\n\nMonthly activities\n' + '\n'.join(lines)
                           + '\n\nHow they helped\nMy reflection.'}]
        deck = Presentation(io.BytesIO(build_standard_deck(source)))
        self.assertEqual(len(deck.slides), 2)
        bodies = [next(shape for shape in slide.shapes if shape.shape_id == 12) for slide in deck.slides]
        self.assertEqual('\n'.join(shape.text for shape in bodies).splitlines(), lines)
        self.assertTrue(all(len(shape.text.splitlines()) <= 13 for shape in bodies))
        self.assertTrue(all(run.font.size.pt == 13 for shape in bodies
                            for paragraph in shape.text_frame.paragraphs for run in paragraph.runs))

    def test_continuation_titles_fit_without_losing_title_text(self):
        source = [{'title': 'Applying my learning at work (continued 12)', 'templateSlide': 3,
                   'body': 'Task\nMy complete task.\n\nApproach\nMy complete approach.\n\nOutcome\nMy complete outcome.'},
                  {'title': 'Full-month reflection (continued 14)', 'templateSlide': 7,
                   'body': 'Reflection\nMy reflection.\n\nNext steps\nMy next steps.'}]
        deck = Presentation(io.BytesIO(build_standard_deck(source)))
        self.assertEqual(len(deck.slides), 2)
        for section, slide in zip(source, deck.slides):
            title = next(shape for shape in slide.shapes if shape.shape_id == SLOTS[section['templateSlide']][0])
            self.assertEqual(title.text, section['title'])
            self.assertGreaterEqual(title.text_frame.paragraphs[0].runs[0].font.size.pt, 18)

    def test_new_format_reaches_learner_personal_and_coach_export_paths(self):
        from inspect import unwrap
        import json
        from django.test import RequestFactory
        from .monthly_assignment import export_presentation
        from .personal_learning_activities import presentation
        from coach_api.presentations import presentation_file
        for kind in ('commercial', 'apprenticeship'):
            payload = {'learnerKind': kind, 'learnerId': '1', 'activityId': 'C1', 'monthlyAssignment': {'presentationFormat': FORMAT, 'month': '2026-10', 'slides': sections()}}
            request = RequestFactory().post('/', data=json.dumps(payload), content_type='application/json')
            response = unwrap(export_presentation)(request)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(Presentation(io.BytesIO(response.content)).slides), 8)
            self.assertEqual(len(Presentation(io.BytesIO(presentation({}, payload).content)).slides), 8)
            self.assertEqual(len(Presentation(io.BytesIO(presentation_file(payload, lambda *a: {})[0])).slides), 8)
