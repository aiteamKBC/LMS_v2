"""Read-only curriculum lookups for the training-plan builder.

Data source: the `curriculum` schema on the same Neon database as enrolment.
These tables are authored elsewhere, so we only ever read them — plain raw SQL
against the `enrolment` connection (no models, no writes).

Cascade (mirrors the builder UI):
    programmes                -> distinct Training_plan.Program
    cohorts?programme=        -> distinct Training_plan.Cohort_name
    groups?programme=&cohort= -> distinct Training_plan.group_name
    modules?programme=        -> authored modules for the programme (NOT filtered
                                 by cohort/group — modules belong to the programme)
    weeks?module=             -> module_authoring_weeks for a module
    components?week=          -> module_authoring_components for a week

How the authoring tables link together:
    Training_plan(id, Program, Cohort_name, group_name, module_name)
        the master grid — one row per module scheduled for a group.
    module_authoring_modules(module_catalogue_id, title, imported_from_training_plan_id)
        authored module content; ties back to a Training_plan row (and, by
        title, to that group's module_name).
    module_authoring_weeks(id, module_catalogue_id)      -> belongs to a module
    module_authoring_components(id, week_id)             -> belongs to a week
So a group's modules come from Training_plan.module_name; each module's weeks
and components follow the module_catalogue_id / week_id chain.
"""
from django.db import DatabaseError, connections
from django.http import JsonResponse


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
        return _error(f"Database error: {exc}", 502)


def programmes(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    return _guard(lambda: [
        r["Program"]
        for r in _rows(
            'SELECT DISTINCT "Program" FROM curriculum."Training_plan" '
            'WHERE "Program" IS NOT NULL AND "Program" <> \'\' '
            'ORDER BY "Program"'
        )
    ])


def cohorts(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    if not programme:
        return _error("programme query param is required.", 400)
    return _guard(lambda: [
        r["Cohort_name"]
        for r in _rows(
            'SELECT DISTINCT "Cohort_name" FROM curriculum."Training_plan" '
            'WHERE "Program" = %s AND "Cohort_name" IS NOT NULL AND "Cohort_name" <> \'\' '
            'ORDER BY "Cohort_name"',
            [programme],
        )
    ])


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
            'SELECT DISTINCT "group_name" FROM curriculum."Training_plan" '
            'WHERE "Program" = %s AND "Cohort_name" = %s '
            'AND "group_name" IS NOT NULL AND "group_name" <> \'\' '
            'ORDER BY "group_name"',
            [programme, cohort],
        )
    ])


def modules(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    programme = (request.GET.get("programme") or "").strip()
    if not programme:
        return _error("programme query param is required.", 400)
    # Modules belong to the PROGRAMME (not the cohort/group). programme_id mirrors
    # Training_plan.Program exactly; programme_name is the base label (e.g. 'ME L4'
    # for 'ME L4 L4'), matched loosely so both forms resolve.
    return _guard(lambda: [
        {"id": r["module_catalogue_id"], "title": r["title"] or r["module_catalogue_id"]}
        for r in _rows(
            "SELECT module_catalogue_id, title FROM curriculum.module_authoring_modules "
            "WHERE programme_id = %s OR programme_name = %s OR %s LIKE programme_name || ' %%' "
            "ORDER BY title",
            [programme, programme, programme],
        )
    ])


def weeks(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    module = (request.GET.get("module") or "").strip()
    if not module:
        return _error("module query param is required.", 400)
    return _guard(lambda: [
        {"id": r["id"], "title": r["title"] or f"Week {r['week_number']}", "weekNumber": r["week_number"]}
        for r in _rows(
            "SELECT id, week_number, title FROM curriculum.module_authoring_weeks "
            "WHERE module_catalogue_id = %s "
            "ORDER BY week_number, display_order",
            [module],
        )
    ])


def components(request):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    week = (request.GET.get("week") or "").strip()
    if not week:
        return _error("week query param is required.", 400)
    return _guard(lambda: [
        {"id": r["id"], "title": r["title"] or r["type"], "type": r["type"]}
        for r in _rows(
            "SELECT id, type, title FROM curriculum.module_authoring_components "
            "WHERE week_id = %s "
            "ORDER BY display_order",
            [week],
        )
    ])
