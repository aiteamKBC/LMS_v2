"""Step 9 map_ksbs / add_lesson_content: real MCP/OAuth/preview protocol, fake LMS endpoints."""
import copy
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tools import components, content, quizzes, read
from mcp_api.tools.markdown import markdown_to_html

MODULE = {"catalogueId": "M1", "programmeId": "PROG-1", "title": "Marketing", "status": "draft",
          "structureRevision": "rev-1", "weekStructure": [
              {"id": "W1", "weekNumber": 1, "title": "Week 1", "components": [
                  {"id": "RD1", "title": "Reading Material", "type": "reading", "settings": {"readingContent": ""},
                   "ksbMappings": [{"id": "MAP-1", "code": "K1", "classification": "secondary",
                                    "weightClass": "soft", "weight": 1}]},
                  {"id": "RD2", "title": "File reading", "type": "reading",
                   "settings": {"uploadedFileUrl": "/curriculum_api/curriculum/uploads/x.pdf"}},
                  {"id": "V1", "title": "Video", "type": "video", "settings": {}},
              ]},
          ]}
SOURCE = SimpleNamespace(kind="standard", source_id="st0001", label="ST0001 Marketing",
                         items=[{"code": "K1"}, {"code": "S2"}, {"code": "B1"}])
MAP_ARGS = {"programme_id": "PROG-1", "module_id": "M1", "component_id": "RD1", "mappings": [
    {"ksb_code": "s2", "classification": "main", "weight_class": "hard", "weight": 2},
    {"ksb_code": "K1", "classification": "secondary", "weight_class": "hard", "weight": 1},
]}
LESSON_ARGS = {"programme_id": "PROG-1", "module_id": "M1", "component_id": "RD1",
               "body_markdown": "# The marketing mix\n\nThe **4 Ps**:\n\n- Product\n- Price"}


class ContentTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_CONTENT_EDITING_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.module = copy.deepcopy(MODULE)
        self.programme = {"id": "PROG-1", "name": "Marketing L3", "status": "active",
                          "ksbProfileSourceId": "standard:st0001"}
        self.writes = []
        self.lost_write = False
        for target in (read, components, quizzes, content):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(quizzes, "_resolve_source", return_value=SOURCE))
        self.enterContext(mock.patch.object(content.transaction, "atomic", mock.MagicMock()))

    def component(self, component_id):
        return next(c for c in self.module["weekStructure"][0]["components"] if c["id"] == component_id)

    def bump(self):
        self.module["structureRevision"] = f"rev-{int(self.module['structureRevision'][4:]) + 1}"

    def api(self, request, method, path, *, query=None, json_body=None):
        if path.endswith("/programmes/"):
            return 200, {"results": [self.programme]}
        if method == "GET" and path.endswith("/modules/M1/structure/"):
            return 200, copy.deepcopy(self.module)
        self.writes.append((method, path, copy.deepcopy(json_body)))
        if json_body.get("expectedRevision") != self.module["structureRevision"]:
            raise dispatch.DispatchError("That conflicts with the item's current state.", 409)
        if self.lost_write:
            return 200, {}
        if method == "POST" and path.endswith("/components/RD1/ksb-mappings/"):
            for m in json_body["mappings"]:
                self.component("RD1")["ksbMappings"].append({"id": f"MAP-{m['code']}", "code": m["code"],
                                                             "classification": m["classification"],
                                                             "weightClass": m["weightClass"], "weight": m["weight"]})
            self.bump()
            return 201, {"created": True}
        if method == "PATCH" and path.startswith("/curriculum_api/curriculum/ksb-mappings/"):
            mapping_id = path.rstrip("/").rsplit("/", 1)[-1]
            mapping = next(m for m in self.component("RD1")["ksbMappings"] if m["id"] == mapping_id)
            mapping.update({k: json_body[k] for k in ("classification", "weightClass", "weight")})
            self.bump()
            return 200, {"updated": True}
        if method == "PATCH" and path == "/curriculum_api/curriculum/components/RD1/":
            component = self.component("RD1")
            component["settings"].update(json_body.get("settings") or {})
            component.update({k: json_body[k] for k in ("title", "description", "expectedOtjh", "points")
                              if k in json_body})
            # The real PATCH re-derives durationMinutes from `duration` (hours x 60 when absent).
            component["settings"]["durationMinutes"] = json_body.get(
                "duration", round(component.get("expectedOtjh", 2) * 60))
            self.bump()
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


