"""Read-only API for the normalized ``Manual_audit`` LMS mirror.

These endpoints keep the frontend's existing OTJ ledger contract and use
``Manual_audit.learners`` as the Aptem-complete learner source. ``learner_id`` is
the optional LMS id; Aptem identity remains available even when it is NULL.

Hours are deliberately conservative: ``mapped_seconds`` is canonical and is
only converted to hours at the JSON boundary.  Until the hours-mapping job has
populated a learner's rows, the response marks hours as unavailable rather than
deriving or inventing them from activity status or video duration.
"""

import json
import re

from django.db import DatabaseError, connections
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

from audit_api.learner_exclusions import is_excluded_learner

from .plan_projection import (
    activity_content_url,
    merge_learner_months,
    plan_activity_detail,
    plan_cohort_overlay,
    plan_rows_for_learner,
    resolve_plan_material_lms_id,
    suppress_claimed_mirror_rows,
)

CONNECTION_ALIAS = "audit"

# Keep every mixed-case schema reference in one place.  The mirror is created
# outside this Django project, so these are intentionally unmanaged SQL tables.
LEARNERS = '"Manual_audit"."learners"'
GROUPS = '"Manual_audit"."groups"'
GROUP_LEARNERS = '"Manual_audit"."group_learners"'
ACTIVITIES = '"Manual_audit"."activities"'
ACTIVITY_RESULTS = '"Manual_audit"."activity_results"'
LEARNER_ATTENDANCE = '"Manual_audit"."learner_attendance"'
# Per-activity OTJH hours mapped by the fetch-evidence pipeline (planned + actual
# with reporting method + timestamps). Keyed (learner_id, kind, ref); ref = the
# LMS activity_id (video/audio/reading_quiz) or the attendance source_key.
ACTIVITY_PLANNED_HOURS = '"Manual_audit"."activity_planned_hours"'
ACTIVITY_ACTUAL_HOURS = '"Manual_audit"."activity_actual_hours"'

# LEFT JOIN fragment shared by the per-learner feed and the cross-learner view,
# so every learner's row carries their own planned / actual / method / timestamp.
_OTJH_JOIN = f"""
    LEFT JOIN {ACTIVITY_PLANNED_HOURS} ph
           ON ph.learner_id = r.learner_id AND ph.ref = r.activity_id::text
    LEFT JOIN {ACTIVITY_ACTUAL_HOURS} ah
           ON ah.learner_id = r.learner_id AND ah.ref = r.activity_id::text
"""
_OTJH_COLS = ("ph.planned_hours AS otjh_planned, ah.actual_hours AS otjh_actual, "
              "ah.reporting_method AS otjh_method, ah.timestamp_label AS otjh_timestamp, "
              "ah.start_time AS otjh_from, ah.end_time AS otjh_to")


def _connection():
    """Use the dedicated audit alias, falling back for minimal test setups."""
    alias = CONNECTION_ALIAS if CONNECTION_ALIAS in connections.databases else "default"
    return connections[alias]


def _dict_rows(cursor):
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _json_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _as_int(value, *, default=None, minimum=None, maximum=None):
    if value in (None, ""):
        return default
    parsed = int(value)
    if minimum is not None and parsed < minimum:
        raise ValueError(f"value must be at least {minimum}")
    if maximum is not None and parsed > maximum:
        raise ValueError(f"value must be at most {maximum}")
    return parsed


def _hours(seconds):
    if seconds is None:
        return None
    return round(float(seconds) / 3600, 2)


def _string_list(value):
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    if value in (None, ""):
        return []
    return [str(value)]


# Shared with the plan projection so identical catalogue materials render
# identically whether the row is a mirror row or a plan row.
_activity_content_url = activity_content_url


def _quiz_attempt_payload(row, component_id):
    """Merge the shared quiz definition with one learner's graded answers."""
    questions = _json_list(row.get("quiz_questions"))
    answers = _json_list(row.get("quiz_answers"))
    is_quiz = row.get("quiz_id") is not None or bool(questions)
    base = {
        "component_id": str(component_id),
        "source_activity_id": int(row["activity_id"]),
        "aptem_id": int(row["aptem_id"]),
        "is_quiz": is_quiz,
    }
    if not is_quiz:
        return {**base, "state": "not_quiz", "attempt": None}

    attempted = bool(
        row.get("quiz_attempted")
        or row.get("quiz_attempt_number")
        or answers
    )
    if not attempted:
        return {**base, "state": "not_attempted", "attempt": None}

    answers_by_question = {
        str(answer.get("question_id")): answer
        for answer in answers
        if isinstance(answer, dict) and answer.get("question_id") is not None
    }
    source_questions = questions or answers
    normalized_questions = []
    for index, question in enumerate(source_questions, start=1):
        if not isinstance(question, dict):
            continue
        question_id = question.get("question_id")
        answer = answers_by_question.get(str(question_id), {})
        correct_answers = _string_list(answer.get("correct_answer"))
        learner_answers = _string_list(answer.get("learner_answer"))
        options = _json_list(question.get("options"))
        if not options:
            # Some historical attempts retain the graded answer body but no
            # option list. Preserve the visible selected/correct values.
            option_values = list(dict.fromkeys(correct_answers + learner_answers))
            options = [{"option_body": value, "option_order": order}
                       for order, value in enumerate(option_values, start=1)]
        normalized_options = []
        for option_index, option in enumerate(options, start=1):
            if not isinstance(option, dict):
                continue
            option_text = str(option.get("option_body") or option.get("option_text") or "")
            normalized_options.append({
                "option_text": option_text,
                "option_order": option.get("option_order") or option_index,
                "is_correct": option_text in correct_answers,
                "is_selected": option_text in learner_answers,
            })
        is_correct = answer.get("is_correct")
        if not isinstance(is_correct, bool):
            is_correct = bool(learner_answers) and set(learner_answers) == set(correct_answers)
        normalized_questions.append({
            "question_id": int(question_id) if question_id is not None else index,
            "question_order": question.get("question_order") or index,
            "question_text": (
                question.get("question_body")
                or answer.get("question_body")
                or f"Question {index}"
            ),
            "question_type": question.get("question_type") or answer.get("question_type") or "",
            "is_correct": is_correct,
            "answer_options": normalized_options,
            "correct_answers": correct_answers,
            "learner_selected_answers": learner_answers,
        })

    passed = row.get("quiz_passed") is True
    return {
        **base,
        "state": "attempted",
        "attempt": {
            "title": row.get("title") or f"Quiz {row['activity_id']}",
            "status": "passed" if passed else "failed",
            "score": float(row["quiz_score"]) if row.get("quiz_score") is not None else None,
            "maximum_score": (
                float(row["quiz_maximum_score"])
                if row.get("quiz_maximum_score") is not None else None
            ),
            "attempt_number": int(row["quiz_attempt_number"] or 0),
            "quiz_body": {
                "description": row.get("quiz_body"),
                "questions": normalized_questions,
            },
        },
    }


