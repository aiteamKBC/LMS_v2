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
                    [{'learner_id': 100, 'group_id': 50}],
                    [{'id': 5, 'source_course_ref': '50'}],
                ]) as read:
                    memberships, unmapped = reconciliation._course_memberships(MagicMock(), result['eligible'])
                self.assertEqual(read.call_args_list[0].args[2], [[100]])
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


if __name__ == '__main__':
    unittest.main()
