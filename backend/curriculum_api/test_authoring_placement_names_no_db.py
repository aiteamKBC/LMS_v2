"""Authoring reads derive the placement names the canonical schema removed.

curriculum.groups no longer stores programme_name or cohort_name, cohorts no
longer stores programme_name, and modules no longer stores programme_name,
cohort_name or group_name. authoring_select_sql() reads each through its id.

No Django database connection: the generated SQL is executed against an
in-memory sqlite3 database (curriculum tables attached as schema "curriculum").
"""
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import views

CANONICAL = {
    'groups': {'group_id', 'group_name', 'cohort_id', 'programme_id', 'notes', 'created_at', 'updated_at',
               'color', 'session_week_day', 'session_start_time', 'session_end_time', 'coach_id', 'status'},
    'cohorts': {'cohort_id', 'cohort_name', 'programme_id', 'start_date', 'end_date', 'status'},
    'modules': {'module_catalogue_id', 'title', 'programme_id', 'cohort_id', 'group_id', 'tutor_id', 'status'},
}
LEGACY = {table: columns | {'programme_name', 'cohort_name', 'group_name'} for table, columns in CANONICAL.items()}
REMOVED = ('"programme_name"', '"cohort_name"')


def select_sql(table, schema=CANONICAL, **kwargs):
    with patch.object(views, 'column_names', side_effect=lambda name: set(schema[name])):
        return views.authoring_select_sql(table, ensure_tables=False, **kwargs)


def database():
    db = sqlite3.connect(':memory:')
    db.create_function('btrim', 1, lambda value: value.strip() if isinstance(value, str) else value)
    db.execute("ATTACH DATABASE ':memory:' AS curriculum")
    db.executescript('''
        CREATE TABLE curriculum.programmes (programme_id TEXT, name TEXT);
        CREATE TABLE curriculum.cohorts (cohort_id TEXT, cohort_name TEXT, programme_id TEXT, start_date TEXT);
        CREATE TABLE curriculum.groups (group_id TEXT, group_name TEXT, cohort_id TEXT, programme_id TEXT);
        INSERT INTO curriculum.programmes VALUES ('P1','Marketing'),('P2','Accounting'),('DUP','One'),('DUP','Two');
        INSERT INTO curriculum.cohorts VALUES ('C1','October 2026','P1','2026-10-01'),('C2','April 2026','P2','2026-04-01');
        INSERT INTO curriculum.groups VALUES ('G1','Group A','C1','P1'),('G2','Group B','C2','P2');
        -- The outer authoring table (sqlite tests keep it unqualified in main).
        CREATE TABLE main.groups (group_id TEXT, group_name TEXT, cohort_id TEXT, programme_id TEXT);
        INSERT INTO main.groups VALUES
          ('g-1','Group A','C1','P1'),('g-2','Group B','C2','P2'),('g-3','Group C','C1','P1'),
          ('g-4','Blank','  ',''),('g-5','Unknown','C9','P9'),('g-6','Ambiguous','C2','DUP');
        CREATE TABLE main.cohorts (cohort_id TEXT, cohort_name TEXT, programme_id TEXT, start_date TEXT);
        INSERT INTO main.cohorts VALUES ('C1','October 2026','P1','2026-10-01'),('C2','April 2026','P2','2026-04-01');
        CREATE TABLE main.modules (module_catalogue_id TEXT, title TEXT, programme_id TEXT, cohort_id TEXT, group_id TEXT);
        INSERT INTO main.modules VALUES ('M1','Module','P1','C1','G1'),('M2','Loose','','','');
    ''')
    return db


