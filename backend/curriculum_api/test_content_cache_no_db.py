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


OTJH = {'c1': (1.5, 'MOD-A'), 'c2': (None, 'MOD-A'), 'c3': (2, 'MOD-B')}
OTJH_LIVE = {'c1': 1.5, 'c2': None, 'c3': 2, 'c-new': 4}


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
        elif sql == content_cache.INDEX_SQL:
            self._result = [(cid, mid) for cid, (_otjh, mid) in OTJH.items()]
        elif sql == content_cache.OTJH_SQL:
            self._result = [(cid, otjh, mid) for cid, (otjh, mid) in OTJH.items() if mid in params[0]]
        elif 'expected_otjh' in sql:  # the by-id read
            self._result = [(cid, OTJH_LIVE[cid]) for cid in params[0] if cid in OTJH_LIVE]
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
@override_settings(SHARED_VERSION_CACHE_ALLOW_LOCAL=True)
class CacheTestCase(SimpleTestCase):
    def setUp(self):
        from config import cache_versions
        cache.clear()
        content_cache.reset_for_tests()
        cache_versions.reset_for_tests()
        self.addCleanup(content_cache.reset_for_tests)
        # Outside a transaction a bump applies at once, as after a commit.
        on_commit = patch('django.db.transaction.on_commit', side_effect=lambda fn, using=None: fn())
        on_commit.start()
        self.addCleanup(on_commit.stop)
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

    def test_a_write_retires_only_its_own_module(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        content_cache.note_rows('components', [{'id': 'c1', 'module_catalogue_id': 'MOD-A'}])
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        self.assertEqual(cursor.data_reads(), [[['MOD-A']]])

    def test_non_content_tables_retire_nothing(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        for table in ('learner_activity_display_overrides', 'groups', 'cohorts', 'live_sessions', 'reviews'):
            content_cache.note_rows(table, [{'module_catalogue_id': 'MOD-A'}])
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A'], 2)
        self.assertEqual(cursor.data_reads(), [])

    def test_a_request_bumps_each_written_module_once_after_the_view(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        from config import cache_versions
        with patch.object(cache_versions, 'bump', wraps=cache_versions.bump) as bump:
            content_cache.begin_write_scope()
            for _ in range(50):  # a tree save writes many rows of one module
                content_cache.note_rows('components', [{'module_catalogue_id': 'MOD-A'}])
            self.assertEqual(bump.call_count, 0)
            content_cache.end_write_scope()
        self.assertEqual(bump.call_count, 1)
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        self.assertEqual(cursor.data_reads(), [[['MOD-A']]])

    def test_retire_all_and_the_curriculum_epoch(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
        with patch.object(views, 'bump_shared_curriculum_epoch'), patch.object(views, 'schedule_curriculum_warm'), \
                patch('curriculum_api.read_model.enqueue_all_curriculum_home_refreshes'):
            views.invalidate_curriculum_cache()  # a non-content write: learner content stays
            cursor = FakeCursor()
            content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
            self.assertEqual(cursor.data_reads(), [])
            views.invalidate_curriculum_cache(content_scope='all')  # a raw-SQL content write
            cursor = FakeCursor()
            content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A', 'MOD-B'], 2)
            self.assertEqual(cursor.data_reads(), [[['MOD-A', 'MOD-B']]])

    def test_a_missing_version_is_a_miss_and_versions_never_repeat(self):
        from config import cache_versions
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        key = cache_versions.version_key(content_cache.NAMESPACE, 'MOD-A')
        seen = {cache.get(key)}
        for _ in range(3):
            cache.delete(key)  # restart / eviction
            cursor = FakeCursor()
            content_cache.module_rows(cursor, 'comp', SQL, ['MOD-A'], 2)
            self.assertEqual(cursor.data_reads(), [[['MOD-A']]])
            seen.add(cache.get(key))
        self.assertEqual(len(seen), 4)

    def test_a_different_statement_is_a_different_key(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        cursor = FakeCursor()
        content_cache.module_rows(cursor, 'comp', SQL + ' ', ['MOD-A'], 2)
        self.assertEqual(len([s for s, _ in cursor.executed if 'ANY' in s and 'information_schema' not in s]), 1)

    def test_keys_hold_only_module_ids_and_statement_digests(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A', 'odd id/with space'], 2)
        from django.core.cache import caches
        keys = [key for key in caches['default']._cache if ':cmc:v2:' in key]
        self.assertEqual(len(keys), 2)
        for key in keys:
            tail = key.split(':cmc:v2:', 1)[1]
            part, statement, module, version, generation = tail.split(':')
            self.assertEqual((part, len(statement), len(version), len(generation)), ('comp', 16, 16, 16))
            self.assertIn(module, {'MOD-A', 'h' + content_cache._digest('odd id/with space')})

    def test_values_are_compressed_pickles(self):
        content_cache.module_rows(FakeCursor(), 'comp', SQL, ['MOD-A'], 2)
        from django.core.cache import caches
        key = next(key for key in caches['default']._cache if ':cmc:v2:comp:' in key)
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
    def test_matches_the_by_id_read_and_hits_after_the_first(self):
        ids = ['c1', 'c2', 'c3', 'missing']
        first = content_cache.expected_otjh(FakeCursor(), ids)
        self.assertEqual(first, {'c1': 1.5, 'c2': None, 'c3': 2})
        cursor = FakeCursor()
        self.assertEqual(content_cache.expected_otjh(cursor, ids), first)
        self.assertEqual([sql for sql, _ in cursor.executed if 'curriculum.components' in sql],
                         ['SELECT id, expected_otjh FROM curriculum.components WHERE id = ANY(%s)'])

    def test_a_component_the_index_does_not_know_is_read_by_id(self):
        result = content_cache.expected_otjh(FakeCursor(), ['c1', 'c-new'])
        self.assertEqual(result, {'c1': 1.5, 'c-new': 4})

    def test_an_edit_to_one_module_rebuilds_only_its_values(self):
        content_cache.expected_otjh(FakeCursor(), ['c1', 'c3'])
        content_cache.note_modules(['MOD-B'])
        cursor = FakeCursor()
        content_cache.expected_otjh(cursor, ['c1', 'c3'])
        self.assertEqual([params for sql, params in cursor.executed if sql == content_cache.OTJH_SQL],
                         [[['MOD-B']]])
        self.assertFalse(any(sql == content_cache.INDEX_SQL for sql, _ in cursor.executed))

    def test_learner_and_coach_lookups_match_the_by_id_reads(self):
        from coach_api import views as coach
        from learner_api import learner_detail
        known = {'c1': 2, 'c2': None, 'c3': 0}
        with patch.object(content_cache, 'expected_otjh', side_effect=lambda cur, ids: {i: known[i] for i in ids if i in known}), \
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
                patch.object(content_cache, 'expected_otjh', side_effect=AssertionError('not shared')):
            self.assertIsNone(coach._shared_expected_otjh(['c1']))


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
        self.assertEqual(views.CURRICULUM_ROWS_CACHE_TTL_SECONDS, 300)
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


@LOCAL_CACHE
class SharedTtlCapTests(SimpleTestCase):
    """Retired generations must not pile up in Valkey for the payload's full TTL."""

    def setUp(self):
        views._CURRICULUM_CACHE.clear()
        self.addCleanup(views._CURRICULUM_CACHE.clear)

    def test_shared_copy_is_capped_but_the_process_copy_keeps_its_ttl(self):
        with patch.object(views, 'shared_curriculum_epoch', return_value=21), \
                patch.object(views.cache, 'set', wraps=views.cache.set) as shared_set:
            views.cached_curriculum_value('cap-check', lambda: {'v': 1}, ttl=1800)
        self.assertEqual(shared_set.call_args.kwargs['timeout'], views.CURRICULUM_SHARED_TTL_SECONDS)
        self.assertEqual(views.CURRICULUM_SHARED_TTL_SECONDS, 300)
        entry = views._CURRICULUM_CACHE['cap-check']
        import time as _time
        from datetime import datetime
        self.assertGreater(entry['expires_at'] - datetime.now().timestamp(), 1700)

    def test_a_shorter_ttl_is_not_raised(self):
        with patch.object(views, 'shared_curriculum_epoch', return_value=22), \
                patch.object(views.cache, 'set', wraps=views.cache.set) as shared_set:
            views.cached_curriculum_value('short-check', lambda: {'v': 1}, ttl=60)
        self.assertEqual(shared_set.call_args.kwargs['timeout'], 60)


class MovePreReadTests(SimpleTestCase):
    """A write that can move rows between modules retires the modules they leave."""

    def run_pre_read(self, table, payloads, **kwargs):
        with patch.object(views.connection, 'vendor', 'postgresql'), \
                patch.object(views, 'fetch_all', return_value=[{'module_catalogue_id': 'MOD-OLD'}]) as read, \
                patch.object(content_cache, 'note_modules') as noted, \
                patch.object(content_cache, 'retire_all') as retired:
            views.note_previous_content_modules(table, payloads=payloads, **kwargs)
        return read, noted, retired

    def test_update_that_sets_the_module_reads_the_old_one(self):
        read, noted, retired = self.run_pre_read('components', [{'module_catalogue_id': 'MOD-NEW'}],
                                                 where_sql='id = %s', where_params=['c1'])
        self.assertIn('where id = %s', read.call_args.args[0])
        self.assertEqual(list(noted.call_args.args[0]), ['MOD-OLD'])
        retired.assert_not_called()

    def test_upsert_by_id_reads_the_old_modules_once(self):
        read, noted, _ = self.run_pre_read('weeks', [{'id': 'w1', 'module_catalogue_id': 'M'},
                                                     {'id': 'w2', 'module_catalogue_id': 'M'}], key_columns=['id'])
        self.assertEqual(read.call_count, 1)
        self.assertEqual(read.call_args.args[1], [['w1', 'w2']])

    def test_writes_that_cannot_move_rows_read_nothing(self):
        for table, payloads in (('components', [{'title': 'x'}]), ('modules', [{'module_catalogue_id': 'M'}]),
                                ('groups', [{'module_catalogue_id': 'M'}])):
            with self.subTest(table=table):
                read, noted, retired = self.run_pre_read(table, payloads, where_sql='1=1', where_params=[])
                read.assert_not_called()
                noted.assert_not_called()
                retired.assert_not_called()

    def test_an_unknown_key_or_a_failed_read_retires_everything(self):
        _read, _noted, retired = self.run_pre_read('ksb_mappings', [{'module_catalogue_id': 'M'}],
                                                   key_columns=['component_id', 'ksb_code'])
        retired.assert_called_once()
        with patch.object(views.connection, 'vendor', 'postgresql'), \
                patch.object(views, 'fetch_all', side_effect=RuntimeError('down')), \
                patch.object(content_cache, 'retire_all') as retired:
            views.note_previous_content_modules('components', payloads=[{'module_catalogue_id': 'M'}],
                                                where_sql='id = %s', where_params=['c'])
        retired.assert_called_once()

    def test_every_helper_reports_its_rows(self):
        """note_live_rows feeds content_cache.note_rows for every write helper."""
        with patch.object(content_cache, 'note_rows') as noted, \
                patch('curriculum_api.module_live.note_rows'):
            views.note_live_rows('components', [{'module_catalogue_id': 'MOD-A'}])
        noted.assert_called_once_with('components', [{'module_catalogue_id': 'MOD-A'}])


class RawContentWriterGuardTests(SimpleTestCase):
    """Raw SQL writes to cached content tables bypass the helpers' reporting, so
    each such file must name the module it wrote (note_modules) or retire all."""

    def test_raw_content_writers_retire_their_modules(self):
        from pathlib import Path
        root = Path(__file__).resolve().parents[1]
        offenders = []
        for path in root.rglob('*.py'):
            relative = path.relative_to(root).as_posix()
            name = path.name
            if (relative.startswith(('venv/', 'scripts/', 'node_modules/')) or '/migrations/' in relative
                    or name.startswith(('test', 'run_', 'postgres_')) or '/tests' in relative
                    or name == 'tests.py' or name.startswith('apply_')):
                continue
            text = path.read_text(encoding='utf-8', errors='ignore')
            if InvalidationGuardTests.RAW.search(text) and not any(
                    marker in text for marker in ('note_modules(', 'retire_all(', "content_scope='all'")):
                offenders.append(relative)
        self.assertEqual(offenders, [], 'These write content tables by raw SQL without retiring the modules.')
