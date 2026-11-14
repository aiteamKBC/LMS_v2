"""The programme modules section's read path: shared forced builds, read-after-write, prefetch, warm."""
from unittest.mock import MagicMock, patch

from django.core.cache.backends.locmem import LocMemCache
from django.test import RequestFactory, SimpleTestCase

from . import views


class ForcedReadSharingTests(SimpleTestCase):
    def setUp(self):
        cache = LocMemCache('modules-read-path', {})
        cache.clear()
        for target, value in (('_CURRICULUM_CACHE', {}), ('cache', cache)):
            patcher = patch.object(views, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch.object(views, 'shared_curriculum_epoch', return_value=1)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_forced_read_takes_a_build_that_began_after_it_asked(self):
        with patch.object(views.time, 'monotonic', return_value=200.0):
            views.cached_curriculum_value('k', lambda: 'built at 200')
        # Asked at 100, queued behind the build that began at 200: every read
        # that build made came after this caller asked, so it is taken.
        with patch.object(views.time, 'monotonic', return_value=100.0):
            self.assertEqual(views.cached_curriculum_value('k', lambda: 'rebuilt', force=True), 'built at 200')

    def test_forced_read_never_takes_a_build_that_began_before_it_asked(self):
        with patch.object(views.time, 'monotonic', return_value=100.0):
            views.cached_curriculum_value('k', lambda: 'old')
        with patch.object(views.time, 'monotonic', return_value=200.0):
            self.assertEqual(views.cached_curriculum_value('k', lambda: 'new', force=True), 'new')

    def test_a_request_that_has_written_never_shares(self):
        views.cached_curriculum_value('k', lambda: 'old')
        entry = views._CURRICULUM_CACHE['k']
        entry['build_started'] = float('inf')  # as if built after this call began
        with patch.object(views._CURRICULUM_EPOCH_BUMP, 'pending', True, create=True):
            self.assertEqual(views.cached_curriculum_value('k', lambda: 'mine', force=True), 'mine')


class ReadAfterWriteTests(SimpleTestCase):
    def call(self, **headers):
        request = RequestFactory().get('/curriculum/programmes/P1/detail/modules/?visibility=all&view=workspace', **headers)
        with patch.object(views, 'repair_curriculum_parent_links'), \
                patch.object(views, 'refresh_curriculum_generations') as refresh, \
                patch.object(views, 'cached_programme_detail_section', return_value=views.encode_json_entry({'flat': {}})) as section, \
                patch.object(views, 'note_programme_section_read'):
            views.curriculum_programme_detail_section(request, 'P1', 'modules')
        return refresh, section

    def test_max_age_zero_rechecks_the_generation_without_forcing_a_rebuild(self):
        refresh, section = self.call(HTTP_CACHE_CONTROL='max-age=0')
        refresh.assert_called_once_with()
        self.assertFalse(section.call_args.kwargs['force'])

    def test_no_cache_still_forces_and_a_plain_read_does_neither(self):
        refresh, section = self.call(HTTP_CACHE_CONTROL='no-cache')
        refresh.assert_not_called()
        self.assertTrue(section.call_args.kwargs['force'])
        refresh, section = self.call()
        refresh.assert_not_called()
        self.assertFalse(section.call_args.kwargs['force'])

    def test_epoch_noted_by_the_scope_poll_only_moves_forward(self):
        with patch.dict(views._SHARED_EPOCH_STATE, {'value': 5, 'checked_at': 0.0}):
            views.note_read_shared_curriculum_epoch(4)
            self.assertEqual(views._SHARED_EPOCH_STATE['value'], 5)
            self.assertEqual(views._SHARED_EPOCH_STATE['checked_at'], 0.0)
            views.note_read_shared_curriculum_epoch(7)
            self.assertEqual(views._SHARED_EPOCH_STATE['value'], 7)
            self.assertGreater(views._SHARED_EPOCH_STATE['checked_at'], 0.0)


class PrefetchTests(SimpleTestCase):
    def setUp(self):
        patcher = patch.object(views, 'CURRICULUM_BATCHED_READS', True)
        patcher.start()
        self.addCleanup(patcher.stop)

    def fake_connection(self, rows_by_sql, *, in_atomic_block=False, fail=False):
        sent = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params):
                sent.append((sql, list(params)))
                if fail:
                    raise RuntimeError('relation does not exist')
                # One multi-statement query: one result set per statement.
                self._sets = [rows_by_sql[statement] for statement in sql.split('; ')]
                self.nextset()

            def nextset(self):
                if not self._sets:
                    return None
                self.description = [('id',)]
                self._rows = self._sets.pop(0)
                return True

            def fetchall(self):
                return self._rows

        connection = MagicMock(vendor='postgresql', in_atomic_block=in_atomic_block)
        connection.cursor.side_effect = Cursor
        return connection, sent

    def test_results_land_under_the_keys_the_real_calls_use(self):
        rows = {}
        connection, sent = self.fake_connection(rows)
        with patch.object(views, 'connection', connection), views.curriculum_read_scope():
            rows[views.authoring_select_sql('modules', 'module_catalogue_id in (%s)', ensure_tables=False)] = [('M1',)]
            rows[views.authoring_select_sql('weeks', 'module_catalogue_id in (%s)', 'display_order, id', ensure_tables=False)] = [('W1',)]
            views.prefetch_authoring_reads([
                (('modules', 'module_catalogue_id in (%s)', ['M1']), {'ensure_tables': False}),
                (('weeks', 'module_catalogue_id in (%s)', ['M2'], 'display_order, id'), {'ensure_tables': False}),
            ])
            # Both reads in one round trip, their parameters in statement order.
            self.assertEqual(len(sent), 1)
            self.assertEqual(sent[0][1], ['M1', 'M2'])
            # Spelled differently (keyword arguments), still the same memo key.
            self.assertEqual(views.authoring_fetch_all('modules', where_sql='module_catalogue_id in (%s)', params=['M1'], ensure_tables=False), [{'id': 'M1'}])
            self.assertEqual(views.authoring_fetch_all('weeks', 'module_catalogue_id in (%s)', ['M2'], 'display_order, id', ensure_tables=False), [{'id': 'W1'}])
            self.assertEqual(len(sent), 1)

    def test_a_failed_batch_leaves_every_read_to_its_call(self):
        connection, sent = self.fake_connection({}, fail=True)
        with patch.object(views, 'connection', connection), views.curriculum_read_scope():
            views.prefetch_authoring_reads([(('modules',), {'ensure_tables': False}), (('weeks',), {'ensure_tables': False})])
            self.assertEqual(len(sent), 1)
            self.assertEqual(views._CURRICULUM_READ_SCOPE.memo, {})

    def test_nothing_is_sent_inside_a_transaction_or_outside_a_read_scope(self):
        calls = [(('modules',), {'ensure_tables': False}), (('weeks',), {'ensure_tables': False})]
        connection, sent = self.fake_connection({}, in_atomic_block=True)
        with patch.object(views, 'connection', connection), views.curriculum_read_scope():
            views.prefetch_authoring_reads(calls)
        connection, sent_outside = self.fake_connection({})
        with patch.object(views, 'connection', connection):
            views.prefetch_authoring_reads(calls)
        self.assertEqual(sent + sent_outside, [])

    def test_nothing_is_sent_while_switched_off(self):
        connection, sent = self.fake_connection({})
        with patch.object(views, 'CURRICULUM_BATCHED_READS', False),                 patch.object(views, 'connection', connection), views.curriculum_read_scope():
            views.prefetch_authoring_reads([(('modules',), {'ensure_tables': False}), (('weeks',), {'ensure_tables': False})])
        self.assertEqual(sent, [])


