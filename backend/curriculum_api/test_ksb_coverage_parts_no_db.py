"""Programme KSB coverage halves (``view=heatmap`` / ``view=items``), without a database.

The heatmap's cells and each item's mapping list are the same placements filed
two ways; each page reads one. Pins what each half keeps, that its placements
carry only the fields the pages read, that both are cut in one build without
the full document being encoded or cached, and that a plain request is
unchanged.
"""
import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views

# A placement as build_coverage serialises it (shortened): the fields the pages
# read, plus camelCase twins, the standard KSB text and source labels they do not.
SLIM = {'mapping_id': 'M1', 'module_name': 'Module A', 'week_name': 'Week 1', 'component_name': 'Intro',
        'component_type': 'video', 'component_otjh': 1.5, 'mapping_level': 'component', 'classification': 'main',
        'group_name': 'Group A', 'groups': ['Group A'], 'weight': 40}
MAPPING = {**SLIM, 'mappingId': 'M1', 'moduleName': 'Module A', 'componentName': 'Intro',
           'description': 'Knows things', 'source_label': 'ST0001', 'sourceLabel': 'ST0001', 'code': 'K1'}
FULL = {
    'scope': 'programme', 'identifier': 'PROG-1', 'summary': {'overall': {'required': 2}},
    'source': {'type': 'standard', 'id': 'st0001-v1-0'},
    'items': [
        {'code': 'K1', 'raw_total_weight': 40, 'occurrence_count': 1, 'mappings': [MAPPING]},
        {'code': 'K2', 'raw_total_weight': 0, 'occurrence_count': 0, 'mappings': []},
    ],
    'heatmap': {
        'modules': [{'module_id': 'MOD-A', 'module_name': 'Module A'}],
        'rows': [{'code': 'K1', 'total': 40, 'modules': [
            {'module_id': 'MOD-A', 'moduleId': 'MOD-A', 'module_name': 'Module A', 'weight': 40, 'mappings': [MAPPING]},
        ]}],
    },
}


class CoveragePartTests(SimpleTestCase):
    def test_heatmap_half_empties_the_item_mappings_and_keeps_the_rest(self):
        part = views.coverage_part(json.loads(json.dumps(FULL)), 'heatmap')
        self.assertEqual([item['mappings'] for item in part['items']], [[], []])
        self.assertEqual([item['occurrence_count'] for item in part['items']], [1, 0])
        # The heatmap's evidence never shows a mapping id or the component's
        # OTJH (only the items half's readers do), so its cells leave both out.
        heatmap_slim = {key: value for key, value in SLIM.items() if key not in {'mapping_id', 'component_otjh'}}
        self.assertEqual(part['heatmap'], {'modules': FULL['heatmap']['modules'], 'rows': [
            {'code': 'K1', 'total': 40, 'modules': [{'module_id': 'MOD-A', 'weight': 40, 'mappings': [heatmap_slim]}]},
        ]})
        self.assertTrue(part['mappingsOmitted'])
        self.assertTrue(part['placementFieldsOnly'])
        self.assertEqual((part['view'], part['summary'], part['source']), ('heatmap', FULL['summary'], FULL['source']))

    def test_items_half_empties_the_heatmap_rows_and_keeps_the_items(self):
        part = views.coverage_part(json.loads(json.dumps(FULL)), 'items')
        self.assertEqual(part['items'], [{**FULL['items'][0], 'mappings': [SLIM]}, FULL['items'][1]])
        self.assertEqual(part['heatmap'], {'modules': FULL['heatmap']['modules'], 'rows': []})
        self.assertTrue(part['placementFieldsOnly'])
        self.assertTrue(part['heatmapOmitted'])
        self.assertEqual(part['view'], 'items')


class CoverageEntryTests(SimpleTestCase):
    def setUp(self):
        self.store, self.builds = {}, []

        def cached(key, build, ttl=None, **kwargs):
            if key not in self.store:
                self.store[key] = build()
            return self.store[key]

        def uncached(request, scope, identifier):
            self.builds.append(request.GET.get('view'))
            return json.loads(json.dumps(FULL))

        for patcher in (mock.patch.object(views, 'cached_curriculum_value', side_effect=cached),
                        mock.patch.object(views, '_coverage_payload_uncached', side_effect=uncached)):
            patcher.start()
            self.addCleanup(patcher.stop)

    def _get(self, scope='programme', **params):
        request = RequestFactory().get('/x', params)
        return json.loads(views.coverage_response(request, scope, 'PROG-1').content)

    def test_plain_request_is_unchanged(self):
        self.assertEqual(self._get(), FULL)

    def test_both_halves_come_from_one_build_without_the_full_document(self):
        heatmap, items = self._get(view='heatmap'), self._get(view='items')
        self.assertEqual(len(self.builds), 1)
        self.assertEqual(heatmap, views.coverage_part(json.loads(json.dumps(FULL)), 'heatmap'))
        self.assertEqual(items, views.coverage_part(json.loads(json.dumps(FULL)), 'items'))
        # v4: the heatmap half's cells changed shape, so no v3 entry may be served.
        self.assertEqual(sorted(self.store), ['ksb-coverage-response:programme:PROG-1:::0:parts-v4'])
        self.assertEqual(self._get(), FULL)           # a plain request still gets the whole document
        self.assertEqual(len(self.builds), 2)

    def test_every_coverage_entry_is_rechecked_against_the_ksb_sources_past_its_ttl(self):
        seen = []

        def cached(key, build, ttl=None, **kwargs):
            seen.append((ttl, kwargs.get('fingerprint')))
            return build()

        with mock.patch.object(views, 'cached_curriculum_value', side_effect=cached):
            self._get(view='heatmap')
            self._get()
        self.assertEqual(seen, [(60, views.component_source_inputs_fingerprint)] * 2)

    def test_other_scopes_ignore_the_view(self):
        self.assertEqual(self._get(scope='module', view='heatmap'), FULL)

    def test_an_error_build_is_passed_through(self):
        with mock.patch.object(views, '_coverage_payload_uncached',
                               return_value=views.json_error('Programme not found.', status=404)):
            for view in views.COVERAGE_PART_VIEWS:
                response = views.coverage_response(RequestFactory().get('/x', {'view': view}), 'programme', 'NOPE')
                self.assertEqual(response.status_code, 404)
                self.assertEqual(json.loads(response.content), {'error': 'Programme not found.'})