def _category(activity_type):
    value = (activity_type or "activity").strip()
    return "reading+quiz" if value.lower() == "reading+quiz" else value.lower()


def _has_quiz(row):
    return row.get("quiz_id") is not None or bool(_json_list(row.get("quiz_questions")))


def _has_reading(row):
    return bool(
        row.get("reading_iframe_url")
        or row.get("reading_text_body")
        or row.get("reading_type")
    )


def _activity_category(row):
    category = _category(row.get("activity_type"))
    if category != "reading+quiz":
        return category
    has_reading = _has_reading(row)
    has_quiz = _has_quiz(row)
    if has_reading and has_quiz:
        return "reading+quiz"
    if has_reading:
        return "reading"
    if has_quiz:
        return "quiz"
    return category


def _is_completed(row):
    if str(row.get("status") or "").strip().lower() == "completed":
        return True
    if row.get("video_completed"):
        return True
    if _has_quiz(row):
        quiz_completed = row.get("quiz_passed") is True
        return bool(quiz_completed and (not _has_reading(row) or row.get("reading_viewed")))
    if _has_reading(row):
        return row.get("reading_viewed") is True
    return False


def _activity_ref(group_id, activity_id):
    return f"la:{group_id}:{activity_id}"


def _merge_title_key(value):
    """Normalise an activity title for reading↔quiz pairing.

    LMS imports sometimes model one learning activity as a reading-only
    catalogue row plus a quiz-only catalogue row sharing the same title STEM.
    Real catalogue patterns (inspected live): quizzes carry a numbering
    prefix — "Q2-What is Project?", "Q1: Project Context" — while readings
    carry "Additional Reading:" / "Optional Reading:" prefixes. Lowercase,
    collapse every non-alphanumeric run, then strip those marker prefixes and
    a trailing "reading"/"quiz" word so both halves reduce to the same stem.
    """
    text = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    text = re.sub(r"^(?:q(?:uiz)?\s*\d*|(?:additional|optional)\s+reading|reading)\b\s*", "", text)
    text = re.sub(r"\s*\b(?:reading|quiz)$", "", text)
    return text.strip()


def merge_reading_quiz_rows(items, protected_ids=frozenset()):
    """Collapse reading-only + quiz-only halves of one activity into one row.

    Pairs LMS mirror rows (``la:`` ids) whose categories are ``reading`` and
    ``quiz`` when they share the same learner, group, month, and normalised
    title. The merged row keeps the READING row's identity (id, date), takes
    the quiz fields from the quiz half, and SUMS the hours — each half carries
    its own OTJH allocation, so the sum preserves ``actual_total`` exactly.
    Rows whose id is in ``protected_ids`` (touched by an auditor overlay) are
    never merged, so client-side overlay merges keep pointing at a live row.
    Runs at read time — future imports flow through it with no backfill.
    """
    def pair_key(item):
        return (item["learner_id"], item.get("group_id"), item["month"], _merge_title_key(item["activity"]))

    def mergeable(item, category):
        return (
            item["category"] == category
            and str(item["activity_id"]).startswith("la:")
            and str(item["activity_id"]) not in protected_ids
            and _merge_title_key(item["activity"])
        )

    quiz_pool = {}
    for index, item in enumerate(items):
        if mergeable(item, "quiz"):
            quiz_pool.setdefault(pair_key(item), []).append(index)

    # Pass 1 — decide the pairs up front. Deciding while emitting would let a
    # quiz half that appears EARLIER in the list slip into the output before
    # its reading partner claims it (list order is arbitrary at this point).
    quiz_owner = {}
    for index, item in enumerate(items):
        if not mergeable(item, "reading"):
            continue
        candidates = quiz_pool.get(pair_key(item)) or []
        quiz_index = next((candidate for candidate in candidates if candidate not in quiz_owner and candidate != index), None)
        if quiz_index is not None:
            quiz_owner[quiz_index] = index
    if not quiz_owner:
        return items
    reading_partner = {reading_index: quiz_index for quiz_index, reading_index in quiz_owner.items()}

    # Pass 2 — emit: drop consumed quiz halves, upgrade their reading halves.
    out = []
    for index, item in enumerate(items):
        if index in quiz_owner:
            continue
        quiz_index = reading_partner.get(index)
        if quiz_index is None:
            out.append(item)
            continue
        quiz = items[quiz_index]
        merged = dict(item)
        merged["category"] = "reading+quiz"
        merged["planned"] = round(float(item.get("planned") or 0) + float(quiz.get("planned") or 0), 2)
        merged["actual"] = round(float(item.get("actual") or 0) + float(quiz.get("actual") or 0), 2)
        seconds = [value for value in (item.get("mapped_seconds"), quiz.get("mapped_seconds")) if value is not None]
        merged["mapped_seconds"] = sum(seconds) if seconds else None
        merged["hours_mapped"] = bool(item.get("hours_mapped") or quiz.get("hours_mapped"))
        merged["has_reading"] = True
        merged["has_quiz"] = True
        merged["completed"] = bool(item.get("completed")) or bool(quiz.get("completed"))
        merged["reporting_method"] = item.get("reporting_method") or quiz.get("reporting_method")
        merged["timestamp_display"] = item.get("timestamp_display") or quiz.get("timestamp_display") or ""
        merged["activity_subtitle"] = item.get("activity_subtitle") or quiz.get("activity_subtitle")
        merged["iframe_url"] = item.get("iframe_url") or quiz.get("iframe_url")
        merged["created_at"] = min(
            (value for value in (item.get("created_at"), quiz.get("created_at")) if value),
            default=None,
        )
        for key in ("quiz_attempted", "quiz_passed", "quiz_score", "quiz_maximum_score"):
            if merged.get(key) is None:
                merged[key] = quiz.get(key)
        # Keep both source ids so the quiz half remains traceable.
        merged["merged_source_activity_ids"] = [item.get("source_activity_id"), quiz.get("source_activity_id")]
        out.append(merged)
    return out


def _overlay_touched_ids(cursor, aptem_id):
    """Ids of this learner's rows an auditor overlay references (or none)."""
    cursor.execute("SELECT to_regclass('\"Manual_audit\".\"activity_overrides\"')")
    if cursor.fetchone()[0] is None:
        return frozenset()
    cursor.execute(
        'SELECT activity_id FROM "Manual_audit"."activity_overrides" WHERE aptem_id = %s',
        [aptem_id],
    )
    return frozenset(str(row[0]) for row in cursor.fetchall())


