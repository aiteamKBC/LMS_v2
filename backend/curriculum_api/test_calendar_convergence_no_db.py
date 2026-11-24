"""Authored source convergence and unchanged HTTP contracts; synthetic reads only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views, delivery_dashboard
from .catalogue.api import programme_detail as http
from .catalogue.application import calendar_queries, session_calendar
from .catalogue.application.overview import CurriculumOverviewUnavailable
from . import tests_delivery_calendar_projection as fixtures

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/programme_http_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_http():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-programme-http>', 'exec'), namespace)
            source = namespace[name]
            fn = FunctionType(source.__code__, vars(views), name, source.__defaults__)
            fn.__kwdefaults__ = source.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                fn = eval(decorator, vars(views))(fn)
            stack.enter_context(composition_fixture(views, name, fn))
        yield


class ProgrammeHttpParity(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.payload = {'schema': 'test', 'flat': {'modules': [{'id': 'M'}], 'sessions': [{'id': 'S'}]}}
        self.build = self.enterContext(composition_fixture(views, 'build_curriculum_programme_tree_detail_payload', return_value=self.payload))
        self.enterContext(composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()))
        self.enterContext(composition_fixture(views, 'repair_curriculum_parent_links', return_value=None))
        self.enterContext(composition_fixture(views, 'note_programme_section_read', return_value=None))
        self.enterContext(composition_fixture(views, 'refresh_curriculum_generations', return_value=None))

    def compare(self, name, request, *args):
        with original_http():
            expected = getattr(views, name)(request, *args)
        with patch.object(http, name, wraps=getattr(http, name)) as owner:
            actual = getattr(views, name)(request, *args)
        owner.assert_called_once()
        self.assertEqual((actual.status_code, actual.content, dict(actual.headers)),
                         (expected.status_code, expected.content, dict(expected.headers)))
        return actual

    def test_full_detail_options_errors_and_conditional_etag_match_original(self):
        for query in ('', '?visibility=all&deferStats=1&omit=components,tree,weekComponents'):
            for payload, status in ((self.payload, 200), (None, 404)):
                with self.subTest(query=query, status=status):
                    self.build.return_value = payload
                    response = self.compare('curriculum_programme_tree_detail', self.factory.get('/detail/'+query), 'P')
                    self.assertEqual(response.status_code, status)
        self.build.return_value = self.payload
        first = views.curriculum_programme_tree_detail(self.factory.get('/detail/'), 'P')
        response = self.compare('curriculum_programme_tree_detail',
            self.factory.get('/detail/', HTTP_IF_NONE_MATCH=first['ETag']), 'P')
        self.assertEqual(response.status_code, 304)

    def test_invalid_canonical_records_return_intended_422_instead_of_encoder_typeerror(self):
        self.build.return_value = {'flat': {'modules': [{}]}}
        for name, args in (('curriculum_programme_tree_detail', ('P',)),
                           ('curriculum_programme_detail_section', ('P', 'modules'))):
            with original_http(), self.assertRaisesRegex(TypeError, "multiple values for argument 'message'"):
                getattr(views, name)(self.factory.get('/detail/'), *args)
            response = getattr(views, name)(self.factory.get('/detail/'), *args)
            self.assertEqual(response.status_code, 422)
            body = json.loads(response.content)
            self.assertEqual(body['code'], 'CANONICAL_DATA_REQUIRED')
            self.assertEqual(body['validationErrors'], ['Canonical module "unnamed record" is missing its id.'])
            self.assertIn('message', body)

    def test_sections_after_write_and_unknown_section_match_original(self):
        for section in ('shell', 'modules', 'unknown'):
            response = self.compare('curriculum_programme_detail_section',
                self.factory.get('/detail/?visibility=all', HTTP_CACHE_CONTROL='max-age=0'), 'P', section)
            self.assertEqual(response.status_code, 404 if section == 'unknown' else 200)

    def test_required_calendar_failure_returns_sanitized_503(self):
        self.build.side_effect = CurriculumOverviewUnavailable('private diagnostic')
        for name, args in (('curriculum_programme_tree_detail', ('P',)),
                           ('curriculum_programme_detail_section', ('P', 'modules'))):
            response = getattr(views, name)(self.factory.get('/detail/'), *args)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(b'private', response.content)


class ProgrammeSessionOrchestration(SimpleTestCase):
    def test_detail_shell_skips_sessions_and_modules_use_resolved_programme(self):
        from . import tests_programme_detail_sections as detail
        from .catalogue.application import programme_detail
        original = programme_detail._build_curriculum_programme_tree_detail_payload
        read = Mock(return_value=[{'id': 'authored', 'componentId': 'COMP'}])
        def build(*args, **kwargs):
            kwargs['read_programme_sessions'] = read
            return original(*args, **kwargs)
        fixture = detail.ProgrammeDetailSectionTests()
        with patch.object(programme_detail, '_build_curriculum_programme_tree_detail_payload', side_effect=build):
            fixture.build('shell')
            read.assert_not_called()
            result = fixture.build('modules')
        read.assert_called_once_with(detail.PROGRAMME, 'all')
        self.assertEqual(result['flat']['sessions'], read.return_value)


class CalendarConvergence(SimpleTestCase):
    def setUp(self):
        self.fixture = fixtures.DeliveryCalendarProjectionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.enterContext(patch('requests.sessions.Session.request', side_effect=AssertionError('Network forbidden')))
        self.enterContext(composition_fixture(views, 'ensure_module_authoring_tables', side_effect=AssertionError('Provisioning forbidden')))

    def test_programme_module_and_delivery_share_actual_application_and_projection(self):
        baseline = delivery_dashboard.build_calendar_sessions()
        with patch.object(calendar_queries, 'build_calendar_snapshot', wraps=calendar_queries.build_calendar_snapshot) as query, \
             patch.object(session_calendar, 'calendar_snapshot_from_rows', wraps=session_calendar.calendar_snapshot_from_rows) as projection:
            programme = views.read_programme_sessions({'sourceId': 'P1'}, 'operational')
            scoped = views.module_scoped_sessions('M1')
            all_view = views.module_scoped_sessions('M1', visibility='all')
        self.assertEqual(programme, baseline)
        self.assertEqual(scoped, baseline)
        self.assertEqual(all_view, baseline)
        self.assertEqual(query.call_count, 3)
        self.assertEqual(projection.call_count, 3)

    def test_programme_scope_is_exact_and_does_not_match_duplicate_names(self):
        self.fixture.modules[0]['programme_id'] = 'OTHER'
        self.assertEqual(views.read_programme_sessions({'sourceId': 'P1', 'name': 'Example programme'}, 'all'), [])
        self.assertEqual(len(views.read_programme_sessions({'sourceId': 'OTHER'}, 'all')), 2)

    def test_missing_module_or_programme_does_not_read_global_calendar(self):
        self.fixture.reads.clear()
        with composition_fixture(views, 'get_holiday_rows', side_effect=AssertionError('No holidays needed')):
            self.assertEqual(views.module_scoped_sessions('missing'), [])
            self.assertEqual(views.read_programme_sessions({}, 'all'), [])
        self.assertEqual(self.fixture.reads, [(views.AUTHORING_MODULES_TABLE, 0)])

    def test_no_component_or_no_date_never_falls_back_to_module_count(self):
        self.fixture.modules[0]['sessions_number'] = 99
        self.fixture.components = []
        self.assertEqual(views.read_programme_sessions({'id': 'P1'}, 'all'), [])
        with composition_fixture(views, 'authoring_session_links_by_catalogue', return_value={'M1': [{'componentId': 'undated', 'date': ''}]}):
            result = delivery_dashboard.build_calendar_snapshot()
        self.assertEqual(result, {'sessions': [], 'undatedSessionCount': 1})

    def test_required_plan_and_calendar_errors_never_return_successful_empty(self):
        with composition_fixture(views, 'module_week_delivery_slots', side_effect=ValueError('synthetic planner failure')):
            with self.assertRaises(CurriculumOverviewUnavailable):
                delivery_dashboard.build_calendar_snapshot()
        with composition_fixture(views, 'cohort_selected_holidays_by_id', side_effect=RuntimeError('synthetic calendar failure')):
            with self.assertRaises(CurriculumOverviewUnavailable):
                views.read_programme_sessions({'id': 'P1'}, 'all')

    def test_scoped_and_all_http_read_failures_return_503(self):
        with composition_fixture(delivery_dashboard, 'build_calendar_snapshot', side_effect=CurriculumOverviewUnavailable('private')), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()):
            for query in ('?module_catalogue_id=M1', '?moduleCatalogueId=M1&visibility=all', '?visibility=all', ''):
                response = views.curriculum_sessions(RequestFactory().get('/sessions/'+query))
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(b'private', response.content)
