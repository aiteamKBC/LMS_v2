"""Project plan-builder rows into the ledger wire shape.

The Learner Journal / Activity Log stay pure viewers: ``ledger_views`` calls
into this module to (1) append each learner's plan rows in the exact
``LiveActivity`` shape the frontend already consumes, (2) suppress the mirror
rows a plan row supersedes (same material / same attendance session — the
no-double-counting contract), and (3) fold plan aggregates into the cohort
response so the search table, journal header stats, month pickers and the PDF
all see the plan.

Bucketing rule (fixed by design): a plan row always buckets under its PLAN
month (``plan_months.calendar_month``) — completion_date is displayed on the
row but never moves it between months, so signed months stay stable.
"""

import datetime
import json
import uuid
from urllib.parse import parse_qs, urlparse

from .plan_tables import assignment_name_key, ensure_plan_tables

# Plan tables are created lazily once per process so a fresh mirror-only
# database never 503s the whole workspace just because the builder was not
# set up yet (setup_manual_audit also creates them).
_TABLES_READY = False


def _ensure_ready(cursor):
    global _TABLES_READY
    if not _TABLES_READY:
        # ensure_plan_tables returns False while Neon has the endpoint
        # read-only (DDL skipped) — don't latch then, or a process that
        # started during a read-only window would never self-heal the tables.
        if ensure_plan_tables(cursor) is not False:
            _TABLES_READY = True


def parse_plan_key(raw):
    """'plan:<uuid>' (or a bare uuid) -> canonical uuid string, else None."""
    text = str(raw or "").strip()
    if text.startswith("plan:"):
        text = text[5:]
    try:
        return str(uuid.UUID(text))
    except (ValueError, AttributeError):
        return None


def activity_content_url(video_url, reading_url, reading_type=None):
    """Browser-renderable content URL, unwrapping PDF-only Office viewers.

    Shared by mirror rows (ledger_views) and plan rows so an identical
    catalogue material renders identically from both sources.
    """
    if video_url:
        return video_url
    if not reading_url or str(reading_type or "").strip().lower() != "pdf":
        return reading_url
    try:
        parsed = urlparse(reading_url)
        if parsed.netloc.lower() != "view.officeapps.live.com":
            return reading_url
        source = parse_qs(parsed.query).get("src", [None])[0]
        if source and urlparse(source).scheme in ("http", "https"):
            return source
    except (TypeError, ValueError):
        pass
    return reading_url


