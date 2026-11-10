"""Learner-scoped read of the free courses assigned to a learner.

Free courses are authored in the canonical curriculum tables and assigned to a
canonical ``Learner.learners`` identity through
``Learner.learner_free_courses``. The legacy
``enrolment.Created_users.Free_courses`` JSON is not an entitlement source.

These views are the learner-facing counterpart: the list returns lightweight
cards for current assignments, and an assignment-scoped detail request returns
one course's authored week/activity tree. Completion is stored separately from
Programme progress, hours and KSBs.

Identity is resolved SERVER-SIDE and never trusted from the client (same gate as
``learner_detail``/``training_plan``): the caller supplies only the
ownership-gated learner record id. The curriculum catalogue is staff-gated, so a
learner session cannot fetch it directly — the enrichment therefore happens
here, in-process, and only the learner's *assigned* courses are ever returned.
"""

import json
import logging

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from login.permissions import learner_self_only, learner_self_or_staff
from login.errors import safe_sqlstate

from curriculum_api import free_course_catalogue
from curriculum_api.views import (
    active_component_rows,
    active_week_rows,
    authoring_table_name,
    clean_str,
    free_programme_component_response,
    programme_deleted_row,
    truthy,
)

from .learner_detail import (
    _component_files,
    _component_resource_url,
    _video_url_from_settings,
    component_audio_url,
)
from .free_course_selectors import VALID_LEARNER_KINDS, assigned_course_ids, canonical_learner
from .mappers import _s
from .models import LearnerFreeCourseProgress, LearnerProfile
from .quizzes import _fetch_quiz, _grade_question, _scrub_answer_key
from quiz_api.answer_keys import quiz_submission_error

logger = logging.getLogger(__name__)

INACTIVE_COURSE_STATUSES = {"inactive", "archived"}

COURSE_COLUMNS = [
    "id", "course_name", "description", "cover_image_url", "display_order",
    "week_count", "component_count",
]
WEEK_COLUMNS = [
    "id", "course_id", "week_number", "title", "summary",
    "learning_outcomes", "status", "holiday_note_enabled", "holiday_note",
    "legacy_copied_from_week_id", "display_order",
]
COMPONENT_SUMMARY_COLUMNS = [
    "id", "free_module_id", "type", "display_order",
]
COMPONENT_DETAIL_COLUMNS = [
    *COMPONENT_SUMMARY_COLUMNS, "title", "description", "settings_json",
]


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _active_course_rows(rows):
    """Current catalogue courses only, including legacy lifecycle columns."""
    return [
        row for row in rows
        if not programme_deleted_row(row)
        and _s(row.get("status")).lower() not in INACTIVE_COURSE_STATUSES
        and not truthy(row.get("is_archived"))
    ]


def _catalogue_batch(reads):
    """Several curriculum reads in one round trip, with the same safe logging.

    ``reads`` is ``[(stage, table, where_sql, params, order_sql, columns), ...]``.
    """
    try:
        return free_course_catalogue.fetch_many([
            (table, where_sql, params, order_sql, columns)
            for _stage, table, where_sql, params, order_sql, columns in reads
        ])
    except DatabaseError as exc:
        logger.error(
            "free_course_catalogue_query_failed stage=%s table=%s type=%s sqlstate=%s",
            "+".join(read[0] for read in reads),
            "+".join(read[1] for read in reads),
            type(exc).__name__,
            safe_sqlstate(exc),
        )
        raise


def _completed_refs(learner_id, course_ids):
    """Canonical ``(course, component)`` completion keys for this learner."""
    return set(
        LearnerFreeCourseProgress.objects
        .filter(learner_id=learner_id, free_course_ref__in=course_ids)
        .values_list("free_course_ref", "component_ref")
    )


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
    # Resolved once: `files` below reports the same document as its first entry,
    # so the two must be read from one resolution rather than two.
    resource_url = _component_resource_url(settings)
    return {
        "componentId": _s(component.get("id")),
        "title": _s(component.get("title")),
        "type": ctype,
        "description": _s(component.get("description")) or None,
        "videoUrl": _video_url_from_settings(settings),
        "audioUrl": component_audio_url(settings, ctype),
        "resourceUrl": resource_url,
        "contentHtml": _s(settings.get("readingContent")) or None,
        "fileName": file_name,
        # Everything the author attached, in their order. Entry 0 is the same
        # file `resourceUrl` points at; the rest are the extra attachments a
        # free-course reading, deck or podcast can carry.
        "files": _component_files(settings, resource_url, file_name),
        "downloadAllowed": bool(settings.get("downloadAllowed")),
        "quizId": (_s(settings.get("linkedQuizId")) or None) if is_quiz else None,
        "manualUnlock": bool(settings.get("manualUnlock")) if is_quiz else False,
    }


