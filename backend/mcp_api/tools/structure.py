"""Step 10: create a programme, cohort, group or module skeleton. Never updates or deletes.

The LMS create endpoints are upserts in disguise, so every tool guards against that:

- ``POST programmes/``, ``POST programmes/<id>/cohorts/`` and ``POST cohorts/<id>/groups/``
  update an existing live record with the same (normalised) name in place and answer
  ``created: false`` -- a cohort upsert even blanks its start date. ``POST modules/`` returns an
  existing module of the same title (``existing: true``) and can create a programme by name.
- So each tool refuses a name already used in its scope (the LMS's own normalisation:
  lower case, letters and digits only), re-checks at apply (race), sends explicit parent ids
  and names, never sends client ids, and accepts only a ``201 created: true`` answer.
  Anything else raises inside the default-DB transaction, which rolls the write back.

Status: programmes have no not-live state (the LMS maps draft/planned to active); a cohort's
status follows its dates; a new group is always ``planned``; a module is ``draft``. A module
placed in a group is seen by that group's learners (roster ``inherited``), so the preview says so.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import DispatchError, call_api
from ..settings import structure_creation_enabled
from . import ToolError, ToolResult, tool
from .read import CURRICULUM, _QUERY, _archived, _capped, _count_note, _programme_by_id, _results, _s

NAME = {"type": "string", "minLength": 1, "maxLength": 200}
ID = {"type": "string", "minLength": 1, "maxLength": 200}
DAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
_TIME = re.compile(r"([01]\d|2[0-3]):[0-5]\d")


def name_key(value):
    """The LMS's duplicate-name key: lower case, letters and digits only."""
    return re.sub(r"[^a-z0-9]", "", _s(value).lower())


def _enabled():
    if not structure_creation_enabled():
        raise ToolError("MCP structure creation is not enabled. Ask an administrator to enable the structure pilot.")


def _clean_name(value, what):
    name = " ".join(_s(value).split())
    if not name or re.search(r"[<>]", name):
        raise ToolError(f"Give the {what} a plain-text name.")
    return name


def _refuse_duplicate(rows, name, what, scope, field="name"):
    key = name_key(name)
    clash = next((row for row in rows if not _archived(row) and name_key(row.get(field)) == key), None)
    if clash:
        raise ToolError(f"{what} '{_s(clash.get(field))}' already exists{scope} (id {_s(clash.get('id') or clash.get('moduleCatalogueId'))}). "
                        "Use it instead of creating another.")


def _created(status, data, key):
    """The created record from a create response, or raise: anything but 201 created:true rolls back."""
    record = data.get(key) if isinstance(data, dict) else None
    if status != 201 or not isinstance(data, dict) or data.get("created") is not True or data.get("existing"):
        raise ToolError(f"The LMS matched an existing {key} instead of creating a new one, so nothing was saved.")
    if key != "module" and (not isinstance(record, dict) or not _s(record.get("id"))):
        raise ToolError(f"The LMS did not confirm the new {key}, so nothing was saved.")
    return record


class _StructureTool(WriteTool):
    """Shared apply: re-validate (duplicate race), then ``self.create`` inside one default-DB transaction."""

    def apply(self, request, payload, progress):
        progress.uncertain("Creating it; check the LMS before trying again.")
        try:
            with transaction.atomic(using="default"):
                recheck = self.validate(request, payload)
                if recheck.errors or recheck.payload != payload:
                    raise ToolError("Something with that name was created, or the parent changed, since the preview. "
                                    "Prepare a new preview.")
                outcome = self.create(request, payload)
        except (ToolError, DispatchError) as exc:
            progress.uncertain_steps.clear()
            if isinstance(exc, DispatchError):
                raise ToolError(f"{exc} Nothing was saved; prepare a new preview.") from None
            raise
        progress.uncertain_steps.clear()
        progress.done(outcome["summary"], **outcome["result"])
        return outcome


