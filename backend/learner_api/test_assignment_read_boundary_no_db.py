"""Actual Django import bindings and count consumers, with all reads substituted."""
import importlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from curriculum_api import learner_assignment_counts_sql as counts
from learner_api import learning_plan, mappers
from learner_api.learning_plans.domain import stored_plan
from learner_api.learning_plans.infrastructure import assignment_reads as reads


class AssignmentReadBoundaryTests(SimpleTestCase):
    def test_redirected_consumers_receive_the_identical_existing_objects(self):
        snapshot = json.loads((Path(__file__).parent / 'learning_plans/tests/fixtures/legacy_snapshots/assignment_reads_snapshot.json').read_text(encoding='utf-8'))
        for entry in snapshot['redirected_imports']:
            previous = importlib.import_module(entry.get('previous', 'curriculum_api.views'))
            owner = importlib.import_module(entry['owner'])
            with self.subTest(consumer=entry['consumer'], symbol=entry['symbol']):
                self.assertIs(getattr(previous, entry['symbol']), getattr(owner, entry['owner_symbol']))

    def test_legacy_exports_and_count_namespace_are_the_actual_read_owner(self):
        self.assertIs(counts.plans, reads)
        for name in ('_rows', '_group_preset_rows', '_module_ids_from_column',
                     '_manual_roster_module_ids', 'group_module_ids_bulk', '_group_module_ids',
                     '_preset_ids_for', 'request_preset_cache', '_effective_plan_ids'):
            self.assertIs(getattr(learning_plan, name), getattr(reads, name))
        for name in ('_s', '_maybe_json', 'stored_training_plan'):
            self.assertIs(getattr(mappers, name), getattr(stored_plan, name))

    def test_actual_reader_cache_and_explicit_empty_semantics(self):
        source = SimpleNamespace(group_id='G', training_plan=None, learning_plan=None)
        cache = {}
        with patch.object(reads, 'placement_ids', return_value={'group_id': 'G'}), \
                patch.object(reads, '_group_module_ids', return_value=['A', 'B']) as group:
            self.assertEqual(learning_plan._effective_plan_ids(source, cache), ['A', 'B'])
            self.assertEqual(counts.plans._effective_plan_ids(source, cache), ['A', 'B'])
            group.assert_called_once_with('', '', group_id='G')
            for saved in ([], [{'moduleId': 'OUT', 'assignmentMode': 'explicit'}]):
                source.training_plan = saved
                self.assertEqual(reads._effective_plan_ids(source, {}), [entry['moduleId'] for entry in saved])
            self.assertEqual(group.call_count, 1)

    def test_counts_use_canonical_group_cache_and_do_not_apply_lifecycle_filtering(self):
        facts = [dict(learner_id=i, programme='P', grp='Display only', group_id='G', ambiguous=False,
                      has_plan=False, id_count=0, has_explicit=False, matched=[], status='inactive')
                 for i in (1, 2)]
        with patch.object(counts, '_group_source', return_value=None), \
                patch.object(reads, '_group_module_ids', return_value=['A', 'A', 'B']) as preset:
            actual, ambiguous = counts.counts_from_plan_facts(facts, {'A', 'B'})
        self.assertEqual(actual, {'A': 2, 'B': 2})
        self.assertEqual(ambiguous, [])
        preset.assert_called_once_with('', '', source=None, group_id='G')

    def test_ambiguous_json_uses_same_reader_and_deduplicates_per_registration(self):
        source = SimpleNamespace(training_plan='[{"moduleId":" A "},{"moduleId":"A"}]',
                                 learning_plan=None, group_id='')
        manager = Mock()
        with patch.object(counts, 'fetch_plan_facts', return_value=[]), \
                patch.object(counts, 'seed_preset_cache', return_value={}), \
                patch.object(counts, 'counts_from_plan_facts', return_value=({'A': 0}, [7])), \
                patch.object(counts, 'EnrolmentUser', all_learners=manager), \
                patch.object(counts, 'with_placements', return_value=[source]), \
                patch.object(reads, 'placement_ids', return_value={'group_id': ''}), \
                patch.object(reads, '_effective_plan_ids', wraps=reads._effective_plan_ids) as actual:
            self.assertEqual(counts.bulk_assigned_learner_counts_sql(['A']), {'A': 1})
        actual.assert_called_once()
        manager.only.return_value.filter.assert_called_once_with(pk__in=[7])
