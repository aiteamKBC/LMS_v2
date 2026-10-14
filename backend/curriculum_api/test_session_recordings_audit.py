"""Read-only reconciliation cases; Graph and storage are mocked."""

import io
import json
from datetime import datetime
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase
from azure.core.exceptions import ResourceNotFoundError

from curriculum_api import session_recordings_audit as audit


class SessionRecordingsAuditTests(SimpleTestCase):
    def setUp(self):
        self.series = {'id': 'S', 'module_catalogue_id': 'M', 'organizer_email': 'organizer@example.invalid',
                       'join_url': 'https://teams.invalid/join', 'online_meeting_id': 'MEETING',
                       'timezone': 'UTC', 'status': 'active'}
        self.first = {'id': 'O1', 'live_session_id': 'S', 'session_number': 1,
                      'scheduled_start': datetime(2026, 10, 14, 9), 'status': 'completed',
                      'join_url': '', 'online_meeting_id': ''}
        self.saved = {'id': 'A', 'occurrence_id': 'O1', 'graph_artifact_id': 'GRAPH-A',
                      'live_session_id': 'S', 'archive_status': 'ready',
                      'container': 'private', 'blob_name': 'recording.mp4'}
        self.graph_item = {'id': 'GRAPH-A', 'createdDateTime': '2026-10-14T09:10:00Z'}
        self.read_patch = patch.object(audit, 'read', side_effect=self.read_rows)
        self.graph_patch = patch.object(audit, 'collection', return_value=[self.graph_item])
        self.groups_patch = patch.object(audit, 'live_session_meeting_groups',
                                         side_effect=lambda series, rows: [('users/owner/onlineMeetings/MEETING', rows)])
        self.settings_patch = patch.object(audit, 'get_graph_settings', return_value={
            'base_url': 'https://graph.microsoft.com/v1.0'})
        blob = Mock(); blob.get_blob_properties.return_value.size = 150
        client = Mock(); client.get_blob_client.return_value = blob
        self.storage_patch = patch.object(audit, 'storage_client', return_value=client)
        self.read = self.read_patch.start(); self.addCleanup(self.read_patch.stop)
        self.graph = self.graph_patch.start(); self.addCleanup(self.graph_patch.stop)
        self.groups = self.groups_patch.start(); self.addCleanup(self.groups_patch.stop)
        self.settings = self.settings_patch.start(); self.addCleanup(self.settings_patch.stop)
        self.storage = self.storage_patch.start(); self.addCleanup(self.storage_patch.stop)
        self.blob = blob
        self.occurrences = [self.first]
        self.launches = []
        self.saved_rows = [self.saved]

    def read_rows(self, sql, params):
        if 'FROM curriculum.live_sessions s' in sql:
            return [self.series]
        if 'FROM curriculum.live_session_occurrences' in sql:
            return self.occurrences
        if 'FROM curriculum.live_session_join_launches' in sql:
            return self.launches
        if 'FROM curriculum.live_session_artifacts a' in sql:
            return self.saved_rows
        raise AssertionError(sql)

    def test_complete_recording_matches_graph_archive_and_blob(self):
        report = audit.audit_recordings(['S'])
        self.assertEqual(report, {'seriesChecked': 1, 'graphRecordings': 1,
                                  'savedRecordings': 1, 'readyRecordings': 1, 'issues': []})
        self.assertEqual(self.read.call_args_list[0].args[1], [['S']])
        self.blob.get_blob_properties.assert_called_once_with(logging_enable=False)

    def test_graph_recording_missing_from_lms_is_reported(self):
        self.saved_rows = []
        report = audit.audit_recordings(['S'])
        self.assertIn('not_imported', {issue['code'] for issue in report['issues']})
        self.assertEqual(report['graphRecordings'], 1)
        self.storage.assert_not_called()

    def test_early_rehearsal_is_not_counted_as_an_unimported_lecture(self):
        self.saved_rows = []
        self.graph_item.update(createdDateTime='2026-10-08T09:10:00Z',
                               endDateTime='2026-10-08T09:15:00Z')
        report = audit.audit_recordings(['S'])
        self.assertIn('unplanned_recording', {issue['code'] for issue in report['issues']})
        self.assertNotIn('not_imported', {issue['code'] for issue in report['issues']})

    def test_failed_archive_and_missing_blob_are_distinct(self):
        self.saved['archive_status'] = 'failed'
        report = audit.audit_recordings(['S'])
        self.assertIn('archive_not_ready', {issue['code'] for issue in report['issues']})
        self.storage.assert_not_called()
        self.saved['archive_status'] = 'ready'
        self.blob.get_blob_properties.side_effect = ResourceNotFoundError('missing')
        report = audit.audit_recordings(['S'])
        self.assertIn('blob_missing', {issue['code'] for issue in report['issues']})

    def test_empty_blob_is_reported_as_unplayable(self):
        self.blob.get_blob_properties.return_value.size = 0
        report = audit.audit_recordings(['S'])
        self.assertIn('empty_blob', {issue['code'] for issue in report['issues']})

    def test_different_lecture_day_is_reviewed_without_moving_history(self):
        self.occurrences.append({'id': 'O2', 'live_session_id': 'S', 'session_number': 2,
                                 'scheduled_start': datetime(2026, 10, 15, 9), 'status': 'completed',
                                 'join_url': '', 'online_meeting_id': ''})
        self.graph_item['createdDateTime'] = '2026-10-15T09:10:00Z'
        report = audit.audit_recordings(['S'])
        self.assertIn({'code': 'placement_review', 'seriesId': 'S', 'artifactId': 'A',
                       'occurrenceId': 'O1'}, report['issues'])
        self.assertEqual(self.saved['occurrence_id'], 'O1')

    def test_graph_denial_is_reported_without_endpoint_or_response_body(self):
        self.graph.side_effect = RuntimeError('private Graph path failed: HTTP 403; secret response')
        report = audit.audit_recordings(['S'])
        self.assertIn({'code': 'graph_check_failed', 'seriesId': 'S', 'httpStatus': '403'}, report['issues'])
        self.assertNotIn('completed_without_recording', {issue['code'] for issue in report['issues']})
        self.assertNotIn('secret', str(report))

    def test_storage_error_is_reported_without_private_exception_text(self):
        self.blob.get_blob_properties.side_effect = RuntimeError('private storage account detail')
        report = audit.audit_recordings(['S'])
        self.assertIn('storage_check_failed', {issue['code'] for issue in report['issues']})
        self.assertNotIn('private storage account detail', str(report))

    def test_missing_meeting_identity_does_not_disappear_from_audit(self):
        self.groups.side_effect = lambda series, rows: []
        report = audit.audit_recordings(['S'])
        self.assertIn('meeting_identity_missing', {issue['code'] for issue in report['issues']})
        self.graph.assert_not_called()

    def test_command_json_and_nonzero_exit_when_a_recording_is_missing(self):
        self.saved_rows = []
        output = io.StringIO()
        with self.assertRaises(CommandError):
            call_command('audit_session_recordings', '--live-session-id', 'S', '--json', stdout=output)
        report = json.loads(output.getvalue())
        self.assertIn('not_imported', {issue['code'] for issue in report['issues']})
