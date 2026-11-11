"""Week listing and templated week creation: real MCP/OAuth/preview protocol, fake DB/API writes."""
import copy
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import video_imports
from curriculum_api import views as curriculum
from mcp_api import dispatch
from mcp_api.tests.test_components import ComponentTestCase, MODULE
from mcp_api.tools import components, weeks

ARGS = {"programme_id": "P1", "module_id": "M1"}
#: Captured before WeekTestCase patches it, for the lock's own test.
REAL_LOCK = weeks._locked_new_week
TEMPLATE_TYPES = ["live-session", "recording-placeholder", "reading", "video", "reflection"]


class WeekTestCase(ComponentTestCase):
    def setUp(self):
        super().setUp()
        self.enterContext(mock.patch.object(weeks, "call_api", side_effect=self.api))
        self.enterContext(mock.patch.object(weeks, "_locked_new_week", side_effect=self.parents))
        self.fail_on_post = None

    def api(self, request, method, path, *, query=None, json_body=None):
        if method == "POST" and path == dispatch.COMPONENT_CREATE_PATH:
            if self.fail_on_post == len(self.posts) + 1:
                self.posts.append(copy.deepcopy(json_body))
                return 201, {"created": True, "component": {"id": "", "title": json_body["title"]}}
            structure = self.module["weekStructure"]
            if not any(w["id"] == json_body["weekId"] for w in structure):
                # component_context_for_payload creates the week row for a new number.
                structure.append({"id": json_body["weekId"], "weekNumber": json_body["weekNumber"],
                                  "title": f"Week {json_body['weekNumber']}", "components": []})
        return super().api(request, method, path, query=query, json_body=json_body)

    def run_week(self, arguments=None, name=weeks.NAME):
        return self.run_tool(ARGS if arguments is None else arguments, name=name)


class ListModuleWeeksTests(WeekTestCase):
    def test_lists_weeks_in_order_with_component_counts_and_writes_nothing(self):
        self.module["weekStructure"].append({"id": "W9", "weekNumber": 9, "title": "Gone", "isDeleted": True,
                                             "components": []})
        result = self.run_week({"module_id": "M1"}, name="list_module_weeks")
        self.assertFalse(result.get("isError"), result)
        data = result["structuredContent"]
        self.assertEqual([w["week_id"] for w in data["weeks"]], ["W1", "W2"])
        self.assertEqual(data["weeks"][0]["component_types"], {"live-session": 1, "recording-placeholder": 1})
        self.assertEqual(data["weeks"][1]["component_count"], 0)
        self.assertEqual(self.posts, [])

    def test_legacy_training_module_alias_is_refused_without_reading(self):
        result = self.run_week({"module_id": "training-module-7"}, name="list_module_weeks")
        self.assert_error(result, "find_modules")


class CreateWeekPreviewTests(WeekTestCase):
    def test_preview_shows_next_week_and_template_without_creating(self):
        before = copy.deepcopy(self.module)
        result = self.run_week()
        self.assertFalse(result.get("isError"), result)
        details = result["structuredContent"]["details"]
        self.assertEqual(details["week_number"], 3)
        self.assertEqual([c["type"] for c in details["components"]], TEMPLATE_TYPES)
        self.assertEqual(details["components"][0]["title"], "Live Teams Session")
        self.assertEqual(details["components"][1]["points"], 0)
        self.assertEqual(self.posts, [])
        self.assertEqual(self.module, before)

    def test_template_bodies_pass_the_lms_component_validation(self):
        result = self.run_week()
        self.assertFalse(result.get("isError"), result)
        row = self.pending.rows[0]
        for body in row.payload["bodies"]:
            self.assertEqual(curriculum.validate_component_authoring_payload(body, "component"), [])
            self.assertEqual(body["status"], "draft")
            self.assertEqual(body["settings"].get("teamsEventId", ""), "")

    def test_flag_off_published_module_and_other_programme_are_refused(self):
        with mock.patch.dict("os.environ", {"MCP_COMPONENT_CREATION_ENABLED": "0"}):
            self.assert_error(self.run_week(), "not enabled")
        self.module["status"] = "published"
        self.assert_error(self.run_week(), "draft module")
        self.module["status"] = "draft"
        self.module["programmeId"] = "P2"
        self.assert_error(self.run_week(), "does not belong")
        self.assertEqual(self.posts, [])

    def test_model_cannot_choose_the_week_id_or_number(self):
        for extra in ({"week_id": "WEEK-MCPX"}, {"week_number": 1}):
            self.assertTrue(self.run_week({**ARGS, **extra}).get("isError"))
        self.assertEqual(self.pending.rows, [])


