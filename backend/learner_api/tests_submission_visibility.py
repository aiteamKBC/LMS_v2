"""Exercise learner reads against real SQL and synthetic in-memory rows."""
import json
import sqlite3
from datetime import datetime
from inspect import unwrap
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from .assignment_topics import prepare_topic_save
from .reflection_submissions import get_reflection_submission
from .submission_visibility import ACTIVITY_MARKING_REFLECTION


class SubmissionVisibilityTests(SimpleTestCase):
    def setUp(self):
        self.database = sqlite3.connect(":memory:")
        self.addCleanup(self.database.close)
        self.database.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.database.execute("ATTACH DATABASE ':memory:' AS curriculum")
        self.database.execute('''CREATE TABLE Learner.learning_reflection_submissions (
            id TEXT, learner_kind TEXT, learner_id TEXT, activity_type TEXT,
            activity_id TEXT, assignment_topic_id TEXT, status TEXT,
            full_submission TEXT, learning_reflection TEXT, coach_feedback TEXT,
            reviewed_by TEXT, reviewed_at TEXT, submitted_at TEXT)''')
        self.database.execute("CREATE TABLE curriculum.components (id TEXT, type TEXT, settings_json TEXT)")
        self.database.execute("INSERT INTO curriculum.components VALUES (?, ?, ?)",
                              ("ASSIGNMENT-1", "assignment", json.dumps({"assignmentTopics": [
                                  {"id": "1", "question": "Research"}, {"id": "2", "question": "Plan"}]})))
        # Only syntax adapters: the production WHERE/order/EXISTS clauses run
        # against SQLite itself. Advisory locks are covered by the queue tests.
        self.database.create_function("hashtextextended", 2, lambda value, seed: 1)
        self.database.create_function("pg_advisory_xact_lock", 1, lambda key: None)
        cursor = self.database.cursor()

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def execute(self, sql, params):
                cursor.execute(sql.replace("%s", "?").replace("::text", "").replace("::jsonb", ""), params)

            def convert(self, row):
                if row is None:
                    return None
                return tuple(datetime.fromisoformat(value) if column[0] in ("submitted_at", "reviewed_at") and value
                             else value for column, value in zip(cursor.description, row))

            def fetchone(self):
                return self.convert(cursor.fetchone())

            def fetchall(self):
                return [self.convert(row) for row in cursor.fetchall()]

        self.cursor = Cursor()
        self.connections = MagicMock()
        self.connections.__getitem__.return_value.cursor.return_value = self.cursor
        self.content = {"assignmentTopicId": "1", "assignmentAnswer": "Synthetic saved answer",
                        "slides": [{"title": "Synthetic slide"}], "presentationToken": "synthetic-file",
                        "evidenceFiles": [{"id": "synthetic-evidence"}]}

    def insert(self, identity, *, topic="", content=None, **changes):
        row = dict(id=identity, learner_kind="commercial", learner_id="learner-1", activity_type="assignment",
                   activity_id="ASSIGNMENT-1", assignment_topic_id=topic, status="submitted_for_tutor_review",
                   full_submission=json.dumps(content or {}), learning_reflection=ACTIVITY_MARKING_REFLECTION,
                   coach_feedback=None, reviewed_by=None, reviewed_at=None,
                   submitted_at="2026-10-22T10:00:00+00:00")
        row.update(changes)
        self.database.execute(f"INSERT INTO Learner.learning_reflection_submissions ({','.join(row)}) "
                              f"VALUES ({','.join('?' for _ in row)})", list(row.values()))

    def read(self, *, summary=False, **changes):
        params = {"learnerKind": "commercial", "learnerId": "learner-1"}
        if not summary:
            params.update(activityType="assignment", activityId="ASSIGNMENT-1")
        params.update(changes)
        with patch("learner_api.reflection_submissions.connections", self.connections):
            response = unwrap(get_reflection_submission)(RequestFactory().get("/", params))
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)

    def originals(self, **changes):
        self.insert("original", topic="1", content=self.content, submitted_at="2026-10-19T09:00:00+00:00", **changes)
        self.insert("placeholder", **changes)

    def test_newer_placeholder_cannot_mask_answers_files_status_or_timestamp(self):
        for kind in ("commercial", "apprenticeship"):
            self.originals(learner_kind=kind)
            with self.subTest(kind=kind):
                result = self.read(learnerKind=kind)["submission"]
                self.assertEqual(result["id"], "original")
                for key, value in self.content.items():
                    self.assertEqual(result[key], value)
                self.assertEqual(result["status"], "submitted_for_tutor_review")
                self.assertEqual(result["submittedAt"], "2026-10-19T09:00:00+00:00")
                self.assertEqual(self.read(learnerKind=kind, assignmentTopicId="1")["submission"], result)
                self.assertIsNone(self.read(learnerKind=kind, assignmentTopicId="")["submission"])

    def test_topic_list_and_submission_count_exclude_only_the_generated_duplicate(self):
        self.originals()
        self.assertEqual([row["topicId"] for row in self.read(view="topics")["topics"]], ["1"])
        self.assertEqual(self.read(summary=True)["statuses"], [{"activityType": "assignment",
                         "activityId": "ASSIGNMENT-1", "status": "submitted_for_tutor_review", "submissionCount": 1}])

    def test_original_attempt_history_remains_accessible_without_counting_the_placeholder(self):
        content = {**self.content, "assignmentAttemptHistory": [{
            "status": "rejected", "submittedAt": "2026-10-01", "coachFeedback": "Synthetic review",
            "content": {"assignmentAnswer": "Synthetic first attempt", "presentationToken": "synthetic-old-file"}}]}
        self.insert("original", topic="1", content=content, submitted_at="2026-10-19T09:00:00+00:00")
        self.insert("placeholder")
        previous = self.read(attempt="1")["submission"]
        self.assertEqual(previous["assignmentAnswer"], "Synthetic first attempt")
        self.assertEqual(previous["presentationToken"], "synthetic-old-file")
        self.assertEqual(previous["coachFeedback"], "Synthetic review")
        self.assertEqual(previous["status"], "rejected")
        current = self.read(attempt="2")["submission"]
        self.assertEqual(current["assignmentAnswer"], self.content["assignmentAnswer"])
        self.assertEqual(self.read(summary=True)["statuses"][0]["submissionCount"], 2)

    def test_placeholder_does_not_block_resuming_or_selecting_another_topic(self):
        self.originals()
        for topic in ("1", "2"):
            payload = {"learnerKind": "commercial", "learnerId": "learner-1",
                       "activityType": "assignment", "activityId": "ASSIGNMENT-1", "assignmentTopicId": topic}
            self.assertEqual(prepare_topic_save(self.cursor, payload), topic)

    def test_evidence_only_activity_without_saved_topics_remains_visible(self):
        self.insert("evidence-only")
        self.assertEqual(self.read()["submission"]["id"], "evidence-only")
        self.assertEqual([row["topicId"] for row in self.read(view="topics")["topics"]], [""])

    def test_real_legacy_content_or_coach_decisions_are_never_hidden(self):
        self.insert("original", topic="1", content=self.content)
        cases = ({"full_submission": json.dumps({"assignmentAnswer": "Legacy answer"})},
                 {"learning_reflection": "Learner's written reflection"}, {"coach_feedback": "Keep feedback"},
                 {"reviewed_by": "coach-1"}, {"reviewed_at": "2026-10-22T11:00:00+00:00"},
                 {"status": "accepted"}, {"status": "needs_revision"}, {"status": "draft"})
        for index, changes in enumerate(cases):
            with self.subTest(changes=changes):
                self.insert(f"legacy-{index}", **changes)
                self.assertIsNotNone(self.read(assignmentTopicId="")["submission"])
                with self.assertRaisesMessage(ValueError, "existing legacy submission"):
                    prepare_topic_save(self.cursor, {"learnerKind": "commercial", "learnerId": "learner-1",
                        "activityType": "assignment", "activityId": "ASSIGNMENT-1", "assignmentTopicId": "2"})
                self.database.execute("DELETE FROM Learner.learning_reflection_submissions WHERE id=?", (f"legacy-{index}",))

    def test_topic_from_another_learner_kind_component_or_activity_does_not_hide_a_row(self):
        self.insert("evidence-only")
        for index, changes in enumerate(({"learner_id": "learner-2"}, {"learner_kind": "apprenticeship"},
                                         {"activity_id": "ASSIGNMENT-2"}, {"activity_type": "reading"})):
            self.insert(f"other-{index}", topic="1", content=self.content, **changes)
        self.assertEqual(self.read()["submission"]["id"], "evidence-only")

    def test_empty_topic_document_is_not_enough_to_hide_a_legacy_row(self):
        self.insert("empty-topic", topic="1")
        self.insert("evidence-only")
        self.assertEqual(self.read(assignmentTopicId="")["submission"]["id"], "evidence-only")

    def test_other_activity_types_keep_their_original_visibility(self):
        self.originals(activity_type="reading")
        self.assertEqual(self.read(activityType="reading")["submission"]["id"], "placeholder")
