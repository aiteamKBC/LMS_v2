"""Strict cache access, version keys and the Phase 2 invalidation guards. No database.

The Redis cases point a real ResilientRedisCache at a closed local port, so
every server call fails to connect exactly as it does when Valkey is down.
"""
import re
from pathlib import Path
from unittest.mock import patch

from django.core.cache import caches
from django.test import SimpleTestCase, override_settings

from config import cache_versions
from config.cache_backends import ResilientRedisCache, SharedCacheUnavailable

DOWN = {'BACKEND': 'config.cache_backends.ResilientRedisCache', 'LOCATION': 'redis://127.0.0.1:1/0',
        'OPTIONS': {'socket_connect_timeout': 0.2, 'socket_timeout': 0.2}}
LOCAL = {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'cache-versions-tests'}


class ResilientFallbackUnchangedTests(SimpleTestCase):
    def cache(self):
        return ResilientRedisCache(DOWN['LOCATION'], {'OPTIONS': DOWN['OPTIONS']})

    def test_existing_methods_still_fall_back_to_this_process(self):
        cache = self.cache()
        cache.set('k', 'v')
        self.assertEqual(cache.get('k'), 'v')
        self.assertGreater(cache._degraded_until, 0)
        self.assertEqual(cache.get_many(['k']), {'k': 'v'})

    def test_strict_never_falls_back_and_leaves_the_degraded_state_alone(self):
        cache = self.cache()
        with self.assertRaises(SharedCacheUnavailable):
            cache.strict('get', 'k')
        self.assertEqual(cache._degraded_until, 0.0)
        cache.set('k', 'v')  # the ordinary path behaves as before
        self.assertEqual(cache.get('k'), 'v')
        with self.assertRaises(SharedCacheUnavailable):
            cache.strict('get', 'k')  # degraded: refused without a connect attempt

    def test_strict_cools_down_after_a_failure(self):
        cache = self.cache()
        with self.assertRaises(SharedCacheUnavailable):
            cache.strict('get', 'k')
        with patch('django.core.cache.backends.redis.RedisCache.get', side_effect=AssertionError('no retry')):
            with self.assertRaises(SharedCacheUnavailable):
                cache.strict('get', 'k')


@override_settings(CACHES={'default': LOCAL}, SHARED_VERSION_CACHE_ALLOW_LOCAL=True)
class VersionTests(SimpleTestCase):
    def setUp(self):
        caches['default'].clear()
        cache_versions.reset_for_tests()

    def test_versions_are_unique_and_never_incremented(self):
        values = {cache_versions.new_version() for _ in range(2000)}
        self.assertEqual(len(values), 2000)

    def test_missing_keys_are_created_once_and_read_back(self):
        first = cache_versions.current('ns', 1)
        self.assertEqual(cache_versions.current('ns', 1), first)
        caches['default'].delete(cache_versions.version_key('ns', 1))
        second = cache_versions.current('ns', 1)
        self.assertNotEqual(second[0], first[0])
        self.assertEqual(second[1], first[1])

    def test_read_reports_missing_keys_as_absent(self):
        self.assertEqual(cache_versions.read('ns', [5]), {})

    def test_bump_after_commit_sets_a_new_value(self):
        before = cache_versions.current('ns', 2)[0]
        with patch.object(cache_versions.transaction, 'on_commit', side_effect=lambda fn, using=None: fn()):
            cache_versions.bump('ns', [2])
        self.assertNotEqual(cache_versions.current('ns', 2)[0], before)

    def test_failed_bumps_are_retried_and_block_use_until_then(self):
        before = cache_versions.current('ns', 3)[0]
        with patch.object(cache_versions, 'strict', side_effect=cache_versions.Unavailable('down')):
            cache_versions._set_versions('ns', ['3'])
        self.assertEqual(cache_versions.pending_count(), 1)
        cache_versions.flush_pending()
        self.assertEqual(cache_versions.pending_count(), 0)
        self.assertNotEqual(cache_versions.current('ns', 3)[0], before)

    def test_too_many_failures_retire_the_namespace(self):
        generation = cache_versions.current('ns', 4)[1]
        cache_versions._remember_failure([('ns', i) for i in range(cache_versions.MAX_PENDING + 5)])
        self.assertEqual(cache_versions.pending_count(), 1)
        cache_versions.flush_pending()
        self.assertNotEqual(cache_versions.current('ns', 4)[1], generation)

    @override_settings(SHARED_VERSION_CACHE_ALLOW_LOCAL=False)
    def test_a_process_local_cache_is_never_trusted(self):
        with self.assertRaises(cache_versions.Unavailable):
            cache_versions.strict('get', 'k')


class Phase2WriteGuardTests(SimpleTestCase):
    """Raw SQL writes bypass the version bumps, so none may touch these columns."""

    LOGIN = re.compile(r'(insert\s+into|update|delete\s+from)\s+"?login"?\."?(Login_accounts|Login_sessions)', re.I)
    MIRROR = re.compile(r'(insert\s+into|update|delete\s+from)\s+"?Learner"?\."?learner_training_plan_modules', re.I)
    PROGRESS = re.compile(r'(insert\s+into|update|delete\s+from)\s+"?Learner"?\."?(learner_progress_entries|learner_progress_ksbs)\b', re.I)
    PLAN = re.compile(r'update\s+"?enrolment"?\."?Created_users"?\s+set[^;]{0,400}?"(Training_plan|Learning_plan)"', re.I | re.S)

    def test_no_raw_sql_writes_bypass_the_bumps(self):
        root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in root.rglob('*.py'):
            relative = path.relative_to(root).as_posix()
            if (relative.startswith(('venv/', 'scripts/')) or '/migrations/' in relative or path.name.startswith(('test', 'run_'))
                    or '/tests' in relative or path.name in ('tests.py',) or 'postgres' in path.name
                    or relative.startswith(('mobile_integration_tests/', 'mobile_comms/check_'))):
                continue
            text = path.read_text(encoding='utf-8', errors='ignore')
            if (self.LOGIN.search(text) or self.MIRROR.search(text) or self.PLAN.search(text)) \
                    and 'cache_versions.bump' not in text and 'bump_learners' not in text and 'bump_account' not in text:
                offenders.append(relative)
            # Schema commands (apply_*) alter or backfill columns no cached statement returns.
            if self.PROGRESS.search(text) and 'bump_learners' not in text and 'bump_generation' not in text \
                    and not path.name.startswith('apply_'):
                offenders.append(relative)
        self.assertEqual(offenders, [])
