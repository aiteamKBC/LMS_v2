"""Real grouped SQL over synthetic in-memory data; no application database."""
import sqlite3
from contextlib import ExitStack
from unittest.mock import patch

from django.test import SimpleTestCase

from . import catalogue_summary_reads, views


class GroupedCatalogueTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            create table components (
                id text, module_catalogue_id text, week_id text, type text,
                title text, expected_otjh real, deleted_at text,
                is_programme_deleted boolean, library_state text
            );
            create table ksb_mappings (
                module_catalogue_id text, ksb_code text, deleted_at text,
                is_programme_deleted boolean, is_deleted boolean,
                isDeleted boolean, isProgrammeDeleted boolean
            );
        ''')
        self.db.executemany('insert into components values (?,?,?,?,?,?,?,?,?)', [
            ('C1', 'MOD-ONE', 'W1', 'reading', 'Body one', .125, None, False, ''),
            ('C2', 'MOD-ONE', 'W1', 'reading', 'Body two', .125, None, False, ''),
            ('C3', 'MOD-ONE', 'W1', 'live_session', 'Repeated', .25, None, False, ''),
            ('C4', 'MOD-ONE', 'W1', 'live_session', 'Repeated', .25, None, False, ''),
            ('C5', 'MOD-ONE', 'W2', 'live-session', 'Other', None, None, False, ''),
            ('C6', 'MOD-ONE', 'missing', 'quiz', 'Quiz', -.5, None, False, ''),
            ('C7', 'MOD-ONE', 'W2', 'quiz', 'Deleted', 99, '2026-01-01', False, ''),
            ('C8', 'MOD-ONE', 'W2', 'reading', 'Library', 99, None, False, ' library '),
            ('C9', 'MOD-ONE', 'W2', 'workplace-evidence', 'Retired', 99, None, False, ''),
            ('C10', 'MOD-ONE', 'W2', 'quiz', 'Parent deleted', 99, None, True, ''),
            ('C11', 'MOD-TWO', 'W3', 'quiz', 'Other module', .5, None, False, ''),
        ])
        self.db.executemany('insert into ksb_mappings values (?,?,?,?,?,?,?)', [
            ('MOD-ONE', 'K1', None, False, False, False, False),
            ('MOD-ONE', 'K1', None, False, False, False, False),
            ('MOD-ONE', ' K1 ', None, False, False, False, False),
            ('MOD-ONE', 'S1', None, False, True, False, False),
            ('MOD-ONE', 'S2', None, False, False, True, False),
            ('MOD-ONE', 'S3', None, False, False, False, True),
            ('MOD-ONE', '', None, False, False, False, False),
            ('MOD-TWO', 'B1', None, False, False, False, False),
        ])
        self.modules = [
            {'module_catalogue_id': 'MOD-ONE', 'title': 'One', 'programme_name': 'Alpha',
             'status': 'published', 'group_id': 'G1', 'weeks_number': 2, 'sessions_number': 3,
             'session_week_day': 'Monday,Thursday', 'description': 'Keep this description'},
            {'module_catalogue_id': 'MOD-TWO', 'title': 'Two', 'programme_name': 'Beta', 'weeks_number': 1},
        ]
        self.weeks = [
            {'id': 'W1', 'module_catalogue_id': 'MOD-ONE', 'week_number': 1},
            {'id': 'W2', 'module_catalogue_id': 'MOD-ONE', 'week_number': 2},
            {'id': 'W3', 'module_catalogue_id': 'MOD-TWO', 'week_number': 1},
        ]
        self.sql_calls = []
        def sql_rows(sql, params=None):
            self.sql_calls.append(sql)
            return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params or [])]
        def fetch(table, where_sql='', params=None, order_sql='', **kwargs):
            if table in ('components', 'ksb_mappings'):
                rows = sql_rows(f'select * from "{table}"' + (f' where {where_sql}' if where_sql else ''), params)
            else:
                rows = {'modules': self.modules, 'weeks': self.weeks,
                        'groups': [{'group_id': 'G1', 'coach_name': 'Coach'}]}.get(table, [])
            fields = kwargs.get('columns')
            return [{k:v for k,v in row.items() if not fields or k in fields} for row in rows]
        columns = {table: {row['name'] for row in self.db.execute(f'pragma table_info("{table}")')}
                   for table in ('components', 'ksb_mappings')}
        stack = self.enterContext(ExitStack())
        for patcher in (
            patch.object(views, 'connection', vendor='postgresql'),
            patch.object(views, 'has_column', side_effect=lambda table, col: col in columns.get(table, set())),
            patch.object(views, 'authoring_table_name', side_effect=lambda table: f'"{table}"'),
            patch.object(views, 'authoring_fetch_all', side_effect=fetch),
            patch.object(views, 'fetch_all', side_effect=sql_rows),
        ):
            stack.enter_context(patcher)

    def test_grouped_rows_preserve_full_compact_response_and_per_item_hour_rounding(self):
        expected = views.compact_module_list_rows(views.enrich_modules_with_authoring([]))
        actual = views.compact_module_list_rows(views.enrich_modules_with_authoring([], list_only=True))
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0]['lessons'], 6)
        self.assertEqual(actual[0]['quizzes'], 1)
        self.assertEqual(actual[0]['totalOtjh'], .77)  # 8+8+15+15 minutes, not round(2*.125h).
        self.assertEqual(actual[0]['sessionNamesCount'], 3)
        self.assertEqual(actual[0]['ksbCodes'], ['K1'])
        components, mappings = catalogue_summary_reads.grouped_catalogue_content_rows()
        self.assertLess(len(components), 7)
        self.assertEqual(sum(row['row_count'] for row in components), 7)
        self.assertEqual(len([row for row in mappings if row.get('ksb_code') == 'K1']), 1)

    def test_merged_delivery_keeps_assignments_distinct_titles_and_other_module_scope(self):
        delivery = [{'id': 'DELIVERY-ONE', 'moduleCatalogueId': 'MOD-ONE', 'name': 'One',
                     'programme': 'Alpha', 'assignments': 9, 'ksbCodes': ['B2'],
                     'sessionNames': ['Repeated', 'Delivery title'], 'status': 'published'}]
        expected = views.compact_module_list_rows(views.enrich_modules_with_authoring(delivery))
        actual = views.compact_module_list_rows(views.enrich_modules_with_authoring(delivery, list_only=True))
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0]['assignments'], 9)
        self.assertEqual(actual[0]['sessionNamesCount'], 3)
        self.assertEqual(actual[1]['ksbCodes'], ['B1'])

    def test_two_sessions_in_one_week_do_not_become_one_session_after_grouping(self):
        self.modules[0]['sessions_number'] = 2
        self.modules[0]['weeks_number'] = 7
        self.db.execute("delete from components where id = 'C5'")
        self.weeks.append({'id': 'W4', 'module_catalogue_id': 'MOD-ONE', 'week_number': 3})
        expected = views.authoring_catalogue_summaries()['MOD-ONE']['deliveryWeeks']
        actual = views.authoring_catalogue_summaries(list_only=True)['MOD-ONE']['deliveryWeeks']
        self.assertEqual(actual, expected)
        self.assertEqual(actual, 7)

    def test_missing_optional_legacy_flags_still_work(self):
        self.db.execute('alter table ksb_mappings drop column isDeleted')
        self.db.execute('alter table ksb_mappings drop column isProgrammeDeleted')
        columns = {table: {row['name'] for row in self.db.execute(f'pragma table_info("{table}")')}
                   for table in ('components', 'ksb_mappings')}
        with patch.object(views, 'has_column', side_effect=lambda table, col: col in columns.get(table, set())):
            self.assertEqual(
                views.compact_module_list_rows(views.enrich_modules_with_authoring([], list_only=True)),
                views.compact_module_list_rows(views.enrich_modules_with_authoring([])),
            )


class ModuleListVisibilityTests(SimpleTestCase):
    def test_programme_visibility_does_not_need_structure_or_learner_totals(self):
        rows = {key: [] for key in ('training', 'modules', 'authoring_modules', 'ksb_profiles')}
        rows['program_configs'] = [
            {'program_id': 'P1', 'name': 'Active', 'status': 'active'},
            {'program_id': 'P2', 'name': 'Archived', 'status': 'archived'},
            {'program_id': 'P3', 'name': 'Inactive', 'is_active': False},
        ]
        modules = [
            {'id': f'M{index}', 'programmeId': f'P{index}', 'status': 'published'}
            for index in (1, 2, 3)
        ]
        with patch.object(views, 'build_modules', return_value=modules), \
             patch.object(views, 'applied_standard_required_codes', return_value=None), \
             patch.object(views, 'authoring_programme_structure_counts', side_effect=AssertionError('unused totals')), \
             patch.object(views, 'active_learner_programme_counts', side_effect=AssertionError('unused learners')), \
             patch.object(views, 'attach_module_assignment_counts') as assignments:
            operational = views.build_curriculum_payload_from_rows(rows, compact=True, module_list=True)
            all_modules = views.build_curriculum_payload_from_rows(rows, 'all', compact=True, module_list=True)
        self.assertEqual([row['id'] for row in operational['modules']], ['M1'])
        self.assertEqual([row['id'] for row in all_modules['modules']], ['M1', 'M2', 'M3'])
        self.assertEqual(assignments.call_count, 2)


class TutorCatalogueReadTests(SimpleTestCase):
    def test_tutor_profiles_skip_unused_groups_and_weeks_with_same_assignments(self):
        people = [{'id': 'T1', 'name': 'Tutor', 'email': 'tutor@example.test'}]
        modules = [{'id': 'M1', 'name': 'One', 'tutor': 'Tutor', 'status': 'active'}]
        expected = views.build_staff_profiles(people, 'tutor', modules, [{'id': 'G1', 'coach': 'Tutor'}])
        with patch.object(views, 'get_staff_profile_rows', return_value=people), \
             patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'table_exists', return_value=False), \
             patch.object(views, 'authoring_modules_as_catalogue_rows', return_value=[]) as catalogue, \
             patch.object(views, 'build_modules', return_value=modules), \
             patch.object(views, 'get_module_rows', side_effect=AssertionError('unused week read')), \
             patch.object(views, 'build_cohorts_and_groups', side_effect=AssertionError('unused group read')):
            actual = views.build_staff_user_profile_collection('tutor')
        self.assertEqual(actual, expected)
        self.assertEqual(actual[0]['moduleCount'], 1)
        catalogue.assert_called_once_with(week_rows=[])

    def test_tutor_legacy_catalogue_and_coach_group_path_are_preserved(self):
        with patch.object(views, 'get_staff_profile_rows', return_value=[{'name': 'Staff'}]), \
             patch.object(views, 'get_training_rows', return_value=[]), \
             patch.object(views, 'get_program_config_rows', return_value=[]), \
             patch.object(views, 'table_exists', return_value=True), \
             patch.object(views, 'get_module_rows', return_value=[]) as catalogue, \
             patch.object(views, 'build_modules', return_value=[]), \
             patch.object(views, 'build_cohorts_and_groups', return_value=([], [{'id': 'G1', 'coach': 'Staff'}])) as groups:
            views.build_staff_user_profile_collection('tutor', 'all')
            groups.assert_not_called()
            actual = views.build_staff_user_profile_collection('coach', 'all')
        self.assertEqual(catalogue.call_count, 2)
        self.assertEqual(actual[0]['assignedGroupIds'], ['G1'])
        groups.assert_called_once_with([], [], include_archived=True)
