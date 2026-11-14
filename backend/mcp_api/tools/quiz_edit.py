"""Step 8: ``edit_quiz_draft`` and ``clone_quiz_version``. A published or attempted quiz is never changed.

- ``edit_quiz_draft`` changes a quiz in place only while it is a draft that no learner has
  attempted (``quiz_is_editable``). Questions go through ``PATCH /quiz_api/quizzes/<id>/questions/``,
  the Quiz Builder's own endpoint: every current question is sent in its current order (so the
  order is kept), removed questions are archived with ``isArchived`` -- never deleted, and
  ``removeMissing`` is never sent. A question's answers are sent only when they change, because
  the endpoint replaces changed answer rows. Title/pass mark/duration go through
  ``PATCH /quiz_api/quizzes/<id>/`` with the quiz's ``weekId`` (a title without it makes the LMS
  rebuild the quiz's week link). New KSB codes are added to the linked component, additively.
- ``clone_quiz_version`` copies the quiz's current questions, with any changes, into a NEW draft
  quiz titled "<title> (vN)". The original is untouched and no component is relinked: learners
  keep the old quiz until someone switches the link in the Module Builder.

Both use the same per-question rules as ``create_quiz_draft`` and run their writes in one
default-DB transaction, so a failure part-way saves nothing.
"""
from __future__ import annotations

import re

from django.db import transaction

from ..changes import Validation, WriteTool, register_write_tool
from ..dispatch import DispatchError, call_api
from ..settings import quiz_creation_enabled
from . import ToolError
from .components import ID, LiveModuleWarning, draft_module
from .quizzes import (
    QUESTION, QUIZ_CREATE_PATH, _UNSAFE, _question_problems, _quiz_component, add_component_ksb_mappings,
    explanation_with_ksbs, programme_ksb_source, stem_key,
)
from .read import _attempt_count, _s

QUIZ_ID = {"type": "integer", "minimum": 1}
UPDATE = {"type": "object", "properties": {
    "question_id": {"type": "integer", "minimum": 1},
    "text": QUESTION["properties"]["text"],
    "explanation": QUESTION["properties"]["explanation"],
    "ksb_codes": QUESTION["properties"]["ksb_codes"],
    "answers": QUESTION["properties"]["answers"],
}, "required": ["question_id"], "additionalProperties": False}
CHANGES = {
    "title": {"type": "string", "minLength": 1, "maxLength": 200},
    "passing_grade": {"type": "integer", "minimum": 0, "maximum": 100},
    "duration_minutes": {"type": "integer", "minimum": 1, "maximum": 600},
    "add_questions": {"type": "array", "maxItems": 100, "items": QUESTION},
    "update_questions": {"type": "array", "maxItems": 100, "items": UPDATE},
    "archive_question_ids": {"type": "array", "maxItems": 100, "items": {"type": "integer", "minimum": 1}},
}
QUESTION_FIELDS = ("add_questions", "update_questions", "archive_question_ids")


def _answers(answers):
    return [{"text": a["text"].strip(), "is_correct": bool(a["is_correct"])} for a in answers]


def _codes(codes):
    return sorted({_s(c).upper() for c in codes or [] if _s(c)})


def load_quiz(request, quiz_id):
    """``(quiz, questions)``: the quiz record and its current (non-archived) questions in order."""
    _, data = call_api(request, "GET", f"/quiz_api/quizzes/{quiz_id}/preview/")
    quiz = (data or {}).get("quiz") if isinstance(data, dict) else None
    if not isinstance(quiz, dict) or not quiz.get("id"):
        raise ToolError(f"Quiz {quiz_id} was not found. Use get_quiz or get_module_structure to find it.")
    questions = [{"question_id": q.get("id"), "type": _s(q.get("questionType")), "text": _s(q.get("text")),
                  "explanation": _s(q.get("explanation")),
                  "answers": [{"text": _s(a.get("text")), "is_correct": bool(a.get("isCorrect"))}
                              for a in q.get("answers") or []]}
                 for q in data.get("questions") or [] if not q.get("isArchived")]
    return quiz, questions


