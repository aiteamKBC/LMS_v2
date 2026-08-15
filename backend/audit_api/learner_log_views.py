from django.db import DatabaseError, connections
from django.db.models import Count, Q, Sum
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

from .db_source import resolve
from .learner_log_models import MreActivity

LEARNER_FIELDS = {
    "ibrahim": {
        "name": "Ibrahim",
        "hours": "ibrahim_actual_lms_hours",
        "date": "ibrahim_activity_date",
        "timestamp": "ibrahim_time_stamp_from_to",
    },
    "aya": {
        "name": "Aya",
        "hours": "aya_actual_lms_hours",
        "date": "aya_activity_date",
        "timestamp": "aya_time_stamp_from_to",
    },
    "huda": {
        "name": "Huda",
        "hours": "huda_actual_lms_hours",
        "date": "huda_activity_date",
        "timestamp": "huda_time_stamp_from_to",
    },
}


def _integer_param(
    request: HttpRequest,
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = request.GET.get(name)
    if raw_value is None:
        return default
    value = int(raw_value)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _month_numbers_for_period(period: str) -> list[int]:
    if not period:
        return []
    year, month = (int(value) for value in period.split("-"))
    if not 1 <= month <= 12:
        raise ValueError("period month must be between 01 and 12")
    return list(
        MreActivity.objects.filter(activity_date__year=year, activity_date__month=month)
        .values_list("month_no", flat=True)
        .distinct()
    )


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    alias = resolve("audit")
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT current_database(), now()")
        database, timestamp = cursor.fetchone()
    return JsonResponse({"ok": True, "database": database, "time": timestamp})


@require_GET
def mre_list(request: HttpRequest) -> JsonResponse:
    try:
        limit = _integer_param(request, "limit", 25, 1, 100)
        offset = _integer_param(request, "offset", 0, 0, 1_000_000)
        search = request.GET.get("search", "").strip()[:100]
        month_raw = request.GET.get("month")
        month = int(month_raw) if month_raw is not None else None
        if month is not None and not 1 <= month <= 60:
            raise ValueError("month must be between 1 and 60")
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": "Invalid query parameters", "details": str(error)}, status=400)

    queryset = MreActivity.objects.all()
    if search:
        queryset = queryset.filter(
            Q(plan_id__icontains=search)
            | Q(activity_unit__icontains=search)
            | Q(activity_description__icontains=search)
            | Q(activity_category__icontains=search)
        )
    if month is not None:
        queryset = queryset.filter(month_no=month)

    total = queryset.count()
    fields = [
        "plan_id", "month_no", "month_unit", "unit_planned_date",
        "activity_date", "week_sequence", "activity_category", "activity_unit",
        "activity_description", "delivery_method", "planned_hours", "key_ksbs",
        "expected_evidence", "source_course", "source_url", "source_basis",
    ]
    items = list(queryset.values(*fields)[offset : offset + limit])
    for item in items:
        if item["planned_hours"] is not None:
            item["planned_hours"] = float(item["planned_hours"])

    return JsonResponse({"items": items, "total": total, "limit": limit, "offset": offset})


@require_GET
def mre_summary(_request: HttpRequest) -> JsonResponse:
    summary = MreActivity.objects.aggregate(
        activities=Count("plan_id"),
        months=Count("month_no", distinct=True),
        planned_hours=Sum("planned_hours"),
    )
    summary["planned_hours"] = float(summary["planned_hours"] or 0)
    return JsonResponse(summary)


@require_GET
def learner_activities(request: HttpRequest) -> JsonResponse:
    """Turn learner-specific MRE columns into one API row per learner activity."""
    try:
        limit = _integer_param(request, "limit", 25, 1, 100)
        offset = _integer_param(request, "offset", 0, 0, 1_000_000)
        search = request.GET.get("search", "").strip()[:100]
        learner_filter = request.GET.get("learner", "").strip().lower()
        learner_search = request.GET.get("learner_search", "").strip().lower()[:100]
        plan_filter = request.GET.get("plan", "").strip()[:100]
        month_raw = request.GET.get("month")
        month = int(month_raw) if month_raw else None
        category = request.GET.get("category", "").strip()[:100]
        period = request.GET.get("period", "").strip()
        if learner_filter and learner_filter not in LEARNER_FIELDS:
            raise ValueError("Unknown learner")
        if month is not None and not 1 <= month <= 60:
            raise ValueError("month must be between 1 and 60")
        if period and (len(period) != 7 or period[4] != "-" or not period.replace("-", "").isdigit()):
            raise ValueError("period must use YYYY-MM format")
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": "Invalid query parameters", "details": str(error)}, status=400)

    common_fields = [
        "plan_id", "month_no", "month_unit", "unit_planned_date", "activity_date",
        "week_sequence", "activity_category", "activity_unit",
        "activity_description", "delivery_method", "planned_hours", "key_ksbs",
        "expected_evidence", "source_course", "source_url", "source_basis",
    ]
    learner_columns = [
        field
        for learner in LEARNER_FIELDS.values()
        for field in (learner["hours"], learner["date"], learner["timestamp"])
    ]
    try:
        queryset = MreActivity.objects.all()
        if plan_filter:
            queryset = queryset.filter(plan_id=plan_filter)
        if month is not None:
            queryset = queryset.filter(month_no=month)
        if category:
            queryset = queryset.filter(activity_category=category)
        if period:
            queryset = queryset.filter(month_no__in=_month_numbers_for_period(period))
        rows = list(queryset.values(*common_fields, *learner_columns))
    except DatabaseError:
        return JsonResponse(
            {
                "error": (
                    "The configured database does not contain the expected MRE data. "
                    "Set DATABASE_URL to the Neon production branch that contains the mre table."
                )
            },
            status=503,
        )
    result = []
    search_lower = search.lower()
    search_matches_learner = any(
        search_lower in learner["name"].lower()
        for learner in LEARNER_FIELDS.values()
    ) if search_lower else False
    planned_total = 0.0
    period_by_month = {
        row["month_no"]: row["activity_date"].strftime("%Y-%m")
        for row in rows
        if row["activity_date"] is not None
    }

    for row in rows:
        common_search = " ".join(
            str(row.get(field) or "")
            for field in ("plan_id", "month_unit", "activity_category", "activity_unit", "activity_description")
        ).lower()
        if not search_lower or search_matches_learner or search_lower in common_search:
            planned_total += float(row["planned_hours"] or 0)
        for learner_key, learner in LEARNER_FIELDS.items():
            if learner_filter and learner_key != learner_filter:
                continue
            if learner_search and learner_search not in learner["name"].lower():
                continue
            hours = row[learner["hours"]]
            learner_activity_date = row[learner["date"]]
            timestamp = row[learner["timestamp"]]
            if hours is None and learner_activity_date is None and not timestamp:
                continue
            activity_date = row["activity_date"]
            if search_lower and search_lower not in common_search and search_lower not in learner["name"].lower():
                continue

            result.append({
                "id": f"{row['plan_id']}-{learner_key}",
                "mre_id": row["plan_id"],
                "learner": learner["name"],
                "plan_id": row["plan_id"],
                "month_no": row["month_no"],
                "month_unit": row["month_unit"],
                "unit_planned_date": row["unit_planned_date"],
                "activity_date": activity_date,
                "learner_activity_date": learner_activity_date,
                "activity_period": period_by_month.get(row["month_no"]),
                "time_from_to": timestamp,
                "actual_lms_hours": float(hours) if hours is not None else None,
                "week_sequence": row["week_sequence"],
                "activity_category": row["activity_category"],
                "activity_unit": row["activity_unit"],
                "activity_description": row["activity_description"],
                "delivery_method": row["delivery_method"],
                "planned_hours": float(row["planned_hours"]) if row["planned_hours"] is not None else None,
                "key_ksbs": row["key_ksbs"],
                "expected_evidence": row["expected_evidence"],
                "source_course": row["source_course"],
                "source_url": row["source_url"],
                "source_basis": row["source_basis"],
            })

    result.sort(key=lambda item: (item["activity_date"] is None, item["activity_date"] or item["unit_planned_date"], item["learner"]))
    total = len(result)
    actual_total = sum(float(item["actual_lms_hours"] or 0) for item in result)
    return JsonResponse({
        "items": result[offset : offset + limit],
        "total": total,
        "planned_total": round(planned_total, 2),
        "actual_total": round(actual_total, 2),
        "limit": limit,
        "offset": offset,
    })


@require_GET
def learner_summaries(request: HttpRequest) -> JsonResponse:
    """Return real per-learner totals calculated from the wide Audit.mre table."""
    try:
        month_raw = request.GET.get("month")
        month = int(month_raw) if month_raw else None
        period = request.GET.get("period", "").strip()
        learner_search = request.GET.get("search", "").strip().lower()[:100]
        position = request.GET.get("position", "").strip().lower()
        if month is not None and not 1 <= month <= 60:
            raise ValueError("month must be between 1 and 60")
        if period and (len(period) != 7 or period[4] != "-" or not period.replace("-", "").isdigit()):
            raise ValueError("period must use YYYY-MM format")
        if position not in ("", "behind", "ahead"):
            raise ValueError("position must be behind or ahead")
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": "Invalid query parameters", "details": str(error)}, status=400)

    fields = [
        "month_no", "month_unit", "activity_date", "activity_category", "planned_hours",
        *[
            field
            for learner in LEARNER_FIELDS.values()
            for field in (learner["hours"], learner["date"], learner["timestamp"])
        ],
    ]
    queryset = MreActivity.objects.all()
    if month is not None:
        queryset = queryset.filter(month_no=month)
    try:
        if period:
            queryset = queryset.filter(month_no__in=_month_numbers_for_period(period))
        rows = list(queryset.values(*fields))
        all_rows = list(MreActivity.objects.values(
            "plan_id", "activity_unit", "month_no", "month_unit", "activity_date", "activity_category"
        ))
    except DatabaseError:
        return JsonResponse(
            {"error": "The configured database does not contain the Audit.mre table."},
            status=503,
        )

    planned_total = sum(float(row["planned_hours"] or 0) for row in rows)
    learners = []
    for learner_key, learner in LEARNER_FIELDS.items():
        entries = []
        for row in rows:
            hours = row[learner["hours"]]
            activity_date = row[learner["date"]]
            timestamp = row[learner["timestamp"]]
            if hours is not None or activity_date is not None or timestamp:
                entries.append(row)
        actual = sum(float(row[learner["hours"]] or 0) for row in entries)
        dates = [row[learner["date"]] for row in entries if row[learner["date"]] is not None]
        learners.append({
            "id": learner_key,
            "name": learner["name"],
            "entries": len(entries),
            "planned_hours": round(planned_total, 2),
            "actual_hours": round(actual, 2),
            "gap_hours": round(actual - planned_total, 2),
            "last_activity_date": max(dates) if dates else None,
        })

    if learner_search:
        learners = [learner for learner in learners if learner_search in learner["name"].lower()]
    if position == "behind":
        learners = [learner for learner in learners if learner["gap_hours"] < 0]
    elif position == "ahead":
        learners = [learner for learner in learners if learner["gap_hours"] >= 0]

    months = sorted(
        {(row["month_no"], row["month_unit"]) for row in all_rows},
        key=lambda item: item[0],
    )
    categories = sorted({row["activity_category"] for row in all_rows if row["activity_category"]})
    activities = sorted(
        {
            (row["plan_id"], row["activity_unit"])
            for row in all_rows
            if row["plan_id"] and row["activity_unit"]
        },
        key=lambda item: (item[1].lower(), item[0]),
    )
    period_values = sorted({row["activity_date"].strftime("%Y-%m") for row in all_rows if row["activity_date"]})
    return JsonResponse({
        "learners": learners,
        "months": [{"number": number, "label": label} for number, label in months],
        "categories": categories,
        "activities": [{"value": plan_id, "label": label} for plan_id, label in activities],
        "periods": [
            {
                "value": value,
                "label": __import__("datetime").datetime.strptime(value, "%Y-%m").strftime("%B %Y"),
            }
            for value in period_values
        ],
    })
