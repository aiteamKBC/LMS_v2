"""Read-only learner-detail lookup for the learner workspace page.

    GET /learner_api/learner-detail/<kind>/<int:pk>/

`kind` is 'commercial' or 'apprenticeship', matching the vocabulary already
used by the /training-plan/:kind/:userId route. Combines the learner's own
record (CommercialUser / EnrolmentUser) with its "Learner"."Active_users"
mirror (present only while the learner is Active) into one response shaped by
mappers.to_learner_detail, then annotates each saved component with its
authored expected_otjh (curriculum.module_authoring_components) and a
programme-wide total.
"""
import logging

from django.db import DatabaseError, connections
from django.http import JsonResponse

from .mappers import to_learner_detail
from .models import ActiveUser, CommercialUser, EnrolmentUser

logger = logging.getLogger(__name__)

SOURCE_MODELS = {
    "commercial": CommercialUser,
    "apprenticeship": EnrolmentUser,
}


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _humanise_type(type_):
    """Mirror frontend/src/api/curriculum.ts's humaniseType()."""
    if not type_:
        return ""
    spaced = type_.replace("_", " ")
    return spaced[:1].upper() + spaced[1:]


def _display_component_title(type_, title):
    """Mirror frontend/src/api/curriculum.ts's fetchComponents() title display
    logic — needed only for the legacy (pre-id) title-matching fallback below."""
    type_label = _humanise_type(type_)
    show_title = bool(title) and title.strip().lower() != type_label.lower()
    return f"{type_label} · {title}" if show_title else (type_label or title)


def _otjh_by_component_id(components):
    """Exact expected_otjh lookup for components saved with the structured
    plan format (they carry the real curriculum.module_authoring_components id)."""
    ids = sorted({c["componentId"] for c in components if c.get("componentId")})
    if not ids:
        return {}
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT id, expected_otjh FROM curriculum.module_authoring_components WHERE id = ANY(%s)",
                [ids],
            )
            return {cid: (float(v) if v is not None else None) for cid, v in cur.fetchall()}
    except DatabaseError as exc:
        logger.warning("Could not look up expected_otjh by id: %s", exc)
        return {}


def _otjh_by_legacy_title(components):
    """Fallback expected_otjh lookup, by title, for components saved before
    the structured plan format existed (no componentId to match on)."""
    legacy = [c for c in components if not c.get("componentId") and c.get("module")]
    if not legacy:
        return {}
    module_titles = sorted({c["module"] for c in legacy})
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT module_catalogue_id, title FROM curriculum.module_authoring_modules "
                "WHERE title = ANY(%s)",
                [module_titles],
            )
            module_ids = {title: cat_id for cat_id, title in cur.fetchall()}
            if not module_ids:
                return {}

            cur.execute(
                "SELECT id, module_catalogue_id, title FROM curriculum.module_authoring_weeks "
                "WHERE module_catalogue_id = ANY(%s)",
                [list(module_ids.values())],
            )
            week_ids = {(cat_id, title): week_id for week_id, cat_id, title in cur.fetchall()}
            if not week_ids:
                return {}

            cur.execute(
                "SELECT week_id, type, title, expected_otjh FROM curriculum.module_authoring_components "
                "WHERE week_id = ANY(%s)",
                [list(set(week_ids.values()))],
            )
            otjh_by_week_component = {
                (week_id, _display_component_title(ctype, title)): (float(otjh) if otjh is not None else None)
                for week_id, ctype, title, otjh in cur.fetchall()
            }
    except DatabaseError as exc:
        logger.warning("Could not look up legacy expected_otjh: %s", exc)
        return {}

    result = {}
    for c in legacy:
        mod_id = module_ids.get(c["module"])
        week_id = week_ids.get((mod_id, c.get("week"))) if mod_id else None
        otjh = otjh_by_week_component.get((week_id, c.get("component"))) if week_id else None
        result[(c.get("module"), c.get("week"), c.get("component"))] = otjh
    return result


def _display_quiz_title(title):
    """Same 'Type · Detail' shape as other components, keyed off the Quiz type."""
    label = "Quiz"
    show_title = bool(title) and title.strip().lower() != label.lower()
    return f"{label} · {title}" if show_title else label


