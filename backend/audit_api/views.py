import datetime
import decimal
import hashlib
import json
import os
import re
import uuid
from collections import defaultdict
from urllib.parse import unquote

from django.db import DatabaseError, connections
from django.http import HttpResponseRedirect, JsonResponse
from django.views.decorators.csrf import csrf_exempt

try:
    from azure.storage.blob import BlobSasPermissions, BlobServiceClient, generate_blob_sas
except ImportError:  # pragma: no cover - handled at runtime when Azure is not installed.
    BlobServiceClient = None
    BlobSasPermissions = None
    generate_blob_sas = None


AUDIT_SCHEMA = "Audit"
MAIN_TABLE = "Aptem_LMS_matching"
SIGNOFF_TABLE = "monthly_audit_signoffs"
STUDENT_SOURCE_DATA_COLUMN = "Learner_source_data"
AUDIT_VERSION = "aptem-lms-reconciliation-v1"
SOURCE_DATA_SUMMARY_LIMIT = 120
TEST_RECORD_FILTER_SQL = """
not (
    coalesce("Learner_name", '') ilike '%%(test)%%'
    or coalesce("Programme_name", '') ilike '%%(test)%%'
    or coalesce("Learner_name", '') ~* '(^|[^a-z])test([^a-z]|$)'
)
"""


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _has_audit_permission(request, write=False):
    if os.environ.get("AUDIT_API_REQUIRE_AUTH", "").lower() not in {"1", "true", "yes"}:
        return True
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return False
    if user.is_staff or user.is_superuser:
        return True
    permission = "audit.export" if write else "audit.view"
    return user.has_perm(permission)


def _json_safe(value):
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    return value


def _rows_from_cursor(cur):
    columns = [col[0] for col in cur.description]
    return [
        {column: _json_safe(value) for column, value in zip(columns, row)}
        for row in cur.fetchall()
    ]


def _parse_json_value(value, path, warnings):
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            warnings.append(_warning("invalid_json", f"{path} contains invalid JSON text.", path))
            return None
    warnings.append(_warning("invalid_json_type", f"{path} is not a JSON object, array, or text value.", path))
    return None


def _warning(code, message, path="", severity="warning"):
    return {"code": code, "message": message, "path": path, "severity": severity}


def _text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    return str(value)


def _number(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float, decimal.Decimal)) and not isinstance(value, bool):
        return float(value)
    match = re.search(r"-?\d+(?:\.\d+)?", str(value))
    return float(match.group(0)) if match else None


def _integer(value):
    number = _number(value)
    return int(number) if number is not None else None


def _date(value):
    normalized = _text(value)
    if not normalized:
        return None
    for parser in (
        lambda v: datetime.datetime.fromisoformat(v.replace("Z", "+00:00")),
        lambda v: datetime.datetime.strptime(v, "%Y-%m-%d %H:%M:%S"),
        lambda v: datetime.datetime.strptime(v, "%Y-%m-%d"),
        lambda v: datetime.datetime.strptime(v, "%d/%m/%Y"),
    ):
        try:
            return parser(normalized).date()
        except ValueError:
            continue
    return None


def _date_iso(value):
    parsed = _date(value)
    return parsed.isoformat() if parsed else None


def _month_key(date_value):
    parsed = _date(date_value)
    return parsed.strftime("%Y-%m") if parsed else None


def _month_label(month_key):
    try:
        parsed = datetime.datetime.strptime(month_key, "%Y-%m")
    except ValueError:
        return "Undated / Needs Review"
    return parsed.strftime("%B %Y")


def _today():
    return datetime.date.today()


def _is_future_date(date_value, today=None):
    parsed = _date(date_value)
    return bool(parsed and parsed > (today or _today()))


