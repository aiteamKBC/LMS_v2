"""Authenticated HTTP and cross-Quiz-API composition for Free Course quiz use cases."""
import json
from django.db import DatabaseError, IntegrityError
from django.http import Http404, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from login.permissions import require_all_access
from quiz_api.answer_keys import quiz_publication_error
from quiz_api.history import is_question_reference_violation
from quiz_api.views import _question_key_payload, _quiz_preview_payload, _quiz_questions_locked
from . import free_course_authoring
from ..application import free_course_quizzes as workflow
from ..infrastructure import free_course_quizzes as storage
from ..domain.free_course_authoring import MutationError
from ..infrastructure.free_course_writer_mode import FreeCourseWriterDisabled
# Existing public helper consumer; implementation has one infrastructure owner.
from ..infrastructure.free_course_quizzes import _owned_component


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


def _document(course_id):
    return free_course_authoring.course_document(course_id, read_snapshot=False)


def _publication_check(quiz_id):
    questions = storage.publication_questions(quiz_id)
    return quiz_publication_error([_question_key_payload(question) for question in questions])


def _save_questions(request, quiz_id):
    request._canonical_free_course_quiz = True
    response = _quiz_questions_locked(request, quiz_id)
    return response if response.status_code >= 400 else None


@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
@require_http_methods(["POST"])
def collection(request, course_id):
    try:
        payload = _payload(request)
        return workflow.create_quiz(payload, course_id, storage=storage, document=_document,
                                    preview=_quiz_preview_payload, reply=JsonResponse)
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
        return workflow.quiz_detail(request.method, course_id, quiz_id,
            load_payload=lambda: _payload(request), storage=storage, document=_document,
            preview=_quiz_preview_payload, reply=JsonResponse,
            save_questions=lambda ident: _save_questions(request, ident),
            publication_check=_publication_check, clock=timezone.now)
    except MutationError as exc:
        return _error(exc)
    except FreeCourseWriterDisabled as exc:
        return JsonResponse({"error": str(exc), "code": "free_course_writer_disabled"}, status=503)
    except Http404:
        return JsonResponse({"error": "Quiz not found.", "code": "quiz_not_found"}, status=404)
    except DatabaseError as exc:
        if isinstance(exc, IntegrityError) and is_question_reference_violation(exc):
            return JsonResponse({"error": "A question now has learner answers. Reload the editor and try again.", "code": "quiz_has_history"}, status=409)
        return JsonResponse({"error": "Free Course quiz authoring is temporarily unavailable.", "code": "free_course_quiz_unavailable"}, status=503)