def _resolve_source(kind, pk):
    """Resolve the URL enrolment id to its canonical learner identity."""
    if kind not in VALID_LEARNER_KINDS:
        return None, _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)
    try:
        return canonical_learner(kind, pk), None
    except LearnerProfile.DoesNotExist:
        return None, _error("Learner not found.", 404)
    except DatabaseError:
        return None, _error("Could not read the learner record.", 503)


def _in_clause(column, values):
    return f"{column} in ({', '.join(['%s'] * len(values))})", list(values)


def _scoped_rows(assigned_ids, *, include_component_settings=True):
    """Fetch only the assigned courses' course/week/component rows.

    The list path deliberately omits component settings and media. Detail reads
    include those columns for one assigned course only.
    """
    assigned_ids = list(dict.fromkeys(clean_str(value) for value in assigned_ids if clean_str(value)))
    if not assigned_ids:
        return {}, [], []
    course_where, course_params = _in_clause("id", assigned_ids)
    week_where, week_params = _in_clause("course_id", assigned_ids)
    # Components of the assigned courses' weeks, selected by course so all
    # three reads go to the database together (one round trip). Rows of an
    # archived or orphaned week are dropped below with the week itself.
    component_where = (
        f"free_module_id in (select id from {authoring_table_name(free_course_catalogue.FREE_COURSE_WEEKS_TABLE)} "
        f"where {week_where})"
    )
    course_rows, week_rows, component_rows = _catalogue_batch([
        ("courses", free_course_catalogue.FREE_COURSES_TABLE, course_where, course_params,
         "display_order, course_name, id", COURSE_COLUMNS),
        ("weeks", free_course_catalogue.FREE_COURSE_WEEKS_TABLE, week_where, week_params,
         "display_order, week_number, id", WEEK_COLUMNS),
        ("components", free_course_catalogue.FREE_COMPONENTS_TABLE, component_where, week_params,
         "display_order, title, id",
         COMPONENT_DETAIL_COLUMNS if include_component_settings else COMPONENT_SUMMARY_COLUMNS),
    ])
    courses_by_id = {clean_str(row.get("id")): row for row in _active_course_rows(course_rows)
                     if clean_str(row.get("id")) in assigned_ids}
    week_rows = active_week_rows(week_rows)
    # A legacy/orphan week must not resurrect a missing or archived course.
    week_rows = [week for week in week_rows if clean_str(week.get("course_id")) in courses_by_id]
    week_ids = {clean_str(week.get("id")) for week in week_rows if clean_str(week.get("id"))}
    component_rows = [
        row for row in active_component_rows(component_rows)
        if clean_str(row.get("free_module_id")) in week_ids
    ]
    return courses_by_id, week_rows, component_rows


def _course_detail(course_id, course_row, week_rows, component_rows, completed_refs):
    """Build one on-demand course tree in canonical curriculum order."""
    activities_by_week = {}
    for row in component_rows:
        activity = _activity(free_programme_component_response(row))
        activity["completed"] = (course_id, activity["componentId"]) in completed_refs
        activities_by_week.setdefault(clean_str(row.get("free_module_id")), []).append(activity)

    weeks = []
    for week in week_rows:
        if clean_str(week.get("course_id")) != course_id:
            continue
        week_id = clean_str(week.get("id"))
        identity = free_course_catalogue.week_api_identity(week)
        weeks.append({
            **identity,
            "weekNumber": week.get("week_number") if isinstance(week.get("week_number"), int) else 0,
            "weekTitle": clean_str(week.get("title")),
            "weekSummary": clean_str(week.get("summary")),
            "summary": clean_str(week.get("summary")),
            "status": clean_str(week.get("status")),
            "learningOutcomes": week.get("learning_outcomes") if isinstance(week.get("learning_outcomes"), list) else [],
            "holidayNoteEnabled": bool(week.get("holiday_note_enabled")),
            "holidayNote": clean_str(week.get("holiday_note")),
            "displayOrder": week.get("display_order") if isinstance(week.get("display_order"), int) else 0,
            "activities": activities_by_week.get(week_id, []),
        })

    return {
        "freeCourseId": course_id,
        "courseName": clean_str(course_row.get("course_name")),
        "description": clean_str(course_row.get("description")),
        "coverImageUrl": clean_str(course_row.get("cover_image_url")),
        "weeks": weeks,
    }


