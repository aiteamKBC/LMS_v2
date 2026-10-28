"""Read-only curriculum lookups for the training-plan builder.

Data source: normalized tables in the `curriculum` schema.

Cascade (mirrors the builder UI):
    programmes                -> curriculum.programmes
    cohorts?programme=        -> curriculum.cohorts
    groups?programme=&cohort= -> curriculum.groups
    modules?programme=        -> authored modules for the programme (NOT filtered
                                 by cohort/group — modules belong to the programme)
    weeks?module=             -> weeks for a module
    components?week=          -> components for a week

How the authoring tables link together:
    programmes(program_id, name)
        the master grid — one row per module scheduled for a group.
    modules(module_catalogue_id, programme_id, title)
        authored module content linked by programme/module ids (and, by
        title, to that group's module_name).
    weeks(id, module_catalogue_id)      -> belongs to a module
    components(id, week_id)             -> belongs to a week
Modules, weeks and components follow the module_catalogue_id / week_id chain.
"""
import json
import logging

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from login.permissions import require_role, staff_only

from .ksb_sources import PROFILE, STANDARD, parse_source, resolve_source
from .selectors.identity import EnrolmentId, ResolutionStatus, resolve_many_for_enrolments


logger = logging.getLogger(__name__)


def _conn():
    return connections["enrolment"]


def _rows(sql, params=None):
    with _conn().cursor() as cur:
        cur.execute(sql, params or [])
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _guard(fn):
    """Wrap a lookup so DB errors become a clean 502 instead of a 500."""
    try:
        return JsonResponse({"results": fn()})
    except DatabaseError as exc:
        logger.error("Database operation failed (%s)", type(exc).__name__)
        return _error("The database service is temporarily unavailable.", 502)


