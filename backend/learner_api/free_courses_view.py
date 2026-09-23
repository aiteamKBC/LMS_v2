"""Learner-scoped read of the free courses assigned to a learner.

Free courses are authored in the curriculum editor (the synthetic
``FREE-COURSES`` programme) and assigned to a learner from the enrolment
Learning-Plan modal, which stores a pure assignment record
(``{freeCourseId, courseName, addedAt}``) on ``enrolment.Created_users``
``Free_courses`` — no hours, no KSBs, no progress, by design.

This view is the learner-facing counterpart: it returns the assigned courses
enriched with their authored week/activity tree so the "My Learning" page can
render them like ordinary modules (minus the progress machinery).

Identity is resolved SERVER-SIDE and never trusted from the client (same gate as
``learner_detail``/``training_plan``): the caller supplies only the
ownership-gated learner record id. The curriculum catalogue is staff-gated, so a
learner session cannot fetch it directly — the enrichment therefore happens
here, in-process, and only the learner's *assigned* courses are ever returned.
"""

import json

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from login.permissions import learner_self_or_admin, learner_self_or_staff

from curriculum_api.views import (
    FREE_COURSES_TABLE,
    FREE_PROGRAMME_COMPONENTS_TABLE,
    FREE_PROGRAMME_MODULES_TABLE,
    active_component_rows,
    active_week_rows,
    clean_str,
    free_programme_component_response,
    free_programme_fetch_all,
)

from .learner_detail import (
    SOURCE_MODELS,
    _component_resource_url,
    _video_url_from_settings,
    component_audio_url,
)
from .mappers import _normalize_free_courses, _s
from .models import LearnerFreeCourseProgress
from .quizzes import _fetch_quiz, _grade_question

FREE_COURSES_PROGRAMME_ID = "FREE-COURSES"


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _in_clause(column, values):
    """A portable ``column IN (...)`` fragment with its ordered params."""
    placeholders = ", ".join(["%s"] * len(values))
    return f"{column} in ({placeholders})", list(values)


def _activity(component):
    """Map one authored free-course component to the learner viewer shape.

    Reuses the same settings resolvers the ordinary module tree uses
    (``_video_url_from_settings`` / ``component_audio_url`` /
    ``_component_resource_url``), so a reading, video, podcast or slide deck
    opens on the free-course page exactly as it does on a normal module — but
    with no hours/KSB/progress fields attached.
    """
    settings = component.get("settings")
    if not isinstance(settings, dict):
        settings = {}
    ctype = _s(component.get("type")) or "activity"
    file_name = _s(settings.get("fileName")) or _s(settings.get("uploadedFileName")) or None
    # A quiz is only "available" when the curriculum author has linked a real
    # quiz to it (settings.linkedQuizId). An empty link reads as not-available,
    # exactly as in the normal modules. `manualUnlock` is the author's per-quiz
    # toggle in the free-courses builder: true = always open (no gating), false
    # = automatic (locked until the section's materials are complete).
    is_quiz = "quiz" in ctype.lower()
    return {
        "componentId": _s(component.get("id")),
        "title": _s(component.get("title")),
        "type": ctype,
        "description": _s(component.get("description")) or None,
        "videoUrl": _video_url_from_settings(settings),
        "audioUrl": component_audio_url(settings, ctype),
        "resourceUrl": _component_resource_url(settings),
        "contentHtml": _s(settings.get("readingContent")) or None,
        "fileName": file_name,
        "downloadAllowed": bool(settings.get("downloadAllowed")),
        "quizId": (_s(settings.get("linkedQuizId")) or None) if is_quiz else None,
        "manualUnlock": bool(settings.get("manualUnlock")) if is_quiz else False,
    }


def _resolve_source(kind, pk):
    """The enrolment learner row for either kind, or (None, error-response)."""
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return None, _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)
    try:
        # all_learners, not objects: the default manager is scoped to
        # apprenticeship rows, so a commercial learner would 404 here. The
        # enrolment `Free_courses` column is the source of truth for both kinds.
        return model.all_learners.only("id", "free_courses").get(pk=pk), None
    except model.DoesNotExist:
        return None, _error("Learner not found.", 404)
    except DatabaseError:
        return None, _error("Could not read the learner record.", 503)