class MapKsbsTests(ContentTestCase):
    def test_preview_separates_additions_from_changes(self):
        data = self.preview("map_ksbs", MAP_ARGS)
        self.assertIn("add S2 (main, hard, weight 2)", data["summary"])
        self.assertIn("change K1: secondary/soft/1 → secondary/hard/1", data["summary"])
        self.assertIn("future completions only", data["details"]["impact"])
        self.assertEqual(self.writes, [])

    def test_apply_creates_then_updates_with_fresh_revisions_and_reads_back(self):
        result = self.apply(self.preview("map_ksbs", MAP_ARGS)["preview_id"])
        self.assertFalse(result.get("isError"), result)
        (m1, p1, create), (m2, p2, update) = self.writes
        self.assertEqual((m1, p1), ("POST", "/curriculum_api/curriculum/components/RD1/ksb-mappings/"))
        self.assertEqual(create["expectedRevision"], "rev-1")
        self.assertEqual(create["mappings"][0]["sourceType"], "standard")
        self.assertEqual(create["mappings"][0]["sourceId"], "st0001")
        self.assertEqual((m2, p2), ("PATCH", "/curriculum_api/curriculum/ksb-mappings/MAP-1/"))
        self.assertEqual(update["expectedRevision"], "rev-2")
        self.assertEqual(result["structuredContent"]["result"]["added"], ["S2"])

    def test_unknown_duplicate_and_unchanged_codes(self):
        bad = {**MAP_ARGS, "mappings": [MAP_ARGS["mappings"][0], MAP_ARGS["mappings"][0],
                                        {**MAP_ARGS["mappings"][0], "ksb_code": "K9"}]}
        text = self.error("map_ksbs", bad)
        self.assertIn("S2 is listed more than once", text)
        self.assertIn("K9 is not in ST0001 Marketing", text)
        same = {**MAP_ARGS, "mappings": [{"ksb_code": "K1", "classification": "secondary",
                                          "weight_class": "soft", "weight": 1}]}
        self.assertIn("nothing to change", self.error("map_ksbs", same))

    def test_flag_and_draft_module_are_required(self):
        with mock.patch.dict("os.environ", {"MCP_CONTENT_EDITING_ENABLED": "0"}):
            self.assertIn("content editing is not enabled", self.error("map_ksbs", MAP_ARGS))
        self.module["status"] = "published"
        self.assertIn("draft module", self.error("map_ksbs", MAP_ARGS))

    def test_mapping_that_does_not_read_back_is_refused(self):
        preview_id = self.preview("map_ksbs", MAP_ARGS)["preview_id"]
        self.lost_write = True
        result = self.apply(preview_id)
        self.assertTrue(result.get("isError"))
        self.assertIn("nothing was saved", result["content"][0]["text"].lower())


