import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import learner_directory, learner_status_counts as counts


def fact(identifier, *, programme_id='P1', cohort_id='C1', group_id='G1', status='active', explicit=False, modules=()):
    return {'id': identifier, 'programme_id': programme_id, 'programme': 'Programme', 'cohort_id': cohort_id,
            'cohort': 'Intake', 'group_id': group_id, 'group_name': 'Group', 'status': status,
            'explicit': explicit, 'module_ids': list(modules)}


def lineage(**overrides):
    return {'found': True, 'programmeId': 'P1', 'programmeName': 'Programme', **overrides}


class LearnerStatusReductionTests(SimpleTestCase):
    def reduce(self, targets, facts):
        return counts.counts_for_lineages(targets, facts, {'P1': ['P1', 'Programme'], 'P2': ['P2', 'Programme']})

    def test_unique_learners_and_statuses_are_counted_without_summing_module_memberships(self):
        rows = [fact(1), fact(2, status='Withdrawn'), fact(3, status='On_Break'), fact(4, status='completed')]
        result = self.reduce({'P1': lineage()}, rows + [rows[0]])['P1']
        self.assertEqual(result, {'total': 4, 'statuses': {'active': 1, 'completed': 1, 'on break': 1, 'withdrawn': 1}})

    def test_id_first_placement_does_not_cross_programmes_cohorts_or_groups_with_matching_names(self):
        targets = {'P1': lineage(), 'C1': lineage(cohortId='C1', cohortName='Intake'),
                   'G1': lineage(cohortId='C1', cohortName='Intake', groupId='G1', groupName='Group')}
        rows = [fact(1), fact(2, group_id='G2'), fact(3, cohort_id='C2'), fact(4, programme_id='P2')]
        result = self.reduce(targets, rows)
        self.assertEqual([result[key]['total'] for key in targets], [3, 2, 1])

    def test_unlinked_legacy_placements_use_names_and_a_missing_record_is_not_zero(self):
        targets = {'G1': lineage(cohortId='C1', cohortName='Intake', groupId='G1', groupName='Group'), 'gone': {'found': False}}
        result = self.reduce(targets, [fact(1, programme_id='', cohort_id='', group_id='', status='')])
        self.assertEqual(result['G1'], {'total': 1, 'statuses': {'unknown': 1}})
        self.assertIsNone(result['gone'])

    def test_direct_and_explicit_module_memberships_match_the_roster_without_broadening_parents(self):
        module = lineage(cohortId='C1', cohortName='Intake', groupId='G1', groupName='Group', moduleCatalogueId='M1')
        rows = [fact(1), fact(2, explicit=True, modules=['M2']), fact(3, programme_id='P2', modules=['M1'], status='withdrawn')]
        result = self.reduce({'P1': lineage(), 'M1': module, 'manual': {**module, 'learnerRosterMode': 'manual'}}, rows)
        self.assertEqual(result['P1']['total'], 2)
        self.assertEqual(result['M1'], {'total': 2, 'statuses': {'active': 1, 'withdrawn': 1}})
        self.assertEqual(result['manual'], {'total': 1, 'statuses': {'withdrawn': 1}})

    def test_empty_scopes_return_a_real_zero_and_json_string_plans_preserve_explicit_decisions(self):
        self.assertEqual(self.reduce({'P1': lineage()}, [])['P1'], {'total': 0, 'statuses': {}})
        self.assertEqual(counts.plan_membership(json.dumps([{'moduleId': 'M1', 'assignmentMode': 'explicit'}, {'moduleId': 'M2'}]), {'M1'}), (True, {'M1'}))
        self.assertEqual(counts.plan_membership('bad json', {'M1'}), (False, set()))

    def test_string_plans_follow_the_rosters_inherited_placement_boundary(self):
        module = lineage(cohortId='C1', groupId='G1', moduleCatalogueId='M1')
        rows = [{**fact(1, explicit=True, modules=['M1']), 'ambiguous': True},
                {**fact(2, programme_id='P2', modules=['M1']), 'ambiguous': True},
                {**fact(3, explicit=True, modules=['M2']), 'ambiguous': True}]
        result = self.reduce({'M1': module, 'manual': {**module, 'learnerRosterMode': 'manual'}}, rows)
        self.assertEqual(result['M1'], {'total': 1, 'statuses': {'active': 1}})
        self.assertEqual(result['manual'], {'total': 0, 'statuses': {}})

    def test_a_batch_reads_learner_facts_once_and_resolves_programme_candidates_once(self):
        with patch.object(counts, 'placement_lineages', side_effect=lambda scope, ids: {ident: lineage(groupId=ident) for ident in ids}), \
             patch('curriculum_api.views.programme_identity_candidates', return_value=['Programme']) as candidates, \
             patch.object(counts, 'learner_facts', return_value=[fact(1)]) as facts:
            result = counts.status_counts('group', ['G1', 'G2'])
        facts.assert_called_once_with(set())
        candidates.assert_called_once_with('P1')
        self.assertEqual((result['G1']['total'], result['G2']['total']), (1, 0))


class LearnerStatusEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')))

    def test_bound_read_only_batch_returns_counts_only_and_deduplicates_requested_ids(self):
        values = {'G1': {'total': 2, 'statuses': {'active': 1, 'withdrawn': 1}}, 'gone': None}
        with patch.object(counts, 'status_counts', return_value=values) as read:
            response = learner_directory.counts(self.factory.get('/', {'scope': 'group', 'ids': 'G1,G1,gone'}))
        read.assert_called_once_with('group', ['G1', 'gone'])
        self.assertEqual(json.loads(response.content), {'counts': values})
        self.assertIn('no-store', response['Cache-Control'])

    def test_invalid_or_over_limit_requests_do_not_read(self):
        with patch.object(counts, 'status_counts') as read:
            for params in [{'scope': 'bad', 'ids': 'G1'}, {'scope': 'group', 'ids': ''},
                           {'scope': 'group', 'ids': ','.join(str(i) for i in range(101))}, {'scope': 'group', 'ids': 'x' * 201}]:
                self.assertEqual(learner_directory.counts(self.factory.get('/', params)).status_code, 400)
        read.assert_not_called()

    def test_failures_are_visible_and_never_fabricated_zero_counts(self):
        with patch.object(counts, 'status_counts', side_effect=DatabaseError('private detail')):
            response = learner_directory.counts(self.factory.get('/', {'scope': 'programme', 'ids': 'P1'}))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private detail', response.content.decode())

    def test_staff_authorization_and_get_only_are_preserved(self):
        with patch.object(counts, 'status_counts') as read:
            for account, status in [(None, 401), (SimpleNamespace(role='learner'), 403), (SimpleNamespace(role='employer'), 403)]:
                with patch('login.permissions.authenticate_request', return_value=account):
                    self.assertEqual(learner_directory.counts(self.factory.get('/', {'scope': 'group', 'ids': 'G1'})).status_code, status)
            self.assertEqual(learner_directory.counts(self.factory.post('/')).status_code, 405)
        read.assert_not_called()

    def test_status_filter_is_applied_before_pagination_and_search(self):
        rows = [{'id': str(i), 'name': f'Learner {i}', 'email': 'synthetic@example.invalid',
                 'status': 'withdrawn' if i % 2 else 'active'} for i in range(60)]
        with patch.object(learner_directory, 'roster', return_value=rows) as roster:
            result = json.loads(learner_directory.learners(self.factory.get('/', {
                'scope': 'cohort', 'id': 'C1', 'status': 'all', 'lifecycle_status': 'Withdrawn', 'page': 2})).content)
        roster.assert_called_once_with('cohort', 'C1', 'all')
        self.assertEqual((result['total'], result['filteredTotal'], len(result['learners'])), (30, 30, 5))
        self.assertTrue(all(row['status'] == 'withdrawn' for row in result['learners']))

    def test_active_directory_matches_normalized_count_status_with_legacy_fallback(self):
        rows = [{'id': 1, 'lifecycleStatus': ' Active ', 'programmeStatus': 'withdrawn'},
                {'id': 2, 'lifecycleStatus': '', 'programmeStatus': 'Active'},
                {'id': 3, 'lifecycleStatus': 'withdrawn', 'programmeStatus': 'active'},
                {'id': 4, 'lifecycleStatus': '', 'programmeStatus': ''},
                {'id': 5, 'lifecycleStatus': ' ', 'programmeStatus': 'Active'}]
        with patch('curriculum_api.views.scope_placement_lineage', return_value=lineage()), \
             patch('curriculum_api.views.assigned_learners_for_scope', return_value=rows) as read:
            result = learner_directory.roster('programme', 'P1', 'active')
        read.assert_called_once_with('programme', 'P1', '', lineage=lineage(), strict=True)
        self.assertEqual([row['id'] for row in result], ['1', '2', '5'])
