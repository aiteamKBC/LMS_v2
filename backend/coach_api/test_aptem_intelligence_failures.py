"""Imported-only failure reproductions; synthetic Graph, no database/provider IO."""
import inspect
import json
from copy import deepcopy
from contextlib import nullcontext
from io import BytesIO
from urllib.error import HTTPError, URLError
from unittest.mock import patch

from django.test import SimpleTestCase

from coach_api import tests_migrated_intelligence as fixtures
from coach_api import views
from coach_api.migrated_intelligence_views import migrated_review_check_session


class ImportedTranscriptCompletenessTests(SimpleTestCase):
    setUp = fixtures.MigratedMeetingIntelligenceTests.setUp
    call_check = fixtures.MigratedMeetingIntelligenceTests.call_check

    def segments(self, *, failed=True):
        snapshot = fixtures.graph_snapshot(transcript=True, attendance=True)
        second = {**snapshot['artifacts'][0], 'graph_artifact_id': 'transcript-2',
                  'transcript_text': '' if failed else 'Final agreed actions'}
        if failed:
            second['transcript_fetch_error'] = 'Microsoft Graph returned 503 for transcript content.'
            snapshot['errors'].append(second['transcript_fetch_error'])
        snapshot['artifacts'].append(second)
        return snapshot

    def test_partial_call_never_generates_or_binds_in_any_imported_summary_family(self):
        for family in ('MCM', 'PR', 'PR_SKILLS_RADAR'):
            for answer in ({}, {'summary': 'Coach edit'}, {'summary': ''}):
                with self.subTest(family=family, answer=answer):
                    self.overlay = fixtures.review()
                    self.overlay.answers = deepcopy(answer)
                    self.overlay.template_snapshot = {'family': family, 'sections': [{'key': 'meeting', 'title': 'Meeting', 'order': 0, 'fields': [
                        {'key': 'summary', 'title': 'Recap', 'order': 0, 'aptemType': 13, 'semanticKey': 'meeting_summary'},
                    ]}]}
                    self.record.event_type = 'mcr' if family == 'MCM' else 'progress-review'
                    with patch('coach_api.views.openai_meeting_summary', return_value=({'overview': 'Incomplete recap'}, 'model')) as ai:
                        response, persist = self.call_check(self.segments(), {'artifactId': 'transcript-1', 'text': 'Opening only'})
                    ai.assert_not_called()
                    self.assertEqual(response.status_code, 207)
                    self.assertEqual(self.overlay.meeting_intelligence['transcriptStatus'], 'incomplete')
                    self.assertIn('TRANSCRIPT_INCOMPLETE', self.overlay.meeting_intelligence['errorCodes'])
                    self.assertNotIn('summary', self.overlay.meeting_intelligence)
                    self.assertEqual(self.overlay.answers, answer)
                    self.assertEqual(len(persist.call_args.kwargs['attendance_reports']), 1)
                    self.assertEqual([r['graph_artifact_id'] for r in persist.call_args.kwargs['artifacts']], ['transcript-1'])

    def test_empty_selected_segment_also_prevents_partial_ai_input(self):
        with patch('coach_api.views.openai_meeting_summary', return_value=({'overview': 'Incomplete'}, 'model')) as ai:
            response, _ = self.call_check(self.segments(failed=False), {'artifactId': 'transcript-1', 'text': 'Only first stored'})
        ai.assert_not_called()
        self.assertEqual(response.status_code, 207)
        self.assertIn('TRANSCRIPT_INCOMPLETE', self.overlay.meeting_intelligence['errorCodes'])

    def test_complete_same_event_cache_is_retained_without_using_failed_fresh_content_for_ai(self):
        transcript = {'artifactId': 'transcript-1,transcript-2', 'text': 'Opening\n\nFinal agreed actions'}
        cached = self.segments(failed=False)
        for row in cached['artifacts']:
            row['metadata'] = {'_lms_graph_event_id': self.record.graph_event_id,
                               '_lms_verified_online_meeting_id': 'synthetic-meeting'}
        with patch('coach_api.views.openai_meeting_summary', return_value=({'overview': 'All facts'}, 'model')) as ai:
            response, _ = self.call_check(self.segments(), transcript, stored_snapshot=cached)
        ai.assert_not_called()
        self.assertEqual(response.status_code, 207)  # Fresh fetch failure remains visible.
        self.assertEqual(self.overlay.meeting_intelligence['transcriptStatus'], 'incomplete')
        self.assertEqual(self.overlay.answers, {})

    def test_retry_after_missing_segment_generates_once_with_all_segments(self):
        with patch('coach_api.views.openai_meeting_summary', return_value=({'overview': 'All facts'}, 'model')) as ai:
            self.call_check(self.segments(), {'artifactId': 'transcript-1', 'text': 'Opening'})
            ai.assert_not_called()
            complete = {'artifactId': 'transcript-1,transcript-2', 'text': 'Opening\n\nFinal actions'}
            self.call_check(self.segments(failed=False), complete)
            self.call_check(self.segments(failed=False), complete)
        ai.assert_called_once_with(self.record, complete['text'])

    def test_failed_transcript_listing_does_not_generate_from_unproven_partial_cache(self):
        fresh = fixtures.graph_snapshot()
        fresh.update(errors=['Microsoft Graph could not return transcripts for this meeting.'],
                     resourceErrors={'transcripts': 'fetch'})
        previous = fixtures.graph_snapshot(transcript=True)
        previous['artifacts'][0]['metadata'] = {'_lms_graph_event_id': self.record.graph_event_id}
        with patch('coach_api.views.openai_meeting_summary', return_value=({'overview': 'Incomplete'}, 'model')) as ai:
            response, _ = self.call_check(fresh, {'artifactId': 'transcript-1', 'text': 'Cached opening'}, previous)
        ai.assert_not_called()
        self.assertEqual(response.status_code, 207)
        self.assertIn('TRANSCRIPT_INCOMPLETE', self.overlay.meeting_intelligence['errorCodes'])