def _resolve_week_ids(weeks):
    """Map each week entry to its real curriculum.module_authoring_weeks id.
    Structured-plan weeks already carry weekId; legacy (pre-id) weeks are
    resolved by module+week title, mirroring _otjh_by_legacy_title."""
    resolved = {}  # (module, week) -> week_id
    legacy = [w for w in weeks if not w.get("weekId") and w.get("module") and w.get("week")]

    for w in weeks:
        if w.get("weekId"):
            resolved[(w.get("module"), w.get("week"))] = w["weekId"]

    if not legacy:
        return resolved

    module_titles = sorted({w["module"] for w in legacy})
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT module_catalogue_id, title FROM curriculum.module_authoring_modules "
                "WHERE title = ANY(%s)",
                [module_titles],
            )
            module_ids = {title: cat_id for cat_id, title in cur.fetchall()}
            if not module_ids:
                return resolved

            cur.execute(
                "SELECT id, module_catalogue_id, title FROM curriculum.module_authoring_weeks "
                "WHERE module_catalogue_id = ANY(%s)",
                [list(module_ids.values())],
            )
            week_ids_by_cat = {(cat_id, title): week_id for week_id, cat_id, title in cur.fetchall()}
    except DatabaseError as exc:
        logger.warning("Could not resolve legacy week ids: %s", exc)
        return resolved

    for w in legacy:
        mod_id = module_ids.get(w["module"])
        week_id = week_ids_by_cat.get((mod_id, w["week"])) if mod_id else None
        if week_id:
            resolved[(w["module"], w["week"])] = week_id
    return resolved


def _append_week_quizzes(weeks, components):
    """Append each week's curriculum.quizzes row (matched by week_id) as the
    last component in that week. A week's plan may have no linked quiz yet
    (quizzes.week_id defaults to '' until authored/linked), in which case
    nothing is appended for it."""
    week_ids_by_key = _resolve_week_ids(weeks)
    ids = sorted({wid for wid in week_ids_by_key.values() if wid})
    if not ids:
        return components

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                "SELECT id, week_id, title, questions, duration, time_unit FROM curriculum.quizzes "
                "WHERE week_id = ANY(%s)",
                [ids],
            )
            quizzes_by_week_id = {}
            for quiz_id, week_id, title, questions, duration, time_unit in cur.fetchall():
                quizzes_by_week_id.setdefault(week_id, []).append((quiz_id, title, questions, duration, time_unit))
    except DatabaseError as exc:
        logger.warning("Could not look up week quizzes: %s", exc)
        return components

    if not quizzes_by_week_id:
        return components

    for w in weeks:
        week_id = week_ids_by_key.get((w.get("module"), w.get("week")))
        for quiz_id, title, questions, duration, time_unit in quizzes_by_week_id.get(week_id, []):
            components.append({
                "module": w.get("module"), "week": w.get("week"),
                "component": _display_quiz_title(title),
                "moduleId": w.get("moduleId"), "weekId": week_id, "componentId": None,
                "expectedOtjh": None, "isQuiz": True,
                "quizMeta": {"quizId": quiz_id, "questions": questions, "duration": duration, "timeUnit": time_unit},
            })
    return components


def _annotate_otjh(components):
    """Attach expectedOtjh (hours, float|None) to each component dict. Prefers
    an exact componentId match (structured-plan saves); falls back to title
    matching only for components saved before that format existed. Returns
    (annotated_components, total_hours)."""
    if not components:
        return components, 0.0

    otjh_by_id = _otjh_by_component_id(components)
    otjh_by_legacy_key = _otjh_by_legacy_title(components)

    total = 0.0
    for c in components:
        cid = c.get("componentId")
        if cid:
            otjh = otjh_by_id.get(cid)
        else:
            otjh = otjh_by_legacy_key.get((c.get("module"), c.get("week"), c.get("component")))
        c["expectedOtjh"] = otjh
        if otjh:
            total += otjh
    return components, round(total, 2)


def learner_detail(request, kind, pk):
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'.", 404)

    try:
        source = model.objects.get(pk=pk)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        active = ActiveUser.objects.filter(id=pk).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    detail = to_learner_detail(source, active)
    detail["components"], detail["totalExpectedOtjh"] = _annotate_otjh(detail["components"])
    detail["components"] = _append_week_quizzes(detail["week"], detail["components"])
    return JsonResponse(detail)
