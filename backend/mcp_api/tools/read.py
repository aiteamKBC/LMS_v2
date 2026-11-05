"""Step 6: read-only tools. The assistant finds where content goes and which KSBs are allowed.

Every tool reads through ``dispatch.call_api`` -- the same GET endpoints the LMS
screens use, as the token's account -- except where noted:

- ``list_standard_ksbs`` reads the programme's applied source with
  ``learner_api.ksb_sources.resolve_source``, the resolver every other KSB consumer
  uses. The source id always comes from the programme record on the server, never
  from the tool arguments.
- ``get_quiz`` counts attempts on ``LearnerProgressEntry`` (a count only, never who).
- ``search_books`` calls ``knowledge_base.retrieval.plan``, the quiz generator's own
  retrieval, and is limited to 10 searches a minute (the topic lookup is a paid
  embedding call, SECURITY_AUDIT A11).

Outputs are cut down to ids, names, codes, counts, statuses and dates. Archived
items are left out unless ``include_archived`` is true. Name searches return at
most 20 matches with the total, and never guess between them.
"""
from __future__ import annotations

from ..dispatch import call_api
from . import ToolError, ToolResult, tool

MAX_RESULTS = 20
PASSAGE_CHARS = 1200

CURRICULUM = "/curriculum_api/curriculum"
ARCHIVED_STATUSES = {"archived", "trash", "deleted", "withdrawn"}


def _s(value):
    return "" if value is None else str(value).strip()


def _results(data):
    if isinstance(data, dict):
        rows = data.get("results")
        if isinstance(rows, list):
            return rows
    return []


def _archived(row):
    status = _s(row.get("status")).lower()
    return bool(row.get("isArchived")) or bool(row.get("isProgrammeDeleted")) or status in ARCHIVED_STATUSES


def _matches(row, query, *fields):
    if not query:
        return True
    needle = query.casefold()
    return any(needle in _s(row.get(field)).casefold() for field in fields)


def _capped(rows):
    return rows[:MAX_RESULTS], len(rows)


def _count_note(shown, total, noun):
    if total == 0:
        return f"No {noun} found."
    if total > shown:
        return f"Showing {shown} of {total} {noun}; narrow the search to see the rest."
    return f"{total} {noun} found."


_QUERY = {"type": "string", "maxLength": 120}
_ID = {"type": "string", "minLength": 1, "maxLength": 200}
_ARCHIVED = {"type": "boolean"}


# --- programmes ---------------------------------------------------------------------------

def _programmes(request, include_archived=False):
    _status, data = call_api(request, "GET", f"{CURRICULUM}/programmes/",
                             query={"visibility": "all"} if include_archived else None)
    rows = _results(data)
    return rows if include_archived else [row for row in rows if not _archived(row)]


def _programme_by_id(request, programme_id):
    wanted = _s(programme_id)
    for row in _programmes(request, include_archived=True):
        if wanted in {_s(row.get("id")), _s(row.get("sourceId"))}:
            return row
    raise ToolError(f"No programme has the id {wanted!r}. Use find_programmes to look it up.")


def _programme_out(row):
    source = _s(row.get("ksbProfileSourceId"))
    return {
        "programme_id": _s(row.get("id")),
        "name": _s(row.get("name")),
        "level": _s(row.get("level")),
        "status": _s(row.get("status")),
        "modules": row.get("modules"),
        "cohorts": row.get("cohorts"),
        "applied_ksb_source": source or None,
    }


@tool("find_programmes",
      "Find programmes by name. Returns each programme's id, level, status and the KSB standard applied to it. "
      "Use the programme_id it returns in other tools.",
      {"type": "object", "properties": {"query": _QUERY, "include_archived": _ARCHIVED},
       "additionalProperties": False})
def find_programmes(request, arguments):
    query = _s(arguments.get("query"))
    rows = [row for row in _programmes(request, bool(arguments.get("include_archived")))
            if _matches(row, query, "name", "id")]
    rows.sort(key=lambda row: _s(row.get("name")).casefold())
    shown, total = _capped(rows)
    items = [_programme_out(row) for row in shown]
    lines = [_count_note(len(items), total, "programmes")]
    for item in items:
        standard = item["applied_ksb_source"] or "no KSB standard applied yet (quizzes can't be KSB-mapped)"
        lines.append(f"- {item['name']} (id {item['programme_id']}, {item['status'] or 'no status'}; {standard})")
    return ToolResult("\n".join(lines), {"programmes": items, "total": total})