class ImportedGraphTargetFailureTests(SimpleTestCase):
    setUp = fixtures.MigratedMeetingIntelligenceTests.setUp

    def target_failure(self, error):
        with (
            patch('coach_api.migrated_intelligence_views._association', return_value=(self.overlay, self.record, {})),
            patch('coach_api.views.has_graph_credentials', return_value=True),
            patch('coach_api.actual_session_resolution.review_meeting_target', side_effect=error),
            patch('coach_api.views.stored_coach_meeting_snapshot', return_value={'storage': {'stored': True}}) as stored,
            patch('coach_api.views.persist_coach_meeting_snapshots') as persist,
            patch('coach_api.views.openai_meeting_summary') as ai,
        ):
            response = inspect.unwrap(migrated_review_check_session)(self.factory.post('/'), fixtures.ID)
        persist.assert_not_called()
        stored.assert_called_once_with(self.record)
        ai.assert_not_called()
        self.overlay.save.assert_not_called()
        self.assertNotIn('private-provider-detail', response.content.decode())
        return response, json.loads(response.content)

    def test_target_http_failure_categories_survive_to_imported_client(self):
        cases = [(401, 502, 'GRAPH_AUTHENTICATION_FAILED'), (403, 403, 'GRAPH_PERMISSION_ERROR'),
                 (404, 404, 'GRAPH_MEETING_NOT_FOUND'), (429, 429, 'GRAPH_THROTTLED'),
                 (500, 502, 'GRAPH_FETCH_FAILED'), (503, 502, 'GRAPH_FETCH_FAILED')]
        for upstream, expected, code in cases:
            with self.subTest(upstream=upstream):
                cause = HTTPError('https://graph.example.invalid', upstream, 'private-provider-detail',
                                  {'Retry-After': '15', 'request-id': '12345678-1234-1234-1234-123456789012'}, BytesIO(b'private-provider-detail'))
                error = RuntimeError('private-provider-detail')
                error.__cause__ = cause
                response, payload = self.target_failure(error)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(payload['code'], code)
                self.assertEqual(payload['stage'], 'meeting-target')
                self.assertEqual(payload['graphStatus'], upstream)
                self.assertEqual(payload['request_id'], cause.headers['request-id'])
                if upstream == 429:
                    self.assertEqual(payload['retryAfterSeconds'], 15)
                    self.assertEqual(response['Retry-After'], '15')

    def test_network_and_timeout_do_not_become_missing_meeting(self):
        for cause, expected in ((URLError('private-provider-detail'), 502), (TimeoutError(), 504)):
            with self.subTest(cause=type(cause).__name__):
                error = RuntimeError('private-provider-detail')
                error.__cause__ = cause
                response, payload = self.target_failure(error)
                self.assertEqual(response.status_code, expected)
                self.assertIn(payload['code'], ('GRAPH_FETCH_FAILED', 'GRAPH_TIMEOUT'))

    def test_empty_lookup_does_not_assert_permission_denial(self):
        with patch('coach_api.migrated_intelligence_views._association', return_value=(self.overlay, self.record, {})), \
             patch('coach_api.views.stored_coach_meeting_snapshot', return_value={'storage': {'stored': True}}), \
             patch('coach_api.views.has_graph_credentials', return_value=True), \
             patch('coach_api.actual_session_resolution.review_meeting_target', return_value=('', {'code': 'coach_online_meeting_unresolved'})):
            response = inspect.unwrap(migrated_review_check_session)(self.factory.post('/'), fixtures.ID)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)['code'], 'GRAPH_MEETING_UNRESOLVED')

    def test_default_shared_target_failure_behavior_is_unchanged(self):
        with patch('coach_api.views.has_graph_credentials', return_value=True), \
             patch('coach_api.views.coach_meeting_graph_target', side_effect=RuntimeError('synthetic')):
            snapshot, payload, status = views.fetch_coach_meeting_graph_snapshot(self.record)
        self.assertIsNone(snapshot)
        self.assertEqual(status, 409)
        self.assertEqual(payload['code'], 'coach_artifact_target_unavailable')


