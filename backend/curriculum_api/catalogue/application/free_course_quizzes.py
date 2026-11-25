"""Canonical quiz use cases with explicit storage, question-writer and response capabilities.

Responses are constructed inside the original atomic scopes, preserving rollback
when downstream serialization or question handling fails. No HTTP/ORM imports.
"""
from ..domain.free_course_authoring import MutationError, _expected
from ..domain.free_course_quizzes import assert_owner, checked_document


def create_quiz(payload, course_id, *, storage, document, preview, reply):
    expected = _expected(payload)
    week_id = str(payload.get("freeCourseWeekId") or "").strip()
    component_id = str(payload.get("componentId") or "").strip()
    if not week_id or not component_id:
        raise MutationError("validation_error", "freeCourseWeekId and componentId are required.")
    storage.require_canonical()
    with storage.atomic():
        storage._catalogue_lock()
        storage.require_canonical()
        checked_document(document(course_id), expected)
        component = storage._owned_component(course_id, week_id, component_id, lock=True)
        current_quiz = str(component["settings"].get("linkedQuizId") or "").strip()
        requested_quiz_id = payload.get("quizId")
        if current_quiz:
            raise MutationError("quiz_already_linked", "This activity already has a linked quiz.", status=409)
        if requested_quiz_id:
            quiz = storage._quiz_owner(requested_quiz_id, lock=True)
            assert_owner(quiz.free_course_week_id, quiz.week_id, week_id)
        else:
            quiz_title = str(payload.get("title") or component["courseName"] + " quiz").strip()
            if not quiz_title or len(quiz_title) > 255:
                raise MutationError("validation_error", "Quiz title must be between 1 and 255 characters.")
            quiz = storage.create_quiz(
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
        storage.link_component(quiz.id, course_id, week_id, component)
        course = document(course_id)
        return reply({"quiz": preview(quiz), "course": course}, status=201 if not requested_quiz_id else 200)


def quiz_detail(method, course_id, quiz_id, *, load_payload, storage, document,
                preview, reply, save_questions, publication_check, clock):
    if method == "GET":
        quiz = storage._quiz_owner(quiz_id)
        week_id = str(quiz.free_course_week_id or "")
        if not week_id:
            raise MutationError("quiz_owner_mismatch", "This is not a canonical Free Course quiz.", status=409)
        if not storage.owns_week(week_id, course_id):
            raise MutationError("quiz_owner_mismatch", "This quiz belongs to a different Free Course.", status=409)
        return reply(preview(quiz, include_archived=True))

    payload = load_payload()
    expected = _expected(payload)
    storage.require_canonical()
    with storage.atomic():
        storage._catalogue_lock()
        storage.require_canonical()
        checked_document(document(course_id), expected)
        quiz = storage._quiz_owner(quiz_id, lock=True)
        week_id = str(quiz.free_course_week_id or "")
        assert_owner(quiz.free_course_week_id, quiz.week_id, week_id)
        component_id = str(payload.get("componentId") or "").strip()
        component = storage._owned_component(course_id, week_id, component_id, lock=True)
        if str(component["settings"].get("linkedQuizId") or "") != str(quiz.id):
            raise MutationError("quiz_owner_mismatch", "The activity is not linked to this quiz.", status=409)
        history = storage._history_count(component_id)
        if method == "DELETE":
            if history:
                raise MutationError("quiz_has_history", "A quiz with learner history cannot be unlinked.", status=409, progressRecords=history)
            settings = dict(component["settings"])
            settings.pop("linkedQuizId", None)
            storage.unlink_component(component_id, settings, quiz.id, course_id, week_id)
            return reply({"unlinked": True, "quizId": quiz.id, "course": document(course_id)})

        if history and quiz.status == "published":
            raise MutationError("quiz_has_history", "A published quiz with learner history is read-only.", status=409, progressRecords=history)
        if "questions" in payload:
            refused = save_questions(quiz.id)
            if refused is not None:
                storage.rollback()
                return refused
            storage.refresh_quiz(quiz)
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
                publication_error = publication_check(quiz.id)
                if publication_error:
                    raise MutationError("quiz_not_publishable", publication_error)
                if not quiz.published_at:
                    quiz.published_at = clock()
            quiz.status = status
        quiz.questions = storage.active_question_count(quiz.id)
        storage.save_quiz(quiz)
        storage.refresh_quiz(quiz)
        return reply({"quiz": preview(quiz, include_archived=True), "course": document(course_id)})