# --- cohorts and groups --------------------------------------------------------------------

def _group_out(row):
    return {
        "group_id": _s(row.get("id")),
        "name": _s(row.get("name")),
        "coach": _s(row.get("coach")),
        "weekdays": _s(row.get("weekDays")),
        "start_time": _s(row.get("startTime")),
        "end_time": _s(row.get("endTime")),
        "status": _s(row.get("status")),
    }


@tool("find_cohorts_groups",
      "List a programme's cohorts and, for each cohort, its groups (with the coach's name and delivery days).",
      {"type": "object", "properties": {"programme_id": _ID, "include_archived": _ARCHIVED},
       "required": ["programme_id"], "additionalProperties": False})
def find_cohorts_groups(request, arguments):
    programme = _programme_by_id(request, arguments["programme_id"])
    include_archived = bool(arguments.get("include_archived"))
    _status, data = call_api(request, "GET", f"{CURRICULUM}/programmes/{_s(programme.get('id'))}/cohorts/")
    cohorts = [row for row in _results(data) if include_archived or not _archived(row)]
    cohorts.sort(key=lambda row: (_s(row.get("startDate")), _s(row.get("name")).casefold()))
    shown, total = _capped(cohorts)
    out = []
    for cohort in shown:
        _status, gdata = call_api(request, "GET", f"{CURRICULUM}/cohorts/{_s(cohort.get('id'))}/groups/")
        groups = [_group_out(g) for g in _results(gdata) if include_archived or not _archived(g)]
        out.append({
            "cohort_id": _s(cohort.get("id")),
            "name": _s(cohort.get("name")),
            "start_date": _s(cohort.get("startDate")),
            "end_date": _s(cohort.get("endDate")),
            "status": _s(cohort.get("status")),
            "groups": groups,
        })
    lines = [f"{programme.get('name')}: " + _count_note(len(out), total, "cohorts")]
    for cohort in out:
        lines.append(f"- {cohort['name']} (id {cohort['cohort_id']}, {cohort['start_date']} to {cohort['end_date']}, "
                     f"{cohort['status']}) — {len(cohort['groups'])} group(s)")
        for group in cohort["groups"]:
            lines.append(f"    - {group['name']} (id {group['group_id']}, coach {group['coach'] or 'unassigned'}, "
                         f"{group['weekdays'] or 'no days set'})")
    return ToolResult("\n".join(lines), {"programme_id": _s(programme.get("id")), "cohorts": out, "total": total})


# --- modules -----------------------------------------------------------------------------

def _module_id(row):
    return _s(row.get("moduleCatalogueId") or row.get("catalogueId") or row.get("moduleId") or row.get("id"))


def _module_out(row):
    return {
        "module_id": _module_id(row),
        "name": _s(row.get("name") or row.get("title")),
        "programme": _s(row.get("programme")),
        "programme_id": _s(row.get("programmeId")),
        "cohort": _s(row.get("cohort")),
        "group": _s(row.get("group")),
        "status": _s(row.get("authoringStatus") or row.get("status")),
        "weeks": row.get("weeks"),
        "quizzes": row.get("quizzes"),
        "ksb_count": row.get("ksbCount"),
    }


@tool("find_modules",
      "Find modules by name, optionally within one programme. Returns each module's id, programme, cohort, group, "
      "status and counts. Use the module_id it returns in other tools.",
      {"type": "object", "properties": {"programme_id": _ID, "query": _QUERY, "include_archived": _ARCHIVED},
       "additionalProperties": False})