# --- programmes ------------------------------------------------------------------------------

@tool("list_ksb_standards",
      "List the Skills England apprenticeship standards a new programme can use, by name or reference "
      "(e.g. ST0122). Returns each standard's id to pass to create_programme.",
      {"type": "object", "properties": {"query": _QUERY}, "additionalProperties": False})
def list_ksb_standards(request, arguments):
    _, data = call_api(request, "GET", f"{CURRICULUM}/standards/")
    query = _s(arguments.get("query")).casefold()
    rows = [row for row in _results(data)
            if not query or query in f"{_s(row.get('name'))} {_s(row.get('standardRef'))} {_s(row.get('code'))}".casefold()]
    shown, total = _capped(rows)
    items = [{"standard_id": _s(r.get("id")), "reference": _s(r.get("standardRef") or r.get("code")),
              "name": _s(r.get("name")), "level": r.get("levelValue") or _s(r.get("level")),
              "version": _s(r.get("version")), "ksb_count": r.get("total")} for r in shown]
    lines = [_count_note(len(items), total, "standards")]
    lines += [f"- {i['reference']} {i['name']} (level {i['level']}, v{i['version']}; standard_id {i['standard_id']})"
              for i in items]
    return ToolResult("\n".join(lines), {"standards": items, "total": total})


