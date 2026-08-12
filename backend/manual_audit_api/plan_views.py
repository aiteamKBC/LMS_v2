"""Plan-builder CRUD endpoints (groups, months, members, activities, progress).

Conventions match the rest of ``manual_audit_api``: plain function views, raw
SQL on ``connections[CONN]``, ``@csrf_exempt`` + manual method checks for
writes, JSON errors, upserts with ensure-table helpers (no migrations).

Editing rules from the design review:
* structural edits write plan tables and are logged to ``plan_events`` —
  plan rows NEVER go through the activity-overrides overlay;
* deletes are soft (``included=false``) so confirmed progress is preserved;
* writes that touch a month a learner has already signed off return
  ``signed_warnings`` so the UI can surface them (the sign-off gate in the UI
  is the only hard block).
"""

import datetime
import json
import math
import re
import uuid

from django.db import DatabaseError, connections, transaction
from django.http import HttpRequest, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET

from .common import CONN
from .plan_projection import _ksbs_dict
from .plan_tables import (
    PLAN_CATEGORIES,
    assignment_name_key,
    ensure_plan_tables,
    log_plan_event,
)

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


# --- tiny validators ---------------------------------------------------------

def _month_or_none(value, field):
    month = str(value or "").strip()
    if not month:
        return None
    if not _MONTH_RE.match(month):
        raise ValueError(f"{field} must be YYYY-MM")
    return month


def _date_or_none(value, field):
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.date.fromisoformat(raw)
    except ValueError:
        raise ValueError(f"{field} must be YYYY-MM-DD")


def _hours(value, field, default=None):
    """Per-activity hours: finite, 0..50 (the ledger wire-contract range)."""
    if value in (None, ""):
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number")
    if not math.isfinite(number):
        raise ValueError(f"{field} must be a finite number")
    if number < 0 or number > 50:
        raise ValueError(f"{field} must be between 0 and 50 hours")
    return round(number, 4)


def _actor(body):
    return str(body.get("updated_by") or body.get("created_by") or "").strip()[:200] or None


def _body(request):
    try:
        parsed = json.loads(request.body or b"{}")
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _int_or_none(value):
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _ksbs_or_none(value):
    """Accept {K:[{code,description}],S:[...],B:[...]} (lists trimmed)."""
    if not isinstance(value, dict):
        return None
    out = {}
    for bucket in ("K", "S", "B"):
        items = value.get(bucket) or []
        clean = []
        if isinstance(items, list):
            for item in items[:100]:
                if not isinstance(item, dict):
                    continue
                code = str(item.get("code") or "").strip()[:20]
                if not code:
                    continue
                clean.append({
                    "code": code,
                    "description": str(item.get("description") or "").strip()[:2000] or None,
                })
        out[bucket] = clean
    return out


def _month_label(month):
    try:
        return datetime.datetime.strptime(month, "%Y-%m").strftime("%B %Y")
    except ValueError:
        return month


def _add_months(month, offset):
    year, month_no = (int(part) for part in month.split("-"))
    total = year * 12 + (month_no - 1) + offset
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


# --- shared lookups ----------------------------------------------------------

def _learner_rows(cur, aptem_ids):
    """aptem_id -> (name, email) from the mirror; missing ids are absent."""
    if not aptem_ids:
        return {}
    cur.execute(
        '''
        select aptem_id, learner_name, learner_email
        from "Manual_audit".learners where aptem_id = any(%s)
        ''',
        [list({int(item) for item in aptem_ids})],
    )
    return {row[0]: (row[1], row[2]) for row in cur.fetchall()}


def _signed_warnings(cur, aptem_ids, months):
    """[(learner_id, report_month)] that already carry a signature."""
    ids = [str(item) for item in aptem_ids if item is not None]
    months = [month for month in months if month]
    if not ids or not months:
        return []
    cur.execute(
        '''
        select distinct learner_id, report_month
        from "Manual_audit".monthly_audit_signoffs
        where learner_id = any(%s) and report_month = any(%s) and signed_at is not null
        ''',
        [ids, months],
    )
    return [{"aptem_id": row[0], "month": row[1]} for row in cur.fetchall()]


def _group_row(cur, group_id):
    cur.execute(
        '''
        select id, name, kind, programme_id, programme_name, status, start_month,
               created_by, created_at, updated_by, updated_at, aptem_group
        from "Manual_audit".plan_groups where id = %s
        ''',
        [group_id],
    )
    return cur.fetchone()


def _group_payload(row):
    return {
        "id": row[0],
        "name": row[1],
        "kind": row[2],
        "programme_id": row[3],
        "programme_name": row[4],
        "status": row[5],
        "start_month": row[6],
        "created_by": row[7],
        "created_at": row[8].isoformat() if row[8] else None,
        "updated_by": row[9],
        "updated_at": row[10].isoformat() if row[10] else None,
        "aptem_group": row[11] if len(row) > 11 else None,
    }


def _months_payload(cur, group_id):
    cur.execute(
        '''
        select month_index, calendar_month, label, anchor_date
        from "Manual_audit".plan_months where group_id = %s order by month_index
        ''',
        [group_id],
    )
    return [
        {
            "month_index": row[0],
            "calendar_month": row[1],
            "label": row[2] or _month_label(row[1]),
            "anchor_date": row[3].isoformat() if row[3] else None,
        }
        for row in cur.fetchall()
    ]


def _members_payload(cur, group_id):
    cur.execute(
        '''
        select aptem_id, learner_name, learner_email, joined_at
        from "Manual_audit".plan_group_members
        where group_id = %s and left_at is null
        order by lower(coalesce(learner_name, '')), aptem_id
        ''',
        [group_id],
    )
    return [
        {
            "aptem_id": row[0],
            "name": row[1],
            "email": row[2],
            "joined_at": row[3].isoformat() if row[3] else None,
        }
        for row in cur.fetchall()
    ]


def _activities_payload(cur, group_id):
    cur.execute(
        '''
        select a.activity_key, a.month_index, a.week_slot, a.position, a.category,
               a.title, a.subtitle, a.material_ref, a.planned_hours, a.planned_date,
               a.included, a.ksbs, a.updated_by, a.updated_at,
               coalesce(x.exempted, '{}') as exempted
        from "Manual_audit".plan_activities a
        left join (
            select activity_key, array_agg(aptem_id) as exempted
            from "Manual_audit".plan_activity_exemptions group by activity_key
        ) x on x.activity_key = a.activity_key
        where a.group_id = %s
        order by a.month_index, a.week_slot, a.position, a.created_at
        ''',
        [group_id],
    )
    return [
        {
            "activity_key": str(row[0]),
            "month_index": row[1],
            "week_slot": row[2],
            "position": row[3],
            "category": row[4],
            "title": row[5],
            "subtitle": row[6],
            "material_ref": row[7],
            "planned_hours": float(row[8]) if row[8] is not None else 0.0,
            "planned_date": row[9].isoformat() if row[9] else None,
            "included": bool(row[10]),
            # jsonb may surface as str depending on the driver adapter — the
            # KSB editor needs a real object or it silently shows 0 KSBs.
            "ksbs": _ksbs_dict(row[11]),
            "updated_by": row[12],
            "updated_at": row[13].isoformat() if row[13] else None,
            "exempted": list(row[14] or []),
        }
        for row in cur.fetchall()
    ]


# --- training-plan month sync ---------------------------------------------------
#
# One shared plan per group, but each learner keeps THEIR OWN calendar dates:
# the group months hold the majority training-plan window, and every member
# whose Aptem training plan differs gets per-member month rows
# (plan_member_months) that the projection prefers over the group months.

def _training_plan_months(cur, aptem_ids):
    """aptem_id -> ['YYYY-MM', ...] from Audit.learner_match.aptem_training_plan."""
    if not aptem_ids:
        return {}
    cur.execute(
        '''
        select lm.aptem_id, tp.ord, tp.item ->> 'date'
        from "Audit".learner_match lm,
             lateral jsonb_array_elements(lm.aptem_training_plan::jsonb)
                 with ordinality as tp(item, ord)
        where lm.aptem_id = any(%s)
          and lm.aptem_training_plan is not null
          and jsonb_typeof(lm.aptem_training_plan::jsonb) = 'array'
        order by lm.aptem_id, tp.ord
        ''',
        [list(set(aptem_ids))],
    )
    plans = {}
    for aptem_id, _ord, date_text in cur.fetchall():
        month = str(date_text or "")[:7]
        if _MONTH_RE.match(month):
            plans.setdefault(aptem_id, []).append(month)
    return plans


