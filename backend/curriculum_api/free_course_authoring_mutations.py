"""Atomic canonical Free Course create, diff/upsert and guarded deletion."""
from __future__ import annotations

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from django.db import connection, transaction
from django.utils import timezone
from django.utils.http import quote_etag

from . import free_course_authoring as documents
from . import free_course_catalogue
from .free_course_writer_mode import CANONICAL, FreeCourseWriterDisabled, _catalogue_lock, require_mode


MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_SETTINGS_BYTES = 256 * 1024
MAX_WEEKS = 100
MAX_COMPONENTS = 500
MAX_COMPONENTS_PER_WEEK = 100
PROGRAMME_MARKER = "FREE-COURSES"
IDEMPOTENCY_OPERATION = "free_course.create.v1"
IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$")


class MutationError(ValueError):
    def __init__(self, code, message, status=400, **details):
        self.code = code
        self.status = status
        self.details = details
        super().__init__(message)


def _clean(value, *, maximum=None, required=False, label="value"):
    text = str(value or "").strip()
    if required and not text:
        raise MutationError("validation_error", f"{label} is required.")
    if maximum is not None and len(text) > maximum:
        raise MutationError("validation_error", f"{label} is too long.")
    if any(ord(char) < 32 for char in text):
        raise MutationError("validation_error", f"{label} contains invalid characters.")
    return text


def _integer(value, *, minimum=0, maximum=None, label="value"):
    if isinstance(value, bool):
        raise MutationError("validation_error", f"{label} must be an integer.")
    try:
        result = int(value)
    except (TypeError, ValueError):
        raise MutationError("validation_error", f"{label} must be an integer.")
    if result < minimum or (maximum is not None and result > maximum):
        raise MutationError("validation_error", f"{label} is outside the allowed range.")
    return result


def _decimal(value, *, label="value"):
    try:
        result = Decimal(str(value if value not in (None, "") else 0))
    except (InvalidOperation, ValueError):
        raise MutationError("validation_error", f"{label} must be numeric.")
    if not result.is_finite() or result < 0:
        raise MutationError("validation_error", f"{label} must be zero or greater.")
    return result


def _json_object(value, *, label):
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise MutationError("validation_error", f"{label} must be a JSON object.")
    encoded = documents.canonical_json_bytes(value)
    if len(encoded) > MAX_SETTINGS_BYTES:
        raise MutationError("settings_too_large", f"{label} exceeds 256 KiB.", status=413)
    return value


def _new_id(prefix):
    return f"{prefix}-{uuid4().hex.upper()}"


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


def _tree(course_id, *, lock=False):
    suffix = " for update" if lock else ""
    with connection.cursor() as cursor:
        cursor.execute(
            "select * from curriculum.free_courses where id=%s" + suffix,
            [course_id],
        )
        course = next(iter(_rows(cursor)), None)
        if not course:
            raise MutationError("free_course_not_found", "Free Course not found.", status=404)
        cursor.execute(
            "select * from curriculum.free_course_weeks where course_id=%s order by id" + suffix,
            [course_id],
        )
        weeks = _rows(cursor)
        week_ids = [row["id"] for row in weeks]
        components = []
        if week_ids:
            cursor.execute(
                "select * from curriculum.free_programme_components "
                "where free_module_id = any(%s::varchar[]) order by id" + suffix,
                [week_ids],
            )
            components = _rows(cursor)
    return course, weeks, components


def _catalogue_revision(rows=None):
    return documents.catalogue_revision(rows if rows is not None else free_course_catalogue.courses())


def _expected(payload, key="expectedRevision"):
    value = _clean(payload.get(key)) if isinstance(payload, dict) else ""
    if not value:
        raise MutationError(
            "precondition_required",
            f"{key} is required. Reload the Free Course and try again.",
            status=428,
        )
    return value