class CreateProgramme(_StructureTool):
    name = "create_programme"
    description = (
        "Preview creating a new programme. Refused if a programme with the same name exists (it would otherwise be "
        "overwritten). Optional standard_id from list_ksb_standards applies a KSB standard. Note: programmes have "
        "no draft state in the LMS. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "name": NAME, "level": {"type": "integer", "minimum": 1, "maximum": 8},
        "description": {"type": "string", "maxLength": 5000}, "standard_id": ID,
    }, "required": ["name"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        name = _clean_name(arguments.get("name"), "programme")
        _, data = call_api(request, "GET", f"{CURRICULUM}/programmes/", query={"visibility": "all"})
        _refuse_duplicate(_results(data), name, "Programme", "")
        standard = None
        if arguments.get("standard_id"):
            standard_id = _s(arguments["standard_id"])
            if not re.fullmatch(r"[\w.-]+", standard_id):
                raise ToolError("Use a standard_id from list_ksb_standards.")
            _, standard = call_api(request, "GET", f"{CURRICULUM}/standards/{standard_id}/")
            if not isinstance(standard, dict) or _s(standard.get("id")) != standard_id:
                raise ToolError("That standard was not found. Use list_ksb_standards.")
        warnings = [] if standard else ["No KSB standard: quizzes cannot be KSB-mapped until one is applied."]
        return Validation({
            "name": name, "description": _s(arguments.get("description")),
            **({"level": arguments["level"]} if "level" in arguments else {}),
            **({"standard_id": _s(standard["id"]), "standard_name": _s(standard.get("name"))} if standard else {}),
        }, warnings=warnings)

    def preview(self, request, payload):
        standard = f", standard {payload['standard_name']}" if payload.get("standard_id") else ", no KSB standard"
        level = f", level {payload['level']}" if payload.get("level") else ""
        return {"summary": f"Create programme '{payload['name']}'{level}{standard}.",
                "details": {**payload, "note": "Programmes have no draft state: it is visible in the LMS at once, "
                                               "with no cohorts or modules yet."}}

    def create(self, request, payload):
        source = f"standard:{payload['standard_id']}" if payload.get("standard_id") else ""
        body = {"name": payload["name"], "description": payload["description"],
                "level": f"LVL-{payload['level']}" if payload.get("level") else "",
                **({"ksbProfileSourceId": source} if source else {})}
        status, data = call_api(request, "POST", f"{CURRICULUM}/programmes/", json_body=body)
        programme = _created(status, data, "programme")
        if source and _s(programme.get("ksbProfileSourceId")) != source:
            raise ToolError("The LMS did not confirm the KSB standard, so nothing was saved.")
        return {"summary": f"Created programme '{payload['name']}'.", "result": {"programme_id": _s(programme["id"])}}


# --- cohorts -----------------------------------------------------------------------------------

def _iso_date(value, what):
    try:
        return date.fromisoformat(_s(value))
    except ValueError:
        raise ToolError(f"Give the {what} as YYYY-MM-DD.") from None


class CreateCohort(_StructureTool):
    name = "create_cohort"
    description = (
        "Preview creating a cohort in an existing programme: name, start date (YYYY-MM-DD) and length in months "
        "(default 24). The preview shows the end date the LMS will calculate. Refused if the programme already has "
        "a cohort with that name. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "name": NAME, "start_date": {"type": "string", "minLength": 10, "maxLength": 10},
        "duration_months": {"type": "integer", "minimum": 1, "maximum": 72},
        "epa_months": {"type": "integer", "minimum": 0, "maximum": 24},
    }, "required": ["programme_id", "name", "start_date"], "additionalProperties": False}

    def validate(self, request, arguments):
        from curriculum_api.views import cohort_practical_end_date

        _enabled()
        programme = _programme_by_id(request, arguments.get("programme_id"))
        if _archived(programme):
            raise ToolError("That programme is archived. Choose an active programme.")
        programme_id = _s(programme.get("id"))
        name = _clean_name(arguments.get("name"), "cohort")
        _, data = call_api(request, "GET", f"{CURRICULUM}/programmes/{programme_id}/cohorts/")
        _refuse_duplicate(_results(data), name, "Cohort", f" in {programme.get('name')}")
        start = _iso_date(arguments.get("start_date"), "start date")
        months = arguments.get("duration_months", 24)
        end = cohort_practical_end_date(start.isoformat(), months)
        if not end or _iso_date(str(end), "end date") <= start:
            raise ToolError("The LMS could not calculate an end date after that start date.")
        warnings = ["The start date is more than a year in the past."] if start < date.today() - timedelta(days=365) else []
        return Validation({"programme_id": programme_id, "programme_name": _s(programme.get("name")), "name": name,
                           "start_date": start.isoformat(), "duration_months": months, "end_date": str(end),
                           **({"epa_months": arguments["epa_months"]} if "epa_months" in arguments else {})},
                          warnings=warnings)

    def preview(self, request, payload):
        return {"summary": f"Create cohort '{payload['name']}' in {payload['programme_name']}: {payload['start_date']} "
                           f"to {payload['end_date']} ({payload['duration_months']} months).",
                "details": {**payload, "note": "Its status follows its dates (planned until it starts)."}}

    def create(self, request, payload):
        body = {"name": payload["name"], "programmeId": payload["programme_id"], "startDate": payload["start_date"],
                "durationMonths": payload["duration_months"],
                **({"epaMonths": payload["epa_months"]} if "epa_months" in payload else {})}
        status, data = call_api(request, "POST", f"{CURRICULUM}/programmes/{payload['programme_id']}/cohorts/",
                                json_body=body)
        cohort = _created(status, data, "cohort")
        if _s(cohort.get("startDate"))[:10] != payload["start_date"] or _s(cohort.get("endDate"))[:10] != payload["end_date"]:
            raise ToolError("The LMS saved different dates from the preview, so nothing was saved.")
        return {"summary": f"Created cohort '{payload['name']}'.", "result": {"cohort_id": _s(cohort["id"])}}


# --- groups ------------------------------------------------------------------------------------

def _cohort(request, programme_id, cohort_id):
    programme = _programme_by_id(request, programme_id)
    _, data = call_api(request, "GET", f"{CURRICULUM}/programmes/{_s(programme.get('id'))}/cohorts/")
    cohort = next((row for row in _results(data) if _s(row.get("id")) == _s(cohort_id)), None)
    if cohort is None or _archived(cohort):
        raise ToolError("Choose an active cohort of that programme (use find_cohorts_groups).")
    return programme, cohort


