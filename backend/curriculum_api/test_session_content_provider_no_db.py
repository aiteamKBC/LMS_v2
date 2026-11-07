"""Legacy recording URLs must retain Bunny and never use Azure on failure."""
import sys
import types
import unittest
from unittest.mock import Mock, patch

from curriculum_api.test_session_results_no_db import ROOT, Response, functions
from curriculum_api.bunny_stream import VideoImportError


class LegacyRecordingProviderTests(unittest.TestCase):
    def setUp(self):
        self.artifact = {'id': 'A', 'occurrence_id': 'O', 'artifact_type': 'recording',
                         'graph_artifact_id': 'REC', 'metadata': {'lmsBunnyRecording': {'state': 'ready'}}}
        self.occurrence = {'id': 'O', 'scheduled_start': '2026-11-06T09:00:00Z'}
        self.fetch = Mock(side_effect=lambda table, *args: {
            'series': [{'id': 'S'}], 'occurrences': [self.occurrence], 'artifacts': [self.artifact]}[table])
        self.player = Mock(return_value='https://video.b-cdn.net/signed/rendition.mp4')
        self.azure = Mock(return_value='https://storage.invalid/old.mp4')
        self.token, self.graph = Mock(), Mock()
        coach = types.ModuleType('coach_api.views')
        coach.get_graph_settings, coach.microsoft_graph_token = Mock(), self.token
        archive = types.ModuleType('coach_api.recording_archive')
        archive.archived_live_session_recording_url = self.azure
        bunny = types.ModuleType('curriculum_api.session_bunny')
        bunny.recording_player = self.player
        modules = patch.dict(sys.modules, {'coach_api.views': coach, 'coach_api.recording_archive': archive,
                                          'curriculum_api.session_bunny': bunny})
        modules.start()
        self.addCleanup(modules.stop)
        self.ns = {'__name__': 'curriculum_api.views', '__package__': 'curriculum_api',
            'require_GET': lambda f: f, 'ensure_live_session_tracking_tables': Mock(),
            'authoring_fetch_all': self.fetch, 'clean_str': lambda value: str(value or '').strip(),
            'LIVE_SESSIONS_TABLE': 'series', 'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
            'LIVE_SESSION_ARTIFACTS_TABLE': 'artifacts',
            'json_error': lambda message, status=400: Response({'error': message}, status),
            'HttpResponseRedirect': lambda url: Response({'location': url}, 302),
            'urllib_request': types.SimpleNamespace(urlopen=self.graph)}
        functions(ROOT / 'views.py', {'curriculum_teams_meeting_artifact_content'}, self.ns)

    def call(self):
        request = types.SimpleNamespace(GET={'preview': '1'}, META={},
            build_absolute_uri=lambda path: 'https://lms.example.invalid' + path)
        return self.ns['curriculum_teams_meeting_artifact_content'](request, 'S', 'A')

    def assert_no_legacy_source(self):
        self.azure.assert_not_called()
        self.token.assert_not_called()
        self.graph.assert_not_called()

    def test_cutover_preview_redirects_to_bunny_mp4_and_is_not_cached(self):
        response = self.call()
        self.assertEqual((response.status_code, response['location']), (302, self.player.return_value))
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.player.assert_called_once_with(self.artifact, download=True, referrer='https://lms.example.invalid/')
        self.assert_no_legacy_source()

    def test_missing_cutover_pointer_reports_pending_without_azure_or_microsoft(self):
        self.artifact['metadata'] = {}
        self.assertEqual(self.call().status_code, 409)
        self.player.assert_not_called()
        self.assert_no_legacy_source()

    def test_bunny_error_is_visible_and_does_not_select_azure_or_microsoft(self):
        self.player.side_effect = VideoImportError('Bunny is temporarily unavailable.')
        response = self.call()
        self.assertEqual(response.status_code, 503)
        self.assertIn('Bunny', response['error'])
        self.assert_no_legacy_source()

    def test_older_recording_already_on_bunny_cannot_revert_to_azure(self):
        self.occurrence['scheduled_start'] = '2026-10-16T08:00:00Z'
        self.assertEqual(self.call()['location'], self.player.return_value)
        self.assert_no_legacy_source()

    def test_unmigrated_historical_recording_keeps_its_existing_source(self):
        self.occurrence['scheduled_start'] = '2026-10-16T08:00:00Z'
        self.artifact['metadata'] = {}
        response = self.call()
        self.assertEqual((response.status_code, response['location']), (302, self.azure.return_value))
        self.player.assert_not_called()
        self.token.assert_not_called()

    def test_recording_cannot_be_served_through_another_series(self):
        self.artifact['occurrence_id'] = 'OTHER'
        self.assertEqual(self.call().status_code, 404)
        self.player.assert_not_called()
        self.assert_no_legacy_source()

    def test_unknown_series_cannot_resolve_a_provider(self):
        self.fetch.side_effect = [[]]
        self.assertEqual(self.call().status_code, 404)
        self.player.assert_not_called()
        self.assert_no_legacy_source()


if __name__ == '__main__':
    unittest.main()