def _check_revision(expected, current, *, scope):
    if expected != current:
        raise MutationError(
            "stale_revision",
            "The Free Course changed after it was opened. Reload before saving.",
            status=409,
            scope=scope,
            expectedRevision=expected,
            currentRevision=current,
        )


def _client_id(value, seen, label):
    result = _clean(value, maximum=128, required=True, label=label)
    if result in seen:
        raise MutationError("duplicate_client_id", f"Duplicate {label}: {result}.")
    seen.add(result)
    return result


def _normalise_component(raw, *, index, existing=None):
    if not isinstance(raw, dict):
        raise MutationError("validation_error", "Each component must be an object.")
    component_type = _clean(raw.get("type"), maximum=64, required=True, label="component type")
    if existing is not None and component_type != str(existing.get("type") or ""):
        raise MutationError("component_type_change_forbidden", "Existing component types cannot be changed.", status=409)
    settings = _json_object(raw.get("settings"), label="component settings")
    if existing is not None:
        previous_settings = existing.get("settings_json") or {}
        if isinstance(previous_settings, str):
            try:
                previous_settings = json.loads(previous_settings)
            except ValueError:
                previous_settings = {}
        previous_quiz = str((previous_settings or {}).get("linkedQuizId") or "").strip()
        requested_quiz = str(settings.get("linkedQuizId") or "").strip()
        if previous_quiz != requested_quiz:
            raise MutationError(
                "linked_quiz_change_forbidden",
                "Use the canonical Free Course quiz controls to link or unlink quizzes.",
                status=409,
            )
    return {
        "type": component_type,
        "title": _clean(raw.get("title"), maximum=255, required=True, label="component title"),
        "description": str(raw.get("description") or ""),
        "expected_otjh": _decimal(raw.get("expectedOtjh"), label="expectedOtjh"),
        "points": _integer(raw.get("points", 0), minimum=0, maximum=1000000, label="points"),
        "reflection_required": bool(raw.get("reflectionRequired")),
        "workplace_evidence_required": bool(raw.get("workplaceEvidenceRequired")),
        "tutor_validation_required": bool(raw.get("tutorValidationRequired")),
        "display_order": _integer(raw.get("displayOrder", index), minimum=0, label="component displayOrder"),
        "settings_json": settings,
    }


def _normalise_week(raw, *, index, existing=None):
    if not isinstance(raw, dict):
        raise MutationError("validation_error", "Each week must be an object.")
    status = _clean(raw.get("status") or (existing or {}).get("status") or "active").lower()
    if status not in {"active", "inactive"}:
        raise MutationError("validation_error", "Week status must be active or inactive.")
    outcomes = raw.get("learningOutcomes", (existing or {}).get("learning_outcomes") or [])
    if not isinstance(outcomes, (list, dict, str)):
        raise MutationError("validation_error", "learningOutcomes has an invalid shape.")
    return {
        "week_number": _integer(raw.get("weekNumber", index + 1), minimum=1, label="weekNumber"),
        "title": _clean(raw.get("title") or raw.get("weekTitle"), maximum=255, required=True, label="week title"),
        "summary": str(raw.get("summary") or raw.get("weekSummary") or ""),
        "learning_outcomes": outcomes,
        "status": status,
        "holiday_note_enabled": bool(raw.get("holidayNoteEnabled")),
        "holiday_note": str(raw.get("holidayNote") or ""),
        "legacy_copied_from_week_id": _clean(raw.get("legacyCopiedFromWeekId"), maximum=128) or None,
        "display_order": _integer(raw.get("displayOrder", index), minimum=0, label="week displayOrder"),
    }


