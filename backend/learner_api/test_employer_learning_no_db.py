"""Employer parity against real learner readers with synthetic storage facts."""
from contextlib import contextmanager, ExitStack
from copy import deepcopy
from datetime import date
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory

from . import (canonical_learning as canonical, dashboard_tabs, dashboard_overview,
               dashboard_training, employer_learning, employer_portal, learning_plan,
               identity, overview_week, training_plan_dashboard as schedule)
from .journal_sources import learner_journal_reads, enabled
from old_otjh.service import ServiceError


class EmployerLearningParityTests(SimpleTestCase):
    @contextmanager
    def fixture(self, plan=None, planned=None, today=date(2026, 10, 15), imported=False):
        owner = {'id': 17, 'enrolment_id': 265, 'start_date': date(2026, 9, 1), 'end_date': date(2026, 11, 30)}
        source = SimpleNamespace(id=265, pk=265, employer_id=9, programme='Synthetic programme', group='G1',
                                 email='learner@example.test', training_plan=plan, learning_plan=None,
                                 start_date=owner['start_date'], end_date=owner['end_date'])
        profile = SimpleNamespace(pk=17, enrolment_id=265)
        module_data = {mid: {'id': mid, 'title': mid, 'start_date': '2027-01-01', 'end_date': '2027-12-31',
                            'total_otjh': hours, 'educational_session_count': 0}
                       for mid, hours in (('M1', 40), ('M2', 60))}
        records = [{'id': 1, 'kind': 'component', 'module_ref': 'M1', 'component_ref': 'C1',
                    'accepted': True, 'completed': True, 'reporting_month': '2026-10', 'actual_seconds': 3600, 'ksbs': []}]

        def facts(*_args, **_kwargs):
            ids = learning_plan._effective_plan_ids(source, {})
            native = {'components': [dict(componentId=cid, moduleId=mid, module=mid, type='reading')
                       for mid, cid in (('M1', 'C1'), ('M1', 'C2'), ('M2', 'C3')) if mid in ids],
                      # Repeated completion must not count twice; C2/C3 are unstarted.
                      'componentProgress': [{'componentId': 'C1', 'kind': 'component', 'passed': True}] * 2,
                      'videoProgress': [], 'quizAttempts': []}
            activity = None
            if imported:
                activity = {'subjects': [{'id': 8, 'name': 'Imported module', 'module_id': 'M1'}],
                            'activities': [{'group_id': 8, 'activity_id': 9, 'completed': True},
                                           {'group_id': 8, 'activity_id': 9, 'completed': True}],
                            'activity_sources': {}}
            return {'activity': activity, 'detail': native,
                    'metadata': {'current_subjects': [{'id': mid, 'title': mid} for mid in ids],
                                 'builder_subjects': {}, 'activity_dates': {}}}

        def metrics(*_args, **_kwargs):
            result = canonical.metrics_from_records(records, {})
            result['otjh']['planned'] = planned  # persisted programme field, including explicit zero
            return {source.pk: result}

        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = (100,)
        connection = SimpleNamespace(cursor=lambda: cursor)
        with ExitStack() as stack:
            for target, value in (
                ('learner_api.canonical_learning.require_profile', owner),
                ('learner_api.identity.learner_profile_for_source', profile),
                ('learner_api.learning_plan._preset_ids_for', ['M1', 'M2']),
                ('learner_api.canonical_learning.curriculum_module_ids_for', []),
                ('learner_api.training_plan_dashboard.builder_subject_links', {}),
                ('learner_api.canonical_learning.entries_for', records),
                ('learner_api.canonical_learning.targets_for', {}),
                ('learner_api.canonical_learning.query', []),
                ('learner_api.training_plan_dashboard._plan_session_rows', []),
                ('learner_api.training_plan_dashboard.plan_reviews', []),
                ('learner_api.training_plan_dashboard.current_coach', {'coach_name': 'Coach', 'coach_email': ''}),
                ('learner_api.overview_week.read_week', {}),
                ('learner_api.attendance_lectures.lecture_register', []),
                ('learner_api.attendance._summarize_attendance', None),
                ('django.utils.timezone.localdate', today),
            ):
                stack.enter_context(patch(target, return_value=value))
            stack.enter_context(patch.object(schedule, 'connections', {'enrolment': connection}))
            stack.enter_context(patch.object(dashboard_overview, 'connections', {'enrolment': connection}))
            stack.enter_context(patch.object(dashboard_training, 'connections', {'enrolment': connection}))
            for target in ('learner_api.dashboard_overview.module_rows', 'learner_api.dashboard_training.module_rows'):
                stack.enter_context(patch(target, side_effect=lambda cur, ids: {mid: module_data[mid] for mid in ids}))
            stack.enter_context(patch.object(canonical, 'metrics_bulk', side_effect=metrics))
            stack.enter_context(patch.object(dashboard_tabs, 'learning_projection', side_effect=facts))
            stack.enter_context(patch.object(dashboard_training, 'learning_facts',
                side_effect=lambda *a, **kw: (dashboard_overview.overview_subjects(facts()), facts()['detail'])))
            yield source, owner, profile

    def compare(self, source, tab):
        request = RequestFactory().get('/employer/', {'month': '2026-10'})
        with learner_journal_reads():
            baseline = dashboard_tabs.read_tab(deepcopy(source), 'commercial', tab, request)
        actual = employer_learning.read_dashboard(deepcopy(source), 'commercial', tab, request)
        self.assertEqual(actual, baseline)
        self.assertFalse(enabled())
        return actual

    def test_null_explicit_additive_and_explicitly_empty_assignments_match_both_learner_tabs(self):
        for plan, ids in ((None, ['M1', 'M2']), ([], []),
                          ([{'moduleId': 'M1', 'assignmentMode': 'explicit'}], ['M1']),
                          ([{'moduleId': 'M1'}], ['M1', 'M2'])):
            with self.subTest(plan=plan), self.fixture(plan=plan) as (source, *_):
                overview = self.compare(source, 'overview')
                training = self.compare(source, 'training')
                self.assertEqual([m['id'] for m in overview['programme']], ['current:' + mid for mid in ids])
                self.assertEqual([m['moduleId'] for m in training['timeline']['modules']], ids)

    def test_unstarted_content_and_duplicate_completion_use_assigned_denominators(self):
        with self.fixture() as (source, *_):
            overview = self.compare(source, 'overview')
            self.assertEqual([m['percent'] for m in overview['programme']], [50, 0])
            self.assertEqual(overview['metrics']['otjh']['actual'], 1)
            self.assertEqual(overview['hours']['months'][0]['completed'], 1)

    def test_imported_catalogue_and_native_content_keep_the_learner_population(self):
        with self.fixture(imported=True) as (source, *_):
            result = self.compare(source, 'overview')
            self.assertEqual(len(result['programme']), 3)
            self.assertEqual(next(m['percent'] for m in result['programme'] if m['id'] == 'legacy:8'), 100)

    def test_null_and_explicit_zero_follow_existing_fallback_and_fixed_programme_boundaries(self):
        for planned in (None, 0, 80):
            for today in (date(2026, 8, 31), date(2026, 9, 1), date(2026, 10, 15), date(2026, 11, 30), date(2026, 12, 1)):
                with self.subTest(planned=planned, today=today), self.fixture(planned=planned, today=today) as (source, *_):
                    with patch.object(schedule, 'plan_planned_hours', wraps=schedule.plan_planned_hours) as fallback:
                        result = self.compare(source, 'overview')
                    self.assertEqual(fallback.call_count, 2 if planned is None else 0)
                    if planned == 0:
                        self.assertIsNone(result['metrics']['otjh']['targetToDate'])
                    if planned is None and today == date(2026, 11, 30):
                        self.assertEqual(result['metrics']['otjh']['targetToDate'], 100)

    def test_wrong_profile_or_enrolment_fails_before_reading_learning_facts(self):
        for profile in (None, SimpleNamespace(pk=18, enrolment_id=265), SimpleNamespace(pk=17, enrolment_id=266)):
            for tab in ('overview', 'training'):
                with self.subTest(profile=profile, tab=tab), self.fixture() as (source, *_):
                    with patch.object(identity, 'learner_profile_for_source', return_value=profile), patch.object(canonical, 'entries_for') as entries:
                        with self.assertRaises(ServiceError):
                            employer_learning.read_dashboard(source, 'commercial', tab, RequestFactory().get('/'))
                        entries.assert_not_called()
                self.assertFalse(enabled())

    def test_action_links_are_removed_without_mutating_learner_results(self):
        baseline = {'timeline': {'reviews': [{'meetingLink': 'private', 'status': 'scheduled'}]},
                    'selectedModule': {'sessions': [{'joinUrl': 'private'}], 'actual': 1}, 'bookingUrl': 'private'}
        before = deepcopy(baseline)
        with patch.object(dashboard_tabs, 'read_tab', return_value=baseline):
            result = employer_learning.read_dashboard(object(), 'commercial', 'training', object())
        self.assertEqual(baseline, before)
        self.assertIsNone(result['timeline']['reviews'][0]['meetingLink'])
        self.assertIsNone(result['selectedModule']['sessions'][0]['joinUrl'])
        self.assertEqual(result['selectedModule']['actual'], 1)

    def test_header_schedule_receives_verified_owner_and_learner_perspective(self):
        source = SimpleNamespace(pk=265)
        owner = {'id': 17, 'enrolment_id': 265}
        profile = SimpleNamespace(pk=17, enrolment_id=265)
        def read(prepared, *, section):
            self.assertTrue(enabled())
            self.assertIs(prepared._canonical_profile, owner)
            self.assertIs(prepared._case_file_profile, profile)
            self.assertEqual(section, 'overview')
            return {'modules': [{'id': 'imported-module'}], 'sessions': [{'joinUrl': 'private'}]}
        with patch.object(canonical, 'require_profile', return_value=owner), \
                patch.object(employer_learning, 'learner_profile_for_source', return_value=profile) as lookup, \
                patch.object(schedule, 'read_dashboard', side_effect=read):
            result = employer_learning.read_schedule(source, 'overview')
        lookup.assert_called_once_with(source, 265, heal=False)
        self.assertEqual(result['modules'], [{'id': 'imported-module'}])
        self.assertIsNone(result['sessions'][0]['joinUrl'])
        self.assertFalse(enabled())


class EmployerLearningSecurityTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=265, employer_id=9)
        self.account = SimpleNamespace(role='employer', subject_id=9)
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.enterContext(patch('login.permissions.authenticate_request', side_effect=lambda req: self.account))
        self.enterContext(patch.object(employer_portal, '_employer_or_404', return_value=(SimpleNamespace(pk=9), None)))
        class Missing(Exception):
            pass
        def get(pk):
            if pk != 265:
                raise Missing()
            return self.source
        model = SimpleNamespace(all_learners=SimpleNamespace(get=get), DoesNotExist=Missing)
        self.enterContext(patch.object(employer_portal, 'SOURCE_MODELS', {'commercial': model, 'apprenticeship': model}))

    def response(self, part, employer=9, learner=265, kind='commercial', method='get'):
        request = getattr(RequestFactory(), method)('/employer/')
        if part == 'plan':
            return employer_portal.employer_portal_learner_plan(request, employer_id=employer, kind=kind, learner_id=learner)
        return employer_portal.employer_portal_learner_overview(request, employer_id=employer, kind=kind, learner_id=learner, part=part)

    def test_authenticated_employer_staff_and_both_learner_types(self):
        with patch.object(employer_learning, 'read_dashboard', return_value={}), patch.object(employer_learning, 'read_plan', return_value={}):
            for role in ('employer', 'staff', 'admin'):
                self.account = SimpleNamespace(role=role, subject_id=9)
                for kind in ('commercial', 'apprenticeship'):
                    for part in ('dashboard', 'training', 'plan'):
                        response = self.response(part, kind=kind)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_wrong_employer_other_enrolment_and_writes_never_resolve_data(self):
        with patch.object(employer_learning, 'read_dashboard') as read, patch.object(employer_learning, 'read_plan') as plan:
            for part in ('dashboard', 'training', 'plan'):
                for options, status in (({'employer': 10}, 404), ({'learner': 266}, 404), ({'method': 'post'}, 405), ({'kind': 'unknown'}, 404)):
                    self.assertEqual(self.response(part, **options).status_code, status)
                self.source.employer_id = 10
                self.assertEqual(self.response(part).status_code, 403)
                self.source.employer_id = 9
            read.assert_not_called()
            plan.assert_not_called()

    def test_anonymous_and_learner_roles_cannot_read(self):
        for account, status in ((None, 401), (SimpleNamespace(role='learner', subject_id=265), 403)):
            self.account = account
            with patch.object(employer_learning, 'read_dashboard') as read:
                self.assertEqual(self.response('dashboard').status_code, status)
                read.assert_not_called()

    def test_plan_uses_non_healing_identity_and_never_calls_write_capable_helpers(self):
        from . import learner_detail, weekly_learning, mappers
        profile = SimpleNamespace(pk=17, enrolment_id=265)
        content = {'modules': ['M1'], 'week': [], 'components': [], 'retiredQuizComponents': []}
        with ExitStack() as stack:
            forbidden = [stack.enter_context(patch.object(learner_detail, name, side_effect=AssertionError(name)))
                         for name in ('build_learner_detail', 'advance_learner', 'hydrate_source_training_plan', 'persist_live_otjh_snapshot')]
            stack.enter_context(patch.object(canonical, 'require_profile', return_value={'id': 17}))
            lookup = stack.enter_context(patch.object(employer_learning, 'learner_profile_for_source', return_value=profile))
            stack.enter_context(patch.object(mappers, 'to_learner_detail', return_value={'id': '265'}))
            stack.enter_context(patch.object(weekly_learning, 'build_learning_content_summary', return_value=content))
            stack.enter_context(patch.object(learner_detail, '_annotate_otjh', return_value=([], 0)))
            stack.enter_context(patch.object(learner_detail, '_live_otjh_snapshot', return_value={}))
            stack.enter_context(patch.object(learner_detail, '_apply_live_otjh_snapshot'))
            response = self.response('plan')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(json.loads(response.content)['modules'], ['M1'])
            lookup.assert_called_once_with(self.source, 265, heal=False)
            for call in forbidden:
                call.assert_not_called()
