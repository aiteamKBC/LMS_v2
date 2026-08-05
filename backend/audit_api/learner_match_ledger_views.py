"""Ledger endpoints for the REAL (auditor-copy) workspace.

These power the copy of the Learner Log Pro app (``/workspace/auditor-copy``).
Unlike ``learner_log_views`` — which reads the wide ``Audit.mre`` table — these
views read a single JSON column: ``Audit.learner_match.programme_structure``.

Only the learners on the exact programme ``Level 6 Project Controls Professional``
are served (6 rows at the time of writing). Each of those rows stores a
``programme_structure`` JSON of the shape::

    {
      "programme": "Level 6 Project Controls Professional",
      "months": [
        {
          "month": "October 2024",
          "date": "2024-10-01",
          "hours": {"planned": 24.0, "completed": 51.32},
          "LMS activities": [ {component_id, title, component_kind, material_type,
                               started_at, completed_at, time_spent_seconds,
                               configured_duration_seconds, preview_url, ...}, ... ],
          "attendance": [ {key, date, module, attended, planned_hours, actual_hours}, ... ],
          "assignment": [ {name, status, due_date, completed_date,
                           planned_hours, actual_hours, assignment_id}, ... ]
        }, ...
      ]
    }

The views flatten that per-month shape into the SAME response contract the copy
UI already consumes (see ``learner-log-pro-copy/lib/api.ts``): a learner-summary
list and a paginated activity list. That way the UI components stay unchanged.

Note: ``Audit.learner_match`` lives on the ``enrolment`` Neon database (same as
``learner_api``), so every query here uses ``connections["enrolment"]`` — this
mirrors how ``audit_api/views.py`` reaches the same table.
"""

import datetime
import json
import re
import time

from django.db import DatabaseError, connections
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


# The one programme these endpoints serve. Kept as an exact match (not a
# substring/ILIKE) so cohort variants like "... PCP - May 25" are excluded.
PROGRAMME_NAME = "Level 6 Project Controls Professional"

# Audit.learner_match is stored on the enrolment database branch.
CONN = "enrolment"


# --- small parsing helpers -------------------------------------------------

def _to_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _iso_date(value):
    """Pull a ``YYYY-MM-DD`` string out of the many timestamp formats used in
    the JSON (``2024-11-17 19:04:59``, ``2024-10-01T00:00:00+01:00``,
    ``2024-10-01``). Returns None when nothing date-like is present."""
    if not value:
        return None
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(value))
    return match.group(0) if match else None


def _period_of(iso_date):
    return iso_date[:7] if iso_date else None


def _integer_param(request, name, default, minimum, maximum):
    raw = request.GET.get(name)
    if raw is None or raw == "":
        return default
    value = int(raw)
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


def _lms_category(activity):
    """Human-facing category for an LMS activity row. Quizzes have no
    material_type, so fall back to the component kind."""
    material = (activity.get("material_type") or "").strip()
    if material:
        return material
    kind = (activity.get("component_kind") or "").strip()
    return kind or "lesson"


# --- shape mapping ---------------------------------------------------------

