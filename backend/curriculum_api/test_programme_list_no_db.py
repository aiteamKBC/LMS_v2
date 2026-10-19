"""Preserve programme list values while avoiding unrelated overview reads."""
import json
from contextlib import ExitStack
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import programme_list, views


def previous_programme_list(visibility):
    with views.curriculum_read_scope():
        overview = views.build_curriculum_payload_from_rows(
            views.get_curriculum_rows(compact=True), visibility, compact=True,
        )
        modules = views.enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all', include_content=False,
        )
        return views.enrich_programmes_with_module_counts(
            overview['programmes'], modules, modules_enriched=True, include_archived=visibility == 'all',
        )


class ProgrammeListTests(SimpleTestCase):
    def setUp(self):
        self.modules = [
            {'module_catalogue_id': 'MOD-1', 'title': 'One', 'programme_id': 'PROG-1',
             'programme_name': 'Alpha', 'cohort_id': 'COHORT-1', 'group_id': 'GROUP-1',
             'sessions_number': 10, 'weeks_number': 5, 'status': 'published'},
            {'module_catalogue_id': 'MOD-2', 'title': 'Unplaced', 'programme_id': 'PROG-1',
             'programme_name': 'Alpha', 'sessions_number': 12, 'session_week_day': 'Monday,Thursday'},
        ]
        self.groups = [{'group_id': 'GROUP-1', 'group_name': 'Group', 'cohort_id': 'COHORT-1',
                        'cohort_name': 'Cohort', 'programme_id': 'PROG-1', 'programme_name': 'Alpha'}]
        self.cohorts = [{'cohort_id': 'COHORT-1', 'cohort_name': 'Cohort', 'programme_id': 'PROG-1',
                         'programme_name': 'Alpha', 'status': 'active'}]
        self.configs = [
            {'programme_id': 'PROG-1', 'name': 'Alpha', 'status': 'published', 'is_active': True,
             'description': 'Description', 'level': '4', 'color': '#123456',
             'ksb_profile_source_id': 'standard:std-one', 'required_otjh': 300, 'display_order': 2},
            {'programme_id': 'PROG-2', 'name': 'Empty', 'status': 'published', 'is_active': True},
        ]
        self.weeks = []
        self.profiles = []
        self.reads = []
        tables = {
            views.AUTHORING_MODULES_TABLE: self.modules, views.GROUPS_TABLE: self.groups,
            views.COHORT_AUTHORING_DETAILS_TABLE: self.cohorts, views.AUTHORING_WEEKS_TABLE: self.weeks,
        }

        def fetch(table, where_sql='', params=None, order_sql='', **kwargs):
            self.reads.append((table, kwargs))
            rows = tables.get(table, [])
            if where_sql.startswith('group_id in'):
                rows = [row for row in rows if row.get('group_id') in params]
            if kwargs.get('columns'):
                rows = [{key: value for key, value in row.items() if key in kwargs['columns']} for row in rows]
            return rows

        stack = self.enterContext(ExitStack())
        for patcher in (
            patch.object(views, 'authoring_fetch_all', side_effect=fetch),
            patch.object(views, 'get_program_config_rows', return_value=self.configs),
            patch.object(views, 'get_ksb_profile_rows', return_value=self.profiles),
            patch.object(views, 'table_exists', return_value=False),
            patch.object(views, 'get_holiday_rows_safe', return_value=[]),
            patch.object(views, 'authoring_module_content_counts', return_value=({}, {})),
            patch.object(views, 'attach_module_assignment_counts'),
            patch.object(views, 'active_learner_programme_counts', return_value=({'PROG-1': 4}, {'alpha': 2})),
            patch.object(views, 'standard_required_ksbs', return_value=[{'code': 'K1'}, {'code': 'S2'}]),
        ):
            stack.enter_context(patcher)

    def assert_same_list(self):
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                self.assertEqual(programme_list.build_programme_list(visibility), previous_programme_list(visibility))

    def test_cards_keep_counts_metadata_ksb_source_and_learner_ownership(self):
        self.assert_same_list()
        with patch.object(views, 'build_curriculum_payload_from_rows', side_effect=AssertionError('Unused overview')), \
             patch.object(views, 'enrich_modules_with_authoring', side_effect=AssertionError('Unused module content')):
            result = programme_list.build_programme_list('operational')
        card = result[0]
        self.assertEqual((card['modules'], card['cohorts'], card['groups'], card['weeks']), (2, 1, 1, 11))
        self.assertEqual((card['learners'], card['ksbTotal']), (6, 2))
        self.assertEqual(card['ksbProfileSourceId'], 'standard:std-one')
        self.assertEqual(result[1]['modules'], 0)

    def test_week_fallback_excludes_deleted_and_library_rows(self):
        self.weeks.extend([
            {'id': 'W1', 'module_catalogue_id': 'MOD-2'},
            {'id': 'W2', 'module_catalogue_id': 'MOD-2'},
            {'id': 'W3', 'module_catalogue_id': 'MOD-2', 'library_state': 'library'},
            {'id': 'W4', 'module_catalogue_id': 'MOD-2', 'deleted_at': '2026-10-01'},
        ])
        self.assert_same_list()
        self.assertEqual(programme_list.build_programme_list('operational')[0]['weeks'], 7)

    def test_renamed_programme_and_reused_name_do_not_double_count_children(self):
        self.configs[0]['name'] = 'Renamed'
        self.configs[1]['name'] = 'Alpha'
        self.assert_same_list()
        cards = programme_list.build_programme_list('operational')
        self.assertEqual([card['modules'] for card in cards], [2, 0])

    def test_module_only_programme_and_archived_modules_retain_reconstruction(self):
        self.modules.append({'module_catalogue_id': 'MOD-3', 'title': 'Only module',
                             'programme_id': 'PROG-3', 'programme_name': 'Module only', 'weeks_number': 3})
        self.assert_same_list()
        self.assertIn('PROG-3', [card['id'] for card in programme_list.build_programme_list('all')])
        self.modules[-1]['deleted_at'] = '2026-10-01'
        self.assert_same_list()

    def test_archived_draft_inactive_and_duplicate_config_visibility(self):
        for status, active in [('archived', True), ('draft', True), ('published', False)]:
            with self.subTest(status=status, active=active):
                self.configs[0].update(status=status, is_active=active)
                self.assert_same_list()
        self.configs.append({'programme_id': 'PROG-OLD', 'name': 'Alpha', 'status': 'archived'})
        self.assert_same_list()

    def test_parent_deletion_and_module_soft_delete_preserve_counts(self):
        self.groups[0]['is_programme_deleted'] = True
        self.modules[1]['deleted_at'] = '2026-10-01'
        self.assert_same_list()

    def test_legacy_catalogue_uses_existing_matching_without_library_or_calendar_reads(self):
        legacy = [{'Module ID': 'MOD-1', 'Module_name': 'One', 'Number of sessions': 10}]
        with patch.object(views, 'table_exists', side_effect=lambda table: table == 'Modules'), \
             patch.object(views, 'get_module_rows', return_value=legacy):
            self.assert_same_list()
            with patch.object(views, 'build_ksb_data', side_effect=AssertionError('Unused library')), \
                 patch.object(views, 'build_cohorts_and_groups', side_effect=AssertionError('Unused calendar')), \
                 patch.object(views, 'attach_module_assignment_counts', side_effect=AssertionError('Unused assignments')):
                self.assertTrue(programme_list.build_programme_list('all'))

    def test_source_failure_does_not_become_an_empty_success(self):
        with patch.object(views, 'authoring_fetch_all', side_effect=RuntimeError('Unavailable')):
            with self.assertRaisesMessage(RuntimeError, 'Unavailable'):
                programme_list.build_programme_list('operational')

    def test_grouped_learner_counts_keep_id_ownership_and_unlinked_name_totals(self):
        rows = [
            {'programme': 'Alpha', 'programme_id': 'PROG-1', 'learner_count': 4},
            {'programme': 'Old name', 'programme_id': ' PROG-1 ', 'learner_count': 3},
            {'programme': ' Alpha ', 'programme_id': '', 'learner_count': 2},
            {'programme': 'ALPHA', 'programme_id': ' ', 'learner_count': 1},
            {'programme': 'Alpha', 'programme_id': 'PROG-OLD', 'learner_count': 5},
        ]
        with patch.object(views, 'fetch_all', return_value=rows) as fetch:
            actual = programme_list.programme_list_learner_counts({'has_learner_table': True})
        self.assertEqual(actual, ({'PROG-1': 7, 'PROG-OLD': 5}, {'alpha': 3}))
        sql = fetch.call_args.args[0]
        self.assertIn("to_jsonb(learner)->>'programme_id'", sql)
        self.assertIn('count(*)', sql)
        self.assertNotIn('lifecycle_status', sql)

    def test_missing_learner_table_and_failed_query_are_distinct(self):
        with patch.object(views, 'fetch_all', side_effect=RuntimeError('Unavailable')) as fetch:
            self.assertEqual(programme_list.programme_list_learner_counts({'has_learner_table': False}), ({}, {}))
            fetch.assert_not_called()
            with self.assertRaisesMessage(RuntimeError, 'Unavailable'):
                programme_list.programme_list_learner_counts({'has_learner_table': True})

    def test_postgres_batches_narrow_relationships_and_decodes_raw_json(self):
        source = {'modules': self.modules, 'groups': self.groups, 'cohorts': self.cohorts,
                  'weeks': self.weeks, 'program_configs': self.configs, 'ksb_profiles': self.profiles}
        with patch.object(views, 'connection', vendor='postgresql'), \
             patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'fetch_all', return_value=[{key: json.dumps(value) for key, value in source.items()}]) as fetch:
            self.assertEqual(programme_list.programme_list_sources(), source)
            sql, params = fetch.call_args.args
            self.assertTrue(sql.startswith('select '))
            self.assertEqual(sql.count('jsonb_agg'), 5)
            self.assertNotIn('cover_image_url', params[0])
            self.assertNotIn('description', params[3])
            self.assertIn('weeks_number', params[0])
            fetch.return_value = [{'modules': 'broken json'}]
            with self.assertRaises(json.JSONDecodeError):
                programme_list.programme_list_sources()

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_list_cache_hit_does_not_first_build_overview_or_read_sources(self):
        cards = [{'id': 'PROG-1', 'modules': 2}]
        with patch.object(views, 'cached_curriculum_value', return_value=cards) as cache, \
             patch.object(programme_list, 'build_programme_list', side_effect=AssertionError('Cache hit')), \
             patch.object(views, 'build_curriculum_payload', side_effect=AssertionError('Cache hit')):
            response = views.curriculum_programmes(RequestFactory().get('/curriculum/programmes/'))
        self.assertJSONEqual(response.content, {'schema': views.CURRICULUM_SCHEMA, 'count': 1, 'results': cards})
        cache.assert_called_once()
        self.assertEqual(cache.call_args.args[0], 'programmes:operational:with-module-counts')

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_forced_all_visibility_rebuild_uses_its_own_cache_key(self):
        with patch.object(views, 'request_bypasses_curriculum_cache', return_value=True), \
             patch.object(views, 'cached_curriculum_value', side_effect=lambda key, build, **kwargs: build()) as cache, \
             patch.object(programme_list, 'build_programme_list', return_value=[]) as build:
            views.curriculum_programmes(RequestFactory().get('/curriculum/programmes/?visibility=all'))
        build.assert_called_once_with('all', force=True)
        self.assertEqual(cache.call_args.args[0], 'programmes:all:with-module-counts')
        self.assertTrue(cache.call_args.kwargs['force'])
