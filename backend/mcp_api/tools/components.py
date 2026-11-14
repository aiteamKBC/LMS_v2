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


#: Stands in for the programme of a free-course module (``source_type = 'free_course'``),
#: which belongs to none. It has no KSB standard, so KSB tools refuse free courses.
FREE_COURSE_PROGRAMME = {"id": "", "name": "", "status": "active", "ksbProfileSourceId": ""}


def is_free_course(module):
    return module.get("isFreeCourse") is True or str(module.get("sourceType") or "") == "free_course"


def live_learner_count(module_id):
    """How many learners have the module on their training plan -- a count, never who.

    Authored modules have no draft/published state (``curriculum.modules`` has no
    status column, so the structure read always says "draft"); being on a learner's
    plan is what makes a module live. ``learner_training_plan_modules`` is the LMS's
    own record of that, and small enough to count on every preview. None if unreadable.
    """
    from django.db import DatabaseError
    from learner_api.models import LearnerTrainingPlanModule

    try:
        return LearnerTrainingPlanModule.objects.filter(module_ref=module_id).values("learner_id").distinct().count()
    except DatabaseError:
        return None


class LiveModuleWarning:
    """Mixin for write tools whose payload names a ``module_id``: warn before writing to a live module."""

    def preview_warnings(self, request, payload):
        if not payload.get("module_id"):
            return []
        count = live_learner_count(payload["module_id"])
        if count is None:
            return ["Could not check whether learners are using this module; treat it as live."]
        if count:
            return [f"LIVE MODULE: {count} learner(s) have this module on their training plan. They will see "
                    "this change as soon as it is saved."]
        return []


def stored_duration(component):
    """The component's own ``settings.durationMinutes``, to send back on every component PATCH.

    The LMS PATCH re-derives ``durationMinutes`` from ``duration``, which reads as
    expected hours x 60 when the stored value is 0 (``component_builder_response``).
    Sending the stored value keeps a single-field edit from changing it.
    """
    settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
    try:
        return max(0, int(settings.get("durationMinutes") or 0))
    except (TypeError, ValueError):
        return 0


def _id(value):
    value = str(value or "").strip()
    if not re.fullmatch(r"[\w-]+", value, re.ASCII) or value.startswith("training-module-"):
        raise ToolError("Look up the saved programme, module and week ids first; do not use training-module aliases.")
    return value


def _title_key(value):
    return " ".join(str(value or "").split()).casefold()


def draft_module(request, arguments, *, enabled=component_creation_enabled, feature="component creation"):
    """The flag-checked ``(programme, module)`` for a draft module of that programme, read without cache."""
    if not enabled():
        raise ToolError(f"MCP {feature} is not enabled. Ask an administrator to enable the {feature} pilot.")
    module_id = _id(arguments.get("module_id"))
    _, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/", query={"skipCache": "1"})
    if (not isinstance(module, dict) or _archived(module) or module.get("isDeleted")
            or module.get("status") != "draft"):
        raise ToolError("Components can only be created in an existing draft module.")
    if str(module.get("catalogueId") or module.get("moduleCatalogueId") or "") != module_id:
        raise ToolError("Choose the saved module's own catalogue id, not an alias.")
    if is_free_course(module):
        # A free course is a standalone module in no programme.
        if str(arguments.get("programme_id") or "").strip():
            raise ToolError("That module is a free course and belongs to no programme. Leave programme_id out.")
        return dict(FREE_COURSE_PROGRAMME), module
    programme = _programme_by_id(request, _id(arguments.get("programme_id")))
    if _archived(programme):
        raise ToolError("Choose an active programme.")
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
    through the authenticated API, within this same default-DB transaction. A free
    course owns its rows in native free-course storage, not the module/week tables.
    """
    from curriculum_api import learning_storage
    from curriculum_api.views import AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE, authoring_table_name

    if not connection.features.has_select_for_update:
        raise ToolError("Component creation requires a database supporting parent row locks.")
    with transaction.atomic(using="default"):
        course = learning_storage.course(target["module_id"], lock=True)
        if course is None:
            lookups = (
                (authoring_table_name(AUTHORING_MODULES_TABLE), "module_catalogue_id = %s", [target["module_id"]]),
                (authoring_table_name(AUTHORING_WEEKS_TABLE),
                 "id = %s and module_catalogue_id = %s and week_number = %s",
                 [target["week_id"], target["module_id"], target["week_number"]]),
            )
        else:
            lookups = (("curriculum.free_course_weeks", "content_ref = %s and course_id = %s and week_number = %s",
                        [target["week_id"], course["id"], target["week_number"]]),)
        with connection.cursor() as cursor:
            for table, where, params in lookups:
                cursor.execute(f"SELECT 1 FROM {table} WHERE {where} FOR UPDATE", params)
                if cursor.fetchone() is None:
                    raise ToolError("The destination module or week no longer exists. Look it up again.")
        yield


class CreateComponent(LiveModuleWarning, WriteTool):
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
    }, "required": ["module_id", "week_id", "type", "title"], "additionalProperties": False}

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
            **{key: arguments[key] for key in ("module_id", "week_id", "type")},
            "programme_id": str(arguments.get("programme_id") or "").strip(),
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
