"""Real selection/update SQL on isolated synthetic SQLite rows; mocked S3.

SQLite omits FOR UPDATE, so these tests do not claim PostgreSQL lock coverage
or live AWS acceptance. No Microsoft/video/evidence API is invoked.
"""
from contextlib import contextmanager
from io import StringIO
import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from azure.core.exceptions import ResourceExistsError
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from .management.commands import backup_coaching_transcripts as backup


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, sql, params=()):
        return self.cursor.execute(sql.replace('%s', '?').replace('FOR UPDATE SKIP LOCKED', ''), params)

    def __getattr__(self, name):
        return getattr(self.cursor, name)


@override_settings(STORAGE_BACKEND='s3', AWS_S3_STORAGE_BUCKET='synthetic-backups',
                   AZURE_STORAGE_ACCOUNT='synthetic', AZURE_TRANSCRIPTS_CONTAINER='transcripts')
class CoachingTranscriptBackupTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:', isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.create_function('octet_length', 1, lambda value: len(value.encode()) if value else 0)
        self.db.create_function('current_database', 0, lambda: 'backup_test')
        self.db.execute("ATTACH DATABASE ':memory:' AS Coach")
        self.db.execute('''CREATE TABLE Coach.coach_meeting_artifacts (
            event_key text,graph_artifact_id text,owner_email text,artifact_type text,
            transcript_vtt text,transcript_text text,transcript_blob_container text,
            transcript_blob_name text,transcript_blob_size_bytes integer,
            transcript_blob_uploaded_at text,transcript_blob_error text,updated_at text,
            graph_event_id text,blob_name text,
            UNIQUE(event_key,artifact_type,graph_artifact_id))''')
        fake = SimpleNamespace(cursor=self.cursor, settings_dict={'HOST': 'ep-backup-pooler.example.invalid'})
        self.mock('connections', {'backup-test': fake})
        self.mock('router.db_for_write', return_value='backup-test')
        self.mock('transaction.atomic', side_effect=self.atomic)
        self.objects = {}
        self.upload = self.mock('upload_blob', side_effect=self.put)
        self.download = self.mock('download_blob_bytes', side_effect=self.get)

    def mock(self, name, *args, **kwargs):
        operation = patch.object(backup, name, *args, **kwargs) if '.' not in name else patch(
            f'{backup.__name__}.{name}', *args, **kwargs)
        value = operation.start()
        self.addCleanup(operation.stop)
        return value

    @contextmanager
    def cursor(self):
        cursor = self.db.cursor()
        try:
            yield Cursor(cursor)
        finally:
            cursor.close()

    @contextmanager
    def atomic(self, **kwargs):
        self.db.execute('BEGIN')
        try:
            yield
        except Exception:
            self.db.execute('ROLLBACK')
            raise
        else:
            self.db.execute('COMMIT')

    def put(self, stream, container, name, content_type, *, overwrite):
        self.assertFalse(overwrite)
        self.assertEqual(content_type, 'text/vtt')
        if (container, name) in self.objects:
            raise ResourceExistsError('Synthetic existing object')
        self.objects[container, name] = stream.read()

    def get(self, container, name, *, max_bytes):
        payload = self.objects[container, name]
        if len(payload) > max_bytes:
            raise ValueError('Oversized synthetic object')
        return payload

    def seed(self, key='event', *, owner='coach@example.invalid', kind='transcript', vtt=None, blob=''):
        vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nSynthetic كلام\n' if vtt is None else vtt
        self.db.execute('''INSERT INTO Coach.coach_meeting_artifacts
            (event_key,graph_artifact_id,owner_email,artifact_type,transcript_vtt,transcript_text,
             transcript_blob_name,graph_event_id,blob_name) VALUES (?,?,?,?,?,?,?,?,?)''',
            (key, 'part', owner, kind, vtt, 'Synthetic كلام', blob, 'microsoft-event', 'original-video'))

    def snapshot(self):
        return self.db.execute('SELECT * FROM Coach.coach_meeting_artifacts ORDER BY event_key').fetchall()

    def command(self, **changes):
        options = dict(limit=100, event_key=[], apply=False, expected_database='backup_test',
                       expected_endpoint='ep-backup', expected_bucket='synthetic-backups')
        options.update(changes)
        output = StringIO()
        backup.Command(stdout=output).handle(**options)
        return json.loads(output.getvalue())

    def test_inspect_never_uploads_or_updates_and_counts_utf8_bytes(self):
        self.seed()
        before = self.snapshot()
        report = self.command()
        self.assertEqual(report['mode'], 'inspect')
        self.assertEqual(report['selectedTranscriptParts'], 1)
        self.assertEqual(report['sourceBytes'], len(before[0][4].encode()))
        self.assertEqual(before, self.snapshot())
        self.upload.assert_not_called()
        self.download.assert_not_called()

    def test_apply_copies_only_vtt_and_preserves_text_video_identity_and_unrelated_rows(self):
        self.seed()
        self.seed('video', kind='recording')
        self.seed('existing', blob='legacy-transcript')
        self.seed('empty', vtt='')
        before = self.snapshot()
        report = self.command(apply=True)
        after = self.snapshot()
        self.assertEqual((report['verifiedBackups'], report['failedVerification'], report['busy']), (1, 0, 0))
        for old, new in zip(before, after):
            if old[0] != 'event':
                self.assertEqual(old, new)
            else:
                self.assertEqual(old[:6], new[:6])
                self.assertEqual(old[12:], new[12:])
                self.assertTrue(new[7].startswith('coaching-transcripts/v1/'))
                self.assertEqual(new[8], len(old[4].encode()))
                self.assertEqual(new[10], '')
        self.assertEqual(self.upload.call_count, 1)
        self.assertEqual(self.command(apply=True)['selectedTranscriptParts'], 0)

    def test_filter_and_limit_only_change_selected_event(self):
        self.seed('event-a')
        self.seed('event-b')
        self.assertEqual(self.command(limit=1)['selectedTranscriptParts'], 1)
        self.command(apply=True, event_key=['event-b', 'event-b'])
        self.assertEqual([row[0] for row in self.snapshot() if not row[7]], ['event-a'])

    def test_source_identities_get_distinct_immutable_keys(self):
        self.seed('event-a')
        self.seed('event-b', owner='another@example.invalid')
        self.command(apply=True)
        self.assertEqual(len(self.objects), 2)
        self.assertTrue(all('example.invalid' not in name and 'event-' not in name for _, name in self.objects))

    def test_bad_database_endpoint_or_bucket_prevents_all_storage_io(self):
        self.seed()
        before = self.snapshot()
        for option in ('expected_database', 'expected_endpoint', 'expected_bucket'):
            for value in ('wrong-target', None):
                with self.subTest(option=option, value=value), self.assertRaises(CommandError):
                    self.command(apply=True, **{option: value})
        self.assertEqual(before, self.snapshot())
        self.upload.assert_not_called()
        self.download.assert_not_called()

    @override_settings(STORAGE_BACKEND='azure')
    def test_apply_refuses_azure_instead_of_migrating_to_an_unapproved_destination(self):
        with self.assertRaises(CommandError):
            self.command(apply=True)
        self.upload.assert_not_called()

    def test_storage_failure_retains_saved_transcript_and_does_not_leak_error_text(self):
        self.seed()
        before = self.snapshot()
        self.upload.side_effect = RuntimeError('private-token-and-transcript')
        output = StringIO()
        options = dict(limit=100, event_key=[], apply=True, expected_database='backup_test',
                       expected_endpoint='ep-backup', expected_bucket='synthetic-backups')
        with self.assertRaises(CommandError):
            backup.Command(stdout=output).handle(**options)
        self.assertNotIn('private-token', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['errorTypes'], {'RuntimeError': 1})
        self.assertEqual(before, self.snapshot())

    def test_failed_readback_never_publishes_a_pointer_and_safe_retry_reuses_object(self):
        self.seed()
        before = self.snapshot()
        self.download.side_effect = lambda *a, **kw: b'wrong bytes'
        with self.assertRaises(CommandError):
            self.command(apply=True)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(len(self.objects), 1)
        self.download.side_effect = self.get
        self.assertEqual(self.command(apply=True)['verifiedBackups'], 1)
        self.assertEqual(len(self.objects), 1)

    def test_oversized_or_invalid_source_never_uploads(self):
        for content in ('invalid body', 'WEBVTT' + 'x' * backup.MAX_BYTES):
            with self.subTest(size=len(content)):
                self.db.execute('DELETE FROM Coach.coach_meeting_artifacts')
                self.seed(vtt=content)
                before = self.snapshot()
                with self.assertRaises(CommandError):
                    self.command(apply=True)
                self.assertEqual(before, self.snapshot())
        self.upload.assert_not_called()

    def test_database_failure_after_upload_retains_text_and_retry_reuses_verified_object(self):
        self.seed()
        before = self.snapshot()
        self.db.execute('''CREATE TRIGGER Coach.reject_backup BEFORE UPDATE ON coach_meeting_artifacts
            BEGIN SELECT RAISE(ABORT,'Synthetic database failure'); END''')
        with self.assertRaises(CommandError):
            self.command(apply=True)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(len(self.objects), 1)
        self.db.execute('DROP TRIGGER Coach.reject_backup')
        self.assertEqual(self.command(apply=True)['verifiedBackups'], 1)
        self.assertEqual(len(self.objects), 1)

    def test_limits_are_bounded_before_any_selection(self):
        for limit in (0, -1, 501):
            with self.subTest(limit=limit), self.assertRaises(CommandError):
                self.command(limit=limit)

    def test_concurrently_completed_row_is_reported_busy_without_upload(self):
        self.seed(blob='already-saved')
        result = backup.backup_one('backup-test', ('event', 'part', 'coach@example.invalid', 50), 'transcripts')
        self.assertEqual(result, 'busy')
        self.upload.assert_not_called()
