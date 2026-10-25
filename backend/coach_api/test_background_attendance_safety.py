"""Background action regressions. Graph/storage are synthetic; no live I/O."""
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import timedelta
from io import StringIO
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from django.utils import timezone

from . import test_aptem_attendance_stabilization as fixtures
from . import views
from .management.commands import sync_coach_meeting_snapshots as command


class BackgroundAttendanceTests(SimpleTestCase):
    def test_verified_attendance_starts_initialized_scheduled_reviews(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.run_command()
                self.assertEqual(self.overlay.status, 'in-progress')

    def test_complete_transcript_starts_all_families_but_partial_or_other_call_never_does(self):
        for family in fixtures.FAMILIES:
            for kind in ('complete', 'partial-page', 'partial-body', 'other-call', 'recording'):
                with self.subTest(family=family, kind=kind):
                    self.prepare(family)
                    report, _ = self.report()
                    row = {'artifact_type': 'recording' if kind == 'recording' else 'transcript',
                        'graph_artifact_id': 'segment-1', 'call_id': 'call-1',
                        'created_datetime': report['meetingStartDateTime'], 'end_datetime': report['meetingEndDateTime'],
                        'transcript_text': 'Synthetic complete transcript'}
                    artifacts = [row]
                    if kind == 'partial-body':
                        artifacts.append({**row, 'graph_artifact_id': 'segment-2', 'transcript_fetch_error': 'Unavailable'})
                    if kind == 'other-call':
                        artifacts.append({**row, 'graph_artifact_id': 'segment-2', 'call_id': 'different-call'})
                    real_fetch = command.fetch_coach_meeting_graph_snapshot
                    def fetch(*args, **kwargs):
                        snapshot, error, status = real_fetch(*args, **kwargs)
                        snapshot.update(artifacts=artifacts, transcriptCollectionComplete=kind != 'partial-page')
                        return snapshot, error, status
                    with patch.object(command, 'fetch_coach_meeting_graph_snapshot', side_effect=fetch):
                        self.run_command()
                    self.assertEqual(self.overlay.status, 'in-progress' if kind == 'complete' else 'scheduled')

    def test_reopened_current_scheduled_revision_starts_without_changing_archive_metadata(self):
        self.prepare('PSP')
        self.overlay.meeting_intelligence = {'reviewRevision': 2, 'reopenCompletedAt': '2026-10-01T10:00:00Z'}
        self.load_report()
        self.run_command()
        self.assertEqual(self.overlay.status, 'in-progress')

    def test_no_evidence_never_starts_and_repeated_refresh_saves_status_once(self):
        self.prepare('PR')
        self.run_command()
        self.assertEqual(self.overlay.status, 'scheduled')
        self.load_report()
        self.run_command()
        self.run_command()
        self.overlay.save.assert_called_once_with(update_fields=['status', 'updated_at'])

    setUp = fixtures.AptemAttendanceRefreshTests.setUp
    report = fixtures.AptemAttendanceRefreshTests.report
    graph = fixtures.AptemAttendanceRefreshTests.graph
    persist = fixtures.AptemAttendanceRefreshTests.persist
    load_report = fixtures.AptemAttendanceRefreshTests.load_report
    assert_attended = fixtures.AptemAttendanceRefreshTests.assert_attended

    def prepare(self, family):
        fixtures.AptemAttendanceRefreshTests.prepare(self, family)
        self.overlay.template_snapshot = {'sections': [{'key': 'section', 'fields': []}]}
        self.overlay.completed_at = None
        self.overlay.migrated_signatures = Mock()
        self.overlay.migrated_signatures.exists.return_value = False
        self.record.save = Mock()
        self.stored['storage'] = {'stored': True}
        self.during_fetch = None
        self.current_record = self.record

    def publish_manual_result(self):
        report, detail = self.report()
        serialized = views.serialize_coach_meeting_attendance_report(report, detail)
        tracker = views.build_coach_meeting_attendance_tracker(fixtures.EXPECTED, serialized['records'], has_report=True)
        self.persist(self.record, artifacts=[], attendance_reports=[serialized], attendance_tracker=tracker)
        self.stored['storage']['syncedAt'] = timezone.now().isoformat()

    def run_command(self, *, native=False, dry_run=False, expected_revision=None):
        before = deepcopy((self.overlay.answers, self.overlay.status, self.overlay.template_snapshot, self.overlay.meeting_intelligence))
        output = StringIO()
        runner = command.Command(stdout=output)
        real_persist = views.persist_coach_meeting_snapshots
        def storage_boundary(record, **kwargs):
            if kwargs.get('imported_refresh') is not None:
                return real_persist(record, **kwargs)
            kwargs.pop('safe_diagnostics', None)
            self.last_artifacts = deepcopy(kwargs['artifacts'])
            return self.persist(record, **kwargs)
        with ExitStack() as stack:
            def mock(target, **kwargs):
                return stack.enter_context(patch(target, **kwargs))
            mock('coach_api.views.has_graph_credentials', return_value=True)
            mock('coach_api.views.coach_meeting_graph_target', return_value=(self.base, None))
            def graph(method, path, *args, **kwargs):
                response = self.graph(method, path, *args, **kwargs)
                if path.endswith('/recordings') and getattr(self, 'during_fetch', None):
                    self.during_fetch()
                return response
            mock('coach_api.views.microsoft_graph_request', side_effect=graph)
            mock('coach_api.views.coach_meeting_expected_attendees', return_value=fixtures.EXPECTED)
            mock('coach_api.views.stored_coach_meeting_snapshot', side_effect=lambda *a, **k: deepcopy(self.stored))
            mock('coach_api.management.commands.sync_coach_meeting_snapshots.stored_coach_meeting_snapshot',
                 side_effect=lambda *a, **k: deepcopy(self.stored), create=True)
            mock('coach_api.views.persist_coach_meeting_snapshots', side_effect=storage_boundary)
            mock('coach_api.management.commands.sync_coach_meeting_snapshots.persist_coach_meeting_snapshots', side_effect=storage_boundary)
            mock('coach_api.management.commands.sync_coach_meeting_snapshots.coach_meeting_snapshot_tables_ready', return_value=True)
            mock('coach_api.management.commands.sync_coach_meeting_snapshots.close_old_connections')
            transition = mock('coach_api.management.commands.sync_coach_meeting_snapshots.apply_teams_attendance_status_transition')
            ai = mock('coach_api.views.openai_meeting_summary')
            recap = mock('coach_api.views.ensure_coach_meeting_summary')
            # Source qualification is covered separately. No caller-supplied
            # family is used by the production command.
            mock('coach_api.management.commands.sync_coach_meeting_snapshots.imported_context', create=True,
                 side_effect=lambda record: None if native else {
                     'reviewKey': record.event_key, 'family': self.family,
                     'overlayId': 3, 'status': self.overlay.status,
                     'revision': self.overlay.meeting_intelligence.get('reviewRevision', 0)})
            mock('django.db.transaction.atomic', return_value=nullcontext())
            manager = mock('coach_api.models.CoachCalendarEvent.objects')
            manager.using.return_value.select_for_update.return_value.get.side_effect = lambda **kw: self.current_record
            overlays = mock('coach_api.models.ImportedReviewInstance.objects')
            overlays.using.return_value.select_for_update.return_value.get.return_value = self.overlay
            stack.enter_context(patch.object(runner, '_matching_records', return_value=[self.record]))
            runner.handle(all=True, recent=False, event_key='', owner_email='', limit=100,
                          lookback_hours=24, lead_minutes=10, dry_run=dry_run, allow_missing_tables=False)
            ai.assert_not_called()
            recap.assert_not_called()
            if native:
                transition.assert_called_once()
            self.transition_calls = transition.call_count
        if expected_revision is not None:
            before[3]['reviewRevision'] = expected_revision
        # The approved follow-up permits only scheduled -> in-progress. The
        # original formal/history preservation assertions remain unchanged.
        self.assertEqual((self.overlay.answers, self.overlay.template_snapshot, self.overlay.meeting_intelligence), (before[0], before[2], before[3]))
        if self.overlay.status != before[1]:
            self.assertEqual((before[1], self.overlay.status), ('scheduled', 'in-progress'))
        for call in self.overlay.save.call_args_list:
            self.assertEqual(call.kwargs, {'update_fields': ['status', 'updated_at']})
        return output.getvalue()

    def test_background_imported_path_never_invokes_lifecycle_helper(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.run_command()
                self.assertEqual(self.transition_calls, 0)

    def test_completed_signature_and_reopened_states_collect_late_evidence_without_form_writes(self):
        for family in fixtures.FAMILIES:
            for status, revision in (('completed', 0), ('awaiting-signature', 0), ('in-progress', 2)):
                with self.subTest(family=family, status=status, revision=revision):
                    self.prepare(family)
                    self.overlay.status = status
                    self.overlay.meeting_intelligence = {'reviewRevision': revision, 'summary': {'text': 'Approved'}}
                    self.load_report()
                    self.assertIn('stored=1', self.run_command())
                    self.assert_attended()

    def test_late_distinct_report_retains_prior_valid_report(self):
        self.prepare('PR')
        self.load_report(roles=('coach',))
        self.run_command()
        self.load_report(roles=('learner',), key='late-report')
        self.run_command()
        self.assertEqual({r['id'] for r in self.writes[-1]['reports']}, {'report-1', 'late-report'})
        self.assert_attended()

    def test_unavailable_stored_read_never_attempts_destructive_tracker_replacement(self):
        self.prepare('PSP')
        self.load_report()
        self.stored['storage'] = {'stored': False}
        self.stored['partial'] = True
        self.assertIn('snapshot_read_unavailable', self.run_command())
        self.assertEqual(self.writes, [])

    def test_changed_booking_during_fetch_skips_all_resource_writes(self):
        for field, value in (('scheduled_date', timezone.now().date()), ('graph_event_id', 'another-event'),
                             ('graph_organizer_email', 'another@example.invalid'), ('owner_email', 'another@example.invalid')):
            with self.subTest(field=field):
                self.prepare('MCM')
                self.load_report()
                self.current_record = deepcopy(self.record)
                setattr(self.current_record, field, value)
                self.assertIn('snapshot_context_changed', self.run_command())
                self.assertEqual(self.writes, [])

    def test_reopen_during_fetch_fences_previous_revision(self):
        self.prepare('MCM')
        self.overlay.status = 'completed'
        self.load_report()
        # Simulate an authorized independent reopen; command must not save its
        # stale resource response. Comparison below excludes that external edit.
        self.during_fetch = lambda: self.overlay.meeting_intelligence.update(reviewRevision=1)
        self.assertIn('snapshot_context_changed', self.run_command(expected_revision=1))
        self.assertEqual(self.writes, [])

    def test_imported_operational_diagnostics_omit_source_and_provider_material(self):
        self.prepare('PSP')
        self.attendance_error = RuntimeError('PRIVATE_PROVIDER_BODY secret@example.invalid')
        with self.assertLogs('coach_api.views', level='WARNING') as captured:
            output = self.run_command()
        combined = output + '\n'.join(captured.output)
        for forbidden in ('PRIVATE_PROVIDER_BODY', 'secret@example.invalid', self.record.event_key):
            self.assertNotIn(forbidden, combined)
        self.assertIn('partial=1', output)

    def test_imported_dry_run_does_not_disclose_personal_identity(self):
        self.prepare('PSP')
        output = self.run_command(dry_run=True)
        self.assertEqual(self.writes, [])
        self.assertNotIn(self.record.event_key, output)
        self.assertNotIn(self.record.owner_email, output)

    def test_background_does_not_write_failed_or_other_session_transcript(self):
        self.prepare('MCM')
        self.load_report()
        start = self.report()[0]['meetingStartDateTime']
        end = self.report()[0]['meetingEndDateTime']
        artifacts = [
            {'artifact_type': 'transcript', 'graph_artifact_id': 'failed',
             'created_datetime': start, 'end_datetime': end, 'call_id': 'same-call',
             'transcript_fetch_error': 'Synthetic unavailable content'},
            {'artifact_type': 'recording', 'graph_artifact_id': 'current-recording',
             'created_datetime': start, 'end_datetime': end, 'call_id': 'same-call'},
            {'artifact_type': 'transcript', 'graph_artifact_id': 'old-call',
             'created_datetime': '2025-01-01T12:00:00Z', 'call_id': 'another-call'},
        ]
        real_fetch = command.fetch_coach_meeting_graph_snapshot
        def fetch(*args, **kwargs):
            snapshot, error, status = real_fetch(*args, **kwargs)
            snapshot['artifacts'] = artifacts
            return snapshot, error, status
        with patch.object(command, 'fetch_coach_meeting_graph_snapshot', side_effect=fetch):
            self.run_command()
        self.assertEqual([row['graph_artifact_id'] for row in self.last_artifacts], ['current-recording'])

    def test_duplicate_listing_does_not_fetch_a_second_conflicting_copy(self):
        self.prepare('PSP')
        self.load_report()
        self.reports *= 2
        original_graph, reads = self.graph, []
        def graph(method, path, *args, **kwargs):
            result = original_graph(method, path, *args, **kwargs)
            if '/attendanceReports/' in path:
                reads.append(path)
                if len(reads) > 1:
                    result['attendanceRecords'] = []
            return result
        with patch.object(self, 'graph', side_effect=graph):
            self.run_command()
        self.assert_attended()
        self.assertEqual(len(reads), 1)

    def test_concurrent_writer_with_earlier_host_clock_still_fences_old_response(self):
        self.prepare('PR')
        self.load_report(roles=())
        def concurrent_write():
            self.publish_manual_result()
            self.stored['storage']['syncedAt'] = (timezone.now() - timedelta(minutes=2)).isoformat()
        self.during_fetch = concurrent_write
        self.assertIn('snapshot_superseded', self.run_command())
        self.assertEqual(len(self.writes), 1)
        self.assert_attended()

    def test_complete_reports_collect_coach_learner_and_both(self):
        for family in fixtures.FAMILIES:
            for roles in (('coach',), ('learner',), ('coach', 'learner')):
                with self.subTest(family=family, roles=roles):
                    self.prepare(family)
                    self.load_report(roles=roles)
                    self.assertIn('stored=1', self.run_command())
                    self.assert_attended(roles)

    def test_empty_later_response_preserves_verified_attendance(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.run_command()
                self.reports = []
                self.assertIn('stored=1', self.run_command())
                self.assert_attended()

    def test_partial_and_failed_details_preserve_evidence_and_error(self):
        for family in fixtures.FAMILIES:
            for failure in ('collection', 'detail', 'records', 'continuation', 'collection-page', 'id'):
                with self.subTest(family=family, failure=failure):
                    self.prepare(family)
                    self.load_report()
                    self.run_command()
                    if failure == 'collection':
                        self.attendance_error = RuntimeError('Synthetic collection failure')
                    elif failure == 'detail':
                        self.details['report-1'] = RuntimeError('Synthetic detail failure')
                    elif failure == 'records':
                        self.details['report-1'].pop('attendanceRecords')
                    elif failure == 'continuation':
                        self.details['report-1']['attendanceRecords'] = self.details['report-1']['attendanceRecords'][:1]
                        self.details['report-1']['attendanceRecords@odata.nextLink'] = '/synthetic-next'
                    elif failure == 'collection-page':
                        self.collection_override = {'value': [], '@odata.nextLink': '/synthetic-next'}
                    else:
                        self.details['report-1']['id'] = 'another-report'
                    output = self.run_command()
                    self.assert_attended()
                    self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                    self.assertIn('partial=1', output)

    def test_wrong_window_is_not_counted_or_written(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                old, detail = self.report(key='old-report', days=-7)
                self.reports.append(old)
                self.details['old-report'] = detail
                self.run_command()
                self.assertEqual([r['id'] for r in self.writes[-1]['reports']], ['report-1'])
                self.assert_attended()

    def test_duplicate_reports_and_duplicate_fetch_do_not_double_seconds(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.reports *= 2
                self.run_command()
                first = deepcopy(self.writes[-1])
                self.run_command()
                self.assertEqual(self.writes[-1], first)
                self.assert_attended()
                self.assertEqual(len(self.writes[-1]['reports']), 1)

    def test_rescheduled_booking_never_reuses_old_window(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.load_report()
                self.run_command()
                self.record.scheduled_date -= timedelta(days=7)
                self.run_command()
                self.assertEqual(self.writes[-1]['reports'], [])
                self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))

    def test_no_report_late_report_and_complete_zero_attendance(self):
        for family in fixtures.FAMILIES:
            with self.subTest(family=family):
                self.prepare(family)
                self.run_command()
                self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))
                self.load_report()
                self.run_command()
                self.assert_attended()
                self.load_report(roles=())
                self.run_command()
                self.assertTrue(all(r['status'] == 'absent' for r in self.writes[-1]['tracker']['tracker']))

    def test_native_default_and_start_transition_are_unchanged(self):
        self.prepare('MCM')
        self.record.event_key = 'mcr:42:native'
        self.load_report()
        self.run_command(native=True)
        self.reports = []
        self.run_command(native=True)
        self.assertEqual(self.writes[-1]['reports'], [])
        self.assertTrue(all(r['status'] == 'pending' for r in self.writes[-1]['tracker']['tracker']))

    def test_manual_write_during_fetch_fences_older_empty_partial_and_complete_results(self):
        for family in fixtures.FAMILIES:
            for response in ('empty', 'partial', 'complete-zero'):
                with self.subTest(family=family, response=response):
                    self.prepare(family)
                    if response == 'partial':
                        self.attendance_error = RuntimeError('Synthetic delayed failure')
                    elif response == 'complete-zero':
                        self.load_report(roles=())
                    self.during_fetch = self.publish_manual_result
                    output = self.run_command()
                    self.assertEqual(len(self.writes), 1, 'Only the newer manual result may persist')
                    self.assert_attended()
                    self.assertIn('snapshot_superseded', output)
        self.during_fetch = None