class PrefetchMatchesTheReadsTests(SimpleTestCase):
    """A prefetch only helps when it is keyed as the call that follows it."""

    def keys(self, calls):
        return {views.authoring_fetch_all.memo_key(*args, **kwargs) for args, kwargs in calls}

    def test_training_rows_prefetch_the_three_reads_they_make(self):
        real = views.authoring_fetch_all
        made, prefetched = [], []
        recorder = MagicMock(side_effect=lambda *args, **kwargs: made.append((args, kwargs)) or [])
        with patch.object(views, 'authoring_fetch_all', recorder),                 patch.object(views, 'prefetch_authoring_reads', side_effect=prefetched.extend):
            recorder.memo_key = real.memo_key
            views.authoring_modules_as_training_rows()
        self.assertEqual(len(made), 3)
        self.assertEqual(self.keys(prefetched), self.keys(made))

    def test_rows_already_supplied_are_not_prefetched(self):
        prefetched = []
        with patch.object(views, 'authoring_fetch_all', return_value=[]),                 patch.object(views, 'prefetch_authoring_reads', side_effect=prefetched.extend):
            views.authoring_modules_as_training_rows(module_rows=[], cohort_rows=[])
        self.assertEqual([args[0] for args, _ in prefetched], [views.GROUPS_TABLE])


class WarmTargetTests(SimpleTestCase):
    def test_only_the_most_recent_sections_are_warmed(self):
        with patch.object(views, '_PROGRAMME_SECTION_WARM_TARGETS', views.OrderedDict()), \
                patch.object(views, 'cached_programme_detail_section') as section:
            for identifier in ('P1', 'P2', 'P3', 'P4', 'P2'):
                views.note_programme_section_read(identifier, 'all', True)
            views.warm_programme_detail_sections()
        self.assertEqual(
            [call.args for call in section.call_args_list],
            [('P2', 'all', 'modules', True), ('P4', 'all', 'modules', True), ('P3', 'all', 'modules', True)],
        )
