"""Canonical Free Course SQL, preserving statement order and cursor lifetimes."""
from contextlib import contextmanager
import json
from django.db import connection, transaction
from django.utils import timezone
from ..domain.free_course_authoring import MutationError, IDEMPOTENCY_OPERATION, PROGRAMME_MARKER, _changed
from .free_course_writer_mode import require_mode, _catalogue_lock
from .free_course_rows import courses as catalogue_rows

atomic = transaction.atomic

def _rows(cursor):
    names = [column[0] for column in cursor.description or ()]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _course_rows(*, lock=False):
    suffix = " for update" if lock else ""
    with connection.cursor() as cursor:
        cursor.execute(
            "select * from curriculum.free_courses order by display_order, id" + suffix
        )
        return _rows(cursor)


def _tree(course_id, *, lock=False, include_deleted=False):
    suffix = " for update" if lock else ""
    current = "" if include_deleted else " and deleted_at is null"
    with connection.cursor() as cursor:
        cursor.execute(
            "select * from curriculum.free_courses where id=%s" + suffix,
            [course_id],
        )
        course = next(iter(_rows(cursor)), None)
        if not course:
            raise MutationError("free_course_not_found", "Free Course not found.", status=404)
        cursor.execute(
            "select * from curriculum.free_course_weeks where course_id=%s" + current + " order by id" + suffix,
            [course_id],
        )
        weeks = _rows(cursor)
        week_ids = [row["id"] for row in weeks]
        components = []
        if week_ids:
            cursor.execute(
                "select * from curriculum.free_programme_components "
                "where free_module_id = any(%s::varchar[])" + current + " order by id" + suffix,
                [week_ids],
            )
            components = _rows(cursor)
    return course, weeks, components


def _ledger_row(staff_id, key, *, lock=False):
    suffix = " for update" if lock else ""
    with connection.cursor() as cursor:
        cursor.execute(
            "select * from curriculum.free_course_authoring_idempotency "
            "where staff_subject_id=%s and operation=%s and idempotency_key=%s" + suffix,
            [staff_id, IDEMPOTENCY_OPERATION, key],
        )
        return next(iter(_rows(cursor)), None)


def _purge_expired_idempotency():
    """Bound lazy retention cleanup to avoid an unbounded delete on a request."""
    with connection.cursor() as cursor:
        cursor.execute(
            "with expired as (select id from curriculum.free_course_authoring_idempotency "
            "where state='completed' and expires_at < transaction_timestamp() order by expires_at,id limit 500) "
            "delete from curriculum.free_course_authoring_idempotency l using expired e where l.id=e.id"
        )


def _dependency_counts(course_id, week_ids, component_ids):
    with connection.cursor() as cursor:
        cursor.execute('select count(*) from "Learner".learner_free_courses where free_course_ref=%s', [course_id])
        assignments = cursor.fetchone()[0]
        cursor.execute('select count(*) from "Learner".learner_free_course_progress where free_course_ref=%s', [course_id])
        progress = cursor.fetchone()[0]
        quiz_links = quizzes = 0
        if week_ids:
            cursor.execute('select count(*) from curriculum.quiz_course_links where free_course_id=%s or free_course_week_id=any(%s::varchar[])', [course_id, week_ids])
            quiz_links = cursor.fetchone()[0]
            cursor.execute('select count(*) from curriculum.quizzes where free_course_week_id=any(%s::varchar[])', [week_ids])
            quizzes = cursor.fetchone()[0]
        component_progress = 0
        if component_ids:
            cursor.execute('select count(*) from "Learner".learner_free_course_progress where component_ref=any(%s::varchar[])', [component_ids])
            component_progress = cursor.fetchone()[0]
    return {"assignments": assignments, "progress": progress, "componentProgress": component_progress,
            "quizLinks": quiz_links, "quizzes": quizzes}


def _update_row(cursor, table, ident, existing, values):
    if not _changed(existing, values):
        return False
    columns = [*values.keys(), "updated_at"]
    assignments = ",".join(f'"{column}"=%s' for column in columns)
    params = [json.dumps(value) if column in {"settings_json", "learning_outcomes"} else value
              for column, value in values.items()]
    params.extend([timezone.now(), ident])
    casts = assignments.replace('"settings_json"=%s', '"settings_json"=%s::jsonb').replace(
        '"learning_outcomes"=%s', '"learning_outcomes"=%s::jsonb')
    cursor.execute(f'update curriculum."{table}" set {casts} where id=%s', params)
    return True


