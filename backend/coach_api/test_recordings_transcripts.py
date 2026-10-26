"""Synthetic occurrences only. No real network or database access."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError

from django.core.cache import cache
from django.test import SimpleTestCase

from coach_api import recordings_transcripts as transport, recordings_evidence as evidence
from coach_api.recordings_calendar_media import calendar_context, calendar_record
from coach_api.recordings_saved_evidence import empty_evidence

START = datetime(2026, 10, 22, 9, tzinfo=timezone.utc)
END = START.replace(hour=10)


class TranscriptReadTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.context = calendar_context('coach@example.invalid', 'event', START, END)
        self.record = calendar_record(self.context)
        self.job = SimpleNamespace(context=self.context, result={'base': 'users/owner/onlineMeetings/online'})
        self.enterContext(patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}))
        self.graph = self.enterContext(patch('coach_api.views.microsoft_graph_request', return_value={'value': [
            {'id': 'transcript', 'createdDateTime': START.isoformat(), 'endDateTime': END.isoformat()}]}))
        self.content = self.enterContext(patch.object(transport, '_content', return_value='WEBVTT\n\nSynthetic verified transcript'))

    def test_one_occurrence_is_read_once_and_reused_by_downloads_and_keywords(self):
        result = transport.microsoft_transcript(self.record, self.job)
        self.assertEqual(result['state'], 'available')
        self.assertEqual(result['transcript']['source'], 'microsoft')
        self.assertEqual(transport.microsoft_transcript(self.record, self.job), result)
        self.assertEqual(transport.cached_microsoft_transcript(self.record, self.job), result['transcript'])
        self.graph.assert_called_once_with('GET', 'users/owner/onlineMeetings/online/transcripts')
        self.content.assert_called_once_with('users/owner/onlineMeetings/online', 'transcript')

    def test_missing_is_not_an_outage_and_another_occurrence_is_never_selected(self):
        self.graph.return_value = {'value': [{'id': 'old', 'createdDateTime': START.replace(day=21).isoformat(), 'endDateTime': END.replace(day=21).isoformat()}]}
        self.assertEqual(transport.microsoft_transcript(self.record, self.job)['state'], 'missing')
        self.content.assert_not_called()

    def test_more_than_five_transcript_parts_are_retained_and_cached(self):
        self.graph.return_value={'value':[{'id':f'part-{index}','createdDateTime':START.isoformat(),'endDateTime':END.isoformat()} for index in range(7)]}
        self.content.side_effect=[f'WEBVTT\n\nSynthetic part {index}' for index in range(7)]
        value=transport.microsoft_transcript(self.record,self.job)
        self.assertEqual(value['state'],'available');self.assertEqual(value['transcript']['partCount'],7)
        for index in range(7):self.assertIn(f'Synthetic part {index}',value['transcript']['content'])
        self.assertEqual(transport.microsoft_transcript(self.record,self.job),value)
        self.graph.assert_called_once();self.assertEqual(self.content.call_count,7)

    def test_explicit_check_keeps_saved_text_and_recovers_additional_microsoft_parts(self):
        saved={**empty_evidence('matched'),'transcript':{'content':'Saved original part','durationSeconds':None,'updatedAt':None}}
        result=evidence.check_microsoft_transcript(self.record,self.job,saved)
        self.assertIn('Saved original part',result['transcript']['content'])
        self.assertIn('Synthetic verified transcript',result['transcript']['content'])
        self.assertEqual(result['transcript']['partCount'],2)

    def test_other_owner_or_future_or_unverified_job_does_not_contact_microsoft(self):
        other = calendar_record({**self.context, 'owner': 'other@example.invalid'})
        self.assertEqual(transport.microsoft_transcript(other, self.job)['code'], 'meeting_identity_pending')
        self.assertEqual(transport.microsoft_transcript(self.record, None)['code'], 'meeting_identity_pending')
        future_context = calendar_context('coach@example.invalid', 'event', START.replace(year=2099), END.replace(year=2099))
        future_job = SimpleNamespace(context=future_context, result=self.job.result)
        self.assertEqual(transport.microsoft_transcript(calendar_record(future_context), future_job)['state'], 'unavailable')
        self.graph.assert_not_called()
        self.assertIsNone(transport.cached_microsoft_transcript(other, self.job))

    def test_permission_failure_is_visible_and_does_not_return_private_provider_details(self):
        error = RuntimeError('Private provider path and message')
        error.__cause__ = HTTPError('https://graph.microsoft.com', 403, 'Private', {}, None)
        self.graph.side_effect = error
        result = transport.microsoft_transcript(self.record, self.job)
        self.assertEqual(result['code'], 'microsoft_access_denied')
        self.assertEqual(result['state'], 'unavailable')
        self.assertNotIn('Private', str(result))

    def test_repeated_or_foreign_pagination_never_returns_partial_transcript(self):
        self.graph.return_value = {'value': [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/foreign/onlineMeetings/other/transcripts'}
        self.assertEqual(transport.microsoft_transcript(self.record, self.job)['state'], 'unavailable')
        self.content.assert_not_called()
        self.graph.assert_called_once()

    def test_saved_report_and_transcript_do_not_trigger_microsoft_or_local_fallback(self):
        saved = {**empty_evidence('matched'), 'transcript': {'content': 'Original source text'}}
        with patch.object(evidence, 'source_evidence', return_value=saved), \
                patch.object(evidence, 'local_transcript', side_effect=AssertionError('No extra reads')):
            self.assertEqual(evidence.saved_evidence(self.record, self.job, part='evidence'), saved)
        self.graph.assert_not_called()

    def test_cached_transcript_recovers_missing_source_without_fabricating_ai(self):
        transport.microsoft_transcript(self.record, self.job)
        self.graph.reset_mock()
        with patch.object(evidence, 'source_evidence', return_value=empty_evidence('not-found')), \
                patch.object(evidence, 'local_transcript', return_value=None):
            result = evidence.saved_evidence(self.record, self.job, part='evidence')
        self.assertEqual(result['state'], 'matched')
        self.assertEqual(result['analysisState'], 'not-found')
        self.assertTrue(result['transcript']['content'])
        self.assertEqual(result['analyses'], [])
        self.graph.assert_not_called()

    def test_local_transcript_uses_owner_event_and_occurrence_across_native_booking_keys(self):
        with patch.object(transport, 'connections') as databases:
            cursor = databases.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [
                ('same', 'Verified saved text', START, END, None),
                ('duplicate', 'Verified saved text', START, END, None),
                ('other-day', 'Wrong occurrence', START.replace(day=21), END.replace(day=21), None)]
            result = transport.local_transcript(self.record)
            query, parameters = cursor.execute.call_args.args
            self.assertIn('owner_email=%s AND graph_event_id=%s', query)
            self.assertNotIn('event_key=%s', query)
            self.assertEqual(parameters, [self.context['owner'], self.context['event'], END, START])
            self.assertEqual(result['content'], 'Verified saved text')
            self.assertEqual(result['source'], 'lms')
        self.graph.assert_not_called()

class TranscriptContentTests(SimpleTestCase):
    def test_content_is_bounded_with_existing_safe_redirect_handler(self):
        with patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://graph.microsoft.com/v1.0'}), \
                patch('coach_api.views.microsoft_graph_token', return_value='synthetic-token'), \
                patch.object(transport.http, 'build_opener') as opener:
            response = opener.return_value.open.return_value.__enter__.return_value
            response.read.return_value = b'WEBVTT\n\nSynthetic text'
            self.assertIn('Synthetic text', transport._content('users/owner/onlineMeetings/id', 'a/b'))
            response.read.assert_called_once_with(transport.MAX_BYTES + 1)
            self.assertIn('a%2Fb/content', opener.return_value.open.call_args.args[0].full_url)
            response.read.return_value = b'x' * (transport.MAX_BYTES + 1)
            with self.assertRaises(ValueError):
                transport._content('users/owner/onlineMeetings/id', 'id')
        with patch('coach_api.views.get_graph_settings', return_value={'base_url': 'https://foreign.invalid'}):
            with self.assertRaises(ValueError):
                transport._content('users/owner/onlineMeetings/id', 'id')
