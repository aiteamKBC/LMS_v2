"""Course replacement projection: no database, Django startup or network."""
from copy import deepcopy
import json
import unittest
from unittest.mock import patch

from learner_api.replacement_learning import project_replacement_learning


class ReplacementLearningTests(unittest.TestCase):
    def setUp(self):
        guard = patch('socket.socket', side_effect=AssertionError('Network prohibited'))
        guard.start()
        self.addCleanup(guard.stop)
        self.component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'reading', 'component': 'Renamed content'}
        self.settings = {'C1': {'legacySettings': json.dumps({'sourceLessonId': 7, 'sourceMaterialKey': 'reading-7'})}}
        self.courses = {'current:M1': 'legacy:50'}
        self.activity = {'activity_id': 'catalogue:50:material:7', 'source_activity_id': 7,
                         'catalogue_kind': 'material', 'group_id': 50, 'completed': True}

    def project(self, components=None, activities=None, courses=None, settings=None):
        return project_replacement_learning(components or [self.component],
            self.settings if settings is None else settings,
            self.courses if courses is None else courses,
            [self.activity] if activities is None else activities)

    def test_exact_owned_identity_carries_completion_without_fabricating_evidence(self):
        before = deepcopy((self.component, self.settings, self.activity))
        row = self.project()[0]
        self.assertEqual(row, {**self.component, 'previousLearning': {
            'courseRef': 'legacy:50', 'activityId': 'catalogue:50:material:7',
            'sourceActivityId': 7, 'catalogueKind': 'material', 'completed': True}})
        self.assertEqual((self.component, self.settings, self.activity), before)
        for field in ('quizAttempts', 'attendanceCompleted', 'actualHours', 'ksbs'):
            self.assertNotIn(field, row)

    def test_other_learner_course_and_unverified_module_cannot_supply_progress(self):
        for courses in ({}, {'current:OTHER': 'legacy:50'}, {'current:M1': 'legacy:51'}):
            with self.subTest(courses=courses):
                self.assertEqual(self.project(courses=courses), [self.component])
        self.assertEqual(self.project(activities=[{**self.activity, 'group_id': 51}]), [self.component])

    def test_quiz_and_material_with_same_number_are_independent(self):
        quiz = {**self.component, 'type': 'quiz', 'isQuiz': True}
        self.assertNotIn('previousLearning', self.project(components=[quiz])[0])
        source = {**self.activity, 'catalogue_kind': 'quiz', 'activity_id': 'catalogue:50:quiz:7'}
        result = self.project(components=[quiz], activities=[self.activity, source])[0]
        self.assertEqual(result['previousLearning']['catalogueKind'], 'quiz')
        self.assertNotIn('quizAttempts', result)

    def test_uncompleted_source_and_native_progress_are_preserved(self):
        component = {**self.component, 'attendanceCompleted': True}
        result = self.project(components=[component], activities=[{**self.activity, 'completed': False}])[0]
        self.assertFalse(result['previousLearning']['completed'])
        self.assertTrue(result['attendanceCompleted'])

    def test_ambiguous_repeated_source_is_not_credited_twice(self):
        duplicate = {**self.component, 'componentId': 'C2'}
        result = self.project(components=[self.component, duplicate], settings={**self.settings, 'C2': self.settings['C1']})
        self.assertEqual(result, [self.component, duplicate])
        self.assertEqual(self.project(activities=[self.activity, self.activity]), [self.component])
        self.assertEqual(self.project(courses={'current:M1': 'legacy:50', 'current:M2': 'legacy:50'}), [self.component])

    def test_invalid_missing_or_contradictory_provenance_is_not_guessed(self):
        for legacy in ('bad json', [], {}, {'sourceLessonId': 'title'},
                       {'sourceLessonId': 7, 'sourceMaterialKey': 'quiz-7'}):
            with self.subTest(legacy=legacy):
                self.assertEqual(self.project(settings={'C1': {'legacySettings': legacy}}), [self.component])

    def test_json_object_and_string_settings_are_equivalent(self):
        obj = {'legacySettings': {'sourceLessonId': 7}}
        self.assertEqual(self.project(settings={'C1': obj}), self.project(settings={'C1': json.dumps(obj)}))

    def test_retired_slots_do_not_inherit_another_activity_completion(self):
        component = {**self.component, 'retired': True}
        self.assertEqual(self.project(components=[component]), [component])


if __name__ == '__main__':
    unittest.main()