def _attendance_ref(source_key):
    return f"att:{source_key}"


def _attendance_payload(row):
    activity_hours = row.get("activity_hours")
    activity_date = row.get("attendance_date")
    attended = row.get("attendance_value") == 1 or str(row.get("attendance_status") or "").lower() in {
        "present", "attended", "attend",
    }
    return {
        "activity_id": _attendance_ref(row["source_key"]),
        "source_activity_id": row["source_key"],
        "group_id": None,
        "group_name": row.get("module"),
        "learner_id": int(row["aptem_id"]),
        "lms_learner_id": int(row["learner_id"]) if row.get("learner_id") is not None else None,
        "learner_name": row.get("learner_name") or f"Learner {row['aptem_id']}",
        "date": activity_date.isoformat() if activity_date else None,
        "month": activity_date.strftime("%Y-%m") if activity_date else "",
        "month_label": activity_date.strftime("%B %Y") if activity_date else "Not dated",
        "category": "attendance",
        # The requested lecture_name is the display title. Module remains as
        # supporting context rather than replacing the source lecture name.
        "activity": row.get("lecture_name") or row.get("module") or "Attendance session",
        "activity_subtitle": row.get("module") or row.get("attendance_status"),
        "planned": None,
        "actual": float(activity_hours) if activity_hours is not None else 0.0,
        "mapped_seconds": int(round(float(activity_hours) * 3600)) if activity_hours is not None else None,
        "hours_mapped": activity_hours is not None,
        "timestamp_from": None,
        "timestamp_to": None,
        "timestamp_display": "attended" if attended else "not attended",
        "status": row.get("attendance_status") or ("Present" if attended else "Absent"),
        "completed": attended,
        "video_started": None,
        "video_completed": None,
        "reading_viewed": None,
        "quiz_attempted": None,
        "quiz_passed": None,
        "quiz_score": None,
        "quiz_maximum_score": None,
        "configured_duration_minutes": None,
        "ksbs": None,
        "iframe_url": None,
        "created_at": (
            row["source_created_at"].isoformat() if row.get("source_created_at")
            else row["synced_at"].isoformat() if row.get("synced_at")
            else None
        ),
        "source": "Manual_audit",
    }


def _parse_activity_ref(value):
    """Return ``(group_id, activity_id)``; group is optional for numeric IDs."""
    raw = str(value or "").strip()
    if raw.startswith("la:"):
        parts = raw.split(":")
        if len(parts) != 3:
            raise ValueError("invalid Manual_audit activity reference")
        return int(parts[1]), int(parts[2])
    return None, int(raw)


def _activity_payload(row):
    mapped_seconds = row.get("mapped_seconds")
    if mapped_seconds is None and row.get("mapped_hours") is not None:
        mapped_seconds = int(round(float(row["mapped_hours"]) * 3600))
    # OTJH pipeline values (from activity_planned_hours / activity_actual_hours)
    # take precedence over the reserved mapped_* columns when the join supplied
    # them. Absent (other callers) -> fall back to the previous behaviour.
    otjh_planned = row.get("otjh_planned")
    otjh_actual = row.get("otjh_actual")
    otjh_from = row.get("otjh_from")
    otjh_to = row.get("otjh_to")
    if otjh_actual is not None:
        actual_hours = float(otjh_actual)
        hours_mapped = True
    else:
        hours_mapped = mapped_seconds is not None
        actual_hours = _hours(mapped_seconds) if hours_mapped else 0.0
    group_id = int(row["group_id"])
    activity_id = int(row["activity_id"])
    activity_date = row.get("activity_date")
    activity_date_iso = activity_date.isoformat() if activity_date else None
    return {
        "activity_id": _activity_ref(group_id, activity_id),
        "source_activity_id": activity_id,
        "group_id": group_id,
        "group_name": row.get("group_name"),
        "learner_id": int(row["aptem_id"]),
        "lms_learner_id": int(row["learner_id"]),
        "learner_name": row.get("learner_name") or f"Learner {row['learner_id']}",
        "date": activity_date_iso,
        "month": activity_date.strftime("%Y-%m") if activity_date else "",
        "month_label": activity_date.strftime("%B %Y") if activity_date else "Not dated",
        "category": _activity_category(row),
        "activity": row.get("title") or f"Activity {activity_id}",
        "activity_subtitle": row.get("status"),
        "planned": float(otjh_planned) if otjh_planned is not None else 0.0,
        "actual": actual_hours,
        "mapped_seconds": mapped_seconds,
        "hours_mapped": hours_mapped,
        "reporting_method": row.get("otjh_method"),
        "timestamp_from": otjh_from.strftime("%H:%M:%S") if otjh_from else None,
        "timestamp_to": otjh_to.strftime("%H:%M:%S") if otjh_to else None,
        "timestamp_display": row.get("otjh_timestamp") or "",
        "status": row.get("status"),
        "completed": _is_completed(row),
        "video_started": row.get("video_started"),
        "video_completed": row.get("video_completed"),
        "reading_viewed": row.get("reading_viewed"),
        "quiz_attempted": row.get("quiz_attempted"),
        "quiz_passed": row.get("quiz_passed"),
        "quiz_score": float(row["quiz_score"]) if row.get("quiz_score") is not None else None,
        "quiz_maximum_score": (
            float(row["quiz_maximum_score"])
            if row.get("quiz_maximum_score") is not None else None
        ),
        "has_reading": _has_reading(row),
        "has_quiz": _has_quiz(row),
        "configured_duration_minutes": (
            float(row["configured_duration_min"])
            if row.get("configured_duration_min") is not None else None
        ),
        "ksbs": None,
        "iframe_url": _activity_content_url(
            row.get("video_iframe_url"),
            row.get("reading_iframe_url"),
            row.get("reading_type"),
        ),
        # When the catalogue row was first synced into the mirror — the closest
        # thing an LMS import has to "when was this activity added".
        "created_at": row["first_seen"].isoformat() if row.get("first_seen") else None,
        "source": "Manual_audit",
    }


@require_GET
def health(_request: HttpRequest) -> JsonResponse:
    try:
        with _connection().cursor() as cursor:
            cursor.execute(
                f"SELECT (SELECT count(*) FROM {LEARNERS} WHERE aptem_id IS NOT NULL), "
                f"(SELECT count(*) FROM {ACTIVITY_RESULTS}), current_database()"
            )
            learners, results, database = cursor.fetchone()
    except DatabaseError as error:
        return JsonResponse(
            {"ok": False, "source": "Manual_audit", "error": str(error)}, status=503
        )
    return JsonResponse({
        "ok": True,
        "source": "Manual_audit",
        "database": database,
        "learners": learners,
        "activity_results": results,
    })


