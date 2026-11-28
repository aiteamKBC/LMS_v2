"""Teams results sync: delivery runs and recording identity. Graph is mocked; nothing leaves the process.

Production, 5-9 Oct 2026: seconds-long opens of a week-1 link days before the
course completed the session; the real lesson could be overwritten by whichever
Teams report was listed last; and Graph listing one recording under two ids
saved and uploaded it twice. Every test also proves the sync only reads Teams.

Run: ``DJANGO_USE_SQLITE=true python manage.py test curriculum_api.test_teams_delivery_sync``
"""
import os
from datetime import datetime
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase

from curriculum_api import session_archive
from curriculum_api import views

SERIES = 'LIVE-DELIVERY'
GRAPH_SETTINGS = {
    'tenant_id': 'tenant', 'client_id': 'client', 'client_secret': 'secret',
    'scope': 'https://graph.microsoft.com/.default', 'base_url': 'https://graph.microsoft.com/v1.0',
    'timezone': 'GMT Standard Time',
}


def report(report_id, start, end, people):
    return {'id': report_id, 'meetingStartDateTime': start, 'meetingEndDateTime': end, 'totalParticipantCount': people,
            'attendanceRecords': [{'id': f'{report_id}-{n}', 'emailAddress': f'person{n}@example.invalid',
                                   'role': 'Attendee', 'totalAttendanceInSeconds': 60,
                                   'identity': {'displayName': f'Person {n}'},
                                   'attendanceIntervals': [{'joinDateTime': start, 'leaveDateTime': end, 'durationInSeconds': 60}]}
                                  for n in range(people)]}


def recording(graph_id, correlation='corr-1', created='2026-10-09T07:33:21Z', end='2026-10-09T10:09:00Z', call='call-1'):
    return {'id': graph_id, 'callId': call, 'contentCorrelationId': correlation,
            'createdDateTime': created, 'endDateTime': end, 'recordingContentUrl': f'https://graph.invalid/{graph_id}'}


class DeliverySyncTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.ensure_module_authoring_tables()
        views.ensure_live_sessions_table()
        views.ensure_live_session_tracking_tables()
        for table in (views.LIVE_SESSION_ARTIFACTS_TABLE, views.LIVE_SESSION_ATTENDANCE_TABLE,
                      views.LIVE_SESSION_OCCURRENCES_TABLE, views.LIVE_SESSIONS_TABLE):
            views.authoring_delete(table)
        env = patch.dict(os.environ, {'MICROSOFT_TEAMS_ORGANIZER_EMAIL': '', 'MICROSOFT_ORGANIZER_EMAIL': ''})
        env.start()
        self.addCleanup(env.stop)
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {
            'id': SERIES, 'organizer_email': 'tutor@example.invalid',
            'join_url': 'https://teams.microsoft.com/l/meetup-join/delivery', 'online_meeting_id': 'meeting-1',
            'recording': 'record-transcribe', 'lobby_bypass': 'invited', 'status': 'active'})
        self.reports, self.recordings, self.calls = [], [], []

    def occurrence(self, start, end, number=1, **stored):
        views.authoring_upsert(views.LIVE_SESSION_OCCURRENCES_TABLE, ['id'], {
            'id': f'OCC-{number}', 'live_session_id': SERIES, 'session_number': number,
            'scheduled_start': start, 'scheduled_end': end, 'status': 'scheduled', **stored})

    def stored(self):
        return views.authoring_fetch_all(views.LIVE_SESSION_OCCURRENCES_TABLE, 'id = %s', ['OCC-1'])[0]

    def graph(self, method, path, payload=None, **_kwargs):
        self.calls.append((method, path))
        if path.endswith('/attendanceReports'):
            return {'value': [{key: value for key, value in item.items() if key != 'attendanceRecords'} for item in self.reports]}
        if '/attendanceReports/' in path:
            report_id = path.split('/attendanceReports/')[1].split('?')[0].split('/')[0]
            return next(item for item in self.reports if item['id'] == report_id)
        if path.endswith('/recordings'):
            return {'value': self.recordings}
        if path.endswith('/transcripts'):
            return {'value': []}
        return {}

    def sync(self):
        with patch('coach_api.views.microsoft_graph_request', side_effect=self.graph), \
                patch('coach_api.views.has_graph_credentials', return_value=True), \
                patch('coach_api.views.get_graph_settings', return_value=GRAPH_SETTINGS), \
                patch('learner_api.teams_attendance.sync_verified_teams_attendance_reporting', return_value=0):
            # Exactly as the results worker calls it (process_session_results).
            request = RequestFactory().post('/internal/session-result-worker/')
            request.session_result_worker = True
            request.session_result_force = False
            response = views.curriculum_teams_meeting_artifacts(request, SERIES)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([call for call in self.calls if call[0] != 'GET'], [], 'the sync must only read Teams')
        return response

    def test_test_opens_never_complete_and_the_real_lesson_wins_in_any_order(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10))
        self.reports = [
            report('real', '2026-10-09T07:33:21Z', '2026-10-09T10:09:00Z', 4),
            report('days-before', '2026-10-05T07:39:40Z', '2026-10-05T07:39:43Z', 1),
            report('lone-check', '2026-10-09T09:20:00Z', '2026-10-09T09:21:00Z', 1),
            report('reconnect', '2026-10-09T09:30:00Z', '2026-10-09T09:45:00Z', 2),
        ]
        self.sync()
        saved = self.stored()
        self.assertEqual((saved['status'], saved['attendance_report_id'], int(saved['participant_count'])), ('completed', 'real', 4))
        self.assertEqual(views.parse_graph_datetime(saved['actual_start']).replace(tzinfo=None), datetime(2026, 10, 9, 7, 33, 21))
        # The reconnect is part of the lesson: its attendance is kept; the test opens give none.
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ATTENDANCE_TABLE, 'occurrence_id = %s', ['OCC-1'])
        sources = {views.parse_json_value(row['raw_data'], {}).get('attendanceReportId') for row in rows}
        self.assertEqual(sources, {'real', 'reconnect'})

    def test_a_saved_test_open_is_replaced_by_the_real_run(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10), status='completed',
                        attendance_report_id='days-before', participant_count=1,
                        actual_start=datetime(2026, 10, 5, 7, 39, 40), actual_end=datetime(2026, 10, 5, 7, 39, 43))
        self.reports = [report('days-before', '2026-10-05T07:39:40Z', '2026-10-05T07:39:43Z', 1),
                        report('real', '2026-10-09T07:33:21Z', '2026-10-09T10:09:00Z', 3)]
        self.sync()
        saved = self.stored()
        self.assertEqual((saved['attendance_report_id'], int(saved['participant_count'])), ('real', 3))

    def test_a_future_session_completed_by_a_test_open_is_reopened_and_its_evidence_kept(self):
        self.occurrence(datetime(2030, 1, 10, 8), datetime(2030, 1, 10, 10), status='completed',
                        attendance_report_id='early-check', participant_count=1,
                        actual_start=datetime(2026, 10, 5, 7, 39, 40), actual_end=datetime(2026, 10, 5, 7, 39, 43))
        views.authoring_upsert(views.LIVE_SESSION_ATTENDANCE_TABLE, ['id'], {
            'id': 'ATT-EARLY', 'occurrence_id': 'OCC-1', 'graph_record_id': 'early-0', 'email': 'tutor@example.invalid',
            'display_name': 'Tutor', 'role': 'Organizer', 'total_attendance_seconds': 3, 'intervals': '[]',
            'raw_data': '{"sourceAttendanceReportIds": ["early-check"]}'})
        self.reports = [report('early-check', '2026-10-05T07:39:40Z', '2026-10-05T07:39:43Z', 1)]
        self.sync()
        saved = self.stored()
        self.assertEqual((saved['status'], saved['attendance_report_id'], saved['actual_start']), ('scheduled', '', None))
        self.assertEqual(len(views.authoring_fetch_all(views.LIVE_SESSION_ATTENDANCE_TABLE, 'id = %s', ['ATT-EARLY'])), 1)

    def test_a_past_session_without_its_real_run_keeps_its_status_for_a_person_to_resolve(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10), status='completed',
                        attendance_report_id='early-check', participant_count=1,
                        actual_start=datetime(2026, 10, 5, 7, 39, 40), actual_end=datetime(2026, 10, 5, 7, 39, 43))
        self.reports = [report('early-check', '2026-10-05T07:39:40Z', '2026-10-05T07:39:43Z', 1)]
        self.sync()
        self.assertEqual(self.stored()['status'], 'completed')

    def test_one_recording_listed_under_two_ids_is_saved_once_however_often_it_syncs(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10))
        self.reports = [report('real', '2026-10-09T07:33:21Z', '2026-10-09T10:09:00Z', 3)]
        self.recordings = [recording('ktVizIr-one'), recording('ktVizIf-one'),
                           recording('second-recording', correlation='corr-2', created='2026-10-09T09:00:00Z')]
        for _ in range(3):
            self.sync()
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'artifact_type = %s', ['recording'])
        self.assertEqual(sorted(row['content_correlation_id'] for row in rows), ['corr-1', 'corr-2'])

    def test_a_reissued_id_with_differently_reported_timing_is_still_the_same_recording(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10))
        self.recordings = [recording('first-id')]
        self.sync()
        self.recordings = [recording('reissued-id', created='2026-10-09T07:33:21.1234567Z')]
        self.sync()
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'artifact_type = %s', ['recording'])
        self.assertEqual([row['graph_artifact_id'] for row in rows], ['reissued-id'])

    def test_two_recordings_sharing_a_correlation_id_on_different_calls_stay_apart(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10))
        self.recordings = [recording('a', call='call-1'), recording('b', call='call-2')]
        self.sync()
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'artifact_type = %s', ['recording'])
        self.assertEqual(len(rows), 2)

    def test_a_recording_between_sessions_is_not_filed_under_the_nearest_week(self):
        # Production: week 2 of a Thursday module holds attendance from a run on 1 Oct, a week with no session.
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10), number=1)
        self.occurrence(datetime(2026, 10, 16, 8), datetime(2026, 10, 16, 10), number=2)
        self.recordings = [recording('between', created='2026-10-12T10:00:00Z', end='2026-10-12T11:00:00Z'),
                           recording('lesson', correlation='corr-2', created='2026-10-16T08:02:00Z', end='2026-10-16T09:58:00Z')]
        self.sync()
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'artifact_type = %s', ['recording'])
        self.assertEqual([(row['graph_artifact_id'], row['occurrence_id']) for row in rows], [('lesson', 'OCC-2')])

    def test_a_reissued_id_stays_on_the_session_its_recording_was_filed_under(self):
        self.occurrence(datetime(2026, 10, 9, 8), datetime(2026, 10, 9, 10), number=1)
        self.occurrence(datetime(2026, 10, 16, 8), datetime(2026, 10, 16, 10), number=2)
        views.authoring_upsert(views.LIVE_SESSION_ARTIFACTS_TABLE, ['id'], {
            'id': 'ART-FILED', 'occurrence_id': 'OCC-1', 'artifact_type': 'recording', 'graph_artifact_id': 'old-id',
            'call_id': 'call-1', 'content_correlation_id': 'corr-1', 'metadata': '{}'})
        # Re-issued with an end time nearer week 2: still the recording filed under week 1.
        self.recordings = [recording('new-id', created='2026-10-09T08:00:00Z', end='2026-10-13T00:00:00Z')]
        self.sync()
        rows = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'artifact_type = %s', ['recording'])
        self.assertEqual([(row['id'], row['occurrence_id'], row['graph_artifact_id']) for row in rows],
                         [('ART-FILED', 'OCC-1', 'new-id')])