class ImportedTranscriptPagingTests(SimpleTestCase):
    setUp = fixtures.MigratedMeetingIntelligenceTests.setUp

    def fetch(self, pages, *, imported=True):
        base = 'users/organizer/onlineMeetings/meeting'
        first = fixtures.graph_snapshot(transcript=True)['artifacts'][0]
        artifact = {'id': 'segment-1', 'callId': 'one-call', 'createdDateTime': first['created_datetime'],
                    'endDateTime': first['end_datetime']}
        def graph(_method, path):
            if '/transcripts' in path:
                return pages.pop(0)
            return {'value': []}
        with (
            patch('coach_api.migrated_intelligence_views._association', return_value=(self.overlay, self.record, {})),
            patch('coach_api.migrated_intelligence_views.transaction.atomic', return_value=nullcontext()),
            patch('coach_api.views.has_graph_credentials', return_value=True),
            patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}),
            patch('coach_api.actual_session_resolution.review_meeting_target',
                  side_effect=lambda _record, *, identity_out: (
                      identity_out.update(target=__import__('types').SimpleNamespace(online_meeting_id='meeting'))
                      or (base, None))),
            patch('coach_api.views.coach_meeting_graph_target', return_value=(base, None)),
            patch('coach_api.views.microsoft_graph_request', side_effect=graph) as calls,
            patch('coach_api.views.coach_meeting_expected_attendees', return_value=[]),
            patch('coach_api.views.fetch_coach_meeting_transcript_content', return_value={'transcript_text': 'Synthetic facts'}) as content,
            patch('coach_api.views.stored_coach_meeting_snapshot', return_value={'artifacts': [], 'attendanceReports': []}),
            patch('coach_api.views.persist_coach_meeting_snapshots', return_value={'stored': False}) as persist,
        ):
            # Exercise the real imported adapter's opt-in. Stop at an explicit
            # storage failure, before any DB writer or AI can be invoked.
            for page in pages:
                page['value'] = [{**artifact, **row} for row in page.get('value', [])]
            if imported:
                response = inspect.unwrap(migrated_review_check_session)(self.factory.post('/'), fixtures.ID)
                self.assertEqual(response.status_code, 503)
                rows = persist.call_args.kwargs['artifacts']
            else:
                snapshot, error, _ = views.fetch_coach_meeting_graph_snapshot(self.record)
                self.assertIsNone(error)
                rows = snapshot['artifacts']
        return rows, calls, content

    def test_imported_transcripts_follow_exact_continuation_query(self):
        path = 'users/organizer/onlineMeetings/meeting/transcripts?$skiptoken=opaque%2Btoken'
        rows, calls, content = self.fetch([
            {'value': [{'id': 'segment-1'}], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/' + path},
            {'value': [{'id': 'segment-2'}]},
        ])
        self.assertEqual([row['graph_artifact_id'] for row in rows], ['segment-1', 'segment-2'])
        self.assertIn(('GET', path), [call.args for call in calls.call_args_list])
        self.assertEqual(content.call_count, 2)

    def test_rejected_or_unfinished_pages_do_not_download_partial_transcript(self):
        for next_link in ('https://untrusted.example.invalid/transcripts',
                          'https://[invalid/transcripts',
                          'https://graph.microsoft.com/v1.0/users/other/onlineMeetings/other/transcripts',
                          'https://graph.microsoft.com/v1.0/users/organizer/onlineMeetings/meeting/transcripts?$skiptoken=loop'):
            with self.subTest(next_link=next_link):
                rows, calls, content = self.fetch([
                    {'value': [{'id': 'segment-1'}], '@odata.nextLink': next_link},
                    {'value': [], '@odata.nextLink': next_link},
                ])
                self.assertEqual(rows, [])
                content.assert_not_called()
                self.assertLessEqual(calls.call_count, 4)

    def test_native_default_keeps_existing_collection_behavior(self):
        rows, calls, content = self.fetch([
            {'value': [{'id': 'segment-1'}], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next'},
        ], imported=False)
        self.assertEqual(len(rows), 1)
        content.assert_called_once()
        self.assertEqual(calls.call_count, 3)

    def test_empty_final_page_and_duplicate_metadata_are_safe(self):
        next_link = 'https://graph.microsoft.com/v1.0/users/organizer/onlineMeetings/meeting/transcripts?$skiptoken=last'
        for last in ([], [{'id': 'segment-1'}]):
            with self.subTest(last=last):
                rows, _, content = self.fetch([
                    {'value': [{'id': 'segment-1'}], '@odata.nextLink': next_link}, {'value': last},
                ])
                self.assertEqual(len(rows), 1)
                content.assert_called_once()

    def test_page_and_metadata_budgets_fail_without_content_download(self):
        pages = [{'value': [{'id': f'segment-{i}'}], '@odata.nextLink':
                  f'https://graph.microsoft.com/v1.0/users/organizer/onlineMeetings/meeting/transcripts?$skiptoken={i}'} for i in range(5)]
        for batch in (pages, [{'value': [{'id': str(i)} for i in range(101)]}]):
            rows, _, content = self.fetch(batch)
            self.assertEqual(rows, [])
            content.assert_not_called()

    def test_conflicting_segment_metadata_fails_closed(self):
        next_link = 'https://graph.microsoft.com/v1.0/users/organizer/onlineMeetings/meeting/transcripts?$skiptoken=last'
        rows, _, content = self.fetch([
            {'value': [{'id': 'segment-1'}], '@odata.nextLink': next_link},
            {'value': [{'id': 'segment-1', 'callId': 'different-call'}]},
        ])
        self.assertEqual(rows, [])
        content.assert_not_called()
