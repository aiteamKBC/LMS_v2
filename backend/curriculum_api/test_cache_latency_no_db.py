"""Cache concurrency regressions; all database and shared-cache I/O is mocked."""

import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from . import views


class EpochReadTests(SimpleTestCase):
    def setUp(self):
        for patcher in (
            patch.dict(views._SHARED_EPOCH_STATE, {'value': None, 'checked_at': 0.0}, clear=True),
            patch.object(views, 'ensure_curriculum_epoch_table', return_value=True),
            patch.object(views, 'connection', in_atomic_block=False),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        views.connection.get_autocommit.return_value = True

    def test_standalone_read_avoids_transaction_but_nested_read_keeps_savepoint(self):
        with patch.object(views, 'read_shared_curriculum_epoch_row', return_value=7) as read, \
             patch.object(views.transaction, 'atomic') as atomic:
            self.assertEqual(views.shared_curriculum_epoch(), 7)
            self.assertEqual(views.shared_curriculum_epoch(), 7)
            read.assert_called_once()
            atomic.assert_not_called()
            views._SHARED_EPOCH_STATE['checked_at'] = 0.0
            views.connection.in_atomic_block = True
            self.assertEqual(views.shared_curriculum_epoch(), 7)
            atomic.assert_called_once()
            atomic.return_value.__enter__.assert_called_once()

    def test_manually_opened_transaction_also_keeps_savepoint(self):
        views.connection.get_autocommit.return_value = False
        with patch.object(views, 'read_shared_curriculum_epoch_row', return_value=7), \
             patch.object(views.transaction, 'atomic') as atomic:
            self.assertEqual(views.shared_curriculum_epoch(), 7)
        atomic.return_value.__enter__.assert_called_once()

    def test_concurrent_expired_reads_share_one_database_query(self):
        entered = threading.Event()
        release = threading.Event()
        second_waiting = threading.Event()
        lock = threading.Lock()

        class ObservedRefreshLock:
            def __enter__(self):
                if entered.is_set():
                    second_waiting.set()
                lock.acquire()

            def __exit__(self, *args):
                lock.release()

        def read_epoch():
            entered.set()
            if not release.wait(3):
                raise AssertionError('Test did not release epoch read')
            return 7

        with patch.object(views, '_SHARED_EPOCH_REFRESH_LOCK', ObservedRefreshLock()), \
             patch.object(views, 'read_shared_curriculum_epoch_row', side_effect=read_epoch) as read, \
             ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(views.shared_curriculum_epoch)
            try:
                self.assertTrue(entered.wait(3))
                second = pool.submit(views.shared_curriculum_epoch)
                self.assertTrue(second_waiting.wait(3))
                self.assertEqual(read.call_count, 1)
            finally:
                release.set()
            self.assertEqual(first.result(timeout=3), 7)
            self.assertEqual(second.result(timeout=3), 7)
            read.assert_called_once()

    def test_inflight_read_cannot_replace_a_newer_local_write_epoch(self):
        def read_epoch():
            views.remember_shared_curriculum_epoch(8)
            return 7

        with patch.object(views, 'read_shared_curriculum_epoch_row', side_effect=read_epoch):
            self.assertEqual(views.shared_curriculum_epoch(), 8)
        self.assertEqual(views._SHARED_EPOCH_STATE['value'], 8)

    def test_failed_read_preserves_last_epoch_without_caching_the_failure(self):
        views._SHARED_EPOCH_STATE['value'] = 7
        with patch.object(views, 'read_shared_curriculum_epoch_row', side_effect=RuntimeError('offline')), \
             patch.object(views.logger, 'warning'):
            self.assertEqual(views.shared_curriculum_epoch(), 7)
        self.assertEqual(views._SHARED_EPOCH_STATE['checked_at'], 0.0)
        with patch.object(views, 'read_shared_curriculum_epoch_row', return_value=8):
            self.assertEqual(views.shared_curriculum_epoch(), 8)


class CachePublicationTests(SimpleTestCase):
    def setUp(self):
        self.epoch = Mock(return_value=7)
        self.cache = Mock()
        self.cache.get.return_value = None
        for patcher in (
            patch.dict(views._CURRICULUM_CACHE, {}, clear=True),
            patch.object(views, '_CURRICULUM_CACHE_EPOCH', 0),
            patch.object(views, 'shared_curriculum_epoch', self.epoch),
            patch.object(views, 'cache', self.cache),
            patch.object(views.shared_build, 'try_acquire', return_value=(True, None)),
            patch.object(views.shared_build, 'release'),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_slow_shared_write_does_not_block_cached_reads_or_invalidation(self):
        views.cached_curriculum_value('ready', lambda: 'ready value', shared=False)
        entered = threading.Event()
        release = threading.Event()

        def slow_set(*args, **kwargs):
            entered.set()
            if not release.wait(3):
                raise AssertionError('Test did not release shared-cache write')

        def invalidate():
            # Model the local invalidation and shared epoch bump, without its
            # production outbox/warm-up side effects.
            with views._CURRICULUM_CACHE_LOCK:
                views._CURRICULUM_CACHE.clear()
                views._CURRICULUM_CACHE_EPOCH += 1
            self.epoch.return_value = 8

        self.cache.set.side_effect = slow_set
        with ThreadPoolExecutor(max_workers=2) as pool:
            writer = pool.submit(views.cached_curriculum_value, 'building', lambda: 'old')
            try:
                self.assertTrue(entered.wait(3))
                factory = Mock(side_effect=AssertionError('Warm read rebuilt'))
                reader = pool.submit(views.cached_curriculum_value, 'ready', factory)
                self.assertEqual(reader.result(timeout=1), 'ready value')
                pool.submit(invalidate).result(timeout=1)
            finally:
                release.set()
            self.assertEqual(writer.result(timeout=3), 'old')
        self.assertEqual(views._CURRICULUM_CACHE, {})
        self.cache.set.side_effect = None
        self.assertEqual(views.cached_curriculum_value('building', lambda: 'new'), 'new')
        self.assertEqual(self.cache.set.call_args.args[0], views.shared_curriculum_cache_key('building', 8))

    def test_epoch_recheck_does_not_hold_global_cache_lock(self):
        def check_epoch():
            acquired = views._CURRICULUM_CACHE_LOCK.acquire(blocking=False)
            self.assertTrue(acquired, 'Epoch I/O held the global cache lock')
            if acquired:
                views._CURRICULUM_CACHE_LOCK.release()
            return 7

        self.epoch.side_effect = check_epoch
        self.assertEqual(views.cached_curriculum_value('building', lambda: 'value'), 'value')

    def test_local_or_remote_invalidation_during_build_prevents_publication(self):
        for remote in (False, True):
            with self.subTest(remote=remote):
                self.cache.set.reset_mock()

                def build():
                    if remote:
                        self.epoch.return_value += 1
                    else:
                        views._CURRICULUM_CACHE_EPOCH += 1
                    return 'old'

                self.assertEqual(views.cached_curriculum_value('building', build), 'old')
                self.assertNotIn('building', views._CURRICULUM_CACHE)
                self.cache.set.assert_not_called()

    def test_shared_cache_failure_keeps_local_result_available(self):
        self.cache.set.side_effect = RuntimeError('offline')
        with patch.object(views.logger, 'warning'):
            self.assertEqual(views.cached_curriculum_value('building', lambda: 'value'), 'value')
        factory = Mock(side_effect=AssertionError('Local hit rebuilt'))
        self.assertEqual(views.cached_curriculum_value('building', factory), 'value')
