"""Backup SQL and rollback on a verified disposable PostgreSQL test database."""
from hashlib import sha256
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TestCase

from .management.commands import backup_coaching_transcripts as backup


@skipUnless(connection.vendor == 'postgresql', 'Requires verified disposable PostgreSQL.')
class CoachingTranscriptBackupPostgresTests(TestCase):
    databases = {'default'}

    def setUp(self):
        self.enterContext(patch.object(backup, 'RELATION', 'pg_temp.transcript_backup_test'))
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TEMP TABLE transcript_backup_test (
                event_key text,graph_artifact_id text,owner_email text,artifact_type text,
                transcript_vtt text,transcript_text text,transcript_blob_container text,
                transcript_blob_name text,transcript_blob_size_bytes bigint,
                transcript_blob_uploaded_at timestamptz,transcript_blob_error text,updated_at timestamptz,
                UNIQUE(event_key,artifact_type,graph_artifact_id)) ON COMMIT DROP''')
            cursor.execute('''INSERT INTO transcript_backup_test
                (event_key,graph_artifact_id,owner_email,artifact_type,transcript_vtt,transcript_text)
                VALUES ('synthetic-event','part','coach@example.invalid','transcript',%s,'Synthetic كلام')''',
                ['WEBVTT\n\n00:00.000 --> 00:01.000\nSynthetic كلام'])
        self.identity = ('synthetic-event', 'part', 'coach@example.invalid', 50)
        self.upload = self.enterContext(patch.object(backup, 'upload_blob'))
        self.download = self.enterContext(patch.object(backup, 'download_blob_bytes'))

    def saved(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT transcript_vtt,transcript_text,transcript_blob_name FROM transcript_backup_test')
            return cursor.fetchone()

    def test_success_publishes_only_verified_pointer_and_preserves_utf8_source(self):
        original = self.saved()
        self.download.return_value = original[0].encode()
        self.assertEqual(backup.backup_one('default', self.identity, 'transcripts'), 'verified')
        saved = self.saved()
        self.assertEqual(saved[:2], original[:2])
        self.assertTrue(saved[2].endswith(sha256(original[0].encode()).hexdigest() + '.vtt'))
        self.assertEqual(backup.backup_one('default', self.identity, 'transcripts'), 'busy')
        self.assertEqual(self.upload.call_count, 1)

    def test_failed_readback_rolls_back_without_erasing_source(self):
        original = self.saved()
        self.download.return_value = b'not the transcript'
        with self.assertRaises(ValueError):
            backup.backup_one('default', self.identity, 'transcripts')
        self.assertEqual(self.saved(), original)

    def test_another_owner_cannot_publish_a_pointer(self):
        original = self.saved()
        identity = (*self.identity[:2], 'another@example.invalid', self.identity[3])
        self.assertEqual(backup.backup_one('default', identity, 'transcripts'), 'busy')
        self.assertEqual(self.saved(), original)
        self.upload.assert_not_called()
