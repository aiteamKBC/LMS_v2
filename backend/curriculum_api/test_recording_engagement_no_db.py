"""Read-only insight contracts, privacy thresholds and duplicate identities."""
from unittest.mock import patch

from django.test import SimpleTestCase
from django.core.cache import cache
from django.test import RequestFactory
from types import SimpleNamespace
from login import permissions

from . import recording_engagement as insights
from . import session_results


class RecordingEngagementTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.source = {'id': 'R', 'artifact_type': 'recording', 'occurrence_id': 'O', 'metadata': {
            'lmsBunnyRecording': {'libraryId': '798153', 'videoId': 'c1c2c3c4-1234-5678-abcd-123456789abc'}}}
        self.people = [{'learner_kind': 'commercial', 'learner_id': i, 'watched_seconds': 600,
                        'duration_seconds': 600} for i in range(12)]

    def load(self, *, learner=True, artifacts=None, people=None):
        with patch.object(insights, 'read', side_effect=[artifacts or [self.source], self.people if people is None else people]) as read, \
                patch.object(insights, '_bunny_statistics', return_value={'state': 'unavailable'}) as provider:
            result = insights.recording_engagement('S', {'artifact_id': 'R', 'occurrence_id': 'O'}, learner_view=learner)
        return result, read, provider

    def test_learner_gets_only_highlights_and_never_provider_or_personal_information(self):
        result, _, provider = self.load()
        self.assertEqual(result, {'audience': 'learner', 'highlights': {'watched': 12, 'finished': 12}})
        provider.assert_not_called()

    def test_small_counts_are_suppressed_independently_on_server(self):
        result, _, _ = self.load(people=self.people[:4])
        self.assertEqual(result['highlights'], {'watched': None, 'finished': None})
        result, _, _ = self.load(people=self.people[:5])
        self.assertEqual(result['highlights'], {'watched': None, 'finished': 5})
        result, _, _ = self.load(people=[{**row, 'watched_seconds': 60} for row in self.people[:10]])
        self.assertEqual(result['highlights'], {'watched': 10, 'finished': None})

    def test_duplicate_video_aliases_and_repeated_reports_do_not_duplicate_people(self):
        result, read, _ = self.load(artifacts=[self.source, {**self.source, 'id': 'ALIAS'}], people=self.people * 2)
        self.assertEqual(result['highlights'], {'watched': 12, 'finished': 12})
        self.assertEqual(read.call_args.args[1], ['S', 'O', ['R', 'ALIAS']])

    def test_other_video_is_not_included_and_unknown_duration_is_not_completion(self):
        other = {**self.source, 'id': 'OTHER', 'metadata': {}}
        result, read, _ = self.load(artifacts=[self.source, other],
            people=[{**row, 'duration_seconds': 0} for row in self.people])
        self.assertEqual(read.call_args.args[1], ['S', 'O', ['R']])
        self.assertEqual(result['highlights']['finished'], None)

    def test_admin_sees_small_counts_and_provider_outage_without_fabricated_zeros(self):
        result, _, provider = self.load(learner=False, people=self.people[:2])
        self.assertEqual((result['learners'], result['finished'], result['completionPercent']), (2, 2, 100))
        self.assertEqual(result['watchedSeconds'], 1200)
        self.assertEqual(result['provider'], {'state': 'unavailable'})
        provider.assert_called_once()

    def test_opening_without_playing_does_not_count_as_a_view(self):
        result, _, _ = self.load(learner=False, people=[{**row, 'watched_seconds': 0} for row in self.people])
        self.assertEqual((result['learners'], result['finished'], result['completionPercent']), (0, 0, None))

    def test_provider_statistics_are_video_scoped_cached_and_do_not_turn_outage_into_zero(self):
        with patch.object(insights, 'BunnyStream') as client:
            client.return_value.request.return_value = {'viewsChart': {'2026-11-10': 15}, 'engagementScore': 85}
            saved = self.source['metadata']['lmsBunnyRecording']
            data = insights._bunny_statistics(saved)
            self.assertEqual((data['views'], data['periodDays']), (15, 30))
            self.assertEqual(insights._bunny_statistics(saved), data)
            client.return_value.request.assert_called_once()
            self.assertEqual(client.return_value.request.call_args.kwargs['params']['videoGuid'], saved['videoId'])
            cache.clear()
            client.return_value.request.side_effect = RuntimeError('Sensitive upstream text')
            self.assertEqual(insights._bunny_statistics(saved), {'state': 'unavailable'})
            self.assertEqual(insights._bunny_statistics({'libraryId': '798153'}), {'state': 'unavailable'})

    def test_existing_authorised_artifact_endpoint_selects_learner_redaction(self):
        row = {'artifact_id': 'R', 'occurrence_id': 'O', 'artifact_type': 'recording', 'status': 'ready',
               'metadata': {}, 'scheduled_start': '2026-11-01T10:00:00Z'}
        payload = {'audience': 'learner', 'highlights': {'watched': None, 'finished': None}}
        with patch.object(session_results, 'read', side_effect=[[self.source], [row]]), \
                patch.object(insights, 'recording_engagement', return_value=payload) as load:
            result = session_results.stored_content(RequestFactory().get('/artifacts/R/', {'format': 'engagement'}),
                                                    'S', 'R', learner_view=True)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result['Cache-Control'], 'private, no-store')
        self.assertTrue(load.call_args.kwargs['learner_view'])

    def test_learner_cannot_use_admin_format_to_bypass_the_existing_role_gate(self):
        request = RequestFactory().get('/artifacts/R/', {'format': 'engagement'})
        with patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='learner')), \
                patch.object(insights, 'recording_engagement') as load:
            result = session_results.admin_content(request, 'S', 'R')
        self.assertEqual(result.status_code, 403)
        load.assert_not_called()

    def test_personal_course_forwards_only_the_assigned_session_insight_format(self):
        from learner_api.personal_learning_reads import session_read
        identity = 'pl.7.study.M'
        context = {'id': identity, 'module_id': 'M', 'mode': 'study'}
        detail = {'components': [{'teamsLiveSessionId': 'S', 'teamsSessionNumber': 1}]}
        path = f'/learner_api/session-results/commercial/{identity}/S/artifacts/R/'
        with patch('learner_api.personal_learning.ensure_open'), \
                patch.object(session_results, 'read', side_effect=[[{'id': 'S'}], [{'session_number': 1}]]), \
                patch.object(session_results, 'stored_content') as content:
            session_read(RequestFactory().get('/adapter'), context, detail, path, {'format': 'engagement'})
        self.assertEqual(content.call_args.args[0].GET['format'], 'engagement')
        self.assertTrue(content.call_args.kwargs['learner_view'])
        with patch('learner_api.personal_learning.ensure_open'), \
                patch.object(session_results, 'read', return_value=[{'id': 'S'}]), \
                patch.object(session_results, 'stored_content') as content:
            with self.assertRaises(LookupError):
                session_read(RequestFactory().get('/adapter'), context, {'components': []}, path, {'format': 'engagement'})
        content.assert_not_called()