def _stored_cover(course_id, value):
    """A cover as a storage URL instead of an inline data: URI in the column.

    The picker sends an uploaded file as base64; kept in the column it rode in
    every catalogue and course response and could never be cached by the
    browser. Same helper, path shape and failure behaviour as module covers:
    URLs and '' pass through untouched.
    """
    from ..domain.authoring_errors import CoverImageError
    from .cover_image_storage import stored_module_cover_image

    try:
        return stored_module_cover_image(course_id, value)
    except CoverImageError as error:
        raise MutationError("invalid_cover", str(error)) from error


class FreeCourseWriteSession:
    """Concrete operations on one cursor; transaction ownership stays with the use case."""

    def __init__(self, cursor):
        self._cursor = cursor

    def update_row(self, table, ident, existing, values):
        return _update_row(self._cursor, table, ident, existing, values)

    def claim_create(self, staff_id, key, digest):
        self._cursor.execute(
            "insert into curriculum.free_course_authoring_idempotency "
            "(staff_subject_id,operation,idempotency_key,request_sha256) "
            "values (%s,%s,%s,%s) on conflict do nothing returning id",
            [staff_id, IDEMPOTENCY_OPERATION, key, digest],
        )
        return self._cursor.fetchone()

    def insert_course(self, course_id, course, courses, now):
        self._cursor.execute(
            "insert into curriculum.free_courses "
            "(id,course_name,description,cover_image_url,display_order,week_count,component_count,total_otjh,created_at,updated_at,course_type,is_for_sale,price,currency) "
            "values (%s,%s,%s,%s,%s,0,0,0,%s,%s,%s,%s,%s,%s)",
            [course_id, course["course_name"], course["description"], course["cover_image_url"],
             max((row.get("display_order") or 0 for row in courses), default=-1) + 1,
             now, now, course["course_type"], course["is_for_sale"], course["price"], course["currency"]],
        )

    def insert_week(self, week_id, course_id, week, components, week_total, now):
        self._cursor.execute(
            "insert into curriculum.free_course_weeks "
            "(id,course_id,display_order,component_count,total_otjh,created_at,updated_at,week_number,title,summary,learning_outcomes,status,holiday_note_enabled,holiday_note,legacy_copied_from_week_id) "
            "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)",
            [week_id, course_id, week["display_order"], len(components), week_total, now, now,
             week["week_number"], week["title"], week["summary"], json.dumps(week["learning_outcomes"]),
             week["status"], week["holiday_note_enabled"], week["holiday_note"], week["legacy_copied_from_week_id"]],
        )

    def insert_component(self, component_id, week_id, values, now):
        self._cursor.execute(
            "insert into curriculum.free_programme_components "
            "(id,free_module_id,programme_id,type,title,description,expected_otjh,points,reflection_required,workplace_evidence_required,tutor_validation_required,display_order,settings_json,created_at,updated_at) "
            "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)",
            [component_id, week_id, PROGRAMME_MARKER, values["type"], values["title"], values["description"],
             values["expected_otjh"], values["points"], values["reflection_required"],
             values["workplace_evidence_required"], values["tutor_validation_required"],
             values["display_order"], json.dumps(values["settings_json"]), now, now],
        )

    def set_course_totals(self, raw_weeks, component_count, total_otjh, now, course_id):
        self._cursor.execute(
            "update curriculum.free_courses set week_count=%s,component_count=%s,total_otjh=%s,updated_at=%s where id=%s",
            [len(raw_weeks), component_count, total_otjh, now, course_id],
        )

    def complete_create(self, course_id, document, etag, location, claimed):
        self._cursor.execute(
            "update curriculum.free_course_authoring_idempotency set "
            "state='completed',course_id=%s,response_status=201,response_body=%s::jsonb,"
            "response_etag=%s,response_location=%s,completed_at=transaction_timestamp() "
            "where id=%s",
            [course_id, json.dumps(document), etag, location, claimed[0]],
        )

    def set_course_order(self, order, now, ident):
        self._cursor.execute("update curriculum.free_courses set display_order=%s,updated_at=case when display_order<>%s then %s else updated_at end where id=%s", [order, order, now, ident])

    def insert_empty_week(self, week_id, course_id, week_values, now):
        self._cursor.execute(
            "insert into curriculum.free_course_weeks (id,course_id,display_order,component_count,total_otjh,created_at,updated_at,week_number,title,summary,learning_outcomes,status,holiday_note_enabled,holiday_note,legacy_copied_from_week_id) values (%s,%s,%s,0,0,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)",
            [week_id, course_id, week_values["display_order"], now, now, week_values["week_number"], week_values["title"],
             week_values["summary"], json.dumps(week_values["learning_outcomes"]), week_values["status"],
             week_values["holiday_note_enabled"], week_values["holiday_note"], week_values["legacy_copied_from_week_id"]],
        )

    def insert_added_component(self, component_id, week_id, values, now):
        self._cursor.execute(
            "insert into curriculum.free_programme_components (id,free_module_id,programme_id,type,title,description,expected_otjh,points,reflection_required,workplace_evidence_required,tutor_validation_required,display_order,settings_json,created_at,updated_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)",
            [component_id, week_id, PROGRAMME_MARKER, values["type"], values["title"], values["description"], values["expected_otjh"], values["points"], values["reflection_required"], values["workplace_evidence_required"], values["tutor_validation_required"], values["display_order"], json.dumps(values["settings_json"]), now, now],
        )

    def archive_components(self, now, deleted_components):
        self._cursor.execute("update curriculum.free_programme_components set deleted_at=%s,updated_at=%s where id=any(%s::varchar[])", [now, now, list(deleted_components)])

    def archive_weeks(self, now, deleted_weeks):
        self._cursor.execute("update curriculum.free_course_weeks set deleted_at=%s,updated_at=%s where id=any(%s::varchar[])", [now, now, list(deleted_weeks)])

    def refresh_week_totals(self, now, course_id):
        self._cursor.execute(
            "update curriculum.free_course_weeks w set component_count=s.c,total_otjh=s.h,updated_at=case when w.component_count<>s.c or w.total_otjh<>s.h then %s else w.updated_at end from (select w2.id,count(c.id)::int c,coalesce(sum(c.expected_otjh),0) h from curriculum.free_course_weeks w2 left join curriculum.free_programme_components c on c.free_module_id=w2.id and c.deleted_at is null where w2.course_id=%s and w2.deleted_at is null group by w2.id) s where w.id=s.id",
            [now, course_id],
        )

    def refresh_course_totals(self, now, course_id):
        self._cursor.execute(
            "update curriculum.free_courses c set week_count=s.w,component_count=s.n,total_otjh=s.h,updated_at=case when c.week_count<>s.w or c.component_count<>s.n or c.total_otjh<>s.h then %s else c.updated_at end from (select count(distinct w.id)::int w,count(p.id)::int n,coalesce(sum(p.expected_otjh),0) h from curriculum.free_course_weeks w left join curriculum.free_programme_components p on p.free_module_id=w.id and p.deleted_at is null where w.course_id=%s and w.deleted_at is null) s where c.id=%s",
            [now, course_id, course_id],
        )

    def structure_counts(self, course_id):
        self._cursor.execute(
            "select count(distinct w.id)::int, count(p.id)::int, "
            "count(*) filter (where w.status='active' and exists (select 1 from curriculum.free_programme_components p2 where p2.free_module_id=w.id and p2.deleted_at is null))::int, "
            "count(*) filter (where w.status='active' and not exists (select 1 from curriculum.free_programme_components p3 where p3.free_module_id=w.id and p3.deleted_at is null))::int "
            "from curriculum.free_course_weeks w left join curriculum.free_programme_components p on p.free_module_id=w.id and p.deleted_at is null where w.course_id=%s and w.deleted_at is null",
            [course_id],
        )
        return self._cursor.fetchone()

    def duplicate_order(self, course_id):
        self._cursor.execute(
            "select 1 from curriculum.free_course_weeks where course_id=%s and deleted_at is null group by display_order having count(*)>1 "
            "union all select 1 from curriculum.free_programme_components p join curriculum.free_course_weeks w on w.id=p.free_module_id "
            "where w.course_id=%s and w.deleted_at is null and p.deleted_at is null group by p.free_module_id,p.display_order having count(*)>1 limit 1",
            [course_id, course_id],
        )
        return self._cursor.fetchone()

    def delete_components(self, weeks):
        self._cursor.execute("delete from curriculum.free_programme_components where free_module_id=any(%s::varchar[])", [[row["id"] for row in weeks]])

    def delete_weeks(self, course_id):
        self._cursor.execute("delete from curriculum.free_course_weeks where course_id=%s", [course_id])

    def delete_course(self, course_id):
        self._cursor.execute("delete from curriculum.free_courses where id=%s", [course_id])


@contextmanager
def session():
    with connection.cursor() as cursor:
        yield FreeCourseWriteSession(cursor)
