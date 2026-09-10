import json
import inspect
from contextlib import nullcontext
from types import SimpleNamespace
from datetime import date, datetime, timezone
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import admin_evidence


def raw(view):
    """Skip require_GET and require_role for focused view-unit tests."""
    return view.__wrapped__.__wrapped__


def body(response):
    return json.loads(response.content)


def learner_row(**overrides):
    row = {
        "learner_id": 42, "full_name": "Alex Learner", "programme": "Marketing L4",
        "run_id": 9, "assignments_found": 12, "unique_assignments_evaluated": 10,
        "assignments_selected": 10, "portfolio_readiness": "ready_with_checks",
        "selection_status": "complete", "portfolio_summary": "Strong portfolio",
        "human_checks_required": ["Check 1"],
        "completed_at": datetime(2026, 8, 1, tzinfo=timezone.utc), "total_count": 1,
    }
    row.update(overrides)
    return row


def assignment_row(**overrides):
    row = {
        "evidence_id": 100, "component_id": 200, "evidence_name": "Assignment.pdf",
        "component_name": "Component A", "assignment_date": date(2026, 7, 1),
        "rank": 1, "final_score": 91, "classification": "strong",
        "audit_readiness": "ready", "selected": True,
        "selection_reasons": ["Strong KSB coverage"], "selection_reason": None,
        "reason_not_selected": None, "exclusion_reason": None,
        "verified_ksb_codes": ["K1", "S2"], "knowledge_found": True,
        "skills_found": True, "behaviours_found": False,
        "key_strengths": ["Clear application"], "weaknesses": [], "risks": [],
        "workplace_evidence_summary": "Applied at work", "feedback_quality_summary": "Detailed",
        "human_verification_required": False, "human_verification_reason": "",
        "evaluation": {}, "has_file": True, "has_report": True, "total_count": 1,
    }
    row.update(overrides)
    return row


class ClassificationDisplayTests(SimpleTestCase):
    def test_legacy_serialized_lists_are_normalized(self):
        for value in ('["K1", "S2"]', "['K1', 'S2']", ["['K1', 'S2']"], ['K1', 'S2']):
            with self.subTest(value=value):
                self.assertEqual(admin_evidence._json_list(value), ['K1', 'S2'])

    def test_prose_with_apostrophes_and_commas_is_preserved(self):
        text = "Uses the learner's CRM, surveys and reports."
        self.assertEqual(admin_evidence._json_list(json.dumps([text])), [text])
        self.assertEqual(admin_evidence._json_list(text), [text])

    def test_invalid_list_text_is_preserved_without_execution(self):
        text = "[not valid list text]"
        self.assertEqual(admin_evidence._json_list(text), [text])
        self.assertEqual(admin_evidence._json_list(None), [])

    def test_admin_ksb_codes_override_pipeline_codes(self):
        result = admin_evidence._assignment_payload(assignment_row(evaluation={
            'admin_verified_ksb_codes': ['K3', 'S4'],
        }), 42)
        self.assertEqual(result['verifiedKsbCodes'], ['K3', 'S4'])


class ClassifiedLearnerListTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        exclusions = patch('login.admin_evidence._exclusions_available', return_value=False)
        exclusions.start()
        self.addCleanup(exclusions.stop)
        programmes = patch('login.admin_evidence._programme_options', return_value=['Marketing'])
        programmes.start()
        self.addCleanup(programmes.stop)
        manual = patch('login.admin_evidence._manual_available', return_value=False)
        manual.start()
        self.addCleanup(manual.stop)

    @patch("login.admin_evidence._rows")
    def test_learner_with_ten_recommendations(self, rows):
        rows.return_value = [learner_row(assignments_selected=10)]
        response = raw(admin_evidence.classified_learners)(self.factory.get("/"))
        self.assertEqual(body(response)["results"][0]["assignmentsSelected"], 10)

    @patch("login.admin_evidence._rows")
    def test_learner_with_fewer_than_ten(self, rows):
        rows.return_value = [learner_row(assignments_selected=4, selection_status="fewer_than_10_available")]
        response = raw(admin_evidence.classified_learners)(self.factory.get("/"))
        self.assertEqual(body(response)["results"][0]["assignmentsSelected"], 4)

    @patch("login.admin_evidence._rows")
    def test_zero_selected_and_unclassified_learners_still_appear(self, rows):
        rows.return_value = [
            learner_row(assignments_selected=0, portfolio_readiness="not_ready", total_count=2),
            learner_row(
                learner_id=43, run_id=None, assignments_found=None,
                unique_assignments_evaluated=None, assignments_selected=None,
                portfolio_readiness=None, selection_status=None,
                human_checks_required=None, completed_at=None, total_count=2,
            ),
        ]
        response = raw(admin_evidence.classified_learners)(self.factory.get("/"))
        payload = body(response)
        self.assertEqual(payload["count"], 2)
        self.assertEqual(payload["results"][0]["assignmentsSelected"], 0)
        self.assertFalse(payload["results"][1]["hasCompletedRun"])
        self.assertEqual(payload["results"][1]["portfolioReadiness"], "not_classified")

    @patch("login.admin_evidence._rows")
    def test_human_verification_filter_is_server_side(self, rows):
        rows.return_value = []
        request = self.factory.get("/", {"humanVerification": "yes"})
        raw(admin_evidence.classified_learners)(request)
        sql = rows.call_args.args[0]
        self.assertIn("jsonb_array_length(run.human_checks_required) > 0", sql)

    def test_latest_run_ignores_failed_and_running(self):
        sql = admin_evidence.LATEST_COMPLETED_RUN
        self.assertIn("r.status = 'completed'", sql)
        self.assertIn("(r.source_fingerprint IS NOT NULL) DESC", sql)
        self.assertIn("r.completed_at DESC", sql)

    def test_test_learner_is_explicitly_excluded(self):
        self.assertEqual(admin_evidence.TEST_LEARNER_ID, 8539)

    @patch('login.admin_evidence._rows', return_value=[])
    def test_column_filters_include_zero_and_manual_selections(self, rows):
        response = raw(admin_evidence.classified_learners)(self.factory.get('/', {
            'q': 'Alex', 'programme': 'Marketing', 'found': '7',
            'evaluated': '3', 'selectedCount': '0', 'portfolioReadiness': 'not_ready',
        }))
        self.assertEqual(response.status_code, 200)
        sql, params = rows.call_args.args
        self.assertIn('(coalesce(run.assignments_selected, 0) + coalesce(manual_count.total, 0) - coalesce(excluded_count.total, 0)) = %s', sql)
        self.assertIn('(coalesce(run.assignments_found, 0)) = %s', sql)
        self.assertIn('(coalesce(run.unique_assignments_evaluated, 0)) = %s', sql)
        self.assertEqual(params, [8539, '%Alex%', '%Alex%', 'Marketing', 7, 3, 0, 'not_ready', 25, 0])
        self.assertEqual(body(response)['programmes'], ['Marketing'])

    @patch('login.admin_evidence._rows')
    def test_invalid_numeric_filters_are_rejected(self, rows):
        for value in ('-1', '1.5', 'invalid', '2147483648'):
            with self.subTest(value=value):
                response = raw(admin_evidence.classified_learners)(self.factory.get('/', {'found': value}))
                self.assertEqual(response.status_code, 400)
        rows.assert_not_called()


class AssignmentDetailTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        exclusions = patch('login.admin_evidence._exclusions_available', return_value=False)
        exclusions.start()
        self.addCleanup(exclusions.stop)
        self.meta = learner_row()
        manual = patch('login.admin_evidence._manual_available', return_value=False)
        manual.start()
        self.addCleanup(manual.stop)

    @patch("login.admin_evidence._rows")
    @patch("login.admin_evidence._learner_and_run")
    def test_recommended_is_ordered_by_rank(self, learner, rows):
        learner.return_value = self.meta
        rows.return_value = [assignment_row(rank=1), assignment_row(evidence_id=101, component_id=201, rank=2, total_count=2)]
        response = raw(admin_evidence.learner_assignments)(self.factory.get("/", {"view": "recommended"}), 42)
        self.assertEqual([item["rank"] for item in body(response)["results"]], [1, 2])
        self.assertIn("ORDER BY coalesce(result.rank, manual.rank) ASC", rows.call_args.args[0])

    @patch("login.admin_evidence._rows")
    @patch("login.admin_evidence._learner_and_run")
    def test_all_assignment_date_and_score_sorting(self, learner, rows):
        learner.return_value = self.meta
        rows.return_value = []
        raw(admin_evidence.learner_assignments)(self.factory.get("/", {"view": "all", "sort": "date"}), 42)
        self.assertIn("v.assignment_date DESC NULLS LAST", rows.call_args.args[0])
        raw(admin_evidence.learner_assignments)(self.factory.get("/", {"view": "all", "sort": "score"}), 42)
        self.assertIn("v.final_score DESC", rows.call_args.args[0])

    @patch("login.admin_evidence._rows")
    @patch("login.admin_evidence._learner_and_run")
    def test_all_selected_sort_puts_recommendations_first(self, learner, rows):
        learner.return_value = self.meta
        rows.return_value = []
        raw(admin_evidence.learner_assignments)(
            self.factory.get("/", {"view": "all", "sort": "selected"}), 42,
        )
        self.assertIn(
            "((result.evidence_id IS NOT NULL AND excluded.evidence_id IS NULL) OR manual.evidence_id IS NOT NULL) DESC",
            rows.call_args.args[0],
        )

    @patch("login.admin_evidence._learner_and_run")
    def test_no_run_has_clear_empty_state(self, learner):
        learner.return_value = learner_row(run_id=None, completed_at=None)
        response = raw(admin_evidence.learner_assignments)(self.factory.get("/"), 42)
        payload = body(response)
        self.assertEqual(payload["results"], [])
        self.assertIn("No assignment components", payload["learner"]["portfolioSummary"])


class ManualSelectionTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.rows = self.start_patch('_rows')
        self.start_patch('_exclusions_available', return_value=True)
        self.start_patch('_exclusion_source', return_value='SELECT NULL::bigint AS run_id, NULL::bigint AS learner_id, NULL::bigint AS component_id, NULL::bigint AS evidence_id WHERE false')
        self.start_patch('_manual_available', return_value=True)
        self.start_patch('_learner_and_run', return_value=learner_row())
        atomic = patch('login.admin_evidence.transaction.atomic', side_effect=lambda **kwargs: nullcontext())
        atomic.start()
        self.addCleanup(atomic.stop)

    def start_patch(self, name, **kwargs):
        patcher = patch(f'login.admin_evidence.{name}', **kwargs)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked

    def request(self, selected=True, **overrides):
        payload = {'runId': 9, 'componentId': 200, 'selected': selected, **overrides}
        request = self.factory.post('/', json.dumps(payload), content_type='application/json', HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        request.login_account = SimpleNamespace(pk=7)
        return request

    def call(self, request=None):
        return inspect.unwrap(admin_evidence.select_assignment)(request or self.request(), 42, 100)

    def test_select_persists_true_in_evaluation_column(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [], [{'evidence_id': 100}]]
        self.assertEqual(self.call().status_code, 200)
        sql, params = self.rows.call_args.args
        self.assertIn('UPDATE fetching_evidence.assignment_classification_evaluations SET manual_selected = %s', sql)
        self.assertEqual(params, [True, 9, 42, 200, 100])
        self.assertIn('FOR UPDATE', self.rows.call_args_list[0].args[0])

    def test_full_portfolio_is_rejected_without_write(self):
        portfolio = [{'component_id': i, 'evidence_id': i, 'rank': i + 1, 'manual': False} for i in range(10)]
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], portfolio]
        self.assertEqual(self.call().status_code, 409)
        self.assertEqual(self.rows.call_count, 3)

    def test_duplicate_component_is_rejected(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 101, 'rank': 1, 'manual': False}]]
        self.assertEqual(self.call().status_code, 409)
        self.assertEqual(self.rows.call_count, 3)

    def test_repeated_selection_is_idempotent(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 100, 'rank': 1, 'manual': True}], [{'evidence_id': 100}]]
        self.assertEqual(self.call().status_code, 200)
        self.assertEqual(self.rows.call_args.args[1], [True, 9, 42, 200, 100])

    def test_wrong_learner_evidence_cannot_be_selected(self):
        self.rows.side_effect = [[{'id': 9}], []]
        self.assertEqual(self.call().status_code, 404)
        self.assertEqual(self.rows.call_count, 2)

    def test_stale_run_cannot_be_selected(self):
        self.rows.return_value = [{'id': 8}]
        self.assertEqual(self.call(self.request(runId=8)).status_code, 409)
        self.assertEqual(self.rows.call_count, 1)

    def test_unselect_persists_false_without_deleting_evaluation(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 100, 'rank': 1, 'manual': True}], []]
        self.assertFalse(body(self.call(self.request(False)))['selected'])
        self.assertIn('SET manual_selected = %s', self.rows.call_args.args[0])
        self.assertEqual(self.rows.call_args.args[1], [False, 9, 42, 200, 100])

    def test_unselect_pipeline_recommendation_uses_same_column(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 100, 'rank': 1, 'manual': False}], []]
        self.assertFalse(body(self.call(self.request(False)))['selected'])
        self.assertIn('UPDATE fetching_evidence.assignment_classification_evaluations SET manual_selected = %s', self.rows.call_args.args[0])
        self.assertEqual(self.rows.call_args.args[1], [False, 9, 42, 200, 100])

    def test_reselect_restores_original_recommendation(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 100, 'rank': 1, 'manual': False, 'excluded': True}], []]
        self.assertTrue(body(self.call())['selected'])
        self.assertEqual(self.rows.call_args.args[1], [True, 9, 42, 200, 100])

    def test_unselect_other_evidence_for_selected_component_does_not_change_it(self):
        self.rows.side_effect = [[{'id': 9}], [{'evidence_id': 100}], [{'component_id': 200, 'evidence_id': 101, 'rank': 1, 'manual': False}], []]
        self.assertFalse(body(self.call(self.request(False)))['selected'])
        self.assertEqual(self.rows.call_args.args[1], [False, 9, 42, 200, 100])

    def test_missing_column_rejects_unselect(self):
        self.start_patch('_manual_available', return_value=False)
        self.assertEqual(self.call(self.request(False)).status_code, 503)
        self.rows.assert_not_called()

    def test_unselected_assignment_hides_rank_but_keeps_score_and_review(self):
        result = admin_evidence._assignment_payload(assignment_row(selected=False, manually_excluded=True), 42)
        self.assertIsNone(result['rank'])
        self.assertEqual(result['finalScore'], 91)
        self.assertEqual(result['reasonNotSelected'], 'Unselected by an administrator.')

    def test_missing_custom_header_and_invalid_payload_are_rejected(self):
        request = self.request()
        del request.META['HTTP_X_REQUESTED_WITH']
        self.assertEqual(self.call(request).status_code, 403)
        self.assertEqual(self.call(self.request(selected='true')).status_code, 400)
        self.rows.assert_not_called()

    @patch('login.permissions.authenticate_request')
    def test_anonymous_and_non_admin_are_rejected(self, authenticate):
        authenticate.return_value = None
        self.assertEqual(admin_evidence.select_assignment(self.request(), 42, 100).status_code, 401)
        authenticate.return_value = SimpleNamespace(role='learner')
        self.assertEqual(admin_evidence.select_assignment(self.request(), 42, 100).status_code, 403)
        self.rows.assert_not_called()

    def test_unconfigured_table_returns_clear_error_without_write(self):
        self.start_patch('_manual_available', return_value=False)
        self.assertEqual(self.call().status_code, 503)
        self.rows.assert_not_called()


class KsbCodeEditingTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def request(self, **overrides):
        payload = {
            'runId': 9,
            'componentId': 200,
            'verifiedKsbCodes': [' k1 ', 'S2', 'K1'],
            **overrides,
        }
        request = self.factory.post('/', json.dumps(payload), content_type='application/json', HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        request.login_account = SimpleNamespace(pk=7)
        return request

    @patch('login.admin_evidence._rows', return_value=[{'evidence_id': 100}])
    @patch('login.admin_evidence._learner_and_run', return_value=learner_row())
    def test_saves_normalized_ksb_codes_in_evaluation_overrides(self, _learner, rows):
        response = inspect.unwrap(admin_evidence.update_ksb_codes)(self.request(), 42, 100)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body(response), {'verifiedKsbCodes': ['K1', 'S2']})
        sql, params = rows.call_args.args
        self.assertIn("evaluation = coalesce(evaluation, '{}'::jsonb) || %s::jsonb", sql)
        self.assertEqual(params[1:], [9, 42, 200, 100])
        self.assertEqual(json.loads(params[0]), {'admin_verified_ksb_codes': ['K1', 'S2']})

    @patch('login.admin_evidence._rows')
    @patch('login.admin_evidence._learner_and_run', return_value=learner_row(run_id=10))
    def test_rejects_stale_classification_without_writing(self, _learner, rows):
        response = inspect.unwrap(admin_evidence.update_ksb_codes)(self.request(), 42, 100)
        self.assertEqual(response.status_code, 409)
        rows.assert_not_called()

    @patch('login.admin_evidence._rows')
    @patch('login.admin_evidence._learner_and_run')
    def test_rejects_invalid_code_before_database_lookup(self, learner, rows):
        response = inspect.unwrap(admin_evidence.update_ksb_codes)(
            self.request(verifiedKsbCodes=['not-a-code']), 42, 100,
        )
        self.assertEqual(response.status_code, 400)
        learner.assert_not_called()
        rows.assert_not_called()


class AssessmentReportFormTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.report_row = {
            'run_id': 9, 'evidence_id': 100, 'learner_id': 42,
            'full_name': 'Alex Learner', 'program_name': 'Marketing L4',
            'evidence_name': 'Assignment.pdf', 'evidence_status': 'CustomStatus',
            'spent_time': 95, 'completed_date': date(2025, 7, 1),
            'report_blob': 'old-report.pdf', 'activity_name': 'Marketing activity',
        }

    def save_request(self, **overrides):
        payload = {
            'learner_name': 'Alex Learner', 'activity_name': 'Marketing activity',
            'evidence_name': 'Assignment.pdf', 'time_spent': 95,
            'result': 'CustomStatus', 'assessor': 'Tutor Name',
            'date': '08/09/2026', 'criteria': 'Knowledge: K1',
            'comments': '<b>Strong</b> workplace evidence.', 'reanalyze': True,
            **overrides,
        }
        request = self.factory.post('/', json.dumps(payload), content_type='application/json', HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        request.login_account = SimpleNamespace(pk=7)
        return request

    @patch('login.admin_evidence.timezone.localdate', return_value=date(2026, 9, 8))
    @patch('login.admin_evidence._report_form_row')
    def test_prefills_report_form_and_keeps_custom_result(self, report_row, _today):
        report_row.return_value = self.report_row
        response = raw(admin_evidence.report_form)(self.factory.get('/'), 42, 100)
        payload = body(response)
        self.assertEqual(payload['activity_name'], 'Marketing activity')
        self.assertEqual(payload['time_spent'], 95)
        self.assertEqual(payload['date'], '08/09/2026')
        self.assertEqual(payload['result_options'][0], 'CustomStatus')
        self.assertTrue(payload['has_report'])

    @patch('login.admin_evidence._start_evidence_reanalysis', return_value={'queued': True, 'job_id': 'job-12'})
    @patch('login.admin_evidence._persist_report_source')
    @patch('login.admin_evidence._rows', return_value=[{'evidence_id': 100}])
    @patch('login.admin_evidence.transaction.atomic', side_effect=lambda **kwargs: nullcontext())
    @patch('login.admin_evidence.evidence_storage.upload_blob')
    @patch('login.admin_evidence.evidence_storage.azure_configured', return_value=True)
    @patch('login.report_pdf.build_assessment_report_pdf', return_value=b'%PDF-1.4 generated')
    @patch('login.admin_evidence._report_form_row')
    def test_builds_uploads_links_and_starts_fresh_audit(
        self, report_row, build_pdf, _configured, upload, _atomic, rows,
        persist_source, start_reanalysis,
    ):
        report_row.return_value = self.report_row
        response = inspect.unwrap(admin_evidence.save_report_form)(self.save_request(), 42, 100)
        self.assertEqual(response.status_code, 200)
        payload = body(response)
        self.assertFalse(payload['analysis_required'])
        self.assertFalse(payload['analysis_preserved'])
        self.assertTrue(payload['reanalyze_queued'])
        self.assertEqual(payload['job_id'], 'job-12')
        self.assertTrue(payload['report_blob'].endswith('/100-AssessmentReport-form.pdf'))
        build_pdf.assert_called_once()
        self.assertEqual(build_pdf.call_args.args[0]['evidence_date'], date(2025, 7, 1))
        self.assertEqual(upload.call_args.args[1], 'fetch-aptem-evidences')
        self.assertEqual(upload.call_args.args[3], 'application/pdf')
        self.assertTrue(upload.call_args.kwargs['overwrite'])
        self.assertIn('SET report_blob=%s', rows.call_args.args[0])
        persist_source.assert_called_once_with(42, 100, payload['report_blob'])
        start_reanalysis.assert_called_once_with(100)

    @patch('login.admin_evidence._start_evidence_reanalysis')
    @patch('login.admin_evidence._persist_report_source')
    @patch('login.admin_evidence._rows', return_value=[{'evidence_id': 100}])
    @patch('login.admin_evidence.transaction.atomic', side_effect=lambda **kwargs: nullcontext())
    @patch('login.admin_evidence.evidence_storage.upload_blob')
    @patch('login.admin_evidence.evidence_storage.azure_configured', return_value=True)
    @patch('login.report_pdf.build_assessment_report_pdf', return_value=b'%PDF-1.4 generated')
    @patch('login.admin_evidence._report_form_row')
    def test_can_save_report_while_preserving_existing_analysis(
        self, report_row, _build_pdf, _configured, _upload, _atomic, _rows,
        persist_source, start_reanalysis,
    ):
        report_row.return_value = self.report_row
        response = inspect.unwrap(admin_evidence.save_report_form)(
            self.save_request(reanalyze=False), 42, 100,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body(response)['analysis_required'], False)
        self.assertEqual(body(response)['analysis_preserved'], True)
        self.assertEqual(body(response)['reanalyze_queued'], False)
        persist_source.assert_called_once()
        start_reanalysis.assert_not_called()

    @patch('login.admin_evidence._report_form_row')
    def test_rejects_invalid_date_before_building(self, report_row):
        report_row.return_value = self.report_row
        response = inspect.unwrap(admin_evidence.save_report_form)(self.save_request(date='2026-09-08'), 42, 100)
        self.assertEqual(response.status_code, 400)

    @patch('login.admin_evidence.evidence_storage.upload_blob', side_effect=RuntimeError('secret storage URL'))
    @patch('login.admin_evidence.evidence_storage.azure_configured', return_value=True)
    @patch('login.report_pdf.build_assessment_report_pdf', return_value=b'%PDF-1.4 generated')
    @patch('login.admin_evidence._report_form_row')
    def test_storage_failure_does_not_expose_secret_details(self, report_row, _build, _configured, _upload):
        report_row.return_value = self.report_row
        response = inspect.unwrap(admin_evidence.save_report_form)(self.save_request(), 42, 100)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('secret', body(response)['error'])

    def test_manifest_link_is_replaced_without_losing_submission(self):
        manifest = {
            'counts': {'reports_missing': 1, 'reports_present': 0},
            'missing_ids': [100],
            'items': [{
                'evidence_id': 100,
                'submission': {'status': 'present', 'blob': 'submission.pdf'},
                'feedback': {'message': 'Good'},
                'report': {'status': 'missing', 'blob': None},
            }],
        }
        updated = admin_evidence._updated_manifest(manifest, 100, 'folder/report.pdf')
        item = updated['items'][0]
        self.assertEqual(item['submission']['blob'], 'submission.pdf')
        self.assertEqual(item['report']['blob'], 'folder/report.pdf')
        self.assertEqual(item['feedback']['report_blob'], 'folder/report.pdf')
        self.assertEqual(updated['counts'], {'reports_missing': 0, 'reports_present': 1})
        self.assertEqual(updated['missing_ids'], [])


class EvidenceDocumentSecurityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("login.permissions.authenticate_request", return_value=None)
    def test_unauthorised_admin_endpoint_is_rejected(self, _authenticate):
        response = admin_evidence.open_evidence_document(self.factory.get("/"), 42, 100)
        self.assertEqual(response.status_code, 401)

    @patch("login.admin_evidence._authorised_document", return_value=None)
    def test_evidence_belonging_to_another_learner_is_hidden(self, _document):
        response = raw(admin_evidence.open_evidence_document)(self.factory.get("/", {"part": "file"}), 42, 999)
        self.assertEqual(response.status_code, 404)

    @patch("login.admin_evidence._authorised_document")
    def test_missing_file_and_report(self, document):
        document.return_value = {"evidence_id": 100, "evidence_name": "A.docx", "file_blob": None, "report_blob": None}
        file_response = raw(admin_evidence.open_evidence_document)(self.factory.get("/", {"part": "file"}), 42, 100)
        report_response = raw(admin_evidence.open_evidence_document)(self.factory.get("/", {"part": "report"}), 42, 100)
        self.assertEqual(file_response.status_code, 404)
        self.assertEqual(report_response.status_code, 404)

    @override_settings(AZURE_SAS_TTL_MINUTES=15)
    @patch("login.admin_evidence.evidence_storage.get_download_sas", return_value="https://blob.test/file?download-token")
    @patch("login.admin_evidence.evidence_storage.get_read_sas", return_value="https://blob.test/file?read-token")
    @patch("login.admin_evidence.evidence_storage.azure_configured", return_value=True)
    @patch("login.admin_evidence._authorised_document")
    def test_assignment_and_report_urls_are_short_lived_and_not_persisted(
        self, document, _configured, _read_sas, _download_sas,
    ):
        document.return_value = {
            "evidence_id": 100, "evidence_name": "Assignment.docx",
            "file_blob": "42/file.docx", "report_blob": "42/report.pdf",
        }
        response = raw(admin_evidence.open_evidence_document)(self.factory.get("/", {"part": "file"}), 42, 100)
        payload = body(response)
        self.assertEqual(payload["url"], "https://blob.test/file?read-token")
        self.assertEqual(payload["downloadUrl"], "https://blob.test/file?download-token")
        self.assertIn("expiresAt", payload)
        report = raw(admin_evidence.open_evidence_document)(self.factory.get("/", {"part": "report"}), 42, 100)
        self.assertEqual(report.status_code, 200)
        # The document endpoint never passes a token to the database lookup.
        self.assertNotIn("token", str(document.call_args_list))

    @patch("login.admin_evidence.evidence_storage.download_blob_bytes", return_value=b"plain <b>text</b>")
    @patch("login.admin_evidence._authorised_document")
    def test_txt_preview_returns_plain_json_text(self, document, _download):
        document.return_value = {"evidence_id": 100, "evidence_name": "notes.txt", "file_blob": "notes.txt", "report_blob": None}
        response = raw(admin_evidence.evidence_text_preview)(self.factory.get("/", {"part": "file"}), 42, 100)
        self.assertEqual(body(response)["text"], "plain <b>text</b>")

    @patch("login.admin_evidence._authorised_document")
    def test_unsupported_text_preview_type(self, document):
        document.return_value = {"evidence_id": 100, "evidence_name": "archive.zip", "file_blob": "archive.zip", "report_blob": None}
        response = raw(admin_evidence.evidence_text_preview)(self.factory.get("/", {"part": "file"}), 42, 100)
        self.assertEqual(response.status_code, 415)
