"""Create one typed draft through the component API, without provisioning parents.

Only the selected component is posted. Full module saves would also affect Teams,
existing components and KSB mappings, so they are deliberately not used here.
"""
from __future__ import annotations

import math
import re
from contextlib import contextmanager

from django.db import connection, transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import COMPONENT_CREATE_PATH, call_api
from ..settings import component_creation_enabled
from . import ToolError
from .read import CURRICULUM, _archived, _programme_by_id

NAME = "create_curriculum_component"
ID = {"type": "string", "minLength": 1, "maxLength": 200}

# Module Builder createEmptyComponent/getComponentDefinition defaults. Keep in
# step with componentAuthoringModel.ts; the contract test checks these values.
# hours, points, reflection required, tutor validation required
DEFAULTS = {
    "video": (0, 10, False, False),
    "podcast": (2, 10, False, False),
    "reading": (2, 10, False, False),
    "powerpoint": (2, 5, False, False),
    "quiz": (2, 20, False, False),
    "assignment": (2, 20, False, True),
    "reflection": (0.5, 15, True, True),
    "checkpoint": (2, 20, False, False),
    "monthly-ksb-quiz": (2, 20, False, False),
    "coaching-preparation": (0.5, 10, True, True),
}


def _id(value):
    value = str(value or "").strip()
    if not re.fullmatch(r"[\w-]+", value, re.ASCII) or value.startswith("training-module-"):
        raise ToolError("Look up the saved programme, module and week ids first; do not use training-module aliases.")
    return value


def _title_key(value):
    return " ".join(str(value or "").split()).casefold()


def draft_module(request, arguments):
    """The flag-checked ``(programme, module)`` for a draft module of that programme, read without cache."""
    if not component_creation_enabled():
        raise ToolError("MCP component creation is not enabled. Ask an administrator to enable the component pilot.")
    module_id = _id(arguments.get("module_id"))
    programme = _programme_by_id(request, _id(arguments.get("programme_id")))
    if _archived(programme):
        raise ToolError("Choose an active programme.")
    _, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/", query={"skipCache": "1"})
    if (not isinstance(module, dict) or _archived(module) or module.get("isDeleted")
            or module.get("status") != "draft"):
        raise ToolError("Components can only be created in an existing draft module.")
    if str(module.get("catalogueId") or module.get("moduleCatalogueId") or "") != module_id:
        raise ToolError("Choose the saved module's own catalogue id, not an alias.")
    if str(module.get("programmeId") or "") not in {
        str(programme.get("id") or ""), str(programme.get("sourceId") or ""),
    } - {""}:
        raise ToolError("That module does not belong to the selected programme.")
    return programme, module


def _target(request, arguments):
    programme, module = draft_module(request, arguments)
    module_id, week_id = _id(arguments.get("module_id")), _id(arguments.get("week_id"))
    week = next((w for w in module.get("weekStructure") or [] if w.get("id") == week_id), None)
    if week is None or _archived(week) or week.get("isDeleted"):
        raise ToolError("Choose an existing week in that draft module. No module or week will be created.")
    number = week.get("weekNumber")
    if isinstance(number, bool) or not isinstance(number, int) or number < 1:
        raise ToolError("That week has no valid saved week number. Correct it in the LMS first.")
    duplicate = next((c for c in week.get("components") or []
                      if _title_key(c.get("title")) == _title_key(arguments.get("title"))), None)
    if duplicate:
        raise ToolError(f"A component with that title already exists in this week (id: {duplicate.get('id')}). "
                        "Use that component, or choose a different title.")
    return {
        "programme_id": str(module["programmeId"]), "programme_name": programme.get("name") or "",
        "module_id": module_id, "module_title": module.get("title") or "",
        "week_id": week_id, "week_number": number, "week_title": week.get("title") or "",
        "cohort_id": str(module.get("cohortId") or ""), "group_id": str(module.get("groupId") or ""),
    }


def component_body(target, type_, title, description, defaults, *, hours=None, points=None, settings=None):
    """The single-component create body; ``defaults`` is ``(hours, points, reflection, tutor)``."""
    from curriculum_api.views import normalise_component_settings_payload

    default_hours, default_points, reflection, tutor = defaults
    settings = normalise_component_settings_payload(type_, settings or {})
    hours = default_hours if hours is None else hours
    return {
        "moduleCatalogueId": target["module_id"], "module": target["module_title"],
        "programme": target["programme_name"], "weekId": target["week_id"], "weekNumber": target["week_number"],
        "type": type_, "title": title, "description": description,
        "status": "draft", "settings": settings,
        # The save sets settings.durationMinutes from `duration`, not from the settings
        # sent (save_component_builder_payload); without it a non-zero default saves as 0.
        "duration": settings.get("durationMinutes") or 0,
        # Both supported spellings preserve a numeric zero through the existing
        # endpoint's `expectedOtjh or expected_otjh` fallback (video defaults to 0).
        "expectedOtjh": hours, "expected_otjh": hours,
        "points": default_points if points is None else points,
        "reflectionRequired": reflection, "reflectionQuestion": settings.get("reflectionPrompt") or "",
        "tutorValidationRequired": tutor, "coachValidationRequired": True,
        "workplaceEvidenceRequired": False, "ksbMappings": [],
    }


