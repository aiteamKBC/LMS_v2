"""Exercise production SELECTs with synthetic CTE rows in a read-only transaction.

Uses PostgreSQL's existing composite types, but reads no learner records and
creates no tables, schemas or fixtures. No application startup or external API.
"""
import ast
from copy import deepcopy
from pathlib import Path
import sys
import unittest

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from sync_legacy_lms_identities import database_url

ROOT = Path(__file__).resolve().parents[1] / 'learner_api'


def select_sql(filename, function):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8'))
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == function)
    return next(n.args[0].value for n in ast.walk(node)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                and n.func.attr == 'execute')


TABLES = {
    'learners': '"Learner".learners',
    'identities': '"Learner".learner_external_identities',
    'memberships': '"Learner".learner_source_course_memberships',
    'courses': 'curriculum.source_courses',
    'catalogue': 'curriculum.source_activities',
    'materials': 'curriculum.source_materials',
    'activities': '"Last_audit".activities',
    'results': '"Last_audit".activity_results',
    'legacy_learners': '"Last_audit".learners',
    'legacy_aliases': '"Last_audit".learner_lms_aliases',
}


def fixture():
    return {
        'learners': [dict(id=1, aptem_id=101, email='work@example.test', full_name='Synthetic learner')],
        'identities': [dict(id=1, learner_id=1, source_system='old_lms', source_learner_id='21',
                            source_payload={'learner_email': 'work@example.test', 'record_id': 21}),
                       dict(id=2, learner_id=1, source_system='old_lms', source_learner_id='22',
                            source_payload={'source_email': 'personal@example.test', 'legacy_alias': {'is_primary': False}}),
                       dict(id=3, learner_id=2, source_system='old_lms', source_learner_id='23',
                            source_payload={'learner_email': 'another@example.test'})],
        'memberships': [dict(id=1, learner_id=1, source_course_id=10)],
        'courses': [dict(id=10, source_system='old_lms', source_course_ref='55')],
        'catalogue': [dict(id=15, source_system='old_lms', source_course_id=10,
                          source_activity_kind='material', source_activity_id='material:5', source_material_id=100)],
        'materials': [dict(material_id=100, source_system='old_lms', title='Synthetic lesson')],
        'activities': [dict(activity_id=5, title='Synthetic lesson', quiz_id=6, quiz_maximum_score=10)],
        'results': [dict(learner_id=21, group_id=55, activity_id=5, quiz_score=9, quiz_maximum_score=10,
                         quiz_answers=[{'synthetic': 'best'}], quiz_attempt_number=1, quiz_passed=True,
                         reading_viewed=False, video_completed=False, status='quiz_attempted'),
                    dict(learner_id=22, group_id=55, activity_id=5, quiz_score=70, quiz_maximum_score=100,
                         quiz_answers=[{'synthetic': 'later'}], quiz_attempt_number=2, quiz_passed=False,
                         reading_viewed=True, video_completed=True, status='completed'),
                    dict(learner_id=23, group_id=55, activity_id=5, quiz_score=100, quiz_maximum_score=100,
                         quiz_answers=[{'synthetic': 'other learner'}], status='completed')],
        'legacy_learners': [dict(learner_id=21, aptem_id=101, learner_email='work@example.test')],
        'legacy_aliases': [dict(aptem_id=101, canonical_lms_id=21, lms_learner_id=99,
                               lms_email='stale@example.test', is_primary=False)],
    }


class ReadOnlyIdentitySQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row)
        cls.conn.read_only = True
        cls.conn.execute('SET LOCAL statement_timeout=15000')
        assert cls.conn.execute('SHOW transaction_read_only').fetchone()['transaction_read_only'] == 'on'

    @classmethod
    def tearDownClass(cls):
        cls.conn.rollback()
        cls.conn.close()

    def query(self, filename, function, rows, params):
        query = select_sql(filename, function)
        ctes, values = [], []
        for alias, table in TABLES.items():
            if table not in query:
                continue
            query = query.replace(table, 'fixture_' + alias)
            ctes.append(f'fixture_{alias} AS (SELECT * FROM jsonb_populate_recordset(NULL::{table},%s::jsonb))')
            values.append(Jsonb(rows.get(alias, [])))
        return self.conn.execute('WITH ' + ','.join(ctes) + ' ' + query, values + params).fetchall()

    def material(self, rows):
        return self.query('student_activity_data.py', 'read_student_material', rows, [5, 101, 55, 'material:5'])

    def identities(self, rows, email='work@example.test'):
        return self.query('subject_source.py', 'read_learner', rows, [101, email, 101, email])

    def test_aliases_preserve_completion_and_coherent_best_attempt_once(self):
        rows = self.material(fixture())
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertTrue(row['reading_viewed'])
        self.assertTrue(row['video_completed'])
        self.assertTrue(row['quiz_passed'])
        self.assertEqual(row['status'], 'completed')
        self.assertEqual((row['quiz_score'], row['result_maximum_score'], row['quiz_attempt_number']), (9, 10, 1))
        self.assertEqual(row['quiz_answers'], [{'synthetic': 'best'}])

    def test_deleted_alias_cannot_contribute_completion(self):
        data = fixture()
        data['identities'][1]['deleted_at'] = '2026-01-01T00:00:00Z'
        self.assertFalse(self.material(data)[0]['reading_viewed'])

    def test_results_are_course_and_activity_scoped(self):
        for field, value in [('group_id', 56), ('activity_id', 6)]:
            data = fixture()
            data['results'][1][field] = value
            self.assertFalse(self.material(data)[0]['video_completed'])

    def test_unowned_course_or_ambiguous_canonical_owner_is_not_authorized(self):
        data = fixture()
        data['memberships'][0]['learner_id'] = 2
        self.assertEqual(self.material(data), [])
        data = fixture()
        data['learners'].append({**data['learners'][0], 'id': 2})
        data['memberships'].append({**data['memberships'][0], 'id': 2, 'learner_id': 2})
        # The caller rejects len(rows) != 1; never LIMIT 1 across owners.
        self.assertEqual(len(self.material(data)), 2)

    def test_canonical_identity_uses_both_saved_emails_not_stale_legacy_aliases(self):
        rows = self.identities(fixture())
        self.assertEqual(len(rows), 2)
        self.assertEqual({r['source_learner_id'] for r in rows}, {'21', '22'})
        self.assertEqual({r['is_primary'] for r in rows}, {True, False})

    def test_wrong_email_and_deleted_identity_never_fall_back_to_legacy(self):
        data = fixture()
        self.assertEqual(self.identities(data, 'wrong@example.test'), [])
        for identity in data['identities']:
            identity['deleted_at'] = '2026-01-01T00:00:00Z'
        self.assertEqual(self.identities(data), [])

    def test_legacy_only_learner_keeps_existing_fallback(self):
        data = fixture()
        data['learners'] = []
        self.assertEqual(self.identities(data)[0]['source_learner_id'], '99')


if __name__ == '__main__':
    unittest.main()
