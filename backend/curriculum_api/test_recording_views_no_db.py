import inspect
import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import recording_views

VIEW = inspect.unwrap(recording_views.learner_recording_watch)
RECORDING = {'id': 'ART-1', 'occurrence_id': 'OCC-1', 'artifact_type': 'recording', 'metadata': '{}'}


def post(body):
    return RequestFactory().post('/', data=json.dumps(body), content_type='application/json')


class RecordingWatchTests(SimpleTestCase):
    def call(self, body, siblings=(RECORDING,), series=True):
        cursor = MagicMock()
        cursor.fetchone.return_value = (47, 7200)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        learner = SimpleNamespace(email=' Aya@Example.test ')
        with patch.object(recording_views, 'learner_series', return_value=(learner, {'id': 'LS-1'} if series else None)), \
                patch.object(recording_views, 'read', return_value=list(siblings)), \
                patch.object(recording_views, 'hidden_artifact_ids', return_value=set()), \
                patch.object(recording_views.transaction, 'atomic', return_value=nullcontext()), \
                patch.object(recording_views, 'connections', {'default': connection}):
            response = VIEW(post(body), 'apprenticeship', 101, 'LS-1', 'ART-1')
        return response, cursor

    def test_played_seconds_are_added_with_a_per_report_cap_and_clock_check(self):
        response, cursor = self.call({'watchedSeconds': 30, 'position': 612, 'duration': 7200})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {'watchedSeconds': 47, 'durationSeconds': 7200})
        sql, params = cursor.execute.call_args.args
        self.assertIn('LEAST(%s, %s)', sql)
        self.assertIn('EXTRACT(EPOCH FROM', sql)
        self.assertEqual(params[1:7], ['LS-1', 'OCC-1', 'ART-1', 'apprenticeship', 101, 'aya@example.test'])
        self.assertEqual(params[7:], [30, recording_views.MAX_REPORT_SECONDS, 7200, 612, recording_views.CLOCK_SLACK_SECONDS])

    def test_invalid_seconds_are_refused_before_any_read(self):
        for body in ({'watchedSeconds': -1}, {'watchedSeconds': 'x'}, {'watchedSeconds': 5000}, ['x']):
            with self.subTest(body=body):
                response, cursor = self.call(body)
                self.assertEqual(response.status_code, 400)
                cursor.execute.assert_not_called()

    def test_only_a_visible_recording_of_the_learners_session_is_counted(self):
        transcript = {**RECORDING, 'artifact_type': 'transcript'}
        for siblings, series in (((transcript,), True), ((), True), ((RECORDING,), False)):
            with self.subTest(siblings=siblings, series=series):
                response, cursor = self.call({'watchedSeconds': 30}, siblings=siblings, series=series)
                self.assertEqual(response.status_code, 404)
                cursor.execute.assert_not_called()


class FullyWatchedTests(SimpleTestCase):
    def check(self, artifacts, views):
        def fake_read(sql, params=()):
            return list(views) if 'live_session_recording_views' in sql else list(artifacts)
        with patch.object(recording_views, 'read', side_effect=fake_read), \
                patch.object(recording_views, 'hidden_artifact_ids', side_effect=lambda rows: {
                    row['id'] for row in rows if row.get('hidden')}):
            return recording_views.fully_watched_occurrences('commercial', 101, ['OCC-1'])

    def recording(self, artifact_id, **extra):
        return {'id': artifact_id, 'occurrence_id': 'OCC-1', 'artifact_type': 'recording', 'archive_status': 'ready', **extra}

    def test_every_playable_recording_must_be_watched_to_within_a_few_seconds_of_the_end(self):
        artifacts = [self.recording('R1'), self.recording('R2')]
        both = [{'artifact_id': 'R1', 'watched_seconds': 7195, 'duration_seconds': 7200},
                {'artifact_id': 'R2', 'watched_seconds': 600, 'duration_seconds': 600}]
        self.assertEqual(self.check(artifacts, both), {'OCC-1'})
        two_percent_short = [{'artifact_id': 'R1', 'watched_seconds': 7378, 'duration_seconds': 7470}, both[1]]
        self.assertEqual(self.check(artifacts, two_percent_short), {'OCC-1'})
        one_short = [both[0], {'artifact_id': 'R2', 'watched_seconds': 300, 'duration_seconds': 600}]
        self.assertEqual(self.check(artifacts, one_short), set())
        self.assertEqual(self.check(artifacts, both[:1]), set())

    def test_one_recording_returned_twice_by_teams_needs_watching_once(self):
        meta = '{"callId": "C1", "createdDateTime": "2026-09-17T10:50:39Z", "endDateTime": "2026-09-17T12:55:09Z"}'
        artifacts = [self.recording('R1', metadata=meta), self.recording('R2', metadata=meta)]
        watched = [{'artifact_id': 'R2', 'watched_seconds': 7470, 'duration_seconds': 7470}]
        self.assertEqual(self.check(artifacts, watched), {'OCC-1'})

    def test_hidden_or_unarchived_recordings_are_not_required_and_nothing_to_watch_is_not_complete(self):
        artifacts = [self.recording('R1'), self.recording('R2', hidden=True), self.recording('R3', archive_status='pending')]
        watched = [{'artifact_id': 'R1', 'watched_seconds': 7200, 'duration_seconds': 7200}]
        self.assertEqual(self.check(artifacts, watched), {'OCC-1'})
        self.assertEqual(self.check([self.recording('R2', hidden=True)], []), set())


class RecordingWatchStateTests(SimpleTestCase):
    def test_get_returns_viewing_so_far_and_a_csrf_token_for_reports(self):
        rows = {'artifacts': [RECORDING], 'views': [{'watched_seconds': 125, 'duration_seconds': 7200}]}
        def fake_read(sql, params=()):
            return rows['views'] if 'live_session_recording_views' in sql else rows['artifacts']
        with patch.object(recording_views, 'learner_series', return_value=(SimpleNamespace(email=''), {'id': 'LS-1'})), \
                patch.object(recording_views, 'read', side_effect=fake_read), \
                patch.object(recording_views, 'hidden_artifact_ids', return_value=set()):
            response = VIEW(RequestFactory().get('/'), 'commercial', 101, 'LS-1', 'ART-1')
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((body['watchedSeconds'], body['durationSeconds']), (125, 7200))
        self.assertTrue(body['csrfToken'])
