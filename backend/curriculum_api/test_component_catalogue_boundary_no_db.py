"""Component/library parity and authorized correctness fixes; synthetic data only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import placement_read_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
import sqlite3
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views
from . import test_structure_read_boundary_no_db as structure_fixtures

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/component_catalogue_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_component_catalogue():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-component-catalogue>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class ComponentCatalogueParity(SimpleTestCase):
    def setUp(self):
        self.fixture = structure_fixtures.StructureReadBoundaryParity()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(composition_fixture(views, 'ensure_module_authoring_tables'))

    def compare(self, name, *args, **kwargs):
        with original_component_catalogue():
            expected = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        called.assert_called_once()
        self.assertEqual(actual, expected)
        return actual

    def test_full_builder_preserves_known_parent_fields_mappings_order_and_counts(self):
        actual = self.compare('component_builder_rows', [' M1 ', 'M1'])
        self.assertEqual([row['id'] for row in actual], ['C1', 'C2'])
        self.assertEqual(actual[0]['week'], 'Week 1')
        self.assertEqual(actual[0]['ksbRefs'], ['K2'])

    def test_unsupported_sql_projection_falls_back_to_equivalent_full_read(self):
        with composition_fixture(views, 'live_component_rows_without_content', return_value=None):
            for programme in (False, True):
                result = self.compare('component_builder_rows', ['M1'], omit_content=True, programme_view=programme)
                self.assertNotIn('readingContent', result[0]['settings'])
                self.assertTrue(result[0]['settingsOmitted'])

    def test_sql_projection_and_missing_content_markers_preserve_save_guards(self):
        def stripped(*args, **kwargs):
            rows = deepcopy(self.fixture.rows[views.AUTHORING_COMPONENTS_TABLE])
            rows[0]['settings_json'] = {}
            rows[0][views.COMPONENT_DB_OMITTED_KEYS_COLUMN] = ['readingContent']
            return rows
        with composition_fixture(views, 'live_component_rows_without_content', side_effect=stripped):
            for programme in (False, True):
                result = self.compare('component_builder_rows', ['M1'], omit_content=True, programme_view=programme)
                self.assertTrue(views.partial_read_errors(result[0]))

    def test_unknown_weeks_no_longer_claim_week_one_but_keep_identity(self):
        row = {'id': 'C-MISSING', 'module_catalogue_id': 'M1', 'week_id': 'W-MISSING', 'type': 'reading'}
        with original_component_catalogue():
            old = views.component_builder_response(row)
        actual = views.component_builder_response(row)
        self.assertEqual((old['week'], old['weekTitle']), ('Week 1', 'Week 1'))
        self.assertEqual((actual['week'], actual['weekTitle']), ('', ''))
        self.assertEqual(actual['weekId'], 'W-MISSING')
        old.update(week='', weekTitle='')
        self.assertEqual(actual, old)
        for week, label in (({}, ''), ({'week_number': 0}, ''), ({'week_number': 3}, 'Week 3'), ({'title': 'Induction'}, 'Induction')):
            self.assertEqual(views.component_week_label(week), label)

    def test_sorting_and_partial_projections_leave_cached_rows_unchanged(self):
        rows = [{'id': 'A', 'updated_at': None, 'settings': {'readingContent': 'body', 'videoUrl': 'synthetic'}},
                {'id': 'B', 'updated_at': '2030-01-01', 'settings': {}},
                {'id': 'C', 'updated_at': '2030-01-01', 'settings': {}}]
        before = deepcopy(rows)
        for name in ('sort_rows_by_updated_at_desc', 'component_rows_without_content', 'component_rows_for_programme_page'):
            self.compare(name, rows)
        self.assertEqual(rows, before)


class LibraryCatalogueParity(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            CREATE TABLE modules(module_catalogue_id TEXT PRIMARY KEY, programme_id TEXT, title TEXT);
            CREATE TABLE weeks(id TEXT PRIMARY KEY, module_catalogue_id TEXT, week_number INTEGER, title TEXT);
            CREATE TABLE components(id TEXT PRIMARY KEY, module_catalogue_id TEXT, week_id TEXT, type TEXT,
                title TEXT, description TEXT, display_order INTEGER, expected_otjh REAL, status TEXT,
                updated_at TEXT, settings_json TEXT);
            CREATE TABLE ksb_mappings(id TEXT PRIMARY KEY, component_id TEXT, standard_ksb_id INTEGER, weight REAL, status TEXT);
            CREATE TABLE standard_ksbs(id INTEGER PRIMARY KEY, ksb_code TEXT, ksb_description TEXT);
            INSERT INTO modules VALUES ('M1','P1','One'), ('M2','P2','Two');
            INSERT INTO weeks VALUES ('W1','M1',1,'First'), ('W2','M2',2,'Second');
            INSERT INTO components VALUES
                ('A1','M1','W1','reading','A1','text',1,1,'active','2030-01-01','{}'),
                ('A2','M1','W1','reading','A2','text',2,1,'active','2030-01-01','{}'),
                ('B1','M2','W2','reading','B1','text',3,1,'active','2030-01-01','{"readingContent":"synthetic"}'),
                ('B2','M2','W2','video','B2','text',4,1,'active','2030-01-01','{}'),
                ('B3','M2','W2','reading','B3','text',5,1,'archived','2030-01-01','{}');
            INSERT INTO standard_ksbs VALUES (1,'K1','Synthetic KSB');
            INSERT INTO ksb_mappings VALUES ('MAP1','B1',1,1,'active');
        ''')
        tables = ('modules','weeks','components','ksb_mappings','standard_ksbs')
        self.columns = {table: {row['name'] for row in self.db.execute('PRAGMA table_info('+table+')')} for table in tables}
        self.calls = []
        def read(sql, params=None):
            self.calls.append((sql, deepcopy(params)))
            return [dict(row) for row in self.db.execute(sql.replace('%s', '?'), params or [])]
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(composition_fixture(views, 'connection', vendor='sqlite'))
        for name, value in (('ensure_module_authoring_tables', None),):
            self.stack.enter_context(composition_fixture(views, name, return_value=value))
        self.stack.enter_context(composition_fixture(views, 'fetch_all', side_effect=read))
        self.stack.enter_context(composition_fixture(views, 'authoring_table_name', side_effect=lambda table: '"'+table+'"'))
        self.stack.enter_context(composition_fixture(views, 'learning_read_table', side_effect=lambda table: '"'+table+'"'))
        self.stack.enter_context(composition_fixture(views, 'table_exists', side_effect=lambda table: table in self.columns))
        self.stack.enter_context(composition_fixture(views, 'has_column', side_effect=lambda table, column: column in self.columns.get(table, set())))
        self.stack.enter_context(placement_read_fixture('attach', side_effect=lambda table, rows: rows))

    def compare(self, **kwargs):
        self.calls.clear()
        with original_component_catalogue():
            expected = views.library_component_rows(**kwargs)
        old_calls = deepcopy(self.calls)
        self.calls.clear()
        from .catalogue.application import component_catalogue
        with patch.object(component_catalogue, 'library_component_rows', wraps=component_catalogue.library_component_rows) as app:
            actual = views.library_component_rows(**kwargs)
        app.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(self.calls, old_calls)
        return actual

    def test_unfiltered_list_search_type_origins_and_page_contract_are_unchanged(self):
        for kwargs in ({}, {'page': 2, 'page_size': 2}, {'search': 'B2'}, {'types': ['video']},
                       {'origins': ['archived']}, {'origins': ['library']}, {'ids': ['A1']}, {'search': 'absent'}):
            self.compare(**kwargs)
        self.assertFalse(self.compare()[0]['settings'])

    def test_unknown_origin_does_not_silently_expand_to_all_origins(self):
        with original_component_catalogue():
            self.assertEqual(len(views.library_component_rows(origins=['typo'])), 5)
        self.assertEqual(views.library_component_rows(origins=['typo']), [])
        self.assertEqual([r['id'] for r in views.library_component_rows(origins=['typo', 'archived'])], ['B3'])
        self.assertEqual(len(views.library_component_rows(origins=[])), 5)

    def test_programme_filter_applies_before_page_limit_instead_of_false_empty_result(self):
        with original_component_catalogue():
            self.assertEqual(views.library_component_rows(programme_ids=['P2'], page_size=2), [])
        first = views.library_component_rows(programme_ids=[' P2 ', 'P2'], page_size=2)
        second = views.library_component_rows(programme_ids=['P2'], page=2, page_size=2)
        self.assertEqual([r['id'] for r in first], ['B1', 'B2'])
        self.assertEqual([r['id'] for r in second], ['B3'])
        self.assertEqual(views.library_component_rows(programme_ids=['missing']), [])
        self.assertEqual([r['id'] for r in views.library_component_rows(programme_ids=['P2'], types=['video'])], ['B2'])

    def test_programme_filter_keeps_python_whitespace_normalization_and_bound_values(self):
        self.db.execute('UPDATE modules SET programme_id=? WHERE module_catalogue_id=?', ('\u00a0\tP2\u3000', 'M2'))
        self.assertEqual([r['id'] for r in views.library_component_rows(programme_ids=['P2'], page_size=2)], ['B1', 'B2'])
        self.assertEqual(views.library_component_rows(programme_ids=["P2' OR 1=1 --"]), [])
        sql, params = next((sql, params) for sql, params in reversed(self.calls) if 'limit %s' in sql)
        self.assertNotIn("P2'", sql)
        self.assertIn("P2' OR 1=1 --", params)

    def test_normalized_detail_uses_joined_ksb_instead_of_silent_empty_mappings(self):
        with original_component_catalogue():
            old = views.library_component_rows(ids=['B1'], detail=True)[0]
        new = views.library_component_rows(ids=['B1'], detail=True)[0]
        self.assertEqual(old['ksbMappings'], [])
        self.assertEqual(new['ksbRefs'], ['K1'])
        self.assertEqual(new['ksbMappings'][0]['description'], 'Synthetic KSB')
        old.update(ksbRefs=new['ksbRefs'], ksbMappings=new['ksbMappings'])
        self.assertEqual(new, old)
        self.assertEqual(new['settings']['readingContent'], 'synthetic')

    def test_missing_library_parent_keeps_blank_provenance(self):
        self.db.execute("DELETE FROM weeks WHERE id='W1'")
        self.db.execute("DELETE FROM modules WHERE module_catalogue_id='M1'")
        result = self.compare(ids=['A1'])[0]
        self.assertEqual((result['originModuleTitle'], result['originWeekLabel']), ('', ''))

    def test_missing_parent_table_is_an_error_not_an_apparently_empty_parent(self):
        self.db.execute('DROP TABLE weeks')
        del self.columns['weeks']
        with original_component_catalogue():
            self.assertEqual(views.library_component_rows(ids=['A1'])[0]['originWeekLabel'], '')
        with self.assertRaises(sqlite3.OperationalError):
            views.library_component_rows(ids=['A1'])
        with patch.object(views.logger, 'exception'):
            response = views.curriculum_component_library(RequestFactory().get('/library/', {'ids': 'A1'}))
        self.assertEqual(response.status_code, 500)
        # Empty ID sets still require no parent query at all.
        before = len(self.calls)
        self.assertEqual(views.rows_for_ids('weeks', 'id', []), [])
        self.assertEqual(len(self.calls), before)

    def test_reader_failure_is_reported_by_existing_http_error_mapping(self):
        with composition_fixture(views, 'fetch_all', side_effect=RuntimeError('synthetic read failure')), \
             patch.object(views.logger, 'exception'):
            with self.assertRaisesRegex(RuntimeError, 'synthetic read failure'):
                views.library_component_rows(programme_ids=['P2'])
            response = views.curriculum_component_library(RequestFactory().get('/library/', {'programmeIds': 'P2'}))
        self.assertEqual(response.status_code, 500)
        self.assertIn('Unable to load', json.loads(response.content)['error'])

    def test_http_paging_reports_remaining_matching_rows_and_rejects_writes(self):
        response = views.curriculum_component_library(RequestFactory().get('/library/', {'programmeIds': 'P2', 'pageSize': 2}))
        data = json.loads(response.content)
        self.assertEqual([r['id'] for r in data['results']], ['B1', 'B2'])
        self.assertEqual(data['count'], 2)
        self.assertTrue(data['hasNext'])
        self.assertEqual(views.curriculum_component_library(RequestFactory().post('/library/')).status_code, 405)
