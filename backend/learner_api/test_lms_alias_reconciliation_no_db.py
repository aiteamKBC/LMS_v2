"""Database-free safety regressions for LMS alias reconciliation."""
import importlib.util
import inspect
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

from learner_api import lms_alias_reconciliation as reconciliation


class LmsAliasReconciliationTests(unittest.TestCase):
    def test_completion_rules_are_conservative(self):
        self.assertTrue(reconciliation.result_is_completed({'status': 'completed'}))
        self.assertTrue(reconciliation.result_is_completed({
            'activity_type': 'Video', 'video_completed': True,
        }))
        self.assertTrue(reconciliation.result_is_completed({
            'activity_type': 'Reading + Quiz', 'reading_viewed': True, 'quiz_passed': True,
        }))
        self.assertFalse(reconciliation.result_is_completed({
            'activity_type': 'Reading + Quiz', 'reading_viewed': True, 'quiz_passed': False,
        }))
        self.assertFalse(reconciliation.result_has_completed_quiz({
            'activity_type': 'Reading + Quiz', 'reading_viewed': False, 'quiz_passed': True,
        }))

    def test_apply_is_blocked_on_production_and_branch_mismatch(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ('br-holy-band-abhispwg',)
        with self.assertRaisesRegex(ValueError, 'Production'):
            reconciliation.verify_apply_branch(cursor, 'br-holy-band-abhispwg')
        cursor.fetchone.return_value = ('br-safe-child',)
        with self.assertRaisesRegex(ValueError, 'does not match'):
            reconciliation.verify_apply_branch(cursor, 'br-another-child')
        cursor.fetchone.return_value = ('br-safe-child',)
        self.assertEqual(
            reconciliation.verify_apply_branch(cursor, 'br-safe-child'), 'br-safe-child'
        )

    def test_reconciliation_has_no_deleted_identity_dependency(self):
        source = inspect.getsource(reconciliation)
        self.assertNotIn('learner_external_identities', source)
        self.assertIn('"Last_audit".learner_lms_aliases', source)
        self.assertNotIn('source_lms_learner_aliases', source)
        self.assertNotIn('source_lms_group_learners', source)

    def test_only_owned_matching_aliases_feed_course_memberships(self):
        aliases = [
            {'aptem_id': 10, 'canonical_lms_id': 100, 'lms_learner_id': 100,
             'aptem_email': 'current@example.test', 'lms_email': 'current@example.test',
             'is_primary': True, 'learner_profile_id': 1},
            {'aptem_id': 10, 'canonical_lms_id': 100, 'lms_learner_id': 101,
             'aptem_email': 'current@example.test', 'lms_email': 'former@example.test',
             'is_primary': False, 'learner_profile_id': None},
        ]
        owner = {'learner_id': 1, 'aptem_id': 10, 'enrolment_id': 11,
                 'owner_email': 'current@example.test', 'account_id': None}
        for owner_aptem, linked_profile, expected in ((10, 1, {10}), (20, 1, set()), (10, None, set())):
            with self.subTest(owner_aptem=owner_aptem, linked_profile=linked_profile):
                rows = [{**aliases[0], 'learner_profile_id': linked_profile}, aliases[1]]
                with patch.object(reconciliation, '_rows', side_effect=[rows, [{**owner, 'aptem_id': owner_aptem}]]):
                    result = reconciliation._candidate_identities(MagicMock())
                self.assertEqual(set(result['eligible']), expected)
                if not expected:
                    continue
                self.assertEqual(result['eligible'][10]['aliases'], [rows[0]])
                with patch.object(reconciliation, '_rows', side_effect=[
                    [{'learner_id': 1, 'source_course_id': 5, 'source_learner_id': '100'}],
                ]) as read:
                    memberships, unmapped = reconciliation._course_memberships(MagicMock(), result['eligible'])
                self.assertEqual(read.call_args_list[0].args[2], [[1], 'old_lms'])
                self.assertEqual(unmapped, 0)
                self.assertEqual(memberships, [{'learner_id': 1, 'enrolment_id': 11,
                    'source_course_id': 5, 'source_learner_id': '100', 'is_primary': True}])

    def test_sync_script_is_read_only_and_rejects_apply(self):
        path = Path(__file__).resolve().parents[1] / 'scripts' / 'sync_legacy_lms_identities.py'
        source = path.read_text(encoding='utf-8-sig')
        self.assertNotIn('learner_external_identities', source)
        for verb in ('INSERT INTO', 'UPDATE "Learner"', 'DELETE FROM', 'LOCK TABLE'):
            self.assertNotIn(verb, source)
        spec = importlib.util.spec_from_file_location('sync_legacy_lms_identities', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaises(SystemExit):
            module.parse_args(['--apply'])
        source_row = {
            'aptem_id': 10, 'canonical_lms_id': 100, 'lms_learner_id': 100,
            'aptem_email': None, 'lms_email': None, 'is_primary': True,
            'match_basis': 'synthetic', 'first_seen': 'a', 'last_seen': 'b',
        }
        canonical_row = {**source_row, 'learner_profile_id': None}
        report = module.verify({
            'source': [source_row, {**source_row, 'lms_learner_id': 101}],
            'aliases': [canonical_row],
            'linked': [],
        })
        self.assertTrue(report['consistent'])
        self.assertEqual(report['historical_records'], 1)
        self.assertEqual(report['source_only_records'], 1)


class MembershipActivityOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.eligible = {10: {'owner': {'learner_id': 1, 'enrolment_id': 11},
            'aliases': [{'aptem_id': 10, 'lms_learner_id': 100, 'is_primary': True},
                        {'aptem_id': 10, 'lms_learner_id': 101, 'is_primary': False}]},
            20: {'owner': {'learner_id': 2}, 'aliases': [{'aptem_id': 20, 'lms_learner_id': 200}]}}

    def result(self, **changes):
        return {'membership_id': 7, 'canonical_learner_id': 1,
                'source_course_id': 5, 'course_source_system': 'old_lms',
                'membership_deleted_at': None, 'learner_id': 101, 'group_id': 999,
                'activity_id': 8, 'activity_type': 'reading', 'status': 'completed',
                **changes}

    def definition(self, course=5, activity='material:8'):
        return {'source_course_id': course, 'source_course_ref': str(course * 10),
                'source_activity_id': activity, 'source_catalog_activity_id': course * 100,
                'source_activity_type': 'reading'}

    def candidates(self, rows, definitions=None):
        definitions = definitions or [self.definition()]
        with patch.object(reconciliation, '_rows', side_effect=[rows, definitions]) as read:
            candidates, stats = reconciliation._completion_candidates(None, self.eligible)
        sql = read.call_args_list[0].args[1]
        self.assertIn('m.id=r.membership_id', sql)
        self.assertIn('c.id=m.source_course_id', sql)
        self.assertIn('c.id=ANY(%s)', read.call_args_list[1].args[1])
        return candidates, stats

    def test_secondary_identity_uses_membership_course_not_historical_group(self):
        candidates, stats = self.candidates([self.result()])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['learner_id'], 1)
        self.assertEqual(candidates[0]['source_course_ref'], '50')
        self.assertEqual(candidates[0]['source_learner_ids'], ['101'])
        self.assertEqual(stats['unresolved_activity_ownership'], 0)

    def test_two_approved_accounts_do_not_duplicate_the_same_activity(self):
        candidates, _ = self.candidates([self.result(), self.result(learner_id=100)])
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]['source_learner_ids'], ['100', '101'])

    def test_shared_course_does_not_merge_unrelated_learners(self):
        candidates, _ = self.candidates([self.result(), self.result(
            membership_id=9, learner_id=200, canonical_learner_id=2)])
        self.assertEqual([c['learner_id'] for c in candidates], [1, 2])

    def test_missing_wrong_and_unapproved_ownership_are_rejected(self):
        for changes in ({'membership_id': None}, {'canonical_learner_id': 2},
                        {'learner_id': 300}, {'course_source_system': 'another_lms'}):
            with self.subTest(changes=changes):
                candidates, stats = self.candidates([self.result(**changes)])
                self.assertEqual(candidates, [])
                self.assertEqual(stats['unresolved_activity_ownership'], 1)

    def test_inactive_membership_does_not_restore_access_or_completion(self):
        candidates, stats = self.candidates([self.result(membership_deleted_at='historical')])
        self.assertEqual(candidates, [])
        self.assertEqual(stats['inactive_membership_results'], 1)

    def test_multiple_courses_retain_distinct_activities(self):
        candidates, _ = self.candidates([self.result(), self.result(
            membership_id=8, source_course_id=6, activity_id=9)],
            [self.definition(), self.definition(6, 'material:9')])
        self.assertEqual([c['source_course_id'] for c in candidates], [5, 6])
        with patch.object(reconciliation, '_rows', side_effect=[[], [], []]):
            state = reconciliation._existing_state(None, self.eligible, candidates, [])
        self.assertEqual([a['action'] for a in state['activity_actions']],
                         ['create_progress', 'create_progress'])

    def test_cross_course_activity_id_collision_is_not_merged(self):
        candidates, _ = self.candidates([self.result(), self.result(
            membership_id=8, source_course_id=6)], [self.definition(), self.definition(6)])
        self.assertEqual(len(candidates), 2)
        with patch.object(reconciliation, '_rows', side_effect=[[], [], []]):
            state = reconciliation._existing_state(None, self.eligible, candidates, [])
        self.assertEqual(state['ambiguous_activity_links'], 2)
        self.assertTrue(all(a['action'] == 'ambiguous' for a in state['activity_actions']))

    def test_memberships_are_existing_owned_rows_only(self):
        with patch.object(reconciliation, '_rows', return_value=[
            {'learner_id': 1, 'source_course_id': 5, 'source_learner_id': '101'},
            {'learner_id': 1, 'source_course_id': 6, 'source_learner_id': '100'},
            {'learner_id': 2, 'source_course_id': 5, 'source_learner_id': '101'},
        ]) as read:
            memberships, unresolved = reconciliation._course_memberships(None, self.eligible)
        self.assertEqual(len(memberships), 2)
        self.assertEqual(unresolved, 1)
        self.assertIn('m.deleted_at IS NULL', read.call_args.args[1])
        self.assertNotIn('INSERT INTO "Learner".learner_source_course_memberships',
                         inspect.getsource(reconciliation.apply))

    def test_unresolved_ownership_blocks_apply_before_any_write(self):
        cursor = MagicMock()
        with patch.object(reconciliation, 'verify_apply_branch'), patch.object(
                reconciliation, 'inspect', return_value=({}, {}, {
                    'identity_conflicts': 0, 'unresolved_activity_ownership': 1})):
            with self.assertRaisesRegex(ValueError, 'ownership'):
                reconciliation.apply(cursor, 'synthetic')
        cursor.execute.assert_not_called()

    def test_existing_activity_source_must_belong_to_same_course(self):
        candidates, _ = self.candidates([self.result()])
        for course, expected in (('50', 'existing_source'), ('60', 'ambiguous'), (None, 'ambiguous')):
            with self.subTest(course=course), patch.object(reconciliation, '_rows', side_effect=[
                [], [{'learner_id': 1, 'source_activity_id': 'material:8', 'source_course_ref': course}], [],
            ]):
                state = reconciliation._existing_state(None, self.eligible, candidates, [])
                self.assertEqual(state['activity_actions'][0]['action'], expected)

    def test_progress_ownership_requires_course_scoped_evidence(self):
        candidates, _ = self.candidates([self.result()])
        for key, payload, expected in (
            ('old_lms:1:50:material:8', {}, 'attach_source'),
            (None, {'original_source_ref': 'la:50:8'}, 'attach_source'),
            ('old_lms:1:60:material:8', {}, 'ambiguous'),
            (None, {}, 'ambiguous'),
        ):
            with self.subTest(key=key, payload=payload), patch.object(reconciliation, '_rows', side_effect=[
                [], [], [{'id': 4, 'learner_id': 1, 'source_system': 'old_lms',
                          'source_activity_id': 'material:8', 'canonical_activity_key': key,
                          'source_payload': payload}],
            ]):
                state = reconciliation._existing_state(None, self.eligible, candidates, [])
                self.assertEqual(state['activity_actions'][0]['action'], expected)


if __name__ == '__main__':
    unittest.main()