@require_GET
def cohort(request: HttpRequest) -> JsonResponse:
    """Return Aptem learners, enriched only by their verified LMS match."""
    search = (request.GET.get("search") or "").strip()
    programme = (request.GET.get("programme") or "").strip()
    conditions = ["l.aptem_id IS NOT NULL"]
    params = []
    if search:
        conditions.append("(l.learner_name ILIKE %s OR l.learner_email ILIKE %s)")
        params.append(f"%{search}%")
        params.append(f"%{search}%")
    if programme:
        conditions.append("l.programme_name = %s")
        params.append(programme)
    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    sql = f"""
        WITH learner_groups AS (
            SELECT gl.learner_id,
                   array_agg(DISTINCT g.group_name ORDER BY g.group_name)
                       FILTER (WHERE g.group_name IS NOT NULL) AS groups,
                   array_agg(DISTINCT g.group_name ORDER BY g.group_name)
                       FILTER (WHERE g.group_name ILIKE '%%KSB%%') AS programme_groups
            FROM {GROUP_LEARNERS} gl
            JOIN {GROUPS} g ON g.group_id = gl.group_id
            GROUP BY gl.learner_id
        ), result_totals AS (
            SELECT learner_id,
                   count(*) AS activity_count,
                   count(*) FILTER (WHERE status = 'completed'
                                      OR video_completed IS TRUE
                                      OR quiz_passed IS TRUE) AS completed_count,
                   count(COALESCE(mapped_seconds, round(mapped_hours * 3600))) AS mapped_count,
                   COALESCE(sum(COALESCE(mapped_seconds, round(mapped_hours * 3600))), 0)
                       AS mapped_seconds
            FROM {ACTIVITY_RESULTS}
            GROUP BY learner_id
        ), attendance_totals AS (
            SELECT aptem_id,
                   count(*) AS attendance_count,
                   count(*) FILTER (
                       WHERE attendance_value = 1
                          OR lower(COALESCE(attendance_status, '')) IN ('present', 'attended', 'attend')
                   ) AS attended_count,
                   count(activity_hours) AS mapped_count,
                   COALESCE(sum(round(activity_hours * 3600)), 0) AS mapped_seconds
            FROM {LEARNER_ATTENDANCE}
            GROUP BY aptem_id
        ), attendance_month_rows AS (
            SELECT aptem_id,
                   to_char(attendance_date, 'YYYY-MM') AS month,
                   to_char(attendance_date, 'FMMonth YYYY') AS label,
                   COALESCE(sum(activity_hours), 0) AS actual
            FROM {LEARNER_ATTENDANCE}
            WHERE attendance_date IS NOT NULL
            GROUP BY aptem_id, date_trunc('month', attendance_date),
                     to_char(attendance_date, 'YYYY-MM'), to_char(attendance_date, 'FMMonth YYYY')
        ), lms_hour_rows AS (
            -- One row per LMS activity result with the SAME hours precedence
            -- the activities feed applies per row (OTJH actual, else the
            -- mirror's mapped seconds/hours) so the monthly buckets reconcile
            -- with the sum of the visible rows' Actual column.
            SELECT l.aptem_id,
                   a.activity_date,
                   lower(COALESCE(a.activity_type, r.activity_type, '')) AS activity_type,
                   CASE
                       WHEN ah.actual_hours IS NOT NULL THEN ah.actual_hours
                       WHEN r.mapped_seconds IS NOT NULL THEN round(r.mapped_seconds / 3600.0, 2)
                       WHEN r.mapped_hours IS NOT NULL THEN round(round(r.mapped_hours * 3600) / 3600.0, 2)
                       ELSE NULL
                   END AS actual_hours
            FROM {ACTIVITY_RESULTS} r
            JOIN {LEARNERS} l ON l.learner_id = r.learner_id
            JOIN {ACTIVITIES} a ON a.activity_id = r.activity_id
            LEFT JOIN {ACTIVITY_ACTUAL_HOURS} ah
                   ON ah.learner_id = r.learner_id AND ah.ref = r.activity_id::text
        ), lms_month_rows AS (
            SELECT aptem_id,
                   to_char(activity_date, 'YYYY-MM') AS month,
                   to_char(activity_date, 'FMMonth YYYY') AS label,
                   COALESCE(sum(actual_hours) FILTER (WHERE activity_type <> 'reading+quiz'), 0) AS media_actual,
                   COALESCE(sum(actual_hours) FILTER (WHERE activity_type = 'reading+quiz'), 0) AS bundle_actual
            FROM lms_hour_rows
            WHERE activity_date IS NOT NULL
            GROUP BY aptem_id, date_trunc('month', activity_date),
                     to_char(activity_date, 'YYYY-MM'), to_char(activity_date, 'FMMonth YYYY')
        ), lms_actual_totals AS (
            SELECT aptem_id, COALESCE(sum(actual_hours), 0) AS lms_actual_hours
            FROM lms_hour_rows
            GROUP BY aptem_id
        ), month_rows AS (
            SELECT aptem_id, month, label,
                   actual AS att_actual,
                   0::numeric AS media_actual, 0::numeric AS bundle_actual
            FROM attendance_month_rows
            UNION ALL
            SELECT aptem_id, month, label,
                   0::numeric, media_actual, bundle_actual
            FROM lms_month_rows
        ), combined_month_rows AS (
            SELECT aptem_id, month, max(label) AS label,
                   sum(att_actual) AS att_actual,
                   sum(media_actual) AS media_actual,
                   sum(bundle_actual) AS bundle_actual
            FROM month_rows
            GROUP BY aptem_id, month
        ), attendance_months AS (
            SELECT aptem_id,
                   jsonb_agg(
                       jsonb_build_object(
                           'month', month, 'label', label, 'planned', 0,
                           'actual', round(att_actual + media_actual + bundle_actual, 2),
                           'not_accepted', 0,
                           'att_actual', round(att_actual, 2), 'asg_actual', 0,
                           'media_actual', round(media_actual, 2),
                           'bundle_actual', round(bundle_actual, 2),
                           'unallocated_actual', 0
                       ) ORDER BY month
                   ) AS months
            FROM combined_month_rows
            GROUP BY aptem_id
        ), ilr_profiles AS (
            SELECT DISTINCT ON (lower(email))
                   lower(email) AS email_key,
                   planned_hours
            FROM "Audit".ilr_learning_deliveries
            WHERE email IS NOT NULL
              AND planned_hours IS NOT NULL
            ORDER BY lower(email), aim_seq_number,
                     updated_at DESC NULLS LAST, id DESC
        )
        SELECT l.aptem_id, l.learner_name, l.learner_email, l.programme_name,
               l.programme_status, l.coach_name, l.coach_email,
               l.declared_lms_id,
               l.learner_id AS verified_lms_id,
               COALESCE(lg.groups, ARRAY[]::text[]) AS groups,
               COALESCE(rt.activity_count, 0) + COALESCE(at.attendance_count, 0) AS activity_count,
               COALESCE(rt.activity_count, 0) AS lms_activity_count,
               COALESCE(at.attendance_count, 0) AS attendance_count,
               COALESCE(rt.completed_count, 0) + COALESCE(at.attended_count, 0) AS completed_count,
               COALESCE(rt.mapped_count, 0) + COALESCE(at.mapped_count, 0) AS mapped_count,
               COALESCE(rt.mapped_count, 0) AS lms_mapped_count,
               COALESCE(rt.mapped_seconds, 0) AS lms_mapped_seconds,
               COALESCE(at.mapped_seconds, 0) AS attendance_seconds,
               COALESCE(lat.lms_actual_hours, 0) AS lms_actual_hours,
               ilr.planned_hours AS ilr_planned_hours,
               COALESCE(am.months, '[]'::jsonb) AS months
        FROM {LEARNERS} l
        LEFT JOIN learner_groups lg ON lg.learner_id = l.learner_id
        LEFT JOIN result_totals rt ON rt.learner_id = l.learner_id
        LEFT JOIN attendance_totals at ON at.aptem_id = l.aptem_id
        LEFT JOIN attendance_months am ON am.aptem_id = l.aptem_id
        LEFT JOIN lms_actual_totals lat ON lat.aptem_id = l.aptem_id
        LEFT JOIN ilr_profiles ilr ON ilr.email_key = lower(l.learner_email)
        {where}
        ORDER BY lower(COALESCE(l.learner_name, '')), l.aptem_id
    """
    try:
        with _connection().cursor() as cursor:
            cursor.execute(sql, params)
            rows = _dict_rows(cursor)
            # Manual plan aggregates (per learner, per month) folded into the
            # cohort payload below so the search table, journal header stats,
            # month pickers, and the PDF all see the plan.
            plan_overlay = plan_cohort_overlay(cursor)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read Manual_audit learners.", "details": str(error)},
            status=503,
        )

    rows = [
        row for row in rows
        if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
    ]
    all_programmes = sorted({row["programme_name"] for row in rows if row["programme_name"]})
    learners = []
    for row in rows:
        programmes = [row["programme_name"]] if row["programme_name"] else []
        mapped_count = int(row["lms_mapped_count"])
        lms_activity_count = int(row["lms_activity_count"])
        actual_hours_available = lms_activity_count > 0 and mapped_count == lms_activity_count
        lms_matched = row["verified_lms_id"] is not None
        flags = []
        if not lms_matched:
            flags.append("lms_not_matched")
        if int(row["lms_activity_count"]) > 0 and int(row["lms_mapped_count"]) == 0:
            flags.append("hours_not_mapped")
        learners.append({
            "aptem_id": int(row["aptem_id"]),
            "lms_id": int(row["verified_lms_id"]) if lms_matched else None,
            "declared_lms_id": int(row["declared_lms_id"]) if row["declared_lms_id"] is not None else None,
            "lms_matched": lms_matched,
            "learner_name": row["learner_name"] or f"Learner {row['aptem_id']}",
            "learner_email": row["learner_email"],
            "programme": programmes[0] if programmes else "Unassigned",
            "programmes": programmes,
            "groups": list(row["groups"]),
            "withdrawn": str(row["programme_status"] or "").strip().lower() == "withdrawn",
            "programme_status": row["programme_status"] or "Unknown",
            "coach_name": row["coach_name"],
            "coach_email": row["coach_email"],
            # This is the same ILR value used by the rich learner profile.
            # A missing ILR row is unavailable data, not a real zero.
            "planned_total": float(row["ilr_planned_hours"]) if row["ilr_planned_hours"] is not None else 0.0,
            "planned_hours_available": row["ilr_planned_hours"] is not None,
            # Claimed hours = the sum of the learner's per-activity Actual
            # hours (attendance + LMS, same per-row precedence as the feed),
            # so the header stat always reconciles with the visible rows.
            "actual_total": round(
                float(row["lms_actual_hours"]) + float(row["attendance_seconds"]) / 3600, 2
            ),
            "not_accepted_total": 0.0,
            "hours_mapped": (
                actual_hours_available
                or float(row["lms_actual_hours"]) > 0
                or float(row["attendance_seconds"]) > 0
            ),
            "mapped_activity_count": mapped_count,
            "activity_count": int(row["activity_count"]),
            "lms_activity_count": lms_activity_count,
            "attendance_count": int(row["attendance_count"]),
            "completed_count": int(row["completed_count"]),
            "flags": flags,
            "months": _json_list(row["months"]),
        })
    for learner in learners:
        merge_learner_months(learner, plan_overlay.get(learner["aptem_id"]))
    return JsonResponse({
        "source": "Manual_audit",
        "programmes": all_programmes,
        "learners": learners,
    })


