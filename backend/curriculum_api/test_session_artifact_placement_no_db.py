"""No Django, database or network needed for recording placement rules."""

import unittest
from datetime import datetime

from curriculum_api.session_artifact_placement import recording_matches_occurrence, overlapping_artifact_occurrence


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


class ArtifactRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.artifact = {'createdDateTime': '2026-11-27T08:25:21Z', 'endDateTime': '2026-11-27T10:55:05Z'}
        self.current = {'id': 'current', 'scheduled_start': datetime(2026, 11, 27, 9),
                        'scheduled_end': datetime(2026, 11, 27, 11), 'status': 'scheduled'}
        self.future = {**self.current, 'id': 'future', 'scheduled_start': datetime(2026, 12, 4, 9),
                       'scheduled_end': datetime(2026, 12, 4, 11)}

    def test_future_join_rejection_recovers_the_actual_lecture(self):
        self.assertFalse(recording_matches_occurrence(self.artifact, self.future, linked_by_launch=True))
        self.assertIs(overlapping_artifact_occurrence(self.artifact, [self.future, self.current]), self.current)

    def test_two_overlapping_slots_are_not_guessed(self):
        self.assertIsNone(overlapping_artifact_occurrence(self.artifact, [self.current, {**self.current, 'id': 'other'}]))

    def test_rehearsal_without_a_planned_overlap_stays_unfiled(self):
        rehearsal = {'createdDateTime': '2026-11-26T15:07:11Z', 'endDateTime': '2026-11-26T15:09:35Z'}
        self.assertIsNone(overlapping_artifact_occurrence(rehearsal, [self.current, self.future]))

    def test_cancelled_or_superseded_slots_are_not_recovered(self):
        for status in ('cancelled', 'canceled', 'deleted', 'superseded', 'failed', ' CANCELED ', 'Failed'):
            self.assertIsNone(overlapping_artifact_occurrence(self.artifact, [{**self.current, 'status': status}]))

    def test_incomplete_or_reversed_windows_are_not_recovered(self):
        for artifact in ({}, {'createdDateTime': '2026-11-27T08:25:21Z'},
                         {'createdDateTime': '2026-11-27T10:55:05Z', 'endDateTime': '2026-11-27T08:25:21Z'}):
            self.assertIsNone(overlapping_artifact_occurrence(artifact, [self.current]))

    def test_touching_a_boundary_is_not_a_lecture_overlap(self):
        for artifact in ({'createdDateTime': '2026-11-27T08:00:00Z', 'endDateTime': '2026-11-27T09:00:00Z'},
                         {'createdDateTime': '2026-11-27T11:00:00Z', 'endDateTime': '2026-11-27T12:00:00Z'}):
            self.assertIsNone(overlapping_artifact_occurrence(artifact, [self.current]))


if __name__ == '__main__':
    unittest.main()
