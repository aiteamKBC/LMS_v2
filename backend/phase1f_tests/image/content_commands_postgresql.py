"""Real content row locks and scoped source SQL on disposable synthetic tables."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import json
import unittest
from unittest.mock import Mock, patch
from django.db import connection, transaction
from curriculum_api import views, content_cache, learning_storage
from curriculum_api.catalogue.tests.test_content_commands_boundary_no_db import content_scope
from curriculum_api.catalogue.tests.test_module_commands_boundary_no_db import recording, request, response_value

SCHEMA = 'phase1f_content_commands'


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            names = [c[0] for c in cursor.description]
            rows = [dict(zip(names, row)) for row in cursor.fetchall()]
            for row in rows:
                if isinstance(row.get('settings'), str):
                    row['settings'] = json.loads(row['settings'])
            return rows
    return []


class ContentCommandsPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['NAME'] == 'phase1f'
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        query(f'CREATE SCHEMA {SCHEMA}')
        query(f'CREATE TABLE {SCHEMA}.components(id text primary key, settings jsonb, title text)')
        query(f'CREATE TABLE {SCHEMA}.modules(module_catalogue_id text primary key, programme_id text, ksb_profile_source_id text, updated_at timestamp)')
        query(f'CREATE TABLE {SCHEMA}.programmes(programme_id text primary key, name text)')
        query(f'CREATE TABLE {SCHEMA}.mappings(id text primary key, component_id text, module_catalogue_id text, ksb_code text, source_type text, source_id text, weight numeric)')

    def compare(self, scenario):
        result = scenario(False)
        self.assertEqual(result, scenario(True))
        return result

    def upload(self, old, rollback=False, failure=False):
        query(f'TRUNCATE {SCHEMA}.components')
        query(f"INSERT INTO {SCHEMA}.components VALUES ('C','{{\"body\":\"keep\"}}','Existing'),('OTHER','{{}}','Other')")
        events = []
        def save(table, keys, payload):
            self.assertTrue(connection.in_atomic_block)
            query(f'UPDATE {SCHEMA}.components SET settings=%s::jsonb WHERE id=%s', [payload['settings'], payload['id']])
            if failure:
                raise ValueError('late refusal')
        values = {'authoring_table_name': Mock(return_value=f'{SCHEMA}.components'),
                  'authoring_fetch_all': Mock(side_effect=lambda table, where, params: query(f'SELECT * FROM {SCHEMA}.components WHERE {where}', params)),
                  'authoring_upsert': Mock(side_effect=save),
                  'normalise_component_settings_payload': Mock(side_effect=lambda kind, value: value)}
        metadata = {'fileName': 'synthetic.pdf', 'url': '/synthetic.pdf', 'size': 3, 'contentType': 'application/pdf'}
        sql = []
        def capture(execute, statement, params, many, context):
            sql.append(statement)
            return execute(statement, params, many, context)
        with content_scope(old, events, values, atomic=False), connection.execute_wrapper(capture):
            try:
                with transaction.atomic():
                    result = views.update_component_upload_settings('C', 'reading', metadata)
                    if rollback:
                        transaction.set_rollback(True)
            except ValueError as exc:
                result = str(exc)
        # Savepoint names vary between calls; compare the actual row lock only.
        locks = [s for s in sql if 'for update' in s.lower()]
        return result, query(f'SELECT * FROM {SCHEMA}.components ORDER BY id'), locks

    def test_upload_locks_then_merges_preserving_other_fields_and_rows(self):
        result, rows, locks = self.compare(self.upload)
        self.assertTrue(result)
        self.assertEqual(len(locks), 1)
        self.assertEqual(rows[0]['settings']['body'], 'keep')
        self.assertEqual(rows[0]['settings']['resourceUrl'], '/synthetic.pdf')
        self.assertEqual(rows[0]['title'], 'Existing')
        self.assertEqual(rows[1]['settings'], {})

    def test_upload_failure_and_outer_rollback_preserve_previous_state(self):
        for kwargs in ({'failure': True}, {'rollback': True}):
            result, rows, locks = self.compare(lambda old: self.upload(old, **kwargs))
            self.assertEqual(rows[0]['settings'], {'body': 'keep'})
            self.assertEqual(len(locks), 1)

    def test_programme_source_update_matches_exact_id_or_name_and_preserves_other_programme(self):
        def scenario(old):
            query(f'TRUNCATE {SCHEMA}.modules, {SCHEMA}.programmes')
            query(f"INSERT INTO {SCHEMA}.programmes VALUES ('P','Synthetic'),('Q','Other')")
            query(f"INSERT INTO {SCHEMA}.modules VALUES ('M','P','before',NULL),('OTHER','Q','untouched',NULL)")
            events = []
            values = {'authoring_table_name': Mock(return_value=f'{SCHEMA}.modules'),
                      'table_name': Mock(return_value=f'{SCHEMA}.programmes')}
            with content_scope(old, events, values, atomic=False), patch.object(content_cache, 'retire_all', side_effect=recording(events, 'retire')):
                with transaction.atomic():
                    result = views.set_programme_modules_ksb_source(['Synthetic', 'Synthetic'], 'standard:ST0001')
            return result, query(f'SELECT * FROM {SCHEMA}.modules ORDER BY module_catalogue_id'), events
        result, rows, events = self.compare(scenario)
        self.assertEqual(result, 1)
        self.assertNotEqual(rows[0]['ksb_profile_source_id'], 'before')
        self.assertEqual(rows[1]['ksb_profile_source_id'], 'untouched')
        self.assertEqual([e[0] for e in events], ['retire'])

    def test_module_lock_uses_storage_identity_or_exact_canonical_row(self):
        def scenario(old, independent):
            query(f'TRUNCATE {SCHEMA}.modules')
            query(f"INSERT INTO {SCHEMA}.modules VALUES ('M','P',NULL,NULL)")
            events = []
            sql = []
            def capture(execute, statement, params, many, context):
                sql.append((statement, params))
                return execute(statement, params, many, context)
            with content_scope(old, events, {'authoring_table_name': Mock(return_value=f'{SCHEMA}.modules')}, atomic=False), \
                    composition_fixture(learning_storage, 'course', side_effect=recording(events, 'course', {'id': 'C'} if independent else None)), \
                    connection.execute_wrapper(capture), transaction.atomic():
                views.lock_module_structure_row(' M ')
            return events, [(s, p) for s, p in sql if 'for update' in s.lower()]
        for independent in (False, True):
            events, locks = self.compare(lambda old: scenario(old, independent))
            self.assertEqual(events, [('course', ('M',), {'lock': True})])
            self.assertEqual(len(locks), 0 if independent else 1)

    def mapping_patch(self, old, missing=False):
        query(f'TRUNCATE {SCHEMA}.mappings')
        query(f"INSERT INTO {SCHEMA}.mappings VALUES ('K','C','M','K1','profile','P',10)")
        events = []
        def read(table, where, params, *args):
            if table == views.AUTHORING_COMPONENTS_TABLE:
                return [{'id': 'C', 'module_catalogue_id': 'M', 'week_id': 'W'}]
            if table == views.AUTHORING_MODULES_TABLE:
                return [{'module_catalogue_id': 'M'}]
            return query(f'SELECT * FROM {SCHEMA}.mappings WHERE {where}', params)
        def store(component, items, **kwargs):
            self.assertTrue(connection.in_atomic_block)
            # Simulate a normalization identity mismatch: the write happened,
            # but its requested identity cannot be read back. No fake SELECT.
            query(f'UPDATE {SCHEMA}.mappings SET weight=%s, id=%s WHERE id=%s',
                  [items[0]['weight'], 'CHANGED' if missing else 'K', 'K'])
        values = {'authoring_fetch_all': Mock(side_effect=read),
                  'active_mapping_rows': Mock(side_effect=lambda rows: rows),
                  'component_ksb_mappings_from_row': Mock(side_effect=lambda component, rows: [{'id': r['id'], 'code': r['ksb_code'], 'weight': r['weight']} for r in rows]),
                  'validate_ksb_mapping_payload': Mock(return_value=[]),
                  'source_payload_from_mapping': Mock(return_value=('profile', 'P')),
                  'normalise_component_ksb_mappings': Mock(side_effect=lambda module, items, **kwargs: (items, [])),
                  'store_component_ksb_mappings': Mock(side_effect=store)}
        with content_scope(old, events, values, atomic=False):
            result = response_value(views._curriculum_ksb_mapping_detail(request('PATCH', {'weight': 20}), 'K'))
        return result, query(f'SELECT id,weight FROM {SCHEMA}.mappings'), events

    def test_successful_mapping_patch_keeps_original_payload_and_commit(self):
        result, rows, events = self.compare(self.mapping_patch)
        self.assertEqual(result[0], 200)
        self.assertEqual(result[1]['mapping']['id'], 'K')
        self.assertEqual(rows[0]['weight'], 20)

    def test_missing_mapping_readback_rolls_back_instead_of_fabricating_success(self):
        before, before_rows, _ = self.mapping_patch(True, missing=True)
        self.assertEqual(before[0], 200)
        self.assertEqual(before[1], {'updated': True, 'mapping': {}})
        self.assertEqual(before_rows[0]['id'], 'CHANGED')
        after, rows, events = self.mapping_patch(False, missing=True)
        self.assertEqual(after[0], 500)
        self.assertNotIn('updated', after[1])
        self.assertEqual(rows[0]['id'], 'K')
        self.assertEqual(rows[0]['weight'], 10)
        self.assertNotIn('invalidate', [e[0] for e in events])