def _seed_group_months_from_plans(cur, group_id, plans):
    """Group months = the most common training-plan month list among members."""
    if not plans:
        return []
    counted = {}
    for months in plans.values():
        counted[tuple(months)] = counted.get(tuple(months), 0) + 1
    majority = list(max(counted, key=counted.get))
    for index, month in enumerate(majority, start=1):
        cur.execute(
            '''
            insert into "Manual_audit".plan_months
                (group_id, month_index, calendar_month, label, anchor_date)
            values (%s, %s, %s, %s, %s)
            on conflict (group_id, month_index) do nothing
            ''',
            [group_id, index, month, _month_label(month), datetime.date.fromisoformat(f"{month}-01")],
        )
    return majority


def _sync_member_months(cur, group_id, aptem_ids):
    """Store each member's OWN training-plan months where they differ from the
    group's months — the projection buckets that learner's rows under their
    own calendar dates."""
    cur.execute(
        'select month_index, calendar_month from "Manual_audit".plan_months '
        'where group_id = %s order by month_index',
        [group_id],
    )
    group_months = [row[1] for row in cur.fetchall()]
    if not group_months:
        return 0
    plans = _training_plan_months(cur, aptem_ids)
    synced = 0
    for aptem_id, months in plans.items():
        if months == group_months:
            # Identical to the group -> no override rows needed.
            cur.execute(
                'delete from "Manual_audit".plan_member_months where group_id = %s and aptem_id = %s',
                [group_id, aptem_id],
            )
            continue
        cur.execute(
            'delete from "Manual_audit".plan_member_months where group_id = %s and aptem_id = %s',
            [group_id, aptem_id],
        )
        # Map by index: the learner's Nth plan month replaces group month N.
        # A learner with a shorter plan simply follows the group for the tail.
        for index, month in enumerate(months[: max(len(group_months), len(months))], start=1):
            cur.execute(
                '''
                insert into "Manual_audit".plan_member_months
                    (group_id, aptem_id, month_index, calendar_month, anchor_date)
                values (%s, %s, %s, %s, %s)
                on conflict (group_id, aptem_id, month_index) do update set
                    calendar_month = excluded.calendar_month,
                    anchor_date = excluded.anchor_date
                ''',
                [group_id, aptem_id, index, month, datetime.date.fromisoformat(f"{month}-01")],
            )
        synced += 1
    return synced


def _aptem_group_learners(cur, programme_name, aptem_group):
    """Cohort learners of one Aptem (programme, group) pair — the exact
    row-by-row linkage as it appears in Aptem."""
    cur.execute(
        '''
        select l.aptem_id, l.learner_name, l.learner_email
        from "LMS"."Aptem_users" au
        join "Manual_audit".learners l on l.aptem_id = au."ID"
        where btrim(au."Program Name") = %s and btrim(au."Group") = %s
        order by l.learner_name
        ''',
        [programme_name, aptem_group],
    )
    return cur.fetchall()


def _lms_group_learners(cur, lms_group_id, programme_name=None):
    """Aptem-linked learners of one mirror LMS group.

    LMS groups mix learners from several programme-name variants; when the
    creation flow picked a programme first, only ITS learners are assigned
    (matching the programme -> groups -> its learners cascade).
    """
    condition = "and l.programme_name = %s" if programme_name else ""
    params = [lms_group_id] + ([programme_name] if programme_name else [])
    cur.execute(
        f'''
        select distinct l.aptem_id, l.learner_name, l.learner_email
        from "Manual_audit".group_learners gl
        join "Manual_audit".learners l on l.learner_id = gl.learner_id
        where gl.group_id = %s and l.aptem_id is not null {condition}
        order by l.learner_name
        ''',
        params,
    )
    return cur.fetchall()


# --- groups ------------------------------------------------------------------

@csrf_exempt
def plan_groups(request: HttpRequest) -> JsonResponse:
    """GET: list groups (+counts). POST: create a group (cohort or individual)."""
    if request.method == "GET":
        try:
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                cur.execute(
                    '''
                    select g.id, g.name, g.kind, g.programme_id, g.programme_name,
                           g.status, g.start_month, g.created_by, g.created_at,
                           g.updated_by, g.updated_at, g.aptem_group,
                           coalesce(m.member_count, 0), coalesce(a.activity_count, 0)
                    from "Manual_audit".plan_groups g
                    left join (
                        select group_id, count(*) as member_count
                        from "Manual_audit".plan_group_members
                        where left_at is null group by group_id
                    ) m on m.group_id = g.id
                    left join (
                        select group_id, count(*) as activity_count
                        from "Manual_audit".plan_activities
                        where included group by group_id
                    ) a on a.group_id = g.id
                    order by g.status = 'archived', g.created_at desc
                    '''
                )
                rows = cur.fetchall()
        except (KeyError, DatabaseError) as error:
            return JsonResponse({"error": "Could not list plan groups.", "details": str(error)}, status=503)
        groups = []
        for row in rows:
            payload = _group_payload(row[:12])
            payload["member_count"] = row[12]
            payload["activity_count"] = row[13]
            groups.append(payload)
        return JsonResponse({"items": groups})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)

    name = str(body.get("name") or "").strip()[:300]
    if not name:
        return JsonResponse({"error": "name is required"}, status=400)
    kind = str(body.get("kind") or "cohort").strip()
    if kind not in {"cohort", "individual"}:
        return JsonResponse({"error": "kind must be cohort or individual"}, status=400)
    programme_name = str(body.get("programme_name") or "").strip()[:300] or None
    programme_id = _int_or_none(body.get("programme_id"))
    try:
        start_month = _month_or_none(body.get("start_month"), "start_month")
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)
    months_count = _int_or_none(body.get("months_count")) or 0
    if months_count < 0 or months_count > 48:
        return JsonResponse({"error": "months_count must be between 0 and 48"}, status=400)
    members = body.get("members") or []
    if not isinstance(members, list):
        return JsonResponse({"error": "members must be a list of aptem ids"}, status=400)
    member_ids = []
    for item in members:
        parsed = _int_or_none(item)
        if parsed is None:
            return JsonResponse({"error": f"invalid member aptem_id: {item!r}"}, status=400)
        member_ids.append(parsed)
    lms_group_id = _int_or_none(body.get("lms_group_id"))
    aptem_group = str(body.get("aptem_group") or "").strip()[:300] or None
    if aptem_group and not programme_name:
        return JsonResponse({"error": "aptem_group requires programme_name"}, status=400)
    # Default when an Aptem/LMS group drives the creation: months come from
    # the members' Aptem training plans (per-learner dates included).
    months_from_plan = bool(
        body.get("months_from_training_plan", bool(lms_group_id or aptem_group))
    )
    actor = _actor(body)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                if aptem_group:
                    # Aptem is the source of truth: the group's learners come
                    # from Aptem's own (Program Name, Group) assignment.
                    member_ids.extend(
                        row[0] for row in _aptem_group_learners(cur, programme_name, aptem_group)
                    )
                if lms_group_id:
                    member_ids.extend(
                        row[0] for row in _lms_group_learners(cur, lms_group_id, programme_name)
                    )
                member_ids = list(dict.fromkeys(member_ids))
                known = _learner_rows(cur, member_ids)
                missing = [item for item in member_ids if item not in known]
                if missing:
                    return JsonResponse(
                        {"error": "Some learners are outside the manual-audit cohort.", "missing": missing},
                        status=404,
                    )
                cur.execute(
                    '''
                    insert into "Manual_audit".plan_groups
                        (name, kind, programme_id, programme_name, aptem_group,
                         status, start_month, created_by, updated_by)
                    values (%s, %s, %s, %s, %s, 'draft', %s, %s, %s)
                    returning id, name, kind, programme_id, programme_name, status, start_month,
                              created_by, created_at, updated_by, updated_at, aptem_group
                    ''',
                    [name, kind, programme_id, programme_name, aptem_group, start_month, actor, actor],
                )
                row = cur.fetchone()
                group_id = row[0]
                if start_month and months_count:
                    for index in range(months_count):
                        month = _add_months(start_month, index)
                        cur.execute(
                            '''
                            insert into "Manual_audit".plan_months
                                (group_id, month_index, calendar_month, label)
                            values (%s, %s, %s, %s)
                            on conflict (group_id, month_index) do nothing
                            ''',
                            [group_id, index + 1, month, _month_label(month)],
                        )
                for aptem_id in member_ids:
                    learner_name, learner_email = known[aptem_id]
                    cur.execute(
                        '''
                        insert into "Manual_audit".plan_group_members
                            (group_id, aptem_id, learner_name, learner_email, added_by)
                        values (%s, %s, %s, %s, %s)
                        ''',
                        [group_id, aptem_id, learner_name, learner_email, actor],
                    )
                members_synced = 0
                if months_from_plan and member_ids:
                    # Group months = the majority training plan; each learner
                    # whose own plan differs keeps THEIR dates via
                    # plan_member_months (the projection prefers them).
                    plans = _training_plan_months(cur, member_ids)
                    _seed_group_months_from_plans(cur, group_id, plans)
                    members_synced = _sync_member_months(cur, group_id, member_ids)
                log_plan_event(cur, "group", group_id, "created", new={
                    "name": name, "kind": kind, "programme_name": programme_name,
                    "start_month": start_month, "months_count": months_count,
                    "lms_group_id": lms_group_id, "aptem_group": aptem_group,
                    "months_from_plan": months_from_plan,
                    "members": member_ids, "member_month_overrides": members_synced,
                }, actor=actor)
                payload = _group_payload(row)
                payload["months"] = _months_payload(cur, group_id)
                payload["members"] = _members_payload(cur, group_id)
                payload["activities"] = []
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not create the plan group.", "details": str(error)}, status=503)
    return JsonResponse(payload, status=201)


