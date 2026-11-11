"""Step 7: one preview -> apply creates a draft quiz, links it to a quiz component and maps its KSBs.

Every write goes through the endpoints the Quiz Builder and Module Builder use:

1. ``POST /quiz_api/quizzes/create-with-questions/`` -- status draft. That view runs
   ``quiz_api.intake.intake_error`` itself; the same check runs here at preview time.
2. ``PATCH /quiz_api/quizzes/<id>/`` -- pass mark, duration and randomisation, which
   the create endpoint does not read.
3. ``PATCH curriculum/components/<id>/`` -- the settings the Module Builder's
   ``applyQuiz`` sets (``linkedQuizId`` and friends). There is no other link: the
   ``quiz_component_links`` table is legacy and every reader honours ``linkedQuizId``.
4. ``POST curriculum/components/<id>/ksb-mappings/`` -- only codes the component
   does not already map (secondary, soft, weight 1), from the programme's applied source.

Steps 3 and 4 need the module's current ``structureRevision`` (read just before each),
so an edit made in the Module Builder meanwhile is refused, never overwritten. Quiz and
curriculum tables share the default database: all four steps run in one transaction,
so a failure at any step leaves nothing behind.

Per-question points are not offered: the create endpoint saves every question at 1 point.
"""
from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlencode

from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import DispatchError, call_api
from ..settings import public_base_url, quiz_creation_enabled
from . import ToolError
from .components import ID, LiveModuleWarning, draft_module, stored_duration
from .read import CURRICULUM, _archived, _resolve_source, _s

NAME = "create_quiz_draft"
QUIZ_CREATE_PATH = "/quiz_api/quizzes/create-with-questions/"
QUIZ_COMPONENT_TYPES = frozenset({"quiz", "monthly-ksb-quiz"})
QUESTION_TYPES = ("single_choice", "multiple_choice", "true_false", "fill_gap", "keywords", "ordering", "matching")
TYPE_LABELS = {"single_choice": "single", "multiple_choice": "multiple", "true_false": "true/false",
               "fill_gap": "fill-the-gap", "keywords": "keywords", "ordering": "ordering", "matching": "matching"}

# A8 (stored XSS): content is Markdown. Refuse anything that looks like markup or script.
_UNSAFE = re.compile(r"<\s*/?\s*[a-zA-Z!]|\bon[a-z]+\s*=|javascript\s*:", re.IGNORECASE)
_ARABIC_MARKS = re.compile("[\u064B-\u0652\u0640]")  # harakat and tatweel
_ALEF_FORMS = str.maketrans({"\u0622": "\u0627", "\u0623": "\u0627", "\u0625": "\u0627", "\u0671": "\u0627"})
_LEGACY_CODE = re.compile(r"([KSB]\d+)\.\d+")
_KSB_LINE = re.compile(r"\s*KSBs: [A-Z0-9., ]+\s*$")

QUESTION = {"type": "object", "properties": {
    "type": {"type": "string", "enum": list(QUESTION_TYPES)},
    "text": {"type": "string", "minLength": 1, "maxLength": 2000},
    "explanation": {"type": "string", "maxLength": 4000},
    "ksb_codes": {"type": "array", "maxItems": 20, "items": {"type": "string", "minLength": 1, "maxLength": 20}},
    "answers": {"type": "array", "minItems": 1, "maxItems": 20, "items": {"type": "object", "properties": {
        "text": {"type": "string", "minLength": 1, "maxLength": 500},
        "is_correct": {"type": "boolean"},
    }, "required": ["text", "is_correct"], "additionalProperties": False}},
}, "required": ["type", "text", "answers"], "additionalProperties": False}


def stem_key(text):
    """Normalised question stem: case, spacing, punctuation and Arabic diacritics/tatweel/alef forms ignored."""
    text = _ARABIC_MARKS.sub("", unicodedata.normalize("NFKC", str(text or ""))).translate(_ALEF_FORMS)
    text = "".join(ch for ch in text if not unicodedata.category(ch).startswith("P"))
    return " ".join(text.split()).casefold()


