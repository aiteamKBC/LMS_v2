"""Execute the actual snapshot upsert against isolated temporary PostgreSQL rows."""
from contextlib import nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.db import connection
from django.test import TestCase

from . import views


@skipUnless(connection.vendor == 'postgresql', 'Requires verified disposable PostgreSQL.')
class TranscriptPreservationTests(TestCase):
    databases = {'default'}

    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TEMP TABLE coach_meeting_artifacts (
                calendar_event_id bigint,event_key text,owner_email text,graph_organizer_email text,
                graph_event_id text,artifact_type text,graph_artifact_id text,call_id text,
                content_correlation_id text,created_datetime timestamptz,end_datetime timestamptz,
                transcript_vtt text,transcript_text text,transcript_content_type text,
                transcript_fetched_at timestamptz,transcript_fetch_error text,metadata jsonb,
                last_seen_at timestamptz,updated_at timestamptz,
                UNIQUE(event_key,artifact_type,graph_artifact_id)) ON COMMIT DROP''')
        self.record = SimpleNamespace(id=None, event_key='coach-calendar:synthetic',
            owner_email='coach@example.invalid', graph_organizer_email='organizer@example.invalid',
            graph_event_id='event', event_type='coach-calendar', learner_name='', learner_email='')
        self.stamp = datetime(2026, 11, 11, 10, tzinfo=timezone.utc)
        self.original = {'transcript_vtt': 'WEBVTT\n\nSynthetic saved speech',
            'transcript_text': 'Synthetic saved speech', 'transcript_content_type': 'text/vtt',
            'transcript_fetched_at': self.stamp.isoformat(), 'transcript_fetch_error': ''}
        self.save(**self.original)

    def save(self, **content):
        capture = Mock()
        fake = SimpleNamespace(cursor=lambda: nullcontext(capture))
        artifact = {'artifact_type': 'transcript', 'graph_artifact_id': 'part', 'metadata': {'id': 'part'}, **content}
        with patch.object(views.router, 'db_for_write', return_value='default'), \
             patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
             patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=True), \
             patch.object(views, 'connections', {'default': fake}):
            result = views.persist_coach_meeting_snapshots(self.record, artifacts=[artifact],
                attendance_reports=[], attendance_tracker={})
        self.assertTrue(result['stored'])
        sql, values = next(call.args for call in capture.execute.call_args_list
                           if 'INSERT INTO' in call.args[0] and 'coach_meeting_artifacts' in call.args[0])
        # Change only the destination schema; execute every production expression.
        sql = sql.replace('"Coach".coach_meeting_artifacts', 'pg_temp.coach_meeting_artifacts')
        with connection.cursor() as cursor:
            cursor.execute(sql, values)

    def saved(self):
        with connection.cursor() as cursor:
            cursor.execute('''SELECT transcript_vtt,transcript_text,transcript_content_type,
                transcript_fetched_at,transcript_fetch_error FROM pg_temp.coach_meeting_artifacts
                WHERE event_key=%s''', [self.record.event_key])
            return cursor.fetchone()

    def test_metadata_only_refresh_keeps_verified_text_type_and_fetch_time(self):
        self.save()
        self.assertEqual(self.saved(), (self.original['transcript_vtt'], self.original['transcript_text'],
                                       'text/vtt', self.stamp, ''))

    def test_provider_failure_is_visible_without_erasing_the_saved_transcript(self):
        self.save(transcript_vtt='', transcript_text='', transcript_fetch_error='Microsoft Graph returned 503.')
        saved = self.saved()
        self.assertEqual(saved[:4], (self.original['transcript_vtt'], self.original['transcript_text'], 'text/vtt', self.stamp))
        self.assertEqual(saved[4], 'Microsoft Graph returned 503.')
        self.save()
        self.assertEqual(self.saved(), saved)

    def test_successful_retry_replaces_content_and_clears_failure_for_only_this_event(self):
        first_key = self.record.event_key
        self.record.event_key = 'coach-calendar:other'
        self.save(**self.original)
        self.record.event_key = first_key
        self.save(transcript_fetch_error='Microsoft Graph returned 400.')
        self.save(**{**self.original, 'transcript_vtt': 'WEBVTT\n\nRecovered actual speech',
                     'transcript_text': 'Recovered actual speech'})
        self.assertEqual(self.saved()[1::3], ('Recovered actual speech', ''))
        self.record.event_key = 'coach-calendar:other'
        self.assertEqual(self.saved()[1], self.original['transcript_text'])
