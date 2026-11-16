"""Step 9: ``map_ksbs`` and ``add_lesson_content`` on existing components of draft modules.

Both sit behind ``MCP_CONTENT_EDITING_ENABLED`` (default off) and write only through
the endpoints the Module Builder uses, sending the module's current ``structureRevision``
so a concurrent Module Builder edit is refused (409), never overwritten. Each apply runs
in one default-DB transaction and re-reads the module afterwards to confirm the result,
so a mismatch rolls everything back.

- ``map_ksbs`` adds mappings (``POST curriculum/components/<id>/ksb-mappings/``) and
  changes existing ones (``PATCH curriculum/ksb-mappings/<id>/``). Removing a mapping is
  not supported: that stays in the Module Builder. Both endpoints keep the component JSON
  and the mapping table in step (``sync_component_ksb_projection``).
- ``add_lesson_content`` writes a Reading component's ``readingContent``. The LMS stores
  that as HTML; the HTML is built only by ``tools/markdown.py`` from escaped text, and
  input containing HTML is refused (A8). Learner pages sanitise it again on display.
"""
from __future__ import annotations

import copy
from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import DispatchError, call_api
from ..settings import content_editing_enabled
from . import ToolError, ToolResult, tool
from .components import DEFAULTS, ID, LiveModuleWarning, draft_module, stored_duration
from .fields import (
    DETAIL_FIELDS, DURATION, MEDIA_URL, SETTINGS, editable_settings, requested_details,
    requested_settings, setting_kind,
)
from .markdown import markdown_to_html
from .quizzes import _UNSAFE, programme_ksb_source, structure_revision
from .read import CURRICULUM, _archived, _s

MAX_MARKDOWN = 50_000
FUTURE_ONLY = ("Mapping changes count for future completions only; learners who already completed this "
               "component keep their existing KSB record.")


def _module_and_component(request, arguments, types=None):
    programme, module = draft_module(request, arguments, enabled=content_editing_enabled, feature="content editing")
    component_id = _s(arguments.get("component_id"))
    for week in module.get("weekStructure") or []:
        for component in week.get("components") or []:
            if _s(component.get("id")) == component_id:
                if _archived(component) or component.get("isDeleted"):
                    break
                if types and _s(component.get("type")) not in types:
                    raise ToolError(f"That component is a {component.get('type')}; choose a "
                                    f"{' or '.join(sorted(types))} component.")
                names = {"programme": _s(programme.get("name")), "module": _s(module.get("title")),
                         "week": _s(week.get("title")), "component": _s(component.get("title"))}
                return programme, module, component, names
    raise ToolError("Choose an existing component in that draft module (use list_module_weeks or "
                    "get_module_structure).")


def _component_after(request, module_id, component_id):
    _, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/", query={"skipCache": "1"})
    for week in (module or {}).get("weekStructure") or []:
        for component in week.get("components") or []:
            if _s(component.get("id")) == component_id:
                return component
    raise ToolError("The component could not be read back after saving, so nothing was saved.")


def _run(progress, label, work):
    """Run ``work`` in one default-DB transaction; a refused/failed step rolls back and says so."""
    progress.uncertain(f"{label}; check the component in the LMS before trying again.")
    try:
        with transaction.atomic(using="default"):
            result = work()
    except (ToolError, DispatchError) as exc:
        progress.uncertain_steps.clear()
        if isinstance(exc, DispatchError):
            raise ToolError(f"{exc} Nothing was saved; prepare a new preview.") from None
        raise
    progress.uncertain_steps.clear()
    return result


# --- map_ksbs ------------------------------------------------------------------------------

MAPPING = {"type": "object", "properties": {
    "ksb_code": {"type": "string", "minLength": 1, "maxLength": 20},
    "classification": {"type": "string", "enum": ["main", "secondary", "possible"]},
    "weight_class": {"type": "string", "enum": ["hard", "soft", "possible"]},
    "weight": {"type": "number", "minimum": 0.01, "maximum": 100},
}, "required": ["ksb_code", "classification", "weight_class", "weight"], "additionalProperties": False}


def _mapping_values(mapping):
    return {"classification": _s(mapping.get("classification") or mapping.get("type")).lower(),
            "weight_class": _s(mapping.get("weightClass") or mapping.get("weight_class")).lower(),
            "weight": float(mapping.get("weight") or 0)}