def _activities_for_row(aptem_id, learner_name, structure):
    """Flatten one learner's programme_structure into activity dicts matching
    the copy UI's ``LearnerActivity`` type (minus the removed KSB / evidence /
    week_sequence fields)."""
    activities = []
    months = structure.get("months") if isinstance(structure, dict) else None
    if not isinstance(months, list):
        return activities

    for month_index, month in enumerate(months):
        if not isinstance(month, dict):
            continue
        month_no = month_index + 1
        month_unit = month.get("month") or ""
        month_date = _iso_date(month.get("date"))
        planned_month_period = _period_of(month_date)

        # 1) LMS activities (videos, pdfs, quizzes, live lessons, ...)
        for index, item in enumerate(month.get("LMS activities") or []):
            if not isinstance(item, dict):
                continue
            component_id = item.get("component_id")
            activity_date = _iso_date(item.get("completed_at")) or _iso_date(item.get("started_at"))
            # An activity's "period" is the month it actually happened; if it was
            # never started, bucket it under its planned month.
            month_period = _period_of(activity_date) or planned_month_period
            seconds = item.get("time_spent_seconds")
            actual_hours = round(seconds / 3600, 2) if isinstance(seconds, (int, float)) and seconds else None
            planned_seconds = item.get("configured_duration_seconds")
            planned_hours = round(planned_seconds / 3600, 2) if isinstance(planned_seconds, (int, float)) and planned_seconds else None
            activities.append({
                "id": f"{aptem_id}:{month_no}:lms:{component_id}:{index}",
                "mre_id": str(component_id) if component_id is not None else "",
                "learner": learner_name,
                "plan_id": str(component_id) if component_id is not None else "",
                "month_no": month_no,
                "month_unit": month_unit,
                "unit_planned_date": month_date,
                "activity_date": activity_date,
                "learner_activity_date": activity_date,
                "activity_period": month_period,
                "time_from_to": item.get("time_spent_formatted") or None,
                "actual_lms_hours": actual_hours,
                "activity_category": _lms_category(item),
                "activity_unit": item.get("title") or "Untitled activity",
                "activity_description": None,
                "delivery_method": item.get("component_kind") or "",
                "planned_hours": planned_hours,
                "source_course": None,
                "source_url": item.get("preview_url") or None,
                "source_basis": item.get("post_type") or None,
                "created_at": item.get("created_at") or None,
                "configured_duration": item.get("configured_duration") or None,
                "done": bool(item.get("completed")),
            })

        # 2) Assignments
        for index, item in enumerate(month.get("assignment") or []):
            if not isinstance(item, dict):
                continue
            # Real completion date drives "when it happened"; a due date only
            # helps place an un-submitted assignment into a month bucket.
            activity_date = _iso_date(item.get("completed_date"))
            month_period = _period_of(activity_date) or _period_of(item.get("due_date")) or planned_month_period
            activities.append({
                "id": f"{aptem_id}:{month_no}:asg:{item.get('assignment_id')}:{index}",
                "mre_id": str(item.get("assignment_id") or ""),
                "learner": learner_name,
                "plan_id": str(item.get("assignment_id") or ""),
                "month_no": month_no,
                "month_unit": month_unit,
                "unit_planned_date": month_date,
                "activity_date": activity_date,
                "learner_activity_date": activity_date,
                "activity_period": month_period,
                "time_from_to": None,
                "actual_lms_hours": _to_float(item.get("actual_hours")),
                "activity_category": "assignment",
                "activity_unit": item.get("name") or "Assignment",
                "activity_description": item.get("status") or None,
                "delivery_method": "assignment",
                "planned_hours": _to_float(item.get("planned_hours")),
                "source_course": None,
                "source_url": None,
                "source_basis": "assignment",
                "created_at": None,
                "configured_duration": None,
                "done": (item.get("status") or "").lower() == "completed",
            })

        # 3) Attendance (live sessions)
        for index, item in enumerate(month.get("attendance") or []):
            if not isinstance(item, dict):
                continue
            activity_date = _iso_date(item.get("date"))
            month_period = _period_of(activity_date) or planned_month_period
            attended = item.get("attended")
            activities.append({
                "id": f"{aptem_id}:{month_no}:att:{item.get('key')}:{index}",
                "mre_id": str(item.get("key") or ""),
                "learner": learner_name,
                "plan_id": str(item.get("key") or ""),
                "month_no": month_no,
                "month_unit": month_unit,
                "unit_planned_date": month_date,
                "activity_date": activity_date,
                "learner_activity_date": activity_date,
                "activity_period": month_period,
                "time_from_to": None,
                "actual_lms_hours": _to_float(item.get("actual_hours")),
                "activity_category": "attendance",
                "activity_unit": item.get("module") or "Attendance",
                "activity_description": None,
                "delivery_method": "attendance",
                "planned_hours": _to_float(item.get("planned_hours")),
                "source_course": None,
                "source_url": None,
                "source_basis": "attendance",
                "created_at": None,
                "configured_duration": None,
                "done": bool(attended),
            })

    return activities


def _month_hours_for_row(structure):
    """Map each month's curated ``hours`` block to its period. These are the
    authoritative planned/completed hour totals (the per-activity ``time_spent``
    tracking in the LMS is noisy, so summaries use these instead)."""
    result = {}
    months = structure.get("months") if isinstance(structure, dict) else None
    if not isinstance(months, list):
        return result
    for month in months:
        if not isinstance(month, dict):
            continue
        period = _period_of(_iso_date(month.get("date")))
        hours = month.get("hours") if isinstance(month.get("hours"), dict) else {}
        if not period:
            continue
        result[period] = {
            "planned": _to_float(hours.get("planned")) or 0.0,
            "completed": _to_float(hours.get("completed")) or 0.0,
        }
    return result


