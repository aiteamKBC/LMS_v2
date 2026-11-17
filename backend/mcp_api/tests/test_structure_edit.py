"""Structure edits: real MCP protocol, a fake LMS that applies the drawers' PATCHes and partial saves."""
import copy
from types import SimpleNamespace
from unittest import mock

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import read, structure, structure_edit

C = "/curriculum_api/curriculum"
RECORDS = {
    "programme": {"PROG-1": {"id": "PROG-1", "name": "Digital Marketing L3", "level": "LVL-3",
                             "description": "Kept", "color": "#6941c6"}},
    "cohort": {"COHORT-1": {"id": "COHORT-1", "name": "Jan-26", "programmeId": "PROG-1", "startDate": "2026-01-05",
                            "durationMonths": 24, "endDate": "2028-01-04", "epaMonths": 3,
                            "apprenticeshipEndOverride": "", "color": "#111111", "holidayIds": []}},
    "group": {"GROUP-1": {"id": "GROUP-1", "name": "Tuesday group", "cohortId": "COHORT-1", "coach": "Ali Hassan",
                          "tutor": "", "weekDays": "Tuesday", "startTime": "10:00", "endTime": "12:00",
                          "color": "#222222"}},
}
MODULE = {"catalogueId": "M1", "programmeId": "PROG-1", "title": "Marketing", "description": "Old", "status": "draft",
          "color": "#333333", "startDate": "2026-02-01", "endDate": "2026-05-01", "tutor": "", "sessionsNumber": 12,
          "weeksNumber": 2, "background": "", "epaRequirements": [], "qualificationOutcomes": [],
          "completionCriteria": {"quizzesCompletedRequired": False, "averageScoreRequired": 70},
          "advancedDetails": {"intent": "", "learnerBenefit": "Kept"},
          "weekStructure": [
              {"id": "W1", "weekNumber": 1, "title": "Week 1", "summary": "", "learningOutcomes": [],
               "holidayNoteEnabled": False, "holidayNote": "", "deletedAt": None,
               "components": [{"id": "C1", "title": "Reading", "type": "reading"}]},
              {"id": "W2", "weekNumber": 2, "title": "Week 2", "summary": "", "learningOutcomes": [],
               "holidayNoteEnabled": False, "holidayNote": "", "components": []},
          ]}


class EditTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_STRUCTURE_CREATION_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.records = copy.deepcopy(RECORDS)
        self.revisions = {(kind, rid): 1 for kind, rows in self.records.items() for rid in rows}
        self.module, self.module_revision = copy.deepcopy(MODULE), 1
        self.writes = []
        for target in (read, structure, structure_edit):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(structure_edit.transaction, "atomic", mock.MagicMock()))

    def stale(self, body, current):
        if body.get("expectedRevision") != f"rev-{current}":
            raise dispatch.DispatchError("That conflicts with the item's current state.", 409)

    def api(self, request, method, path, *, query=None, json_body=None):
        if method == "GET" and path == f"{C}/record-snapshot/":
            record = self.records[query["kind"]].get(query["id"])
            revision = self.revisions.get((query["kind"], query["id"]))
            return 200, {"record": copy.deepcopy(record), "revision": f"rev-{revision}" if record else ""}
        if method == "GET" and path == f"{C}/programmes/":
            return 200, {"results": [{**r, "status": "active", "ksbProfileSourceId": r.get("ksb", "")}
                                     for r in self.records["programme"].values()]}
        if method == "GET" and path == f"{C}/coaches/":
            return 200, {"results": [{"name": "Ali Hassan"}, {"name": "Sarah Jones"}]}
        if method == "GET" and path == f"{C}/standards/st0122/":
            return 200, {"id": "st0122", "name": "Digital marketer"}
        if method == "GET" and path.endswith("/groups/") or method == "GET" and path.endswith("/cohorts/"):
            return 200, {"results": []}
        if method == "GET" and path == f"{C}/modules/M1/structure/":
            return 200, {**copy.deepcopy(self.module), "structureRevision": f"rev-{self.module_revision}"}
        self.writes.append((method, path, copy.deepcopy(json_body)))
        found = dispatch.forbidden_key(json_body)
        assert found is None, f"dispatcher would refuse {found}"
        assert dispatch.is_allowed(method, path), path
        for kind, base in (("programme", "programmes"), ("cohort", "cohorts"), ("group", "groups")):
            if method == "PATCH" and path.startswith(f"{C}/{base}/"):
                rid = path.rstrip("/").rsplit("/", 1)[-1]
                self.stale(json_body, self.revisions[(kind, rid)])
                record = self.records[kind][rid]
                body = {k: v for k, v in json_body.items() if k != "expectedRevision"}
                if body.get("ksbProfileSourceId"):
                    record["ksb"] = body.pop("ksbProfileSourceId")
                if kind == "cohort" and "durationMonths" in body and "endDate" not in body:
                    body["endDate"] = "2028-03-01"  # what the LMS recalculates
                record.update({k: ("" if v is None else v) for k, v in body.items()})
                self.revisions[(kind, rid)] += 1
                return 200, {"updated": True, "teamsCalendarsToUpdate":
                             [{"moduleName": "Marketing"}] if kind == "group" and "weekDays" in body else []}
        if method == "PATCH" and path == f"{C}/modules/M1/":
            self.stale(json_body, self.module_revision)
            body = {k: v for k, v in json_body.items() if k != "expectedRevision"}
            if "weeks" in body:
                body["weeksNumber"] = body.pop("weeks")
            self.module.update(body)
            self.module_revision += 1
            return 200, {"updated": True, "teamsCalendarsToUpdate": [{"moduleName": "Marketing"}]
                         if {"startDate", "endDate"} & body.keys() else []}
        if method == "PATCH" and path == f"{C}/modules/M1/structure/":
            self.stale(json_body, self.module_revision)
            delta = json_body["structureDelta"]
            weeks = {w["id"]: w for w in self.module["weekStructure"]}
            assert delta["weekOrder"] == list(weeks), "every week must stay in its stored order"
            self.module["weekStructure"] = [
                {**{k: v for k, v in delta["weeks"].get(wid, weeks[wid]).items() if k != "components"},
                 "components": weeks[wid]["components"]} for wid in delta["weekOrder"]]
            for key in ("background", "epaRequirements", "qualificationOutcomes"):
                self.module[key] = json_body.get(key, self.module[key])
            self.module_revision += 1
            return 200, {"updated": True}
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

    def edit(self, name, arguments):
        data = self.preview(name, arguments)
        applied = self.apply(data["preview_id"])
        self.assertFalse(applied.get("isError"), applied)
        return data, applied["structuredContent"]


