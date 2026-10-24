"""Completing a tutor-validated activity hands it to a coach.

An assignment is authored with tutor_validation_required=true and, in this
curriculum, reflection_required=false. The learner finishes it like any other
activity -- but finishing is a hand-in, not a completion. The marking queue
reads Learner.learning_reflection_submissions, so unless a row lands there the
learner sees a green tick and the coach sees an empty queue, which is exactly
what happened.

These cover the row that completion now writes, and the one case where it must
not overwrite what a coach already decided.
"""
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from . import marking_queue_entry as entry


class RequiresTutorValidationTests(SimpleTestCase):
    def _row(self, value):
        cursor = MagicMock()
        cursor.fetchone.return_value = value
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
        patch.object(entry, "connections", conn).start()
        self.addCleanup(patch.stopall)

    def test_a_component_marked_for_validation_is_reported(self):
        self._row((True,))

        self.assertTrue(entry.requires_tutor_validation("COMP-1"))

    def test_an_ordinary_component_is_not(self):
        self._row((False,))

        self.assertFalse(entry.requires_tutor_validation("COMP-1"))

    def test_a_lookup_failure_does_not_gate(self):
        # Fail open: a database problem must not start queueing every activity
        # for marking, which would bury coaches in work nobody asked them to do.
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.side_effect = DatabaseError("down")
        patch.object(entry, "connections", conn).start()
        self.addCleanup(patch.stopall)

        self.assertFalse(entry.requires_tutor_validation("COMP-1"))


class QueueForMarkingTests(SimpleTestCase):
    def setUp(self):
        self.atomic = patch.object(entry.transaction, "atomic").start()
        self.audit = patch.object(entry, "record_submission_row").start()
        self.addCleanup(patch.stopall)

    def _conn(self, *, existing=None, evidence=(), inserted=("sub-1",), topic=None, assignment=True):
        cursor = MagicMock()
        # Assignment topic lookup -> existing legacy -> evidence -> insert.
        cursor.fetchone.side_effect = ([topic] if assignment else []) + [existing, inserted]
        cursor.fetchall.return_value = [(name,) for name in evidence]
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
        patch.object(entry, "connections", conn).start()
        self.addCleanup(patch.stopall)
        return cursor

    def _context(self):
        return {
            "learnerName": "Aya Test",
            "programmeName": "Test fouda",
            "activityType": "assignment",
            "activityTitle": "Assignment 2test",
            "moduleTitle": "Module 1",
            "weekTitle": "Week 8",
            "plannedOtjh": "2h",
            "actualTimeHours": "02:00:00",
            "progressEntryId": None,
        }

    def test_a_completed_assignment_is_queued(self):
        self._conn(evidence=["May Assignment.pdf"])

        result = entry.queue_for_marking(
            component_id="COMP-1", kind="commercial", learner_id="101",
            context=self._context(),
        )

        self.assertEqual(result, "sub-1")

    def test_component_clock_is_stored_as_decimal_hours(self):
        self.assertEqual(entry._actual_time_hours("02:00"), 2 / 60)
        self.assertEqual(entry._actual_time_hours("2"), 2.0)

    def test_the_uploaded_evidence_travels_with_it(self):
        # The evidence is the submission -- without it the coach has a queue row
        # naming work they cannot open.
        cursor = self._conn(evidence=["May Assignment.pdf", "notes.docx"])

        entry.queue_for_marking(
            component_id="COMP-1", kind="commercial", learner_id="101",
            context=self._context(),
        )

        params = cursor.execute.call_args[0][1]
        self.assertIn('["May Assignment.pdf", "notes.docx"]', params)

    def test_an_accepted_submission_is_left_alone(self):
        # Re-completing the activity must not reopen a decision a coach has
        # already made and recorded against their name.
        cursor = self._conn(existing=("sub-existing", "accepted"))

        result = entry.queue_for_marking(
            component_id="COMP-1", kind="commercial", learner_id="101",
            context=self._context(),
        )

        self.assertEqual(result, "sub-existing")
        # Assignment lock and two lookups; no submission/audit write.
        self.assertEqual(cursor.execute.call_count, 3)
        self.audit.assert_not_called()

    def test_a_pending_submission_is_refreshed_rather_than_duplicated(self):
        # Same upsert key as the reflection flow, so re-finishing updates the
        # row instead of giving the coach the same work twice.
        self._conn(existing=("sub-existing", "submitted_for_tutor_review"))

        result = entry.queue_for_marking(
            component_id="COMP-1", kind="commercial", learner_id="101",
            context=self._context(),
        )

        self.assertEqual(result, "sub-1")

    def test_a_write_failure_is_reported_not_raised(self):
        # The learner has finished their work; a queue row that could not be
        # written must not turn that into an error they see.
        conn = MagicMock()
        conn.__getitem__.return_value.cursor.side_effect = DatabaseError("down")
        patch.object(entry, "connections", conn).start()
        self.addCleanup(patch.stopall)

        self.assertIsNone(entry.queue_for_marking(
            component_id="COMP-1", kind="commercial", learner_id="101",
            context=self._context(),
        ))

    def test_topic_submission_prevents_empty_queue_entries_on_completion_and_reward_retries(self):
        for kind in ("commercial", "apprenticeship"):
            for status in ("submitted_for_tutor_review", "accepted", "draft", "needs_revision", "rejected"):
                for reward_retry in (False, True):
                    with self.subTest(kind=kind, status=status, reward_retry=reward_retry):
                        cursor = self._conn(topic=("topic-original", status))
                        context = self._context()
                        if reward_retry:
                            context.update(sharedRewardProgressId=123, progressEntryId=123)
                        result = entry.queue_for_marking(
                            component_id="COMP-1", kind=kind, learner_id="101", context=context,
                        )
                        self.assertEqual(result, "topic-original" if status in ("accepted", "submitted_for_tutor_review") else None)
                        self.atomic.assert_called_with(using="enrolment")
                        self.assertIn("pg_advisory_xact_lock", cursor.execute.call_args_list[0].args[0])
                        self.assertEqual(cursor.execute.call_args_list[0].args[1],
                                         [f'["assignment-daily-hours", "{kind}", "101"]'])
                        self.assertEqual(cursor.execute.call_count, 2)
                        self.assertEqual(cursor.execute.call_args.args[1], [kind, "101", "COMP-1"])
                        self.assertIn("assignment_topic_id <> ''", cursor.execute.call_args.args[0])
                        self.assertIn("activity_type='assignment'", cursor.execute.call_args.args[0])
                        self.audit.assert_not_called()

    def test_non_assignment_evidence_completion_keeps_its_queue_path(self):
        cursor = self._conn(evidence=["evidence.pdf"], assignment=False)
        result = entry.queue_for_marking(component_id="COMP-1", kind="commercial", learner_id="101",
                                         context={**self._context(), "activityType": "reading"})
        self.assertEqual(result, "sub-1")
        self.atomic.assert_not_called()
        self.assertIn('["evidence.pdf"]', cursor.execute.call_args.args[1])
        self.audit.assert_called_once_with(("sub-1",))
