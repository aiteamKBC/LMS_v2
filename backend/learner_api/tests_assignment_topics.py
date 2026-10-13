"""Pure and mocked topic persistence checks; no live database or services."""
import json
from inspect import unwrap
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase, RequestFactory

from .assignment_topics import aggregate_statuses, definitions, prepare_topic_save, topic_id, topics_from_settings


class AssignmentTopicTests(SimpleTestCase):
    def payload(self, kind="commercial", identity="2"):
        return {"learnerKind": kind, "learnerId": "synthetic-1", "activityId": "COMP-TOPICS",
                "activityType": "assignment", "assignmentTopicId": identity, "submissionMode": "draft"}

    def cursor(self, existing=()):
        cursor = MagicMock()
        cursor.fetchone.return_value = ({"assignmentTopics": json.dumps([
            {"id": "1", "name": "Research", "question": "Question one"},
            {"id": "2", "name": "Planning", "question": "Question two"},
            {"id": "3", "question": "Question three"}])},)
        cursor.fetchall.return_value = [(identity, status, {}) for identity, status in existing]
        return cursor

    def test_topic_identity_rejects_arbitrary_values(self):
        for value in ("4", "0", "1 OR 1=1", [], 1, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                topic_id(value)
        self.assertEqual(topic_id(None), "")
        self.assertEqual(topic_id("2"), "2")

    def test_authoritative_question_and_name_are_saved_for_both_learner_types(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                payload = {**self.payload(kind), "assignmentTopicName": "Forged", "assignmentQuestion": "Forged"}
                cursor = self.cursor()
                self.assertEqual(prepare_topic_save(cursor, payload), "2")
                self.assertEqual(payload["assignmentTopicName"], "Planning")
                self.assertEqual(payload["assignmentQuestion"], "Question two")
                self.assertEqual(cursor.execute.call_args.args[1], [kind, "synthetic-1", "COMP-TOPICS"])
                self.assertIn("pg_advisory_xact_lock", cursor.execute.call_args_list[1].args[0])

    def test_only_one_unsubmitted_topic_can_be_active(self):
        for status in ("draft", "rejected", "needs_revision"):
            with self.subTest(status=status), self.assertRaisesMessage(ValueError, "Resume"):
                prepare_topic_save(self.cursor([("1", status)]), self.payload())

    def test_submitted_topic_does_not_block_the_remaining_topics(self):
        self.assertEqual(prepare_topic_save(self.cursor([("1", "submitted_for_tutor_review")]), self.payload()), "2")
        self.assertEqual(prepare_topic_save(self.cursor([("1", "accepted")]), self.payload()), "2")

    def test_current_topic_can_resume(self):
        self.assertEqual(prepare_topic_save(self.cursor([("2", "draft")]), self.payload()), "2")

    def test_unconfigured_topic_cannot_be_selected(self):
        cursor = self.cursor()
        cursor.fetchone.return_value = ({"assignmentBrief": "Legacy question"},)
        with self.assertRaisesMessage(ValueError, "not available"):
            prepare_topic_save(cursor, self.payload())
        self.assertEqual(prepare_topic_save(cursor, self.payload(identity="1")), "1")

    def test_topics_are_not_available_for_a_different_activity_type(self):
        with self.assertRaisesMessage(ValueError, "only available"):
            prepare_topic_save(self.cursor(), {**self.payload(), "activityType": "reading"})

    def test_legacy_question_and_file_are_retained_without_cloning_to_other_topics(self):
        topics = topics_from_settings({"assignmentBrief": "Legacy question", "assignmentFileUrl": "/curriculum_api/curriculum/uploads/brief.pdf"})
        self.assertEqual(len(topics), 3)
        self.assertEqual(topics[0]["question"], "Legacy question")
        self.assertEqual(len(topics[0]["resources"]), 1)
        self.assertEqual(topics[1]["question"], "")
        self.assertEqual(topics[2]["resources"], [])

    def test_unsafe_resources_are_not_exposed(self):
        topics = definitions([{"id": "1", "resources": [{"url": "javascript:alert(1)"}, {"url": "/curriculum_api/curriculum/uploads/a.mp4"}]}])
        self.assertEqual(len(topics[0]["resources"]), 1)

    def test_optional_draft_preserves_component_submission_and_counts_individual_submissions(self):
        result = aggregate_statuses([
            ("assignment", "A", "submitted_for_tutor_review", []), ("assignment", "A", "draft", []),
            ("assignment", "B", "draft", []), ("assignment", "A", "accepted", [])])
        self.assertEqual(result, [
            {"activityType": "assignment", "activityId": "A", "status": "accepted", "submissionCount": 2},
            {"activityType": "assignment", "activityId": "B", "status": "draft", "submissionCount": 0}])

    def test_topic_save_targets_its_own_row_and_preserves_legacy_payload_order(self):
        from .reflection_submissions import _submit_reflection
        for kind in ("commercial", "apprenticeship"):
            payload = self.payload(kind)
            cursor = MagicMock()
            cursor.fetchone.side_effect = [None, ("submission-topic-2",)]
            with patch("learner_api.reflection_submissions.connections") as connection, patch("learner_api.reflection_submissions.transaction.atomic"), patch("learner_api.reflection_submissions._reflection_lineage", return_value={}), patch("learner_api.reflection_submissions.record_submission_row"), patch("learner_api.assignment_topics.prepare_topic_save") as prepare:
                def authorise(cur, data):
                    data.update(assignmentTopicName="Planning", assignmentQuestion="Question two")
                    return "2"
                prepare.side_effect = authorise
                connection.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
                response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
            self.assertEqual(response.status_code, 201)
            sql, params = cursor.execute.call_args.args
            self.assertEqual(params[11], "draft")
            self.assertEqual(params[-1], "2")
            self.assertIn("assignment_topic_id", sql)
            self.assertEqual(cursor.execute.call_args_list[1].args[1], [kind, "synthetic-1", "assignment", "COMP-TOPICS", "2"])
            saved = json.loads(params[30])
            self.assertEqual(saved["assignmentQuestion"], "Question two")
            self.assertEqual(saved["assignmentTopicId"], "2")

    def test_late_selection_retry_does_not_replace_the_saved_topic(self):
        from .reflection_submissions import _submit_reflection
        payload = {**self.payload(), "selectAssignmentTopic": True}
        for status, expected in (("draft", 200), ("submitted_for_tutor_review", 409), ("accepted", 409), ("partial", 409)):
            cursor = MagicMock()
            cursor.fetchone.return_value = (status, {"assignmentAnswer": "Keep my saved answer"}, None, None, None, None)
            with patch("learner_api.reflection_submissions.connections") as connection, patch("learner_api.reflection_submissions.transaction.atomic"), patch("learner_api.reflection_submissions._reflection_lineage", return_value={}), patch("learner_api.assignment_topics.prepare_topic_save") as prepare:
                prepare.side_effect = lambda cur, data: data.update(assignmentTopicName="Planning", assignmentQuestion="Question")
                connection.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
                response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
            self.assertEqual(response.status_code, expected)
            self.assertEqual(cursor.execute.call_count, 2)  # Learner lock and lookup; no overwrite on a retry or locked submission.

    def test_invalid_elapsed_time_is_rejected_before_any_database_write(self):
        from .reflection_submissions import _submit_reflection
        for elapsed in (-1, "bad", float("inf"), None):
            response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps({
                **self.payload(), "assignmentElapsedSeconds": elapsed}), content_type="application/json"))
            self.assertEqual(response.status_code, 400)

    def test_topic_lookup_is_parameterized_for_learner_kind_and_component(self):
        from .reflection_submissions import get_reflection_submission
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        for kind in ("commercial", "apprenticeship"):
            with patch("learner_api.reflection_submissions.connections") as connection:
                connection.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
                response = unwrap(get_reflection_submission)(RequestFactory().get("/", {
                    "learnerKind": kind, "learnerId": "synthetic-2", "activityType": "assignment",
                    "activityId": "OTHER-COMPONENT", "assignmentTopicId": "3"}))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(cursor.execute.call_args.args[1], [kind, "synthetic-2", "assignment", "OTHER-COMPONENT", "3", "3"])
            self.assertIn("%s::text IS NULL", cursor.execute.call_args.args[0])

    def test_topic_parameter_cannot_bypass_another_component_marking_flow(self):
        from .components import submit_component_progress
        with patch("learner_api.components.resolve_completion_instants", return_value=(None, "")), patch("learner_api.components.component_ksb_codes", return_value=[]), patch("learner_api.components._component_meta", return_value=("reading", "Reading")):
            response = unwrap(submit_component_progress)(RequestFactory().post(
                "/?kind=commercial&learnerId=synthetic-1", json.dumps({"assignmentTopicId": "2"}), content_type="application/json"), "READING-1")
        self.assertEqual(response.status_code, 400)

    def test_topic_upload_does_not_replace_component_or_other_topic_files(self):
        from django.core.files.uploadedfile import SimpleUploadedFile
        from curriculum_api.views import curriculum_component_upload, COMPONENT_UPLOAD_EXTENSIONS
        resource = {"fileName": "guide.mp4", "url": "/curriculum_api/curriculum/uploads/guide.mp4", "size": 5, "contentType": "video/mp4"}
        with patch("curriculum_api.views.component_upload_metadata", return_value=(resource, "")), patch("curriculum_api.views.update_component_upload_settings") as update:
            response = unwrap(curriculum_component_upload)(RequestFactory().post("/", {
                "componentType": "assignment", "topicResource": "true",
                "file": SimpleUploadedFile("guide.mp4", b"video", content_type="video/mp4")}), "COMP-TOPICS")
        self.assertEqual(response.status_code, 201)
        self.assertFalse(json.loads(response.content)["savedToComponent"])
        update.assert_not_called()
        self.assertTrue({".mp4", ".webm", ".pdf"}.issubset(COMPONENT_UPLOAD_EXTENSIONS["assignment"]))

    def test_topic_settings_use_the_curriculum_storage_column(self):
        import sqlite3
        from .assignment_topics import configured_topics
        with sqlite3.connect(":memory:") as database:
            database.execute("ATTACH DATABASE ':memory:' AS curriculum")
            database.execute("CREATE TABLE curriculum.components (id TEXT, type TEXT, settings_json TEXT)")
            database.execute("INSERT INTO curriculum.components VALUES (?, ?, ?)",
                             ("COMP-TOPICS", "assignment", json.dumps({"assignmentTopics": [
                                 {"id": "1", "name": "Research", "question": "Question one"}]})))
            cursor = database.cursor()

            class CurriculumCursor:
                def execute(self, sql, params):
                    cursor.execute(sql.replace("%s", "?"), params)

                def fetchone(self):
                    return cursor.fetchone()

            topics = configured_topics(CurriculumCursor(), "COMP-TOPICS")
            self.assertEqual(topics[0]["name"], "Research")
            self.assertEqual(topics[0]["question"], "Question one")


