"""The shared curriculum content cache, the shared rows cache and the warm allow-list.

No database: cursors are fakes that record what they were asked, and the cache
is the test LocMemCache (or a stand-in that fails, for the Valkey-down cases).
"""
import pickle
import threading
import time
import zlib
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings

from curriculum_api import apps as curriculum_apps
from curriculum_api import content_cache, views

SQL = 'SELECT id, week_id, module_catalogue_id FROM curriculum.components WHERE module_catalogue_id = ANY(%s)'
ROWS = {
    'MOD-A': [('c1', 'w1', 'MOD-A'), ('c2', 'w2', 'MOD-A')],
    'MOD-B': [('c3', 'w9', 'MOD-B')],
    'MOD-C': [],
}


class FakeCursor:
    """Answers the component statement for whichever modules it is asked for."""

    def __init__(self, rows=ROWS, delay=0.0, collation=('C.UTF-8', 'c'), columns=()):
        self.rows, self.delay, self.collation, self.columns = rows, delay, collation, columns
        self.executed = []
        self._result = []

        class Db:
            vendor = 'postgresql'
            alias = 'default'
        self.db = Db()

    def execute(self, sql, params=None):
        self.executed.append((sql, params))
        if 'pg_database' in sql:
            self._result = [self.collation]
        elif 'information_schema.columns' in sql:
            self._result = [(name,) for name in self.columns]
        elif 'expected_otjh' in sql:
            self._result = [('c1', 1.5), ('c2', None)]
        else:
            if self.delay:
                time.sleep(self.delay)
            self._result = [row for mid in params[0] for row in self.rows.get(mid, [])]

    def fetchall(self):
        return list(self._result)

    def fetchone(self):
        return self._result[0] if self._result else None

    def data_reads(self):
        return [params for sql, params in self.executed if sql == SQL]


