"""Deterministic document values and existing optimistic-concurrency revisions."""
import hashlib
import json
import math
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

CATALOGUE_SCHEMA_VERSION = "free-course-authoring.v1"

CATALOGUE_REVISION_PREFIX = "fccv1:"

COURSE_REVISION_PREFIX = "fcv1:"

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
