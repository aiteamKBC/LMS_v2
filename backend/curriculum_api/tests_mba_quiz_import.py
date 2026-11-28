"""The legacy quiz import's decisions, checked without a database.

    python manage.py test curriculum_api.tests_mba_quiz_import

70,830 questions go through these few functions, and two of the judgements are
easy to get quietly wrong:

* the question type. Both columns that hold it have a check constraint, so an
  unmapped legacy type fails the insert outright — and the legacy "multi_choice"
  label covers both "pick one" and "pick every correct one", which decides
  whether a learner sees radio buttons or checkboxes.
* whether a question is usable at all. Questions with no correct option exist in
  the export; they are imported and reported rather than dropped, because
  dropping them would hide the problem from whoever has to fix it.
"""
from __future__ import annotations

from django.test import SimpleTestCase

from curriculum_api.management.commands import import_mba_quizzes as importer


def question(question_type='single_choice', options=(), text='What is HRM?'):
    return {
        'question_text': text,
        'title': text,
        'question_type': question_type,
        'answer_options': [
            {'option_text': option_text, 'is_correct': is_correct, 'option_order': order}
            for order, (option_text, is_correct) in enumerate(options, start=1)
        ],
    }


def prepare(questions):
    command = importer.Command()
    command.stats = dict.fromkeys(
        ('questions_without_options', 'questions_without_a_correct_option'), 0,
    )
    command.problems = []
    return command, command.prepare_questions(questions, 'A quiz')


class QuestionTypeTests(SimpleTestCase):
    def test_every_legacy_type_lands_inside_the_allowed_set(self):
        """The database rejects anything else, so this cannot be approximate."""
        legacy_types = (
            'single_choice', 'multi_choice', 'true_false', 'item_match',
            'image_match', 'fill_the_gap', 'question_bank',
        )
        for legacy in legacy_types:
            self.assertIn(importer.question_type_for(legacy), importer.ALLOWED_QUESTION_TYPES, legacy)

    def test_the_legacy_names_map_to_this_app_s_names(self):
        self.assertEqual(importer.question_type_for('multi_choice'), 'multiple_choice')
        self.assertEqual(importer.question_type_for('item_match'), 'matching')
        self.assertEqual(importer.question_type_for('image_match'), 'image_matching')
        self.assertEqual(importer.question_type_for('fill_the_gap'), 'fill_gap')

    def test_an_unknown_type_becomes_single_choice_rather_than_failing_the_insert(self):
        for value in ('interpretive_dance', '', None, 'question_bank'):
            self.assertEqual(importer.question_type_for(value), 'single_choice', value)


class ChoiceTypeFromDataTests(SimpleTestCase):
    """The label is ambiguous; the options are not."""

    def test_one_correct_option_is_a_single_choice_question(self):
        _command, prepared = prepare([question('multi_choice', [('a', True), ('b', False)])])
        self.assertEqual(prepared[0][1], 'single_choice')

    def test_several_correct_options_make_it_multiple_choice(self):
        _command, prepared = prepare([question('single_choice', [('a', True), ('b', True), ('c', False)])])
        self.assertEqual(prepared[0][1], 'multiple_choice')

    def test_a_non_choice_type_is_left_as_it_is(self):
        _command, prepared = prepare([question('true_false', [('True', True), ('False', False)])])
        self.assertEqual(prepared[0][1], 'true_false')
        _command, prepared = prepare([question('item_match', [('a', True), ('b', True)])])
        self.assertEqual(prepared[0][1], 'matching')


class QuestionPreparationTests(SimpleTestCase):
    def test_options_keep_their_text_correctness_and_order(self):
        _command, prepared = prepare([question('single_choice', [('first', False), ('second', True)])])
        _text, _type, options = prepared[0]
        self.assertEqual(options, [('first', False, 1), ('second', True, 2)])

    def test_a_question_with_no_correct_option_is_imported_and_reported(self):
        command, prepared = prepare([question('single_choice', [('a', False), ('b', False)])])
        self.assertEqual(len(prepared), 1, 'the question was dropped instead of reported')
        self.assertEqual(command.stats['questions_without_a_correct_option'], 1)
        self.assertTrue(command.problems)

    def test_a_question_with_no_options_is_imported_and_reported(self):
        command, prepared = prepare([question('single_choice', [])])
        self.assertEqual(len(prepared), 1)
        self.assertEqual(command.stats['questions_without_options'], 1)

    def test_blank_option_text_is_dropped_because_it_cannot_be_answered(self):
        _command, prepared = prepare([question('single_choice', [('a', True), ('   ', False)])])
        self.assertEqual([option[0] for option in prepared[0][2]], ['a'])

    def test_a_question_with_no_text_at_all_is_skipped(self):
        _command, prepared = prepare([question('single_choice', [('a', True)], text='')])
        self.assertEqual(prepared, [])

    def test_the_title_stands_in_when_there_is_no_question_text(self):
        item = question('single_choice', [('a', True)])
        item['question_text'] = ''
        item['title'] = 'Fallback title'
        _command, prepared = prepare([item])
        self.assertEqual(prepared[0][0], 'Fallback title')

    def test_questions_keep_the_order_the_export_gave_them(self):
        _command, prepared = prepare([
            question('single_choice', [('a', True)], text='first'),
            question('single_choice', [('a', True)], text='second'),
        ])
        self.assertEqual([text for text, _type, _options in prepared], ['first', 'second'])


class DurationTests(SimpleTestCase):
    def test_a_real_duration_is_used(self):
        self.assertEqual(
            importer.quiz_duration_minutes({'configured_duration': '20 minutes'}), 20,
        )
        self.assertEqual(
            importer.quiz_duration_minutes({'configured_duration': '1 h 30 m'}), 90,
        )

    def test_the_apps_own_default_stands_in_for_the_usual_zero(self):
        # Nearly every legacy quiz records "0" for its duration.
        for value in ('0', '', None, 'nonsense'):
            self.assertEqual(
                importer.quiz_duration_minutes({'configured_duration': value}),
                importer.DEFAULT_DURATION_MINUTES,
                value,
            )