def _scoped_rows(assigned_ids):
    """Fetch only the assigned courses' course/week/component rows.

    Building the whole FREE-COURSES catalogue instead (every course's weeks and
    every component's heavy settings_json) is what made the read slow enough to
    trip the client's timeout — a learner has a handful of courses, not all.
    """
    course_where, course_params = _in_clause("id", assigned_ids)
    courses_by_id = {
        clean_str(row.get("id")): row
        for row in free_programme_fetch_all(FREE_COURSES_TABLE, course_where, course_params)
    }

    week_where, week_params = _in_clause("course_id", assigned_ids)
    week_rows = active_week_rows(free_programme_fetch_all(
        FREE_PROGRAMME_MODULES_TABLE, week_where, week_params, "display_order, week_number, id",
    ))
    week_ids = [clean_str(week.get("id")) for week in week_rows if clean_str(week.get("id"))]

    component_rows = []
    if week_ids:
        module_in, module_params = _in_clause("free_module_id", week_ids)
        component_rows = active_component_rows(free_programme_fetch_all(
            FREE_PROGRAMME_COMPONENTS_TABLE,
            f"programme_id = %s and {module_in}",
            [FREE_COURSES_PROGRAMME_ID, *module_params],
            "display_order, title",
        ))
    return courses_by_id, week_rows, component_rows


@require_GET
@learner_self_or_staff(kwarg="pk")
def free_courses(request, kind, pk):
    """Return the learner's assigned free courses, each with its week/activity tree."""
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    assigned = _normalize_free_courses(
        source.free_courses if isinstance(source.free_courses, list) else []
    )
    if not assigned:
        response = JsonResponse({"freeCourses": []})
        response["Cache-Control"] = "private, no-store"
        return response

    assigned_ids = [record["freeCourseId"] for record in assigned]

    try:
        courses_by_id, week_rows, component_rows = _scoped_rows(assigned_ids)
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)

    # This learner's own free-course completions — a separate store that never
    # touches OTJH/KSB or the programme's overall progress. Read defensively: if
    # the progress table has not been provisioned yet, the course tree must still
    # render (just with nothing ticked) rather than failing the whole page.
    try:
        completed_refs = set(
            LearnerFreeCourseProgress.objects
            .filter(learner_id=source.pk)
            .values_list("component_ref", flat=True)
        )
    except DatabaseError:
        completed_refs = set()

    # Bucket components by their week once, so the tree build stays linear.
    activities_by_week = {}
    for row in component_rows:
        activity = _activity(free_programme_component_response(row))
        activity["completed"] = activity["componentId"] in completed_refs
        activities_by_week.setdefault(clean_str(row.get("free_module_id")), []).append(activity)

    courses = {}
    for week in week_rows:
        course_id = clean_str(week.get("course_id"))
        if course_id not in courses:
            course_row = courses_by_id.get(course_id) or {}
            courses[course_id] = {
                "freeCourseId": course_id,
                "courseName": clean_str(course_row.get("course_name")) or clean_str(week.get("course_name")),
                "description": clean_str(course_row.get("description")),
                "coverImageUrl": clean_str(course_row.get("cover_image_url")),
                "weeks": [],
            }
        courses[course_id]["weeks"].append({
            "weekId": clean_str(week.get("id")),
            "weekNumber": week.get("week_number") if isinstance(week.get("week_number"), int) else 0,
            "weekTitle": clean_str(week.get("week_title")),
            "activities": activities_by_week.get(clean_str(week.get("id")), []),
        })

    # Return in assignment order. A course the catalogue no longer lists (retired
    # or mis-referenced) still surfaces as a titled shell, so the learner sees the
    # assignment rather than it silently vanishing.
    result = []
    for record in assigned:
        course = courses.get(record["freeCourseId"])
        if course is None:
            course = {
                "freeCourseId": record["freeCourseId"],
                "courseName": record.get("courseName") or "",
                "description": "",
                "coverImageUrl": "",
                "weeks": [],
            }
        result.append(course)

    response = JsonResponse({"freeCourses": result})
    response["Cache-Control"] = "private, no-store"
    return response


