"""Preserve programme list values while avoiding unrelated overview reads."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import json
from pathlib import Path
from contextlib import ExitStack
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import programme_list, views
from .catalogue.tests.parity.read_dependency_test_support import database_read_fixture


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
            {'programme_id': 'PROG-1', 'name': 'Alpha', 'status': 'published',
             'description': 'Description', 'level': '4', 'color': '#123456',
             'ksb_profile_source_id': 'standard:std-one', 'required_otjh': 300, 'display_order': 2},
            {'programme_id': 'PROG-2', 'name': 'Empty', 'status': 'published'},
        ]
        # Normalized schema: authored week rows, not the legacy weeks_number
        # field, establish MOD-1's five weeks (module_stored_week_count).
        self.weeks = [
            {'id': f'MOD1-W{number}', 'module_catalogue_id': 'MOD-1',
             'week_number': number, 'status': 'active'}
            for number in range(1, 6)
        ]
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
            composition_fixture(views, 'authoring_fetch_all', side_effect=fetch),
            composition_fixture(views, 'get_program_config_rows', return_value=self.configs),
            composition_fixture(views, 'get_ksb_profile_rows', return_value=self.profiles),
            database_read_fixture('table_exists', return_value=False),
            composition_fixture(views, 'get_holiday_rows_safe', return_value=[]),
            composition_fixture(views, 'authoring_module_content_counts', return_value=({}, {})),
            composition_fixture(views, 'attach_module_assignment_counts'),
            composition_fixture(views, 'active_learner_programme_counts', return_value=({'PROG-1': 4}, {'alpha': 2})),
            composition_fixture(views, 'standard_required_ksbs', return_value=[{'code': 'K1'}, {'code': 'S2'}]),
        ):
            stack.enter_context(patcher)

    def assert_same_list(self):
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                self.assertEqual(views.build_programme_list(visibility), previous_programme_list(visibility))

    def _assert_builder_extraction_parity(self):
        from .catalogue.application import programme_builder
        source = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots' /
                             'programme_builder_snapshot.json').read_text())['source']
        # Compile the frozen production body, with the real current helpers and
        # this fixture's patched readers. No independently reimplemented oracle.
        namespace = dict(vars(views))
        identities = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots' /
                                 'programme_identity_snapshot.json').read_text())['functions']
        for original in identities.values():
            exec(compile(original, '<pre-identity-extraction>', 'exec'), namespace)
        exec(compile(source, '<pre-programme-builder>', 'exec'), namespace)
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                self.reads.clear()
                with composition_fixture(views, 'build_programmes', namespace['build_programmes']):
                    expected = views.build_programme_list(visibility)
                old_reads = list(self.reads)
                self.reads.clear()
                with patch.object(programme_builder, 'build_programmes',
                                  wraps=programme_builder.build_programmes) as extracted:
                    actual = views.build_programme_list(visibility)
                self.assertTrue(extracted.called)
                self.assertEqual(actual, expected)
                self.assertEqual(self.reads, old_reads)

    def test_builder_calls_domain_identity_rules_directly(self):
        from .catalogue.application import programme_builder
        from .catalogue.domain import programme_identity as policy
        with ExitStack() as stack:
            spies = [stack.enter_context(patch.object(programme_builder, name, wraps=getattr(policy, name)))
                     for name in ('programme_identity', 'programme_config_identity', 'unique_program_configs_for_display')]
            views.build_programme_list('operational')
        for spy in spies:
            self.assertTrue(spy.called)

    def test_extracted_builder_payload_and_read_order_parity(self):
        self._assert_builder_extraction_parity()

    def test_extracted_builder_archived_draft_duplicate_and_renamed_parity(self):
        self.configs[0]['name'] = 'Renamed Alpha'
        self.configs.extend([
            dict(self.configs[0]),
            {'programme_id': 'PROG-ARCH', 'name': 'Archived', 'status': 'archived'},
            {'programme_id': 'PROG-DRAFT', 'name': 'Draft', 'status': 'draft'},
            {'programme_id': 'PROG-SAME', 'name': 'Alpha', 'status': 'published'},
        ])
        self._assert_builder_extraction_parity()

    def test_extracted_builder_empty_source_parity(self):
        self.modules.clear()
        self.configs.clear()
        self.cohorts.clear()
        self.groups.clear()
        self.weeks.clear()
        self._assert_builder_extraction_parity()

    def test_extracted_builder_supplied_counts_do_not_read_again(self):
        from .catalogue.application import programme_builder
        with composition_fixture(views, 'authoring_programme_structure_counts',
                          side_effect=AssertionError('Supplied structure counts')), \
             composition_fixture(views, 'active_learner_programme_counts',
                          side_effect=AssertionError('Supplied learner counts')), \
             patch.object(programme_builder, 'build_programmes',
                          wraps=programme_builder.build_programmes) as extracted:
            cards = views.build_programmes(
                [], self.configs, [], include_structure_counts=False,
                include_learner_counts=False, only_stats_for_ids=set(),
                structure_counts=({'PROG-1': {'modules': 7, 'cohorts': 2, 'groups': 3, 'weeks': 9}}, {}),
                learner_counts=({'PROG-1': 6}, {'alpha': 2}),
            )
        self.assertEqual(extracted.call_count, 1)
        card = next(item for item in cards if item['id'] == 'PROG-1')
        self.assertEqual((card['modules'], card['cohorts'], card['groups'], card['weeks'], card['learners']),
                         (7, 2, 3, 9, 8))

    def test_cards_keep_counts_metadata_ksb_source_and_learner_ownership(self):
        self.assert_same_list()
        with composition_fixture(views, 'build_curriculum_payload_from_rows', side_effect=AssertionError('Unused overview')), \
             composition_fixture(views, 'enrich_modules_with_authoring', side_effect=AssertionError('Unused module content')):
            result = views.build_programme_list('operational')
        card = result[0]
        self.assertEqual((card['modules'], card['cohorts'], card['groups'], card['weeks']), (2, 1, 1, 11))
        self.assertEqual((card['learners'], card['ksbTotal']), (6, 2))
        self.assertEqual(card['ksbProfileSourceId'], 'standard:std-one')
        self.assertEqual(result[1]['modules'], 0)

    def test_week_fallback_excludes_archived_rows(self):
        self.weeks.extend([
            {'id': 'W1', 'module_catalogue_id': 'MOD-2', 'status': 'active'},
            {'id': 'W2', 'module_catalogue_id': 'MOD-2', 'status': 'active'},
            {'id': 'W4', 'module_catalogue_id': 'MOD-2', 'status': 'inactive'},
        ])
        self.assert_same_list()
        self.assertEqual(views.build_programme_list('operational')[0]['weeks'], 7)

    def test_without_authored_weeks_uses_sessions_and_delivery_days(self):
        self.weeks.clear()
        self.assert_same_list()
        # MOD-1: 10 / one day; MOD-2: 12 / two days. Legacy weeks_number
        # must not override the normalized read contract when rows are absent.
        self.assertEqual(views.build_programme_list('operational')[0]['weeks'], 16)

    def test_renamed_programme_and_reused_name_do_not_double_count_children(self):
        self.configs[0]['name'] = 'Renamed'
        self.configs[1]['name'] = 'Alpha'
        self.assert_same_list()
        cards = views.build_programme_list('operational')
        self.assertEqual([card['modules'] for card in cards], [2, 0])

    def test_module_only_programme_and_archived_modules_retain_reconstruction(self):
        self.modules.append({'module_catalogue_id': 'MOD-3', 'title': 'Only module',
                             'programme_id': 'PROG-3', 'programme_name': 'Module only', 'weeks_number': 3})
        self.assert_same_list()
        self.assertIn('PROG-3', [card['id'] for card in views.build_programme_list('all')])
        self.modules[-1]['status'] = 'inactive'
        self.assert_same_list()

    def test_archived_draft_inactive_and_duplicate_config_visibility(self):
        for status in ('archived', 'draft', 'inactive'):
            with self.subTest(status=status):
                self.configs[0].update(status=status)
                self.assert_same_list()
        self.configs.append({'programme_id': 'PROG-OLD', 'name': 'Alpha', 'status': 'archived'})
        self.assert_same_list()

    def test_parent_deletion_and_module_soft_delete_preserve_counts(self):
        self.groups[0]['status'] = 'inactive'
        self.modules[1]['status'] = 'inactive'
        self.assert_same_list()

    def test_source_failure_does_not_become_an_empty_success(self):
        with composition_fixture(views, 'authoring_fetch_all', side_effect=RuntimeError('Unavailable')):
            with self.assertRaisesMessage(RuntimeError, 'Unavailable'):
                views.build_programme_list('operational')

    def test_grouped_learner_counts_are_owned_by_programme_id(self):
        rows = [
            {'programme_id': 'PROG-1', 'learner_count': 4},
            {'programme_id': ' PROG-1 ', 'learner_count': 3},
            {'programme_id': ' ', 'learner_count': 1},
            {'programme_id': 'PROG-OLD', 'learner_count': 5},
        ]
        with composition_fixture(views, 'fetch_all', return_value=rows) as fetch:
            actual = views.programme_list_learner_counts({'has_learner_table': True})
        self.assertEqual(actual, ({'PROG-1': 7, 'PROG-OLD': 5}, {}))
        sql = fetch.call_args.args[0]
        # Plain column reads: to_jsonb(learner) serialised every row.
        self.assertIn("coalesce(programme_id::text, '')", sql)
        self.assertNotIn('to_jsonb', sql)
        self.assertIn('count(*)', sql)
        self.assertNotIn('lifecycle_status', sql)

    def test_missing_learner_table_and_failed_query_are_distinct(self):
        with composition_fixture(views, 'fetch_all', side_effect=RuntimeError('Unavailable')) as fetch:
            self.assertEqual(views.programme_list_learner_counts({'has_learner_table': False}), ({}, {}))
            fetch.assert_not_called()
            with self.assertRaisesMessage(RuntimeError, 'Unavailable'):
                views.programme_list_learner_counts({'has_learner_table': True})

    def test_postgres_batches_narrow_relationships_and_decodes_raw_json(self):
        source = {'modules': self.modules, 'groups': self.groups, 'cohorts': self.cohorts,
                  'weeks': self.weeks, 'program_configs': self.configs}
        with composition_fixture(views, 'connection', vendor='postgresql'), \
             composition_fixture(views, 'ensure_module_authoring_tables'), \
             composition_fixture(views, 'fetch_all', return_value=[{key: json.dumps(value) for key, value in source.items()}]) as fetch:
            self.assertEqual(views.programme_list_sources(), source)
            sql, params = fetch.call_args.args
            self.assertTrue(sql.startswith('select '))
            self.assertEqual(sql.count('jsonb_agg'), 5)
            self.assertNotIn('ksb_profiles', sql)
            self.assertNotIn('cover_image_url', params[0])
            self.assertNotIn('description', params[3])
            self.assertIn('weeks_number', params[0])
            fetch.return_value = [{'modules': 'broken json'}]
            with self.assertRaises(json.JSONDecodeError):
                views.programme_list_sources()

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_list_cache_hit_does_not_first_build_overview_or_read_sources(self):
        cards = [{'id': 'PROG-1', 'modules': 2}]
        with composition_fixture(views, 'cached_curriculum_value', return_value=cards) as cache, \
             composition_fixture(views, 'build_programme_list', side_effect=AssertionError('Cache hit')), \
             composition_fixture(views, 'build_curriculum_payload', side_effect=AssertionError('Cache hit')):
            response = views.curriculum_programmes(RequestFactory().get('/curriculum/programmes/'))
        self.assertJSONEqual(response.content, {'schema': views.CURRICULUM_SCHEMA, 'count': 1, 'results': cards})
        cache.assert_called_once()
        self.assertEqual(cache.call_args.args[0], 'programmes:operational:with-module-counts')

    @override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
    def test_forced_all_visibility_rebuild_uses_its_own_cache_key(self):
        with composition_fixture(views, 'request_bypasses_curriculum_cache', return_value=True), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, build, **kwargs: build()) as cache, \
             composition_fixture(views, 'build_programme_list', return_value=[]) as build:
            views.curriculum_programmes(RequestFactory().get('/curriculum/programmes/?visibility=all'))
        build.assert_called_once_with('all', force=True)
        self.assertEqual(cache.call_args.args[0], 'programmes:all:with-module-counts')
        self.assertTrue(cache.call_args.kwargs['force'])
