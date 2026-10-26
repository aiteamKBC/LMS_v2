"""Calendar evidence regressions: isolated settings, mocked DB and providers only."""
from datetime import datetime, timezone
from contextlib import nullcontext
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core import signing
from django.core.management.base import CommandError
from django.test import SimpleTestCase
from django.core.cache import cache

from coach_api import recordings_calendar_media as media
from coach_api import recordings_calendar_sync as sync
from coach_api.management.commands import sync_coaching_calendar_media as command
from coach_api import views
from coach_api import recording_archive
from coach_api.management.commands import prepare_coaching_recording_archive as prepare

OWNER = 'coach@example.invalid'
START, END = '2026-10-20T09:00:00Z', '2026-10-20T10:00:00Z'
LINK = 'https://teams.microsoft.com/l/meetup-join/synthetic'


def event(**changes):
    return {'id': 'calendar-event', 'subject': 'Any original meeting title',
        'start': {'dateTime': START}, 'end': {'dateTime': END},
        'organizer': {'emailAddress': {'address': OWNER}}, 'onlineMeeting': {'joinUrl': LINK}, **changes}


def context():
    return media.event_context(OWNER, event())


def report():
    return {'id': 'report', 'meetingStartDateTime': START, 'meetingEndDateTime': END,
            'records': [{'id': 'person', 'email': 'person@example.invalid', 'displayName': 'Actual Person',
                         'totalAttendanceSeconds': 60, 'intervals': []}]}


class CalendarEvidenceTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Live network forbidden')))

    def test_identity_is_timezone_canonical_and_separate_for_each_coach_event_and_occurrence(self):
        base = context()
        same = media.calendar_context(' COACH@example.invalid ', 'calendar-event', '2026-10-20T10:00:00+01:00', '2026-10-20T11:00:00+01:00')
        self.assertEqual(media.calendar_key(base), media.calendar_key(same))
        for change in ({'owner': 'other@example.invalid'}, {'event': 'another'}, {'start': '2026-10-19T09:00:00Z', 'end': '2026-10-19T10:00:00Z'}):
            self.assertNotEqual(media.calendar_key(base), media.calendar_key({**base, **change}))
        self.assertIsNone(media.calendar_record(base).learner_id)
        self.assertIsNone(media.calendar_record(base).id)

    def test_invalid_and_expired_references_do_not_authorise_an_event(self):
        with self.assertRaises(ValueError):
            media.calendar_context(OWNER, 'event', '2026-10-20T09:00:00', END)
        with patch('django.core.signing.time.time', return_value=1000):
            token = media.calendar_reference(context())
        with patch('django.core.signing.time.time', return_value=5000):
            with self.assertRaises(signing.SignatureExpired):
                media.read_reference(token)

    def test_actual_attendance_unions_device_visits_and_never_infers_absence_from_an_invite(self):
        original = report()
        original['records'][0]['intervals'] = [{'joinDateTime': START, 'leaveDateTime': '2026-10-20T09:02:00Z'}]
        original['records'].append({**original['records'][0], 'id': 'second-device',
            'intervals': [{'joinDateTime': '2026-10-20T09:01:00Z', 'leaveDateTime': '2026-10-20T09:03:00Z'}]})
        original['records'].append({'id': 'zero', 'displayName': 'Reported with no duration', 'totalAttendanceSeconds': 0})
        rows = media.attendance_rows([original, original])
        self.assertEqual(rows[0]['totalAttendanceSeconds'], 180)
        self.assertEqual(rows[0]['status'], 'attended')
        self.assertFalse(rows[0]['expected'])
        self.assertEqual(rows[1]['status'], 'pending')
        self.assertNotIn('absent', {row['status'] for row in rows})

    def test_anonymous_people_are_not_merged_just_because_their_display_names_match(self):
        original = report()
        original['records'] = [{'id': 'one', 'displayName': 'Same name', 'totalAttendanceSeconds': 60},
                               {'id': 'two', 'displayName': 'Same name', 'totalAttendanceSeconds': 30}]
        self.assertEqual(len(media.attendance_rows([original])), 2)

    def test_saved_reports_are_scoped_by_owner_event_and_window_without_graph_reads(self):
        record = media.calendar_record(context())
        start, end = record.calendar_window
        rows = [('report', start, end, report(), end), ('old', start.replace(day=19), end.replace(day=19), {'id': 'old', 'records': []}, end)]
        with patch.object(media.connections['default'], 'cursor') as connection, patch.object(media.router, 'db_for_read', return_value='default'):
            cursor = connection.return_value.__enter__.return_value
            cursor.fetchall.return_value = rows
            result = media.saved_calendar_attendance(record)
        self.assertEqual(result['reportCount'], 1)
        self.assertEqual(result['rows'][0]['name'], 'Actual Person')
        self.assertEqual(cursor.execute.call_args.args[1], [OWNER, 'calendar-event', record.event_key, end, start])
        self.assertTrue(cursor.execute.call_args.args[0].strip().startswith('SELECT'))
        self.assertIn('OR (meeting_start_datetime', cursor.execute.call_args.args[0])

    def test_legacy_archive_queue_keeps_native_rows_and_excludes_calendar_only_evidence(self):
        with patch.object(recording_archive, 'blob_columns_ready', return_value=True), \
                patch.object(recording_archive.connections['default'], 'cursor') as connection:
            cursor = connection.return_value.__enter__.return_value
            cursor.description = [(name,) for name in ('event_key', 'graph_artifact_id', 'owner_email', 'graph_organizer_email', 'graph_event_id')]
            cursor.fetchall.return_value = [('mcr:1', 'native-file', OWNER, OWNER, 'native-event')]
            rows = recording_archive.pending_recordings(database='default', limit=12)
        self.assertIn("event_key not like 'coach-calendar:%%'", cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1], [12])
        self.assertEqual(rows[0]['event_key'], 'mcr:1')

    def test_snapshot_failure_cannot_start_an_upload_or_create_a_native_booking(self):
        with patch.object(sync, 'fetch_snapshot', return_value=('base', OWNER, [], [])), \
                patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': False}), \
                patch.object(sync, 'archive_calendar_recording') as archive:
            with self.assertRaises(RuntimeError):
                sync.sync_calendar_event(OWNER, event())
        archive.assert_not_called()

    def test_successful_discovery_uses_nullable_snapshot_identity_and_actual_attendees_only(self):
        artifacts = [{'graph_artifact_id': 'recording'}]
        with patch.object(sync, 'fetch_snapshot', return_value=('base', OWNER, artifacts, [report()])), \
                patch.object(views, 'persist_coach_meeting_snapshots', return_value={'stored': True}) as persist, \
                patch.object(sync, 'archive_calendar_recording', return_value='archived') as archive:
            counts = sync.sync_calendar_event(OWNER, event())
        self.assertEqual(counts['archived'], 0)
        record = persist.call_args.args[0]
        self.assertIsNone(record.id); self.assertIsNone(record.learner_id)
        self.assertTrue(record.event_key.startswith('coach-calendar:'))
        self.assertEqual(persist.call_args.kwargs['attendance_tracker']['tracker'][0]['status'], 'attended')
        archive.assert_not_called()

    def test_existing_snapshot_store_accepts_calendar_identity_without_writing_a_booking_or_learner(self):
        record = media.calendar_record(context(), organizer=OWNER)
        artifact = views.serialize_coach_meeting_artifact('recording', {'id': 'file', 'createdDateTime': START, 'endDateTime': END})
        person = {**media.attendance_rows([report()])[0], 'id': 'actual', 'attended': True}
        with patch.object(views.router, 'db_for_write', return_value='default'), \
                patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
                patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=False), \
                patch.object(views.transaction, 'atomic', side_effect=lambda **kwargs: nullcontext()), \
                patch.object(views.connections['default'], 'cursor') as connection:
            cursor = connection.return_value.__enter__.return_value
            result = views.persist_coach_meeting_snapshots(record, artifacts=[artifact], attendance_reports=[report()], attendance_tracker={'tracker': [person]})
        self.assertTrue(result['stored'])
        self.assertEqual(len(cursor.execute.call_args_list), 4)
        for call in cursor.execute.call_args_list:
            sql, values = call.args
            self.assertIn('coach_meeting_', sql)
            self.assertNotIn('"Learner"', sql)
            if sql.strip().startswith('INSERT'):
                self.assertIsNone(values[0])
                self.assertEqual(values[1], record.event_key)
            else:
                self.assertEqual(values[-1], record.event_key)


class SharePointOnlyStorageTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Live network forbidden')))

    def test_retired_archive_entry_point_refuses_before_any_storage_or_media_access(self):
        with patch('curriculum_api.session_archive.storage_client') as storage, \
                patch('learner_api.evidence_storage.upload_blob') as upload, \
                patch('curriculum_api.recordings_external.recording_stream') as stream:
            with self.assertRaisesRegex(ValueError, 'SharePoint only'):
                sync.archive_calendar_recording('base', 'coach-calendar:old', 'file')
        storage.assert_not_called()
        upload.assert_not_called()
        stream.assert_not_called()

    def test_explicit_legacy_archive_request_is_rejected_before_discovery_or_writes(self):
        with patch.object(sync, 'fetch_snapshot') as fetch, \
                patch.object(views, 'persist_coach_meeting_snapshots') as save:
            with self.assertRaisesRegex(ValueError, 'SharePoint only'):
                sync.sync_calendar_event(OWNER, event(), archive=True)
        fetch.assert_not_called()
        save.assert_not_called()

    def test_retired_prepare_command_cannot_create_or_modify_a_container(self):
        with patch('curriculum_api.session_archive.storage_client') as storage:
            with self.assertRaisesMessage(CommandError, 'SharePoint only'):
                prepare.Command(stdout=StringIO()).handle()
        storage.assert_not_called()


class CalendarSyncCommandTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Live network forbidden')))
        self.enterContext(patch.object(command, '_coaches', return_value=[{'email': OWNER, 'name': 'Coach'}]))
        self.enterContext(patch.object(command, '_learners', return_value=[]))
        self.enterContext(patch.object(command, '_bookings', return_value=[]))
        self.graph = self.enterContext(patch.object(command, 'load_coach_calendar', return_value=[event()]))
        self.sync = self.enterContext(patch.object(command, 'sync_calendar_event', return_value={'archived': 1, 'existing': 0}))

    def run_command(self, **changes):
        options = {'coach_email': OWNER, 'all_coaches': False, 'start': '2026-10-01', 'end': '2026-10-31',
                   'recent_days': 0, 'time_zone': 'UTC', 'offset': 0, 'limit': 0, 'metadata_only': True, 'dry_run': False, **changes}
        instance = command.Command(stdout=StringIO(), stderr=StringIO())
        instance.handle(**options)
        return instance

    def test_dry_run_validates_scope_without_graph_reads_or_writes(self):
        self.run_command(dry_run=True)
        self.graph.assert_not_called(); self.sync.assert_not_called()

    def test_invalid_owner_or_date_cannot_start_provider_reads(self):
        for changes in ({'coach_email': 'unknown@example.invalid'}, {'start': '2026-01-01'}, {'time_zone': 'not-a-zone'}):
            with self.assertRaises(CommandError):
                self.run_command(**changes)
        self.graph.assert_not_called()

    def test_completed_external_meeting_is_imported_without_calling_native_booking_actions(self):
        self.run_command()
        self.sync.assert_called_once_with(OWNER, event(), archive=False, owner_name='Coach')

    def test_default_command_needs_no_azure_configuration_and_never_requests_a_copy(self):
        with patch('coach_api.recording_archive.archive_configured', return_value=False), \
                patch('curriculum_api.session_archive.storage_client') as storage:
            self.run_command(metadata_only=False)
        self.sync.assert_called_once_with(OWNER, event(), archive=False, owner_name='Coach')
        storage.assert_not_called()

    def test_existing_native_matches_keep_their_original_sync_path(self):
        with patch.object(command, 'compare_coach_calendar', return_value={'complete': True, 'meetings': [
            {'calendarEventId': 'calendar-event', 'startsAt': START, 'endsAt': END, 'match': 'matched', 'phase': 'ended'}]}):
            self.run_command()
        self.sync.assert_not_called()

    def test_a_limited_range_reports_incomplete_instead_of_silently_dropping_meetings(self):
        self.graph.return_value = [event(), event(id='second')]
        with self.assertRaisesMessage(CommandError, '--offset 1'):
            self.run_command(limit=1)
        self.assertEqual(self.sync.call_count, 1)

    def test_duplicate_calendar_pages_do_not_repeat_archive_work(self):
        self.graph.return_value = [event(), event()]
        self.run_command()
        self.assertEqual(self.sync.call_count, 1)

    def test_plain_calendar_appointments_remain_visible_without_failing_the_teams_evidence_job(self):
        self.sync.side_effect = sync.CalendarMeetingWithoutTeams()
        instance = self.run_command()
        self.assertIn('without_teams=1; failed=0', instance.stdout.getvalue())

    def test_provider_failures_are_reported_and_do_not_get_skipped_as_plain_appointments(self):
        self.sync.side_effect = RuntimeError('Provider unavailable')
        with self.assertRaisesMessage(CommandError, 'could not be synchronised'):
            self.run_command()

    def test_rolling_recovery_range_uses_the_selected_business_zone(self):
        with patch.object(command, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 21, 23, 30, tzinfo=timezone.utc)
            self.run_command(start='', end='', recent_days=7, time_zone='Africa/Cairo')
        start, end = self.graph.call_args.args[1:]
        self.assertEqual(start.isoformat(), '2026-10-15T21:00:00+00:00')
        self.assertEqual(end.isoformat(), '2026-10-22T21:00:00+00:00')


class CalendarGraphSnapshotTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Live network forbidden')))
        self.enterContext(patch.object(views, 'get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}))
        self.enterContext(patch('curriculum_api.views.teams_online_meeting_owner_id', return_value=OWNER))
        self.graph = self.enterContext(patch.object(views, 'microsoft_graph_request', side_effect=self.read))

    def read(self, method, path, **kwargs):
        self.assertEqual(method, 'GET')
        if '/onlineMeetings?' in path:
            return {'value': [{'id': 'online', 'joinWebUrl': LINK}]}
        if path.endswith('/recordings'):
            return {'value': [{'id': 'current', 'contentCorrelationId': 'same-file', 'createdDateTime': START, 'endDateTime': END},
                {'id': 'old', 'createdDateTime': '2026-10-19T09:00:00Z', 'endDateTime': '2026-10-19T10:00:00Z'}],
                '@odata.nextLink': 'https://graph.microsoft.com/v1.0/second-recording-page'}
        if path == 'second-recording-page':
            return {'value': [{'id': 'alias', 'contentCorrelationId': 'same-file', 'createdDateTime': START, 'endDateTime': END}]}
        if path.endswith('/attendanceReports'):
            return {'value': [{'id': 'current-report', 'meetingStartDateTime': START, 'meetingEndDateTime': END},
                {'id': 'old-report', 'meetingStartDateTime': '2026-10-19T09:00:00Z', 'meetingEndDateTime': '2026-10-19T10:00:00Z'}]}
        if '/attendanceReports/current-report?' in path:
            return {'id': 'current-report', 'meetingStartDateTime': START, 'meetingEndDateTime': END,
                'attendanceRecords': [{'id': 'one', 'emailAddress': 'person@example.invalid', 'identity': {'displayName': 'Actual Person'}, 'totalAttendanceInSeconds': 60}],
                'attendanceRecords@odata.nextLink': 'https://graph.microsoft.com/v1.0/second-attendance-page'}
        if path == 'second-attendance-page':
            return {'value': [{'id': 'two', 'emailAddress': 'second@example.invalid', 'identity': {'displayName': 'Second Person'}, 'totalAttendanceInSeconds': 30}]}
        raise AssertionError(f'Unexpected Graph request: {path}')

    def test_paged_evidence_is_complete_date_scoped_and_deduplicated_without_invite_or_ai_calls(self):
        base, organizer, artifacts, reports = sync.fetch_snapshot(context(), event())
        self.assertEqual(organizer, OWNER)
        self.assertEqual([row['graph_artifact_id'] for row in artifacts], ['current'])
        self.assertEqual(len(reports), 1)
        self.assertEqual(len(reports[0]['records']), 2)
        paths = [call.args[1] for call in self.graph.call_args_list]
        self.assertFalse(any('old-report?' in path or 'transcript' in path for path in paths))

    def test_repeated_occurrences_reuse_target_and_recording_pages_without_fetching_attendance(self):
        _, _, first = sync.fetch_recordings(context(), event())
        prior = event(start={'dateTime': '2026-10-19T09:00:00Z'}, end={'dateTime': '2026-10-19T10:00:00Z'})
        _, _, second = sync.fetch_recordings(media.event_context(OWNER, prior), prior)
        self.assertEqual([row['graph_artifact_id'] for row in first], ['current'])
        self.assertEqual([row['graph_artifact_id'] for row in second], ['old'])
        paths = [call.args[1] for call in self.graph.call_args_list]
        self.assertEqual(sum('/onlineMeetings?' in path for path in paths), 1)
        self.assertEqual(sum(path.endswith('/recordings') for path in paths), 1)
        self.assertFalse(any('attendanceReports' in path for path in paths))

    def test_foreign_pagination_or_provider_failure_cannot_persist_partial_evidence(self):
        original = self.read
        def read(method, path, **kwargs):
            if path.endswith('/recordings'):
                return {'value': [], '@odata.nextLink': 'https://foreign.example.invalid/files'}
            return original(method, path, **kwargs)
        self.graph.side_effect = read
        with patch.object(views, 'persist_coach_meeting_snapshots') as save:
            with self.assertRaises(RuntimeError):
                sync.sync_calendar_event(OWNER, event())
        save.assert_not_called()

    def test_an_online_meeting_with_a_different_join_identity_is_rejected(self):
        self.graph.side_effect = None
        self.graph.return_value = {'value': [{'id': 'wrong', 'joinWebUrl': LINK + '-other'}]}
        with self.assertRaises(ValueError):
            sync.graph_target(context(), event())

    def test_calendar_time_change_during_fallback_resolution_requires_a_fresh_discovery(self):
        self.graph.side_effect = None
        self.graph.return_value = event(start={'dateTime': '2026-10-19T09:00:00Z'})
        with self.assertRaises(ValueError):
            sync.graph_target(context(), event(onlineMeeting=None))

    def test_plain_appointment_is_confirmed_without_teams_requests(self):
        self.graph.side_effect = None
        self.graph.return_value = event(onlineMeeting=None)
        with self.assertRaises(sync.CalendarMeetingWithoutTeams):
            sync.graph_target(context(), event(onlineMeeting=None))
        self.assertEqual(self.graph.call_count, 1)
        self.assertIn('/events/', self.graph.call_args.args[1])

    def test_report_identity_mismatch_cannot_be_attached_to_this_meeting(self):
        original = self.read
        def read(method, path, **kwargs):
            result = original(method, path, **kwargs)
            return {**result, 'id': 'different-report'} if '/attendanceReports/current-report?' in path else result
        self.graph.side_effect = read
        with self.assertRaisesMessage(ValueError, 'different attendance report'):
            sync.fetch_snapshot(context(), event())

    def test_zero_duration_actual_participant_does_not_create_an_absence(self):
        original = self.read
        def read(method, path, **kwargs):
            result = original(method, path, **kwargs)
            if path == 'second-attendance-page':
                result['value'][0]['totalAttendanceInSeconds'] = 0
            return result
        self.graph.side_effect = read
        *_, reports = sync.fetch_snapshot(context(), event())
        self.assertEqual(reports[0]['absentCount'], 0)
        self.assertEqual(media.attendance_rows(reports)[1]['status'], 'pending')