def confirmed_component(status, data, body):
    """The created component if the LMS response matches ``body``, else None."""
    component = data.get("component") if isinstance(data, dict) else None
    expected = {key: body[key] for key in (
        "moduleCatalogueId", "weekId", "type", "title", "description", "status", "expectedOtjh", "points",
        "reflectionRequired", "reflectionQuestion", "tutorValidationRequired", "coachValidationRequired",
        "workplaceEvidenceRequired",
    )}
    settings = component.get("settings") if isinstance(component, dict) else None
    if (status != 201 or not isinstance(data, dict) or data.get("created") is not True
            or not isinstance(component, dict) or not component.get("id") or component.get("isDeleted")
            or any(component.get(key) != value for key, value in expected.items())
            or not isinstance(settings, dict)
            or any(settings.get(key) != value for key, value in body["settings"].items())):
        return None
    return component


def _body(payload):
    return component_body(payload["target"], payload["type"], payload["title"], payload["description"],
                          DEFAULTS[payload["type"]], hours=payload.get("expected_otjh"),
                          points=payload.get("points"))


@contextmanager
def _locked_parents(target):
    """Prevent the existing API's missing-parent fallback during the actual save.

    These are parameterised reads, never business SQL writes. All writes still go
    through the authenticated API, within this same default-DB transaction.
    """
    from curriculum_api.views import AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE, authoring_table_name

    if not connection.features.has_select_for_update:
        raise ToolError("Component creation requires a database supporting parent row locks.")
    with transaction.atomic(using="default"):
        with connection.cursor() as cursor:
            for table, where, params in (
                (AUTHORING_MODULES_TABLE, "module_catalogue_id = %s", [target["module_id"]]),
                (AUTHORING_WEEKS_TABLE, "id = %s and module_catalogue_id = %s and week_number = %s",
                 [target["week_id"], target["module_id"], target["week_number"]]),
            ):
                cursor.execute(f"SELECT 1 FROM {authoring_table_name(table)} WHERE {where} FOR UPDATE", params)
                if cursor.fetchone() is None:
                    raise ToolError("The destination module or week no longer exists. Look it up again.")
        yield


class CreateComponent(WriteTool):
    name = NAME
    description = (
        "Preview creation of one non-Teams content component in an existing draft module and week. "
        "Look up programme/module/week ids first. Supported types are listed in the type field; Teams, "
        "recordings and retired workplace-evidence are excluded. This creates a draft container, not quiz "
        "questions or media. After confirmation use apply_change; it returns component_id. For a video, "
        "pass that id to save_curriculum_video. Never invent parent ids or create a second matching title."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "week_id": ID,
        "type": {"type": "string", "enum": list(DEFAULTS)},
        "title": {"type": "string", "minLength": 1, "maxLength": 200},
        "description": {"type": "string", "maxLength": 10000},
        "expected_otjh": {"type": "number", "minimum": 0},
        "points": {"type": "integer", "minimum": 0},
    }, "required": ["programme_id", "module_id", "week_id", "type", "title"], "additionalProperties": False}

    def validate(self, request, arguments):
        from curriculum_api.views import validate_component_authoring_payload

        if arguments.get("type") not in DEFAULTS:
            raise ToolError("Choose a supported non-Teams content type.")
        title = str(arguments.get("title") or "").strip()
        if not title:
            raise ToolError("Give the component a title.")
        if not math.isfinite(arguments.get("expected_otjh", 0)):
            raise ToolError("Expected OTJH must be a finite non-negative number.")
        target = _target(request, {**arguments, "title": title})
        defaults = DEFAULTS[arguments["type"]]
        payload = {
            **{key: arguments[key] for key in ("programme_id", "module_id", "week_id", "type")},
            "title": title, "description": arguments.get("description", "").strip(),
            "expected_otjh": arguments.get("expected_otjh", defaults[0]),
            "points": arguments.get("points", defaults[1]), "target": target,
        }
        payload["body"] = _body(payload)
        errors = validate_component_authoring_payload(payload["body"], "component")
        return Validation(payload, [error["message"] for error in errors])

    def preview(self, request, payload):
        body, target = payload["body"], payload["target"]
        return {
            "summary": f"Create draft {payload['type']} '{payload['title']}' in {target['module_title']}, {target['week_title']}.",
            "details": {
                **target, "type": payload["type"], "title": payload["title"], "description": payload["description"],
                "expected_otjh": body["expectedOtjh"], "points": body["points"],
                "reflection_required": body["reflectionRequired"], "reflection_question": body["reflectionQuestion"],
                "tutor_validation_required": body["tutorValidationRequired"], "coach_validation_required": True,
                "content_status": "Draft", "settings": body["settings"],
                "content_note": "Creates a draft container. Add media or questions separately; nothing is published.",
            },
        }

    def apply(self, request, payload, progress):
        target = payload["target"]
        with _locked_parents(target):
            # Another preview can have been applied while this one waited for
            # the parent lock. Re-read without cache and re-check duplicates.
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The destination or defaults changed. Prepare a new preview.")
            progress.uncertain("Creating the component; check the selected week before trying again.")
            status, data = call_api(request, "POST", COMPONENT_CREATE_PATH, json_body=payload["body"])
            component = confirmed_component(status, data, payload["body"])
            if component is None:
                raise ToolError("The LMS did not confirm the requested draft component.")
        component_id = str(component["id"])
        progress.uncertain_steps.clear()
        progress.done("Created draft component", component_id=component_id)
        result = {"component_id": component_id, "programme_id": target["programme_id"],
                  "module_id": target["module_id"], "week_id": target["week_id"],
                  "type": payload["type"], "title": payload["title"], "content_status": "Draft"}
        if payload["type"] == "video":
            result["next_tool"] = "save_curriculum_video"
        return {"summary": f"Created draft {payload['type']} '{payload['title']}'.", "result": result}


register_write_tool(CreateComponent())
