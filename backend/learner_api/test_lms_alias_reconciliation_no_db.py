"""Database-free safety regressions for LMS alias reconciliation."""
import unittest
from unittest.mock import MagicMock

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

    def test_identity_payload_normalizes_email_without_logging_it(self):
        payload = reconciliation._identity_payload({
            'aptem_id': 10, 'lms_email': ' Former@Example.org ',
        })
        self.assertEqual(payload['source_email'], 'former@example.org')
        self.assertEqual(payload['identity_import'], reconciliation.RUN_KIND)


if __name__ == '__main__':
    unittest.main()