def rows(db, sql):
    cursor = db.execute(sql)
    names = [column[0] for column in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


class DerivedPlacementNamesSqlTests(SimpleTestCase):
    def test_group_authoring_order_reads_no_removed_column(self):
        sql = select_sql('groups', order_sql=views.GROUP_ROWS_ORDER)
        select_list = sql.split(' from ', 1)[0]
        for column in REMOVED:
            self.assertNotIn(column, select_list)
        self.assertIn('AS programme_name', sql)
        self.assertIn('AS cohort_name', sql)
        self.assertIn('curriculum.programmes', sql)
        self.assertIn('placement_source.cohort_id', sql)
        self.assertTrue(sql.endswith(f'order by {views.GROUP_ROWS_ORDER}'))

    def test_cohort_order_derives_programme_name_only(self):
        sql = select_sql('cohorts', order_sql=views.COHORT_ROWS_ORDER)
        self.assertIn('AS programme_name', sql)
        self.assertNotIn('AS cohort_name', sql)       # cohorts still store cohort_name

    def test_modules_derive_all_three_names(self):
        sql = select_sql('modules')
        for name in ('programme_name', 'cohort_name', 'group_name'):
            self.assertIn(f'AS {name}', sql)

    def test_a_schema_that_still_has_the_columns_is_read_unchanged(self):
        for table in ('groups', 'cohorts', 'modules'):
            with self.subTest(table=table):
                self.assertEqual(select_sql(table, schema=LEGACY), f'select * from {views.authoring_table_name(table)}')

    def test_narrow_and_excluded_reads_derive_only_what_is_asked(self):
        narrow = select_sql('groups', columns=('group_id', 'cohort_name'))
        self.assertIn('AS cohort_name', narrow)
        self.assertNotIn('AS programme_name', narrow)
        self.assertNotIn('"cohort_name"', narrow.split(' from ', 1)[0])
        excluded = select_sql('groups', exclude_columns=('notes', 'programme_name'))
        self.assertIn('AS cohort_name', excluded)
        self.assertNotIn('AS programme_name', excluded)

    def test_other_tables_are_untouched(self):
        self.assertEqual(select_sql('weeks', schema={'weeks': {'id', 'title'}}), f'select * from {views.authoring_table_name("weeks")}')


class DerivedPlacementNamesExecutionTests(SimpleTestCase):
    def setUp(self):
        self.db = database()
        self.addCleanup(self.db.close)

    def test_group_authoring_rows_keep_keys_order_and_count(self):
        result = rows(self.db, select_sql('groups', order_sql=views.GROUP_ROWS_ORDER))
        self.assertEqual(len(result), 6)                       # no duplicated or dropped group
        by_id = {row['group_id']: row for row in result}
        self.assertEqual((by_id['g-1']['programme_name'], by_id['g-1']['cohort_name']), ('Marketing', 'October 2026'))
        self.assertEqual((by_id['g-2']['programme_name'], by_id['g-2']['cohort_name']), ('Accounting', 'April 2026'))
        # Blank or unknown ids give the removed column's '' default; an id that
        # matches two programmes is not resolved to either.
        self.assertEqual((by_id['g-4']['programme_name'], by_id['g-4']['cohort_name']), ('', ''))
        self.assertEqual((by_id['g-5']['programme_name'], by_id['g-5']['cohort_name']), ('', ''))
        self.assertEqual(by_id['g-6']['programme_name'], '')
        self.assertEqual(by_id['g-6']['cohort_name'], 'April 2026')
        # ORDER BY programme_name, cohort_name, group_name on the derived values.
        self.assertEqual([row['group_id'] for row in result], ['g-4', 'g-5', 'g-6', 'g-2', 'g-1', 'g-3'])

    def test_cohort_rows_are_ordered_by_derived_programme_name(self):
        result = rows(self.db, select_sql('cohorts', order_sql=views.COHORT_ROWS_ORDER))
        self.assertEqual([(row['cohort_id'], row['programme_name']) for row in result],
                         [('C2', 'Accounting'), ('C1', 'Marketing')])

    def test_module_rows_get_names_through_their_ids(self):
        result = {row['module_catalogue_id']: row for row in rows(self.db, select_sql('modules'))}
        self.assertEqual({key: result['M1'][key] for key in ('programme_name', 'cohort_name', 'group_name')},
                         {'programme_name': 'Marketing', 'cohort_name': 'October 2026', 'group_name': 'Group A'})
        self.assertEqual({key: result['M2'][key] for key in ('programme_name', 'cohort_name', 'group_name')},
                         {'programme_name': '', 'cohort_name': '', 'group_name': ''})


class WritersIgnoreDerivedNamesTests(SimpleTestCase):
    def test_upsert_writes_only_physical_columns(self):
        executed = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=None):
                executed.append(sql)

            def fetchall(self):
                return []

        connection = SimpleNamespace(vendor='sqlite', cursor=lambda: Cursor())
        with patch.object(views, 'column_names', return_value=set(CANONICAL['groups'])), \
             patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'connection', connection):
            try:
                views.authoring_upsert('groups', ['group_id'], {
                    'group_id': 'g-1', 'group_name': 'Group A', 'programme_name': 'Marketing', 'cohort_name': 'Oct'})
            except Exception:  # noqa: BLE001 - only the issued INSERT is under test
                pass
        self.assertTrue(executed)
        self.assertNotIn('"programme_name"', executed[0])
        self.assertNotIn('"cohort_name"', executed[0])
