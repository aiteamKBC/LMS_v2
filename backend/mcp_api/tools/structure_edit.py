"""Update a programme, cohort, group, module or week the way its LMS edit form does.

Each tool reads the stored record together with its revision token (programme, cohort
and group through ``record-snapshot/``, modules and weeks through the structure read),
previews the before/after, then saves through the endpoint the LMS form uses with that
token as ``expectedRevision`` -- so an edit made by somebody else in between is refused
(409), never overwritten -- and reads the record back to confirm. Nothing is ever
archived, deleted, published or moved to another parent here, and no Teams meeting is
changed: a schedule edit names the calendars staff must update in the LMS.

- Programme, cohort and group: their drawers' PATCH. The programme PATCH writes
  ``level`` and ``description`` from the body, so all four drawer fields are always sent.
- Module: the module drawer's PATCH (merged onto the stored module; a smaller week count
  only drops empty trailing weeks), plus the Module Builder's partial structure save for
  the fields that PATCH does not carry (background, EPA requirements, qualification outcomes).
- Week: the Module Builder's partial structure save -- the changed week, with every
  week and component kept in its stored order, so nothing else moves.
"""
from __future__ import annotations

import re

from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import FORBIDDEN_KEY_PREFIXES, FORBIDDEN_KEYS, DispatchError, call_api
from . import ToolError
from .components import is_free_course
from .read import CURRICULUM, _archived, _programme_by_id, _results, _s
from .structure import (
    COLOR, DATE, DAYS, ID, LINES, MODULE_BUILDER_FIELDS, MODULE_FIELDS, MODULE_GROUPED, NAME, WEEK_FIELDS, _TIME,
    _clean_name, _coach, _color, _enabled, _iso_date, _refuse_duplicate, _text, _value, name_key,
)


def _snapshot(request, kind, record_id):
    """``(record, revision)``: the drawer's own fields and the token they were read with."""
    _, data = call_api(request, "GET", f"{CURRICULUM}/record-snapshot/", query={"kind": kind, "id": record_id})
    record = data.get("record") if isinstance(data, dict) else None
    revision = _s((data or {}).get("revision")) if isinstance(data, dict) else ""
    if not isinstance(record, dict) or not revision:
        raise ToolError(f"That {kind} was not found, or its saved version could not be read. Look it up again.")
    return record, revision


def _without_system_keys(value):
    """Echo stored data back without the keys the dispatcher refuses (deletion/removal markers)."""
    if isinstance(value, dict):
        return {key: _without_system_keys(item) for key, item in value.items()
                if str(key).lower() not in FORBIDDEN_KEYS and not str(key).lower().startswith(FORBIDDEN_KEY_PREFIXES)}
    if isinstance(value, list):
        return [_without_system_keys(item) for item in value]
    return value


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _same(saved, wanted, *, loose=False):
    """Equal as the LMS stores it: numbers by value, text ignoring spacing (and case when ``loose``)."""
    if _number(wanted) or _number(saved):
        try:
            return float(saved) == float(wanted)
        except (TypeError, ValueError):
            return False
    if isinstance(wanted, str) and isinstance(saved, str):
        saved, wanted = " ".join(saved.split()), " ".join(wanted.split())
        return saved.casefold() == wanted.casefold() if loose else saved == wanted
    return saved == wanted


class _EditTool(WriteTool):
    """Preview a field-by-field change; apply it under the record's revision and confirm by reading back."""

    noun = ""

    def echo(self, arguments):
        return {key: arguments[key] for key in self.input_schema["properties"] if key in arguments}

    def finish(self, request, payload, before, after, extra=None, warnings=()):
        if not after:
            raise ToolError("Those values are already set; there is nothing to change.")
        return Validation({**self.echo(payload), **(extra or {}), "before": before, "after": after},
                          warnings=list(warnings))

    def preview(self, request, payload):
        lines = [f"{key}: {payload['before'].get(key)!r} → {value!r}" for key, value in payload["after"].items()]
        return {"summary": f"Change {self.noun} '{payload['label']}': " + "; ".join(lines) + ".",
                "details": {"before": payload["before"], "after": payload["after"],
                            "note": "Saved straight to the LMS; nothing is published, archived or moved."}}

    def apply(self, request, payload, progress):
        progress.uncertain(f"Saving the {self.noun}; check it in the LMS before trying again.")
        try:
            with transaction.atomic(using="default"):
                recheck = self.validate(request, payload)
                if recheck.errors or recheck.payload != payload:
                    raise ToolError(f"The {self.noun} changed since the preview. Prepare a new preview.")
                result = self.save(request, payload) or {}
        except (ToolError, DispatchError) as exc:
            progress.uncertain_steps.clear()
            if isinstance(exc, DispatchError):
                raise ToolError(f"{exc} Nothing was saved; prepare a new preview.") from None
            raise
        progress.uncertain_steps.clear()
        progress.done(f"Updated the {self.noun}", **{f"{self.noun}_id": payload["record_id"]})
        return {"summary": f"Updated {self.noun} '{payload['after'].get('name') or payload['label']}'.",
                "result": {f"{self.noun}_id": payload["record_id"], "changed": sorted(payload["after"]), **result}}

    def confirm(self, saved, after, *, loose=()):
        wrong = [key for key, value in after.items() if not _same(saved.get(key), value, loose=key in loose)]
        if wrong:
            raise ToolError(f"The {self.noun} did not read back as changed ({', '.join(wrong)}), so nothing was saved.")


