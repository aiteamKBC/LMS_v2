"""Actual old/new delivery read parity; synthetic inputs, Django DB access denied."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, MagicMock, patch

from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
from django.test import SimpleTestCase
from curriculum_api import views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/delivery_reads_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_delivery_reads():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-delivery-read>', 'exec'), namespace)
            source = namespace[name]
            fn = FunctionType(source.__code__, vars(views), name, source.__defaults__)
            fn.__kwdefaults__ = source.__kwdefaults__
            if name == 'active_learner_delivery_counts':
                fn = views.scoped_curriculum_read(fn)
            stack.enter_context(composition_fixture(views, name, fn))
        yield


class DeliveryReadBoundaryParity(SimpleTestCase):
    def compare(self, name, *args, **kwargs):
        before = deepcopy((args, kwargs))
        with original_delivery_reads():
            expected = getattr(views, name)(*args, **kwargs)
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual((args, kwargs), before)
        return actual

    def test_identity_preserves_missing_names_metadata_and_slug_fallback(self):
        for row in ({}, {'cohort': 'not-the-authoritative-field'},
                    {'Cohort_name': ' Cohort A ', 'group_name': 'Group A'},
                    {'Cohort_name': 'Cohort A', '_meta': {'cohort_id': ' C1 ', 'group_id': 'G1', 'group_name': 'Metadata group'}}):
            self.compare('actual_cohort_identity', row, 'Programme')
            self.compare('actual_group_identity', row, 'C1')
        for detail in (None, {}, {'status': ' ARCHIVED '}, {'status': 'inactive'}):
            self.compare('detail_is_archived', detail)

    def test_learner_count_adds_disjoint_id_and_name_buckets(self):
        counts = {'C1': 2, ('programme', 'cohort'): 3}
        self.assertEqual(self.compare('delivery_learner_count', counts, ' C1 ', ('programme', 'cohort')), 5)
        self.assertEqual(self.compare('delivery_learner_count', counts, '', ('programme', 'cohort')), 3)
        self.assertEqual(self.compare('delivery_learner_count', {}, 'C1', ('p', 'c')), 0)

    def test_overview_normalized_sources_reconstructed_groups_and_stale_arrays(self):
        source = {
            'modules': [
                {'module_catalogue_id': 'MOD-1', 'title': 'One', 'cohort_id': 'C1', 'group_id': 'G1', 'sessions_number': 2},
                {'module_catalogue_id': 'MOD-2', 'title': 'Two', 'cohort_id': 'C1', 'group_id': 'G2', 'group_name': 'Recovered', 'sessions_number': 3},
                {'module_catalogue_id': 'MOD-OLD', 'title': 'Old', 'cohort_id': 'C1', 'group_id': 'G1', 'status': 'inactive'},
            ],
            'cohorts': [{'cohortId': 'C1', 'cohortName': 'Cohort', 'programmeName': 'Programme', 'groupIds': ['G0']},
                        {'cohortId': 'C-OLD', 'status': 'inactive'}],
            'groups': [{'id': 'G1', 'name': 'Group', 'cohortId': 'C1', 'moduleIds': ['STALE'], 'status': 'planned'},
                       {'id': 'G-EMPTY', 'moduleIds': ['STORED'], 'modules': ['Stored name']},
                       {'id': 'G-OLD', 'status': 'inactive'}],
        }
        with composition_fixture(views, 'active_learner_delivery_counts', return_value=({'C1': 2, ('programme', 'cohort'): 1}, {'G1': 2})):
            for archived in (False, True):
                for counts in (False, True):
                    cohorts, groups = self.compare('build_cohorts_and_groups', [{'ignored': True}], [], archived,
                                                  source=source, include_learner_counts=counts)
                    self.assertEqual([c['id'] for c in cohorts], ['C1'])
                    self.assertEqual(cohorts[0]['groups'], ['G0', 'G1', 'G2'])
                    self.assertEqual(cohorts[0]['learners'], 3 if counts else 0)
                    self.assertEqual(next(g for g in groups if g['id'] == 'G2')['sessions'], 3)
                    self.assertEqual(next(g for g in groups if g['id'] == 'G-EMPTY')['moduleIds'], ['STORED'])

    def test_empty_provided_source_skips_all_reader_capabilities(self):
        with ExitStack() as stack:
            readers = [stack.enter_context(composition_fixture(views, name, side_effect=AssertionError('unneeded read')))
                       for name in ('safe_module_index_rows', 'active_learner_delivery_counts',
                                    'cohort_authoring_detail_rows', 'group_authoring_detail_rows')]
            self.assertEqual(self.compare('build_cohorts_and_groups', include_learner_counts=False,
                                          source={'modules': [], 'cohorts': [], 'groups': []}), ([], []))
            for reader in readers:
                reader.assert_not_called()

    def test_group_reader_dates_tutors_serialization_and_read_order(self):
        rows = [{'group_id': 'G1', 'group_name': 'Group', 'module_ids': '["MOD-1"]',
                 'coach_name': 'Coach', 'schedule': 'Monday 09:00-10:00'}]
        modules = [{'group_id': 'G1', 'start_date': '2030-02-01', 'end_date': '2030-04-01', 'tutor_name': 'Ada'},
                   {'group_id': 'G1', 'start_date': '2030-01-01', 'end_date': '2030-03-01', 'tutor_name': 'Unassigned'},
                   {'group_id': 'G2', 'start_date': '1990-01-01', 'tutor_name': 'Other'}]
        for row in ({}, rows[0], {'group_id': 'G2', 'session_week_day': 'Tuesday', 'session_start_time': '12:00', 'session_end_time': '13:00'}):
            self.compare('serialize_group_authoring_detail', row)
        with composition_fixture(views, 'authoring_fetch_all', return_value=rows) as reads, \
             composition_fixture(views, 'safe_module_index_rows', return_value=modules):
            result = self.compare('group_authoring_detail_rows')
            self.assertEqual(reads.call_count, 2)
            self.assertEqual(reads.call_args_list[0], reads.call_args_list[1])
            # Existing quirk: staff_assignment_key('Unassigned') is '', so the
            # reader's != 'unassigned' check retains that token as a second name.
            # Preserve the original label here; fixing it is a behavior change.
            self.assertEqual((result[0]['startDate'], result[0]['endDate'], result[0]['tutor']),
                             ('2030-01-01', '2030-04-01', 'Ada +1'))

    def test_cohort_reader_shares_calendar_and_preserves_failure_boundary(self):
        rows = [{'cohort_id': 'C1'}, {'cohort_id': 'C2'}]
        with composition_fixture(views, 'get_holiday_rows_safe', return_value=[]) as holidays, \
             composition_fixture(views, 'authoring_fetch_all', return_value=rows) as reads, \
             composition_fixture(views, 'serialize_cohort_authoring_detail', side_effect=lambda row, calendar: dict(row)) as serializer:
            self.compare('cohort_authoring_detail_rows')
            self.assertEqual(holidays.call_count, 2)
            self.assertEqual(reads.call_args_list[0], reads.call_args_list[1])
            self.assertEqual(serializer.call_count, 4)
        for name in ('cohort_authoring_detail_rows', 'group_authoring_detail_rows'):
            with composition_fixture(views, 'get_holiday_rows_safe', return_value=[]), \
                 composition_fixture(views, 'authoring_fetch_all', side_effect=RuntimeError('synthetic read failure')), \
                 patch.object(views.logger, 'warning') as warning:
                with original_delivery_reads():
                    self.assertEqual(getattr(views, name)(), [])
                with self.assertRaises(CatalogueReadUnavailable):
                    getattr(views, name)()
                self.assertEqual(warning.call_count, 1)
        # Calendar acquisition precedes the existing try block; preserve propagation.
        with composition_fixture(views, 'get_holiday_rows_safe', side_effect=RuntimeError('calendar failure')):
            for original in (True, False):
                with ExitStack() as stack:
                    if original:
                        stack.enter_context(original_delivery_reads())
                    with self.assertRaisesRegex(RuntimeError, 'calendar failure'):
                        views.cohort_authoring_detail_rows()

    def test_sql_count_variants_preserve_exact_sql_id_name_partition_and_lifecycle(self):
        rows = [('Programme', 'Cohort', 'Group', ' C1 ', 'G1', 2),
                ('programme', 'cohort', 'group', '', '', 3), ('', '', '', '', '', 9)]
        for linked in (False, True):
            for columns in (set(), {'programme'}, {'cohort_id', 'group_id'}):
                db = MagicMock(vendor='postgresql')
                cursor = db.cursor.return_value.__enter__.return_value
                cursor.fetchall.return_value = rows if linked else [(p, c, g, '', '', n) for p, c, g, _c, _g, n in rows]
                with composition_fixture(views, 'connection', db), \
                     composition_fixture(views, 'learner_relation_exists', return_value=True), \
                     composition_fixture(views, 'learners_link_placement_by_id', return_value=linked), \
                     patch.object(views.schema_compat, 'columns_of', return_value=columns):
                    cohort, group = self.compare('active_learner_delivery_counts')
                self.assertEqual(cursor.execute.call_count, 2)
                self.assertEqual(cursor.execute.call_args_list[0], cursor.execute.call_args_list[1])
                sql = cursor.execute.call_args.args[0]
                self.assertIn("where lifecycle_status = 'active'", sql)
                self.assertEqual(cohort, {'C1': 2, ('programme', 'cohort'): 3} if linked else {('programme', 'cohort'): 5})
                self.assertEqual(group, {'G1': 2, ('programme', 'cohort', 'group'): 3} if linked else {('programme', 'cohort', 'group'): 5})

    def test_count_reader_unavailable_sources_and_errors(self):
        for vendor, exists, fail in (('sqlite', True, False), ('postgresql', False, False), ('postgresql', True, True)):
            db = MagicMock(vendor=vendor)
            if fail:
                db.cursor.side_effect = RuntimeError('synthetic connection failure')
            with composition_fixture(views, 'connection', db), \
                 composition_fixture(views, 'learner_relation_exists', return_value=exists), \
                 patch.object(views.logger, 'warning'):
                if fail:
                    with original_delivery_reads():
                        self.assertEqual(views.active_learner_delivery_counts(), ({}, {}))
                    with self.assertRaises(CatalogueReadUnavailable):
                        views.active_learner_delivery_counts()
                else:
                    self.assertEqual(self.compare('active_learner_delivery_counts'), ({}, {}))
            if not fail:
                db.cursor.assert_not_called()