class CreateWeekApplyTests(WeekTestCase):
    def test_apply_creates_the_week_with_all_template_components_and_links_the_recording(self):
        preview_id = self.preview_week()
        result = self.apply(preview_id)
        self.assertFalse(result.get("isError"), result)
        self.assertEqual([p["type"] for p in self.posts], TEMPLATE_TYPES)
        week_ids = {p["weekId"] for p in self.posts}
        self.assertEqual(len(week_ids), 1)
        self.assertRegex(week_ids.pop(), weeks.WEEK_ID_PATTERN)
        self.assertEqual({p["weekNumber"] for p in self.posts}, {3})
        live_id = "COMP-1"
        self.assertEqual(self.posts[1]["settings"]["linkedLiveSessionComponentId"], live_id)
        self.assertEqual(self.posts[1]["settings"]["linkedLiveSessionModuleId"], "M1")
        data = result["structuredContent"]["result"]
        self.assertEqual(data["week_number"], 3)
        self.assertEqual([c["component_id"] for c in data["components"]], [f"COMP-{i}" for i in range(1, 6)])
        # Existing weeks are untouched.
        self.assertEqual(self.module["weekStructure"][:2], MODULE["weekStructure"])

    def test_replay_does_not_create_a_second_week(self):
        preview_id = self.preview_week()
        first = self.apply(preview_id)
        second = self.apply(preview_id)
        self.assertFalse(second.get("isError"), second)
        self.assertEqual(len(self.posts), 5)
        self.assertEqual(first["structuredContent"]["result"], second["structuredContent"]["result"])

    def test_week_added_after_preview_requires_a_new_preview(self):
        preview_id = self.preview_week()
        self.module["weekStructure"].append({"id": "W3", "weekNumber": 3, "title": "Week 3", "components": []})
        self.assert_error(self.apply(preview_id), "prepare it again")
        self.assertEqual(self.posts, [])

    def test_two_previews_only_create_one_week(self):
        first, second = self.preview_week(), self.preview_week()
        self.assertFalse(self.apply(first).get("isError"))
        self.assert_error(self.apply(second), "prepare it again")
        self.assertEqual(len(self.posts), 5)

    def test_unconfirmed_component_reports_rollback_and_is_not_retried(self):
        self.fail_on_post = 3
        preview_id = self.preview_week()
        result = self.apply(preview_id)
        self.assert_error(result, "nothing was saved")
        self.assertNotIn("may have been saved", result["content"][0]["text"])
        self.assertEqual(len(self.posts), 3)
        self.assertTrue(self.apply(preview_id).get("isError"))
        self.assertEqual(len(self.posts), 3)

    def preview_week(self):
        result = self.run_week()
        self.assertFalse(result.get("isError"), result)
        return result["structuredContent"]["preview_id"]


