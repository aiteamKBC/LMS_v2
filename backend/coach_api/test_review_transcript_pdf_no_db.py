"""Coach Review transcript PDF checks with synthetic, stored evidence only."""
from datetime import datetime, timezone
from inspect import unwrap
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import patch

from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory, SimpleTestCase
from pypdf import PdfReader

from .review_transcript_pdf import coach_review_transcript_pdf


class ReviewTranscriptPdfTests(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory().get('/coach_api/coach/timetable/events/review:synthetic/transcript-pdf/combined')
        self.record = SimpleNamespace(
            event_type='mcr', owner_email='coach@example.invalid', owner_name='Synthetic Coach',
            learner_name='Synthetic Learner',
            calendar_window=(datetime(2026, 11, 9, 9, tzinfo=timezone.utc),
                             datetime(2026, 11, 9, 10, tzinfo=timezone.utc)),
        )
        # The endpoint's existing Coach guard is tested separately; bypass only
        # that outer decorator here so these rendering cases need no staff DB.
        self.view = unwrap(coach_review_transcript_pdf)

    def test_combined_pdf_keeps_all_saved_speakers_and_cue_times(self):
        parts = {
            'one': 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Synthetic Coach>First segment</v>',
            'two': 'WEBVTT\n\n00:00:04.000 --> 00:00:06.000\n<v Synthetic Learner>Second segment</v>',
        }

        def content(_request, _event_key, _kind, artifact_id):
            return HttpResponse('Combined text' if artifact_id == 'combined' else parts[artifact_id])

        with patch('coach_api.views.coach_timetable_event_artifact_content', side_effect=content), \
                patch('coach_api.views.coach_meeting_artifact_record', return_value=self.record), \
                patch('coach_api.review_transcript_pdf.authenticated_coach_email', return_value=self.record.owner_email), \
                patch('coach_api.review_transcript_pdf._combined_ids', return_value=['one', 'two']), \
                patch('socket.socket', side_effect=AssertionError('Network forbidden')):
            response = self.view(self.request, 'review:synthetic', 'combined')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        pages = PdfReader(BytesIO(response.content)).pages
        text = '\n'.join(page.extract_text() for page in pages)
        for phrase in ('Synthetic Coach', 'Synthetic Learner', '00:00:01.000 - 00:00:03.000',
                       'First segment', 'Second segment'):
            self.assertIn(phrase, text)

    def test_content_denial_stops_before_pdf_generation(self):
        denied = JsonResponse({'detail': 'Not authorised.'}, status=403)
        with patch('coach_api.views.coach_timetable_event_artifact_content', return_value=denied), \
                patch('coach_api.views.coach_meeting_artifact_record') as record:
            response = self.view(self.request, 'review:synthetic', 'combined')
        self.assertIs(response, denied)
        record.assert_not_called()

    def test_old_combined_text_still_exports_when_vtt_is_missing(self):
        def content(_request, _event_key, _kind, artifact_id):
            if artifact_id == 'combined':
                return HttpResponse('First saved turn\n\nSecond saved turn', content_type='text/plain')
            return JsonResponse({'detail': 'The saved VTT is unavailable.'}, status=404)

        with patch('coach_api.views.coach_timetable_event_artifact_content', side_effect=content), \
                patch('coach_api.views.coach_meeting_artifact_record', return_value=self.record), \
                patch('coach_api.review_transcript_pdf.authenticated_coach_email', return_value=self.record.owner_email), \
                patch('coach_api.review_transcript_pdf._combined_ids', return_value=['one']):
            response = self.view(self.request, 'review:synthetic', 'combined')

        self.assertEqual(response.status_code, 200)
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(response.content)).pages)
        self.assertIn('First saved turn', text)
        self.assertIn('Second saved turn', text)

    def test_previous_meeting_pdf_uses_its_saved_window(self):
        old_start = datetime(2026, 10, 26, 9, tzinfo=timezone.utc)
        old_end = datetime(2026, 10, 26, 10, tzinfo=timezone.utc)
        saved = HttpResponse('WEBVTT\n\n00:00:01.000 --> 00:00:03.000\nOld review evidence')
        with patch('coach_api.views.coach_timetable_event_artifact_content', return_value=saved), \
                patch('coach_api.views.coach_meeting_artifact_record', return_value=self.record), \
                patch('coach_api.views.stored_coach_meeting_snapshot', return_value={}), \
                patch('coach_api.review_rescheduling.historical_content', return_value={
                    'created_datetime': old_start.isoformat(), 'end_datetime': old_end.isoformat(),
                }), \
                patch('coach_api.review_transcript_pdf.authenticated_coach_email', return_value=self.record.owner_email), \
                patch('coach_api.review_transcript_pdf.review_transcript_pdf', return_value=b'%PDF-synthetic') as render:
            response = self.view(self.request, 'review:synthetic', 'old')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'%PDF-synthetic')
        self.assertEqual(render.call_args.kwargs['window'], (old_start, old_end))
