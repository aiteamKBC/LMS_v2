"""Free Course validation, revisions, idempotency and content change decisions."""
import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from . import free_course_revisions as documents

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


def _changed(existing, values):
    for key, value in values.items():
        current = existing.get(key)
        if key in {"settings_json", "learning_outcomes"}:
            if documents.canonical_value(current) != documents.canonical_value(value):
                return True
        elif current != value:
            return True
    return False
