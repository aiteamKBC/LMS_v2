"""Canonical catalogue/quiz reads and read-only snapshots for authoring.

No provisioning, writer or legacy views dependency.
"""
from contextlib import contextmanager
from django.db import connection, transaction
from ... import schema_gate
from . import free_course_rows as free_course_catalogue
from curriculum_api.catalogue.domain.free_course_revisions import QUIZ_LINK_REVISION_COLUMNS

QUIZZES_TABLE = "quizzes"

QUIZ_LINKS_TABLE = "quiz_course_links"

def _quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def _table_name(table):
    if connection.vendor == "postgresql":
        return f'{_quote_ident(schema_gate.CURRICULUM_SCHEMA)}.{_quote_ident(table)}'
    return _quote_ident(table)


def _dict_rows(cursor):
    columns = [column[0] for column in cursor.description or ()]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _quiz_rows(quiz_ids):
    quiz_ids = sorted({str(value) for value in quiz_ids if value is not None and str(value)})
    if not quiz_ids:
        return []
    placeholders = ", ".join(["%s"] * len(quiz_ids))
    sql = (
        'select "id", "free_course_week_id", "status", "week_id" '
        f'from {_table_name(QUIZZES_TABLE)} where "id" in ({placeholders})'
    )
    with connection.cursor() as cursor:
        cursor.execute(sql, quiz_ids)
        return _dict_rows(cursor)


def _quiz_link_rows(course_id, quiz_ids):
    quiz_ids = sorted({str(value) for value in quiz_ids if value is not None and str(value)})
    columns = ", ".join(_quote_ident(column) for column in QUIZ_LINK_REVISION_COLUMNS)
    sql = (f"select {columns} from {_table_name(QUIZ_LINKS_TABLE)} "
           f'where ("free_course_id" = %s and {_current_quiz_link_clause()})')
    params = [course_id]
    if quiz_ids:
        placeholders = ", ".join(["%s"] * len(quiz_ids))
        sql += (
            f' or ("quiz_id" in ({placeholders}) '
            'and "free_course_week_id" is not null)'
        )
        params.extend(quiz_ids)
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return _dict_rows(cursor)


def _current_quiz_link_clause():
    # Keep historical quiz ownership intact, without reporting its archived
    # week as a missing current owner. Explicit live component references still
    # fetch these links through the OR branch and receive the usual validation.
    links = _table_name(QUIZ_LINKS_TABLE)
    weeks = _table_name(free_course_catalogue.FREE_COURSE_WEEKS_TABLE)
    return (f"not exists (select 1 from {weeks} archived "
            f"where archived.id={links}.free_course_week_id "
            f"and archived.course_id={links}.free_course_id "
            "and archived.deleted_at is not null)")


@contextmanager
def _read_snapshot():
    """Use one repeatable, read-only PostgreSQL snapshot for a document."""
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        yield


def _require_course_tables():
    schema_gate.require_tables(
        free_course_catalogue.FREE_COURSES_TABLE,
        free_course_catalogue.FREE_COURSE_WEEKS_TABLE,
        free_course_catalogue.FREE_COMPONENTS_TABLE,
        QUIZZES_TABLE,
        QUIZ_LINKS_TABLE,
    )


def _quiz_link_rows_for_courses(course_ids, quiz_ids):
    """Every link row any of ``course_ids`` would read through _quiz_link_rows."""
    course_ids = sorted({str(value) for value in course_ids if value})
    quiz_ids = sorted({str(value) for value in quiz_ids if value is not None and str(value)})
    if not course_ids and not quiz_ids:
        return []
    columns = ", ".join(_quote_ident(column) for column in QUIZ_LINK_REVISION_COLUMNS)
    clauses, params = [], []
    if course_ids:
        clauses.append(f'("free_course_id" in ({", ".join(["%s"] * len(course_ids))}) '
                       f'and {_current_quiz_link_clause()})')
        params.extend(course_ids)
    if quiz_ids:
        clauses.append(
            f'("quiz_id" in ({", ".join(["%s"] * len(quiz_ids))}) '
            'and "free_course_week_id" is not null)'
        )
        params.extend(quiz_ids)
    sql = f"select {columns} from {_table_name(QUIZ_LINKS_TABLE)} where " + " or ".join(clauses)
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return _dict_rows(cursor)


def require_catalogue_tables():
    schema_gate.require_tables(free_course_catalogue.FREE_COURSES_TABLE)
