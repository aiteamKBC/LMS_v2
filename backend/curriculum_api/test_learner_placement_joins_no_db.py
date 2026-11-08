"""Run with PYTHONPATH=backend python -m unittest curriculum_api.test_learner_placement_joins_no_db.

Capture the production query and execute its joins using SELECT-only SQLite
VALUES fixtures. No tables, records, Django startup hooks or external DB calls.
Only PostgreSQL's empty array literal is adapted; joins and status SQL are intact.
"""
import sqlite3
import sys
import unittest
from collections import Counter
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import curriculum_api
from . import learner_status_counts as counts


class PlacementJoinTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.addCleanup(self.db.close)
        self.db.execute('PRAGMA query_only = ON')
        self.db.create_function('btrim', 1, lambda value: value.strip() if value is not None else None)
        self.labels = ('Programme', 'Intake', 'Group')
        self.columns = {'id', 'programme_id', 'cohort_id', 'group_id', 'lifecycle_status', 'programme_status', 'learning_plan'}
        self.sql = ''
        self.views = ModuleType('curriculum_api.views')
        self.views.connection = SimpleNamespace(vendor='postgresql', cursor=lambda: self.cursor())
        self.views.learner_schema_table_exists = lambda table: table == 'learners'
        self.views.learner_schema_columns = lambda table: self.columns
        self.views.scope_programme_identifier = lambda scope: scope.get('programmeId', '')
        self.views.normalise = lambda value: str(value or '').strip().lower()
        self.enterContext(patch.dict(sys.modules, {'curriculum_api.views': self.views}))
        self.enterContext(patch.object(curriculum_api, 'views', self.views, create=True))

    def cursor(self):
        owner = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def execute(self, sql, params):
                owner.sql = sql
                owner.assertEqual(params, [])
                # CTE rows include NULL references, dangling IDs, duplicate
                # labels on different IDs, and two learners in one placement.
                fixtures = '''WITH
                    learners(id, programme_id, cohort_id, group_id, lifecycle_status, programme_status) AS
                    (VALUES (1,'P1','C1','G1',' Active ','withdrawn'),
                            (2,'P1','C1','G1','','Withdrawn'),
                            (3,NULL,NULL,NULL,NULL,NULL),
                            (4,'missing','missing','missing','on_break','active'),
                            (5,'P2','C2','G2','completed','active')),
                    programmes(programme_id, name) AS (VALUES ('P1',?),('P2',?)),
                    cohorts(cohort_id, cohort_name) AS (VALUES ('C1',?),('C2',?)),
                    groups(group_id, group_name) AS (VALUES ('G1',?),('G2',?))
                '''
                adapted = sql.replace('"Learner"."learners"', 'learners')
                for table in ('programmes', 'cohorts', 'groups'):
                    adapted = adapted.replace('curriculum.' + table, table)
                adapted = adapted.replace('ARRAY[]::text[]', 'NULL')
                values = [label for label in owner.labels for _ in range(2)]
                self.result = owner.db.execute(fixtures + adapted, values)
                self.description = self.result.description

            def fetchall(self):
                return self.result.fetchall()

        return Cursor()

    def read(self):
        return counts.learner_facts(set())

    def test_authoritative_renames_are_visible_and_ids_never_change(self):
        before = self.read()
        self.labels = ('Renamed programme', 'Renamed cohort', 'Renamed group')
        after = self.read()
        ids = lambda rows: [(r['id'], r['programme_id'], r['cohort_id'], r['group_id']) for r in rows]
        self.assertEqual(ids(before), ids(after))
        self.assertEqual(tuple(after[0][key] for key in ('programme', 'cohort', 'group_name')), self.labels)
        self.assertNotEqual(before[0]['programme'], after[0]['programme'])

    def test_null_and_missing_relationships_keep_learners_with_null_names(self):
        rows = {row['id']: row for row in self.read()}
        self.assertEqual(set(rows), {1, 2, 3, 4, 5})
        for identifier in (3, 4):
            self.assertEqual([rows[identifier][key] for key in ('programme', 'cohort', 'group_name')], [None] * 3)
        self.assertEqual(rows[4]['programme_id'], 'missing')

    def test_shared_placement_and_duplicate_labels_do_not_duplicate_learners(self):
        rows = self.read()
        self.assertEqual(len(rows), 5)
        self.assertEqual(len({row['id'] for row in rows}), 5)
        targets = {'P1': {'found': True, 'programmeId': 'P1'},
                   'G1': {'found': True, 'programmeId': 'P1', 'cohortId': 'C1', 'groupId': 'G1'}}
        result = counts.counts_for_lineages(targets, rows, {})
        self.assertEqual(result['P1'], {'total': 2, 'statuses': {'active': 1, 'withdrawn': 1}})
        self.assertEqual(result['P1'], result['G1'])

    def test_status_precedence_and_totals_are_unchanged_by_labels(self):
        rows = self.read()
        expected = Counter({'active': 1, 'withdrawn': 1, 'unknown': 1, 'on break': 1, 'completed': 1})
        self.assertEqual(Counter(counts.status_key(row['status']) for row in rows), expected)
        self.labels = (None, None, None)
        self.assertEqual(Counter(counts.status_key(row['status']) for row in self.read()), expected)

    def test_join_sql_never_reads_legacy_learner_name_columns(self):
        # Even on a legacy-shaped schema, names must come from FK targets.
        self.columns.update({'programme', 'cohort', 'group_name'})
        self.read()
        for alias, table, key in (('placement_programme', 'programmes', 'programme_id'),
                                  ('placement_cohort', 'cohorts', 'cohort_id'),
                                  ('placement_group', 'groups', 'group_id')):
            self.assertIn(f'LEFT JOIN curriculum.{table} {alias} ON {alias}.{key} = p.{key}', self.sql)
        for field in ('programme', 'cohort', 'group_name'):
            self.assertNotRegex(self.sql, rf'\bp\.{field}\b')
        self.assertNotIn('WHERE', self.sql.upper())


if __name__ == '__main__':
    unittest.main()