def _course_values(raw):
    if not isinstance(raw, dict):
        raise MutationError("validation_error", "course must be an object.")
    course_type = _clean(raw.get("courseType") or "free").lower()
    if course_type not in {"free", "apprentices"}:
        raise MutationError("validation_error", "Unsupported courseType.")
    is_for_sale = bool(raw.get("isForSale"))
    price = None if not is_for_sale else _decimal(raw.get("price"), label="price")
    if is_for_sale and (price is None or price <= 0 or price > Decimal("99999999.99")):
        raise MutationError("validation_error", "A valid positive price is required.")
    return {
        "course_name": _clean(raw.get("courseName") or raw.get("title"), maximum=255, required=True, label="courseName"),
        "description": str(raw.get("description") or ""),
        "cover_image_url": str(raw.get("coverImageUrl") or ""),
        "course_type": course_type,
        "is_for_sale": is_for_sale,
        "price": price,
        "currency": "GBP",
    }


def _validate_shape(weeks):
    if not isinstance(weeks, list):
        raise MutationError("validation_error", "weeks must be a list.")
    if not weeks:
        raise MutationError("validation_error", "A Free Course needs at least one week.")
    if len(weeks) > MAX_WEEKS:
        raise MutationError("limit_exceeded", "A course can contain at most 100 weeks.")
    total = 0
    active_nonempty = False
    week_orders = set()
    for week_index, week in enumerate(weeks):
        if not isinstance(week, dict):
            raise MutationError("validation_error", "Each week must be an object.")
        components = week.get("components", []) if isinstance(week, dict) else []
        if not isinstance(components, list):
            raise MutationError("validation_error", "components must be a list.")
        if len(components) > MAX_COMPONENTS_PER_WEEK:
            raise MutationError("limit_exceeded", "A week can contain at most 100 components.")
        week_order = _integer(week.get("displayOrder", week_index), minimum=0, label="week displayOrder")
        if week_order in week_orders:
            raise MutationError("duplicate_display_order", "Week displayOrder values must be unique.")
        week_orders.add(week_order)
        component_orders = set()
        for component_index, component in enumerate(components):
            if not isinstance(component, dict):
                raise MutationError("validation_error", "Each component must be an object.")
            component_order = _integer(component.get("displayOrder", component_index), minimum=0, label="component displayOrder")
            if component_order in component_orders:
                raise MutationError("duplicate_display_order", "Component displayOrder values must be unique within a week.")
            component_orders.add(component_order)
        total += len(components)
        status = _clean(week.get("status") or "active").lower()
        if status == "active" and not components:
            raise MutationError("active_week_empty", "Active weeks must contain at least one component.")
        active_nonempty = active_nonempty or (status == "active" and bool(components))
    if total > MAX_COMPONENTS:
        raise MutationError("limit_exceeded", "A course can contain at most 500 components.")
    if not active_nonempty:
        raise MutationError("validation_error", "A course needs at least one active, non-empty week.")


def request_digest(payload):
    return hashlib.sha256(documents.canonical_json_bytes({
        "operation": IDEMPOTENCY_OPERATION,
        "payload": payload,
    })).hexdigest()


def validate_idempotency_key(value):
    value = str(value or "").strip()
    if not IDEMPOTENCY_KEY_RE.fullmatch(value):
        raise MutationError(
            "invalid_idempotency_key",
            "Idempotency-Key must be 8-255 characters using letters, numbers, . _ : or -.",
        )
    return value


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


def _replay(row, digest):
    if row["request_sha256"] != digest:
        raise MutationError("idempotency_key_reused", "This Idempotency-Key was used for a different request.", status=409)
    if row["state"] != "completed":
        raise MutationError("idempotency_in_progress", "The create request is still in progress.", status=409)
    return {
        "replayed": True,
        "status": row["response_status"],
        "body": row["response_body"],
        "etag": row["response_etag"],
        "location": row["response_location"],
    }