@require_GET
def activities(request: HttpRequest) -> JsonResponse:
    """Return LMS and linked attendance rows for one Aptem-linked learner."""
    try:
        aptem_id = _as_int(request.GET.get("aptem_id"), minimum=1)
        limit = _as_int(request.GET.get("limit"), default=10000, minimum=1, maximum=20000)
        offset = _as_int(request.GET.get("offset"), default=0, minimum=0)
    except (TypeError, ValueError) as error:
        return JsonResponse({"error": f"Invalid query parameters: {error}"}, status=400)
    if aptem_id is None:
        return JsonResponse({"error": "aptem_id (int) is required"}, status=400)

    category = (request.GET.get("category") or "").strip()
    search = (request.GET.get("search") or "").strip()
    month = (request.GET.get("month") or "").strip()
    try:
        with _connection().cursor() as cursor:
            cursor.execute(
                f"SELECT learner_id, learner_name FROM {LEARNERS} WHERE aptem_id=%s",
                [aptem_id],
            )
            learner = cursor.fetchone()
            if not learner:
                return JsonResponse({"error": f"no learner {aptem_id}"}, status=404)
            learner_id, learner_name = learner
            if is_excluded_learner(aptem_id, learner_name):
                return JsonResponse({"error": "Learner not found."}, status=404)

            lms_rows = []
            if learner_id is not None and category.lower() != "attendance":
                conditions = ["r.learner_id = %s"]
                params = [learner_id]
                if month == "undated":
                    conditions.append("a.activity_date IS NULL")
                elif month:
                    conditions.append("to_char(a.activity_date, 'YYYY-MM') = %s")
                    params.append(month)
                if category:
                    conditions.append("lower(r.activity_type) = lower(%s)")
                    params.append("Reading+Quiz" if category.lower() == "reading+quiz" else category)
                if search:
                    conditions.append("(a.title ILIKE %s OR CAST(a.activity_id AS text) ILIKE %s)")
                    params.extend([f"%{search}%", f"%{search}%"])
                cursor.execute(f"""
                    SELECT r.group_id, r.learner_id, l.aptem_id, l.learner_name,
                           g.group_name, r.activity_id,
                           COALESCE(a.activity_type, r.activity_type) AS activity_type,
                           a.title, a.activity_date,
                           a.video_iframe_url, a.reading_iframe_url,
                           a.reading_type, a.reading_text_body,
                           a.quiz_id, a.quiz_questions,
                           a.configured_duration_min, a.first_seen, r.status,
                           r.video_started, r.video_completed, r.reading_viewed,
                           r.quiz_attempted, r.quiz_passed, r.quiz_score,
                           r.quiz_maximum_score, r.mapped_seconds, r.mapped_hours,
                           {_OTJH_COLS}
                    FROM {ACTIVITY_RESULTS} r
                    JOIN {LEARNERS} l ON l.learner_id = r.learner_id
                    JOIN {ACTIVITIES} a ON a.activity_id = r.activity_id
                    LEFT JOIN {GROUPS} g ON g.group_id = r.group_id
                    {_OTJH_JOIN}
                    WHERE {' AND '.join(conditions)}
                """, params)
                lms_rows = _dict_rows(cursor)

            attendance_rows = []
            if month != "undated" and category.lower() in ("", "attendance"):
                conditions = ["la.aptem_id = %s"]
                params = [aptem_id]
                if month:
                    conditions.append("to_char(la.attendance_date, 'YYYY-MM') = %s")
                    params.append(month)
                if search:
                    conditions.append("(la.lecture_name ILIKE %s OR la.module ILIKE %s OR la.source_key ILIKE %s)")
                    params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])
                cursor.execute(f"""
                    SELECT la.*, l.learner_name
                    FROM {LEARNER_ATTENDANCE} la
                    JOIN {LEARNERS} l ON l.aptem_id = la.aptem_id
                    WHERE {' AND '.join(conditions)}
                """, params)
                attendance_rows = _dict_rows(cursor)

            # Manual plan rows for this learner, in the same wire shape. Their
            # claims suppress the mirror rows they supersede (same LMS material
            # or same attendance session) so nothing is ever double-counted.
            plan_rows, plan_claims = plan_rows_for_learner(
                cursor, aptem_id, month=month, category=category, search=search,
            )
            overlay_touched = _overlay_touched_ids(cursor, aptem_id)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read Manual_audit activities.", "details": str(error)},
            status=503,
        )
    all_items = [_activity_payload(row) for row in lms_rows]
    all_items.extend(_attendance_payload(row) for row in attendance_rows)
    all_items, plan_suppressed_ids = suppress_claimed_mirror_rows(all_items, plan_claims)
    # After suppression (so a plan claim on either half wins), fold split
    # reading/quiz halves of one learning activity into a single row.
    all_items = merge_reading_quiz_rows(all_items, protected_ids=overlay_touched)
    all_items.extend(plan_rows)
    all_items.sort(key=lambda item: (
        item["date"] is None,
        item["date"] or "",
        (item.get("group_name") or "").lower(),
        item["activity"].lower(),
        str(item["activity_id"]),
    ))
    total = len(all_items)
    mapped = [item for item in all_items if item["hours_mapped"]]
    items = all_items[offset:offset + limit]
    return JsonResponse({
        "source": "Manual_audit",
        "aptem_id": aptem_id,
        "learner_name": learner_name,
        "month": month or None,
        "count": total,
        "planned_total": 0.0,
        "actual_total": round(sum(item["actual"] for item in mapped), 2),
        "hours_mapped": bool(mapped),
        "limit": limit,
        "offset": offset,
        # Mirror rows a plan superseded — the client overlay merge must skip
        # overlays keyed to these ids instead of resurrecting them.
        "plan_suppressed_ids": plan_suppressed_ids,
        "activities": items,
    })


