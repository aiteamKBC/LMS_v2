"""Synthetic recovery-plan regressions; no database, settings or HTTP access."""
from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import restore_legacy_course_components as recovery


class CourseComponentRecoveryTests(unittest.TestCase):
    def setUp(self):
        for target in ('psycopg.connect', 'urllib.request.OpenerDirector.open'):
            guard = patch(target, side_effect=AssertionError('External access forbidden'))
            guard.start()
            self.addCleanup(guard.stop)
        config = patch.object(recovery.subject_content, 'settings', SimpleNamespace(
            KBC_LMS_API_KEY='synthetic-secret', KBC_LMS_SCHEMA_URL='https://source.test/schema'))
        config.start()
        self.addCleanup(config.stop)
        self.fact = dict(component_id=10, component_kind='lesson', post_type='stm-lessons', material_type='video',
                         section_id=5, section_order=2, section_title='Second section', component_order=1,
                         configured_duration_seconds=None, title='Synthetic video')
        self.inventory = dict(course_id=1, title='Synthetic course', facts={'material:10': self.fact})
        self.state = dict(course={'id': 1, 'source_course_ref': '1', 'source_course_title': 'Synthetic course'},
            module={'module_catalogue_id': 'MOD-1', 'weeks_number': 1},
            export={'sections': []}, weeks=[], components=[], materials=[], definitions=[dict(
                id=1, source_activity_id='material:10', curriculum_component_ref=None, source_material_id=None, deleted_at=None)])
        self.schema = dict(material_id=10, material_title='Synthetic video', content_type='video',
                           iframe_url='https://video.test/10', source={}, content_duration={'seconds': 300})

    def plan(self):
        return recovery.make_plan(self.state, self.inventory, {10: self.schema})

    def test_exact_source_identity_creates_missing_rows_and_preserves_input(self):
        before = deepcopy(self.state)
        plan = self.plan()
        self.assertEqual(self.state, before)
        self.assertEqual(plan['weeks'][0]['week_number'], 2)
        self.assertEqual(plan['weeks'][0]['display_order'], 1)
        self.assertEqual(plan['components'][0]['display_order'], 0)
        self.assertEqual(plan['components'][0]['id'], 'COMP-OLDLMS-1-MATERIAL-10')
        self.assertEqual(plan['links'][0]['fields']['source_material_id'], 10)

    def test_media_length_is_display_metadata_not_invented_training_hours(self):
        component = self.plan()['components'][0]
        self.assertEqual(component['settings_json']['durationMinutes'], 5)
        self.assertEqual(component['expected_otjh'], 0)
        self.fact['configured_duration_seconds'] = 1800
        self.assertEqual(self.plan()['components'][0]['expected_otjh'], recovery.Decimal('0.50'))

    def test_existing_export_identity_is_reused_and_authored_component_is_unchanged(self):
        self.state['export']['sections'] = [dict(section_id=5, week_id='WEEK-OLD', materials=[dict(
            source_component_id=10, component_kind='lesson', component_id='COMP-OLD')])]
        self.state['weeks'] = [dict(id='WEEK-OLD', deleted_at=None)]
        self.state['components'] = [dict(id='COMP-OLD', deleted_at=None, settings_json={'authored': 'preserve'})]
        self.assertEqual(self.plan()['components'], [])
        self.assertEqual(self.plan()['weeks'], [])
        self.assertEqual(self.plan()['links'][0]['fields']['curriculum_component_ref'], 'COMP-OLD')

    def test_other_course_and_unverified_types_are_rejected(self):
        self.inventory['course_id'] = 2
        with self.assertRaisesRegex(ValueError, 'another course'):
            self.plan()
        self.inventory['course_id'] = 1
        self.fact['post_type'] = 'page'
        with self.assertRaisesRegex(ValueError, 'typed component'):
            self.plan()

    def test_deleted_content_is_not_resurrected(self):
        self.state['components'] = [dict(id='COMP-OLDLMS-1-MATERIAL-10', deleted_at='synthetic-deletion')]
        with self.assertRaisesRegex(ValueError, 'deleted component'):
            self.plan()

    def test_conflicting_material_identity_is_not_overwritten(self):
        self.state['definitions'][0]['source_material_id'] = 99
        with self.assertRaisesRegex(ValueError, 'different source identity'):
            self.plan()

    def test_new_material_cannot_copy_learner_results_or_credentials(self):
        self.schema.update(user_id=1, completed=True, time_spent_seconds=500)
        material = self.plan()['materials'][0]
        self.assertNotIn('user_id', material['payload'])
        self.assertNotIn('completed', material['payload'])
        self.assertNotIn('time_spent_seconds', material['payload'])
        self.schema['iframe_url'] = 'https://source.test/view?key=synthetic-secret'
        with self.assertRaisesRegex(ValueError, 'unavailable'):
            self.plan()

    def test_unavailable_quiz_does_not_become_published(self):
        self.fact.update(component_kind='quiz', post_type='stm-quizzes', material_type=None)
        self.inventory['facts'] = {'quiz:10': self.fact}
        self.state['definitions'][0]['source_activity_id'] = 'quiz:10'
        self.schema.update(content_type='quiz', quiz={'questions': []})
        with self.assertRaisesRegex(ValueError, 'answer keys'):
            self.plan()

    def test_idempotence_and_unmatched_historical_catalogue_are_preserved(self):
        self.state['definitions'].append(dict(id=2, source_activity_id='material:99', deleted_at=None,
            curriculum_component_ref='HISTORICAL', source_material_id=99))
        plan = self.plan()
        for key in ('weeks', 'components', 'materials'):
            self.state[key] = [{**row, 'id': row.get('id', 10), 'deleted_at': None} for row in plan[key]]
        self.state['definitions'][0].update(plan['links'][0]['fields'])
        again = self.plan()
        self.assertFalse(any(again[key] for key in ('weeks', 'components', 'materials', 'links')))
        self.assertEqual(self.state['definitions'][1]['curriculum_component_ref'], 'HISTORICAL')


if __name__ == '__main__':
    unittest.main(verbosity=2)
