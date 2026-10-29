"""Imported Review feedback: source parity, launch boundaries and real races.

Unit tests mock all source/identity I/O. The ORM race/transaction checks use
only an explicitly created temporary SQLite database, never application DBs.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier, local
from types import SimpleNamespace
from unittest import TestCase, mock

from django.core.management import call_command
from django.db import DatabaseError, connections, transaction
from django.db.models.query import QuerySet
from django.test import SimpleTestCase, override_settings

from . import review_feedback as reviews, review_feedback_signals as signals
from .models import FeedbackForm, FeedbackReviewDelivery

UTC = timezone.utc
LAUNCH = datetime(2026, 10, 18, 12, tzinfo=UTC)
COMPLETED = LAUNCH + timedelta(days=1)
NOW = LAUNCH + timedelta(days=10)
SOURCE_ROWS = reviews._source_rows


def source_row(**changes):
    return {'id': 9001, 'aptem_review_id': 'SYNTHETIC-9001', 'learner_id': 17,
            'learner_name': 'Synthetic Learner', 'review_type': 'Monthly Coaching Meeting',
            'review_name': 'Synthetic review', 'status': 'Not Scheduled',
            'completed_date': None, 'review_data': {}, **changes}


def overlay(**changes):
    return SimpleNamespace(**{
        'pk': 31, 'source_review_id': 9001, 'learner_id': 17,
        'event_key': 'imported-review:SYNTHETIC-9001',
        'status': 'completed', 'completed_at': COMPLETED,
        'meeting_intelligence': {}, **changes,
    })


class CompletionStateTests(SimpleTestCase):
    @override_settings(TIME_ZONE='Europe/London')
    def test_source_states_and_dates_remain_separate(self):
        row = source_row()
        before = deepcopy(row)
        state = reviews.review_completion(row, overlay())
        self.assertTrue(state.lms_completed)
        self.assertFalse(state.aptem_completed)
        self.assertEqual(state.source, 'LMS')
        self.assertEqual(state.lms_completed_at, COMPLETED)
        self.assertIsNone(state.aptem_completed_at)
        self.assertEqual(row, before)

    def test_completion_status_aliases_and_metadata(self):
        for status in ('Completed', ' Complete ', 'FINISHED'):
            with self.subTest(status=status):
                state = reviews.review_completion(source_row(status=status, completed_date=COMPLETED))
                self.assertTrue(state.aptem_completed)
                self.assertEqual(state.source, 'Aptem')
        row = source_row(review_data='{"source_metadata": {"Status": "Finished", '
                                    '"Completed Date": "19 October 2026 at 10:30"}}')
        with override_settings(TIME_ZONE='Europe/London'):
            state = reviews.review_completion(row)
        self.assertTrue(state.aptem_completed)
        self.assertEqual(state.aptem_completed_at.isoformat(), '2026-10-19T10:30:00+01:00')

    def test_valid_source_date_alone_is_completion_but_invalid_date_is_not(self):
        self.assertTrue(reviews.review_completion(source_row(completed_date=COMPLETED)).completed)
        for value in (None, '', 'invalid', '2026-99-99'):
            with self.subTest(value=value):
                self.assertFalse(reviews.review_completion(source_row(completed_date=value)).completed)

    def test_status_without_date_is_completed_but_cannot_prove_launch_eligibility(self):
        state = reviews.review_completion(source_row(status='Complete', updated_at=NOW))
        self.assertTrue(state.completed)
        self.assertTrue(state.undated_completion)
        self.assertIsNone(state.first_completed_at)

    @override_settings(TIME_ZONE='Europe/London')
    def test_timezone_offsets_date_only_and_dst_use_business_zone(self):
        for value, expected in (
            ('2026-10-19T10:30:00+02:00', '2026-10-19T10:30:00+02:00'),
            ('2026-07-01', '2026-07-01T00:00:00+01:00'),
            ('2026-12-01', '2026-12-01T00:00:00+00:00'),
        ):
            self.assertEqual(reviews.completion_datetime(value).isoformat(), expected)

    def test_both_sources_keep_dates_and_use_earliest_completion(self):
        state = reviews.review_completion(source_row(status='Completed', completed_date=LAUNCH), overlay())
        self.assertEqual(state.source, 'both')
        self.assertEqual(state.aptem_completed_at, LAUNCH)
        self.assertEqual(state.lms_completed_at, COMPLETED)
        self.assertEqual(state.first_completed_at, LAUNCH)


class ReviewFeedbackSyncTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.learner = SimpleNamespace(pk=71)
        self.profile = SimpleNamespace(pk=17)
        self.form = FeedbackForm(id=81, form_type='post_mcm_review', published_at=LAUNCH)
        self.pr_form = FeedbackForm(id=82, form_type='post_progress_review', published_at=LAUNCH)
        forms = self.patch(FeedbackForm.objects, 'filter')
        forms.return_value.order_by.return_value = [self.form, self.pr_form]
        self.patch(reviews.EnrolmentUser.all_learners, 'filter').return_value.first.return_value = self.learner
        self.profile_lookup = self.patch(reviews, 'review_profile_for_source', return_value=self.profile)
        self.patch(reviews, 'source_for_learner', return_value=SimpleNamespace(kind='aptem', aptem_id=503))
        self.rows = self.patch(reviews, '_source_rows', return_value=[source_row()])
        self.overlays = self.patch(reviews.ImportedReviewInstance.objects, 'filter', return_value=[])
        self.existing = self.patch(FeedbackReviewDelivery.objects, 'filter', return_value=[])
        self.create = self.patch(FeedbackReviewDelivery.objects, 'get_or_create')
        self.create.side_effect = lambda **kwargs: (FeedbackReviewDelivery(
            source_review_id=kwargs['source_review_id'], **kwargs['defaults']), True)
        self.patch(reviews.timezone, 'now', return_value=NOW)
        self.warning = self.patch(reviews.logger, 'warning')

    def patch(self, target, name, **kwargs):
        return self.stack.enter_context(mock.patch.object(target, name, **kwargs))

    def sync(self):
        return reviews.sync_review_feedback('71')

    def test_lms_completion_works_when_aptem_is_not_scheduled_and_ids_differ(self):
        self.overlays.return_value = [overlay()]
        self.assertEqual(self.sync()['created'], 1)
        self.profile_lookup.assert_called_once_with(self.learner)
        self.rows.assert_called_once_with(17, None)
        defaults = self.create.call_args.kwargs['defaults']
        self.assertEqual(defaults['learner_id'], '71')
        self.assertEqual(defaults['completed_at'], COMPLETED)

    def test_aptem_completion_with_no_local_overlay_or_an_incomplete_overlay(self):
        self.rows.return_value = [source_row(status='Complete', completed_date=COMPLETED)]
        for overlays in ([], [overlay(status='in-progress', completed_at=None)]):
            with self.subTest(overlays=bool(overlays)):
                self.overlays.return_value = overlays
                self.assertEqual(self.sync()['created'], 1)

    def test_both_incomplete_create_nothing(self):
        self.overlays.return_value = [overlay(status='awaiting-signature', completed_at=None)]
        self.assertEqual(self.sync()['incomplete'], 1)
        self.create.assert_not_called()

    def test_no_published_template_does_not_read_or_assign_reviews(self):
        reviews.FeedbackForm.objects.filter.return_value.order_by.return_value = []
        self.assertEqual(self.sync()['created'], 0)
        self.rows.assert_not_called()
        self.create.assert_not_called()

    def test_completion_callback_with_missing_or_foreign_source_is_reported(self):
        self.rows.return_value = []
        result = reviews.sync_review_feedback('71', source_review_id=9001)
        self.assertEqual(result['unlinked'], 1)
        self.warning.assert_called_once()
        self.create.assert_not_called()

    def test_all_included_aliases_and_excluded_types(self):
        for kind, expected in (
            ('Monthly Coaching Meeting', self.form), (' Monthly Coaching ', self.form),
            ('mCm', self.form), ('Progress Review', self.pr_form),
            (' progress review (+ SKILLS RADAR) ', self.pr_form),
            ('Skills Radar', None), ('Gateway Review', None), ('Personal Support Plan', None),
            ('Progress Review extra', None), ('Monthly Coaching Meeting extra', None),
        ):
            with self.subTest(kind=kind):
                self.create.reset_mock()
                self.rows.return_value = [source_row(review_type=kind, completed_date=COMPLETED)]
                result = self.sync()
                self.assertEqual(result['created'], int(expected is not None))
                if expected:
                    self.assertIs(self.create.call_args.kwargs['defaults']['form'], expected)

    def test_review_feedback_sync_uses_publish_time_as_the_no_backfill_boundary(self):
        for completed, expected in ((LAUNCH - timedelta(microseconds=1), 0), (LAUNCH, 1), (COMPLETED, 1)):
            with self.subTest(completed=completed):
                self.rows.return_value = [source_row(completed_date=completed)]
                self.assertEqual(self.sync()['created'], expected)

    def test_old_completion_in_either_source_blocks_newer_completion(self):
        for row, local in (
            (source_row(completed_date=LAUNCH - timedelta(days=1)), overlay()),
            (source_row(completed_date=COMPLETED), overlay(completed_at=LAUNCH - timedelta(days=1))),
            (source_row(), overlay(meeting_intelligence={'reopenCompletedAt': '2026-10-01T10:00:00Z'})),
        ):
            with self.subTest(row=row):
                self.rows.return_value = [row]
                self.overlays.return_value = [local]
                self.assertEqual(self.sync()['historical'], 1)
        self.create.assert_not_called()

    def test_undated_completion_never_borrows_other_source_date_or_updated_at(self):
        self.rows.return_value = [source_row(status='Finished', updated_at=NOW)]
        self.overlays.return_value = [overlay()]
        self.assertEqual(self.sync()['undated'], 1)
        self.create.assert_not_called()
        self.warning.assert_called_once()

    def test_missing_local_completion_and_invalid_reopen_dates_are_reported(self):
        for local in (overlay(completed_at=None), overlay(meeting_intelligence={'reopenCompletedAt': 'invalid'})):
            with self.subTest(local=local):
                self.overlays.return_value = [local]
                self.assertEqual(self.sync()['undated'], 1)
        self.create.assert_not_called()

    def test_future_completion_waits_until_its_real_date(self):
        self.rows.return_value = [source_row(completed_date=NOW + timedelta(days=1))]
        self.assertEqual(self.sync()['future'], 1)
        self.create.assert_not_called()

    def test_existing_delivery_survives_later_aptem_completion_and_new_template(self):
        self.rows.return_value = [source_row(status='Completed', completed_date=COMPLETED)]
        self.overlays.return_value = [overlay()]
        self.existing.return_value = [SimpleNamespace(source_review_id=9001, learner_id='71', form_id=1)]
        self.assertEqual(self.sync()['existing'], 1)
        self.create.assert_not_called()

    def test_reopened_review_with_delivery_is_never_sent_again(self):
        self.existing.return_value = [SimpleNamespace(source_review_id=9001, learner_id='71')]
        for status in ('in-progress', 'completed'):
            self.overlays.return_value = [overlay(status=status)]
            self.assertEqual(self.sync()['existing'], 1)
        self.create.assert_not_called()

    def test_multiple_reviews_for_one_learner_do_not_share_local_completion(self):
        self.rows.return_value = [source_row(), source_row(id=9002, aptem_review_id='SYNTHETIC-9002')]
        self.overlays.return_value = [overlay(source_review_id=9002, event_key='imported-review:SYNTHETIC-9002')]
        result = self.sync()
        self.assertEqual((result['created'], result['incomplete']), (1, 1))
        self.assertEqual(self.create.call_args.kwargs['source_review_id'], 9002)

    def test_legacy_overlay_uses_exact_event_key_only(self):
        self.overlays.return_value = [overlay(source_review_id=None)]
        self.assertEqual(self.sync()['created'], 1)
        self.overlays.return_value = [overlay(source_review_id=None, event_key='imported-review:UNRELATED')]
        result = self.sync()
        self.assertEqual((result['created'], result['unlinked']), (0, 1))

    def test_ambiguous_legacy_and_cross_learner_links_are_reported(self):
        for overlays in ([overlay(learner_id=99)], [overlay(), overlay(pk=32, source_review_id=None)]):
            with self.subTest(overlays=len(overlays)):
                self.overlays.return_value = overlays
                self.assertEqual(self.sync()['identityConflicts'], 1)
        self.create.assert_not_called()

    def test_legacy_key_duplicated_across_source_rows_is_not_guessed(self):
        self.rows.return_value = [source_row(), source_row(id=9002)]
        self.overlays.return_value = [overlay(source_review_id=None)]
        self.assertEqual(self.sync()['identityConflicts'], 2)
        self.create.assert_not_called()

    def test_conflicting_aptem_learner_identity_and_existing_delivery_owner_fail_closed(self):
        self.rows.return_value = [source_row(completed_date=COMPLETED,
                                             review_data={'aptem_learner_id': 999})]
        self.assertEqual(self.sync()['identityConflicts'], 1)
        self.rows.return_value = [source_row(completed_date=COMPLETED)]
        self.existing.return_value = [SimpleNamespace(source_review_id=9001, learner_id='17')]
        self.assertEqual(self.sync()['identityConflicts'], 1)
        self.create.assert_not_called()

    def test_source_query_uses_profile_and_stable_review_id_without_status_filter(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.description = [('id',), ('learner_id',)]
        cursor.fetchall.return_value = [(9001, 17)]
        with mock.patch.object(reviews, 'connection', SimpleNamespace(cursor=mock.Mock(return_value=cursor))):
            self.assertEqual(SOURCE_ROWS(17, 9001), [{'id': 9001, 'learner_id': 17}])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, [17, 9001])
        self.assertIn('learner_id = %s AND id = %s', sql)
        self.assertNotIn("status =", sql)


@override_settings(DEBUG=True)
class CompletionHookTests(SimpleTestCase):
    def test_only_completion_saves_register_post_commit_work(self):
        for status, fields, raw, expected in (
            ('completed', {'status', 'completed_at'}, False, True),
            ('completed', None, False, True), ('completed', {'answers'}, False, False),
            ('in-progress', {'status'}, False, False), ('completed', {'status'}, True, False),
        ):
            with self.subTest(status=status, fields=fields, raw=raw), \
                    mock.patch.object(signals.transaction, 'on_commit') as commit:
                signals.imported_review_saved(None, overlay(status=status), 'default', raw=raw,
                                              update_fields=fields)
                self.assertEqual(commit.called, expected)

    @override_settings(DEBUG=False, LEARNER_FEEDBACK_ENABLED=True,
                       LEARNER_NON_LECTURE_FEEDBACK_ENABLED=False)
    def test_disabled_review_release_does_not_create_feedback(self):
        with mock.patch.object(signals.transaction, 'on_commit') as commit:
            signals.imported_review_saved(None, overlay(), 'default')
        commit.assert_not_called()

    def test_other_managed_review_families_do_not_schedule_feedback(self):
        with mock.patch.object(signals.transaction, 'on_commit') as commit:
            signals.imported_review_saved(None, overlay(template_snapshot={
                'templateSource': {'family': 'PSP'},
            }), 'default')
        commit.assert_not_called()

    def test_failed_callback_is_visible_and_does_not_undo_committed_completion(self):
        with (mock.patch.object(signals.transaction, 'on_commit') as commit,
              mock.patch.object(reviews, 'sync_completed_overlay', side_effect=DatabaseError('PRIVATE')),
              self.assertLogs(reviews.logger, level='WARNING') as logs):
            signals.imported_review_saved(None, overlay(), 'default')
            commit.call_args.args[0]()
        self.assertNotIn('PRIVATE', ''.join(logs.output))
        self.assertIn('pending', ''.join(logs.output))

    def test_post_commit_identity_translation_and_legacy_reconciliation(self):
        profile = SimpleNamespace(pk=17)
        learner = SimpleNamespace(pk=71)
        with (mock.patch.object(reviews.LearnerProfile.objects, 'filter') as query,
              mock.patch.object(reviews, 'enrolment_for_review_profile', return_value=learner),
              mock.patch.object(reviews, 'sync_review_feedback') as sync):
            query.return_value.first.return_value = profile
            reviews.sync_completed_overlay(overlay())
            sync.assert_called_once_with(71, source_review_id=9001)
            sync.reset_mock()
            reviews.sync_completed_overlay(overlay(source_review_id=None))
            sync.assert_called_once_with(71, source_review_id=None)

    def test_import_reconciliation_command_is_explicitly_scoped(self):
        result = {'created': 1, 'undated': 0}
        with mock.patch('engagement_api.management.commands.sync_review_feedback.sync_review_feedback',
                        return_value=result) as sync:
            output = StringIO()
            call_command('sync_review_feedback', '--learner-id=71', '--learner-id=71', stdout=output)
        sync.assert_called_once_with(71)
        self.assertIn('"created": 1', output.getvalue())


class IsolatedDeliveryTransactionTests(TestCase):
    """Actual ORM uniqueness/rollback checks in a disposable local SQLite file."""

    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        directory = self.stack.enter_context(TemporaryDirectory(prefix='lms-review-feedback-'))
        self.alias = 'isolated_review_feedback'
        config = deepcopy(connections.databases['default'])
        if config['ENGINE'] != 'django.db.backends.sqlite3':
            self.skipTest('Run with config.settings_sqlite_test; no application DB may be used.')
        config.update(NAME=str(Path(directory) / 'reviews.sqlite3'), TEST={},
                      OPTIONS={'timeout': 20}, CONN_MAX_AGE=0)
        connections.databases[self.alias] = config
        self.addCleanup(self.close_database)
        self.stack.enter_context(mock.patch.object(FeedbackForm._meta, 'db_table', 'review_test_forms'))
        self.stack.enter_context(mock.patch.object(FeedbackReviewDelivery._meta, 'db_table', 'review_test_deliveries'))
        with connections[self.alias].schema_editor() as schema:
            schema.create_model(FeedbackForm)
            schema.create_model(FeedbackReviewDelivery)
        form_manager = FeedbackForm.objects.db_manager(self.alias)
        self.deliveries = FeedbackReviewDelivery.objects.db_manager(self.alias)
        self.form = form_manager.create(title='Synthetic feedback', form_type='post_mcm_review',
                                        status='published', published_at=LAUNCH, created_by='Synthetic')
        self.stack.enter_context(mock.patch.object(FeedbackForm, 'objects', form_manager))
        self.stack.enter_context(mock.patch.object(FeedbackReviewDelivery, 'objects', self.deliveries))
        self.stack.enter_context(mock.patch.object(reviews.EnrolmentUser.all_learners, 'filter')) \
            .return_value.first.return_value = SimpleNamespace(pk=71)
        self.stack.enter_context(mock.patch.object(reviews, 'review_profile_for_source',
                                                   return_value=SimpleNamespace(pk=17)))
        self.stack.enter_context(mock.patch.object(reviews, 'source_for_learner',
                                                   return_value=SimpleNamespace(kind='aptem', aptem_id=503)))
        self.stack.enter_context(mock.patch.object(reviews, '_source_rows',
                                                   return_value=[source_row(completed_date=COMPLETED)]))
        self.stack.enter_context(mock.patch.object(reviews.ImportedReviewInstance.objects, 'filter', return_value=[]))
        self.stack.enter_context(mock.patch.object(reviews.timezone, 'now', return_value=NOW))

    def close_database(self):
        connections[self.alias].close()
        del connections[self.alias]
        connections.databases.pop(self.alias, None)

    def test_retry_and_recompletion_preserve_one_delivery_and_original_template(self):
        self.assertEqual(reviews.sync_review_feedback(71)['created'], 1)
        FeedbackForm.objects.filter(pk=self.form.pk).update(is_current=False)
        FeedbackForm.objects.create(title='Synthetic version two', form_type='post_mcm_review',
                                    template_key=self.form.template_key, version=2,
                                    status='published', published_at=LAUNCH, created_by='Synthetic')
        reviews._source_rows.return_value = [source_row(status='Finished',
                                                        completed_date=COMPLETED + timedelta(days=1))]
        self.assertEqual(reviews.sync_review_feedback(71)['existing'], 1)
        self.assertEqual(self.deliveries.count(), 1)
        self.assertEqual(self.deliveries.get().form_id, self.form.pk)
        self.assertEqual(self.deliveries.get().completed_at, COMPLETED)

    def test_transaction_rollback_keeps_recognition_retryable(self):
        with self.assertRaises(ValueError):
            with transaction.atomic(using=self.alias):
                self.assertEqual(reviews.sync_review_feedback(71)['created'], 1)
                raise ValueError('Synthetic rollback')
        self.assertEqual(self.deliveries.count(), 0)
        self.assertEqual(reviews.sync_review_feedback(71)['created'], 1)

    def test_two_workers_that_both_miss_the_delivery_create_exactly_one(self):
        barrier, seen = Barrier(2), local()
        original_get = QuerySet.get

        def race_get(query, *args, **kwargs):
            try:
                return original_get(query, *args, **kwargs)
            except FeedbackReviewDelivery.DoesNotExist:
                if query.model is FeedbackReviewDelivery and not getattr(seen, 'waited', False):
                    seen.waited = True
                    barrier.wait(timeout=10)
                raise

        def run():
            try:
                return reviews.sync_review_feedback(71)
            finally:
                connections[self.alias].close()

        with mock.patch.object(QuerySet, 'get', race_get), ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: run(), range(2)))
        self.assertEqual(sum(item['created'] for item in results), 1)
        self.assertEqual(self.deliveries.count(), 1)

    @override_settings(DEBUG=True)
    def test_rollback_does_not_deliver_and_commit_runs_the_completion_hook(self):
        with mock.patch.object(reviews, 'sync_completed_overlay') as sync:
            with self.assertRaises(ValueError):
                with transaction.atomic(using=self.alias):
                    signals.imported_review_saved(None, overlay(), self.alias, update_fields={'status'})
                    raise ValueError('Synthetic rollback')
            sync.assert_not_called()
            with transaction.atomic(using=self.alias):
                signals.imported_review_saved(None, overlay(), self.alias, update_fields={'status'})
                sync.assert_not_called()
            sync.assert_called_once()
