"""Protect question identities retained by learner answer history."""
from django.db import connections

from learner_api.models import LearnerQuizAnswer


def referenced_question_ids(questions, *, lock=False):
    # Materialise IDs: curriculum and learner models use different DB aliases.
    # Lock before checking history so an FK insert cannot race a hard deletion.
    if lock:
        questions = questions.select_for_update()
    ids = list(questions.order_by("id").values_list("id", flat=True))
    if not ids:
        return set()
    return set(LearnerQuizAnswer.objects.filter(question_ref__in=ids)
               .order_by().values_list("question_ref", flat=True).distinct())


def is_question_reference_violation(error, *, using="default"):
    """Recognise only the planned FK, regardless of the DB team's chosen name.

    Call after the failing atomic block has rolled back. Never classify other
    foreign keys, unique constraints or missing schema as this conflict.
    """
    cause = error.__cause__
    # PostgreSQL can report RESTRICT deletions as 23001; missing referenced
    # questions on insert (and older FK errors) use 23503.
    if getattr(cause, "sqlstate", getattr(cause, "pgcode", None)) not in {"23503", "23001"}:
        return False
    diag = getattr(cause, "diag", None)
    if (getattr(diag, "schema_name", None), getattr(diag, "table_name", None)) != (
        "Learner", "learner_quiz_answers",
    ):
        return False
    with connections[using].cursor() as cursor:
        cursor.execute("""
            SELECT 1 FROM pg_constraint c
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND c.conkey = ARRAY[a.attnum]
            JOIN pg_attribute q ON q.attrelid = c.confrelid AND c.confkey = ARRAY[q.attnum]
            WHERE c.contype = 'f' AND c.conname = %s
              AND c.conrelid = '"Learner".learner_quiz_answers'::regclass
              AND c.confrelid = 'curriculum.quiz_questions'::regclass
              AND a.attname = 'question_ref' AND q.attname = 'id'
        """, [diag.constraint_name])
        return cursor.fetchone() is not None
