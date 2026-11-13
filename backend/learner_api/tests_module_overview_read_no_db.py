"""My Learning module read: the Module Overview rides on the authorised read.

All persistence is mocked (SimpleTestCase), like the other my_learning no-db
suites. What is pinned:

* the overview is read only for the native module the learner was authorised
  to open, by that module's id;
* the instructor resolves from that module's own tutor;
* legacy (Old LMS) subjects carry no overview;
* a module outside the learner's plan fails before any overview read.
"""
import json
from contextlib import ExitStack
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from old_otjh.service import ServiceError

from . import canonical_learning as canonical
from . import my_learning as learning
from .tests_my_learning_no_db import component, fake_connections, metadata, native

RAY_PHOTO = 'https://jokdxsdbxorzciulkdyl.supabase.co/storage/v1/object/public/images/8feac92ab1694a919754ce97fc4973f0.webp'


class ModuleOverviewReadTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=7, id=7, email='synthetic@example.test', programme='Programme', cohort='', group='',
                                      _case_file_profile=SimpleNamespace(pk=9))
        self.owner = {'id': 9, 'name': 'Synthetic learner'}
        self.meta = metadata()
        self.meta['current_subjects'].append({'id': 'M2', 'title': 'Two'})
        self.context = ([{'moduleId': 'M1'}, {'moduleId': 'M2'}], ['M1', 'M2'], [], native([component(), component('OTHER', 'M2')]),
                        [], [], set(), set(), {}, self.meta, [])

    def read(self, subject, *, stored=None, tutor='Ray Mead', context=None):
        from . import weekly_learning, dashboard_training, training_plan_dashboard, live_session_progress, teams_attendance, builder_activity_dates, subject_store
        connections = fake_connections()
        cursor = connections['enrolment'].cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (json.dumps(stored) if stored is not None else None,)
        detail = native([component()])
        detail['id'] = '7'
        with ExitStack() as stack:
            stack.enter_context(patch.object(learning, 'load_context', return_value=context or self.context))
            stack.enter_context(patch.object(learning, 'connections', connections))
            stack.enter_context(patch.object(weekly_learning, 'build_learning_content_summary', return_value=detail))
            stack.enter_context(patch.object(dashboard_training, 'module_rows', return_value={'M1': {'id': 'M1', 'tutor_name': tutor}}))
            stack.enter_context(patch.object(training_plan_dashboard, 'plan_sessions', return_value=[]))
            stack.enter_context(patch.object(live_session_progress, 'read_live_credits', return_value=[]))
            stack.enter_context(patch.object(teams_attendance, 'annotate_attendance_completion', side_effect=lambda rows, *args: rows))
            stack.enter_context(patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}))
            stack.enter_context(patch.object(subject_store, 'covers_for', return_value={}))
            stack.enter_context(patch.object(canonical, 'source_subjects', return_value={'subjects': [], 'activities': [], 'progress_basis': 'catalogue_activities'}))
            result = learning.read_module(self.source, 'commercial', self.owner, subject)
        overview_calls = [call for call in cursor.execute.call_args_list if 'module_overview' in str(call.args[0])]
        return result, overview_calls

    def test_native_module_returns_its_overview_and_tutor(self):
        result, calls = self.read('current:M1', stored={'summary': 'Plan projects', 'requirements': ['Laptop']})
        self.assertEqual([call.args[1] for call in calls], [['M1']])
        self.assertEqual(result['overview']['summary'], 'Plan projects')
        self.assertEqual(result['overview']['requirements'], ['Laptop'])
        self.assertEqual(result['overview']['instructor'], {'name': 'Ray Mead', 'bio': '', 'photoUrl': RAY_PHOTO})
        self.assertNotIn('OTHER', json.dumps(result['overview']))

    def test_no_authored_overview_still_returns_existing_facts_only(self):
        result, _ = self.read('current:M1', stored=None, tutor='Someone New')
        self.assertEqual(result['overview'], {'summary': '', 'description': '', 'targetAudience': [], 'prerequisites': [],
                                              'requirements': [], 'highlights': [], 'descriptionSections': [], 'sidebarSections': [],
                                              'instructor': {'name': 'Someone New', 'bio': '', 'photoUrl': ''}})

    def test_previous_tutors_details_are_not_shown(self):
        stored = {'summary': 'S', 'instructor': {'tutorName': 'Andrew Millington', 'bio': 'Andrew bio',
                                                 'photoUrl': 'https://images.example.org/andrew.png'}}
        result, _ = self.read('current:M1', stored=stored, tutor='Ray Mead')
        self.assertEqual(result['overview']['instructor'], {'name': 'Ray Mead', 'bio': '', 'photoUrl': RAY_PHOTO})

    def test_legacy_subject_has_no_overview_and_reads_none(self):
        context = list(deepcopy(self.context))
        context[4] = [{'id': 3, 'source_course_ref': '50', 'source_course_title': 'Old'}]
        result, calls = self.read('legacy:50', context=tuple(context))
        self.assertIsNone(result['overview'])
        self.assertEqual(calls, [])

    def test_module_outside_the_plan_fails_before_any_overview_read(self):
        with self.assertRaises(ServiceError) as failure:
            self.read('current:FOREIGN')
        self.assertEqual(failure.exception.status, 404)
