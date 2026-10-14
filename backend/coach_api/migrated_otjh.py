"""OTJ hours for Aptem continuations; source history is never rewritten.

Unstarted reviews use their effective template. Starting a review freezes its
OTJ settings in template_snapshot. An older started snapshot without OTJ settings
contributes nothing, including after its questions are synchronized.
"""
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from django.db import connections
from django.db.models import Q
from django.utils.dateparse import parse_date, parse_datetime

from learner_api.student_activity_access import student_activity_available
from .migrated_reviews import INITIAL_STATUSES, initial_local_status, programme_key, review_family


def validate_expected_hours(value):
    message = "Expected OTJH must be between 0 and 999999.99 with up to two decimal places."
    if isinstance(value, bool) or value is None:
        raise ValueError(message)
    try:
        hours = Decimal(str(value))
        if not hours.is_finite() or not 0 <= hours <= Decimal("999999.99") or hours != hours.quantize(Decimal("0.01")):
            raise ValueError(message)
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(message) from None
    return hours


def template_settings(template):
    return {"expectedHours": float(getattr(template, "expected_otjh", 0)),
            "countsTowardsOtjh": getattr(template, "counts_towards_otjh", False)}


def settings_hours(settings):
    if not isinstance(settings, dict) or settings.get("countsTowardsOtjh") is not True:
        return 0.0
    return float(validate_expected_hours(settings.get("expectedHours")))


def preserve_otjh(previous, latest):
    """Question synchronization must not change a started review's hours."""
    if "otjh" in previous:
        latest["otjh"] = previous["otjh"]
    else:
        latest.pop("otjh", None)
    return latest


def owner_from_profile(profile):
    return {key: getattr(profile, key, None) for key in
            ("id", "aptem_id", "programme_id", "programme", "start_date", "end_date")}


def business_date(value):
    if isinstance(value, datetime):
        return value.astimezone(ZoneInfo("Europe/London")).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    return business_date(parse_datetime(text)) if "T" in text or " " in text else parse_date(text)


def _source_rows(profile_ids):
    # LearnerProfile and its imported reviews share the enrolment database.
    with connections["enrolment"].cursor() as cursor:
        placeholders = ",".join(["%s"] * len(profile_ids))
        cursor.execute(f'''SELECT id, learner_id, review_type, status,
            planned_scheduled_date, completed_date FROM "Learner".reviews
            WHERE learner_id IN ({placeholders})''', profile_ids)
        names = [column[0] for column in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]