# --- programme ---------------------------------------------------------------------------------

class UpdateProgramme(_EditTool):
    name = "update_programme"
    noun = "programme"
    description = (
        "Preview changing a programme as its LMS edit form does: name, level (1-8), description, colour (hex), and "
        "its KSB standard (standard_id from list_ksb_standards; every module of the programme then uses it). Only "
        "what you give changes. Programmes are never archived or deleted here. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "name": NAME, "level": {"type": "integer", "minimum": 1, "maximum": 8},
        "description": {"type": "string", "maxLength": 5000}, "color": COLOR, "standard_id": ID,
    }, "required": ["programme_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        programme = _programme_by_id(request, arguments.get("programme_id"))
        if _archived(programme):
            raise ToolError("That programme is archived. Restore it in the LMS first.")
        record_id = _s(programme.get("id"))
        record, revision = _snapshot(request, "programme", record_id)
        current = {key: _s(record.get(key)) for key in ("name", "level", "description", "color")}
        wanted = {}
        if "name" in arguments:
            wanted["name"] = _clean_name(arguments["name"], "programme")
            if name_key(wanted["name"]) != name_key(current["name"]):
                _, data = call_api(request, "GET", f"{CURRICULUM}/programmes/", query={"visibility": "all"})
                _refuse_duplicate([r for r in _results(data) if _s(r.get("id")) != record_id], wanted["name"],
                                  "Programme", "")
        if "level" in arguments:
            wanted["level"] = f"LVL-{arguments['level']}"
        if "description" in arguments:
            wanted["description"] = _text(arguments["description"], "description", 5000)
        if "color" in arguments:
            wanted["color"] = _color(arguments["color"])
        after = {key: value for key, value in wanted.items() if value != current[key]}
        warnings = []
        if "standard_id" in arguments:
            standard_id = _s(arguments["standard_id"])
            if not re.fullmatch(r"[\w.-]+", standard_id):
                raise ToolError("Use a standard_id from list_ksb_standards.")
            _, standard = call_api(request, "GET", f"{CURRICULUM}/standards/{standard_id}/")
            if not isinstance(standard, dict) or _s(standard.get("id")) != standard_id:
                raise ToolError("That standard was not found. Use list_ksb_standards.")
            source = f"standard:{standard_id}"
            if source != _s(programme.get("ksbProfileSourceId")):
                after["ksbProfileSourceId"] = source
                current["ksbProfileSourceId"] = _s(programme.get("ksbProfileSourceId"))
                warnings.append(f"Every module of this programme will use {_s(standard.get('name'))} for KSB mapping. "
                                "Existing KSB mappings are not removed.")
        return self.finish(request, arguments, {k: current.get(k) for k in after}, after,
                           {"record_id": record_id, "label": current["name"], "revision": revision,
                            "current": current}, warnings)

    def save(self, request, payload):
        current, after = payload["current"], payload["after"]
        body = {key: after.get(key, current[key]) for key in ("name", "level", "description", "color")}
        if "ksbProfileSourceId" in after:
            body["ksbProfileSourceId"] = after["ksbProfileSourceId"]
        call_api(request, "PATCH", f"{CURRICULUM}/programmes/{payload['record_id']}/",
                 json_body={**body, "expectedRevision": payload["revision"]})
        saved, _ = _snapshot(request, "programme", payload["record_id"])
        if "ksbProfileSourceId" in after:
            saved["ksbProfileSourceId"] = _s(_programme_by_id(request, payload["record_id"]).get("ksbProfileSourceId"))
        self.confirm(saved, after)


# --- cohort ------------------------------------------------------------------------------------

class UpdateCohort(_EditTool):
    name = "update_cohort"
    noun = "cohort"
    description = (
        "Preview changing a cohort as its LMS edit form does: name, start date (YYYY-MM-DD), length in months, an "
        "authored practical end date, EPA months, an apprenticeship end date override (empty text clears it) and "
        "colour. The preview shows the end date the LMS will calculate. Cohorts are never moved to another programme, "
        "archived or deleted here. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "cohort_id": ID, "name": NAME, "start_date": DATE,
        "duration_months": {"type": "integer", "minimum": 1, "maximum": 72},
        "practical_end_date": DATE, "epa_months": {"type": "integer", "minimum": 0, "maximum": 24},
        "apprenticeship_end_override": {"type": "string", "maxLength": 10}, "color": COLOR,
    }, "required": ["cohort_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        from curriculum_api.views import cohort_practical_end_date

        _enabled()
        record_id = _s(arguments["cohort_id"])
        record, revision = _snapshot(request, "cohort", record_id)
        if _archived(record):
            raise ToolError("That cohort is archived. Restore it in the LMS first.")
        current = {"name": _s(record.get("name")), "startDate": _s(record.get("startDate"))[:10],
                   "durationMonths": record.get("durationMonths"), "endDate": _s(record.get("endDate"))[:10],
                   "epaMonths": record.get("epaMonths"),
                   "apprenticeshipEndOverride": _s(record.get("apprenticeshipEndOverride"))[:10],
                   "color": _s(record.get("color"))}
        after, body = {}, {}
        if "name" in arguments:
            name = _clean_name(arguments["name"], "cohort")
            if name != current["name"]:
                if name_key(name) != name_key(current["name"]):
                    programme_id = _s(record.get("programmeId"))
                    _, data = call_api(request, "GET", f"{CURRICULUM}/programmes/{programme_id}/cohorts/")
                    _refuse_duplicate([r for r in _results(data) if _s(r.get("id")) != record_id], name, "Cohort",
                                      " in this programme")
                after["name"] = body["name"] = name
        if {"start_date", "duration_months", "practical_end_date"} & arguments.keys():
            start = _iso_date(arguments.get("start_date") or current["startDate"], "start date").isoformat()
            months = arguments.get("duration_months") or current["durationMonths"] or 24
            if "practical_end_date" in arguments:
                end = _iso_date(arguments["practical_end_date"], "practical end date").isoformat()
            else:
                end = _s(cohort_practical_end_date(start, months, record.get("holidayIds") or []))[:10]
            if not end or end <= start:
                raise ToolError("The practical end date must be after the start date.")
            # The LMS form always sends the start and length together, so the end is recalculated from both.
            body.update(startDate=start, durationMonths=months,
                        **({"endDate": end} if "practical_end_date" in arguments else {}))
            for key, value in (("startDate", start), ("durationMonths", months), ("endDate", end)):
                if value != current[key]:
                    after[key] = value
        if "epa_months" in arguments and arguments["epa_months"] != current["epaMonths"]:
            after["epaMonths"] = body["epaMonths"] = arguments["epa_months"]
        if "apprenticeship_end_override" in arguments:
            override = _s(arguments["apprenticeship_end_override"])
            if override:
                override = _iso_date(override, "apprenticeship end date").isoformat()
            if override != current["apprenticeshipEndOverride"]:
                after["apprenticeshipEndOverride"] = override
                body["apprenticeshipEndOverride"] = override or None
        if "color" in arguments and _color(arguments["color"]) != current["color"]:
            after["color"] = body["color"] = _color(arguments["color"])
        warnings = (["Changing the dates moves the cohort's period. Modules keep their own dates; check their "
                     "schedules in the LMS."] if {"startDate", "endDate", "durationMonths"} & after.keys() else [])
        return self.finish(request, arguments, {k: current.get(k) for k in after}, after,
                           {"record_id": record_id, "label": current["name"], "revision": revision, "body": body},
                           warnings)

    def save(self, request, payload):
        call_api(request, "PATCH", f"{CURRICULUM}/cohorts/{payload['record_id']}/",
                 json_body={**payload["body"], "expectedRevision": payload["revision"]})
        saved, _ = _snapshot(request, "cohort", payload["record_id"])
        saved = {**saved, **{key: _s(saved.get(key))[:10] for key in ("startDate", "endDate",
                                                                       "apprenticeshipEndOverride")}}
        self.confirm(saved, payload["after"])


# --- group -------------------------------------------------------------------------------------

def _day_list(value):
    chosen = {d.strip().casefold() for d in (value if isinstance(value, list) else _s(value).split(",")) if d.strip()}
    return [day for day in DAYS if day.casefold() in chosen]


class UpdateGroup(_EditTool):
    name = "update_group"
    noun = "group"
    description = (
        "Preview changing a delivery group as its LMS edit form does: name, coach and tutor (must match the LMS "
        "directory; empty text unassigns), delivery days, session start/end time (HH:MM, 24-hour) and colour. "
        "Changing days or times moves every module of the group to the new slot; the result lists the Teams "
        "calendars staff must then update in the LMS. Groups are never moved to another cohort, archived or deleted "
        "here. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "group_id": ID, "name": NAME, "coach": {"type": "string", "maxLength": 200},
        "tutor": {"type": "string", "maxLength": 200},
        "week_days": {"type": "array", "maxItems": 7, "items": {"type": "string", "enum": list(DAYS)}},
        "start_time": {"type": "string", "maxLength": 5}, "end_time": {"type": "string", "maxLength": 5},
        "color": COLOR,
    }, "required": ["group_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        record_id = _s(arguments["group_id"])
        record, revision = _snapshot(request, "group", record_id)
        if _archived(record):
            raise ToolError("That group is archived. Restore it in the LMS first.")
        current = {"name": _s(record.get("name")), "coach": _s(record.get("coach")), "tutor": _s(record.get("tutor")),
                   "weekDays": ", ".join(_day_list(record.get("weekDays"))), "startTime": _s(record.get("startTime")),
                   "endTime": _s(record.get("endTime")), "color": _s(record.get("color"))}
        wanted = {}
        if "name" in arguments:
            wanted["name"] = _clean_name(arguments["name"], "group")
            if name_key(wanted["name"]) != name_key(current["name"]):
                _, data = call_api(request, "GET", f"{CURRICULUM}/cohorts/{_s(record.get('cohortId'))}/groups/")
                _refuse_duplicate([r for r in _results(data) if _s(r.get("id")) != record_id], wanted["name"],
                                  "Group", " in this cohort")
        if "coach" in arguments:
            wanted["coach"] = _coach(request, arguments["coach"]) if _s(arguments["coach"]) else ""
        if "tutor" in arguments:
            wanted["tutor"] = _clean_name(arguments["tutor"], "tutor") if _s(arguments["tutor"]) else ""
        if "week_days" in arguments:
            wanted["weekDays"] = ", ".join(_day_list(arguments["week_days"]))
        for arg, key in (("start_time", "startTime"), ("end_time", "endTime")):
            if arg in arguments:
                if not _TIME.fullmatch(_s(arguments[arg])):
                    raise ToolError("Give session times as HH:MM (24-hour).")
                wanted[key] = _s(arguments[arg])
        start, end = wanted.get("startTime", current["startTime"]), wanted.get("endTime", current["endTime"])
        if start and end and end <= start:
            raise ToolError("The end time must be after the start time.")
        if "color" in arguments:
            wanted["color"] = _color(arguments["color"])
        after = {key: value for key, value in wanted.items() if not _same(current[key], value)}
        warnings = (["Every module in this group moves to the new delivery slot. Teams meetings are not changed "
                     "here: update the listed calendars from the LMS Teams Meetings page afterwards."]
                    if {"weekDays", "startTime", "endTime"} & after.keys() else [])
        return self.finish(request, arguments, {k: current.get(k) for k in after}, after,
                           {"record_id": record_id, "label": current["name"], "revision": revision}, warnings)

    def save(self, request, payload):
        _, data = call_api(request, "PATCH", f"{CURRICULUM}/groups/{payload['record_id']}/",
                           json_body={**payload["after"], "expectedRevision": payload["revision"]})
        saved, _ = _snapshot(request, "group", payload["record_id"])
        saved = {**saved, "weekDays": ", ".join(_day_list(saved.get("weekDays")))}
        # The LMS stores staff names as its directory spells them.
        self.confirm(saved, payload["after"], loose=("coach", "tutor"))
        stale = (data or {}).get("teamsCalendarsToUpdate") if isinstance(data, dict) else None
        return {"teams_calendars_to_update": [_s(m.get("moduleName") or m.get("moduleCatalogueId"))
                                              for m in stale or [] if isinstance(m, dict)]}


# --- module and week ---------------------------------------------------------------------------

def _structure(request, module_id):
    """The module as the Module Builder reads it (uncached), refused unless it is an editable draft."""
    module_id = _s(module_id)
    if not re.fullmatch(r"[\w-]+", module_id, re.ASCII) or module_id.startswith("training-module-"):
        raise ToolError("Use find_modules to look up the saved module id.")
    _, module = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/", query={"skipCache": "1"})
    if (not isinstance(module, dict) or _archived(module) or module.get("isDeleted")
            or module.get("status") != "draft"):
        raise ToolError("Only an existing draft module can be changed. Restore an archived one in the LMS first.")
    if _s(module.get("catalogueId") or module.get("moduleCatalogueId")) != module_id:
        raise ToolError("Choose the saved module's own catalogue id, not an alias.")
    revision = _s(module.get("structureRevision"))
    if not revision or revision.lower() == "unavailable":
        raise ToolError("The module's saved version could not be read, so it cannot be changed safely. Try again.")
    return module, revision


def _partial_save(request, module, revision, *, module_changes=None, week_id=None, week_changes=None):
    """The Module Builder's partial structure save: module fields as stored (plus changes), one optional
    changed week, and every week and component in its stored order, so nothing else is added, moved or removed."""
    weeks = module.get("weekStructure") or []
    module_fields = {key: value for key, value in module.items()
                     if key not in ("weekStructure", "weeks", "structureRevision")}
    delta = {
        "weeks": {}, "components": {},
        "weekOrder": [_s(w.get("id")) for w in weeks],
        "componentOrder": {_s(w.get("id")): [_s(c.get("id")) for c in w.get("components") or []] for w in weeks},
    }
    if week_id:
        week = next(w for w in weeks if _s(w.get("id")) == week_id)
        delta["weeks"][week_id] = {**{k: v for k, v in week.items() if k != "components"}, **week_changes}
    body = _without_system_keys({**module_fields, **(module_changes or {}), "weeksNumber": len(weeks),
                                 "saveMode": "partial", "expectedRevision": revision, "structureDelta": delta})
    module_id = _s(module.get("catalogueId") or module.get("moduleCatalogueId"))
    call_api(request, "PATCH", f"{CURRICULUM}/modules/{module_id}/structure/", json_body=body)


class UpdateModule(_EditTool):
    name = "update_module"
    noun = "module"
    description = (
        "Preview changing a draft module as its LMS edit form and Module Builder do: title, description, colour, "
        "start/end dates (YYYY-MM-DD), tutor (empty text unassigns), number of sessions, number of weeks (a smaller "
        "number only removes empty trailing weeks), sale price (free courses only), completion criteria, "
        "intent/learner benefit/employer benefit/sequence purpose, background, EPA requirements and qualification "
        "outcomes (lists of lines). Only what you give changes; weeks and components are kept. Date or session "
        "changes do not move Teams meetings: the result lists the calendars to update in the LMS. Never moves the "
        "module to another programme/cohort/group, archives or publishes it. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "module_id": ID, **{arg: schema for arg, _, schema in MODULE_FIELDS},
        **{arg: schema for arg, _, _, schema in MODULE_GROUPED},
        **{arg: schema for arg, _, schema in MODULE_BUILDER_FIELDS},
    }, "required": ["module_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        module, revision = _structure(request, arguments["module_id"])
        before, after, drawer, builder = {}, {}, {}, {}
        free = is_free_course(module)
        for arg, key, schema in MODULE_FIELDS:
            if arg not in arguments:
                continue
            if key in ("isForSale", "price") and not free:
                raise ToolError("Only a free course has a sale price.")
            value = _value(arg, schema, arguments[arg], arg.replace("_", " "))
            if arg == "title" and not value:
                raise ToolError("Give the module a title.")
            if arg == "color":
                value = _color(value)
            if arg in ("start_date", "end_date"):
                value = _iso_date(value, arg.replace("_", " ")).isoformat()
            stored = _s(module.get(key))[:10] if arg in ("start_date", "end_date") else module.get(key)
            if not _same(stored, value):
                before[key], after[key], drawer[key] = stored, value, value
        start = after.get("startDate", _s(module.get("startDate"))[:10])
        end = after.get("endDate", _s(module.get("endDate"))[:10])
        if start and end and end < start:
            raise ToolError("The end date must not be before the start date.")
        for arg, group, key, schema in MODULE_GROUPED:
            if arg in arguments:
                stored = (module.get(group) or {}).get(key)
                value = _value(arg, schema, arguments[arg], arg.replace("_", " "))
                if not _same(stored, value):
                    before[f"{group}.{key}"], after[f"{group}.{key}"] = stored, value
                    drawer[group] = {**(module.get(group) or {}), **drawer.get(group, {}), key: value}
        for arg, key, schema in MODULE_BUILDER_FIELDS:
            if arg in arguments:
                value = _value(arg, schema, arguments[arg], arg.replace("_", " "))
                if not _same(module.get(key), value):
                    before[key], after[key], builder[key] = module.get(key), value, value
        if "weeksNumber" in drawer:
            drawer["weeks"] = drawer.pop("weeksNumber")  # the drawer's name for the authored week count
        warnings = []
        if {"startDate", "endDate", "sessionsNumber", "weeksNumber"} & after.keys():
            warnings.append("The session dates move with this change. Teams meetings are not changed here: update the "
                            "listed calendars from the LMS Teams Meetings page afterwards.")
        if "weeksNumber" in after and after["weeksNumber"] < len(module.get("weekStructure") or []):
            warnings.append("Fewer weeks: only empty trailing weeks are removed; weeks with content are kept.")
        label = _s(module.get("title"))
        return self.finish(request, arguments, before, after,
                           {"record_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                            "label": label, "revision": revision, "drawer": drawer, "builder": builder}, warnings)

    def save(self, request, payload):
        result = {}
        if payload["drawer"]:
            _, data = call_api(request, "PATCH", f"{CURRICULUM}/modules/{payload['record_id']}/",
                               json_body={**payload["drawer"], "expectedRevision": payload["revision"]})
            stale = (data or {}).get("teamsCalendarsToUpdate") if isinstance(data, dict) else None
            result["teams_calendars_to_update"] = [_s(m.get("moduleName") or m.get("moduleCatalogueId"))
                                                   for m in stale or [] if isinstance(m, dict)]
        if payload["builder"]:
            # Re-read: a drawer save above moved the revision.
            module, revision = _structure(request, payload["record_id"])
            _partial_save(request, module, revision, module_changes=payload["builder"])
        saved, _ = _structure(request, payload["record_id"])
        flat = {**saved, "startDate": _s(saved.get("startDate"))[:10], "endDate": _s(saved.get("endDate"))[:10],
                **{f"{group}.{key}": (saved.get(group) or {}).get(key)
                   for _, group, key, _ in MODULE_GROUPED}}
        self.confirm(flat, payload["after"])
        return result


class UpdateWeek(_EditTool):
    name = "update_week"
    noun = "week"
    description = (
        "Preview changing a week of a draft module as the Module Builder does: title, summary, learning outcomes "
        "(a list of lines), and the holiday note and whether learners see it. Its components and every other week "
        "are kept exactly as they are. Use list_module_weeks for the week_id. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "module_id": ID, "week_id": ID, **{arg: schema for arg, _, schema in WEEK_FIELDS},
    }, "required": ["module_id", "week_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        module, revision = _structure(request, arguments["module_id"])
        week_id = _s(arguments["week_id"])
        week = next((w for w in module.get("weekStructure") or [] if _s(w.get("id")) == week_id), None)
        if week is None:
            raise ToolError("That week is not in this module. Use list_module_weeks to find its id.")
        before, after = {}, {}
        for arg, key, schema in WEEK_FIELDS:
            if arg in arguments:
                value = _value(arg, schema, arguments[arg], arg.replace("_", " "))
                if arg == "title" and not value:
                    raise ToolError("Give the week a title.")
                if not _same(week.get(key), value):
                    before[key], after[key] = week.get(key), value
        label = f"{_s(module.get('title'))} › {_s(week.get('title')) or 'Week ' + _s(week.get('weekNumber'))}"
        return self.finish(request, arguments, before, after,
                           {"record_id": week_id, "label": label, "revision": revision,
                            "module_id": _s(module.get("catalogueId") or module.get("moduleCatalogueId"))})

    def save(self, request, payload):
        module, revision = _structure(request, payload["module_id"])
        _partial_save(request, module, revision, week_id=payload["record_id"], week_changes=payload["after"])
        saved, _ = _structure(request, payload["module_id"])
        week = next((w for w in saved.get("weekStructure") or [] if _s(w.get("id")) == payload["record_id"]), {})
        self.confirm(week, payload["after"])


for _tool in (UpdateProgramme(), UpdateCohort(), UpdateGroup(), UpdateModule(), UpdateWeek()):
    register_write_tool(_tool)