class CreateWeekLockTests(WeekTestCase):
    def test_lock_holds_the_module_and_refuses_a_number_used_by_any_week(self):
        connection = mock.MagicMock()
        connection.features.has_select_for_update = True
        cursor = connection.cursor.return_value.__enter__.return_value
        target = {"module_id": "M1", "week_id": "WEEK-MCP1", "week_number": 3}
        with mock.patch.object(weeks, "connection", connection), \
                mock.patch.object(weeks.transaction, "atomic", mock.MagicMock()) as atomic, \
                mock.patch.object(curriculum, "authoring_table_name", side_effect=lambda t: f'"curriculum"."{t}"'):
            cursor.fetchone.side_effect = [(1,), None]
            with REAL_LOCK(target):
                pass
            atomic.assert_called_with(using="default")
            calls = cursor.execute.call_args_list
            self.assertIn("FOR UPDATE", calls[0].args[0])
            self.assertEqual(calls[1].args[1], ["M1", 3, "WEEK-MCP1"])
            self.assertNotIn("deleted", calls[1].args[0].lower())
            cursor.fetchone.side_effect = [(1,), (1,)]
            with self.assertRaisesRegex(weeks.ToolError, "already used"):
                with REAL_LOCK(target):
                    self.fail("must not create when the week number is taken")
            cursor.fetchone.side_effect = [None]
            with self.assertRaisesRegex(weeks.ToolError, "no longer exists"):
                with REAL_LOCK(target):
                    self.fail("must not create when the module disappeared")


class CreateWeekRealSaveContractTests(SimpleTestCase):
    """The template bodies through the real component API/service, with fake tables."""

    def test_every_template_component_is_confirmed_by_the_real_save(self):
        module = {"module_catalogue_id": "M1", "title": "Marketing", "programme_name": "Marketing"}
        rows = {curriculum.AUTHORING_MODULES_TABLE: [module], curriculum.AUTHORING_WEEKS_TABLE: [],
                curriculum.AUTHORING_COMPONENTS_TABLE: [], curriculum.AUTHORING_KSB_MAPPINGS_TABLE: []}

        def fetch(table, where="", params=None, *args, **kwargs):
            found = rows[table]
            if where:
                keys = [part.strip().split()[0] for part in where.split(" and ")]
                found = [r for r in found if all(r.get(k) == v for k, v in zip(keys, params))]
            return copy.deepcopy(found)

        def upsert(table, keys, row, **kwargs):
            self.assertNotEqual(table, curriculum.AUTHORING_MODULES_TABLE, "must not create or update the module")
            rows[table].append(copy.deepcopy(row))

        target = {"programme_id": "P1", "programme_name": "Marketing", "module_id": "M1",
                  "module_title": "Marketing", "week_id": "WEEK-MCP1", "week_number": 3}
        with mock.patch.object(curriculum, "ensure_module_authoring_tables"), \
                mock.patch.object(curriculum, "authoring_fetch_all", side_effect=fetch), \
                mock.patch.object(curriculum, "authoring_upsert", side_effect=upsert), \
                mock.patch.object(curriculum, "authoring_soft_delete"), \
                mock.patch.object(curriculum, "authoring_bulk_upsert"), \
                mock.patch.object(curriculum, "invalidate_curriculum_cache"), \
                mock.patch.object(curriculum.transaction, "atomic", mock.MagicMock()), \
                mock.patch.object(dispatch, "refusal_for", return_value=None), \
                mock.patch.object(video_imports, "enabled", return_value=False):
            request = SimpleNamespace(login_account=SimpleNamespace(pk=5, role="staff"))
            live_id = None
            for type_, title, description, defaults in weeks.TEMPLATE:
                with self.subTest(type=type_):
                    body = components.component_body(target, type_, title, description, defaults)
                    if type_ == "recording-placeholder":
                        body["settings"] = {**body["settings"], "linkedLiveSessionComponentId": live_id,
                                            "linkedLiveSessionModuleId": "M1"}
                    status, data = dispatch.call_api(request, "POST", dispatch.COMPONENT_CREATE_PATH, json_body=body)
                    created = components.confirmed_component(status, data, body)
                    self.assertIsNotNone(created, data)
                    self.assertEqual(created["weekId"], "WEEK-MCP1")
                    live_id = live_id or created["id"]
        weeks_rows = rows[curriculum.AUTHORING_WEEKS_TABLE]
        self.assertEqual([(w["id"], w["week_number"]) for w in weeks_rows], [("WEEK-MCP1", 3)])