class MapKsbs(LiveModuleWarning, WriteTool):
    name = "map_ksbs"
    description = (
        "Preview adding KSB mappings to a component of a draft module, or changing the classification "
        "(main/secondary/possible), weight class (hard/soft/possible) or weight of ones it already has. Codes "
        "must come from list_standard_ksbs. Removing a mapping is not supported: do that in the Module Builder. "
        "Show the preview and use apply_change only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        "mappings": {"type": "array", "minItems": 1, "maxItems": 30, "items": MAPPING},
    }, "required": ["module_id", "component_id", "mappings"], "additionalProperties": False}

    def validate(self, request, arguments):
        programme, module, component, names = _module_and_component(request, arguments)
        wanted = [{"code": _s(m["ksb_code"]).upper(), "classification": m["classification"],
                   "weight_class": m["weight_class"], "weight": float(m["weight"])}
                  for m in arguments.get("mappings") or []]
        codes = [m["code"] for m in wanted]
        errors = [f"{code} is listed more than once." for code in sorted({c for c in codes if codes.count(c) > 1})]
        source, problems = programme_ksb_source(programme, sorted(set(codes)), "then map the KSBs")
        errors += problems
        existing = {_s(m.get("code")).upper(): m for m in component.get("ksbMappings") or []}
        creates, updates, unchanged = [], [], []
        for mapping in wanted:
            current = existing.get(mapping["code"])
            values = {k: mapping[k] for k in ("classification", "weight_class", "weight")}
            if current is None:
                creates.append(mapping)
            elif _mapping_values(current) == values:
                unchanged.append(mapping["code"])
            elif not _s(current.get("id")):
                errors.append(f"{mapping['code']}'s existing mapping has no id; change it in the Module Builder.")
            else:
                updates.append({**mapping, "mapping_id": _s(current["id"]), "before": _mapping_values(current)})
        if not errors and not creates and not updates:
            raise ToolError("Every mapping already has those values; there is nothing to change.")
        return Validation({"programme_id": _s(arguments.get("programme_id")),
                           "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                           "component_id": _s(component.get("id")), "names": names, "source": source,
                           # The request itself, so apply's re-validation sees the same input.
                           "mappings": [{"ksb_code": m["code"], "classification": m["classification"],
                                         "weight_class": m["weight_class"], "weight": m["weight"]} for m in wanted],
                           "creates": creates, "updates": updates, "unchanged": unchanged}, errors)

    def preview(self, request, payload):
        def describe(m):
            return f"{m['code']} ({m['classification']}, {m['weight_class']}, weight {m['weight']:g})"

        lines = [f"add {describe(m)}" for m in payload["creates"]]
        lines += [f"change {m['code']}: {m['before']['classification']}/{m['before']['weight_class']}/"
                  f"{m['before']['weight']:g} → {m['classification']}/{m['weight_class']}/{m['weight']:g}"
                  for m in payload["updates"]]
        names = payload["names"]
        return {"summary": f"KSB mappings on '{names['component']}' ({names['module']} › {names['week']}): "
                           + "; ".join(lines) + ".",
                "details": {"names": names, "add": payload["creates"], "change": payload["updates"],
                            "already_set": payload["unchanged"], "source": payload["source"]["label"],
                            "impact": FUTURE_ONLY}}

    def apply(self, request, payload, progress):
        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The component's mappings changed since the preview. Prepare a new preview.")
            module_id, component_id, source = payload["module_id"], payload["component_id"], payload["source"]
            if payload["creates"]:
                body = {"expectedRevision": structure_revision(request, module_id), "mappings": [
                    {"code": m["code"], "classification": m["classification"], "weightClass": m["weight_class"],
                     "weight": m["weight"], "sourceType": source["type"], "sourceId": source["id"]}
                    for m in payload["creates"]]}
                status, data = call_api(request, "POST", f"{CURRICULUM}/components/{component_id}/ksb-mappings/",
                                        json_body=body)
                if status != 201 or not isinstance(data, dict) or data.get("created") is not True:
                    raise ToolError("The LMS did not confirm the new KSB mappings, so nothing was saved.")
            for m in payload["updates"]:
                body = {"expectedRevision": structure_revision(request, module_id), "classification":
                        m["classification"], "weightClass": m["weight_class"], "weight": m["weight"]}
                call_api(request, "PATCH", f"{CURRICULUM}/ksb-mappings/{m['mapping_id']}/", json_body=body)
            # Both stores are kept in step by the endpoints; confirm from the structure read.
            saved = {_s(m.get("code")).upper(): _mapping_values(m)
                     for m in _component_after(request, module_id, component_id).get("ksbMappings") or []}
            for m in [*payload["creates"], *payload["updates"]]:
                if saved.get(m["code"]) != {k: m[k] for k in ("classification", "weight_class", "weight")}:
                    raise ToolError(f"{m['code']} did not read back as requested, so nothing was saved.")

        _run(progress, "Saving KSB mappings", work)
        for m in payload["creates"]:
            progress.done(f"Added {m['code']}")
        for m in payload["updates"]:
            progress.done(f"Changed {m['code']}", mapping_id=m["mapping_id"])
        return {"summary": f"Saved {len(payload['creates'])} new and {len(payload['updates'])} changed KSB "
                           f"mapping(s) on '{payload['names']['component']}'. {FUTURE_ONLY}",
                "result": {"component_id": payload["component_id"],
                           "added": [m["code"] for m in payload["creates"]],
                           "changed": [m["code"] for m in payload["updates"]]}}


