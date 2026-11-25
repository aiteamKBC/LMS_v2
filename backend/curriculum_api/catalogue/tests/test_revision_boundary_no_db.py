"""Actual pre-extraction/new revision parity with synthetic rows and read ports."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/revisions_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_revisions():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-structure-revision>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class RevisionBoundaryParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.rows = {table: [] for _, table, _, _ in views.STRUCTURE_REVISION_SOURCES}
        self.rows[views.AUTHORING_MODULES_TABLE] = [{'module_catalogue_id': 'M', 'title': 'Synthetic'}]
        self.rows[views.AUTHORING_WEEKS_TABLE] = [
            {'id': 'W2', 'module_catalogue_id': 'M', 'status': 'active'},
            {'id': 'W1', 'module_catalogue_id': 'M', 'status': 'active'},
            {'id': 'W0', 'module_catalogue_id': 'M', 'status': 'inactive'},
        ]
        self.rows[views.AUTHORING_COMPONENTS_TABLE] = [
            {'id': 'C1', 'status': 'active', 'settings_json': {'body': 'محتوى 🙂'}, 'updated_at': 'old'},
            {'id': 'C2', 'status': 'inactive', 'settings_json': {'body': 'hidden'}},
        ]
        self.rows[views.AUTHORING_KSB_MAPPINGS_TABLE] = [{'id': 'K1', 'status': 'active', 'ksb_code': 'K1'}]
        self.events = []
        self.guard = self.stack.enter_context(composition_fixture(views, 'ensure_module_authoring_tables'))
        self.connection = self.stack.enter_context(composition_fixture(views, 'connection', vendor='postgresql'))
        self.columns = self.stack.enter_context(composition_fixture(views, 'column_names', return_value=set()))
        self.logger = self.stack.enter_context(composition_fixture(views, 'logger'))
        def reader(kind):
            def read(table, *args, **kwargs):
                self.events.append((kind, table, deepcopy(args), deepcopy(kwargs)))
                return deepcopy(self.rows[table])
            return read
        self.fetch = self.stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=reader('regular')))
        self.compact = self.stack.enter_context(patch('curriculum_api.authoring_read_transport.compact_authoring_rows', side_effect=reader('compact')))

    def compare(self, name, *args, **kwargs):
        before = deepcopy((args, kwargs, self.rows))
        self.events.clear()
        with original_revisions():
            expected = getattr(views, name)(*args, **kwargs)
        expected_events = deepcopy(self.events)
        self.events.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(self.events, expected_events)
        self.assertEqual((args, kwargs, self.rows), before)
        return actual

    def test_fresh_and_supplied_rows_portable_and_postgresql_parity(self):
        expected = None
        for vendor in ('sqlite', 'postgresql'):
            self.connection.vendor = vendor
            revision = self.compare('module_structure_revision', ' \u3000M\t')
            self.assertTrue(revision)
            self.assertEqual(revision, expected or revision)
            expected = revision
            self.assertEqual(len(self.events), 6)
            self.assertEqual(sum(e[0] == 'compact' for e in self.events), 2 if vendor == 'postgresql' else 0)
            self.assertEqual(self.compare('module_structure_revision', 'M', source_rows=self.rows), expected)
            self.assertEqual(self.events, [])

    def test_deleted_rows_timestamps_and_database_order_do_not_change_revision(self):
        expected = self.compare('module_structure_revision', 'M')
        self.rows[views.AUTHORING_WEEKS_TABLE].reverse()
        self.rows[views.AUTHORING_COMPONENTS_TABLE][0]['updated_at'] = 'later'
        self.rows[views.AUTHORING_COMPONENTS_TABLE][1]['settings_json'] = {'body': 'deleted changed'}
        self.assertEqual(self.compare('module_structure_revision', 'M'), expected)
        self.rows[views.AUTHORING_COMPONENTS_TABLE][1]['status'] = 'archived'
        self.assertEqual(self.compare('module_structure_revision', 'M'), expected)
        self.rows[views.AUTHORING_COMPONENTS_TABLE].extend([
            {'id': 'C3', 'deleted_at': '2026-01-01', 'status': 'active'},
            {'id': 'C4', 'type': 'workplace_evidence', 'status': 'active'},
        ])
        self.assertEqual(self.compare('module_structure_revision', 'M'), expected)
        self.rows[views.AUTHORING_COMPONENTS_TABLE][0]['settings_json']['body'] = 'edited'
        self.assertNotEqual(self.compare('module_structure_revision', 'M'), expected)

    def test_physical_column_projection_and_metadata_failure_compatibility(self):
        self.columns.return_value = {'id', 'module_catalogue_id', 'title', 'status', 'settings_json'}
        expected = self.compare('module_structure_revision', 'M')
        self.rows[views.AUTHORING_MODULES_TABLE][0]['programme_name'] = 'derived'
        self.assertEqual(self.compare('module_structure_revision', 'M'), expected)
        self.columns.side_effect = RuntimeError('metadata unavailable')
        self.assertNotEqual(self.compare('module_structure_revision', 'M'), expected)

    def test_blank_missing_and_empty_source_states_remain_distinct(self):
        for module_id in (None, '', ' \t\u3000'):
            self.assertEqual(self.compare('module_structure_revision', module_id), '')
        self.guard.assert_not_called()
        self.rows = {table: [] for table in self.rows}
        empty = self.compare('module_structure_revision', 'missing', source_rows=self.rows)
        self.assertEqual(len(empty), 32)
        self.assertEqual(self.compare('module_structure_revision', 'M', source_rows={}), '')
        self.assertEqual(self.logger.warning.call_count, 2)

    def test_read_failure_contract_is_explicit_and_payload_is_unverified(self):
        self.compact.side_effect = RuntimeError('synthetic read failure')
        self.assertEqual(self.compare('module_structure_revision', 'M'), '')
        actual = self.compare('structure_payload_with_revision', lambda: {'id': 'M'}, 'M')
        self.assertEqual(actual, {'id': 'M', 'structureRevision': 'unverified'})
        for oracle in (True, False):
            with ExitStack() as stack:
                if oracle:
                    stack.enter_context(original_revisions())
                with self.assertRaisesRegex(RuntimeError, 'synthetic read failure'):
                    views.module_structure_source_rows('M')

    def test_schema_guard_failure_remains_outside_read_error_fallback(self):
        self.guard.side_effect = RuntimeError('schema guard refused')
        with original_revisions(), self.assertRaisesRegex(RuntimeError, 'schema guard refused'):
            views.module_structure_revision('M')
        with self.assertRaisesRegex(RuntimeError, 'schema guard refused'):
            views.module_structure_revision('M')
        self.fetch.assert_not_called()
        self.compact.assert_not_called()

    def test_six_source_queries_keep_original_scope_order_and_reuse_flags(self):
        self.assertEqual(self.compare('module_structure_source_rows', ' M '), self.rows)
        self.assertEqual(len(self.events), 6)
        self.assertTrue(all(e[2][0] == 'module_catalogue_id = %s' and e[2][1] == [' M '] for e in self.events))
        self.assertEqual([e[2][2] for e in self.events], ['module_catalogue_id', 'display_order, week_number, id',
            'display_order, id', 'created_at, id', 'module_catalogue_id', 'module_catalogue_id'])
        self.assertEqual([e[3]['reuse_unchanged'] for e in self.events], [False, False, True, True, False, False])

    def test_shared_rows_revision_before_payload_and_item_fingerprints(self):
        events = []
        payload = {'id': 'M', 'weekStructure': [{'id': 'W', 'components': [{'id': 'C', 'title': 'Synthetic'}]}]}
        shared = {}
        def revision(mid, *, source_rows):
            events.append('revision')
            shared['rows'] = source_rows
            return 'synthetic-revision'
        def build(mid, *, source_rows):
            events.append('payload')
            self.assertIs(source_rows, shared['rows'])
            return deepcopy(payload)
        with composition_fixture(views, 'module_structure_revision', side_effect=revision), \
             composition_fixture(views, 'get_authoring_structure_payload', side_effect=build):
            actual = self.compare('read_module_structure_with_revision', 'M')
        self.assertEqual(events, ['revision', 'payload'] * 2)
        self.assertEqual(actual['structureRevision'], 'synthetic-revision')
        self.assertEqual(set(actual['itemFingerprints']['components']), {'C'})
        self.assertEqual(len(self.events), 6)

    def test_item_fingerprints_and_empty_payload_contract(self):
        for payload in (None, {}, {'id': 'M', 'weekStructure': []},
                        {'weekStructure': [{'id': 'W', 'title': 'Week', 'components': [{'id': 'C', 'title': 'Text'}]}]}):
            self.compare('with_item_fingerprints', payload)
        for payload in (None, {}):
            self.assertIs(self.compare('structure_payload_with_revision', lambda: payload, 'M'), payload)
