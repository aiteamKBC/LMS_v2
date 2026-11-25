"""Original-source parity and required overview failure behavior with synthetic ports."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views
from curriculum_api.catalogue.application import session_calendar, overview

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/session_enrichment_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_sessions():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name, None), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-session-enrichment>', 'exec'), namespace)
            fn = namespace[name]
            original = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            original.__kwdefaults__ = fn.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, original, create=True))
        yield


class SessionEnrichmentParity(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')))
        self.module = {'module_catalogue_id': 'M', 'title': 'Synthetic', 'programme_id': 'P',
                       'programme_name': 'Programme', 'cohort_id': 'C', 'group_id': 'G'}
        self.week = {'id': 'W', 'module_catalogue_id': 'M', 'title': 'Week', 'week_number': 1}
        self.component = {'id': 'COMP', 'module_catalogue_id': 'M', 'week_id': 'W',
                          'type': 'live_session', 'title': 'Synthetic session', 'settings_json': {}}
        self.calls = []

        def read(table, *args, **kwargs):
            self.calls.append((table, deepcopy(args), deepcopy(kwargs)))
            return deepcopy({views.AUTHORING_MODULES_TABLE: [self.module],
                             views.GROUPS_TABLE: [{'group_id': 'G'}],
                             views.AUTHORING_WEEKS_TABLE: [self.week],
                             views.AUTHORING_COMPONENTS_TABLE: [self.component]}[table])
        self.reader = self.enterContext(composition_fixture(views, 'authoring_fetch_all', side_effect=read))
        self.enterContext(composition_fixture(views, 'module_week_delivery_slots', return_value=(
            [[{'date': '2028-01-03', 'sessionNumber': 1}]], [{'date': '2028-01-03', 'sessionNumber': 1}])) )

    def compare(self, name, *args, **kwargs):
        self.calls.clear()
        with original_sessions():
            expected = getattr(views, name, None)(*deepcopy(args), **deepcopy(kwargs))
        calls = deepcopy(self.calls)
        self.calls.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as invoked:
            actual = getattr(views, name, None)(*deepcopy(args), **deepcopy(kwargs))
        invoked.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(type(actual), type(expected))
        self.assertEqual(self.calls, calls)
        return actual

    def test_session_identity_helpers_preserve_normalization_and_authoring_precedence(self):
        for names in ([], None, ['Week 1', ' week 2 '], ['Real title', 'Week 2']):
            self.compare('meaningful_session_names', names)
        for name in ('build_sessions', 'build_sessions_basic', 'prefer_authoring_module_sessions',
                     'authoring_programme_lookup_key', 'build_authoring_modules_by_programme',
                     'matching_authoring_module_for_training_row'):
            self.assertFalse(hasattr(views, name), name)

    def test_unbooked_primary_date_resolution_matches_original(self):
        self.compare('resolved_live_session_date', {}, 0, [{'date': '2028-01-03'}], [], stored_date='2028-01-01')
        self.compare('resolved_live_session_date', {}, 3, [], [], stored_date='2028-01-01')

    def test_links_and_plans_preserve_exact_read_calls_and_result_order(self):
        result = self.compare('authoring_session_links_by_catalogue', ['M', 'M', ' M '])
        self.assertEqual(result['M'][0]['componentId'], 'COMP')
        self.assertEqual(result['M'][0]['date'], '2028-01-03')
        self.compare('delivery_slots_by_catalogue', {'M': [self.week]})
        self.compare('authoring_session_links_by_catalogue', [])

    def test_supplied_rows_avoid_database_reads_and_keep_empty_authoritative(self):
        self.reader.side_effect = AssertionError('Unexpected database read')
        for components in ([], [self.component]):
            self.compare('authoring_session_links_by_catalogue', ['M'],
                         modules_by_catalogue={'M': self.module}, groups_by_id={}, holidays_by_cohort={},
                         week_rows=[self.week], component_rows=components)
        self.reader.assert_not_called()

    def test_strict_source_failure_propagates_and_compatibility_failure_stays_unchanged(self):
        self.reader.side_effect = RuntimeError('private diagnostic')
        self.assertEqual(self.compare('authoring_session_links_by_catalogue', ['M']), {})
        with self.assertRaises(RuntimeError):
            views.authoring_session_links_by_catalogue(['M'], strict=True)

    def test_each_required_dependency_failure_propagates(self):
        normal = self.reader.side_effect
        for table in (views.AUTHORING_WEEKS_TABLE, views.AUTHORING_COMPONENTS_TABLE,
                      views.AUTHORING_MODULES_TABLE, views.GROUPS_TABLE):
            with self.subTest(table=table):
                def fail(selected, *args, **kwargs):
                    if selected == table:
                        raise RuntimeError('synthetic source unavailable')
                    return normal(selected, *args, **kwargs)
                self.reader.side_effect = fail
                with self.assertRaises(RuntimeError):
                    views.authoring_session_links_by_catalogue(['M'], strict=True)

    def test_required_and_compatibility_successes_match(self):
        expected = views.authoring_session_links_by_catalogue(['M'])
        self.assertEqual(views.authoring_session_links_by_catalogue(['M'], strict=True), expected)

    def test_authored_session_payloads_match_the_existing_authored_builder(self):
        with composition_fixture(views, 'cohort_selected_holidays_by_id', return_value={}):
            expected = views.build_sessions_from_authoring_modules([self.module], {}, groups_by_id={})
            actual = views.curriculum_sessions_from_rows({}, [{'sessions_number': 99}], [self.module], [], [], [])
        self.assertEqual(actual, expected)
        self.assertEqual([row['componentId'] for row in actual], ['COMP'])

    def test_legacy_training_count_does_not_create_sessions_without_components(self):
        with (composition_fixture(views, 'authoring_session_links_by_catalogue', return_value={}),
              composition_fixture(views, 'cohort_selected_holidays_by_id', return_value={})):
            self.assertEqual(views.curriculum_sessions_from_rows({},
                [{'id': 'D', 'sessions_number': 99, 'start_date': '2028-01-03'}], [self.module], [], [], []), [])


class RequiredOverviewCalendar(SimpleTestCase):
    def setUp(self):
        cache.clear()
        views.cache_state._CURRICULUM_CACHE.clear()
        self.addCleanup(cache.clear)
        self.addCleanup(views.cache_state._CURRICULUM_CACHE.clear)
        self.read = Mock(return_value={})
        self.build = Mock(return_value=[])
        self.holidays = Mock(return_value={})
        self.rows = {'_delivery_rows': {'groups': [{'group_id': 'G', 'session_week_day': 'Monday'}]}}
        self.modules = [{'module_catalogue_id': 'M', 'sessions_number': 99}]

    def run_calendar(self, cohorts=None):
        return session_calendar.required_curriculum_sessions(
            self.rows, [{'sessions_number': 99}], self.modules, cohorts or [], [], [],
            read_links=self.read, select_holidays=self.holidays, build_authored_sessions=self.build,
            clean_str=views.clean_str, parse_date=views.parse_date)

    def test_empty_structure_never_generates_training_count_sessions(self):
        self.assertEqual(self.run_calendar(), [])
        self.assertTrue(self.read.call_args.kwargs['strict'])
        self.assertEqual(self.build.call_args.kwargs['session_links'], {})
        self.assertEqual(self.read.call_args.kwargs['groups_by_id']['G']['session_week_day'], 'Monday')

    def test_unavailable_links_do_not_become_successful_empty_calendar(self):
        self.read.side_effect = RuntimeError('private diagnostic')
        with self.assertRaises(overview.CurriculumOverviewUnavailable):
            self.run_calendar()
        self.build.assert_not_called()

    def test_calendar_error_is_not_interpreted_as_no_holidays(self):
        with self.assertRaises(overview.CurriculumOverviewUnavailable):
            self.run_calendar([{'id': 'C', 'calendarError': 'Unavailable'}])
        self.read.assert_not_called()

    def test_error_raised_during_holiday_selection_is_not_hidden(self):
        def select(cohorts, holidays):
            cohorts[0]['calendarError'] = 'Unavailable'
            return {}
        self.holidays.side_effect = select
        with self.assertRaises(overview.CurriculumOverviewUnavailable):
            self.run_calendar([{'id': 'C'}])
        self.read.assert_not_called()

    def test_http_failure_is_503_not_cached_and_does_not_expose_diagnostics(self):
        self.read.side_effect = RuntimeError('private diagnostic')
        with (composition_fixture(views, 'build_curriculum_overview', side_effect=lambda *a, **k: self.run_calendar()),
              composition_fixture(views, 'shared_curriculum_epoch', return_value=1),
              composition_fixture(views, 'connection', in_atomic_block=False)):
            response = views.curriculum_overview(RequestFactory().get('/curriculum/overview/'))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'private', response.content)
        self.assertNotIn('overview-required:v2:operational:full', views.cache_state._CURRICULUM_CACHE)
