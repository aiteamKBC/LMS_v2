from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo


BUSINESS_TZ = ZoneInfo("Europe/London")


def _value(row, *names):
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return ""


def _date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def _decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def unwrap(row, key):
    value = row.get(key)
    return value if isinstance(value, dict) else row


def normalize_employee(raw):
    row = unwrap(raw, "employee")
    employee_id = str(_value(row, "id", "employee_id", "employeeId")).strip()
    return {
        "external_employee_id": employee_id,
        "external_email": str(_value(row, "email", "work_email", "workEmail")).strip().lower(),
        "display_name": " ".join(part for part in (str(_value(row, "first_name", "firstName")), str(_value(row, "last_name", "lastName"))) if part).strip() or str(_value(row, "name", "full_name")).strip(),
        "job_title": str(_value(row, "job_title", "jobTitle", "position")).strip(),
        "department_external_id": str(_value(row, "department_id", "departmentId")).strip(),
        "department_name": str(_value(row, "department_name", "departmentName", "department")).strip(),
        "manager_external_id": str(_value(row, "manager_id", "managerId", "line_manager_id")).strip(),
        "employment_status": str(_value(row, "status", "employment_status", "employmentStatus")).strip(),
        "employment_start_date": _date(_value(row, "start_date", "employment_start_date", "employmentStartDate")),
        "contracted_hours": _decimal(_value(row, "contracted_hours", "working_hours", "hours_per_week", "hoursPerWeek")),
        "working_pattern": row.get("working_pattern") if isinstance(row.get("working_pattern"), dict) else {},
        "source_updated_at": _date(_value(row, "updated_at", "updatedAt")),
    }


def normalize_department(raw):
    row = unwrap(raw, "department")
    return {
        "external_department_id": str(_value(row, "id", "department_id", "departmentId")).strip(),
        "external_name": str(_value(row, "name", "title")).strip(),
    }


def normalize_leave(raw):
    row = unwrap(raw, "leave_request")
    state = str(_value(row, "status", "approval_status", "approvalStatus")).strip().lower()
    if state not in {"approved", "authorised", "authorized"}:
        return None
    start = _date(_value(row, "start_date", "startDate", "from"))
    end = _date(_value(row, "end_date", "endDate", "to")) or start
    if not start or not end:
        return None
    # Store a compliance category, never the provider's free-text reason.
    reason = str(_value(row, "reason_category", "reason_type", "leave_type", "leaveType")).strip().lower()
    return {
        "external_person_id": str(_value(row, "employee_id", "employeeId", "person_id")).strip(),
        "starts_at": datetime.combine(start, datetime.min.time(), tzinfo=BUSINESS_TZ),
        "ends_at": datetime.combine(end, datetime.max.time(), tzinfo=BUSINESS_TZ),
        "reason_category": reason[:64],
        "source_ref": str(_value(row, "id", "leave_request_id", "leaveRequestId")).strip(),
    }


def normalize_training(raw):
    row = unwrap(raw, "employee_training_course")
    return {
        "external_training_id": str(_value(row, "id", "training_id", "trainingId")).strip(),
        "external_employee_id": str(_value(row, "employee_id", "employeeId", "person_id")).strip(),
        "title": str(_value(row, "title", "name", "course_name", "courseName")).strip(),
        "category": str(_value(row, "category", "training_type", "trainingType")).strip(),
        "completion_date": _date(_value(row, "completion_date", "completed_at", "completedAt")),
        "status": str(_value(row, "status", "state")).strip(),
        "certificate_ref": str(_value(row, "certificate_reference", "certificateRef")).strip(),
    }