# --- add_lesson_content ------------------------------------------------------------------

class AddLessonContent(LiveModuleWarning, WriteTool):
    name = "add_lesson_content"
    description = (
        "Preview writing the lesson text of an existing Reading component in a draft module. Write the text as "
        "Markdown (headings with #, lists with - or 1., **bold**, *italic*, [links](https://...)); HTML is not "
        "allowed. If the component already has text, it is REPLACED, and replace_existing must be true after the "
        "user agrees. Reading components that use an uploaded file are refused. Show the preview and use "
        "apply_change only after confirmation. Nothing is published."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        "body_markdown": {"type": "string", "minLength": 1, "maxLength": MAX_MARKDOWN},
        "replace_existing": {"type": "boolean"},
    }, "required": ["module_id", "component_id", "body_markdown"], "additionalProperties": False}

    def validate(self, request, arguments):
        _, module, component, names = _module_and_component(request, arguments, types={"reading"})
        settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
        if any(_s(settings.get(key)) for key in ("uploadedFileUrl", "resourceUrl", "componentFiles")):
            raise ToolError("This Reading component uses an uploaded file or link. Change it in the LMS, or use "
                            "another Reading component for written text.")
        markdown = _s(arguments.get("body_markdown"))
        if _UNSAFE.search(markdown):
            raise ToolError("Write the lesson as Markdown only; HTML tags and scripts are not allowed.")
        current = _s(settings.get("readingContent"))
        content_html = markdown_to_html(markdown)
        if current and current != content_html and not arguments.get("replace_existing"):
            raise ToolError(f"'{names['component']}' already has lesson text ({len(current)} characters). Ask the "
                            "user whether to replace it; if they agree, call again with replace_existing true.")
        if current == content_html:
            raise ToolError("The component already has exactly this text; there is nothing to change.")
        return Validation({"programme_id": _s(arguments.get("programme_id")),
                           "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                           "component_id": _s(component.get("id")), "names": names,
                           "body_markdown": markdown, "replace_existing": bool(arguments.get("replace_existing")),
                           "content_html": content_html, "replaces_chars": len(current),
                           "component_duration": stored_duration(component)})

    def preview(self, request, payload):
        names = payload["names"]
        action = (f"REPLACE the existing lesson text ({payload['replaces_chars']} characters) of"
                  if payload["replaces_chars"] else "Write lesson text into")
        excerpt = payload["body_markdown"][:400] + ("…" if len(payload["body_markdown"]) > 400 else "")
        return {"summary": f"{action} '{names['component']}' ({names['module']} › {names['week']}): "
                           f"{len(payload['body_markdown'])} characters of Markdown.",
                "details": {"names": names, "replaces_existing_text": bool(payload["replaces_chars"]),
                            "excerpt": excerpt, "content_note": "Saved to the draft module; nothing is published."}}

    def apply(self, request, payload, progress):
        settings = {"readingContent": payload["content_html"], "readingSource": "Written in LMS"}

        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The component changed since the preview. Prepare a new preview.")
            body = {"expectedRevision": structure_revision(request, payload["module_id"]), "settings": settings,
                    "duration": payload["component_duration"]}
            call_api(request, "PATCH", f"{CURRICULUM}/components/{payload['component_id']}/", json_body=body)
            saved = _component_after(request, payload["module_id"], payload["component_id"]).get("settings") or {}
            if any(saved.get(k) != v for k, v in settings.items()):
                raise ToolError("The lesson text did not read back as written, so nothing was saved.")

        _run(progress, "Saving the lesson text", work)
        progress.done("Saved lesson text", component_id=payload["component_id"])
        return {"summary": f"Saved the lesson text in '{payload['names']['component']}'.",
                "result": {"component_id": payload["component_id"], "characters": len(payload["body_markdown"]),
                           "replaced_existing": bool(payload["replaces_chars"])}}


