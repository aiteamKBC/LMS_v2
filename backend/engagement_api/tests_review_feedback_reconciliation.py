"""Isolated source discovery, retry, runtime wiring and read-only recovery plans."""
import asyncio
import ast
from contextlib import ExitStack, nullcontext
from io import StringIO
from pathlib import Path
import json
from types import SimpleNamespace
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import SimpleTestCase, override_settings

from . import review_feedback_reconciliation as discovery
from . import review_feedback_scheduler as scheduler
from . import tests_review_feedback as baseline
from . import tests_employer_feedback as employer_baseline


class DiscoveryTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.db = self.stack.enter_context(mock.patch.object(discovery, 'connection'))
        self.db.in_atomic_block = False
        self.db.get_autocommit.return_value = True
        self.forms = self.stack.enter_context(mock.patch.object(discovery.FeedbackForm.objects, 'filter'))
        self.forms.return_value.exists.return_value = True
        self.ids = self.stack.enter_context(mock.patch.object(discovery, 'source_profile_ids',
                                                            side_effect=[[17, 18], []]))
        self.profiles = self.stack.enter_context(mock.patch.object(discovery.LearnerProfile.objects, 'filter',
            return_value=[SimpleNamespace(pk=17), SimpleNamespace(pk=18)]))
        self.bridge = self.stack.enter_context(mock.patch.object(discovery, 'enrolment_for_review_profile',
            side_effect=lambda profile: SimpleNamespace(pk=profile.pk + 100) if profile else None))
        self.sync = self.stack.enter_context(mock.patch.object(discovery, 'sync_review_feedback',
            return_value={'created': 1, 'employerCreated': 1}))

    def test_bounded_batches_resolve_profiles_to_enrolment_ids_and_keep_both_recipient_types(self):
        result = discovery.reconcile_imported_reviews(batch_size=2)
        self.assertEqual(self.ids.call_args_list, [mock.call(0, 2), mock.call(18, 2)])
        self.assertEqual(self.sync.call_args_list, [mock.call(117), mock.call(118)])
        self.assertEqual((result['profiles'], result['created'], result['employerCreated']), (2, 2, 2))

    def test_failure_does_not_starve_batch_and_is_retried_on_next_sweep(self):
        self.ids.side_effect = [[17, 18], [], [17, 18], []]
        self.sync.side_effect = [DatabaseError('PRIVATE'), {'created': 1}, {'created': 1}, {'existing': 1}]
        with self.assertLogs(discovery.logger, level='ERROR') as logs:
            first = discovery.reconcile_imported_reviews()
        second = discovery.reconcile_imported_reviews()
        self.assertEqual((first['failedProfiles'], first['created']), (1, 1))
        self.assertEqual((second['failedProfiles'], second['created'], second['existing']), (0, 1, 1))
        self.assertNotIn('PRIVATE', ''.join(logs.output))

    def test_missing_and_ambiguous_identity_never_guess_a_recipient(self):
        self.bridge.side_effect = [None, discovery.ReviewIdentityConflict('PRIVATE')]
        result = discovery.reconcile_imported_reviews()
        self.assertEqual((result['unlinkedProfiles'], result['identityConflicts']), (2, 1))
        self.sync.assert_not_called()

    def test_no_published_supported_forms_does_not_scan_sources(self):
        self.forms.return_value.exists.return_value = False
        self.assertEqual(discovery.reconcile_imported_reviews()['profiles'], 0)
        self.ids.assert_not_called()

    def test_dry_run_uses_the_same_service_without_writes(self):
        self.sync.return_value = {'created': 0, 'wouldCreate': 1, 'employerWouldCreate': 1}
        result = discovery.reconcile_imported_reviews(dry_run=True)
        self.assertEqual(result['wouldCreate'], 2)
        self.assertEqual(self.sync.call_args_list, [mock.call(117, dry_run=True), mock.call(118, dry_run=True)])

    def test_uncommitted_or_invalid_batches_fail_before_any_discovery(self):
        for atomic, autocommit in ((True, True), (False, False)):
            self.db.in_atomic_block = atomic
            self.db.get_autocommit.return_value = autocommit
            with self.assertRaises(RuntimeError):
                discovery.reconcile_imported_reviews()
        for size in (0, 1001):
            with self.assertRaises(ValueError):
                discovery.reconcile_imported_reviews(batch_size=size)
        self.ids.assert_not_called()

    def test_shutdown_stops_before_processing_and_leaves_sources_for_next_run(self):
        result = discovery.reconcile_imported_reviews(should_stop=lambda: True)
        self.assertTrue(result['stopped'])
        self.ids.assert_not_called()

    def test_profile_claim_is_short_and_busy_profiles_are_not_processed(self):
        self.db.vendor = 'postgresql'
        with (mock.patch.object(discovery.transaction, 'atomic', side_effect=lambda: nullcontext()) as atomic,
              mock.patch.object(discovery, 'claim_profile', side_effect=[False, True])):
            result = discovery.reconcile_imported_reviews(lock_profiles=True)
        self.assertEqual(atomic.call_count, 2)
        self.assertEqual(result['busyProfiles'], 1)
        self.sync.assert_called_once_with(118)

    def test_profile_commit_failure_never_reports_a_created_assignment(self):
        class FailedCommit:
            def __enter__(self):
                pass

            def __exit__(self, *args):
                raise DatabaseError('PRIVATE')

        self.db.vendor = 'postgresql'
        with (mock.patch.object(discovery.transaction, 'atomic', return_value=FailedCommit()),
              mock.patch.object(discovery, 'claim_profile', return_value=True),
              self.assertLogs(discovery.logger, level='ERROR')):
            result = discovery.reconcile_imported_reviews(lock_profiles=True)
        self.assertEqual(result['failedProfiles'], 2)
        self.assertNotIn('created', result)


