"""Round trips the curriculum read paths share; synthetic rows, no database.

Each of these was a database round trip repeated on every cache rebuild of the
list and programme-detail payloads. What is pinned here is both halves of each
change: the repeat is gone, and the answer is what it was.
"""
import json
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views


def fake_connection(rows_per_execute):
    """A postgres-looking connection whose cursor answers each execute in turn."""
    answers = list(rows_per_execute)
    cursor = MagicMock()

    def execute(sql, params=None):
        cursor.current = answers.pop(0)

    cursor.execute.side_effect = execute
    cursor.fetchone.side_effect = lambda: cursor.current[0] if cursor.current else None
    cursor.fetchall.side_effect = lambda: cursor.current
    connection = MagicMock(vendor='postgresql')
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


class LearnerSchemaCacheTests(SimpleTestCase):
    def setUp(self):
        views.reset_learner_schema_cache()
        self.addCleanup(views.reset_learner_schema_cache)

    def test_a_table_that_exists_is_asked_about_once(self):
        connection, cursor = fake_connection([[(1,)]])
        with patch.object(views, 'connection', connection):
            self.assertTrue(views.learner_schema_table_exists('learners'))
            self.assertTrue(views.learner_schema_table_exists('learners'))
        self.assertEqual(cursor.execute.call_count, 1)

    def test_a_missing_table_is_asked_about_again(self):
        connection, cursor = fake_connection([[], [(1,)]])
        with patch.object(views, 'connection', connection):
            self.assertFalse(views.learner_schema_table_exists('learners'))
            self.assertTrue(views.learner_schema_table_exists('learners'))
        self.assertEqual(cursor.execute.call_count, 2)

    def test_relation_probe_is_remembered_once_true_and_raises_like_the_inline_one(self):
        connection, cursor = fake_connection([[(None,)], [('Learner.learners',)]])
        with patch.object(views, 'connection', connection):
            self.assertFalse(views.learner_relation_exists('learners'))
            self.assertTrue(views.learner_relation_exists('learners'))
            self.assertTrue(views.learner_relation_exists('learners'))
        self.assertEqual(cursor.execute.call_count, 2)
        broken = MagicMock(vendor='postgresql')
        broken.cursor.side_effect = RuntimeError('connection lost')
        views.reset_learner_schema_cache()
        with patch.object(views, 'connection', broken), self.assertRaises(RuntimeError):
            views.learner_relation_exists('learners')

    def test_columns_are_remembered_for_a_while_and_an_empty_answer_never(self):
        connection, cursor = fake_connection([[], [('programme_id',), ('cohort_id',)], [('programme_id',), ('cohort_id',), ('group_id',)]])
        clock = [1000.0]
        with patch.object(views, 'connection', connection), patch.object(views.time, 'monotonic', lambda: clock[0]):
            self.assertEqual(views.learner_schema_columns('learners'), set())
            self.assertEqual(views.learner_schema_columns('learners'), {'programme_id', 'cohort_id'})
            clock[0] += views.LEARNER_SCHEMA_COLUMNS_TTL_SECONDS - 1
            self.assertEqual(views.learner_schema_columns('learners'), {'programme_id', 'cohort_id'})
            self.assertEqual(cursor.execute.call_count, 2)
            # A column added out of band is seen once the entry expires.
            clock[0] += 2
            self.assertEqual(views.learner_schema_columns('learners'), {'programme_id', 'cohort_id', 'group_id'})
        self.assertEqual(cursor.execute.call_count, 3)

    def test_a_caller_cannot_change_the_cached_columns(self):
        connection, _cursor = fake_connection([[('programme_id',)]])
        with patch.object(views, 'connection', connection):
            first = views.learner_schema_columns('learners')
            first.add('injected')
            self.assertEqual(views.learner_schema_columns('learners'), {'programme_id'})