def _coach(request, wanted):
    """The one coach whose directory name matches exactly (case and spacing ignored), else refuse."""
    _, data = call_api(request, "GET", f"{CURRICULUM}/coaches/")
    coaches = [_s(row.get("name")) for row in _results(data) if _s(row.get("name"))]
    key = " ".join(_s(wanted).split()).casefold()
    exact = sorted({c for c in coaches if " ".join(c.split()).casefold() == key})
    if len(exact) == 1:
        return exact[0]
    similar = sorted({c for c in coaches if key and key.split()[0] in c.casefold()})[:10]
    reason = "matches more than one coach" if exact else "is not a coach in the LMS"
    raise ToolError(f"'{wanted}' {reason}." + (f" Candidates: {', '.join(similar)}." if similar else ""))


class CreateGroup(_StructureTool):
    name = "create_group"
    description = (
        "Preview creating a delivery group in an existing cohort: name, optional coach (must match exactly one "
        "coach in the LMS), delivery days and session times (HH:MM, 24-hour). New groups are 'planned'. Refused if "
        "the cohort already has a group with that name. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "cohort_id": ID, "name": NAME, "coach": {"type": "string", "maxLength": 200},
        "week_days": {"type": "array", "maxItems": 7, "items": {"type": "string", "enum": list(DAYS)}},
        "start_time": {"type": "string", "maxLength": 5}, "end_time": {"type": "string", "maxLength": 5},
    }, "required": ["programme_id", "cohort_id", "name"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        programme, cohort = _cohort(request, arguments.get("programme_id"), arguments.get("cohort_id"))
        name = _clean_name(arguments.get("name"), "group")
        _, data = call_api(request, "GET", f"{CURRICULUM}/cohorts/{_s(cohort.get('id'))}/groups/")
        _refuse_duplicate(_results(data), name, "Group", f" in cohort {cohort.get('name')}")
        times = [_s(arguments.get(k)) for k in ("start_time", "end_time")]
        if any(times) and not all(_TIME.fullmatch(t) for t in times):
            raise ToolError("Give both start_time and end_time as HH:MM (24-hour).")
        if all(times) and times[1] <= times[0]:
            raise ToolError("The end time must be after the start time.")
        coach = _coach(request, arguments["coach"]) if _s(arguments.get("coach")) else ""
        days = [d for d in DAYS if d in set(arguments.get("week_days") or [])]
        return Validation({"programme_id": _s(programme.get("id")), "cohort_id": _s(cohort.get("id")),
                           "cohort_name": _s(cohort.get("name")), "name": name, "coach": coach, "week_days": days,
                           "start_time": times[0], "end_time": times[1]})

    def preview(self, request, payload):
        when = ", ".join(payload["week_days"]) or "no days set"
        if payload["start_time"]:
            when += f" {payload['start_time']}–{payload['end_time']}"
        return {"summary": f"Create group '{payload['name']}' in cohort {payload['cohort_name']}: coach "
                           f"{payload['coach'] or 'unassigned'}, {when}. Status planned.", "details": payload}

    def create(self, request, payload):
        body = {"name": payload["name"], "coach": payload["coach"], "weekDays": ", ".join(payload["week_days"]),
                "startTime": payload["start_time"], "endTime": payload["end_time"]}
        status, data = call_api(request, "POST", f"{CURRICULUM}/cohorts/{payload['cohort_id']}/groups/", json_body=body)
        group = _created(status, data, "group")
        return {"summary": f"Created group '{payload['name']}'.", "result": {"group_id": _s(group["id"])}}


# --- modules -----------------------------------------------------------------------------------

class CreateModule(_StructureTool):
    name = "create_module"
    description = (
        "Preview creating a new draft module in a programme, optionally placed in one of its cohort groups, with a "
        "number of empty weeks (then use create_week / create_curriculum_component to fill it). Refused if the "
        "programme already has a module with that title. A module placed in a group is seen by that group's "
        "learners. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "cohort_id": ID, "group_id": ID, "title": NAME,
        "description": {"type": "string", "maxLength": 5000}, "weeks": {"type": "integer", "minimum": 0, "maximum": 52},
    }, "required": ["programme_id", "title"], "additionalProperties": False}

    def validate(self, request, arguments):
        _enabled()
        title = _clean_name(arguments.get("title"), "module")
        if bool(arguments.get("cohort_id")) != bool(arguments.get("group_id")):
            raise ToolError("Give both cohort_id and group_id to place the module in a group, or neither.")
        if arguments.get("cohort_id"):
            programme, cohort = _cohort(request, arguments.get("programme_id"), arguments["cohort_id"])
            _, data = call_api(request, "GET", f"{CURRICULUM}/cohorts/{_s(cohort.get('id'))}/groups/")
            group = next((g for g in _results(data) if _s(g.get("id")) == _s(arguments["group_id"])), None)
            if group is None or _archived(group):
                raise ToolError("Choose an active group of that cohort (use find_cohorts_groups).")
        else:
            programme, cohort, group = _programme_by_id(request, arguments.get("programme_id")), {}, {}
            if _archived(programme):
                raise ToolError("That programme is archived. Choose an active programme.")
        programme_id = _s(programme.get("id"))
        _, data = call_api(request, "GET", f"{CURRICULUM}/modules/", query={"compact": "1", "visibility": "all"})
        in_programme = [r for r in _results(data) if _s(r.get("programmeId")) == programme_id]
        _refuse_duplicate(in_programme, title, "Module", f" in {programme.get('name')}", field="name")
        _refuse_duplicate(in_programme, title, "Module", f" in {programme.get('name')}", field="title")
        warnings = ([f"Learners in group {group.get('name')} will see this module (with empty weeks) once created."]
                    if group else [])
        return Validation({"programme_id": programme_id, "programme_name": _s(programme.get("name")),
                           "cohort_id": _s(cohort.get("id")), "cohort_name": _s(cohort.get("name")),
                           "group_id": _s(group.get("id")), "group_name": _s(group.get("name")), "title": title,
                           "description": _s(arguments.get("description")), "weeks": arguments.get("weeks", 0)},
                          warnings=warnings)

    def preview(self, request, payload):
        where = f" › {payload['cohort_name']} › {payload['group_name']}" if payload["group_id"] else " (no group yet)"
        return {"summary": f"Create draft module '{payload['title']}' in {payload['programme_name']}{where} with "
                           f"{payload['weeks']} empty week(s).", "details": payload}

    def create(self, request, payload):
        body = {
            "title": payload["title"], "moduleType": "authoring", "sourceType": "authoring",
            "description": payload["description"], "status": "draft", "learnerRosterMode": "inherited",
            "duplicateDestination": False, "programmeId": payload["programme_id"],
            "programme": payload["programme_name"], "programmeName": payload["programme_name"],
            "cohortId": payload["cohort_id"], "cohortName": payload["cohort_name"],
            "groupId": payload["group_id"], "groupName": payload["group_name"],
            "weeksNumber": payload["weeks"],
            "weekStructure": [{"weekNumber": n, "title": f"Week {n}", "summary": "", "learningOutcomes": [],
                               "components": [], "ksbMappings": []} for n in range(1, payload["weeks"] + 1)],
        }
        status, data = call_api(request, "POST", f"{CURRICULUM}/modules/", json_body=body)
        _created(status, data, "module")
        module_id = _s(data.get("moduleCatalogueId"))
        if not module_id:
            raise ToolError("The LMS did not confirm the new module, so nothing was saved.")
        return {"summary": f"Created draft module '{payload['title']}'.", "result": {"module_id": module_id}}


for _tool in (CreateProgramme(), CreateCohort(), CreateGroup(), CreateModule()):
    register_write_tool(_tool)
