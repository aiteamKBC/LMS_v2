"""Step 8 edit_quiz_draft / clone_quiz_version: real MCP protocol and quiz intake rules, fake LMS endpoints."""
import copy
from types import SimpleNamespace
from unittest import mock

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_quizzes import MODULE, SOURCE
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import components, quiz_edit, quizzes, read

QUIZ = {"id": 77, "title": "Marketing Mix", "status": "draft", "version": "v1.0", "weekId": "W1",
        "programmeId": "PROG-1", "programme": "Marketing L3", "module": "Marketing", "assessmentType": "quiz",
        "passingGrade": 65, "duration": 60, "randomizeQuestions": False, "updatedAt": "2026-11-11T10:00:00"}
QUESTIONS = [
    {"id": 1, "questionType": "single_choice", "text": "What is the marketing mix?", "explanation": "The 4 Ps.",
     "answers": [{"id": 11, "text": "4 Ps", "isCorrect": True}, {"id": 12, "text": "SWOT", "isCorrect": False}]},
    {"id": 2, "questionType": "true_false", "text": "Promotion is a P.",
     "answers": [{"id": 21, "text": "True", "isCorrect": True}, {"id": 22, "text": "False", "isCorrect": False}]},
]
NEW_Q = {"type": "true_false", "text": "Place is a P.",
         "answers": [{"text": "True", "is_correct": True}, {"text": "False", "is_correct": False}]}


class QuizEditTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_QUIZ_CREATION_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.quiz, self.questions = copy.deepcopy(QUIZ), copy.deepcopy(QUESTIONS)
        self.module = copy.deepcopy(MODULE)
        self.module["weekStructure"][0]["components"][0]["settings"]["linkedQuizId"] = "77"
        self.programme = {"id": "PROG-1", "name": "Marketing L3", "status": "active",
                          "ksbProfileSourceId": "standard:st0001"}
        self.writes, self.attempts = [], 0
        for target in (read, components, quizzes, quiz_edit):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(quiz_edit, "_attempt_count", side_effect=lambda _id: self.attempts))
        self.enterContext(mock.patch.object(quizzes, "_resolve_source", return_value=SOURCE))
        self.enterContext(mock.patch.object(quiz_edit.transaction, "atomic", mock.MagicMock()))

    def api(self, request, method, path, *, query=None, json_body=None):
        if path.endswith("/programmes/"):
            return 200, {"results": [self.programme]}
        if method == "GET" and path.endswith("/modules/M1/structure/"):
            return 200, copy.deepcopy(self.module)
        if method == "GET" and path == "/quiz_api/quizzes/77/preview/":
            return 200, {"quiz": copy.deepcopy(self.quiz), "questions": copy.deepcopy(self.questions)}
        self.writes.append((method, path, copy.deepcopy(json_body)))
        if method == "PATCH" and path == "/quiz_api/quizzes/77/questions/":
            by_id = {q["id"]: q for q in self.questions}
            result = []
            for item in json_body["questions"]:
                q = copy.deepcopy(by_id.get(item.get("id"), {"id": 100 + len(result), "answers": []}))
                q.update({k: v for k, v in item.items() if k in ("text", "explanation", "isArchived", "questionType")})
                if "answers" in item:
                    q["answers"] = item["answers"]
                result.append(q)
            self.questions = [q for q in result if not q.get("isArchived")]
            return 200, {"quiz": self.quiz, "questions": self.questions}
        if method == "PATCH" and path.startswith("/quiz_api/quizzes/"):
            return 200, {**self.quiz, **json_body}
        if path == quizzes.QUIZ_CREATE_PATH:
            return 201, {"id": 90, "status": json_body["status"], "questions": len(json_body["initialQuestions"])}
        if method == "POST" and path.endswith("/ksb-mappings/"):
            return 201, {"created": True}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, name, arguments):
        response = self.post(rpc("tools/call", {"name": name, "arguments": arguments}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def error(self, name, arguments):
        result = self.run_tool(name, arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]

    def preview(self, name, arguments):
        result = self.run_tool(name, arguments)
        self.assertFalse(result.get("isError"), result)
        return result["structuredContent"]

    def apply(self, preview_id):
        return self.run_tool("apply_change", {"preview_id": preview_id})


class EditQuizDraftTests(QuizEditTestCase):
    def test_edit_keeps_order_archives_instead_of_deleting_and_never_sends_remove_missing(self):
        args = {"quiz_id": 77, "title": "Marketing Mix 2", "update_questions": [{"question_id": 2, "text": "Price is a P."}],
                "archive_question_ids": [1], "add_questions": [NEW_Q]}
        data = self.preview("edit_quiz_draft", args)
        self.assertIn("1 question(s) changed, 1 question(s) added, 1 question(s) archived", data["summary"])
        self.assertEqual(self.writes, [])
        result = self.apply(data["preview_id"])
        self.assertFalse(result.get("isError"), result)
        (m1, p1, meta), (m2, p2, body) = self.writes
        self.assertEqual((m1, p1), ("PATCH", "/quiz_api/quizzes/77/"))
        self.assertEqual(meta, {"title": "Marketing Mix 2", "weekId": "W1"})
        self.assertEqual((m2, p2), ("PATCH", "/quiz_api/quizzes/77/questions/"))
        self.assertNotIn("removeMissing", body)
        self.assertEqual(body["questions"][0], {"id": 1, "isArchived": True})
        self.assertEqual(body["questions"][1], {"id": 2, "text": "Price is a P.", "explanation": ""})  # answers kept
        self.assertEqual(body["questions"][2]["text"], "Place is a P.")
        self.assertIsNone(dispatch.forbidden_key(body))

    def test_attempted_and_published_quizzes_are_refused_with_the_clone_suggestion(self):
        self.attempts = 3
        self.assertIn("clone_quiz_version", self.error("edit_quiz_draft", {"quiz_id": 77, "title": "X"}))
        self.attempts = 0
        self.quiz["status"] = "published"
        self.assertIn("clone_quiz_version", self.error("edit_quiz_draft", {"quiz_id": 77, "title": "X"}))
        self.assertEqual(self.writes, [])

    def test_changed_answers_are_validated_and_sent_only_when_they_change(self):
        same = {"question_id": 1, "answers": [{"text": "4 Ps", "is_correct": True}, {"text": "SWOT", "is_correct": False}],
                "explanation": "Product, price, place, promotion."}
        self.apply(self.preview("edit_quiz_draft", {"quiz_id": 77, "update_questions": [same]})["preview_id"])
        self.assertNotIn("answers", self.writes[-1][2]["questions"][0])
        two_correct = {"question_id": 1, "answers": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}]}
        self.assertIn("Question 1", self.error("edit_quiz_draft", {"quiz_id": 77, "update_questions": [two_correct]}))

    def test_cannot_archive_every_question_or_touch_unknown_ones(self):
        self.assertIn("at least one question", self.error("edit_quiz_draft", {"quiz_id": 77, "archive_question_ids": [1, 2]}))
        self.assertIn("Question 9 is not a current question", self.error("edit_quiz_draft", {"quiz_id": 77, "archive_question_ids": [9]}))

    def test_ksb_codes_need_the_linked_component_and_are_added_additively(self):
        update = {"question_id": 2, "ksb_codes": ["K1", "S2"]}
        self.assertIn("give both the module_id", self.error("edit_quiz_draft", {"quiz_id": 77, "update_questions": [update]}))
        args = {"quiz_id": 77, "programme_id": "PROG-1", "module_id": "M1", "component_id": "Q1", "update_questions": [update]}
        data = self.preview("edit_quiz_draft", args)
        self.assertEqual(data["details"]["new_ksb_mappings"], ["S2"])  # K1 is already mapped
        self.apply(data["preview_id"])
        self.assertTrue(self.writes[0][2]["questions"][1]["explanation"].endswith("KSBs: K1, S2"))
        self.assertEqual([m["code"] for m in self.writes[-1][2]["mappings"]], ["S2"])

    def test_quiz_changed_after_preview_is_refused_before_writing(self):
        preview_id = self.preview("edit_quiz_draft", {"quiz_id": 77, "title": "New"})["preview_id"]
        self.quiz["updatedAt"] = "2026-11-11T11:00:00"
        self.assertTrue(self.apply(preview_id).get("isError"))
        self.assertEqual(self.writes, [])


