"""Step 6: read-only tools, DB-free.

Each tool runs through the real ``/mcp/`` endpoint with a real token (in-memory
OAuth store from ``test_oauth``). The LMS endpoints behind ``dispatch.call_api``
are replaced by a fake that serves fixed JSON in the shapes the real views
return, and records every call so the tests can prove they are all GETs.
"""
from types import SimpleNamespace
from unittest import mock

from knowledge_base.retrieval import KnowledgeBaseUnavailable, Plan, Segment

from mcp_api import pii, ratelimit
from mcp_api.dispatch import DispatchError
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import REGISTRY
from mcp_api.tools import read

C = "/curriculum_api/curriculum"

PROGRAMMES = [
    {"id": "P1", "sourceId": "P1", "name": "Digital Marketing L3", "level": "3", "status": "active",
     "isArchived": False, "modules": 4, "cohorts": 2, "ksbProfileSourceId": "standard:st0596-v1-0", "learners": 40},
    {"id": "P2", "sourceId": "P2", "name": "Digital Marketing L4", "level": "4", "status": "active",
     "isArchived": False, "modules": 1, "cohorts": 1, "ksbProfileSourceId": ""},
    {"id": "P9", "sourceId": "P9", "name": "Old Programme", "status": "archived", "isArchived": True,
     "ksbProfileSourceId": ""},
]
COHORTS = [
    {"id": "C1", "name": "Jan-26", "programmeId": "P1", "startDate": "2026-01-10", "endDate": "2028-01-10",
     "status": "active", "learners": 12},
    {"id": "C0", "name": "Old cohort", "programmeId": "P1", "status": "archived"},
]
GROUPS = [
    {"id": "G1", "name": "Tuesday", "cohortId": "C1", "coach": "Sam Coach", "weekDays": "Tue",
     "startTime": "10:00", "endTime": "12:00", "status": "active", "learners": 12},
]
MODULES = [
    {"moduleCatalogueId": "M1", "name": "Marketing Mix", "programmeId": "P1", "programme": "Digital Marketing L3",
     "cohort": "Jan-26", "group": "Tuesday", "status": "draft", "weeks": 4, "quizzes": 1, "ksbCount": 3},
    {"moduleCatalogueId": "M2", "name": "SEO Basics", "programmeId": "P2", "programme": "Digital Marketing L4",
     "status": "published", "weeks": 2},
    {"moduleCatalogueId": "M3", "name": "Marketing archive", "programmeId": "P1", "status": "archived"},
]
STRUCTURE = {
    "moduleCatalogueId": "M1", "title": "Marketing Mix", "programmeName": "Digital Marketing L3",
    "programmeId": "P1", "status": "draft", "ksbProfileSourceId": "standard:st0596-v1-0",
    "weekStructure": [{
        "id": "W1", "weekNumber": 1, "title": "Introduction",
        "components": [
            {"id": "CP1", "title": "What is marketing", "type": "lesson", "settings": {},
             "ksbMappings": [{"code": "K1"}]},
            {"id": "CP2", "title": "Check your understanding", "type": "quiz", "settings": {"linkedQuizId": 42},
             "ksbMappings": [{"code": "S2"}, {"code": "K1"}]},
        ],
    }],
}
COVERAGE = {"items": [
    {"code": "K1", "mappingCount": 2, "componentCount": 2, "description": "Marketing principles"},
    {"code": "S2", "mappingCount": 0, "componentCount": 0, "description": "Use analytics tools"},
]}
QUIZ = {
    "quiz": {"id": 42, "title": "Mix quiz", "status": "draft", "version": "1", "programme": "DM",
             "module": "Marketing Mix", "passingGrade": 65, "author": "Curriculum Team"},
    "questions": [{"id": 7, "questionType": "single_choice", "text": "Which P is about cost?",
                   "explanation": "Price is the cost.", "answers": [
                       {"id": 1, "text": "Price", "isCorrect": True},
                       {"id": 2, "text": "Place", "isCorrect": False}]}],
}
BOOKS = {"books": [
    {"id": "B1", "title": "Marketing Essentials", "archived": False, "processing": {"status": "ready"},
     "version": {"pageCount": 300, "edition": "3rd"}},
    {"id": "B2", "title": "Marketing draft", "archived": False, "processing": {"status": "queued"}},
    {"id": "B3", "title": "Marketing old", "archived": True, "processing": {"status": "ready"}},
]}


