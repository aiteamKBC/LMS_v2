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
                                  programmeId='', programmeName='', groupName='', isFreeCourse=True)
        self.ordinary = dict(moduleId='MOD-REGULAR', moduleTitle='Programme skills', hours=10,
                             programmeId='PROG-1', programmeName='Programme', groupName='Group')
        self.source = SimpleNamespace(pk=7, id=7, username='Synthetic learner', free_courses=[],
            learner_type='commercial',
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
        for kind, field, total in [('commercial', 'training_plan', 16), ('apprenticeship', 'learning_plan', 10)]:
            with self.subTest(field=field):
                self.source.learner_type = kind
                self.source.training_plan = None
                self.source.learning_plan = None
                setattr(self.source, field, [self.ordinary])
                request = RequestFactory().patch('/learner_api/learning-plan/7/', content_type='application/json',
                    data=json.dumps({'modules': ['MOD-REGULAR', 'MOD-FREE', 'MOD-FREE'], 'freeCourses': []}))
                response = plans.learning_plan(request, pk=7)
                self.assertEqual(response.status_code, 200)
                self.assertEqual([entry['moduleId'] for entry in getattr(self.source, field)], ['MOD-REGULAR', 'MOD-FREE'])
                self.assertEqual(json.loads(response.content)['totals']['totalHours'], total)
                self.assertEqual(self.source.free_courses, [])

    def test_apprentice_keeps_free_assignment_but_only_core_and_meetings_are_planned(self):
        self.source.learner_type = 'apprenticeship'
        with patch.object(plans, '_meetings', return_value=([{'hours': 2}], '')):
            response = plans.learning_plan(RequestFactory().get('/'), pk=7)
        body = json.loads(response.content)
        self.assertEqual(body['learner']['learnerType'], 'apprenticeship')
        self.assertEqual([m['moduleId'] for m in body['plan']], ['MOD-REGULAR', 'MOD-FREE'])
        self.assertEqual(body['totals'], dict(moduleCount=1, moduleHours=10, freeCourseCount=1,
            freeCourseHours=6, plannedFreeCourseHours=0, meetingCount=1, meetingHours=2, totalHours=12))
        self.source.save.assert_not_called()

    def test_free_only_apprentice_has_zero_planned_hours_without_changing_course_duration(self):
        totals = plans._totals([self.course_module], kind='apprenticeship')
        self.assertEqual(totals['totalHours'], 0)
        self.assertEqual(totals['freeCourseHours'], 6)
        self.assertEqual(self.course_module['hours'], 6)

    def test_converted_course_is_a_normal_planned_module(self):
        for source_type, expected in [('free_course', 0), ('module_authoring', 6)]:
            module = plans._module_payload(dict(module_catalogue_id='MOD-FREE', title='Skills',
                total_otjh=6, source_type=source_type))
            self.assertEqual(plans._totals([module], kind='apprenticeship')['totalHours'], expected)

    def test_new_plan_documents_exclude_additional_courses_for_apprentices_only(self):
        from . import apprenticeship_agreement, training_plan_document
        for document in (apprenticeship_agreement, training_plan_document):
            for kind, expected in [('apprenticeship', ['MOD-REGULAR']), ('commercial', ['MOD-REGULAR', 'MOD-FREE'])]:
                with self.subTest(document=document.__name__, kind=kind):
                    self.source.learner_type = kind
                    with patch.object(document, 'learner_programme_modules', return_value=[self.ordinary, self.course_module]):
                        modules = document._plan_modules(self.source)
                    self.assertEqual([m['moduleId'] for m in modules], expected)
                    self.assertEqual(len(self.source.training_plan), 2)

    def test_fallback_planned_total_excludes_free_only_for_apprentices_and_preserves_zero(self):
        from . import training_plan_dashboard as dashboard
        db = MagicMock()
        cursor = db.cursor.return_value.__enter__.return_value
        for kind, total in [('apprenticeship', 10), ('apprenticeship', 0), ('commercial', 16)]:
            with self.subTest(kind=kind, total=total):
                self.source.learner_type = kind
                cursor.fetchone.return_value = (total,)
                with patch.object(dashboard, 'connections', {'enrolment': db}):
                    actual = dashboard.plan_planned_hours(self.source, {}, ids=['MOD-REGULAR', 'MOD-FREE'])
                self.assertEqual(actual, total)
                sql, params = cursor.execute.call_args.args
                self.assertEqual(params, [['MOD-REGULAR', 'MOD-FREE']])
                if kind == 'apprenticeship':
                    self.assertIn("CASE WHEN source_type = 'free_course' THEN 0 ELSE total_otjh END", sql)
                else:
                    self.assertIn('sum(total_otjh)', sql)

    def test_popup_removal_keeps_the_other_module(self):
        request = RequestFactory().patch('/learner_api/learning-plan/7/', content_type='application/json',
            data=json.dumps({'modules': ['MOD-REGULAR'], 'freeCourses': []}))
        response = plans.learning_plan(request, pk=7)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([entry['moduleId'] for entry in self.source.training_plan], ['MOD-REGULAR'])
        self.assertEqual(json.loads(response.content)['totals']['totalHours'], 10)
