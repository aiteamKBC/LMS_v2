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

from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import DispatchError, call_api
from ..settings import content_editing_enabled
from . import ToolError
from .components import ID, LiveModuleWarning, draft_module, stored_duration
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


# --- update_component --------------------------------------------------------------------

#: Component fields this tool may change, as (argument, LMS field).
DETAIL_FIELDS = (("title", "title"), ("description", "description"), ("expected_otjh", "expectedOtjh"),
                 ("points", "points"))


class UpdateComponent(LiveModuleWarning, WriteTool):
    name = "update_component"
    description = (
        "Preview changing an existing component's title, description (Markdown, no HTML), expected OTJ hours or "
        "points. Only the fields you give change; the component's content, links, settings and KSB mappings are "
        "kept. Use the content tools for lesson text, quizzes and videos. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        "title": {"type": "string", "minLength": 1, "maxLength": 200},
        "description": {"type": "string", "maxLength": 10000},
        "expected_otjh": {"type": "number", "minimum": 0, "maximum": 1000},
        "points": {"type": "integer", "minimum": 0, "maximum": 10000},
    }, "required": ["module_id", "component_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _, module, component, names = _module_and_component(request, arguments)
        changes = {}
        for arg, field in DETAIL_FIELDS:
            if arg not in arguments:
                continue
            value = arguments[arg]
            if isinstance(value, str):
                value = " ".join(value.split()) if arg == "title" else value.strip()
                if _UNSAFE.search(value):
                    raise ToolError(f"Write the {arg} as plain text or Markdown; HTML is not allowed.")
            if arg == "title" and not value:
                raise ToolError("Give the component a title.")
            if value != component.get(field):
                changes[field] = value
        if not changes:
            raise ToolError("Those values are already set; there is nothing to change.")
        if "title" in changes:
            week = next(w for w in module.get("weekStructure") or []
                        if any(_s(c.get("id")) == _s(component.get("id")) for c in w.get("components") or []))
            clash = next((c for c in week.get("components") or [] if _s(c.get("id")) != _s(component.get("id"))
                          and " ".join(_s(c.get("title")).split()).casefold() == changes["title"].casefold()), None)
            if clash:
                raise ToolError(f"Another component in this week is already called that (id {clash.get('id')}).")
        return Validation({**{key: arguments[key] for key in ("programme_id", *(a for a, _ in DETAIL_FIELDS))
                              if key in arguments},
                           "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                           "component_id": _s(component.get("id")), "names": names,
                           "before": {field: component.get(field) for field in changes}, "changes": changes,
                           "component_duration": stored_duration(component)})

    def preview(self, request, payload):
        names = payload["names"]
        lines = [f"{field}: {payload['before'][field]!r} → {value!r}" for field, value in payload["changes"].items()]
        return {"summary": f"Change '{names['component']}' ({names['module']} › {names['week']}): " + "; ".join(lines) + ".",
                "details": {"names": names, "before": payload["before"], "after": payload["changes"]}}

    def apply(self, request, payload, progress):
        changes = payload["changes"]

        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The component changed since the preview. Prepare a new preview.")
            body = {"expectedRevision": structure_revision(request, payload["module_id"]), **changes,
                    "duration": payload["component_duration"]}
            if "expectedOtjh" in changes:
                body["expected_otjh"] = changes["expectedOtjh"]  # both spellings keep a numeric zero
            call_api(request, "PATCH", f"{CURRICULUM}/components/{payload['component_id']}/", json_body=body)
            saved = _component_after(request, payload["module_id"], payload["component_id"])
            if any(saved.get(field) != value for field, value in changes.items()):
                raise ToolError("The component did not read back as changed, so nothing was saved.")

        _run(progress, "Saving the component", work)
        progress.done("Updated the component", component_id=payload["component_id"])
        return {"summary": f"Updated '{changes.get('title', payload['names']['component'])}'.",
                "result": {"component_id": payload["component_id"], "changed": sorted(changes)}}


register_write_tool(MapKsbs())
register_write_tool(AddLessonContent())
register_write_tool(UpdateComponent())
