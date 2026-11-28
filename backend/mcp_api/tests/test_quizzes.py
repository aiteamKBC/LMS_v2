"""Step 7 create_quiz_draft: real MCP/OAuth/preview protocol and quiz intake rules, fake LMS endpoints."""
import copy
from types import SimpleNamespace
from unittest import mock

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import components, quizzes, read

MODULE = {"catalogueId": "M1", "programmeId": "PROG-1", "title": "Marketing", "status": "draft",
          "structureRevision": "rev-1", "weekStructure": [
              {"id": "W1", "weekNumber": 1, "title": "Week 1", "components": [
                  {"id": "Q1", "title": "Weekly quiz", "type": "quiz", "settings": {"linkedQuizId": ""},
                   "ksbMappings": [{"code": "K1"}]},
                  {"id": "RD1", "title": "Reading", "type": "reading", "settings": {}},
              ]},
          ]}
QUESTIONS = [
    {"type": "single_choice", "text": "What is the marketing mix?", "explanation": "The 4 Ps.",
     "ksb_codes": ["K1", "s2"], "answers": [{"text": "4 Ps", "is_correct": True},
                                             {"text": "SWOT", "is_correct": False}]},
    {"type": "multiple_choice", "text": "Which are Ps?", "ksb_codes": ["B1"],
     "answers": [{"text": "Price", "is_correct": True}, {"text": "Place", "is_correct": True},
                 {"text": "People skills", "is_correct": False}]},
    {"type": "true_false", "text": "Promotion is a P.",
     "answers": [{"text": "True", "is_correct": True}, {"text": "False", "is_correct": False}]},
]
ARGS = {"programme_id": "PROG-1", "module_id": "M1", "component_id": "Q1", "title": "Marketing Mix",
        "passing_grade": 70, "questions": QUESTIONS}
SOURCE = SimpleNamespace(kind="standard", source_id="st0001", label="ST0001 Marketing",
                         items=[{"code": "K1"}, {"code": "K4"}, {"code": "S2"}, {"code": "B1"}])


class QuizTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_QUIZ_CREATION_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.module = copy.deepcopy(MODULE)
        self.programme = {"id": "PROG-1", "name": "Marketing L3", "status": "active",
                          "ksbProfileSourceId": "standard:st0001"}
        self.writes = []
        self.fail = {}
        self.create_response = None
        for target in (read, components, quizzes):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(quizzes, "_resolve_source", return_value=SOURCE))
        # SimpleTestCase has no database; the real atomic block is exercised on PostgreSQL.
        self.enterContext(mock.patch.object(quizzes.transaction, "atomic", mock.MagicMock()))

    def api(self, request, method, path, *, query=None, json_body=None):
        if path.endswith("/programmes/"):
            return 200, {"results": [self.programme]}
        if method == "GET" and path.endswith("/modules/M1/structure/"):
            return 200, copy.deepcopy(self.module)
        self.writes.append((method, path, copy.deepcopy(json_body)))
        if path in self.fail:
            raise self.fail[path]
        if path == quizzes.QUIZ_CREATE_PATH:
            if self.create_response is not None:
                return self.create_response
            return 201, {"id": 77, "status": json_body["status"], "questions": len(json_body["initialQuestions"])}
        if method == "PATCH" and path == "/quiz_api/quizzes/77/":
            return 200, {"id": 77, "passingGrade": 65, "duration": 60, "randomizeQuestions": True, **json_body}
        if method == "PATCH" and path == "/curriculum_api/curriculum/components/Q1/":
            component = self.module["weekStructure"][0]["components"][0]
            component["settings"].update(json_body["settings"])
            self.module["structureRevision"] = "rev-2"
            return 200, {"updated": True, "component": copy.deepcopy(component)}
        if method == "POST" and path.endswith("/components/Q1/ksb-mappings/"):
            return 201, {"created": True, "count": len(json_body["mappings"])}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, arguments=None, name=quizzes.NAME):
        response = self.post(rpc("tools/call", {"name": name, "arguments": ARGS if arguments is None else arguments}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def error(self, arguments=None):
        result = self.run_tool(arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]

    def preview(self, arguments=None):
        result = self.run_tool(arguments)
        self.assertFalse(result.get("isError"), result)
        return result["structuredContent"]

    def apply(self, preview_id):
        return self.run_tool({"preview_id": preview_id}, name="apply_change")


class QuizPreviewTests(QuizTestCase):
    def test_preview_summarises_questions_and_new_mappings_without_writing(self):
        data = self.preview()
        self.assertFalse(data["saved"])
        self.assertIn("3 question(s)", data["summary"])
        self.assertIn("KSBs: B1 (1), K1 (1), S2 (1).", data["summary"])
        self.assertEqual(data["details"]["new_ksb_mappings"], ["B1", "S2"])
        self.assertEqual(data["details"]["already_mapped"], ["K1"])
        self.assertEqual(self.writes, [])

    def test_flag_is_independent_and_default_off(self):
        with mock.patch.dict("os.environ", {"MCP_QUIZ_CREATION_ENABLED": "0", "MCP_COMPONENT_CREATION_ENABLED": "1"}):
            self.assertIn("quiz creation is not enabled", self.error())

    def test_only_an_unlinked_quiz_component_in_a_draft_module(self):
        self.assertIn("not a quiz component", self.error({**ARGS, "component_id": "RD1"}))
        self.assertIn("existing quiz component", self.error({**ARGS, "component_id": "NOPE"}))
        self.module["weekStructure"][0]["components"][0]["settings"]["linkedQuizId"] = "12"
        self.assertIn("already has quiz 12", self.error())
        self.module["weekStructure"][0]["components"][0]["settings"]["linkedQuizId"] = ""
        self.module["status"] = "published"
        self.assertIn("draft module", self.error())

    def test_question_rules_are_reported_with_question_numbers(self):
        bad = [
            {**QUESTIONS[0], "answers": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}]},
            {**QUESTIONS[1], "answers": [{"text": "A", "is_correct": True}, {"text": "B", "is_correct": True}]},
            {**QUESTIONS[2], "text": "<script>alert(1)</script>"},
        ]
        text = self.error({**ARGS, "questions": bad})
        self.assertIn("Question 2: a multiple-choice question needs", text)
        self.assertIn("Question 3: use plain text or Markdown only", text)
        self.assertIn("Question 1", text)  # intake: single choice allows exactly one correct answer
        self.assertEqual(self.pending.rows, [])

    def test_true_false_needs_exactly_two_answers(self):
        question = {**QUESTIONS[2], "answers": [*QUESTIONS[2]["answers"], {"text": "Maybe", "is_correct": False}]}
        self.assertIn("Question 1", self.error({**ARGS, "questions": [question]}))

    def test_duplicate_stems_ignore_case_punctuation_and_arabic_marks(self):
        arabic = chr(0x623) + chr(0x64E) + "حمد"
        plain = chr(0x627) + "حمد"
        questions = [{**QUESTIONS[2], "text": f"Who is {arabic}?"}, {**QUESTIONS[2], "text": f"who is {plain}"}]
        self.assertIn("Question 2 repeats question 1", self.error({**ARGS, "questions": questions}))

    def test_unknown_and_legacy_ksb_codes_get_suggestions(self):
        question = {**QUESTIONS[2], "ksb_codes": ["K4.2", "K9"]}
        text = self.error({**ARGS, "questions": [question]})
        self.assertIn("K4.2 is an old manual code; this programme uses ST0001 Marketing. Did you mean K4?", text)
        self.assertIn("K9 is not in ST0001 Marketing. Did you mean K1, K4?", text)

    def test_ksb_codes_need_an_applied_standard_but_a_quiz_without_codes_does_not(self):
        self.programme["ksbProfileSourceId"] = ""
        self.assertIn("no KSB standard applied", self.error())
        data = self.preview({**ARGS, "questions": [QUESTIONS[2]]})
        self.assertEqual(data["details"]["new_ksb_mappings"], [])

    def test_numeric_legacy_programme_id_is_refused(self):
        self.programme["id"] = self.module["programmeId"] = "42"
        self.assertIn("legacy numeric id", self.error({**ARGS, "programme_id": "42"}))

    def test_points_and_extra_fields_cannot_be_supplied(self):
        question = {**QUESTIONS[0], "points": 5}
        self.assertTrue(self.run_tool({**ARGS, "questions": [question]}).get("isError"))
        self.assertTrue(self.run_tool({**ARGS, "status": "published"}).get("isError"))


