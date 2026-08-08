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
import html
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


# The full names behind the K/S/B single-letter KSB groups, for display.
_KSB_TYPE_LABELS = {"K": "Knowledge", "S": "Skill", "B": "Behaviour"}


def _normalize_ksbs(ksbs):
    """Flatten the ``{"K": [...], "S": [...], "B": [...]}`` KSB block that now
    lives on every activity in programme_structure into a single ordered list of
    ``{code, type, type_label, description, reason}`` dicts (Knowledge, then
    Skill, then Behaviour). Returns ``[]`` when no KSBs are present."""
    if not isinstance(ksbs, dict):
        return []
    result = []
    for group in ("K", "S", "B"):
        items = ksbs.get(group)
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            code = (item.get("code") or "").strip()
            if not code:
                continue
            group_letter = (item.get("type") or group or "").strip().upper()[:1] or group
            result.append({
                "code": code,
                "type": group_letter,
                "type_label": _KSB_TYPE_LABELS.get(group_letter, group_letter),
                "description": (item.get("description") or "").strip() or None,
                "reason": (item.get("reason") or "").strip() or None,
            })
    return result


# --- attendance-session grouping + recording matching ----------------------
#
# An attendance key is ``<learner_id>_<YYYY-MM-DD>_<group>`` — e.g.
# ``471_2026-07-03_project_planning_and_control_ppc_andrew``. Two learners
# attended the *same* live session when the last two parts (date + group) match;
# the group text is spelled inconsistently across learners (``ray-project...``
# vs ``ray_project...`` vs ``Ray - Project ...``) so it's normalised first.
#
# The recording of that session lives as ordinary LMS lesson(s) whose *title*
# starts with the session date in ``D-M-YYYY`` form and names the course, e.g.
# ``26-6-2026 Project Planning & Control - Andrew Millington Part 1``. So a
# recording belongs to a session when its title-date equals the session date and
# its course name overlaps the session group. (Per-activity ``created_at`` /
# ``completed_at`` are upload / watch timestamps and don't identify the session.)

_ATT_KEY_RE = re.compile(r"^(\d+)_(\d{4}-\d{2}-\d{2})_(.+)$")
# A D-M-YYYY / D/M/YYYY date appearing ANYWHERE in a recording title. Some
# courses date-stamp the front ("26-6-2026 Project Planning…"), others the tail
# ("… Customer Experience - 17/7/2026"), so it is not start-anchored.
_TITLE_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?!\d)")

# Filler words that carry no course identity — dropped before comparing a
# session group against a recording's course name.
_TOKEN_STOP = {
    "and", "the", "of", "a", "an", "part", "parts", "session", "sessions",
    "recorded", "live", "lecture", "lesson", "qualification", "module",
    "group", "online",
}


def _norm_group(value):
    """Lower-case and collapse all non-alphanumerics to single spaces, so the
    ``-``/``_``/space/case spelling variants of a group name unify."""
    return re.sub(r"[^a-z0-9]+", " ", (value or "").lower()).strip()


def _significant_tokens(text):
    """Meaningful word set of a group/course name (stop-words and bare numbers
    removed) — used to score whether a recording's course matches a session."""
    return {t for t in _norm_group(text).split() if t not in _TOKEN_STOP and not t.isdigit()}


def _parse_attendance_key(key):
    match = _ATT_KEY_RE.match(key or "")
    if not match:
        return None
    return match.group(1), match.group(2), match.group(3)


def _clean_title(title):
    """Un-escape HTML entities (``&amp;``) and drop zero-width spaces that some
    recording titles carry, so parsing/matching sees plain text."""
    return html.unescape(title or "").replace("​", " ")


def _title_session_date(title):
    """Parse the ``D-M-YYYY`` date somewhere in a recording's title into an ISO
    ``YYYY-MM-DD`` string (the live-session date), or None if absent."""
    match = _TITLE_DATE_RE.search(_clean_title(title))
    if not match:
        return None
    day, month, year = (int(part) for part in match.groups())
    if not (1 <= month <= 12 and 1 <= day <= 31):
        return None
    return f"{year:04d}-{month:02d}-{day:02d}"


