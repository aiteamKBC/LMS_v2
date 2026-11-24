"""Frozen-source cache ownership parity; effects are synthetic and explicit."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

import curriculum_api
from django.test import SimpleTestCase
from . import views, content_cache, module_live, read_model
from .catalogue.infrastructure import cache_invalidation, cache_epochs, cache_runtime
from .catalogue.tests.parity.cache_ownership_oracle import SNAPSHOT, relocated_source


@contextmanager
def original_cache_ownership():
    """Execute the actual old bodies with their relocated shared state address."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT['functions'].items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(relocated_source(entry['source']), '<pre-cache-ownership>', 'exec'), namespace)
            compiled = namespace[name]
            original = FunctionType(compiled.__code__, vars(views), name, compiled.__defaults__)
            original.__kwdefaults__ = compiled.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


class CacheOwnershipParity(SimpleTestCase):
    def run_invalidation(self, original, *, fail_enqueue=False, fail_bump=False):
        events = []
        def event(label):
            def call(*args, **kwargs):
                events.append((label, args, kwargs))
                if label == 'enqueue' and fail_enqueue or label == 'bump' and fail_bump:
                    raise RuntimeError('synthetic failure')
            return call
        with ExitStack() as stack:
            state = views.cache_state
            for patcher in (
                patch.object(state, '_CURRICULUM_CACHE', {'global': {}, 'scoped': {'scoped': True}}),
                patch.object(state, '_CURRICULUM_CACHE_EPOCH', 0),
                patch.object(state, '_CURRICULUM_EPOCH_BUMP', SimpleNamespace()),
                composition_fixture(views, '_TABLE_EXISTS_CACHE', {'present': True, 'absent': False}),
                patch.object(views.schema_compat, 'invalidate', side_effect=event('schema')),
                patch.object(content_cache, 'retire_all', side_effect=event('retire')),
                patch.object(content_cache, 'begin_write_scope', side_effect=event('content-begin')),
                patch.object(content_cache, 'end_write_scope', side_effect=event('content-end')),
                composition_fixture(module_live, 'begin_request', side_effect=event('module-begin')),
                composition_fixture(module_live, 'end_request', side_effect=event('module-end')),
                composition_fixture(read_model, 'enqueue_all_curriculum_home_refreshes', side_effect=event('enqueue')),
                composition_fixture(views, 'write_shared_curriculum_epoch_bump', side_effect=event('bump')),
                patch.object(views.transaction, 'on_commit', side_effect=lambda callback: events.append(('on-commit', callback.__name__))),
                composition_fixture(views, 'logger'),
            ):
                stack.enter_context(patcher)
            if original:
                stack.enter_context(original_cache_ownership())
            views.begin_curriculum_write_scope()
            views.invalidate_curriculum_cache('all')
            views.invalidate_curriculum_cache()
            pending = views.curriculum_write_pending()
            error = None
            try:
                views.end_curriculum_write_scope(frozenset({'P'}))
            except RuntimeError as exc:
                error = str(exc)
            return (events, pending, dict(state._CURRICULUM_CACHE), state._CURRICULUM_CACHE_EPOCH,
                    vars(state._CURRICULUM_EPOCH_BUMP), dict(views._TABLE_EXISTS_CACHE), error)

    def test_shared_state_invalidation_deduplication_and_callback_order(self):
        with patch.object(cache_invalidation, 'invalidate_curriculum_cache', wraps=cache_invalidation.invalidate_curriculum_cache) as called:
            actual = self.run_invalidation(False)
        self.assertEqual(called.call_count, 2)
        self.assertEqual(actual, self.run_invalidation(True))
        events, pending, entries, epoch, flags, tables, error = actual
        self.assertTrue(pending)
        self.assertEqual(entries, {'scoped': {'scoped': True}})
        self.assertEqual(epoch, 2)
        self.assertEqual(tables, {'present': True})
        self.assertFalse(flags['pending'])
        self.assertEqual([e[0] for e in events].count('enqueue'), 1)
        self.assertEqual([e[0] for e in events].count('bump'), 1)
        self.assertEqual(events[-1][0], 'module-end')
        self.assertIsNone(error)

    def test_enqueue_failure_keeps_the_existing_once_per_request_rule(self):
        actual = self.run_invalidation(False, fail_enqueue=True)
        self.assertEqual(actual, self.run_invalidation(True, fail_enqueue=True))
        self.assertEqual([e[0] for e in actual[0]].count('enqueue'), 1)

    def test_failed_flush_still_ends_request_and_clears_pending(self):
        actual = self.run_invalidation(False, fail_bump=True)
        self.assertEqual(actual, self.run_invalidation(True, fail_bump=True))
        self.assertEqual(actual[0][-1][0], 'module-end')
        self.assertEqual(actual[-1], 'synthetic failure')
        self.assertFalse(actual[4]['pending'])

    def test_no_copy_of_state_remains_in_views(self):
        for name in SNAPSHOT['state']:
            self.assertNotIn(name, vars(views))
        for owner in (cache_invalidation, cache_epochs, cache_runtime):
            self.assertIs(owner.cache_state, views.cache_state)

    def test_reset_clears_the_owned_schema_flag(self):
        # Unchanged sibling flag resets are stubbed; no review/provider modules
        # need importing just to verify this state address.
        with ExitStack() as stack:
            for name in ('reviews', 'review_schedule', 'review_types', 'review_instances'):
                sibling = SimpleNamespace(reset_ready_flag=Mock())
                stack.enter_context(patch.object(curriculum_api, name, sibling, create=True))
            stack.enter_context(patch.object(views.cache_state, '_CURRICULUM_EPOCH_TABLE_READY', True))
            views.reset_schema_ready_flags()
            self.assertFalse(views.cache_state._CURRICULUM_EPOCH_TABLE_READY)
            self.assertNotIn('_CURRICULUM_EPOCH_TABLE_READY', vars(views))
