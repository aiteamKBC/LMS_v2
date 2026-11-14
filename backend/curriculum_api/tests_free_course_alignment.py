"""Synthetic, database-free coverage of preservation and cross-branch identity."""
from copy import deepcopy
from datetime import datetime, timezone

from django.test import SimpleTestCase

from .free_course_alignment import TABLES, build_plan


class AlignmentPlanTests(SimpleTestCase):
    def setUp(self):
        self.source = {table: [] for table in TABLES}
        self.source.update(profiles=[{'id': 7, 'enrolment_id': 50}], assignments_json=[], quiz_ids=[],
                           enrolment_uuids={50: 'synthetic-permanent-identity'})
        self.source['free_courses'] = [dict(id='COURSE', course_name='Source title')]
        self.source['free_course_weeks'] = [dict(id='OLD-WEEK', course_id='COURSE', title='Source week',
            week_number=1, display_order=1, created_at=None, updated_at=None)]
        self.source['free_programme_components'] = [dict(id='ITEM', free_module_id='OLD-WEEK', type='reading',
                                                       settings_json={'readingContent': 'Source text'})]
        self.source['learner_free_courses'] = [dict(id=1, learner_id=7, free_course_ref='COURSE', position=1)]
        self.source['learner_free_course_progress'] = [dict(id=1, learner_id=7, free_course_ref='COURSE',
            component_ref='ITEM', completed_at=None, status='active', deleted_at=None)]
        self.target = {table: [] for table in TABLES}
        self.target.update(profiles=[{'id': 80, 'enrolment_id': 50}],
                           assignments_json=[{'id': 50, 'value': []}], quiz_ids=[],
                           enrolment_uuids={50: 'synthetic-permanent-identity'})
        self.source['ordinary_refs'] = self.target['ordinary_refs'] = {'modules': [], 'weeks': [], 'components': []}

    def test_matches_enrolment_identity_and_does_not_copy_learner_record_ids(self):
        plan = build_plan(self.source, self.target)
        self.assertEqual(plan.inserts['learner_free_courses'][0]['learner_id'], 80)
        self.assertNotIn('id', plan.inserts['learner_free_courses'][0])
        self.assertNotIn('id', plan.inserts['learner_free_course_progress'][0])
        self.assertIsNone(plan.inserts['learner_free_course_progress'][0]['completed_at'])
        self.assertEqual(plan.assignment_appends[50][0]['freeCourseId'], 'COURSE')

    def test_preserves_target_values_and_recognises_renamed_weeks(self):
        self.target['free_courses'] = [dict(id='COURSE', course_name='Keep target title')]
        self.target['free_course_weeks'] = [dict(id='NEW-WEEK', course_id='COURSE', title='Keep week')]
        self.target['free_programme_components'] = [dict(id='ITEM', free_module_id='NEW-WEEK', settings_json={'keep': True})]
        before = deepcopy(self.target)
        plan = build_plan(self.source, self.target)
        for table in list(TABLES)[:3]:
            self.assertEqual(plan.inserts[table], [])
        self.assertEqual(plan.inserts['learner_free_courses'][0]['free_course_title'], 'Keep target title')
        self.assertEqual(self.target, before)

    def test_existing_assignment_and_completion_win_without_appending_duplicate_json(self):
        self.target['learner_free_courses'] = [dict(id=9, learner_id=80, free_course_ref='COURSE', position=8)]
        self.target['learner_free_course_progress'] = [dict(id=4, learner_id=80, component_ref='ITEM', completed_at='keep')]
        plan = build_plan(self.source, self.target)
        self.assertEqual(plan.inserts['learner_free_courses'], [])
        self.assertEqual(plan.inserts['learner_free_course_progress'], [])
        self.assertEqual(plan.assignment_appends, {})

    def test_appends_after_existing_positions_and_preserves_json(self):
        self.target['learner_free_courses'] = [dict(id=1, learner_id=80, free_course_ref='OTHER', position=9)]
        self.target['assignments_json'][0]['value'] = [{'freeCourseId': 'OTHER', 'addedAt': 'original'}]
        before = deepcopy(self.target)
        plan = build_plan(self.source, self.target)
        self.assertEqual(plan.inserts['learner_free_courses'][0]['position'], 10)
        self.assertEqual(self.target, before)

    def test_archived_completion_keeps_its_exact_timestamp_and_state(self):
        at = datetime(2026, 1, 2, tzinfo=timezone.utc)
        self.source['learner_free_course_progress'][0].update(status='inactive', deleted_at=at, completed_at=at)
        saved = build_plan(self.source, self.target).inserts['learner_free_course_progress'][0]
        self.assertEqual((saved['status'], saved['deleted_at'], saved['completed_at']), ('inactive', at, at))

    def test_rejects_ambiguous_learner_identity(self):
        self.target['profiles'].append(dict(id=81, enrolment_id=50))
        with self.assertRaisesRegex(ValueError, 'unambiguously'):
            build_plan(self.source, self.target)

    def test_rejects_a_reused_enrolment_id_with_a_different_permanent_identity(self):
        self.target['enrolment_uuids'][50] = 'another-person'
        with self.assertRaisesRegex(ValueError, 'UUID differs'):
            build_plan(self.source, self.target)

    def test_rejects_cross_course_component_identity(self):
        self.target['free_programme_components'] = [dict(id='ITEM', free_module_id='OTHER-WEEK')]
        self.target['free_course_weeks'] = [dict(id='OTHER-WEEK', course_id='OTHER')]
        with self.assertRaisesRegex(ValueError, 'ownership'):
            build_plan(self.source, self.target)

    def test_missing_quiz_definition_aborts_without_creating_a_fake_quiz(self):
        self.source['free_programme_components'][0].update(type='quiz', settings_json={'linkedQuizId': 999})
        with self.assertRaisesRegex(ValueError, 'quiz definition'):
            build_plan(self.source, self.target)

    def test_plan_fingerprint_detects_changed_target_values(self):
        previous = build_plan(self.source, self.target).fingerprint
        self.target['assignments_json'][0]['value'].append({'freeCourseId': 'OTHER'})
        self.assertNotEqual(build_plan(self.source, self.target).fingerprint, previous)

    def test_ordinary_content_identity_collision_aborts(self):
        from .legacy_free_course_migration import adopted_id
        self.target['ordinary_refs']['modules'] = [adopted_id('MOD', 'COURSE', 'COURSE')]
        with self.assertRaisesRegex(ValueError, 'ordinary curriculum'):
            build_plan(self.source, self.target)
