"""Free Course authoring — read-only document builders and CRUD HTTP views.

The read-only section builds canonical catalogue/course documents with revision
fingerprinting and quiz-reference validation. It reads only the separated Free
Course catalogue tables and never mutates data.

The CRUD section provides HTTP views for catalogue listing and course-structure
editing through the shared Module Builder writer.
"""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import math
from contextlib import contextmanager, nullcontext
from datetime import date, datetime, time
from decimal import Decimal
from urllib.parse import quote
from uuid import UUID, uuid4

from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET

from login.permissions import require_role
from . import free_course_catalogue, schema_gate
from . import views as v
from .module_collaboration import collaboration_configuration
from .video_imports import tracked_save


CATALOGUE_SCHEMA_VERSION = "free-course-authoring.v1"
CATALOGUE_REVISION_PREFIX = "fccv1:"
COURSE_REVISION_PREFIX = "fcv1:"

QUIZZES_TABLE = "quizzes"
QUIZ_LINKS_TABLE = "quiz_course_links"
FREE_COURSE_PROGRAMME_MARKER = "FREE-COURSES"

COURSE_REVISION_COLUMNS = (
    "id", "course_name", "description", "cover_image_url", "display_order",
    "course_type", "is_for_sale", "price", "currency",
)
WEEK_REVISION_COLUMNS = (
    "id", "course_id", "display_order", "week_number", "title", "summary",
    "learning_outcomes", "status", "holiday_note_enabled", "holiday_note",
    "legacy_copied_from_week_id",
)
COMPONENT_REVISION_COLUMNS = (
    "id", "free_module_id", "programme_id", "type", "title", "description",
    "expected_otjh", "points", "reflection_required",
    "workplace_evidence_required", "tutor_validation_required", "display_order",
    "settings_json",
)
QUIZ_REVISION_COLUMNS = ("id", "free_course_week_id", "status", "week_id")
QUIZ_LINK_REVISION_COLUMNS = (
    "id", "quiz_id", "free_course_week_id", "free_course_id",
    "module_catalogue_id", "week_id",
)


class FreeCourseNotFound(LookupError):
    pass


class InvalidFreeCourseId(ValueError):
    pass


def normalize_course_id(value):
    course_id = str(value or "").strip()
    if not course_id or len(course_id) > 128 or any(ord(char) < 32 for char in course_id):
        raise InvalidFreeCourseId("A valid Free Course id is required.")
    return course_id


def _plain_decimal(value):
    if not value.is_finite():
        raise ValueError("Non-finite numbers cannot be revision inputs.")
    rendered = format(value, "f")
    if "." in rendered:
        rendered = rendered.rstrip("0").rstrip(".")
    return "0" if rendered in {"", "-0"} else rendered


