"""Plan-builder picker endpoints — the "select from your group's data" sources.

Every picker scopes to the group's own members first (the design rule: suggest
from the group's data, or build by hand):

* attendance sessions  -> "Manual_audit".learner_attendance grouped by
  (date, module) — sessions at least one member attended;
* materials            -> "Manual_audit".activities, default-scoped to what the
  members actually touched (activity_results), full catalogue as fallback;
* assignments          -> "Last_audit".learner_assignments aggregated by the
  normalised component NAME (component ids are unique per learner);
* KSBs                 -> curriculum.standard_ksbs (the IfATE standard list);
* LMS groups           -> mirror groups/group_learners as membership seeds.
"""

from django.db import DatabaseError, connections
from django.http import HttpRequest, JsonResponse
from django.views.decorators.http import require_GET

from .common import CONN
from .plan_tables import assignment_name_key, ensure_plan_tables

# Catalog casing differs from the wire categories ('Reading+Quiz' vs 'reading+quiz').
_CATALOG_TYPES = {"video": "video", "reading+quiz": "Reading+Quiz", "audio": "audio"}


def _member_ids(cur, group_id):
    cur.execute(
        'select aptem_id from "Manual_audit".plan_group_members '
        'where group_id = %s and left_at is null',
        [group_id],
    )
    return [row[0] for row in cur.fetchall()]