class QuizApplyTests(QuizTestCase):
    def test_apply_creates_draft_quiz_links_it_and_maps_only_new_codes(self):
        result = self.apply(self.preview()["preview_id"])
        self.assertFalse(result.get("isError"), result)
        self.assertEqual([(m, p) for m, p, _ in self.writes], [
            ("POST", quizzes.QUIZ_CREATE_PATH),
            ("PATCH", "/quiz_api/quizzes/77/"),
            ("PATCH", "/curriculum_api/curriculum/components/Q1/"),
            ("POST", "/curriculum_api/curriculum/components/Q1/ksb-mappings/"),
        ])
        create, settings, link, mappings = (body for _, _, body in self.writes)
        self.assertEqual(create["status"], "draft")
        self.assertEqual(create["programmeId"], "PROG-1")
        self.assertEqual(create["weekId"], "W1")
        self.assertEqual([q["questionType"] for q in create["initialQuestions"]],
                         ["single_choice", "multiple_choice", "true_false"])
        self.assertTrue(create["initialQuestions"][0]["explanation"].endswith("KSBs: K1, S2"))
        self.assertNotIn("points", create["initialQuestions"][0])
        self.assertEqual(settings, {"passingGrade": 70, "duration": 60, "randomizeQuestions": False})
        self.assertEqual(link["expectedRevision"], "rev-1")
        self.assertEqual(link["settings"]["linkedQuizId"], "77")
        self.assertEqual(link["settings"]["numberOfQuestions"], 3)
        self.assertEqual(mappings["expectedRevision"], "rev-2")
        self.assertEqual([(m["code"], m["classification"], m["weightClass"], m["weight"], m["sourceType"],
                           m["sourceId"]) for m in mappings["mappings"]],
                         [("B1", "secondary", "soft", 1, "standard", "st0001"),
                          ("S2", "secondary", "soft", 1, "standard", "st0001")])
        data = result["structuredContent"]["result"]
        self.assertEqual((data["quiz_id"], data["status"]), (77, "draft"))

    def test_replay_writes_nothing_more(self):
        preview_id = self.preview()["preview_id"]
        first = self.apply(preview_id)
        second = self.apply(preview_id)
        self.assertEqual(len(self.writes), 4)
        self.assertEqual(first["structuredContent"]["result"], second["structuredContent"]["result"])

    def test_no_mapping_post_when_every_code_is_already_mapped(self):
        preview_id = self.preview({**ARGS, "questions": [{**QUESTIONS[0], "ksb_codes": ["K1"]}]})["preview_id"]
        self.assertFalse(self.apply(preview_id).get("isError"))
        self.assertEqual(len(self.writes), 3)

    def test_component_linked_after_preview_is_refused_before_any_write(self):
        preview_id = self.preview()["preview_id"]
        self.module["weekStructure"][0]["components"][0]["settings"]["linkedQuizId"] = "99"
        result = self.apply(preview_id)
        self.assertTrue(result.get("isError"))
        self.assertEqual(self.writes, [])

    def test_failure_part_way_reports_nothing_saved_not_unknown(self):
        self.fail["/curriculum_api/curriculum/components/Q1/"] = dispatch.DispatchError(
            "That conflicts with the item's current state. Look it up again and retry.", 409)
        result = self.apply(self.preview()["preview_id"])
        text = result["content"][0]["text"]
        self.assertTrue(result.get("isError"))
        self.assertIn("Nothing was saved", text)
        self.assertNotIn("may have been saved", text)

    def test_unconfirmed_quiz_create_is_refused(self):
        self.create_response = (201, {"id": 77, "status": "draft", "questions": 1})  # 3 were sent
        result = self.apply(self.preview()["preview_id"])
        self.assertIn("did not confirm the new draft quiz", result["content"][0]["text"])
        self.assertEqual(len(self.writes), 1)


class QuizDispatchTests(QuizTestCase):
    def test_quiz_endpoints_are_allowlisted_but_publishing_and_deleting_are_not(self):
        for method, path in (("POST", quizzes.QUIZ_CREATE_PATH), ("PATCH", "/quiz_api/quizzes/77/"),
                             ("POST", "/curriculum_api/curriculum/components/Q1/ksb-mappings/")):
            self.assertTrue(dispatch.is_allowed(method, path))
        self.assertFalse(dispatch.is_allowed("DELETE", "/quiz_api/quizzes/77/"))
        self.assertFalse(dispatch.is_allowed("PATCH", "/quiz_api/quizzes/77/course-links/"))
        self.assertEqual(dispatch.forbidden_key({"status": "published"}), "payload.status")


class FreeCourseQuizTests(QuizTestCase):
    def test_free_course_quiz_needs_no_programme_but_refuses_ksb_codes(self):
        self.module.update({"programmeId": "", "isFreeCourse": True})
        free_args = {k: v for k, v in ARGS.items() if k != "programme_id"}
        self.assertIn("Free courses do not use KSBs", self.error(free_args))
        data = self.preview({**free_args, "questions": [QUESTIONS[2]]})
        self.assertEqual(data["details"]["new_ksb_mappings"], [])
