"""A lagging progress id sequence must self-heal instead of failing the save.

Run: python manage.py test learner_api.test_progress_id_self_heal_no_db --settings=config.settings_sqlite_test
"""
from contextlib import nullcontext
from unittest.mock import MagicMock, patch

from django.db import IntegrityError
from django.test import SimpleTestCase

from learner_api import active_users

PKEY_COLLISION = IntegrityError(
    'duplicate key value violates unique constraint "learner_progress_entries_pkey" '
    'DETAIL: Key (id)=(880929) already exists.'
)


class ProgressIdSelfHealTests(SimpleTestCase):
    def setUp(self):
        atomic = patch.object(active_users.transaction, "atomic", return_value=nullcontext())
        atomic.start()
        self.addCleanup(atomic.stop)
        create = patch.object(active_users.LearnerProgressEntry.objects, "create")
        self.create = create.start()
        self.addCleanup(create.stop)
        resync = patch.object(active_users, "_resync_progress_entry_id_sequence")
        self.resync = resync.start()
        self.addCleanup(resync.stop)

    def test_saves_normally_without_touching_the_sequence(self):
        row = object()
        self.create.return_value = row

        self.assertIs(active_users._create_progress_entry(kind="video"), row)

        self.create.assert_called_once_with(kind="video")
        self.resync.assert_not_called()

    def test_primary_key_collision_resyncs_and_retries_once_with_same_fields(self):
        row = object()
        self.create.side_effect = [PKEY_COLLISION, row]

        self.assertIs(active_users._create_progress_entry(kind="video", entry_order=7), row)

        self.resync.assert_called_once_with()
        self.assertEqual(self.create.call_count, 2)
        for call in self.create.call_args_list:
            self.assertEqual(call.kwargs, {"kind": "video", "entry_order": 7})

    def test_second_collision_is_raised_not_retried_forever(self):
        self.create.side_effect = [PKEY_COLLISION, PKEY_COLLISION]

        with self.assertRaises(IntegrityError):
            active_users._create_progress_entry(kind="video")

        self.assertEqual(self.create.call_count, 2)
        self.resync.assert_called_once_with()

    def test_other_integrity_errors_are_raised_unchanged(self):
        reused_session = IntegrityError(
            'duplicate key value violates unique constraint "learner_progress_tracking_session_uq"'
        )
        self.create.side_effect = reused_session

        with self.assertRaises(IntegrityError) as raised:
            active_users._create_progress_entry(kind="video")

        self.assertIs(raised.exception, reused_session)
        self.create.assert_called_once()
        self.resync.assert_not_called()


class ProgressIdResyncSqlTests(SimpleTestCase):
    def test_resync_never_moves_the_sequence_backwards(self):
        cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.dict(active_users.connections, {"enrolment": connection}, clear=False):
            active_users._resync_progress_entry_id_sequence()

        sql = cursor.execute.call_args.args[0]
        self.assertIn("setval(seq::regclass, GREATEST(", sql)
        self.assertIn('MAX(id), 0) FROM "Learner".learner_progress_entries', sql)
        self.assertIn("pg_sequence_last_value(seq::regclass)", sql)
        self.assertIn("pg_get_serial_sequence('\"Learner\".learner_progress_entries', 'id')", sql)