@require_GET
@learner_self_or_staff(kwarg="pk")
def free_courses(request, kind, pk):
    """Return lightweight cards for this learner's current assignments.

    Component settings, media and quiz metadata are loaded only when one course
    is opened through :func:`free_course_detail`.
    """
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    try:
        assigned_ids = assigned_course_ids(source)
    except DatabaseError:
        return _error("Could not read the learner's free course assignments.", 503)
    if not assigned_ids:
        response = JsonResponse({"freeCourses": []})
        response["Cache-Control"] = "private, no-store"
        return response

    try:
        courses_by_id, week_rows, component_rows = _scoped_rows(
            assigned_ids, include_component_settings=False,
        )
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)

    # This learner's own free-course completions — a separate store that never
    # touches OTJH/KSB or the programme's overall progress. A database failure is
    # not equivalent to having no progress and must remain visible to the caller.
    try:
        completed_refs = _completed_refs(source.pk, assigned_ids)
    except DatabaseError:
        return _error("Could not read the learner's free course progress.", 503)

    course_by_week = {
        clean_str(week.get("id")): clean_str(week.get("course_id"))
        for week in week_rows
    }
    activity_totals = {}
    completed_totals = {}
    for row in component_rows:
        component_id = clean_str(row.get("id"))
        course_id = course_by_week.get(clean_str(row.get("free_module_id")))
        if not component_id or not course_id:
            continue
        activity_totals[course_id] = activity_totals.get(course_id, 0) + 1
        if (course_id, component_id) in completed_refs:
            completed_totals[course_id] = completed_totals.get(course_id, 0) + 1

    week_totals = {}
    for week in week_rows:
        course_id = clean_str(week.get("course_id"))
        if course_id:
            week_totals[course_id] = week_totals.get(course_id, 0) + 1

    # Preserve Learning Plan order, but do not expose a missing/withdrawn
    # catalogue course. Its assignment record remains intact for history.
    result = []
    for course_id in assigned_ids:
        course = courses_by_id.get(course_id)
        if course is None:
            continue
        activity_count = activity_totals.get(course_id, 0)
        completed_count = min(completed_totals.get(course_id, 0), activity_count)
        result.append({
            "freeCourseId": course_id,
            "courseName": clean_str(course.get("course_name")),
            "description": clean_str(course.get("description")),
            "coverImageUrl": clean_str(course.get("cover_image_url")),
            "weekCount": week_totals.get(course_id, 0),
            "activityCount": activity_count,
            "completedActivities": completed_count,
            "progressPercentage": round((completed_count / activity_count) * 100) if activity_count else 0,
        })

    response = JsonResponse({"freeCourses": result})
    response["Cache-Control"] = "private, no-store"
    return response


@require_GET
@learner_self_or_staff(kwarg="pk")
def free_course_detail(request, kind, pk, course_id):
    """Return one assigned course's canonical weeks and component content."""
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    try:
        assigned_ids = set(assigned_course_ids(source))
    except DatabaseError:
        return _error("Could not read the learner's free course assignments.", 503)
    course_id = _s(course_id)
    if not course_id or course_id not in assigned_ids:
        return _error("Course not found.", 404)

    try:
        courses_by_id, week_rows, component_rows = _scoped_rows([course_id])
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)
    course = courses_by_id.get(course_id)
    if course is None:
        return _error("Course not found.", 404)

    try:
        completed_refs = _completed_refs(source.pk, [course_id])
    except DatabaseError:
        return _error("Could not read the learner's free course progress.", 503)

    response = JsonResponse({
        "freeCourse": _course_detail(course_id, course, week_rows, component_rows, completed_refs),
    })
    response["Cache-Control"] = "private, no-store"
    return response


