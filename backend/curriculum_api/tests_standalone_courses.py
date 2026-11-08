"""Standalone courses retain the ordinary module storage and hours contracts."""
from unittest.mock import patch

from . import views
from .tests import CurriculumPersistenceHarness
from . import learner_assignments as assignments
from .tests_learner_assignments import learner


class StandaloneCourseTests(CurriculumPersistenceHarness):
    def test_existing_uploaded_mp4_is_editable_but_non_lms_and_traversal_paths_are_rejected(self):
        original = '/curriculum_api/curriculum/uploads/legacy-course/lesson.mp4'
        for url, valid in ((original, True), ('//example.test/lesson.mp4', False),
                           ('/private/lesson.mp4', False),
                           ('/curriculum_api/curriculum/uploads/%2e%2e/lesson.mp4', False),
                           ('/curriculum_api/curriculum/uploads/file.html', False)):
            with self.subTest(url=url):
                component = {'type': 'video', 'title': 'Existing video', 'settings': {
                    'sourceType': 'HTML (MP4)', 'videoUrl': url}}
                errors = views.validate_component_authoring_payload(component, 'component')
                self.assertEqual(not errors, valid)

    def payload(self):
        return {
            'isFreeCourse': True, 'title': 'Independent study',
            'weekStructure': [{'id': 'WEEK-FREE', 'title': 'Study', 'components': [
                {'id': 'COMP-FREE-A', 'type': 'reading', 'title': 'Reading', 'expectedOtjh': 1.5, 'points': 0},
                {'id': 'COMP-FREE-B', 'type': 'reading', 'title': 'Practice', 'expectedOtjh': 0.5, 'points': 0},
            ]}],
        }

    def save(self, payload=None):
        return views.save_module_authoring_structure('MOD-FREE', payload or self.payload(), repair_links=False)

    def test_course_uses_normal_content_and_hours_without_placement_or_teams(self):
        with patch.object(views, 'link_live_session_series_to_module') as link:
            course = self.save()
        link.assert_not_called()
        row = views.authoring_module_exists('MOD-FREE')
        self.assertEqual(row['source_type'], 'free_course')
        self.assertEqual(row['learner_roster_mode'], 'manual')
        for key in ('programme_id', 'programme_name', 'cohort_id', 'group_id', 'teams_shared_source_module_id'):
            self.assertFalse(row.get(key), key)
        self.assertEqual(float(row['total_otjh']), 2)
        self.assertTrue(course['isFreeCourse'])
        self.assertEqual(len(course['weekStructure'][0]['components']), 2)
        summary = views.authoring_catalogue_summaries()['MOD-FREE']
        compact = views.compact_module_list_rows([views.authoring_summary_catalogue_item(summary)])[0]
        self.assertTrue(compact['isFreeCourse'])

    def test_partial_edit_keeps_course_kind_and_hours(self):
        self.save()
        result = self.save({'title': 'Renamed course', 'sourceType': 'module_authoring'})
        self.assertTrue(result['isFreeCourse'])
        self.assertEqual(float(views.authoring_module_exists('MOD-FREE')['total_otjh']), 2)
        self.assertEqual(len(result['weekStructure'][0]['components']), 2)

    def test_public_create_and_detail_edit_keep_course_kind(self):
        import json
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.post('/', json.dumps({**self.payload(), 'moduleType': 'authoring', 'catalogueId': 'MOD-FREE'}), content_type='application/json')
        response = views.curriculum_module_collection(request)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(json.loads(response.content)['module']['isFreeCourse'])
        request = factory.patch('/', json.dumps({'name': 'Edited course', 'description': 'Edited', 'weeks': 2}), content_type='application/json')
        response = views.curriculum_module_detail(request, 'MOD-FREE')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(json.loads(response.content)['module']['isFreeCourse'])
        self.assertEqual(float(views.authoring_module_exists('MOD-FREE')['total_otjh']), 2)

    def test_public_detail_refuses_placement_with_validation_response(self):
        import json
        from django.test import RequestFactory
        self.save()
        request = RequestFactory().patch('/', json.dumps({'groupId': 'OTHER-GROUP'}), content_type='application/json')
        response = views.curriculum_module_detail(request, 'MOD-FREE')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertTrue(json.loads(response.content)['validationErrors'])
        self.assertFalse(views.authoring_module_exists('MOD-FREE')['group_id'])

    def test_live_content_is_refused_before_persistence(self):
        payload = self.payload()
        payload['weekStructure'][0]['components'][0]['type'] = 'live-session'
        with self.assertRaises(views.ModuleAuthoringValidationError):
            self.save(payload)
        self.assertFalse(views.authoring_module_exists('MOD-FREE'))

    def test_scope_and_teams_cannot_be_attached_later(self):
        self.save()
        for patch_payload in ({'programmeId': 'PROG-DATA'}, {'cohortId': 'COHORT-X'},
                              {'groupId': 'GROUP-X'}, {'teamsSharedSourceModuleId': 'MOD-OTHER'}):
            with self.subTest(patch=patch_payload), self.assertRaises(views.ModuleAuthoringValidationError):
                self.save(patch_payload)
        self.assertEqual(views.authoring_module_exists('MOD-FREE')['learner_roster_mode'], 'manual')

    def test_normal_module_with_same_title_is_a_different_record(self):
        self.save()
        self.assertEqual(views.find_existing_authoring_catalogue_id_for_payload({'title': 'Independent study'}), '')
        self.assertEqual(views.find_existing_authoring_catalogue_id_for_payload({'title': 'Independent study', 'isFreeCourse': True}), '')
        self.assertEqual(views.find_existing_authoring_catalogue_id_for_payload({'catalogueId': 'MOD-FREE', 'isFreeCourse': True}), 'MOD-FREE')

    def test_existing_normal_module_cannot_be_reclassified(self):
        self.save({'title': 'Ordinary module', 'weekStructure': []})
        with self.assertRaises(views.ModuleAuthoringValidationError):
            self.save(self.payload())
        self.assertNotEqual(views.authoring_module_exists('MOD-FREE')['source_type'], 'free_course')

    def test_component_builder_cannot_add_live_sessions_to_course(self):
        self.save()
        with self.assertRaises(views.ModuleAuthoringValidationError):
            views.save_component_builder_payload({'moduleCatalogueId': 'MOD-FREE', 'type': 'Live session', 'title': 'Live'})
        self.assertEqual(len(views.get_authoring_structure_payload('MOD-FREE')['weekStructure'][0]['components']), 2)

    def test_assignment_uses_normal_plan_and_hours_for_both_learner_types(self):
        self.save()
        target = assignments._target('module', 'MOD-FREE')
        catalogue = {entry['moduleId']: entry for entry in assignments.plans._all_modules()}
        for kind, field in (('apprenticeship', 'learning_plan'), ('commercial', 'training_plan'),
                            ('apprenticeship', 'training_plan'), ('commercial', 'learning_plan')):
            with self.subTest(learner_type=kind, plan_column=field), \
                    patch.object(assignments.plans, '_group_module_ids', return_value=[]), \
                    patch.object(assignments.plans, 'sync_learning_plan_mirror'), \
                    patch.object(assignments, 'LearnerProfile') as profiles:
                row = learner([], learner_type=kind, training_plan=[] if field == 'training_plan' else None)
                other = learner([], pk=2, learner_type=kind, training_plan=[] if field == 'training_plan' else None)
                self.assertTrue(assignments._assign(row, target, catalogue, {}))
                plan = getattr(row, field)
                self.assertEqual([entry['moduleId'] for entry in plan], ['MOD-FREE'])
                self.assertEqual(assignments.plans._totals(plan)['totalHours'], 2)
                self.assertTrue(plan[0]['weeks'])
                self.assertEqual((row.programme, row.cohort, row.group), ('Original programme', 'Original cohort', 'Original group'))
                self.assertEqual(getattr(other, field), [])
                row.save.assert_called_once_with(update_fields=[field])
                profiles.objects.filter.assert_not_called()
                self.assertFalse(assignments._assign(row, target, catalogue, {}))

    def test_teams_creation_refuses_course_before_graph_request(self):
        import json
        from django.test import RequestFactory
        self.save()
        with patch('coach_api.views.get_graph_settings', return_value={}), \
                patch('coach_api.views.has_graph_credentials', return_value=True), \
                patch('coach_api.views.microsoft_graph_request') as graph:
            request = RequestFactory().post('/', json.dumps({'moduleCatalogueId': 'MOD-FREE'}), content_type='application/json')
            response = views.curriculum_teams_meeting(request)
        self.assertEqual(response.status_code, 400)
        graph.assert_not_called()