def create_course(payload, *, staff_id, idempotency_key):
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    expected = _expected(payload)
    key = validate_idempotency_key(idempotency_key)
    digest = request_digest(payload)
    raw_weeks = payload.get("weeks")
    _validate_shape(raw_weeks)

    require_mode(CANONICAL)
    with transaction.atomic():
        _purge_expired_idempotency()
        existing_ledger = _ledger_row(staff_id, key, lock=True)
        if existing_ledger:
            return _replay(existing_ledger, digest)
        require_mode(CANONICAL)
        with connection.cursor() as cursor:
            cursor.execute(
                "insert into curriculum.free_course_authoring_idempotency "
                "(staff_subject_id,operation,idempotency_key,request_sha256) "
                "values (%s,%s,%s,%s) on conflict do nothing returning id",
                [staff_id, IDEMPOTENCY_OPERATION, key, digest],
            )
            claimed = cursor.fetchone()
        if not claimed:
            return _replay(_ledger_row(staff_id, key, lock=True), digest)

        _catalogue_lock()
        require_mode(CANONICAL)
        courses = _course_rows(lock=True)
        _check_revision(expected, _catalogue_revision(courses), scope="catalogue")

        course_id = _new_id("FREECOURSE")
        course = _course_values(payload.get("course"))
        client_map = {"courses": {}, "weeks": {}, "components": {}}
        seen_clients = set()
        course_client = _client_id(payload.get("clientId"), seen_clients, "course clientId")
        client_map["courses"][course_client] = course_id
        now = timezone.now()
        with connection.cursor() as cursor:
            cursor.execute(
                "insert into curriculum.free_courses "
                "(id,course_name,description,cover_image_url,display_order,week_count,component_count,total_otjh,created_at,updated_at,course_type,is_for_sale,price,currency) "
                "values (%s,%s,%s,%s,%s,0,0,0,%s,%s,%s,%s,%s,%s)",
                [course_id, course["course_name"], course["description"], course["cover_image_url"],
                 max((row.get("display_order") or 0 for row in courses), default=-1) + 1,
                 now, now, course["course_type"], course["is_for_sale"], course["price"], course["currency"]],
            )
            component_count = 0
            total_otjh = Decimal("0")
            for week_index, raw_week in enumerate(raw_weeks):
                week = _normalise_week(raw_week, index=week_index)
                week_client = _client_id(raw_week.get("clientId"), seen_clients, "week clientId")
                week_id = _new_id("FREEWEEK")
                client_map["weeks"][week_client] = week_id
                components = raw_week.get("components", [])
                week_total = sum((_decimal(item.get("expectedOtjh"), label="expectedOtjh") for item in components), Decimal("0"))
                cursor.execute(
                    "insert into curriculum.free_course_weeks "
                    "(id,course_id,display_order,component_count,total_otjh,created_at,updated_at,week_number,title,summary,learning_outcomes,status,holiday_note_enabled,holiday_note,legacy_copied_from_week_id) "
                    "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)",
                    [week_id, course_id, week["display_order"], len(components), week_total, now, now,
                     week["week_number"], week["title"], week["summary"], json.dumps(week["learning_outcomes"]),
                     week["status"], week["holiday_note_enabled"], week["holiday_note"], week["legacy_copied_from_week_id"]],
                )
                for component_index, raw_component in enumerate(components):
                    values = _normalise_component(raw_component, index=component_index)
                    component_client = _client_id(raw_component.get("clientId"), seen_clients, "component clientId")
                    component_id = _new_id("FREECOMP")
                    client_map["components"][component_client] = component_id
                    cursor.execute(
                        "insert into curriculum.free_programme_components "
                        "(id,free_module_id,programme_id,type,title,description,expected_otjh,points,reflection_required,workplace_evidence_required,tutor_validation_required,display_order,settings_json,created_at,updated_at) "
                        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)",
                        [component_id, week_id, PROGRAMME_MARKER, values["type"], values["title"], values["description"],
                         values["expected_otjh"], values["points"], values["reflection_required"],
                         values["workplace_evidence_required"], values["tutor_validation_required"],
                         values["display_order"], json.dumps(values["settings_json"]), now, now],
                    )
                component_count += len(components)
                total_otjh += week_total
            cursor.execute(
                "update curriculum.free_courses set week_count=%s,component_count=%s,total_otjh=%s,updated_at=%s where id=%s",
                [len(raw_weeks), component_count, total_otjh, now, course_id],
            )

        document = documents.course_document(course_id, read_snapshot=False)
        document["clientIdMap"] = client_map
        etag = quote_etag(document["revision"])
        location = f"/curriculum_api/curriculum/free-courses/{course_id}/authoring/"
        with connection.cursor() as cursor:
            cursor.execute(
                "update curriculum.free_course_authoring_idempotency set "
                "state='completed',course_id=%s,response_status=201,response_body=%s::jsonb,"
                "response_etag=%s,response_location=%s,completed_at=transaction_timestamp() "
                "where id=%s",
                [course_id, json.dumps(document), etag, location, claimed[0]],
            )
        return {"replayed": False, "status": 201, "body": document, "etag": etag, "location": location}


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


