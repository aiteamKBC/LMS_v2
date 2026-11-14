"""Component creation: real MCP/OAuth/preview protocol, fake DB/API writes."""
import copy
import os
import re
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import learning_storage, video_imports
from curriculum_api import views as curriculum
from mcp_api import changes, dispatch
from mcp_api.tests.test_changes import PendingManager
from mcp_api.tests.test_transport import TransportTestCase, rpc
from mcp_api.tests.test_video import VideoTestCase, FILE
from mcp_api.tools import components, read, video

ARGS = {"programme_id": "P1", "module_id": "M1", "week_id": "W1", "type": "video",
        "title": "Inspector MP4 Test"}
MODULE = {"catalogueId": "M1", "programmeId": "P1", "cohortId": "C1", "groupId": "G1",
          "title": "Marketing", "status": "draft", "weekStructure": [
              {"id": "W1", "weekNumber": 1, "title": "Week one", "components": [
                  {"id": "S1", "title": "Meeting", "type": "live-session", "settings": {"teamsEventId": "event-1"}},
                  {"id": "R1", "title": "Recording", "type": "recording-placeholder", "settings": {"recordingUrl": "https://example.com/r"}},
              ]},
              {"id": "W2", "weekNumber": 2, "title": "Week two", "components": []},
          ]}


