"""Static safety checks for QR deletion cleanup SQL."""
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name('migrations') / '0085_qr_attendance_delete_cleanup.py'


class QRAttendanceDeleteCleanupTests(unittest.TestCase):
    def test_delete_cleanup_cascades_direct_register_rows(self):
        source = SOURCE.read_text(encoding='utf-8')
        self.assertIn('ON DELETE CASCADE', source)
        self.assertIn('qr_attendance_delete_cleanup', source)
        self.assertIn('parallel_source_occurrence_id = OLD.occurrence_id', source)

    def test_delete_cleanup_restores_existing_original_and_removes_generated_one(self):
        source = SOURCE.read_text(encoding='utf-8')
        self.assertIn("parallel_created = true", source)
        self.assertIn("parallel_created = false", source)
        self.assertIn("COALESCE(parallel_previous_status, 'absent')", source)
        self.assertIn("COALESCE(parallel_previous_basis, 'teams')", source)


if __name__ == '__main__':
    unittest.main(verbosity=2)
