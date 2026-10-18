"""Synthetic preservation checks; no database or external services."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import deduplicate_legacy_catalogue as cleanup
import reconcile_legacy_learning as repair


class CatalogueCleanupTests(unittest.TestCase):
    def setUp(self):
        self.scope = repair.projection_scope()
        self.courses = [{'id': 1, 'source_course_ref': '21', 'source_course_title': 'Synthetic',
                         'curriculum_module_ref': 'native', 'deleted_at': None}]
        lesson = {'id': 5, 'source_course_id': 1, 'source_activity_id': 'material:91',
            'source_activity_title': 'Lesson', 'source_activity_kind': 'material',
            'source_activity_type': 'reading', 'source_position': 1,
            'curriculum_component_ref': None, 'source_section_ref': '1',
            'source_section_title': 'Section', 'source_payload': {}, 'deleted_at': None}
        self.defs = [lesson, {**lesson, 'id': 6, 'source_activity_id': 'quiz:91',
                             'source_activity_kind': 'quiz', 'source_activity_type': 'quiz'}]
        self.duplicates = [{'id': 6, 'course_ref': '21', 'wrong_ref': 'quiz:91',
                            'verified_ref': 'material:91'}]
        self.state = {'owner': {'id': 9}, 'progress': [], 'sources': [], 'journals': [],
            'segments': [], 'modules': [], 'memberships': [{'id': 8, 'source_course_id': 1,
                'deleted_at': None, 'source_relationship': 'historical'}]}

    def record(self, ident, ref, definition, seconds=3600):
        self.state['progress'].append({'id': ident, 'learner_id': 9, 'enrolment_id': 2,
            'programme_id': 'synthetic', 'aptem_id': 3, 'entry_order': ident,
            'accepted': bool(seconds), 'actual_seconds': seconds or None,
            'activity_status': 'completed', 'canonical_activity_key': f'key-{ident}', 'deleted_at': None})
        self.state['sources'].append({'id': ident, 'learner_id': 9, 'source_system': 'old_lms',
            'source_activity_id': ref, 'source_course_ref': '21', 'source_catalog_activity_id': definition,
            'canonical_progress_id': ident, 'completed': True, 'activity_status': 'completed', 'deleted_at': None})

    def test_distinct_historical_records_keep_hours_once_when_activities_merge(self):
        self.record(10, 'quiz:91', 6, 3600)
        self.record(11, 'material:91', 5, 1800)
        before = deepcopy(self.state)
        plan, simulated = cleanup.lineage_plan(self.state, self.courses, self.defs, self.duplicates, self.scope)
        self.assertEqual(plan['before']['21'], {'total': 2, 'completed': 2, 'hours': 1.5})
        self.assertEqual(plan['after']['21'], {'total': 1, 'completed': 1, 'hours': 1.5})
        self.assertEqual(plan['links'][0]['source_activity_id'], 'course:21:material:91')
        self.assertFalse(plan['links'][0]['accepted'])
        self.assertIsNone(plan['links'][0]['actual_seconds'])
        self.assertEqual(self.state, before)
        again, _ = cleanup.lineage_plan(simulated, self.courses, self.defs, self.duplicates, self.scope)
        self.assertEqual(again['links'], [])

    def test_unstarted_duplicates_do_not_generate_completion(self):
        plan, simulated = cleanup.lineage_plan(self.state, self.courses, self.defs, self.duplicates, self.scope)
        self.assertEqual(plan['links'], [])
        self.assertEqual(plan['after']['21']['completed'], 0)
        self.assertEqual(simulated['progress'], [])

    def test_retained_quiz_content_alias_is_hidden_without_losing_completion_or_hours(self):
        self.record(10, 'material:91', 5, 1800)
        self.state['memberships'][0]['learner_id'] = 9
        aliases = [{'id': 5, 'course_ref': '21', 'wrong_ref': 'material:91',
                    'verified_ref': 'quiz:91'}]
        plan, simulated = cleanup.lineage_plan(self.state, self.courses, self.defs, aliases, self.scope)
        scopes = repair.content_alias_scopes(simulated['memberships'], self.courses, aliases)
        simulated['memberships'][0]['verified_catalogue_scope'] = scopes[0]['scope']
        visible = repair.projected_items(simulated, self.courses, self.defs, self.scope, owned_only=True)
        self.assertEqual(cleanup.cards(visible), plan['after'])
        self.assertEqual(cleanup.cards(visible)['21'], {'total': 1, 'completed': 1, 'hours': .5})
        self.assertEqual(visible[0]['activity_id'], 'catalogue:21:quiz:91')
        self.assertTrue(all(definition['deleted_at'] is None for definition in self.defs))

    def test_adding_explicit_route_preserves_other_journal_placements(self):
        self.record(10, 'journal-source', None)
        self.state['sources'][0]['source_system'] = 'journal'
        self.state['progress'][0]['source_payload'] = {'original_source_ref': 'la:21:91'}
        self.defs.append({**self.defs[0], 'id': 7, 'source_activity_id': 'material:92'})
        for ref in (91, 92):
            self.state['journals'].append({'id': ref, 'source_id': 10, 'progress_id': 10,
                'canonical_learner_id': 9, 'deleted_at': None, 'group_id': '21',
                'activity_id': str(ref), 'source_ref': f'la:21:{ref}'})
        duplicates = [{'id': 5, 'course_ref': '21', 'wrong_ref': 'material:91',
                       'verified_ref': 'quiz:91'}]
        plan, _ = cleanup.lineage_plan(self.state, self.courses, self.defs, duplicates, self.scope)
        self.assertEqual(len(plan['links']), 2)
        self.assertEqual(plan['after']['21']['completed'], 2)
        self.assertEqual(plan['after']['21']['hours'], 1)

    def test_occupied_source_keys_fail_without_overwriting_history(self):
        self.record(10, 'quiz:91', 6)
        self.record(11, 'material:91', 5)
        self.record(12, 'course:21:material:91', 5)
        before = deepcopy(self.state)
        with self.assertRaisesRegex(ValueError, 'identities'):
            cleanup.lineage_plan(self.state, self.courses, self.defs, self.duplicates, self.scope)
        self.assertEqual(self.state, before)

    def test_unrecorded_extras_are_scoped_to_historical_membership_only(self):
        self.record(10, 'material:91', 5)
        third = {**self.defs[0], 'id': 7, 'source_activity_id': 'material:92'}
        verified = {'21': {'facts': {}}}
        before = deepcopy(self.state)
        result = cleanup.catalogue_scope_plan(self.state, verified, self.courses,
                                             [self.defs[0], third], self.scope)
        self.assertEqual(result[0]['new_exclusions'], ['material:92'])
        self.assertEqual(self.state, before)
        self.state['memberships'][0]['source_relationship'] = 'assigned'
        self.assertEqual(cleanup.catalogue_scope_plan(self.state, verified, self.courses,
            [self.defs[0], third], self.scope), [])

    def test_existing_owner_exclusions_survive_and_verified_unstarted_content_stays(self):
        self.state['memberships'][0]['verified_catalogue_scope'] = {
            'version': 1, 'basis': 'verified-legacy-account-inventory', 'course_ref': '21',
            'excluded_activity_refs': ['material:99']}
        result = cleanup.catalogue_scope_plan(self.state, {'21': {'facts': {'material:91': {}}}},
                                             self.courses, self.defs, self.scope)
        self.assertEqual(result[0]['scope']['excluded_activity_refs'], ['material:99', 'quiz:91'])


if __name__ == '__main__':
    unittest.main()
