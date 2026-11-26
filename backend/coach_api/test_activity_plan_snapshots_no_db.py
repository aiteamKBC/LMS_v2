from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory

from . import activity_plan_snapshots as snapshots, activity_plan_events as events
from .services.dashboard.sections import learner_table_row


class ActivitySnapshotTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 13, 12, tzinfo=timezone.utc)
        self.plan = {'completed': 3, 'total': 12, 'percent': 25.0}
        self.payload = {'enrolmentId': 107, 'activityPlan': self.plan, 'completedRecords': 9,
                        'calculatedAt': self.now.isoformat()}
        self.row = SimpleNamespace(pk=1, scope_id='7', schema_version=1, payload=self.payload,
            expires_at=self.now+timedelta(hours=1), source_revision={})

    def test_saved_current_stale_failed_and_wrong_identity_are_distinct(self):
        fields = snapshots.snapshot_fields(self.row, 107, now=self.now)
        self.assertEqual(fields['activityPlan'], self.plan)
        self.assertEqual(fields['completedRecords'], 9)
        self.assertEqual(fields['activityPlanState'], 'ready')
        self.row.expires_at = self.now
        self.assertEqual(snapshots.snapshot_fields(self.row, 107, now=self.now)['activityPlanState'], 'updating')
        self.row.source_revision = {'error': True}
        self.assertEqual(snapshots.snapshot_fields(self.row, 107, now=self.now)['activityPlan'], self.plan)
        self.assertEqual(snapshots.snapshot_fields(self.row, 107, now=self.now)['activityPlanState'], 'unavailable')
        self.assertIsNone(snapshots.snapshot_fields(self.row, 108, now=self.now)['activityPlan'])
        self.assertIsNone(snapshots.snapshot_fields(None, 107, now=self.now)['activityPlan'])
        self.row.schema_version = 0
        self.assertIsNone(snapshots.snapshot_fields(self.row, 107, now=self.now)['activityPlan'])

    def test_empty_completed_plan_is_a_real_value(self):
        self.row.payload = {**self.payload, 'activityPlan': {'completed': 0, 'total': 0, 'percent': None}}
        self.assertEqual(snapshots.snapshot_fields(self.row, 107, now=self.now)['activityPlanState'], 'ready')

    def test_bulk_overlay_reauthorises_and_never_computes_a_plan(self):
        profiles, store = MagicMock(), MagicMock()
        profiles.annotate.return_value.filter.return_value.values_list.return_value = [(7, 107), (8, 108)]
        store.filter.return_value = [self.row]
        payload = {'learners': [{'id': '7', 'componentsCompleted': 1}, {'id': '8'}, {'id': '9'}]}
        with patch.object(snapshots.LearnerProfile.objects, 'using', return_value=profiles), \
             patch.object(snapshots, 'store', return_value=store), \
             patch.object(snapshots, 'ensure_profiles') as seed, patch.object(snapshots, 'start_worker'), \
             patch.object(snapshots, 'build_payload') as build, patch.object(snapshots.timezone, 'now', return_value=self.now):
            snapshots.attach_snapshots(' COACH@example.invalid ', payload)
        profiles.annotate.return_value.filter.assert_called_once_with(pk__in=[7, 8, 9], owner='coach@example.invalid', enrolment_id__isnull=False)
        store.filter.assert_called_once_with(scope_id__in=['7', '8'])
        seed.assert_called_once_with({8})
        build.assert_not_called()
        self.assertEqual(payload['learners'][0]['completedRecords'], 9)
        self.assertEqual(payload['learners'][0]['componentsCompleted'], 1)
        self.assertEqual(payload['learners'][1]['activityPlanState'], 'pending')
        self.assertEqual(payload['learners'][2]['activityPlanState'], 'unavailable')
        self.assertNotIn('sourceFingerprint', learner_table_row(payload['learners'][0]))
        self.assertEqual(learner_table_row(payload['learners'][0])['activityPlan'], self.plan)

    def test_projection_failure_does_not_fallback_to_expensive_read(self):
        profiles = MagicMock()
        profiles.annotate.return_value.filter.return_value.values_list.return_value = [(7, 107)]
        payload = {'learners': [{'id': '7', 'componentsCompleted': 9}]}
        with patch.object(snapshots.LearnerProfile.objects, 'using', return_value=profiles), \
             patch.object(snapshots, 'store', side_effect=RuntimeError()), \
             patch.object(snapshots, 'build_payload') as build, patch.object(snapshots.log, 'warning'):
            snapshots.attach_snapshots('coach@example.invalid', payload)
        self.assertEqual(payload['learners'][0]['activityPlanState'], 'unavailable')
        self.assertEqual(payload['learners'][0]['componentsCompleted'], 9)
        build.assert_not_called()

    def test_one_initial_queue_failure_does_not_hide_other_saved_learners(self):
        profiles, store = MagicMock(), MagicMock()
        profiles.annotate.return_value.filter.return_value.values_list.return_value = [(7, 107), (8, 108)]
        store.filter.return_value = [self.row]
        payload = {'learners': [{'id': '7'}, {'id': '8'}]}
        with patch.object(snapshots.LearnerProfile.objects, 'using', return_value=profiles), \
             patch.object(snapshots, 'store', return_value=store), patch.object(snapshots, 'start_worker'), \
             patch.object(snapshots, 'ensure_profiles', side_effect=RuntimeError()), \
             patch.object(snapshots.log, 'warning'), patch.object(snapshots.timezone, 'now', return_value=self.now):
            snapshots.attach_snapshots('coach@example.invalid', payload)
        self.assertEqual(payload['learners'][0]['activityPlan'], self.plan)
        self.assertEqual(payload['learners'][0]['activityPlanState'], 'ready')
        self.assertEqual(payload['learners'][1]['activityPlanState'], 'unavailable')

    def test_worker_does_not_exceed_database_wide_build_limit(self):
        store = MagicMock()
        store.filter.return_value.count.return_value = 4
        with patch.object(snapshots, 'store', return_value=store), \
             patch.object(snapshots.transaction, 'atomic'), patch.object(snapshots, 'connections'):
            self.assertIsNone(snapshots._claim())
        store.filter.return_value.update.assert_not_called()
        store.filter.return_value.order_by.assert_not_called()

    def test_builder_rejects_changed_sources_and_retains_each_learner_type(self):
        from . import dashboard_activity_plan, activity_plan_reconcile
        for kind in ('commercial', 'apprenticeship'):
            source = SimpleNamespace(pk=107, learner_type=kind)
            with patch.object(snapshots.LearnerProfile.objects, 'using') as profiles, \
                 patch.object(snapshots.EnrolmentUser.all_learners, 'using') as sources, \
                 patch.object(activity_plan_reconcile, 'fingerprints', side_effect=[{7: 'first'}, {7: 'changed'}]), \
                 patch.object(dashboard_activity_plan, 'plan_activity_counts', return_value={**self.plan, 'completedRecords': 9}) as counts:
                profiles.return_value.get.return_value = SimpleNamespace(pk=7, enrolment_id=107)
                sources.return_value.get.return_value = source
                with self.assertRaises(ValueError):
                    snapshots.build_payload(7, as_of=self.now)
                self.assertIs(counts.call_args.args[0], source)
                self.assertTrue(counts.call_args.kwargs['include_record_counts'])

    def test_successful_build_only_replaces_the_claimed_revision(self):
        store = MagicMock()
        store.filter.return_value.update.return_value = 1
        self.row.source_revision = {'token': 'claim'}
        with patch.object(snapshots, '_claim', return_value=self.row), \
             patch.object(snapshots, 'build_payload', return_value=self.payload), \
             patch.object(snapshots, 'store', return_value=store), \
             patch.object(snapshots.connections, 'close_all') as close:
            self.assertTrue(snapshots.refresh_one())
        store.filter.assert_called_once_with(pk=1, source_revision={'token': 'claim'}, expires_at=self.row.expires_at)
        self.assertEqual(store.filter.return_value.update.call_args.kwargs['payload'], self.payload)
        close.assert_called_once()

    def test_change_while_building_keeps_dirty_marker_and_old_value(self):
        store = MagicMock()
        store.filter.return_value.update.return_value = 0
        with patch.object(snapshots, '_claim', return_value=self.row), \
             patch.object(snapshots, 'build_payload', return_value=self.payload), \
             patch.object(snapshots, 'store', return_value=store), patch.object(snapshots.connections, 'close_all'):
            snapshots.refresh_one()
        self.assertEqual(store.filter.return_value.update.call_args_list[-1].kwargs, {'source_revision': {}})
        self.assertEqual(store.filter.call_args_list[0].kwargs['expires_at'], self.row.expires_at)

    def test_failure_retains_successful_payload_and_schedules_retry(self):
        store = MagicMock()
        with patch.object(snapshots, '_claim', return_value=self.row), \
             patch.object(snapshots, 'build_payload', side_effect=RuntimeError('private detail')), \
             patch.object(snapshots, 'store', return_value=store), patch.object(snapshots.connections, 'close_all'), \
             patch.object(snapshots.log, 'warning') as log:
            self.assertFalse(snapshots.refresh_one())
        change = store.filter.return_value.update.call_args.kwargs
        self.assertEqual(set(change), {'source_revision'})
        self.assertTrue(change['source_revision']['error'])
        self.assertNotIn('private detail', str(log.call_args))

    def test_invalidations_wait_for_commit_and_do_not_replace_values(self):
        store = MagicMock()
        with patch.object(snapshots.transaction, 'on_commit') as commit, patch.object(snapshots, 'store', return_value=store):
            snapshots.mark_dirty([7], using='enrolment')
            store.filter.assert_not_called()
            commit.call_args.args[0]()
        self.assertEqual(commit.call_args.kwargs, {'using': 'enrolment'})
        store.filter.assert_called_once_with(scope_id__in=['7'])
        self.assertEqual(set(store.filter.return_value.update.call_args.kwargs), {'expires_at'})

    def test_reconciliation_only_queues_changed_sources_and_does_not_postpone_existing_work(self):
        from . import activity_plan_reconcile as revisions
        store = MagicMock()
        store.filter.return_value.values_list.return_value = [('7', 'same'), ('8', 'old')]
        with patch.object(snapshots, 'store', return_value=store), patch.object(snapshots, 'mark_dirty') as dirty, \
             patch.object(revisions, 'fingerprints', return_value={7: 'same', 8: 'new'}), \
             patch.object(revisions.timezone, 'now', return_value=self.now):
            self.assertEqual(revisions.reconcile(), 1)
        dirty.assert_called_once_with([8])
        store.filter.assert_called_once_with(payload__has_key='sourceFingerprint', expires_at__gt=self.now)