class SharedTopicCoachingTests(SimpleTestCase):
    payload = AssignmentTopicTests.payload
    cursor = AssignmentTopicTests.cursor
    # Reuse fixtures only; tests below exercise actual topic save and read code.
    def booking_payload(self, kind="commercial", identity="2"):
        return {**self.payload(kind, identity), "learnerId": "101",
                "monthlyAssignment": {"version": 2, "month": "2026-09", "meetingKey": "",
                                      "timeEntries": [], "reflection": "Keep this answer"}}

    def meeting(self, **changes):
        from datetime import date
        from types import SimpleNamespace
        return SimpleNamespace(**{"event_type": "mcr", "scheduled_date": date(2026, 9, 22),
                                  "status": "scheduled", **changes})

    def booked_cursor(self, **monthly):
        cursor = self.cursor()
        cursor.fetchall.return_value = [("1", "submitted_for_tutor_review", {
            "monthlyAssignment": {"month": "2026-09", "meetingKey": "shared-mcm", **monthly}})]
        return cursor

    def test_owned_booking_is_inherited_by_both_remaining_topics_and_learner_types(self):
        from copy import deepcopy
        for kind in ("commercial", "apprenticeship"):
            for identity in ("2", "3"):
                with self.subTest(kind=kind, topic=identity):
                    payload = self.booking_payload(kind, identity)
                    cursor = self.booked_cursor()
                    previous = deepcopy(cursor.fetchall.return_value)
                    with patch("learner_api.calendar._learner_calendar_record", return_value=self.meeting()) as lookup:
                        prepare_topic_save(cursor, payload)
                    self.assertEqual(payload["monthlyAssignment"]["meetingKey"], "shared-mcm")
                    self.assertEqual(payload["monthlyAssignment"]["reflection"], "Keep this answer")
                    self.assertEqual(cursor.fetchall.return_value, previous)
                    lookup.assert_called_once_with(kind, 101, "shared-mcm")
                    self.assertEqual(cursor.execute.call_args.args[1], [kind, "101", "COMP-TOPICS"])

    def test_a_different_client_booking_cannot_replace_the_shared_booking(self):
        payload = self.booking_payload()
        payload["monthlyAssignment"]["meetingKey"] = "replacement"
        with patch("learner_api.calendar._learner_calendar_record", return_value=self.meeting()):
            prepare_topic_save(self.booked_cursor(), payload)
        self.assertEqual(payload["monthlyAssignment"]["meetingKey"], "shared-mcm")

    def test_cancelled_unowned_and_wrong_type_meetings_are_not_inherited(self):
        for record in (None, self.meeting(status="cancelled"), self.meeting(event_type="review")):
            with self.subTest(record=record):
                payload = self.booking_payload()
                with patch("learner_api.calendar._learner_calendar_record", return_value=record):
                    prepare_topic_save(self.booked_cursor(), payload)
                self.assertEqual(payload["monthlyAssignment"]["meetingKey"], "")

    def test_meeting_on_any_date_is_inherited(self):
        from datetime import date
        payload = self.booking_payload()
        with patch("learner_api.calendar._learner_calendar_record", return_value=self.meeting(scheduled_date=date(2026, 10, 15))):
            prepare_topic_save(self.booked_cursor(), payload)
        self.assertNotEqual(payload["monthlyAssignment"]["meetingKey"], "")

    def test_completed_and_rescheduled_meetings_still_satisfy_other_topics(self):
        from datetime import date
        from .monthly_assignment import booked_coaching
        for status in ("scheduled", "in-progress", "completed", "awaiting-signature"):
            with self.subTest(status=status), patch("learner_api.calendar._learner_calendar_record", return_value=self.meeting(
                    status=status, scheduled_date=date(2026, 10, 28))), patch(
                    "learner_api.monthly_assignment.resubmission_booking_satisfied", return_value=False):
                payload = self.booking_payload()
                prepare_topic_save(self.booked_cursor(), payload)
                self.assertTrue(booked_coaching(payload))

    def test_other_month_and_legacy_assignment_do_not_inherit_booking(self):
        with patch("learner_api.calendar._learner_calendar_record") as lookup:
            payload = self.booking_payload()
            prepare_topic_save(self.booked_cursor(month="2026-08"), payload)
            self.assertEqual(payload["monthlyAssignment"]["meetingKey"], "")
            payload["assignmentTopicId"] = ""
            self.assertEqual(prepare_topic_save(self.booked_cursor(), payload), "")
            lookup.assert_not_called()

    def test_topic_summary_exposes_saved_meeting_only_for_requested_learner_and_component(self):
        from .reflection_submissions import get_reflection_submission
        cursor = MagicMock()
        cursor.fetchall.return_value = [("1", "submitted_for_tutor_review", {
            "monthlyAssignment": {"month": "2026-09", "meetingKey": "shared-mcm"}}, None)]
        with patch("learner_api.reflection_submissions.connections") as connections:
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = unwrap(get_reflection_submission)(RequestFactory().get("/", {
                "learnerKind": "commercial", "learnerId": "101", "activityType": "assignment",
                "activityId": "COMP-TOPICS", "view": "topics"}))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["topics"][0]["meetingKey"], "shared-mcm")
        self.assertEqual(cursor.execute.call_args.args[1], ["commercial", "101", "COMP-TOPICS"])

    def test_new_topic_selection_persists_inherited_booking_in_its_draft(self):
        from .reflection_submissions import _submit_reflection
        cursor = self.booked_cursor()
        cursor.fetchone.side_effect = [cursor.fetchone.return_value, None, ("new-topic",)]
        payload = {**self.booking_payload(), "selectAssignmentTopic": True}
        with patch("learner_api.reflection_submissions.connections") as connections, patch(
                "learner_api.reflection_submissions.transaction.atomic"), patch(
                "learner_api.reflection_submissions._reflection_lineage", return_value={}), patch(
                "learner_api.reflection_submissions.record_submission_row"), patch(
                "learner_api.calendar._learner_calendar_record", return_value=self.meeting()):
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = cursor
            response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
        self.assertEqual(response.status_code, 201, response.content)
        saved = json.loads(cursor.execute.call_args.args[1][30])
        self.assertEqual(saved["monthlyAssignment"]["meetingKey"], "shared-mcm")
        self.assertEqual(saved["assignmentTopicId"], "2")
        self.assertEqual(saved["monthlyAssignment"]["reflection"], "Keep this answer")