def _changed(existing, values):
    for key, value in values.items():
        current = existing.get(key)
        if key in {"settings_json", "learning_outcomes"}:
            if documents.canonical_value(current) != documents.canonical_value(value):
                return True
        elif current != value:
            return True
    return False


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


def update_course(course_id, payload):
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    expected = _expected(payload)
    require_mode(CANONICAL)
    with transaction.atomic():
        _catalogue_lock()
        require_mode(CANONICAL)
        course, weeks, components = _tree(course_id, lock=True)
        current_document = documents.course_document(course_id, read_snapshot=False)
        _check_revision(expected, current_document["revision"], scope="course")
        if current_document["integrity"]["status"] == "blocked":
            raise MutationError("free_course_integrity_blocked", "Resolve blocking Free Course integrity issues before saving.", status=409,
                                issues=current_document["integrity"]["issues"])

        week_by_id = {row["id"]: row for row in weeks}
        component_by_id = {row["id"]: row for row in components}
        deleted_weeks = {_clean(value, maximum=128) for value in payload.get("deletedWeekIds", [])}
        deleted_components = {_clean(value, maximum=128) for value in payload.get("deletedComponentIds", [])}
        if not deleted_weeks.issubset(week_by_id):
            raise MutationError("cross_course_id", "A deleted week does not belong to this course.", status=409)
        if not deleted_components.issubset(component_by_id):
            raise MutationError("cross_course_id", "A deleted component does not belong to this course.", status=409)

        if deleted_weeks or deleted_components:
            counts = _dependency_counts(course_id, list(deleted_weeks), list(deleted_components))
            if any(counts.values()):
                raise MutationError("dependent_records", "Assigned, progressed or quiz-linked content cannot be deleted.", status=409, dependencies=counts)
            for component in components:
                if component["id"] in deleted_components:
                    settings = component.get("settings_json") or {}
                    if isinstance(settings, dict) and str(settings.get("linkedQuizId") or "").strip():
                        raise MutationError("dependent_quiz", "A component linked to a quiz cannot be deleted.", status=409,
                                            componentId=component["id"])
            for week_id in deleted_weeks:
                remaining = [row["id"] for row in components if row["free_module_id"] == week_id and row["id"] not in deleted_components]
                if remaining:
                    raise MutationError("week_not_empty", "Delete or move no components before deleting a week.", status=409,
                                        freeCourseWeekId=week_id)

        raw_weeks = payload.get("weeks", [])
        if not isinstance(raw_weeks, list):
            raise MutationError("validation_error", "weeks must be a list.")
        if len(weeks) - len(deleted_weeks) + sum(1 for row in raw_weeks if not row.get("freeCourseWeekId")) > MAX_WEEKS:
            raise MutationError("limit_exceeded", "A course can contain at most 100 weeks.")
        seen_ids, seen_clients = set(), set()
        client_id_map = {"course": {}, "weeks": {}, "components": {}}
        now = timezone.now()
        with connection.cursor() as cursor:
            course_patch = payload.get("course") or {}
            if course_patch:
                merged = {
                    "courseName": course_patch.get("courseName", course["course_name"]),
                    "description": course_patch.get("description", course.get("description")),
                    "coverImageUrl": course_patch.get("coverImageUrl", course.get("cover_image_url")),
                    "courseType": course_patch.get("courseType", course.get("course_type")),
                    "isForSale": course_patch.get("isForSale", course.get("is_for_sale")),
                    "price": course_patch.get("price", course.get("price")),
                }
                values = _course_values(merged)
                _update_row(cursor, "free_courses", course_id, course, values)
                if "displayOrder" in course_patch:
                    catalogue_expected = _expected(payload, "expectedCatalogueRevision")
                    all_courses = _course_rows(lock=True)
                    _check_revision(catalogue_expected, _catalogue_revision(all_courses), scope="catalogue")
                    ordered = [row["id"] for row in all_courses if row["id"] != course_id]
                    target = min(_integer(course_patch["displayOrder"], minimum=0, label="displayOrder"), len(ordered))
                    ordered.insert(target, course_id)
                    for order, ident in enumerate(ordered):
                        cursor.execute("update curriculum.free_courses set display_order=%s,updated_at=case when display_order<>%s then %s else updated_at end where id=%s", [order, order, now, ident])

            for index, raw_week in enumerate(raw_weeks):
                week_id = _clean(raw_week.get("freeCourseWeekId"), maximum=128)
                if week_id:
                    if week_id in seen_ids:
                        raise MutationError("duplicate_id", "A week id appears more than once.")
                    seen_ids.add(week_id)
                    existing_week = week_by_id.get(week_id)
                    if not existing_week or week_id in deleted_weeks:
                        raise MutationError("cross_course_id", "A week does not belong to this course.", status=409)
                    week_values = _normalise_week(raw_week, index=index, existing=existing_week)
                    _update_row(cursor, "free_course_weeks", week_id, existing_week, week_values)
                else:
                    client_id = _client_id(raw_week.get("clientId"), seen_clients, "week clientId")
                    week_id = _new_id("FREEWEEK")
                    client_id_map["weeks"][client_id] = week_id
                    week_values = _normalise_week(raw_week, index=index)
                    cursor.execute(
                        "insert into curriculum.free_course_weeks (id,course_id,display_order,component_count,total_otjh,created_at,updated_at,week_number,title,summary,learning_outcomes,status,holiday_note_enabled,holiday_note,legacy_copied_from_week_id) values (%s,%s,%s,0,0,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)",
                        [week_id, course_id, week_values["display_order"], now, now, week_values["week_number"], week_values["title"],
                         week_values["summary"], json.dumps(week_values["learning_outcomes"]), week_values["status"],
                         week_values["holiday_note_enabled"], week_values["holiday_note"], week_values["legacy_copied_from_week_id"]],
                    )

                raw_components = raw_week.get("components", [])
                if not isinstance(raw_components, list) or len(raw_components) > MAX_COMPONENTS_PER_WEEK:
                    raise MutationError("limit_exceeded", "A week can contain at most 100 components.")
                if week_values["status"] == "active" and not raw_components and not any(
                    row["free_module_id"] == week_id and row["id"] not in deleted_components for row in components
                ):
                    raise MutationError("active_week_empty", "Active weeks must contain at least one component.")
                for component_index, raw_component in enumerate(raw_components):
                    component_id = _clean(raw_component.get("id"), maximum=128)
                    if component_id:
                        if component_id in seen_ids:
                            raise MutationError("duplicate_id", "An id appears more than once.")
                        seen_ids.add(component_id)
                        existing_component = component_by_id.get(component_id)
                        if not existing_component or component_id in deleted_components:
                            raise MutationError("cross_course_id", "A component does not belong to this course.", status=409)
                        if existing_component["free_module_id"] != week_id:
                            raise MutationError("component_move_forbidden", "Existing components cannot move between Free Weeks.", status=409)
                        values = _normalise_component(raw_component, index=component_index, existing=existing_component)
                        _update_row(cursor, "free_programme_components", component_id, existing_component, values)
                    else:
                        client_id = _client_id(raw_component.get("clientId"), seen_clients, "component clientId")
                        component_id = _new_id("FREECOMP")
                        values = _normalise_component(raw_component, index=component_index)
                        cursor.execute(
                            "insert into curriculum.free_programme_components (id,free_module_id,programme_id,type,title,description,expected_otjh,points,reflection_required,workplace_evidence_required,tutor_validation_required,display_order,settings_json,created_at,updated_at) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s)",
                            [component_id, week_id, PROGRAMME_MARKER, values["type"], values["title"], values["description"], values["expected_otjh"], values["points"], values["reflection_required"], values["workplace_evidence_required"], values["tutor_validation_required"], values["display_order"], json.dumps(values["settings_json"]), now, now],
                        )
                        client_id_map["components"][client_id] = component_id

            if deleted_components:
                cursor.execute("delete from curriculum.free_programme_components where id=any(%s::varchar[])", [list(deleted_components)])
            if deleted_weeks:
                cursor.execute("delete from curriculum.free_course_weeks where id=any(%s::varchar[])", [list(deleted_weeks)])

            cursor.execute(
                "update curriculum.free_course_weeks w set component_count=s.c,total_otjh=s.h,updated_at=case when w.component_count<>s.c or w.total_otjh<>s.h then %s else w.updated_at end from (select w2.id,count(c.id)::int c,coalesce(sum(c.expected_otjh),0) h from curriculum.free_course_weeks w2 left join curriculum.free_programme_components c on c.free_module_id=w2.id where w2.course_id=%s group by w2.id) s where w.id=s.id",
                [now, course_id],
            )
            cursor.execute(
                "update curriculum.free_courses c set week_count=s.w,component_count=s.n,total_otjh=s.h,updated_at=case when c.week_count<>s.w or c.component_count<>s.n or c.total_otjh<>s.h then %s else c.updated_at end from (select count(distinct w.id)::int w,count(p.id)::int n,coalesce(sum(p.expected_otjh),0) h from curriculum.free_course_weeks w left join curriculum.free_programme_components p on p.free_module_id=w.id where w.course_id=%s) s where c.id=%s",
                [now, course_id, course_id],
            )
            cursor.execute(
                "select count(distinct w.id)::int, count(p.id)::int, "
                "count(*) filter (where w.status='active' and exists (select 1 from curriculum.free_programme_components p2 where p2.free_module_id=w.id))::int, "
                "count(*) filter (where w.status='active' and not exists (select 1 from curriculum.free_programme_components p3 where p3.free_module_id=w.id))::int "
                "from curriculum.free_course_weeks w left join curriculum.free_programme_components p on p.free_module_id=w.id where w.course_id=%s",
                [course_id],
            )
            week_count, component_count, active_nonempty, active_empty = cursor.fetchone()
            if not week_count or not active_nonempty:
                raise MutationError("validation_error", "A course needs at least one active, non-empty week.")
            if active_empty:
                raise MutationError("active_week_empty", "Active weeks must contain at least one component.")
            if component_count > MAX_COMPONENTS:
                raise MutationError("limit_exceeded", "A course can contain at most 500 components.")
            cursor.execute(
                "select 1 from curriculum.free_course_weeks where course_id=%s group by display_order having count(*)>1 "
                "union all select 1 from curriculum.free_programme_components p join curriculum.free_course_weeks w on w.id=p.free_module_id "
                "where w.course_id=%s group by p.free_module_id,p.display_order having count(*)>1 limit 1",
                [course_id, course_id],
            )
            if cursor.fetchone():
                raise MutationError("duplicate_display_order", "Week and component displayOrder values must be unique.")

        result = documents.course_document(course_id, read_snapshot=False)
        result["clientIdMap"] = client_id_map
        return result


