"""save_component_file: real MCP protocol, synthetic files, temporary storage, fake LMS endpoints."""
import copy
import io
import tempfile
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from mcp_api import changes, dispatch
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tests.test_video import VideoPendingManager
from mcp_api.tools import components, content, files, quizzes, read

PDF = b"%PDF-1.7\n" + b"0" * 200
MODULE = {"catalogueId": "M1", "programmeId": "P1", "title": "Marketing", "status": "draft",
          "structureRevision": "rev-1", "weekStructure": [
              {"id": "W1", "weekNumber": 1, "title": "Week 1", "components": [
                  {"id": "RD1", "title": "Reading Material", "type": "reading", "settings": {"readingContent": ""}},
                  {"id": "PP1", "title": "Slides", "type": "powerpoint", "settings": {}},
                  {"id": "V1", "title": "Video", "type": "video", "settings": {}},
              ]}]}
FILE = {"download_url": "https://files.example.com/x?sig=1", "file_id": "f1", "file_name": "Notes.pdf"}
ARGS = {"programme_id": "P1", "module_id": "M1", "component_id": "RD1", "file": FILE}


class FileTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_FILE_UPLOADS_ENABLED": "1"}))
        self.pending = VideoPendingManager()
        fake = SimpleNamespace(objects=self.pending)
        self.enterContext(mock.patch.object(changes, "McpPendingChange", fake))
        self.enterContext(mock.patch.object(files, "McpPendingChange", fake))
        self.module, self.bytes, self.content_type = copy.deepcopy(MODULE), PDF, "application/pdf"
        self.calls, self.downloads, self.uploads = [], [], []
        self.media = Path(self.enterContext(tempfile.TemporaryDirectory()))
        for target in (read, components, content, quizzes, files):
            self.enterContext(mock.patch.object(target, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(files, "public_response", self.response))
        self.enterContext(mock.patch.object(files.upload_storage, "store", side_effect=self.store_bytes))
        self.enterContext(mock.patch.object(files.upload_storage, "delete", side_effect=self.delete_bytes))
        self.enterContext(mock.patch.object(files.upload_storage, "local_copy", side_effect=self.local_copy))
        self.enterContext(mock.patch.object(content.transaction, "atomic", mock.MagicMock()))
        self.programme = {"id": "P1", "name": "Marketing", "status": "active"}

    @contextmanager
    def response(self, url):
        self.downloads.append(url)
        yield SimpleNamespace(headers={"Content-Type": self.content_type}, read=io.BytesIO(self.bytes).read)

    def store_bytes(self, stream, relative, content_type):
        (self.media / relative).parent.mkdir(parents=True, exist_ok=True)
        (self.media / relative).write_bytes(stream.read())
        return relative

    def delete_bytes(self, relative):
        (self.media / relative).unlink(missing_ok=True)

    def local_copy(self, relative):
        path = self.media / relative
        return (path if path.is_file() else None), lambda: None

    def component(self, cid):
        return next(c for c in self.module["weekStructure"][0]["components"] if c["id"] == cid)

    def api(self, request, method, path, *, query=None, json_body=None, uploaded_file=None):
        if path.endswith("/programmes/"):
            return 200, {"results": [self.programme]}
        if method == "GET" and path.endswith("/modules/M1/structure/"):
            return 200, copy.deepcopy(self.module)
        self.calls.append((method, path, copy.deepcopy(json_body)))
        if method == "POST" and path.endswith("/upload/"):
            data = b"".join(uploaded_file.chunks())
            self.uploads.append(data)
            url = f"/curriculum_api/curriculum/uploads/M1/{path.split('/')[-3]}/{uploaded_file.name}"
            return 201, {"uploaded": True, "file": {"fileName": uploaded_file.name, "url": url, "size": len(data),
                                                    "contentType": "application/pdf"}}
        if method == "PATCH" and path.startswith("/curriculum_api/curriculum/components/"):
            self.component(path.rstrip("/").rsplit("/", 1)[-1])["settings"].update(json_body["settings"])
            self.module["structureRevision"] = "rev-2"
            return 200, {"updated": True}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, arguments, name=files.NAME):
        response = self.post(rpc("tools/call", {"name": name, "arguments": arguments}))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def error(self, arguments):
        result = self.run_tool(arguments)
        self.assertTrue(result.get("isError"), result)
        return result["content"][0]["text"]