# --- learner-first plans -------------------------------------------------------
#
# The manual workspace pivoted to learner-first: the auditor adds ONE learner
# at a time (picked from Aptem) and gets that learner's own training-plan
# months (Aptem's labels and dates, untouched) with 4 weeks inside each to
# fill with activities. Under the hood a learner-plan is a plan_groups row
# with kind='individual' and a single member, so the whole engine (pickers,
# progress, suggestions, journal projection) works unchanged. Shared cohort
# filtering stays possible later because activities keep material_ref and the
# plan keeps the learner's Aptem programme/group linkage.

def _learner_plan_payload(row):
    (plan_id, name, programme_name, aptem_group, status, created_at, updated_at,
     aptem_id, learner_name, learner_email, month_count, activity_count) = row
    return {
        "id": plan_id,
        "name": name,
        "aptem_id": aptem_id,
        "learner_name": learner_name or name,
        "learner_email": learner_email,
        "programme_name": programme_name,
        "aptem_group": aptem_group,
        "status": status,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "month_count": month_count,
        "activity_count": activity_count,
    }


def _seed_months_from_learner_plan(cur, group_id, aptem_id):
    """Seed plan months straight from THIS learner's Aptem training plan —
    labels exactly as Aptem shows them, dates untouched."""
    cur.execute(
        '''
        select lm.aptem_training_plan from "Audit".learner_match lm
        where lm.aptem_id = %s and lm.aptem_training_plan is not null
        ''',
        [aptem_id],
    )
    row = cur.fetchone()
    if not row:
        return 0
    from .match_ledger_views import _training_plan_from_audit

    plan = _training_plan_from_audit(row[0])
    index = 0
    for month in plan["months"]:
        date_text = str(month.get("date") or "")[:10]
        calendar_month = date_text[:7]
        if not _MONTH_RE.match(calendar_month):
            continue
        index += 1
        label = str(month.get("month") or "").strip() or _month_label(calendar_month)
        cur.execute(
            '''
            insert into "Manual_audit".plan_months
                (group_id, month_index, calendar_month, label, anchor_date)
            values (%s, %s, %s, %s, %s)
            on conflict (group_id, month_index) do nothing
            ''',
            [group_id, index, calendar_month, label[:200], datetime.date.fromisoformat(date_text)],
        )
    return index


@csrf_exempt
def plan_learners(request: HttpRequest) -> JsonResponse:
    """GET: list learner-plans. POST: add one learner (from Aptem) manually."""
    if request.method == "GET":
        try:
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                cur.execute(
                    '''
                    select g.id, g.name, g.programme_name, g.aptem_group, g.status,
                           g.created_at, g.updated_at,
                           m.aptem_id, m.learner_name, m.learner_email,
                           coalesce(mo.month_count, 0), coalesce(a.activity_count, 0)
                    from "Manual_audit".plan_groups g
                    join "Manual_audit".plan_group_members m
                      on m.group_id = g.id and m.left_at is null
                    left join (
                        select group_id, count(*) as month_count
                        from "Manual_audit".plan_months group by group_id
                    ) mo on mo.group_id = g.id
                    left join (
                        select group_id, count(*) as activity_count
                        from "Manual_audit".plan_activities
                        where included group by group_id
                    ) a on a.group_id = g.id
                    where g.kind = 'individual' and g.status <> 'archived'
                    order by g.created_at desc
                    '''
                )
                rows = cur.fetchall()
        except (KeyError, DatabaseError) as error:
            return JsonResponse({"error": "Could not list learner plans.", "details": str(error)}, status=503)
        return JsonResponse({"items": [_learner_plan_payload(row) for row in rows]})

    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    aptem_id = _int_or_none(body.get("aptem_id"))
    if aptem_id is None:
        return JsonResponse({"error": "aptem_id is required"}, status=400)
    actor = _actor(body)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                known = _learner_rows(cur, [aptem_id])
                if aptem_id not in known:
                    return JsonResponse(
                        {"error": "This learner is outside the manual-audit cohort."}, status=404,
                    )
                learner_name, learner_email = known[aptem_id]
                # One active plan per learner — reopen attempts return it.
                cur.execute(
                    '''
                    select g.id from "Manual_audit".plan_groups g
                    join "Manual_audit".plan_group_members m
                      on m.group_id = g.id and m.left_at is null
                    where g.kind = 'individual' and g.status <> 'archived'
                      and m.aptem_id = %s
                    ''',
                    [aptem_id],
                )
                existing = cur.fetchone()
                if existing:
                    return JsonResponse(
                        {"error": "This learner already has a plan.", "id": existing[0]},
                        status=409,
                    )
                # The learner's own Aptem linkage (programme + group), kept for
                # the shared cohort filtering that comes later.
                cur.execute(
                    '''
                    select btrim(au."Program Name"), btrim(au."Group")
                    from "LMS"."Aptem_users" au where au."ID" = %s
                    ''',
                    [aptem_id],
                )
                aptem_row = cur.fetchone()
                programme_name = (aptem_row[0] or None) if aptem_row else None
                aptem_group = (aptem_row[1] or None) if aptem_row else None
                cur.execute(
                    '''
                    insert into "Manual_audit".plan_groups
                        (name, kind, programme_name, aptem_group, status, created_by, updated_by)
                    values (%s, 'individual', %s, %s, 'active', %s, %s)
                    returning id, created_at, updated_at
                    ''',
                    [learner_name or f"Learner {aptem_id}", programme_name, aptem_group, actor, actor],
                )
                plan_id, created_at, updated_at = cur.fetchone()
                cur.execute(
                    '''
                    insert into "Manual_audit".plan_group_members
                        (group_id, aptem_id, learner_name, learner_email, added_by)
                    values (%s, %s, %s, %s, %s)
                    ''',
                    [plan_id, aptem_id, learner_name, learner_email, actor],
                )
                month_count = _seed_months_from_learner_plan(cur, plan_id, aptem_id)
                log_plan_event(cur, "group", plan_id, "created", new={
                    "kind": "individual", "aptem_id": aptem_id,
                    "programme_name": programme_name, "aptem_group": aptem_group,
                    "months_seeded": month_count,
                }, actor=actor)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not add the learner.", "details": str(error)}, status=503)
    return JsonResponse(_learner_plan_payload((
        plan_id, learner_name or f"Learner {aptem_id}", programme_name, aptem_group,
        "active", created_at, updated_at, aptem_id, learner_name, learner_email,
        month_count, 0,
    )), status=201)


@csrf_exempt
def plan_group_detail(request: HttpRequest, group_id: int) -> JsonResponse:
    """GET: the full group (months, members, activities). PATCH: rename/status."""
    if request.method == "GET":
        try:
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                row = _group_row(cur, group_id)
                if not row:
                    return JsonResponse({"error": "Plan group not found."}, status=404)
                payload = _group_payload(row)
                payload["months"] = _months_payload(cur, group_id)
                payload["members"] = _members_payload(cur, group_id)
                payload["activities"] = _activities_payload(cur, group_id)
        except (KeyError, DatabaseError) as error:
            return JsonResponse({"error": "Could not load the plan group.", "details": str(error)}, status=503)
        return JsonResponse(payload)

    if request.method not in {"PATCH", "DELETE"}:
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request) or {}
    actor = _actor(body)

    try:
      with transaction.atomic(using=CONN):
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            row = _group_row(cur, group_id)
            if not row:
                return JsonResponse({"error": "Plan group not found."}, status=404)

            if request.method == "DELETE":
                cur.execute(
                    'update "Manual_audit".plan_groups set status = %s, updated_by = %s, updated_at = now() where id = %s',
                    ["archived", actor, group_id],
                )
                log_plan_event(cur, "group", group_id, "archived", actor=actor)
                return JsonResponse({"ok": True, "id": group_id, "status": "archived"})

            updates, params = [], []
            name = body.get("name")
            if name is not None:
                name = str(name).strip()[:300]
                if not name:
                    return JsonResponse({"error": "name cannot be empty"}, status=400)
                updates.append("name = %s")
                params.append(name)
            status = body.get("status")
            if status is not None:
                if status not in {"draft", "active", "archived"}:
                    return JsonResponse({"error": "status must be draft, active, or archived"}, status=400)
                updates.append("status = %s")
                params.append(status)
            programme_name = body.get("programme_name")
            if programme_name is not None:
                updates.append("programme_name = %s")
                params.append(str(programme_name).strip()[:300] or None)
            if not updates:
                return JsonResponse({"error": "Nothing to update."}, status=400)
            updates.append("updated_by = %s")
            params.append(actor)
            params.append(group_id)
            cur.execute(
                f'update "Manual_audit".plan_groups set {", ".join(updates)}, updated_at = now() where id = %s',
                params,
            )
            log_plan_event(cur, "group", group_id, "updated", new=body, actor=actor)
            refreshed = _group_row(cur, group_id)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not update the plan group.", "details": str(error)}, status=503)
    return JsonResponse(_group_payload(refreshed))