def _grouped(participants):
    """Nest participants under their cohort so the UI can show them grouped."""
    buckets, order = {}, []
    for p in participants:
        key = (p.get("group_id"), p.get("group_name"))
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(p)
    return [{"group_id": k[0], "group_name": k[1],
             "participant_count": len(buckets[k]), "participants": buckets[k]}
            for k in order]


@require_GET
def activity(request: HttpRequest) -> JsonResponse:
    """Return a shared definition and all learner results for one activity.

    Learners are grouped by their cohort (`groups[]`). For attendance the
    activity is a live session: we match on the session key (the source_key with
    the leading learner id removed = date + lecture), so every learner in that
    session appears — attended or not — not just the one whose key was clicked.
    """
    raw_id = request.GET.get("activity_id") or request.GET.get("component_id")
    if str(raw_id or "").startswith("plan:"):
        # Manual plan activity -> participants come from the plan tables
        # (group members x confirmed progress), closing the who-completed gap
        # that ad-hoc overlay rows have always had.
        try:
            with _connection().cursor() as cursor:
                detail = plan_activity_detail(cursor, str(raw_id)[5:])
        except DatabaseError as error:
            return JsonResponse(
                {"error": "Could not read the manual plan activity.", "details": str(error)},
                status=503,
            )
        if not detail:
            return JsonResponse({"error": f"no manual plan activity {raw_id}"}, status=404)
        return JsonResponse(detail)
    if str(raw_id or "").startswith("att:"):
        session_key = _session_key(raw_id)      # 'att:{id}_{date}_{slug}' -> '{date}_{slug}'
        if not session_key:
            return JsonResponse({"error": "invalid attendance key"}, status=400)
        try:
            with _connection().cursor() as cursor:
                cursor.execute(f"""
                    SELECT la.*, l.learner_name
                    FROM {LEARNER_ATTENDANCE} la
                    JOIN {LEARNERS} l ON l.aptem_id = la.aptem_id
                    WHERE substring(la.source_key from position('_' in la.source_key) + 1) = %s
                    ORDER BY (la.attendance_value = 1) DESC,
                             lower(COALESCE(l.learner_name, '')), la.aptem_id
                """, [session_key])
                rows = _dict_rows(cursor)
        except DatabaseError as error:
            return JsonResponse(
                {"error": "Could not read Manual_audit attendance.", "details": str(error)},
                status=503,
            )
        rows = [
            row for row in rows
            if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
        ]
        if not rows:
            return JsonResponse({"error": f"no Manual_audit attendance {raw_id}"}, status=404)
        items = [_attendance_payload(row) for row in rows]
        first = items[0]
        participants = [{
            "learner_id": item["learner_id"],
            "learner_name": item["learner_name"],
            "found_as": "attendance",
            "activity": item["activity"],
            "completed": item["completed"],
            "reading_completed": False,
            "quiz_attempted": False,
            "quiz_passed": False,
            "actual": item["actual"] if item["hours_mapped"] else None,
            "planned": None,
            "reporting_method": "Attendance",
            "month": item["month"] or None,
            "date": item["date"],
            "timestamp_from": None,
            "timestamp_to": None,
            "timestamp_display": item["timestamp_display"],
            "item_title": item.get("group_name"),
            "status": item["status"],
            "group_id": None,
            "group_name": item.get("group_name"),
        } for item in items]
        return JsonResponse({
            "source": "Manual_audit",
            "component_id": first["activity_id"],
            "source_activity_id": session_key,
            "session_key": session_key,
            "activity": first["activity"],
            "category": "attendance",
            "has_reading": False,
            "has_quiz": False,
            "participant_count": len(participants),
            "completed_count": sum(1 for p in participants if p["completed"]),
            "reading_completed_count": 0,
            "quiz_attempted_count": 0,
            "quiz_completed_count": 0,
            "items": [],
            "item_count": 0,
            "participants": participants,
            "groups": _grouped(participants),
        })
    try:
        group_id, activity_id = _parse_activity_ref(raw_id)
    except (TypeError, ValueError):
        return JsonResponse({"error": "activity_id is required"}, status=400)

    conditions = ["r.activity_id = %s"]
    params = [activity_id]
    if group_id is not None:
        conditions.append("r.group_id = %s")
        params.append(group_id)
    sql = f"""
        SELECT r.group_id, r.learner_id, l.aptem_id, l.learner_name,
               g.group_name, r.activity_id,
               COALESCE(a.activity_type, r.activity_type) AS activity_type,
               a.title, a.activity_date,
               a.video_iframe_url, a.reading_iframe_url,
               a.reading_type, a.quiz_id, a.quiz_questions,
               a.configured_duration_min, r.status,
               r.video_started, r.video_completed, r.reading_viewed,
               r.quiz_attempted, r.quiz_passed, r.quiz_score,
               r.quiz_maximum_score, r.mapped_seconds, r.mapped_hours,
               {_OTJH_COLS}
        FROM {ACTIVITY_RESULTS} r
        JOIN {LEARNERS} l ON l.learner_id = r.learner_id
        JOIN {ACTIVITIES} a ON a.activity_id = r.activity_id
        LEFT JOIN {GROUPS} g ON g.group_id = r.group_id
        {_OTJH_JOIN}
        WHERE {' AND '.join(conditions)}
        ORDER BY lower(COALESCE(g.group_name, '')), r.group_id,
                 lower(COALESCE(l.learner_name, '')), l.learner_id
    """
    try:
        with _connection().cursor() as cursor:
            cursor.execute(sql, params)
            rows = _dict_rows(cursor)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read Manual_audit activity.", "details": str(error)},
            status=503,
        )
    rows = [
        row for row in rows
        if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
    ]
    if not rows:
        return JsonResponse({"error": f"no Manual_audit activity {raw_id}"}, status=404)

    items = [_activity_payload(row) for row in rows]
    first = items[0]
    participants = [{
        "learner_id": item["learner_id"],
        "learner_name": item["learner_name"],
        "found_as": item["category"],
        "activity": item["activity"],
        "completed": item["completed"],
        "reading_completed": item["reading_viewed"] is True,
        "quiz_attempted": item["quiz_attempted"] is True,
        "quiz_passed": item["quiz_passed"] is True,
        "actual": item["actual"] if item["hours_mapped"] else None,
        "planned": item["planned"] or None,
        "reporting_method": item.get("reporting_method"),
        "month": item["month"] or None,
        "date": item["date"],
        "timestamp_from": item["timestamp_from"],
        "timestamp_to": item["timestamp_to"],
        "timestamp_display": item["timestamp_display"],
        "item_title": None,
        "status": item["status"],
        "group_id": item["group_id"],
        "group_name": item["group_name"],
    } for item in items]
    return JsonResponse({
        "source": "Manual_audit",
        "component_id": first["activity_id"],
        "source_activity_id": activity_id,
        "groups": _grouped(participants),
        "activity": first["activity"],
        "category": first["category"],
        "has_reading": first["has_reading"],
        "has_quiz": first["has_quiz"],
        "participant_count": len(participants),
        "completed_count": sum(1 for item in participants if item["completed"]),
        "reading_completed_count": sum(
            1 for item in participants if item["reading_completed"]
        ),
        "quiz_attempted_count": sum(
            1 for item in participants if item["quiz_attempted"]
        ),
        "quiz_completed_count": sum(
            1 for item in participants if item["quiz_passed"]
        ),
        "items": [],
        "item_count": 0,
        "participants": participants,
    })