@staff_only()
def programmes(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return _guard(lambda: [
        r["name"]
        for r in _rows(
            "SELECT DISTINCT COALESCE(NULLIF(name, ''), NULLIF(programme_id, '')) AS name "
            "FROM curriculum.programmes "
            "WHERE COALESCE(NULLIF(name, ''), NULLIF(programme_id, '')) IS NOT NULL "
            "  AND COALESCE(is_archived, false) = false "
            "ORDER BY name"
        )
    ])


@staff_only()
def cohorts(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    if not programme:
        return _error("programme query param is required.", 400)
    return _guard(lambda: [
        r["cohort_name"]
        for r in _rows(
            "SELECT DISTINCT cohort_name FROM curriculum.cohorts "
            "WHERE cohort_name IS NOT NULL AND cohort_name <> '' "
            "  AND (programme_name = %s OR programme_id = %s) "
            "ORDER BY cohort_name",
            [programme, programme],
        )
    ])


@staff_only()
def groups(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    cohort = (request.GET.get("cohort") or "").strip()
    if not programme or not cohort:
        return _error("programme and cohort query params are required.", 400)
    return _guard(lambda: [
        r["group_name"]
        for r in _rows(
            "SELECT DISTINCT group_name FROM curriculum.groups "
            "WHERE group_name IS NOT NULL AND group_name <> '' "
            "  AND (programme_name = %s OR programme_id = %s) "
            "  AND (cohort_name = %s OR cohort_id = %s) "
            "ORDER BY group_name",
            [programme, programme, cohort, cohort],
        )
    ])


@staff_only()
def modules(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    if not programme:
        return _error("programme query param is required.", 400)
    # Modules belong to the programme in the normalized curriculum schema.
    return _guard(lambda: [
        {"id": r["module_catalogue_id"], "title": r["title"] or r["module_catalogue_id"]}
        for r in _rows(
            "SELECT module_catalogue_id, title FROM curriculum.modules "
            "WHERE programme_id = %s OR programme_name = %s OR %s LIKE programme_name || ' %%' "
            "ORDER BY title",
            [programme, programme, programme],
        )
    ])


@staff_only()
def weeks(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    module = (request.GET.get("module") or "").strip()
    if not module:
        return _error("module query param is required.", 400)
    return _guard(lambda: [
        {"id": r["id"], "title": r["title"] or f"Week {r['week_number']}", "weekNumber": r["week_number"]}
        for r in _rows(
            "SELECT id, week_number, title FROM curriculum.weeks "
            "WHERE module_catalogue_id = %s "
            f"AND {visible_week_sql('weeks')} "
            "ORDER BY week_number, display_order",
            [module],
        )
    ])


@staff_only()
def components(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    week = (request.GET.get("week") or "").strip()
    if not week:
        return _error("week query param is required.", 400)
    return _guard(lambda: [
        {
            "id": r["id"],
            "title": r["title"] or r["type"],
            "type": r["type"],
            "expectedOtjh": float(r["expected_otjh"]) if r["expected_otjh"] is not None else None,
        }
        for r in _rows(
            "SELECT id, type, title, expected_otjh FROM curriculum.components "
            "WHERE week_id = %s "
            f"AND {visible_child_sql('components')} "
            "ORDER BY display_order",
            [week],
        )
    ])


def _source_row(raw_source):
    """The KSB list an applied source names, shaped like a ksb_profiles row.

    A standard ('standard:st0596-v1-0') is read from curriculum.standard_ksbs.
    A profile id is read even once archived: the programme still applies it,
    and Skills Radar answers were given against its items.
    """
    kind, source_id = parse_source(raw_source)
    if kind == PROFILE:
        rows = _rows(
            "SELECT id, name, ksb_items FROM curriculum.ksb_profiles "
            "WHERE id = %s OR ksb_profile_id = %s "
            "ORDER BY COALESCE(is_active, true) DESC LIMIT 1",
            [source_id, source_id],
        )
        return rows[0] if rows else None
    if kind == STANDARD:
        resolved = resolve_source(raw_source, using="enrolment")
        if not resolved.items:
            return None
        return {
            "id": resolved.source_value,
            "name": resolved.label,
            "ksb_items": [
                {"id": item["id"], "type": item["type"], "code": item["code"],
                 "title": item["title"], "description": item["description"]}
                for item in resolved.items
            ],
        }
    return None


def _ksb_profile_row(programme):
    """The KSB list a programme applies, or None.

    Two links exist, tried in order of authority:
      1. programmes.ksb_profile_source_id — the applied source: a profile id
         ('KSBP-...', 'profile:<id>') or a standard ('standard:st0596-v1-0').
      2. ksb_profiles.programme_ids — discovery for a programme that applies
         nothing; only active profiles take part.
    """
    programme = (programme or "").strip()
    if not programme:
        return None

    source = _rows(
        "SELECT programme_id, ksb_profile_source_id FROM curriculum.programmes "
        "WHERE name = %s OR programme_id = %s LIMIT 1",
        [programme, programme],
    )
    programme_id = (source[0].get("programme_id") or "") if source else ""
    raw_source = (source[0].get("ksb_profile_source_id") or "") if source else ""

    if raw_source:
        row = _source_row(raw_source)
        if row:
            return row

    # programme_ids holds programme ids and names side by side. (This read used
    # programme_id / programme_name, columns ksb_profiles no longer has, so it
    # raised for every programme without an applied source.)
    rows = _rows(
        "SELECT id, name, ksb_items FROM curriculum.ksb_profiles "
        "WHERE COALESCE(is_active, true) "
        "  AND (programme_ids @> to_jsonb(%s::text) OR programme_ids @> to_jsonb(%s::text)) "
        "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
        [programme_id or programme, programme],
    )
    return rows[0] if rows else None


_KSB_KIND = {"K": "Knowledge", "S": "Skill", "B": "Behaviour"}


def ksb_profile_for_programme(programme):
    """(standard, results) for a programme's authored KSB profile.

    Shared by the ksb_profile view and the enrolment review form, which shows the
    learner's Skills Radar answers against these same KSBs. Returns (None, []) for
    an unmapped programme so callers can say "none authored yet" rather than fail.
    """
    return _profile_results(_ksb_profile_row(programme), programme)


def ksb_profile_for_source(source_value, label=""):
    """(standard, results) for one explicit source, e.g. the profile or standard
    a learner's Skills Radar was answered against -- archived or not -- so a
    signed assessment keeps its titles after the programme changes source."""
    return _profile_results(_source_row(source_value) if source_value else None, label)


def _learner_programme_id(account, requested_programme):
    """Return the canonical programme id when this learner owns the request.

    ``LoginAccount.subject_id`` identifies the enrolment record, not the
    Learner profile.  Resolve that bridge through the established read-only
    selector, then accept only an exact, unambiguous curriculum id/name match.
    The raw query parameter is never treated as evidence of ownership.
    """
    if getattr(account, "subject_type", None) != "learner":
        return None
    try:
        enrolment_id = EnrolmentId(int(account.subject_id))
    except (AttributeError, TypeError, ValueError):
        return None

    resolutions = resolve_many_for_enrolments([enrolment_id], query=_rows)
    resolution = resolutions.get(enrolment_id)
    if resolution is None or resolution.status is not ResolutionStatus.RESOLVED:
        return None

    profile = resolution.profile or {}
    assigned_id = str(profile.get("programme_id") or "").strip()
    assigned_name = str(profile.get("programme") or "").strip()
    if not assigned_id and not assigned_name:
        return None

    matches = _rows(
        "SELECT programme_id, name FROM curriculum.programmes "
        "WHERE programme_id = %s OR name = %s "
        "ORDER BY programme_id LIMIT 2",
        [requested_programme, requested_programme],
    )
    if len(matches) != 1:
        return None

    programme_id = str(matches[0].get("programme_id") or "").strip()
    programme_name = str(matches[0].get("name") or "").strip()
    if not programme_id:
        return None
    if assigned_id:
        return programme_id if programme_id == assigned_id else None
    return programme_id if programme_name == assigned_name else None


def _programme_forbidden():
    """One opaque response for missing, ambiguous and cross-programme access."""
    return JsonResponse(
        {
            "error": "You do not have permission to perform this action.",
            "code": "forbidden",
        },
        status=403,
    )


def _profile_results(row, programme):
    if row is None:
        return None, []

    items = row.get("ksb_items")
    if isinstance(items, str):
        try:
            items = json.loads(items)
        except ValueError:
            items = []
    if not isinstance(items, list):
        items = []

    results = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        type_ = (item.get("type") or "").strip().upper()
        number = str(item.get("code") or item.get("number") or "").strip()
        # 'K' + '1' -> 'K1'. Authored codes are sometimes already prefixed.
        code = number if number[:1].upper() in _KSB_KIND else f"{type_}{number}"
        title = (item.get("title") or item.get("description") or "").strip()
        results.append({
            "id": str(item.get("id") or f"{row['id']}-{index}"),
            "theme": (item.get("theme") or _KSB_KIND.get(type_, "")).strip(),
            "kind": _KSB_KIND.get(type_, "Knowledge"),
            "codes": [code] if code else [],
            "title": title,
            "displayOrder": item.get("displayOrder", index),
        })

    results.sort(key=lambda r: (r["displayOrder"] if isinstance(r["displayOrder"], int) else 0))
    for r in results:
        r.pop("displayOrder", None)

    return {"id": row["id"], "label": row.get("name") or programme}, results


@require_role("learner", "staff", "admin")
def ksb_profile(request):
    """The KSB list a learner should self-assess against, for their programme.

        GET /learner_api/curriculum/ksb-profile/?programme=<name>

    Returns {standard: {id, label}, results: [Ksb]} shaped for the Skills Radar
    step. An unmapped programme returns an empty list rather than an error, so
    the step can say "none authored yet" instead of failing.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    if not programme:
        return _error("programme query param is required.", 400)

    try:
        account = request.login_account
        if account.role == "learner":
            programme = _learner_programme_id(account, programme)
            if programme is None:
                return _programme_forbidden()
        standard, results = ksb_profile_for_programme(programme)
    except DatabaseError as exc:
        logger.error("Database operation failed (%s)", type(exc).__name__)
        return _error("The database service is temporarily unavailable.", 502)

    return JsonResponse({"standard": standard, "results": results})


@csrf_exempt
def legacy_otjh(request):
    """Best-effort OTJH lookup for older saved training-plan components."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)
    from .learner_detail import _otjh_by_legacy_title

    try:
        payload = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return _error("Invalid JSON body.", 400)

    items = payload.get("items")
    if not isinstance(items, list):
        return _error("items must be a list of {module, week, component}.", 400)

    components_arg = [
        {"module": it.get("module"), "week": it.get("week"), "component": it.get("component")}
        for it in items if isinstance(it, dict)
    ]

    def run():
        by_key = _otjh_by_legacy_title(components_arg)
        return {
            f"{mod}|{wk}|{comp}": otjh
            for (mod, wk, comp), otjh in by_key.items()
            if otjh is not None
        }

    return _guard(run)