def quiz_is_editable(quiz, attempts):
    """``(editable, reason)``: only a draft, untrashed quiz nobody has attempted is changed in place."""
    status = _s(quiz.get("status")).lower()
    if status == "trash":
        return False, "This quiz is in the trash."
    if status != "draft":
        return False, f"This quiz is {status or 'not a draft'}, so it cannot be changed in place."
    if attempts:
        return False, f"Learners have attempted this quiz {attempts} time(s), so it cannot be changed in place."
    return True, ""


def apply_changes(current, arguments):
    """Pure: ``(result, errors, diff)`` for the quiz's questions after ``arguments``' changes.

    ``result`` keeps the current order, with added questions at the end. Each entry has
    ``question_id`` (None when new), ``archived``, ``changed`` and ``answers_changed``.
    """
    by_id = {q["question_id"]: q for q in current}
    updates, archive, errors = {}, set(arguments.get("archive_question_ids") or []), []
    for update in arguments.get("update_questions") or []:
        if update["question_id"] in updates:
            errors.append(f"Question {update['question_id']} is listed twice in update_questions.")
        updates[update["question_id"]] = update
    for qid in sorted((archive | set(updates)) - set(by_id)):
        errors.append(f"Question {qid} is not a current question of this quiz.")
    for qid in sorted(archive & set(updates)):
        errors.append(f"Question {qid} cannot be both updated and archived.")
    result, diff = [], []
    for q in current:
        qid = q["question_id"]
        if qid in archive:
            result.append({**q, "ksb_codes": [], "archived": True, "changed": True, "answers_changed": False})
            diff.append({"action": "archive", "question_id": qid, "text": q["text"]})
            continue
        update = updates.get(qid)
        if not update:
            result.append({**q, "ksb_codes": [], "archived": False, "changed": False, "answers_changed": False})
            continue
        new = {**q, "archived": False, "changed": True, "ksb_codes": _codes(update.get("ksb_codes"))}
        if "text" in update:
            new["text"] = update["text"].strip()
        if "explanation" in update:
            new["explanation"] = update["explanation"].strip()
        if "ksb_codes" in update:
            new["explanation"] = explanation_with_ksbs(new["explanation"], new["ksb_codes"])
        new["answers_changed"] = "answers" in update and _answers(update["answers"]) != q["answers"]
        if "answers" in update:
            new["answers"] = _answers(update["answers"])
        diff.append({"action": "update", "question_id": qid,
                     "before": {"text": q["text"], "answers": q["answers"]},
                     "after": {"text": new["text"], "answers": new["answers"]}})
        result.append(new)
    for added in arguments.get("add_questions") or []:
        codes = _codes(added.get("ksb_codes"))
        result.append({"question_id": None, "type": added["type"], "text": added["text"].strip(),
                       "explanation": explanation_with_ksbs((added.get("explanation") or "").strip(), codes),
                       "ksb_codes": codes, "answers": _answers(added["answers"]),
                       "archived": False, "changed": True, "answers_changed": True})
        diff.append({"action": "add", "text": added["text"].strip()})
    return result, errors, diff


def result_problems(result):
    """The Step 7 rules over the quiz as it would be after the change, numbered as the learner sees it."""
    from quiz_api.intake import intake_error

    active = [q for q in result if not q["archived"]]
    if not active:
        return ["A quiz needs at least one question; do not archive them all."]
    problems = [p for number, q in enumerate(active, 1) if q["changed"] for p in _question_problems(number, q)]
    seen = {}
    for number, q in enumerate(active, 1):
        key = stem_key(q["text"])
        if key in seen:
            problems.append(f"Question {number} repeats question {seen[key]}.")
        seen.setdefault(key, number)
    intake = intake_error([{"text": q["text"], "type": q["type"],
                            "answers": [{"text": a["text"], "isCorrect": a["is_correct"]} for a in q["answers"]]}
                           for q in active])
    return problems + ([intake] if intake else [])


def _unsafe_title(arguments):
    title = " ".join(_s(arguments.get("title")).split())
    if "title" in arguments and (not title or _UNSAFE.search(title)):
        raise ToolError("Give the quiz a plain-text title.")
    return title


def _run(progress, label, work):
    """One default-DB transaction; a refused or failed step rolls back and says nothing was saved."""
    progress.uncertain(f"{label}; check the quiz in the LMS before trying again.")
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