@require_GET
def quiz_attempt(request: HttpRequest) -> JsonResponse:
    """Return one Manual_audit learner's normalized quiz definition and answers."""
    raw_id = request.GET.get("component_id") or request.GET.get("component")
    plan_ref = str(raw_id or "").startswith("plan:")
    lms_ref = str(raw_id or "").startswith("lms:")
    try:
        aptem_id = _as_int(request.GET.get("aptem_id"), minimum=1)
        if plan_ref:
            group_id = None
            activity_id = None  # resolved from the plan's material_ref below
        elif lms_ref:
            # Bundle pieces reference the catalogue directly (lms:<id>).
            group_id = None
            activity_id = _as_int(str(raw_id)[4:], minimum=1)
            if activity_id is None:
                raise ValueError("invalid lms ref")
        else:
            group_id, activity_id = _parse_activity_ref(raw_id)
    except (TypeError, ValueError):
        return JsonResponse(
            {"error": "aptem_id and component_id are required"},
            status=400,
        )
    if aptem_id is None:
        return JsonResponse(
            {"error": "aptem_id and component_id are required"},
            status=400,
        )
    if is_excluded_learner(aptem_id):
        return JsonResponse({"error": "Learner not found."}, status=404)

    try:
        with _connection().cursor() as cursor:
            if plan_ref:
                activity_id = resolve_plan_material_lms_id(cursor, str(raw_id)[5:])
                if activity_id is None:
                    # Not an LMS-backed material -> nothing quiz-like to show.
                    return JsonResponse({
                        "component_id": str(raw_id),
                        "source_activity_id": None,
                        "aptem_id": aptem_id,
                        "is_quiz": False,
                        "state": "not_quiz",
                        "attempt": None,
                    })
            conditions = ["r.activity_id = %s", "l.aptem_id = %s"]
            params = [activity_id, aptem_id]
            if group_id is not None:
                conditions.append("r.group_id = %s")
                params.append(group_id)
            cursor.execute(f"""
                SELECT r.group_id, r.activity_id, l.aptem_id, l.learner_name,
                       a.title, a.quiz_id, a.quiz_body, a.quiz_questions,
                       r.quiz_attempted, r.quiz_passed, r.quiz_score,
                       r.quiz_maximum_score, r.quiz_attempt_number,
                       r.quiz_answers
                FROM {ACTIVITY_RESULTS} r
                JOIN {LEARNERS} l ON l.learner_id = r.learner_id
                JOIN {ACTIVITIES} a ON a.activity_id = r.activity_id
                WHERE {' AND '.join(conditions)}
                ORDER BY (r.quiz_passed IS TRUE) DESC,
                         r.quiz_attempt_number DESC NULLS LAST, r.group_id
                LIMIT 1
            """, params)
            rows = _dict_rows(cursor)
            if not rows and (plan_ref or lms_ref):
                # A plan member who never had the activity in the LMS still
                # deserves the quiz definition (state: not_attempted) instead
                # of a 404 — the builder's main use case.
                cursor.execute(f"""
                    SELECT NULL AS group_id, a.activity_id, %s AS aptem_id,
                           a.title, a.quiz_id, a.quiz_body, a.quiz_questions,
                           NULL AS quiz_attempted, NULL AS quiz_passed,
                           NULL AS quiz_score, NULL AS quiz_maximum_score,
                           NULL AS quiz_attempt_number, NULL AS quiz_answers
                    FROM {ACTIVITIES} a
                    WHERE a.activity_id = %s
                """, [aptem_id, activity_id])
                rows = _dict_rows(cursor)
    except DatabaseError as error:
        return JsonResponse(
            {"error": "Could not read Manual_audit quiz attempt.", "details": str(error)},
            status=503,
        )
    rows = [
        row for row in rows
        if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
    ]
    if not rows:
        return JsonResponse(
            {"error": "No matching Manual_audit learner activity."},
            status=404,
        )
    if plan_ref:
        component_id = str(raw_id)
    else:
        component_id = (
            _activity_ref(group_id, activity_id)
            if group_id is not None else str(activity_id)
        )
    return JsonResponse(_quiz_attempt_payload(rows[0], component_id))


