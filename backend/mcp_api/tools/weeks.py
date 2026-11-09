"""Create one new week at the end of a draft module, filled with the standard week template.

There is no single-week endpoint: the component API creates the week row when it
is given a week number that has none (``component_context_for_payload``). So the
week is made by posting its first template component with a new week id and the
next week number, then the rest with that id. The module structure save is not
used -- it would also rewrite Teams settings, existing components and KSB mappings.

All posts run in one default-DB transaction under a module row lock, so a failure
part-way rolls the whole week back and two applies cannot both take a number.
The live session is an empty draft: no Teams meeting is booked here.
"""
from __future__ import annotations

import re
import uuid
from contextlib import contextmanager
from urllib.parse import urlencode

from django.db import connection, transaction
from django.utils import timezone

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import COMPONENT_CREATE_PATH, DispatchError, call_api
from ..settings import public_base_url
from . import ToolError
from .components import DEFAULTS, ID, component_body, confirmed_component, draft_module

NAME = "create_week"
WEEK_ID_PATTERN = r"WEEK-MCP[0-9A-F]{26}"

# (type, title, description, (hours, points, reflection required, tutor validation required)).
# Titles, descriptions and defaults follow the Module Builder's createNamedComponent and
# componentAuthoringModel.ts; the recording mirrors prepareLinkedRecording.
TEMPLATE = (
    ("live-session", "Live Teams Session", "Tutor-led session via Teams", (2, 10, False, False)),
    ("recording-placeholder", "Session Recording", "", (0, 0, False, False)),
    ("reading", "Reading Material", "PDF, Word, or typed text", DEFAULTS["reading"]),
    ("video", "Video", "Upload or link a video", DEFAULTS["video"]),
    ("reflection", "Reflection", "Learner written reflection", DEFAULTS["reflection"]),
)


def _new_week_id():
    return f"WEEK-MCP{timezone.now():%Y%m%d%H%M%S}{uuid.uuid4().hex[:12].upper()}"


@contextmanager
def _locked_new_week(target):
    """Hold the module row and refuse if the new week's number or id is taken, even by a deleted week.

    The component API looks weeks up by number without excluding deleted rows, so
    reusing a deleted week's number would attach the components to that deleted week.
    """
    from curriculum_api.views import AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE, authoring_table_name

    if not connection.features.has_select_for_update:
        raise ToolError("Week creation requires a database supporting row locks.")
    with transaction.atomic(using="default"):
        with connection.cursor() as cursor:
            cursor.execute(f"SELECT 1 FROM {authoring_table_name(AUTHORING_MODULES_TABLE)} "
                           "WHERE module_catalogue_id = %s FOR UPDATE", [target["module_id"]])
            if cursor.fetchone() is None:
                raise ToolError("The module no longer exists. Look it up again.")
            cursor.execute(f"SELECT 1 FROM {authoring_table_name(AUTHORING_WEEKS_TABLE)} "
                           "WHERE (module_catalogue_id = %s AND week_number = %s) OR id = %s",
                           [target["module_id"], target["week_number"], target["week_id"]])
            if cursor.fetchone() is not None:
                raise ToolError(f"Week {target['week_number']} is already used in this module, possibly by a "
                                "deleted week. Add or restore that week in the LMS instead.")
        yield