class ComponentTestCase(TransportTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.dict("os.environ", {"MCP_COMPONENT_CREATION_ENABLED": "1"}))
        self.pending = PendingManager()
        self.enterContext(mock.patch.object(changes, "McpPendingChange", SimpleNamespace(objects=self.pending)))
        self.module = copy.deepcopy(MODULE)
        self.programme = {"id": "P1", "name": "Marketing", "status": "active"}
        self.posts = []
        self.response_override = None
        self.before_lock = lambda: None
        self.lock_depth = 0
        self.enterContext(mock.patch.object(components, "_locked_parents", side_effect=self.parents))
        self.enterContext(mock.patch.object(components, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(read, "call_api", side_effect=self.api))

    @contextmanager
    def parents(self, target):
        self.before_lock()
        self.lock_depth += 1
        try:
            yield
        finally:
            self.lock_depth -= 1

    def api(self, request, method, path, *, query=None, json_body=None):
        if path.endswith("/programmes/"):
            return 200, {"results": [self.programme]}
        if method == "GET" and path.endswith("/modules/M1/structure/"):
            self.assertEqual(query, {"skipCache": "1"})
            return 200, self.module
        if method == "POST" and path == dispatch.COMPONENT_CREATE_PATH:
            self.assertEqual(self.lock_depth, 1, "POST must hold both parent locks")
            self.posts.append(copy.deepcopy(json_body))
            if self.response_override is not None:
                if isinstance(self.response_override, Exception):
                    raise self.response_override
                return self.response_override
            created = {**json_body, "id": f"COMP-{len(self.posts)}"}
            week = next(w for w in self.module["weekStructure"] if w["id"] == created["weekId"])
            week["components"].append(created)
            return 201, {"created": True, "component": created}
        raise dispatch.DispatchError("That item doesn't exist.", 404)

    def run_tool(self, arguments=None, name=components.NAME, token=None):
        response = self.post(rpc("tools/call", {"name": name, "arguments": ARGS if arguments is None else arguments}), token=token)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["result"]

    def preview(self, **arguments):
        result = self.run_tool({**ARGS, **arguments})
        self.assertFalse(result.get("isError"), result)
        return result["structuredContent"]["preview_id"]

    def apply(self, preview_id):
        return self.run_tool({"preview_id": preview_id}, name="apply_change")

    def assert_error(self, result, text=None):
        self.assertTrue(result.get("isError"), result)
        if text:
            self.assertIn(text, result["content"][0]["text"])


class ComponentPreviewTests(ComponentTestCase):
    def test_all_ten_types_preview_without_creating_content(self):
        for type_, (hours, points, reflection, tutor) in components.DEFAULTS.items():
            with self.subTest(type=type_):
                result = self.run_tool({**ARGS, "type": type_})
                self.assertFalse(result.get("isError"), result)
                data = result["structuredContent"]
                self.assertFalse(data["saved"])
                self.assertEqual(data["details"]["expected_otjh"], hours)
                self.assertEqual(data["details"]["points"], points)
                self.assertEqual(data["details"]["reflection_required"], reflection)
                self.assertEqual(data["details"]["tutor_validation_required"], tutor)
                self.assertTrue(data["details"]["coach_validation_required"])
                self.assertEqual(data["details"]["content_status"], "Draft")
        self.assertEqual(len(components.DEFAULTS), 10)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.module, MODULE)

    def test_creation_has_its_own_default_off_flag(self):
        with mock.patch.dict("os.environ"):
            os.environ.pop("MCP_COMPONENT_CREATION_ENABLED", None)
            self.assert_error(self.run_tool(), "not enabled")
        self.assertEqual(self.pending.rows, [])

    def test_creation_does_not_require_video_or_bunny_flags(self):
        with mock.patch.dict("os.environ", {"MCP_VIDEO_UPLOADS_ENABLED": "0", "BUNNY_STREAM_ENABLED": "0"}):
            self.preview(type="reading")

    def test_learner_and_unauthenticated_accounts_cannot_create(self):
        response = self.post(rpc("tools/call", {"name": components.NAME, "arguments": ARGS}), token="")
        self.assertEqual(response.status_code, 401)
        self.staff.role = "learner"
        response = self.post(rpc("tools/call", {"name": components.NAME, "arguments": ARGS}))
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.posts, [])

    def test_removed_curriculum_grant_is_checked(self):
        self.store.accesses[self.staff.pk] = frozenset()
        response = self.post(rpc("tools/call", {"name": components.NAME, "arguments": ARGS}))
        self.assertEqual(response.status_code, 401)

    def test_teams_recordings_retired_and_unknown_types_are_refused(self):
        for type_ in ("live-session", "recording-placeholder", "workplace-evidence", "workshop", "Video", "invented"):
            with self.subTest(type=type_):
                self.assert_error(self.run_tool({**ARGS, "type": type_}))
        self.assertEqual(self.pending.rows, [])

    def test_model_cannot_supply_ids_settings_publish_or_user_identity(self):
        for key, value in (("id", "S1"), ("settings", {"teamsEventId": "x"}), ("status", "published"),
                           ("account_id", 5), ("removeMissing", True), ("ksbMappings", [])):
            with self.subTest(key=key):
                self.assert_error(self.run_tool({**ARGS, key: value}))
        self.assertEqual(self.posts, [])

    def test_invalid_fields_and_missing_ids_are_refused(self):
        for fields in ({"title": "  "}, {"title": "x" * 201}, {"points": -1}, {"points": True},
                       {"expected_otjh": -1}, {"expected_otjh": float("nan")},
                       {"module_id": "training-module-1"}, {"module_id": "../../M1"}, {"week_id": "missing"}):
            with self.subTest(fields=fields):
                self.assert_error(self.run_tool({**ARGS, **fields}))
        for key in ("programme_id", "module_id", "week_id", "type", "title"):
            self.assert_error(self.run_tool({k: v for k, v in ARGS.items() if k != key}))
        self.assertEqual(self.pending.rows, [])

    def test_other_programme_published_deleted_and_alias_destinations_are_refused(self):
        for fields in ({"programmeId": "P2"}, {"programmeId": ""}, {"status": "published"},
                       {"isProgrammeDeleted": True}, {"isDeleted": True}, {"catalogueId": "M2"}):
            with self.subTest(fields=fields):
                self.module = {**copy.deepcopy(MODULE), **fields}
                self.assert_error(self.run_tool())
        self.assertEqual(self.posts, [])

    def test_archived_programme_and_invalid_or_deleted_week_are_refused(self):
        self.programme["status"] = "archived"
        self.assert_error(self.run_tool())
        self.programme["status"] = "active"
        for fields in ({"weekNumber": 0}, {"weekNumber": True}, {"weekNumber": "1"}, {"isDeleted": True}):
            self.module = copy.deepcopy(MODULE)
            self.module["weekStructure"][0].update(fields)
            self.assert_error(self.run_tool())

    def test_duplicate_title_in_same_week_is_refused_with_existing_id(self):
        self.module["weekStructure"][0]["components"].append({"id": "EXISTING", "title": "  INSPECTOR   MP4 TEST "})
        self.assert_error(self.run_tool(), "EXISTING")
        self.assertEqual(self.pending.rows, [])

    def test_same_title_in_another_week_is_allowed(self):
        self.module["weekStructure"][1]["components"].append({"id": "OTHER", "title": ARGS["title"]})
        self.preview()


