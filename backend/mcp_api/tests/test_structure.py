"""Step 10 structure creation: real MCP protocol and the LMS's own end-date rule, fake LMS endpoints."""
import copy
from types import SimpleNamespace
from unittest import mock

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import read, structure

PROGRAMMES = [{"id": "PROG-1", "name": "Digital Marketing L3", "status": "active"},
              {"id": "PROG-OLD", "name": "Old Programme", "status": "archived"}]
COHORTS = [{"id": "COHORT-1", "name": "Jan-26", "status": "active"}]
GROUPS = [{"id": "GROUP-1", "name": "Tuesday group", "status": "planned"}]
MODULES = [{"moduleCatalogueId": "MOD-1", "name": "Marketing Basics", "programmeId": "PROG-1"}]
COACHES = [{"name": "Sarah Jones"}, {"name": "Sarah Khan"}, {"name": "Ali Hassan"}]


class StructureTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_STRUCTURE_CREATION_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.programmes, self.cohorts, self.groups = copy.deepcopy(PROGRAMMES), copy.deepcopy(COHORTS), copy.deepcopy(GROUPS)
        self.modules, self.writes, self.answer = copy.deepcopy(MODULES), [], None
        for target in (read, structure):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(structure.transaction, "atomic", mock.MagicMock()))

    def api(self, request, method, path, *, query=None, json_body=None):
        c = "/curriculum_api/curriculum"
        reads = {f"{c}/programmes/": self.programmes, f"{c}/programmes/PROG-1/cohorts/": self.cohorts,
                 f"{c}/cohorts/COHORT-1/groups/": self.groups, f"{c}/modules/": self.modules, f"{c}/coaches/": COACHES,
                 f"{c}/standards/": [{"id": "st0122-v1-2", "name": "Digital marketer", "standardRef": "ST0122"}]}
        if method == "GET" and path in reads:
            return 200, {"results": reads[path]}
        if method == "GET" and path == f"{c}/standards/st0122-v1-2/":
            return 200, {"id": "st0122-v1-2", "name": "Digital marketer"}
        self.writes.append((method, path, copy.deepcopy(json_body)))
        if self.answer:
            return self.answer
        if path == f"{c}/programmes/":
            return 201, {"created": True, "programme": {"id": "PROG-NEW", "ksbProfileSourceId": json_body.get("ksbProfileSourceId", "")}}
        if path.endswith("/cohorts/"):
            from curriculum_api.views import cohort_practical_end_date
            end = cohort_practical_end_date(json_body["startDate"], json_body["durationMonths"])
            return 201, {"created": True, "cohort": {"id": "COHORT-NEW", "startDate": json_body["startDate"], "endDate": str(end)}}
        if path.endswith("/groups/"):
            return 201, {"created": True, "group": {"id": "GROUP-NEW", "status": "planned"}}
        if path == f"{c}/modules/":
            return 201, {"created": True, "moduleCatalogueId": "MOD-NEW", "module": {}}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, name, arguments):
        response = self.post(rpc("tools/call", {"name": name, "arguments": arguments}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def error(self, name, arguments):
        result = self.run_tool(name, arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]

    def create(self, name, arguments):
        result = self.run_tool(name, arguments)
        self.assertFalse(result.get("isError"), result)
        applied = self.run_tool("apply_change", {"preview_id": result["structuredContent"]["preview_id"]})
        self.assertFalse(applied.get("isError"), applied)
        return result["structuredContent"], applied["structuredContent"]


class ProgrammeTests(StructureTestCase):
    def test_duplicate_names_are_refused_ignoring_case_spacing_and_punctuation(self):
        self.assertIn("already exists", self.error("create_programme", {"name": "digital  marketing-L3"}))
        self.assertEqual(self.writes, [])

    def test_create_with_standard_sends_no_client_id_and_needs_created_true(self):
        preview, applied = self.create("create_programme", {"name": "Data Analyst L4", "level": 4, "standard_id": "st0122-v1-2"})
        self.assertIn("no draft state", preview["details"]["note"])
        (_, path, body), = self.writes
        self.assertEqual(body, {"name": "Data Analyst L4", "description": "", "level": "LVL-4",
                                "ksbProfileSourceId": "standard:st0122-v1-2"})
        self.assertEqual(applied["result"]["programme_id"], "PROG-NEW")

    def test_an_upsert_answer_is_never_reported_as_created(self):
        preview = self.run_tool("create_programme", {"name": "Data Analyst L4"})["structuredContent"]
        self.answer = (200, {"created": False, "programme": {"id": "PROG-1"}})
        result = self.run_tool("apply_change", {"preview_id": preview["preview_id"]})
        self.assertIn("matched an existing programme", result["content"][0]["text"])

    def test_name_created_between_preview_and_apply_is_refused(self):
        preview = self.run_tool("create_programme", {"name": "Data Analyst L4"})["structuredContent"]
        self.programmes.append({"id": "PROG-RACE", "name": "Data Analyst L4", "status": "active"})
        self.assertTrue(self.run_tool("apply_change", {"preview_id": preview["preview_id"]}).get("isError"))
        self.assertEqual(self.writes, [])

    def test_standards_are_listed_without_their_ksbs(self):
        data = self.run_tool("list_ksb_standards", {"query": "st0122"})["structuredContent"]
        self.assertEqual(data["standards"][0]["standard_id"], "st0122-v1-2")


class CohortTests(StructureTestCase):
    def test_end_date_comes_from_the_lms_rule_and_is_checked_at_apply(self):
        preview, applied = self.create("create_cohort", {"programme_id": "PROG-1", "name": "Sep-26", "start_date": "2026-09-01"})
        self.assertEqual(preview["details"]["end_date"], "2028-08-31")
        (_, path, body), = self.writes
        self.assertEqual(path, "/curriculum_api/curriculum/programmes/PROG-1/cohorts/")
        self.assertEqual(body, {"name": "Sep-26", "programmeId": "PROG-1", "startDate": "2026-09-01", "durationMonths": 24})
        self.assertEqual(applied["result"]["cohort_id"], "COHORT-NEW")

    def test_archived_programme_duplicate_cohort_and_bad_date_are_refused(self):
        self.assertIn("archived", self.error("create_cohort", {"programme_id": "PROG-OLD", "name": "X", "start_date": "2026-09-01"}))
        self.assertIn("already exists", self.error("create_cohort", {"programme_id": "PROG-1", "name": "JAN 26", "start_date": "2026-09-01"}))
        self.assertIn("YYYY-MM-DD", self.error("create_cohort", {"programme_id": "PROG-1", "name": "X", "start_date": "01/09/2026"}))


class GroupTests(StructureTestCase):
    def test_coach_must_match_exactly_one_directory_name(self):
        base = {"programme_id": "PROG-1", "cohort_id": "COHORT-1", "name": "Thursday group"}
        text = self.error("create_group", {**base, "coach": "Sarah"})
        self.assertIn("is not a coach", text)
        self.assertIn("Sarah Jones, Sarah Khan", text)
        preview, _ = self.create("create_group", {**base, "coach": "sarah  jones", "week_days": ["Thursday", "Tuesday"],
                                                  "start_time": "09:30", "end_time": "12:00"})
        self.assertEqual(self.writes[-1][2], {"name": "Thursday group", "coach": "Sarah Jones",
                                              "weekDays": "Tuesday, Thursday", "startTime": "09:30", "endTime": "12:00"})

    def test_times_and_duplicates_are_checked(self):
        base = {"programme_id": "PROG-1", "cohort_id": "COHORT-1"}
        self.assertIn("after the start time", self.error("create_group", {**base, "name": "G", "start_time": "12:00", "end_time": "09:00"}))
        self.assertIn("HH:MM", self.error("create_group", {**base, "name": "G", "start_time": "9am", "end_time": "12:00"}))
        self.assertIn("already exists", self.error("create_group", {**base, "name": "tuesday GROUP"}))
        self.assertIn("active cohort", self.error("create_group", {**base, "cohort_id": "COHORT-X", "name": "G"}))


class ModuleTests(StructureTestCase):
    def test_draft_module_with_weeks_and_explicit_placement(self):
        preview, applied = self.create("create_module", {"programme_id": "PROG-1", "cohort_id": "COHORT-1",
                                                         "group_id": "GROUP-1", "title": "Social Media", "weeks": 2})
        self.assertIn("will see this module", preview["warnings"][0])
        (_, path, body), = self.writes
        self.assertEqual((body["status"], body["moduleType"], body["programmeId"], body["programmeName"], body["groupId"]),
                         ("draft", "authoring", "PROG-1", "Digital Marketing L3", "GROUP-1"))
        self.assertEqual([w["title"] for w in body["weekStructure"]], ["Week 1", "Week 2"])
        self.assertNotIn("catalogueId", body)
        self.assertIsNone(dispatch.forbidden_key(body))
        self.assertEqual(applied["result"]["module_id"], "MOD-NEW")

    def test_duplicate_title_and_existing_match_are_refused(self):
        self.assertIn("already exists", self.error("create_module", {"programme_id": "PROG-1", "title": "marketing basics"}))
        preview = self.run_tool("create_module", {"programme_id": "PROG-1", "title": "New one"})["structuredContent"]
        self.answer = (200, {"created": False, "existing": True, "moduleCatalogueId": "MOD-9"})
        self.assertTrue(self.run_tool("apply_change", {"preview_id": preview["preview_id"]}).get("isError"))

    def test_cohort_without_group_is_refused_and_flag_is_default_off(self):
        self.assertIn("both cohort_id and group_id",
                      self.error("create_module", {"programme_id": "PROG-1", "cohort_id": "COHORT-1", "title": "X"}))
        with mock.patch.dict("os.environ", {"MCP_STRUCTURE_CREATION_ENABLED": "0"}):
            self.assertIn("not enabled", self.error("create_module", {"programme_id": "PROG-1", "title": "X"}))
