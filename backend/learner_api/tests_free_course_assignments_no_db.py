"""Builder assignments appear in the learner free-course section without writes."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import free_courses_view as view
from . import free_course_catalogue as catalogue
from . import learning_plan as plans


COURSE = dict(freeCourseId='FC-1', moduleId='MOD-FREE', courseName='Standalone skills',
              description='', coverImageUrl='', weekCount=2, activityCount=4, hours=6, weeks=[])


class FreeCourseAssignmentReadTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=7, id=7, free_courses=[], training_plan=None,
                                      learning_plan=[], programme='', group='')
        self.source_read = self.enterContext(patch.object(view, '_resolve_source', return_value=(self.source, None)))
        self.catalogue = self.enterContext(patch.object(view, 'builder_free_courses', return_value=[COURSE]))
        self.auth = self.enterContext(patch('login.permissions.authenticate_request',
                                          return_value=SimpleNamespace(role='learner', subject_id=7)))
        self.enterContext(patch('login.permissions._auth_gate_enabled', return_value=True))
        self.legacy = self.enterContext(patch.object(view, '_scoped_rows', return_value=({}, [], [])))
        self.enterContext(patch.object(view, 'LearnerFreeCourseProgress'))

    def read(self, kind='commercial', pk=7):
        request = RequestFactory().get(f'/learner_api/free-courses/{kind}/{pk}/')
        return view.free_courses(request, kind=kind, pk=pk)

    def test_reads_normal_plan_for_both_learner_types_without_legacy_assignment(self):
        for kind, field in [('commercial', 'training_plan'), ('apprenticeship', 'learning_plan')]:
            with self.subTest(kind=kind):
                self.source.training_plan = None
                self.source.learning_plan = None
                setattr(self.source, field, [dict(moduleId='MOD-FREE', assignmentMode='explicit')])
                response = self.read(kind)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['freeCourses'], [COURSE])
                self.catalogue.assert_called_with(['MOD-FREE'])
                self.legacy.assert_not_called()
                self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_keeps_legacy_assignments_but_deduplicates_adopted_course(self):
        self.source.training_plan = [dict(moduleId='MOD-FREE', assignmentMode='explicit')]
        self.source.free_courses = [dict(freeCourseId='FC-1', courseName='Old title'),
                                    dict(freeCourseId='LEGACY', courseName='Legacy skills')]
        courses = json.loads(self.read().content)['freeCourses']
        self.assertEqual([course['freeCourseId'] for course in courses], ['FC-1', 'LEGACY'])
        self.assertEqual(courses[0]['moduleId'], 'MOD-FREE')
        self.legacy.assert_called_once_with(['LEGACY'])

    def test_cleared_plan_does_not_request_an_unscoped_catalogue(self):
        self.source.training_plan = []
        self.catalogue.return_value = []
        self.assertEqual(json.loads(self.read().content), {'freeCourses': []})
        self.catalogue.assert_called_once_with([])

    def test_catalogue_failure_is_visible_instead_of_an_empty_success(self):
        self.catalogue.side_effect = DatabaseError('synthetic outage')
        self.assertEqual(self.read().status_code, 503)

    def test_another_learner_cannot_read_assignments(self):
        self.assertEqual(self.read(pk=8).status_code, 404)
        self.source_read.assert_not_called()
        self.catalogue.assert_not_called()

    def test_anonymous_caller_cannot_read_assignments(self):
        self.auth.return_value = None
        self.assertEqual(self.read().status_code, 401)
        self.source_read.assert_not_called()

    def test_staff_can_read_the_selected_learner(self):
        self.auth.return_value = SimpleNamespace(role='staff')
        self.assertEqual(self.read().status_code, 200)


class BuilderFreeCourseCatalogueTests(SimpleTestCase):
    def test_reader_limits_sql_to_owned_modules_and_active_standalone_courses(self):
        db = MagicMock()
        cursor = db.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('FC-1', 'MOD-FREE', 'Standalone skills', '', '', 2, 4, 6)]
        with patch.object(catalogue, 'connection', db):
            result = catalogue.builder_free_courses(['MOD-FREE', 'MOD-FREE'])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [['MOD-FREE']])
        for constraint in ['f.module_catalogue_id = ANY(%s)', 'f.converted_at IS NULL',
                           'f.deleted_at IS NULL', 'm.deleted_at IS NULL', "m.source_type = 'free_course'"]:
            self.assertIn(constraint, sql)
        self.assertEqual(result, [COURSE])

    def test_empty_assignment_skips_the_catalogue_query(self):
        db = Mock()
        with patch.object(catalogue, 'connection', db):
            self.assertEqual(catalogue.builder_free_courses([]), [])
        db.cursor.assert_not_called()

    def test_plan_picker_does_not_load_large_cover_or_content_fields(self):
        db = MagicMock()
        with patch.object(catalogue, 'connection', db):
            catalogue.builder_free_courses(include_content=False)
        sql = db.cursor.return_value.__enter__.return_value.execute.call_args.args[0]
        self.assertNotIn('f.cover_image_url', sql)
        self.assertNotIn('f.description', sql)


class FreeCourseLearningPlanTests(SimpleTestCase):
    def setUp(self):
        self.course_module = dict(moduleId='MOD-FREE', moduleTitle='Standalone skills', hours=6,
                                  programmeId='', programmeName='', groupName='')
        self.ordinary = dict(moduleId='MOD-REGULAR', moduleTitle='Programme skills', hours=10,
                             programmeId='PROG-1', programmeName='Programme', groupName='Group')
        self.source = SimpleNamespace(pk=7, id=7, username='Synthetic learner', free_courses=[],
            training_plan=[self.ordinary, self.course_module], learning_plan=None,
            programme='Programme', cohort='Cohort', group='Group', programme_status='Delivery', save=Mock())
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='admin')))
        self.enterContext(patch.object(plans, 'EnrolmentUser')).all_learners.get.return_value = self.source
        self.enterContext(patch.object(plans, 'learner_programme_modules', return_value=[self.ordinary]))
        self.enterContext(patch.object(plans, 'learner_group_module_ids', return_value=[]))
        self.enterContext(patch.object(plans, '_all_modules', return_value=[self.ordinary, self.course_module]))
        self.enterContext(patch.object(plans, '_modules_by_id', return_value={'MOD-FREE': self.course_module}))
        self.enterContext(patch.object(plans, '_aptem_subject_modules', return_value={}))
        self.enterContext(patch.object(plans, '_meetings', return_value=([], '')))
        self.enterContext(patch.object(plans, 'sync_learning_plan_mirror'))
        self.enterContext(patch.object(plans, 'advance_learner'))
        self.enterContext(patch.object(catalogue, 'builder_free_courses', return_value=[COURSE]))
        self.enterContext(patch('curriculum_api.legacy_free_course_adoption.adopted_courses', return_value={'FC-1': 'MOD-FREE'}))

    def test_popup_returns_course_identity_and_hours_counted_once_in_the_plan(self):
        response = plans.learning_plan(RequestFactory().get('/learner_api/learning-plan/7/'), pk=7)
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body['standaloneCourses'], [COURSE])
        self.assertEqual(body['freeCourses'], [])
        self.assertEqual([entry['moduleId'] for entry in body['plan']], ['MOD-REGULAR', 'MOD-FREE'])
        self.assertEqual(body['totals']['totalHours'], 16)
        self.source.save.assert_not_called()

    def test_popup_save_updates_the_same_plan_as_builder_assignment_for_both_kinds(self):
        for field in ('training_plan', 'learning_plan'):
            with self.subTest(field=field):
                self.source.training_plan = None
                self.source.learning_plan = None
                setattr(self.source, field, [self.ordinary])
                request = RequestFactory().patch('/learner_api/learning-plan/7/', content_type='application/json',
                    data=json.dumps({'modules': ['MOD-REGULAR', 'MOD-FREE', 'MOD-FREE'], 'freeCourses': []}))
                response = plans.learning_plan(request, pk=7)
                self.assertEqual(response.status_code, 200)
                self.assertEqual([entry['moduleId'] for entry in getattr(self.source, field)], ['MOD-REGULAR', 'MOD-FREE'])
                self.assertEqual(json.loads(response.content)['totals']['totalHours'], 16)
                self.assertEqual(self.source.free_courses, [])

    def test_popup_removal_keeps_the_other_module(self):
        request = RequestFactory().patch('/learner_api/learning-plan/7/', content_type='application/json',
            data=json.dumps({'modules': ['MOD-REGULAR'], 'freeCourses': []}))
        response = plans.learning_plan(request, pk=7)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([entry['moduleId'] for entry in self.source.training_plan], ['MOD-REGULAR'])
        self.assertEqual(json.loads(response.content)['totals']['totalHours'], 10)