def _week_key(date_value):
    parsed = _date(date_value)
    if not parsed:
        return None
    day_bucket = ((parsed.day - 1) // 7) * 7 + 1
    start = parsed.replace(day=day_bucket)
    end = min(start + datetime.timedelta(days=6), _last_day_of_month(parsed))
    return start.isoformat(), start.isoformat(), end.isoformat(), f"{start.day}-{end.day} {start.strftime('%b')}"


def _last_day_of_month(value):
    if value.month == 12:
        return value.replace(day=31)
    return value.replace(month=value.month + 1, day=1) - datetime.timedelta(days=1)


def _status_bucket(status):
    normalized = _text(status).lower().replace(" ", "")
    if "complete" in normalized or normalized in {"passed", "done"}:
        return "completed"
    if "progress" in normalized or "started" in normalized or "visited" in normalized:
        return "in_progress"
    return "not_started"


def _relevant_date(source, row, warnings, path):
    completion_keys = (
        "completed_at",
        "completed_date",
        "completion_date",
        "Course Completed At",
        "Latest Quiz Submitted At",
        "submitted_at",
        "submission_date",
    )
    for key in completion_keys:
        value = row.get(key)
        if _date(value):
            return _date_iso(value), key
    for key in ("end_date", "End Date", "Course End Date"):
        value = row.get(key)
        if _date(value):
            return _date_iso(value), key
    for key in ("start_date", "Start Date", "Course Started At", "Registered At"):
        value = row.get(key)
        if _date(value):
            return _date_iso(value), key
    warnings.append(_warning("missing_relevant_date", f"{source} item has no reliable structured date.", path))
    return None, None


def _date_warnings(row, warnings, path):
    start = _date(row.get("start_date") or row.get("Course Started At"))
    end = _date(row.get("end_date") or row.get("Course Completed At"))
    if start and end and start > end:
        warnings.append(_warning("invalid_date_range", "Start date is later than end date.", path))


def _programme_key(row):
    return _text(row.get("Programme_name")) or "programme-not-available"


def _aptem_components(row, warnings):
    parsed = _parse_json_value(row.get("Aptem_components"), "Aptem_components", warnings)
    if parsed is None:
        warnings.append(_warning("no_aptem_data", "No Aptem components are available.", "Aptem_components", "info"))
        return []
    components = parsed.get("components") if isinstance(parsed, dict) else parsed
    if not isinstance(components, list):
        warnings.append(_warning("invalid_aptem_shape", "Aptem_components must contain a components array.", "Aptem_components"))
        return []
    if not components:
        warnings.append(_warning("no_aptem_data", "No Aptem components are available.", "Aptem_components", "info"))
    return components


def _lms_items(row, warnings):
    parsed = _parse_json_value(row.get("LMS_modules_details"), "LMS_modules_details", warnings)
    if parsed is None:
        if not _text(row.get("LMS_Summary")):
            warnings.append(_warning("no_lms_data", "No LMS module details are available.", "LMS_modules_details", "info"))
        return []
    items = parsed.get("items") if isinstance(parsed, dict) else parsed
    if not isinstance(items, list):
        warnings.append(_warning("invalid_lms_shape", "LMS_modules_details must contain an items array.", "LMS_modules_details"))
        return []
    if not items and not _text(row.get("LMS_Summary")):
        warnings.append(_warning("no_lms_data", "No LMS module details are available.", "LMS_modules_details", "info"))
    return items


def _normalize_aptem_item(component, index):
    warnings = []
    path = f"Aptem_components.components[{index}]"
    if not isinstance(component, dict):
        return None, [_warning("invalid_aptem_item", "Aptem component is not an object.", path)]
    _date_warnings(component, warnings, path)
    relevant_date, date_source = _relevant_date("Aptem", component, warnings, path)
    hours = _number(component.get("hours"))
    planned_hours = _number(component.get("planned_hours"))
    source_id = _text(component.get("id") or component.get("component_id") or component.get("source_id")) or f"aptem-{index}"
    return {
        "id": f"aptem:{source_id}",
        "source": "Aptem",
        "source_id": source_id,
        "activity_name": _text(component.get("name")) or "Unnamed Aptem activity",
        "type": _text(component.get("type")) or "Not available",
        "status": _text(component.get("status")) or "Not available",
        "actual_hours": hours,
        "planned_hours": planned_hours,
        "hours_variance": (hours - planned_hours) if hours is not None and planned_hours is not None else None,
        "start_date": _date_iso(component.get("start_date")),
        "end_date": _date_iso(component.get("end_date")),
        "relevant_date": relevant_date,
        "date_source": date_source,
        "match_status": "Needs Review",
        "match_reason": "No stable Aptem/LMS matching key was available in the source record.",
        "matched_source_ids": [],
        "warning_codes": [warning["code"] for warning in warnings],
        "warnings": warnings,
        "raw": component,
    }, warnings


def _normalize_lms_item(item, index):
    warnings = []
    path = f"LMS_modules_details.items[{index}]"
    if not isinstance(item, dict):
        return None, [_warning("invalid_lms_item", "LMS item is not an object.", path)]
    relevant_date, date_source = _relevant_date("LMS", item, warnings, path)
    tracked_seconds = _integer(item.get("Total Tracked Time Seconds") or item.get("Course Elapsed Seconds") or item.get("Material Time Seconds"))
    source_id = _text(item.get("Course ID") or item.get("row_number") or item.get("User ID")) or f"lms-{index}"
    return {
        "id": f"lms:{source_id}:{index}",
        "source": "LMS",
        "source_id": source_id,
        "course_module": _text(item.get("Module/Course") or item.get("Course")) or "Not available",
        "component_name": _text(item.get("Latest Quiz Title") or item.get("Completed Material Titles") or item.get("Module/Course") or item.get("Course")) or "Not available",
        "component_type": _text(item.get("from") or "LMS module"),
        "completion_status": _text(item.get("Course Status") or item.get("Latest Quiz Status")) or "Not available",
        "tracked_seconds": tracked_seconds,
        "quiz_attempts": _integer(item.get("Quiz Attempts Count") or item.get("Quizzes Attempted")),
        "quiz_score": _number(item.get("Latest Quiz Score (%)") or item.get("Average Best Quiz Score (%)") or item.get("Overall Quiz Accuracy (%)")),
        "tutor": _text(item.get("Tutor Name")),
        "course_started_at": _date_iso(item.get("Course Started At") or item.get("Registered At")),
        "course_completed_at": _date_iso(item.get("Course Completed At")),
        "relevant_date": relevant_date,
        "date_source": date_source,
        "match_status": "Needs Review",
        "match_reason": "No stable Aptem/LMS matching key was available in the source record.",
        "matched_source_ids": [],
        "warning_codes": [warning["code"] for warning in warnings],
        "warnings": warnings,
        "raw": item,
    }, warnings


def _parse_lms_summary(text):
    progress = None
    tracked_seconds = None
    if not text:
        return {"lms_progress": None, "tracked_seconds": None}
    progress_match = re.search(r"Progress\s*\(%\)\D+(\d+(?:\.\d+)?)", text)
    if progress_match:
        progress = float(progress_match.group(1))
    time_match = re.search(r"Time:\s*(\d+):(\d+):(\d+)", text)
    if time_match:
        hours, minutes, seconds = [int(part) for part in time_match.groups()]
        tracked_seconds = hours * 3600 + minutes * 60 + seconds
    return {"lms_progress": progress, "tracked_seconds": tracked_seconds}


def _parse_quiz_summary(text):
    if not text:
        return {"quiz_attempts": None}
    attempts = [int(value) for value in re.findall(r"Attempts:\s*(\d+)", text)]
    return {"quiz_attempts": sum(attempts) if attempts else None}


def _build_audit_payload(row):
    warnings = []
    aptem_components = _aptem_components(row, warnings)
    lms_source_items = _lms_items(row, warnings)
    aptem_items = []
    lms_items = []

    for index, component in enumerate(aptem_components):
        item, item_warnings = _normalize_aptem_item(component, index)
        warnings.extend(item_warnings)
        if item:
            aptem_items.append(item)

    for index, source_item in enumerate(lms_source_items):
        item, item_warnings = _normalize_lms_item(source_item, index)
        warnings.extend(item_warnings)
        if item:
            lms_items.append(item)

    months = _group_months(aptem_items, lms_items)
    signoffs = _empty_signoffs_by_month(months)
    lms_summary = _summary_from_lms_items(lms_items) or {}
    quiz_summary = _summary_from_quiz_items(lms_items) or {}
    components_completed = sum(1 for item in aptem_items if _status_bucket(item["status"]) == "completed")
    total_planned_hours = _sum_unique_planned_hours(aptem_items)

    payload = {
        "learnerId": str(row.get("Learner_ID") or ""),
        "learner": {
            "id": row.get("Learner_ID"),
            "name": row.get("Learner_name"),
            "programme_name": row.get("Programme_name"),
            "programme_key": _programme_key(row),
            "programme_start_date": None,
            "employer": None,
            "epa": None,
            "epao": None,
            "company_logo_url": os.environ.get("AUDIT_COMPANY_LOGO_URL") or None,
        },
        "summary": {
            "completed_otjh": row.get("Completed_OTJH"),
            "approved_hours": None,
            "planned_hours_month": None,
            "planned_hours_to_date": None,
            "total_programme_planned_hours": total_planned_hours,
            "ksb_progression": None,
            "lms_progress": lms_summary.get("lms_progress"),
            "tracked_seconds": lms_summary.get("tracked_seconds"),
            "components_completed": components_completed,
            "components_total": len(aptem_items) if aptem_components else None,
            "quiz_attempts": quiz_summary.get("quiz_attempts"),
        },
        "months": months,
        "signoffs": signoffs,
        "warnings": _dedupe_warnings(warnings),
        "field_sources": _field_sources(),
        "source_status": {
            "has_aptem_data": bool(aptem_items),
            "has_lms_data": bool(lms_items),
            "lms_summary_fallback": False,
            "quiz_summary_fallback": False,
        },
        "audit_version": AUDIT_VERSION,
    }
    _apply_monthly_planned_totals(payload)
    payload["snapshot_hash"] = _snapshot_hash(payload)
    return payload


def _build_student_source_data(row):
    warnings = []
    aptem_components = _parse_json_value(row.get("Aptem_components"), "Aptem_components", warnings)
    lms_modules_details = _parse_json_value(row.get("LMS_modules_details"), "LMS_modules_details", warnings)
    aptem_items = aptem_components.get("components") if isinstance(aptem_components, dict) else aptem_components
    lms_items = lms_modules_details.get("items") if isinstance(lms_modules_details, dict) else lms_modules_details
    if not isinstance(aptem_items, list):
        aptem_items = []
    if not isinstance(lms_items, list):
        lms_items = []

    return {
        "schema_version": "learner-source-data-v6",
        "programme": _programme_tree(row, aptem_items, lms_items),
        "aptem": {
            "months_source": "Aptem_components grouped by component end_date/start_date",
        },
        "lms": {
            "weeks_source": "LMS_modules_details grouped by Course Completed At/Course Started At",
            "modules_source": "LMS_modules_details.items[].Module/Course",
            "components_or_lecture_summaries_source": "LMS_modules_details.items[].Completed Material Titles split by |, plus Latest Quiz Title",
            "summary": row.get("LMS_Summary"),
            "quiz_summary": row.get("Quiz_summary"),
        },
        "warnings": _dedupe_warnings(warnings),
        "source_columns": {
            "programme": ["Programme_name", "Aptem_components"],
            "months": ["Aptem_components"],
            "weeks": ["LMS_modules_details"],
            "modules": ["LMS_modules_details"],
            "components_or_lecture_summaries": ["LMS_modules_details"],
        },
    }


def _programme_tree(row, aptem_items, lms_items):
    programme = _aptem_programme(row, aptem_items)
    programme["learner"] = {
        "id": row.get("Learner_ID"),
        "name": row.get("Learner_name"),
        "completed_otjh": row.get("Completed_OTJH"),
    }
    programme["modules"] = _programme_modules(aptem_items, lms_items)
    return programme


def _aptem_programme(row, aptem_items):
    dates = [_date(item.get("start_date")) for item in aptem_items if isinstance(item, dict) and _date(item.get("start_date"))]
    end_dates = [_date(item.get("end_date")) for item in aptem_items if isinstance(item, dict) and _date(item.get("end_date"))]
    return {
        "name": row.get("Programme_name"),
        "source": "Aptem",
        "start_date": min(dates).isoformat() if dates else None,
        "end_date": max(end_dates).isoformat() if end_dates else None,
        "components_count": len(aptem_items),
    }


def _programme_modules(aptem_items, lms_items):
    aptem_months = _aptem_month_map(aptem_items)
    modules = {}
    for item in lms_items:
        if not isinstance(item, dict):
            continue
        name = _text(item.get("Module/Course") or item.get("Course")) or "Not available"
        module = modules.setdefault(name, {
            "name": name,
            "source": "LMS",
            "course_id": item.get("Course ID"),
            "category": item.get("Course Category"),
            "status": item.get("Course Status") or item.get("Latest Quiz Status"),
            "progress_percent": _number(item.get("Progress (%)")),
            "components_total": _integer(item.get("Components Total")),
            "components_completed": _integer(item.get("Components Completed")),
            "months": {},
        })
        weeks = _lms_weeks_for_item(item)
        month_key = _month_key(weeks[0].get("date")) if weeks else "undated"
        month = module["months"].setdefault(month_key, {
            "month_key": month_key,
            "label": _month_label(month_key),
            "source": "Aptem",
            "aptem_components": aptem_months.get(month_key, []),
            "weeks": {},
        })
        summaries = _lms_components_or_lecture_summaries(item)
        for week, week_summaries in zip(weeks, _split_across_weeks(summaries, weeks)):
            week_entry = month["weeks"].setdefault(week["week_key"], {
                **week,
                "lectures_or_components": [],
                "lectures_or_components_count": 0,
                "allocation_note": "LMS does not provide per-lecture dates; completed material titles are distributed across the LMS month weeks in source order.",
            })
            for component in week_summaries:
                if component not in week_entry["lectures_or_components"]:
                    week_entry["lectures_or_components"].append(component)
            week_entry["lectures_or_components_count"] = len(week_entry["lectures_or_components"])
            week_entry["lectures_or_components"] = week_entry["lectures_or_components"][:SOURCE_DATA_SUMMARY_LIMIT]

    result = []
    for module in modules.values():
        months = []
        for month in module["months"].values():
            month["weeks"] = sorted(month["weeks"].values(), key=lambda week: week["week_key"])
            months.append(month)
        module["months"] = sorted(months, key=lambda month: month["month_key"], reverse=True)
        result.append(module)
    return sorted(result, key=lambda module: module["name"])


def _aptem_month_map(aptem_items):
    months = {}
    for component in aptem_items:
        if not isinstance(component, dict):
            continue
        month_key = _month_key(component.get("end_date") or component.get("start_date")) or "undated"
        months.setdefault(month_key, []).append(_aptem_month_component(component))
    return months


def _source_data_months(aptem_items, lms_items):
    month_map = {}
    for component in aptem_items:
        if not isinstance(component, dict):
            continue
        month_key = _month_key(component.get("end_date") or component.get("start_date")) or "undated"
        month = month_map.setdefault(month_key, {
            "month_key": month_key,
            "label": _month_label(month_key),
            "source": "Aptem",
            "aptem_month_components": [],
            "lms_weeks": [],
        })
        month["aptem_month_components"].append(_aptem_month_component(component))

    for item in lms_items:
        if not isinstance(item, dict):
            continue
        week = _lms_week(item)
        month_key = _month_key(week.get("date")) if week else None
        month_key = month_key or "undated"
        month = month_map.setdefault(month_key, {
            "month_key": month_key,
            "label": _month_label(month_key),
            "source": "Aptem",
            "aptem_month_components": [],
            "lms_weeks": [],
        })
        if week:
            week["modules"] = [_lms_module_summary(item)]
            summaries = _lms_components_or_lecture_summaries(item)
            week["components_or_lecture_summaries_count"] = len(summaries)
            week["components_or_lecture_summaries"] = summaries[:SOURCE_DATA_SUMMARY_LIMIT]
            month["lms_weeks"].append(week)

    return sorted(month_map.values(), key=lambda month: month["month_key"], reverse=True)


def _aptem_month_component(component):
    return {
        "name": component.get("name"),
        "type": component.get("type"),
        "status": component.get("status"),
        "hours": _number(component.get("hours")),
        "planned_hours": _number(component.get("planned_hours")),
        "start_date": _date_iso(component.get("start_date")),
        "end_date": _date_iso(component.get("end_date")),
    }


def _lms_week(item):
    date_value = (
        item.get("Course Completed At")
        or item.get("Latest Quiz Submitted At")
        or item.get("Course Started At")
        or item.get("Registered At")
    )
    week_parts = _week_key(date_value)
    if not week_parts:
        return None
    week_key, start, end, label = week_parts
    return {
        "week_key": week_key,
        "label": label,
        "date": _date_iso(date_value),
        "start_date": start,
        "end_date": end,
        "source": "LMS",
    }


def _lms_weeks_for_item(item):
    date_value = (
        item.get("Course Completed At")
        or item.get("Latest Quiz Submitted At")
        or item.get("Course Started At")
        or item.get("Registered At")
    )
    parsed = _date(date_value)
    if not parsed:
        return [{
            "week_key": "undated",
            "label": "Undated / Needs Review",
            "date": None,
            "start_date": None,
            "end_date": None,
            "source": "LMS",
        }]

    first_day = parsed.replace(day=1)
    last_day = _last_day_of_month(parsed)
    weeks = []
    start = first_day
    while start <= last_day:
        end = min(start + datetime.timedelta(days=6), last_day)
        weeks.append({
            "week_key": start.isoformat(),
            "label": f"{start.day}-{end.day} {start.strftime('%b')}",
            "date": parsed.isoformat(),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "source": "LMS",
        })
        start = end + datetime.timedelta(days=1)
    return weeks


def _split_across_weeks(items, weeks):
    if not weeks:
        return []
    buckets = [[] for _ in weeks]
    if not items:
        return buckets
    for index, item in enumerate(items):
        bucket_index = min((index * len(weeks)) // len(items), len(weeks) - 1)
        buckets[bucket_index].append(item)
    return buckets


def _lms_module_summary(item):
    return {
        "name": _text(item.get("Module/Course") or item.get("Course")) or "Not available",
        "course_id": item.get("Course ID"),
        "status": item.get("Course Status") or item.get("Latest Quiz Status"),
        "progress_percent": _number(item.get("Progress (%)")),
        "components_total": _integer(item.get("Components Total")),
        "components_completed": _integer(item.get("Components Completed")),
        "materials_completed": _integer(item.get("Materials Completed")),
        "quizzes_attempted": _integer(item.get("Quizzes Attempted") or item.get("Quiz Attempts Count")),
    }


def _lms_components_or_lecture_summaries(item):
    values = []
    completed_titles = _text(item.get("Completed Material Titles"))
    if completed_titles:
        values.extend(title.strip() for title in completed_titles.split("|") if title.strip())
    latest_quiz = _text(item.get("Latest Quiz Title"))
    if latest_quiz:
        values.append(latest_quiz)
    seen = set()
    result = []
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def _summary_from_lms_items(lms_items):
    if not lms_items:
        return None
    progress_values = [_number(item["raw"].get("Progress (%)")) for item in lms_items if _number(item["raw"].get("Progress (%)")) is not None]
    tracked_values = [item.get("tracked_seconds") for item in lms_items if item.get("tracked_seconds") is not None]
    return {
        "lms_progress": round(sum(progress_values) / len(progress_values), 2) if progress_values else None,
        "tracked_seconds": max(tracked_values) if tracked_values else None,
    }


def _summary_from_quiz_items(lms_items):
    attempts = [item.get("quiz_attempts") for item in lms_items if item.get("quiz_attempts") is not None]
    return {"quiz_attempts": sum(attempts)} if attempts else None


def _sum_unique_planned_hours(aptem_items, until_month=None, only_month=None):
    seen = set()
    total = decimal.Decimal("0")
    for item in aptem_items:
        planned = item.get("planned_hours")
        if planned is None:
            continue
        month = _month_key(item.get("relevant_date"))
        if only_month and month != only_month:
            continue
        if until_month and (not month or month > until_month):
            continue
        key = (item.get("source_id"), item.get("activity_name"), item.get("start_date"), item.get("end_date"))
        if key in seen:
            continue
        seen.add(key)
        total += decimal.Decimal(str(planned))
    return float(total)


def _group_months(aptem_items, lms_items, today=None):
    today = today or _today()
    month_map = {}

    def ensure_month(key):
        if key not in month_map:
            month_map[key] = {
                "month_key": key,
                "label": _month_label(key),
                "summary": {
                    "actual_hours": 0,
                    "planned_hours": 0,
                    "aptem_items": 0,
                    "lms_items": 0,
                    "completed": 0,
                    "in_progress": 0,
                    "not_started": 0,
                    "warnings": 0,
                },
                "weeks": [],
                "undated_items": [],
                "signoffs": {"learner": None, "coach": None},
            }
        return month_map[key]

    week_maps = defaultdict(dict)
    all_items = [(item, "aptem_items") for item in aptem_items] + [(item, "lms_items") for item in lms_items]
    for item, list_key in all_items:
        relevant = item.get("relevant_date")
        if _is_future_date(relevant, today):
            continue
        month = _month_key(relevant)
        if not month:
            ensure_month("undated")["undated_items"].append(item)
            continue
        month_entry = ensure_month(month)
        week_parts = _week_key(relevant)
        if not week_parts:
            month_entry["undated_items"].append(item)
            continue
        week_key, start, end, label = week_parts
        if week_key not in week_maps[month]:
            week_maps[month][week_key] = {
                "week_key": week_key,
                "label": label,
                "start_date": start,
                "end_date": end,
                "aptem_items": [],
                "lms_items": [],
            }
        week_maps[month][week_key][list_key].append(item)

    for key, month in month_map.items():
        if key != "undated":
            month["weeks"] = sorted(week_maps[key].values(), key=lambda week: week["week_key"])
        month_aptem = [item for week in month["weeks"] for item in week["aptem_items"]]
        month_lms = [item for week in month["weeks"] for item in week["lms_items"]]
        for item in month["undated_items"]:
            (month_aptem if item.get("source") == "Aptem" else month_lms).append(item)
        statuses = [_status_bucket(item.get("status") or item.get("completion_status")) for item in month_aptem + month_lms]
        month["summary"] = {
            "actual_hours": _round_hours(sum(item.get("actual_hours") or 0 for item in month_aptem)),
            "planned_hours": _round_hours(_sum_unique_planned_hours(month_aptem, only_month=None)),
            "aptem_items": len(month_aptem),
            "lms_items": len(month_lms),
            "completed": statuses.count("completed"),
            "in_progress": statuses.count("in_progress"),
            "not_started": statuses.count("not_started"),
            "warnings": sum(len(item.get("warnings") or []) for item in month_aptem + month_lms),
        }
    return sorted(month_map.values(), key=lambda month: month["month_key"], reverse=True)


def _round_hours(value):
    return float(decimal.Decimal(str(value)).quantize(decimal.Decimal("0.01")))


def _apply_monthly_planned_totals(payload):
    aptem_items = [
        item
        for month in payload["months"]
        for week in month["weeks"]
        for item in week["aptem_items"]
    ] + [
        item
        for month in payload["months"]
        for item in month["undated_items"]
        if item.get("source") == "Aptem"
    ]
    for month in payload["months"]:
        if month["month_key"] == "undated":
            continue
        month["summary"]["planned_hours"] = _round_hours(_sum_unique_planned_hours(aptem_items, only_month=month["month_key"]))
    if payload["months"]:
        first_month = payload["months"][0]["month_key"]
        payload["summary"]["planned_hours_month"] = _round_hours(_sum_unique_planned_hours(aptem_items, only_month=first_month)) if first_month != "undated" else None
        payload["summary"]["planned_hours_to_date"] = _round_hours(_sum_unique_planned_hours(aptem_items, until_month=first_month)) if first_month != "undated" else None


def _dedupe_warnings(warnings):
    seen = set()
    result = []
    for warning in warnings:
        key = (warning.get("code"), warning.get("path"), warning.get("message"))
        if key in seen:
            continue
        seen.add(key)
        result.append(warning)
    return result


def _snapshot_hash(payload):
    snapshot = {
        "learner": payload["learner"],
        "summary": payload["summary"],
        "months": [
            {key: value for key, value in month.items() if key != "signoffs"}
            for month in payload["months"]
        ],
        "warnings": payload["warnings"],
        "audit_version": AUDIT_VERSION,
    }
    encoded = json.dumps(snapshot, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _empty_signoffs_by_month(months):
    return {month["month_key"]: {"learner": None, "coach": None} for month in months}


def _field_sources():
    return {
        "learner.id": {"table": "Audit.Aptem_LMS_matching", "column": "Learner_ID", "join_key": "primary row", "fallback": None},
        "learner.name": {"table": "Audit.Aptem_LMS_matching", "column": "Learner_name", "join_key": "primary row", "fallback": None},
        "learner.programme_name": {"table": "Audit.Aptem_LMS_matching", "column": "Programme_name", "join_key": "primary row", "fallback": None},
        "learner.programme_start_date": {"table": None, "column": None, "join_key": None, "fallback": None},
        "learner.employer": {"table": None, "column": None, "join_key": None, "fallback": None},
        "learner.epa": {"table": None, "column": None, "join_key": None, "fallback": None},
        "learner.epao": {"table": None, "column": None, "join_key": None, "fallback": None},
        "summary.completed_otjh": {"table": "Audit.Aptem_LMS_matching", "column": "Completed_OTJH", "join_key": "primary row", "fallback": None},
        "summary.approved_hours": {"table": None, "column": None, "join_key": None, "fallback": None},
        "summary.ksb_progression": {"table": None, "column": None, "join_key": None, "fallback": None},
        "summary.planned_hours": {"table": "Audit.Aptem_LMS_matching", "column": "Aptem_components.components[].planned_hours", "join_key": "Learner_ID", "fallback": None},
        "summary.lms": {"table": "Audit.Aptem_LMS_matching", "column": "LMS_modules_details", "join_key": "Learner_ID", "fallback": None},
        "summary.quiz": {"table": "Audit.Aptem_LMS_matching", "column": "LMS_modules_details", "join_key": "Learner_ID", "fallback": None},
        "source_data.combined": {"table": "Audit.Aptem_LMS_matching", "column": STUDENT_SOURCE_DATA_COLUMN, "join_key": "Learner_ID", "fallback": None},
        "company.logo": {"table": "environment", "column": "AUDIT_COMPANY_LOGO_URL", "join_key": None, "fallback": None},
    }


def learner_audit(request, learner_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f'select * from "{AUDIT_SCHEMA}"."{MAIN_TABLE}" where "Learner_ID" = %s',
                [learner_id],
            )
            rows = _rows_from_cursor(cur)
            if not rows:
                return _error("Learner audit record was not found.", 404)
            payload = _build_audit_payload(rows[0])
            _attach_signoffs(cur, payload)
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse(payload)


def _learner_summary(row):
    warnings = []
    aptem_components = _aptem_components(row, warnings)
    component_count = len(aptem_components)
    lms_items = _lms_items(row, warnings)
    return {
        "learnerId": str(row.get("Learner_ID") or ""),
        "fullName": row.get("Learner_name") or "",
        "programName": row.get("Programme_name") or "",
        "completedOtjh": row.get("Completed_OTJH"),
        "aptemComponentCount": component_count if aptem_components else None,
        "hasAptemData": bool(aptem_components),
        "hasLmsData": bool(lms_items) or bool(_text(row.get("LMS_Summary"))),
        "warnings": _dedupe_warnings(warnings),
    }


def _learner_list_summary(row):
    return {
        "learnerId": str(row.get("Learner_ID") or ""),
        "fullName": row.get("Learner_name") or "",
        "programName": row.get("Programme_name") or "",
        "completedOtjh": row.get("Completed_OTJH"),
        "aptemComponentCount": row.get("aptem_component_count"),
        "hasAptemData": bool(row.get("has_aptem_data")),
        "hasLmsData": bool(row.get("has_lms_data")),
        "warnings": [],
    }


def learner_audit_list(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    search = (request.GET.get("search") or "").strip()
    include_test = (request.GET.get("includeTest") or request.GET.get("include_test") or "").strip().lower() in {"1", "true", "yes"}
    limit_raw = (request.GET.get("limit") or "").strip()
    limit = None
    if limit_raw:
        try:
            limit = max(1, int(limit_raw))
        except ValueError:
            limit = None

    try:
        with connections["enrolment"].cursor() as cur:
            list_columns_sql = f"""
                "Learner_ID",
                "Learner_name",
                "Programme_name",
                "Completed_OTJH",
                case
                    when "Aptem_components" is null then null
                    when jsonb_typeof("Aptem_components"::jsonb) = 'object'
                        and jsonb_typeof(("Aptem_components"::jsonb)->'components') = 'array'
                        then jsonb_array_length(("Aptem_components"::jsonb)->'components')
                    when jsonb_typeof("Aptem_components"::jsonb) = 'array'
                        then jsonb_array_length("Aptem_components"::jsonb)
                    else null
                end as aptem_component_count,
                "Aptem_components" is not null as has_aptem_data,
                (
                    nullif("LMS_modules_details", '') is not null
                    or nullif("LMS_Summary", '') is not null
                ) as has_lms_data
            """
            if search:
                pattern = f"%{search}%"
                test_filter_sql = "" if include_test else f"and {TEST_RECORD_FILTER_SQL}"
                cur.execute(
                    f"""
                    select {list_columns_sql}
                    from "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                    where (
                        "Learner_ID"::text ilike %s
                        or coalesce("Learner_name", '') ilike %s
                        or coalesce("Programme_name", '') ilike %s
                    )
                    {test_filter_sql}
                    order by coalesce("Learner_name", ''), "Learner_ID"
                    {f"limit {limit}" if limit else ""}
                    """,
                    [pattern, pattern, pattern],
                )
            else:
                test_filter_sql = "" if include_test else f"where {TEST_RECORD_FILTER_SQL}"
                cur.execute(
                    f"""
                    select {list_columns_sql}
                    from "{AUDIT_SCHEMA}"."{MAIN_TABLE}"
                    {test_filter_sql}
                    order by coalesce("Learner_name", ''), "Learner_ID"
                    {f"limit {limit}" if limit else ""}
                    """,
                )
            rows = _rows_from_cursor(cur)
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"count": len(rows), "results": [_learner_list_summary(row) for row in rows]})


def _azure_service_client():
    if BlobServiceClient is None:
        raise RuntimeError("The azure-storage-blob package is not installed.")
    connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
    if not connection_string:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING is not configured.")
    return BlobServiceClient.from_connection_string(connection_string)


def _azure_connection_parts():
    connection_string = os.environ.get("AZURE_STORAGE_CONNECTION_STRING", "").strip()
    parts = {}
    for chunk in connection_string.split(";"):
        if "=" in chunk:
            key, value = chunk.split("=", 1)
            parts[key] = value
    return parts


def _blob_client_with_fallback(service, container, blob_name):
    client = service.get_blob_client(container=container, blob=blob_name)
    try:
        client.get_blob_properties()
        return client
    except Exception as exc:
        fallback_container = f"{container}s" if not container.endswith("s") else ""
        if not fallback_container or "ContainerNotFound" not in str(exc):
            raise
        fallback_client = service.get_blob_client(container=fallback_container, blob=blob_name)
        fallback_client.get_blob_properties()
        return fallback_client


def _signed_blob_url(client):
    parts = _azure_connection_parts()
    connection_sas = (parts.get("SharedAccessSignature") or "").lstrip("?")
    if connection_sas:
        separator = "&" if "?" in client.url else "?"
        return f"{client.url}{separator}{connection_sas}"

    account_name = parts.get("AccountName") or getattr(client, "account_name", "")
    account_key = parts.get("AccountKey")
    if not account_name or not account_key or generate_blob_sas is None or BlobSasPermissions is None:
        return client.url

    token = generate_blob_sas(
        account_name=account_name,
        container_name=client.container_name,
        blob_name=client.blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=30),
    )
    return f"{client.url}?{token}"


def audit_blob(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if not _has_audit_permission(request):
        return _error("Authentication or audit permission is required.", 403)

    container = (request.GET.get("container") or "").strip()
    blob_name = unquote((request.GET.get("blob") or "").strip())
    if not container or not blob_name:
        return _error("Missing Azure container or blob.", 400)

    try:
        service = _azure_service_client()
        client = _blob_client_with_fallback(service, container, blob_name)
        return HttpResponseRedirect(_signed_blob_url(client))
    except RuntimeError as exc:
        return _error(str(exc), 503)
    except Exception as exc:
        return _error(f"Azure blob error: {exc}", 502)


def _ensure_signoff_table(cur):
    cur.execute(
        f"""
        create table if not exists "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}" (
            id bigserial primary key,
            learner_id text not null,
            programme_key text not null,
            report_month text not null,
            signer_role text not null check (signer_role in ('learner', 'coach')),
            signer_name text,
            review_confirmed boolean default false,
            signature_data text,
            signed_at timestamp with time zone,
            snapshot_hash text,
            audit_version text,
            created_at timestamp with time zone default now(),
            updated_at timestamp with time zone default now(),
            unique (learner_id, programme_key, report_month, signer_role)
        )
        """
    )


def _signoff_row(row, current_hash):
    if not row:
        return None
    stale = bool(row.get("snapshot_hash") and row.get("snapshot_hash") != current_hash)
    return {
        "id": row.get("id"),
        "signer_role": row.get("signer_role"),
        "signer_name": row.get("signer_name") or "",
        "review_confirmed": bool(row.get("review_confirmed")),
        "signature_data": row.get("signature_data") or "",
        "signed_at": row.get("signed_at"),
        "snapshot_hash": row.get("snapshot_hash"),
        "audit_version": row.get("audit_version"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "is_stale": stale,
        "status_message": "Signature requires renewal - audit data changed after sign-off." if stale else "",
    }


def _attach_signoffs(cur, payload):
    _ensure_signoff_table(cur)
    learner_id = str(payload["learner"]["id"] or "")
    programme_key = payload["learner"]["programme_key"]
    month_keys = [month["month_key"] for month in payload["months"]]
    if not month_keys:
        return
    cur.execute(
        f"""
        select *
        from "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}"
        where learner_id = %s and programme_key = %s and report_month = any(%s)
        """,
        [learner_id, programme_key, month_keys],
    )
    rows = _rows_from_cursor(cur)
    by_scope = {(row["report_month"], row["signer_role"]): row for row in rows}
    for month in payload["months"]:
        month["signoffs"] = {
            "learner": _signoff_row(by_scope.get((month["month_key"], "learner")), payload["snapshot_hash"]),
            "coach": _signoff_row(by_scope.get((month["month_key"], "coach")), payload["snapshot_hash"]),
        }
    payload["signoffs"] = {month["month_key"]: month["signoffs"] for month in payload["months"]}


@csrf_exempt
def learner_signoff(request, learner_id):
    if not _has_audit_permission(request, write=request.method != "GET"):
        return _error("Authentication or audit permission is required.", 403)

    month_key = (request.GET.get("month") or "").strip() or "all"
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f'select * from "{AUDIT_SCHEMA}"."{MAIN_TABLE}" where "Learner_ID" = %s',
                [learner_id],
            )
            rows = _rows_from_cursor(cur)
            if not rows:
                return _error("Learner audit record was not found.", 404)
            audit_payload = _build_audit_payload(rows[0])
            programme_key = audit_payload["learner"]["programme_key"]
            snapshot_hash = audit_payload["snapshot_hash"]
            _ensure_signoff_table(cur)

            if request.method == "GET":
                cur.execute(
                    f"""
                    select * from "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}"
                    where learner_id = %s and programme_key = %s and report_month = %s
                    """,
                    [str(learner_id), programme_key, month_key],
                )
                signoffs = {"learner": None, "coach": None}
                for row in _rows_from_cursor(cur):
                    signoffs[row["signer_role"]] = _signoff_row(row, snapshot_hash)
                return JsonResponse({"learnerId": str(learner_id), "month": month_key, "signoffs": signoffs})

            if request.method != "POST":
                return _error("Method not allowed.", 405)

            try:
                payload = json.loads(request.body.decode("utf-8") or "{}")
            except ValueError:
                return _error("Invalid JSON body.", 400)

            report_month = _text(payload.get("monthKey") or month_key or "all")
            roles = payload.get("roles") if isinstance(payload.get("roles"), dict) else {}
            if not roles:
                roles = {
                    "learner": {
                        "signerName": payload.get("learnerSignerName"),
                        "signature": payload.get("learnerSignature"),
                        "confirmed": payload.get("learnerConfirmed"),
                        "signedAt": payload.get("learnerSignedAt"),
                    },
                    "coach": {
                        "signerName": payload.get("coachSignerName"),
                        "signature": payload.get("coachSignature"),
                        "confirmed": payload.get("coachConfirmed"),
                        "signedAt": payload.get("coachSignedAt"),
                    },
                }

            for role in ("learner", "coach"):
                role_payload = roles.get(role) or {}
                cur.execute(
                    f"""
                    insert into "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}" (
                        learner_id, programme_key, report_month, signer_role, signer_name,
                        review_confirmed, signature_data, signed_at, snapshot_hash, audit_version, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    on conflict (learner_id, programme_key, report_month, signer_role) do update set
                        signer_name = excluded.signer_name,
                        review_confirmed = excluded.review_confirmed,
                        signature_data = excluded.signature_data,
                        signed_at = excluded.signed_at,
                        snapshot_hash = excluded.snapshot_hash,
                        audit_version = excluded.audit_version,
                        updated_at = now()
                    """,
                    [
                        str(learner_id),
                        programme_key,
                        report_month,
                        role,
                        _text(role_payload.get("signerName")),
                        bool(role_payload.get("confirmed")),
                        _text(role_payload.get("signature")),
                        role_payload.get("signedAt") or None,
                        snapshot_hash,
                        AUDIT_VERSION,
                    ],
                )

            cur.execute(
                f"""
                select * from "{AUDIT_SCHEMA}"."{SIGNOFF_TABLE}"
                where learner_id = %s and programme_key = %s and report_month = %s
                """,
                [str(learner_id), programme_key, report_month],
            )
            signoffs = {"learner": None, "coach": None}
            for row in _rows_from_cursor(cur):
                signoffs[row["signer_role"]] = _signoff_row(row, snapshot_hash)
            return JsonResponse({"learnerId": str(learner_id), "month": report_month, "signoffs": signoffs})
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
