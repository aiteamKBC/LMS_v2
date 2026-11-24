"""Lifecycle SQL and transaction parity on disposable synthetic PostgreSQL.

Production lifecycle bodies execute. Generic read/update ports address a small
fixture schema; revision/cache/provider capabilities are mocked deliberately.
"""
from datetime import datetime
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from django.db import connection, transaction
from curriculum_api import views
from curriculum_api.catalogue.infrastructure import lifecycle_writes, quiz_lifecycle
from curriculum_api.test_lifecycle_commands_boundary_no_db import lifecycle_scope
from curriculum_api.test_module_commands_boundary_no_db import recording, response_value
from curriculum_api.test_hierarchy_commands_boundary_no_db import FrozenClock

SCHEMA = 'phase1f_lifecycle'
TABLES = {
    'modules': 'module_catalogue_id text primary key, title text, programme_id text, programme_name text, status text, updated_at timestamp',
    'weeks': 'id text primary key, module_catalogue_id text, status text, updated_at timestamp',
    'components': 'id text primary key, module_catalogue_id text, week_id text, settings_json jsonb, status text, updated_at timestamp',
    'ksb_mappings': 'id text primary key, component_id text references phase1f_lifecycle.components(id) on delete restrict, status text, updated_at timestamp',
    'module_details': 'module_catalogue_id text primary key references phase1f_lifecycle.modules(module_catalogue_id) on delete restrict',
    'module_completion_criteria': 'module_catalogue_id text primary key references phase1f_lifecycle.modules(module_catalogue_id) on delete restrict',
    'guard_refs': 'module_catalogue_id text references phase1f_lifecycle.modules(module_catalogue_id) on delete restrict',
    'quizzes': 'id integer primary key, status text, updated_at timestamp, week_id text, module text, programme_id text, programme text',
    'quiz_course_links': 'quiz_id integer, module_catalogue_id text',
    'quiz_component_links': 'quiz_id integer, component_id text',
    'week_template_components': 'settings_json jsonb',
    'legacy': 'id text primary key, deleted_at timestamp, deleted_by text, deleted_via_parent text, updated_at timestamp',
}


