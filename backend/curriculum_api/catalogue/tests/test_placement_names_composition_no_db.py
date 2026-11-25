"""Actual placement readers versus frozen source, using only synthetic capabilities."""
import ast
import copy
import threading
import time
from types import ModuleType
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase
from curriculum_api import curriculum_names, calendar_holidays, views
from curriculum_api.catalogue.domain import archive_policy
from curriculum_api.catalogue.infrastructure import placement_reads as reads, holiday_reads, ksb_read_store, authoring_runtime
from curriculum_api.catalogue.tests.parity.test_placement_names_standalone import original_tree
from curriculum_api.catalogue.tests.parity.placement_names_oracle import SNAPSHOT
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import database_read_fixture, placement_read_fixture


def original():
    module = ModuleType('curriculum_api.frozen_placement_names')
    module.__package__ = 'curriculum_api'
    module.__dict__.update(threading=threading, time=time, connections={}, **{
        n: getattr(archive_policy, n) for n in ('ACTIVE', 'INACTIVE', 'INACTIVE_STATUSES', 'is_inactive')})
    nodes = [n for n in original_tree('curriculum_names.py').body if isinstance(n, (ast.Assign, ast.FunctionDef))]
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), '<frozen-placement>', 'exec'), module.__dict__)
    return module


ROWS = [('p', 'P', 'Programme', None, None, None, None, 'active'),
        ('g', 'G', 'Group', 'C', 'P', 'K2', None, 'active'),
        ('k', 'K1', 'Adam', '', None, None, None, 'active'),
        ('k', 'K2', 'Zara', '', None, None, None, 'active'),
        ('gc', 'G', 'K1', None, None, None, None, None),
        ('gc', 'G', 'K1', None, None, None, None, None),
        ('h', 'C', 'H2', 'true', 'false', None, None, '2'),
        ('h', 'C', 'H1', 'false', 'true', None, None, '1'),
        ('s', 'digest', None, None, None, None, None, None)]


def fake_db(rows):
    cursor = MagicMock(); cursor.__enter__.return_value = cursor
    cursor.fetchall.return_value = copy.deepcopy(rows)
    db = Mock(vendor='postgresql'); db.cursor.return_value = cursor
    return db, cursor


