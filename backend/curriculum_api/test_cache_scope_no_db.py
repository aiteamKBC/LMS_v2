"""Programme-scoped cache generations; every database and cache call is mocked."""
import contextlib
import json
import threading
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import cache_scope, views
from .middleware import CurriculumChangeLogMiddleware


class WriteSeedTests(SimpleTestCase):
    def test_module_group_and_cohort_saves_are_attributable(self):
        self.assertEqual(cache_scope.write_seeds('PUT', '/curriculum/modules/MOD-1/structure/')['modules'], ['MOD-1'])
        self.assertEqual(cache_scope.write_seeds('PATCH', '/curriculum/modules/MOD-1/')['modules'], ['MOD-1'])
        self.assertEqual(cache_scope.write_seeds('PUT', '/curriculum/modules/MOD-1/weeks/W1/')['modules'], ['MOD-1'])
        self.assertEqual(cache_scope.write_seeds('PUT', '/curriculum/modules/MOD-1/components/C1/')['modules'], ['MOD-1'])
        self.assertEqual(cache_scope.write_seeds('PUT', '/curriculum/groups/G1/')['groups'], ['G1'])
        self.assertEqual(cache_scope.write_seeds('PUT', '/curriculum/cohorts/C1/')['cohorts'], ['C1'])

    def test_everything_else_stays_global(self):
        for method, path in (
            ('DELETE', '/curriculum/modules/MOD-1/'),
            ('PUT', '/curriculum/programmes/PROG-1/'),
            ('POST', '/curriculum/programmes/tree/'),
            ('PUT', '/curriculum/modules/MOD-1/week-teams-meetings/'),
            ('PUT', '/curriculum/modules/MOD-1/teams-links/'),
            ('POST', '/curriculum/modules/MOD-1/restore/'),
            ('POST', '/curriculum/modules/tutor-email/'),
            ('PUT', '/curriculum/ksb-sets/'),
            ('POST', '/curriculum/groups/G1/restore/'),
        ):
            with self.subTest(method=method, path=path):
                self.assertIsNone(cache_scope.write_seeds(method, path))


def resolution(found=(1, 0, 0), linked=1, refs=(), programmes=()):
    cursor = MagicMock()
    cursor.description = [(name,) for name in (
        'found_modules', 'found_groups', 'found_cohorts', 'linked_modules', 'refs', 'programmes',
    )]
    cursor.fetchone.return_value = (*found, linked, json.dumps([list(r) for r in refs]), json.dumps([list(p) for p in programmes]))
    connection = MagicMock(vendor='postgresql', in_atomic_block=False)
    connection.get_autocommit.return_value = True
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


class AffectedProgrammeTests(SimpleTestCase):
    def resolve(self, seeds, **kwargs):
        connection, cursor = resolution(**kwargs)
        with patch.object(cache_scope, 'connection', connection), \
                patch.object(cache_scope, 'scope_table_available', return_value=True):
            return cache_scope.affected_programmes(seeds), cursor

    def seeds(self, **ids):
        return {'modules': [], 'groups': [], 'cohorts': [], **ids}

    def test_the_rows_programmes_by_id_and_by_name(self):
        result, cursor = self.resolve(
            self.seeds(modules=['M1']),
            refs=[('P1', 'Data'), ('', 'Leadership '), ('P1', 'Old name')],
            programmes=[('P1', 'Data'), ('P2', 'Leadership'), ('P3', 'Other')],
        )
        self.assertEqual(result, {'P1', 'P2'})
        self.assertEqual(cursor.execute.call_args.args[1], {'m': ['M1'], 'g': [], 'c': []})

    def test_a_stale_name_matching_another_programme_retires_it_as_well(self):
        result, _ = self.resolve(
            self.seeds(modules=['M1']), refs=[('P1', 'Leadership')],
            programmes=[('P1', 'Data'), ('P2', 'Leadership')],
        )
        self.assertEqual(result, {'P1', 'P2'})

    def test_unsure_answers_are_global(self):
        cases = {
            'missing module': dict(found=(0, 0, 0)),
            'unknown programme id': dict(refs=[('P9', '')], programmes=[('P1', 'Data')]),
            'no programme at all': dict(refs=[('', '')], programmes=[('P1', 'Data')]),
            'closure too wide': dict(linked=cache_scope.MAX_LINKED_MODULES + 1, refs=[('P1', '')], programmes=[('P1', '')]),
        }
        for label, kwargs in cases.items():
            with self.subTest(label):
                result, _ = self.resolve(self.seeds(modules=['M1']), **kwargs)
                self.assertIsNone(result)

    def test_a_failed_lookup_is_global(self):
        connection, cursor = resolution()
        cursor.execute.side_effect = RuntimeError('timeout')
        with patch.object(cache_scope, 'connection', connection), \
                patch.object(cache_scope, 'scope_table_available', return_value=True), \
                patch.object(cache_scope.logger, 'warning'):
            self.assertIsNone(cache_scope.affected_programmes(self.seeds(modules=['M1'])))

    def test_no_table_means_no_lookup(self):
        connection, cursor = resolution()
        with patch.object(cache_scope, 'connection', connection), \
                patch.object(cache_scope, 'scope_table_available', return_value=False):
            self.assertIsNone(cache_scope.affected_programmes(self.seeds(modules=['M1'])))
        cursor.execute.assert_not_called()

    def test_the_closure_follows_copies_and_teams_sharing_both_ways(self):
        sql = cache_scope._AFFECTED_SQL
        self.assertIn('m.source_id = linked.id', sql)
        self.assertIn('m.teams_shared_source_module_id = linked.id', sql)
        self.assertIn('(m.source_id), (m.teams_shared_source_module_id)', sql)