def find_modules(request, arguments):
    include_archived = bool(arguments.get("include_archived"))
    query = {"compact": "1"}
    if include_archived:
        query["visibility"] = "all"
    _status, data = call_api(request, "GET", f"{CURRICULUM}/modules/", query=query)
    rows = [row for row in _results(data) if include_archived or not _archived(row)]
    programme_id = _s(arguments.get("programme_id"))
    if programme_id:
        programme = _programme_by_id(request, programme_id)
        ids = {_s(programme.get("id")), _s(programme.get("sourceId"))} - {""}
        rows = [row for row in rows if _s(row.get("programmeId")) in ids
                or _s(row.get("programme")).casefold() == _s(programme.get("name")).casefold()]
    rows = [row for row in rows if _matches(row, _s(arguments.get("query")), "name", "title")]
    rows.sort(key=lambda row: (_s(row.get("programme")).casefold(), _s(row.get("name")).casefold()))
    shown, total = _capped(rows)
    items = [_module_out(row) for row in shown]
    lines = [_count_note(len(items), total, "modules")]
    for item in items:
        where = " › ".join(part for part in (item["programme"], item["cohort"], item["group"]) if part)
        lines.append(f"- {item['name']} (id {item['module_id']}, {item['status'] or 'no status'}"
                     f"{', ' + where if where else ''})")
    return ToolResult("\n".join(lines), {"modules": items, "total": total})


def _component_out(component):
    settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
    quiz_id = settings.get("linkedQuizId") or settings.get("linked_quiz_id")
    return {
        "component_id": _s(component.get("id")),
        "title": _s(component.get("title")),
        "type": _s(component.get("type")),
        "linked_quiz_id": _s(quiz_id) or None,
        "ksb_codes": sorted({_s(m.get("code")) for m in component.get("ksbMappings") or [] if _s(m.get("code"))}),
    }


@tool("get_module_structure",
      "Show a module's weeks and the components in each week (lessons, quizzes, files), with linked quizzes and "
      "KSB codes. Use it to find the week_id and component_id for a change.",
      {"type": "object", "properties": {"module_id": _ID}, "required": ["module_id"], "additionalProperties": False})
def get_module_structure(request, arguments):
    module_id = _s(arguments["module_id"])
    _status, data = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/")
    if not isinstance(data, dict):
        raise ToolError("The LMS returned no structure for that module.")
    weeks = []
    for week in data.get("weekStructure") or []:
        weeks.append({
            "week_id": _s(week.get("id")),
            "week_number": week.get("weekNumber"),
            "title": _s(week.get("title")),
            "components": [_component_out(c) for c in week.get("components") or []],
        })
    module = {
        "module_id": _s(data.get("moduleCatalogueId") or module_id),
        "title": _s(data.get("title")),
        "programme": _s(data.get("programmeName")),
        "programme_id": _s(data.get("programmeId")),
        "cohort": _s(data.get("cohort")),
        "group": _s(data.get("group")),
        "status": _s(data.get("status")),
        "applied_ksb_source": _s(data.get("ksbProfileSourceId")) or None,
    }
    lines = [f"{module['title']} (id {module['module_id']}, {module['status']}) — {len(weeks)} week(s)"]
    for week in weeks:
        lines.append(f"- Week {week['week_number']}: {week['title']} (week_id {week['week_id']})")
        for c in week["components"]:
            extra = []
            if c["linked_quiz_id"]:
                extra.append(f"quiz {c['linked_quiz_id']}")
            if c["ksb_codes"]:
                extra.append("KSBs " + ", ".join(c["ksb_codes"]))
            lines.append(f"    - [{c['type']}] {c['title']} (component_id {c['component_id']})"
                         + (f" — {'; '.join(extra)}" if extra else ""))
    return ToolResult("\n".join(lines), {"module": module, "weeks": weeks})


# --- KSBs ----------------------------------------------------------------------------------

def _resolve_source(value):
    from learner_api.ksb_sources import resolve_source

    return resolve_source(value)


@tool("list_standard_ksbs",
      "List the only KSB codes allowed for a programme: those of the standard (or profile) applied to it, with "
      "their descriptions. Never use a KSB code that is not in this list.",
      {"type": "object", "properties": {
          "programme_id": _ID,
          "type": {"type": "string", "enum": ["K", "S", "B"]},
          "query": _QUERY,
      }, "required": ["programme_id"], "additionalProperties": False})