@csrf_exempt
@require_POST
# Staff/admin preview is read-only; only the learner can create completion.
@learner_self_only(kwarg="pk")
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

    try:
        assigned_ids = assigned_course_ids(source)
    except DatabaseError:
        return _error("Could not read the learner's free course assignments.", 503)
    if not assigned_ids:
        return _error("Activity not found.", 404)

    # Resolve the component within the learner's assigned courses, so a stray id
    # cannot record a completion against unassigned content.
    try:
        courses, week_rows, component_rows = _scoped_rows(
            assigned_ids, include_component_settings=False,
        )
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)

    course_by_week = {clean_str(week.get("id")): clean_str(week.get("course_id")) for week in week_rows}
    free_course_ref = None
    found = False
    for row in component_rows:
        if clean_str(row.get("id")) == component_id:
            # Quiz completion is owned exclusively by the graded submit path
            # below.  The generic activity endpoint must never turn possession
            # of a component id into an ungraded quiz completion.
            if "quiz" in clean_str(row.get("type")).lower():
                return _error(
                    "Quiz activities can only be completed by passing the quiz.",
                    409,
                )
            free_course_ref = course_by_week.get(clean_str(row.get("free_module_id")))
            found = bool(free_course_ref and free_course_ref in courses)
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
    assigned_ids = assigned_course_ids(source)
    if not assigned_ids:
        return None, None, _error("Activity not found.", 404)

    courses, week_rows, component_rows = _scoped_rows(assigned_ids)
    course_by_week = {clean_str(week.get("id")): clean_str(week.get("course_id")) for week in week_rows}
    for row in component_rows:
        if clean_str(row.get("id")) != component_id:
            continue
        free_course_ref = course_by_week.get(clean_str(row.get("free_module_id")))
        # An assignment record is not sufficient by itself: the course must
        # still exist in the canonical catalogue and the component must still
        # belong to one of its active weeks.
        if not free_course_ref or free_course_ref not in courses:
            return None, None, _error("Activity not found.", 404)
        mapped = _activity(free_programme_component_response(row))
        if not mapped.get("quizId"):
            return None, None, _error("No quiz is linked to this activity.", 400)
        try:
            quiz_id = int(str(mapped["quizId"]).strip())
        except (TypeError, ValueError):
            return None, None, _error("No quiz is linked to this activity.", 400)
        if not _quiz_owner_is_valid(quiz_id, free_course_ref, clean_str(row.get("free_module_id"))):
            return None, None, _error("This quiz is not available for this Free Course activity.", 409)
        return quiz_id, free_course_ref, None
    return None, None, _error("Activity not found.", 404)


def _quiz_owner_is_valid(quiz_id, course_id, week_id):
    """Accept exact canonical ownership or an unchanged legacy normal owner."""
    with connections["enrolment"].cursor() as cursor:
        cursor.execute(
            "select q.free_course_week_id,q.week_id,"
            "count(l.id) filter (where l.free_course_id=%s and l.free_course_week_id=%s "
            "and l.module_catalogue_id is null and l.week_id is null),"
            "count(l.id) filter (where l.free_course_id is not null or l.free_course_week_id is not null) "
            "from curriculum.quizzes q left join curriculum.quiz_course_links l on l.quiz_id=q.id "
            "where q.id=%s group by q.id,q.free_course_week_id,q.week_id",
            [course_id, week_id, quiz_id],
        )
        row = cursor.fetchone()
    if not row:
        return False
    canonical_week, normal_week, exact_links, canonical_links = row
    if canonical_week:
        return str(canonical_week) == week_id and not normal_week and exact_links == 1 and canonical_links == 1
    # The 110 legacy references remain read-only and usable only while they
    # still have an explicit normal Curriculum owner and no canonical link.
    return bool(normal_week) and canonical_links == 0


@require_GET
@learner_self_or_staff(kwarg="pk")
def free_course_quiz(request, kind, pk, component_id):
    """Return a quiz only through an eligible, currently assigned component."""
    source, error = _resolve_source(kind, pk)
    if error is not None:
        return error

    try:
        quiz_id, _free_course_ref, error = _resolve_quiz_component(source, component_id)
    except DatabaseError:
        return _error("Could not read the free course catalogue.", 503)
    if error is not None:
        return error

    try:
        quiz = _fetch_quiz(quiz_id)
    except DatabaseError:
        return _error("Could not read this quiz. Please try again.", 503)
    if quiz is None:
        return _error("Quiz not found.", 404)

    response = JsonResponse(_scrub_answer_key(quiz))
    response["Cache-Control"] = "private, no-store"
    return response


@csrf_exempt
@require_POST
@learner_self_only(kwarg="pk")
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
    except DatabaseError:
        return _error("Could not read this quiz. Please try again.", 503)
    if quiz is None:
        return _error("Quiz not found.", 404)

    grading_error = quiz_submission_error(quiz, submitted)
    if grading_error:
        return _error(grading_error, 409)

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
