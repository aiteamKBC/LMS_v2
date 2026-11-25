"""Exact Free Course quiz SQL/ORM operations; transactions remain use-case owned."""
import json
from django.db import connection, transaction
from django.utils import timezone
from quiz_api.models import QuizPackage, QuizQuestion
from ..domain.free_course_authoring import MutationError
from ..domain.free_course_quizzes import owned_component, canonical_link_required
from .free_course_writer_mode import CANONICAL, require_mode, _catalogue_lock


def atomic():
    return transaction.atomic()


def require_canonical():
    require_mode(CANONICAL)


def rollback():
    transaction.set_rollback(True)


def _owned_component(course_id, week_id, component_id, *, lock=False):
    suffix = " for update" if lock else ""
    with connection.cursor() as cursor:
        cursor.execute(
            "select c.id,c.type,c.settings_json,w.id,w.title,fc.course_name "
            "from curriculum.free_programme_components c "
            "join curriculum.free_course_weeks w on w.id=c.free_module_id "
            "join curriculum.free_courses fc on fc.id=w.course_id "
            "where fc.id=%s and w.id=%s and c.id=%s "
            "and w.deleted_at is null and c.deleted_at is null" + suffix,
            [course_id, week_id, component_id],
        )
        row = cursor.fetchone()
    return owned_component(row)


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
    if canonical_link_required(links, course_id, week_id):
        cursor.execute(
            "insert into curriculum.quiz_course_links "
            "(quiz_id,module_catalogue_id,week_id,free_course_id,free_course_week_id) "
            "values (%s,null,null,%s,%s)",
            [quiz_id, course_id, week_id],
        )


def create_quiz(**values):
    return QuizPackage.objects.create(**values)


def link_component(quiz_id, course_id, week_id, component):
    with connection.cursor() as cursor:
        _canonical_link(cursor, quiz_id, course_id, week_id)
        _set_component_quiz(cursor, component, quiz_id)


def owns_week(week_id, course_id):
    with connection.cursor() as cursor:
        cursor.execute("select 1 from curriculum.free_course_weeks where id=%s and course_id=%s", [week_id, course_id])
        return bool(cursor.fetchone())


def unlink_component(component_id, settings, quiz_id, course_id, week_id):
    with connection.cursor() as cursor:
        cursor.execute("update curriculum.free_programme_components set settings_json=%s::jsonb,updated_at=%s where id=%s", [json.dumps(settings), timezone.now(), component_id])
        cursor.execute("delete from curriculum.quiz_course_links where quiz_id=%s and free_course_id=%s and free_course_week_id=%s", [quiz_id, course_id, week_id])


def publication_questions(quiz_id):
    return QuizQuestion.objects.filter(quiz_id=quiz_id, is_archived=False).prefetch_related("answers")


def active_question_count(quiz_id):
    return QuizQuestion.objects.filter(quiz_id=quiz_id, is_archived=False).count()


def refresh_quiz(quiz):
    quiz.refresh_from_db()


def save_quiz(quiz):
    quiz.save()