def _question_problems(number, question):
    problems = []
    texts = [question["text"], question.get("explanation", ""), *(a["text"] for a in question["answers"])]
    if any(_UNSAFE.search(text) for text in texts):
        problems.append(f"Question {number}: use plain text or Markdown only; HTML tags and scripts are not allowed.")
    if question["type"] == "multiple_choice":
        correct = sum(1 for a in question["answers"] if a["is_correct"])
        if correct < 2 or correct == len(question["answers"]):
            problems.append(f"Question {number}: a multiple-choice question needs at least 2 correct answers "
                            "and at least 1 wrong answer.")
    return problems


def _ksb_problems(codes, allowed, standard):
    problems = []
    for code in codes:
        if code in allowed:
            continue
        legacy = _LEGACY_CODE.fullmatch(code)
        if legacy:
            problems.append(f"{code} is an old manual code; this programme uses {standard}. "
                            f"Did you mean {legacy.group(1)}?")
            continue
        similar = sorted(c for c in allowed if c[:1] == code[:1])[:3]
        problems.append(f"{code} is not in {standard}." + (f" Did you mean {', '.join(similar)}?" if similar else "")
                        + " Use list_standard_ksbs to see the allowed codes.")
    return problems


def programme_ksb_source(programme, codes, alternative):
    """``({type, id, label}, problems)``: the programme's applied KSB source and any codes not in it.

    The source is read from the programme record on the server and parsed with the
    LMS's own ``split_ksb_source``, so the mapping endpoint's "code belongs to the
    selected source" check agrees with this one.
    """
    from curriculum_api.views import split_ksb_source

    if not _s(programme.get("id")):
        # Only a free course has no programme (FREE_COURSE_PROGRAMME).
        raise ToolError("Free courses do not use KSBs. Leave the KSB codes out.")
    raw_source = _s(programme.get("ksbProfileSourceId"))
    if not raw_source:
        raise ToolError(f"{programme.get('name')} has no KSB standard applied, so KSB codes cannot be mapped. "
                        f"Apply a standard in the LMS, {alternative}.")
    resolved = _resolve_source(raw_source)
    label = resolved.label or resolved.source_id or raw_source
    problems = _ksb_problems(codes, {_s(i.get("code")).upper() for i in resolved.items}, label)
    source_type, source_id = split_ksb_source("", raw_source)
    return {"type": source_type, "id": source_id, "label": label}, problems


def _quiz_component(module, component_id):
    for week in module.get("weekStructure") or []:
        for component in week.get("components") or []:
            if _s(component.get("id")) == component_id:
                return week, component
    raise ToolError("Choose an existing quiz component in that module (use list_module_weeks or "
                    "get_module_structure). Create one first with create_curriculum_component if needed.")


def structure_revision(request, module_id):
    _, data = call_api(request, "GET", f"{CURRICULUM}/modules/{module_id}/structure/", query={"skipCache": "1"})
    revision = _s((data or {}).get("structureRevision")) if isinstance(data, dict) else ""
    if not revision:
        raise ToolError("The LMS did not return the module's saved version, so nothing was saved.")
    return revision