def canonical_value(value):
    """Return a JSON-safe, recursively deterministic revision value."""
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, Decimal):
        return _plain_decimal(value)
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("Non-finite numbers cannot be revision inputs.")
        return _plain_decimal(Decimal(str(value)))
    if isinstance(value, dict):
        return {
            str(key): canonical_value(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [canonical_value(item) for item in value]
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    return str(value)


def canonical_json_bytes(value):
    return json.dumps(
        canonical_value(value),
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def _revision(prefix, value):
    return prefix + hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def catalogue_revision(course_rows):
    rows = sorted(
        ([str(row.get("id") or ""), row.get("display_order")] for row in course_rows),
        key=lambda row: row[0],
    )
    return _revision(CATALOGUE_REVISION_PREFIX, {"version": 1, "courses": rows})


def _row_values(row, columns):
    return {column: row.get(column) for column in columns}


def course_revision(course, weeks, components, quizzes, quiz_links):
    payload = {
        "version": 1,
        "course": _row_values(course, COURSE_REVISION_COLUMNS),
        "weeks": [
            _row_values(row, WEEK_REVISION_COLUMNS)
            for row in sorted(weeks, key=lambda item: str(item.get("id") or ""))
        ],
        "components": [
            _row_values(row, COMPONENT_REVISION_COLUMNS)
            for row in sorted(components, key=lambda item: str(item.get("id") or ""))
        ],
        "quizzes": [
            _row_values(row, QUIZ_REVISION_COLUMNS)
            for row in sorted(quizzes, key=lambda item: str(item.get("id") or ""))
        ],
        "quizLinks": [
            _row_values(row, QUIZ_LINK_REVISION_COLUMNS)
            for row in sorted(quiz_links, key=lambda item: str(item.get("id") or ""))
        ],
    }
    return _revision(COURSE_REVISION_PREFIX, payload)


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
    sql = f"select {columns} from {_table_name(QUIZ_LINKS_TABLE)} where \"free_course_id\" = %s"
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


@contextmanager
def _read_snapshot():
    """Use one repeatable, read-only PostgreSQL snapshot for a document."""
    with transaction.atomic():
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        yield


def _public_course(row, *, include_counts=False):
    value = {
        "courseId": str(row.get("id") or ""),
        "courseName": row.get("course_name") or "",
        "description": row.get("description") or "",
        "coverImageUrl": row.get("cover_image_url") or "",
        "displayOrder": row.get("display_order"),
        "courseType": row.get("course_type") or "",
        "isForSale": bool(row.get("is_for_sale")),
        "price": canonical_value(row.get("price")),
        "currency": row.get("currency") or "",
    }
    if include_counts:
        value.update({
            "weekCount": row.get("week_count") or 0,
            "componentCount": row.get("component_count") or 0,
            "totalOtjh": canonical_value(row.get("total_otjh") or 0),
            "authoringHref": (
                "/curriculum_api/curriculum/free-courses/"
                f"{row.get('id')}/authoring/"
            ),
        })
    return value


def catalogue_document(*, read_snapshot=True):
    schema_gate.require_tables(free_course_catalogue.FREE_COURSES_TABLE)
    with (_read_snapshot() if read_snapshot else nullcontext()):
        return _catalogue_from_rows(free_course_catalogue.courses())


def _catalogue_from_rows(rows):
    return {
        "schemaVersion": CATALOGUE_SCHEMA_VERSION,
        "scope": "catalogue",
        "revision": catalogue_revision(rows),
        "courses": [_public_course(row, include_counts=True) for row in rows],
    }


def catalogue_with_documents():
    """The catalogue plus every course's document, read in one snapshot.

    ``revision`` stays the catalogue revision (writers send it back as
    expectedRevision). ``documentsRevision`` also covers every course revision,
    so it is the one to use as the ETag: a 304 must not hide a course edit.
    """
    _require_course_tables()
    with _read_snapshot():
        rows = free_course_catalogue.courses()
        document = _catalogue_from_rows(rows)
        documents = course_documents(rows)
    document["documents"] = documents
    document["documentsRevision"] = _revision(CATALOGUE_REVISION_PREFIX, {
        "version": 1,
        "catalogue": document["revision"],
        "courses": [item["revision"] for item in documents],
    })
    return document


def _decode_settings(value):
    if value is None:
        return {}, None
    if isinstance(value, dict):
        return value, None
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return value, "invalid_component_settings"
        if isinstance(decoded, dict):
            return decoded, None
        return decoded, "invalid_component_settings"
    return value, "invalid_component_settings"


def _linked_quiz_id(settings):
    if not isinstance(settings, dict) or "linkedQuizId" not in settings:
        return None, None
    value = settings.get("linkedQuizId")
    if value is None or value == "":
        return None, None
    if isinstance(value, bool):
        return None, "malformed"
    value = str(value).strip()
    if not value or len(value) > 128:
        return None, "malformed"
    return value, None


def _issue(code, severity, **context):
    return {"code": code, "severity": severity, **context}


def _quiz_reference(component, course_id, quiz_id, malformed, quiz_by_id, links_by_quiz):
    component_id = str(component.get("id") or "")
    week_id = str(component.get("free_module_id") or "")
    context = {"componentId": component_id, "freeCourseWeekId": week_id}
    if malformed:
        return ({
            "quizId": None,
            "classification": "malformed",
            "ownerClassification": None,
            "quizStatus": None,
            "readOnly": True,
        }, [_issue("malformed_quiz_reference", "blocked", **context)], False)
    if quiz_id is None:
        return None, [], False

    context["quizId"] = quiz_id
    quiz = quiz_by_id.get(quiz_id)
    links = links_by_quiz.get(quiz_id, [])
    if quiz is None:
        return ({
            "quizId": quiz_id,
            "classification": "missing",
            "ownerClassification": None,
            "quizStatus": None,
            "readOnly": True,
        }, [_issue("missing_quiz_reference", "warning", **context)], False)

    quiz_week = str(quiz.get("free_course_week_id") or "")
    quiz_status = str(quiz.get("status") or "")
    exact_links = [
        link for link in links
        if str(link.get("free_course_week_id") or "") == week_id
        and str(link.get("free_course_id") or "") == course_id
        and not link.get("module_catalogue_id")
        and not link.get("week_id")
    ]

    issues = []
    if len(links) > 1 or len(exact_links) > 1:
        owner = "canonical" if quiz_week == week_id else None
        classification = "duplicate-canonical-link"
    elif quiz_week and quiz_week != week_id:
        owner = "canonical"
        classification = "owner-mismatch"
        issues.append(_issue("quiz_owner_mismatch", "blocked", **context))
    elif links and not exact_links:
        owner = "canonical" if quiz_week else None
        classification = "owner-mismatch"
        issues.append(_issue("quiz_link_owner_mismatch", "blocked", **context))
    elif quiz_week == week_id and quiz.get("week_id"):
        owner = "canonical"
        classification = "owner-mismatch"
        issues.append(_issue("canonical_quiz_has_normal_week_owner", "blocked", **context))
    elif quiz_week == week_id and len(exact_links) == 1:
        owner = "canonical"
        classification = "canonical"
    elif quiz_week == week_id:
        owner = "canonical"
        classification = "canonical-link-missing"
        issues.append(_issue("canonical_quiz_link_missing", "blocked", **context))
    elif not quiz_week and not links and quiz.get("week_id"):
        owner = "legacy-normal-owner"
        classification = "legacy-normal-owner"
        issues.append(_issue("legacy_normal_quiz_reference", "warning", **context))
    else:
        owner = None
        classification = "owner-mismatch"
        issues.append(_issue("quiz_owner_missing_or_ambiguous", "blocked", **context))

    legacy = owner == "legacy-normal-owner"
    if quiz_status.casefold() == "trash":
        issues.append(_issue("trashed_quiz_reference", "warning", **context))
        if classification not in {"duplicate-canonical-link", "owner-mismatch", "canonical-link-missing"}:
            classification = "trashed"

    return ({
        "quizId": quiz_id,
        "classification": classification,
        "ownerClassification": owner,
        "quizStatus": quiz_status or None,
        "readOnly": True,
    }, issues, legacy)


def _integrity_status(issues):
    if any(issue.get("severity") == "blocked" for issue in issues):
        return "blocked"
    return "warning" if issues else "ok"


def _duplicate_order_issues(rows, *, owner_key, entity):
    grouped = {}
    for row in rows:
        key = (str(row.get(owner_key) or ""), row.get("display_order"))
        grouped.setdefault(key, []).append(str(row.get("id") or ""))
    return [
        _issue(
            f"duplicate_{entity}_display_order",
            "warning",
            ownerId=owner,
            displayOrder=order,
            ids=sorted(ids),
        )
        for (owner, order), ids in sorted(grouped.items(), key=lambda item: (item[0][0], str(item[0][1])))
        if len(ids) > 1
    ]


def _decode_components(components):
    """Decode each component's settings and collect the quizzes they reference."""
    decoded_settings = {}
    quiz_ids = set()
    initial_issues = []
    malformed_quiz = {}
    for component in components:
        component_id = str(component.get("id") or "")
        settings, settings_error = _decode_settings(component.get("settings_json"))
        decoded_settings[component_id] = settings
        if settings_error:
            initial_issues.append(_issue(
                settings_error,
                "blocked",
                componentId=component_id,
                freeCourseWeekId=str(component.get("free_module_id") or ""),
            ))
        quiz_id, malformed = _linked_quiz_id(settings)
        malformed_quiz[component_id] = (quiz_id, malformed)
        if quiz_id:
            quiz_ids.add(quiz_id)
    return decoded_settings, quiz_ids, initial_issues, malformed_quiz


def _require_course_tables():
    schema_gate.require_tables(
        free_course_catalogue.FREE_COURSES_TABLE,
        free_course_catalogue.FREE_COURSE_WEEKS_TABLE,
        free_course_catalogue.FREE_COMPONENTS_TABLE,
        QUIZZES_TABLE,
        QUIZ_LINKS_TABLE,
    )


def course_document(course_id, *, read_snapshot=True):
    course_id = normalize_course_id(course_id)
    _require_course_tables()
    with (_read_snapshot() if read_snapshot else nullcontext()):
        courses = free_course_catalogue.courses(course_ids=[course_id])
        if not courses:
            raise FreeCourseNotFound(course_id)
        course = courses[0]
        weeks = free_course_catalogue.weeks(course_ids=[course_id])
        week_ids = [str(row.get("id") or "") for row in weeks]
        components = free_course_catalogue.components(week_ids=week_ids)

        decoded = _decode_components(components)
        quiz_ids = set(decoded[1])
        quiz_links = _quiz_link_rows(course_id, quiz_ids)
        quiz_ids.update(str(link.get("quiz_id") or "") for link in quiz_links if link.get("quiz_id"))
        quizzes = _quiz_rows(quiz_ids)
        return _assemble_course_document(course, weeks, components, decoded, quiz_links, quizzes)


def course_documents(course_rows):
    """Build the course document for every row in ``course_rows`` in one pass.

    Same output as calling ``course_document`` once per course, but the weeks,
    components, quiz links and quizzes are each read once for all the courses
    instead of once per course. Call inside the caller's read snapshot.
    """
    course_rows = list(course_rows)
    if not course_rows:
        return []
    _require_course_tables()
    course_ids = [str(row.get("id") or "") for row in course_rows]
    weeks = free_course_catalogue.weeks(course_ids=course_ids)
    components = free_course_catalogue.components(
        week_ids=[str(row.get("id") or "") for row in weeks]
    )
    weeks_by_course = {}
    for week in weeks:
        weeks_by_course.setdefault(str(week.get("course_id") or ""), []).append(week)
    week_course = {str(week.get("id") or ""): str(week.get("course_id") or "") for week in weeks}
    components_by_course = {}
    for component in components:
        owner = week_course.get(str(component.get("free_module_id") or ""))
        components_by_course.setdefault(owner, []).append(component)

    decoded_by_course = {
        course_id: _decode_components(components_by_course.get(course_id, []))
        for course_id in course_ids
    }
    all_quiz_ids = set().union(*(decoded[1] for decoded in decoded_by_course.values()))
    all_links = _quiz_link_rows_for_courses(course_ids, all_quiz_ids)
    all_quiz_ids.update(str(link.get("quiz_id") or "") for link in all_links if link.get("quiz_id"))
    all_quizzes = _quiz_rows(all_quiz_ids)

    documents = []
    for course in course_rows:
        course_id = str(course.get("id") or "")
        decoded = decoded_by_course[course_id]
        referenced = decoded[1]
        # The same rows _quiz_link_rows(course_id, referenced) would return.
        quiz_links = [
            link for link in all_links
            if str(link.get("free_course_id") or "") == course_id
            or (str(link.get("quiz_id") or "") in referenced and link.get("free_course_week_id") is not None)
        ]
        quiz_ids = set(referenced)
        quiz_ids.update(str(link.get("quiz_id") or "") for link in quiz_links if link.get("quiz_id"))
        quizzes = [row for row in all_quizzes if str(row.get("id") or "") in quiz_ids]
        documents.append(_assemble_course_document(
            course, weeks_by_course.get(course_id, []), components_by_course.get(course_id, []),
            decoded, quiz_links, quizzes,
        ))
    return documents


def _quiz_link_rows_for_courses(course_ids, quiz_ids):
    """Every link row any of ``course_ids`` would read through _quiz_link_rows."""
    course_ids = sorted({str(value) for value in course_ids if value})
    quiz_ids = sorted({str(value) for value in quiz_ids if value is not None and str(value)})
    if not course_ids and not quiz_ids:
        return []
    columns = ", ".join(_quote_ident(column) for column in QUIZ_LINK_REVISION_COLUMNS)
    clauses, params = [], []
    if course_ids:
        clauses.append(f'"free_course_id" in ({", ".join(["%s"] * len(course_ids))})')
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


def _assemble_course_document(course, weeks, components, decoded, quiz_links, quizzes):
    course_id = str(course.get("id") or "")
    decoded_settings, referenced_quiz_ids, initial_issues, malformed_quiz = decoded
    week_by_id = {str(row.get("id") or ""): row for row in weeks}
    quiz_by_id = {str(row.get("id") or ""): row for row in quizzes}
    links_by_quiz = {}
    for link in quiz_links:
        links_by_quiz.setdefault(str(link.get("quiz_id") or ""), []).append(link)

    issues = list(initial_issues)
    if len({str(row.get("id") or "") for row in weeks}) != len(weeks):
        issues.append(_issue("duplicate_free_week_id", "blocked"))
    if len({str(row.get("id") or "") for row in components}) != len(components):
        issues.append(_issue("duplicate_free_component_id", "blocked"))
    for week in weeks:
        if str(week.get("course_id") or "") != course_id:
            issues.append(_issue(
                "free_week_owner_mismatch", "blocked",
                freeCourseWeekId=str(week.get("id") or ""),
            ))
    for component in components:
        component_id = str(component.get("id") or "")
        week_id = str(component.get("free_module_id") or "")
        if week_id not in week_by_id:
            issues.append(_issue(
                "free_component_week_owner_mismatch", "blocked",
                componentId=component_id, freeCourseWeekId=week_id,
            ))
        if str(component.get("programme_id") or "") != FREE_COURSE_PROGRAMME_MARKER:
            issues.append(_issue(
                "free_component_programme_marker_mismatch", "blocked",
                componentId=component_id, freeCourseWeekId=week_id,
            ))
    for quiz_id, links in links_by_quiz.items():
        if len(links) > 1:
            issues.append(_issue(
                "duplicate_canonical_quiz_link", "blocked", quizId=quiz_id,
            ))
    for link in quiz_links:
        if str(link.get("free_course_id") or "") != course_id:
            continue
        quiz_id = str(link.get("quiz_id") or "")
        link_week_id = str(link.get("free_course_week_id") or "")
        quiz = quiz_by_id.get(quiz_id)
        if (
            link_week_id not in week_by_id
            or quiz is None
            or str(quiz.get("free_course_week_id") or "") != link_week_id
            or bool(quiz.get("week_id"))
            or bool(link.get("week_id"))
            or bool(link.get("module_catalogue_id"))
        ):
            issues.append(_issue(
                "canonical_quiz_link_owner_mismatch", "blocked",
                quizId=quiz_id, freeCourseWeekId=link_week_id,
            ))
        if quiz_id not in referenced_quiz_ids:
            issues.append(_issue(
                "unreferenced_canonical_quiz_link", "warning",
                quizId=quiz_id, freeCourseWeekId=link_week_id,
            ))
    issues.extend(_duplicate_order_issues(weeks, owner_key="course_id", entity="week"))
    issues.extend(_duplicate_order_issues(components, owner_key="free_module_id", entity="component"))

    public_components = {}
    legacy_count = 0
    for component in components:
        component_id = str(component.get("id") or "")
        quiz_id, malformed = malformed_quiz[component_id]
        quiz_reference, quiz_issues, legacy = _quiz_reference(
            component, course_id, quiz_id, malformed, quiz_by_id, links_by_quiz
        )
        issues.extend(quiz_issues)
        legacy_count += int(legacy)
        public_components.setdefault(str(component.get("free_module_id") or ""), []).append({
            "id": component_id,
            "freeCourseWeekId": str(component.get("free_module_id") or ""),
            "type": component.get("type") or "",
            "title": component.get("title") or "",
            "description": component.get("description") or "",
            "expectedOtjh": canonical_value(component.get("expected_otjh") or 0),
            "points": component.get("points") or 0,
            "reflectionRequired": bool(component.get("reflection_required")),
            "workplaceEvidenceRequired": bool(component.get("workplace_evidence_required")),
            "tutorValidationRequired": bool(component.get("tutor_validation_required")),
            "displayOrder": component.get("display_order"),
            "settings": decoded_settings[component_id],
            "quizReference": quiz_reference,
        })

    for rows in public_components.values():
        rows.sort(key=lambda row: (
            row.get("displayOrder") is None,
            row.get("displayOrder"),
            row["title"],
            row["id"],
        ))
    public_weeks = []
    for week in sorted(
        weeks,
        key=lambda row: (
            row.get("display_order") is None, row.get("display_order"),
            row.get("week_number") is None, row.get("week_number"), str(row.get("id") or ""),
        ),
    ):
        week_id = str(week.get("id") or "")
        provenance = str(week.get("legacy_copied_from_week_id") or "").strip() or None
        public_weeks.append({
            "freeCourseWeekId": week_id,
            "legacyCopiedFromWeekId": provenance,
            "weekNumber": week.get("week_number"),
            "title": week.get("title") or "",
            "summary": week.get("summary") or "",
            "learningOutcomes": week.get("learning_outcomes") or "",
            "status": week.get("status") or "",
            "holidayNoteEnabled": bool(week.get("holiday_note_enabled")),
            "holidayNote": week.get("holiday_note") or "",
            "displayOrder": week.get("display_order"),
            "components": public_components.get(week_id, []),
        })

    # Only canonical quiz ownership participates beyond the component's own
    # linkedQuizId. Legacy normal-owned quiz metadata remains diagnostic and
    # read-only, so unrelated changes there cannot stale a Free Course edit.
    canonical_quiz_ids = {
        str(link.get("quiz_id") or "")
        for link in quiz_links
        if str(link.get("free_course_id") or "") == course_id
    }
    revision_quizzes = [row for row in quizzes if str(row.get("id") or "") in canonical_quiz_ids]
    revision_links = [
        row for row in quiz_links
        if str(row.get("free_course_id") or "") == course_id
    ]
    revision = course_revision(
        course, weeks, components, revision_quizzes, revision_links
    )
    issues.sort(key=lambda issue: canonical_json_bytes(issue))
    return {
        "schemaVersion": CATALOGUE_SCHEMA_VERSION,
        "scope": "course",
        "revision": revision,
        "course": _public_course(course),
        "weeks": public_weeks,
        "integrity": {
            "status": _integrity_status(issues),
            "issues": issues,
            "legacyQuizReferenceCount": legacy_count,
        },
        "policies": {
            "expectedRevisionRequired": True,
            "componentWeekMoveAllowed": False,
            "assignedContentDeletionAllowed": False,
            "quizOwnershipEditingAllowed": False,
            "normalToFreeMode": "clone-only",
        },
    }


# ---------------------------------------------------------------------------
# CRUD HTTP views — catalogue listing and course-structure editing
# ---------------------------------------------------------------------------

logger = logging.getLogger(__name__)
_save_structure = tracked_save(v.curriculum_module_structure, 'module')
_metadata = {'expectedRevision', 'collaboration'}
_week_fields = {'title', 'summary', 'learningOutcomes', 'ksbMappings'}
_component_fields = {
    'type', 'title', 'description', 'expectedOtjh', 'points', 'reflectionRequired',
    'reflectionQuestion', 'workplaceEvidenceRequired', 'tutorValidationRequired', 'settings', 'ksbMappings',
}


def _course(course_id):
    rows = free_course_catalogue.courses(course_ids=[course_id], columns=['id'])
    return rows[0] if rows else None


def _active_module(course):
    row = v.authoring_module_exists(course.get('module_catalogue_id'))
    return bool(row and row.get('source_type') == 'free_course'
                and not v.curriculum_row_effectively_deleted(row))


def _reply(data, *, status=200):
    response = JsonResponse(data, status=status)
    response['Cache-Control'] = 'no-store'
    return response


@require_role('admin', 'staff')
@require_GET
def catalogue(request):
    """Compatibility catalogue backed by canonical Free Course identities."""
    try:
        rows = free_course_catalogue.courses(columns=[
            'id', 'course_name', 'week_count', 'component_count',
        ])
        results = [{**row, 'courseId': row['id'], 'courseName': row['course_name'],
                    # Retained response keys only; there is no module relation.
                    'moduleCatalogueId': None,
                    'editable': True,
                    'structureUrl': '/curriculum_api/curriculum/free-courses/'
                                    + quote(row['id'], safe='') + '/authoring/'}
                   for row in rows]
        return _reply({'results': results, 'count': len(results)})
    except DatabaseError:
        logger.exception('Unable to read the free-course authoring catalogue.')
        return v.json_error('The free-course catalogue could not be read. Retry shortly.', status=503)


def _forward_save(request, module_id, payload):
    # Keep the authenticated request/session and CSRF decision. Only adapt the
    # body to the shared, guarded structure writer; never issue another HTTP call.
    forwarded = copy.copy(request)
    forwarded.method = 'PATCH'
    forwarded._body = json.dumps(payload).encode('utf-8')
    forwarded.META = {**request.META, 'CONTENT_TYPE': 'application/json',
                      'CONTENT_LENGTH': str(len(forwarded._body))}
    return _save_structure(forwarded, module_catalogue_id=module_id)


def _delta(stored, kind, item_id, payload, method):
    """Change exactly one item; keep the latest order and all unnamed fields."""
    weeks = stored.get('weekStructure') or []
    week_by_id = {week['id']: week for week in weeks}
    components = {c['id']: c for week in weeks for c in week.get('components') or []}
    fields = _component_fields if kind == 'component' else _week_fields
    allowed = fields | _metadata | ({'weekId'} if method == 'POST' and kind == 'component' else set())
    if set(payload) - allowed:
        raise ValueError('Unsupported fields: ' + ', '.join(sorted(set(payload) - allowed)))
    if method == 'DELETE' and set(payload) - _metadata:
        raise ValueError('A delete only accepts expectedRevision and collaboration metadata.')
    if 'settings' in payload and not isinstance(payload['settings'], dict):
        raise ValueError('settings must be an object; clear an individual setting explicitly.')
    if 'ksbMappings' in payload and not isinstance(payload['ksbMappings'], list):
        raise ValueError('ksbMappings must be a list.')
    delta = {'weekOrder': list(week_by_id),
             'componentOrder': {w['id']: [c['id'] for c in w.get('components') or []] for w in weeks},
             'weeks': {}, 'components': {}}
    table = components if kind == 'component' else week_by_id
    if method == 'POST':
        if not payload.get('title') or (kind == 'component' and not payload.get('type')):
            raise ValueError('A title and, for a component, a type are required.')
        item_id = ('COMP-' if kind == 'component' else 'WEEK-') + uuid4().hex.upper()
        if kind == 'component':
            week_id = payload.get('weekId')
            if week_id not in week_by_id:
                raise LookupError('Week not found in this free course.')
            delta['componentOrder'][week_id].append(item_id)
            current = {'id': item_id, 'weekId': week_id, 'settings': {}, 'ksbMappings': []}
        else:
            delta['weekOrder'].append(item_id)
            delta['componentOrder'][item_id] = []
            current = {'id': item_id, 'weekNumber': len(weeks) + 1}
    else:
        if item_id not in table:
            raise LookupError('Item not found in this free course.')
        current = table[item_id]
    if method == 'DELETE':
        if kind == 'component':
            for ids in delta['componentOrder'].values():
                if item_id in ids:
                    ids.remove(item_id)
        else:
            delta['weekOrder'].remove(item_id)
            del delta['componentOrder'][item_id]
    else:
        changed = {**current, **{key: value for key, value in payload.items() if key in fields}, 'id': item_id}
        if 'settings' in payload:
            changed['settings'] = {**(current.get('settings') or {}), **payload['settings']}
        if kind == 'week':
            changed.pop('components', None)
        delta['components' if kind == 'component' else 'weeks'][item_id] = changed
    body = {key: value for key, value in stored.items() if key not in {'weeks', 'weekStructure'}}
    body.update({key: value for key, value in payload.items() if key in _metadata})
    body.update(saveMode='partial', structureDelta=delta)
    return body, item_id


@require_role('admin', 'staff')
@csrf_protect
def authoring(request, course_id, *, kind='structure', item_id=None):
    methods = {'GET', 'PATCH'} if kind == 'structure' else {'GET'} if kind == 'collaboration' else (
        {'GET', 'PATCH', 'DELETE'} if item_id else {'POST'})
    if request.method not in methods:
        return v.json_error('Method not allowed.', status=405)
    payload = v.json_body(request) if request.method != 'GET' else {}
    if not isinstance(payload, dict):
        return v.json_error('Invalid JSON body.', status=400)
    try:
        course = _course(course_id)
        if not course:
            return v.json_error('Free course not found.', status=404)
        module_id = course.get('module_catalogue_id')
        if not module_id:
            return v.json_error('This legacy course needs adoption into Module Builder before concurrent editing.',
                                status=409, code='free_course_adoption_required')
        with transaction.atomic():
            # The same lock as Builder, conversion and field reservations.
            # Recheck type after locking: conversion must not race a free edit.
            v.lock_module_structure_row(module_id)
            if not _active_module(course):
                return v.json_error('Free course not found or already converted.', status=404)
            if kind == 'collaboration':
                return collaboration_configuration(request, module_id)
            if request.method != 'GET':
                refused = v.refuse_stale_module_write(request, payload, module_id)
                if refused is not None:
                    return refused
            stored = v.read_module_structure_with_revision(module_id)
            if not stored:
                return v.json_error('Free course not found.', status=404)
            if request.method == 'GET':
                if kind == 'structure':
                    return _reply({**stored, 'courseId': course_id, 'moduleCatalogueId': module_id})
                items = stored.get('weekStructure') or []
                if kind == 'component':
                    items = [c for w in items for c in w.get('components') or []]
                item = next((item for item in items if item['id'] == item_id), None)
                if item is None:
                    return v.json_error('Item not found in this free course.', status=404)
                return _reply({kind: item, 'courseId': course_id, 'moduleCatalogueId': module_id,
                               'structureRevision': stored['structureRevision']})
            if kind == 'structure':
                body = {**payload, 'expectedRevision': v.requested_expected_revision(request, payload)}
            else:
                payload = {**payload, 'expectedRevision': v.requested_expected_revision(request, payload)}
                body, item_id = _delta(stored, kind, item_id, payload, request.method)
            response = _forward_save(request, module_id, body)
            if response.status_code >= 300:
                return response
            saved = json.loads(response.content)
            return _reply({**saved, 'courseId': course_id, 'moduleCatalogueId': module_id,
                           **({'itemId': item_id} if item_id else {}),
                           **({'deleted': True, 'permanent': False} if request.method == 'DELETE' else {})},
                          status=201 if request.method == 'POST' else 200)
    except LookupError as exc:
        return v.json_error(str(exc), status=404)
    except (ValueError, TypeError) as exc:
        return v.json_error(str(exc), status=400)
    except DatabaseError:
        logger.exception('Unable to edit a free course.')
        return v.json_error('The course could not be checked or saved. Your changes have not been applied.', status=503)
