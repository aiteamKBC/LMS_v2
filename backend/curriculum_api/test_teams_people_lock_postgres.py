"""Two real PostgreSQL connections; no Microsoft calls or application rows.

Run only through a verified disposable PostgreSQL runner. Local PostgreSQL
proves lock lifetime and contention, not live Neon/PgBouncer acceptance.
"""
from contextlib import nullcontext
from unittest import skipUnless
from unittest.mock import Mock, patch
import uuid

from django.db import DatabaseError, connection, transaction
from django.test import SimpleTestCase

from . import teams_people_refresh as refresh


@skipUnless(connection.vendor == 'postgresql', 'Requires verified disposable PostgreSQL.')
class PeopleLockPostgresTests(SimpleTestCase):
    databases = {'default'}

    def setUp(self):
        self.live_id = 'LIVE-TEST-' + uuid.uuid4().hex
        self.key = 'curriculum:teams-people:' + self.live_id
        self.peer = connection.copy(alias='people_lock_peer')
        self.addCleanup(self.peer.close)
        self.peer.ensure_connection()
        self.peer.set_autocommit(True)
        with connection.cursor() as cursor:
            cursor.execute('SELECT pg_backend_pid()')
            self.pid = cursor.fetchone()[0]
        with self.peer.cursor() as cursor:
            cursor.execute('SELECT pg_backend_pid()')
            self.assertNotEqual(cursor.fetchone()[0], self.pid)

    def peer_try(self, key=None):
        with self.peer.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s, 0))', [key or self.key])
            return cursor.fetchone()[0]

    def assert_no_lock_left(self):
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=%s", [self.pid])
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_success_holds_one_transaction_and_releases_without_unlock(self):
        with refresh.people_sync_lock(self.live_id):
            self.assertTrue(connection.in_atomic_block)
            self.assertFalse(self.peer_try())
            self.assertTrue(self.peer_try(self.key + '-another-series'))
            with connection.cursor() as cursor:
                cursor.execute('SELECT pg_backend_pid()')
                self.assertEqual(cursor.fetchone()[0], self.pid)
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()

    def test_failed_read_rolls_back_and_another_connection_can_retry(self):
        with self.assertRaises(RuntimeError):
            with refresh.people_sync_lock(self.live_id):
                self.assertFalse(self.peer_try())
                raise RuntimeError('Synthetic read failure')
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()
        with refresh.people_sync_lock(self.live_id):
            self.assertFalse(self.peer_try())

    def test_contention_is_nonblocking_scoped_and_retryable(self):
        self.peer.set_autocommit(False)
        try:
            self.assertTrue(self.peer_try())
            with self.assertRaises(refresh.CalendarStateError) as failure:
                with refresh.people_sync_lock(self.live_id):
                    self.fail('A concurrent owner must exclude this reader')
            self.assertEqual(refresh._failure_details(failure.exception), ('lock_busy', 'lock'))
            with refresh.people_sync_lock(self.live_id + '-another-series'):
                pass
        finally:
            self.peer.rollback()
            self.peer.set_autocommit(True)
        with refresh.people_sync_lock(self.live_id):
            self.assertFalse(self.peer_try())
        self.assert_no_lock_left()

    def test_database_error_releases_lock_even_when_the_transaction_is_aborted(self):
        with self.assertRaises(DatabaseError):
            with refresh.people_sync_lock(self.live_id):
                with connection.cursor() as cursor:
                    cursor.execute('SELECT %s::integer', ['not-an-integer'])
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()

    def test_nested_caller_holds_lock_until_its_outer_transaction_ends(self):
        with transaction.atomic():
            with refresh.people_sync_lock(self.live_id):
                self.assertFalse(self.peer_try())
            self.assertFalse(self.peer_try())
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()

    def test_repeated_success_and_failure_never_accumulate_locks(self):
        for attempt in range(12):
            with self.subTest(attempt=attempt):
                try:
                    with refresh.people_sync_lock(self.live_id):
                        self.assertFalse(self.peer_try())
                        if attempt % 2:
                            raise RuntimeError('Synthetic retry')
                except RuntimeError:
                    pass
                self.assertTrue(self.peer_try())
                self.assert_no_lock_left()

    def test_legacy_session_lock_still_blocks_until_its_connection_closes(self):
        # Deliberately reproduce an OLD lock on a disposable connection. The
        # fix preserves the key; deployment alone cannot clean leaked owners.
        with self.peer.cursor() as cursor:
            cursor.execute('SELECT pg_try_advisory_lock(hashtextextended(%s, 0))', [self.key])
            self.assertTrue(cursor.fetchone()[0])
        with self.assertRaises(refresh.CalendarStateError):
            with refresh.people_sync_lock(self.live_id):
                self.fail('The legacy owner still holds the same key')
        self.peer.close()
        with refresh.people_sync_lock(self.live_id):
            pass
        self.assert_no_lock_left()

    def test_synced_cache_is_published_only_after_the_outer_commit(self):
        cache = Mock()
        cache.get.return_value = None
        with patch.object(refresh, 'cache', cache), \
                patch.object(refresh, '_refresh_people', return_value={'changed': False}):
            with transaction.atomic():
                self.assertEqual(refresh.refresh_people(self.live_id), {'changed': False})
                cache.set.assert_not_called()
            self.assertEqual(cache.set.call_args.args[1]['status'], 'synced')
        self.assert_no_lock_left()

    def test_rolled_back_import_publishes_neither_invalidation_nor_synced_cache(self):
        series = {'id': self.live_id, 'status': 'active', 'organizer_email': 'synthetic@example.invalid',
                  'module_catalogue_id': 'MODULE', 'attendees': [], 'presenters': [], 'co_organizers': []}
        values = {'attendees': ['learner@example.invalid'], 'presenters': [], 'coOrganizers': []}
        cache = Mock()
        cache.get.return_value = None
        with patch.object(refresh, 'cache', cache), \
                patch.object(refresh, 'load_calendar_state', return_value=(series, [], {})), \
                patch.object(refresh, 'calendar_reader', return_value=nullcontext(Mock())), \
                patch.object(refresh, 'read_people', return_value=values), \
                patch('curriculum_api.views.update_authoring_rows') as update, \
                patch('curriculum_api.views.invalidate_curriculum_cache') as invalidate:
            with self.assertRaises(RuntimeError):
                with transaction.atomic():
                    self.assertTrue(refresh.refresh_people(self.live_id)['changed'])
                    update.assert_called_once()
                    invalidate.assert_not_called()
                    cache.set.assert_not_called()
                    raise RuntimeError('Synthetic outer rollback')
            invalidate.assert_not_called()
            cache.set.assert_not_called()
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()

    def test_post_commit_publication_failure_retains_retry_receipt_and_releases_lock(self):
        cache = Mock()
        cache.get.return_value = None
        def read(_live_id):
            refresh._after_commit('invalidate_cache', Mock(side_effect=RuntimeError('Synthetic cache failure')))
            return {'changed': True}
        with patch.object(refresh, 'cache', cache), patch.object(refresh, '_refresh_people', side_effect=read):
            with self.assertRaises(RuntimeError) as failure:
                refresh.refresh_people(self.live_id)
            self.assertEqual(refresh._failure_details(failure.exception), ('unexpected_error', 'invalidate_cache'))
            cache.set.assert_called_once()
            self.assertEqual(cache.set.call_args.args[1]['status'], 'failed')
            self.assertIn('attemptEpoch', cache.set.call_args.args[1])
        self.assertTrue(self.peer_try())
        self.assert_no_lock_left()
