from contextlib import nullcontext
from io import StringIO
from unittest import TestCase
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.core.management.base import CommandError

from curriculum_api.management.commands import repair_session_transcripts as repair


class RecoveryCommandTests(TestCase):
    def setUp(self):
        self.pending = [{'id': 'T', 'series_id': 'S', 'occurrence_id': 'O'}]
        self.read = self.enterContext(patch.object(repair, 'read', return_value=self.pending))
        self.archive = self.enterContext(patch.object(repair, 'archive_series', return_value=[]))
        self.storage = self.enterContext(patch.object(repair, 'storage_client'))
        self.connection = Mock(settings_dict={'HOST': 'ep-synthetic-pooler.example.test'})
        self.cursor = Mock()
        self.connection.cursor.return_value = nullcontext(self.cursor)
        self.enterContext(patch.object(repair, 'connections', {'default': self.connection}))
        self.enterContext(patch.object(repair.transaction, 'atomic', return_value=nullcontext()))

    def run_command(self, *args):
        output = StringIO()
        call_command('repair_session_transcripts', *args, stdout=output)
        return output.getvalue()

    def apply(self):
        return self.run_command('--apply', '--expected-database', 'isolated', '--expected-endpoint', 'ep-synthetic')

    def test_inspect_never_writes_or_opens_storage(self):
        output = self.run_command('--live-session-id', 'S')
        self.assertIn('"mode": "inspect"', output)
        self.archive.assert_not_called()
        self.storage.assert_not_called()
        self.connection.cursor.assert_not_called()

    def test_wrong_environment_refuses_all_repairs(self):
        self.read.side_effect = [self.pending, [{'name': 'wrong-database'}]]
        with self.assertRaisesRegex(CommandError, 'does not match'):
            self.apply()
        self.archive.assert_not_called()
        self.storage.assert_not_called()
        self.connection.cursor.assert_not_called()

    def test_active_worker_keeps_ownership_of_its_series(self):
        self.read.side_effect = [self.pending, [{'name': 'isolated'}]]
        self.cursor.fetchone.return_value = ('running',)
        with self.assertRaisesRegex(CommandError, 'incomplete'):
            self.apply()
        self.archive.assert_not_called()
        self.storage.assert_not_called()

    def test_only_selected_transcripts_are_archived_and_physical_copy_is_verified(self):
        self.read.side_effect = [self.pending, [{'name': 'isolated'}],
            [{'id': 'T', 'container': 'private', 'blob_name': 'test.vtt', 'status': 'ready',
              'transcript_text': 'Synthetic recovered text'}]]
        self.cursor.fetchone.return_value = ('failed',)
        self.storage.return_value.get_blob_client.return_value.get_blob_properties.return_value.size = 120
        output = self.apply()
        self.archive.assert_called_once_with('S', artifact_ids=['T'])
        self.assertIn('"verifiedReady": 1', output)
        self.storage.return_value.get_blob_client.assert_called_once_with('private', 'test.vtt')

    def test_database_ready_without_a_storage_object_does_not_count_as_recovered(self):
        self.read.side_effect = [self.pending, [{'name': 'isolated'}],
            [{'id': 'T', 'container': 'private', 'blob_name': 'test.vtt', 'status': 'ready',
              'transcript_text': 'Synthetic recovered text'}]]
        self.cursor.fetchone.return_value = ('failed',)
        self.storage.return_value.get_blob_client.return_value.get_blob_properties.side_effect = RuntimeError('unavailable')
        with self.assertRaisesRegex(CommandError, 'incomplete'):
            self.apply()

    def test_invalid_batch_is_rejected_before_reading_database(self):
        with self.assertRaises(CommandError):
            self.run_command('--limit', '501')
        self.read.assert_not_called()