def delete_course(course_id, payload):
    expected = _expected(payload if isinstance(payload, dict) else {})
    require_mode(CANONICAL)
    with transaction.atomic():
        _catalogue_lock()
        require_mode(CANONICAL)
        _course, weeks, components = _tree(course_id, lock=True)
        current = documents.course_document(course_id, read_snapshot=False)
        _check_revision(expected, current["revision"], scope="course")
        counts = _dependency_counts(course_id, [row["id"] for row in weeks], [row["id"] for row in components])
        linked = []
        for row in components:
            settings = row.get("settings_json") or {}
            if isinstance(settings, dict) and str(settings.get("linkedQuizId") or "").strip():
                linked.append(row["id"])
        if any(counts.values()) or linked:
            raise MutationError("dependent_records", "This Free Course has assignments, progress or quiz history and cannot be deleted.", status=409,
                                dependencies={**counts, "linkedComponents": linked})
        with connection.cursor() as cursor:
            cursor.execute("delete from curriculum.free_programme_components where free_module_id=any(%s::varchar[])", [[row["id"] for row in weeks]])
            cursor.execute("delete from curriculum.free_course_weeks where course_id=%s", [course_id])
            cursor.execute("delete from curriculum.free_courses where id=%s", [course_id])
        return {"deleted": True, "courseId": course_id, "catalogueRevision": _catalogue_revision()}


