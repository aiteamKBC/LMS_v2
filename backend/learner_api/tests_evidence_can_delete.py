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
import inspect
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase

from . import evidence
from .evidence import _evidence_lineage, _is_submitted_for_marking


class EvidenceLineageOwnershipTests(SimpleTestCase):
    """A component match alone must never attach another learner's progress."""

    def test_progress_lookup_is_scoped_to_the_target_learners_profile_ids(self):
        cursor = MagicMock()
        cursor.fetchone.side_effect = [(1,), (902,)]
        connection = patch("learner_api.evidence._conn").start()
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        patch(
            "learner_api.evidence._learner_profile_ids_for_source",
            return_value=["248"],
        ).start()
        self.addCleanup(patch.stopall)

        lineage = _evidence_lineage("commercial", "56", "COMP-1")

        self.assertEqual(lineage, {"component_ref": "COMP-1", "progress_entry_id": 902})
        progress_sql, progress_params = cursor.execute.call_args_list[1].args
        self.assertIn("p.learner_id::text = any(%s)", progress_sql)
        self.assertEqual(progress_params, ["COMP-1", ["248"]])

    def test_missing_target_profile_cannot_attach_any_progress_entry(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = (1,)
        connection = patch("learner_api.evidence._conn").start()
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        patch(
            "learner_api.evidence._learner_profile_ids_for_source",
            return_value=[],
        ).start()
        self.addCleanup(patch.stopall)

        lineage = _evidence_lineage("commercial", "56", "COMP-1")

        self.assertEqual(lineage, {"component_ref": "COMP-1", "progress_entry_id": None})
        self.assertEqual(cursor.execute.call_count, 1)


class EvidenceUploadDeleteTests(SimpleTestCase):
    """Exercise the request handlers without a database or live Azure calls."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_upload_saves_the_server_resolved_progress_lineage(self):
        cursor = MagicMock()
        connection = self.enterContext(patch.object(evidence, "_conn"))
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        self.enterContext(patch.object(evidence, "azure_configured", return_value=True))
        self.enterContext(patch.object(evidence, "ensure_evidence_tables"))
        self.enterContext(patch.object(evidence, "upload_to_quarantine"))
        self.enterContext(patch.object(evidence, "move_blob"))
        self.enterContext(patch.object(evidence, "blob_url", return_value="https://files.example.test/evidence"))
        self.enterContext(patch.object(evidence, "_record_approved_evidence"))
        self.enterContext(patch.object(
            evidence,
            "_evidence_lineage",
            return_value={"component_ref": "COMP-1", "progress_entry_id": 902},
        ))
        uploaded = SimpleUploadedFile("report.pdf", b"evidence", content_type="application/pdf")
        request = self.factory.post("/upload/", {"section_ref": "COMP-1", "file": uploaded})

        response = inspect.unwrap(evidence.upload_evidence)(request, kind="commercial", pk=56)

        self.assertEqual(response.status_code, 201)
        insert_call = next(call for call in cursor.execute.call_args_list if "insert into" in call.args[0].lower())
        self.assertEqual(insert_call.args[1][-2:], ["COMP-1", 902])

    def test_delete_of_another_learners_file_is_not_found(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        connection = self.enterContext(patch.object(evidence, "_conn"))
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        self.enterContext(patch.object(evidence, "ensure_evidence_tables"))
        delete_blob = self.enterContext(patch.object(evidence, "delete_blob"))
        request = self.factory.delete("/evidence/file-id/")

        response = inspect.unwrap(evidence.delete_evidence)(
            request,
            kind="commercial",
            pk=56,
            file_id="file-id",
        )

        self.assertEqual(response.status_code, 404)
        lookup_sql, lookup_params = cursor.execute.call_args.args
        self.assertIn("learner_kind = %s and learner_id = %s", lookup_sql)
        self.assertEqual(lookup_params, ["file-id", "commercial", "56"])
        delete_blob.assert_not_called()
        self.assertEqual(cursor.execute.call_count, 1)

    def test_owner_can_delete_an_unsubmitted_file_with_scoped_queries(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = ("commercial/56/COMP-1/file.pdf", "approved", "COMP-1", None)
        connection = self.enterContext(patch.object(evidence, "_conn"))
        connection.return_value.cursor.return_value.__enter__.return_value = cursor
        self.enterContext(patch.object(evidence, "ensure_evidence_tables"))
        self.enterContext(patch.object(evidence, "_is_submitted_for_marking", return_value=False))
        self.enterContext(patch.object(evidence, "azure_configured", return_value=False))
        request = self.factory.delete("/evidence/file-id/")

        response = inspect.unwrap(evidence.delete_evidence)(
            request,
            kind="commercial",
            pk=56,
            file_id="file-id",
        )

        self.assertEqual(response.status_code, 200)
        delete_call = next(
            call for call in cursor.execute.call_args_list
            if call.args[0].strip().lower().startswith("delete from")
            and "evidence_files" in call.args[0]
        )
        self.assertEqual(delete_call.args[1], ["file-id", "commercial", "56"])


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
