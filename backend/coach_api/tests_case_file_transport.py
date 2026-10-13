import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from .case_file import CaseFileContext, case_file_section, project_attendance, project_month_focus


class CaseFileTransportTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, path):
        request = self.factory.get(path)
        request.coach_email = 'coach@example.test'
        return request

    def test_context_queries_stable_profile_and_authenticated_coach_only(self):
        query = MagicMock()
        query.filter.return_value.only.return_value.first.return_value = SimpleNamespace(id=101, enrolment_id=201, learner_type='commercial')
        with patch('coach_api.case_file.LearnerProfile.objects.annotate', return_value=query):
            context = CaseFileContext(self.request('/coach_api/coach/case-file/101/overview'), 101)
        query.filter.assert_called_once_with(id=101, coach_email_key='coach@example.test')
        self.assertEqual(context.profile.enrolment_id, 201)

    def test_unknown_or_other_coach_learner_never_calls_underlying_reader(self):
        context = MagicMock(profile=None)
        for section in ('attendance', 'otjh-ksb', 'ksb-search', 'ksb-detail'):
            with self.subTest(section=section), patch('coach_api.case_file.CaseFileContext', return_value=context), \
                 patch('coach_api.otjh_ksb.read_otjh_ksb') as projection, \
                 patch('coach_api.otjh_ksb.search_ksb_activities') as search:
                response = unwrap(case_file_section)(self.request('/'), 101, section=section)
            self.assertEqual(response.status_code, 404)
            projection.assert_not_called()
            search.assert_not_called()
        context.learner_read.assert_not_called()

    def test_historical_assessments_keep_coach_and_pilot_scope(self):
        request = self.request('/coach_api/coach/case-file/101/assignments?resource=historical')
        request.GET = request.GET.copy()
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201, aptem_id=301))
        context.kind = 'commercial'
        with patch('coach_api.case_file.CaseFileContext', return_value=context), \
             patch('login.models.AdvancedAdminLearnerScope.objects') as scope, \
             patch('learner_api.legacy_assignments.classified_rows') as source:
            scope.filter.return_value.exists.return_value = False
            response = unwrap(case_file_section)(request, 101, section='assignments')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'items': []})
        source.assert_not_called()

    def test_historical_assessments_show_lms_reviews_with_original_feedback(self):
        request = self.request('/coach_api/coach/case-file/101/assignments?resource=historical')
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201, aptem_id=301))
        context.kind = 'commercial'
        row = {'evidence_id': 7, 'evidence_name': 'Assessment', 'activity_date': None,
               'evidence_status': 'Accepted'}
        review = {'decision': 'referred', 'feedback': 'Add detail.', 'reviewedBy': 'Assessor',
                  'reviewedAt': '2026-10-08T10:00:00+00:00'}
        with patch('coach_api.case_file.CaseFileContext', return_value=context), \
             patch('login.models.AdvancedAdminLearnerScope.objects') as scope, \
             patch('learner_api.legacy_assignments.classified_rows', return_value=[row]), \
             patch('learner_api.legacy_assignments.classified_submission',
                   return_value={'legacyAssignment': {'feedbacks': [{'message': 'Original'}]}}), \
             patch('learner_api.legacy_marking.reviews_for_evidence', return_value={7: [review]}):
            scope.filter.return_value.exists.return_value = True
            response = unwrap(case_file_section)(request, 101, section='assignments')
        item = json.loads(response.content)['items'][0]
        self.assertEqual(item['originalFeedback'][0]['message'], 'Original')
        self.assertEqual(item['lmsReviews'], [review])

    def test_section_does_not_accept_arbitrary_resource_or_upstream_url(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        with patch('coach_api.case_file.CaseFileContext', return_value=context):
            response = unwrap(case_file_section)(self.request('/?resource=https://example.test'), 101, section='attendance')
        self.assertEqual(response.status_code, 400)
        context.learner_read.assert_not_called()

    def test_attendance_summary_preserves_counts_without_history(self):
        payload = {'attendance': {'sessions': 2, 'present': 1, 'absent': 1, 'attendanceRate': 50, 'sessionHistory': [{'id': 'synthetic'}]}}
        response = project_attendance(JsonResponse(payload))
        self.assertEqual(json.loads(response.content)['attendance'], {'sessions': 2, 'present': 1, 'absent': 1, 'attendanceRate': 50})
        self.assertEqual(json.loads(project_attendance(JsonResponse(payload), history=True).content), payload)

    def test_month_focus_keeps_selected_canonical_rows_and_date_precedence(self):
        payload = {'months': {'2026-09': {'planned': 10}, '2026-10': {'planned': 20}},
                   'actual': [{'month': '2026-09', 'hours': 7}, {'month': '2026-10', 'hours': 3}],
                   'actualAvailable': True,
                   'reviews': [{'id': 'selected', 'scheduledDate': '2026-09-12', 'targetDate': '2026-10-12'},
                               {'id': 'other', 'scheduledDate': '2026-10-12', 'targetDate': '2026-09-12'}],
                   'snapshot_digest': 'unused', 'signatures': ['unused']}
        result = json.loads(project_month_focus(JsonResponse(payload), '2026-09').content)
        self.assertEqual(result['months'], {'2026-09': {'planned': 10}})
        self.assertEqual(result['actual'], [{'month': '2026-09', 'hours': 7}])
        self.assertEqual([row['id'] for row in result['reviews']], ['selected'])
        self.assertNotIn('signatures', result)

    def test_month_focus_rejects_missing_or_invalid_month_before_source_read(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        with patch('coach_api.case_file.CaseFileContext', return_value=context):
            for month in ('', '2026-13', '2026-09-01'):
                response = unwrap(case_file_section)(self.request(f'/?month={month}'), 101, section='monthly-focus')
                self.assertEqual(response.status_code, 400)
        context.learner_read.assert_not_called()

    def test_module_detail_is_limited_to_modules_in_the_owned_learner_plan(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        module = {'id': 'M1', 'description': 'Synthetic description', 'learning_outcomes': ['Synthetic outcome']}
        context.learner_read.return_value = JsonResponse({'modules': [module], 'reviews': []})
        with patch('coach_api.case_file.CaseFileContext', return_value=context):
            found = unwrap(case_file_section)(self.request('/?resource=module&moduleId=M1'), 101, section='learning-plan')
            other = unwrap(case_file_section)(self.request('/?resource=module&moduleId=M2'), 101, section='learning-plan')
        self.assertEqual(json.loads(found.content), {'module': module})
        self.assertEqual(other.status_code, 404)

    def test_schedule_keeps_timeline_metadata_but_defers_module_description_and_outcomes(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        context.learner_read.return_value = JsonResponse({'modules': [{'id': 'M1', 'description': 'Deferred',
            'learning_outcomes': ['Deferred'], 'effectiveEndDate': '2026-10-12', 'curriculumSlots': [{'date': '2026-10-12'}]}]})
        with patch('coach_api.case_file.CaseFileContext', return_value=context):
            response = unwrap(case_file_section)(self.request('/?resource=schedule'), 101, section='learning-plan')
        module = json.loads(response.content)['modules'][0]
        self.assertNotIn('description', module)
        self.assertNotIn('learning_outcomes', module)
        self.assertEqual(module['effectiveEndDate'], '2026-10-12')
        self.assertEqual(module['curriculumSlots'], [{'date': '2026-10-12'}])

    def test_otjh_section_rejects_legacy_overfetch_resources(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        for resource in ('breakdown', 'schedule', 'week', 'hours', 'metrics'):
            with self.subTest(resource=resource), patch('coach_api.case_file.CaseFileContext', return_value=context):
                response = unwrap(case_file_section)(self.request('/?resource=' + resource), 101, section='otjh-ksb')
            self.assertEqual(response.status_code, 400)
        context.learner_read.assert_not_called()

    def test_header_preserves_learner_metrics_perspective_without_evidence_points(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201, learner_type='apprenticeship'))
        context.parallel.side_effect = lambda readers: {name: reader() for name, reader in readers.items()}
        context.learner_read.return_value = JsonResponse({'attendance': None})
        metrics = {'otjh': {'actual': 12, 'planned': 100}, 'programme': {'percent': 50}, 'ksb': {'percent': 50, 'points': ['unused'], 'codes': ['unused']}, '_ksb_evidence_sources': ['internal']}
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('coach_api.case_file.canonical_learning.metrics_bulk', return_value={201: metrics}) as read, patch('coach_api.views._case_file_next_session', return_value=None), patch('coach_api.views._case_file_review_events', return_value=([], [])):
            response = unwrap(case_file_section)(self.request('/'), 101, section='header-summary')
        read.assert_called_once_with([201], learner_workspace=True, include_ksb_points=False)
        result = json.loads(response.content)['metrics']
        self.assertEqual(result['otjh'], {'actual': 12, 'planned': 100})
        self.assertEqual(result['ksb'], {'percent': 50})
        self.assertNotIn('_ksb_evidence_sources', result)

    def test_review_rows_keep_distinct_display_dates_but_strip_raw_status_and_answers(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        event = {'id': 'synthetic', 'learnerId': '101', 'status': 'scheduled',
                 'targetDate': '2026-09-12', 'scheduledDate': '2026-10-12',
                 'reviewCompletedAt': None, 'rawStatus': 'source-only', 'reviewResponses': {'unused': 'unused'}}
        context.read.return_value = JsonResponse({'events': [event], 'reviewGenerationIssues': []})
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('coach_api.case_file_reviews.review_events', return_value=([event], [])):
            response = unwrap(case_file_section)(self.request('/?resource=rows'), 101, section='reviews')
        row = json.loads(response.content)['reviews'][0]
        self.assertEqual(row['plannedDate'], '2026-09-12')
        self.assertEqual(row['scheduledDate'], '2026-10-12')
        self.assertNotIn('rawStatus', row)
        self.assertNotIn('reviewResponses', row)

    def test_detail_reader_uses_bound_ksb_code_and_enrolment_identity(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('learner_api.aptem_ksb_breakdown.read_learner_breakdown', return_value={'rows': []}) as read:
            response = unwrap(case_file_section)(self.request('/?code=K1'), 101, section='ksb-detail')
        self.assertEqual(read.call_args.kwargs, {'code': 'K1'})
        self.assertEqual(read.call_args.args[1], 201)
        self.assertEqual(response.status_code, 404)

    def test_detail_cannot_fall_back_to_loading_all_ksb_evidence_without_a_code(self):
        context = MagicMock(profile=SimpleNamespace(id=101, enrolment_id=201))
        with patch('coach_api.case_file.CaseFileContext', return_value=context), patch('learner_api.aptem_ksb_breakdown.read_learner_breakdown') as read:
            response = unwrap(case_file_section)(self.request('/'), 101, section='ksb-detail')
        self.assertEqual(response.status_code, 400)
        read.assert_not_called()

    def test_unauthenticated_semantic_endpoints_are_rejected(self):
        for section in ('profile', 'header-summary', 'attendance', 'reviews', 'otjh-ksb', 'ksb-search', 'ksbs/K1'):
            with self.subTest(section=section):
                response = self.client.get(f'/coach_api/coach/case-file/101/{section}')
                self.assertIn(response.status_code, (401, 403))


class CaseFileAggregationTests(SimpleTestCase):
    def test_overview_returns_only_final_chart_contract(self):
        from .case_file import build_overview
        context = MagicMock(profile=SimpleNamespace(enrolment_id=201, aptem_id=None),
                            source=SimpleNamespace(start_date='2026-01-01', end_date='2027-01-01'))
        context.parallel.return_value = {
            'learning': ({'programme': {'completed': 1, 'total': 2, 'percent': 50}, 'otjh': {'actual': 12, 'planned': 100}, 'ksb': {'completed': 1, 'total': 4, 'percent': 25, 'points': ['private']}}, None),
            'attendance': {'present': 1, 'sessions': 2, 'sessionHistory': ['private']},
            'progress': [
                {'id': 'legacy:1', 'source': 'legacy', 'title': 'Old', 'total': 2, 'completed': 1, 'percent': 50, 'dates': [], 'directHours': None},
                {'id': 'current:M1', 'source': 'current', 'title': 'New', 'total': 2, 'completed': 2, 'percent': 100, 'dates': [], 'directHours': 3},
            ],
            'schedule': {'moduleLinks': {'legacy:1': {'id': 'M1', 'title': 'Verified title'}}, 'modules': [], 'sessions': [], 'actual': [], 'reviews': ['private']},
        }
        result = build_overview(context)
        self.assertEqual(set(result), {'wholeProgrammeProgress', 'programmeProgress'})
        self.assertEqual(result['programmeProgress'], [{'id': 'legacy:1', 'title': 'Old', 'percent': 50}, {'id': 'current:M1', 'title': 'New', 'percent': 100}])
        self.assertNotIn('points', result['wholeProgrammeProgress']['ksb'])
        self.assertEqual(result['wholeProgrammeProgress']['attendance'], {'present': 1, 'sessions': 2, 'percent': 50})
        whole = result['wholeProgrammeProgress']
        self.assertEqual(set(whole), {'overall', 'attendance', 'otjh', 'ksb'})
        self.assertEqual(set(whole['otjh']), {'actual', 'targetToDate', 'planned', 'percent'})
        self.assertEqual(set(whole['overall']), {'completed', 'total', 'percent'})
        self.assertEqual(set(whole['ksb']), {'completed', 'total', 'percent'})
        self.assertEqual(whole['otjh']['planned'], 100)
        self.assertIn('targetToDate', whole['otjh'])


    def test_assignment_projection_preserves_submitted_status_and_date_precedence(self):
        from .case_file import normalize_assignments
        parts = {'detail': {'components': [
            {'componentId': 'A1', 'type': 'assignment', 'component': 'Submitted', 'module': 'M', 'week': 'W', 'sessionDate': '2026-09-01', 'html': 'private'},
            {'componentId': 'A2', 'type': 'assignment', 'component': 'Draft', 'module': 'M', 'week': 'W'},
        ], 'componentProgress': [], 'componentMarkingStatus': {}},
            'covers': {'activity_dates': {'A1': {'date': '2026-10-01', 'date_source': 'session'}}},
            'contract': {'months': {'2026-10': {'label': 'October'}}},
            'statuses': {'statuses': [{'activityType': 'assignment', 'activityId': 'A1', 'status': 'submitted', 'submissionCount': 1}]}}
        result = normalize_assignments(parts)
        self.assertEqual(len(result['months']), 1)
        row = result['months'][0]['assignments'][0]
        self.assertEqual((row['id'], row['status'], row['date']), ('A1', 'submitted', '2026-10-01'))
        self.assertNotIn('html', row)

    def test_plan_progress_preserves_stored_scores_and_uses_one_prefetched_history(self):
        from .case_file import read_plan_detail
        from datetime import datetime, timezone
        entry = SimpleNamespace(kind='quiz', module_ref='M1', module_title='Module', week_ref='W1',
            week_title='Week', component_ref='C1', component_title='Quiz', component_type='quiz',
            attempt=2, passed=True, feedback='Synthetic feedback', time_taken=60, quiz_ref='7',
            grade=.75, achieved_score=3, total_score=4, expected_otjh=1,
            started_at=None, submitted_at=datetime(2026, 9, 1, tzinfo=timezone.utc),
            ksb_links=MagicMock())
        entry.ksb_links.all.return_value = [SimpleNamespace(ksb_code='K1')]
        context = MagicMock(source=SimpleNamespace(learner_start_date='2026-01-01', learner_end_date='2027-01-01'))
        context.profile.enrolment_id = 201
        context.profile.progress_entries.only.return_value.prefetch_related.return_value = [entry]
        with patch('coach_api.case_file.read_assignment_detail', return_value={'components': []}) as detail:
            result = read_plan_detail(context)
        detail.assert_called_once_with(context, include_progress=False)
        context.profile.progress_entries.only.assert_called_once()
        context.profile.progress_entries.only.return_value.prefetch_related.assert_called_once_with('ksb_links')
        row = result['quizAttempts'][0]
        self.assertEqual((row['grade'], row['achievedScore'], row['totalScore'], row['passed']), (.75, 3, 4, True))
        self.assertEqual(row['ksbs'], ['K1'])
        self.assertNotIn('questions', row)

    def test_repository_reuses_identical_reads_and_copies_rows_only_within_request(self):
        from old_otjh import repository
        with patch('learner_api.journal_sources.retained_journal_sql', side_effect=lambda sql: sql), patch('old_otjh.repository._query_rows', return_value=[{'value': 1}]) as read:
            with repository.request_read_scope():
                first = repository.query('SELECT value WHERE id=%s', [201])
                first[0]['value'] = 999
                self.assertEqual(repository.query('SELECT value WHERE id=%s', [201]), [{'value': 1}])
                self.assertEqual(read.call_count, 1)
                repository.query('SELECT value WHERE id=%s', [202])
                self.assertEqual(read.call_count, 2)
            repository.query('SELECT value WHERE id=%s', [201])
            self.assertEqual(read.call_count, 3)

    def test_repository_never_caches_writes_and_invalidates_after_write(self):
        from old_otjh import repository
        with patch('learner_api.journal_sources.retained_journal_sql', side_effect=lambda sql: sql), patch('old_otjh.repository._query_rows', return_value=[]) as read:
            with repository.request_read_scope():
                repository.query('SELECT value')
                repository.query('UPDATE values SET value=1')
                repository.query('UPDATE values SET value=1')
                repository.query('SELECT value')
                self.assertEqual(read.call_count, 4)