def review_rows_bulk(owners):
    """Bounded reads keyed by verified profile IDs, never enrolment/Aptem IDs."""
    from .models import ImportedReviewInstance, MigratedReviewTemplate

    owners = {int(owner["id"]): owner for owner in owners
              if owner.get("id") and student_activity_available(owner.get("aptem_id"))}
    result = {profile_id: [] for profile_id in owners}
    if not owners:
        return result
    keys = {programme_key(owner.get("programme_id"), owner.get("programme")) for owner in owners.values()}
    templates = list(MigratedReviewTemplate.objects.filter(is_active=True).filter(
        Q(scope="GLOBAL") | Q(scope="PROGRAMME", programme_key__in=[key for key in keys if key])
    ).only("id", "scope", "programme_key", "review_family", "name", "expected_otjh", "counts_towards_otjh"))
    by_slot = {(row.programme_key if row.scope == "PROGRAMME" else None, row.review_family): row for row in templates}
    overlays = {row["source_review_id"]: row for row in ImportedReviewInstance.objects.filter(
        learner_id__in=owners, source_review_id__isnull=False,
    ).values("source_review_id", "learner_id", "status", "completed_at", "migrated_template_id",
             "template_snapshot__otjh", "template_snapshot__name", "template_snapshot__templateSource")}
    # With no opted-in template or saved contribution, no source-table read is needed.
    if not any(row.counts_towards_otjh for row in templates) and not any(
            settings_hours(row["template_snapshot__otjh"]) for row in overlays.values()):
        return result
    for source in _source_rows(list(owners)):
        profile_id = int(source["learner_id"])
        owner = owners.get(profile_id)
        if owner is None:
            continue
        family = review_family(source["review_type"])
        # Historical Aptem completions already belong to the retained ledger.
        if not family or source.get("completed_date") or not initial_local_status(source["status"]):
            continue
        overlay = overlays.get(source["id"])
        if overlay and overlay["learner_id"] != profile_id:
            raise ValueError("The imported Review hours have a conflicting learner association.")
        status = overlay["status"] if overlay else initial_local_status(source["status"])
        key = programme_key(owner.get("programme_id"), owner.get("programme"))
        if status in INITIAL_STATUSES:
            template = by_slot.get((key, family)) or by_slot.get((None, family))
            hours = settings_hours(template_settings(template)) if template else 0
            template_id, name = (template.pk, template.name) if template else (None, "")
        else:
            hours = settings_hours(overlay["template_snapshot__otjh"])
            template_id, name = overlay["migrated_template_id"], overlay["template_snapshot__name"]
            saved_source = overlay["template_snapshot__templateSource"] or {}
            if hours and (saved_source.get("family") != family or saved_source.get("id") != template_id):
                raise ValueError("The imported Review hours have a conflicting template association.")
        if hours <= 0:
            continue
        result[profile_id].append({"sourceReviewId": source["id"], "reviewTemplateId": f"aptem:{template_id}",
            "name": name or source["review_type"], "hoursEach": hours, "status": status,
            "targetDate": business_date(source.get("planned_scheduled_date")),
            "completedDate": business_date(overlay["completed_at"]) if overlay else None})
    return result


def summarize(rows, *, window_start=None, window_end=None):
    start, end = business_date(window_start), business_date(window_end)

    def within(day):
        return (not start or day is not None and day >= start) and (not end or day is not None and day <= end)

    planned = sum(row["hoursEach"] for row in rows if row["targetDate"] and within(row["targetDate"]))
    completed = sum(row["hoursEach"] for row in rows
                    if row["status"] == "completed" and row["completedDate"] and within(row["completedDate"]))
    return {"planned": round(planned, 2), "completed": round(completed, 2)}


def hours_for_profile(profile, *, window_start=None, window_end=None):
    owner = owner_from_profile(profile)
    rows = review_rows_bulk([owner]).get(owner["id"], [])
    return summarize(rows, window_start=window_start, window_end=window_end)


def add_to_metrics(metrics, rows):
    """Add the separate continuation contribution once; unknown totals stay unknown."""
    hours = summarize(rows)
    for field in ("actual", "completed_actual", "new"):
        if metrics["otjh"].get(field) is not None:
            metrics["otjh"][field] = round(metrics["otjh"][field] + hours["completed"], 4)
    if metrics["otjh"].get("planned") is not None:
        metrics["otjh"]["planned"] = round(metrics["otjh"]["planned"] + hours["planned"], 4)
    if metrics.get("aptem_planned_total") is not None:
        metrics["aptem_planned_total"] = round(metrics["aptem_planned_total"] + hours["planned"], 4)
    return metrics


def planned_meetings(owner, *, window_start=None, window_end=None):
    start, end = business_date(window_start), business_date(window_end)
    groups = {}
    for row in review_rows_bulk([owner]).get(owner["id"], []):
        day = row["targetDate"]
        if day is None or start and day < start or end and day > end:
            continue
        # Different frozen rates remain visible rather than averaging history.
        key = (row["reviewTemplateId"], row["hoursEach"])
        group = groups.setdefault(key, {"reviewTemplateId": row["reviewTemplateId"], "name": row["name"],
            "hoursEach": row["hoursEach"], "occurrences": 0, "hours": 0, "recurrenceLabel": "Imported review dates",
            "startDate": day.isoformat(), "endDate": day.isoformat()})
        group["occurrences"] += 1
        group["hours"] = round(group["hours"] + row["hoursEach"], 2)
        group["startDate"] = min(group["startDate"], day.isoformat())
        group["endDate"] = max(group["endDate"], day.isoformat())
    return list(groups.values())