@csrf_exempt
def plan_group_members(request: HttpRequest, group_id: int) -> JsonResponse:
    """POST {add:[aptem_id], remove:[aptem_id]} — membership with history."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    add = [item for item in (_int_or_none(v) for v in body.get("add") or []) if item]
    remove = [item for item in (_int_or_none(v) for v in body.get("remove") or []) if item]
    if not add and not remove:
        return JsonResponse({"error": "Provide add and/or remove lists."}, status=400)
    actor = _actor(body)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                if not _group_row(cur, group_id):
                    return JsonResponse({"error": "Plan group not found."}, status=404)
                known = _learner_rows(cur, add)
                missing = [item for item in add if item not in known]
                if missing:
                    return JsonResponse(
                        {"error": "Some learners are outside the manual-audit cohort.", "missing": missing},
                        status=404,
                    )
                added, skipped = [], []
                for aptem_id in dict.fromkeys(add):
                    learner_name, learner_email = known[aptem_id]
                    cur.execute(
                        '''
                        insert into "Manual_audit".plan_group_members
                            (group_id, aptem_id, learner_name, learner_email, added_by)
                        select %s, %s, %s, %s, %s
                        where not exists (
                            select 1 from "Manual_audit".plan_group_members
                            where group_id = %s and aptem_id = %s and left_at is null
                        )
                        returning id
                        ''',
                        [group_id, aptem_id, learner_name, learner_email, actor, group_id, aptem_id],
                    )
                    (added if cur.fetchone() else skipped).append(aptem_id)
                # Late joiners keep their OWN training-plan dates too.
                if added:
                    _sync_member_months(cur, group_id, added)
                removed = []
                for aptem_id in dict.fromkeys(remove):
                    cur.execute(
                        '''
                        update "Manual_audit".plan_group_members set left_at = now()
                        where group_id = %s and aptem_id = %s and left_at is null
                        returning id
                        ''',
                        [group_id, aptem_id],
                    )
                    if cur.fetchone():
                        removed.append(aptem_id)
                log_plan_event(cur, "group", group_id, "membership", new={
                    "added": added, "removed": removed, "already_member": skipped,
                }, actor=actor)
                members = _members_payload(cur, group_id)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not update the members.", "details": str(error)}, status=503)
    return JsonResponse({"ok": True, "added": added, "removed": removed, "already_member": skipped, "members": members})


@csrf_exempt
def plan_group_months(request: HttpRequest, group_id: int) -> JsonResponse:
    """PUT {months:[{month_index, calendar_month, label?, anchor_date?}]}."""
    if request.method != "PUT":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request)
    if body is None or not isinstance(body.get("months"), list):
        return JsonResponse({"error": "months list is required"}, status=400)
    actor = _actor(body)

    parsed = []
    try:
        for item in body["months"]:
            if not isinstance(item, dict):
                raise ValueError("each month must be an object")
            index = _int_or_none(item.get("month_index"))
            if not index or index < 1 or index > 60:
                raise ValueError("month_index must be 1..60")
            month = _month_or_none(item.get("calendar_month"), "calendar_month")
            if not month:
                raise ValueError("calendar_month is required")
            parsed.append({
                "month_index": index,
                "calendar_month": month,
                "label": str(item.get("label") or "").strip()[:200] or _month_label(month),
                "anchor_date": _date_or_none(item.get("anchor_date"), "anchor_date"),
            })
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)
    if len({item["month_index"] for item in parsed}) != len(parsed):
        return JsonResponse({"error": "month_index values must be unique"}, status=400)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                if not _group_row(cur, group_id):
                    return JsonResponse({"error": "Plan group not found."}, status=404)
                keep = [item["month_index"] for item in parsed]
                # Months referenced by activities cannot be dropped silently.
                cur.execute(
                    '''
                    select distinct month_index from "Manual_audit".plan_activities
                    where group_id = %s and not (month_index = any(%s))
                    ''',
                    [group_id, keep or [0]],
                )
                orphaned = [row[0] for row in cur.fetchall()]
                if orphaned:
                    return JsonResponse(
                        {"error": "Months with activities cannot be removed.", "months_with_activities": orphaned},
                        status=400,
                    )
                cur.execute(
                    'delete from "Manual_audit".plan_months where group_id = %s and not (month_index = any(%s))',
                    [group_id, keep or [0]],
                )
                for item in parsed:
                    cur.execute(
                        '''
                        insert into "Manual_audit".plan_months
                            (group_id, month_index, calendar_month, label, anchor_date)
                        values (%s, %s, %s, %s, %s)
                        on conflict (group_id, month_index) do update set
                            calendar_month = excluded.calendar_month,
                            label = excluded.label,
                            anchor_date = excluded.anchor_date
                        ''',
                        [group_id, item["month_index"], item["calendar_month"], item["label"], item["anchor_date"]],
                    )
                log_plan_event(cur, "group", group_id, "months_updated", new={"months": parsed}, actor=actor)
                months = _months_payload(cur, group_id)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not update the months.", "details": str(error)}, status=503)
    return JsonResponse({"ok": True, "months": months})


# --- activities ---------------------------------------------------------------

def _validate_activity_input(item):
    if not isinstance(item, dict):
        raise ValueError("each activity must be an object")
    category = str(item.get("category") or "").strip().lower()
    if category not in PLAN_CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(PLAN_CATEGORIES)}")
    title = str(item.get("title") or "").strip()
    if not title:
        raise ValueError("title is required")
    if len(title) > 500:
        raise ValueError("title must be at most 500 characters")
    month_index = _int_or_none(item.get("month_index"))
    if not month_index or month_index < 1 or month_index > 60:
        raise ValueError("month_index must be 1..60")
    week_slot = _int_or_none(item.get("week_slot")) or 1
    if week_slot < 1 or week_slot > 4:
        raise ValueError("week_slot must be 1..4")
    return {
        "category": category,
        "title": title,
        "subtitle": str(item.get("subtitle") or "").strip()[:2000] or None,
        "month_index": month_index,
        "week_slot": week_slot,
        "material_ref": str(item.get("material_ref") or "").strip()[:500] or None,
        "planned_hours": _hours(item.get("planned_hours"), "planned_hours", default=0.0),
        "planned_date": _date_or_none(item.get("planned_date"), "planned_date"),
        "ksbs": _ksbs_or_none(item.get("ksbs")),
    }


def _group_calendar_months(cur, group_id, month_indexes):
    if not month_indexes:
        return {}
    cur.execute(
        '''
        select month_index, calendar_month from "Manual_audit".plan_months
        where group_id = %s and month_index = any(%s)
        ''',
        [group_id, list(set(month_indexes))],
    )
    return {row[0]: row[1] for row in cur.fetchall()}


def _active_member_ids(cur, group_id):
    cur.execute(
        'select aptem_id from "Manual_audit".plan_group_members where group_id = %s and left_at is null',
        [group_id],
    )
    return [row[0] for row in cur.fetchall()]


@csrf_exempt
def plan_activities(request: HttpRequest) -> JsonResponse:
    """POST: add activities. PATCH: edit one. DELETE: soft-exclude one."""
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    actor = _actor(body)

    if request.method == "POST":
        group_id = _int_or_none(body.get("group_id"))
        if not group_id:
            return JsonResponse({"error": "group_id is required"}, status=400)
        raw_items = body.get("activities")
        if raw_items is None:
            raw_items = [body]
        if not isinstance(raw_items, list) or not raw_items:
            return JsonResponse({"error": "activities must be a non-empty list"}, status=400)
        try:
            items = [_validate_activity_input(item) for item in raw_items]
        except ValueError as error:
            return JsonResponse({"error": str(error)}, status=400)

        assignment_refs = body.get("assignment_refs") or []
        try:
            with transaction.atomic(using=CONN):
                with connections[CONN].cursor() as cur:
                    ensure_plan_tables(cur)
                    if not _group_row(cur, group_id):
                        return JsonResponse({"error": "Plan group not found."}, status=404)
                    months = _group_calendar_months(cur, group_id, [item["month_index"] for item in items])
                    unknown = sorted({item["month_index"] for item in items} - set(months))
                    if unknown:
                        return JsonResponse(
                            {"error": "Add these months to the group schedule first.", "unknown_months": unknown},
                            status=400,
                        )
                    # Duplicate-material check (warning only; the UI decides).
                    # Covers both refs already in the plan AND repeats inside
                    # this same batch.
                    refs = [item["material_ref"] for item in items if item["material_ref"]]
                    seen_refs, intra_batch = set(), set()
                    for ref in refs:
                        if ref in seen_refs:
                            intra_batch.add(ref)
                        seen_refs.add(ref)
                    duplicates = set(intra_batch)
                    if refs:
                        cur.execute(
                            '''
                            select material_ref from "Manual_audit".plan_activities
                            where group_id = %s and included and material_ref = any(%s)
                            ''',
                            [group_id, refs],
                        )
                        duplicates.update(row[0] for row in cur.fetchall())
                    duplicates = sorted(duplicates)

                    created = []
                    for item in items:
                        cur.execute(
                            '''
                            insert into "Manual_audit".plan_activities
                                (group_id, month_index, week_slot, position, category, title,
                                 subtitle, material_ref, planned_hours, planned_date, ksbs,
                                 created_by, updated_by)
                            values (
                                %s, %s, %s,
                                coalesce((
                                    select max(position) + 1 from "Manual_audit".plan_activities
                                    where group_id = %s and month_index = %s and week_slot = %s
                                ), 0),
                                %s, %s, %s, %s, %s, %s, %s, %s, %s
                            )
                            returning activity_key
                            ''',
                            [
                                group_id, item["month_index"], item["week_slot"],
                                group_id, item["month_index"], item["week_slot"],
                                item["category"], item["title"], item["subtitle"],
                                item["material_ref"],
                                item["planned_hours"],
                                item["planned_date"],
                                json.dumps(item["ksbs"]) if item["ksbs"] is not None else None,
                                actor, actor,
                            ],
                        )
                        created.append(str(cur.fetchone()[0]))

                    # Snapshot per-learner assignment component ids (name-keyed refs).
                    for ref in assignment_refs:
                        if not isinstance(ref, dict):
                            continue
                        aptem_id = _int_or_none(ref.get("aptem_id"))
                        component_id = _int_or_none(ref.get("component_id"))
                        name_key = assignment_name_key(ref.get("component_name") or ref.get("name_key"))
                        if not aptem_id or not component_id or not name_key:
                            continue
                        cur.execute(
                            '''
                            insert into "Manual_audit".plan_assignment_refs
                                (group_id, name_key, aptem_id, component_id, component_name, assignment_month)
                            values (%s, %s, %s, %s, %s, %s)
                            on conflict (group_id, name_key, aptem_id) do update set
                                component_id = excluded.component_id,
                                component_name = excluded.component_name,
                                assignment_month = excluded.assignment_month
                            ''',
                            [
                                group_id, name_key, aptem_id, component_id,
                                str(ref.get("component_name") or "").strip()[:500] or None,
                                str(ref.get("assignment_month") or "").strip()[:10] or None,
                            ],
                        )

                    members = _active_member_ids(cur, group_id)
                    warnings = _signed_warnings(
                        cur, members, [months[item["month_index"]] for item in items],
                    )
                    log_plan_event(cur, "group", group_id, "activities_added", new={
                        "activity_keys": created,
                        "count": len(created),
                    }, actor=actor)
        except (KeyError, DatabaseError) as error:
            return JsonResponse({"error": "Could not add the activities.", "details": str(error)}, status=503)
        return JsonResponse(
            {"ok": True, "activity_keys": created, "duplicate_refs": duplicates, "signed_warnings": warnings},
            status=201,
        )

    if request.method not in {"PATCH", "DELETE"}:
        return JsonResponse({"error": "Method not allowed."}, status=405)

    raw_key = str(body.get("activity_key") or "").strip()
    try:
        activity_key = str(uuid.UUID(raw_key))
    except ValueError:
        return JsonResponse({"error": "activity_key must be a uuid"}, status=400)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                cur.execute(
                    '''
                    select group_id, month_index, week_slot, category, title, subtitle,
                           material_ref, planned_hours, planned_date, included, ksbs
                    from "Manual_audit".plan_activities where activity_key = %s
                    ''',
                    [activity_key],
                )
                existing = cur.fetchone()
                if not existing:
                    return JsonResponse({"error": "Plan activity not found."}, status=404)
                group_id = existing[0]
                members = _active_member_ids(cur, group_id)

                if request.method == "DELETE":
                    cur.execute(
                        '''
                        update "Manual_audit".plan_activities
                        set included = false, excluded_at = now(), updated_by = %s, updated_at = now()
                        where activity_key = %s
                        ''',
                        [actor, activity_key],
                    )
                    cur.execute(
                        'select count(*) from "Manual_audit".plan_learner_progress '
                        'where activity_key = %s and archived_at is null',
                        [activity_key],
                    )
                    progress_count = cur.fetchone()[0]
                    months = _group_calendar_months(cur, group_id, [existing[1]])
                    warnings = _signed_warnings(cur, members, list(months.values()))
                    log_plan_event(cur, "activity", activity_key, "excluded", old={
                        "title": existing[4], "month_index": existing[1],
                        "progress_rows_kept": progress_count,
                    }, actor=actor)
                    return JsonResponse({
                        "ok": True, "activity_key": activity_key, "included": False,
                        "progress_rows_kept": progress_count, "signed_warnings": warnings,
                    })

                patch = body.get("patch")
                if not isinstance(patch, dict) or not patch:
                    return JsonResponse({"error": "patch object is required"}, status=400)
                updates, params = [], []
                try:
                    if "title" in patch:
                        title = str(patch.get("title") or "").strip()
                        if not title or len(title) > 500:
                            raise ValueError("title must be 1..500 characters")
                        updates.append("title = %s")
                        params.append(title)
                    if "subtitle" in patch:
                        updates.append("subtitle = %s")
                        params.append(str(patch.get("subtitle") or "").strip()[:2000] or None)
                    if "category" in patch:
                        category = str(patch.get("category") or "").strip().lower()
                        if category not in PLAN_CATEGORIES:
                            raise ValueError(f"category must be one of: {', '.join(PLAN_CATEGORIES)}")
                        updates.append("category = %s")
                        params.append(category)
                    if "planned_hours" in patch:
                        updates.append("planned_hours = %s")
                        params.append(_hours(patch.get("planned_hours"), "planned_hours", default=0.0))
                    if "planned_date" in patch:
                        updates.append("planned_date = %s")
                        params.append(_date_or_none(patch.get("planned_date"), "planned_date"))
                    if "week_slot" in patch:
                        week_slot = _int_or_none(patch.get("week_slot"))
                        if not week_slot or week_slot < 1 or week_slot > 4:
                            raise ValueError("week_slot must be 1..4")
                        updates.append("week_slot = %s")
                        params.append(week_slot)
                    if "month_index" in patch:
                        month_index = _int_or_none(patch.get("month_index"))
                        if not month_index or month_index < 1 or month_index > 60:
                            raise ValueError("month_index must be 1..60")
                        if not _group_calendar_months(cur, group_id, [month_index]):
                            raise ValueError("month_index is not on the group schedule")
                        updates.append("month_index = %s")
                        params.append(month_index)
                    if "position" in patch:
                        position = _int_or_none(patch.get("position"))
                        if position is None or position < 0:
                            raise ValueError("position must be >= 0")
                        updates.append("position = %s")
                        params.append(position)
                    if "included" in patch:
                        included = bool(patch.get("included"))
                        updates.append("included = %s")
                        params.append(included)
                        updates.append("excluded_at = %s")
                        params.append(None if included else datetime.datetime.now(datetime.timezone.utc))
                    if "ksbs" in patch:
                        ksbs = _ksbs_or_none(patch.get("ksbs"))
                        updates.append("ksbs = %s")
                        params.append(json.dumps(ksbs) if ksbs is not None else None)
                    if "exempted" in patch:
                        exempted = [item for item in (_int_or_none(v) for v in patch.get("exempted") or []) if item]
                        cur.execute(
                            'delete from "Manual_audit".plan_activity_exemptions where activity_key = %s',
                            [activity_key],
                        )
                        for aptem_id in dict.fromkeys(exempted):
                            cur.execute(
                                '''
                                insert into "Manual_audit".plan_activity_exemptions
                                    (activity_key, aptem_id, exempted_by)
                                values (%s, %s, %s)
                                ''',
                                [activity_key, aptem_id, actor],
                            )
                except ValueError as error:
                    return JsonResponse({"error": str(error)}, status=400)

                if updates:
                    updates.append("updated_by = %s")
                    params.append(actor)
                    params.append(activity_key)
                    cur.execute(
                        f'update "Manual_audit".plan_activities set {", ".join(updates)}, updated_at = now() '
                        'where activity_key = %s',
                        params,
                    )
                month_indexes = [existing[1]]
                if "month_index" in patch and _int_or_none(patch.get("month_index")):
                    month_indexes.append(int(patch["month_index"]))
                months = _group_calendar_months(cur, group_id, month_indexes)
                warnings = _signed_warnings(cur, members, list(months.values()))
                log_plan_event(cur, "activity", activity_key, "updated", old={
                    "title": existing[4], "month_index": existing[1],
                }, new=patch, actor=actor)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not update the activity.", "details": str(error)}, status=503)
    return JsonResponse({"ok": True, "activity_key": activity_key, "signed_warnings": warnings})


# --- learner progress ----------------------------------------------------------

_PROGRESS_STATUSES = {"not_started", "in_progress", "completed", "not_accepted"}


def _validate_progress_patch(patch):
    if not isinstance(patch, dict) or not patch:
        raise ValueError("patch object is required")
    out = {}
    if "status" in patch:
        status = str(patch.get("status") or "").strip()
        if status not in _PROGRESS_STATUSES:
            raise ValueError(f"status must be one of: {', '.join(sorted(_PROGRESS_STATUSES))}")
        out["status"] = status
    if "completion_date" in patch:
        date = _date_or_none(patch.get("completion_date"), "completion_date")
        out["completion_date"] = date
    if "actual_hours" in patch:
        out["actual_hours"] = _hours(patch.get("actual_hours"), "actual_hours")
    if "attendance_status" in patch:
        value = str(patch.get("attendance_status") or "").strip().lower() or None
        if value not in {None, "attended", "absent", "makeup"}:
            raise ValueError("attendance_status must be attended, absent, or makeup")
        out["attendance_status"] = value
    # Tri-state flags may be null; the NOT NULL bookkeeping booleans coerce
    # null to False so bad input can never turn into a 503 at insert time.
    for flag in ("quiz_attempted", "quiz_passed", "reading_viewed"):
        if flag in patch:
            out[flag] = bool(patch.get(flag)) if patch.get(flag) is not None else None
    for flag in ("suggestion_accepted", "rejected"):
        if flag in patch:
            out[flag] = bool(patch.get(flag))
    if "note" in patch:
        out["note"] = str(patch.get("note") or "").strip()[:5000] or None
    if "evidence_ref" in patch:
        out["evidence_ref"] = str(patch.get("evidence_ref") or "").strip()[:500] or None
    for stamp in ("timestamp_from", "timestamp_to"):
        if stamp in patch:
            raw = str(patch.get(stamp) or "").strip()
            if not raw:
                out[stamp] = None
            else:
                try:
                    parsed = datetime.datetime.fromisoformat(raw.replace("Z", "+00:00"))
                except ValueError:
                    raise ValueError(f"{stamp} must be an ISO timestamp")
                # Normalise naive input to UTC so mixed naive/aware bounds can
                # always be compared (and stored consistently).
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=datetime.timezone.utc)
                out[stamp] = parsed
    if out.get("timestamp_from") and out.get("timestamp_to") and out["timestamp_to"] < out["timestamp_from"]:
        raise ValueError("timestamp_to must be after timestamp_from")
    return out


def _upsert_progress(cur, aptem_id, activity_key, group_id, patch, actor):
    columns = list(patch.keys())
    insert_cols = ["aptem_id", "activity_key", "group_id", *columns, "updated_by"]
    placeholders = ", ".join(["%s"] * len(insert_cols))
    conflict_updates = ", ".join(
        [f"{col} = excluded.{col}" for col in columns] + ["updated_by = excluded.updated_by", "updated_at = now()"]
    )
    values = [aptem_id, activity_key, group_id, *[patch[col] for col in columns], actor]
    cur.execute(
        f'insert into "Manual_audit".plan_learner_progress ({", ".join(insert_cols)}) '
        f'values ({placeholders}) '
        f'on conflict (aptem_id, activity_key) do update set {conflict_updates}',
        values,
    )


def _activity_group_and_month(cur, activity_key):
    cur.execute(
        '''
        select a.group_id, m.calendar_month
        from "Manual_audit".plan_activities a
        left join "Manual_audit".plan_months m
          on m.group_id = a.group_id and m.month_index = a.month_index
        where a.activity_key = %s
        ''',
        [activity_key],
    )
    return cur.fetchone()


def _active_membership_set(cur, group_id, aptem_ids):
    """The subset of aptem_ids that are active members of the group."""
    if not aptem_ids:
        return set()
    cur.execute(
        '''
        select aptem_id from "Manual_audit".plan_group_members
        where group_id = %s and aptem_id = any(%s) and left_at is null
        ''',
        [group_id, list(set(aptem_ids))],
    )
    return {row[0] for row in cur.fetchall()}


@csrf_exempt
def plan_progress(request: HttpRequest) -> JsonResponse:
    """POST: upsert one learner's progress cell. DELETE: clear it (back to suggested)."""
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    actor = _actor(body)
    aptem_id = _int_or_none(body.get("aptem_id"))
    raw_key = str(body.get("activity_key") or "").strip()
    if not aptem_id:
        return JsonResponse({"error": "aptem_id is required"}, status=400)
    try:
        activity_key = str(uuid.UUID(raw_key))
    except ValueError:
        return JsonResponse({"error": "activity_key must be a uuid"}, status=400)

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            located = _activity_group_and_month(cur, activity_key)
            if not located:
                return JsonResponse({"error": "Plan activity not found."}, status=404)
            group_id, calendar_month = located

            if request.method == "DELETE":
                cur.execute(
                    'delete from "Manual_audit".plan_learner_progress where aptem_id = %s and activity_key = %s',
                    [aptem_id, activity_key],
                )
                return JsonResponse({"ok": True, "cleared": True})

            if request.method != "POST":
                return JsonResponse({"error": "Method not allowed."}, status=405)
            if aptem_id not in _active_membership_set(cur, group_id, [aptem_id]):
                return JsonResponse(
                    {"error": "Learner is not an active member of this plan group."},
                    status=404,
                )
            try:
                patch = _validate_progress_patch(body.get("patch") or {})
            except ValueError as error:
                return JsonResponse({"error": str(error)}, status=400)
            _upsert_progress(cur, aptem_id, activity_key, group_id, patch, actor)
            warnings = _signed_warnings(cur, [aptem_id], [calendar_month])
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not save the progress.", "details": str(error)}, status=503)
    return JsonResponse({"ok": True, "signed_warnings": warnings})


