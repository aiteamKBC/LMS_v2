"""Home source reuse must preserve the former summary, not just its shape."""
import json
from collections import Counter
from contextlib import ExitStack
from unittest.mock import patch

from django.test import SimpleTestCase

from . import home_summary, views


def previous_summary(visibility):
    with views.curriculum_read_scope():
        rows = views.get_curriculum_rows(compact=True)
        overview = views.build_curriculum_payload_from_rows(rows, visibility, compact=True, home_summary=True)
        modules = views.enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        programmes = views.enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True,
            include_archived=visibility == 'all', include_structure_counts=False,
        )
        return home_summary.project_home_summary(overview, programmes)


class HomeSourceTests(SimpleTestCase):
    def setUp(self):
        self.modules = [
            {'module_catalogue_id': 'MOD-A', 'title': 'First', 'programme_id': 'P1',
             'programme_name': 'Alpha', 'cohort_id': 'C1', 'group_id': 'G1',
             'sessions_number': 0, 'status': 'published', 'tutor_name': 'Tutor'},
            {'module_catalogue_id': 'MOD-B', 'title': 'Second', 'programme_id': 'P1',
             'programme_name': 'Alpha', 'cohort_id': 'C1', 'group_id': 'missing-group',
             'sessions_number': None, 'status': 'draft', 'tutor_name': ''},
            {'module_catalogue_id': 'MOD-C', 'title': 'Unused', 'programme_id': 'P1',
             'programme_name': 'Alpha', 'sessions_number': None, 'status': 'draft'},
            {'module_catalogue_id': 'MOD-D', 'title': 'Archived', 'programme_id': 'P2',
             'programme_name': 'Archived programme', 'cohort_id': 'C2', 'group_id': 'G2',
             'sessions_number': 3, 'status': 'archived'},
            {'module_catalogue_id': 'MOD-E', 'title': 'Deleted parent', 'programme_id': 'P1',
             'programme_name': 'Alpha', 'cohort_id': 'C1', 'group_id': 'G1',
             'sessions_number': 4, 'status': 'draft', 'is_programme_deleted': True},
        ]
        self.groups = [
            {'group_id': 'G1', 'group_name': 'Group', 'cohort_id': 'C1', 'cohort_name': 'Cohort',
             'programme_id': 'P1', 'programme_name': 'Alpha', 'coach_name': 'Coach'},
            {'group_id': 'G2', 'group_name': 'Archived', 'cohort_id': 'C2',
             'programme_id': 'P2', 'programme_name': 'Archived programme', 'status': 'archived'},
        ]
        self.cohorts = [
            {'cohort_id': 'C1', 'cohort_name': 'Cohort', 'programme_id': 'P1',
             'programme_name': 'Alpha', 'status': 'active'},
            {'cohort_id': 'C2', 'cohort_name': 'Archived', 'programme_id': 'P2',
             'programme_name': 'Archived programme', 'status': 'archived'},
        ]
        self.programmes = [
            {'programme_id': 'P1', 'name': 'Alpha', 'status': 'published', 'is_active': True},
            {'programme_id': 'P2', 'name': 'Archived programme', 'status': 'archived', 'is_archived': True},
            {'programme_id': 'P3', 'name': 'Empty', 'status': 'published', 'is_active': True},
        ]
        self.weeks = [
            {'id': 'W1', 'module_catalogue_id': 'MOD-C', 'title': 'Repeated', 'week_number': 1},
            {'id': 'W2', 'module_catalogue_id': 'MOD-C', 'title': 'Repeated', 'week_number': 2},
            {'id': 'W3', 'module_catalogue_id': 'MOD-C', 'title': '', 'week_number': 3},
            {'id': 'W4', 'module_catalogue_id': 'MOD-B', 'title': 'Zero stays zero', 'week_number': 1},
        ]
        self.calls = []
        tables = {
            views.AUTHORING_MODULES_TABLE: self.modules, views.GROUPS_TABLE: self.groups,
            views.COHORT_AUTHORING_DETAILS_TABLE: self.cohorts, views.AUTHORING_WEEKS_TABLE: self.weeks,
        }

        def fetch(table, where_sql='', params=None, order_sql='', **kwargs):
            self.calls.append((table, kwargs))
            rows = tables.get(table, [])
            if where_sql.startswith('group_id in'):
                return [row for row in rows if row.get('group_id') in params]
            if kwargs.get('columns'):
                return [{key: value for key, value in row.items() if key in kwargs['columns']} for row in rows]
            return rows

        stack = self.enterContext(ExitStack())
        for patcher in (
            patch.object(views, 'authoring_fetch_all', side_effect=fetch),
            patch.object(views, 'get_program_config_rows', return_value=self.programmes),
            patch.object(views, 'get_ksb_profile_rows', return_value=[]),
            patch.object(views, 'table_exists', return_value=False),
            patch.object(views, 'get_holiday_rows_safe', return_value=[]),
            patch.object(views, 'authoring_module_content_counts', return_value=({}, {})),
        ):
            stack.enter_context(patcher)

    def test_operational_and_all_match_previous_summary_with_archives_and_missing_groups(self):
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                expected = previous_summary(visibility)
                actual = home_summary.build_home_summary(visibility)
                self.assertEqual(actual, expected)
                self.assertGreater(actual['stats']['programmes'], 0)
                self.assertGreater(actual['stats']['groups'], 0)

    def test_unknown_programme_names_retain_full_enrichment_and_module_only_programmes(self):
        self.modules.append({'module_catalogue_id': 'MOD-F', 'title': 'Orphan',
                             'programme_id': 'P4', 'programme_name': 'Module only', 'status': 'draft'})
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                expected = previous_summary(visibility)
                actual = home_summary.build_home_summary(visibility)
                self.assertEqual(actual, expected)
                self.assertIn('P4', [item['programme']['id'] for item in actual['programmeFocus']])

    def test_known_programmes_skip_content_counts_holidays_and_repeated_table_reads(self):
        # The guard remains conservative about archived names too: include the
        # programme in the visible list to exercise the common fast path.
        self.programmes[1].update(status='published', is_archived=False, is_active=True)
        with patch.object(views, 'enrich_modules_with_authoring', side_effect=AssertionError('Unused content read')), \
             patch.object(views, 'get_holiday_rows_safe', side_effect=AssertionError('Unused holiday read')):
            result = home_summary.build_home_summary('operational')
        self.assertGreater(result['stats']['programmes'], 0)
        self.assertEqual(Counter(table for table, _ in self.calls), {
            views.AUTHORING_MODULES_TABLE: 1, views.GROUPS_TABLE: 1, views.COHORT_AUTHORING_DETAILS_TABLE: 1,
        })

    def test_all_visibility_preserves_distinct_title_fallback_for_unused_modules(self):
        rows, _ = home_summary.home_source_rows('all')
        unused = next(row for row in rows['modules'] if row['Module ID'] == 'MOD-C')
        self.assertEqual(unused['Number of sessions'], 2)
        week_calls = [kwargs for table, kwargs in self.calls if table == views.AUTHORING_WEEKS_TABLE]
        self.assertEqual(week_calls, [{'columns': ('module_catalogue_id', 'display_order', 'week_number', 'title')}])

    def test_legacy_catalogue_ksb_codes_are_kept(self):
        legacy = [{'Module ID': 'MOD-A', 'Module_name': 'First', 'session_ksb_json': '["K1"]'}]
        with patch.object(views, 'table_exists', return_value=True), \
             patch.object(views, 'get_module_rows', return_value=legacy):
            self.assertEqual(home_summary.build_home_summary('operational'), previous_summary('operational'))
            rows, _ = home_summary.home_source_rows('operational')
        self.assertEqual(rows['modules'], legacy)

    def test_empty_provided_sources_do_not_trigger_fallback_database_reads(self):
        with patch.object(views, 'authoring_fetch_all', side_effect=AssertionError('Unexpected read')):
            self.assertEqual(views.authoring_modules_as_training_rows(module_rows=[], group_rows=[], cohort_rows=[]), [])
            self.assertEqual(views.authoring_modules_as_catalogue_rows(module_rows=[], week_rows=[]), [])
            self.assertEqual(views.build_cohorts_and_groups(
                include_learner_counts=False, source={'modules': [], 'cohorts': [], 'groups': []},
            ), ([], []))

    def test_source_failure_is_not_reported_as_an_empty_success(self):
        with patch.object(views, 'authoring_fetch_all', side_effect=RuntimeError('Source unavailable')):
            with self.assertRaisesMessage(RuntimeError, 'Source unavailable'):
                home_summary.build_home_summary('operational')

    def test_explicit_archive_and_parent_deletion_survive_narrow_projection(self):
        self.modules[0]['is_archived'] = True
        self.groups[0]['deleted_at'] = '2026-10-01'
        self.cohorts[0]['is_deleted'] = True
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                self.assertEqual(home_summary.build_home_summary(visibility), previous_summary(visibility))

    def test_postgres_batches_relationship_tables_and_binds_column_allowlists(self):
        relationship_rows = {'modules': self.modules, 'groups': self.groups, 'cohorts': self.cohorts,
                             'program_configs': self.programmes, 'ksb_profiles': []}
        with patch.object(views, 'connection', vendor='postgresql'), \
             patch.object(views, 'ensure_module_authoring_tables') as ensure, \
             patch.object(views, 'fetch_all', return_value=[relationship_rows]) as fetch:
            self.assertEqual(home_summary.home_relationship_rows(), relationship_rows)
        ensure.assert_called_once()
        fetch.assert_called_once()
        sql, params = fetch.call_args.args
        self.assertTrue(sql.startswith('select '))
        self.assertEqual(sql.count('jsonb_agg'), 4)
        self.assertEqual(sql.count('key = any(%s)'), 3)
        self.assertIn('"curriculum"."modules"', sql)
        self.assertIn('"curriculum"."groups"', sql)
        self.assertIn('"curriculum"."cohorts"', sql)
        self.assertIn('is_archived', params[0])
        self.assertIn('deleted_at', params[0])
        self.assertNotIn('cover_image_url', params[0])
        self.assertNotIn('selected_holidays', params[2])

    def test_postgres_source_error_propagates(self):
        with patch.object(views, 'connection', vendor='postgresql'), \
             patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'fetch_all', side_effect=RuntimeError('Unavailable')):
            with self.assertRaisesMessage(RuntimeError, 'Unavailable'):
                home_summary.home_relationship_rows()

    def test_postgres_raw_json_is_decoded_and_malformed_json_is_not_hidden(self):
        source = {'modules': self.modules, 'groups': self.groups, 'cohorts': self.cohorts,
                  'program_configs': self.programmes, 'ksb_profiles': []}
        with patch.object(views, 'connection', vendor='postgresql'), \
             patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'fetch_all', return_value=[{key: json.dumps(value) for key, value in source.items()}]) as fetch:
            self.assertEqual(home_summary.home_relationship_rows(), source)
            fetch.return_value = [{'modules': 'invalid'}]
            with self.assertRaises(json.JSONDecodeError):
                home_summary.home_relationship_rows()