# Each programme_structure blob is multi-megabyte (thousands of activities), and
# the UI fires several calls per page. Cache the flattened result briefly so the
# repeated fetch+parse+flatten cost is paid once, not on every request.
_CACHE_TTL_SECONDS = 20
_cache = {"expires_at": 0.0, "rows": None}


def _load_rows():
    now = time.monotonic()
    if _cache["rows"] is not None and now < _cache["expires_at"]:
        return _cache["rows"]
    rows = _fetch_rows()
    _cache["rows"] = rows
    _cache["expires_at"] = now + _CACHE_TTL_SECONDS
    return rows


def _fetch_rows():
    """Fetch the 6 exact-programme learners from Audit.learner_match and return
    one dict per learner: aptem_id, name, flattened activities, and the curated
    per-period hour totals."""
    with connections[CONN].cursor() as cur:
        # The column is `json` (not jsonb). Using `->>` directly (no ::jsonb
        # cast) avoids converting every row's multi-MB blob to jsonb just to
        # read the programme name — roughly halves the query time.
        cur.execute(
            '''
            select aptem_id, learner_name, programme_structure
            from "Audit".learner_match
            where programme_structure ->> 'programme' = %s
            order by learner_name, aptem_id
            ''',
            [PROGRAMME_NAME],
        )
        rows = cur.fetchall()

    learners = []
    for aptem_id, learner_name, structure in rows:
        # psycopg may hand json/jsonb back as a decoded dict or as raw text
        # depending on the configured loaders — normalise to a dict either way.
        if isinstance(structure, str):
            try:
                structure = json.loads(structure)
            except ValueError:
                structure = None
        name = learner_name or f"Learner {aptem_id}"
        learners.append({
            "aptem_id": aptem_id,
            "name": name,
            "activities": _activities_for_row(aptem_id, name, structure),
            "month_hours": _month_hours_for_row(structure),
        })
    return learners


def _learner_id(name):
    """Stable slug used as the learner filter key. Mirrors the original MRE
    app convention (id == lowercased name) so the existing UI links/dropdowns
    keep working without change."""
    return (name or "").strip().lower()


# --- views -----------------------------------------------------------------

@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    alias = CONN if CONN in connections.databases else "default"
    with connections[alias].cursor() as cursor:
        cursor.execute("SELECT current_database(), now()")
        database, timestamp = cursor.fetchone()
    return JsonResponse({"ok": True, "database": database, "time": timestamp})


@require_GET
def learner_summaries(request: HttpRequest) -> JsonResponse:
    """Per-learner totals + the filter option lists (learners/periods/
    categories/months) the copy UI needs. Matches ``getLearners()``."""
    try:
        period = request.GET.get("period", "").strip()
        search = request.GET.get("search", "").strip().lower()[:100]
        position = request.GET.get("position", "").strip().lower()
        if period and (len(period) != 7 or period[4] != "-" or not period.replace("-", "").isdigit()):
            raise ValueError("period must use YYYY-MM format")
        if position not in ("", "behind", "ahead"):
            raise ValueError("position must be behind or ahead")
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": "Invalid query parameters", "details": str(error)}, status=400)

    try:
        learners_raw = _load_rows()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Audit.learner_match from the enrolment database.", "details": str(error)},
            status=503,
        )

    # Only surface months up to the current one, and only those where real
    # activity happened — so the dropdown never defaults to empty future
    # scaffolding (the structure is planned out to 2028).
    current_period = datetime.date.today().strftime("%Y-%m")
    period_values = set()
    categories = set()
    month_labels = {}
    for learner in learners_raw:
        for activity in learner["activities"]:
            if activity["activity_category"]:
                categories.add(activity["activity_category"])
            bucket = activity["activity_period"]
            if bucket and activity["activity_date"] and bucket <= current_period:
                period_values.add(bucket)
                month_labels[bucket] = activity["month_unit"] or bucket

    summaries = []
    for learner in learners_raw:
        month_hours = learner["month_hours"]
        if period:
            entry_hours = month_hours.get(period, {"planned": 0.0, "completed": 0.0})
            planned = entry_hours["planned"]
            actual = entry_hours["completed"]
            activities = [item for item in learner["activities"] if item["activity_period"] == period]
        else:
            # Cumulative programme totals (all planned months + all completed).
            planned = sum(value["planned"] for value in month_hours.values())
            actual = sum(value["completed"] for value in month_hours.values())
            activities = learner["activities"]
        dates = [
            item["activity_date"] for item in activities
            if item["activity_date"] and item["activity_date"][:7] <= current_period
        ]
        summaries.append({
            "id": _learner_id(learner["name"]),
            "name": learner["name"],
            "entries": len(activities),
            "planned_hours": round(planned, 2),
            "actual_hours": round(actual, 2),
            "gap_hours": round(actual - planned, 2),
            "last_activity_date": max(dates) if dates else None,
        })

    if search:
        summaries = [item for item in summaries if search in item["name"].lower()]
    if position == "behind":
        summaries = [item for item in summaries if item["gap_hours"] < 0]
    elif position == "ahead":
        summaries = [item for item in summaries if item["gap_hours"] >= 0]

    ordered_periods = sorted(period_values)
    return JsonResponse({
        "learners": summaries,
        "months": [
            {"number": index + 1, "label": month_labels[value]}
            for index, value in enumerate(ordered_periods)
        ],
        "categories": sorted(categories),
        "periods": [
            {"value": value, "label": _period_label(value)}
            for value in ordered_periods
        ],
    })


