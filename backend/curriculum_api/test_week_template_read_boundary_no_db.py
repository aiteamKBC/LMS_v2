"""Week-template parity against actual frozen functions; no DB or providers."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/week_templates_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_week_template_reads():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-week-template-read>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class WeekTemplateReadParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.factory = RequestFactory()
        self.events = []
        self.guard = self.stack.enter_context(composition_fixture(views, 'ensure_week_template_tables'))
        self.stack.enter_context(composition_fixture(views, 'table_name', side_effect=lambda name: 'curriculum.'+name))
        self.rows = [{'id': 'T', 'title': 'محتوى 🙂', 'status': 'draft'},
                     {'id': 'OLD', 'status': 'inactive'}, {'id': 'ARCHIVED', 'status': 'archived'},
                     {'id': 'STAMP', 'status': 'draft', 'deleted_at': '2026-01-01'}]
        def fetch(query, params):
            self.events.append((query, deepcopy(params)))
            return deepcopy(self.rows)
        self.read = self.stack.enter_context(composition_fixture(views, 'fetch_all', side_effect=fetch))

    def compare(self, name, *args, **kwargs):
        self.events.clear()
        with original_week_template_reads():
            expected = getattr(views, name)(*args, **kwargs)
        expected_events = deepcopy(self.events)
        self.events.clear()
        entry = SNAPSHOT[name]
        owner = importlib.import_module(entry['module'])
        symbol = entry.get('new_name', name)
        with observe_export(views, owner, symbol, wraps=getattr(owner, symbol)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(self.events, expected_events)
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_rows_archive_filter_scope_parameters_and_include_deleted(self):
        self.assertEqual([r['id'] for r in self.compare('get_week_template_rows', 'programme_id = %s', ['P'])], ['T'])
        self.assertEqual(self.events, [('select * from curriculum.week_templates where programme_id = %s order by updated_at desc', ['P'])])
        self.assertEqual(self.compare('get_week_template_rows', include_deleted=True), self.rows)
        self.assertEqual(self.events[0], ('select * from curriculum.week_templates order by updated_at desc', []))

    def test_single_row_uses_existing_first_row_and_missing_semantics(self):
        self.assertEqual(self.compare('get_week_template_row', 'T')['id'], 'T')
        self.assertEqual(self.events[0][1], ['T'])
        self.rows = []
        self.assertIsNone(self.compare('get_week_template_row', 'MISSING'))
        self.rows = [{'id': 'T', 'deleted_at': '2026-01-01'}]
        self.assertIsNone(self.compare('get_week_template_row', 'T'))
        self.assertEqual(self.compare('get_week_template_row', 'T', include_deleted=True), self.rows[0])

    def test_component_reader_preserves_template_scope_and_order_sql(self):
        self.rows = [{'id': 'C2'}, {'id': 'C1'}]
        self.assertEqual(self.compare('get_week_template_component_rows', ' T '), self.rows)
        self.assertEqual(self.events, [('select * from curriculum.week_template_components where week_template_id = %s order by display_order asc', [' T '])])

    def test_read_and_schema_errors_propagate_without_fabricated_empty_results(self):
        for dependency in (self.read, self.guard):
            dependency.side_effect = RuntimeError('synthetic read unavailable')
            for name in ('get_week_template_rows', 'get_week_template_component_rows'):
                args = () if name == 'get_week_template_rows' else ('T',)
                with original_week_template_reads(), self.assertRaisesRegex(RuntimeError, 'synthetic read unavailable'):
                    getattr(views, name)(*args)
                with self.assertRaisesRegex(RuntimeError, 'synthetic read unavailable'):
                    getattr(views, name)(*args)
            dependency.side_effect = None

    def test_component_json_numbers_nulls_flags_and_no_mutation(self):
        for settings in ({'body': 'محتوى 🙂'}, '{"body":"text"}', 'invalid', '[1]', None):
            row = {'id': 'C', 'week_template_id': 'T', 'type': 'reading', 'title': None,
                   'expected_otjh': Decimal('1.125'), 'points': '3', 'settings_json': settings,
                   'ksb_mappings': '["K1"]', 'display_order': '2', 'coach_validation_required': None}
            before = deepcopy(row)
            actual = self.compare('week_template_component_payload', row)
            self.assertEqual((actual['expectedOtjh'], actual['points'], actual['displayOrder']), (1.125, 3, 2))
            self.assertTrue(actual['coachValidationRequired'])
            self.assertEqual(actual['ksbMappings'], ['K1'])
            self.assertEqual(row, before)

    def test_reflection_column_priority_and_existing_settings_compatibility(self):
        column = views.WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN
        key = views.LEGACY_REFLECTION_QUESTION_SETTING
        for direct, legacy, expected in [(' column ', 'legacy', 'column'), (' \t', ' legacy ', 'legacy'),
                                          (None, 'legacy', 'legacy'), ('', None, '')]:
            row = {column: direct, 'settings_json': {key: legacy}}
            self.assertEqual(self.compare('week_template_component_payload', row)['reflectionQuestion'], expected)

    def test_header_payload_stored_totals_and_component_order_preserved(self):
        row = {'id': 'T', 'title': 'Synthetic', 'total_otjh': Decimal('2.25'), 'points': '8', 'component_count': 7,
               'learning_outcomes': '["Outcome"]', 'course_type': 'free', 'programme_id': None,
               'created_at': datetime(2026, 1, 1, tzinfo=timezone.utc)}
        components = [{'id': 'B', 'expected_otjh': 9}, {'id': 'A'}]
        actual = self.compare('week_template_payload', row, components)
        self.assertEqual((actual['totalOtjh'], actual['points'], actual['componentCount']), (2.25, 8, 7))
        self.assertEqual([c['id'] for c in actual['components']], ['B', 'A'])
        self.assertEqual(actual['programmeId'], '')
        self.assertEqual(self.compare('week_template_payload', {})['status'], 'draft')
        self.assertEqual(self.compare('week_template_payload', {})['components'], [])

    def test_collection_filters_search_count_and_no_component_reads(self):
        self.rows = [{'id': 'T', 'title': 'Read One', 'status': 'draft'}, {'id': 'X', 'title': 'Other'}]
        request = self.factory.get('/synthetic/', {'courseType': ' PAID ', 'programmeId': ' P ',
            'moduleCatalogueId': ' M ', 'groupId': ' G ', 'status': ' draft ', 'search': ' READ '})
        actual = self.compare('curriculum_week_template_collection', request)
        data = json.loads(actual.content)
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['id'], 'T')
        self.assertEqual(data['results'][0]['components'], [])
        self.assertEqual(self.events, [('select * from curriculum.week_templates where course_type = %s and programme_id = %s and module_catalogue_id = %s and group_id = %s and status = %s order by updated_at desc', ['paid', 'P', 'M', 'G', 'draft'])])

    def test_collection_unknown_course_filter_and_empty_search_preserve_contract(self):
        request = self.factory.get('/synthetic/', {'courseType': 'unknown', 'search': ' \u3000'})
        actual = self.compare('curriculum_week_template_collection', request)
        self.assertEqual(json.loads(actual.content)['count'], 1)
        self.assertEqual(self.events[0][1], [])

    def test_record_read_and_after_write_order_match_actual_old_code(self):
        events = []
        with composition_fixture(views, 'week_template_revision', side_effect=lambda ident: events.append('revision') or 'token'), \
             composition_fixture(views, 'get_week_template_row', side_effect=lambda ident: events.append('row') or {'id': ident}), \
             composition_fixture(views, 'get_week_template_component_rows', side_effect=lambda ident: events.append('components') or []):
            for after_write, expected in ((False, ['revision', 'row', 'components']), (True, ['row', 'components', 'revision'])):
                events.clear()
                actual = self.compare('week_template_record', 'T', after_write=after_write)
                self.assertEqual(events, expected * 2)
                self.assertEqual(actual['revision'], 'token')

    def test_record_missing_unavailable_and_detail_response_contracts(self):
        with composition_fixture(views, 'week_template_revision', return_value='') as revision, \
             composition_fixture(views, 'get_week_template_row', return_value=None) as row, \
             composition_fixture(views, 'get_week_template_component_rows', return_value=[]) as components:
            self.assertIsNone(self.compare('week_template_record', 'T'))
            revision.reset_mock()
            self.assertIsNone(self.compare('week_template_record', 'T', after_write=True))
            revision.assert_not_called()
            components.assert_not_called()
            self.assertEqual(views.week_template_detail_response('T').status_code, 404)
            row.return_value = {'id': 'T'}
            self.assertEqual(self.compare('week_template_record', 'T')['revision'], 'unverified')
            response = views.week_template_detail_response('T', wrapper_key='template', after_write=True, updated=True)
            self.assertEqual(json.loads(response.content)['template']['revision'], 'unverified')
            self.assertTrue(json.loads(response.content)['updated'])


if __name__ == '__main__':
    raise SystemExit('Run only through the isolated Django fixture harness.')