def table_name(table):
    assert table in TABLES, table
    return f'"{SCHEMA}"."{table}"'


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            columns = [c[0] for c in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
    return []


def read(table, where='1 = 1', params=None, **kwargs):
    return query(f'SELECT * FROM {table_name(table)} WHERE {where}', params)


def update(table, where, params, payload, **kwargs):
    columns = list(payload)
    assignments = ', '.join('"' + c + '" = %s' for c in columns)
    return query(f'UPDATE {table_name(table)} SET {assignments} WHERE {where} RETURNING *',
                 [*[payload[c] for c in columns], *(params or [])])


class LifecycleCommandsPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        query(f'CREATE SCHEMA {SCHEMA}')
        for table, columns in TABLES.items():
            query(f'CREATE TABLE {table_name(table)} ({columns})')

    def reset(self):
        query('TRUNCATE ' + ', '.join(table_name(table) for table in TABLES))

    def ports(self, events):
        def has_column(table, column):
            return any(part.strip().split()[0] == column for part in TABLES[table].split(','))
        return {
            'table_name': table_name, 'authoring_table_name': table_name,
            'fetch_all': Mock(side_effect=query), 'authoring_fetch_all': Mock(side_effect=read),
            'execute_returning': Mock(side_effect=query), 'update_rows': Mock(side_effect=update),
            'written_rows': Mock(side_effect=lambda table, rows: rows),
            'note_live_rows': recording(events, 'live-rows'),
            'table_exists': Mock(side_effect=lambda table: table in TABLES),
            'has_column': Mock(side_effect=has_column),
            'column_names': Mock(side_effect=lambda table: [part.strip().split()[0] for part in TABLES[table].split(',')]),
            'versioning': SimpleNamespace(VERSIONED_TABLES={'weeks'}, record_deleted_rows=recording(events, 'revision')),
        }

    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def delete_scenario(self, original, *, authoring=False, rollback=False, versioned=True):
        self.reset()
        query(f"INSERT INTO {table_name('weeks')} (id,module_catalogue_id,status) VALUES ('A','M','active'),('B','OTHER','active')")
        events = []
        values = self.ports(events)
        if not versioned:
            values['versioning'].VERSIONED_TABLES = set()
        with lifecycle_scope(original, events, values, atomic=False):
            with transaction.atomic():
                result = (views.authoring_delete if authoring else views.delete_rows)('weeks', 'module_catalogue_id = %s', ['M'])
                inside = read('weeks')
                if rollback:
                    transaction.set_rollback(True)
        return result, inside, read('weeks', '1=1 ORDER BY id'), events

    def test_delete_returning_keeps_scope_revision_and_cache_order(self):
        with patch.object(lifecycle_writes, 'delete_rows', wraps=lifecycle_writes.delete_rows) as invoked:
            actual = self.delete_scenario(False)
        invoked.assert_called_once()
        self.assertEqual(actual, self.delete_scenario(True))
        self.assertEqual([r['id'] for r in actual[0]], ['A'])
        self.assertEqual([r['id'] for r in actual[2]], ['B'])
        self.assertEqual([e[0] for e in actual[3]], ['revision', 'live-rows'])

    def test_authoring_delete_versioned_and_unversioned(self):
        for versioned in (False, True):
            with self.subTest(versioned=versioned):
                result = self.compare(lambda old: self.delete_scenario(old, authoring=True, versioned=versioned))
                self.assertIsNone(result[0])
                self.assertEqual([r['id'] for r in result[2]], ['B'])
                self.assertEqual(len(result[3]), 2 if versioned else 0)

    def test_deletes_participate_in_callers_rollback(self):
        for authoring in (False, True):
            result = self.compare(lambda old: self.delete_scenario(old, authoring=authoring, rollback=True))
            self.assertEqual([r['id'] for r in result[2]], ['A', 'B'])

    def test_normalized_archive_does_not_rearchive_inactive_or_other_rows(self):
        def scenario(original):
            self.reset()
            query(f"INSERT INTO {table_name('weeks')} (id,module_catalogue_id,status) VALUES ('A','M','active'),('B','M','inactive'),('C','OTHER','active')")
            events = []
            with lifecycle_scope(original, events, self.ports(events), atomic=False), patch.object(views.archive_state, 'datetime', FrozenClock):
                with transaction.atomic():
                    result = views.soft_delete_rows('weeks', 'module_catalogue_id = %s', ['M'], via_parent='M', deleted_by='module-delete')
            return result, read('weeks', '1=1 ORDER BY id'), events
        result, rows, events = self.compare(scenario)
        self.assertEqual([r['id'] for r in result], ['A'])
        self.assertEqual([r['status'] for r in rows], ['inactive', 'inactive', 'active'])

    def test_legacy_restore_keeps_other_cascades_and_earlier_archives(self):
        def scenario(original):
            self.reset()
            query(f"INSERT INTO {table_name('legacy')} (id,deleted_at,deleted_by,deleted_via_parent) VALUES ('A','2026-01-02','module-delete','M'),('B','2026-01-01','module-delete','M'),('C','2026-01-02','component-delete',NULL)")
            events = []
            with lifecycle_scope(original, events, self.ports(events), atomic=False):
                result = views.restore_rows_via_parent('legacy', 'M', (datetime(2026, 1, 2), datetime(2026, 1, 3)))
            return result, read('legacy', '1=1 ORDER BY id')
        result, rows = self.compare(scenario)
        self.assertEqual([r['id'] for r in result], ['A'])
        self.assertIsNone(rows[0]['deleted_at'])
        self.assertIsNotNone(rows[1]['deleted_at'])
        self.assertIsNotNone(rows[2]['deleted_at'])

    def quiz_scenario(self, original, *, apply=True):
        self.reset()
        query(f"INSERT INTO {table_name('modules')} (module_catalogue_id,title,programme_id,status) VALUES ('M','Synthetic','P','active'),('OTHER','Elsewhere','P','active')")
        query(f"INSERT INTO {table_name('components')} (id,module_catalogue_id,settings_json,status) VALUES ('A','M','{{\"linkedQuizId\":17}}','active'),('B','OTHER','{{\"linkedQuizId\":18}}','active')")
        query(f"INSERT INTO {table_name('quizzes')} (id,status,module,programme_id) VALUES (17,'published',NULL,NULL),(18,'published',NULL,NULL),(19,'published',NULL,NULL),(20,'trash',NULL,NULL),(21,'published','Synthetic','P'),(22,'published','Synthetic','OTHER'),(23,'published',NULL,NULL)")
        query(f"INSERT INTO {table_name('quiz_course_links')} VALUES (17,'M'),(18,'M'),(19,'M'),(19,'OTHER'),(20,'M'),(23,'M')")
        query(f"INSERT INTO {table_name('week_template_components')} VALUES ('{{\"linkedQuizId\":23}}')")
        events = []
        with lifecycle_scope(original, events, self.ports(events), atomic=False):
            result = views.archive_module_child_quizzes('M', apply=apply)
        return result, [(r['id'], r['status']) for r in read('quizzes', '1=1 ORDER BY id')]

    def test_quiz_archive_preserves_shared_links_templates_and_programme_scope(self):
        with patch.object(quiz_lifecycle, 'archive_module_child_quizzes', wraps=quiz_lifecycle.archive_module_child_quizzes) as invoked:
            result = self.quiz_scenario(False)
        invoked.assert_called_once()
        self.assertEqual(result, self.quiz_scenario(True))
        self.assertEqual(result[0], [17, 21])
        self.assertEqual(dict(result[1]), {17: 'trash', 18: 'published', 19: 'published', 20: 'trash', 21: 'trash', 22: 'published', 23: 'published'})

    def test_quiz_preview_returns_same_ids_without_updates(self):
        result = self.compare(lambda old: self.quiz_scenario(old, apply=False))
        self.assertEqual(result[0], [17, 21])
        self.assertEqual(dict(result[1])[17], 'published')
        self.assertEqual(dict(result[1])[21], 'published')

    def test_frozen_normalized_ksb_delete_failure_baseline_is_retained(self):
        # Keep the original 42703 evidence executable after the narrow fix.
        def scenario(original):
            self.reset()
            query(f"INSERT INTO {table_name('modules')} (module_catalogue_id,status) VALUES ('M','inactive')")
            events, diagnostics = [], []
            values = self.ports(events)
            def execute(sql, params=None):
                try:
                    return query(sql, params)
                except Exception as exc:
                    diagnostics.append(getattr(exc.__cause__, 'sqlstate', None))
                    raise
            values.update(execute_returning=Mock(side_effect=execute),
                          module_teams_calendar_block_response=Mock(return_value=None),
                          permanent_delete_reference_refusal=Mock(return_value=None))
            with lifecycle_scope(original, events, values, atomic=False):
                result = response_value(views.permanent_module_delete_response({'module_catalogue_id': 'M', 'status': 'inactive'}))
            return result, read('modules'), diagnostics
        result, rows, diagnostics = scenario(True)
        self.assertEqual(result[0], 409)
        self.assertEqual(result[1]['reason'], 'module-delete-restricted')
        self.assertEqual(diagnostics, ['42703'])
        self.assertEqual([r['module_catalogue_id'] for r in rows], ['M'])

    def module_delete(self, *, restricted=False, outer_rollback=False, blocked=False):
        self.reset()
        for module in ('M', 'OTHER'):
            query(f"INSERT INTO {table_name('modules')} (module_catalogue_id,status) VALUES (%s,'inactive')", [module])
            query(f"INSERT INTO {table_name('weeks')} (id,module_catalogue_id,status) VALUES (%s,%s,'inactive')", ['W-' + module, module])
            query(f"INSERT INTO {table_name('components')} (id,module_catalogue_id,week_id,status) VALUES (%s,%s,%s,'inactive')", ['C-' + module, module, 'W-' + module])
            query(f"INSERT INTO {table_name('ksb_mappings')} (id,component_id,status) VALUES (%s,%s,'inactive')", ['K-' + module, 'C-' + module])
            for table in ('module_details', 'module_completion_criteria'):
                query(f'INSERT INTO {table_name(table)} VALUES (%s)', [module])
        if restricted:
            query(f"INSERT INTO {table_name('guard_refs')} VALUES ('M')")
        events = []
        values = self.ports(events)
        values.update(module_teams_calendar_block_response=Mock(return_value=None),
                      permanent_delete_reference_refusal=Mock(return_value=views.json_error('referenced', status=409) if blocked else None))
        with lifecycle_scope(False, events, values, atomic=False):
            with transaction.atomic():
                result = response_value(views.permanent_module_delete_response({'module_catalogue_id': 'M', 'status': 'inactive'}))
                if outer_rollback:
                    transaction.set_rollback(True)
        remaining = {table: read(table, '1=1 ORDER BY 1') for table in
                     ('modules', 'weeks', 'components', 'ksb_mappings', 'module_details', 'module_completion_criteria')}
        return result, remaining, events

    def test_normalized_module_delete_scopes_mappings_through_components(self):
        result, remaining, events = self.module_delete()
        self.assertEqual(result[0], 200)
        self.assertTrue(result[1]['deleted'])
        self.assertEqual(result[1]['removed'], {table: 1 for table in remaining})
        self.assertEqual([r['id'] for r in remaining['ksb_mappings']], ['K-OTHER'])
        self.assertEqual([r['module_catalogue_id'] for r in remaining['modules']], ['OTHER'])
        self.assertTrue(all(len(rows) == 1 for rows in remaining.values()))

    def test_late_foreign_key_refusal_rolls_back_every_child_delete(self):
        result, remaining, events = self.module_delete(restricted=True)
        self.assertEqual(result[0], 409)
        self.assertEqual(result[1]['reason'], 'module-delete-restricted')
        self.assertTrue(all(len(rows) == 2 for rows in remaining.values()))
        self.assertNotIn('invalidate', [e[0] for e in events])

    def test_fixed_delete_preserves_outer_rollback_and_reference_refusal(self):
        for kwargs, status in (({'outer_rollback': True}, 200), ({'blocked': True}, 409)):
            with self.subTest(kwargs=kwargs):
                result, remaining, events = self.module_delete(**kwargs)
                self.assertEqual(result[0], status)
                self.assertTrue(all(len(rows) == 2 for rows in remaining.values()))