class ComponentApplyTests(ComponentTestCase):
    def test_every_type_uses_single_create_api_and_leaves_existing_content_intact(self):
        original = copy.deepcopy(self.module["weekStructure"])
        for type_ in components.DEFAULTS:
            with self.subTest(type=type_):
                result = self.apply(self.preview(type=type_, title=f"New {type_}"))
                self.assertFalse(result.get("isError"), result)
                self.assertEqual(result["structuredContent"]["result"]["type"], type_)
                body = self.posts[-1]
                self.assertNotIn("id", body)
                self.assertEqual(body["moduleCatalogueId"], "M1")
                self.assertEqual(body["weekId"], "W1")
                self.assertEqual(body["weekNumber"], 1)
                self.assertEqual(body["status"], "draft")
                self.assertEqual(body["settings"]["contentStatus"], "Draft")
                self.assertEqual(body["ksbMappings"], [])
        self.assertEqual(len(self.posts), 10)
        self.assertEqual(self.module["weekStructure"][0]["components"][:2], original[0]["components"])
        self.assertEqual(self.module["weekStructure"][1], original[1])

    def test_apply_returns_component_id_and_replay_does_not_duplicate(self):
        pid = self.preview()
        first, second = self.apply(pid), self.apply(pid)
        self.assertFalse(first.get("isError"), first)
        self.assertEqual(first["structuredContent"]["result"]["component_id"], "COMP-1")
        self.assertEqual(first["structuredContent"]["result"]["next_tool"], video.NAME)
        self.assertTrue(second["structuredContent"]["already_applied"])
        self.assertEqual(len(self.posts), 1)

    def test_explicit_hours_points_and_description_are_preserved_in_preview_and_save(self):
        pid = self.preview(type="reading", expected_otjh=0, points=0, description="Read **this**.")
        self.apply(pid)
        self.assertEqual(self.posts[0]["expectedOtjh"], 0)
        self.assertEqual(self.posts[0]["expected_otjh"], 0)
        self.assertEqual(self.posts[0]["points"], 0)
        self.assertEqual(self.posts[0]["description"], "Read **this**.")

    def test_parent_or_scope_change_after_preview_refuses_before_post(self):
        for mutate in (
            lambda: self.module.update(status="published"),
            lambda: self.module.update(programmeId="P2"),
            lambda: self.module.update(groupId="G2"),
            lambda: self.module.update(title="Renamed"),
            lambda: self.module["weekStructure"].clear(),
            lambda: self.module["weekStructure"][0].update(weekNumber=2),
        ):
            self.module = copy.deepcopy(MODULE)
            pid = self.preview()
            mutate()
            self.assert_error(self.apply(pid))
        self.assertEqual(self.posts, [])

    def test_flag_disabled_after_preview_refuses(self):
        pid = self.preview()
        with mock.patch.dict("os.environ", {"MCP_COMPONENT_CREATION_ENABLED": "0"}):
            self.assert_error(self.apply(pid), "not enabled")
        self.assertEqual(self.posts, [])

    def test_two_previews_for_same_title_only_create_once(self):
        first, second = self.preview(), self.preview()
        self.assertFalse(self.apply(first).get("isError"))
        self.assert_error(self.apply(second), "already exists")
        self.assertEqual(len(self.posts), 1)

    def test_duplicate_created_while_waiting_for_parent_lock_is_rechecked(self):
        pid = self.preview()
        self.before_lock = lambda: self.module["weekStructure"][0]["components"].append({"id": "CONCURRENT", "title": ARGS["title"]})
        self.assert_error(self.apply(pid), "already exists")
        self.assertEqual(self.posts, [])

    def test_changed_backend_defaults_require_a_new_preview(self):
        pid = self.preview()
        defaults = {**curriculum.COMPONENT_SETTINGS_SCHEMA["video"], "version": "0.2"}
        with mock.patch.dict(curriculum.COMPONENT_SETTINGS_SCHEMA, {"video": defaults}):
            self.assert_error(self.apply(pid), "different from the preview")
        self.assertEqual(self.posts, [])

    def test_cancelled_preview_does_not_create(self):
        pid = self.preview()
        self.run_tool({"preview_id": pid}, name="cancel_change")
        self.assert_error(self.apply(pid), "cancelled")
        self.assertEqual(self.posts, [])

    def test_malformed_or_wrong_destination_response_never_reports_success_or_retries(self):
        body = components._body({**ARGS, "description": "", "target": {
            "module_id": "M1", "module_title": "Marketing", "programme_name": "Marketing",
            "week_id": "W1", "week_number": 1,
        }})
        for response in ((201, None), (200, {"created": True}), (201, {"created": True, "component": {
                "id": "COMP-1", "moduleCatalogueId": "OTHER", "weekId": "W1", "type": "video", "status": "draft"}}),
                (201, {"created": True, "component": {**body, "id": "COMP-1", "settings": {
                    **body["settings"], "contentStatus": "Approved"}}})):
            with self.subTest(response=response):
                pid = self.preview()
                self.response_override = response
                self.assert_error(self.apply(pid), "outcome could not be confirmed")
                count = len(self.posts)
                self.assert_error(self.apply(pid), "already attempted")
                self.assertEqual(len(self.posts), count)
                row = self.pending.filter(pk=uuid.UUID(pid)).first()
                self.assertEqual(row.result["status"], "unknown")


