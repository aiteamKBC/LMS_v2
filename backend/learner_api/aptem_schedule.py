"""Normalise and reconcile programme schedule facts from Aptem Auto Extract.

The Auto Extract relation is an external, read-only source.  This module only
normalises its three schedule facts and plans scoped mirror updates; the
management command owns the database transaction.  Keeping the comparison
pure makes the dry-run report testable without opening either database.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation


SCHEDULE_FIELDS = ("planned_hours", "start_date", "end_date")


def _text(value) -> str:
    return "" if value in (None, "") else str(value).strip()


def normalise_aptem_id(value) -> str | None:
    value = _text(value)
    return value or None


def parse_aptem_date(value) -> date | None:
    """Parse the date shapes used by Auto Extract and enrolment mirrors."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _text(value)
    if not text:
        return None
    for candidate in (text[:10], text):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
            try:
                return datetime.strptime(candidate, fmt).date()
            except ValueError:
                continue
    return None


def parse_aptem_hours(value) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        result = Decimal(str(value).strip())
    except (InvalidOperation, TypeError, ValueError):
        return None
    if not result.is_finite() or result < 0:
        return None
    # Auto Extract stores whole hours today, while the SSOT mirror accepts two
    # decimal places.  Rejecting excess precision is safer than silently
    # inventing a rounded training-plan total.
    if result.as_tuple().exponent < -2:
        return None
    return result.quantize(Decimal("0.01"))


def normalise_source_row(row: dict) -> dict:
    """Return one source row with typed values and an explicit review status."""
    aptem_id = normalise_aptem_id(row.get("aptem_id"))
    planned_hours = parse_aptem_hours(row.get("planned_hours"))
    start_date = parse_aptem_date(row.get("start_date"))
    end_date = parse_aptem_date(row.get("end_date"))
    errors: list[str] = []
    if not aptem_id:
        errors.append("missing_aptem_id")
    if row.get("planned_hours") not in (None, "") and planned_hours is None:
        errors.append("invalid_planned_hours")
    if row.get("start_date") not in (None, "") and start_date is None:
        errors.append("invalid_start_date")
    if row.get("end_date") not in (None, "") and end_date is None:
        errors.append("invalid_end_date")
    if start_date and end_date and end_date <= start_date:
        errors.append("end_not_after_start")
    if planned_hours is None:
        errors.append("missing_planned_hours")
    if start_date is None:
        errors.append("missing_start_date")
    if end_date is None:
        errors.append("missing_end_date")
    return {
        "aptem_id": aptem_id,
        "planned_hours": planned_hours,
        "start_date": start_date,
        "end_date": end_date,
        "status": "READY" if not errors else "REVIEW",
        "errors": errors,
    }


def canonical_hours(value) -> Decimal | None:
    return parse_aptem_hours(value)


def canonical_date(value) -> date | None:
    return parse_aptem_date(value)


def _same(field: str, current, expected) -> bool:
    if field == "planned_hours":
        return canonical_hours(current) == expected
    return canonical_date(current) == expected


def plan_mirror_update(source: dict, enrolment, profile=None, *, replace_conflicts=False) -> dict:
    """Plan missing-only SSOT mirror fields for one matched learner.

    Existing, different values are reported as conflicts and never overwritten
    unless ``replace_conflicts`` is explicitly requested by the operator.
    The command still refuses incomplete/invalid source rows.
    """
    if source.get("status") != "READY":
        return {
            "status": "REVIEW",
            "errors": list(source.get("errors") or []),
            "enrolment_fields": {},
            "profile_fields": {},
            "conflicts": [],
        }

    expected = {field: source[field] for field in SCHEDULE_FIELDS}
    enrolment_fields = {}
    profile_fields = {}
    conflicts = []
    for field, value in expected.items():
        current = getattr(enrolment, field, None)
        if current in (None, ""):
            enrolment_fields[field] = (
                f"{value:.2f}" if field == "planned_hours" else value.isoformat()
            )
        elif not _same(field, current, value):
            conflicts.append({"target": "enrolment", "field": field})

        if profile is None:
            continue
        current_profile = getattr(profile, field, None)
        if current_profile in (None, ""):
            profile_fields[field] = value
        elif not _same(field, current_profile, value):
            conflicts.append({"target": "profile", "field": field})

    if conflicts and not replace_conflicts:
        return {
            "status": "CONFLICT",
            "errors": [],
            # Keep non-conflicting missing fields in the plan.  A stale profile
            # planned total must not prevent restoring a blank end date on the
            # source row; only the differing field itself is held back.
            "enrolment_fields": enrolment_fields,
            "profile_fields": profile_fields,
            "conflicts": conflicts,
        }

    if replace_conflicts:
        for field, value in expected.items():
            enrolment_fields[field] = (
                f"{value:.2f}" if field == "planned_hours" else value.isoformat()
            )
            if profile is not None:
                profile_fields[field] = value

    return {
        "status": "UPDATE" if enrolment_fields or profile_fields else "CURRENT",
        "errors": [],
        "enrolment_fields": enrolment_fields,
        "profile_fields": profile_fields,
        "conflicts": conflicts,
    }
