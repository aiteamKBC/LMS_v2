import unittest
from copy import deepcopy

from repair_quiz_answer_keys import fingerprint, proposed_question, validate_plan


class ReviewedKeyRepairTests(unittest.TestCase):
    def setUp(self):
        self.state = {'id': 1, 'quizId': 2, 'text': 'Choose', 'type': 'single_choice',
                      'points': 3, 'sortOrder': 0, 'explanation': '', 'imageUrl': '',
                      'archived': False, 'answers': [
                          {'id': 10, 'text': 'Correct', 'isCorrect': True, 'sortOrder': 0},
                          {'id': 11, 'text': 'Distractor', 'isCorrect': True, 'sortOrder': 1}]}
        self.repair = {'questionId': 1, 'quizId': 2, 'beforeSha256': fingerprint(self.state),
                       'flags': {'10': True, '11': False}, 'evidence': ['Reviewed source'],
                       'rationale': 'One correct choice.'}

    def test_repair_preserves_ids_points_and_original_input(self):
        before = deepcopy(self.state)
        after = proposed_question(self.state, self.repair)
        self.assertEqual(self.state, before)
        self.assertEqual(after['points'], 3)
        self.assertEqual([a['id'] for a in after['answers']], [10, 11])
        self.assertEqual([a['isCorrect'] for a in after['answers']], [True, False])

    def test_concurrent_content_flag_type_or_points_change_invalidates_plan(self):
        for field, value in [('text', 'Edited'), ('type', 'multiple_choice'), ('points', 4),
                             ('archived', True), ('quizId', 3)]:
            state = {**self.state, field: value}
            with self.subTest(field=field), self.assertRaises(ValueError):
                proposed_question(state, self.repair)
        state = deepcopy(self.state)
        state['answers'][0]['isCorrect'] = False
        with self.assertRaises(ValueError):
            proposed_question(state, self.repair)

    def test_cannot_omit_an_existing_answer_or_use_nonboolean_flags(self):
        for flags in ({'10': True}, {'10': True, '11': 'false'}):
            with self.subTest(flags=flags), self.assertRaises(ValueError):
                proposed_question(self.state, {**self.repair, 'flags': flags})

    def test_missing_correct_option_is_added_without_replacing_old_options(self):
        repair = {**self.repair, 'flags': {'10': False, '11': False},
                  'additions': [{'text': 'Restored correct option', 'isCorrect': True}]}
        after = proposed_question(self.state, repair)
        self.assertEqual([a['id'] for a in after['answers'][:2]], [10, 11])
        self.assertEqual(after['answers'][2]['text'], 'Restored correct option')

    def test_all_correct_ksb_items_require_multiple_choice_type(self):
        repair = {**self.repair, 'flags': {'10': True, '11': True}}
        with self.assertRaises(ValueError):
            proposed_question(self.state, repair)
        self.assertEqual(proposed_question(self.state, {**repair, 'type': 'multiple_choice'})['type'],
                         'multiple_choice')

    def test_replacement_keeps_original_question_and_answers_untouched(self):
        original = deepcopy(self.state)
        repair = {**self.repair, 'replacement': {'text': 'New assessment item',
                   'type': 'single_choice', 'answers': [{'text': 'Answer', 'isCorrect': True}]}}
        after = proposed_question(self.state, repair)
        self.assertEqual(self.state, original)
        self.assertEqual(after['points'], original['points'])
        self.assertEqual(after['sortOrder'], original['sortOrder'])
        self.assertEqual(after['text'], 'New assessment item')

    def test_unreviewed_blank_or_ungradeable_additions_are_rejected(self):
        for changes in ({'evidence': []}, {'rationale': ''},
                        {'additions': [{'text': ' ', 'isCorrect': False}]},
                        {'flags': {'10': False, '11': False}}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                proposed_question(self.state, {**self.repair, **changes})

    def test_whole_quiz_must_pass_before_any_write(self):
        other = deepcopy(self.state)
        other['id'] = 5
        manifest = {'quizIds': [2], 'repairs': [self.repair]}
        with self.assertRaises(ValueError):
            validate_plan([self.state, other], manifest)
        manifest['repairs'].append({**self.repair, 'questionId': 5,
                                    'beforeSha256': fingerprint(other)})
        self.assertEqual(len(validate_plan([self.state, other], manifest)), 2)

    def test_repeated_question_or_missing_quiz_is_rejected(self):
        with self.assertRaises(ValueError):
            validate_plan([self.state], {'quizIds': [2], 'repairs': [self.repair, self.repair]})
        with self.assertRaises(ValueError):
            validate_plan([self.state], {'quizIds': [2, 3], 'repairs': [self.repair]})


if __name__ == '__main__':
    unittest.main()