class ProgrammeEditTests(EditTestCase):
    def test_changed_fields_are_sent_with_the_others_and_the_revision(self):
        data, applied = self.edit("update_programme", {"programme_id": "PROG-1", "name": "Digital Marketing L4",
                                                       "level": 4, "color": "#ABCDEF", "standard_id": "st0122"})
        self.assertIn("level: 'LVL-3' → 'LVL-4'", data["summary"])
        self.assertTrue(any("KSB mapping" in w for w in data["warnings"]))
        (_, path, body), = self.writes
        self.assertEqual(path, f"{C}/programmes/PROG-1/")
        # The programme PATCH writes level and description from the body, so the kept ones travel too.
        self.assertEqual(body, {"name": "Digital Marketing L4", "level": "LVL-4", "description": "Kept",
                                "color": "#abcdef", "ksbProfileSourceId": "standard:st0122",
                                "expectedRevision": "rev-1"})
        self.assertEqual(sorted(applied["result"]["changed"]), ["color", "ksbProfileSourceId", "level", "name"])

    def test_someone_elses_save_after_the_preview_is_refused(self):
        preview_id = self.preview("update_programme", {"programme_id": "PROG-1", "description": "New"})["preview_id"]
        self.revisions[("programme", "PROG-1")] += 1
        self.assertTrue(self.apply(preview_id).get("isError"))
        self.assertEqual(self.writes, [])

    def test_nothing_to_change_html_and_bad_colour_are_refused(self):
        self.assertIn("nothing to change", self.error("update_programme", {"programme_id": "PROG-1", "level": 3}))
        self.assertIn("HTML", self.error("update_programme", {"programme_id": "PROG-1", "description": "<b>x</b>"}))
        self.assertIn("hex code", self.error("update_programme", {"programme_id": "PROG-1", "color": "red1234"}))
        self.assertEqual(self.writes, [])


class CohortEditTests(EditTestCase):
    def test_start_date_sends_the_length_too_and_previews_the_lms_end_date(self):
        data, _ = self.edit("update_cohort", {"cohort_id": "COHORT-1", "start_date": "2026-03-02"})
        self.assertIn("startDate: '2026-01-05' → '2026-03-02'", data["summary"])
        (_, path, body), = self.writes
        self.assertEqual(path, f"{C}/cohorts/COHORT-1/")
        self.assertEqual((body["startDate"], body["durationMonths"]), ("2026-03-02", 24))
        self.assertNotIn("endDate", body)  # the LMS calculates it, as the form leaves it to

    def test_override_is_cleared_with_empty_text_and_name_alone_is_partial(self):
        self.records["cohort"]["COHORT-1"]["apprenticeshipEndOverride"] = "2028-06-01"
        self.edit("update_cohort", {"cohort_id": "COHORT-1", "apprenticeship_end_override": "", "name": "Feb-26"})
        (_, _, body), = self.writes
        self.assertEqual(body, {"apprenticeshipEndOverride": None, "name": "Feb-26", "expectedRevision": "rev-1"})