class ComponentContractTests(SimpleTestCase):
    def test_defaults_follow_module_builder_and_exclude_teams_recordings_and_retired_types(self):
        source = (Path(__file__).resolve().parents[3] / "frontend/src/pages/curriculum/module-builder/componentAuthoringModel.ts").read_text(encoding="utf-8")
        definitions = re.split(r"\n    type: '([^']+)',", source)[1:]
        actual = {}
        for type_, text in zip(definitions[::2], definitions[1::2]):
            if type_ in {"live-session", "recording-placeholder"}:
                continue
            actual[type_] = (
                float(re.search(r"defaultOtjh: ([\d.]+)", text)[1]),
                int(re.search(r"defaultPoints: (\d+)", text)[1]),
                re.search(r"reflectionDefault: (true|false)", text)[1] == "true",
                re.search(r"tutorValidationDefault: (true|false)", text)[1] == "true",
            )
        self.assertEqual(components.DEFAULTS, actual)

    def test_real_component_save_contract_preserves_zero_hours_and_never_upserts_parents(self):
        module = {"module_catalogue_id": "M1", "title": "Marketing", "programme_name": "Marketing"}
        week = {"id": "W1", "module_catalogue_id": "M1", "week_number": 1}
        rows = {curriculum.AUTHORING_MODULES_TABLE: [module], curriculum.AUTHORING_WEEKS_TABLE: [week],
                curriculum.AUTHORING_COMPONENTS_TABLE: [], curriculum.AUTHORING_KSB_MAPPINGS_TABLE: []}

        def fetch(table, where="", params=None, *args, **kwargs):
            found = rows[table]
            if where:
                keys = [part.strip().split()[0] for part in where.split(" and ")]
                found = [r for r in found if all(r.get(k) == v for k, v in zip(keys, params))]
            return copy.deepcopy(found)

        def upsert(table, keys, row, **kwargs):
            self.assertEqual(table, curriculum.AUTHORING_COMPONENTS_TABLE, "must not create or update a parent")
            rows[table].append(copy.deepcopy(row))

        payload = {**ARGS, "description": "", "target": {"module_id": "M1", "module_title": "Marketing",
                   "programme_name": "Marketing", "week_id": "W1", "week_number": 1}}
        with mock.patch.object(curriculum, "ensure_module_authoring_tables"), \
                mock.patch.object(curriculum, "authoring_fetch_all", side_effect=fetch), \
                mock.patch.object(curriculum, "authoring_upsert", side_effect=upsert) as write, \
                mock.patch.object(curriculum, "authoring_soft_delete"), \
                mock.patch.object(curriculum, "authoring_bulk_upsert"), \
                mock.patch.object(curriculum, "invalidate_curriculum_cache"), \
                mock.patch.object(curriculum.transaction, "atomic", mock.MagicMock()), \
                mock.patch.object(dispatch, "refusal_for", return_value=None) as gate, \
                mock.patch.object(video_imports, "enabled", return_value=False):
            account = SimpleNamespace(pk=5, role="staff")
            for type_, (hours, points, reflection, tutor) in components.DEFAULTS.items():
                with self.subTest(type=type_):
                    body = components._body({**payload, "type": type_})
                    status, data = dispatch.call_api(SimpleNamespace(login_account=account), "POST",
                                                     dispatch.COMPONENT_CREATE_PATH, json_body=body)
                    self.assertEqual(status, 201)
                    # The exact check apply runs: every sent setting must come back.
                    self.assertIsNotNone(components.confirmed_component(status, data, body), data)
                    created = data["component"]
                    self.assertEqual(created["expectedOtjh"], hours)
                    self.assertEqual(created["points"], points)
                    self.assertEqual(created["type"], type_)
                    self.assertEqual(created["reflectionRequired"], reflection)
                    self.assertEqual(created["tutorValidationRequired"], tutor)
                    self.assertEqual(created["weekId"], "W1")
                    self.assertEqual(created["moduleCatalogueId"], "M1")
                    self.assertEqual(created["status"], "draft")
            gate.assert_called_with(dispatch.COMPONENT_CREATE_PATH, account, method="POST")
        self.assertEqual(write.call_count, 10)

    def test_parent_locks_use_default_database_and_exact_ids_before_yielding(self):
        connection = mock.MagicMock()
        connection.features.has_select_for_update = True
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        target = {"module_id": "M1", "week_id": "W1", "week_number": 3}
        with mock.patch.object(components, "connection", connection), \
                mock.patch.object(components.transaction, "atomic", mock.MagicMock()) as atomic, \
                mock.patch.object(curriculum, "authoring_table_name", side_effect=lambda t: f'"curriculum"."{t}"'):
            with components._locked_parents(target):
                self.assertEqual(cursor.execute.call_count, 2)
            atomic.assert_called_once_with(using="default")
            calls = cursor.execute.call_args_list
            self.assertEqual(calls[0].args[1], ["M1"])
            self.assertEqual(calls[1].args[1], ["W1", "M1", 3])
            for call in calls:
                self.assertIn("FOR UPDATE", call.args[0])
                self.assertTrue(call.args[0].startswith("SELECT"))
            cursor.fetchone.side_effect = [None]
            with self.assertRaisesRegex(components.ToolError, "no longer exists"):
                with components._locked_parents(target):
                    self.fail("must not reach creation when a parent disappeared")

    def test_free_course_parent_locks_use_native_course_storage(self):
        connection = mock.MagicMock()
        connection.features.has_select_for_update = True
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1,)
        target = {"module_id": "FC1", "week_id": "W1", "week_number": 3}
        with mock.patch.object(components, "connection", connection), \
                mock.patch.object(components.transaction, "atomic", mock.MagicMock()), \
                mock.patch.object(learning_storage, "course", return_value={"id": "FC-ROW"}) as course:
            with components._locked_parents(target):
                pass
            course.assert_called_once_with("FC1", lock=True)
            (call,) = cursor.execute.call_args_list
            self.assertIn("curriculum.free_course_weeks", call.args[0])
            self.assertIn("FOR UPDATE", call.args[0])
            self.assertEqual(call.args[1], ["W1", "FC-ROW", 3])
            cursor.fetchone.return_value = None
            with self.assertRaisesRegex(components.ToolError, "no longer exists"):
                with components._locked_parents(target):
                    self.fail("must not reach creation when the free-course week disappeared")

    def test_dispatcher_allows_single_component_writes_but_no_module_save_or_delete(self):
        self.assertTrue(dispatch.is_allowed("POST", dispatch.COMPONENT_CREATE_PATH))
        # Step 7 links a quiz through the single-component PATCH (revision-checked by the LMS).
        self.assertTrue(dispatch.is_allowed("PATCH", "/curriculum_api/curriculum/components/C1/"))
        for method, path in (("PUT", dispatch.COMPONENT_CREATE_PATH),
                             ("DELETE", "/curriculum_api/curriculum/components/C1/"),
                             ("PATCH", "/curriculum_api/curriculum/modules/M1/structure/"),
                             ("DELETE", "/curriculum_api/curriculum/modules/M1/weeks/W1/"),
                             ("DELETE", "/quiz_api/quizzes/1/"),
                             ("PATCH", "/curriculum_api/curriculum/modules/M1/")):
            self.assertFalse(dispatch.is_allowed(method, path))


