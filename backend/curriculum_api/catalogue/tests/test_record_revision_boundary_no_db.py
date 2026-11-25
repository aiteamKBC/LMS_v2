"""Actual original/new record-read parity, with synthetic storage capabilities."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/record_revisions_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_record_reads():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-record-read>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        # The real dispatch table captures functions at import time. Point the
        # old run at its restored functions, while retaining test-supplied ports.
        readers = {kind: getattr(views, fn.__name__) if not isinstance(fn, Mock)
                   and getattr(fn, '__name__', None) in SNAPSHOT else fn
                   for kind, fn in views.CURRICULUM_RECORD_REVISIONS.items()}
        stack.enter_context(composition_fixture(views, 'CURRICULUM_RECORD_REVISIONS', readers))
        yield


class RecordReadBoundaryParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.factory = RequestFactory()
        self.guard = self.stack.enter_context(composition_fixture(views, 'ensure_module_authoring_tables'))
        self.week_guard = self.stack.enter_context(composition_fixture(views, 'ensure_week_template_tables'))
        self.logger = self.stack.enter_context(composition_fixture(views, 'logger'))
        self.config = self.stack.enter_context(composition_fixture(views, 'programme_config_by_identifier',
            return_value={'programme_id': 'P', 'name': 'Synthetic', 'color': '#123456'}))
        self.key = self.stack.enter_context(composition_fixture(views, 'programme_config_key_column', return_value='programme_id'))
        self.events = []
        self.rows = {'programmes': [{'programme_id': 'P', 'name': 'Synthetic'}],
                     views.COHORT_AUTHORING_DETAILS_TABLE: [{'cohort_id': 'C'}],
                     views.GROUPS_TABLE: [{'group_id': 'G'}],
                     views.WEEK_TEMPLATES_TABLE: [{'id': 'T'}],
                     views.WEEK_TEMPLATE_COMPONENTS_TABLE: [{'id': 'B'}, {'id': 'A'}]}
        def read(table, where, params, **kwargs):
            self.events.append((table, where, deepcopy(params), deepcopy(kwargs)))
            return deepcopy(self.rows.get(table, []))
        self.read = self.stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=read))

    def compare(self, name, *args, **kwargs):
        self.events.clear()
        with original_record_reads():
            expected = getattr(views, name)(*args, **kwargs)
        before = deepcopy(self.events)
        self.events.clear()
        entry = SNAPSHOT[name]
        owner = importlib.import_module(entry['module'])
        with observe_export(views, owner, entry['new_name'], wraps=getattr(owner, entry['new_name'])) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(self.events, before)
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_programme_identity_source_and_failure_boundaries(self):
        self.assertEqual(len(self.compare('programme_record_revision', 'program-synthetic')), 32)
        self.assertEqual(self.events[0][:3], ('programmes', '"programme_id" = %s', ['P']))
        for config in (None, {}, {'programme_id': ''}, {'programme_id': ' \u3000'}):
            self.config.return_value = config
            self.assertEqual(self.compare('programme_record_revision', 'P'), '')
            self.assertEqual(self.events, [])
        self.config.return_value = {'programme_id': 'P'}
        self.key.side_effect = RuntimeError('synthetic metadata failure')
        self.assertEqual(self.compare('programme_record_revision', 'P'), '')
        self.assertEqual(self.logger.warning.call_count, 2)

    def test_cohort_and_group_scope_identifier_normalization_and_empty_inputs(self):
        for name, table, key, ident in (('cohort_record_revision', views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', 'C'),
                                        ('group_record_revision', views.GROUPS_TABLE, 'group_id', 'G')):
            self.assertTrue(self.compare(name, '\u00a0'+ident+'\t'))
            self.assertEqual(self.events[0][:3], (table, key+' = %s', [ident]))
            for value in (None, '', ' \u3000'):
                self.assertEqual(self.compare(name, value), '')
                self.assertEqual(self.events, [])

    def test_template_header_and_components_both_contribute(self):
        initial = self.compare('week_template_revision', ' T ')
        self.assertEqual([e[:3] for e in self.events], [(views.WEEK_TEMPLATES_TABLE, 'id = %s', ['T']),
            (views.WEEK_TEMPLATE_COMPONENTS_TABLE, 'week_template_id = %s', ['T'])])
        self.rows[views.WEEK_TEMPLATE_COMPONENTS_TABLE].reverse()
        self.assertEqual(self.compare('week_template_revision', 'T'), initial)
        self.rows[views.WEEK_TEMPLATE_COMPONENTS_TABLE][0]['title'] = 'Changed'
        self.assertNotEqual(self.compare('week_template_revision', 'T'), initial)
        self.rows[views.WEEK_TEMPLATES_TABLE] = []
        self.assertEqual(self.compare('week_template_revision', 'T'), '')
        self.assertEqual(len(self.events), 1)

    def test_module_alias_resolution_and_shared_builder_revision(self):
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='M') as resolve, \
             composition_fixture(views, 'module_structure_revision', return_value='structure-token') as revision:
            self.assertEqual(self.compare('module_record_revision', ' legacy '), 'structure-token')
            resolve.assert_called_with('legacy')
            revision.assert_called_with('M')
            resolve.return_value = None
            self.compare('module_record_revision', ' unresolved ')
            revision.assert_called_with('unresolved')
            resolve.reset_mock()
            self.assertEqual(self.compare('module_record_revision', ''), '')
            resolve.assert_not_called()

    def test_dispatch_unknown_empty_and_exception_contract(self):
        read = Mock(return_value='token')
        with composition_fixture(views, 'CURRICULUM_RECORD_REVISIONS', {'cohort': read}):
            self.assertEqual(self.compare('curriculum_record_revision', 'unknown', 'C'), '')
            read.assert_not_called()
            self.assertEqual(self.compare('curriculum_record_revision', 'cohort', 'C'), 'token')
            read.return_value = None
            self.assertEqual(self.compare('curriculum_record_revision', 'cohort', 'C'), '')
            read.side_effect = RuntimeError('synthetic unavailable')
            self.assertEqual(self.compare('curriculum_record_revision', 'cohort', 'C'), '')
        self.assertEqual(self.logger.warning.call_count, 2)

    def test_read_failures_do_not_return_successful_revision(self):
        self.read.side_effect = RuntimeError('synthetic table unavailable')
        self.assertEqual(self.compare('cohort_record_revision', 'C'), '')
        self.assertEqual(self.compare('record_revision', [('cohort', 'cohorts', '', [], 'cohort_id')]), '')
        self.assertEqual(self.logger.warning.call_count, 4)

    def test_revisions_http_contract_order_deduplication_unknown_and_methods(self):
        request = self.factory.get('/synthetic/', [('cohort', ' C '), ('cohort', 'C'), ('cohort', ''),
            ('group', 'G'), ('unknown', 'ignored')])
        actual = self.compare('curriculum_record_revisions', request)
        payload = json.loads(actual.content)['revisions']
        self.assertEqual(list(payload), ['cohort', 'group'])
        self.assertEqual(list(payload['cohort']), ['C'])
        self.assertTrue(payload['cohort']['C'])
        self.assertEqual(len(self.events), 2)
        self.assertEqual(views.curriculum_record_revisions(self.factory.post('/synthetic/')).status_code, 405)

    def test_cohort_conflict_json_lists_defaults_and_missing_row(self):
        row = {'cohort_id': 'C', 'holiday_ids': '["h1"]', 'excluded_holiday_ids': 'invalid', 'cohort_name': 'Synthetic'}
        with composition_fixture(views, 'fetch_cohort_row', return_value=row) as fetch, \
             composition_fixture(views, 'curriculum_cohort_from_authoring_detail', side_effect=lambda r: r):
            actual = self.compare('cohort_conflict_record', 'C')
            self.assertEqual(actual['holiday_ids'], ['h1'])
            self.assertEqual(actual['excluded_holiday_ids'], [])
            self.assertEqual(row['holiday_ids'], '["h1"]')
            fetch.return_value = None
            self.assertIsNone(self.compare('cohort_conflict_record', 'C'))

    def test_group_conflict_uses_existing_projection_and_preserves_missing(self):
        row = {'group_id': 'G', 'session_week_day': 'Tuesday'}
        with composition_fixture(views, 'fetch_group_row', return_value=row) as fetch, \
             composition_fixture(views, 'curriculum_group_from_authoring_detail', return_value={'id': 'G', 'weekDays': 'Tuesday'}) as project:
            self.assertEqual(self.compare('group_conflict_record', 'G'), {'id': 'G', 'weekDays': 'Tuesday'})
            project.assert_called_with(row)
            fetch.return_value = None
            self.assertIsNone(self.compare('group_conflict_record', 'G'))

    def test_programme_conflict_omits_rollups_and_uses_existing_identity(self):
        self.config.return_value = {'programme_id': 'P', 'name': 'Synthetic', 'level': None, 'description': '',
                                   'color': None, 'learnerCount': 999}
        actual = self.compare('programme_conflict_record', 'P')
        self.assertEqual(actual, {'id': 'P', 'sourceId': 'P', 'name': 'Synthetic', 'level': '', 'description': '', 'color': ''})
        self.config.return_value = None
        self.assertIsNone(self.compare('programme_conflict_record', 'P'))

    def test_unchanged_409_adapter_with_and_without_readable_current_record(self):
        record = self.compare('programme_conflict_record', 'P')
        response = views.record_conflict_response('old', 'new', programme=record)
        data = json.loads(response.content)
        self.assertEqual(response.status_code, 409)
        self.assertEqual((data['expectedRevision'], data['currentRevision'], data['programme']), ('old', 'new', record))
        self.assertTrue(data['conflict'])
        unavailable = views.record_conflict_response('old', '', programme=record)
        self.assertEqual(unavailable.status_code, 409)
        self.assertNotIn('programme', json.loads(unavailable.content))
