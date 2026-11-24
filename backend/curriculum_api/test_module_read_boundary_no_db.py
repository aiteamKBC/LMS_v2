"""Compare actual pre-extraction and new module reads on synthetic values.

Requires Django imports, so run only inside the reviewed isolated harness.
SimpleTestCase denies database access; every authoring reader is fixture-bound.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
import sys
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from . import views

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/module_reads_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_module_reads():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-module-reads>', 'exec'), namespace)
            original = namespace[name]
            restored = FunctionType(original.__code__, vars(views), name, original.__defaults__)
            restored.__kwdefaults__ = original.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, restored))
        yield


def summary(identifier='MOD-ONE', **changes):
    return {
        'catalogueId': identifier, 'title': 'One', 'programmeName': 'Programme',
        'programmeId': 'PROG-ONE', 'weeks': 2, 'ksbCount': 1, 'lessonCount': 3,
        'quizCount': 1, 'status': 'published', 'qualityScore': 70,
        'description': '', 'totalOtjh': 2, 'lastUpdated': '', 'startDate': '',
        'endDate': '', 'sessionsNumber': 4, 'sessionNames': ['Read'],
        'ksbCodes': ['K1'], 'weekStructure': [], **changes,
    }


class ModuleReadBoundaryParity(SimpleTestCase):
    def compare(self, name, *args, **kwargs):
        before = deepcopy((args, kwargs))
        with original_module_reads():
            expected = getattr(views, name)(*args, **kwargs)
        if name == 'enrich_curriculum_modules_with_authoring_details':
            # Only enriched records receive dev's approved nullable schedule field.
            expected = [{**row, 'weekBoundaryMode': None} if 'weekStartsOn' in row else row for row in expected]
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        self.assertEqual(actual, expected)
        self.assertEqual((args, kwargs), before, 'shared input records must remain unchanged')
        called.assert_called_once()
        return actual

    def test_payload_alias_precedence_empty_zero_and_placement_fallbacks(self):
        for payload in (None, [], {}, {'id': 'legacy', 'name': 'Name'}, {
            'moduleCatalogueId': ' MOD-ONE ', 'catalogueId': 'MOD-OTHER',
            'notes': '', 'description': 'Description', 'weeks': 0, 'sessionsNumber': 0,
            'week_structure': [{'id': 'W1'}], 'programme_id': 'PROG-ONE',
            'group_name': 'Group', 'title': 'Title',
        }):
            self.compare('curriculum_module_from_authoring_payload', payload)
        programme = {'id': 'display-programme', 'sourceId': 'PROG-ONE', 'name': 'Programme'}
        for item in (None, [], {}, {'id': ' C1 ', 'cohortId': 'C2', 'programme_id': 'PROG-OTHER'},
                     {'group_id': 'G1', 'module_ids': ['MOD-ONE'], 'cohort_name': 'Cohort'}):
            self.compare('normalise_programme_config_cohort', item, programme)
            self.compare('normalise_programme_config_group', item, programme)

    def test_duplicate_richness_ties_order_and_missing_identifiers(self):
        values = [None, {}, {'id': ' A ', 'title': 'First'}, {'id': 'A', 'title': 'Later'},
                  {'name': 'Same name', 'weekStructure': [{'components': [1]}]},
                  {'name': 'same-name', 'notes': 'Longer text'}, {}, {'id': 'B'}]
        for item in values:
            self.compare('curriculum_item_richness', item)
        for items in (None, [], values, list(reversed(values))):
            self.compare('unique_curriculum_items', items, ('id', 'moduleId'))
        # Equal richness uses the later row but preserves the first key position.
        self.assertEqual(self.compare('unique_curriculum_items',
                         [{'id': 'A', 'x': 1}, {'id': 'B'}, {'id': 'A', 'x': 2}], ('id',)),
                         [{'id': 'A', 'x': 2}, {'id': 'B'}])

    def test_group_matching_explicit_lists_and_aliases(self):
        modules = [{}, {'id': 'catalogue-module-MOD-ONE'}, {'moduleCatalogueId': ' MOD-ONE '},
                   {'moduleId': 'MOD-ONE', 'groupId': 'G-OTHER'}, {'group_id': 'G-ONE'}]
        groups = [{}, {'id': 'G-ONE'}, {'id': 'G-OTHER', 'moduleIds': ['mod one']},
                  {'id': 'G-ONE', 'module_ids': [None, '', 'MOD-ONE']}]
        for module in modules:
            for group in groups:
                self.compare('module_belongs_to_group', module, group)

    def test_outline_preserves_omission_semantics_without_mutating_cached_records(self):
        for modules in ([], [{'id': 'MOD-ONE'}], [{'weekStructure': [
            {'id': 'W1', 'components': [{'id': 'C1'}]}, {'components': []}, None,
        ]}]):
            self.compare('module_rows_with_week_outline', modules)

    def test_delivery_and_unused_catalogue_identity_and_counts(self):
        catalogue = [{'Module ID': 'MOD-ONE', 'Module_name': 'One', 'Number of sessions': 7},
                     {'Module ID': 'MOD-UNUSED', 'Module_name': 'Unused', 'Number of sessions': 3}]
        training = [
            {'id': 'DELIVERY-1', 'module_name': 'One', 'module_catalogue_id': 'MOD-ONE',
             'programme_name': 'Programme', 'Cohort_name': 'Cohort', 'group_name': 'Group',
             'sessions_number': 4, 'session_week_day': 'Monday,Thursday',
             '_meta': {'cohort_id': 'C1', 'group_id': 'G1'}},
            {'id': 'DELIVERY-2', 'module_name': 'Legacy', 'module_catalogue_id': 'bad-id'},
            {'id': 'DELIVERY-3', 'module_name': 'Missing placement'},
            {'id': 'EMPTY', 'module_name': ' '},
        ]
        for records in ([], training):
            for unused in (False, True):
                result = self.compare('build_modules', catalogue, records, [], include_unused=unused)
                if records:
                    self.assertEqual(result[0]['moduleCatalogueId'], 'MOD-ONE')
                    self.assertEqual(result[0]['deliveryRowId'], 'DELIVERY-1')
                if unused:
                    self.assertEqual(result[-1]['weeks'], 3)

    def test_programme_authoring_ownership_and_archive_selection(self):
        rows = [
            {'module_catalogue_id': 'MOD-ONE', 'programme_id': 'PROG-ONE', 'status': 'active'},
            {'module_catalogue_id': 'MOD-OTHER', 'programme_id': 'PROG-OTHER', 'programme_name': 'Same'},
            {'module_catalogue_id': 'MOD-NAME', 'programme_name': 'Same'},
            {'module_catalogue_id': 'MOD-OLD', 'programme_id': 'PROG-ONE', 'status': 'inactive'},
            {'module_catalogue_id': 'MOD-DELETED', 'programme_id': 'PROG-ONE', 'deleted_at': 'yesterday'},
        ]
        with composition_fixture(views, 'safe_module_index_rows', return_value=rows):
            result = self.compare('programme_authoring_module_rows', {'id': 'PROG-ONE', 'name': 'Same'})
        self.assertEqual([r['module_catalogue_id'] for r in result], ['MOD-ONE', 'MOD-NAME'])

    def test_batched_payloads_fallback_fields_and_config_sources(self):
        programme = {'id': 'PROG-ONE', 'name': 'Programme'}
        rows = [{'module_catalogue_id': 'MOD-ONE'}, {'module_catalogue_id': 'MOD-MISSING', 'title': 'Fallback'}]
        with composition_fixture(views, 'programme_authoring_module_rows', return_value=rows), \
             composition_fixture(views, 'get_authoring_structure_payloads', return_value={'MOD-ONE': {'catalogueId': 'MOD-ONE', 'title': 'Saved'}}) as reads:
            self.compare('programme_authoring_modules', programme)
            reads.reset_mock()
            result = self.compare('programme_authoring_modules', programme, module_rows=rows, child_rows={'weeks': []})
            self.assertEqual(reads.call_args_list[0], reads.call_args_list[1])
            self.assertEqual(reads.call_count, 2)  # One read per old/new invocation.
            self.assertEqual([r['name'] for r in result], ['Saved', 'Fallback'])
        # Intentional correction: embedded config content is not authoritative.
        config = {'modules': [{'title': 'Embedded'}, 'MOD-ONE', '', 'missing']}
        with composition_fixture(views, 'get_authoring_structure_payload', side_effect=lambda mid: {'catalogueId': mid} if mid == 'MOD-ONE' else None):
            with original_module_reads():
                old = views.programme_config_modules(config)
        with composition_fixture(views, 'get_authoring_structure_payloads', return_value={'MOD-ONE': {'catalogueId': 'MOD-ONE'}}) as reads:
            current = views.programme_config_modules(config)
        self.assertEqual(len(old), 2)
        self.assertEqual(current, [old[1]])
        reads.assert_called_once_with(['MOD-ONE', 'missing'])

    def test_detail_enrichment_field_precedence_and_bounded_read_options(self):
        modules = [{'moduleCatalogueId': 'MOD-ONE', 'name': 'Old', 'notes': 'Keep', 'weeks': 3,
                    'deliveryMetadata': {'groupId': 'G1', 'source': 'delivery'}}, {'id': 'missing'}]
        payloads = {'MOD-ONE': {'catalogueId': 'MOD-ONE', 'title': 'New', 'description': '',
                               'weeks': 0, 'deliveryMetadata': {'source': 'authoring'}}}
        with composition_fixture(views, 'get_authoring_structure_payloads', return_value=payloads) as reads:
            result = self.compare('enrich_curriculum_modules_with_authoring_details', modules, child_rows={'weeks': []})
            self.assertEqual(reads.call_args_list[0], reads.call_args_list[1])
            self.assertFalse(reads.call_args.kwargs['include_staff'])
            self.assertFalse(reads.call_args.kwargs['include_quality'])
            self.assertFalse(reads.call_args.kwargs['include_extra'])
            self.assertEqual(result[0]['notes'], '')
            self.assertEqual(result[0]['weeks'], 3)
            self.assertEqual(result[0]['deliveryMetadata'], {'groupId': 'G1', 'source': 'authoring'})
        with composition_fixture(views, 'get_authoring_structure_payloads') as reads:
            self.compare('enrich_curriculum_modules_with_authoring_details', [{'id': 'missing'}])
            reads.assert_not_called()

    def test_catalogue_enrichment_candidates_dedup_and_read_flags(self):
        summaries = {'MOD-ONE': summary(), 'MOD-TWO': summary('MOD-TWO', title='Other')}
        delivery = {'id': 'DELIVERY-1', 'name': 'One', 'programme': 'Programme',
                    'assignments': 9, 'ksbCodes': ['S1'], 'status': 'published'}
        cases = [[], [delivery], [dict(delivery, moduleCatalogueId='MOD-ONE')],
                 [dict(delivery, invalidModuleCatalogueId='invalid')],
                 [delivery, dict(delivery, id='DELIVERY-2')]]
        def unexpected_fallback(*args, **kwargs):
            raise AssertionError('Unexpected enrichment fallback') from sys.exc_info()[1]
        with composition_fixture(views, 'authoring_catalogue_summaries', return_value=summaries) as reads, \
             patch.object(views.logger, 'exception', side_effect=unexpected_fallback) as errors:
            for modules in cases:
                for list_only in (False, True):
                    reads.reset_mock()
                    self.compare('enrich_modules_with_authoring', modules, True, False, list_only=list_only)
                    self.assertEqual(reads.call_count, 2)
                    self.assertEqual(reads.call_args_list[0], reads.call_args_list[1])
            errors.assert_not_called()

    def test_catalogue_reader_failure_retains_original_fallback_identity(self):
        modules = [{'id': 'MOD-ONE'}]
        with composition_fixture(views, 'authoring_catalogue_summaries', side_effect=RuntimeError('synthetic failure')), \
             patch.object(views.logger, 'exception') as errors:
            self.assertIs(self.compare('enrich_modules_with_authoring', modules), modules)
            self.assertEqual(errors.call_count, 2)
