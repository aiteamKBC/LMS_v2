"""Original/new authoring read parity with synthetic inputs and in-memory SQLite.

Requires the isolated Django test harness; SimpleTestCase forbids application DBs.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from . import views, catalogue_summary_reads
from . import test_module_builder_latency_no_db as grouped_fixtures
from .test_module_read_boundary_no_db import summary

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/authoring_reads_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_authoring_reads():
    with ExitStack() as stack:
        from . import ksb_mapping_placement
        stack.enter_context(patch.object(catalogue_summary_reads, 'views', views, create=True))
        stack.enter_context(patch.object(catalogue_summary_reads, 'ksb_mapping_placement', ksb_mapping_placement, create=True))
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            owner = importlib.import_module('curriculum_api.' + filename[:-3])
            if isinstance(getattr(owner, name), Mock):
                continue
            namespace = dict(vars(owner))
            exec(compile(entry['source'], '<original-authoring-reads>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(owner), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            stack.enter_context(patch.object(owner, name, restored))
        yield


class AuthoringReadBoundaryParity(SimpleTestCase):
    def compare(self, name, *args, owner=views, **kwargs):
        before = deepcopy((args, kwargs))
        with original_authoring_reads():
            expected = getattr(owner, name)(*args, **kwargs)
        # Approved study-week payload addition, not a general ignored-field comparison.
        if name == 'authoring_summary_catalogue_item':
            expected = {**expected, 'weekBoundaryMode': None}
        elif name == 'authoring_catalogue_summaries':
            expected = {key: {**row, 'weekBoundaryMode': None} for key, row in expected.items()}
        key = owner.__name__.rsplit('.', 1)[1] + '.py:' + name
        module = importlib.import_module(SNAPSHOT[key]['module'])
        with observe_export(owner, module, name, wraps=getattr(module, name)) as called:
            actual = getattr(owner, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual((args, kwargs), before)
        return actual

    def grouped_fixture(self):
        fixture = grouped_fixtures.GroupedCatalogueTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        return fixture

    def test_summary_modes_preserve_values_and_sql_on_real_synthetic_grouped_reads(self):
        fixture = self.grouped_fixture()
        for archived in (False, True):
            for content, list_only in ((True, False), (True, True), (False, False), (False, True)):
                with self.subTest(archived=archived, content=content, list_only=list_only):
                    fixture.sql_calls.clear()
                    with original_authoring_reads():
                        expected = views.authoring_catalogue_summaries(archived, content, list_only=list_only)
                    expected = {key: {**row, 'weekBoundaryMode': None} for key, row in expected.items()}
                    old_sql = list(fixture.sql_calls)
                    fixture.sql_calls.clear()
                    result = self.compare('authoring_catalogue_summaries', archived, content, list_only=list_only)
                    self.assertEqual(result, expected)
                    self.assertEqual(fixture.sql_calls, old_sql + old_sql)
                    self.assertEqual(set(result), {'MOD-ONE', 'MOD-TWO'})
                    self.assertEqual(result['MOD-ONE']['ksbCount'], 1)

    def test_grouped_reader_preserves_sql_parameters_mapping_projection_and_results(self):
        fixture = self.grouped_fixture()
        fixture.sql_calls.clear()
        components, mappings = self.compare('grouped_catalogue_content_rows', owner=catalogue_summary_reads)
        half = len(fixture.sql_calls) // 2
        self.assertEqual(fixture.sql_calls[:half], fixture.sql_calls[half:])
        self.assertEqual(half, 2)
        self.assertTrue(any(row['row_count'] > 1 for row in components))
        self.assertTrue(any(row['ksb_code'] == 'K1' for row in mappings))

    def test_training_projection_preserves_parent_precedence_and_skips_unplaced(self):
        modules = [{'module_catalogue_id': 'MOD-ONE', 'group_id': 'G1', 'cohort_id': 'C1',
                    'programme_id': 'PROG-MODULE', 'title': 'One', 'status': 'published'},
                   {'module_catalogue_id': 'MOD-NO-GROUP', 'cohort_id': 'C1'}]
        groups = [{'group_id': 'G1', 'programme_id': 'PROG-GROUP', 'programme_name': 'Group programme',
                   'cohort_name': 'Group cohort', 'group_name': 'Group', 'schedule': 'Monday 09:00-10:00'}]
        cohorts = [{'cohort_id': 'C1', 'programme_id': 'PROG-COHORT', 'start_date': '2030-01-01'}]
        with composition_fixture(views, 'prefetch_authoring_reads') as prefetch, \
             composition_fixture(views, 'authoring_fetch_all', side_effect=AssertionError('unused reader')), \
             composition_fixture(views, 'module_index_rows', side_effect=AssertionError('unused index')):
            result = self.compare('authoring_modules_as_training_rows', ensure_tables=False,
                                  module_rows=modules, group_rows=groups, cohort_rows=cohorts)
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]['_meta']['program_id'], 'PROG-GROUP')
            self.assertEqual(result[0]['Cohort_name'], 'Group cohort')
            self.assertEqual(prefetch.call_args_list[0], prefetch.call_args_list[1])

    def test_source_reads_and_prefetch_flags_keep_same_sequence(self):
        events = []
        def fetch(table, *args, **kwargs):
            events.append(('fetch', table, args, kwargs))
            return []
        def index(**kwargs):
            events.append(('index', kwargs))
            return []
        def prefetch(reads):
            events.append(('prefetch', reads))
        with composition_fixture(views, 'prefetch_authoring_reads', side_effect=prefetch), \
             composition_fixture(views, 'module_index_rows', side_effect=index), \
             composition_fixture(views, 'authoring_fetch_all', side_effect=fetch):
            for kwargs in ({}, {'ensure_tables': False}, {'group_rows': []}, {'module_rows': [], 'cohort_rows': []}):
                events.clear()
                self.compare('authoring_modules_as_training_rows', **kwargs)
                half = len(events) // 2
                self.assertEqual(events[:half], events[half:])

    def test_catalogue_projection_preserves_sort_dedup_session_fallback_and_empty_sources(self):
        modules = [{'module_catalogue_id': 'MOD-ONE', 'sessions_number': 0}, {'module_catalogue_id': 'MOD-TWO', 'sessions_number': 5}]
        weeks = [{'module_catalogue_id': 'MOD-ONE', 'display_order': 2, 'week_number': 2},
                 {'module_catalogue_id': 'MOD-ONE', 'display_order': 1, 'title': 'First'},
                 {'module_catalogue_id': 'MOD-ONE', 'display_order': 3, 'title': 'First'}]
        with composition_fixture(views, 'module_index_rows', side_effect=AssertionError('unused index')), \
             composition_fixture(views, 'authoring_fetch_all', side_effect=AssertionError('unused read')):
            result = self.compare('authoring_modules_as_catalogue_rows', module_rows=modules, week_rows=weeks)
            self.assertEqual(json.loads(result[0]['session_names_json']), ['First', 'Week 2'])
            self.assertEqual([r['Number of sessions'] for r in result], [2, 5])
            self.assertEqual(self.compare('authoring_modules_as_catalogue_rows', module_rows=[], week_rows=[]), [])

    def test_summary_item_contract_preserves_missing_field_errors_and_empty_values(self):
        item = summary(programmeId='PROG-ONE', tutor='Tutor', coach='Coach', price=0, isForSale=False)
        self.compare('authoring_summary_catalogue_item', item)
        for original in (True, False):
            with ExitStack() as stack:
                if original:
                    stack.enter_context(original_authoring_reads())
                with self.assertRaises(KeyError):
                    views.authoring_summary_catalogue_item({})

    def test_read_failure_fallbacks_remain_distinct_from_pricing_errors(self):
        with composition_fixture(views, 'prefetch_authoring_reads', side_effect=RuntimeError('synthetic read failure')), \
             patch.object(views.logger, 'exception'), patch.object(views.logger, 'debug'):
            self.assertEqual(self.compare('authoring_catalogue_summaries'), {})
            self.assertEqual(self.compare('authoring_modules_as_training_rows'), [])
        with composition_fixture(views, 'module_index_rows', side_effect=RuntimeError('synthetic read failure')), \
             patch.object(views.logger, 'debug'):
            self.assertEqual(self.compare('authoring_modules_as_catalogue_rows'), [])
        self.grouped_fixture()
        with patch.object(views.free_course_pricing, 'lookup', side_effect=RuntimeError('synthetic pricing failure')):
            for original in (True, False):
                with ExitStack() as stack:
                    if original:
                        stack.enter_context(original_authoring_reads())
                    with self.assertRaisesRegex(RuntimeError, 'synthetic pricing failure'):
                        views.authoring_catalogue_summaries()

    def test_pricing_is_read_only_and_keeps_lookup_and_payload_order(self):
        self.grouped_fixture()
        events = []
        def lookup(rows):
            events.append(('lookup', [r['module_catalogue_id'] for r in rows]))
            return {'synthetic': True}
        def payload(row, prices):
            events.append(('payload', row['module_catalogue_id'], prices))
            return {'isForSale': False, 'price': 0, 'currency': 'GBP'}
        with patch.object(views.free_course_pricing, 'lookup', side_effect=lookup), \
             patch.object(views.free_course_pricing, 'payload', side_effect=payload), \
             patch.object(views.free_course_pricing, 'save', side_effect=AssertionError('writer forbidden')) as writer:
            result = self.compare('authoring_catalogue_summaries')
            half = len(events) // 2
            self.assertEqual(events[:half], events[half:])
            self.assertEqual(result['MOD-ONE']['price'], 0)
            writer.assert_not_called()