class RecordingDeliveryWindowTests(SimpleTestCase):
    """Exercise the worker endpoint's recording gates with storage and Graph mocked."""

    def setUp(self):
        self.series = {'id': SERIES, 'organizer_email': 'tutor@example.invalid',
                       'join_url': 'https://teams.microsoft.com/l/meetup-join/delivery',
                       'online_meeting_id': 'meeting-1', 'status': 'active'}
        self.occurrences = [
            {'id': f'OCC-{number}', 'live_session_id': SERIES, 'session_number': number,
             'scheduled_start': datetime(2026, 10, day, 8, 30),
             'scheduled_end': datetime(2026, 10, day, 10, 30), 'status': 'scheduled'}
            for number, day in ((1, 9), (2, 16))
        ]

    def rows(self, table, *_args, **_kwargs):
        return {
            views.LIVE_SESSIONS_TABLE: [self.series],
            views.LIVE_SESSION_OCCURRENCES_TABLE: self.occurrences,
            views.LIVE_SESSION_ATTENDANCE_TABLE: [],
            views.LIVE_SESSION_ARTIFACTS_TABLE: [],
            views.LIVE_SESSION_JOIN_LAUNCHES_TABLE: [],
        }[table]

    def sync_recording(self, artifact):
        def graph(method, path, *_args, **_kwargs):
            self.assertEqual(method, 'GET')
            return {'value': [artifact] if path.endswith('/recordings') and artifact is not None else []}

        with patch.object(views.schema_gate, 'require_tables'), \
                patch.object(views, 'authoring_fetch_all', side_effect=self.rows), \
                patch.object(views, 'upsert_live_session_artifact', return_value=True) as save, \
                patch.object(views, 'remove_artifact_from_wrong_occurrences'), \
                patch.object(views, 'update_authoring_rows') as update, \
                patch.object(views, 'authoring_delete', side_effect=AssertionError('Existing evidence must be kept')), \
                patch.object(views, 'resolve_directory_accounts', return_value={'resolved': 0, 'notFound': 0, 'denied': 0}), \
                patch('curriculum_api.teams_dial_in.remember_teams_dial_in'), \
                patch('coach_api.views.microsoft_graph_request', side_effect=graph), \
                patch('coach_api.views.has_graph_credentials', return_value=True), \
                patch('coach_api.views.get_graph_settings', return_value=GRAPH_SETTINGS), \
                patch('learner_api.teams_attendance.sync_verified_teams_attendance_reporting', return_value=0):
            request = RequestFactory().post('/internal/session-result-worker/')
            request.session_result_worker = True
            response = views.curriculum_teams_meeting_artifacts(request, SERIES)
        self.assertEqual(response.status_code, 200, response.content)
        for call in update.call_args_list:
            self.assertEqual(call.args[0], views.LIVE_SESSION_OCCURRENCES_TABLE)
            self.assertEqual(set(call.args[3]), {'artifacts_synced_at', 'last_sync_error'})
        return save

    def test_recording_started_early_and_ending_after_the_lecture_is_saved(self):
        artifact = recording('early-start', created='2026-10-09T08:17:00Z', end='2026-10-09T10:31:00Z')

        save = self.sync_recording(artifact)

        save.assert_called_once()
        occurrence, kind, saved = save.call_args.args
        self.assertEqual((occurrence['id'], kind), ('OCC-1', 'recording'))
        self.assertEqual(saved['endDateTime'], artifact['endDateTime'])
        self.assertEqual(saved['lmsOccurrenceId'], 'OCC-1')

    def test_recording_finished_before_the_lecture_is_not_saved(self):
        save = self.sync_recording(recording('rehearsal', created='2026-10-09T08:17:00Z',
                                            end='2026-10-09T08:20:00Z'))
        save.assert_not_called()

    def test_delayed_recording_is_saved_on_a_later_sync_after_an_empty_result(self):
        first_save = self.sync_recording(None)
        first_save.assert_not_called()

        artifact = recording('published-later', created='2026-10-09T08:17:00Z',
                             end='2026-10-09T10:31:00Z')
        later_save = self.sync_recording(artifact)

        later_save.assert_called_once()
        occurrence, kind, saved = later_save.call_args.args
        self.assertEqual((occurrence['id'], kind), ('OCC-1', 'recording'))
        self.assertEqual(saved['id'], 'published-later')
        self.assertEqual(saved['lmsOccurrenceId'], 'OCC-1')