class PlacementReaderParity(SimpleTestCase):
    def setUp(self):
        saved = vars(reads._LOCAL).copy()
        vars(reads._LOCAL).clear()
        self.addCleanup(lambda: (vars(reads._LOCAL).clear(), vars(reads._LOCAL).update(saved)))

    def test_aliases_share_functions_and_single_cache_owner(self):
        for name in ('lookups', 'attach', 'invalidate', 'invalidate_for', 'standards_digest', 'begin_request', 'end_request'):
            self.assertIs(getattr(curriculum_names, name), getattr(reads, name))
        self.assertIs(curriculum_names._LOCAL, reads._LOCAL)
        self.assertIs(curriculum_names._OPTIONAL_TABLES, reads._OPTIONAL_TABLES)
        self.assertIs(calendar_holidays.attach_cohort_choices, reads.attach_cohort_choices)
        self.assertIs(calendar_holidays.in_use, holiday_reads.calendar_in_use)
        self.assertIs(authoring_runtime.curriculum_names, reads)
        self.assertIs(views.get_skills_england_ksb_rows, ksb_read_store.get_skills_england_ksb_rows)

    def test_actual_lookup_sql_and_rows_match_for_all_optional_shapes(self):
        for bits in range(16):
            optional = dict(zip(('choices', 'standards', 'group_coaches', 'group_coach_column'),
                                (bool(bits & (1 << i)) for i in range(4))))
            results = []
            for owner in (original(), reads):
                owner.invalidate(); db, cursor = fake_db(ROWS)
                with patch.object(owner, 'connections', {'default': db}), patch.object(owner, '_optional_tables', return_value=optional):
                    data = copy.deepcopy(owner.lookups())
                data.pop('at'); data.pop('request_token')
                results.append((data, cursor.execute.call_args_list))
            self.assertEqual(results[0], results[1], optional)
        self.assertEqual(results[1][0]['groups']['G']['coach_ids'], ['K1', 'K2'])
        self.assertEqual(results[1][0]['cohort_holidays']['C'], {'selected': ['H2'], 'excluded': ['H1']})

    def test_optional_metadata_cached_per_alias_with_exact_queries(self):
        results = []
        for owner in (original(), reads):
            db, cursor = fake_db([]); cursor.fetchone.side_effect = [(True, False), (True, False)] * 2
            with patch.object(owner, '_OPTIONAL_TABLES', {}), patch.object(owner, 'connections', {'default': db, 'other': db}):
                first = owner._optional_tables(); again = owner._optional_tables(); other = owner._optional_tables('other')
                self.assertIs(first, again)
                results.append((first, other, cursor.execute.call_args_list))
        self.assertEqual(results[0], results[1])
        self.assertEqual(len(results[0][2]), 4)

    def test_request_ttl_and_write_invalidation_match_original(self):
        for owner in (original(), reads):
            owner.begin_request(); token = owner._LOCAL.request_token
            cached = {'at': -1000, 'request_token': token}; owner._LOCAL.lookups = cached
            with patch.object(owner, 'connections') as connections:
                connections.__getitem__.side_effect = RuntimeError('read needed')
                self.assertIs(owner.lookups(), cached)
                owner.invalidate_for('components'); self.assertIs(owner.lookups(), cached)
                owner.end_request()
                with self.assertRaisesRegex(RuntimeError, 'read needed'): owner.lookups()
                owner._LOCAL.lookups = cached
                owner.invalidate_for('"curriculum"."groups"')
                self.assertIsNone(owner._LOCAL.lookups)

    def test_attach_preserves_selected_fields_projection_order_and_mutation_contract(self):
        data = {'programmes': {'P': {'name': 'Programme'}}, 'cohorts': {}, 'groups': {}, 'modules': {}, 'tutors': {}, 'coaches': {}}
        for requested, excluded in ((None, None), (['programme_name'], []), (None, ['programme_name'])):
            results = []
            for owner in (original(), reads):
                rows = [{'cohort_id': 'C', 'programme_id': 'P'}, {'cohort_id': 'C', 'programme_name': 'Selected'}]
                events = []
                def choices(value, **kwargs): events.append('choices')
                def lookup(*args): events.append('names'); return copy.deepcopy(data)
                with patch.object(owner, 'connections', {'default': Mock(vendor='postgresql')}), \
                        patch.object(owner, 'lookups', side_effect=lookup), \
                        patch.object(calendar_holidays, 'attach_cohort_choices', side_effect=choices), \
                        patch.object(reads, 'attach_cohort_choices', side_effect=choices):
                    self.assertIs(owner.attach('cohorts', rows, requested=requested, excluded=excluded), rows)
                results.append((rows, events))
            self.assertEqual(results[0], results[1])

    def test_real_cohort_choice_completion_matches_original_and_copies_lists(self):
        env = dict(vars(calendar_holidays))
        exec(compile(SNAPSHOT['original_functions']['calendar_holidays.py:attach_cohort_choices'], '<old-cohort-choices>', 'exec'), env)
        for requested, excluded in ((None, None), (['holiday_ids'], None), (None, ['holiday_ids'])):
            results = []
            for fn in (env['attach_cohort_choices'], reads.attach_cohort_choices):
                rows = [{'cohort_id': 'C'}, {'cohort_id': 'C'}, {'cohort_id': 'missing'}]
                with placement_read_fixture('lookups', return_value={'cohort_holidays': {'C': {'selected': ['H'], 'excluded': []}}}), \
                        patch.object(reads, 'calendar_in_use', return_value=True), patch.dict(env, in_use=Mock(return_value=True)):
                    fn(rows, requested=requested, excluded=excluded)
                if rows[0].get('holiday_ids'):
                    self.assertIsNot(rows[0]['holiday_ids'], rows[1]['holiday_ids'])
                results.append(rows)
            self.assertEqual(results[0], results[1])

    def test_lookup_errors_propagate_without_fabricated_empty_cache(self):
        for owner in (original(), reads):
            owner.invalidate()
            with patch.object(owner, 'connections') as db:
                db.__getitem__.side_effect = RuntimeError('synthetic failure')
                with self.assertRaisesRegex(RuntimeError, 'synthetic failure'): owner.lookups()
            self.assertIsNone(owner._LOCAL.lookups)

    def test_ksb_reader_keeps_digest_cache_and_exact_sql(self):
        source = SNAPSHOT['original_functions']['views.py:get_skills_england_ksb_rows']
        tree = ast.parse(source); tree.body[0].decorator_list = []
        results = []
        for old in (True, False):
            calls = []; digests = iter(('A', 'A', 'B', '', ''))
            fetch = lambda sql: calls.append(sql) or [{'id': len(calls)}]
            if old:
                env = dict(table_exists=lambda name: True, table_name=lambda name: 'fixture.' + name,
                           fetch_all=fetch, curriculum_names=Mock(standards_digest=lambda: next(digests)), _SKILLS_ENGLAND_ROWS=(None, None))
                exec(compile(tree, '<old-ksb>', 'exec'), env); fn = env['get_skills_england_ksb_rows']
                rows = [fn() for _ in range(5)]
            else:
                with patch.object(ksb_read_store, '_SKILLS_ENGLAND_ROWS', (None, None)), \
                        database_read_fixture('table_exists', return_value=True), database_read_fixture('table_name', side_effect=lambda name: 'fixture.' + name), \
                        database_read_fixture('fetch_all', side_effect=fetch), placement_read_fixture('standards_digest', side_effect=lambda: next(digests)):
                    rows = [ksb_read_store.get_skills_england_ksb_rows() for _ in range(5)]
            self.assertIs(rows[0], rows[1]); results.append((rows, calls))
        self.assertEqual(results[0], results[1]); self.assertEqual(len(results[0][1]), 4)