def _period_label(value):
    try:
        return datetime.datetime.strptime(value, "%Y-%m").strftime("%B %Y")
    except ValueError:
        return value


@require_GET
def learner_activities(request: HttpRequest) -> JsonResponse:
    """Paginated, filtered activity rows. Matches ``getLearnerActivities()``."""
    try:
        limit = _integer_param(request, "limit", 25, 1, 200)
        offset = _integer_param(request, "offset", 0, 0, 1_000_000)
        search = request.GET.get("search", "").strip().lower()[:100]
        learner_filter = request.GET.get("learner", "").strip().lower()
        learner_search = request.GET.get("learner_search", "").strip().lower()[:100]
        category = request.GET.get("category", "").strip().lower()
        period = request.GET.get("period", "").strip()
        if period and (len(period) != 7 or period[4] != "-" or not period.replace("-", "").isdigit()):
            raise ValueError("period must use YYYY-MM format")
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": "Invalid query parameters", "details": str(error)}, status=400)

    try:
        learners_raw = _load_rows()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Audit.learner_match from the enrolment database.", "details": str(error)},
            status=503,
        )

    in_scope = []
    for learner in learners_raw:
        learner_id = _learner_id(learner["name"])
        if learner_filter and learner_filter not in (learner_id, str(learner["aptem_id"])):
            continue
        if learner_search and learner_search not in learner["name"].lower():
            continue
        in_scope.append(learner)

    rows = [item for learner in in_scope for item in learner["activities"]]
    if period:
        rows = [item for item in rows if item["activity_period"] == period]
    if category:
        rows = [item for item in rows if (item["activity_category"] or "").lower() == category]
    if search:
        rows = [
            item for item in rows
            if search in (item["activity_unit"] or "").lower()
            or search in (item["plan_id"] or "").lower()
            or search in (item["activity_description"] or "").lower()
            or search in (item["learner"] or "").lower()
        ]

    rows.sort(key=lambda item: (item["activity_date"] is None, item["activity_date"] or "", item["learner"]))

    # Header totals use the curated month.hours (authoritative), not the noisy
    # per-activity tracked time — summed over the in-scope learners / period.
    planned_total = 0.0
    actual_total = 0.0
    for learner in in_scope:
        if period:
            entry = learner["month_hours"].get(period)
            if entry:
                planned_total += entry["planned"]
                actual_total += entry["completed"]
        else:
            planned_total += sum(value["planned"] for value in learner["month_hours"].values())
            actual_total += sum(value["completed"] for value in learner["month_hours"].values())
    planned_total = round(planned_total, 2)
    actual_total = round(actual_total, 2)
    total = len(rows)
    return JsonResponse({
        "items": rows[offset : offset + limit],
        "total": total,
        "planned_total": planned_total,
        "actual_total": actual_total,
        "limit": limit,
        "offset": offset,
    })


