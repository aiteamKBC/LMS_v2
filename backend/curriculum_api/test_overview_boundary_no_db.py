"""Original-source overview parity, required reads and HTTP/cache failure contracts."""
from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase, override_settings

from . import views, test_home_source_no_db as fixtures
from .catalogue.application import overview
from .catalogue.infrastructure import overview_reads

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/overview_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_overview(*names):
    """Run the frozen original bodies with real current helper bindings."""
    with ExitStack() as stack:
        for name in names or ('get_curriculum_rows', '_build_curriculum_payload_from_rows'):
            entry = SNAPSHOT[name]
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-overview>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(views))(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class OverviewParity(SimpleTestCase):
    def setUp(self):
        self.fixture = fixtures.HomeSourceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.stack = self.enterContext(ExitStack())
        for name, value in (
            ('get_holiday_rows', []), ('get_tutor_module_rows', []),
            ('fetch_staff_users_by_access', []), ('active_learner_delivery_counts', ({}, {})),
            ('active_learner_programme_counts', ({}, {})),
        ):
            self.stack.enter_context(composition_fixture(views, name, return_value=value))
        self.count_calls = []

        def assignment_counts(modules, **options):
            # This boundary owns orchestration, not either membership-count
            # implementation. Pin the inputs/options and enrich synthetic rows.
            self.count_calls.append((deepcopy(modules), options))
            for module in modules:
                module['assignments'] = 3
        self.stack.enter_context(composition_fixture(views, 'attach_module_assignment_counts', side_effect=assignment_counts))

    def compare(self, *, visibility='operational', compact=True, **options):
        self.count_calls.clear()
        with original_overview():
            expected_rows = views.get_curriculum_rows(compact=compact)
            expected = views.build_curriculum_payload_from_rows(
                deepcopy(expected_rows), visibility, compact=compact, **options)
        expected_count_calls = deepcopy(self.count_calls)
        self.count_calls.clear()
        with (patch.object(overview_reads, 'read_curriculum_source', wraps=overview_reads.read_curriculum_source) as reader,
              patch.object(overview, 'build_curriculum_payload_from_rows', wraps=overview.build_curriculum_payload_from_rows) as owner):
            rows = views.get_required_curriculum_rows(compact=compact)
            before = deepcopy(rows)
            actual = views.build_curriculum_payload_from_rows(rows, visibility, compact=compact, **options)
        reader.assert_called_once()
        owner.assert_called_once()
        self.assertEqual({k: v for k, v in rows.items() if k != '_delivery_rows'}, expected_rows)
        self.assertEqual(rows, before, 'Assembly must not mutate cached source rows')
        self.assertEqual(actual, expected)
        self.assertEqual(self.count_calls, expected_count_calls)
        return actual

    def test_full_and_compact_overview_parity_for_both_visibilities(self):
        for visibility in ('operational', 'all'):
            for compact in (False, True):
                with self.subTest(visibility=visibility, compact=compact):
                    self.compare(visibility=visibility, compact=compact)

    def test_home_module_and_programme_consumers_keep_their_existing_branches(self):
        for visibility in ('operational', 'all'):
            for option in ('home_summary', 'module_list', 'programme_list', 'learner_profiles'):
                with self.subTest(visibility=visibility, option=option):
                    self.compare(visibility=visibility, **{option: True})

    def test_archive_copy_cannot_hide_live_original(self):
        self.fixture.modules.append({'module_catalogue_id': 'COPY', 'source_id': 'MOD-A',
                                     'title': 'Archived copy', 'status': 'archived'})
        payload = self.compare()
        ids = {m.get('moduleCatalogueId') or m.get('catalogueId') or m['id'] for m in payload['modules']}
        self.assertIn('MOD-A', ids)
        self.assertNotIn('COPY', ids)

    def test_provided_delivery_source_is_forwarded_unchanged(self):
        self.compare(home_summary=True, delivery_source={'modules': [], 'cohorts': [], 'groups': []})

    def test_invalid_noncompact_projection_still_raises(self):
        for option in ('home_summary', 'module_list', 'programme_list'):
            with self.subTest(option=option):
                with self.assertRaisesRegex(ValueError, 'requires compact'):
                    views.build_curriculum_payload_from_rows({}, compact=False, **{option: True})

    def test_strict_source_reads_once_and_never_uses_safe_legacy_readers(self):
        self.fixture.calls.clear()
        with ExitStack() as guard:
            for name in ('get_training_rows', 'get_module_rows', 'get_authoring_module_rows',
                         'get_tutor_rows', 'get_coach_rows'):
                guard.enter_context(composition_fixture(views, name, side_effect=AssertionError(name)))
            views.get_required_curriculum_rows(compact=False)
        self.assertEqual(len(self.fixture.calls), 4)
        self.assertTrue(all(kwargs.get('ensure_tables', True) is True for _, kwargs in self.fixture.calls))

    def test_every_required_source_failure_propagates_without_partial_rows(self):
        original = views.authoring_fetch_all.side_effect
        for table in (views.AUTHORING_MODULES_TABLE, views.GROUPS_TABLE,
                      views.COHORT_AUTHORING_DETAILS_TABLE, views.AUTHORING_WEEKS_TABLE):
            with self.subTest(table=table):
                def fail(selected, *args, **kwargs):
                    if selected == table:
                        raise RuntimeError('private source diagnostic')
                    return original(selected, *args, **kwargs)
                with composition_fixture(views, 'authoring_fetch_all', side_effect=fail):
                    with self.assertRaises(overview.CurriculumOverviewUnavailable):
                        views.get_required_curriculum_rows(compact=True)
        for name in ('get_program_config_rows', 'get_holiday_rows',
                     'fetch_staff_users_by_access', 'get_tutor_module_rows'):
            with self.subTest(source=name), composition_fixture(views, name, side_effect=RuntimeError('private')):
                with self.assertRaises(overview.CurriculumOverviewUnavailable):
                    views.get_required_curriculum_rows(compact=False)

    def test_compact_read_does_not_request_optional_full_sources(self):
        with ExitStack() as guard:
            for name in ('get_holiday_rows', 'fetch_staff_users_by_access', 'get_tutor_module_rows'):
                guard.enter_context(composition_fixture(views, name, side_effect=AssertionError(name)))
            rows = views.get_required_curriculum_rows(compact=True)
        for key in ('holidays', 'tutors', 'coaches', 'tutor_modules'):
            self.assertEqual(rows[key], [])

    def test_genuinely_empty_sources_remain_a_success(self):
        with (composition_fixture(views, 'authoring_fetch_all', return_value=[]),
              composition_fixture(views, 'get_program_config_rows', return_value=[])):
            self.assertTrue(all(value == [] for key, value in views.get_required_curriculum_rows(compact=False).items() if key != '_delivery_rows'))

    def test_old_and_required_overview_consumers_refuse_incomplete_reads(self):
        with composition_fixture(views, 'authoring_fetch_all', side_effect=RuntimeError('offline')):
            with self.assertRaises(CatalogueReadUnavailable):
                views.get_curriculum_rows(compact=True)
            with self.assertRaises(overview.CurriculumOverviewUnavailable):
                views.get_required_curriculum_rows(compact=True)


@override_settings(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)
class OverviewHttpCache(SimpleTestCase):
    def setUp(self):
        cache.clear()
        views.cache_state._CURRICULUM_CACHE.clear()
        self.addCleanup(cache.clear)
        self.addCleanup(views.cache_state._CURRICULUM_CACHE.clear)
        self.enterContext(composition_fixture(views, 'shared_curriculum_epoch', return_value=1))
        self.enterContext(composition_fixture(views, 'connection', in_atomic_block=False))
        self.factory = RequestFactory()

    def get(self, query='', **headers):
        return views.curriculum_overview(self.factory.get('/curriculum/overview/'+query, **headers))

    def test_failed_source_is_503_and_never_cached_as_rows_or_payload(self):
        with composition_fixture(views, 'get_required_curriculum_rows', side_effect=overview.CurriculumOverviewUnavailable('private')):
            response = self.get('?compact=1', HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content), {'error': 'Curriculum overview unavailable. Please retry.'})
        self.assertNotIn('rows-required:v2:compact', views.cache_state._CURRICULUM_CACHE)
        self.assertNotIn('overview-required:v2:operational:compact', views.cache_state._CURRICULUM_CACHE)

    def test_failed_forced_refresh_preserves_last_success_and_next_refresh_recovers(self):
        good = {'modules': [], 'ksbSets': [{'id': 'K'}], 'generation': 1}
        with (composition_fixture(views, 'get_required_curriculum_rows', return_value={'complete': True}),
              composition_fixture(views, 'build_curriculum_payload_from_rows', return_value=good)):
            self.assertEqual(self.get('?compact=1').status_code, 200)
        with composition_fixture(views, 'get_required_curriculum_rows', side_effect=overview.CurriculumOverviewUnavailable('private')):
            self.assertEqual(self.get('?compact=1', HTTP_CACHE_CONTROL='no-cache').status_code, 503)
            self.assertEqual(json.loads(self.get('?compact=1').content)['generation'], 1)
        self.assertEqual(views.cache_state._CURRICULUM_CACHE['overview-required:v2:operational:compact']['value']['ksbSets'], [{'id': 'K'}])
        with (composition_fixture(views, 'get_required_curriculum_rows', return_value={'complete': True}),
              composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={**good, 'generation': 2})):
            self.assertEqual(json.loads(self.get('?compact=1', HTTP_CACHE_CONTROL='no-cache').content)['generation'], 2)

    def test_compact_profile_identity_uses_separate_payload_cache_and_option(self):
        with (composition_fixture(views, 'get_required_curriculum_rows', return_value={}),
              composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={'modules': [], 'ksbSets': []}) as build):
            self.assertEqual(self.get('?compact=1&learner_source=profiles').status_code, 200)
        self.assertTrue(build.call_args.kwargs['learner_profiles'])
        self.assertIn('overview-required:v2:operational:compact:learner-profiles', views.cache_state._CURRICULUM_CACHE)

    def test_legacy_cache_entries_cannot_satisfy_the_required_read_contract(self):
        views.cached_curriculum_value('rows:compact', lambda: {'legacy': 'partial'}, force=True)
        views.cached_curriculum_value('overview:operational:compact', lambda: {'modules': [], 'ksbSets': []}, force=True)
        with composition_fixture(views, 'get_required_curriculum_rows', side_effect=overview.CurriculumOverviewUnavailable('private')):
            self.assertEqual(self.get('?compact=1').status_code, 503)
        self.assertEqual(views.cache_state._CURRICULUM_CACHE['rows:compact']['value'], {'legacy': 'partial'})

    def test_shared_epoch_invalidates_required_payload_and_rows(self):
        good = {'modules': [], 'ksbSets': [], 'generation': 1}
        with (composition_fixture(views, 'get_required_curriculum_rows', return_value={}) as read,
              composition_fixture(views, 'build_curriculum_payload_from_rows', return_value=good) as build):
            self.assertEqual(json.loads(self.get('?compact=1').content)['generation'], 1)
            self.assertEqual(json.loads(self.get('?compact=1').content)['generation'], 1)
            read.assert_called_once()
            build.return_value = {**good, 'generation': 2}
            with composition_fixture(views, 'shared_curriculum_epoch', return_value=2):
                self.assertEqual(json.loads(self.get('?compact=1').content)['generation'], 2)
            self.assertEqual(read.call_count, 2)