def _ksbs_dict(value):
    """jsonb can surface as dict or str depending on the driver adapter."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return None
        return parsed if isinstance(parsed, dict) else None
    return None

# SQL twin of plan_tables.assignment_name_key — keep the two in sync.
_SLUG_SQL = (
    "coalesce(nullif(btrim(regexp_replace(lower(btrim(coalesce({column}, ''))), "
    "'[^a-z0-9]+', '-', 'g'), '-'), ''), 'unnamed')"
)


def _month_label(month):
    try:
        return datetime.datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    except (TypeError, ValueError):
        return month or "Not dated"


def _resolve_date(member_date, planned_date, anchor_date, calendar_month, week_slot):
    """Member override > activity date > month anchor + weeks > month 1st + weeks."""
    if member_date:
        return member_date
    if planned_date:
        return planned_date
    offset = datetime.timedelta(days=(max(int(week_slot or 1), 1) - 1) * 7)
    if anchor_date:
        return anchor_date + offset
    try:
        first = datetime.date.fromisoformat(f"{calendar_month}-01")
    except (TypeError, ValueError):
        return None
    return first + offset


_PLAN_ROWS_SQL = '''
    select a.activity_key, a.group_id, g.name as group_name, a.month_index,
           a.week_slot, a.position, a.category, a.title, a.subtitle,
           a.material_ref, a.planned_hours, a.planned_date, a.ksbs,
           coalesce(mm.calendar_month, m.calendar_month) as calendar_month,
           coalesce(mm.anchor_date, m.anchor_date) as anchor_date,
           md.planned_date as member_date,
           p.status as progress_status, p.completion_date, p.actual_hours,
           p.attendance_status, p.quiz_attempted, p.quiz_passed,
           p.reading_viewed, p.note, p.timestamp_from, p.timestamp_to,
           p.rejected,
           cat.video_iframe_url, cat.reading_iframe_url, cat.reading_type,
           cat.quiz_id as catalog_quiz_id, cat.reading_text_body,
           l.learner_name, a.created_at
    from "Manual_audit".plan_activities a
    join "Manual_audit".plan_groups g
      on g.id = a.group_id and g.status = 'active'
    join "Manual_audit".plan_group_members pm
      on pm.group_id = a.group_id and pm.aptem_id = %(aptem_id)s and pm.left_at is null
    join "Manual_audit".plan_months m
      on m.group_id = a.group_id and m.month_index = a.month_index
    left join "Manual_audit".plan_member_months mm
      on mm.group_id = a.group_id and mm.aptem_id = %(aptem_id)s
     and mm.month_index = a.month_index
    left join "Manual_audit".plan_member_dates md
      on md.group_id = a.group_id and md.aptem_id = %(aptem_id)s
     and md.activity_key = a.activity_key
    left join "Manual_audit".plan_learner_progress p
      on p.aptem_id = %(aptem_id)s and p.activity_key = a.activity_key
     and p.archived_at is null
    left join "Manual_audit".plan_activity_exemptions x
      on x.activity_key = a.activity_key and x.aptem_id = %(aptem_id)s
    left join "Manual_audit".activities cat
      on a.material_ref = 'lms:' || cat.activity_id::text
    left join "Manual_audit".learners l on l.aptem_id = %(aptem_id)s
    where a.included and x.aptem_id is null
    order by m.calendar_month, a.week_slot, a.position, a.created_at
'''


def _plan_row_payload(row, aptem_id):
    (
        activity_key, group_id, group_name, _month_index, week_slot, _position,
        category, title, subtitle, material_ref, planned_hours, planned_date,
        ksbs, calendar_month, anchor_date, member_date, progress_status,
        completion_date, actual_hours, attendance_status, quiz_attempted,
        quiz_passed, reading_viewed, note, timestamp_from, timestamp_to,
        rejected, video_iframe_url, reading_iframe_url, reading_type,
        catalog_quiz_id, reading_text_body, learner_name, created_at,
    ) = row

    # A rejected suggestion means "treat as nothing happened".
    has_progress = progress_status is not None and not rejected
    completed = has_progress and progress_status == "completed"
    not_accepted = has_progress and progress_status == "not_accepted"
    actual = float(actual_hours) if has_progress and actual_hours is not None else 0.0

    display_date = completion_date if (has_progress and completion_date) else _resolve_date(
        member_date, planned_date, anchor_date, calendar_month, week_slot,
    )

    if category == "attendance":
        if not has_progress or attendance_status is None:
            timestamp_display = ""
        elif attendance_status in {"attended", "makeup"}:
            timestamp_display = "attended"
        else:
            timestamp_display = "not attended"
    elif timestamp_from and timestamp_to:
        timestamp_display = f"{timestamp_from:%H:%M}–{timestamp_to:%H:%M}"
    elif actual > 0:
        timestamp_display = "input"
    else:
        timestamp_display = ""

    iframe_url = None
    if material_ref and material_ref.startswith("lms:"):
        # Catalog-resolved only — never auditor-typed (design invariant); the
        # Office-PDF unwrap keeps plan rows identical to mirror rows.
        iframe_url = activity_content_url(video_iframe_url, reading_iframe_url, reading_type)

    ksbs_payload = _ksbs_dict(ksbs)

    return {
        "activity_id": f"plan:{activity_key}",
        "source_activity_id": str(activity_key),
        "group_id": None,
        "group_name": group_name,
        "learner_id": int(aptem_id),
        "lms_learner_id": None,
        "learner_name": learner_name or f"Learner {aptem_id}",
        "date": display_date.isoformat() if display_date else None,
        # Fixed bucketing: the plan month, never the completion month.
        "month": calendar_month,
        "month_label": _month_label(calendar_month),
        "category": category,
        "activity": title,
        "activity_subtitle": subtitle or note,
        "planned": float(planned_hours) if planned_hours is not None else 0.0,
        "actual": actual,
        "mapped_seconds": int(round(actual * 3600)) if has_progress else None,
        # Plan rows are auditor-owned: their hours are always "mapped".
        "hours_mapped": True,
        "reporting_method": "Manual plan",
        "timestamp_from": timestamp_from.strftime("%H:%M:%S") if timestamp_from else None,
        "timestamp_to": timestamp_to.strftime("%H:%M:%S") if timestamp_to else None,
        "timestamp_display": timestamp_display,
        "status": progress_status or "planned",
        "completed": completed,
        "not_accepted": not_accepted,
        "video_started": None,
        "video_completed": None,
        "reading_viewed": bool(reading_viewed) if has_progress and reading_viewed is not None else None,
        "quiz_attempted": bool(quiz_attempted) if has_progress and quiz_attempted is not None else None,
        "quiz_passed": bool(quiz_passed) if has_progress and quiz_passed is not None else None,
        "quiz_score": None,
        "quiz_maximum_score": None,
        "has_reading": bool(reading_iframe_url or reading_text_body),
        "has_quiz": catalog_quiz_id is not None,
        "configured_duration_minutes": None,
        "ksbs": ksbs_payload,
        "iframe_url": iframe_url,
        "reporting_week_label": f"Week {week_slot}",
        "created_at": created_at.isoformat() if created_at else None,
        "source": "Manual_audit",
        "plan": {
            "activity_key": str(activity_key),
            "group_id": group_id,
            "group_name": group_name,
            "material_ref": material_ref,
        },
    }


def plan_rows_for_learner(cursor, aptem_id, *, month="", category="", search=""):
    """All projected plan rows for one learner + the claims they make.

    Returns ``(rows, claims)`` where rows already honour the month/category/
    search filters, and claims cover EVERY plan row (unfiltered) so mirror
    suppression works in the all-months view too:
    ``claims = {"lms_ids": {int}, "sessions": {(module_slug, iso_date)}}``.
    """
    _ensure_ready(cursor)
    cursor.execute(_PLAN_ROWS_SQL, {"aptem_id": aptem_id})
    raw = cursor.fetchall()

    claims = {"lms_ids": set(), "sessions": set()}
    rows = []
    needle = (search or "").strip().lower()
    for record in raw:
        payload = _plan_row_payload(record, aptem_id)
        ref = payload["plan"]["material_ref"] or ""
        if ref.startswith("lms:"):
            try:
                claims["lms_ids"].add(int(ref[4:]))
            except ValueError:
                pass
        elif ref.startswith("session:"):
            parts = ref.split(":")
            if len(parts) == 3:
                claims["sessions"].add((parts[1], parts[2]))
        if month and payload["month"] != month:
            continue
        if category and payload["category"].lower() != category.lower():
            continue
        if needle and needle not in payload["activity"].lower() and needle not in payload["activity_id"].lower():
            continue
        rows.append(payload)
    return rows, claims


def suppress_claimed_mirror_rows(items, claims):
    """Drop mirror rows a plan row supersedes (LMS materials + sessions).

    Returns ``(kept, dropped_ids)``. The dropped ids travel to the frontend so
    the client-side overlay merge can skip overlays keyed to superseded mirror
    rows instead of resurrecting them next to the plan row.
    """
    if not claims["lms_ids"] and not claims["sessions"]:
        return items, []
    kept, dropped = [], []
    for item in items:
        if item.get("source") != "Manual_audit" or str(item.get("activity_id", "")).startswith("plan:"):
            kept.append(item)
            continue
        ref = str(item.get("activity_id") or "")
        if ref.startswith("la:"):
            if item.get("source_activity_id") in claims["lms_ids"]:
                dropped.append(ref)
                continue
        elif ref.startswith("att:"):
            slug = assignment_name_key(item.get("group_name") or "")
            if (slug, item.get("date") or "") in claims["sessions"]:
                dropped.append(ref)
                continue
        kept.append(item)
    return kept, dropped


# --- cohort merge -------------------------------------------------------------

_PLAN_AGGREGATE_SQL = '''
    select pm.aptem_id,
           coalesce(mm.calendar_month, m.calendar_month) as calendar_month,
           count(*) as activity_count,
           coalesce(sum(a.planned_hours), 0) as planned,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'completed' and not coalesce(p.rejected, false)
                 and p.archived_at is null
           ), 0) as actual,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'completed' and not coalesce(p.rejected, false)
                 and p.archived_at is null and a.category = 'attendance'
           ), 0) as att_actual,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'completed' and not coalesce(p.rejected, false)
                 and p.archived_at is null and a.category = 'assignment'
           ), 0) as asg_actual,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'completed' and not coalesce(p.rejected, false)
                 and p.archived_at is null and a.category in ('video', 'audio')
           ), 0) as media_actual,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'completed' and not coalesce(p.rejected, false)
                 and p.archived_at is null and a.category = 'reading+quiz'
           ), 0) as bundle_actual,
           coalesce(sum(p.actual_hours) filter (
               where p.status = 'not_accepted' and not coalesce(p.rejected, false)
                 and p.archived_at is null
           ), 0) as not_accepted
    from "Manual_audit".plan_activities a
    join "Manual_audit".plan_groups g on g.id = a.group_id and g.status = 'active'
    join "Manual_audit".plan_months m
      on m.group_id = a.group_id and m.month_index = a.month_index
    join "Manual_audit".plan_group_members pm
      on pm.group_id = a.group_id and pm.left_at is null
    left join "Manual_audit".plan_member_months mm
      on mm.group_id = a.group_id and mm.aptem_id = pm.aptem_id
     and mm.month_index = a.month_index
    left join "Manual_audit".plan_activity_exemptions x
      on x.activity_key = a.activity_key and x.aptem_id = pm.aptem_id
    left join "Manual_audit".plan_learner_progress p
      on p.aptem_id = pm.aptem_id and p.activity_key = a.activity_key
    where a.included and x.aptem_id is null
    group by pm.aptem_id, coalesce(mm.calendar_month, m.calendar_month)
'''

# Attendance hours already counted in the mirror month buckets for sessions a
# plan row claims — subtracted so the month never double-counts a session.
# The claims CTE mirrors the per-learner feed's claim rules exactly: active
# group, included activity, member not exempted, ANY category with a session
# ref — and DISTINCT so two plan rows claiming the same session subtract once.
_CLAIMED_ATTENDANCE_SQL = f'''
    with claims as (
        select distinct pm.aptem_id, a.material_ref
        from "Manual_audit".plan_activities a
        join "Manual_audit".plan_groups g on g.id = a.group_id and g.status = 'active'
        join "Manual_audit".plan_group_members pm
          on pm.group_id = a.group_id and pm.left_at is null
        left join "Manual_audit".plan_activity_exemptions x
          on x.activity_key = a.activity_key and x.aptem_id = pm.aptem_id
        where a.included and a.material_ref like 'session:%%'
          and x.aptem_id is null
    )
    select c.aptem_id,
           to_char(la.attendance_date, 'YYYY-MM') as month,
           coalesce(sum(la.activity_hours), 0) as hours,
           count(*) as row_count
    from claims c
    join "Manual_audit".learner_attendance la
      on la.aptem_id = c.aptem_id
     and c.material_ref = 'session:' || {_SLUG_SQL.format(column='la.module')}
                          || ':' || to_char(la.attendance_date, 'YYYY-MM-DD')
    group by c.aptem_id, to_char(la.attendance_date, 'YYYY-MM')
'''

# Mirror LMS rows a plan claims still sit inside the cohort's activity_count —
# counted here (same claim rules) so the counter matches the deduped feed.
_CLAIMED_LMS_COUNT_SQL = '''
    with claims as (
        select distinct pm.aptem_id,
               cast(substring(a.material_ref from 5) as bigint) as lms_id
        from "Manual_audit".plan_activities a
        join "Manual_audit".plan_groups g on g.id = a.group_id and g.status = 'active'
        join "Manual_audit".plan_group_members pm
          on pm.group_id = a.group_id and pm.left_at is null
        left join "Manual_audit".plan_activity_exemptions x
          on x.activity_key = a.activity_key and x.aptem_id = pm.aptem_id
        where a.included and a.material_ref ~ '^lms:[0-9]+$'
          and x.aptem_id is null
    )
    select c.aptem_id, count(*)
    from claims c
    join "Manual_audit".learners l on l.aptem_id = c.aptem_id
    join "Manual_audit".activity_results r
      on r.learner_id = l.learner_id and r.activity_id = c.lms_id
    group by c.aptem_id
'''


def plan_cohort_overlay(cursor):
    """Aggregates keyed by aptem_id for the cohort merge.

    Returns {aptem_id: {"months": {month: bucket}, "activity_count": int,
    "claimed": {month: hours}, "claimed_rows": int}}.
    """
    _ensure_ready(cursor)
    cursor.execute(_PLAN_AGGREGATE_SQL)
    overlay = {}
    for row in cursor.fetchall():
        (aptem_id, month, activity_count, planned, actual, att, asg,
         media, bundle, not_accepted) = row
        entry = overlay.setdefault(
            aptem_id, {"months": {}, "activity_count": 0, "claimed": {}, "claimed_rows": 0},
        )
        entry["activity_count"] += int(activity_count)
        entry["months"][month] = {
            "planned": float(planned),
            "actual": float(actual),
            "att_actual": float(att),
            "asg_actual": float(asg),
            "media_actual": float(media),
            "bundle_actual": float(bundle),
            "not_accepted": float(not_accepted),
        }
    cursor.execute(_CLAIMED_ATTENDANCE_SQL)
    for aptem_id, month, hours, row_count in cursor.fetchall():
        entry = overlay.get(aptem_id)
        if entry is not None:
            entry["claimed"][month] = float(hours)
            entry["claimed_rows"] += int(row_count)
    cursor.execute(_CLAIMED_LMS_COUNT_SQL)
    for aptem_id, row_count in cursor.fetchall():
        entry = overlay.get(aptem_id)
        if entry is not None:
            entry["claimed_rows"] += int(row_count)
    return overlay


def merge_learner_months(learner, overlay_entry):
    """Fold one learner's plan aggregates into their cohort payload in place."""
    if not overlay_entry:
        return
    months = {item["month"]: item for item in learner.get("months", [])}
    # Subtract mirror attendance hours for claimed sessions first.
    for month, hours in overlay_entry["claimed"].items():
        bucket = months.get(month)
        if bucket and hours:
            bucket["actual"] = round(max(0.0, float(bucket.get("actual", 0)) - hours), 2)
            bucket["att_actual"] = round(max(0.0, float(bucket.get("att_actual", 0)) - hours), 2)
    for month, plan_bucket in overlay_entry["months"].items():
        bucket = months.get(month)
        if bucket is None:
            bucket = {
                "month": month, "label": _month_label(month), "planned": 0,
                "actual": 0, "not_accepted": 0, "att_actual": 0, "asg_actual": 0,
                "media_actual": 0, "bundle_actual": 0, "unallocated_actual": 0,
            }
            months[month] = bucket
        for key in ("planned", "actual", "not_accepted", "att_actual",
                    "asg_actual", "media_actual", "bundle_actual"):
            bucket[key] = round(float(bucket.get(key, 0)) + plan_bucket[key], 2)
        # Marks the month as plan-backed so the frontend keeps it visible in
        # month pickers even when it is post-cutoff and planned-only.
        bucket["plan"] = True
    learner["months"] = sorted(months.values(), key=lambda item: item["month"])
    # Counter = plan rows added minus mirror rows the plan superseded, so the
    # search table's Activities column matches the deduped feed exactly.
    learner["activity_count"] = max(
        0,
        int(learner.get("activity_count", 0))
        + overlay_entry["activity_count"]
        - int(overlay_entry.get("claimed_rows", 0)),
    )
    # A learner with a plan always has meaningful planned/actual month buckets.
    if overlay_entry["months"]:
        learner["has_manual_plan"] = True