class LearnerProgrammeCountTests(SimpleTestCase):
    def test_counts_are_grouped_by_the_database_into_the_same_buckets(self):
        connection, cursor = fake_connection([[('Data Analyst', 'PROG-1', 3), ('Data  analyst ', '', 2), ('Leadership', '', 4), ('', '', 9)]])
        with patch.object(views, 'connection', connection), \
                patch.object(views, 'learner_relation_exists', return_value=True), \
                patch.object(views, 'learners_link_programme_by_id', return_value=True):
            by_id, by_name = views.active_learner_programme_counts()
        self.assertEqual(by_id, {'PROG-1': 3})
        self.assertEqual(by_name, {views.normalise('Data  analyst '): 2, views.normalise('Leadership'): 4})
        sql = cursor.execute.call_args.args[0]
        self.assertIn('count(*)', sql)
        self.assertIn('group by programme', sql)

    def test_no_learner_table_counts_nothing(self):
        connection, cursor = fake_connection([])
        with patch.object(views, 'connection', connection), patch.object(views, 'learner_relation_exists', return_value=False):
            self.assertEqual(views.active_learner_programme_counts(), ({}, {}))
        cursor.execute.assert_not_called()


class HolidayReadScopeTests(SimpleTestCase):
    def reads(self):
        rows = {
            'england': [{'holiday_date': '2026-12-25', 'title': 'Christmas Day'}],
            'authored': [{'start_date': '2026-08-03', 'label': 'Summer closure'}],
        }
        fetch = MagicMock(side_effect=lambda sql, *a, **k: [dict(row) for row in (rows['england'] if 'england' in sql else rows['authored'])])
        return fetch

    def test_one_read_per_scope_and_each_caller_gets_its_own_list(self):
        fetch = self.reads()
        with patch.object(views, 'fetch_all', fetch), \
                patch.object(views, 'table_exists', return_value=True), \
                patch.object(views, 'authored_holiday_table_name', return_value='holidays'):
            with views.curriculum_read_scope():
                first = views.get_holiday_rows()
                second = views.get_holiday_rows()
            self.assertEqual(fetch.call_count, 2)  # england + authored, once
            self.assertEqual(first, second)
            self.assertIsNot(first, second)
            first.append({'title': 'not shared'})
            self.assertEqual(len(second), 2)
            # Outside a scope every call reads afresh, as before.
            views.get_holiday_rows()
            views.get_holiday_rows()
        self.assertEqual(fetch.call_count, 6)

    def test_archived_and_live_calendars_are_separate_reads(self):
        fetch = self.reads()
        with patch.object(views, 'fetch_all', fetch), \
                patch.object(views, 'table_exists', return_value=True), \
                patch.object(views, 'authored_holiday_table_name', return_value='holidays'), \
                views.curriculum_read_scope():
            views.get_holiday_rows()
            views.get_holiday_rows(include_archived=True)
        self.assertEqual(fetch.call_count, 4)


class SharedWeekIndexTests(SimpleTestCase):
    def test_the_three_whole_table_week_readers_ask_for_the_same_columns(self):
        calls = []

        def record(table, where_sql='', params=None, order_sql='', **kwargs):
            calls.append((table, where_sql, params, order_sql, kwargs))
            return []

        with patch.object(views, 'authoring_fetch_all', side_effect=record), \
                patch.object(views, 'safe_authoring_module_rows', return_value=[]), \
                patch.object(views, 'authoring_module_content_counts', return_value=({}, {})):
            views.authoring_modules_as_catalogue_rows(module_rows=[])
            views.authoring_programme_structure_counts()
            views.authoring_catalogue_summaries(include_content=False)
        week_reads = [call for call in calls if call[0] == views.AUTHORING_WEEKS_TABLE]
        self.assertEqual(len(week_reads), 3)
        # Identical arguments are one entry in the read scope's memo.
        self.assertEqual(len({views._scope_memo_key((call[1], call[2], call[3], call[4])) for call in week_reads}), 1)
        self.assertEqual(week_reads[0][4], {'columns': views.WEEK_INDEX_COLUMNS})

    def test_columns_cover_everything_the_readers_use(self):
        used = {
            'id', 'module_catalogue_id', 'display_order', 'week_number', 'title',
            # active_week_rows() / programme_deleted_row() / is_library_row()
            'deleted_at', 'is_programme_deleted', 'is_deleted', 'library_state',
        }
        self.assertEqual(set(views.WEEK_INDEX_COLUMNS), used)

    def test_catalogue_titles_and_counts_are_unchanged_by_the_narrow_rows(self):
        weeks = [
            {'id': 'W2', 'module_catalogue_id': 'M1', 'display_order': 2, 'week_number': 2, 'title': ''},
            {'id': 'W1', 'module_catalogue_id': 'M1', 'display_order': 1, 'week_number': 1, 'title': 'Kick-off'},
        ]
        rows = views.authoring_modules_as_catalogue_rows(
            module_rows=[{'module_catalogue_id': 'M1', 'title': 'Planning'}], week_rows=weeks,
        )
        self.assertEqual(json.loads(rows[0]['session_names_json']), ['Kick-off', 'Week 2'])


