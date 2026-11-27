"""Real isolated-DB discovery regressions; Graph and delivery side effects are doubled."""
import json
from datetime import datetime
from unittest.mock import patch

from django.db import connection
from django.test import RequestFactory

from . import views
from .tests import CurriculumTeamsRequestTestCase


class ArtifactOccurrenceRecoveryTests(CurriculumTeamsRequestTestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.ensure_module_authoring_tables()
        views.ensure_live_sessions_table()
        self.prepare_teams_fixtures('PROG-RESTORE')
        views.ensure_live_session_tracking_tables()
        self.series = {'id': 'LIVE-RECOVERY', 'organizer_email': 'tutor@example.invalid',
                       'online_meeting_id': 'meeting-recovery', 'status': 'active',
                       'timezone': 'GMT Standard Time'}
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], self.series)
        self.current = {'id': 'OCC-RECOVERY-CURRENT', 'live_session_id': self.series['id'], 'session_number': 8,
                        'scheduled_start': datetime(2026, 11, 27, 9), 'scheduled_end': datetime(2026, 11, 27, 11),
                        'status': 'scheduled'}
        self.future = {**self.current, 'id': 'OCC-RECOVERY-FUTURE', 'session_number': 9,
                       'scheduled_start': datetime(2026, 12, 4, 9), 'scheduled_end': datetime(2026, 12, 4, 11)}
        for occurrence in (self.current, self.future):
            views.authoring_upsert(views.LIVE_SESSION_OCCURRENCES_TABLE, ['id'], occurrence)
        views.authoring_upsert(views.LIVE_SESSION_JOIN_LAUNCHES_TABLE, ['id'], {
            'id': 'JOIN-FUTURE', 'live_session_id': self.series['id'], 'occurrence_id': self.future['id'],
            'launched_at': datetime(2026, 11, 27, 8, 18),
        })
        self.window = {'createdDateTime': '2026-11-27T08:25:21Z', 'endDateTime': '2026-11-27T10:55:05Z',
                       'callId': 'call-recovery', 'contentCorrelationId': 'content-recovery'}

    def discover(self):
        def graph(method, path, **kwargs):
            self.assertEqual(method, 'GET')
            if path.endswith('/recordings'):
                return {'value': [{**self.window, 'id': 'recording-recovery'}]}
            if path.endswith('/transcripts'):
                return {'value': [{**self.window, 'id': 'transcript-recovery'}]}
            if path.endswith('/attendanceReports'):
                return {'value': []}
            if path.endswith('/onlineMeetings/meeting-recovery'):
                return {'id': 'meeting-recovery'}
            raise AssertionError('Unexpected Graph route in isolated recovery test')
        request = RequestFactory().post('/internal/artifact-recovery/')
        request.session_result_worker = True
        with patch('coach_api.views.has_graph_credentials', return_value=True), \
                patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0', 'tenant_id': 'synthetic'}), \
                patch('coach_api.views.microsoft_graph_request', side_effect=graph), \
                patch.object(views, 'resolve_directory_accounts', return_value={}):
            response = views.curriculum_teams_meeting_artifacts(request, self.series['id'])
        self.assertEqual(response.status_code, 200, response.content)
        return views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE,
                                         'occurrence_id IN (%s,%s)', [self.current['id'], self.future['id']])

    def test_future_join_does_not_discard_recording_or_steal_transcript(self):
        rows = self.discover()
        self.assertEqual({row['artifact_type'] for row in rows}, {'recording', 'transcript'})
        self.assertEqual({row['occurrence_id'] for row in rows}, {self.current['id']})
        for row in rows:
            metadata = views.parse_json_value(row['metadata'], {})
            self.assertEqual(metadata['lmsSessionNumber'], 8)
            self.assertEqual(metadata['joinLaunchId'], '')

    def test_repeated_discovery_keeps_one_artifact_identity_per_file(self):
        first = self.discover()
        second = self.discover()
        self.assertEqual({row['id'] for row in first}, {row['id'] for row in second})
        self.assertEqual(len(second), 2)

    def test_reviewed_occurrence_repair_keeps_the_original_artifact_id_on_resync(self):
        views.upsert_live_session_artifact(self.future, 'transcript', {**self.window, 'id': 'transcript-recovery'})
        old = views.authoring_fetch_all(views.LIVE_SESSION_ARTIFACTS_TABLE, 'occurrence_id=%s', [self.future['id']])[0]
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.live_session_artifacts SET occurrence_id=%s WHERE id=%s',
                           [self.current['id'], old['id']])
        rows = self.discover()
        transcript = next(row for row in rows if row['artifact_type'] == 'transcript')
        self.assertEqual(transcript['id'], old['id'])
        self.assertEqual(transcript['occurrence_id'], self.current['id'])
