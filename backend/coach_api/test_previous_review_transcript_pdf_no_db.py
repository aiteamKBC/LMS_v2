"""Stored previous Review PDF checks without database or external calls."""
from datetime import datetime, timezone
from inspect import unwrap
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase
from pypdf import PdfReader

from .previous_review_transcript_pdf import _previous_record_and_text, _saved_turns, previous_review_transcript_pdf


class PreviousReviewTranscriptPdfTests(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory().get('/coach_api/coach/reviews/current/previous/transcript-pdf')
        self.record = SimpleNamespace(
            event_type='mcr', owner_email='coach@example.invalid', owner_name='Synthetic Coach',
            learner_name='Synthetic Learner',
            calendar_window=(datetime(2026, 11, 9, 9, tzinfo=timezone.utc),
                             datetime(2026, 11, 9, 10, tzinfo=timezone.utc)),
        )
        self.view = unwrap(previous_review_transcript_pdf)

    def _context(self, *, available=True, transcript=True):
        return JsonResponse({
            'available': available, 'transcriptAvailable': transcript,
            'instance': {'id': 'previous'}, 'review': {'reviewTypeCode': 'mcm'},
            'transcriptText': 'Truncated UI excerpt', 'transcriptTruncated': True,
        })

    def test_full_saved_transcript_is_rendered_not_truncated_context_excerpt(self):
        with patch('coach_api.views.coach_review_instance_previous', return_value=self._context()), \
                patch('coach_api.previous_review_transcript_pdf._previous_record_and_text',
                      return_value=(self.record, {'text': 'Full saved first turn\n\nFull saved second turn'})) as saved, \
                patch('socket.socket', side_effect=AssertionError('Network forbidden')):
            response = self.view(self.request, 'current')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        saved.assert_called_once_with(self.request, 'previous', 'mcm')
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
        self.assertIn('Full saved first turn', text)
        self.assertIn('Full saved second turn', text)
        self.assertNotIn('Truncated UI excerpt', text)

    def test_unavailable_or_denied_context_never_reads_prior_content(self):
        for context in (self._context(available=False), self._context(transcript=False),
                        JsonResponse({'detail': 'Forbidden'}, status=403)):
            with self.subTest(status=context.status_code, body=json.loads(context.content)), \
                    patch('coach_api.views.coach_review_instance_previous', return_value=context), \
                    patch('coach_api.previous_review_transcript_pdf._previous_record_and_text') as saved:
                response = self.view(self.request, 'current')
            self.assertEqual(response.status_code, 403 if context.status_code == 403 else 404)
            saved.assert_not_called()

    def test_native_lookup_uses_authorized_prior_instance_and_exact_calendar_record(self):
        prior = {'id': 'previous', 'learner_id': 12}
        with patch('coach_api.views._authorized_review_instance', return_value=(prior, None)), \
                patch('coach_api.views._review_instance_calendar_record', return_value=self.record) as linked, \
                patch('coach_api.views.stored_coach_meeting_transcript_for_summary',
                      return_value={'text': 'Complete stored transcript'}) as stored:
            record, stored_value = _previous_record_and_text(self.request, 'previous', 'mcm')
        self.assertIs(record, self.record)
        self.assertEqual(stored_value['text'], 'Complete stored transcript')
        linked.assert_called_once_with(prior)
        stored.assert_called_once_with(self.record)

    def test_imported_lookup_requires_owner_booking_and_meeting_scoped_selection(self):
        overlay = SimpleNamespace(owner_email='coach@example.invalid', learner_id=12)
        selection = {'code': None, 'artifactIds': ['saved-part']}
        for review_type, event_type in (('aptem_mcm', 'mcr'), ('aptem_progress_review', 'progress-review')):
            with self.subTest(review_type=review_type):
                record = SimpleNamespace(owner_email='coach@example.invalid', learner_id=12, event_type=event_type)
                with patch('coach_api.previous_review_transcript_pdf.authenticated_coach_email',
                           return_value='coach@example.invalid'), \
                        patch('coach_api.models.ImportedReviewInstance.objects.filter') as filtered, \
                        patch('coach_api.review_sources.booking_for_overlay', return_value=record), \
                        patch('coach_api.views.stored_coach_meeting_snapshot', return_value={}) as snapshot, \
                        patch('coach_api.migrated_session_scope.stored_transcript_selection', return_value=selection) as select, \
                        patch('coach_api.views.stored_coach_meeting_transcript_for_summary',
                              return_value={'text': 'Complete imported meeting'}) as stored:
                    filtered.return_value.__getitem__.return_value = [overlay]
                    chosen, stored_value = _previous_record_and_text(self.request, 'imported-review:prior', review_type)
                self.assertIs(chosen, record)
                self.assertEqual(stored_value['text'], 'Complete imported meeting')
                snapshot.assert_called_once_with(record)
                select.assert_called_once_with(record, {}, meeting_scoped=True)
                stored.assert_called_once_with(record, artifact_ids=['saved-part'])

    def test_imported_lookup_rejects_a_different_owner_before_booking(self):
        overlay = SimpleNamespace(owner_email='another@example.invalid', learner_id=12)
        with patch('coach_api.previous_review_transcript_pdf.authenticated_coach_email',
                   return_value='coach@example.invalid'), \
                patch('coach_api.models.ImportedReviewInstance.objects.filter') as filtered, \
                patch('coach_api.review_sources.booking_for_overlay') as booking:
            filtered.return_value.__getitem__.return_value = [overlay]
            record, text = _previous_record_and_text(self.request, 'imported-review:prior', 'aptem_mcm')
        self.assertIsNone(record)
        self.assertIsNone(text)
        booking.assert_not_called()

    def test_saved_vtt_preserves_speaker_and_timestamps_with_text_fallback(self):
        stored = {'artifactId': 'one,two', 'text': 'Synthetic Coach: First part\nSynthetic Learner: Second part'}
        parts = {
            'one': {'transcript_vtt': 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Synthetic Coach>First part</v>'},
            'two': {'transcript_vtt': 'WEBVTT\n\n00:00:04.000 --> 00:00:06.000\n<v Synthetic Learner>Second part</v>'},
        }
        with patch('coach_api.views.stored_coach_meeting_transcript', side_effect=lambda _record, key: parts[key]):
            turns = _saved_turns(self.record, stored)
        self.assertEqual([turn[0] for turn in turns], ['Synthetic Coach', 'Synthetic Learner'])
        self.assertEqual(turns[0][1], '00:00:01.000 - 00:00:03.000')
        with patch('coach_api.views.stored_coach_meeting_transcript', return_value=None):
            fallback = _saved_turns(self.record, stored)
        self.assertEqual(fallback, [('Synthetic Coach', '', 'First part'),
                                    ('Synthetic Learner', '', 'Second part')])