class ArchiveReuseTests(SimpleTestCase):
    """A row that is the same Teams file as one already saved points at that copy: no download, no upload."""

    ARTIFACT = {'id': 'ART-2', 'occurrence_id': 'OCC-1', 'artifact_type': 'recording', 'saved_status': None,
                'saved_name': None, 'graph_artifact_id': 'second-id', 'content_correlation_id': 'corr-1',
                'call_id': 'call-1', 'created_datetime': datetime(2026, 10, 9, 7, 33), 'end_datetime': datetime(2026, 10, 9, 10, 9)}

    def fake_read(self, sql, params=()):
        if 'FROM curriculum.live_sessions WHERE' in sql:
            return [{'id': SERIES, 'module_catalogue_id': 'MOD-1', 'module_title': 'Module'}]
        if 'FROM curriculum.modules' in sql:
            return [{'group_id': 'G', 'group_name': 'Group'}]
        if 'FROM curriculum.live_session_occurrences WHERE' in sql:
            return [{'id': 'OCC-1', 'session_number': 1}]
        if 'r.status AS saved_status' in sql:
            return [dict(self.ARTIFACT)]
        if "r.status='ready'" in sql:
            self.twin_params = params
            return [{'blob_name': 'MOD/G/session-01/recording-ART-1.mp4', 'transcript_text': None}]
        raise AssertionError(sql)

    def test_the_second_id_reuses_the_saved_copy(self):
        storage = MagicMock()
        with patch.object(session_archive, 'read', side_effect=self.fake_read), \
                patch.object(session_archive, 'result_rows', return_value=[]), \
                patch.object(session_archive, 'storage_client', return_value=storage), \
                patch.object(session_archive, 'save_archive') as save, \
                patch('httpx.Client', side_effect=AssertionError('no download')):
            errors = session_archive.archive_series(SERIES)
        self.assertEqual(errors, [])
        save.assert_called_once()
        self.assertEqual(save.call_args.args[1], 'MOD/G/session-01/recording-ART-1.mp4')
        storage.get_blob_client.assert_not_called()
        self.assertIn('corr-1', self.twin_params)
        self.assertIn('ART-2', self.twin_params, 'the row never matches itself')

    def test_without_identity_there_is_no_reuse(self):
        with patch.object(session_archive, 'read', side_effect=AssertionError('no lookup')):
            self.assertIsNone(session_archive.saved_copy_of_same_recording(
                {**self.ARTIFACT, 'content_correlation_id': '', 'call_id': ''}))