# --- who-completed / detail resolver -------------------------------------------

def plan_activity_detail(cursor, activity_key):
    """ActivityDetail-shaped payload for one plan activity (participants view).

    Only ACTIVE groups resolve here — draft/archived plans never reach the
    journals, so their activities must not resolve from journal-facing URLs
    either (the /plan/* endpoints serve the builder itself).
    """
    _ensure_ready(cursor)
    activity_key = parse_plan_key(activity_key)
    if not activity_key:
        return None
    cursor.execute(
        '''
        select a.activity_key, a.group_id, g.name, a.category, a.title, a.subtitle,
               a.material_ref, a.planned_hours, a.week_slot, a.ksbs, a.included,
               m.calendar_month, m.anchor_date, a.planned_date, a.month_index
        from "Manual_audit".plan_activities a
        join "Manual_audit".plan_groups g on g.id = a.group_id and g.status = 'active'
        left join "Manual_audit".plan_months m
          on m.group_id = a.group_id and m.month_index = a.month_index
        where a.activity_key = %s
        ''',
        [activity_key],
    )
    head = cursor.fetchone()
    if not head:
        return None
    (key, group_id, group_name, category, title, subtitle, material_ref,
     planned_hours, week_slot, ksbs, included, calendar_month, anchor_date,
     planned_date, _month_index) = head

    cursor.execute(
        '''
        select pm.aptem_id, pm.learner_name,
               p.status, p.completion_date, p.actual_hours, p.attendance_status,
               p.quiz_attempted, p.quiz_passed, p.reading_viewed, p.rejected,
               md.planned_date as member_date,
               mm.calendar_month as member_month,
               mm.anchor_date as member_anchor
        from "Manual_audit".plan_group_members pm
        left join "Manual_audit".plan_learner_progress p
          on p.aptem_id = pm.aptem_id and p.activity_key = %s and p.archived_at is null
        left join "Manual_audit".plan_member_dates md
          on md.group_id = pm.group_id and md.aptem_id = pm.aptem_id and md.activity_key = %s
        left join "Manual_audit".plan_member_months mm
          on mm.group_id = pm.group_id and mm.aptem_id = pm.aptem_id and mm.month_index = %s
        left join "Manual_audit".plan_activity_exemptions x
          on x.activity_key = %s and x.aptem_id = pm.aptem_id
        where pm.group_id = %s and pm.left_at is null and x.aptem_id is null
        order by lower(coalesce(pm.learner_name, '')), pm.aptem_id
        ''',
        [activity_key, activity_key, _month_index, activity_key, group_id],
    )
    participants = []
    completed_count = 0
    for row in cursor.fetchall():
        (aptem_id, learner_name, status, completion_date, actual_hours,
         attendance_status, quiz_attempted, quiz_passed, reading_viewed,
         rejected, member_date, member_month, member_anchor) = row
        has_progress = status is not None and not rejected
        completed = has_progress and status == "completed"
        if completed:
            completed_count += 1
        # Each learner's own training-plan month wins over the group month.
        date = completion_date or _resolve_date(
            member_date, planned_date, member_anchor or anchor_date,
            member_month or calendar_month, week_slot,
        )
        if category == "attendance":
            display = "" if not has_progress or attendance_status is None else (
                "attended" if attendance_status in {"attended", "makeup"} else "not attended"
            )
        else:
            display = "input" if has_progress and actual_hours else ""
        participants.append({
            "learner_id": aptem_id,
            "learner_name": learner_name or f"Learner {aptem_id}",
            "found_as": category,
            "activity": title,
            "completed": completed,
            "reading_completed": bool(reading_viewed) if has_progress and reading_viewed is not None else None,
            "quiz_attempted": bool(quiz_attempted) if has_progress and quiz_attempted is not None else None,
            "quiz_passed": bool(quiz_passed) if has_progress and quiz_passed is not None else None,
            "actual": float(actual_hours) if has_progress and actual_hours is not None else None,
            "planned": float(planned_hours) if planned_hours is not None else None,
            "reporting_method": "Manual plan",
            "month": member_month or calendar_month,
            "date": date.isoformat() if date else None,
            "timestamp_from": None,
            "timestamp_to": None,
            "timestamp_display": display,
            "status": status or "planned",
            "item_title": None,
            "group_id": group_id,
            "group_name": group_name,
        })

    iframe_url = None
    has_reading = has_quiz = False
    if material_ref and material_ref.startswith("lms:"):
        try:
            lms_id = int(material_ref[4:])
        except ValueError:
            lms_id = None
        if lms_id is not None:
            cursor.execute(
                '''
                select video_iframe_url, reading_iframe_url, reading_type,
                       reading_text_body, quiz_id
                from "Manual_audit".activities where activity_id = %s
                ''',
                [lms_id],
            )
            catalog = cursor.fetchone()
            if catalog:
                iframe_url = activity_content_url(catalog[0], catalog[1], catalog[2])
                has_reading = bool(catalog[1] or catalog[3])
                has_quiz = catalog[4] is not None

    return {
        "source": "Manual_audit",
        "plan": True,
        "component_id": f"plan:{key}",
        "source_activity_id": str(key),
        "group_id": group_id,
        "group_name": group_name,
        "included": bool(included),
        "activity": title,
        "activity_subtitle": subtitle,
        "category": category,
        "material_ref": material_ref,
        "iframe_url": iframe_url,
        "has_reading": has_reading,
        "has_quiz": has_quiz,
        "ksbs": _ksbs_dict(ksbs),
        "participant_count": len(participants),
        "completed_count": completed_count,
        "reading_completed_count": sum(1 for p in participants if p["reading_completed"]),
        "quiz_attempted_count": sum(1 for p in participants if p["quiz_attempted"]),
        "quiz_completed_count": sum(1 for p in participants if p["quiz_passed"]),
        "items": [],
        "item_count": 0,
        "participants": participants,
        "groups": [{
            "group_id": group_id,
            "group_name": group_name,
            "participant_count": len(participants),
            "participants": participants,
        }],
    }


def resolve_plan_material_lms_id(cursor, activity_key):
    """The catalog activity_id behind a plan row's lms: ref (quiz viewer)."""
    _ensure_ready(cursor)
    activity_key = parse_plan_key(activity_key)
    if not activity_key:
        return None
    cursor.execute(
        '''
        select a.material_ref
        from "Manual_audit".plan_activities a
        join "Manual_audit".plan_groups g on g.id = a.group_id and g.status = 'active'
        where a.activity_key = %s
        ''',
        [activity_key],
    )
    row = cursor.fetchone()
    ref = row[0] if row else None
    if ref and ref.startswith("lms:"):
        try:
            return int(ref[4:])
        except ValueError:
            return None
    return None
