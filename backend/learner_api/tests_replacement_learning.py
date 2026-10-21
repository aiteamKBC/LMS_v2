"""Integration boundary checks with all database/source reads replaced."""
from copy import deepcopy
from unittest.mock import patch
from django.test import SimpleTestCase

from .replacement_learning import annotate_replacement_learning, project_approved_learning


class ReplacementLearningReadTests(SimpleTestCase):
    def test_approval_for_one_learner_never_completes_the_same_component_for_another(self):
        component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading'}
        match = {'courseRef': 'legacy:50', 'activityId': 'catalogue:50:material:7',
                 'sourceActivityId': 7, 'catalogueKind': 'material', 'completed': True}
        transfer = {'status': 'approved', 'moduleId': 'M1', 'courseRef': 'legacy:50',
                    'matchedComponents': {'C1': match}}
        states = {12: {'items': [transfer]}, 13: {'items': [{**transfer, 'status': 'pending'}]}}
        with patch('learner_api.progress_transfer_store.read_state', side_effect=lambda pk: states[pk]) as state, \
             patch('django.db.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('C1', {'legacySettings': {'sourceLessonId': 7}})]
            for pk in (12, 13, 12):
                result = annotate_replacement_learning([component], pk)
                if pk == 12:
                    self.assertEqual(result[0]['previousLearning'], match)
                else:
                    self.assertEqual(result, [component])
            self.assertEqual([call.args[0] for call in state.call_args_list], [12, 13, 12])
            self.assertEqual(cursor.execute.call_count, 2)
            self.assertNotIn('previousLearning', component)

    def test_unassigned_and_unowned_courses_do_not_load_source_records(self):
        component = {'componentId': 'C1', 'moduleId': 'M1'}
        with patch('learner_api.progress_transfer_store.read_state', return_value={'items': []}) as state, \
             patch('django.db.connections') as connections, \
             patch('learner_api.canonical_learning.source_subjects') as history:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            self.assertEqual(annotate_replacement_learning([component], 12), [component])
            state.assert_called_once_with(12)
            history.assert_not_called()
            cursor.execute.assert_not_called()

    def test_owned_source_does_not_complete_new_components_or_rewrite_attendance(self):
        component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading', 'previousLearning': {'completed': True}}
        other = {'componentId': 'OTHER', 'moduleId': 'M2', 'type': 'reading'}
        before = deepcopy(component)
        with patch('learner_api.progress_transfer_store.read_state', return_value={'items': []}), \
             patch('django.db.connections') as connections, \
             patch('learner_api.canonical_learning.source_subjects') as history:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('C1', {'legacySettings': {'sourceLessonId': 7}})]
            history.return_value = {'activities': [{'group_id': 50, 'catalogue_kind': 'material', 'source_activity_id': 7,
                'activity_id': 'catalogue:50:material:7', 'completed': True}]}
            result = annotate_replacement_learning([component, other], 12)
            self.assertEqual(result[0], {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading'})
            self.assertEqual(result[1], other)
            self.assertEqual(component, before)
            cursor.execute.assert_not_called()
            history.assert_not_called()

    def test_no_components_never_opens_a_database_cursor(self):
        with patch('django.db.connections') as connections:
            self.assertEqual(annotate_replacement_learning([], 12), [])
            connections.__getitem__.assert_not_called()

    def test_approved_exact_matches_survive_without_new_attempts_and_never_leak_to_other_modules(self):
        reading = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading'}
        quiz = {'componentId': 'Q1', 'moduleId': 'M1', 'type': 'quiz', 'isQuiz': True}
        other = {'componentId': 'OTHER', 'moduleId': 'M2', 'type': 'reading'}
        settings = {key: {'legacySettings': {'sourceLessonId': 7}} for key in ('C1', 'Q1', 'OTHER')}
        matches = {key: {'courseRef': 'legacy:50', 'activityId': f'catalogue:50:{kind}:7',
            'sourceActivityId': 7, 'catalogueKind': kind, 'completed': True} for key, kind in [('C1', 'material'), ('Q1', 'quiz')]}
        transfer = {'status': 'approved', 'moduleId': 'M1', 'courseRef': 'legacy:50', 'matchedComponents': matches}
        before = deepcopy([reading, quiz, other, transfer])
        result = project_approved_learning([reading, quiz, other], settings, [transfer])
        self.assertEqual(result[0]['previousLearning'], matches['C1'])
        self.assertEqual(result[1]['previousLearning'], matches['Q1'])
        self.assertEqual(result[2], other)
        self.assertEqual([reading, quiz, other, transfer], before)
        for key in ('quizAttempts', 'attendanceCompleted', 'actualHours'):
            self.assertTrue(all(key not in row for row in result))
        for changed in ({**transfer, 'status': 'pending'}, {**transfer, 'matchedComponents': {}},
                        {**transfer, 'moduleId': 'M2'}, {**transfer, 'courseRef': 'legacy:99'}):
            self.assertEqual(project_approved_learning([reading, quiz], settings, [changed]), [reading, quiz])
        settings['C1']['legacySettings']['sourceLessonId'] = 8
        self.assertEqual(project_approved_learning([reading], settings, [transfer]), [reading])
        settings['C1']['legacySettings']['sourceLessonId'] = 7
        duplicate = {**reading, 'componentId': 'COPY'}
        settings['COPY'] = settings['C1']
        self.assertEqual(project_approved_learning([reading, duplicate], settings, [transfer]), [reading, duplicate])

    def test_annotation_reads_only_the_requested_learner_and_approved_module_settings(self):
        component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading'}
        match = {'courseRef': 'legacy:50', 'activityId': 'catalogue:50:material:7',
                 'sourceActivityId': 7, 'catalogueKind': 'material', 'completed': True}
        transfer = {'status': 'approved', 'moduleId': 'M1', 'courseRef': 'legacy:50', 'matchedComponents': {'C1': match}}
        with patch('learner_api.progress_transfer_store.read_state', return_value={'items': [transfer]}) as state, \
             patch('django.db.connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('C1', {'legacySettings': {'sourceLessonId': 7}})]
            self.assertEqual(annotate_replacement_learning([component], 12)[0]['previousLearning'], match)
            state.assert_called_once_with(12)
            self.assertEqual(cursor.execute.call_args.args[1], [['C1'], ['M1']])