def list_standard_ksbs(request, arguments):
    programme = _programme_by_id(request, arguments["programme_id"])
    source_value = _s(programme.get("ksbProfileSourceId"))
    if not source_value:
        raise ToolError(f"{programme.get('name')} has no KSB standard applied yet, so it has no allowed KSB codes. "
                        "Apply a standard to the programme in the LMS first.")
    source = _resolve_source(source_value)
    if not source.items:
        raise ToolError(f"The KSB source applied to {programme.get('name')} ({source_value}) has no KSBs the LMS "
                        "can read. Check it in the LMS.")
    wanted_type = _s(arguments.get("type")).upper()
    query = _s(arguments.get("query"))
    items = []
    for item in source.items:
        code = _s(item.get("code"))
        row = {"code": code, "type": _s(item.get("type")),
               "description": _s(item.get("description") or item.get("title"))}
        if wanted_type and row["type"] != wanted_type:
            continue
        if query and query.casefold() not in f"{code} {row['description']}".casefold():
            continue
        items.append(row)
    label = source.label or source.source_id or source_value
    lines = [f"{programme.get('name')} uses {label}: {len(items)} KSB(s)"
             + (" matching your filter" if wanted_type or query else "") + "."]
    lines += [f"- {row['code']}: {row['description']}" for row in items]
    return ToolResult("\n".join(lines), {
        "programme_id": _s(programme.get("id")),
        "source": {"kind": source.kind, "id": source.source_id or source_value, "label": label},
        "ksbs": items,
    })


@tool("ksb_coverage",
      "Show which KSBs a programme or a module covers and which are gaps (no activity mapped to them yet). "
      "Give either programme_id or module_id.",
      {"type": "object", "properties": {"programme_id": _ID, "module_id": _ID}, "additionalProperties": False})
def ksb_coverage(request, arguments):
    programme_id, module_id = _s(arguments.get("programme_id")), _s(arguments.get("module_id"))
    if bool(programme_id) == bool(module_id):
        raise ToolError("Give exactly one of programme_id or module_id.")
    if programme_id:
        programme = _programme_by_id(request, programme_id)
        scope, ident, name = "programmes", _s(programme.get("id")), _s(programme.get("name"))
    else:
        scope, ident, name = "modules", module_id, f"module {module_id}"
    _status, data = call_api(request, "GET", f"{CURRICULUM}/{scope}/{ident}/ksb-coverage/")
    covered, gaps = [], []
    for item in (data or {}).get("items") or []:
        code = _s(item.get("code"))
        if not code:
            continue
        count = int(item.get("mappingCount") or 0)
        if count:
            covered.append({"code": code, "mappings": count, "components": int(item.get("componentCount") or 0)})
        else:
            gaps.append({"code": code, "description": _s(item.get("description") or item.get("title"))})
    lines = [f"KSB coverage for {name}: {len(covered)} covered, {len(gaps)} gap(s)."]
    if gaps:
        lines.append("Gaps (nothing mapped yet):")
        lines += [f"- {gap['code']}: {gap['description']}" for gap in gaps]
    if covered:
        lines.append("Covered: " + ", ".join(f"{c['code']} ({c['mappings']})" for c in covered))
    return ToolResult("\n".join(lines), {"scope": scope[:-1], "id": ident, "covered": covered, "gaps": gaps})


# --- quizzes -------------------------------------------------------------------------------

def _attempt_count(quiz_id):
    from learner_api.models import LearnerProgressEntry

    return LearnerProgressEntry.objects.filter(kind="quiz", quiz_ref=str(quiz_id)).count()


@tool("get_quiz",
      "Show a quiz: its settings, questions, answers (with which are correct) and how many learner attempts it has. "
      "A quiz with attempts must not be edited in place.",
      {"type": "object", "properties": {"quiz_id": {"type": "integer", "minimum": 1}},
       "required": ["quiz_id"], "additionalProperties": False})
