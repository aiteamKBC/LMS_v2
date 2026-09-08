"""When a learner may still remove their own evidence.

Two things have to agree here, and they did not.

`delete_evidence` refuses (409) once the work has been handed in. The list
endpoint has to reach the same verdict, or the page shows a Remove button that
the server then rejects -- which is what a learner hit on an activity they were
still working through.

The rule itself was also wrong. It keyed on a *progress entry*, which records
that the learner completed an activity: 1,439 of those exist against 18 marking
records, so nearly every completed video and reading locked its evidence even
though no coach would ever see it. A hand-in is a row in
``learning_reflection_submissions`` -- the reflection the learner signs and
sends -- and that is what these assert.
"""
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from .evidence import _is_submitted_for_marking


class SubmittedForMarkingTests(SimpleTestCase):
    def _cursor(self, *, submission_row, profile_ids=("101",)):
        cursor = MagicMock()
        cursor.fetchone.return_value = submission_row
        conn = patch("learner_api.evidence._conn").start()
        conn.return_value.cursor.return_value.__enter__.return_value = cursor
        patch(
            "learner_api.evidence._learner_profile_ids_for_source",
            return_value=list(profile_ids),
        ).start()
        self.addCleanup(patch.stopall)
        return cursor

    def test_an_activity_sent_to_a_coach_is_locked(self):
        self._cursor(submission_row=(1,))

        self.assertTrue(_is_submitted_for_marking("commercial", "101", "COMP-1"))

    def test_a_completed_activity_that_was_never_submitted_stays_editable(self):
        # The bug this replaces. Finishing an activity writes a progress entry;
        # it does not hand anything to a coach, and the learner must still be
        # able to swap a file they uploaded by mistake.
        self._cursor(submission_row=None)

        self.assertFalse(_is_submitted_for_marking("commercial", "101", "COMP-1"))

    def test_an_activity_with_no_section_is_not_locked(self):
        # Nothing to look up; a file with no section was never part of a
        # submission.
        self.assertFalse(_is_submitted_for_marking("commercial", "101", ""))
        self.assertFalse(_is_submitted_for_marking("commercial", "101", None))

    def test_a_database_failure_locks_rather_than_unlocks(self):
        # Refusing is the recoverable direction: a learner can ask a tutor,
        # whereas a file deleted from a submission a coach has read is gone.
        conn = patch("learner_api.evidence._conn").start()
        self.addCleanup(patch.stopall)
        conn.return_value.cursor.side_effect = DatabaseError("connection lost")

        self.assertTrue(_is_submitted_for_marking("commercial", "101", "COMP-1"))

    def test_the_lookup_accepts_both_learner_id_shapes(self):
        # Submissions are keyed on the enrolment id the learner page uses, but
        # historic rows carry a profile id, so both have to be searched or an
        # older submission would not lock its evidence.
        cursor = self._cursor(submission_row=(1,), profile_ids=("101", "248"))

        _is_submitted_for_marking("commercial", "101", "COMP-1")

        candidates = cursor.execute.call_args[0][1][2]
        self.assertIn("101", candidates)
        self.assertIn("248", candidates)


class CanDeleteContractTests(SimpleTestCase):
    """The list and the delete gate must keep answering with the same rule."""

    def test_both_paths_ask_the_same_question(self):
        # They live in separate request handlers, and a change to one that
        # forgets the other is exactly the mismatch this file exists to prevent.
        from pathlib import Path

        source = Path(__file__).with_name("evidence.py").read_text(encoding="utf-8")
        list_body = source.split("def list_evidence")[1].split("def download_evidence")[0]
        delete_body = source.split("def delete_evidence")[1]

        # Both reach the same lookup: the list through _marking_status, the
        # delete gate through _is_submitted_for_marking, which is defined as a
        # reading of _marking_status. What matters is that neither invents its
        # own rule.
        self.assertIn("_marking_status", list_body)
        self.assertIn("_is_submitted_for_marking", delete_body)

        gate = source.split("def _is_submitted_for_marking")[1].split("\ndef ")[0]
        self.assertIn("_marking_status", gate)

    def test_the_gate_no_longer_keys_on_progress_entries(self):
        # Guards the regression directly: progress entries mean "completed",
        # not "submitted", and keying on them locked ~1,400 activities.
        from pathlib import Path

        source = Path(__file__).with_name("evidence.py").read_text(encoding="utf-8")
        # The lookup itself now lives in _marking_status, which both paths reach.
        lookup = source.split("def _marking_status")[1].split("\ndef ")[0]

        self.assertIn("learning_reflection_submissions", lookup)
        self.assertNotIn("learner_progress_entries", lookup)