class ActivityEventTests(SimpleTestCase):
    def test_progress_profile_and_source_changes_have_correct_identity(self):
        with patch.object(events, 'mark_dirty') as dirty, patch.object(events, 'mark_sources_dirty') as source:
            events.progress_changed(None, SimpleNamespace(learner_id=7), 'enrolment')
            events.profile_changed(None, SimpleNamespace(pk=8), 'enrolment')
            events.source_changed(None, SimpleNamespace(pk=107), 'enrolment')
        self.assertEqual([call.args for call in dirty.call_args_list], [([7],), ([8],)])
        source.assert_called_once_with([107], using='enrolment')

    def test_raw_writes_are_invalidated_only_after_success(self):
        factory = RequestFactory()
        with patch.object(events, 'mark_dirty') as dirty, patch.object(events, 'mark_sources_dirty') as source:
            for method, status in [('get', 200), ('post', 400), ('post', 403), ('post', 500)]:
                events.ActivityPlanInvalidationMiddleware(lambda r: SimpleNamespace(status_code=status))(
                    getattr(factory, method)('/curriculum_api/components'))
            dirty.assert_not_called()
            middleware = events.ActivityPlanInvalidationMiddleware(lambda r: SimpleNamespace(status_code=200))
            for path in ('/curriculum_api/performance/record/', '/curriculum_api/activity/record/',
                         '/curriculum_api/curriculum/modules/example/changes/', '/audit_api/read/'):
                middleware(factory.post(path))
            dirty.assert_not_called()
            request = factory.post('/curriculum_api/curriculum/modules/example/structure/')
            request.curriculum_changed = True
            middleware(request)
            middleware(factory.post('/learner_api/progress/apprenticeship/107/'))
            middleware(factory.patch('/learner_api/learning-plan/108/'))
        dirty.assert_called_once_with()
        self.assertEqual([call.args for call in source.call_args_list], [([107],), ([108],)])
