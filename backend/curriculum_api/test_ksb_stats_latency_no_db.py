"""KSB summary equivalence and business-rule boundaries without a database."""
from contextlib import ExitStack
from decimal import Decimal
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase, RequestFactory

from . import views, ksb_stats_reads
from .ksb_coverage import build_coverage


class CoverageTotalsTests(SimpleTestCase):
    def test_totals_preserve_source_identity_duplicate_weights_and_rounding(self):
        required = [
            {'code': ' k1 ', 'sourceType': 'Standard', 'sourceId': 'ST-A'},
            {'code': 'K1', 'source_type': 'standard', 'source_id': 'st-b'},
            {'code': 'S1', 'source_type': 'standard', 'source_id': 'st-a'},
            {'code': 'B1', 'source_type': 'standard', 'source_id': 'st-a'},
        ]
        mappings = [
            {'module_catalogue_id': 'M1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'ST-A', 'weight': '.125'},
            {'module_catalogue_id': 'M1', 'ksb_code': 'k1', 'source_type': 'standard', 'source_id': 'st-a', 'weight': '.135'},
            {'module_catalogue_id': 'M1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'st-b', 'weight': 15},
            {'module_catalogue_id': 'M2', 'ksb_code': 'S1', 'source_type': 'standard', 'source_id': 'st-a', 'weight': -2},
            {'module_catalogue_id': 'M2', 'ksb_code': 'S1.1', 'source_type': 'standard', 'source_id': 'st-a', 'weight': 20},
            {'module_catalogue_id': 'M2', 'ksb_code': 'S1', 'source_type': 'framework', 'source_id': 'st-a', 'weight': 99},
            {'module_catalogue_id': '', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'st-a', 'weight': 99},
        ]
        for definitions, include_mapping_only in ((required, False), (required, True), ([], True)):
            with self.subTest(definitions=bool(definitions), mapping_only=include_mapping_only):
                full = build_coverage(definitions, mappings, [], [], [], include_mapping_only)
                totals = build_coverage(definitions, mappings, [], [], [], include_mapping_only, totals_only=True)
                self.assertEqual(totals['items'], [
                    {'code': item['code'], 'raw_total_weight': item['raw_total_weight']} for item in full['items']
                ])
        result = build_coverage(required, mappings, [], [], [], False, totals_only=True)
        self.assertEqual([item['raw_total_weight'] for item in result['items']], [.26, 15, -2, 0])


class StatsScopeTests(SimpleTestCase):
    def test_grouped_sql_keeps_row_multiplicity_for_delivery_selection_and_weights(self):
        db = sqlite3.connect(':memory:')
        self.addCleanup(db.close)
        db.row_factory = sqlite3.Row
        db.create_function('btrim', 2, lambda value, chars: value.strip(chars) if value is not None else None)
        db.executescript('''
            create table weeks (module_catalogue_id text, library_state text, isDeleted boolean);
            create table components (module_catalogue_id text, type text, deleted_at text, library_state text);
            create table ksb_mappings (module_catalogue_id text, component_id text, ksb_code text,
                                      weight real, source_type text, source_id text, isProgrammeDeleted boolean);
            insert into weeks values ('M1','',0),('M2','',0),('M2','',0),('M2','',1);
            insert into components values ('M1','reading',null,''),('M1','quiz',null,''),
                ('M2','reading',null,''),('M2','reading',null,''),('M2','workplace_evidence',null,''),
                ('M2','reading',null,' library ');
            insert into ksb_mappings values ('M1','C1','K1',4,'standard','S1',0),
                ('M1','C1','K2',4,'standard','S1',0),('M2','C2','K1',.125,'standard','S1',0),
                ('M2','C3','K1',.125,'standard','S1',0),('M2','C4','K1',.125,'standard','S1',0),
                ('M2',' ','K2',5,'standard','S1',0),('M2','C2','K1',90,'standard','S1',1),
                ('M3','C9','K9',90,'standard','S2',0);
        ''')
        tables = ('weeks', 'components', 'ksb_mappings')
        columns = {table: {row['name'] for row in db.execute(f'pragma table_info({table})')} for table in tables}
        modules = [{'module_catalogue_id': key, 'title': 'Duplicate', 'programme_id': 'P1'} for key in ('M1', 'M2')]
        def full_children(table, ids, **kwargs):
            fields = kwargs.get('columns')
            return [{k:v for k,v in dict(row).items() if not fields or k in fields}
                    for row in db.execute(f'select * from {table}') if row['module_catalogue_id'] in ids]
        with patch.object(views, 'connection', vendor='postgresql'), \
             patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'authoring_scope_module_rows', return_value=modules), \
             patch.object(views, 'authoring_child_rows_for_modules', side_effect=full_children), \
             patch.object(views, 'has_column', side_effect=lambda table,col: col in columns[table]), \
             patch.object(views, 'authoring_table_name', side_effect=lambda table: table), \
             patch.object(views, 'fetch_all', side_effect=lambda sql, params: [dict(row) for row in db.execute(sql.replace('%s','?'), params)]):
            full = views.authoring_scope_data('programme', 'P1')
            grouped = views.authoring_scope_data('programme', 'P1', stats_only=True)
        self.assertEqual(grouped[0], full[0])
        self.assertEqual(grouped[0][0]['module_catalogue_id'], 'M2')
        full_coverage = build_coverage([], full[3], *full[:3])
        totals = build_coverage([], grouped[3], *grouped[:3], totals_only=True)
        self.assertEqual(totals['items'], [{'code': item['code'], 'raw_total_weight': item['raw_total_weight']}
                                         for item in full_coverage['items']])
        self.assertEqual(totals['items'], [{'code': 'K1', 'raw_total_weight': .36}, {'code': 'K2', 'raw_total_weight': 5}])
        self.assertEqual(len(grouped[3]), 2)
        self.assertEqual(sum(row['_stats_count'] for row in grouped[3]), 4)

    def test_projection_keeps_duplicate_delivery_selection_and_deletion_flags(self):
        modules = [
            {'module_catalogue_id': key, 'title': 'Duplicate', 'programme_id': 'P1', 'group_id': 'G1'}
            for key in ('M1', 'M2')
        ]
        children = {
            views.AUTHORING_WEEKS_TABLE: [
                {'id': 'W1', 'module_catalogue_id': 'M1'},
                {'id': 'W2', 'module_catalogue_id': 'M2'},
                {'id': 'W3', 'module_catalogue_id': 'M2', 'isDeleted': True},
            ],
            views.AUTHORING_COMPONENTS_TABLE: [
                {'id': 'C1', 'module_catalogue_id': 'M1', 'type': 'reading'},
                {'id': 'C2', 'module_catalogue_id': 'M2', 'type': 'reading'},
                {'id': 'C3', 'module_catalogue_id': 'M2', 'type': 'reading', 'library_state': ' library '},
                {'id': 'C4', 'module_catalogue_id': 'M2', 'type': 'workplace-evidence'},
            ],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [
                {'module_catalogue_id': 'M1', 'component_id': 'C1', 'ksb_code': 'K1', 'weight': 3},
                {'module_catalogue_id': 'M2', 'component_id': 'C2', 'ksb_code': 'K1', 'weight': 5},
                {'module_catalogue_id': 'M2', 'component_id': '', 'ksb_code': 'K2', 'weight': 6},
                {'module_catalogue_id': 'M2', 'component_id': 'C2', 'ksb_code': 'K1', 'weight': 90, 'isProgrammeDeleted': True},
            ],
        }
        def fetch(table, ids, **kwargs):
            columns = kwargs.get('columns')
            return [{key:value for key,value in row.items() if columns is None or key in columns}
                    for row in children[table] if row['module_catalogue_id'] in ids]
        with patch.object(views, 'ensure_module_authoring_tables'), \
             patch.object(views, 'authoring_scope_module_rows', return_value=modules), \
             patch.object(views, 'authoring_child_rows_for_modules', side_effect=fetch):
            full = views.authoring_scope_data('programme', 'P1')
            slim = views.authoring_scope_data('programme', 'P1', stats_only=True)
        self.assertEqual(slim[0], full[0])
        self.assertEqual([row['module_catalogue_id'] for row in slim[0]], ['M2'])
        self.assertEqual([len(rows) for rows in slim], [len(rows) for rows in full])
        self.assertEqual(build_coverage([], slim[3], slim[0], slim[1], slim[2], totals_only=True),
                         build_coverage([], full[3], full[0], full[1], full[2], totals_only=True))


class LearnerProgressStatsTests(SimpleTestCase):
    def test_achievement_rule_is_applied_to_outcomes_and_weight_order_is_preserved(self):
        outcomes = [{'kind': kind, 'passed': passed} for kind in ('quiz', ' QUIZ ', 'component', 'future-kind', None)
                    for passed in (True, False, None)]
        rows = [
            {'learner_id': 1, 'ksb_code': 'K1', 'weights': [Decimal('.125'), Decimal('.135')]},
            {'learner_id': 2, 'ksb_code': 'K1', 'weights': [Decimal('1e16'), 1, Decimal('-1e16')]},
        ]
        with patch.object(views, 'fetch_all', side_effect=[outcomes, rows]) as fetch, \
             patch.object(views, 'and_not_excluded', return_value=''):
            result = ksb_stats_reads.progress_totals([1, 2], ['K1'])
        self.assertEqual(result, {1: {'K1': .26}, 2: {'K1': 0.0}})
        params = fetch.call_args.args[1]
        self.assertEqual(params[1:-2], [value for row in outcomes if views.progress_counts_as_achieved(**row)
                                       for value in (row['kind'], row['passed'])])
        self.assertEqual(params[-2:], [[1, 2], ['K1']])

    def test_no_eligible_attempts_need_no_weight_query(self):
        with patch.object(views, 'fetch_all', return_value=[{'kind': 'quiz', 'passed': None}]) as fetch:
            self.assertEqual(ksb_stats_reads.progress_totals([1], ['K1']), {})
        self.assertEqual(fetch.call_count, 1)

    def calculate(self, learners):
        modules = [{'module_catalogue_id': 'M1'}]
        mappings = [{'module_catalogue_id': 'M1', 'ksb_code': code, 'weight': weight}
                    for code, weight in [('K1', 10), ('K2', 20)]]
        with ExitStack() as stack:
            for name, value in (
                ('authoring_scope_data', (modules, [], [], mappings)),
                ('infer_source_from_scope', ('', '', '')),
                ('required_ksbs_for_resolved_source', []),
                ('mappings_with_inferred_sources', mappings),
                ('assigned_learners_for_programme', [{'id': i} for i in learners]),
                ('learner_progress_ksb_totals', {1: {'K1': 30, 'K2': 10}, 2: {'K1': -2, 'K2': 30}}),
            ):
                stack.enter_context(patch.object(views, name, return_value=value))
            return views.programme_learner_ksb_progress('P1')

    def test_capping_is_per_learner_and_code_with_existing_denominator(self):
        result = self.calculate([1, 2])
        self.assertEqual(result, {
            'learnerKsbProgressPercentage': 67, 'learnerKsbConsumedWeight': 40,
            'learnerKsbExpectedWeight': 60, 'learnerKsbLearnerCount': 2,
            'learnerKsbCodesStarted': 2, 'learnerKsbCodesComplete': 2, 'learnerKsbCodesTotal': 2,
        })

    def test_no_learners_keep_design_weight_with_zero_progress(self):
        result = self.calculate([])
        self.assertEqual(result['learnerKsbExpectedWeight'], 30)
        self.assertEqual(result['learnerKsbLearnerCount'], 0)
        self.assertEqual(result['learnerKsbProgressPercentage'], 0)


class KsbStatsResponseTests(SimpleTestCase):
    def test_conditional_response_uses_cached_body_without_rebuilding(self):
        from django.core.cache import cache
        cache.clear()
        views._CURRICULUM_CACHE.clear()
        self.addCleanup(cache.clear)
        self.addCleanup(views._CURRICULUM_CACHE.clear)
        with patch.object(views, 'shared_curriculum_epoch', return_value=123), \
             patch.object(views, 'build_programme_ksb_stats', return_value={'programmeId': 'P1', 'ksbMapped': 3}) as build:
            initial = views.curriculum_programme_ksb_stats(RequestFactory().get('/ksb-stats/'), 'P1')
            repeated = views.curriculum_programme_ksb_stats(RequestFactory().get('/ksb-stats/', HTTP_IF_NONE_MATCH=initial['ETag']), 'P1')
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(repeated.status_code, 304)
        self.assertEqual(repeated.content, b'')
        self.assertEqual(build.call_count, 1)
