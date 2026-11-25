"""Employer chart parity with My Learning; storage and network are mocked."""
from contextlib import contextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory

from . import canonical_learning as canonical, dashboard_overview, employer_learning
from . import employer_performance, my_learning, my_learning_ksbs
from .tests_my_learning_no_db import component, fake_connections, metadata, native


class EmployerModuleKsbTests(SimpleTestCase):
    @contextmanager
    def catalogue(self, *, historical=False, free_ids=()):
        content = native([
            component('C1', ksbMappings=[{'code': code} for code in ('K1', 'K2', 'S1')]),
            component('C1', ksbMappings=[{'code': code} for code in ('K1', 'K2', 'S1')]),
            component('C2', ksbMappings=[{'code': 'K1'}]),
            component('C3', 'M2', ksbMappings=[{'code': 'B1'}]),
        ])
        content['componentProgress'] = [{'componentId': 'C1', 'kind': 'component'}]
        meta = metadata()
        meta['current_subjects'].append({'id': 'M2', 'title': 'Two'})
        meta['modules'] = {'M1': {'id': 'M1', 'title': 'One'}, 'M2': {'id': 'M2', 'title': 'Two'}}
        meta['free_course_module_ids'] = list(free_ids)
        courses, definitions, done, hours = [], [], set(), {}
        if historical:
            courses = [{'id': 3, 'source_course_ref': '50', 'source_course_title': 'Old',
                        'curriculum_module_ref': 'M1'}]
            definitions = [{'source_course_ref': '50', 'source_activity_id': ref,
                            'source_activity_title': ref} for ref in ('material:7', 'quiz:7')]
            done, hours = {('50', 'material:7')}, {'50': 0}
            meta['imported_courses'] = {'current:M1': 'legacy:50'}
            meta['record_ids'] = {('50', 'material:7'): {'10'}, ('50', 'quiz:7'): {'11'}}
        context = ([], [], [], content, courses, definitions, done, set(), hours, meta, [])

        def query(sql, *args, **kwargs):
            if 'learner_progress_ksbs' in sql:
                return [{'id': 10, 'codes': ['K1']}, {'id': 11, 'codes': ['S1', 'S2']}]
            return []

        with patch.object(my_learning, 'load_context', side_effect=lambda *a, **kw: deepcopy(context)) as load, \
                patch.object(my_learning_ksbs, 'connections', fake_connections()), \
                patch.object(canonical, 'query', side_effect=query), \
                patch('learner_api.course_catalogue_display.read_export_placements', return_value=[]), \
                patch('learner_api.subject_store.covers_for', return_value={}) as covers, \
                patch.object(canonical, 'programme_planned_hours', return_value=0) as planned, \
                patch.object(my_learning, 'upcoming_links', return_value=[]) as upcoming:
            yield load, covers, planned, upcoming

    def test_native_chart_matches_learner_points_including_unstarted_modules_and_duplicate_placements(self):
        source, owner = SimpleNamespace(pk=7, cohort='', group=''), {'id': 9, 'name': 'Synthetic learner'}
        modules = [{'id': 'current:M1', 'moduleId': 'M1'}, {'id': 'current:M2', 'moduleId': 'M2'}]
        with self.catalogue() as (_, covers, planned, upcoming):
            actual = employer_performance.module_ksbs(source, 'commercial', owner, modules)
            covers.assert_not_called()
            planned.assert_not_called()
            upcoming.assert_not_called()
            learner = my_learning.read_catalogue(source, 'commercial', owner)
        self.assertEqual(actual, {'current:M1': {'completed': 3, 'total': 4},
                                  'current:M2': {'completed': 0, 'total': 1}})
        self.assertEqual(actual, {card['id']: {k: card['ksbProgress'][k] for k in ('completed', 'total')}
                                  for card in learner['modules']})

    def test_imported_chart_uses_owned_material_and_quiz_points_from_the_same_learner_card(self):
        with self.catalogue(historical=True):
            result = employer_performance.module_ksbs(SimpleNamespace(pk=7), 'apprenticeship', {'id': 9}, [
                {'id': 'legacy:50', 'moduleId': 'M1'}, {'id': 'current:M2', 'moduleId': 'M2'}])
        self.assertEqual(result['legacy:50'], {'completed': 1, 'total': 3})
        self.assertEqual(result['current:M2'], {'completed': 0, 'total': 1})

    def test_hidden_free_course_does_not_supply_chart_points(self):
        with self.catalogue(free_ids=['M1']):
            result = employer_performance.module_ksbs(SimpleNamespace(pk=7), 'commercial', {'id': 9}, [
                {'id': 'current:M1', 'moduleId': 'M1'}, {'id': 'current:M2', 'moduleId': 'M2'}])
        self.assertIsNone(result['current:M1'])
        self.assertEqual(result['current:M2'], {'completed': 0, 'total': 1})

    def test_identity_matching_does_not_borrow_same_title_or_ambiguous_module_points(self):
        cards = [
            {'id': 'legacy:50', 'moduleId': 'M1', 'ksbProgress': {'status': 'ready', 'completed': 1, 'total': 3}},
            {'id': 'current:M1', 'moduleId': 'M1', 'ksbProgress': {'status': 'ready', 'completed': 0, 'total': 2}},
        ]
        with patch.object(my_learning, 'read_catalogue', return_value={'modules': cards}):
            result = employer_performance.module_ksbs(SimpleNamespace(pk=7), 'commercial', {'id': 9}, [
                {'id': 'legacy:50', 'moduleId': 'M1'}, {'id': 'legacy:other', 'moduleId': 'M1'},
                {'id': 'legacy:unlinked', 'title': 'One'}, {'id': 'current:foreign', 'moduleId': 'FOREIGN'}])
        self.assertEqual(result, {'legacy:50': {'completed': 1, 'total': 3},
                                  'legacy:other': None, 'legacy:unlinked': None, 'current:foreign': None})

    def test_single_explicit_module_link_resolves_different_overview_identity(self):
        with self.catalogue(historical=True):
            result = employer_performance.module_ksbs(SimpleNamespace(pk=7), 'commercial', {'id': 9}, [
                {'id': 'legacy:overview', 'moduleId': 'M1'}])
        self.assertEqual(result['legacy:overview'], {'completed': 1, 'total': 3})

    def test_unavailable_and_empty_mappings_never_fall_back_to_completed_ledger_points(self):
        cards = [dict(id='current:M1', ksbProgress={'status': 'unavailable', 'completed': None, 'total': None}),
                 dict(id='current:M2', ksbProgress={'status': 'empty', 'completed': 0, 'total': 0})]
        with patch.object(my_learning, 'read_catalogue', return_value={'modules': cards}):
            result = employer_performance.module_ksbs(SimpleNamespace(pk=7), 'commercial', {'id': 9}, [
                {'id': 'current:M1', 'moduleId': 'M1'}, {'id': 'current:M2', 'moduleId': 'M2'}])
        self.assertEqual(result, {'current:M1': None, 'current:M2': {'completed': 0, 'total': 0}})

    def test_empty_chart_skips_catalogue_and_uses_separate_request_caches(self):
        source = SimpleNamespace(pk=7, _plan_preset_cache={'existing': True})
        with patch.object(my_learning, 'read_catalogue', return_value={'modules': []}) as read:
            self.assertEqual(employer_performance.module_ksbs(source, 'commercial', {'id': 9}, []), {})
            read.assert_not_called()
            employer_performance.module_ksbs(source, 'commercial', {'id': 9}, [{'id': 'current:M1'}])
        self.assertIsNot(read.call_args.args[0], source)
        self.assertEqual(read.call_args.args[1:], ('commercial', {'id': 9}))
        self.assertEqual(read.call_args.kwargs, {'ksb_only': True})

    def test_opted_in_employer_overview_attaches_my_learning_points_and_preserves_other_facts(self):
        from .test_employer_learning_no_db import EmployerLearningParityTests

        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), EmployerLearningParityTests().fixture(planned=100) as (source, *_), \
                    patch.object(dashboard_overview, 'saved_attendance_hours', return_value=[]):
                baseline = employer_learning.read_dashboard(deepcopy(source), kind, 'overview', RequestFactory().get('/'))
                with self.catalogue():
                    actual = employer_learning.read_dashboard(deepcopy(source), kind, 'overview',
                        RequestFactory().get('/', {'performance': '1'}))
            self.assertEqual([row['ksb'] for row in actual['modules']], [
                {'completed': 3, 'total': 4}, {'completed': 0, 'total': 1}])
            for row, original in zip(actual['modules'], baseline['modules']):
                row.pop('assignments')
                row['ksb'] = original['ksb']
            self.assertEqual(actual, baseline)