# --- update_component / get_component -------------------------------------------------------

def _lms_errors(component):
    """The LMS's own component validation messages for ``component``."""
    from curriculum_api.views import validate_component_authoring_payload

    return {f"{error.get('path', '')}: {error.get('message', '')}"
            for error in validate_component_authoring_payload(copy.deepcopy(component), "component")}


class UpdateComponent(LiveModuleWarning, WriteTool):
    name = "update_component"
    description = (
        "Preview changing anything on an existing component, as its editor in the LMS would: title, description, "
        "expected OTJ hours, points, duration_minutes, reflection and validation options, and its type's settings "
        "(settings: an object of setting names to new values). Call get_component first: it lists the settings "
        "this component has, their current values and which ones can be changed. media_url is a shortcut for a "
        "Podcast's episode link (External Link) or a Video's YouTube link; never put a link meant to be played into "
        "the description. Text is plain text or Markdown, no HTML. Only what you give changes. Lesson text, uploaded "
        "files, MP4 videos, linked quizzes, KSB mappings and Teams session details have their own tools or stay in "
        "the LMS. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        **{arg: schema for arg, _, schema in DETAIL_FIELDS},
        "duration_minutes": DURATION, "media_url": MEDIA_URL, "settings": SETTINGS,
    }, "required": ["module_id", "component_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _, module, component, names = _module_and_component(request, arguments)
        current = component.get("settings") if isinstance(component.get("settings"), dict) else {}
        wanted = requested_settings(_s(component.get("type")), arguments)
        settings = {key: value for key, value in wanted.items() if current.get(key) != value}
        changes = {field: value for field, value in requested_details(arguments).items()
                   if value != component.get(field)}
        duration_before = stored_duration(component)
        duration = arguments.get("duration_minutes", duration_before)
        if not changes and not settings and duration == duration_before:
            raise ToolError("Those values are already set; there is nothing to change.")
        if "title" in changes:
            week = next(w for w in module.get("weekStructure") or []
                        if any(_s(c.get("id")) == _s(component.get("id")) for c in w.get("components") or []))
            clash = next((c for c in week.get("components") or [] if _s(c.get("id")) != _s(component.get("id"))
                          and " ".join(_s(c.get("title")).split()).casefold() == changes["title"].casefold()), None)
            if clash:
                raise ToolError(f"Another component in this week is already called that (id {clash.get('id')}).")
        # The LMS's own rules (link formats, reflection question, status needs), refusing only new problems.
        after = {**component, **changes, "settings": {**current, **settings}}
        errors = sorted(_lms_errors(after) - _lms_errors(component))
        echoed = ("programme_id", *(arg for arg, _, _ in DETAIL_FIELDS), "duration_minutes", "media_url", "settings")
        return Validation({**{key: arguments[key] for key in echoed if key in arguments},
                           "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                           "component_id": _s(component.get("id")), "names": names,
                           "before": {field: component.get(field) for field in changes}, "changes": changes,
                           "settings_before": {key: current.get(key) for key in settings}, "new_settings": settings,
                           "duration_before": duration_before, "component_duration": duration},
                          [f"The LMS would refuse this: {error}" for error in errors])

    def preview(self, request, payload):
        names = payload["names"]
        before = {**payload["before"], **payload["settings_before"]}
        after = {**payload["changes"], **payload["new_settings"]}
        if payload["component_duration"] != payload["duration_before"]:
            before["durationMinutes"] = payload["duration_before"]
            after["durationMinutes"] = payload["component_duration"]
        lines = [f"{key}: {before[key]!r} → {value!r}" for key, value in after.items()]
        return {"summary": f"Change '{names['component']}' ({names['module']} › {names['week']}): " + "; ".join(lines) + ".",
                "details": {"names": names, "before": before, "after": after}}

    def apply(self, request, payload, progress):
        changes, settings, duration = payload["changes"], payload["new_settings"], payload["component_duration"]

        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The component changed since the preview. Prepare a new preview.")
            body = {"expectedRevision": structure_revision(request, payload["module_id"]), **changes,
                    "duration": duration}
            if "expectedOtjh" in changes:
                body["expected_otjh"] = changes["expectedOtjh"]  # both spellings keep a numeric zero
            if settings:
                body["settings"] = settings  # merged into the stored settings by the LMS
            call_api(request, "PATCH", f"{CURRICULUM}/components/{payload['component_id']}/", json_body=body)
            saved = _component_after(request, payload["module_id"], payload["component_id"])
            saved_settings = saved.get("settings") if isinstance(saved.get("settings"), dict) else {}
            if (any(saved.get(field) != value for field, value in changes.items())
                    or any(saved_settings.get(key) != value for key, value in settings.items())
                    or stored_duration(saved) != duration):
                raise ToolError("The component did not read back as changed, so nothing was saved.")

        _run(progress, "Saving the component", work)
        progress.done("Updated the component", component_id=payload["component_id"])
        changed = [*changes, *settings, *(["durationMinutes"] if duration != payload["duration_before"] else [])]
        return {"summary": f"Updated '{changes.get('title', payload['names']['component'])}'.",
                "result": {"component_id": payload["component_id"], "changed": sorted(changed)}}


@tool("get_component",
      "Show everything on one component, as its editor in the LMS shows it: title, description, hours, points, "
      "duration, reflection and validation options, and every setting with its current value. editable_settings "
      "lists the settings update_component can change, with the kind of value each takes. Use it before "
      "update_component. Before create_curriculum_component, give only type to list that type's settings and "
      "their LMS defaults.",
      {"type": "object", "properties": {"module_id": ID, "component_id": ID,
                                        "type": {"type": "string", "enum": list(DEFAULTS)}},
       "additionalProperties": False})
def get_component(request, arguments):
    if "type" in arguments:
        if "module_id" in arguments or "component_id" in arguments:
            raise ToolError("Give either type (for a new component) or module_id and component_id, not both.")
        defaults = editable_settings(arguments["type"])
        data = {"type": arguments["type"], "settings": defaults,
                "editable_settings": {key: setting_kind(default) for key, default in sorted(defaults.items())}}
        lines = [f"Settings a new {arguments['type']} component can be given (LMS default shown):"]
        lines += [f"- settings.{key} ({setting_kind(default)}): {default!r}"
                  for key, default in sorted(defaults.items())]
        return ToolResult("\n".join(lines), data)
    if not arguments.get("module_id") or not arguments.get("component_id"):
        raise ToolError("Give module_id and component_id for an existing component, or type for a new one.")
    module_id, component_id = _s(arguments["module_id"]), _s(arguments["component_id"])
    if module_id.startswith("training-module-"):
        # That GET can provision authoring records; a read tool must never trigger writes.
        raise ToolError("Use find_modules to look up the saved module id; nothing was created or changed.")
    _status, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/")
    found = next(((w, c) for w in (module or {}).get("weekStructure") or [] for c in w.get("components") or []
                  if _s(c.get("id")) == component_id), None)
    if found is None:
        raise ToolError("That component is not in that module. Use get_module_structure to find its id.")
    week, component = found
    settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
    editable = editable_settings(component.get("type"))
    fields = {arg: component.get(field) for arg, field, _ in DETAIL_FIELDS}
    fields["duration_minutes"] = stored_duration(component)
    data = {"component_id": component_id, "type": _s(component.get("type")), "week": _s(week.get("title")),
            "fields": fields, "settings": settings,
            "editable_settings": {key: setting_kind(default) for key, default in sorted(editable.items())}}
    lines = [f"[{data['type']}] {fields['title']} (component_id {component_id}, {data['week']})"]
    lines += [f"- {key}: {value!r}" for key, value in fields.items() if key != "title"]
    lines += [f"- settings.{key}: {settings.get(key)!r}{'' if key in editable else ' (not editable here)'}"
              for key in sorted(settings)]
    return ToolResult("\n".join(lines), data)


register_write_tool(MapKsbs())
register_write_tool(AddLessonContent())
register_write_tool(UpdateComponent())
