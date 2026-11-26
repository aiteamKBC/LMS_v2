"""No Django, database or network needed for recording placement rules."""

import unittest
from datetime import datetime

from curriculum_api.session_artifact_placement import recording_matches_occurrence


class RecordingPlacementTests(unittest.TestCase):
    def test_recorded_lecture_near_planned_start_is_accepted(self):
        recording = {'createdDateTime': '2026-10-09T07:47:58Z',
                     'endDateTime': '2026-10-09T10:07:44Z'}
        occurrence = {'scheduled_start': datetime(2026, 10, 9, 8)}
        self.assertTrue(recording_matches_occurrence(recording, occurrence))

    def test_early_rehearsal_does_not_fill_a_future_lecture_even_with_launch(self):
        recording = {'createdDateTime': '2026-10-08T10:54:13Z',
                     'endDateTime': '2026-10-08T12:35:18Z'}
        occurrence = {'scheduled_start': datetime(2026, 10, 15, 11)}
        self.assertFalse(recording_matches_occurrence(recording, occurrence, linked_by_launch=True))

    def test_late_unlinked_run_does_not_fill_an_old_lecture(self):
        recording = {'createdDateTime': '2026-10-14T02:55:49Z',
                     'endDateTime': '2026-10-14T06:55:49Z'}
        occurrence = {'scheduled_start': datetime(2026, 10, 9, 6)}
        self.assertFalse(recording_matches_occurrence(recording, occurrence))

    def test_launch_allows_real_session_that_started_after_schedule_shift(self):
        recording = {'createdDateTime': '2026-10-09T19:00:00Z',
                     'endDateTime': '2026-10-09T21:00:00Z'}
        occurrence = {'scheduled_start': datetime(2026, 10, 9, 6)}
        self.assertTrue(recording_matches_occurrence(recording, occurrence, linked_by_launch=True))

    def test_missing_timestamps_cannot_be_placed(self):
        self.assertFalse(recording_matches_occurrence({}, {'scheduled_start': datetime(2026, 10, 9, 6)}))


if __name__ == '__main__':
    unittest.main()
