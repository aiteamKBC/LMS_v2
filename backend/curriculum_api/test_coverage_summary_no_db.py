from collections import Counter
from unittest.mock import patch

from django.core.cache.backends.locmem import LocMemCache
from django.test import RequestFactory, SimpleTestCase

from . import views
from .ksb_coverage import build_coverage, build_coverage_summary


class CoverageSummaryTests(SimpleTestCase):
    def test_grouped_summary_matches_full_weights_occurrences_and_sources(self):
        modules = [{'module_catalogue_id': 'M1', 'title': 'Module'}]
        rows = [
            {'module_catalogue_id': 'M1', 'ksb_code': code, 'source_type': 'standard', 'source_id': source, 'weight': weight}
            for code, source, weight in [('K1', 'S1', .125), ('K1', 'S1', .125), ('K2', 'S1', 0), ('K1', 'S2', 5)]
        ]
        counts = Counter((row['ksb_code'], row['source_id'], row['weight']) for row in rows)
        grouped = [{'module_catalogue_id': 'M1', 'ksb_code': code, 'source_type': 'standard', 'source_id': source, 'weight': weight, '_stats_count': count}
                   for (code, source, weight), count in counts.items()]
        for required in ([], [{'code': code, 'source_type': 'standard', 'source_id': 'S1'} for code in ['K1', 'K2', 'K3']]):
            full = build_coverage(required, rows, modules, [], [], include_mapping_only=not required)
            summary = build_coverage_summary(required, grouped, include_mapping_only=not required)
            fields = ('coverage_key', 'code', 'source_type', 'source_id', 'raw_total_weight', 'occurrence_count')
            self.assertEqual([{k: item[k] for k in fields} for item in summary['items']],
                             [{k: item[k] for k in fields} for item in full['items']])

    def test_summary_and_detail_use_separate_epoch_cache_entries(self):
        cache = LocMemCache('coverage-summary-regression', {})
        cache.clear()
        factory = RequestFactory()
        with patch.object(views, '_CURRICULUM_CACHE', {}), patch.object(views, 'cache', cache), \
                patch.object(views, 'shared_curriculum_epoch', return_value=1) as epoch, \
                patch.object(views, '_coverage_response_uncached', side_effect=lambda request, *args: views.JsonResponse({'view': request.GET.get('view', 'full')})) as build:
            summary = factory.get('/?view=summary')
            full = factory.get('/')
            first = views.coverage_endpoint_response(summary, 'programme', 'P1')
            detailed = views.coverage_endpoint_response(full, 'programme', 'P1')
            warm = views.coverage_endpoint_response(factory.get('/?view=summary', HTTP_IF_NONE_MATCH=first['ETag']), 'programme', 'P1')
            self.assertNotEqual(first['ETag'], detailed['ETag'])
            self.assertEqual(warm.status_code, 304)
            self.assertEqual(build.call_count, 2)
            epoch.return_value = 2
            views.coverage_endpoint_response(summary, 'programme', 'P1')
            self.assertEqual(build.call_count, 3)

