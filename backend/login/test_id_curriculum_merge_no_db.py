"""Offline merge regression checks; SELECT-only fixtures, no app startup hooks.

Run: PYTHONPATH=backend python -m login.test_id_curriculum_merge_no_db
"""
import ast
import importlib
from pathlib import Path
import sqlite3
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

if __name__ == '__main__':
    from django.conf import settings
    settings.configure(SECRET_KEY='offline-merge', INSTALLED_APPS=[],
                       DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}})
    from django.apps import AppConfig, apps
    apps.populate([AppConfig('learner_api', importlib.import_module('learner_api'))])

from django.db.backends.base.base import BaseDatabaseWrapper
from learner_api.models import EnrolmentUser
from curriculum_api.programme_name_sql import programme_name_sql


def function(filename, name, **namespace):
    tree = ast.parse(Path(__file__).with_name(filename).read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), filename, 'exec'), namespace)
    return namespace[name]


class LookupTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(BaseDatabaseWrapper, 'connect', side_effect=AssertionError('DB I/O forbidden')))
        self.lookup = function('learner_enrolment.py', 'existing_learner_record',
                               EnrolmentUser=EnrolmentUser, normalize_email=lambda value: str(value or '').strip().lower())

    def test_lookup_filters_email_but_loads_only_consumer_fields(self):
        for kind in ('commercial', 'apprenticeship'):
            row = EnrolmentUser.from_db('default', ['id', 'learner_type'], [42, kind])
            with patch.object(EnrolmentUser, 'all_learners') as manager, \
                    patch.object(row, 'refresh_from_db', side_effect=AssertionError('Deferred field query')):
                manager.filter.return_value.only.return_value.first.return_value = row
                result = self.lookup(' Person@Example.TEST ')
                manager.filter.assert_called_once_with(email__iexact='person@example.test')
                manager.filter.return_value.only.assert_called_once_with('id', 'learner_type')
                # All current consumers use existence, pk and/or learner_type.
                self.assertIsNotNone(result)
                self.assertEqual((result.pk, result.learner_type), (42, kind))
                self.assertIn('email', result.get_deferred_fields())

    def test_empty_email_does_not_query_and_not_found_stays_none(self):
        with patch.object(EnrolmentUser, 'all_learners') as manager:
            self.assertIsNone(self.lookup('   '))
            manager.filter.assert_not_called()
            manager.filter.return_value.only.return_value.first.return_value = None
            self.assertIsNone(self.lookup('missing@example.invalid'))

    def test_real_orm_projection_excludes_email_but_keeps_email_predicate(self):
        query = EnrolmentUser.all_learners.filter(email__iexact='person@example.test').only('id', 'learner_type')
        sql, params = query.query.get_compiler(using='default').as_sql()
        selection = sql.split(' FROM ', 1)[0]
        self.assertNotIn('"Email"', selection)
        self.assertNotIn('"email"', selection)
        self.assertEqual(set(query.query.deferred_loading[0]), {'id', 'learner_type'})
        self.assertIn('person@example.test', params)
        self.assertIn('email', sql.split(' WHERE ', 1)[1].lower())


class CurriculumCountTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA query_only=ON')
        self.db.create_function('btrim', 1, lambda value: value.strip())
        self.db.row_factory = sqlite3.Row
        self.statements = []
        self.programme_name = 'Same name'
        self.fixture = '''WITH
            programmes(programme_id,name,is_archived) AS (VALUES ('P1',?),('P2',?),('P3','Archived',1)),
            cohorts(cohort_id,cohort_name,programme_id,start_date,end_date) AS
              (VALUES ('C1','Intake','P1','2026-01-01','2026-06-01'),
                      ('C2','Intake','P1','2026-02-01','2026-07-01'),
                      ('C3','Intake','P2','2026-03-01','2026-08-01')),
            modules(module_catalogue_id,programme_id) AS (VALUES ('M1','P1'),('M2','P2')),
            users(id,programme_id,cohort_id) AS (VALUES (1,'P1','C1'),(2,'P1','C2'),(3,'P2','C3'),
                                                    (4,'P1',NULL),(5,NULL,NULL),(6,'missing','missing'))
        '''.replace("('P1',?),('P2',?)", "('P1',?,0),('P2',?,0)")
        self.reader = function('platform_admin.py', 'curriculum', require_GET=lambda fn: fn,
                               require_role=lambda role: lambda fn: fn, ROLE_ADMIN='admin',
                               programme_name_sql=programme_name_sql, _optional_rows=self.read,
                               JsonResponse=lambda payload: payload, _iso=lambda value: value)
        self.adapter = self.enterContext(patch('curriculum_api.schema_compat.adapt_sql', side_effect=lambda sql: sql))

    def read(self, sql, params=None):
        self.statements.append(sql)
        adapted = sql.replace('enrolment."Created_users"', 'users').replace('curriculum.', '').replace('%s', '?')
        rows = self.db.execute(self.fixture + adapted, [self.programme_name, self.programme_name, *(params or [])])
        return None, [dict(row) for row in rows]

    def get(self, programme=''):
        return self.reader(SimpleNamespace(GET={'programme': programme}))

    def test_programme_counts_are_id_based_even_when_names_match(self):
        result = self.get()
        self.assertEqual(sorted(p['learners'] for p in result['programmes']), [1, 3])
        self.assertEqual(sorted(p['cohorts'] for p in result['programmes']), [1, 2])
        self.assertEqual([p['modules'] for p in result['programmes']], [1, 1])
        self.assertNotIn('Archived', [p['name'] for p in result['programmes']])

    def test_same_named_cohorts_remain_distinct_and_counts_do_not_multiply(self):
        cohorts = self.get('P1')['cohorts']
        self.assertEqual(len(cohorts), 2)
        self.assertEqual([c['learners'] for c in cohorts], [1, 1])
        self.assertEqual({c['startDate'] for c in cohorts}, {'2026-01-01', '2026-02-01'})

    def test_renames_preserve_counts_and_name_filter_uses_authoritative_name(self):
        before = self.get('Same name')
        self.programme_name = 'Renamed'
        after = self.get('Renamed')
        self.assertEqual([p['learners'] for p in before['programmes']], [p['learners'] for p in after['programmes']])
        self.assertEqual(len(after['cohorts']), 3)
        self.assertTrue(all(c['programme'] == 'Renamed' for c in after['cohorts']))
        self.assertEqual(self.get('Same name')['cohorts'], [])

    def test_missing_cohort_keeps_programme_count_and_bad_ids_are_not_guessed(self):
        result = self.get()
        # Four valid programme assignments include one without a cohort.
        # The two synthetic missing/invalid programme IDs match no programme;
        # they must be reported by a data audit, never assigned by a label.
        self.assertEqual(sum(p['learners'] for p in result['programmes']), 4)
        self.assertEqual(sum(c['learners'] for c in result['cohorts']), 3)

    def test_query_shape_and_response_contract_are_preserved(self):
        result = self.get('P1')
        self.assertEqual(set(result), {'available', 'error', 'programmes', 'cohorts'})
        self.assertTrue(result['available'])
        self.assertIsNone(result['error'])
        self.assertEqual(set(result['programmes'][0]), {'name', 'cohorts', 'modules', 'learners'})
        self.assertEqual(set(result['cohorts'][0]), {'name', 'programme', 'learners', 'startDate', 'endDate'})
        self.assertEqual(self.adapter.call_count, 2)
        self.assertIn('GROUP BY c.cohort_name, c.cohort_id, c.programme_id ORDER BY c.cohort_name', self.statements[1])
        for sql in self.statements:
            self.assertNotIn('to_jsonb', sql)
            self.assertNotIn('c.programme_name', sql)
            self.assertNotIn('u."Programme"', sql)
            self.assertNotIn('u."Cohort"', sql)

    def test_optional_read_error_contract_is_preserved(self):
        reader = function('platform_admin.py', 'curriculum', require_GET=lambda fn: fn,
                          require_role=lambda role: lambda fn: fn, ROLE_ADMIN='admin',
                          programme_name_sql=programme_name_sql,
                          _optional_rows=Mock(side_effect=[('unavailable', []), (None, [])]),
                          JsonResponse=lambda payload: payload, _iso=lambda value: value)
        result = reader(SimpleNamespace(GET={}))
        self.assertFalse(result['available'])
        self.assertEqual(result['error'], 'unavailable')


if __name__ == '__main__':
    unittest.main(verbosity=2)