class GroupEditTests(EditTestCase):
    def test_slot_change_warns_and_names_the_teams_calendars_to_update(self):
        data, applied = self.edit("update_group", {"group_id": "GROUP-1", "week_days": ["Thursday", "Monday"],
                                                   "start_time": "13:00", "end_time": "15:00",
                                                   "coach": "sarah jones"})
        self.assertTrue(any("Teams" in w for w in data["warnings"]))
        (_, _, body), = self.writes
        self.assertEqual(body["weekDays"], "Monday, Thursday")
        self.assertEqual(body["coach"], "Sarah Jones")
        self.assertEqual(applied["result"]["teams_calendars_to_update"], ["Marketing"])

    def test_bad_times_and_unknown_coach_are_refused(self):
        self.assertIn("after the start", self.error("update_group", {"group_id": "GROUP-1", "end_time": "09:00"}))
        self.assertIn("not a coach", self.error("update_group", {"group_id": "GROUP-1", "coach": "Nobody"}))
        self.assertEqual(self.writes, [])


class ModuleEditTests(EditTestCase):
    def test_form_fields_use_the_drawer_patch_and_builder_fields_the_partial_save(self):
        data, applied = self.edit("update_module", {
            "module_id": "M1", "description": "New", "end_date": "2026-06-01", "intent": "Why",
            "quizzes_completed_required": True, "background": "Context", "epa_requirements": ["Portfolio"]})
        (m1, p1, drawer), (m2, p2, partial) = self.writes
        self.assertEqual((m1, p1), ("PATCH", f"{C}/modules/M1/"))
        self.assertEqual(drawer["advancedDetails"], {"intent": "Why", "learnerBenefit": "Kept"})
        self.assertEqual(drawer["completionCriteria"], {"quizzesCompletedRequired": True, "averageScoreRequired": 70})
        self.assertNotIn("background", drawer)
        self.assertEqual((m2, p2), ("PATCH", f"{C}/modules/M1/structure/"))
        self.assertEqual((partial["saveMode"], partial["expectedRevision"]), ("partial", "rev-2"))
        self.assertEqual(partial["structureDelta"]["weeks"], {})
        self.assertEqual((partial["background"], partial["epaRequirements"]), ("Context", ["Portfolio"]))
        self.assertEqual(applied["result"]["teams_calendars_to_update"], ["Marketing"])
        self.assertTrue(any("Teams" in w for w in data["warnings"]))

    def test_price_needs_a_free_course_and_dates_must_be_in_order(self):
        self.assertIn("free course", self.error("update_module", {"module_id": "M1", "price": 10}))
        self.assertIn("before the start", self.error("update_module", {"module_id": "M1", "end_date": "2026-01-01"}))
        self.module["status"] = "archived"
        self.assertIn("draft module", self.error("update_module", {"module_id": "M1", "title": "X"}))
        self.assertEqual(self.writes, [])


class WeekEditTests(EditTestCase):
    def test_only_the_week_changes_and_every_week_and_component_keeps_its_place(self):
        data, _ = self.edit("update_week", {"module_id": "M1", "week_id": "W2", "title": "Pricing",
                                            "learning_outcomes": ["Set a price", " Compare  offers "]})
        self.assertIn("title: 'Week 2' → 'Pricing'", data["summary"])
        (_, path, body), = self.writes
        self.assertEqual(path, f"{C}/modules/M1/structure/")
        delta = body["structureDelta"]
        self.assertEqual(list(delta["weeks"]), ["W2"])
        self.assertEqual(delta["weeks"]["W2"]["learningOutcomes"], ["Set a price", "Compare offers"])
        self.assertEqual(delta["componentOrder"], {"W1": ["C1"], "W2": []})
        self.assertEqual(self.module["weekStructure"][1]["title"], "Pricing")
        self.assertEqual(self.module["weekStructure"][0]["components"], MODULE["weekStructure"][0]["components"])

    def test_unknown_week_is_refused(self):
        self.assertIn("not in this module", self.error("update_week", {"module_id": "M1", "week_id": "W9",
                                                                       "title": "X"}))