class SaveComponentFileTests(FileTestCase):
    def test_preview_stages_privately_then_apply_uploads_and_attaches(self):
        result = self.run_tool(ARGS)
        self.assertFalse(result.get("isError"), result)
        self.assertEqual([m for m, _, _ in self.calls], [])  # nothing written at preview
        self.assertNotIn(FILE["download_url"], str(result))
        applied = self.run_tool({"preview_id": result["structuredContent"]["preview_id"]}, name="apply_change")
        self.assertFalse(applied.get("isError"), applied)
        (m1, p1, form), (m2, p2, patch) = self.calls
        self.assertEqual((m1, p1), ("POST", "/curriculum_api/curriculum/components/RD1/upload/"))
        self.assertEqual(form, {"componentType": "reading", "moduleCatalogueId": "M1"})
        self.assertEqual(self.uploads, [PDF])
        self.assertEqual(patch["expectedRevision"], "rev-1")
        self.assertEqual(patch["settings"]["readingSource"], "LMS resource")
        self.assertTrue(patch["settings"]["resourceUrl"].startswith("/curriculum_api/curriculum/uploads/"))
        self.assertEqual(patch["duration"], 0)

    def test_powerpoint_points_the_presentation_at_the_file(self):
        result = self.run_tool({**ARGS, "component_id": "PP1"})
        self.run_tool({"preview_id": result["structuredContent"]["preview_id"]}, name="apply_change")
        self.assertIn("presentationUrl", self.calls[-1][2]["settings"])

    def test_wrong_extension_wrong_bytes_and_html_pages_are_refused_before_storage(self):
        self.assertIn("accepts", self.error({**ARGS, "file": {**FILE, "file_name": "Notes.exe"}}))
        self.bytes = b"<html>sign in</html>"
        self.assertIn("do not match a .pdf file", self.error(ARGS))
        self.content_type = "text/html"
        self.assertIn("opens a web page", self.error(ARGS))
        self.assertEqual(list(self.media.rglob("*.*")), [])

    def test_video_components_and_both_or_neither_sources_are_refused(self):
        self.assertIn("save_curriculum_video", self.error({**ARGS, "component_id": "V1"}))
        self.assertIn("not both or neither", self.error({**ARGS, "file_url": "https://x.example/a.pdf"}))
        self.assertIn("not both or neither", self.error({k: v for k, v in ARGS.items() if k != "file"}))

    def test_existing_content_needs_replace_existing(self):
        self.component("RD1")["settings"]["readingContent"] = "<p>Written</p>"
        self.assertIn("replace_existing true", self.error(ARGS))
        result = self.run_tool({**ARGS, "replace_existing": True})
        self.assertIn("REPLACE", result["structuredContent"]["summary"])

    def test_pasted_link_downloads_through_the_public_fetcher(self):
        result = self.run_tool({k: v for k, v in ARGS.items() if k != "file"}
                               | {"file_url": "https://drive.google.com/file/d/abcdefghijklmnop/view", "file_name": "N.pdf"})
        self.assertFalse(result.get("isError"), result)
        self.assertIn("drive.google.com/uc?", self.downloads[0])

    def test_flag_is_default_off(self):
        with mock.patch.dict("os.environ", {"MCP_FILE_UPLOADS_ENABLED": "0"}):
            self.assertIn("file upload is not enabled", self.error(ARGS))
        self.assertEqual(self.downloads, [])

    def test_upload_endpoint_needs_a_file_and_takes_files_only_there(self):
        self.assertTrue(dispatch.is_allowed("POST", "/curriculum_api/curriculum/components/RD1/upload/"))
        self.assertFalse(dispatch.is_allowed("DELETE", "/curriculum_api/curriculum/components/RD1/"))