class CreateQuizDraft(LiveModuleWarning, WriteTool):
    name = NAME
    description = (
        "Preview creating a DRAFT quiz with its questions inside an existing quiz component of a draft module, "
        "linking it to that component and adding the questions' KSB codes to the component's KSB mappings. "
        "Look up the programme, module and quiz component first (create the component with "
        "create_curriculum_component, type quiz, if it does not exist). KSB codes must come from "
        "list_standard_ksbs. Question rules: single_choice and true_false have exactly one correct answer "
        "(true_false exactly two answers); multiple_choice has at least two correct and one wrong; fill_gap and "
        "keywords list every accepted answer, ordering lists the steps in the correct order (all marked correct); "
        "matching answers are written 'prompt -> match' (all marked correct). Plain text or Markdown only. "
        "Show the preview and use apply_change only after confirmation. Nothing is published."
    )
    input_schema = {"type": "object", "properties": {
        "programme_id": ID, "module_id": ID, "component_id": ID,
        "title": {"type": "string", "minLength": 1, "maxLength": 200},
        "passing_grade": {"type": "integer", "minimum": 0, "maximum": 100},
        "duration_minutes": {"type": "integer", "minimum": 1, "maximum": 600},
        "randomize_questions": {"type": "boolean"},
        "questions": {"type": "array", "minItems": 1, "maxItems": 100, "items": QUESTION},
    }, "required": ["module_id", "component_id", "title", "questions"],
        "additionalProperties": False}

    def validate(self, request, arguments):
        from quiz_api.intake import intake_error

        programme, module = draft_module(request, arguments, enabled=quiz_creation_enabled, feature="quiz creation")
        module_id = _s(module.get("catalogueId") or module.get("moduleCatalogueId"))
        programme_id = _s(module.get("programmeId"))
        if programme_id.isdigit():
            raise ToolError("This programme has a legacy numeric id, so the quiz could be filed under the wrong "
                            "programme. Create this quiz in the LMS Quiz Builder.")
        week, component = _quiz_component(module, _s(arguments.get("component_id")))
        if _s(component.get("type")) not in QUIZ_COMPONENT_TYPES or _archived(component) or component.get("isDeleted"):
            raise ToolError("That component is not a quiz component. Choose a Quiz or Monthly KSB Quiz component.")
        settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
        linked = _s(settings.get("linkedQuizId") or settings.get("linked_quiz_id"))
        if linked:
            raise ToolError(f"Component '{component.get('title')}' already has quiz {linked}. Use a new quiz "
                            "component, or change that quiz in the LMS Quiz Builder.")
        title = " ".join(_s(arguments.get("title")).split())
        if not title or _UNSAFE.search(title):
            raise ToolError("Give the quiz a plain-text title.")

        questions = [{"type": q["type"], "text": q["text"].strip(), "explanation": (q.get("explanation") or "").strip(),
                      "ksb_codes": sorted({_s(c).upper() for c in q.get("ksb_codes") or [] if _s(c)}),
                      "answers": [{"text": a["text"].strip(), "is_correct": a["is_correct"]} for a in q["answers"]]}
                     for q in arguments.get("questions") or []]
        errors = [p for number, q in enumerate(questions, 1) for p in _question_problems(number, q)]
        seen = {}
        for number, question in enumerate(questions, 1):
            key = stem_key(question["text"])
            if key in seen:
                errors.append(f"Question {number} repeats question {seen[key]}.")
            seen.setdefault(key, number)
        intake = intake_error([{"text": q["text"], "type": q["type"],
                                "answers": [{"text": a["text"], "isCorrect": a["is_correct"]} for a in q["answers"]]}
                               for q in questions])
        if intake:
            errors.append(intake)

        codes = sorted({code for q in questions for code in q["ksb_codes"]})
        source = {"type": "", "id": "", "label": ""}
        if codes:
            source, problems = programme_ksb_source(programme, codes, "or create the quiz without ksb_codes")
            errors += problems
        mapped = {_s(m.get("code")).upper() for m in component.get("ksbMappings") or []}

        passing_grade = arguments.get("passing_grade", 65)
        payload = {
            "programme_id": _s(arguments.get("programme_id")), "programme_catalogue_id": programme_id,
            "module_id": module_id,
            "component_id": _s(component.get("id")), "week_id": _s(week.get("id")),
            "names": {"programme": _s(programme.get("name")), "module": _s(module.get("title")),
                      "week": _s(week.get("title")), "component": _s(component.get("title"))},
            "title": title, "passing_grade": passing_grade,
            "duration_minutes": arguments.get("duration_minutes", 60),
            "randomize_questions": bool(arguments.get("randomize_questions", False)),
            "questions": questions, "ksb_source": source,
            "new_ksb_codes": [code for code in codes if code not in mapped],
            "component_duration": stored_duration(component),
            "existing_ksb_codes": [code for code in codes if code in mapped],
        }
        return Validation(payload, errors)

    def preview(self, request, payload):
        names, questions = payload["names"], payload["questions"]
        kinds = {}
        for q in questions:
            kinds[TYPE_LABELS[q["type"]]] = kinds.get(TYPE_LABELS[q["type"]], 0) + 1
        per_code = {}
        for q in questions:
            for code in q["ksb_codes"]:
                per_code[code] = per_code.get(code, 0) + 1
        mix = ", ".join(f"{n} {k}" for k, n in kinds.items())
        where = " › ".join(part for part in (names["programme"], names["module"], names["week"],
                                             names["component"]) if part)
        summary = f"Create DRAFT quiz '{payload['title']}' — {len(questions)} question(s) ({mix}) in {where}."
        if per_code:
            summary += " KSBs: " + ", ".join(f"{c} ({n})" for c, n in sorted(per_code.items())) + "."
            summary += (" New KSB mappings on the component: " + ", ".join(payload["new_ksb_codes"]) + "."
                        if payload["new_ksb_codes"] else " All of these are already mapped on the component.")
        return {"summary": summary, "details": {
            "names": names, "title": payload["title"], "passing_grade": payload["passing_grade"],
            "duration_minutes": payload["duration_minutes"], "randomize_questions": payload["randomize_questions"],
            "question_count": len(questions), "question_types": kinds, "ksb_questions": per_code,
            "new_ksb_mappings": payload["new_ksb_codes"], "already_mapped": payload["existing_ksb_codes"],
            "ksb_source": payload["ksb_source"]["label"] or None,
            "questions": [{"number": n, "type": q["type"], "text": q["text"], "answers": q["answers"],
                           "ksb_codes": q["ksb_codes"]} for n, q in enumerate(questions, 1)],
            "content_note": "Created as a draft quiz; every question is worth 1 point. Review and publish it in "
                            "the LMS Quiz Builder.",
        }}

    def apply(self, request, payload, progress):
        progress.uncertain("Creating the quiz; check the component in the LMS before trying again.")
        try:
            with transaction.atomic(using="default"):
                recheck = self.validate(request, payload)
                if recheck.errors or recheck.payload != payload:
                    raise ToolError("The module or component changed since the preview. Prepare a new preview.")
                quiz_id = self._create_quiz(request, payload)
                self._link(request, payload, quiz_id)
                self._map_ksbs(request, payload)
        except (ToolError, DispatchError) as exc:
            # Raised inside the transaction, so it rolled back: nothing was saved.
            progress.uncertain_steps.clear()
            if isinstance(exc, DispatchError):
                raise ToolError(f"{exc} Nothing was saved; prepare a new preview.") from None
            raise
        progress.uncertain_steps.clear()
        progress.done("Created draft quiz", quiz_id=quiz_id, questions=len(payload["questions"]))
        progress.done("Linked the quiz to the component", component_id=payload["component_id"])
        if payload["new_ksb_codes"]:
            progress.done("Added KSB mappings", codes=payload["new_ksb_codes"])
        base = public_base_url()
        return {
            "summary": f"Created draft quiz '{payload['title']}' ({len(payload['questions'])} questions) and linked "
                       f"it to '{payload['names']['component']}'.",
            "result": {"quiz_id": quiz_id, "component_id": payload["component_id"], "module_id": payload["module_id"],
                       "week_id": payload["week_id"], "status": "draft",
                       "new_ksb_mappings": payload["new_ksb_codes"]},
            "links": [f"{base}/curriculum/module-builder?{urlencode({'module': payload['module_id']})}"],
        }

    def _create_quiz(self, request, payload):
        def explanation(q):
            return explanation_with_ksbs(q["explanation"], q["ksb_codes"])

        body = {
            "title": payload["title"], "status": "draft", "assessmentType": "quiz",
            # A non-numeric programme id is stored as given: no free-text programme guessing.
            "programmeId": payload["programme_catalogue_id"], "programme": payload["names"]["programme"],
            "module": payload["names"]["module"], "weekId": payload["week_id"],
            "initialQuestions": [{"questionType": q["type"], "text": q["text"], "explanation": explanation(q),
                                  "answers": [{"text": a["text"], "isCorrect": a["is_correct"]}
                                              for a in q["answers"]]} for q in payload["questions"]],
        }
        status, quiz = call_api(request, "POST", QUIZ_CREATE_PATH, json_body=body)
        quiz_id = quiz.get("id") if isinstance(quiz, dict) else None
        if (status != 201 or isinstance(quiz_id, bool) or not isinstance(quiz_id, int)
                or quiz.get("status") != "draft" or quiz.get("questions") != len(payload["questions"])):
            raise ToolError("The LMS did not confirm the new draft quiz, so nothing was saved.")
        settings = {"passingGrade": payload["passing_grade"], "duration": payload["duration_minutes"],
                    "randomizeQuestions": payload["randomize_questions"]}
        status, updated = call_api(request, "PATCH", f"/quiz_api/quizzes/{quiz_id}/", json_body=settings)
        if status != 200 or not isinstance(updated, dict) or any(updated.get(k) != v for k, v in settings.items()):
            raise ToolError("The LMS did not confirm the quiz settings, so nothing was saved.")
        return quiz_id

    def _link(self, request, payload, quiz_id):
        component_id = payload["component_id"]
        settings = {"linkedQuizId": str(quiz_id), "linkedActivity": payload["title"],
                    "quizWeekId": payload["week_id"], "numberOfQuestions": len(payload["questions"]),
                    "passMarkPercentage": payload["passing_grade"], "quizDuration": payload["duration_minutes"],
                    "quizStatus": "draft"}
        body = {"expectedRevision": structure_revision(request, payload["module_id"]), "settings": settings,
                "duration": payload["component_duration"]}
        status, data = call_api(request, "PATCH", f"{CURRICULUM}/components/{component_id}/", json_body=body)
        saved = (data or {}).get("component") if isinstance(data, dict) else None
        saved_settings = saved.get("settings") if isinstance(saved, dict) else None
        if (status != 200 or not isinstance(saved_settings, dict)
                or any(saved_settings.get(k) != v for k, v in settings.items())):
            raise ToolError("The LMS did not confirm the quiz link on the component, so nothing was saved.")

    def _map_ksbs(self, request, payload):
        add_component_ksb_mappings(request, payload["module_id"], payload["component_id"],
                                   payload["new_ksb_codes"], payload["ksb_source"])


def explanation_with_ksbs(explanation, codes):
    """The explanation with a trailing human-readable "KSBs: ..." line (any previous one replaced)."""
    body = _KSB_LINE.sub("", explanation or "").rstrip()
    note = f"KSBs: {', '.join(codes)}" if codes else ""
    return "\n\n".join(part for part in (body, note) if part)


def add_component_ksb_mappings(request, module_id, component_id, codes, source):
    """Add ``codes`` to the component as secondary/soft/weight-1 mappings (additive only, Step 7.11)."""
    if not codes:
        return
    body = {"expectedRevision": structure_revision(request, module_id), "mappings": [
        {"code": code, "classification": "secondary", "weightClass": "soft", "weight": 1,
         "sourceType": source["type"], "sourceId": source["id"]} for code in codes]}
    status, data = call_api(request, "POST", f"{CURRICULUM}/components/{component_id}/ksb-mappings/", json_body=body)
    if status != 201 or not isinstance(data, dict) or data.get("created") is not True:
        raise ToolError("The LMS did not confirm the KSB mappings, so nothing was saved.")


register_write_tool(CreateQuizDraft())