class AddLessonContentTests(ContentTestCase):
    def test_preview_then_apply_writes_built_html_and_reads_it_back(self):
        result = self.apply(self.preview("add_lesson_content", LESSON_ARGS)["preview_id"])
        self.assertFalse(result.get("isError"), result)
        (_, path, body), = self.writes
        self.assertEqual(path, "/curriculum_api/curriculum/components/RD1/")
        self.assertEqual(body["expectedRevision"], "rev-1")
        self.assertEqual(body["settings"]["readingContent"],
                         "<h2>The marketing mix</h2><p>The <strong>4 Ps</strong>:</p><ul><li>Product</li><li>Price</li></ul>")
        self.assertEqual(body["settings"]["readingSource"], "Written in LMS")

    def test_existing_text_needs_replace_existing(self):
        self.component("RD1")["settings"]["readingContent"] = "<p>Old</p>"
        self.assertIn("replace_existing true", self.error("add_lesson_content", LESSON_ARGS))
        data = self.preview("add_lesson_content", {**LESSON_ARGS, "replace_existing": True})
        self.assertIn("REPLACE the existing lesson text (10 characters)", data["summary"])

    def test_html_file_backed_and_non_reading_components_are_refused(self):
        self.assertIn("Markdown only", self.error("add_lesson_content", {**LESSON_ARGS, "body_markdown": "<b>x</b>"}))
        self.assertIn("uploaded file", self.error("add_lesson_content", {**LESSON_ARGS, "component_id": "RD2"}))
        self.assertIn("choose a reading component", self.error("add_lesson_content", {**LESSON_ARGS, "component_id": "V1"}))
        self.assertEqual(self.writes, [])

    def test_edit_elsewhere_in_the_module_does_not_block_the_save(self):
        preview_id = self.preview("add_lesson_content", LESSON_ARGS)["preview_id"]
        self.module["weekStructure"][0]["components"][2]["title"] = "Renamed in the Module Builder"
        result = self.apply(preview_id)
        # Another component changed, not this one: the save uses the module's current revision.
        self.assertFalse(result.get("isError"), result)


class MarkdownTests(SimpleTestCase):
    def test_everything_is_escaped_and_only_fixed_tags_are_emitted(self):
        html = markdown_to_html('Use <script>alert(1)</script> & "quotes" [x](javascript:alert(1))')
        self.assertEqual(html, "<p>Use &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot; "
                               "[x](javascript:alert(1))</p>")

    def test_supported_markdown(self):
        source = "## Title\nline one\nline two\n\n1. first\n2. *second*\n\n> quoted\n\n[LMS](https://lms.example/a?b=1&c=2) `x<y`"
        self.assertEqual(markdown_to_html(source),
                         "<h3>Title</h3><p>line one<br>line two</p><ol><li>first</li><li><em>second</em></li></ol>"
                         "<blockquote><p>quoted</p></blockquote>"
                         '<p><a href="https://lms.example/a?b=1&amp;c=2" rel="noopener noreferrer">LMS</a> '
                         "<code>x&lt;y</code></p>")

    def test_link_url_cannot_break_out_of_the_attribute(self):
        html = markdown_to_html('[a](https://x.example/"onmouseover=alert(1))')
        self.assertNotIn('"onmouseover', html)


class UpdateComponentTests(ContentTestCase):
    def setUp(self):
        super().setUp()
        self.component("RD1").update({"description": "Old", "expectedOtjh": 2.0, "points": 10})

    def test_only_given_fields_change_and_duration_is_preserved(self):
        args = {"programme_id": "PROG-1", "module_id": "M1", "component_id": "RD1", "title": "Marketing reading",
                "points": 15}
        data = self.preview("update_component", args)
        self.assertIn("title: 'Reading Material' → 'Marketing reading'", data["summary"])
        result = self.apply(data["preview_id"])
        self.assertFalse(result.get("isError"), result)
        (_, path, body), = self.writes
        self.assertEqual(path, "/curriculum_api/curriculum/components/RD1/")
        self.assertEqual({k: body[k] for k in ("title", "points", "duration")},
                         {"title": "Marketing reading", "points": 15, "duration": 0})
        self.assertNotIn("description", body)
        self.assertEqual(self.component("RD1")["settings"]["durationMinutes"], 0)  # not silently 120

    def test_html_duplicate_title_and_no_change_are_refused(self):
        base = {"programme_id": "PROG-1", "module_id": "M1", "component_id": "RD1"}
        self.assertIn("HTML is not allowed", self.error("update_component", {**base, "description": "<b>x</b>"}))
        self.assertIn("already called that", self.error("update_component", {**base, "title": "video"}))
        self.assertIn("nothing to change", self.error("update_component", {**base, "points": 10}))
        self.assertEqual(self.writes, [])

    def test_lesson_text_patch_also_preserves_duration(self):
        self.apply(self.preview("add_lesson_content", LESSON_ARGS)["preview_id"])
        self.assertEqual(self.writes[-1][2]["duration"], 0)
