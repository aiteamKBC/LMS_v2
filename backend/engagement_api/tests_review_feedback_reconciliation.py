"""Scoped recovery and regression guards against full-table Review polling."""
import ast
import importlib.util
from io import StringIO
from pathlib import Path
import json
from types import SimpleNamespace
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import SimpleTestCase

from . import tests_review_feedback as baseline
from . import tests_employer_feedback as employer_baseline


class NoAutomaticSweepTests(SimpleTestCase):
    def test_http_startup_does_not_import_or_run_review_discovery(self):
        root = Path(__file__).resolve().parents[1]
        for filename in ('asgi.py', 'wsgi.py'):
            tree = ast.parse((root / 'config' / filename).read_text(encoding='utf-8'))
            with self.subTest(entrypoint=filename):
                self.assertFalse(any(isinstance(node, ast.ImportFrom) and (node.module or '').startswith(
                    'engagement_api.review_feedback') for node in ast.walk(tree)))
                self.assertFalse(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                    and node.func.id in {'ReviewFeedbackASGI', 'ReviewFeedbackWSGI', 'reconcile_imported_reviews'}
                    for node in ast.walk(tree)))

    def test_full_scan_and_scheduler_modules_are_not_importable(self):
        for name in ('review_feedback_scheduler', 'review_feedback_reconciliation'):
            with self.subTest(module=name):
                self.assertIsNone(importlib.util.find_spec(f'engagement_api.{name}'))


class RecoveryPlanTests(SimpleTestCase):
    def test_scoped_command_assigns_mcm_pr_skills_epa_and_independent_employer_pr(self):
        fixture = employer_baseline.EmployerSyncTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        f = fixture.f
        baseline.reviews.FeedbackForm.objects.filter.return_value.order_by.return_value = [
            f.form, f.pr_form, f.epa_form, fixture.form]
        f.rows.return_value = [
            baseline.source_row(id=9001, review_type='Monthly Coaching Meeting', completed_date=baseline.COMPLETED),
            baseline.source_row(id=9002, review_type='Progress Review', completed_date=baseline.COMPLETED),
            baseline.source_row(id=9003, review_type='Progress Review (+ Skills Radar)', completed_date=baseline.COMPLETED),
            baseline.source_row(id=9004, review_name='Gateway Review', status='Completed', completed_date=baseline.COMPLETED),
        ]
        output = StringIO()
        call_command('sync_review_feedback', '--learner-id=71', stdout=output)
        result = json.loads(output.getvalue())
        self.assertEqual((result['created'], result['employerCreated']), (4, 2))
        self.assertEqual([call.kwargs['defaults']['form'] for call in f.create.call_args_list],
                         [f.form, f.pr_form, f.pr_form, f.epa_form])

    def test_recovery_can_be_restricted_to_exact_sources_for_one_verified_learner(self):
        module = 'engagement_api.management.commands.sync_review_feedback'
        with mock.patch(f'{module}.sync_review_feedback', return_value={'wouldCreate': 1}) as sync:
            output = StringIO()
            call_command('sync_review_feedback', '--learner-id=71', '--source-review-id=9001',
                         '--source-review-id=9001', '--source-review-id=9002', '--dry-run', stdout=output)
            self.assertEqual(sync.call_args_list, [mock.call(71, source_review_id=9001, dry_run=True),
                                                  mock.call(71, source_review_id=9002, dry_run=True)])
            self.assertEqual(json.loads(output.getvalue())['wouldCreate'], 2)

    def test_invalid_recovery_scopes_are_rejected_before_any_sync(self):
        module = 'engagement_api.management.commands.sync_review_feedback'
        for arguments in (
            [],
            ['--discover', '--source-review-id=9001'],
            ['--learner-id=71', '--learner-id=72', '--source-review-id=9001'],
            ['--learner-id=0'], ['--learner-id=71', '--source-review-id=-1'],
            ['--discover', '--batch-size=0'],
            ['--learner-id=71', '--discover'],
            ['--learner-id=71', '--batch-size=100'],
        ):
            with self.subTest(arguments=arguments), mock.patch(f'{module}.sync_review_feedback') as sync:
                with self.assertRaises(CommandError):
                    call_command('sync_review_feedback', *arguments, stdout=StringIO())
                sync.assert_not_called()

    def test_explicit_learner_dry_run_stays_scoped(self):
        module = 'engagement_api.management.commands.sync_review_feedback'
        with mock.patch(f'{module}.sync_review_feedback', return_value={'wouldCreate': 1}) as sync:
            output = StringIO()
            call_command('sync_review_feedback', '--learner-id=71', '--dry-run', stdout=output)
            sync.assert_called_once_with(71, dry_run=True)
            self.assertEqual(json.loads(output.getvalue()), {'wouldCreate': 1})

    def test_scoped_command_propagates_failure_instead_of_reporting_success(self):
        with mock.patch('engagement_api.management.commands.sync_review_feedback.sync_review_feedback',
                        side_effect=DatabaseError('Synthetic outage')):
            output = StringIO()
            with self.assertRaises(DatabaseError):
                call_command('sync_review_feedback', '--learner-id=71', stdout=output)
            self.assertEqual(output.getvalue(), '')

    def test_dry_run_uses_real_eligibility_without_creating_assignments(self):
        fixture = baseline.ReviewFeedbackSyncTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.rows.return_value = [
            baseline.source_row(status='Completed', completed_date=baseline.COMPLETED),
            baseline.source_row(id=9002, status='Completed', completed_date=baseline.LAUNCH - baseline.timedelta(days=1)),
            baseline.source_row(id=9003, status='Completed'),
        ]
        result = baseline.reviews.sync_review_feedback(71, dry_run=True)
        self.assertEqual((result['wouldCreate'], result['historical'], result['undated']), (1, 1, 1))
        fixture.create.assert_not_called()

    def test_employer_dry_run_does_not_resolve_links_or_create_records(self):
        fixture = employer_baseline.EmployerSyncTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with mock.patch('engagement_api.employer_feedback.resolve_pending_delivery') as resolve:
            result = baseline.reviews.sync_review_feedback(71, dry_run=True)
            self.assertEqual(result['employerWouldCreate'], 1)
            fixture.create.assert_not_called()
            resolve.assert_not_called()
        baseline.reviews.FeedbackEmployerReviewDelivery.objects.filter.return_value = [
            SimpleNamespace(source_review_id=9001, learner_id='71', employer_id=None)]
        result = baseline.reviews.sync_review_feedback(71, dry_run=True)
        self.assertEqual((result['employerExisting'], result['employerPending']), (1, 1))
        fixture.resolve.assert_not_called()
