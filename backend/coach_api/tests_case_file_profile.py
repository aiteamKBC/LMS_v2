"""Compact profile contract and source-loading regressions; no database access."""
import json
from contextlib import ExitStack
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from .case_file import CaseFileContext, PROFILE_FIELDS, PROFILE_SOURCE_FIELDS, case_file_section
from .serializers.case_file_profile import serialize_case_file_profile


class CaseFileProfileTests(SimpleTestCase):
    def profile(self, **values):
        return SimpleNamespace(**{
            'id': 101, 'enrolment_id': 201, 'aptem_id': 9001, 'learner_type': 'apprenticeship',
            'full_name': 'Synthetic Learner', 'email': 'learner@example.test',
            'programme': 'Synthetic Programme', 'group_name': 'Synthetic Group',
            'programme_status': 'Active', **values,
        })

    def source(self, **values):
        return SimpleNamespace(**{
            'id': 201, 'aptem_id': '9001', 'learner_type': 'apprenticeship',
            'username': 'Source Learner', 'email': 'source@example.test',
            'programme': 'Source Programme', 'group': 'Source Group', 'employer': 'Synthetic Employer',
            'programme_status': 'Completed', 'learner_start_date': '2026-01-01',
            'learner_end_date': '2027-01-01', **values,
        })

    def request(self):
        request = RequestFactory().get('/coach_api/coach/case-file/101/profile')
        request.coach_email = 'coach@example.test'
        return request

    def test_exact_approved_contract_and_employer(self):
        payload = serialize_case_file_profile(self.profile(), self.source())
        self.assertEqual(payload, {'learner': {
            'id': '101', 'name': 'Synthetic Learner', 'email': 'learner@example.test',
            'programme': 'Synthetic Programme', 'group': 'Synthetic Group',
            'employer': 'Synthetic Employer', 'status': 'Active',
            'startDate': '2026-01-01', 'plannedEndDate': '2027-01-01',
            'enrolmentId': '201', 'aptemId': '9001', 'learnerType': 'apprenticeship',
        }})
        self.assertNotIn('header', payload)
        self.assertNotIn('identity', payload)
        for field in ('learnerStartDate', 'learnerEndDate', 'cohort', 'coachName', 'coachEmail',
                      'coachRag', 'gatewayReviewDate', 'otjhProgrammeStartDate', 'otjhProgrammeEndDate'):
            self.assertNotIn(field, payload['learner'])

    def test_profile_executes_only_two_projected_source_reads_and_no_enrichment(self):
        profiles = MagicMock()
        profiles.filter.return_value.only.return_value.first.return_value = self.profile()
        sources = MagicMock()
        sources.filter.return_value.only.return_value.first.return_value = self.source()
        forbidden = (
            'coach_api.case_file.build_header_summary', 'coach_api.case_file.build_overview',
            'coach_api.case_file.build_tab', 'coach_api.case_file.canonical_learning.metrics_bulk',
            'coach_api.case_file.CaseFileContext.parallel', 'coach_api.case_file.CaseFileContext.read',
            'coach_api.case_file.CaseFileContext.learner_read',
            'coach_api.views.serialize_case_file_shell', 'coach_api.views._case_file_review_events',
            'coach_api.views._case_file_next_session',
        )
        with ExitStack() as stack:
            stack.enter_context(patch('coach_api.case_file.LearnerProfile.objects.annotate', return_value=profiles))
            stack.enter_context(patch('coach_api.case_file.EnrolmentUser.all_learners', sources))
            blocked = [stack.enter_context(patch(name, side_effect=AssertionError('Heavy profile read'))) for name in forbidden]
            response = unwrap(case_file_section)(self.request(), 101)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), serialize_case_file_profile(self.profile(), self.source()))
        profiles.filter.assert_called_once_with(id=101, coach_email_key='coach@example.test')
        self.assertEqual(set(profiles.filter.return_value.only.call_args.args), set(PROFILE_FIELDS))
        profiles.filter.return_value.only.return_value.first.assert_called_once_with()
        sources.filter.assert_called_once_with(pk=201)
        self.assertEqual(set(sources.filter.return_value.only.call_args.args), set(PROFILE_SOURCE_FIELDS))
        sources.filter.return_value.only.return_value.first.assert_called_once_with()
        for reader in blocked:
            reader.assert_not_called()

    def test_missing_or_unowned_profile_does_not_read_source(self):
        profiles = MagicMock()
        profiles.filter.return_value.only.return_value.first.return_value = None
        with patch('coach_api.case_file.LearnerProfile.objects.annotate', return_value=profiles), \
             patch('coach_api.case_file.EnrolmentUser.all_learners') as sources:
            response = unwrap(case_file_section)(self.request(), 101)
        self.assertEqual(response.status_code, 404)
        sources.filter.assert_not_called()

    def test_lazy_source_is_read_only_once(self):
        profiles = MagicMock()
        profiles.filter.return_value.only.return_value.first.return_value = self.profile()
        with patch('coach_api.case_file.LearnerProfile.objects.annotate', return_value=profiles), \
             patch('coach_api.case_file.EnrolmentUser.all_learners') as sources:
            sources.filter.return_value.only.return_value.first.return_value = self.source()
            context = CaseFileContext(self.request(), 101, profile_only=True)
            self.assertIs(context.source, context.source)
        sources.filter.assert_called_once_with(pk=201)

    def test_identity_matches_legacy_resolution_for_both_learner_types(self):
        from .serializers.learner_profile import serialize_learner_profile_shell
        from .views import clean_text, format_date, student_activity_available, format_coach_rag_value
        for kind in ('commercial', 'apprenticeship'):
            for source_id, profile_id in (('9001', 9001), ('9002', 9001), (None, 9001), ('9001', None), (None, None)):
                with self.subTest(kind=kind, source_id=source_id, profile_id=profile_id):
                    profile = self.profile(aptem_id=profile_id)
                    source = self.source(learner_type=kind, aptem_id=source_id)
                    legacy = serialize_learner_profile_shell(profile, source, canonical_start_date='2026-01-01',
                        clean_text=clean_text, format_date=format_date, student_activity_available=student_activity_available,
                        format_coach_rag_value=format_coach_rag_value)
                    learner = serialize_case_file_profile(profile, source)['learner']
                    self.assertEqual(learner['aptemId'], legacy['identity']['aptemId'])
                    self.assertEqual(learner['learnerType'], legacy['identity']['kind'])
                    self.assertEqual(learner['enrolmentId'], legacy['identity']['enrolmentId'])

    def test_header_dates_preserve_recorded_values_instead_of_programme_window(self):
        from .views import serialize_case_file_shell
        source = self.source(start_date='2020-01-01', end_date='2030-01-01',
                             learner_start_date=' 2026-01-01 ', learner_end_date='2027-01-01')
        profile = self.profile(start_date='2021-01-01', end_date='2031-01-01')
        old = serialize_case_file_shell(profile, source)['profile']
        new = serialize_case_file_profile(profile, source)['learner']
        self.assertEqual(new['startDate'], old['startDate'])
        self.assertEqual(new['plannedEndDate'], old['learnerEndDate'])

    def test_missing_source_preserves_nulls_and_profile_fallbacks(self):
        learner = serialize_case_file_profile(self.profile(enrolment_id=None), None)['learner']
        self.assertIsNone(learner['enrolmentId'])
        self.assertIsNone(learner['employer'])
        self.assertIsNone(learner['startDate'])
        self.assertIsNone(learner['plannedEndDate'])
        self.assertEqual(learner['programme'], 'Synthetic Programme')

    def test_no_header_date_fallback_or_invalid_start_date_repair(self):
        for value in (None, '', ' ', '2026-02-30', '2026-01-01invalid'):
            with self.subTest(value=value):
                learner = serialize_case_file_profile(self.profile(), self.source(learner_start_date=value,
                                                     learner_end_date=None))['learner']
                self.assertIsNone(learner['startDate'])
                self.assertIsNone(learner['plannedEndDate'])

    def test_source_text_fallbacks_and_whitespace_match_legacy(self):
        profile = self.profile(full_name='', email=None, programme=None, group_name=None, programme_status=None)
        learner = serialize_case_file_profile(profile, self.source(employer=' Synthetic Employer '))['learner']
        self.assertEqual(learner['name'], 'Source Learner')
        self.assertEqual(learner['email'], 'source@example.test')
        self.assertEqual(learner['programme'], 'Source Programme')
        self.assertEqual(learner['group'], 'Source Group')
        self.assertEqual(learner['status'], 'Completed')
        self.assertEqual(learner['employer'], 'Synthetic Employer')

    def test_profile_authentication_gate_remains_enabled(self):
        from django.test import override_settings
        with override_settings(AUTH_REQUIRED=True), patch('coach_api.case_file.CaseFileContext') as context:
            response = self.client.get('/coach_api/coach/case-file/101/profile')
        self.assertIn(response.status_code, (401, 403))
        context.assert_not_called()

    def test_canonical_metrics_and_window_load_only_in_owning_progress_section(self):
        from .case_file import build_tab
        context = MagicMock(profile=self.profile(), source=self.source(start_date='2020-01-01',
                                                                     end_date='2030-01-01'))
        context.parallel.side_effect = lambda readers: {name: read() for name, read in readers.items()}
        context.payload.side_effect = lambda resource: {
            'schedule': {'modules': []}, 'week': {}, 'hours': {'months': []},
        }[resource]
        metrics = {'programme': {'percent': 50}, 'otjh': {'actual': 12, 'planned': 100},
                   'ksb': {'percent': 25, 'points': ['deferred'], 'codes': ['deferred']}}
        with patch('coach_api.case_file.canonical_learning.metrics_bulk', return_value={201: metrics}) as read, \
             patch('learner_api.aptem_ksb_breakdown.read_breakdown', return_value={'rows': []}), \
             patch('coach_api.case_file.build_header_summary', side_effect=AssertionError('Unrelated header reads')) as header:
            result = build_tab(context, 'otjh-ksb')
        read.assert_called_once_with([201], learner_workspace=True, include_ksb_points=False)
        header.assert_not_called()
        self.assertEqual(result['metrics']['otjh'], metrics['otjh'])
        self.assertEqual(result['metrics']['ksb'], {'percent': 25})
        self.assertEqual(result['programmeWindow'], {'startDate': '01 Jan 2020', 'plannedEndDate': '01 Jan 2030'})

    def test_progress_metrics_failure_preserves_available_breakdown_and_visible_error(self):
        from .case_file import build_tab
        context = MagicMock(profile=self.profile(), source=self.source())
        context.parallel.side_effect = lambda readers: {name: read() for name, read in readers.items()}
        context.payload.side_effect = lambda resource: {'schedule': {'modules': []}, 'week': {},
                                                       'hours': {'months': []}}[resource]
        with patch('coach_api.case_file.canonical_learning.metrics_bulk', side_effect=ValueError('Synthetic failure')), \
             patch('learner_api.aptem_ksb_breakdown.read_breakdown', return_value={'rows': [], 'achievedKsbs': 1}), \
             patch('coach_api.case_file.log.exception'):
            result = build_tab(context, 'otjh-ksb')
        self.assertIsNone(result['metrics'])
        self.assertEqual(result['errors'], {'metrics': 'Programme totals are unavailable.'})
        self.assertEqual(result['breakdown']['achievedKsbs'], 1)