# Never a real cache: setUp clears it, and local settings may name a Redis.
LOCAL_CACHE = override_settings(CACHES={'default': {
    'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'content-cache-tests'}})


class BrokenCache:
    def __getattr__(self, name):
        def fail(*args, **kwargs):
            raise ConnectionError('valkey down')
        return fail


@LOCAL_CACHE
class CacheTestCase(SimpleTestCase):
    def setUp(self):
        cache.clear()
        content_cache.reset_for_tests()
        self.addCleanup(content_cache.reset_for_tests)
        self.epoch = 7
        patcher = patch.object(content_cache, '_epoch', side_effect=lambda: self.epoch)
        patcher.start()
        self.addCleanup(patcher.stop)
        # The atomic() around the collation read needs a real alias.
        atomic = patch('django.db.transaction.atomic')
        atomic.start()
        self.addCleanup(atomic.stop)


class ModuleRowsTests(CacheTestCase):
    def test_miss_reads_once_then_hits_without_sql(self):
        cursor = FakeCursor()
        first = content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        self.assertEqual(first, {'MOD-A': ROWS['MOD-A'], 'MOD-B': ROWS['MOD-B']})
        self.assertEqual(cursor.data_reads(), [[['MOD-A', 'MOD-B']]])

        again = FakeCursor()
        self.assertEqual(content_cache.module_rows(again, 'comp', SQL, ['MOD-B', 'MOD-A'], 2), first)
        self.assertEqual(again.data_reads(), [])

    def test_only_missing_modules_are_read_and_empty_modules_are_cached(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        cursor = FakeCursor()
        result = content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-C'], 2)
        self.assertEqual(result, {'MOD-A': ROWS['MOD-A'], 'MOD-C': []})
        self.assertEqual(cursor.data_reads(), [[['MOD-C']]])
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL, ['MOD-C'], 2)
        self.assertEqual(cursor.data_reads(), [])

    def test_a_curriculum_write_retires_every_entry(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        self.epoch += 1  # what invalidate_curriculum_cache() does to the shared epoch
        changed = {**ROWS, 'MOD-A': [('c1', 'w1', 'MOD-A')]}
        cursor = FakeCursor(rows=changed)
        self.assertEqual(content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A'], 2), {'MOD-A': changed['MOD-A']})
        self.assertEqual(cursor.data_reads(), [[['MOD-A']]])

    def test_invalidate_curriculum_cache_moves_the_epoch_the_keys_use(self):
        """The real epoch, not the patched one: a write must change the key."""
        content_cache._epoch.side_effect = None
        content_cache._epoch.side_effect = lambda: views.shared_curriculum_epoch()
        with patch.object(views, 'ensure_curriculum_epoch_table', return_value=False), \
                patch.object(views, 'schedule_curriculum_warm'), \
                patch('curriculum_api.read_model.enqueue_all_curriculum_home_refreshes'), \
                patch('config.management_safety.reconciliation_command', return_value=False):
            before = views.shared_curriculum_epoch()
            views.invalidate_curriculum_cache()
            views._SHARED_EPOCH_STATE['checked_at'] = 0.0
            after = views.shared_curriculum_epoch()
        self.assertNotEqual(before, after)

    def test_a_different_statement_is_a_different_key(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL + ' ', ['MOD-A'], 2)
        self.assertEqual(len([s for s, _ in cursor.executed if 'ANY' in s and 'information_schema' not in s]), 1)

    def test_keys_hold_only_module_ids_and_statement_digests(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A', 'odd id/with space'], 2)
        from django.core.cache import caches
        keys = [key for key in caches['default']._cache if ':cmc:v1:' in key]
        self.assertEqual(len(keys), 2)
        for key in keys:
            tail = key.split(':cmc:v1:', 1)[1]
            epoch, part, statement, module = tail.split(':')
            self.assertEqual((epoch, part, len(statement)), ('7', 'comp', 16))
            self.assertIn(module, {'MOD-A', 'h' + content_cache._digest('odd id/with space')})

    def test_values_are_compressed_pickles(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        from django.core.cache import caches
        key = next(key for key in caches['default']._cache if ':cmc:v1:' in key)
        stored = cache.get(key.split(':', 2)[2])
        self.assertEqual(pickle.loads(zlib.decompress(stored)), ROWS['MOD-A'])

    def test_valkey_down_reads_the_database_every_time(self):
        with patch.object(content_cache, 'cache', BrokenCache()), \
                patch.object(content_cache.shared_build, 'cache_is_shared', return_value=False):
            for _ in range(2):
                cursor = FakeCursor()
                self.assertEqual(content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A'], 2), {'MOD-A': ROWS['MOD-A']})
                self.assertEqual(cursor.data_reads(), [[['MOD-A']]])

    def test_concurrent_misses_read_once(self):
        results, cursors = [], [FakeCursor(delay=0.2) for _ in range(6)]

        def read(cursor):
            results.append(content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2))
        content_cache.collation_ok(FakeCursor())
        threads = [threading.Thread(target=read, args=(cursor,)) for cursor in cursors]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sum(len(cursor.data_reads()) for cursor in cursors), 1)
        self.assertEqual(len(results), 6)
        self.assertTrue(all(result == results[0] for result in results))

    def test_off_switch_and_reconciliation_commands_read_live(self):
        with patch.dict('os.environ', {'CURRICULUM_CONTENT_CACHE': 'false'}):
            self.assertIsNone(content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2))
        with patch('config.management_safety.reconciliation_command', return_value=True):
            self.assertIsNone(content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2))


class CollationTests(CacheTestCase):
    def test_code_point_collations_pass(self):
        for collation in (('C.UTF-8', 'c'), ('C', 'c'), ('C.UTF-8', 'b'), ('POSIX', 'c')):
            content_cache.reset_for_tests()
            self.assertTrue(content_cache.collation_ok(FakeCursor(collation=collation)), collation)

    def test_linguistic_collations_turn_the_cache_off(self):
        for cursor in (FakeCursor(collation=('en_US.UTF-8', 'c')), FakeCursor(collation=('und-x-icu', 'i')),
                       FakeCursor(columns=('en_GB',))):
            content_cache.reset_for_tests()
            self.assertFalse(content_cache.collation_ok(cursor))
            self.assertIsNone(content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A'], 2))

    def test_other_databases_read_live(self):
        cursor = FakeCursor()
        cursor.db.vendor = 'sqlite'
        self.assertFalse(content_cache.collation_ok(cursor))
        self.assertEqual(cursor.executed, [])

    def test_a_failed_check_is_not_remembered(self):
        broken = FakeCursor()
        broken.execute = lambda *a, **k: (_ for _ in ()).throw(RuntimeError('timeout'))
        self.assertFalse(content_cache.collation_ok(broken))
        self.assertTrue(content_cache.collation_ok(FakeCursor()))


class ExpectedOtjhTests(CacheTestCase):
    def test_built_once_per_generation_then_served_from_the_process(self):
        cursor = FakeCursor()
        self.assertEqual(content_cache.expected_otjh_map(cursor), {'c1': 1.5, 'c2': None})
        with patch.object(content_cache, '_get_many', side_effect=AssertionError('process copy expected')):
            self.assertEqual(content_cache.expected_otjh_map(FakeCursor()), {'c1': 1.5, 'c2': None})
        self.epoch += 1
        cursor = FakeCursor()
        content_cache.expected_otjh_map(cursor)
        self.assertEqual(len([1 for sql, _ in cursor.executed if 'expected_otjh' in sql]), 1)

    def test_other_processes_read_the_shared_copy(self):
        content_cache.expected_otjh_map(FakeCursor())
        content_cache._otjh_local.update(epoch=None)  # a different process
        cursor = FakeCursor()
        self.assertEqual(content_cache.expected_otjh_map(cursor), {'c1': 1.5, 'c2': None})
        self.assertEqual(cursor.executed, [])

    def test_learner_and_coach_lookups_match_the_by_id_reads(self):
        from coach_api import views as coach
        from learner_api import learner_detail
        known = {'c1': 2, 'c2': None, 'c3': 0}
        with patch.object(content_cache, 'expected_otjh_map', return_value=known), \
                patch.object(coach, '_same_database', return_value=True), \
                patch.object(coach, 'connections') as coach_db, \
                patch.object(learner_detail, 'connections') as learner_db:
            learner = learner_detail._otjh_by_component_id(
                [{'componentId': 'c1'}, {'componentId': 'c2'}, {'componentId': 'missing'}])
            staff = coach.curriculum_expected_otjh_by_component_id(['c1', ' c2 ', 'c3', 'missing', ''])
        # By-id semantics: unknown ids absent; the learner keeps None, the coach drops it.
        self.assertEqual(learner, {'c1': 2.0, 'c2': None})
        self.assertEqual(staff, {'c1': 2.0, 'c3': 0.0})
        learner_db.__getitem__.return_value.cursor.return_value.__enter__.return_value.execute.assert_not_called()
        self.assertFalse(any('ANY' in str(c) for c in coach_db.mock_calls))

    def test_coach_lookup_reads_by_id_when_aliases_are_different_databases(self):
        from coach_api import views as coach
        with patch.object(coach, '_same_database', return_value=False), \
                patch.object(content_cache, 'expected_otjh_map', side_effect=AssertionError('not shared')):
            self.assertIsNone(coach._shared_expected_otjh())


@LOCAL_CACHE
class SharedRowsCacheTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        views._CURRICULUM_CACHE.clear()
        self.addCleanup(views._CURRICULUM_CACHE.clear)
        epoch = patch.object(views, 'shared_curriculum_epoch', return_value=11)
        epoch.start()
        self.addCleanup(epoch.stop)

    def test_rows_are_shared_compressed_and_survive_a_new_process(self):
        rows = {'training': [{'id': 1}], 'modules': [{'id': 'MOD-A'}]}
        with patch.object(views, 'get_curriculum_rows', return_value=rows) as read:
            self.assertEqual(views.get_cached_curriculum_rows(compact=True), rows)
            views._CURRICULUM_CACHE.clear()  # another worker: nothing in process memory
            self.assertEqual(views.get_cached_curriculum_rows(compact=True), rows)
        self.assertEqual(read.call_count, 1)
        stored = cache.get(views.shared_curriculum_cache_key('rows:compact', 11))
        self.assertIsInstance(stored, bytes)
        self.assertEqual(pickle.loads(zlib.decompress(stored)), rows)

    def test_rows_follow_the_epoch_and_use_the_payload_ttl(self):
        self.assertEqual(views.CURRICULUM_ROWS_CACHE_TTL_SECONDS, views.CURRICULUM_CACHE_TTL_SECONDS)
        with patch.object(views, 'get_curriculum_rows', side_effect=[{'v': 1}, {'v': 2}]):
            self.assertEqual(views.get_cached_curriculum_rows(), {'v': 1})
            views.shared_curriculum_epoch.return_value = 12
            self.assertEqual(views.get_cached_curriculum_rows(), {'v': 2})

    def test_valkey_down_still_builds(self):
        with patch.object(views, 'cache', BrokenCache()), \
                patch.object(views.shared_build, 'cache_is_shared', return_value=False), \
                patch.object(views, 'get_curriculum_rows', return_value={'v': 3}):
            self.assertEqual(views.get_cached_curriculum_rows(), {'v': 3})


class WarmAllowListTests(SimpleTestCase):
    def allowed(self, argv, service=None, **environ):
        if service is not None:
            environ['LOAD_METRIC_SERVICE'] = service
        return curriculum_apps.serves_curriculum_pages(argv, environ)

    def test_web_workers_of_curriculum_serving_services_warm(self):
        uvicorn = ['/usr/local/bin/uvicorn', 'config.asgi:application']
        self.assertTrue(self.allowed(uvicorn, 'curriculum-api'))
        self.assertTrue(self.allowed(uvicorn, 'night-api'))
        self.assertTrue(self.allowed(uvicorn))  # unnamed deployment / local
        self.assertTrue(self.allowed(['/usr/local/bin/gunicorn', 'config.wsgi'], 'curriculum-api'))
        self.assertTrue(self.allowed(['manage.py', 'runserver'], RUN_MAIN='true'))

    def test_other_services_and_every_command_do_not(self):
        uvicorn = ['/usr/local/bin/uvicorn', 'config.asgi:application']
        for service in ('learner-api', 'coach-api', 'login-api', 'quiz-api', 'enrolment-api', 'engagement-api'):
            self.assertFalse(self.allowed(uvicorn, service), service)
        for argv in (['manage.py', 'process_session_results', '--scheduled', '--limit', '10'],
                     ['manage.py', 'migrate'], ['manage.py', 'some_new_command'],
                     ['manage.py', 'runserver']):  # the reloader parent
            self.assertFalse(self.allowed(argv, 'curriculum-api'), argv)
            self.assertFalse(self.allowed(argv), argv)

    def test_ready_schedules_only_when_allowed(self):
        config = curriculum_apps.CurriculumApiConfig.__new__(curriculum_apps.CurriculumApiConfig)
        config.log_cache_backend = lambda: None
        cases = [
            (['/usr/local/bin/uvicorn', 'config.asgi:application'], 'night-api', True),
            (['/usr/local/bin/uvicorn', 'config.asgi:application'], 'curriculum-api', True),
            (['/usr/local/bin/uvicorn', 'config.asgi:application'], 'learner-api', False),
            (['manage.py', 'process_session_results', '--scheduled'], '', False),
        ]
        for argv, service, expected in cases:
            with self.subTest(argv=argv[1], service=service), \
                    patch.object(curriculum_apps.sys, 'argv', argv), \
                    patch.dict(curriculum_apps.os.environ, {'LOAD_METRIC_SERVICE': service}), \
                    patch('curriculum_api.read_model.register_curriculum_home_read_model'), \
                    patch.object(curriculum_apps, 'reconciliation_command', return_value=False), \
                    patch.object(curriculum_apps.settings, 'CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED', False), \
                    patch.object(views, 'schedule_curriculum_warm') as schedule:
                config.ready()
                self.assertEqual(schedule.called, expected)


class InvalidationGuardTests(SimpleTestCase):
    """Every module that writes a cached curriculum table also invalidates.

    The content cache is retired only by invalidate_curriculum_cache(). A new
    command or helper that writes these tables without it would leave learner
    pages stale for CONTENT_CACHE_TTL_SECONDS, which is what this catches.
    backend/scripts/ is exempt by design (see content_cache's docstring).
    """

    RAW = __import__('re').compile(
        r'(insert\s+into|update|delete\s+from)\s+"?curriculum"?\."?(components|weeks|modules|ksb_mappings)\b',
        __import__('re').I)
    HELPER = __import__('re').compile(
        r'(insert_row|update_rows|delete_rows|authoring_upsert|authoring_bulk_upsert|authoring_delete|'
        r'authoring_soft_delete)\(\s*(?:v\.|views\.)?AUTHORING_(COMPONENTS|WEEKS|MODULES|KSB_MAPPINGS)_TABLE')

    def test_writers_of_cached_tables_invalidate(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in root.rglob('*.py'):
            relative = path.relative_to(root).as_posix()
            name = path.name
            if (relative.startswith(('venv/', 'scripts/', 'node_modules/')) or '/migrations/' in relative
                    or name.startswith(('test', 'run_')) or '/tests' in relative or name == 'tests.py'):
                continue
            text = path.read_text(encoding='utf-8', errors='ignore')
            if (self.RAW.search(text) or self.HELPER.search(text)) and 'invalidate_curriculum_cache' not in text:
                offenders.append(relative)
        self.assertEqual(offenders, [], 'These write cached curriculum tables without invalidate_curriculum_cache().')
