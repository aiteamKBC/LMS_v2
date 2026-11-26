"""Per-learner counts of what a coach accepted and rejected.

Stored on Learner.learners so a learner's marking record can be read without
aggregating the submissions table, and recomputed from those submissions after
every decision rather than incremented -- a counter nudged on each decision
drifts the first time a coach changes their mind, with nothing to show it has.
"""
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import marking_tally as tally


class ComputeTallyTests(SimpleTestCase):
    def _rows(self, rows):
        cursor = MagicMock()
        cursor.fetchall.return_value = rows
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
        patch.object(tally, "connections", conn).start()
        patch.object(tally, "_learner_ids_for_profile", return_value=["1"]).start()
        self.addCleanup(patch.stopall)
        return cursor

    def test_assignments_and_reflections_are_counted_separately(self):
        self._rows([
            ("assignment", "accepted", 3),
            ("assignment", "rejected", 1),
            ("reading", "accepted", 5),
            ("video", "referred", 2),
        ])

        self.assertEqual(tally.compute_tally(1), {
            "accepted_assignments": 3,
            "rejected_assignments": 1,
            "accepted_reflections": 5,
            "rejected_reflections": 2,
        })

    def test_work_still_waiting_on_a_coach_counts_in_neither(self):
        # The whole point: nothing is counted until somebody has decided.
        self._rows([
            ("assignment", "submitted_for_tutor_review", 9),
            ("reading", "escalated", 4),
        ])

        self.assertEqual(sum(tally.compute_tally(1).values()), 0)

    def test_a_partial_award_counts_as_accepted(self):
        # The learner was awarded something, so it is not a rejection.
        self._rows([("quiz", "partial", 1)])

        self.assertEqual(tally.compute_tally(1)["accepted_reflections"], 1)

    def test_referred_counts_as_rejected(self):
        # Sent back for more work -- the learner has to act on it.
        self._rows([("assignment", "referred", 2)])

        self.assertEqual(tally.compute_tally(1)["rejected_assignments"], 2)

    def test_a_learner_with_no_submissions_is_all_zero(self):
        self._rows([])

        self.assertEqual(sum(tally.compute_tally(1).values()), 0)

    def test_an_unknown_learner_yields_nothing_rather_than_zeroes(self):
        # None tells refresh_tally to leave the stored values alone; writing
        # zeroes would erase a real marking record.
        conn = MagicMock()
        patch.object(tally, "connections", conn).start()
        patch.object(tally, "_learner_ids_for_profile", return_value=[]).start()
        self.addCleanup(patch.stopall)

        self.assertIsNone(tally.compute_tally(1))

    def test_a_database_failure_yields_nothing(self):
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.side_effect = DatabaseError("down")
        patch.object(tally, "connections", conn).start()
        self.addCleanup(patch.stopall)

        self.assertIsNone(tally.compute_tally(1))


class RefreshTallyTests(SimpleTestCase):
    def test_nothing_is_written_when_the_counts_could_not_be_read(self):
        # Otherwise a transient failure would zero a learner's record.
        conn = MagicMock()
        patch.object(tally, "connections", conn).start()
        patch.object(tally, "compute_tally", return_value=None).start()
        self.addCleanup(patch.stopall)

        self.assertIsNone(tally.refresh_tally(1))
        conn.__getitem__.return_value.cursor.return_value.__enter__.return_value.execute.assert_not_called()

    def test_a_write_failure_is_reported_not_raised(self):
        # This runs after a coach has saved a decision; a counter problem must
        # not turn a successful marking into an error they see.
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.side_effect = DatabaseError("down")
        patch.object(tally, "connections", conn).start()
        patch.object(tally, "compute_tally", return_value=dict.fromkeys(tally.TALLY_COLUMNS, 0)).start()
        self.addCleanup(patch.stopall)

        self.assertIsNone(tally.refresh_tally(1))
