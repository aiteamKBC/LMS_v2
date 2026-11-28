"""Native row reuse and concurrent changes, without any application database."""
import copy
import hashlib
from contextlib import ExitStack
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import authoring_read_transport, authoring_row_cache as cache, views


class VerifiedAuthoringRowsTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(cache._SNAPSHOTS, clear=True))
        self.db = MagicMock(vendor='postgresql', settings_dict={'NAME': 'isolated', 'HOST': 'local'})
        self.stack.enter_context(patch.object(views, 'connection', self.db))
        self.stack.enter_context(patch.object(views, 'authoring_table_name', return_value='synthetic'))
        self.rows = [
            {'id': '1', 'description': '', 'settings_json': {'body': 'عربي 🙂'}, 'points': Decimal('1.20'),
             'created_at': datetime(2026, 10, 17, tzinfo=timezone.utc), cache._FINGERPRINT: 'first'},
            {'id': '2', 'description': None, 'settings_json': '{ "x": 1 }', cache._FINGERPRINT: 'second'},
        ]
        self.cursor = self.db.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.side_effect = lambda: (hashlib.sha256(''.join(row[cache._FINGERPRINT] for row in self.rows).encode()).hexdigest(),)
        self.fetch = self.stack.enter_context(patch.object(authoring_read_transport, '_compact_rows', side_effect=lambda *a, **kw: copy.deepcopy(self.rows)))
        self.headers = self.stack.enter_context(patch.object(views, 'rows_as_dicts', side_effect=lambda c: [
            {'id': row['id'], cache._FINGERPRINT: row[cache._FINGERPRINT]} for row in self.rows
        ]))

    def read(self, scope='module_catalogue_id = %s', params=None, columns=None):
        return cache.read_verified_rows('components', scope, params or ['M1'], 'id', columns or ['id', 'description', 'settings_json'])

    def test_unchanged_rows_still_check_database_but_do_not_transfer_content(self):
        first = self.read()
        self.fetch.reset_mock()
        # Caller mutation must not corrupt the compressed snapshot.
        first[0]['settings_json']['body'] = 'local unsaved edit'
        actual = self.read()
        self.fetch.assert_not_called()
        self.headers.assert_not_called()
        self.assertEqual(actual[0]['settings_json']['body'], 'عربي 🙂')
        self.assertEqual(actual[0]['points'], Decimal('1.20'))
        self.assertIsInstance(actual[0]['created_at'], datetime)
        self.assertEqual(actual[1]['settings_json'], '{ "x": 1 }')
        self.assertNotIn(cache._FINGERPRINT, actual[0])
        sql, params = self.db.cursor.return_value.__enter__.return_value.execute.call_args.args
        self.assertIn('sha256', sql)
        self.assertIn('pg_typeof', sql)
        self.assertEqual(params, ['M1'])

    def test_changed_and_inserted_rows_are_read_and_deleted_rows_disappear(self):
        self.read()
        self.rows = [
            {'id': '3', 'description': 'new', cache._FINGERPRINT: 'inserted'},
            {'id': '1', 'settings_json': {'body': 'changed'}, cache._FINGERPRINT: 'changed'},
        ]
        self.fetch.reset_mock()
        actual = self.read()
        self.assertEqual([row['id'] for row in actual], ['3', '1'])
        self.assertEqual(actual[1]['settings_json']['body'], 'changed')
        self.fetch.assert_called_once()
        self.assertEqual(self.fetch.call_args.args[2], ['M1', '3', '1'])

    def test_delete_all_rows_returns_empty_without_reusing_old_content(self):
        self.read()
        self.rows = []
        self.fetch.reset_mock()
        self.assertEqual(self.read(), [])
        self.fetch.assert_not_called()

    def test_one_changed_row_does_not_reload_unchanged_siblings(self):
        self.read()
        self.rows[1]['description'] = 'edited'
        self.rows[1][cache._FINGERPRINT] = 'second-edited'
        self.fetch.side_effect = lambda *a, **kw: [copy.deepcopy(self.rows[1])]
        self.fetch.reset_mock()
        result = self.read()
        self.assertEqual(result[0]['settings_json'], {'body': 'عربي 🙂'})
        self.assertEqual(result[1]['description'], 'edited')
        self.assertEqual(self.fetch.call_args.args[2], ['M1', '2'])

    def test_write_between_digest_and_content_reads_falls_back_to_one_fresh_snapshot(self):
        self.read()
        self.cursor.fetchone.side_effect = None
        self.cursor.fetchone.return_value = ('changed',)
        self.headers.side_effect = None
        self.headers.return_value = [{'id': '1', cache._FINGERPRINT: 'middle'}]
        self.fetch.side_effect = [
            [{'id': '1', 'description': 'latest', cache._FINGERPRINT: 'latest'}],
            [{'id': '1', 'description': 'latest', cache._FINGERPRINT: 'latest'},
             {'id': '3', 'description': 'inserted meanwhile', cache._FINGERPRINT: 'third'}],
        ]
        self.fetch.reset_mock()
        result = self.read()
        self.assertEqual([row['id'] for row in result], ['1', '3'])
        self.assertEqual(self.fetch.call_count, 2)
        self.assertEqual(self.fetch.call_args.args[1:3], ('module_catalogue_id = %s', ['M1']))

    def test_delete_between_digest_and_content_reads_also_falls_back(self):
        self.read()
        self.cursor.fetchone.side_effect = None
        self.cursor.fetchone.return_value = ('changed',)
        self.headers.side_effect = None
        self.headers.return_value = [{'id': '1', cache._FINGERPRINT: 'changed'}]
        self.fetch.side_effect = [[], []]
        self.fetch.reset_mock()
        self.assertEqual(self.read(), [])
        self.assertEqual(self.fetch.call_count, 2)

    def test_query_projection_and_database_scopes_never_share_rows(self):
        self.read()
        self.fetch.reset_mock()
        self.read(params=['M2'])
        self.read(columns=['id'])
        self.db.settings_dict['NAME'] = 'other database'
        self.read()
        self.assertEqual(self.fetch.call_count, 3)

    def test_read_failure_is_not_answered_with_unverified_cached_data(self):
        self.read()
        self.cursor.fetchone.side_effect = RuntimeError('database unavailable')
        with self.assertRaisesRegex(RuntimeError, 'database unavailable'):
            self.read()

    def test_expiry_and_size_limits_bound_process_memory(self):
        with patch.object(cache, '_MAX_ENTRIES', 2):
            cache._store('a', self.rows)
            cache._store('b', self.rows)
            cache._store('c', self.rows)
            self.assertIsNone(cache._load('a'))
            self.assertIsNotNone(cache._load('c'))
        with patch.object(cache, '_MAX_BYTES', 1):
            cache._store('d', self.rows)
            self.assertEqual(len(cache._SNAPSHOTS), 0)
        with patch.object(cache, '_TTL_SECONDS', -1):
            cache._store('expired', self.rows)
            self.assertIsNone(cache._load('expired'))

    def test_large_rewrite_uses_one_full_read(self):
        self.read()
        self.rows = [{'id': str(n), cache._FINGERPRINT: f'new-{n}'} for n in range(1100)]
        self.fetch.reset_mock()
        self.assertEqual(len(self.read()), 1100)
        self.fetch.assert_called_once()
        self.assertEqual(self.fetch.call_args.args[2], ['M1'])