class SourceQueryTests(SimpleTestCase):
    def test_profile_lock_is_transaction_scoped_for_pooled_database_connections(self):
        with mock.patch.object(discovery, 'connection') as db:
            cursor = db.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = (False,)
            self.assertFalse(discovery.claim_profile(17))
        cursor.execute.assert_called_once_with(
            'SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0))', ['review-feedback-profile:17'])

    def test_candidate_query_cannot_drop_new_completed_or_late_updated_sources(self):
        with mock.patch.object(discovery, 'connection') as db:
            cursor = db.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [(17,), (18,)]
            self.assertEqual(discovery.source_profile_ids(10, 2), [17, 18])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [10, 2])
        self.assertIn('DISTINCT learner_id', sql)
        for column in ('status', 'completed_date', 'updated_at', 'review_type'):
            self.assertNotIn(column, sql)


@override_settings(DEBUG=True, CHAT_TEST_MODE=False, RUN_APP_ON_TEST_BRANCH=False)
class SchedulerTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.db = self.stack.enter_context(mock.patch.object(scheduler, 'connection'))
        self.db.vendor = 'postgresql'
        self.db.in_atomic_block = False
        self.db.get_autocommit.return_value = True
        self.cursor = self.db.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = (True,)
        self.reconcile = self.stack.enter_context(mock.patch.object(scheduler, 'reconcile_imported_reviews',
            return_value={'created': 2, 'failedProfiles': 0}))

    def test_worker_requests_transaction_scoped_profile_claims(self):
        self.assertEqual(scheduler.run_scheduled_reconciliation()['created'], 2)
        self.reconcile.assert_called_once_with(should_stop=scheduler._stop.is_set, lock_profiles=True)
        self.cursor.execute.assert_not_called()

    def test_failure_is_propagated_to_the_retry_loop(self):
        self.reconcile.side_effect = DatabaseError('PRIVATE')
        with self.assertRaises(DatabaseError):
            scheduler.run_scheduled_reconciliation()
        self.cursor.execute.assert_not_called()

    def test_worker_refuses_non_postgres_or_an_open_import_transaction(self):
        for vendor, atomic in (('sqlite', False), ('postgresql', True)):
            self.db.vendor, self.db.in_atomic_block = vendor, atomic
            with self.assertRaises(RuntimeError):
                scheduler.run_scheduled_reconciliation()
        self.reconcile.assert_not_called()

    def test_loop_survives_failure_closes_connections_and_retries(self):
        with (mock.patch.object(scheduler, '_stop') as stop,
              mock.patch.object(scheduler, 'run_scheduled_reconciliation',
                                side_effect=[DatabaseError('PRIVATE'), {'created': 1}]) as run,
              mock.patch.object(scheduler.connections, 'close_all') as close,
              self.assertLogs(scheduler.logger, level='INFO') as logs):
            stop.wait.return_value = False
            stop.is_set.side_effect = [False, False, True]
            scheduler._loop()
        self.assertEqual((run.call_count, close.call_count), (2, 2))
        self.assertEqual(stop.wait.call_args_list, [mock.call(60), mock.call(300), mock.call(300)])
        self.assertNotIn('PRIVATE', ''.join(logs.output))

    def test_tests_and_disabled_release_never_start_a_thread(self):
        with mock.patch.object(scheduler.threading, 'Thread') as thread:
            self.assertFalse(scheduler.start_scheduler())
            with mock.patch.object(scheduler.sys, 'argv', ['daphne']), \
                    mock.patch.dict(scheduler.os.environ, {'REVIEW_FEEDBACK_SCHEDULE': 'false'}):
                self.assertFalse(scheduler.start_scheduler())
            with override_settings(DEBUG=False, LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False), \
                    mock.patch.object(scheduler.sys, 'argv', ['daphne']):
                self.assertFalse(scheduler.start_scheduler())
        thread.assert_not_called()

    def test_serving_process_starts_one_thread_and_start_failure_is_visible(self):
        with (mock.patch.object(scheduler.sys, 'argv', ['daphne']),
              mock.patch.dict(scheduler.os.environ, {}, clear=False) as env,
              mock.patch.object(scheduler, '_thread', None),
              mock.patch.object(scheduler.threading, 'Thread') as thread):
            env.pop('PYTEST_CURRENT_TEST', None)
            env.pop('REVIEW_FEEDBACK_SCHEDULE', None)
            thread.return_value.is_alive.return_value = True
            self.assertTrue(scheduler.start_scheduler())
            self.assertTrue(scheduler.start_scheduler())
            thread.assert_called_once()
            with mock.patch.object(scheduler, '_thread', None), self.assertLogs(scheduler.logger, level='ERROR'):
                thread.return_value.start.side_effect = RuntimeError('PRIVATE')
                self.assertFalse(scheduler.start_scheduler())

    def test_wrappers_start_only_on_serving_calls_and_preserve_application(self):
        app = mock.Mock(return_value=[b'ok'])
        with mock.patch.object(scheduler, 'start_scheduler') as start:
            wrapper = scheduler.ReviewFeedbackWSGI(app)
            start.assert_not_called()
            self.assertEqual(wrapper({}, None), [b'ok'])
            start.assert_called_once()
        calls = []

        async def async_app(scope, receive, send):
            calls.append(scope['type'])

        with mock.patch.object(scheduler, 'start_scheduler') as start:
            wrapper = scheduler.ReviewFeedbackASGI(async_app)
            asyncio.run(wrapper({'type': 'websocket'}, None, None))
            start.assert_not_called()
            asyncio.run(wrapper({'type': 'http'}, None, None))
            start.assert_called_once()
        self.assertEqual(calls, ['websocket', 'http'])

    def test_both_actual_server_entrypoints_wire_the_review_scheduler(self):
        root = Path(__file__).resolve().parents[1]
        for filename, wrapper in (('asgi.py', 'ReviewFeedbackASGI'), ('wsgi.py', 'ReviewFeedbackWSGI')):
            tree = ast.parse((root / 'config' / filename).read_text(encoding='utf-8'))
            self.assertTrue(any(isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                                and node.func.id == wrapper for node in ast.walk(tree)))


