"""Authenticated canonical quiz operations for Free Course authoring."""
from __future__ import annotations

import json

from django.db import DatabaseError, connection, transaction
from django.http import Http404, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from login.permissions import require_all_access
from quiz_api.answer_keys import quiz_publication_error
from quiz_api.models import QuizPackage, QuizQuestion
from quiz_api.views import _question_key_payload, _quiz_preview_payload, _quiz_questions_locked

from . import free_course_authoring
from .free_course_authoring_mutations import MutationError, _check_revision, _expected
from .free_course_writer_mode import CANONICAL, FreeCourseWriterDisabled, _catalogue_lock, require_mode


def _error(exc):
    response = JsonResponse({"error": str(exc), "code": exc.code, **exc.details}, status=exc.status)
    response["Cache-Control"] = "private, no-store"
    return response


def _payload(request):
    try:
        value = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise MutationError("invalid_json", "Invalid JSON body.")
    if not isinstance(value, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    return value


def _owned_component(course_id, week_id, component_id, *, lock=False):
    suffix = " for update" if lock else ""
    with connection.cursor() as cursor:
        cursor.execute(
            "select c.id,c.type,c.settings_json,w.id,w.title,fc.course_name "
            "from curriculum.free_programme_components c "
            "join curriculum.free_course_weeks w on w.id=c.free_module_id "
            "join curriculum.free_courses fc on fc.id=w.course_id "
            "where fc.id=%s and w.id=%s and c.id=%s" + suffix,
            [course_id, week_id, component_id],
        )
        row = cursor.fetchone()
    if not row:
        raise MutationError("cross_course_id", "The quiz component does not belong to this Free Course Week.", status=409)
    if "quiz" not in str(row[1] or "").casefold():
        raise MutationError("not_quiz_component", "Only a quiz activity can own a quiz.")
    settings = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
    return {"componentId": row[0], "type": row[1], "settings": settings, "weekTitle": row[4], "courseName": row[5]}


def _history_count(component_id):
    with connection.cursor() as cursor:
        cursor.execute(
            'select count(*) from "Learner".learner_free_course_progress where component_ref=%s',
            [component_id],
        )
        return cursor.fetchone()[0]


def _quiz_owner(quiz_id, *, lock=False):
    manager = QuizPackage.objects.select_for_update() if lock else QuizPackage.objects
    try:
        return manager.get(pk=quiz_id)
    except QuizPackage.DoesNotExist:
        raise MutationError("quiz_not_found", "Quiz not found.", status=404)


def _assert_owner(quiz, week_id):
    owner = str(quiz.free_course_week_id or "")
    if owner != week_id or str(quiz.week_id or ""):
        raise MutationError(
            "quiz_owner_mismatch",
            "This quiz is not canonically owned by the selected Free Course Week.",
            status=409,
        )


def _set_component_quiz(cursor, component, quiz_id):
    settings = dict(component["settings"])
    settings["linkedQuizId"] = str(quiz_id)
    cursor.execute(
        "update curriculum.free_programme_components set settings_json=%s::jsonb,updated_at=%s where id=%s",
        [json.dumps(settings), timezone.now(), component["componentId"]],
    )


def _canonical_link(cursor, quiz_id, course_id, week_id):
    cursor.execute(
        "select id,free_course_id,free_course_week_id,module_catalogue_id,week_id "
        "from curriculum.quiz_course_links where quiz_id=%s for update",
        [quiz_id],
    )
    links = cursor.fetchall()
    exact = [row for row in links if str(row[1] or "") == course_id and str(row[2] or "") == week_id and not row[3] and not row[4]]
    if len(links) > 1 or len(exact) > 1:
        raise MutationError("duplicate_canonical_quiz_link", "This quiz has duplicate ownership links.", status=409)
    if links and not exact:
        raise MutationError("quiz_owner_mismatch", "This quiz already belongs to different curriculum content.", status=409)
    if not exact:
        cursor.execute(
            "insert into curriculum.quiz_course_links "
            "(quiz_id,module_catalogue_id,week_id,free_course_id,free_course_week_id) "
            "values (%s,null,null,%s,%s)",
            [quiz_id, course_id, week_id],
        )


def _document(course_id):
    return free_course_authoring.course_document(course_id, read_snapshot=False)


def _checked_document(course_id, expected):
    document = _document(course_id)
    _check_revision(expected, document["revision"], scope="course")
    if document.get("integrity", {}).get("status") == "blocked":
        raise MutationError(
            "free_course_integrity_blocked",
            "Resolve blocking Free Course integrity issues before changing quizzes.",
            status=409,
            issues=document.get("integrity", {}).get("issues", []),
        )
    return document


@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
@require_http_methods(["POST"])
def collection(request, course_id):
    try:
        payload = _payload(request)
        expected = _expected(payload)
        week_id = str(payload.get("freeCourseWeekId") or "").strip()
        component_id = str(payload.get("componentId") or "").strip()
        if not week_id or not component_id:
            raise MutationError("validation_error", "freeCourseWeekId and componentId are required.")
        require_mode(CANONICAL)
        with transaction.atomic():
            _catalogue_lock()
            require_mode(CANONICAL)
            _checked_document(course_id, expected)
            component = _owned_component(course_id, week_id, component_id, lock=True)
            current_quiz = str(component["settings"].get("linkedQuizId") or "").strip()
            requested_quiz_id = payload.get("quizId")
            if current_quiz:
                raise MutationError("quiz_already_linked", "This activity already has a linked quiz.", status=409)
            if requested_quiz_id:
                quiz = _quiz_owner(requested_quiz_id, lock=True)
                _assert_owner(quiz, week_id)
            else:
                quiz_title = str(payload.get("title") or component["courseName"] + " quiz").strip()
                if not quiz_title or len(quiz_title) > 255:
                    raise MutationError("validation_error", "Quiz title must be between 1 and 255 characters.")
                quiz = QuizPackage.objects.create(
                    title=quiz_title,
                    programme_id="",
                    programme=component["courseName"],
                    module=component["weekTitle"],
                    week_id="",
                    free_course_week_id=week_id,
                    status="draft",
                    package_type="xml",
                    schema_valid=True,
                    questions=0,
                    linked_courses=1,
                )
            with connection.cursor() as cursor:
                _canonical_link(cursor, quiz.id, course_id, week_id)
                _set_component_quiz(cursor, component, quiz.id)
            document = _document(course_id)
            return JsonResponse({"quiz": _quiz_preview_payload(quiz), "course": document}, status=201 if not requested_quiz_id else 200)
    except MutationError as exc:
        return _error(exc)
    except FreeCourseWriterDisabled as exc:
        return JsonResponse({"error": str(exc), "code": "free_course_writer_disabled"}, status=503)
    except DatabaseError:
        return JsonResponse({"error": "Free Course quiz authoring is temporarily unavailable.", "code": "free_course_quiz_unavailable"}, status=503)


@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
@require_http_methods(["GET", "PATCH", "DELETE"])
def detail(request, course_id, quiz_id):
    try:
        if request.method == "GET":
            quiz = _quiz_owner(quiz_id)
            week_id = str(quiz.free_course_week_id or "")
            if not week_id:
                raise MutationError("quiz_owner_mismatch", "This is not a canonical Free Course quiz.", status=409)
            with connection.cursor() as cursor:
                cursor.execute("select 1 from curriculum.free_course_weeks where id=%s and course_id=%s", [week_id, course_id])
                if not cursor.fetchone():
                    raise MutationError("quiz_owner_mismatch", "This quiz belongs to a different Free Course.", status=409)
            return JsonResponse(_quiz_preview_payload(quiz, include_archived=True))

        payload = _payload(request)
        expected = _expected(payload)
        require_mode(CANONICAL)
        with transaction.atomic():
            _catalogue_lock()
            require_mode(CANONICAL)
            _checked_document(course_id, expected)
            quiz = _quiz_owner(quiz_id, lock=True)
            week_id = str(quiz.free_course_week_id or "")
            _assert_owner(quiz, week_id)
            component_id = str(payload.get("componentId") or "").strip()
            component = _owned_component(course_id, week_id, component_id, lock=True)
            if str(component["settings"].get("linkedQuizId") or "") != str(quiz.id):
                raise MutationError("quiz_owner_mismatch", "The activity is not linked to this quiz.", status=409)
            history = _history_count(component_id)
            if request.method == "DELETE":
                if history:
                    raise MutationError("quiz_has_history", "A quiz with learner history cannot be unlinked.", status=409, progressRecords=history)
                settings = dict(component["settings"])
                settings.pop("linkedQuizId", None)
                with connection.cursor() as cursor:
                    cursor.execute("update curriculum.free_programme_components set settings_json=%s::jsonb,updated_at=%s where id=%s", [json.dumps(settings), timezone.now(), component_id])
                    cursor.execute("delete from curriculum.quiz_course_links where quiz_id=%s and free_course_id=%s and free_course_week_id=%s", [quiz.id, course_id, week_id])
                return JsonResponse({"unlinked": True, "quizId": quiz.id, "course": _document(course_id)})

            if history and quiz.status == "published":
                raise MutationError("quiz_has_history", "A published quiz with learner history is read-only.", status=409, progressRecords=history)
            if "questions" in payload:
                request._canonical_free_course_quiz = True
                response = _quiz_questions_locked(request, quiz.id)
                if response.status_code >= 400:
                    transaction.set_rollback(True)
                    return response
                quiz.refresh_from_db()
            if "title" in payload:
                title = str(payload.get("title") or "").strip()
                if not title:
                    raise MutationError("validation_error", "Quiz title is required.")
                if len(title) > 255:
                    raise MutationError("validation_error", "Quiz title cannot exceed 255 characters.")
                quiz.title = title
            for field, attribute in {
                "shortDescription": "short_description",
                "lessonContent": "lesson_content",
                "timeUnit": "time_unit",
                "quizStyle": "quiz_style",
                "questionType": "default_question_type",
            }.items():
                if field in payload:
                    setattr(quiz, attribute, str(payload.get(field) or ""))
            for field, attribute in {
                "duration": "duration",
                "passingGrade": "passing_grade",
                "retakePointsCut": "retake_points_cut",
            }.items():
                if field in payload:
                    try:
                        setattr(quiz, attribute, max(0, int(payload.get(field) or 0)))
                    except (TypeError, ValueError):
                        raise MutationError("validation_error", f"{field} must be a whole number.")
            for field, attribute in {
                "randomizeQuestions": "randomize_questions",
                "randomizeAnswers": "randomize_answers",
                "showCorrectAnswer": "show_correct_answer",
                "attemptHistory": "attempt_history",
                "retakeAfterPass": "retake_after_pass",
                "limitAttempts": "limit_attempts",
            }.items():
                if field in payload:
                    setattr(quiz, attribute, bool(payload.get(field)))
            if "status" in payload:
                status = str(payload.get("status") or "").strip().lower()
                if status not in {"draft", "published", "private"}:
                    raise MutationError("validation_error", "Unsupported quiz status.")
                if status == "published":
                    questions = QuizQuestion.objects.filter(quiz_id=quiz.id, is_archived=False).prefetch_related("answers")
                    publication_error = quiz_publication_error([_question_key_payload(question) for question in questions])
                    if publication_error:
                        raise MutationError("quiz_not_publishable", publication_error)
                    if not quiz.published_at:
                        quiz.published_at = timezone.now()
                quiz.status = status
            quiz.questions = QuizQuestion.objects.filter(quiz_id=quiz.id, is_archived=False).count()
            quiz.save()
            quiz.refresh_from_db()
            return JsonResponse({"quiz": _quiz_preview_payload(quiz, include_archived=True), "course": _document(course_id)})
    except MutationError as exc:
        return _error(exc)
    except FreeCourseWriterDisabled as exc:
        return JsonResponse({"error": str(exc), "code": "free_course_writer_disabled"}, status=503)
    except Http404:
        return JsonResponse({"error": "Quiz not found.", "code": "quiz_not_found"}, status=404)
    except DatabaseError:
        return JsonResponse({"error": "Free Course quiz authoring is temporarily unavailable.", "code": "free_course_quiz_unavailable"}, status=503)