class CreateWeek(WriteTool):
    name = NAME
    description = (
        "Preview adding one new week at the end of an existing draft module, pre-filled with the standard week "
        "template: Live Teams Session, Session Recording (linked to that session), Reading Material, Video and "
        "Reflection, all as empty drafts. No Teams meeting is booked and nothing is published; staff fill in the "
        "session date, Teams link and content in the LMS. Use list_module_weeks first. After confirmation use "
        "apply_change; it returns the new week_id and each component_id (pass the video's id to "
        "save_curriculum_video)."
    )
    input_schema = {"type": "object", "properties": {"programme_id": ID, "module_id": ID},
                    "required": ["programme_id", "module_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        from curriculum_api.views import validate_component_authoring_payload

        programme, module = draft_module(request, arguments)
        week_id = arguments.get("week_id") or _new_week_id()
        if not isinstance(week_id, str) or not re.fullmatch(WEEK_ID_PATTERN, week_id):
            raise ToolError("The prepared week id is invalid. Prepare a new preview.")
        numbers = [w.get("weekNumber") for w in module.get("weekStructure") or []]
        if any(isinstance(n, bool) or not isinstance(n, int) or n < 1 for n in numbers):
            raise ToolError("A week in this module has no valid week number. Correct it in the LMS first.")
        module_id = str(module.get("catalogueId") or module.get("moduleCatalogueId"))
        target = {
            "programme_id": str(module["programmeId"]), "programme_name": programme.get("name") or "",
            "module_id": module_id, "module_title": module.get("title") or "",
            "week_id": week_id, "week_number": max(numbers, default=0) + 1,
        }
        bodies = [component_body(target, type_, title, description, defaults)
                  for type_, title, description, defaults in TEMPLATE]
        errors = [error["message"] for body in bodies
                  for error in validate_component_authoring_payload(body, "component")]
        return Validation({"programme_id": str(arguments["programme_id"]).strip(), "module_id": module_id,
                           "week_id": week_id, "target": target, "bodies": bodies}, errors)

    def preview(self, request, payload):
        target = payload["target"]
        return {
            "summary": f"Add Week {target['week_number']} to {target['module_title']} with "
                       f"{len(payload['bodies'])} draft components.",
            "details": {
                **target, "week_title": f"Week {target['week_number']}",
                "components": [{"type": b["type"], "title": b["title"], "expected_otjh": b["expectedOtjh"],
                                "points": b["points"]} for b in payload["bodies"]],
                "content_note": "Empty drafts. The live session books no Teams meeting; the recording is linked "
                                "to it. Rename the week and fill in content in the LMS. Nothing is published.",
            },
        }

    def apply(self, request, payload, progress):
        target = payload["target"]
        created = []
        progress.uncertain(f"Creating Week {target['week_number']}; check the module's weeks before trying again.")
        try:
            with _locked_new_week(target):
                recheck = self.validate(request, payload)
                if recheck.errors or recheck.payload != payload:
                    raise ToolError("The module changed since the preview. Prepare a new preview.")
                for body in payload["bodies"]:
                    if body["type"] == "recording-placeholder":
                        body = {**body, "settings": {**body["settings"],
                                                     "linkedLiveSessionComponentId": created[0][2],
                                                     "linkedLiveSessionModuleId": target["module_id"]}}
                    status, data = call_api(request, "POST", COMPONENT_CREATE_PATH, json_body=body)
                    component = confirmed_component(status, data, body)
                    if component is None:
                        raise ToolError(f"The LMS did not confirm '{body['title']}', so the whole new week was "
                                        "rolled back and nothing was saved. Prepare a new preview.")
                    created.append((body["type"], body["title"], str(component["id"])))
        except (ToolError, DispatchError):
            # Raised inside the transaction, so it rolled back: nothing was saved.
            # Only a failure at commit (any other error) leaves the outcome uncertain.
            progress.uncertain_steps.clear()
            raise
        progress.uncertain_steps.clear()
        for type_, title, component_id in created:
            progress.done(f"Created draft {type_} '{title}'", component_id=component_id)
        return {
            "summary": f"Added Week {target['week_number']} to {target['module_title']} with "
                       f"{len(created)} draft components.",
            "result": {"week_id": target["week_id"], "week_number": target["week_number"],
                       "module_id": target["module_id"], "programme_id": target["programme_id"],
                       "components": [{"type": t, "title": n, "component_id": c} for t, n, c in created],
                       "content_status": "Draft"},
            "links": [f"{public_base_url()}/curriculum/module-builder?{urlencode({'module': target['module_id']})}"],
        }


register_write_tool(CreateWeek())