@require_GET
def picker_attendance_sessions(request: HttpRequest) -> JsonResponse:
    """Sessions (date + module) for one calendar month, member-scoped.

    ?group_id=&month=YYYY-MM[&all=1] — default lists only sessions where at
    least one group member has an attendance row; all=1 expands to every
    session that month.
    """
    try:
        group_id = int(request.GET.get("group_id", ""))
    except ValueError:
        return JsonResponse({"error": "group_id is required"}, status=400)
    month = str(request.GET.get("month") or "").strip()
    if len(month) != 7 or month[4] != "-":
        return JsonResponse({"error": "month must be YYYY-MM"}, status=400)
    include_all = str(request.GET.get("all") or "").strip() in {"1", "true", "yes"}

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            members = _member_ids(cur, group_id)
            # Per-learner sums first: a session can hold several lecture rows
            # per learner, and the plan's hours must equal what the mirror
            # dedup later removes (sum, never max). default_hours = the most
            # common per-learner sum (mode), so one duplicated import row
            # cannot seed an absurd figure.
            cur.execute(
                '''
                with per_learner as (
                    select la.attendance_date::date as session_date,
                           coalesce(la.module, '') as module_raw,
                           la.aptem_id,
                           sum(la.activity_hours) as learner_hours,
                           max(coalesce(la.attendance_value, 0)) as attended
                    from "Manual_audit".learner_attendance la
                    where to_char(la.attendance_date::date, 'YYYY-MM') = %s
                    group by 1, 2, la.aptem_id
                )
                select session_date, module_raw,
                       count(*) as total_learners,
                       count(*) filter (where aptem_id = any(%s)) as member_learners,
                       count(*) filter (where aptem_id = any(%s) and attended > 0) as members_attended,
                       mode() within group (order by learner_hours) as typical_hours
                from per_learner
                group by session_date, module_raw
                order by session_date, module_raw
                ''',
                [month, members or [0], members or [0]],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load attendance sessions.", "details": str(error)}, status=503)

    items = []
    for session_date, module_raw, total, member_count, attended, typical_hours in rows:
        if not include_all and not member_count:
            continue
        date_text = session_date.isoformat()
        items.append({
            # Immutable session identity — slugged from the RAW module string
            # so it always matches the projection's SQL slug (an unlabelled
            # session slugs to 'unnamed' on both sides). Display text is
            # prettified separately.
            "session_ref": f"session:{assignment_name_key(module_raw)}:{date_text}",
            "date": date_text,
            "module": str(module_raw or "").strip() or "Unlabelled session",
            "total_learners": total,
            "member_learners": member_count,
            "members_attended": attended,
            "default_hours": float(typical_hours) if typical_hours is not None else 2.5,
        })
    return JsonResponse({"items": items, "month": month, "member_count": len(members)})


@require_GET
def picker_attendance_grid(request: HttpRequest) -> JsonResponse:
    """The bulk-attendance grid for one month: learners x session days.

    ?group_id=&month=YYYY-MM[&all=1] — mirrors the student portal's /bulk
    sheet: every day (date + module) is a column, every learner a row, each
    cell attended/absent. Default scope = the group's members (all of them,
    even without attendance rows) over the sessions any member appears in;
    all=1 expands to every session and every learner of the month.
    """
    try:
        group_id = int(request.GET.get("group_id", ""))
    except ValueError:
        return JsonResponse({"error": "group_id is required"}, status=400)
    month = str(request.GET.get("month") or "").strip()
    if len(month) != 7 or month[4] != "-":
        return JsonResponse({"error": "month must be YYYY-MM"}, status=400)
    include_all = str(request.GET.get("all") or "").strip() in {"1", "true", "yes"}

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            cur.execute(
                '''
                select pm.aptem_id, pm.learner_name
                from "Manual_audit".plan_group_members pm
                where pm.group_id = %s and pm.left_at is null
                order by lower(coalesce(pm.learner_name, '')), pm.aptem_id
                ''',
                [group_id],
            )
            member_rows = cur.fetchall()
            member_ids = {row[0] for row in member_rows}
            # One row per (learner, session): hours summed, attendance rolled up.
            cur.execute(
                '''
                select la.attendance_date::date as session_date,
                       coalesce(la.module, '') as module_raw,
                       la.aptem_id,
                       l.learner_name,
                       sum(la.activity_hours) as hours,
                       max(coalesce(la.attendance_value, 0)) as attended,
                       max(la.attendance_status) as status
                from "Manual_audit".learner_attendance la
                left join "Manual_audit".learners l on l.aptem_id = la.aptem_id
                where to_char(la.attendance_date::date, 'YYYY-MM') = %s
                group by 1, 2, la.aptem_id, l.learner_name
                order by 1, 2
                ''',
                [month],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load the attendance grid.", "details": str(error)}, status=503)

    days = {}
    cells = {}
    extra_learners = {}
    for session_date, module_raw, aptem_id, learner_name, hours, attended, status in rows:
        date_text = session_date.isoformat()
        ref = f"session:{assignment_name_key(module_raw)}:{date_text}"
        day = days.setdefault(ref, {
            "session_ref": ref,
            "date": date_text,
            "module": str(module_raw or "").strip() or "Unlabelled session",
            "member_attended": 0,
            "member_rows": 0,
            "total_learners": 0,
            "hours_values": [],
        })
        day["total_learners"] += 1
        is_member = aptem_id in member_ids
        if is_member:
            day["member_rows"] += 1
            if attended:
                day["member_attended"] += 1
        if hours is not None:
            day["hours_values"].append(float(hours))
        if is_member or include_all:
            cells[f"{aptem_id}:{ref}"] = {
                "attended": bool(attended),
                "hours": float(hours) if hours is not None else None,
                "status": status,
            }
            if not is_member:
                extra_learners[aptem_id] = learner_name
    # A day belongs to the grid when a member appears in it — or always with all=1.
    visible_days = [
        day for day in days.values()
        if include_all or day["member_rows"] > 0
    ]
    for day in visible_days:
        values = day.pop("hours_values")
        # Most common per-learner sum = the planning default for the day.
        day["default_hours"] = (
            max(set(values), key=values.count) if values else 2.5
        )
    visible_days.sort(key=lambda item: (item["date"], item["module"]))

    learners = [
        {"aptem_id": aptem_id, "name": name, "is_member": True}
        for aptem_id, name in member_rows
    ]
    if include_all:
        learners.extend(
            {"aptem_id": aptem_id, "name": name, "is_member": False}
            for aptem_id, name in sorted(extra_learners.items(), key=lambda kv: str(kv[1] or ""))
        )
    return JsonResponse({
        "month": month,
        "days": visible_days,
        "learners": learners,
        "cells": cells,
    })


@require_GET
def picker_materials(request: HttpRequest) -> JsonResponse:
    """LMS materials, ranked by the group's own engagement.

    ?group_id=&type=video|reading+quiz|audio&search=&scope=group|all&limit=&offset=
    scope=group (default): only materials the members' LMS accounts touched,
    ranked by engaged-member count. scope=all: the full 10k catalogue.
    """
    try:
        group_id = int(request.GET.get("group_id", ""))
    except ValueError:
        return JsonResponse({"error": "group_id is required"}, status=400)
    type_param = str(request.GET.get("type") or "").strip().lower()
    if type_param and type_param not in _CATALOG_TYPES:
        return JsonResponse({"error": "type must be video, reading+quiz, or audio"}, status=400)
    catalog_type = _CATALOG_TYPES.get(type_param, "")
    search = str(request.GET.get("search") or "").strip()[:200]
    scope = str(request.GET.get("scope") or "group").strip()
    try:
        limit = min(max(int(request.GET.get("limit", "50")), 1), 200)
        offset = max(int(request.GET.get("offset", "0")), 0)
    except ValueError:
        return JsonResponse({"error": "limit/offset must be integers"}, status=400)

    columns = '''
        a.activity_id, a.activity_type, a.title, a.activity_date,
        a.configured_duration_min,
        (coalesce(a.video_iframe_url, '') <> '' or coalesce(a.reading_iframe_url, '') <> '') as has_iframe,
        coalesce(a.reading_text_body, '') <> '' as has_text,
        a.quiz_id is not null as has_quiz
    '''
    filters = "(%s = '' or a.activity_type = %s) and (%s = '' or a.title ilike '%%' || %s || '%%')"
    filter_params = [catalog_type, catalog_type, search, search]

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            if scope == "all":
                cur.execute(
                    f'''
                    select {columns}, 0 as engaged_members
                    from "Manual_audit".activities a
                    where {filters}
                    order by a.title, a.activity_id
                    limit %s offset %s
                    ''',
                    [*filter_params, limit, offset],
                )
            else:
                cur.execute(
                    f'''
                    with member_lms as (
                        select l.learner_id
                        from "Manual_audit".learners l
                        join "Manual_audit".plan_group_members pm
                          on pm.aptem_id = l.aptem_id and pm.left_at is null and pm.group_id = %s
                        where l.learner_id is not null
                    )
                    select {columns}, count(distinct r.learner_id) as engaged_members
                    from "Manual_audit".activities a
                    join "Manual_audit".activity_results r on r.activity_id = a.activity_id
                    join member_lms m on m.learner_id = r.learner_id
                    where {filters}
                    group by a.activity_id, a.activity_type, a.title, a.activity_date,
                             a.configured_duration_min, a.video_iframe_url,
                             a.reading_iframe_url, a.reading_text_body, a.quiz_id
                    order by engaged_members desc, a.title, a.activity_id
                    limit %s offset %s
                    ''',
                    [group_id, *filter_params, limit, offset],
                )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load materials.", "details": str(error)}, status=503)

    items = []
    for row in rows:
        duration_min = float(row[4]) if row[4] is not None else None
        items.append({
            "material_ref": f"lms:{row[0]}",
            "activity_id": row[0],
            "type": row[1],
            "title": row[2],
            "activity_date": row[3].isoformat() if row[3] else None,
            "suggested_hours": round(duration_min / 60, 2) if duration_min else None,
            "has_iframe": bool(row[5]),
            "has_text": bool(row[6]),
            "has_quiz": bool(row[7]),
            "engaged_members": row[8],
        })
    return JsonResponse({"items": items, "scope": scope, "limit": limit, "offset": offset})


@require_GET
def picker_assignments(request: HttpRequest) -> JsonResponse:
    """Aptem assignments for the group's members, aggregated by normalised name.

    Component ids are unique per learner, so aggregation and the plan ref use
    the name key; each row carries the per-learner (aptem_id -> component_id)
    resolution the plan POST snapshots into plan_assignment_refs.
    """
    try:
        group_id = int(request.GET.get("group_id", ""))
    except ValueError:
        return JsonResponse({"error": "group_id is required"}, status=400)

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            members = _member_ids(cur, group_id)
            if not members:
                return JsonResponse({"items": [], "member_count": 0})
            cur.execute(
                '''
                select aptem_id, component_id, component_name,
                       to_char(assignment_month::date, 'YYYY-MM') as month,
                       status, planned_hours, actual_hours
                from "Last_audit".learner_assignments
                where aptem_id = any(%s)
                order by component_name, aptem_id
                ''',
                [members],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load assignments.", "details": str(error)}, status=503)

    aggregated = {}
    for aptem_id, component_id, component_name, month, status, planned, actual in rows:
        key = assignment_name_key(component_name)
        bucket = aggregated.setdefault(key, {
            "material_ref": f"asg:{key}",
            "name_key": key,
            "name": str(component_name or "").strip(),
            "learners": [],
            "status_counts": {},
            "month_counts": {},
            "suggested_hours": None,
        })
        bucket["learners"].append({
            "aptem_id": aptem_id,
            "component_id": component_id,
            "component_name": str(component_name or "").strip(),
            "assignment_month": month,
            "status": status,
        })
        status_key = str(status or "Unknown")
        bucket["status_counts"][status_key] = bucket["status_counts"].get(status_key, 0) + 1
        if month:
            bucket["month_counts"][month] = bucket["month_counts"].get(month, 0) + 1
        if bucket["suggested_hours"] is None and planned is not None:
            bucket["suggested_hours"] = float(planned)

    items = sorted(aggregated.values(), key=lambda item: item["name"].lower())
    for item in items:
        item["learner_count"] = len(item["learners"])
    return JsonResponse({"items": items, "member_count": len(members)})


@require_GET
def picker_ksbs(request: HttpRequest) -> JsonResponse:
    """The IfATE standard KSB codes, grouped K/S/B, optionally per standard."""
    standard = str(request.GET.get("standard") or "").strip()[:300]
    search = str(request.GET.get("search") or "").strip()[:200]
    try:
        with connections[CONN].cursor() as cur:
            cur.execute('select distinct standard_title from curriculum.standard_ksbs order by 1')
            standards = [row[0] for row in cur.fetchall()]
            cur.execute(
                '''
                select ksb_code, ksb_type, ksb_description
                from curriculum.standard_ksbs
                where (%s = '' or standard_title = %s)
                  and (%s = '' or ksb_description ilike '%%' || %s || '%%' or ksb_code ilike %s || '%%')
                order by ksb_type, length(ksb_code), ksb_code
                ''',
                [standard, standard, search, search, search],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load the KSB list.", "details": str(error)}, status=503)

    grouped = {"K": [], "S": [], "B": []}
    type_map = {"knowledge": "K", "skill": "S", "behaviour": "B"}
    for code, ksb_type, description in rows:
        bucket = type_map.get(str(ksb_type or "").strip().lower())
        if not bucket:
            bucket = (str(code or "?")[:1].upper() if str(code or "?")[:1].upper() in grouped else None)
        if bucket:
            grouped[bucket].append({"code": code, "description": description})
    return JsonResponse({"standards": standards, "ksbs": grouped, "standard": standard})


@require_GET
def picker_assignment_evidence(request: HttpRequest) -> JsonResponse:
    """Per-learner submitted documents for one plan assignment (name-keyed).

    Documents resolve through the per-learner component snapshot in
    plan_assignment_refs -> fetching_evidence.evidence_items; preview/download
    reuses the existing /manual_audit_api/evidence/<id>/open streaming endpoint
    (inline PDF + Office viewer), so an assignment doc previews "like any
    document".
    """
    try:
        group_id = int(request.GET.get("group_id", ""))
    except ValueError:
        return JsonResponse({"error": "group_id is required"}, status=400)
    name_key = str(request.GET.get("name_key") or "").strip()
    if not name_key:
        return JsonResponse({"error": "name_key is required"}, status=400)

    try:
        with connections[CONN].cursor() as cur:
            ensure_plan_tables(cur)
            cur.execute(
                '''
                select ar.aptem_id, pm.learner_name,
                       ei.evidence_id, ei.evidence_name, ei.evidence_kind,
                       ei.evidence_status, ei.submission_date,
                       (ei.file_blob is not null and ei.file_blob <> '') as has_blob,
                       ei.source_file_url
                from "Manual_audit".plan_assignment_refs ar
                join "Manual_audit".plan_group_members pm
                  on pm.group_id = ar.group_id and pm.aptem_id = ar.aptem_id
                 and pm.left_at is null
                left join fetching_evidence.evidence_items ei
                  on ei.learner_id = ar.aptem_id and ei.component_id = ar.component_id
                where ar.group_id = %s and ar.name_key = %s
                order by lower(coalesce(pm.learner_name, '')), ar.aptem_id,
                         ei.submission_date desc nulls last
                ''',
                [group_id, name_key],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load assignment evidence.", "details": str(error)}, status=503)

    learners = {}
    for (aptem_id, learner_name, evidence_id, evidence_name, evidence_kind,
         evidence_status, submission_date, has_blob, source_file_url) in rows:
        bucket = learners.setdefault(aptem_id, {
            "aptem_id": aptem_id,
            "name": learner_name,
            "documents": [],
        })
        if evidence_id is None:
            continue
        bucket["documents"].append({
            "evidence_id": evidence_id,
            "name": evidence_name,
            "kind": evidence_kind,
            "status": evidence_status,
            "submission_date": str(submission_date)[:10] if submission_date else None,
            # Azure-backed preview through the existing streaming endpoint;
            # falls back to the Aptem link (requires an Aptem session) if the
            # blob was never fetched.
            "open_url": (
                f"/manual_audit_api/evidence/{evidence_id}/open?learner_id={aptem_id}"
                if has_blob else None
            ),
            "aptem_url": source_file_url,
        })
    return JsonResponse({"items": list(learners.values()), "name_key": name_key})


def _programme_variant_rows(cur):
    """(programme variant, aptem count, cohort count) straight from Aptem."""
    cur.execute(
        '''
        select btrim(au."Program Name") as programme,
               count(*) as aptem_learners,
               count(l.aptem_id) as in_cohort
        from "LMS"."Aptem_users" au
        left join "Manual_audit".learners l on l.aptem_id = au."ID"
        where coalesce(btrim(au."Program Name"), '') <> ''
        group by 1
        '''
    )
    return cur.fetchall()


@require_GET
def picker_aptem_programmes(request: HttpRequest) -> JsonResponse:
    """Aptem programmes exactly as named (FULL name including the cohort) —
    each one holds precisely the groups its learner rows link it to."""
    try:
        with connections[CONN].cursor() as cur:
            rows = _programme_variant_rows(cur)
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load Aptem programmes.", "details": str(error)}, status=503)
    items = [
        {"programme": programme, "aptem_learners": aptem_learners, "in_cohort": in_cohort}
        for programme, aptem_learners, in_cohort in rows
    ]
    items.sort(key=lambda item: -item["aptem_learners"])
    return JsonResponse({"items": items})


@require_GET
def picker_aptem_groups(request: HttpRequest) -> JsonResponse:
    """One programme's groups from Aptem's own Group field — the exact
    (Program Name, Group) linkage as it appears row by row in Aptem."""
    programme = str(request.GET.get("programme") or "").strip()
    if not programme:
        return JsonResponse({"error": "programme is required"}, status=400)
    try:
        with connections[CONN].cursor() as cur:
            cur.execute(
                '''
                select btrim(au."Group") as group_name,
                       count(*) as aptem_learners,
                       count(l.aptem_id) as in_cohort
                from "LMS"."Aptem_users" au
                left join "Manual_audit".learners l on l.aptem_id = au."ID"
                where btrim(au."Program Name") = %s
                  and coalesce(btrim(au."Group"), '') <> ''
                group by 1
                order by 2 desc, 1
                ''',
                [programme],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load Aptem groups.", "details": str(error)}, status=503)
    return JsonResponse({
        "items": [
            {"group": row[0], "aptem_learners": row[1], "in_cohort": row[2]}
            for row in rows
        ],
        "programme": programme,
    })


@require_GET
def picker_training_plan(request: HttpRequest) -> JsonResponse:
    """The GENERAL training plan of one programme (full Aptem name).

    Learners of a cohort share one plan structure with per-learner date
    shifts, so the "general" plan = the most common month signature among the
    programme's learners; its representative content (months + modules) is
    what the auditor sees under the programme.
    """
    programme = str(request.GET.get("programme") or "").strip()
    if not programme:
        return JsonResponse({"error": "programme is required"}, status=400)
    try:
        with connections[CONN].cursor() as cur:
            cur.execute(
                '''
                select lm.aptem_id, lm.aptem_training_plan
                from "LMS"."Aptem_users" au
                join "Manual_audit".learners l on l.aptem_id = au."ID"
                join "Audit".learner_match lm on lm.aptem_id = l.aptem_id
                where btrim(au."Program Name") = %s
                  and lm.aptem_training_plan is not null
                  and jsonb_typeof(lm.aptem_training_plan::jsonb) = 'array'
                  and jsonb_array_length(lm.aptem_training_plan::jsonb) > 0
                ''',
                [programme],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load the training plan.", "details": str(error)}, status=503)

    if not rows:
        return JsonResponse({
            "programme": programme, "learners_with_plan": 0, "plan": None,
        })

    # Normalise every learner's plan with the same helper the profile uses,
    # then pick the most common month signature as "the general plan".
    from .match_ledger_views import _training_plan_from_audit

    signatures = {}
    for aptem_id, raw_plan in rows:
        plan = _training_plan_from_audit(raw_plan)
        signature = tuple(str(month.get("date") or "")[:7] for month in plan["months"])
        bucket = signatures.setdefault(signature, {"count": 0, "plan": plan, "aptem_id": aptem_id})
        bucket["count"] += 1
    top = max(signatures.values(), key=lambda item: item["count"])
    plan = top["plan"]

    months = [
        {
            "month": month.get("month"),
            "date": str(month.get("date") or "")[:10] or None,
            "modules": [
                {
                    "name": module.get("name"),
                    "type": module.get("type"),
                    "status": module.get("status"),
                }
                for module in month.get("modules", [])
            ],
        }
        for month in plan["months"]
    ]
    return JsonResponse({
        "programme": programme,
        "learners_with_plan": len(rows),
        "majority_count": top["count"],
        "total_modules": plan.get("total_modules"),
        "months": months,
    })


@require_GET
def picker_lms_groups(request: HttpRequest) -> JsonResponse:
    """Mirror LMS groups as membership seeds (?group_id= lists its learners).

    ?programme= narrows the list to that Aptem programme: the count becomes
    "this programme's learners inside the group" and groups without any of
    them disappear — the programme -> its groups cascade.
    """
    lms_group_id = str(request.GET.get("group_id") or "").strip()
    programme = str(request.GET.get("programme") or "").strip()
    try:
        with connections[CONN].cursor() as cur:
            if not lms_group_id:
                if programme:
                    cur.execute(
                        '''
                        select g.group_id, g.group_name, count(distinct l.aptem_id)
                        from "Manual_audit".groups g
                        join "Manual_audit".group_learners gl on gl.group_id = g.group_id
                        join "Manual_audit".learners l
                          on l.learner_id = gl.learner_id and l.aptem_id is not null
                        where l.programme_name = %s
                        group by g.group_id, g.group_name
                        order by count(distinct l.aptem_id) desc, g.group_name
                        ''',
                        [programme],
                    )
                else:
                    cur.execute(
                        '''
                        select g.group_id, g.group_name, count(distinct gl.learner_id)
                        from "Manual_audit".groups g
                        left join "Manual_audit".group_learners gl on gl.group_id = g.group_id
                        group by g.group_id, g.group_name
                        order by g.group_name
                        '''
                    )
                return JsonResponse({
                    "items": [
                        {"group_id": row[0], "name": row[1], "learner_count": row[2]}
                        for row in cur.fetchall()
                    ]
                })
            cur.execute(
                '''
                select distinct l.aptem_id, l.learner_name, l.learner_email, l.programme_status
                from "Manual_audit".group_learners gl
                join "Manual_audit".learners l on l.learner_id = gl.learner_id
                where gl.group_id = %s and l.aptem_id is not null
                order by l.learner_name
                ''',
                [lms_group_id],
            )
            rows = cur.fetchall()
    except (KeyError, DatabaseError) as error:
        return JsonResponse({"error": "Could not load LMS groups.", "details": str(error)}, status=503)
    return JsonResponse({
        "items": [
            {"aptem_id": row[0], "name": row[1], "email": row[2], "status": row[3] or "Unknown"}
            for row in rows
        ]
    })