def clone_normal_module(payload, *, staff_id, idempotency_key):
    """Clone a normal Module into new canonical rows; never move its source."""
    if not isinstance(payload, dict):
        raise MutationError("validation_error", "Request body must be an object.")
    if str(payload.get("mode") or "clone").strip().lower() != "clone":
        raise MutationError("clone_only", "Normal Curriculum content can only be cloned into Free Courses.", status=409)
    module_id = _clean(payload.get("moduleCatalogueId"), maximum=128, required=True, label="moduleCatalogueId")
    from . import views as legacy_views

    structure = legacy_views.get_authoring_structure_payload(module_id)
    if not structure:
        raise MutationError("module_not_found", "Module not found.", status=404)
    weeks = []
    for week_index, week in enumerate(structure.get("weekStructure") or []):
        week_client = f"week:{week_index}:{week.get('id') or week_index}"
        components = []
        for component_index, component in enumerate(week.get("components") or []):
            settings = dict(component.get("settings") or {}) if isinstance(component.get("settings"), dict) else {}
            components.append({
                "clientId": f"component:{week_index}:{component_index}:{component.get('id') or component_index}",
                "type": component.get("type"),
                "title": component.get("title") or "Untitled activity",
                "description": component.get("description") or "",
                "expectedOtjh": component.get("expectedOtjh") or 0,
                "points": component.get("points") or 0,
                "reflectionRequired": bool(component.get("reflectionRequired")),
                "workplaceEvidenceRequired": bool(component.get("workplaceEvidenceRequired")),
                "tutorValidationRequired": bool(component.get("tutorValidationRequired")),
                "displayOrder": component_index,
                "settings": settings,
            })
        weeks.append({
            "clientId": week_client,
            "legacyCopiedFromWeekId": week.get("id") or None,
            "weekNumber": week.get("weekNumber") or week_index + 1,
            "title": week.get("title") or f"Week {week_index + 1}",
            "summary": week.get("summary") or "",
            "learningOutcomes": week.get("learningOutcomes") or [],
            "status": "active",
            "displayOrder": week_index,
            "components": components,
        })
    if not weeks:
        raise MutationError("module_empty", "The selected Module has no weeks to clone.", status=409)
    create_payload = {
        "expectedRevision": payload.get("expectedRevision"),
        "clientId": payload.get("clientId") or f"module:{module_id}",
        "course": {
            "courseName": structure.get("title") or "Untitled course",
            "description": structure.get("description") or "",
            "coverImageUrl": structure.get("coverImage") or "",
            "courseType": "free",
        },
        "weeks": weeks,
    }
    return create_course(
        create_payload,
        staff_id=staff_id,
        idempotency_key=idempotency_key,
    )
