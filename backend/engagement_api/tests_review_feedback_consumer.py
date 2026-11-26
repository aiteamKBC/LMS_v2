"""Integration tests run ONLY by the isolated PostgreSQL consumer-test runner.

The fixture uses the ORM's column types and actual service/ownership resolvers.
No application fixtures, migrations, credentials, mail or HTTP calls are used.
"""
import ast
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from io import StringIO
import json
from pathlib import Path
import threading
import unittest
from unittest import mock

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections, DatabaseError
from django.db.models import QuerySet
from django.utils import timezone

from coach_api.models import ImportedReviewInstance
from learner_api.models import Employer, EnrolmentUser, LearnerProfile
from login.models import LoginAccount

from . import review_feedback_consumer as consumer
from .models import FeedbackEmployerReviewDelivery, FeedbackForm, FeedbackReviewDelivery


MEASUREMENTS = {}
MODELS = (Employer, EnrolmentUser, LearnerProfile, LoginAccount, ImportedReviewInstance,
          FeedbackForm, FeedbackReviewDelivery, FeedbackEmployerReviewDelivery)


class ConsumerIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not getattr(settings, 'FEEDBACK_CONSUMER_TEST_DIRECTORY', None):
            raise unittest.SkipTest('Use run_review_feedback_consumer_tests.py; never an application database.')
        cls.directory = Path(settings.FEEDBACK_CONSUMER_TEST_DIRECTORY).resolve()
        consumer._sandbox_config(cls.directory)
        consumer._verify_connections(cls.directory)
        with connections['default'].cursor() as cursor:
            for schema in ('Feedback', 'Learner', 'Coach', 'enrolment', 'login'):
                cursor.execute(f'CREATE SCHEMA "{schema}"')
            for model in MODELS:
                definitions = []
                for field in model._meta.local_fields:
                    name = connections['default'].ops.quote_name(field.column)
                    if field.primary_key and field.get_internal_type() in ('AutoField', 'BigAutoField'):
                        definition = f'{name} bigserial PRIMARY KEY'
                    else:
                        definition = f'{name} {field.db_type(connections["default"])}'
                        if field.primary_key:
                            definition += ' PRIMARY KEY'
                        elif field.unique:
                            definition += ' UNIQUE'
                    definitions.append(definition)
                table = connections['default'].ops.quote_name(model._meta.db_table)
                cursor.execute(f'CREATE TABLE {table} ({",".join(definitions)})')
            cursor.execute('''CREATE TABLE "Learner".reviews (
                id bigint PRIMARY KEY, aptem_review_id text, learner_id bigint, learner_name text,
                review_type text, review_name text, completed_date timestamptz, status text, review_data jsonb)''')
            cursor.execute('ALTER TABLE enrolment."Created_users" ADD COLUMN "Employer_email" text')
            migration = Path(__file__).parent / 'migrations/0015_review_feedback_outbox.py'
            tree = ast.parse(migration.read_text(encoding='utf-8'))
            sql = next(ast.literal_eval(node.value) for node in tree.body
                       if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                       and node.targets[0].id == 'SQL')
            # The actual producer SQL runs only inside this verified sandbox.
            from django.db import transaction
            with transaction.atomic():
                cursor.execute(sql)

    def setUp(self):
        consumer._verify_connections(self.directory)
        names = [connections['default'].ops.quote_name(model._meta.db_table) for model in MODELS]
        names += ['"Learner".reviews', '"Feedback".review_feedback_outbox']
        with connections['default'].cursor() as cursor:
            cursor.execute('TRUNCATE ' + ','.join(names) + ' RESTART IDENTITY')
        self.now = timezone.now()
        self.publish = self.now - timedelta(days=10)
        self.completed = self.now - timedelta(days=1)
        QuerySet(EnrolmentUser, using='default').bulk_create([
            EnrolmentUser(id=71, aptem_id='503', learner_type='apprenticeship', email='one@example.test'),
            EnrolmentUser(id=72, aptem_id='504', learner_type='commercial', email='two@example.test'),
        ])
        QuerySet(LearnerProfile, using='default').bulk_create([
            LearnerProfile(id=17, enrolment_id=71, aptem_id=503, email='one@example.test'),
            LearnerProfile(id=18, enrolment_id=72, aptem_id=504, email='two@example.test'),
        ])
        kinds = ('post_mcm_review', 'post_progress_review', 'post_epa_review', 'post_progress_review_employer')
        QuerySet(FeedbackForm, using='default').bulk_create([FeedbackForm(id=index, title=kind, form_type=kind,
            status='published', is_current=True, published_at=self.publish, created_by='Synthetic')
            for index, kind in enumerate(kinds, start=1)])

    def review(self, source_id=9001, kind='Monthly Coaching Meeting', name='Synthetic review',
               status='Completed', completed='default', profile=17, data=None):
        completed = self.completed if completed == 'default' else completed
        with connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO "Learner".reviews
                (id,aptem_review_id,learner_id,learner_name,review_type,review_name,status,completed_date,review_data)
                VALUES(%s,%s,%s,'Synthetic learner',%s,%s,%s,%s,%s::jsonb)''',
                [source_id, f'SYNTHETIC-{source_id}', profile, kind, name, status, completed, json.dumps(data or {})])

    def run_once(self, **kwargs):
        return consumer.process_once(expected_data_directory=self.directory, **kwargs)

    def pending(self):
        with connections['default'].cursor() as cursor:
            cursor.execute('''SELECT count(*) FROM "Feedback".review_feedback_outbox
                WHERE processed_version<requested_version''')
            return cursor.fetchone()[0]

    def test_empty_pass_reads_pending_once_and_exits(self):
        connections.close_all()
        report = self.run_once(apply=True)
        self.assertEqual((report['selected'], report['attempted'], report['pendingReads']), (0, 0, 1))
        self.assertLessEqual(report['queries'], 12)
        MEASUREMENTS['empty'] = report

    def test_all_review_types_and_independent_employer_pending(self):
        for index, kind in enumerate(('Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)', 'Other'), start=9001):
            self.review(index, kind, name='Gateway Review' if kind == 'Other' else 'Synthetic review')
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated'], report['acknowledged']), (4, 2, 4))
        self.assertEqual(FeedbackEmployerReviewDelivery.objects.filter(employer_id__isnull=True).count(), 2)
        self.assertEqual(self.pending(), 0)
        self.assertEqual(set(FeedbackReviewDelivery.objects.values_list('learner_id', flat=True)), {'71'})
        MEASUREMENTS['mixed_types'] = report

    def test_dry_run_changes_neither_assignments_nor_queue(self):
        self.review(kind='Progress Review')
        report = self.run_once()
        self.assertEqual((report['wouldCreate'], report['employerWouldCreate'], report['previewed']), (1, 1, 1))
        self.assertEqual(FeedbackReviewDelivery.objects.count(), 0)
        self.assertEqual(FeedbackEmployerReviewDelivery.objects.count(), 0)
        self.assertEqual(self.pending(), 1)

    def test_strict_completion_and_signature_then_same_date(self):
        for index, (kind, name) in enumerate((('Monthly Coaching Meeting', 'Synthetic'),
                                            ('Progress Review', 'Synthetic'), ('Other', 'Gateway Review')), start=9001):
            self.review(index, kind, name, status='AwaitingSignature')
        report = self.run_once(apply=True)
        self.assertEqual(report['created'], 0)
        self.assertEqual(self.pending(), 0)
        with connections['default'].cursor() as cursor:
            cursor.execute('''UPDATE "Learner".reviews SET status='Completed' ''')
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated']), (3, 1))
        self.assertEqual(self.pending(), 0)

    def test_local_overlay_cannot_bypass_gate_but_existing_lms_path_is_preserved(self):
        self.review(status='AwaitingSignature')
        QuerySet(ImportedReviewInstance, using='default').bulk_create([ImportedReviewInstance(
            learner_id=17, source_review_id=9001, event_key='imported-review:SYNTHETIC-9001',
            owner_email='coach@example.test', status='completed', completed_at=self.completed)])
        # The newly agreed queue rule requires the source columns even if the
        # separate LMS completion path can already recognize its own overlay.
        self.assertEqual(self.run_once(apply=True)['created'], 0)
        self.assertEqual(FeedbackReviewDelivery.objects.count(), 0)
        self.assertEqual(self.pending(), 0)
        self.assertEqual(consumer.sync_review_feedback(71, source_review_id=9001)['created'], 1)

    def test_metadata_cannot_supply_either_missing_typed_column(self):
        metadata = {'source_metadata': {'Status': 'Completed', 'Completed Date': self.completed.isoformat()}}
        source_id = 9100
        for kind, name in (('Monthly Coaching Meeting', 'Synthetic'),
                           ('Progress Review', 'Synthetic'), ('Other', 'Gateway Review')):
            for status, date in ((None, self.completed), ('', self.completed),
                                 ('Completed', None), (None, None)):
                source_id += 1
                self.review(source_id, kind, name, status=status, completed=date, data=metadata)
                # Exercise the actual trigger for rows inserted without a date.
                # The restored values are the exact state the consumer evaluates.
                if date is None:
                    with connections['default'].cursor() as cursor:
                        cursor.execute('UPDATE "Learner".reviews SET status=%s WHERE id=%s',
                                       ['AwaitingSignature' if status == 'Completed' else 'Completed', source_id])
                        cursor.execute('UPDATE "Learner".reviews SET status=%s WHERE id=%s', [status, source_id])
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated'], report['blocked']), (0, 0, 3))
        self.assertEqual(FeedbackReviewDelivery.objects.count(), 0)
        self.assertEqual(FeedbackEmployerReviewDelivery.objects.count(), 0)

    def test_typed_columns_win_when_metadata_disagrees(self):
        metadata = {'source_metadata': {'Status': 'AwaitingSignature',
                                       'Completed Date': (self.publish - timedelta(days=1)).isoformat()}}
        for index, (kind, name) in enumerate((('Monthly Coaching Meeting', 'Synthetic'),
                                             ('Progress Review', 'Synthetic'), ('Other', 'Gateway Review')), start=9101):
            self.review(index, kind, name, data=metadata)
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated']), (3, 1))

    def test_completed_status_is_the_exact_source_value(self):
        for index, status in enumerate(('completed', ' Completed ', 'Complete', 'Finished'), start=9101):
            self.review(index, status=status)
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['incomplete']), (0, 4))

    def test_missing_source_fields_do_not_rewrite_an_existing_assignment(self):
        self.review()
        self.run_once(apply=True)
        original = FeedbackReviewDelivery.objects.get()
        with connections['default'].cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET status=NULL,completed_date=NULL WHERE id=9001')
        report = self.run_once(apply=True)
        self.assertEqual(report['created'], 0)
        current = FeedbackReviewDelivery.objects.get()
        self.assertEqual((current.pk, current.form_id, current.assigned_at, current.completed_at),
                         (original.pk, original.form_id, original.assigned_at, original.completed_at))

    def test_history_and_future_dates_are_not_assigned(self):
        self.review(9001, completed=self.publish - timedelta(seconds=1))
        self.review(9002, completed=self.now + timedelta(days=1))
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['historical'], report['blocked']), (0, 1, 1))
        self.assertEqual(self.pending(), 1)

    def test_missing_date_stays_visible_until_date_arrives(self):
        self.review(completed=None)
        with connections['default'].cursor() as cursor:
            cursor.execute("UPDATE \"Learner\".reviews SET status='Complete'")
            cursor.execute("UPDATE \"Learner\".reviews SET status='Completed'")
        self.assertEqual(self.run_once(apply=True)['blocked'], 1)
        self.assertEqual(self.pending(), 1)
        with connections['default'].cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET completed_date=%s', [self.completed])
        self.assertEqual(self.run_once(apply=True)['created'], 1)

    def test_identity_conflict_leaves_request_pending(self):
        self.review()
        QuerySet(LearnerProfile, using='default').filter(pk=17).update(aptem_id=999)
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['blocked']), (0, 1))
        self.assertEqual(self.pending(), 1)

    def test_commercial_identity_uses_enrolment_not_profile_id(self):
        self.review(profile=18)
        self.assertEqual(self.run_once(apply=True)['created'], 1)
        self.assertEqual(FeedbackReviewDelivery.objects.get().learner_id, '72')

    def test_employer_with_active_account_is_linked_independently(self):
        QuerySet(Employer, using='default').bulk_create([Employer(id=91, email='employer@example.test')])
        QuerySet(LoginAccount, using='default').bulk_create([LoginAccount(subject_type='employer', subject_id=91,
                                                       role='employer', is_active=True)])
        QuerySet(EnrolmentUser, using='default').filter(pk=71).update(employer_id=91)
        self.review(kind='Progress Review')
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated']), (1, 1))
        delivery = FeedbackEmployerReviewDelivery.objects.get()
        self.assertEqual((delivery.employer_id, delivery.pending_reason), (91, ''))

    def test_employer_draft_does_not_block_learner(self):
        FeedbackForm.objects.filter(form_type='post_progress_review_employer').update(status='draft')
        self.review(kind='Progress Review')
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['employerCreated']), (1, 0))
        self.assertEqual(self.pending(), 0)

    def test_no_current_template_does_not_fall_back(self):
        self.review()
        FeedbackForm.objects.filter(form_type='post_mcm_review').update(status='draft')
        self.assertEqual(self.run_once(apply=True)['created'], 0)
        self.assertEqual(FeedbackReviewDelivery.objects.count(), 0)

    def test_missing_source_is_acknowledged_explicitly(self):
        self.review()
        with connections['default'].cursor() as cursor:
            cursor.execute('DELETE FROM "Learner".reviews')
        report = self.run_once(apply=True)
        self.assertEqual((report['missingSource'], report['acknowledged']), (1, 1))

    def test_repeated_run_keeps_original_assignment(self):
        self.review()
        self.run_once(apply=True)
        original = FeedbackReviewDelivery.objects.get()
        with connections['default'].cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET completed_date=%s', [self.completed + timedelta(minutes=1)])
        report = self.run_once(apply=True)
        self.assertEqual((report['created'], report['existing']), (0, 1))
        current = FeedbackReviewDelivery.objects.get()
        self.assertEqual((current.pk, current.form_id, current.assigned_at), (original.pk, original.form_id, original.assigned_at))

    def test_1000_requests_processes_only_20_and_counts_real_queries(self):
        with connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO "Learner".reviews
                (id,aptem_review_id,learner_id,learner_name,review_type,review_name,status,completed_date,review_data)
                SELECT n,'SYNTHETIC-'||n,17,'Synthetic learner','Monthly Coaching Meeting','Synthetic','Completed',%s,'{}'
                FROM generate_series(1,1000) n''', [self.completed])
        connections.close_all()
        report = self.run_once(apply=True, max_queries=1000)
        self.assertEqual((report['selected'], report['attempted'], report['created'], report['pendingReads']), (20, 20, 20, 1))
        self.assertEqual(self.pending(), 980)
        self.assertLessEqual(report['queries'], 1000)
        self.assertLessEqual(report['totalQueries'], 1000)
        MEASUREMENTS['1000_pending_limit_20'] = report

    def test_query_budget_rolls_back_partial_work(self):
        for source_id in range(1, 21):
            self.review(source_id)
        report = self.run_once(apply=True, max_queries=35)
        self.assertEqual(report['stopped'], 'query_limit')
        self.assertLessEqual(report['queries'], 35)
        self.assertLessEqual(report['totalQueries'], 35)
        self.assertEqual(FeedbackReviewDelivery.objects.count(), report['created'])
        self.assertEqual(self.pending(), 20 - report['acknowledged'])
        MEASUREMENTS['query_cap_35'] = report

    def test_database_failures_are_not_retried_in_a_loop(self):
        for source_id in range(1, 21):
            self.review(source_id)
        with mock.patch.object(consumer, 'sync_review_feedback', side_effect=DatabaseError) as sync:
            report = self.run_once(apply=True)
        self.assertEqual((report['stopped'], report['attempted'], report['failed'], sync.call_count), ('error_limit', 3, 3, 3))
        self.assertEqual(self.pending(), 20)
        self.assertEqual(self.run_once(apply=True, limit=1)['created'], 1)

    def test_deadline_prevents_further_queries(self):
        clock = mock.Mock()
        clock.monotonic.side_effect = [0, 2, 2]
        with mock.patch.object(consumer, 'time', clock):
            report = self.run_once(max_seconds=1)
        self.assertEqual((report['stopped'], report['queries']), ('time_limit', 0))

    def test_running_statement_is_cancelled_at_deadline_without_ack(self):
        self.review(9001)
        self.review(9002)

        def slow(*args, **kwargs):
            with connections['default'].cursor() as cursor:
                cursor.execute('SELECT pg_sleep(1)')

        with mock.patch.object(consumer, 'sync_review_feedback', side_effect=slow):
            report = self.run_once(apply=True, max_seconds=0.15)
        self.assertEqual(report['stopped'], 'time_limit')
        self.assertLess(report['elapsedSeconds'], 0.8)
        self.assertEqual((self.pending(), FeedbackReviewDelivery.objects.count()), (2, 0))

    def test_query_cap_cannot_commit_only_half_a_learner_employer_pair(self):
        for source_id in range(1, 21):
            self.review(source_id, kind='Progress Review')
        report = self.run_once(apply=True, max_queries=100)
        self.assertEqual(report['stopped'], 'query_limit')
        self.assertLessEqual(report['totalQueries'], 100)
        self.assertEqual(FeedbackReviewDelivery.objects.count(), report['acknowledged'])
        self.assertEqual(FeedbackEmployerReviewDelivery.objects.count(), report['acknowledged'])
        self.assertEqual(self.pending(), 20 - report['acknowledged'])

    def test_non_pr_work_does_not_read_employer_assignments(self):
        self.review()
        statements = []

        def observed(execute, sql, params, many, context):
            statements.append(str(sql))
            return execute(sql, params, many, context)

        with connections['default'].execute_wrapper(observed):
            report = self.run_once(apply=True)
        self.assertEqual(report['created'], 1)
        self.assertFalse(any('feedback_employer_review_deliveries' in statement for statement in statements))

    def test_unsupported_source_is_acknowledged_without_assignment(self):
        self.review(kind='Personal Support Plan')
        report = self.run_once(apply=True)
        self.assertEqual((report['unsupportedSource'], report['created'], self.pending()), (1, 0, 0))

    def test_crash_rolls_back_assignment_and_preserves_request(self):
        self.review(kind='Progress Review')
        actual = consumer.sync_review_feedback

        def crash(*args, **kwargs):
            actual(*args, **kwargs)
            raise RuntimeError('Synthetic crash')

        with mock.patch.object(consumer, 'sync_review_feedback', side_effect=crash):
            with self.assertRaisesRegex(RuntimeError, 'Synthetic crash'):
                self.run_once(apply=True)
        self.assertEqual((FeedbackReviewDelivery.objects.count(), FeedbackEmployerReviewDelivery.objects.count()), (0, 0))
        self.assertEqual(self.pending(), 1)
        self.assertEqual(self.run_once(apply=True)['created'], 1)

    def test_new_version_during_processing_is_not_lost_or_blocked(self):
        self.review()
        actual = consumer.sync_review_feedback

        def changed(*args, **kwargs):
            result = actual(*args, **kwargs)
            # A separate local writer runs the real producer concurrently.
            config = connections['default'].settings_dict
            import psycopg
            with psycopg.connect(host=config['HOST'], port=config['PORT'], dbname=config['NAME'],
                                 user=config['USER'], password=config['PASSWORD'],
                                 options='-c lock_timeout=500') as writer:
                writer.execute('UPDATE "Learner".reviews SET completed_date=%s WHERE id=9001',
                               [self.completed + timedelta(minutes=1)])
            return result

        with mock.patch.object(consumer, 'sync_review_feedback', side_effect=changed):
            self.assertEqual(self.run_once(apply=True)['created'], 1)
        self.assertEqual(self.pending(), 1)
        self.assertEqual(self.run_once(apply=True)['existing'], 1)

    def test_two_consumers_do_not_process_same_request(self):
        self.review()
        entered, release = threading.Event(), threading.Event()
        actual = consumer.sync_review_feedback

        def pause(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise RuntimeError('Synthetic worker timeout')
            return actual(*args, **kwargs)

        def first():
            try:
                return self.run_once(apply=True)
            finally:
                connections.close_all()

        with mock.patch.object(consumer, 'sync_review_feedback', side_effect=pause):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(first)
                try:
                    self.assertTrue(entered.wait(5))
                    self.assertEqual(self.run_once(apply=True).get('busy'), 1)
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=10)['created'], 1)
        self.assertEqual(FeedbackReviewDelivery.objects.count(), 1)

    def test_invalid_limits_and_application_targets_fail_before_any_query(self):
        with mock.patch.object(consumer, '_verify_connections') as verify:
            for options in ({'limit': 21}, {'max_queries': 1001}, {'max_seconds': 31}, {'max_errors': 0}):
                with self.assertRaises(consumer.ConsumerSafetyError):
                    self.run_once(**options)
            verify.assert_not_called()
        config = settings.DATABASES['default']
        with mock.patch.dict(config, {'HOST': 'production.example.invalid'}):
            with mock.patch.object(consumer, '_verify_connections') as verify:
                with self.assertRaises(consumer.ConsumerSafetyError):
                    self.run_once(apply=True)
                verify.assert_not_called()

    def test_command_defaults_to_preview_and_has_no_forever_option(self):
        self.review()
        output = StringIO()
        call_command('process_review_feedback_outbox', '--expected-data-directory', str(self.directory), stdout=output)
        report = json.loads(output.getvalue())
        self.assertFalse(report['apply'])
        self.assertEqual((report['wouldCreate'], self.pending()), (1, 1))
        with self.assertRaises(CommandError):
            call_command('process_review_feedback_outbox', '--expected-data-directory', str(self.directory), '--forever')

    def test_no_runtime_hook_imports_consumer(self):
        root = Path(__file__).resolve().parents[1]
        for file in (root / 'config/asgi.py', root / 'config/wsgi.py', root / 'engagement_api/apps.py'):
            tree = ast.parse(file.read_text(encoding='utf-8'))
            self.assertFalse(any(isinstance(node, ast.ImportFrom) and
                                 'review_feedback_consumer' in (node.module or '') for node in ast.walk(tree)))