@csrf_exempt
def plan_progress_bulk(request: HttpRequest) -> JsonResponse:
    """POST {activity_key, patch, aptem_ids:[...]} — one column-wide bulk write."""
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = _body(request)
    if body is None:
        return JsonResponse({"error": "Invalid JSON body."}, status=400)
    actor = _actor(body)
    raw_key = str(body.get("activity_key") or "").strip()
    try:
        activity_key = str(uuid.UUID(raw_key))
    except ValueError:
        return JsonResponse({"error": "activity_key must be a uuid"}, status=400)
    aptem_ids = [item for item in (_int_or_none(v) for v in body.get("aptem_ids") or []) if item]
    if not aptem_ids:
        return JsonResponse({"error": "aptem_ids list is required"}, status=400)
    try:
        patch = _validate_progress_patch(body.get("patch") or {})
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)

    try:
        with transaction.atomic(using=CONN):
            with connections[CONN].cursor() as cur:
                ensure_plan_tables(cur)
                located = _activity_group_and_month(cur, activity_key)
                if not located:
                    return JsonResponse({"error": "Plan activity not found."}, status=404)
                group_id, calendar_month = located
                members = _active_membership_set(cur, group_id, aptem_ids)
                skipped = sorted(set(aptem_ids) - members)
                for aptem_id in dict.fromkeys(aptem_ids):
                    if aptem_id in members:
                        _upsert_progress(cur, aptem_id, activity_key, group_id, patch, actor)
                warnings = _signed_warnings(cur, sorted(members), [calendar_month])
                log_plan_event(cur, "activity", activity_key, "progress_bulk", new={
                    "aptem_ids": sorted(members), "skipped_non_members": skipped,
                    "patch": {k: str(v) for k, v in patch.items()},
                }, actor=actor)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not save the bulk progress.", "details": str(error)}, status=503)
    return JsonResponse({
        "ok": True, "updated": len(members),
        "skipped_non_members": skipped, "signed_warnings": warnings,
    })