def _diff_summary(diff):
    counts = {"update": 0, "add": 0, "archive": 0}
    for item in diff:
        counts[item["action"]] += 1
    parts = [f"{n} question(s) {word}" for key, word, n in (
        ("update", "changed", counts["update"]), ("add", "added", counts["add"]),
        ("archive", "archived", counts["archive"])) if n]
    return ", ".join(parts)


# --- edit_quiz_draft --------------------------------------------------------------------------

class EditQuizDraft(LiveModuleWarning, WriteTool):
    name = "edit_quiz_draft"
    description = (
        "Preview changes to a DRAFT quiz that no learner has attempted: title, pass mark, duration, and adding, "
        "updating or archiving questions (archived questions are kept, not deleted). Use get_quiz first for "
        "question ids. A published or attempted quiz cannot be changed: use clone_quiz_version instead. To add "
        "KSB codes, also give the module_id and the component_id the quiz is linked to (and programme_id unless "
        "it is a free course). Same question rules as create_quiz_draft. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {
        "quiz_id": QUIZ_ID, "programme_id": ID, "module_id": ID, "component_id": ID, **CHANGES,
    }, "required": ["quiz_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        if not quiz_creation_enabled():
            raise ToolError("MCP quiz creation is not enabled. Ask an administrator to enable the quiz creation pilot.")
        quiz_id = arguments["quiz_id"]
        quiz, current = load_quiz(request, quiz_id)
        editable, reason = quiz_is_editable(quiz, _attempt_count(quiz_id))
        if not editable:
            raise ToolError(f"{reason} Use clone_quiz_version to make an edited new draft version instead.")
        title = _unsafe_title(arguments)
        result, errors, diff = apply_changes(current, arguments)
        meta = {}
        if title and title != _s(quiz.get("title")):
            meta.update(title=title, weekId=_s(quiz.get("weekId")))
        for arg, key in (("passing_grade", "passingGrade"), ("duration_minutes", "duration")):
            if arg in arguments and arguments[arg] != quiz.get(key):
                meta[key] = arguments[arg]
        if not diff and not meta and not errors:
            raise ToolError("Those values are already set; there is nothing to change.")
        errors += result_problems(result)

        codes = sorted({c for q in result if q["changed"] and not q["archived"] for c in q["ksb_codes"]})
        ksb = {"module_id": "", "component_id": "", "new_codes": [], "source": {"type": "", "id": "", "label": ""}}
        if codes or arguments.get("module_id") or arguments.get("component_id"):
            if not (arguments.get("module_id") and arguments.get("component_id")):
                raise ToolError("To add KSB codes, give both the module_id and the component_id this quiz is linked to.")
            programme, module = draft_module(request, arguments, enabled=quiz_creation_enabled, feature="quiz creation")
            _, component = _quiz_component(module, _s(arguments["component_id"]))
            settings = component.get("settings") if isinstance(component.get("settings"), dict) else {}
            if _s(settings.get("linkedQuizId")) != str(quiz_id):
                raise ToolError(f"Component '{component.get('title')}' is not linked to quiz {quiz_id}.")
            mapped = {_s(m.get("code")).upper() for m in component.get("ksbMappings") or []}
            if codes:
                ksb["source"], problems = programme_ksb_source(programme, codes, "or leave ksb_codes out")
                errors += problems
            ksb.update(module_id=_s(module.get("catalogueId") or module.get("moduleCatalogueId")),
                       component_id=_s(component.get("id")), new_codes=[c for c in codes if c not in mapped])

        body = []
        for q in result:
            if q["question_id"] is None:
                body.append({"text": q["text"], "questionType": q["type"], "explanation": q["explanation"],
                             "answers": [{"text": a["text"], "isCorrect": a["is_correct"]} for a in q["answers"]]})
            elif q["archived"]:
                body.append({"id": q["question_id"], "isArchived": True})
            elif q["changed"]:
                item = {"id": q["question_id"], "text": q["text"], "explanation": q["explanation"]}
                if q["answers_changed"]:
                    item["answers"] = [{"text": a["text"], "isCorrect": a["is_correct"]} for a in q["answers"]]
                body.append(item)
            else:
                body.append({"id": q["question_id"]})  # keeps its position; nothing else changes
        payload = {
            **{key: arguments[key] for key in ("quiz_id", *CHANGES, "programme_id", "module_id", "component_id")
               if key in arguments},
            "quiz_title": _s(quiz.get("title")), "updated_at": _s(quiz.get("updatedAt")), "current": current,
            "meta": meta, "questions_body": body if diff else [], "diff": diff,
            "expected_texts": [q["text"] for q in result if not q["archived"]],
            "ksb": ksb, "module_id": ksb["module_id"],
        }
        return Validation(payload, errors)

    def preview(self, request, payload):
        parts = [_diff_summary(payload["diff"])] if payload["diff"] else []
        meta = payload["meta"]
        if "title" in meta:
            parts.append(f"title → '{meta['title']}'")
        if "passingGrade" in meta:
            parts.append(f"pass mark → {meta['passingGrade']}%")
        if "duration" in meta:
            parts.append(f"duration → {meta['duration']} min")
        if payload["ksb"]["new_codes"]:
            parts.append("new KSB mappings on the component: " + ", ".join(payload["ksb"]["new_codes"]))
        return {"summary": f"Edit DRAFT quiz '{payload['quiz_title']}' (id {payload['quiz_id']}): " + "; ".join(parts) + ".",
                "details": {"quiz_id": payload["quiz_id"], "changes": payload["diff"], "settings": meta,
                            "new_ksb_mappings": payload["ksb"]["new_codes"],
                            "note": "Archived questions are kept in the quiz's history, not deleted. Nothing is published."}}

    def apply(self, request, payload, progress):
        quiz_id = payload["quiz_id"]

        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The quiz changed since the preview. Prepare a new preview.")
            if payload["meta"]:
                status, updated = call_api(request, "PATCH", f"/quiz_api/quizzes/{quiz_id}/", json_body=payload["meta"])
                if status != 200 or not isinstance(updated, dict) or any(
                        updated.get(k) != v for k, v in payload["meta"].items()):
                    raise ToolError("The LMS did not confirm the quiz settings, so nothing was saved.")
            if payload["questions_body"]:
                status, data = call_api(request, "PATCH", f"/quiz_api/quizzes/{quiz_id}/questions/",
                                        json_body={"questions": payload["questions_body"]})
                saved = [_s(q.get("text")) for q in (data or {}).get("questions") or [] if not q.get("isArchived")]
                if status != 200 or saved != payload["expected_texts"]:
                    raise ToolError("The LMS did not confirm the question changes, so nothing was saved.")
            ksb = payload["ksb"]
            add_component_ksb_mappings(request, ksb["module_id"], ksb["component_id"], ksb["new_codes"], ksb["source"])

        _run(progress, "Saving the quiz changes", work)
        progress.done("Saved the quiz changes", quiz_id=quiz_id)
        return {"summary": f"Saved the changes to draft quiz '{payload['meta'].get('title', payload['quiz_title'])}'.",
                "result": {"quiz_id": quiz_id, "status": "draft", "question_count": len(payload["expected_texts"]),
                           "new_ksb_mappings": payload["ksb"]["new_codes"]}}


# --- clone_quiz_version -----------------------------------------------------------------------

def _next_version(version):
    match = re.search(r"\d+", version or "")
    return int(match.group(0)) + 1 if match else 2


class CloneQuizVersion(WriteTool):
    name = "clone_quiz_version"
    description = (
        "Preview copying a quiz (published or attempted ones included) into a NEW draft version, optionally with "
        "changes (title, pass mark, duration, add/update/archive questions). The original quiz is not changed and "
        "the new version is NOT linked to any component: learners keep the current quiz until someone switches "
        "the link in the Module Builder after review. KSB codes cannot be added here. Apply only after confirmation."
    )
    input_schema = {"type": "object", "properties": {"quiz_id": QUIZ_ID, **CHANGES},
                    "required": ["quiz_id"], "additionalProperties": False}

    def validate(self, request, arguments):
        if not quiz_creation_enabled():
            raise ToolError("MCP quiz creation is not enabled. Ask an administrator to enable the quiz creation pilot.")
        quiz_id = arguments["quiz_id"]
        quiz, current = load_quiz(request, quiz_id)
        if _s(quiz.get("status")).lower() == "trash":
            raise ToolError("This quiz is in the trash; restore it in the LMS before copying it.")
        programme_id = _s(quiz.get("programmeId"))
        if programme_id.isdigit():
            raise ToolError("This quiz has a legacy numeric programme id, so a copy could be filed under the wrong "
                            "programme. Copy it in the LMS Quiz Builder.")
        if any(q.get("ksb_codes") for field in ("add_questions", "update_questions") for q in arguments.get(field) or []):
            raise ToolError("KSB codes cannot be added to an unlinked copy. Leave them out; map KSBs after the new "
                            "version is linked to a component.")
        title = _unsafe_title(arguments)
        result, errors, diff = apply_changes(current, arguments)
        errors += result_problems(result)
        version = _next_version(_s(quiz.get("version")))
        active = [q for q in result if not q["archived"]]
        new_title = title or f"{_s(quiz.get('title'))} (v{version})"
        body = {
            "title": new_title, "status": "draft", "assessmentType": _s(quiz.get("assessmentType")) or "quiz",
            "programmeId": programme_id, "programme": _s(quiz.get("programme")), "module": _s(quiz.get("module")),
            "weekId": _s(quiz.get("weekId")), "version": f"v{version}.0",
            "initialQuestions": [{"questionType": q["type"], "text": q["text"], "explanation": q["explanation"],
                                  "answers": [{"text": a["text"], "isCorrect": a["is_correct"]} for a in q["answers"]]}
                                 for q in active],
        }
        settings = {"passingGrade": arguments.get("passing_grade", quiz.get("passingGrade")),
                    "duration": arguments.get("duration_minutes", quiz.get("duration")),
                    "randomizeQuestions": bool(quiz.get("randomizeQuestions"))}
        payload = {**{key: arguments[key] for key in ("quiz_id", *CHANGES) if key in arguments},
                   "quiz_title": _s(quiz.get("title")), "updated_at": _s(quiz.get("updatedAt")), "current": current,
                   "diff": diff, "create_body": body, "settings": settings}
        return Validation(payload, errors)

    def preview(self, request, payload):
        body = payload["create_body"]
        changes = _diff_summary(payload["diff"])
        return {"summary": f"Copy quiz '{payload['quiz_title']}' (id {payload['quiz_id']}) into a NEW draft "
                           f"'{body['title']}' with {len(body['initialQuestions'])} question(s)"
                           + (f" ({changes})" if changes else "") + ". The original is unchanged and the copy is "
                           "not linked to any component.",
                "details": {"new_title": body["title"], "version": body["version"], "changes": payload["diff"],
                            "settings": payload["settings"],
                            "next_step": "Review the new draft, then switch the component's quiz link in the Module "
                                         "Builder. Learners keep the current quiz until then."}}

    def apply(self, request, payload, progress):
        def work():
            recheck = self.validate(request, payload)
            if recheck.errors or recheck.payload != payload:
                raise ToolError("The quiz changed since the preview. Prepare a new preview.")
            body = payload["create_body"]
            status, quiz = call_api(request, "POST", QUIZ_CREATE_PATH, json_body=body)
            new_id = quiz.get("id") if isinstance(quiz, dict) else None
            if (status != 201 or isinstance(new_id, bool) or not isinstance(new_id, int)
                    or quiz.get("status") != "draft" or quiz.get("questions") != len(body["initialQuestions"])):
                raise ToolError("The LMS did not confirm the new draft version, so nothing was saved.")
            status, updated = call_api(request, "PATCH", f"/quiz_api/quizzes/{new_id}/", json_body=payload["settings"])
            if status != 200 or not isinstance(updated, dict) or any(
                    updated.get(k) != v for k, v in payload["settings"].items()):
                raise ToolError("The LMS did not confirm the new version's settings, so nothing was saved.")
            return new_id

        new_id = _run(progress, "Copying the quiz", work)
        progress.done("Created the new draft version", quiz_id=new_id)
        return {"summary": f"Created draft quiz {new_id} '{payload['create_body']['title']}'. It is not linked to any "
                           "component yet: review it, then switch the link in the Module Builder.",
                "result": {"quiz_id": new_id, "copied_from": payload["quiz_id"], "status": "draft", "linked": False}}


register_write_tool(EditQuizDraft())
register_write_tool(CloneQuizVersion())