def _recording_course(title):
    """Strip the date and any ``Part N`` marker out of a recording title,
    leaving just the course/topic words for token matching."""
    text = _TITLE_DATE_RE.sub(" ", _clean_title(title))
    text = re.sub(r"(?i)\bpart\s*\d+\b", " ", text)
    return text.strip(" -–—")


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
            # Skip the week-group wrapper entries (shape: kind/week/items/_meta,
            # no component_id). They bundle curriculum materials for context but
            # carry no per-learner completion/time data — the individual activity
            # entries that follow hold the real records. Without this guard each
            # wrapper became a junk "Untitled activity" row.
            if item.get("component_id") is None:
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
                "section_title": item.get("section_title") or item.get("section") or item.get("week") or None,
                "activity_description": None,
                "delivery_method": item.get("component_kind") or "",
                "planned_hours": planned_hours,
                "source_course": None,
                "source_url": item.get("preview_url") or None,
                "source_basis": item.get("post_type") or None,
                "created_at": item.get("created_at") or None,
                "configured_duration": item.get("configured_duration") or None,
                "week": item.get("week") or None,
                "ksbs": _normalize_ksbs(item.get("KSBs")),
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
                "section_title": item.get("section_title") or item.get("section") or None,
                "activity_description": item.get("status") or None,
                "delivery_method": "assignment",
                "planned_hours": _to_float(item.get("planned_hours")),
                "source_course": None,
                "source_url": None,
                "source_basis": "assignment",
                "created_at": None,
                "configured_duration": None,
                "week": None,
                "ksbs": _normalize_ksbs(item.get("KSBs")),
                "done": (item.get("status") or "").lower() == "completed",
            })

        # 3) Attendance (live sessions)
        for index, item in enumerate(month.get("attendance") or []):
            if not isinstance(item, dict):
                continue
            activity_date = _iso_date(item.get("date"))
            month_period = _period_of(activity_date) or planned_month_period
            attended = item.get("attended")
            # Session identity from the key (date + normalised group) — lets us
            # gather every learner who attended the same live session.
            parsed_key = _parse_attendance_key(item.get("key"))
            session_date = parsed_key[1] if parsed_key else activity_date
            session_group = _norm_group(parsed_key[2]) if parsed_key else ""
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
                "section_title": item.get("section_title") or item.get("section") or None,
                "activity_description": None,
                "delivery_method": "attendance",
                "planned_hours": _to_float(item.get("planned_hours")),
                "source_course": None,
                "source_url": None,
                "source_basis": "attendance",
                "created_at": None,
                "configured_duration": None,
                "week": None,
                "ksbs": _normalize_ksbs(item.get("KSBs")),
                "session_date": session_date,
                "session_group": session_group,
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
            select lm.aptem_id, lm.learner_name, lm.learner_email,
                   lm.programme_structure, lm.aptem_training_plan,
                   lm.programme_name, profile.program_status,
                   profile.break_in_learning, owner.coach_name,
                   owner.coach_email
            from "Audit".learner_match lm
            left join lateral (
                select program_status, "Break in learning" as break_in_learning
                from fetching_evidence.aptem_cv_contracts_probe
                where learner_id = lm.aptem_id
                order by fetched_at desc nulls last, id desc
                limit 1
            ) profile on true
            left join lateral (
                select "OwnerName" as coach_name, "OwnerEmail" as coach_email
                from "LMS"."Aptem_users"
                where "ID" = lm.aptem_id
                limit 1
            ) owner on true
            where lm.programme_structure ->> 'programme' = %s
            order by lm.learner_name, lm.aptem_id
            ''',
            [PROGRAMME_NAME],
        )
        rows = cur.fetchall()

    learners = []
    for (
        aptem_id, learner_name, learner_email, structure, training_plan,
        programme_name, program_status, break_in_learning, coach_name,
        coach_email,
    ) in rows:
        # psycopg may hand json/jsonb back as a decoded dict or as raw text
        # depending on the configured loaders — normalise to a dict either way.
        if isinstance(structure, str):
            try:
                structure = json.loads(structure)
            except ValueError:
                structure = None
        if isinstance(training_plan, str):
            try:
                training_plan = json.loads(training_plan)
            except ValueError:
                training_plan = None
        if isinstance(break_in_learning, str):
            try:
                break_in_learning = json.loads(break_in_learning)
            except ValueError:
                break_in_learning = None
        break_in_learning = break_in_learning if isinstance(break_in_learning, dict) else {}
        name = learner_name or f"Learner {aptem_id}"
        learners.append({
            "aptem_id": aptem_id,
            "name": name,
            "email": learner_email,
            "programme_name": programme_name or PROGRAMME_NAME,
            "program_status": program_status or "Unknown",
            "has_break_in_learning": (
                bool(break_in_learning.get("has_break_in_learning"))
                or str(program_status or "").strip().lower() == "onbreak"
            ),
            "coach": {
                "name": coach_name or None,
                "email": coach_email or None,
            },
            "training_plan": training_plan if isinstance(training_plan, list) else [],
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
            "program_status": learner.get("program_status") or "Unknown",
            "has_break_in_learning": bool(learner.get("has_break_in_learning")),
            "coach": learner.get("coach") or {"name": None, "email": None},
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


@require_GET
def learner_profile(request: HttpRequest) -> JsonResponse:
    """Return the cross-source profile for one REAL-workspace learner."""
    learner_key = request.GET.get("learner", "").strip().lower()
    if not learner_key or len(learner_key) > 200:
        return JsonResponse({"error": "A valid learner is required."}, status=400)

    try:
        learners = _load_rows()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Audit.learner_match from the enrolment database.", "details": str(error)},
            status=503,
        )

    learner = next(
        (
            item for item in learners
            if learner_key in (_learner_id(item["name"]), str(item["aptem_id"]).lower())
        ),
        None,
    )
    if learner is None:
        return JsonResponse({"error": "Learner not found."}, status=404)

    try:
        sources = _load_profile_sources(learner["aptem_id"], learner.get("email"))
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not load the learner profile sources.", "details": str(error)},
            status=503,
        )

    training_months = []
    total_modules = 0
    completed_modules = 0
    for month in learner.get("training_plan") or []:
        if not isinstance(month, dict):
            continue
        modules = []
        for item in month.get("modules") or []:
            if not isinstance(item, dict):
                continue
            component = item.get("components") if isinstance(item.get("components"), dict) else {}
            status = component.get("status") or "Unknown"
            total_modules += 1
            if str(status).strip().lower() == "completed":
                completed_modules += 1
            modules.append({
                "name": item.get("module") or "Untitled module",
                "type": component.get("type") or "",
                "status": status,
            })
        training_months.append({
            "month": month.get("month") or "",
            "date": _iso_date(month.get("date")),
            "modules": modules,
        })

    return JsonResponse({
        "id": _learner_id(learner["name"]),
        "aptem_id": str(learner["aptem_id"]),
        "name": learner["name"],
        "email": learner.get("email"),
        "programme": learner.get("programme_name") or PROGRAMME_NAME,
        "programme_status": sources["programme_status"],
        "break_in_learning": sources["break_in_learning"],
        "coach": learner.get("coach") or {"name": None, "email": None},
        "planned_hours": sources["learning_delivery"].get("planned_hours"),
        "learning_delivery": sources["learning_delivery"],
        "contracts": sources["contracts"],
        "training_plan": {
            "total_modules": total_modules,
            "completed_modules": completed_modules,
            "months": training_months,
        },
        "skills_radar": sources["skills_radar"],
        "certifications": sources["certifications"],
        "employment": sources["employment"],
        "programme_understanding": sources["programme_understanding"],
    })


def _load_profile_sources(aptem_id, learner_email):
    """Read the profile's external sources without retaining user selection.

    Every query is keyed by this request's learner id/email. The returned data
    is request-local and safe when different learners are viewed concurrently.
    """
    contracts = []
    skill_groups = {}
    certifications = []
    employment = None
    learning_delivery = {}
    programme_understanding = {
        "understanding_programme": None,
        "career_development_progression": None,
    }
    programme_status = "Unknown"
    break_in_learning = {
        "has_break_in_learning": False,
        "last_learning_date": None,
        "expected_return_date": None,
        "has_return_to_learning": False,
        "return_to_learning_date": None,
        "revised_learning_planned_end_date": None,
    }

    with connections[CONN].cursor() as cursor:
        cursor.execute(
            '''
            select id, document_name, status, date, learner_signed_date,
                   fully_signed_date, requested_date, program_name,
                   program_start_date, planned_end_date, file
            from fetching_evidence.aptem_cv_contracts_probe
            where learner_id = %s
            order by date desc nulls last, id desc
            ''',
            [aptem_id],
        )
        for row in cursor.fetchall():
            contracts.append({
                "id": str(row[0]),
                "document_name": row[1] or "Contract",
                "status": row[2] or "Unknown",
                "date": row[3],
                "learner_signed_date": row[4],
                "fully_signed_date": row[5],
                "requested_date": row[6],
                "programme": row[7],
                "programme_start_date": row[8],
                "planned_end_date": row[9],
                "file": row[10],
            })

        cursor.execute(
            '''
            select program_status, "Break in learning"
            from fetching_evidence.aptem_cv_contracts_probe
            where learner_id = %s
            order by fetched_at desc nulls last, id desc
            limit 1
            ''',
            [aptem_id],
        )
        status_row = cursor.fetchone()
        if status_row:
            programme_status = status_row[0] or "Unknown"
            break_value = status_row[1]
            if isinstance(break_value, str):
                try:
                    break_value = json.loads(break_value)
                except ValueError:
                    break_value = None
            if isinstance(break_value, dict):
                break_in_learning = {
                    "has_break_in_learning": bool(break_value.get("has_break_in_learning")),
                    "last_learning_date": break_value.get("last_learning_date"),
                    "expected_return_date": break_value.get("expected_return_date"),
                    "has_return_to_learning": bool(break_value.get("has_return_to_learning")),
                    "return_to_learning_date": break_value.get("return_to_learning_date"),
                    "revised_learning_planned_end_date": break_value.get("revised_learning_planned_end_date"),
                }
            if str(programme_status).strip().lower() == "onbreak":
                break_in_learning["has_break_in_learning"] = True

        cursor.execute(
            '''
            select
                coalesce(
                    "Programme understanding" ->> 'understanding_programme',
                    "Programme understanding" -> 'raw' ->> 'ExtendedILRModel_UnderstandingProgramme'
                ),
                coalesce(
                    "Programme understanding" ->> 'career_development_progression',
                    "Programme understanding" -> 'raw' ->> 'ExtendedILRModel_CareerDevelopmentProgression'
                )
            from fetching_evidence.aptem_cv_contracts_probe
            where learner_id = %s
              and "Programme understanding" is not null
            order by fetched_at desc nulls last, id desc
            limit 1
            ''',
            [aptem_id],
        )
        understanding_row = cursor.fetchone()
        if understanding_row:
            programme_understanding = {
                "understanding_programme": understanding_row[0] or None,
                "career_development_progression": understanding_row[1] or None,
            }

        cursor.execute(
            '''
            select characteristic_name, assessed_level
            from fetching_evidence.aptem_skills_radar_probe
            where learner_id = %s and assessed_level is not null
            order by characteristic_name
            ''',
            [aptem_id],
        )
        for characteristic, assessed_level in cursor.fetchall():
            match = re.match(
                r"Understanding of (.+?) \((Knowledge|Skill|Behaviour)\)",
                characteristic or "",
            )
            domain = match.group(1).strip() if match else (characteristic or "Skill").split(" - ")[0].strip()
            score = max(0, min(8, int(assessed_level)))
            score_type = match.group(2).lower() if match else "skill"
            field = {"knowledge": "knowledge", "skill": "skill_score", "behaviour": "behaviour"}[score_type]
            skill_groups.setdefault(domain, {})[field] = score

        cursor.execute(
            '''
            select certifications, employment_details
            from fetching_evidence.aptem_cv_certifications
            where learner_id = %s
            order by updated_at desc nulls last, id desc
            ''',
            [aptem_id],
        )
        seen_certifications = set()
        for certification_value, employment_value in cursor.fetchall():
            if isinstance(certification_value, str):
                try:
                    certification_value = json.loads(certification_value)
                except ValueError:
                    certification_value = []
            if isinstance(employment_value, str):
                try:
                    employment_value = json.loads(employment_value)
                except ValueError:
                    employment_value = []
            if isinstance(certification_value, list):
                for certification in certification_value:
                    if not isinstance(certification, dict):
                        continue
                    key = (
                        str(certification.get("name") or "").strip().lower(),
                        str(certification.get("issuer") or "").strip().lower(),
                    )
                    if key in seen_certifications or not key[0]:
                        continue
                    seen_certifications.add(key)
                    certifications.append(certification)
            if employment is None:
                employment = _first_employment_details(employment_value)

        if learner_email:
            cursor.execute(
                '''
                select learn_ref_number, planned_hours, otj_actual_hours,
                       learn_start_date, learn_plan_end_date, completion_status
                from "Audit".ilr_learning_deliveries
                where lower(email) = lower(%s) and planned_hours is not null
                order by aim_seq_number, updated_at desc nulls last, id desc
                limit 1
                ''',
                [learner_email],
            )
            delivery = cursor.fetchone()
            if delivery:
                learning_delivery = {
                    "learner_reference": delivery[0],
                    "planned_hours": delivery[1],
                    "actual_hours": delivery[2],
                    "start_date": delivery[3],
                    "planned_end_date": delivery[4],
                    "completion_status": delivery[5],
                    "first_evidence_date": None,
                    "first_evidence_items": [],
                }
                cursor.execute(
                    '''
                    with raw_candidates as (
                        select
                            item ->> 'id' as evidence_id,
                            item ->> 'name' as evidence_name,
                            item ->> 'component_name' as component_name,
                            item ->> 'kind' as evidence_kind,
                            item ->> 'status' as evidence_status,
                            item ->> 'file' as evidence_file,
                            item ->> 'content' as evidence_content,
                            substring(item ->> 'created_date' from 1 for 10)::date as evidence_date
                        from fetching_evidence.learner_evidence learner_evidence
                        cross join lateral jsonb_array_elements(
                            case
                                when jsonb_typeof(learner_evidence.evidence) = 'array'
                                    then learner_evidence.evidence
                                else '[]'::jsonb
                            end
                        ) item
                        where learner_evidence.learner_id = %s
                          and ltrim(lower(coalesce(item ->> 'name', ''))) not like 'welcome%%'
                          and ltrim(lower(coalesce(item ->> 'component_name', ''))) not like 'welcome%%'
                          and coalesce(item ->> 'created_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}'
                          and substring(item ->> 'created_date' from 1 for 10)::date >= %s
                    ), candidates as (
                        select distinct on (evidence_id)
                            evidence_id, evidence_name, component_name, evidence_kind,
                            evidence_status, evidence_file, evidence_content, evidence_date
                        from raw_candidates
                        order by evidence_id, evidence_date
                    )
                    select evidence_id, evidence_name, component_name, evidence_kind,
                           evidence_status, evidence_file, evidence_content, evidence_date
                    from candidates
                    where evidence_date = (select min(evidence_date) from candidates)
                    order by evidence_id
                    ''',
                    [aptem_id, delivery[3]],
                )
                first_evidence_rows = cursor.fetchall()
                if first_evidence_rows:
                    learning_delivery["first_evidence_date"] = first_evidence_rows[0][7]
                    learning_delivery["first_evidence_items"] = [
                        {
                            "id": row[0],
                            "name": row[1] or "Untitled evidence",
                            "component_name": row[2] or "",
                            "kind": row[3] or "",
                            "status": row[4] or "",
                            "file": row[5],
                            "content": row[6],
                            "date": row[7],
                        }
                        for row in first_evidence_rows
                    ]

    skills_radar = [
        {
            "skill": domain,
            "knowledge": scores.get("knowledge"),
            "skill_score": scores.get("skill_score"),
            "behaviour": scores.get("behaviour"),
            "maximum": 8,
        }
        for domain, scores in sorted(skill_groups.items())
    ]
    return {
        "contracts": contracts,
        "skills_radar": skills_radar,
        "certifications": certifications,
        "employment": employment,
        "learning_delivery": learning_delivery,
        "programme_understanding": programme_understanding,
        "programme_status": programme_status,
        "break_in_learning": break_in_learning,
    }


def _first_employment_details(value):
    if isinstance(value, dict):
        nested = value.get("employment_details")
        if isinstance(nested, dict) and nested.get("section_found", True):
            return nested
        if value.get("employer_name") and value.get("section_found", True):
            return value
    if isinstance(value, list):
        for item in value:
            details = _first_employment_details(item)
            if details:
                return details
    return None


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


@require_GET
def attendance_session(request: HttpRequest) -> JsonResponse:
    """Everything about one live session, given any one learner's attendance key.

    Returns (a) every learner who attended the *same* session — matched by the
    key's date + normalised group, not the per-learner key — as activity rows
    the "Learner activity records" table can render, and (b) the session's
    recordings (LMS lessons whose title-date equals the session date and whose
    course name overlaps the group), for the content-preview panel."""
    key = request.GET.get("key", "").strip()
    parsed = _parse_attendance_key(key)
    if not parsed:
        return JsonResponse({"error": "key must look like <learner_id>_<YYYY-MM-DD>_<group>"}, status=400)
    _learner_part, date, group_raw = parsed
    norm_group = _norm_group(group_raw)

    try:
        learners_raw = _load_rows()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Audit.learner_match from the enrolment database.", "details": str(error)},
            status=503,
        )

    # (a) attendees — same date + same normalised group, one row per learner.
    attendees = []
    for learner in learners_raw:
        for item in learner["activities"]:
            if item.get("session_date") == date and item.get("session_group") == norm_group:
                attendees.append(item)
    attendees.sort(key=lambda item: item["learner"])

    # (b) recordings — LMS lessons whose title is dated to this session day. On a
    # given day more than one course can run (e.g. a PPC session and a PMO
    # session), so rather than a fixed word-overlap threshold we assign each
    # dated recording to whichever of that day's sessions its course name best
    # matches, and keep the ones that land on THIS session. This copes with
    # topical titles that share only one word with the group ("… PMO …").
    sessions_on_date = {}  # normalised group -> significant-token set
    for learner in learners_raw:
        for item in learner["activities"]:
            group = item.get("session_group")
            if item.get("session_date") == date and group and group not in sessions_on_date:
                sessions_on_date[group] = _significant_tokens(group)

    recordings = {}
    for learner in learners_raw:
        for item in learner["activities"]:
            source_url = item.get("source_url")
            if not source_url:
                continue
            title = item.get("activity_unit")
            if _title_session_date(title) != date:
                continue
            course_tokens = _significant_tokens(_recording_course(title))
            scores = {group: len(course_tokens & tokens) for group, tokens in sessions_on_date.items()}
            best = max(scores.values(), default=0)
            # Keep only if this session is (one of) the best match and it is a
            # real match (>0 shared words), so unrelated same-day courses split.
            if best <= 0 or scores.get(norm_group, 0) != best:
                continue
            component = item.get("plan_id")
            if component in recordings:
                continue
            recordings[component] = {
                "component_id": component,
                "title": _clean_title(title),
                "preview_url": source_url,
                "week": item.get("week"),
            }
    recordings_list = sorted(recordings.values(), key=lambda rec: rec["title"])

    planned_total = round(sum(item["planned_hours"] or 0 for item in attendees), 2)
    actual_total = round(sum(item["actual_lms_hours"] or 0 for item in attendees), 2)
    return JsonResponse({
        "session": {
            "date": date,
            "group": group_raw,
            "group_label": norm_group,
            "module": attendees[0]["activity_unit"] if attendees else None,
        },
        "recordings": recordings_list,
        "items": attendees,
        "total": len(attendees),
        "planned_total": planned_total,
        "actual_total": actual_total,
        "limit": len(attendees),
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