# --- progress matrix (members x month activities, with read-time suggestions) ---

_SLUG_SQL = (
    "coalesce(nullif(btrim(regexp_replace(lower(btrim(coalesce({column}, ''))), "
    "'[^a-z0-9]+', '-', 'g'), '-'), ''), 'unnamed')"
)


@require_GET
def plan_matrix(request: HttpRequest, group_id: int) -> JsonResponse:
    """One month's matrix: members x activities, confirmed progress
    LEFT-JOINed with read-time suggestions from the mirror (never persisted,
    so a re-sync can never leave stale suggestion rows behind)."""
    month_index = _int_or_none(request.GET.get("month_index"))
    if not month_index:
        return JsonResponse({"error": "month_index is required"}, status=400)

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            if not _group_row(cur, group_id):
                return JsonResponse({"error": "Plan group not found."}, status=404)

            cur.execute(
                '''
                select a.activity_key, a.week_slot, a.position, a.category, a.title,
                       a.material_ref, a.planned_hours, a.planned_date, a.ksbs,
                       coalesce(x.exempted, '{}')
                from "Manual_audit".plan_activities a
                left join (
                    select activity_key, array_agg(aptem_id) as exempted
                    from "Manual_audit".plan_activity_exemptions group by activity_key
                ) x on x.activity_key = a.activity_key
                where a.group_id = %s and a.month_index = %s and a.included
                order by a.week_slot, a.position, a.created_at
                ''',
                [group_id, month_index],
            )
            activity_rows = cur.fetchall()
            activities = [
                {
                    "activity_key": str(row[0]),
                    "week_slot": row[1],
                    "position": row[2],
                    "category": row[3],
                    "title": row[4],
                    "material_ref": row[5],
                    "planned_hours": float(row[6]) if row[6] is not None else 0.0,
                    "planned_date": row[7].isoformat() if row[7] else None,
                    "exempted": list(row[9] or []),
                }
                for row in activity_rows
            ]

            cur.execute(
                '''
                select pm.aptem_id, pm.learner_name, l.learner_id
                from "Manual_audit".plan_group_members pm
                left join "Manual_audit".learners l on l.aptem_id = pm.aptem_id
                where pm.group_id = %s and pm.left_at is null
                order by lower(coalesce(pm.learner_name, '')), pm.aptem_id
                ''',
                [group_id],
            )
            member_rows = cur.fetchall()
            members = [
                {"aptem_id": row[0], "name": row[1], "lms_linked": row[2] is not None}
                for row in member_rows
            ]
            member_ids = [row[0] for row in member_rows]

            keys = [item["activity_key"] for item in activities]
            cells = {}
            if keys and member_ids:
                cur.execute(
                    '''
                    select aptem_id, activity_key, status, completion_date, actual_hours,
                           attendance_status, quiz_attempted, quiz_passed, reading_viewed,
                           note, rejected, suggestion_accepted
                    from "Manual_audit".plan_learner_progress
                    where activity_key = any(%s::uuid[]) and aptem_id = any(%s)
                      and archived_at is null
                    ''',
                    [keys, member_ids],
                )
                for row in cur.fetchall():
                    cells.setdefault(f"{row[0]}:{row[1]}", {})["progress"] = {
                        "status": row[2],
                        "completion_date": row[3].isoformat() if row[3] else None,
                        "actual_hours": float(row[4]) if row[4] is not None else None,
                        "attendance_status": row[5],
                        "quiz_attempted": row[6],
                        "quiz_passed": row[7],
                        "reading_viewed": row[8],
                        "note": row[9],
                        "rejected": bool(row[10]),
                        "suggestion_accepted": bool(row[11]),
                    }

                # LMS material suggestions (video / reading+quiz / audio).
                lms_by_id = {}
                for item in activities:
                    ref = item["material_ref"] or ""
                    if ref.startswith("lms:"):
                        try:
                            lms_by_id.setdefault(int(ref[4:]), []).append(item["activity_key"])
                        except ValueError:
                            pass
                if lms_by_id:
                    # A learner can hold several activity_results rows for one
                    # material (multiple LMS groups, quiz retakes) — aggregate
                    # with bool_or so the suggestion is deterministic and the
                    # best attempt wins, never an arbitrary row.
                    cur.execute(
                        '''
                        select l.aptem_id, r.activity_id,
                               bool_or(lower(coalesce(r.status, '')) = 'completed') as status_completed,
                               bool_or(coalesce(r.video_completed, false)) as video_completed,
                               bool_or(coalesce(r.reading_viewed, false)) as reading_viewed,
                               bool_or(coalesce(r.quiz_attempted, false)) as quiz_attempted,
                               bool_or(coalesce(r.quiz_passed, false)) as quiz_passed,
                               max(ah.actual_hours) as actual_hours,
                               max(ah.activity_date) as activity_date
                        from "Manual_audit".activity_results r
                        join "Manual_audit".learners l on l.learner_id = r.learner_id
                        left join "Manual_audit".activity_actual_hours ah
                          on ah.learner_id = r.learner_id and ah.ref = r.activity_id::text
                         and ah.kind in ('reading_quiz', 'video', 'audio')
                        where l.aptem_id = any(%s) and r.activity_id = any(%s)
                        group by l.aptem_id, r.activity_id
                        ''',
                        [member_ids, list(lms_by_id)],
                    )
                    for row in cur.fetchall():
                        (aptem_id, lms_id, status_completed, video_completed,
                         reading_viewed, quiz_attempted, quiz_passed,
                         actual_hours, activity_date) = row
                        suggestion = {
                            "kind": "lms",
                            "completed": bool(status_completed or video_completed or quiz_passed),
                            "reading_viewed": reading_viewed,
                            "quiz_attempted": quiz_attempted,
                            "quiz_passed": quiz_passed,
                            "actual_hours": float(actual_hours) if actual_hours is not None else None,
                            "date": activity_date.isoformat() if activity_date else None,
                        }
                        for key in lms_by_id[lms_id]:
                            cells.setdefault(f"{aptem_id}:{key}", {})["suggestion"] = suggestion

                # Attendance suggestions matched on the immutable session ref.
                session_refs = {
                    item["material_ref"]: item["activity_key"]
                    for item in activities
                    if (item["material_ref"] or "").startswith("session:")
                }
                if session_refs:
                    # sum() (not max) so a multi-lecture session suggests the
                    # SAME hours the mirror suppression/subtraction removes —
                    # otherwise accepting the suggestion loses real hours.
                    cur.execute(
                        f'''
                        select la.aptem_id,
                               'session:' || {_SLUG_SQL.format(column='la.module')}
                                   || ':' || to_char(la.attendance_date, 'YYYY-MM-DD') as ref,
                               max(coalesce(la.attendance_value, 0)) as attended,
                               sum(la.activity_hours) as hours,
                               max(la.attendance_status) as status
                        from "Manual_audit".learner_attendance la
                        where la.aptem_id = any(%s)
                        group by la.aptem_id, ref
                        ''',
                        [member_ids],
                    )
                    for aptem_id, ref, attended, hours, status in cur.fetchall():
                        key = session_refs.get(ref)
                        if not key:
                            continue
                        cells.setdefault(f"{aptem_id}:{key}", {})["suggestion"] = {
                            "kind": "attendance",
                            "attended": bool(attended),
                            "actual_hours": float(hours) if hours is not None else None,
                            "status": status,
                        }

                # Assignment suggestions via the per-learner ref snapshots.
                name_keys = {
                    (item["material_ref"] or "")[4:]: item["activity_key"]
                    for item in activities
                    if (item["material_ref"] or "").startswith("asg:")
                }
                if name_keys:
                    cur.execute(
                        '''
                        select ar.aptem_id, ar.name_key, la.status,
                               to_char(la.assignment_month::date, 'YYYY-MM'), la.actual_hours
                        from "Manual_audit".plan_assignment_refs ar
                        join "Last_audit".learner_assignments la
                          on la.aptem_id = ar.aptem_id and la.component_id = ar.component_id
                        where ar.group_id = %s and ar.name_key = any(%s)
                          and ar.aptem_id = any(%s)
                        ''',
                        [group_id, list(name_keys), member_ids],
                    )
                    for aptem_id, name_key, status, month, actual_hours in cur.fetchall():
                        key = name_keys.get(name_key)
                        if not key:
                            continue
                        cells.setdefault(f"{aptem_id}:{key}", {})["suggestion"] = {
                            "kind": "assignment",
                            "status": status,
                            "completed": str(status or "").strip().lower() == "completed",
                            "assignment_month": month,
                            "actual_hours": float(actual_hours) if actual_hours is not None else None,
                        }
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not build the matrix.", "details": str(error)}, status=503)
    return JsonResponse({
        "group_id": group_id,
        "month_index": month_index,
        "activities": activities,
        "members": members,
        "cells": cells,
    })


