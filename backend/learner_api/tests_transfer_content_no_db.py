from copy import deepcopy
from unittest import TestCase
from unittest.mock import MagicMock, patch
import json

from .progress_transfer_content import authored_text, tokens, add_scores, content_review, verified_source_types


def review():
    return {'reviewToken': 'unchanged', 'modules': [{'moduleId': 'M1', 'courseRef': 'legacy:50',
        'sources': [{'sourceActivityRef': 'material:7', 'type': 'quiz', 'title': 'Unrelated title', 'automaticTargetId': None}],
        'targets': [{'componentId': 'A', 'type': 'quiz'}, {'componentId': 'B', 'type': 'quiz'},
                    {'componentId': 'C', 'type': 'reading'}]}]}


class TransferContentTests(TestCase):
    def test_composite_reading_without_quiz_is_corrected_only_in_request_context(self):
        from .tests_transfer_matching_no_db import context
        from .tests_progress_transfer_no_db import item
        from .progress_transfer_matching import build_review, validate_decisions
        data = context()
        data[5][1]['source_activity_type'] = 'Reading+Quiz'
        before = deepcopy(data)
        items = [item(completedSourceActivities=['material:8'])]
        cursor = MagicMock(); cursor.fetchall.return_value = [('50', 'material:8', 'pdf', {}, {}, None, None)]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
            corrected = verified_source_types(data, items)
        self.assertEqual(data, before)
        result = build_review('R1', items, corrected)
        self.assertEqual(result['modules'][0]['sources'][0]['type'], 'reading')
        decisions = {'reviewToken': result['reviewToken'], 'mappings': [{'moduleId': 'M1', 'sourceActivityRef': 'material:8', 'targetComponentId': 'MANUAL'}]}
        self.assertIn(('M1', 'material:8'), validate_decisions(result, decisions))
        from old_otjh.service import ServiceError
        decisions['mappings'][0]['targetComponentId'] = 'QUIZ'
        with self.assertRaises(ServiceError):
            validate_decisions(result, decisions)

    def test_actual_quizzes_unknown_formats_and_foreign_sources_are_not_reclassified(self):
        from .tests_transfer_matching_no_db import context
        from .tests_progress_transfer_no_db import item
        data = context(); data[5][1]['source_activity_type'] = 'Reading+Quiz'
        items = [item(completedSourceActivities=['material:8'])]
        cases = [
            [('50', 'material:8', 'pdf', {'quiz_id': 123}, {}, None, None)],
            [('50', 'material:8', 'pdf', {}, {'quiz': {'questions': [{'question_id': 1}]}}, None, None)],
            [('50', 'material:8', 'pdf', {}, {}, 123, None)],
            [('50', 'material:8', 'pdf', {}, {}, None, [{'question_id': 1}])],
            [('50', 'material:8', 'unknown', {}, {}, None, None)],
            [('90', 'material:8', 'pdf', {}, {}, None, None)], [],
        ]
        for rows in cases:
            cursor = MagicMock(); cursor.fetchall.return_value = rows
            connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
            with self.subTest(rows=rows), patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
                self.assertEqual(verified_source_types(data, items)[5][1]['source_activity_type'], 'Reading+Quiz')

    def test_historical_questions_are_available_when_material_payload_has_no_questions(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [('50', 'material:7', {}, {'quiz_questions': [{'question_body': 'Explain data protection regulations'}]})],
            [], [('M1', 'A', {'questions': [{'question_text': 'Explain data protection regulations'}]})],
        ]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        context = (None, None, None, {'components': [{'moduleId': 'M1', 'componentId': 'A'}]})
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
            result = content_review(review(), context)
        source = result['modules'][0]['sources'][0]
        self.assertTrue(source['contentAvailable'])
        self.assertEqual(source['contentScores'][0]['score'], 1)
        self.assertIn('history.activity_id::text', cursor.execute.call_args_list[0].args[0])

    def test_material_recovers_questions_using_its_embedded_quiz_id_and_course(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [[('50', 'material:7', {}, {'quiz_id': 123})], [], []]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}), \
             patch('learner_api.subject_quiz.imported_quiz', return_value={'questions': [{'question_body': 'Recovered original question'}]}) as recover:
            result = content_review(review(), (None, None, None, {'components': []}))
        recover.assert_called_once_with(cursor, 50, 123, for_review=True)
        self.assertTrue(result['modules'][0]['sources'][0]['contentAvailable'])

    def test_missing_source_does_not_mark_available_target_content_as_missing(self):
        source = add_scores(review(), {}, {('M1', 'A'): 'Available question text'})['modules'][0]['sources'][0]
        self.assertFalse(source['contentAvailable'])
        self.assertEqual(source['contentScores'][0], {'componentId': 'A', 'score': None, 'contentAvailable': True})
        self.assertEqual(source['contentScores'][1], {'componentId': 'B', 'score': None, 'contentAvailable': False})

    def test_extracts_questions_not_solutions_attempts_titles_or_urls(self):
        payload = {'title': 'Ignored title', 'quiz': {'questions': [{'question_body': '<p>Explain data protection</p>',
                   'correct_answer': 'SECRET', 'options': [{'option_text': 'SECRET'}]}]}, 'answers': 'SECRET'}
        self.assertEqual(authored_text(payload, True), '<p>Explain data protection</p>')
        self.assertEqual(authored_text({'quiz_body': 'Title but no questions'}, True), '')
        self.assertEqual(authored_text({'readingContent': 'Stored reading', 'resourceUrl': 'SECRET'}), 'Stored reading')
        self.assertEqual(tokens('<script>SECRET</script><p>Data &amp; protection</p>'), tokens('data protection'))

    def test_ranks_question_content_and_does_not_return_author_content(self):
        result = add_scores(review(), {('50', 'material:7'): 'Explain data protection regulations'},
                            {('M1', 'A'): 'Explain data protection regulations', ('M1', 'B'): 'Marketing budget forecasts'})
        source = result['modules'][0]['sources'][0]
        self.assertTrue(source['contentAvailable'])
        self.assertEqual(source['contentScores'], [{'componentId': 'A', 'score': 1.0, 'contentAvailable': True}, {'componentId': 'B', 'score': 0.0, 'contentAvailable': True}])
        self.assertNotIn('regulations', json.dumps(result))
        self.assertEqual(result['reviewToken'], 'unchanged')
        self.assertIsNone(source['automaticTargetId'])

    def test_missing_content_is_explicit_and_foreign_module_cannot_supply_text(self):
        result = add_scores(review(), {}, {('M2', 'A'): 'Explain data protection regulations'})
        source = result['modules'][0]['sources'][0]
        self.assertFalse(source['contentAvailable'])
        self.assertTrue(all(row['score'] is None for row in source['contentScores']))

    def test_batched_local_reads_scope_sources_targets_and_active_questions(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [('50', 'material:7', {'quiz': {'questions': [{'question_body': 'Explain data protection regulations'}]}}, {})],
            [], [('M1', 'A', {}), ('M1', 'B', {}), ('M1', 'C', {'readingContent': 'Text'})],
            [(10, 'Explain data protection regulations'), (20, 'Marketing budget forecasts')],
        ]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        context = (None, None, None, {'components': [
            {'moduleId': 'M1', 'componentId': 'A', 'quizMeta': {'quizId': 10}},
            {'moduleId': 'M1', 'componentId': 'B', 'quizMeta': {'quizId': 20}},
            {'moduleId': 'M2', 'componentId': 'FOREIGN', 'quizMeta': {'quizId': 999}},
        ]})
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
            result = content_review(review(), context)
        self.assertEqual(result['modules'][0]['sources'][0]['contentScores'][0]['score'], 1)
        calls = cursor.execute.call_args_list
        self.assertEqual(calls[0].args[1], [['50'], ['material:7']])
        self.assertEqual(calls[2].args[1], [['M1'], ['A', 'B', 'C']])
        self.assertEqual(calls[3].args[1], [[10, 20]])
        self.assertIn('is_archived=false', calls[3].args[0])
        self.assertTrue(all(call.args[0].lstrip().startswith(('SELECT', 'WITH')) for call in calls))

    def test_conflicting_source_payloads_do_not_choose_arbitrarily(self):
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [('50', 'material:7', {'quiz_questions': [{'question_text': text}]}, {}) for text in ['One text', 'Different text']], [], [],
        ]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
            result = content_review(review(), (None, None, None, {'components': []}))
        self.assertFalse(result['modules'][0]['sources'][0]['contentAvailable'])

    def test_exported_questions_can_supply_missing_source_content(self):
        cursor = MagicMock()
        data = review(); data['modules'][0]['sources'][0]['sourceActivityRef'] = 'quiz:7'
        cursor.fetchall.side_effect = [[], [(50, {'component_kind': 'quiz', 'source_component_id': 7,
            'quiz_definition': {'questions': [{'body_html': 'Explain data protection regulations'}]}})], []]
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        with patch('learner_api.progress_transfer_content.connections', {'enrolment': connection}):
            result = content_review(data, (None, None, None, {'components': []}))
        self.assertTrue(result['modules'][0]['sources'][0]['contentAvailable'])
