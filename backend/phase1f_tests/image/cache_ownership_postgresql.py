"""Actual cache epoch SQL/transaction parity on the disposable fixture only."""
def composition_fixture(*args, **kwargs):
    from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture as inject
    return inject(*args, **kwargs)

from contextlib import ExitStack, nullcontext
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from django.db import connection, transaction
from curriculum_api import views, cache_scope, read_model
from curriculum_api.catalogue.infrastructure import cache_epochs
from curriculum_api.test_cache_ownership_boundary_no_db import original_cache_ownership


class CacheOwnershipPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        with connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA phase1f_cache_ownership')
            cursor.execute('CREATE TABLE phase1f_cache_ownership.cache_epoch (id integer PRIMARY KEY, epoch bigint NOT NULL)')
            cursor.execute('INSERT INTO phase1f_cache_ownership.cache_epoch VALUES (1, 7)')

    def scenario(self, original, rollback=False, schema_error=False):
        with connection.cursor() as cursor:
            cursor.execute('UPDATE phase1f_cache_ownership.cache_epoch SET epoch=7 WHERE id=1')
        with ExitStack() as stack:
            for patcher in (
                composition_fixture(views, 'table_name', return_value='"phase1f_cache_ownership"."cache_epoch"'),
                composition_fixture(views, 'ensure_curriculum_epoch_table', return_value=True),
                patch.object(views.cache_state, '_CURRICULUM_CACHE', {'stale': {}, 'scoped': {'scoped': True}}),
                patch.object(views.cache_state, '_CURRICULUM_CACHE_EPOCH', 0),
                patch.object(views.cache_state, '_CURRICULUM_EPOCH_BUMP', SimpleNamespace(scoped=False)),
                patch.object(views.cache_state, '_SHARED_EPOCH_STATE', {'value': 7, 'checked_at': 0.0}),
                composition_fixture(cache_scope, 'bump_scopes', return_value=None),
                composition_fixture(cache_scope, 'forget_epochs'),
                composition_fixture(cache_scope, 'remember_scope_epochs'),
                patch.object(read_model, 'enqueue_all_curriculum_home_refreshes'),
                patch.object(views.schema_compat, 'invalidate'),
                composition_fixture(views, 'logger'),
            ):
                stack.enter_context(patcher)
            warm = stack.enter_context(composition_fixture(views, 'schedule_curriculum_warm'))
            if original:
                stack.enter_context(original_cache_ownership())
            with transaction.atomic():
                if schema_error:
                    # The old function uses a savepoint. A failed epoch UPDATE
                    # must leave the caller's transaction usable.
                    with composition_fixture(views, 'table_name', return_value='"phase1f_cache_ownership"."missing_epoch"'):
                        views.write_shared_curriculum_epoch_bump(frozenset({'P'}))
                else:
                    views.invalidate_curriculum_cache()
                self.assertFalse(warm.called)
                with connection.cursor() as cursor:
                    cursor.execute('SELECT epoch FROM phase1f_cache_ownership.cache_epoch WHERE id=1')
                    inside = cursor.fetchone()[0]
                if rollback:
                    transaction.set_rollback(True)
            with connection.cursor() as cursor:
                cursor.execute('SELECT epoch FROM phase1f_cache_ownership.cache_epoch WHERE id=1')
                persisted = cursor.fetchone()[0]
            return (inside, persisted, warm.call_count, dict(views.cache_state._CURRICULUM_CACHE),
                    views.cache_state._CURRICULUM_CACHE_EPOCH, views.cache_state._SHARED_EPOCH_STATE['value'])

    def test_committed_epoch_and_on_commit_match_original(self):
        with patch.object(cache_epochs, 'write_shared_curriculum_epoch_bump', wraps=cache_epochs.write_shared_curriculum_epoch_bump) as called:
            actual = self.scenario(False)
        called.assert_called_once()
        self.assertEqual(actual, self.scenario(True))
        self.assertEqual(actual[:3], (8, 8, 1))

    def test_outer_rollback_preserves_existing_memory_and_scheduling_semantics(self):
        actual = self.scenario(False, rollback=True)
        self.assertEqual(actual, self.scenario(True, rollback=True))
        self.assertEqual(actual[:3], (8, 7, 0))
        # Characterization, not a new guarantee: existing local publication is
        # after the nested atomic block, before a caller's outer transaction ends.
        self.assertEqual(actual[-1], 8)

    def test_failed_epoch_sql_rolls_back_savepoint_and_discards_scoped_cache(self):
        actual = self.scenario(False, schema_error=True)
        self.assertEqual(actual, self.scenario(True, schema_error=True))
        self.assertEqual(actual[:3], (7, 7, 0))
        self.assertNotIn('scoped', actual[3])
        self.assertEqual(actual[-1], 7)