# --- the group's Aptem training plan -----------------------------------------

def _tp_status_bucket(status):
    """Fold Aptem's free-text module status into a countable bucket."""
    text = str(status or "").strip().lower()
    if text == "completed":
        return "completed"
    if "progress" in text:
        return "in_progress"
    if text in ("not started", "notstarted", ""):
        return "not_started"
    return "other"


@require_GET
def plan_group_training_plan(request: HttpRequest, group_id: int) -> JsonResponse:
    """The group's Aptem training plan — the general (majority) plan backbone
    with every member's own module status and month date beside it.

    Group months were seeded from the same majority signature, so
    ``month_index`` here lines up with the Plan tab's month pills. Learners
    share the plan structure with shifted dates, so each member's module is
    matched by name within the same month index first, then anywhere in
    their plan (their months can lag the majority).
    """
    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            if not _group_row(cur, group_id):
                return JsonResponse({"error": "Plan group not found."}, status=404)
            cur.execute(
                '''
                select gm.aptem_id, coalesce(l.learner_name, gm.learner_name),
                       lm.aptem_training_plan
                from "Manual_audit".plan_group_members gm
                left join "Manual_audit".learners l on l.aptem_id = gm.aptem_id
                left join "Audit".learner_match lm on lm.aptem_id = gm.aptem_id
                where gm.group_id = %s and gm.left_at is null
                order by 2
                ''',
                [group_id],
            )
            member_rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse(
            {"error": "Could not load the group's training plan.", "details": str(error)},
            status=503,
        )

    from .match_ledger_views import _training_plan_from_audit

    members_total = len(member_rows)
    plans = {}
    names = {}
    no_plan = []
    for aptem_id, name, raw_plan in member_rows:
        names[aptem_id] = name
        plan = _training_plan_from_audit(raw_plan) if raw_plan else None
        if plan and plan["months"]:
            plans[aptem_id] = plan["months"]
        else:
            no_plan.append({"aptem_id": aptem_id, "name": name})

    if not plans:
        return JsonResponse({
            "group_id": group_id, "members_total": members_total,
            "members_with_plan": 0, "majority_count": 0,
            "members_without_plan": no_plan, "months": [],
        })

    # The general plan = the most common month signature among members. Ties
    # break on the signature itself so the pick is deterministic across
    # requests (dict iteration order would otherwise decide).
    signatures = {}
    for aptem_id, months in plans.items():
        signature = tuple(str(month.get("date") or "")[:7] for month in months)
        bucket = signatures.setdefault(signature, {"count": 0, "months": months, "signature": signature})
        bucket["count"] += 1
    top = max(signatures.values(), key=lambda item: (item["count"], item["signature"]))
    backbone = top["months"]

    def _month_num(calendar):
        try:
            year, month = calendar.split("-")
            return int(year) * 12 + int(month)
        except (AttributeError, ValueError):
            return None

    # Precompute each member's module lookup once (backbone x members x
    # modules would otherwise re-normalise names inside three nested loops):
    # per month position name_key -> [instances in order] (module names DO
    # repeat within one month), plus every occurrence anywhere for the
    # cross-month fallback (shifted starts push modules across months).
    member_maps = {}
    for aptem_id, own_months in plans.items():
        by_month = []
        anywhere = {}
        for own_month in own_months:
            local = {}
            own_cal = str(own_month.get("date") or "")[:7]
            for module in own_month.get("modules", []):
                key = assignment_name_key(module.get("name"))
                local.setdefault(key, []).append(module)
                anywhere.setdefault(key, []).append((_month_num(own_cal), own_month, module))
            by_month.append((own_month, local))
        member_maps[aptem_id] = (by_month, anywhere)

    # Month numbering matches the seeders: months without a real YYYY-MM date
    # (the trailing EPA/end-of-programme rows) are skipped, so month_index
    # here lines up with the plan_months pills. Member matching still uses the
    # raw backbone position, which aligns with the members' raw plans.
    numbered = []
    seen_index = 0
    for month_pos, month in enumerate(backbone):
        if _MONTH_RE.match(str(month.get("date") or "")[:7]):
            seen_index += 1
            numbered.append((seen_index, month_pos, month))

    months_payload = []
    for month_index, month_pos, month in numbered:
        modules_payload = []
        backbone_num = _month_num(str(month.get("date") or "")[:7])
        ordinals = {}
        for module in month.get("modules", []):
            name_key = assignment_name_key(module.get("name"))
            ordinal = ordinals.get(name_key, 0)
            ordinals[name_key] = ordinal + 1
            counts = {"completed": 0, "in_progress": 0, "not_started": 0, "other": 0, "missing": 0}
            learners = []
            for aptem_id in plans:
                by_month, anywhere = member_maps[aptem_id]
                own_month, own = None, None
                # Same month, same occurrence ordinal (repeated names map
                # 1st -> 1st, 2nd -> 2nd instead of collapsing onto the first).
                if month_pos < len(by_month):
                    instances = by_month[month_pos][1].get(name_key) or []
                    if ordinal < len(instances):
                        own_month, own = by_month[month_pos][0], instances[ordinal]
                if own is None:
                    # Fallback: the occurrence closest in calendar time to the
                    # backbone month — recurring modules (progress reviews,
                    # monthly job activities) must not all map to the first.
                    occurrences = anywhere.get(name_key) or []
                    if occurrences:
                        _, own_month, own = min(
                            occurrences,
                            key=lambda occ: abs(occ[0] - backbone_num)
                            if occ[0] is not None and backbone_num is not None else 10 ** 9,
                        )
                if own is None:
                    counts["missing"] += 1
                    learners.append({
                        "aptem_id": aptem_id, "name": names.get(aptem_id),
                        "status": "Not on plan", "bucket": "missing", "date": None,
                    })
                    continue
                bucket = _tp_status_bucket(own.get("status"))
                counts[bucket] += 1
                learners.append({
                    "aptem_id": aptem_id, "name": names.get(aptem_id),
                    "status": own.get("status") or "Unknown", "bucket": bucket,
                    "date": str(own_month.get("date") or "")[:10] or None,
                })
            modules_payload.append({
                "name": module.get("name"),
                "type": module.get("type"),
                "counts": counts,
                "learners": learners,
            })
        months_payload.append({
            "month_index": month_index,
            "label": month.get("month"),
            "date": str(month.get("date") or "")[:10] or None,
            "modules": modules_payload,
        })

    return JsonResponse({
        "group_id": group_id,
        "members_total": members_total,
        "members_with_plan": len(plans),
        "majority_count": top["count"],
        "members_without_plan": no_plan,
        "months": months_payload,
    })