class ProgrammeGenerationTests(SimpleTestCase):
    def test_only_an_exact_programme_id_is_scoped(self):
        epochs = {'#global': 40, '#bumps': 30, '*': 5, 'P1': 2}
        with patch.object(cache_scope, 'scope_epochs', return_value=epochs), \
                patch.object(cache_scope, 'programme_ids', return_value=frozenset({'P1', 'P2'})):
            self.assertEqual(cache_scope.programme_generation('P1'), ('scope', 10, 5, 'P1', 2))
            self.assertEqual(cache_scope.programme_generation('P2'), ('scope', 10, 5, 'P2', 0))
            self.assertIsNone(cache_scope.programme_generation('data-analyst'))
            self.assertIsNone(cache_scope.programme_generation(''))

    def test_no_table_is_global(self):
        with patch.object(cache_scope, 'scope_epochs', return_value=None):
            self.assertIsNone(cache_scope.programme_generation('P1'))

    def test_no_global_reading_is_global(self):
        with patch.object(cache_scope, 'scope_epochs', return_value={'*': 1}), \
                patch.object(cache_scope, 'programme_ids', return_value=frozenset({'P1'})):
            self.assertIsNone(cache_scope.programme_generation('P1'))


class ScopedCacheTests(SimpleTestCase):
    def setUp(self):
        self.epochs = {'#global': 7, '#bumps': 2, '*': 1, 'P1': 1, 'P2': 1}
        self.global_epoch = Mock(return_value=7)
        self.cache = Mock()
        self.cache.get.return_value = None
        for patcher in (
            patch.dict(views._CURRICULUM_CACHE, {}, clear=True),
            patch.object(views, '_CURRICULUM_CACHE_EPOCH', 0),
            patch.object(views, 'shared_curriculum_epoch', self.global_epoch),
            patch.object(views, 'cache', self.cache),
            patch.object(views.shared_build, 'try_acquire', return_value=(True, None)),
            patch.object(views.shared_build, 'release'),
            patch.object(cache_scope, 'scope_epochs', lambda: dict(self.epochs)),
            patch.object(cache_scope, 'programme_ids', return_value=frozenset({'P1', 'P2'})),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        views._CURRICULUM_EPOCH_BUMP.pending = False
        views._CURRICULUM_EPOCH_BUMP.scoped = False

    def get(self, programme, value):
        return views.cached_curriculum_value(f'detail:{programme}', lambda: value, scope=programme)

    def test_a_write_to_another_programme_keeps_the_entry(self):
        self.assertEqual(self.get('P1', 'p1 v1'), 'p1 v1')
        self.assertEqual(self.get('P2', 'p2 v1'), 'p2 v1')
        # Another programme's save: the global epoch, BUMPS and P2 move, P1 does not.
        self.global_epoch.return_value = 8
        self.epochs['#global'] += 1
        self.epochs['#bumps'] += 1
        self.epochs['P2'] += 1
        self.assertEqual(self.get('P1', 'p1 rebuilt'), 'p1 v1')
        self.assertEqual(self.get('P2', 'p2 v2'), 'p2 v2')

    def test_an_unattributed_write_retires_every_programme(self):
        self.get('P1', 'p1 v1')
        self.epochs['*'] += 1
        self.assertEqual(self.get('P1', 'p1 v2'), 'p1 v2')

    def test_a_writer_that_does_not_know_the_table_retires_every_programme(self):
        # An older deployment or another checkout: it moves the global epoch
        # alone, never BUMPS or any programme counter.
        self.get('P1', 'p1 v1')
        self.epochs['#global'] += 1
        self.assertEqual(self.get('P1', 'p1 v2'), 'p1 v2')
        # A later scoped save to another programme does not bring the old one back.
        self.epochs['#global'] += 1
        self.epochs['#bumps'] += 1
        self.epochs['P2'] += 1
        self.assertEqual(self.get('P1', 'p1 v3'), 'p1 v2')

    def test_unscoped_keys_still_follow_the_global_epoch(self):
        views.cached_curriculum_value('overview', lambda: 'o1')
        self.global_epoch.return_value = 8
        self.assertEqual(views.cached_curriculum_value('overview', lambda: 'o2'), 'o2')

    def test_a_local_invalidation_keeps_scoped_entries_and_drops_the_rest(self):
        self.get('P1', 'p1 v1')
        views.cached_curriculum_value('overview', lambda: 'o1')
        with patch.object(views, 'bump_shared_curriculum_epoch'), \
                patch.object(views.transaction, 'on_commit'), \
                patch('curriculum_api.read_model.enqueue_all_curriculum_home_refreshes'):
            views.invalidate_curriculum_cache()
        self.assertIn('detail:P1', views._CURRICULUM_CACHE)
        self.assertNotIn('overview', views._CURRICULUM_CACHE)

    def test_the_writing_request_reads_its_own_writes(self):
        self.get('P1', 'p1 v1')
        views._CURRICULUM_EPOCH_BUMP.pending = True
        try:
            self.assertEqual(self.get('P1', 'p1 after write'), 'p1 after write')
        finally:
            views._CURRICULUM_EPOCH_BUMP.pending = False

    def test_a_build_overtaken_by_its_programmes_write_is_not_published(self):
        def build():
            self.epochs['P1'] += 1
            return 'pre-write'
        self.assertEqual(views.cached_curriculum_value('detail:P1', build, scope='P1'), 'pre-write')
        self.assertNotIn('detail:P1', views._CURRICULUM_CACHE)

    def test_without_the_table_a_scope_is_ignored(self):
        with patch.object(cache_scope, 'scope_epochs', return_value=None):
            self.get('P1', 'p1 v1')
            self.global_epoch.return_value = 8
            self.assertEqual(self.get('P1', 'p1 v2'), 'p1 v2')


class MiddlewareScopeTests(SimpleTestCase):
    def run_request(self, method, path, before, after, pending=True, status=200):
        def view(request):
            views._CURRICULUM_EPOCH_BUMP.pending = pending
            return Mock(status_code=status)

        middleware = CurriculumChangeLogMiddleware(view)
        request = getattr(RequestFactory(), method.lower())('/curriculum_api' + path)
        answers = iter([before, after])
        with patch.object(cache_scope, 'affected_programmes', side_effect=lambda seeds: next(answers)) as resolve, \
                patch.object(views, 'write_shared_curriculum_epoch_bump') as bump, \
                patch.object(views, 'shared_curriculum_epoch', return_value=1), \
                patch.object(views, 'record_curriculum_change'):
            middleware(request)
        return bump, resolve

    def test_a_module_moved_between_programmes_retires_both(self):
        bump, _ = self.run_request('PUT', '/curriculum/modules/M1/', frozenset({'P1'}), frozenset({'P2'}))
        bump.assert_called_once_with(frozenset({'P1', 'P2'}))

    def test_an_unsure_side_makes_it_global(self):
        bump, _ = self.run_request('PUT', '/curriculum/modules/M1/', frozenset({'P1'}), None)
        bump.assert_called_once_with(None)
        bump, resolve = self.run_request('PUT', '/curriculum/modules/M1/', None, frozenset({'P1'}))
        bump.assert_called_once_with(None)
        self.assertEqual(resolve.call_count, 1)

    def test_other_writes_are_global_without_a_lookup(self):
        bump, resolve = self.run_request('POST', '/curriculum/programmes/tree/', None, None)
        bump.assert_called_once_with(None)
        resolve.assert_not_called()

    def test_a_save_that_wrote_nothing_bumps_nothing(self):
        bump, resolve = self.run_request('PUT', '/curriculum/modules/M1/', frozenset({'P1'}), frozenset({'P1'}), pending=False)
        bump.assert_not_called()
        self.assertEqual(resolve.call_count, 1)


class BumpTests(SimpleTestCase):
    def test_scopes_or_the_unscoped_counter_are_moved(self):
        connection = MagicMock(vendor='postgresql')
        for scopes, expected in ((frozenset({'P2', 'P1'}), ['#bumps', 'P1', 'P2']), (None, ['#bumps', '*'])):
            with self.subTest(scopes=scopes), \
                    patch.object(cache_scope, 'connection', connection), \
                    patch.object(cache_scope, 'scope_table_available', return_value=True), \
                    patch.object(cache_scope.transaction, 'atomic'), \
                    patch.object(views, 'fetch_all', return_value=[]) as fetch:
                cache_scope.bump_scopes(scopes)
            self.assertEqual(fetch.call_args.args[1], [expected])

    def test_a_failed_programme_bump_falls_back_to_the_unscoped_one(self):
        connection = MagicMock(vendor='postgresql')
        with patch.object(cache_scope, 'connection', connection), \
                patch.object(cache_scope, 'scope_table_available', return_value=True), \
                patch.object(cache_scope.transaction, 'atomic'), \
                patch.object(cache_scope.logger, 'warning'), \
                patch.object(views, 'fetch_all', side_effect=[RuntimeError('x'), []]) as fetch:
            cache_scope.bump_scopes(frozenset({'P1'}))
        self.assertEqual(fetch.call_args.args[1], [['#bumps', '*']])


def bump_harness(test, *, global_error=None, scope_rows=None, commit_error=None):
    """Patch views/cache_scope for write_shared_curriculum_epoch_bump().

    ``global_error`` fails the global UPDATE; ``commit_error`` fails the outer
    transaction after both statements ran, as a lost connection at COMMIT would.
    """
    @contextlib.contextmanager
    def atomic():
        yield
        if commit_error is not None:
            raise commit_error

    def fetch_all(sql, params=None):
        if global_error is not None:
            raise global_error
        return [{'epoch': 8}]

    for patcher in (
        patch.object(views, 'connection', MagicMock(vendor='postgresql')),
        patch.object(views, 'ensure_curriculum_epoch_table', return_value=True),
        patch.object(views.transaction, 'atomic', atomic),
        patch.object(views, 'fetch_all', side_effect=fetch_all),
        patch.object(cache_scope, 'bump_scopes', return_value=scope_rows),
        patch.object(views.logger, 'error'),
    ):
        patcher.start()
        test.addCleanup(patcher.stop)


class BumpFailureTests(SimpleTestCase):
    """A save whose counter cannot move must not leave this worker serving the
    programme pages it just changed, nor publish generations never committed."""

    def setUp(self):
        for patcher in (
            patch.dict(views._CURRICULUM_CACHE, {}, clear=True),
            patch.object(views, '_CURRICULUM_CACHE_EPOCH', 0),
            patch.dict(views._SHARED_EPOCH_STATE, {'value': 7, 'checked_at': 0.0}),
            patch.dict(cache_scope._STATE, {
                'epochs': {'#global': 7, '#bumps': 2, '*': 1, 'P1': 1},
                'checked_at': 123.0, 'table': True, 'table_checked_at': 0.0,
            }),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)
        views._CURRICULUM_CACHE.update({
            'detail:P1': {'expires_at': 1e12, 'shared_epoch': ('scope', 5, 1, 'P1', 1), 'value': 'p1', 'scoped': True},
            'overview': {'expires_at': 1e12, 'shared_epoch': 7, 'value': 'o', 'scoped': False},
        })

    def test_a_failed_global_bump_drops_this_workers_scoped_entries_and_says_so(self):
        bump_harness(self, global_error=RuntimeError('connection lost'))
        views.write_shared_curriculum_epoch_bump(frozenset({'P1'}))
        self.assertNotIn('detail:P1', views._CURRICULUM_CACHE)
        # A build already running cannot publish its pre-write result.
        self.assertEqual(views._CURRICULUM_CACHE_EPOCH, 1)
        # The polled generations are read again rather than trusted.
        self.assertIsNone(cache_scope._STATE['epochs'])
        # Nothing moved, so the remembered global epoch is unchanged.
        self.assertEqual(views._SHARED_EPOCH_STATE['value'], 7)
        views.logger.error.assert_called_once()

    def test_a_failed_commit_never_publishes_the_scope_epochs_it_returned(self):
        # Both statements ran, then COMMIT failed: P1=2 and global 8 are not
        # the database's values. Publishing them would key a pre-write build
        # on the generation the next real save to P1 hands out.
        bump_harness(self, scope_rows=[{'scope': '#bumps', 'epoch': 3}, {'scope': 'P1', 'epoch': 2}],
                     commit_error=RuntimeError('commit failed'))
        views.write_shared_curriculum_epoch_bump(frozenset({'P1'}))
        self.assertIsNone(cache_scope._STATE['epochs'])
        self.assertNotIn('detail:P1', views._CURRICULUM_CACHE)
        self.assertEqual(views._SHARED_EPOCH_STATE['value'], 7)

    def test_a_committed_bump_is_published_to_this_worker_at_once(self):
        bump_harness(self, scope_rows=[{'scope': '#bumps', 'epoch': 3}, {'scope': 'P1', 'epoch': 2}])
        views.write_shared_curriculum_epoch_bump(frozenset({'P1'}))
        self.assertEqual(cache_scope._STATE['epochs'], {'#global': 8, '#bumps': 3, '*': 1, 'P1': 2})
        self.assertEqual(views._SHARED_EPOCH_STATE['value'], 8)
        # Kept: the new P1 generation retires it on the next read.
        self.assertIn('detail:P1', views._CURRICULUM_CACHE)
        views.logger.error.assert_not_called()

    def test_a_scope_bump_that_moved_nothing_rereads_rather_than_guesses(self):
        bump_harness(self, scope_rows=None)
        views.write_shared_curriculum_epoch_bump(frozenset({'P1'}))
        self.assertIsNone(cache_scope._STATE['epochs'])

    def test_without_the_epoch_table_scoped_entries_are_dropped_as_before_scoping(self):
        with patch.object(views, 'ensure_curriculum_epoch_table', return_value=False), \
                patch.object(views, 'cache', Mock()):
            views.write_shared_curriculum_epoch_bump(frozenset({'P1'}))
        self.assertNotIn('detail:P1', views._CURRICULUM_CACHE)
        self.assertIn('overview', views._CURRICULUM_CACHE)

    def test_both_scope_bumps_failing_falls_back_to_the_global_epoch(self):
        # The programme counter and the unscoped fallback both fail: the table
        # is forgotten, so lookups use the global epoch this write did move.
        with patch.object(cache_scope, 'connection', MagicMock(vendor='postgresql')), \
                patch.object(cache_scope, 'scope_table_available', return_value=True), \
                patch.object(cache_scope.transaction, 'atomic'), \
                patch.object(cache_scope.logger, 'warning'), \
                patch.object(views, 'fetch_all', side_effect=RuntimeError('x')):
            self.assertIsNone(cache_scope.bump_scopes(frozenset({'P1'})))
        self.assertIsNone(cache_scope._STATE['table'])


class WriteOutsideRequestTests(SimpleTestCase):
    def tearDown(self):
        views._CURRICULUM_EPOCH_BUMP.scoped = False
        views._CURRICULUM_EPOCH_BUMP.pending = False

    def test_a_save_outside_a_request_moves_the_unscoped_counter_at_once(self):
        views._CURRICULUM_EPOCH_BUMP.scoped = False
        with patch.object(views, 'write_shared_curriculum_epoch_bump') as bump:
            views.bump_shared_curriculum_epoch()
        bump.assert_called_once_with()

    def test_inside_a_request_the_bump_is_owed_until_the_view_returns(self):
        views.begin_curriculum_write_scope()
        with patch.object(views, 'write_shared_curriculum_epoch_bump') as bump:
            views.bump_shared_curriculum_epoch()
            bump.assert_not_called()
            self.assertTrue(views.curriculum_write_pending())
            views.end_curriculum_write_scope(frozenset({'P1'}))
        bump.assert_called_once_with(frozenset({'P1'}))


class TwoWorkerTests(ScopedCacheTests):
    """Another worker's save reaches this one only through the polled epochs."""

    def test_another_workers_save_to_this_programme_retires_the_entry(self):
        self.assertEqual(self.get('P1', 'p1 v1'), 'p1 v1')
        # Worker B committed a scoped save to P1; worker A's next poll sees it.
        self.epochs.update({'#global': 8, '#bumps': 3, 'P1': 2})
        self.global_epoch.return_value = 8
        self.assertEqual(self.get('P1', 'p1 v2'), 'p1 v2')

    def test_concurrent_misses_on_one_programme_build_once(self):
        calls = []
        started = threading.Event()
        release = threading.Event()

        def build():
            calls.append(1)
            started.set()
            release.wait(5)
            return 'built'

        results = []

        def read():
            results.append(views.cached_curriculum_value('detail:P1', build, scope='P1'))

        threads = [threading.Thread(target=read) for _ in range(3)]
        for thread in threads:
            thread.start()
        started.wait(5)
        release.set()
        for thread in threads:
            thread.join(10)
        self.assertEqual(results, ['built'] * 3)
        self.assertEqual(len(calls), 1)


class LearnerFreshnessTests(SimpleTestCase):
    """Learner counts and KSB progress are bounded by a short TTL, because no
    curriculum epoch moves when learner, hours or progress data changes."""

    def captured_cache_call(self, path):
        from django.test import RequestFactory
        from django.urls import resolve
        captured = {}

        def fake_cache(key, factory, force=False, ttl=None, shared=True, scope=None):
            captured.update(key=key, ttl=ttl, scope=scope)
            return Mock()

        match = resolve(path)
        with patch.object(views, 'cached_curriculum_value', fake_cache), \
                patch.object(views, 'repair_curriculum_parent_links'), \
                patch.object(views, 'conditional_json_response', return_value=Mock(status_code=200)):
            match.func(RequestFactory().get(path), *match.args, **match.kwargs)
        return captured

    def test_learner_bearing_payloads_use_the_learner_ttl(self):
        base = '/curriculum_api/curriculum/programmes/P1'
        for path in (f'{base}/ksb-stats/', f'{base}/detail/', f'{base}/detail/shell/'):
            with self.subTest(path=path):
                captured = self.captured_cache_call(path)
                self.assertEqual(captured['ttl'], views.CURRICULUM_LEARNER_DATA_TTL_SECONDS)
                self.assertEqual(captured['scope'], 'P1')

    def test_the_modules_section_carries_no_learner_data_and_keeps_the_full_ttl(self):
        captured = self.captured_cache_call('/curriculum_api/curriculum/programmes/P1/detail/modules/')
        self.assertIsNone(captured['ttl'])
        self.assertEqual(captured['scope'], 'P1')

    def test_a_scoped_learner_entry_expires_even_when_no_epoch_moves(self):
        epochs = {'#global': 7, '#bumps': 2, '*': 1, 'P1': 1}
        clock = [1000.0]
        fake_datetime = Mock()
        fake_datetime.now.return_value.timestamp.side_effect = lambda: clock[0]
        ttl = views.CURRICULUM_LEARNER_DATA_TTL_SECONDS
        with patch.dict(views._CURRICULUM_CACHE, {}, clear=True), \
                patch.object(views, 'datetime', fake_datetime), \
                patch.object(views, 'shared_curriculum_epoch', return_value=7), \
                patch.object(views, 'cache', Mock(get=Mock(return_value=None))), \
                patch.object(views.shared_build, 'try_acquire', return_value=(True, None)), \
                patch.object(views.shared_build, 'release'), \
                patch.object(cache_scope, 'scope_epochs', return_value=epochs), \
                patch.object(cache_scope, 'programme_ids', return_value=frozenset({'P1'})):
            def get(value):
                return views.cached_curriculum_value('shell:P1', lambda: value, ttl=ttl, scope='P1')

            self.assertEqual(get('5 learners'), '5 learners')
            clock[0] += ttl - 1
            self.assertEqual(get('6 learners'), '5 learners')
            clock[0] += 2
            self.assertEqual(get('6 learners'), '6 learners')
