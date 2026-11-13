"""Selection and idempotence regressions, using synthetic evidence and no IO."""
from datetime import datetime, timezone
import unittest
from unittest.mock import MagicMock

from scripts.restore_legacy_assignment_visibility import restore, validate_selection


def upload(evidence_id=701, status='PendingAssessment'):
    return dict(evidence_id=evidence_id, learner_id=601, submitted_by_id=601,
                evidence_kind='File', file_blob='synthetic-upload.zip', component_id=801,
                component_name='Project governance - Assignment', evidence_status=status,
                submission_date=datetime(2026, 1, 4, tzinfo=timezone.utc))


class RestoreVisibilityTests(unittest.TestCase):
    def test_valid_selection_preserves_all_original_assessment_states(self):
        rows = [upload(701, 'Accepted'), upload(702, 'Referred'), upload(703)]
        before = [dict(row) for row in rows]
        validate_selection(rows, [701, 702, 703], 601)
        self.assertEqual(rows, before)

    def test_refuses_missing_duplicate_or_cross_learner_evidence(self):
        for rows, ids in (([], [701]), ([upload()], [701, 701]),
                          ([{**upload(), 'learner_id': 602}], [701]),
                          ([{**upload(), 'submitted_by_id': 602}], [701])):
            with self.subTest(ids=ids), self.assertRaises(ValueError):
                validate_selection(rows, ids, 601)

    def test_refuses_non_assignment_notes_missing_files_or_dates(self):
        for field, value in (('component_name', 'Attendance'), ('evidence_kind', 'Note'),
                             ('file_blob', ''), ('submission_date', None), ('component_id', None)):
            with self.subTest(field=field), self.assertRaises(ValueError):
                validate_selection([{**upload(), field: value}], [701], 601)

    def test_existing_restore_is_idempotent_without_rewriting_provenance(self):
        cursor = MagicMock()
        cursor.execute.return_value.fetchone.return_value = {'component_id': 801, 'revoked_at': None}
        self.assertEqual(restore(cursor, [upload()], 501, 601, 'admin:1', 'reviewed upload', 'digest'), 0)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertTrue(cursor.execute.call_args.args[0].startswith('SELECT'))

    def test_revoked_or_reassigned_upload_is_not_silently_restored(self):
        for existing in ({'component_id': 801, 'revoked_at': datetime(2026, 2, 1, tzinfo=timezone.utc)},
                         {'component_id': 802, 'revoked_at': None}):
            cursor = MagicMock()
            cursor.execute.return_value.fetchone.return_value = existing
            with self.subTest(existing=existing), self.assertRaises(ValueError):
                restore(cursor, [upload()], 501, 601, 'admin:1', 'reviewed upload', 'digest')
            self.assertEqual(cursor.execute.call_count, 1)


if __name__ == '__main__':
    unittest.main()