class CloneQuizVersionTests(QuizEditTestCase):
    def test_clone_creates_an_unlinked_draft_and_leaves_the_original_untouched(self):
        self.quiz["status"] = "published"
        self.attempts = 12
        before = copy.deepcopy(self.questions)
        data = self.preview("clone_quiz_version", {"quiz_id": 77, "add_questions": [NEW_Q]})
        self.assertIn("not linked to any component", data["summary"])
        result = self.apply(data["preview_id"])
        self.assertFalse(result.get("isError"), result)
        (m1, p1, create), (m2, p2, settings) = self.writes
        self.assertEqual((m1, p1), ("POST", quizzes.QUIZ_CREATE_PATH))
        self.assertEqual((create["title"], create["version"], create["status"]), ("Marketing Mix (v2)", "v2.0", "draft"))
        self.assertEqual(len(create["initialQuestions"]), 3)
        self.assertEqual((m2, p2), ("PATCH", "/quiz_api/quizzes/90/"))
        self.assertEqual(settings, {"passingGrade": 65, "duration": 60, "randomizeQuestions": False})
        self.assertEqual(self.questions, before)  # original question/answer ids untouched
        self.assertFalse(any("components" in path for _, path, _ in self.writes))  # never relinked
        self.assertEqual(result["structuredContent"]["result"]["linked"], False)

    def test_archived_questions_are_not_copied_and_ksb_codes_are_refused(self):
        data = self.preview("clone_quiz_version", {"quiz_id": 77, "archive_question_ids": [1]})
        self.apply(data["preview_id"])
        self.assertEqual([q["text"] for q in self.writes[0][2]["initialQuestions"]], ["Promotion is a P."])
        update = {"question_id": 2, "ksb_codes": ["K1"]}
        self.assertIn("cannot be added to an unlinked copy",
                      self.error("clone_quiz_version", {"quiz_id": 77, "update_questions": [update]}))