@csrf_exempt
@require_POST
# The learner or an admin may record completion — the same gate the normal
# component completion uses. Free-course completion is not a compliance record
# (no OTJH/KSBs), so an admin ticking it on the learner's behalf is fine.
@learner_self_or_admin(kwarg="pk")
def complete_free_course_activity(request, kind, pk):
    """Record that the learner finished one free-course activity.

    Writes to the isolated LearnerFreeCourseProgress store only — never OTJH,
    KSBs or the programme's overall progress. The component must belong to one
    of THIS learner's assigned free courses, or it 404s (existence-hiding).
    """
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    component_id = _s(payload.get("componentId")) if isinstance(payload, dict) else ""
    if not component_id:
        return _error("componentId is required.", 400)

    assigned = _normalize_free_courses(
        source.free_courses if isinstance(source.free_courses, list) else []
    )
    assigned_ids = [record["freeCourseId"] for record in assigned]
    if not assigned_ids:
        return _error("Activity not found.", 404)

    # Resolve the component within the learner's assigned courses, so a stray id
    # cannot record a completion against unassigned content.
    try:
        _courses, week_rows, component_rows = _scoped_rows(assigned_ids)
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)

    course_by_week = {clean_str(week.get("id")): clean_str(week.get("course_id")) for week in week_rows}
    free_course_ref = None
    found = False
    for row in component_rows:
        if clean_str(row.get("id")) == component_id:
            free_course_ref = course_by_week.get(clean_str(row.get("free_module_id")))
            found = True
            break
    if not found:
        return _error("Activity not found.", 404)

    try:
        LearnerFreeCourseProgress.objects.get_or_create(
            learner_id=source.pk,
            component_ref=component_id,
            defaults={"free_course_ref": free_course_ref, "completed_at": timezone.now()},
        )
    except DatabaseError:
        return _error("Could not save your progress. Please try again.", 503)

    response = JsonResponse({"componentId": component_id, "completed": True})
    response["Cache-Control"] = "private, no-store"
    return response


def _resolve_quiz_component(source, component_id):
    """Find one quiz component within the learner's assigned courses.

    Returns (quiz_id:int, free_course_ref, error_response). The component must be
    an assigned quiz with a linked quiz — otherwise a 404/400 is returned so a
    stray id can never reach an unassigned or unlinked quiz.
    """
    assigned = _normalize_free_courses(
        source.free_courses if isinstance(source.free_courses, list) else []
    )
    assigned_ids = [record["freeCourseId"] for record in assigned]
    if not assigned_ids:
        return None, None, _error("Activity not found.", 404)

    _courses, week_rows, component_rows = _scoped_rows(assigned_ids)
    course_by_week = {clean_str(week.get("id")): clean_str(week.get("course_id")) for week in week_rows}
    for row in component_rows:
        if clean_str(row.get("id")) != component_id:
            continue
        mapped = _activity(free_programme_component_response(row))
        if not mapped.get("quizId"):
            return None, None, _error("No quiz is linked to this activity.", 400)
        try:
            quiz_id = int(str(mapped["quizId"]).strip())
        except (TypeError, ValueError):
            return None, None, _error("No quiz is linked to this activity.", 400)
        return quiz_id, course_by_week.get(clean_str(row.get("free_module_id"))), None
    return None, None, _error("Activity not found.", 404)


@csrf_exempt
@require_POST
@learner_self_or_admin(kwarg="pk")
def submit_free_course_quiz(request, kind, pk, component_id):
    """Grade a free-course quiz and, on a pass, record its completion.

    Reuses the ordinary quiz reader/grader (``_fetch_quiz`` + ``_grade_question``)
    but writes NOTHING to the training-plan/KSB/OTJH stores — a pass records only
    an isolated LearnerFreeCourseProgress row, exactly like any other free-course
    completion.
    """
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    submitted = payload.get("answers") if isinstance(payload, dict) else None
    if not isinstance(submitted, dict):
        return _error("answers must be an object keyed by question id.", 400)

    try:
        quiz_id, free_course_ref, error = _resolve_quiz_component(source, component_id)
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)
    if error is not None:
        return error

    try:
        quiz = _fetch_quiz(quiz_id)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if quiz is None:
        return _error("Quiz not found.", 404)

    earned = 0.0
    possible = 0.0
    breakdown = []
    for question in quiz["questions"]:
        result = _grade_question(question, submitted.get(str(question["id"])))
        earned += result["earned"]
        possible += result["possible"]
        breakdown.append({
            "questionId": question["id"],
            "correct": result["correct"],
            "earned": result["earned"],
            "possible": result["possible"],
            "correctAnswer": result["correctAnswer"],
        })
    grade_pct = round((earned / possible) * 100, 1) if possible else 0.0
    passed = grade_pct >= (quiz["passingGrade"] or 0)

    if passed:
        try:
            LearnerFreeCourseProgress.objects.get_or_create(
                learner_id=source.pk,
                component_ref=component_id,
                defaults={"free_course_ref": free_course_ref, "completed_at": timezone.now()},
            )
        except DatabaseError:
            return _error("Your quiz was graded but could not be saved. Please try again.", 503)

    response = JsonResponse({
        "componentId": component_id,
        "grade": grade_pct,
        "passed": passed,
        "passingGrade": quiz["passingGrade"] or 0,
        "breakdown": breakdown,
    })
    response["Cache-Control"] = "private, no-store"
    return response