@require_GET
def activity_learners(request: HttpRequest) -> JsonResponse:
    """All learners who have a given activity (by component id), each with their
    own log entry on it. Powers the "Learner activity records" table on the
    activity-detail page — a per-activity, cross-learner view. Same response
    shape as ``learner_activities`` so the UI table can consume it unchanged."""
    component = request.GET.get("component", "").strip()
    search = request.GET.get("search", "").strip().lower()[:100]
    if not component:
        return JsonResponse({"items": [], "total": 0, "planned_total": 0.0, "actual_total": 0.0, "limit": 0, "offset": 0})

    try:
        learners_raw = _load_rows()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Audit.learner_match from the enrolment database.", "details": str(error)},
            status=503,
        )

    rows = []
    for learner in learners_raw:
        if search and search not in learner["name"].lower():
            continue
        for item in learner["activities"]:
            if str(item["plan_id"]) == component:
                rows.append(item)

    rows.sort(key=lambda item: (item["actual_lms_hours"] is None, -(item["actual_lms_hours"] or 0), item["learner"]))
    planned_total = round(sum(item["planned_hours"] or 0 for item in rows), 2)
    actual_total = round(sum(item["actual_lms_hours"] or 0 for item in rows), 2)
    return JsonResponse({
        "items": rows,
        "total": len(rows),
        "planned_total": planned_total,
        "actual_total": actual_total,
        "limit": len(rows),
        "offset": 0,
    })


# --- manual auditor annotations (KSBs + planned hours) per activity ---------
#
# programme_structure carries no KSB mapping and no auditor-set planned hours,
# so auditors enter those by hand. They are stored once per activity (keyed by
# component id) in a small table this module owns. The table is created on first
# use with `create table if not exists`, mirroring how audit_api/views.py
# provisions its `monthly_audit_signoffs` table.

def _ensure_annotation_table(cur):
    cur.execute(
        '''
        create table if not exists "Audit".activity_annotations (
            component_id text primary key,
            planned_hours numeric,
            mapped_ksbs text,
            updated_by text,
            updated_at timestamp with time zone default now()
        )
        '''
    )


def _annotation_payload(row):
    if not row:
        return {"planned_hours": None, "mapped_ksbs": None, "updated_by": None, "updated_at": None}
    component_id, planned_hours, mapped_ksbs, updated_by, updated_at = row
    return {
        "component_id": component_id,
        "planned_hours": float(planned_hours) if planned_hours is not None else None,
        "mapped_ksbs": mapped_ksbs,
        "updated_by": updated_by,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


@require_GET
def activity_annotation(request: HttpRequest) -> JsonResponse:
    """Return the auditor-entered KSBs / planned hours for one activity."""
    component = request.GET.get("component", "").strip()
    if not component:
        return JsonResponse({"error": "component is required"}, status=400)
    try:
        with connections[CONN].cursor() as cur:
            _ensure_annotation_table(cur)
            cur.execute(
                '''
                select component_id, planned_hours, mapped_ksbs, updated_by, updated_at
                from "Audit".activity_annotations where component_id = %s
                ''',
                [component],
            )
            row = cur.fetchone()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not read activity annotations.", "details": str(error)}, status=503)
    payload = _annotation_payload(row)
    payload.setdefault("component_id", component)
    return JsonResponse(payload)


@csrf_exempt
def save_activity_annotation(request: HttpRequest) -> JsonResponse:
    """Create/update the auditor-entered KSBs / planned hours for one activity."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        body = json.loads(request.body or b"{}")
    except ValueError:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    component = str(body.get("component_id") or "").strip()
    if not component:
        return JsonResponse({"error": "component_id is required"}, status=400)

    planned_raw = body.get("planned_hours")
    if planned_raw in (None, ""):
        planned_hours = None
    else:
        try:
            planned_hours = float(planned_raw)
        except (TypeError, ValueError):
            return JsonResponse({"error": "planned_hours must be a number"}, status=400)
        if planned_hours < 0 or planned_hours > 100000:
            return JsonResponse({"error": "planned_hours is out of range"}, status=400)

    mapped_ksbs = body.get("mapped_ksbs")
    if mapped_ksbs is not None:
        mapped_ksbs = str(mapped_ksbs).strip()[:5000] or None
    updated_by = str(body.get("updated_by") or "").strip()[:200] or None

    try:
        with connections[CONN].cursor() as cur:
            _ensure_annotation_table(cur)
            cur.execute(
                '''
                insert into "Audit".activity_annotations
                    (component_id, planned_hours, mapped_ksbs, updated_by, updated_at)
                values (%s, %s, %s, %s, now())
                on conflict (component_id) do update set
                    planned_hours = excluded.planned_hours,
                    mapped_ksbs = excluded.mapped_ksbs,
                    updated_by = excluded.updated_by,
                    updated_at = now()
                returning component_id, planned_hours, mapped_ksbs, updated_by, updated_at
                ''',
                [component, planned_hours, mapped_ksbs, updated_by],
            )
            row = cur.fetchone()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not save activity annotation.", "details": str(error)}, status=503)
    return JsonResponse(_annotation_payload(row))