# --- attendance sheet (one live session, every assigned learner) ------------
#
# An attendance ``source_key`` is ``"{aptem_id}_{YYYY-MM-DD}_{lecture_slug}"``.
# Dropping the leading learner id leaves the SESSION identity shared by every
# learner assigned to that lecture on that date — attended or not. That suffix
# is the join key for the "attendance sheet": one row per learner, each marked
# attended/absent from ``attendance_value``.

def _session_key(source_key):
    """Return the session identity (``source_key`` minus the leading learner id),
    i.e. ``"{date}_{lecture_slug}"``, or ``None`` if the key is not composite."""
    raw = str(source_key or "").strip()
    if raw.startswith("att:"):
        raw = raw[len("att:"):]
    if "_" not in raw:
        return None
    return raw.split("_", 1)[1]


def _attendance_sheet_payload(rows, session_key):
    """Build the roster response from raw ``learner_attendance`` rows.

    Kept separate from the view (and DB) so it is unit-testable the same way
    ``_attendance_payload`` is. ``rows`` all share one ``session_key``."""
    attendees = [_attendance_payload(row) for row in rows]
    attended = sum(1 for row in rows if row.get("attendance_value") == 1)
    first = rows[0] if rows else {}
    session_date = first.get("attendance_date")
    return {
        "session": {
            "session_key": session_key,
            "date": session_date.isoformat() if session_date else None,
            "lecture_name": first.get("lecture_name") or first.get("module"),
            "module": first.get("module"),
        },
        "items": attendees,
        "total": len(attendees),
        "counts": {
            "assigned": len(attendees),
            "attended": attended,
            "absent": len(attendees) - attended,
        },
        "planned_total": 0.0,
        "actual_total": round(sum(item["actual"] or 0 for item in attendees), 2),
        "limit": len(attendees),
        "offset": 0,
    }


@require_GET
def attendance_sheet(request: HttpRequest) -> JsonResponse:
    """Roster for one live session: every learner sharing the session key, each
    marked attended/absent. Given any single learner's attendance key (the full
    ``source_key`` or its ``att:`` ref), matches on the key with the leading
    learner id removed, so the whole assigned cohort is returned regardless of
    programme. Reads ``Manual_audit.learner_attendance`` only; writes nothing."""
    session_key = _session_key(request.GET.get("key"))
    if not session_key:
        return JsonResponse(
            {"error": "key must look like <id>_<YYYY-MM-DD>_<lecture>"},
            status=400,
        )
    try:
        with _connection().cursor() as cursor:
            cursor.execute(f"""
                SELECT la.source_key, la.aptem_id, la.learner_id,
                       la.attendance_date, la.attendance_value, la.attendance_status,
                       la.module, la.lecture_name, la.activity_hours,
                       l.learner_name
                FROM {LEARNER_ATTENDANCE} la
                LEFT JOIN {LEARNERS} l ON l.aptem_id = la.aptem_id
                WHERE substring(la.source_key from position('_' in la.source_key) + 1) = %s
                ORDER BY (la.attendance_value = 1) DESC,
                         l.learner_name NULLS LAST, la.aptem_id
            """, [session_key])
            rows = _dict_rows(cursor)
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not read Manual_audit attendance.", "details": str(error)},
            status=503,
        )
    rows = [
        row for row in rows
        if not is_excluded_learner(row.get("aptem_id"), row.get("learner_name"))
    ]
    if not rows:
        return JsonResponse(
            {"error": f"No attendance session for '{session_key}'."},
            status=404,
        )
    return JsonResponse(_attendance_sheet_payload(rows, session_key))