# --- member suggestions ---------------------------------------------------------

@require_GET
def plan_suggest_members(request: HttpRequest, group_id: int) -> JsonResponse:
    """Cohort learners for the member-selection step, flagged by membership."""
    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            if not _group_row(cur, group_id):
                return JsonResponse({"error": "Plan group not found."}, status=404)
            cur.execute(
                '''
                select l.aptem_id, l.learner_name, l.learner_email, l.programme_name,
                       l.programme_status, l.learner_id,
                       exists (
                           select 1 from "Manual_audit".plan_group_members pm
                           where pm.aptem_id = l.aptem_id and pm.left_at is null and pm.group_id = %s
                       ) as in_this_group,
                       exists (
                           select 1 from "Manual_audit".plan_group_members pm
                           join "Manual_audit".plan_groups pg on pg.id = pm.group_id
                           where pm.aptem_id = l.aptem_id and pm.left_at is null
                             and pm.group_id <> %s and pg.kind = 'cohort' and pg.status <> 'archived'
                       ) as in_other_group
                from "Manual_audit".learners l
                where l.aptem_id is not null
                order by lower(coalesce(l.learner_name, '')), l.aptem_id
                ''',
                [group_id, group_id],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load learners.", "details": str(error)}, status=503)
    return JsonResponse({
        "items": [
            {
                "aptem_id": row[0],
                "name": row[1],
                "email": row[2],
                "programme": row[3],
                "status": row[4] or "Unknown",
                # NULL learner_id => no LMS linkage => suggestions impossible.
                "lms_linked": row[5] is not None,
                "in_this_group": bool(row[6]),
                "in_other_group": bool(row[7]),
            }
            for row in rows
        ]
    })