def get_quiz(request, arguments):
    quiz_id = arguments["quiz_id"]
    _status, data = call_api(request, "GET", f"/quiz_api/quizzes/{quiz_id}/preview/")
    quiz = (data or {}).get("quiz") or {}
    questions = []
    for question in (data or {}).get("questions") or []:
        questions.append({
            "question_id": question.get("id"),
            "type": _s(question.get("questionType")),
            "text": _s(question.get("text")),
            "explanation": _s(question.get("explanation")),
            "answers": [{"text": _s(a.get("text")), "is_correct": bool(a.get("isCorrect"))}
                        for a in question.get("answers") or []],
        })
    attempts = _attempt_count(quiz_id)
    out = {
        "quiz_id": quiz.get("id", quiz_id),
        "title": _s(quiz.get("title")),
        "status": _s(quiz.get("status")),
        "version": _s(quiz.get("version")),
        "programme": _s(quiz.get("programme")),
        "module": _s(quiz.get("module")),
        "passing_grade": quiz.get("passingGrade"),
        "question_count": len(questions),
        "attempt_count": attempts,
        "questions": questions,
    }
    note = ("It has learner attempts, so it must not be edited in place." if attempts
            else "No learner has attempted it yet.")
    lines = [f"Quiz {out['quiz_id']}: {out['title']} ({out['status']}), {len(questions)} question(s), "
             f"{attempts} attempt(s). {note}"]
    for index, q in enumerate(questions, 1):
        correct = [a["text"] for a in q["answers"] if a["is_correct"]]
        lines.append(f"{index}. [{q['type']}] {q['text']} — correct: {'; '.join(correct) or 'none marked'}")
    return ToolResult("\n".join(lines), out)


# --- Knowledge Base ------------------------------------------------------------------------

@tool("list_books",
      "List the books in the LMS Knowledge Base that are ready to use as a source, optionally filtered by title.",
      {"type": "object", "properties": {"query": _QUERY}, "additionalProperties": False})
def list_books(request, arguments):
    _status, data = call_api(request, "GET", "/curriculum_api/knowledge-base/books/")
    query = _s(arguments.get("query"))
    books = []
    for row in (data or {}).get("books") or []:
        if row.get("archived") or (row.get("processing") or {}).get("status") != "ready":
            continue
        if query and query.casefold() not in _s(row.get("title")).casefold():
            continue
        books.append({"book_id": _s(row.get("id")), "title": _s(row.get("title")),
                      "pages": (row.get("version") or {}).get("pageCount"),
                      "edition": _s((row.get("version") or {}).get("edition"))})
    books.sort(key=lambda b: b["title"].casefold())
    shown, total = _capped(books)
    lines = [_count_note(len(shown), total, "ready books")]
    lines += [f"- {b['title']} (book_id {b['book_id']}{', ' + str(b['pages']) + ' pages' if b['pages'] else ''})"
              for b in shown]
    return ToolResult("\n".join(lines), {"books": shown, "total": total})


def _plan(book_ids, topic, k):
    from knowledge_base import integration, retrieval
    from knowledge_base.repository import Repository

    return retrieval.plan(Repository(), integration._query_provider(), book_ids, k, topic)


@tool("search_books",
      "Find passages about a topic in Knowledge Base books, with the book, chapter, section and pages, so content "
      "can be written from the book and cited. Use list_books first to get book ids.",
      {"type": "object", "properties": {
          "book_ids": {"type": "array", "items": _ID, "minItems": 1, "maxItems": 5},
          "topic": {"type": "string", "minLength": 2, "maxLength": 200},
          "max_passages": {"type": "integer", "minimum": 1, "maximum": 12},
      }, "required": ["book_ids", "topic"], "additionalProperties": False},
      rate_bucket="book_searches")
def search_books(request, arguments):
    from knowledge_base.retrieval import KnowledgeBaseUnavailable

    k = int(arguments.get("max_passages") or 8)
    try:
        plan = _plan(list(dict.fromkeys(arguments["book_ids"])), arguments["topic"].strip(), k)
    except KnowledgeBaseUnavailable as exc:
        raise ToolError(str(exc)) from None
    passages = []
    for seg in plan.segments[:k]:
        text = _s(seg.text)
        passages.append({
            "book_id": _s(seg.book_id), "book": _s(seg.book_title), "chapter": _s(seg.chapter),
            "section": _s(seg.section), "pages": _s(seg.pages),
            "text": text[:PASSAGE_CHARS] + ("…" if len(text) > PASSAGE_CHARS else ""),
        })
    if not passages:
        raise ToolError("The selected books have nothing about that topic.")
    lines = [f"{len(passages)} passage(s) about '{arguments['topic'].strip()}':"]
    for p in passages:
        lines.append(f"\n[{p['book']} — {p['chapter']} › {p['section']}, p. {p['pages']}]\n{p['text']}")
    if "low_content" in plan.warnings:
        lines.append("\nNote: the books have little on this topic; check the content carefully.")
    return ToolResult("\n".join(lines), {"passages": passages, "warnings": list(plan.warnings)})