class FakeLMS:
    def __init__(self):
        self.calls = []
        self.modules = list(MODULES)
        self.routes = {
            f"{C}/programmes/": lambda q: {"results": PROGRAMMES if (q or {}).get("visibility") == "all"
                                           else [p for p in PROGRAMMES if not p["isArchived"]]},
            f"{C}/programmes/P1/cohorts/": lambda q: {"results": COHORTS},
            f"{C}/cohorts/C1/groups/": lambda q: {"results": GROUPS},
            f"{C}/cohorts/C0/groups/": lambda q: {"results": []},
            f"{C}/modules/": lambda q: {"results": self.modules},
            f"{C}/modules/M1/structure/": lambda q: STRUCTURE,
            f"{C}/programmes/P1/ksb-coverage/": lambda q: COVERAGE,
            f"{C}/modules/M1/ksb-coverage/": lambda q: COVERAGE,
            "/quiz_api/quizzes/42/preview/": lambda q: QUIZ,
            "/curriculum_api/knowledge-base/books/": lambda q: BOOKS,
        }

    def __call__(self, request, method, path, *, query=None, json_body=None):
        self.calls.append((method, path, query))
        if path not in self.routes:
            raise DispatchError("That item doesn't exist, or you can't see it.", 404)
        return 200, self.routes[path](query)


class ReadToolTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.lms = FakeLMS()
        self.enterContext(mock.patch.object(read, "call_api", self.lms))
        self.source = SimpleNamespace(kind="standard", source_id="st0596-v1-0", label="ST0596 v1.0", items=[
            {"code": "K1", "type": "K", "description": "Marketing principles"},
            {"code": "S2", "type": "S", "description": "Use analytics tools"},
            {"code": "B1", "type": "B", "description": "Works ethically"},
        ])
        self.resolve = self.enterContext(mock.patch.object(read, "_resolve_source", return_value=self.source))
        self.attempts = self.enterContext(mock.patch.object(read, "_attempt_count", return_value=0))

    def run_tool(self, name, arguments=None):
        response = self.post(rpc("tools/call", {"name": name, "arguments": arguments or {}}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def ok(self, name, arguments=None):
        result = self.run_tool(name, arguments)
        self.assertFalse(result.get("isError"), result)
        # No tool output may carry a personal-data key (the guard would otherwise strip or refuse it).
        self.assertEqual(pii.find_pii(result["structuredContent"]), [])
        return result["content"][0]["text"], result["structuredContent"]

    def err(self, name, arguments=None):
        result = self.run_tool(name, arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]


class ProgrammeTests(ReadToolTestCase):
    def test_lists_live_programmes_with_their_standard(self):
        text, data = self.ok("find_programmes")
        self.assertEqual([p["programme_id"] for p in data["programmes"]], ["P1", "P2"])
        self.assertEqual(data["programmes"][0]["applied_ksb_source"], "standard:st0596-v1-0")
        self.assertIsNone(data["programmes"][1]["applied_ksb_source"])
        self.assertIn("no KSB standard applied yet", text)
        self.assertNotIn("learners", data["programmes"][0])

    def test_query_is_case_insensitive_and_can_include_archived(self):
        _text, data = self.ok("find_programmes", {"query": "l4"})
        self.assertEqual([p["programme_id"] for p in data["programmes"]], ["P2"])
        _text, data = self.ok("find_programmes", {"query": "old", "include_archived": True})
        self.assertEqual([p["programme_id"] for p in data["programmes"]], ["P9"])

    def test_cohorts_and_groups(self):
        text, data = self.ok("find_cohorts_groups", {"programme_id": "P1"})
        self.assertEqual([c["cohort_id"] for c in data["cohorts"]], ["C1"])
        self.assertEqual(data["cohorts"][0]["groups"][0],
                         {"group_id": "G1", "name": "Tuesday", "coach": "Sam Coach", "weekdays": "Tue",
                          "start_time": "10:00", "end_time": "12:00", "status": "active"})
        self.assertIn("coach Sam Coach", text)

    def test_unknown_programme_is_a_plain_error(self):
        self.assertIn("find_programmes", self.err("find_cohorts_groups", {"programme_id": "NOPE"}))


class ModuleTests(ReadToolTestCase):
    def test_filters_by_programme_and_name_and_hides_archived(self):
        _text, data = self.ok("find_modules", {"programme_id": "P1"})
        self.assertEqual([m["module_id"] for m in data["modules"]], ["M1"])
        _text, data = self.ok("find_modules", {"query": "seo"})
        self.assertEqual([m["module_id"] for m in data["modules"]], ["M2"])
        self.assertIn(("GET", f"{C}/modules/", {"compact": "1"}), self.lms.calls)

    def test_programme_id_wins_when_another_programme_has_the_same_name(self):
        self.lms.modules = [
            {"moduleCatalogueId": "M1", "name": "Selected module", "programmeId": "P1",
             "programme": "Digital Marketing L3"},
            {"moduleCatalogueId": "M2", "name": "Other programme module", "programmeId": "P2",
             "programme": "Digital Marketing L3"},
        ]
        _text, data = self.ok("find_modules", {"programme_id": "P1"})
        self.assertEqual([m["module_id"] for m in data["modules"]], ["M1"])

    def test_programme_scope_does_not_guess_ownership_for_missing_ids(self):
        self.lms.modules = [
            {"moduleCatalogueId": "M1", "name": "Selected module", "programmeId": "P1"},
            {"moduleCatalogueId": "M2", "name": "No programme id", "programme": "Digital Marketing L3"},
            {"moduleCatalogueId": "M3", "name": "Empty programme id", "programmeId": "",
             "programme": "Digital Marketing L3"},
        ]
        _text, data = self.ok("find_modules", {"programme_id": "P1"})
        self.assertEqual([m["module_id"] for m in data["modules"]], ["M1"])

    def test_programme_source_id_is_also_recognised(self):
        self.lms.modules = [{"moduleCatalogueId": "M1", "name": "Selected module",
                             "programmeId": "SOURCE-P1", "programme": "Legacy display name"}]
        with mock.patch.dict(PROGRAMMES[0], {"sourceId": "SOURCE-P1"}):
            _text, data = self.ok("find_modules", {"programme_id": "SOURCE-P1"})
        self.assertEqual([m["module_id"] for m in data["modules"]], ["M1"])

    def test_caps_at_twenty_and_reports_the_total(self):
        self.lms.modules = [{"moduleCatalogueId": f"X{i:02}", "name": f"Module {i:02}", "status": "draft"}
                            for i in range(25)]
        text, data = self.ok("find_modules")
        self.assertEqual(len(data["modules"]), 20)
        self.assertEqual(data["total"], 25)
        self.assertIn("Showing 20 of 25", text)

    def test_structure_lists_weeks_components_quizzes_and_ksbs(self):
        text, data = self.ok("get_module_structure", {"module_id": "M1"})
        week = data["weeks"][0]
        self.assertEqual(week["week_id"], "W1")
        quiz = week["components"][1]
        self.assertEqual((quiz["component_id"], quiz["linked_quiz_id"], quiz["ksb_codes"]), ("CP2", "42", ["K1", "S2"]))
        self.assertIn("component_id CP2", text)
        self.assertIn("quiz 42", text)

    def test_missing_module_is_a_plain_error(self):
        self.assertIn("doesn't exist", self.err("get_module_structure", {"module_id": "ZZZ"}))

    def test_legacy_training_module_is_refused_without_calling_its_get(self):
        path = f"{C}/modules/training-module-123/structure/"
        self.lms.routes[path] = lambda q: STRUCTURE
        message = self.err("get_module_structure", {"module_id": "training-module-123"})
        self.assertIn("saved module", message)
        self.assertIn("find_modules", message)
        self.assertNotIn(("GET", path, None), self.lms.calls)


class KsbTests(ReadToolTestCase):
    def test_source_comes_from_the_programme_record(self):
        text, data = self.ok("list_standard_ksbs", {"programme_id": "P1"})
        self.resolve.assert_called_once_with("standard:st0596-v1-0")
        self.assertEqual([k["code"] for k in data["ksbs"]], ["K1", "S2", "B1"])
        self.assertIn("ST0596 v1.0", text)

    def test_filters(self):
        _text, data = self.ok("list_standard_ksbs", {"programme_id": "P1", "type": "S"})
        self.assertEqual([k["code"] for k in data["ksbs"]], ["S2"])
        _text, data = self.ok("list_standard_ksbs", {"programme_id": "P1", "query": "ethic"})
        self.assertEqual([k["code"] for k in data["ksbs"]], ["B1"])

    def test_programme_without_standard_is_refused(self):
        self.assertIn("no KSB standard applied", self.err("list_standard_ksbs", {"programme_id": "P2"}))
        self.resolve.assert_not_called()

    def test_coverage_splits_covered_and_gaps(self):
        text, data = self.ok("ksb_coverage", {"programme_id": "P1"})
        self.assertEqual(data["covered"], [{"code": "K1", "mappings": 2, "components": 2}])
        self.assertEqual(data["gaps"], [{"code": "S2", "description": "Use analytics tools"}])
        self.assertIn("1 covered, 1 gap(s)", text)
        _text, data = self.ok("ksb_coverage", {"module_id": "M1"})
        self.assertEqual(data["scope"], "module")

    def test_coverage_needs_exactly_one_scope(self):
        self.assertIn("exactly one", self.err("ksb_coverage", {}))
        self.assertIn("exactly one", self.err("ksb_coverage", {"programme_id": "P1", "module_id": "M1"}))


class QuizTests(ReadToolTestCase):
    def test_quiz_with_answers_and_no_attempts(self):
        text, data = self.ok("get_quiz", {"quiz_id": 42})
        self.assertEqual(data["attempt_count"], 0)
        self.assertEqual(data["questions"][0]["answers"][0], {"text": "Price", "is_correct": True})
        self.assertIn("No learner has attempted it yet", text)
        self.attempts.assert_called_once_with(42)

    def test_quiz_with_attempts_warns(self):
        self.attempts.return_value = 3
        text, data = self.ok("get_quiz", {"quiz_id": 42})
        self.assertEqual(data["attempt_count"], 3)
        self.assertIn("must not be edited in place", text)

    def test_quiz_id_must_be_a_number(self):
        self.assertIn("whole number", self.err("get_quiz", {"quiz_id": "42"}))


class BookTests(ReadToolTestCase):
    def plan(self, **kwargs):
        plan = Plan(mode="topic", question_count=8, ceiling=1000)
        plan.blocks = [("Marketing Essentials", [Segment(1, "b", "B1", "Marketing Essentials", "Ch 2", "The 4 Ps",
                                                         "12–14", 100, "x" * 2000)])]
        plan.warnings = kwargs.get("warnings", [])
        return plan

    def test_only_ready_live_books_are_listed(self):
        _text, data = self.ok("list_books", {"query": "market"})
        self.assertEqual([b["book_id"] for b in data["books"]], ["B1"])
        self.assertEqual(data["books"][0]["pages"], 300)

    def test_search_returns_cited_truncated_passages(self):
        with mock.patch.object(read, "_plan", return_value=self.plan()) as plan:
            text, data = self.ok("search_books", {"book_ids": ["B1", "B1"], "topic": " marketing mix "})
        plan.assert_called_once_with(["B1"], "marketing mix", 8)
        passage = data["passages"][0]
        self.assertEqual((passage["book"], passage["section"], passage["pages"]),
                         ("Marketing Essentials", "The 4 Ps", "12–14"))
        self.assertEqual(len(passage["text"]), read.PASSAGE_CHARS + 1)
        self.assertIn("p. 12–14", text)

    def test_unavailable_books_are_a_plain_error(self):
        with mock.patch.object(read, "_plan", side_effect=KnowledgeBaseUnavailable("None of the selected books is ready yet.")):
            self.assertIn("ready yet", self.err("search_books", {"book_ids": ["B2"], "topic": "mix"}))

    def test_search_is_rate_limited(self):
        limits = {**ratelimit.BUCKETS, "book_searches": (1, 60, "book searches", "a minute")}
        with mock.patch.dict(ratelimit.BUCKETS, limits), mock.patch.object(read, "_plan", return_value=self.plan()):
            self.ok("search_books", {"book_ids": ["B1"], "topic": "mix"})
            self.assertIn("limit of 1 book searches", self.err("search_books", {"book_ids": ["B1"], "topic": "mix"}))


class ReadOnlyGuaranteeTests(ReadToolTestCase):
    READ_TOOLS = ("find_programmes", "find_cohorts_groups", "find_modules", "get_module_structure",
                  "list_standard_ksbs", "ksb_coverage", "get_quiz", "list_books", "search_books")

    def test_read_tools_are_annotated_read_only(self):
        for name in self.READ_TOOLS:
            self.assertFalse(REGISTRY[name].writes, name)

    def test_every_lms_call_is_a_get_and_no_output_holds_personal_data(self):
        with mock.patch.object(read, "_plan", return_value=BookTests.plan(self)):
            for name, arguments in (
                ("find_programmes", {}), ("find_cohorts_groups", {"programme_id": "P1"}),
                ("find_modules", {}), ("get_module_structure", {"module_id": "M1"}),
                ("list_standard_ksbs", {"programme_id": "P1"}), ("ksb_coverage", {"programme_id": "P1"}),
                ("get_quiz", {"quiz_id": 42}), ("list_books", {}),
                ("search_books", {"book_ids": ["B1"], "topic": "mix"}),
            ):
                self.ok(name, arguments)  # ok() also asserts no personal-data keys
        self.assertTrue(self.lms.calls)
        self.assertEqual({method for method, _path, _query in self.lms.calls}, {"GET"})
