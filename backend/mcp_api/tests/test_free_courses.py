"""Free courses: converted free courses are standalone modules (source_type 'free_course') in no programme."""
import copy
from unittest import mock

from mcp_api import dispatch
from mcp_api.tests.test_components import ComponentTestCase
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import components, read, weeks

ROWS = [
    {"moduleCatalogueId": "MOD-FREE-1", "name": "GDPR", "isFreeCourse": True, "weeks": 1},
    {"moduleCatalogueId": "MOD-FREE-2", "name": "Academic Writing", "sourceType": "free_course", "weeks": 2},
    {"moduleCatalogueId": "MOD-P1", "name": "Marketing", "programmeId": "P1", "weeks": 6},
]
FREE_MODULE = {"catalogueId": "MOD-FREE-1", "programmeId": "", "programmeName": "Unassigned programme",
               "title": "GDPR", "status": "draft", "isFreeCourse": True, "weekStructure": [
                   {"id": "FW1", "weekNumber": 1, "title": "Week 1", "components": []}]}


class FindFreeCoursesTests(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.queries = []
        self.enterContext(mock.patch.object(read, "call_api", side_effect=self.api))

    def api(self, request, method, path, *, query=None, json_body=None):
        self.queries.append((method, path, query))
        return 200, {"results": ROWS}

    def run_tool(self, arguments):
        response = self.post(rpc("tools/call", {"name": "find_free_courses", "arguments": arguments}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def test_lists_only_free_course_modules_with_their_module_ids(self):
        data = self.run_tool({})["structuredContent"]
        self.assertEqual([c["module_id"] for c in data["free_courses"]], ["MOD-FREE-2", "MOD-FREE-1"])
        self.assertEqual(self.queries, [("GET", "/curriculum_api/curriculum/modules/", {"compact": "1"})])

    def test_query_filters_by_name(self):
        data = self.run_tool({"query": "gdpr"})["structuredContent"]
        self.assertEqual([c["module_id"] for c in data["free_courses"]], ["MOD-FREE-1"])

    def test_the_legacy_whole_library_save_is_never_allowlisted(self):
        path = "/curriculum_api/curriculum/free-programmes/FREE-COURSES/modules/"
        for method in ("GET", "PATCH", "POST", "PUT"):
            self.assertFalse(dispatch.is_allowed(method, path))


class FreeCourseWriteTests(ComponentTestCase):
    def setUp(self):
        super().setUp()
        self.module = copy.deepcopy(FREE_MODULE)
        self.enterContext(mock.patch.object(weeks, "call_api", side_effect=self.free_api))
        self.enterContext(mock.patch.object(weeks, "_locked_new_week", side_effect=self.parents))
        self.enterContext(mock.patch.object(components, "call_api", side_effect=self.free_api))

    def free_api(self, request, method, path, *, query=None, json_body=None):
        if method == "GET" and path.endswith("/modules/MOD-FREE-1/structure/"):
            return 200, copy.deepcopy(self.module)
        if path.endswith("/programmes/"):
            raise AssertionError("a free course must not be looked up as a programme")
        if method == "POST" and path == dispatch.COMPONENT_CREATE_PATH:
            self.posts.append(copy.deepcopy(json_body))
            structure = self.module["weekStructure"]
            week = next((w for w in structure if w["id"] == json_body["weekId"]), None)
            if week is None:
                week = {"id": json_body["weekId"], "weekNumber": json_body["weekNumber"], "components": []}
                structure.append(week)
            created = {**json_body, "id": f"COMP-{len(self.posts)}"}
            week["components"].append(created)
            return 201, {"created": True, "component": created}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def test_component_creation_works_without_a_programme(self):
        result = self.run_tool({"module_id": "MOD-FREE-1", "week_id": "FW1", "type": "reading", "title": "Notes"})
        self.assertFalse(result.get("isError"), result)
        self.assertFalse(self.apply(result["structuredContent"]["preview_id"]).get("isError"))
        self.assertEqual(self.posts[0]["moduleCatalogueId"], "MOD-FREE-1")

    def test_a_programme_id_on_a_free_course_is_refused(self):
        result = self.run_tool({"programme_id": "P1", "module_id": "MOD-FREE-1", "week_id": "FW1",
                                "type": "reading", "title": "Notes"})
        self.assert_error(result, "free course and belongs to no programme")

    def test_a_programme_module_still_needs_its_programme(self):
        self.module = {**copy.deepcopy(FREE_MODULE), "isFreeCourse": False, "programmeId": "P1"}
        result = self.run_tool({"module_id": "MOD-FREE-1", "week_id": "FW1", "type": "reading", "title": "Notes"})
        self.assert_error(result)
        self.assertEqual(self.posts, [])

    def test_free_course_week_uses_the_self_study_template(self):
        result = self.run_tool({"module_id": "MOD-FREE-1"}, name=weeks.NAME)
        self.assertFalse(result.get("isError"), result)
        types = [c["type"] for c in result["structuredContent"]["details"]["components"]]
        self.assertEqual(types, ["reading", "video", "reflection"])
        self.assertFalse(self.apply(result["structuredContent"]["preview_id"]).get("isError"))
        self.assertEqual([p["type"] for p in self.posts], ["reading", "video", "reflection"])
