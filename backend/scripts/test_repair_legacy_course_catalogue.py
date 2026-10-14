"""Synthetic catalogue recovery regressions; no DB, HTTP or Django startup."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from repair_legacy_course_catalogue import catalogue_plan, plan_repair, projections, verify


def component(ident, kind, completed=False):
    return dict(source_component_id=ident, component_kind=kind,
        post_type='stm-quizzes' if kind == 'quiz' else 'stm-lessons',
        title='Synthetic activity', material_type='pdf', progress=dict(completed=completed,
        started_at_utc='2026-04-20T14:00:00Z', completed_at_utc='2026-04-20T18:00:00Z'))


def fixture():
    components = [component(10, 'lesson', True), component(20, 'quiz', True), component(30, 'lesson')]
    definitions = [dict(id=i, source_activity_id=ref, deleted_at=None,
        curriculum_component_ref=None, source_activity_title='Synthetic activity',
        source_activity_type='quiz' if ref.startswith('quiz:') else 'reading', source_position=i)
        for i, ref in enumerate(('material:10', 'quiz:20', 'material:30', 'material:20', 'quiz:10', 'material:99'), 1)]
    records = [dict(id=i, learner_id=owner, entry_order=1, deleted_at=None, accepted=True,
        activity_status='completed', source_system='journal', kind='reading_quiz',
        component_ref='original', source_payload={'original_source_ref': 'la:50:20'},
        actual_seconds=1800, reporting_month='2026-04') for i, owner in ((100, 1), (200, 2))]
    return dict(course={'source_course_ref': '50', 'source_course_title': 'Synthetic course', 'curriculum_module_ref': 'M'},
        definitions=definitions, export={'curriculum': {'sections': [{'materials': components}]}},
        owners=[{'id': 1}, {'id': 2}], owner={'id': 1}, memberships=[],
        snapshot={'component_progress': components}, progress=records,
        sources=[], journals=[], segments=[], identities=[], source_routes=[])


def simulated_after(state, plan):
    after = deepcopy(state)
    for d in after['definitions']:
        if d['id'] in plan['archive']:
            d['deleted_at'] = '2026-10-13'
    for i, link in enumerate(plan['links'], 1):
        after['sources'].append(dict(id=i, learner_id=link['learner_id'], source_system='old_lms',
            source_activity_id=link['new_ref'], source_catalog_activity_id=link['catalogue_id'],
            canonical_progress_id=link['progress_id'], deleted_at=None, completed=True))
        after['source_routes'].append({'id': link['catalogue_id'], 'source_course_ref': '50'})
    for item in plan['restores']:
        pid = item['progress_id'] or 300
        if item['progress_id'] is None:
            after['progress'].append(dict(id=pid, learner_id=1, entry_order=2, deleted_at=None,
                accepted=False, activity_status='completed', kind='reading', source_system='old_lms',
                component_ref=item['ref'], source_payload={'original_source_ref': 'la:50:10'}, actual_seconds=None))
        after['sources'].append(dict(id=99, learner_id=1, source_system='old_lms',
            source_activity_id=item['ref'], source_catalog_activity_id=item['definition']['id'],
            canonical_progress_id=pid, deleted_at=None, completed=True))
        after['source_routes'].append({'id': item['definition']['id'], 'source_course_ref': '50'})
    return after


class CourseRepairTests(unittest.TestCase):
    def setUp(self):
        self.no_db = patch('psycopg.connect', side_effect=AssertionError('No database in these tests'))
        self.no_db.start()
        self.addCleanup(self.no_db.stop)
        self.state = fixture()

    def plan(self):
        return plan_repair(self.state, ['material:99'], [10])

    def test_rehomes_both_learners_completed_quiz_without_rewriting_hours(self):
        original = deepcopy(self.state)
        plan = self.plan()
        self.assertEqual(plan['archive'], [4, 5, 6])
        self.assertEqual(len(plan['links']), 2)
        self.assertEqual({x['learner_id'] for x in plan['links']}, {1, 2})
        self.assertTrue(all(x['new_ref'] == 'quiz:20' for x in plan['links']))
        after = simulated_after(self.state, plan)
        projected = verify(self.state, after, plan)
        self.assertEqual(sum(x['completed'] for x in projected[1]['items']), 2)
        self.assertEqual(sum(x['completed'] for x in projected[2]['items']), 1)
        self.assertEqual(projected[1]['accepted_hours'], 0.5)
        self.assertEqual(self.state, original)
        again = plan_repair(after, ['material:99'], [10])
        self.assertEqual((again['archive'], again['links'], again['restores']), ([], [], []))

    def test_unknown_extra_is_not_silently_removed(self):
        with self.assertRaisesRegex(ValueError, 'explicit decision'):
            plan_repair(self.state, [], [10])

    def test_native_component_is_not_archived(self):
        self.state['definitions'][3]['curriculum_component_ref'] = 'NATIVE'
        with self.assertRaisesRegex(ValueError, 'native component'):
            self.plan()

    def test_matching_numeric_id_with_conflicting_export_type_is_rejected(self):
        self.state['export']['curriculum']['sections'][0]['materials'][0]['post_type'] = 'stm-quizzes'
        with self.assertRaisesRegex(ValueError, 'unverified component kind'):
            self.plan()

    def test_uncompleted_snapshot_does_not_invent_progress(self):
        self.state['snapshot']['component_progress'][0]['progress']['completed'] = False
        with self.assertRaisesRegex(ValueError, 'does not confirm completion'):
            self.plan()

    def test_deleted_historical_progress_is_not_duplicated(self):
        self.state['progress'].append({**self.state['progress'][0], 'id': 101, 'deleted_at': '2026-04-21',
            'source_payload': {'original_source_ref': 'la:50:10'}})
        with self.assertRaisesRegex(ValueError, 'Historical progress'):
            self.plan()

    def test_ambiguous_progress_for_same_learner_is_rejected(self):
        self.state['progress'].append({**self.state['progress'][0], 'id': 101})
        with self.assertRaisesRegex(ValueError, 'More than one record'):
            self.plan()

    def test_existing_foreign_course_source_remains_authoritative(self):
        self.state['sources'] = [dict(id=1, learner_id=1, source_system='old_lms',
            source_activity_id='material:20', source_catalog_activity_id=1000,
            canonical_progress_id=100, deleted_at=None, completed=True)]
        self.state['source_routes'] = [{'id': 1000, 'source_course_ref': '60'}]
        plan = self.plan()
        self.assertEqual([x['learner_id'] for x in plan['links']], [2])
        self.assertEqual(sum(x['completed'] for x in projections(self.state)[1]['items']), 0)

    def test_verification_rejects_changes_to_existing_evidence(self):
        plan = self.plan()
        after = simulated_after(self.state, plan)
        after['progress'][0]['actual_seconds'] = 900
        with self.assertRaisesRegex(ValueError, 'Existing progress changed'):
            verify(self.state, after, plan)

    def test_verification_rejects_lost_completion_for_other_learner(self):
        plan = self.plan()
        after = simulated_after(self.state, plan)
        after['sources'] = [s for s in after['sources'] if s['learner_id'] == 1]
        with self.assertRaisesRegex(ValueError, 'source record count|completion changed unexpectedly'):
            verify(self.state, after, plan)

    def merged_journal(self):
        self.state['journals'] = [dict(id=1, canonical_learner_id=1, source_ref='la:50:10',
            progress_id=100, source_id=50, deleted_at='2026-04-21')]
        self.state['sources'] = [dict(id=50, learner_id=1, source_system='journal',
            source_activity_id='journal:1', source_catalog_activity_id=None,
            canonical_progress_id=100, deleted_at=None, completed=True)]

    def test_restores_merged_journal_completion_without_new_progress_or_hours(self):
        self.merged_journal()
        plan = self.plan()
        self.assertEqual(plan['restores'][0]['progress_id'], 100)
        after = simulated_after(self.state, plan)
        projected = verify(self.state, after, plan)
        self.assertEqual(len(after['progress']), len(self.state['progress']))
        self.assertEqual(sum(i['completed'] for i in projected[1]['items']), 2)
        self.assertEqual(projected[1]['accepted_hours'], 0.5)
        self.assertEqual(after['journals'], self.state['journals'])

    def test_merged_journal_cannot_link_other_learners_progress(self):
        self.merged_journal()
        self.state['journals'][0]['progress_id'] = 200
        with self.assertRaisesRegex(ValueError, 'progress is unavailable'):
            self.plan()

    def test_merged_journal_source_must_reference_the_same_progress(self):
        self.merged_journal()
        self.state['sources'][0]['canonical_progress_id'] = 200
        with self.assertRaisesRegex(ValueError, 'source ownership is invalid'):
            self.plan()

    def test_cross_course_merged_reading_restores_completion_without_moving_hours(self):
        self.merged_journal()
        self.state['progress'][0]['source_payload'] = {'original_source_ref': 'la:60:30'}
        self.state['snapshot']['component_progress'][0]['material_type'] = 'slides'
        plan = self.plan()
        self.assertIsNone(plan['restores'][0]['progress_id'])
        self.assertEqual(plan['restores'][0]['retained_history_id'], 100)
        after = simulated_after(self.state, plan)
        projection = verify(self.state, after, plan)
        self.assertEqual(sum(i['completed'] for i in projection[1]['items']), 1)
        self.assertEqual(projection[1]['accepted_hours'], 0)
        self.assertEqual(after['progress'][0], self.state['progress'][0])
        self.assertEqual(after['journals'], self.state['journals'])

    def test_retyping_preserves_every_placement_of_a_merged_record(self):
        self.state['sources'] = [dict(id=50, learner_id=1, source_system='journal',
            source_activity_id='journal:1', source_catalog_activity_id=None,
            canonical_progress_id=100, deleted_at=None, completed=True)]
        self.state['journals'] = [dict(id=ident, canonical_learner_id=1, source_ref=f'la:50:{ident}',
            group_id=50, activity_id=ident, progress_id=100, source_id=50, deleted_at=None) for ident in (20, 30)]
        plan = self.plan()
        self.assertEqual({x['new_ref'] for x in plan['links'] if x['learner_id'] == 1}, {'quiz:20', 'material:30'})
        projected = verify(self.state, simulated_after(self.state, plan), plan)
        self.assertEqual(sum(i['completed'] for i in projected[1]['items']), 3)
        self.assertEqual(projected[1]['accepted_hours'], 0.5)

    def test_unrelated_non_object_json_payload_is_preserved(self):
        self.state['progress'].append({**self.state['progress'][0], 'id': 400,
            'component_ref': 'unrelated', 'source_payload': [{'unrelated': 'saved evidence'}]})
        original = deepcopy(self.state)
        plan = self.plan()
        after = simulated_after(self.state, plan)
        verify(self.state, after, plan)
        self.assertEqual(self.state, original)
        self.assertEqual(after['progress'][2], original['progress'][2])

    def test_catalogue_only_keeps_newer_content_and_does_not_restore_progress(self):
        plan = plan_repair(self.state, [], [], catalogue_only=True)
        self.assertEqual(plan['archive'], [4, 5])
        self.assertIn('material:99', plan['expected'])
        self.assertEqual(plan['restores'], [])
        after = simulated_after(self.state, plan)
        verify(self.state, after, plan)
        self.assertEqual(plan_repair(after, [], [], catalogue_only=True)['archive'], [])

    def test_catalogue_only_retains_native_mappings_and_missing_export_items(self):
        self.state['definitions'][3]['curriculum_component_ref'] = 'NATIVE'
        self.state['export']['curriculum']['sections'][0]['materials'].append({
            'source_component_id': 800, 'component_kind': 'quiz', 'post_type': 'stm-quizzes'})
        plan = plan_repair(self.state, [], [], catalogue_only=True)
        self.assertNotIn(4, plan['archive'])
        self.assertNotIn('quiz:800', plan['expected'])
        verify(self.state, simulated_after(self.state, plan), plan)

    def test_unexported_pair_cannot_establish_its_own_authoritative_type(self):
        self.state['definitions'].append({**self.state['definitions'][-1],
            'id': 90, 'source_activity_id': 'quiz:99', 'source_activity_kind': 'quiz'})
        for definitions in (self.state['definitions'], list(reversed(self.state['definitions']))):
            self.state['definitions'] = definitions
            plan = plan_repair(self.state, [], [], catalogue_only=True)
            self.assertIn('material:99', plan['expected'])
            self.assertIn('quiz:99', plan['expected'])
            verify(self.state, simulated_after(self.state, plan), plan)

    def test_catalogue_only_preserves_unsupported_assignments(self):
        self.state['export']['curriculum']['sections'][0]['materials'].append({
            'source_component_id': 99, 'component_kind': 'assignment', 'post_type': 'stm-assignments'})
        plan = plan_repair(self.state, [], [], catalogue_only=True)
        self.assertIn('material:99', plan['expected'])
        verify(self.state, simulated_after(self.state, plan), plan)

    def test_catalogue_only_preserves_conflicting_source_for_another_record(self):
        self.state['sources'] = [dict(id=50, learner_id=1, source_system='old_lms',
            source_activity_id='quiz:20', source_catalog_activity_id=2,
            canonical_progress_id=999, deleted_at=None, completed=True)]
        plan = plan_repair(self.state, [], [], catalogue_only=True)
        self.assertNotIn('material:20', plan['replacements'])
        self.assertEqual(plan['links'], [])
        verify(self.state, simulated_after(self.state, plan), plan)

    def test_catalogue_only_preserves_pair_claimed_by_two_progress_records(self):
        self.state['progress'].append({**self.state['progress'][0], 'id': 101})
        plan = plan_repair(self.state, [], [], catalogue_only=True)
        self.assertNotIn('material:20', plan['replacements'])
        verify(self.state, simulated_after(self.state, plan), plan)

    def test_catalogue_only_never_silently_ignores_requested_restorations(self):
        with self.assertRaisesRegex(ValueError, 'cannot remove unmatched'):
            plan_repair(self.state, [], [10], catalogue_only=True)


if __name__ == '__main__':
    unittest.main()