class ComponentVideoHandoffTests(VideoTestCase):
    def test_create_then_upload_uses_returned_component_id(self):
        self.enterContext(mock.patch.dict("os.environ", {"MCP_COMPONENT_CREATION_ENABLED": "1"}))
        self.module["catalogueId"] = "M1"
        self.module["weekStructure"][0]["weekNumber"] = 1

        def api(request, method, path, **kwargs):
            if method == "POST" and path == dispatch.COMPONENT_CREATE_PATH:
                created = {**kwargs["json_body"], "id": "V2"}
                self.module["weekStructure"][0]["components"].append(created)
                return 201, {"created": True, "component": created}
            if method == "POST" and path.endswith("/videos/module/M1/V2/"):
                self.component = self.module["weekStructure"][0]["components"][-1]
                status, data = self.api(request, method, path.replace("/V2/", "/V1/"), **kwargs)
                data["savedSettings"]["videoUrl"] = data["savedSettings"]["videoUrl"].replace("/V1/", "/V2/")
                return status, data
            return self.api(request, method, path, **kwargs)

        self.enterContext(mock.patch.object(components, "_locked_parents", mock.MagicMock()))
        self.enterContext(mock.patch.object(components, "call_api", side_effect=api))
        self.enterContext(mock.patch.object(video, "call_api", side_effect=api))
        creation = self.run_tool(components.NAME, ARGS)["structuredContent"]
        created = self.apply(creation["preview_id"])
        self.assertFalse(created.get("isError"), created)
        component_id = created["structuredContent"]["result"]["component_id"]
        self.assertEqual(component_id, "V2")
        upload = self.run_tool(video.NAME, {"programme_id": "P1", "module_id": "M1", "component_id": component_id, "file": FILE})
        self.assertFalse(upload.get("isError"), upload)
        saved = self.apply(upload["structuredContent"]["preview_id"])
        self.assertFalse(saved.get("isError"), saved)
        self.assertEqual(self.post_count, 1)


class LiveModuleWarningTests(ComponentTestCase):
    def test_a_module_on_learner_plans_is_flagged_live_but_not_blocked(self):
        self.live_learners.return_value = 91
        result = self.run_tool()
        self.assertFalse(result.get("isError"), result)
        warning = result["structuredContent"]["warnings"][0]
        self.assertIn("LIVE MODULE: 91 learner(s)", warning)
        self.assertIn("LIVE MODULE", result["content"][0]["text"])
        self.live_learners.assert_called_with("M1")

    def test_an_unreadable_count_is_treated_as_live(self):
        self.live_learners.return_value = None
        result = self.run_tool()
        self.assertIn("treat it as live", result["structuredContent"]["warnings"][0])

    def test_no_learners_no_warning(self):
        self.assertEqual(self.run_tool()["structuredContent"]["warnings"], [])
