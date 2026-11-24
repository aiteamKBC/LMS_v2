"""Compare the actual original KSB implementations with their extracted owners."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
import unittest
from unittest.mock import Mock, patch

from django.core.cache import cache
from django.http import HttpResponse
from django.test import SimpleTestCase

from . import views, ksb_stats_reads
from . import test_programme_ksb_source_no_db as source_cases
from . import test_programme_ksb_design_cache_no_db as design_cases
from . import test_ksb_stats_latency_no_db as stats_cases
from .reporting.application import programme_statistics, source_catalogue
from .reporting.domain import programme_statistics as rules

ROOT = Path(__file__).parent / 'reporting'
SNAPSHOTS = (
    (views, json.loads((ROOT / 'tests/fixtures/legacy_snapshots/statistics_snapshot.json').read_text(encoding='utf-8'))),
    (ksb_stats_reads, json.loads((ROOT / 'tests/fixtures/legacy_snapshots/statistics_reads_snapshot.json').read_text(encoding='utf-8'))),
)


@contextmanager
def original_statistics():
    """Restore original bodies against real module globals and existing fixture ports."""
    with ExitStack() as stack:
        stack.enter_context(patch.object(ksb_stats_reads, 'views', views, create=True))
        for module, snapshot in SNAPSHOTS:
            for name, entry in snapshot.items():
                if isinstance(getattr(module, name), Mock):
                    continue
                namespace = dict(vars(module))
                exec(compile(entry['source'], '<original-ksb-statistics>', 'exec'), namespace)
                original = namespace[name]
                restored = FunctionType(original.__code__, vars(module), name, original.__defaults__)
                restored.__kwdefaults__ = original.__kwdefaults__
                for decorator in reversed(entry['decorators']):
                    restored = eval(decorator, vars(module))(restored)
                stack.enter_context(composition_fixture(module, name, restored))
        yield


def value(result):
    if isinstance(result, HttpResponse):
        return result.status_code, result.content, dict(result.items())
    return deepcopy(result)


@contextmanager
def capture_results():
    results = []
    def record(label, function):
        def call(*args, **kwargs):
            result = function(*args, **kwargs)
            results.append((label, value(result)))
            return result
        return call
    with ExitStack() as stack:
        for module, snapshot in SNAPSHOTS:
            for name in snapshot:
                if name == 'forced_programme_ksb_design':
                    continue  # The generator lifetime is covered by the force/cache fixtures.
                stack.enter_context(composition_fixture(module, name, record(module.__name__ + '.' + name, getattr(module, name))))
        yield results


class StatisticsFixtureParity(SimpleTestCase):
    """Original-source result traces, with every existing assertion retained."""


def parity_case(case, method):
    def test(self):
        def run():
            # Compare the same cold state; individual cases still exercise warm
            # and forced reads inside their own assertions.
            cache.clear()
            views.cache_state._CURRICULUM_CACHE.clear()
            with capture_results() as records:
                result = unittest.TestResult()
                case(method).run(result)
            self.assertTrue(result.wasSuccessful(), str(result.errors + result.failures))
            self.assertEqual(result.skipped, [])
            return records
        current = run()
        with original_statistics():
            original = run()
        self.assertEqual(current, original)
        self.assertTrue(current)
    return test


for case in (
    source_cases.StoredSourceReaderTests, source_cases.AppliedProfileTests,
    source_cases.ProgrammeCardLabelTests, source_cases.CoverageSourceTests,
    source_cases.AchievementSourceTests, design_cases.ProgrammeKsbDesignCacheTests,
    stats_cases.StatsScopeTests, stats_cases.LearnerProgressStatsTests,
    stats_cases.KsbStatsResponseTests,
):
    for method in unittest.defaultTestLoader.getTestCaseNames(case):
        if case is stats_cases.StatsScopeTests and method == 'test_projection_keeps_duplicate_delivery_selection_and_deletion_flags':
            continue  # The existing non-PostgreSQL projection test runs separately; it calls no extracted owner.
        setattr(StatisticsFixtureParity, 'test_' + case.__name__ + '_' + method[5:], parity_case(case, method))
del case, method


class SourceAndStatisticsContracts(SimpleTestCase):
    def compare(self, call):
        current = value(call())
        with original_statistics():
            original = value(call())
        self.assertEqual(current, original)
        return current

    def test_standard_index_definitions_and_alias_collision_order_match(self):
        rows = [
            {'id': 1, 'standard_ref': 'ST1', 'standard_version': '1.0', 'standard_title': 'Synthetic standard', 'ksb_code': 'K10', 'ksb_type': 'knowledge'},
            {'id': 2, 'standard_ref': 'ST1', 'standard_version': '1.0', 'standard_title': 'Synthetic standard', 'ksb_code': 'K2', 'ksb_type': 'knowledge'},
            {'id': 3, 'standard_ref': 'ST1', 'standard_version': '2.0', 'standard_title': 'Synthetic standard', 'ksb_code': 'S1', 'ksb_type': 'skill'},
        ]
        with composition_fixture(views, 'get_skills_england_ksb_rows', return_value=rows):
            built = self.compare(views.build_skills_england_standards)
            self.assertEqual([item['code'] for item in built[0]['ksbs']], ['K2', 'K10'])
            for identifier in ('ST1', ' st1 ', 'st1-v1-0', 'synthetic-standard', 'missing'):
                with self.subTest(identifier=identifier):
                    self.compare(lambda: views.find_skills_england_standard(identifier))
            self.assertEqual(views.find_skills_england_standard('ST1')['version'], '1.0')
            self.compare(lambda: views.required_ksbs_for_source('standard', ''))

    def test_mapping_source_enrichment_keeps_explicit_values_cache_and_identity(self):
        module = {'module_catalogue_id': 'M', 'ksb_profile_source_id': 'standard:STD', 'programme_name': 'Synthetic'}
        explicit = {'module_catalogue_id': 'M', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'OTHER'}
        inferred = {'module_catalogue_id': 'M', 'ksb_code': 'k1'}
        missing = {'module_catalogue_id': 'X', 'ksb_code': 'K9'}
        with composition_fixture(views, 'required_ksbs_for_source', return_value=[{'code': 'K1'}]) as source:
            result = self.compare(lambda: views.mappings_with_inferred_sources([explicit, inferred, inferred, missing], [module]))
            self.assertEqual(result[0], explicit)
            self.assertEqual([item.get('source_id') for item in result], ['OTHER', 'STD', 'STD', None])
            self.assertEqual(source.call_count, 2)  # One per original/new build, shared by duplicate rows.
            self.assertNotIn('source_id', inferred)

    def test_no_source_is_mapping_only_and_removed_framework_has_no_required_set(self):
        self.assertEqual(self.compare(lambda: views.required_ksbs_for_resolved_source('', '', 'all-profiles')), [])
        self.assertEqual(self.compare(lambda: views.required_ksbs_for_source('framework', 'gone')), [])
        self.assertEqual(self.compare(lambda: views.split_ksb_source('skills_england', '\tstandard:ST1\u3000')), ('standard', 'ST1'))

    def test_new_application_and_domain_owners_are_actually_called(self):
        with composition_fixture(views, 'authoring_scope_data', return_value=([{'module_catalogue_id': 'M'}], [], [], [{'module_catalogue_id': 'M', 'component_id': 'C', 'ksb_code': 'K1'}])), \
             patch.object(programme_statistics, 'mapped_ksb_count', wraps=rules.mapped_ksb_count) as domain, \
             patch.object(programme_statistics, '_programme_component_ksb_mapping_count', wraps=programme_statistics._programme_component_ksb_mapping_count) as application:
            self.assertEqual(views._programme_component_ksb_mapping_count('P', {'K1'}), 1)
            self.assertEqual(application.call_count, 1)
            self.assertEqual(domain.call_count, 1)
        with composition_fixture(views, 'get_skills_england_ksb_rows', return_value=[]), \
             patch.object(source_catalogue, 'build_skills_england_standards', wraps=source_catalogue.build_skills_england_standards) as build:
            self.assertEqual(views.build_skills_england_standards(), [])
            self.assertEqual(build.call_count, 1)

    def test_force_state_is_restored_after_nested_reads_and_exceptions(self):
        def run():
            seen = []
            try:
                with views.forced_programme_ksb_design(True):
                    with views.forced_programme_ksb_design(False):
                        seen.append(views._PROGRAMME_KSB_DESIGN_FORCE.on)
                        raise ValueError('synthetic failure')
            except ValueError:
                pass
            seen.append(views._PROGRAMME_KSB_DESIGN_FORCE.on)
            return seen
        self.assertEqual(self.compare(run), [True, False])