class RecoveryPlanTests(SimpleTestCase):
    def test_discovery_assigns_mcm_pr_skills_epa_and_independent_employer_pr(self):
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
        with (mock.patch.object(discovery, 'connection') as db,
              mock.patch.object(discovery, 'source_profile_ids', side_effect=[[17], []]),
              mock.patch.object(discovery.LearnerProfile.objects, 'filter', return_value=[f.profile]),
              mock.patch.object(discovery, 'enrolment_for_review_profile', return_value=f.learner)):
            db.in_atomic_block = False
            db.get_autocommit.return_value = True
            result = discovery.reconcile_imported_reviews()
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
            ['--discover', '--source-review-id=9001'],
            ['--learner-id=71', '--learner-id=72', '--source-review-id=9001'],
            ['--learner-id=0'], ['--learner-id=71', '--source-review-id=-1'],
            ['--discover', '--batch-size=0'],
        ):
            with self.subTest(arguments=arguments), mock.patch(f'{module}.sync_review_feedback') as sync:
                with self.assertRaises(CommandError):
                    call_command('sync_review_feedback', *arguments, stdout=StringIO())
                sync.assert_not_called()

    def test_explicit_learner_dry_run_and_discovery_scope(self):
        module = 'engagement_api.management.commands.sync_review_feedback'
        with mock.patch(f'{module}.sync_review_feedback', return_value={'wouldCreate': 1}) as sync:
            output = StringIO()
            call_command('sync_review_feedback', '--learner-id=71', '--dry-run', stdout=output)
            sync.assert_called_once_with(71, dry_run=True)
            self.assertEqual(json.loads(output.getvalue()), {'wouldCreate': 1})
        with mock.patch(f'{module}.reconcile_imported_reviews',
                        return_value={'profiles': 2, 'failedProfiles': 0}) as discover:
            call_command('sync_review_feedback', '--discover', '--dry-run', '--batch-size=2', stdout=StringIO())
            discover.assert_called_once_with(batch_size=2, dry_run=True)

    def test_failed_discovery_reports_partial_counts_and_nonzero_exit(self):
        with mock.patch('engagement_api.management.commands.sync_review_feedback.reconcile_imported_reviews',
                        return_value={'profiles': 2, 'failedProfiles': 1, 'created': 1}):
            output = StringIO()
            with self.assertRaises(CommandError):
                call_command('sync_review_feedback', '--discover', stdout=output)
            self.assertEqual(json.loads(output.getvalue())['failedProfiles'], 1)

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
