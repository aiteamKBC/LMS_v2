"""Actual queue ORM in a separately verified in-memory SQLite database; provider doubles."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import unittest
from io import StringIO
from unittest.mock import patch

from django.conf import settings
from django.core.cache import cache
from django.db import connections
from django.utils import timezone as clock

from coach_api.models import CoachingRecordingJob, CoachingCalendarIndex, CoachingCalendarMeeting
from coach_api import recordings_jobs as jobs
from coach_api import recordings_api as api
from coach_api import recordings_calendar_sync as sync
from coach_api import recordings_transport as transport
from coach_api import views
from coach_api.management.commands import process_coaching_recordings as process
from django.core.management.base import CommandError

OWNER = 'coach@example.invalid'
CONTEXT = {'owner': OWNER, 'event': 'event', 'start': '2026-10-20T09:00:00+00:00', 'end': '2026-10-20T10:00:00+00:00'}
EVENT = {'id': 'event', 'start': {'dateTime': CONTEXT['start']}, 'end': {'dateTime': CONTEXT['end']}}


class RecordingJobsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert settings.COACH_TEST_MODE
        assert all(config['ENGINE'] == 'django.db.backends.sqlite3' for config in settings.DATABASES.values())
        cls.alias = 'coaching_job_memory'
        config = deepcopy(connections['default'].settings_dict)
        config['NAME'] = ':memory:'
        connections.databases[cls.alias] = config
        assert connections[cls.alias].vendor == 'sqlite' and connections[cls.alias].settings_dict['NAME'] == ':memory:'
        with connections[cls.alias].schema_editor() as editor:
            editor.create_model(CoachingRecordingJob)
            editor.create_model(CoachingCalendarIndex)
            editor.create_model(CoachingCalendarMeeting)

    @classmethod
    def tearDownClass(cls):
        connections[cls.alias].close()
        del connections[cls.alias]
        del connections.databases[cls.alias]

    def setUp(self):
        cache.clear()
        self.addCleanup(patch.stopall)
        patch('socket.socket', side_effect=AssertionError('Live network forbidden')).start()
        patch.object(jobs.router, 'db_for_read', return_value=self.alias).start()
        patch.object(jobs.router, 'db_for_write', return_value=self.alias).start()
        patch.object(api, '_coaches', return_value=[{'email': OWNER, 'name': 'Coach'}]).start()
        self.workers = patch.object(jobs, 'start_workers', return_value=False).start()
        CoachingCalendarIndex.objects.using(self.alias).all().delete()
        CoachingRecordingJob.objects.using(self.alias).all().delete()

    def make(self, kind='evidence', context=None, **changes):
        context = context or CONTEXT
        defaults = {'key': jobs.job_key(kind, context), 'kind': kind, 'context': context, 'owner_email': OWNER,
                    'next_run_at': clock.now(), 'result': {'event': EVENT}, **changes}
        return CoachingRecordingJob.objects.using(self.alias).create(**defaults)

    def test_repeated_calendar_reads_coalesce_one_durable_job_and_publish_pending(self):
        start, end = datetime(2026, 10, 20, tzinfo=timezone.utc), datetime(2026, 10, 21, tzinfo=timezone.utc)
        for _ in range(3):
            result = jobs.calendar_snapshots([{'email': OWNER}], start, end)
            self.assertTrue(result[0]['pending'])
            self.assertIsNone(result[0]['events'])
        self.assertEqual(CoachingRecordingJob.objects.count(), 1)

    def failed_account(self, **changes):
        return self.make('calendar', {'owner': OWNER, 'start': '2026-10-19T00:00:00+00:00', 'end': '2026-10-20T00:00:00+00:00'},
            state='failed', error_code='calendar_not_found', retryable=False, attempts=1,
            next_run_at=clock.now() + timedelta(hours=24), **changes)

    def test_failed_account_is_reused_across_dates_without_becoming_pending_or_extending_deadline(self):
        previous = self.failed_account()
        start, end = datetime(2026, 10, 20, tzinfo=timezone.utc), datetime(2026, 10, 21, tzinfo=timezone.utc)
        for _ in range(3):
            result = jobs.calendar_snapshots([{'email': OWNER}], start, end)[0]
            self.assertEqual(result['error'], {'code': 'calendar_not_found', 'retryable': False})
            self.assertFalse(result['pending'])
            self.assertIsNone(result['events'])
        current = CoachingRecordingJob.objects.exclude(pk=previous.pk).get()
        self.assertEqual(current.next_run_at, previous.next_run_at)
        self.assertEqual(current.attempts, 0)
        self.assertIsNone(jobs.claim_job(('calendar',)))

    def test_manual_refresh_can_recover_an_account_and_new_success_overrides_old_window_failure(self):
        failed = self.failed_account()
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        jobs.ensure_jobs([('calendar', context)])
        self.assertIsNone(jobs.claim_job(('calendar',)))
        jobs.ensure_jobs([('calendar', context)], refresh=True)
        # A normal browser poll must not swallow an explicit retry before the
        # worker gets its slot, even while another window still has the error.
        jobs.ensure_jobs([('calendar', context)])
        current = jobs.claim_job(('calendar',))
        self.assertEqual(current.context, context)
        with patch.object(jobs.timezone, 'now', return_value=failed.updated_at + timedelta(seconds=1)):
            jobs.complete(current, {'events': []}, seconds=300)
        failed.refresh_from_db()
        self.assertEqual(failed.state, 'queued')
        self.assertEqual(failed.error_code, '')
        later = {**context, 'end': '2026-10-22T00:00:00+00:00'}
        found = jobs.ensure_jobs([('calendar', later)])
        self.assertEqual(found[jobs.job_key('calendar', later)].state, 'queued')
        self.assertIsNotNone(jobs.claim_job(('calendar',)))

    def test_account_pause_preserves_successful_snapshots_and_does_not_affect_other_coaches_or_evidence(self):
        # A real provider failure pauses other existing windows atomically.
        failed = self.failed_account()
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        old_success = clock.now() - timedelta(hours=1)
        saved = self.make('calendar', context, state='idle', result={'events': [EVENT]}, last_success_at=old_success)
        with patch.object(jobs, 'execute_job', side_effect=RuntimeError()), patch.object(jobs, 'calendar_failure',
                return_value={'code': 'calendar_not_found', 'retryable': False}):
            self.assertEqual(jobs.run_one(('calendar',)), 'failed')
        other = {**context, 'owner': 'other@example.invalid'}
        found = jobs.ensure_jobs([('calendar', context), ('calendar', other), ('evidence', CONTEXT)])
        current = found[saved.pk]
        self.assertEqual(current.result, {'events': [EVENT]})
        self.assertEqual(current.last_success_at, old_success)
        self.assertEqual(current.state, 'failed')
        self.assertEqual(found[jobs.job_key('calendar', other)].state, 'queued')
        self.assertEqual(found[jobs.job_key('evidence', CONTEXT)].state, 'queued')

    def test_expired_account_pause_allows_a_new_check(self):
        failed = self.failed_account()
        CoachingRecordingJob.objects.filter(pk=failed.pk).update(next_run_at=clock.now() - timedelta(seconds=1))
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        found = jobs.ensure_jobs([('calendar', context)])
        self.assertEqual(found[jobs.job_key('calendar', context)].state, 'queued')
        self.assertIsNotNone(jobs.claim_job(('calendar',)))

    def test_temporary_calendar_failure_does_not_pause_other_date_windows(self):
        failed = self.failed_account()
        CoachingRecordingJob.objects.filter(pk=failed.pk).update(error_code='calendar_timeout', retryable=True)
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        found = jobs.ensure_jobs([('calendar', context)])
        self.assertEqual(found[jobs.job_key('calendar', context)].state, 'queued')

    def test_each_account_failure_code_is_reused_but_invalid_window_requests_are_not(self):
        failed = self.failed_account()
        for index, code in enumerate(jobs.ACCOUNT_FAILURES + ('calendar_request_rejected',)):
            with self.subTest(code=code):
                CoachingRecordingJob.objects.filter(pk=failed.pk).update(error_code=code)
                context = {'owner': OWNER, 'start': f'2026-10-{21 + index}T00:00:00+00:00', 'end': f'2026-10-{22 + index}T00:00:00+00:00'}
                found = jobs.ensure_jobs([('calendar', context)])[jobs.job_key('calendar', context)]
                self.assertEqual(found.state, 'queued' if code == 'calendar_request_rejected' else 'failed')
                self.assertEqual(found.error_code, '' if code == 'calendar_request_rejected' else code)

    def test_provider_confirmed_account_failure_pauses_other_queued_windows_only(self):
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        failed = self.make('calendar', context)
        queued = self.make('calendar', {**context, 'end': '2026-10-22T00:00:00+00:00'},
            result={'events': [EVENT]}, last_success_at=clock.now() - timedelta(hours=1))
        evidence = self.make()
        with patch.object(jobs, 'execute_job', side_effect=RuntimeError('Provider-private diagnostic')), patch.object(jobs, 'calendar_failure',
                return_value={'code': 'calendar_mailbox_unavailable', 'retryable': False}):
            self.assertEqual(jobs.run_one(('calendar',)), 'failed')
        failed.refresh_from_db(); queued.refresh_from_db(); evidence.refresh_from_db()
        self.assertEqual(failed.state, 'failed')
        self.assertEqual(failed.next_run_at, queued.next_run_at)
        self.assertEqual(queued.result, {'events': [EVENT]})
        self.assertEqual(evidence.state, 'queued')
        self.assertIsNone(jobs.claim_job(('calendar',)))

    def test_account_failure_does_not_replace_another_running_calendar_lease(self):
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        self.make('calendar', context)
        running = []
        def fail(_row):
            running.append(self.make('calendar', {**context, 'end': '2026-10-22T00:00:00+00:00'},
                state='running', claim=jobs.uuid.uuid4(), lease_until=clock.now() + timedelta(minutes=10)))
            raise RuntimeError('Private provider response')
        with patch.object(jobs, 'execute_job', side_effect=fail), patch.object(jobs, 'calendar_failure',
                return_value={'code': 'calendar_access_denied', 'retryable': False}):
            self.assertEqual(jobs.run_one(('calendar',)), 'failed')
        claim = running[0].claim
        running[0].refresh_from_db()
        self.assertEqual(running[0].state, 'running')
        self.assertEqual(running[0].claim, claim)
        self.assertEqual(running[0].error_code, '')

    def test_stale_failed_claim_cannot_pause_other_windows(self):
        context = {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'}
        first = self.make('calendar', context)
        queued = []
        def fail(row):
            CoachingRecordingJob.objects.filter(pk=row.pk).update(claim=jobs.uuid.uuid4())
            queued.append(self.make('calendar', {**context, 'end': '2026-10-22T00:00:00+00:00'}))
            raise RuntimeError('Failure after lease was replaced')
        with patch.object(jobs, 'execute_job', side_effect=fail), patch.object(jobs, 'calendar_failure',
                return_value={'code': 'calendar_not_found', 'retryable': False}):
            self.assertEqual(jobs.run_one(('calendar',)), 'failed')
        first.refresh_from_db(); queued[0].refresh_from_db()
        self.assertEqual(first.state, 'running')
        self.assertEqual(queued[0].state, 'queued')

    def test_claim_is_exclusive_and_expired_lease_can_be_recovered_without_old_completion(self):
        self.make()
        first = jobs.claim_job(('evidence',))
        self.assertIsNone(jobs.claim_job(('evidence',)))
        CoachingRecordingJob.objects.filter(pk=first.pk).update(lease_until=clock.now()-timedelta(seconds=1), next_run_at=clock.now()-timedelta(seconds=1))
        second = jobs.claim_job(('evidence',))
        self.assertNotEqual(first.claim, second.claim)
        self.assertEqual(jobs.complete(first, {'stale': True}), 0)
        jobs.complete(second, {'current': True})
        self.assertEqual(CoachingRecordingJob.objects.get().result, {'current': True})

    def test_slow_calendar_has_one_slot_and_recordings_keep_two_slots_without_archive_claims(self):
        for index in range(4):
            self.make(context={**CONTEXT, 'event': str(index)})
        self.make('archive')
        self.make('archive', context={**CONTEXT, 'recording': 'second'})
        self.make('calendar', {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'})
        self.assertIsNotNone(jobs.claim_job(('calendar',)))
        self.assertIsNone(jobs.claim_job(('calendar',)))
        for _ in range(2):
            self.assertIsNotNone(jobs.claim_job(('evidence',)))
        self.assertIsNone(jobs.claim_job(('evidence',)))
        self.assertIsNone(jobs.claim_job(('archive',)))
        self.assertEqual(CoachingRecordingJob.objects.filter(kind='archive', state='queued').count(), 2)

    def test_new_calendar_navigation_is_not_blocked_by_older_evidence_work(self):
        self.make()
        self.make('calendar', {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'})
        self.assertEqual(jobs.claim_job(('calendar', 'evidence')).kind, 'calendar')

    def test_selected_coach_evidence_gets_priority_over_unfocused_backlog(self):
        focused = self.make()
        self.make(context={**CONTEXT, 'event': 'unfocused'})
        start, end = datetime(2026, 10, 20, tzinfo=timezone.utc), datetime(2026, 10, 21, tzinfo=timezone.utc)
        self.make('calendar', {'owner': OWNER, 'start': start.isoformat(), 'end': end.isoformat()},
            result={'events': [EVENT]}, state='idle', last_success_at=clock.now(), next_run_at=clock.now()+timedelta(hours=1))
        # Windows clocks can give every fast fixture write the same tick.
        # Model a later foreground request explicitly instead of sleeping.
        later = clock.now() + timedelta(seconds=5)
        with patch.object(jobs.timezone, 'now', return_value=later):
            jobs.calendar_snapshots([{'email': OWNER}], start, end)
            self.assertEqual(jobs.claim_job(('evidence',)).key, focused.key)

    def test_calendar_publishes_events_and_enqueues_ended_evidence_with_event_seed(self):
        row = self.make('calendar', {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'})
        row = jobs.claim_job(('calendar',))
        with patch('coach_api.recordings_calendar.load_coach_calendar', return_value=[EVENT]):
            jobs.execute_job(row)
        self.assertEqual(CoachingRecordingJob.objects.get(pk=row.pk).result['events'], [EVENT])
        evidence = CoachingRecordingJob.objects.get(kind='evidence')
        self.assertEqual(evidence.result['event'], EVENT)
        self.assertEqual(evidence.context, CONTEXT)

    def test_successful_calendar_publishes_index_in_the_same_generation(self):
        context = {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'}
        self.make('calendar', context)
        row = jobs.claim_job(('calendar',))
        with patch('coach_api.recordings_calendar.load_coach_calendar', return_value=[EVENT]):
            jobs.execute_job(row)
        saved = CoachingRecordingJob.objects.get(pk=row.pk)
        projection = CoachingCalendarIndex.objects.get(pk=row.pk)
        self.assertEqual(projection.source_success_at, saved.last_success_at)
        self.assertEqual(projection.event_count, 1)
        self.assertEqual(CoachingCalendarMeeting.objects.get().event['id'], EVENT['id'])

    def test_index_failure_rolls_back_calendar_success_and_retains_previous_snapshot(self):
        row = self.make('calendar', {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'},
                        result={'events': [EVENT]})
        row = jobs.claim_job(('calendar',))
        with patch('coach_api.recordings_index.publish_calendar_index', side_effect=RuntimeError('Index unavailable')):
            with self.assertRaises(RuntimeError):
                jobs.complete(row, {'events': []})
        saved = CoachingRecordingJob.objects.get(pk=row.pk)
        self.assertEqual(saved.result, {'events': [EVENT]})
        self.assertEqual(saved.state, 'running')
        self.assertIsNone(saved.last_success_at)

    def test_stale_calendar_claim_cannot_replace_a_successful_index(self):
        self.make('calendar', {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'})
        stale = jobs.claim_job(('calendar',))
        current = jobs.claim_job(('calendar',))
        self.assertIsNone(current)
        self.assertEqual(jobs.complete(stale, {'events': [EVENT]}), 1)
        with patch('coach_api.recordings_index.publish_calendar_index') as publish:
            self.assertEqual(jobs.complete(stale, {'events': []}), 0)
        publish.assert_not_called()
        self.assertEqual(CoachingCalendarIndex.objects.get().event_count, 1)

    def test_indexed_month_reads_only_selected_day_without_legacy_json(self):
        from coach_api.recordings_index import publish_calendar_index
        context = {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'}
        stamp = clock.now()
        row = self.make('calendar', context, result={'events': [EVENT]}, state='idle', last_success_at=stamp,
                        next_run_at=stamp+timedelta(hours=1))
        publish_calendar_index(row.key, context, [EVENT], stamp)
        with patch.object(jobs, 'cached_results', side_effect=AssertionError('Legacy source JSON must not be loaded')):
            result = jobs.calendar_snapshots([{'email': OWNER}], datetime(2026,10,21,tzinfo=timezone.utc),
                                            datetime(2026,10,22,tzinfo=timezone.utc))
        self.assertEqual(result[0]['events'], [])
        self.assertFalse(result[0]['pending'])

    def test_provider_failure_retains_index_and_reports_the_error_with_saved_events(self):
        context = {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'}
        self.make('calendar', context)
        self.assertEqual(jobs.complete(jobs.claim_job(('calendar',)), {'events': [EVENT]}, seconds=300), 1)
        stamp = CoachingCalendarIndex.objects.get().source_success_at
        CoachingRecordingJob.objects.filter(kind='calendar').update(next_run_at=clock.now()-timedelta(seconds=1))
        with patch('coach_api.recordings_calendar.load_coach_calendar', side_effect=RuntimeError('Provider unavailable')):
            self.assertEqual(jobs.run_one(('calendar',)), 'failed')
        snapshot = jobs.calendar_snapshots([{'email': OWNER}], datetime(2026,10,20,tzinfo=timezone.utc),
                                          datetime(2026,10,21,tzinfo=timezone.utc))[0]
        self.assertEqual(snapshot['events'][0]['id'], EVENT['id'])
        self.assertIsNotNone(snapshot['error'])
        self.assertEqual(CoachingCalendarIndex.objects.get().source_success_at, stamp)

    def test_saved_month_serves_a_day_without_creating_or_fetching_another_calendar(self):
        month = {'owner': OWNER, 'start': '2026-10-01T00:00:00+00:00', 'end': '2026-11-01T00:00:00+00:00'}
        self.make('calendar', month, result={'events': [EVENT]}, state='idle', last_success_at=clock.now(), next_run_at=clock.now()+timedelta(hours=1))
        result = jobs.calendar_snapshots([{'email': OWNER}], datetime(2026,10,20,tzinfo=timezone.utc), datetime(2026,10,21,tzinfo=timezone.utc))
        self.assertEqual(result[0]['events'], [EVENT])
        self.assertFalse(result[0]['pending'])
        self.assertEqual(CoachingRecordingJob.objects.filter(kind='calendar').count(), 1)

    def test_verified_source_is_not_download_probed_again_inside_twenty_four_hours(self):
        artifact = {'graph_artifact_id': 'file', 'sourceAvailable': True, 'sourceCheckedAt': clock.now().isoformat()}
        self.make(result={'event': EVENT, 'artifacts': [artifact]})
        row = jobs.claim_job(('evidence',))
        with patch.object(sync, 'fetch_recordings', return_value=('users/coach/onlineMeetings/meeting', OWNER, [{'graph_artifact_id': 'file'}])), \
                patch.object(transport, 'recording_accessible') as probe, patch.object(sync, 'fetch_attendance') as attendance:
            jobs.execute_job(row)
        probe.assert_not_called()
        attendance.assert_not_called()
        self.assertEqual(jobs.source_summary(CoachingRecordingJob.objects.get(pk=row.pk))['readyCount'], 1)

    def test_only_an_opened_meeting_queues_attendance_and_failure_cannot_clear_ready_recording(self):
        self.make(result={'event': EVENT, 'base': 'users/coach/onlineMeetings/meeting', 'artifacts': [{'graph_artifact_id': 'file', 'sourceAvailable': True}]})
        self.assertFalse(CoachingRecordingJob.objects.filter(kind='attendance').exists())
        record = SimpleNamespace(owner_email=OWNER, graph_event_id='event', calendar_window=(datetime.fromisoformat(CONTEXT['start']), datetime.fromisoformat(CONTEXT['end'])))
        for _ in range(2):
            jobs.queue_attendance(record)
        self.assertEqual(CoachingRecordingJob.objects.filter(kind='attendance').count(), 1)
        with patch.object(sync, 'fetch_attendance', side_effect=RuntimeError('Report unavailable')), \
                patch.object(views, 'persist_coach_meeting_snapshots') as persist:
            self.assertEqual(jobs.run_one(('attendance',)), 'failed')
        persist.assert_not_called()
        self.assertEqual(jobs.source_summary(jobs.source_details(record))['readyCount'], 1)

    def test_on_demand_attendance_persists_actual_reports_only_after_success(self):
        artifact = {'graph_artifact_id': 'file', 'sourceAvailable': True}
        self.make(result={'base': 'users/coach/onlineMeetings/meeting', 'organizer': OWNER, 'artifacts': [artifact]})
        self.make('attendance')
        report = {'id': 'actual', 'records': [{'id': 'person', 'displayName': 'Reported Participant', 'totalAttendanceSeconds': 60}]}
        with patch.object(sync, 'fetch_attendance', return_value=[report]) as read, \
                patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': True}) as persist:
            self.assertEqual(jobs.run_one(('attendance',)), 'complete')
        read.assert_called_once_with(CONTEXT, 'users/coach/onlineMeetings/meeting')
        self.assertEqual(persist.call_args.kwargs['artifacts'], [artifact])
        self.assertEqual(persist.call_args.kwargs['attendance_reports'], [report])
        self.assertEqual(persist.call_args.kwargs['attendance_tracker']['tracker'][0]['status'], 'attended')

    def test_calendar_is_not_published_idle_before_evidence_jobs_exist(self):
        self.make('calendar', {'owner': OWNER, 'start': '2026-10-20T00:00:00+00:00', 'end': '2026-10-21T00:00:00+00:00'})
        row = jobs.claim_job(('calendar',))
        original = jobs.ensure_jobs
        def enqueue(items, **kwargs):
            self.assertEqual(CoachingRecordingJob.objects.get(pk=row.pk).state, 'running')
            return original(items, **kwargs)
        with patch('coach_api.recordings_calendar.load_coach_calendar', return_value=[EVENT]), \
                patch.object(jobs, 'ensure_jobs', side_effect=enqueue):
            jobs.execute_job(row)
        self.assertEqual(CoachingRecordingJob.objects.get(pk=row.pk).state, 'idle')

    def test_evidence_is_ready_from_microsoft_without_creating_any_archive_job_or_booking(self):
        self.make()
        row = jobs.claim_job(('evidence',))
        artifact = {'graph_artifact_id': 'file', 'created_datetime': CONTEXT['start'], 'end_datetime': CONTEXT['end']}
        with patch.object(sync, 'fetch_recordings', return_value=('users/coach/onlineMeetings/meeting', OWNER, [artifact])), \
                patch.object(transport, 'recording_accessible', return_value=True), \
                patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': True}) as persist:
            jobs.execute_job(row)
        saved = CoachingRecordingJob.objects.get(pk=row.pk)
        media = jobs.source_summary(saved)
        self.assertEqual(media['readyCount'], 1)
        self.assertEqual(media['recordings'][0]['source'], 'microsoft')
        self.assertNotIn('archiveState', media['recordings'][0])
        persist.assert_not_called()
        self.assertFalse(CoachingRecordingJob.objects.filter(kind='archive').exists())

    def test_unreadable_content_is_not_ready_and_no_archive_is_scheduled(self):
        self.make()
        row = jobs.claim_job(('evidence',))
        with patch.object(sync, 'fetch_recordings', return_value=('users/coach/onlineMeetings/meeting', OWNER, [{'graph_artifact_id': 'file'}])), \
                patch.object(transport, 'recording_accessible', side_effect=RuntimeError()), \
                patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': True}):
            jobs.execute_job(row)
        media = jobs.source_summary(CoachingRecordingJob.objects.get(pk=row.pk))
        self.assertEqual(media['readyCount'], 0)
        self.assertFalse(CoachingRecordingJob.objects.filter(kind='archive').exists())

    def test_source_availability_alone_determines_ready_and_azure_fields_are_never_emitted(self):
        job = SimpleNamespace(result={'artifacts': [{'graph_artifact_id': 'file', 'sourceAvailable': True}]}, error_code='')
        for available in (True, False):
            job.result['artifacts'][0]['sourceAvailable'] = available
            media = jobs.source_summary(job)
            self.assertEqual(media['readyCount'], int(available))
            self.assertEqual(media['recordings'][0]['source'], 'microsoft')
            self.assertNotIn('archiveState', media['recordings'][0])

    def test_archive_only_processor_exits_before_attempting_any_job(self):
        with patch.object(process, 'run_one') as run:
            with self.assertRaisesRegex(CommandError, 'SharePoint only'):
                process.Command(stdout=StringIO()).handle(limit=5, coach_email=OWNER, kind='archive')
        run.assert_not_called()

    def test_all_processor_processes_only_metadata_even_with_old_archive_rows(self):
        with patch.object(process, 'run_one', return_value=None) as run:
            process.Command(stdout=StringIO()).handle(limit=5, coach_email=OWNER, kind='all')
        run.assert_called_once_with(('calendar', 'evidence', 'attendance'), owner=OWNER)

    def test_native_booking_looks_up_the_same_microsoft_occurrence_job(self):
        source = self.make()
        record = SimpleNamespace(owner_email=OWNER, graph_event_id='event', calendar_window=(
            datetime.fromisoformat(CONTEXT['start']), datetime.fromisoformat(CONTEXT['end'])))
        self.assertEqual(jobs.source_details(record).key, source.key)

    def test_failed_job_retains_previous_success_and_backoff_instead_of_empty_success(self):
        self.make(result={'artifacts': [{'graph_artifact_id': 'file', 'sourceAvailable': True}]}, last_success_at=clock.now())
        with patch.object(jobs, 'execute_job', side_effect=RuntimeError('Provider body must not be stored')):
            self.assertTrue(jobs.run_one())
        row = CoachingRecordingJob.objects.get()
        self.assertEqual(row.state, 'failed')
        self.assertEqual(row.error_code, 'evidence_unavailable')
        self.assertIn('artifacts', row.result)
        self.assertGreater(row.next_run_at, clock.now())
        self.assertIsNone(jobs.claim_job(('evidence',)))

    def test_revoked_owner_cannot_trigger_provider_or_upload(self):
        row = self.make()
        with patch.object(api, '_coaches', return_value=[]), patch.object(sync, 'fetch_recordings') as read:
            with self.assertRaises(PermissionError):
                jobs.execute_job(row)
        read.assert_not_called()

    def test_calendar_projection_reads_files_without_returning_participant_reports(self):
        self.make(result={'artifacts': [{'graph_artifact_id': 'file', 'sourceAvailable': True}],
                          'reports': [{'private': 'Actual participant data'}]}, last_success_at=clock.now())
        result = jobs.evidence_jobs([CONTEXT])
        row = next(iter(result.values()))
        self.assertEqual(row.result['artifacts'][0]['graph_artifact_id'], 'file')
        self.assertNotIn('reports', row.result)

    def test_snapshot_cache_reads_large_json_once_and_invalidates_on_new_success(self):
        saved = self.make(result={'artifacts': [{'graph_artifact_id': 'one', 'sourceAvailable': True}]}, last_success_at=clock.now())
        statements = []
        def count(execute, sql, params, many, context):
            statements.append(sql)
            return execute(sql, params, many, context)
        with connections[self.alias].execute_wrapper(count):
            first = jobs.evidence_jobs([CONTEXT])
            statements.clear()
            second = jobs.evidence_jobs([CONTEXT])
        self.assertEqual(len(statements), 1)
        self.assertNotIn('"result"', statements[0])
        self.assertEqual(next(iter(first.values())).result, next(iter(second.values())).result)
        CoachingRecordingJob.objects.filter(pk=saved.pk).update(result={'artifacts': [{'graph_artifact_id': 'two'}]}, last_success_at=clock.now()+timedelta(seconds=1))
        self.assertEqual(next(iter(jobs.evidence_jobs([CONTEXT]).values())).result['artifacts'][0]['graph_artifact_id'], 'two')

    def test_scheduler_command_exits_unsuccessfully_when_a_job_fails(self):
        with patch.object(process, 'run_one', side_effect=['failed', None]):
            with self.assertRaisesRegex(CommandError, 'Some coaching recording jobs failed'):
                process.Command(stdout=StringIO()).handle(limit=10, coach_email=OWNER, kind='metadata')