def memo_key(call):
    table, where_sql, params, order_sql, kwargs = call
    bound = {'where_sql': where_sql, 'params': params, 'order_sql': order_sql,
             'ensure_tables': kwargs.get('ensure_tables', True), 'columns': kwargs.get('columns'),
             'exclude_columns': kwargs.get('exclude_columns')}
    return (table, views._scope_memo_key(bound))


class RecordedReads:
    """authoring_fetch_all, recorded; answers from ``tables`` by table name."""

    def __init__(self, tables):
        self.tables = tables
        self.calls = []

    def __call__(self, table, where_sql='', params=None, order_sql='', **kwargs):
        self.calls.append((table, where_sql, params, order_sql, kwargs))
        return [dict(row) for row in self.tables.get(table, [])]

    def keys(self, table):
        return {memo_key(call) for call in self.calls if call[0] == table}


class SharedParentReadTests(SimpleTestCase):
    """The shared-rows and programme builds read modules, groups and cohorts
    once each where they used to read them two to four times."""

    TABLES = {
        views.AUTHORING_MODULES_TABLE: [
            {'module_catalogue_id': 'M1', 'title': 'Planning', 'group_id': 'G1', 'cohort_id': 'C1',
             'start_date': '2026-01-05', 'end_date': '2026-03-01', 'tutor_name': 'Ada'},
        ],
        views.GROUPS_TABLE: [
            {'group_id': 'G2', 'cohort_id': 'C1', 'group_name': 'B'},
            {'group_id': 'G1', 'cohort_id': 'C1', 'group_name': 'A'},
        ],
        views.COHORT_AUTHORING_DETAILS_TABLE: [
            {'cohort_id': 'C2', 'start_date': '2026-02-01'},
            {'cohort_id': 'C1', 'start_date': '2026-01-01', 'excluded_holiday_ids': '[]'},
        ],
    }

    def run_readers(self):
        reads = RecordedReads(self.TABLES)
        with patch.object(views, 'authoring_fetch_all', side_effect=reads), \
                patch.object(views, 'serialize_group_authoring_detail', side_effect=lambda row: {'id': row['group_id']}), \
                patch.object(views, 'serialize_cohort_authoring_detail', side_effect=lambda row, holidays=None: {'id': row['cohort_id']}), \
                patch.object(views, 'get_holiday_rows', return_value=[]), \
                patch.object(views, 'get_holiday_rows_safe', return_value=[]), \
                views.curriculum_read_scope():
            views.authoring_modules_as_training_rows()
            views.authoring_modules_as_catalogue_rows(week_rows=[])
            groups = views.group_authoring_detail_rows()
            views.cohort_authoring_detail_rows()
            by_id = views.authoring_rows_by_id(views.GROUPS_TABLE, 'group_id', ['G1'], views.GROUP_ROWS_ORDER)
            holidays = views.cohort_selected_holidays_by_cohort(['C1'])
        return reads, groups, by_id, holidays

    def test_each_parent_table_is_one_memo_entry(self):
        reads, *_ = self.run_readers()
        for table in (views.AUTHORING_MODULES_TABLE, views.GROUPS_TABLE, views.COHORT_AUTHORING_DETAILS_TABLE):
            with self.subTest(table=table):
                self.assertEqual(len(reads.keys(table)), 1, reads.keys(table))

    def test_no_whole_table_module_read_ships_the_remap_report(self):
        reads, *_ = self.run_readers()
        for call in reads.calls:
            if call[0] == views.AUTHORING_MODULES_TABLE:
                self.assertEqual(call[4].get('exclude_columns'), views.MODULE_INDEX_EXCLUDED_COLUMNS)

    def test_the_answers_are_what_the_targeted_reads_gave(self):
        _reads, groups, by_id, holidays = self.run_readers()
        g1 = next(group for group in groups if group['id'] == 'G1')
        self.assertEqual(g1['tutor'], views.group_tutor_from_module_names(['Ada']))
        self.assertEqual(g1['startDate'], '2026-01-05')
        self.assertEqual(g1['endDate'], '2026-03-01')
        self.assertEqual([row['group_id'] for row in by_id], ['G1'])
        self.assertEqual(set(holidays), {'C1'})

    def test_outside_a_scope_the_lookup_is_the_targeted_read(self):
        reads = RecordedReads(self.TABLES)
        with patch.object(views, 'authoring_fetch_all', side_effect=reads):
            views.authoring_rows_by_id(views.GROUPS_TABLE, 'group_id', ['G2', 'G1', ''], views.GROUP_ROWS_ORDER)
            self.assertEqual(views.authoring_rows_by_id(views.GROUPS_TABLE, 'group_id', [''], views.GROUP_ROWS_ORDER), [])
        self.assertEqual(len(reads.calls), 1)
        table, where_sql, params, order_sql, _kwargs = reads.calls[0]
        self.assertIn('group_id', where_sql)
        self.assertEqual(sorted(params), ['G1', 'G2'])

    def test_a_failed_module_read_still_answers_the_groups(self):
        reads = RecordedReads(self.TABLES)

        def flaky(table, *args, **kwargs):
            if table == views.AUTHORING_MODULES_TABLE:
                raise RuntimeError('timeout')
            return reads(table, *args, **kwargs)

        with patch.object(views, 'authoring_fetch_all', side_effect=flaky), \
                patch.object(views, 'serialize_group_authoring_detail', side_effect=lambda row: {'id': row['group_id']}):
            groups = views.group_authoring_detail_rows()
        self.assertEqual({group['id'] for group in groups}, {'G1', 'G2'})
        self.assertEqual(groups[0]['startDate'], '')


