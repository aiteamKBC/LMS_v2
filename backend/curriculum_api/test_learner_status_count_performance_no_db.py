"""Bound count work by batches and placements; no database or live services."""
from unittest.mock import patch

from django.test import SimpleTestCase

from . import learner_status_counts as counts, views
from .test_learner_status_counts_no_db import fact, lineage


class LearnerCountPlacementReadTests(SimpleTestCase):
    columns = {'module_catalogue_id', 'programme_id', 'programme_name', 'cohort_id',
               'cohort_name', 'group_id', 'group_name', 'learner_roster_mode'}

    def test_a_hundred_canonical_modules_need_one_narrow_read_and_no_catalogue_resolution(self):
        identifiers = [f'M{index}' for index in range(100)]
        rows = [{'module_catalogue_id': identifier, 'programme_id': 'P1', 'programme_name': 'Programme',
                 'cohort_id': 'C1', 'cohort_name': 'Intake', 'group_id': 'G1', 'group_name': 'Group',
                 'learner_roster_mode': 'manual' if index % 2 else 'inherited'}
                for index, identifier in enumerate(identifiers)]
        with patch.object(views, 'column_names', return_value=self.columns), \
             patch.object(views, 'authoring_fetch_all', return_value=rows) as read, \
             patch.object(views, 'scope_placement_lineage', side_effect=AssertionError('No per-module catalogue build')):
            result = counts.placement_lineages('module', identifiers)
        read.assert_called_once()
        self.assertEqual(read.call_args.args[2], identifiers)
        self.assertEqual(set(read.call_args.kwargs['columns']), self.columns)
        self.assertFalse(read.call_args.kwargs['ensure_tables'])
        self.assertEqual(result['M0'], lineage(cohortId='C1', cohortName='Intake', groupId='G1', groupName='Group',
                                              moduleCatalogueId='M0', learnerRosterMode='inherited'))
        self.assertEqual(result['M1']['learnerRosterMode'], 'manual')

    def test_canonical_parent_reads_preserve_their_own_placement_boundary(self):
        for scope, id_column in [('cohort', 'cohort_id'), ('group', 'group_id')]:
            rows = [{id_column: 'chosen', 'programme_id': 'P1', 'programme_name': 'Programme',
                     'cohort_id': 'C1' if scope == 'group' else 'chosen', 'cohort_name': 'Intake',
                     'group_id': 'chosen' if scope == 'group' else 'unrelated', 'group_name': 'Group'}]
            with self.subTest(scope=scope), patch.object(views, 'column_names', return_value=self.columns), \
                 patch.object(views, 'authoring_fetch_all', return_value=rows) as read, \
                 patch.object(views, 'scope_placement_lineage', side_effect=AssertionError('No per-row lookup')):
                result = counts.placement_lineages(scope, ['chosen'])['chosen']
            self.assertEqual(result['programmeId'], 'P1')
            self.assertEqual('groupId' in result, scope == 'group')
            read.assert_called_once()

    def test_legacy_aliases_and_missing_records_keep_the_authoritative_resolver(self):
        expected = {'legacy': lineage(moduleCatalogueId='canonical'), 'missing': {'found': False}}
        with patch.object(views, 'column_names', return_value=self.columns), \
             patch.object(views, 'authoring_fetch_all', return_value=[]), \
             patch.object(views, 'scope_placement_lineage', side_effect=lambda scope, identifier: expected[identifier]) as resolve:
            self.assertEqual(counts.placement_lineages('module', list(expected)), expected)
        self.assertEqual(resolve.call_count, 2)

    def test_old_schema_without_roster_mode_keeps_inherited_membership(self):
        with patch.object(views, 'column_names', return_value=self.columns - {'learner_roster_mode'}), \
             patch.object(views, 'authoring_fetch_all', return_value=[{'module_catalogue_id': 'M1'}]) as read:
            self.assertEqual(counts.placement_lineages('module', ['M1'])['M1']['learnerRosterMode'], 'inherited')
        self.assertNotIn('learner_roster_mode', read.call_args.kwargs['columns'])

    def test_placement_matching_is_shared_across_modules_but_explicit_assignments_stay_individual(self):
        modules = {f'M{index}': lineage(cohortId='C1', groupId='G1', moduleCatalogueId=f'M{index}') for index in range(100)}
        facts = [fact(1), fact(2, status='on break'), fact(3, explicit=True, modules=['M1']),
                 fact(4, programme_id='P2', modules=['M2'], status='withdrawn')]
        with patch.object(views, 'narrow_learners_to_placement', wraps=views.narrow_learners_to_placement) as narrow:
            result = counts.counts_for_lineages(modules, facts, {'P1': ['Programme']})
        self.assertLessEqual(narrow.call_count, 2 * len(facts))
        self.assertEqual(result['M0'], {'total': 2, 'statuses': {'active': 1, 'on break': 1}})
        self.assertEqual(result['M1'], {'total': 3, 'statuses': {'active': 2, 'on break': 1}})
        self.assertEqual(result['M2'], {'total': 3, 'statuses': {'active': 1, 'on break': 1, 'withdrawn': 1}})

    def test_name_fallback_and_id_only_placements_do_not_share_incompatible_buckets(self):
        modules = {'by_id': lineage(cohortId='C1', groupId='G1', moduleCatalogueId='M1'),
                   'by_name': lineage(cohortName='Intake', groupName='Group', moduleCatalogueId='M2'),
                   'other': lineage(cohortId='C2', groupId='G2', moduleCatalogueId='M3')}
        facts = [fact(1), fact(2, cohort_id='C2', group_id='G2'),
                 fact(3, cohort_id='', group_id=''), fact(4, programme_id='P2')]
        result = counts.counts_for_lineages(modules, facts, {'P1': ['Programme']})
        self.assertEqual([result[key]['total'] for key in modules], [2, 3, 2])