class KsbSetsTests(SimpleTestCase):
    def get(self, query, profiles, payload=None):
        with patch.object(views, 'get_ksb_profile_rows', return_value=profiles), \
                patch.object(views, 'get_cached_payload', return_value=payload or {'schema': 'curriculum', 'ksbSets': [{'frameworkId': 'F1'}]}) as build:
            response = views.curriculum_ksb_sets(RequestFactory().get('/curriculum/ksb-sets/' + query))
        return json.loads(response.content), build

    def test_no_profiles_answers_without_building_the_overview(self):
        body, build = self.get('', [])
        self.assertEqual(body, {'schema': 'curriculum', 'count': 0, 'results': []})
        build.assert_not_called()

    def test_only_inactive_profiles_is_empty_for_the_operational_view_only(self):
        body, build = self.get('', [{'id': 1, 'is_active': False}])
        self.assertEqual(body['results'], [])
        build.assert_not_called()
        body, build = self.get('?visibility=all', [{'id': 1, 'is_active': False}])
        self.assertEqual(body['results'], [{'frameworkId': 'F1'}])
        build.assert_called_once()

    def test_active_profiles_still_read_the_sets_from_the_overview(self):
        body, build = self.get('', [{'id': 1, 'is_active': True}])
        self.assertEqual(body, {'schema': 'curriculum', 'count': 1, 'results': [{'frameworkId': 'F1'}]})
        build.assert_called_once()

