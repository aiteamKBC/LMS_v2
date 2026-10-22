"""Training Plan document reads, retaining existing aliases and populations.

Document derivation intentionally preserves its historical saved-empty fallback;
this is distinct from effective native assignment and must not be unified by name.
"""
import logging
from django.db import DatabaseError
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from ..learning_plan import _saved_modules, learner_programme_modules
from .assignments import learner_group_module_ids
from ..mappers import _s
from ..models import TrainingPlanDocument
from ..serializers.training_plan_documents import _method_label

logger = logging.getLogger(__name__)

def _extended_ilr_answers(learner_id):
    """The wizard's Extended ILR answers, which hold the employment details."""
    try:
        from enrolment_api.models import ExtendedIlr

        row = ExtendedIlr.objects.filter(learner_id=learner_id).first()
    except DatabaseError:
        logger.exception("_extended_ilr_answers: lookup failed")
        return {}
    answers = getattr(row, "answers", None)
    return answers if isinstance(answers, dict) else {}


def _plan_modules(learner):
    """The learner's learning plan, falling back to their group's preset."""
    catalogue = {m["moduleId"]: m for m in learner_programme_modules(learner)}
    saved = _saved_modules(learner)
    ids = (
        [_s(m.get("moduleId")) for m in saved]
        if saved
        else learner_group_module_ids(learner)
    )
    return [catalogue[i] for i in ids if i in catalogue]


def _module_breakdown(module_ids):
    """Weeks and components for the plan's modules, keyed by module id.

    The printed Training Plan lists each teaching activity, not just the module
    it belongs to — so the plan table is built from components, grouped by the
    week that delivers them. Off-the-job hours come from each component's
    expected_otjh, which is what actually sums to the module total.
    """
    if not module_ids:
        return {}

    from django.db import connection

    try:
        # Deliberately the `default` alias: curriculum.weeks/components are owned
        # by curriculum_api and migrated on `default`. See the note in
        # apprenticeship_agreement._group_dates.
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT w.module_catalogue_id, w.week_number, w.title,
                       c.id, c.type, c.title, c.expected_otjh, c.display_order
                FROM curriculum.weeks w
                LEFT JOIN curriculum.components c ON c.week_id = w.id
                  AND """ + visible_child_sql("c") + """
                WHERE w.module_catalogue_id = ANY(%s)
                  AND """ + visible_week_sql("w") + """
                ORDER BY w.module_catalogue_id, w.week_number, w.display_order,
                         c.display_order, c.title
                """,
                [list(module_ids)],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("_module_breakdown: lookup failed")
        return {}

    breakdown = {}
    for module_id, week_no, week_title, comp_id, comp_type, comp_title, otjh, _order in rows:
        weeks = breakdown.setdefault(_s(module_id), [])
        week = next((w for w in weeks if w["weekNumber"] == week_no), None)
        if week is None:
            week = {
                "weekNumber": week_no,
                "weekTitle": _s(week_title) or (f"Week {week_no}" if week_no else ""),
                "components": [],
            }
            weeks.append(week)
        # LEFT JOIN: a week with no components still appears, with none listed.
        if comp_id:
            week["components"].append({
                "componentId": _s(comp_id),
                "title": _s(comp_title),
                "method": _method_label(comp_type),
                "otjHours": float(otjh) if otjh is not None else 0.0,
            })
    return breakdown


def _active_document(learner_kind, learner_id, lock=False):
    """The learner's active training plan. `lock=True` takes a row lock for the
    caller's transaction — only valid inside
    `transaction.atomic(using="enrolment")`."""
    qs = TrainingPlanDocument.objects.filter(
        learner_kind=learner_kind,
        learner_id=learner_id,
        status=TrainingPlanDocument.STATUS_ACTIVE,
    )
    if lock:
        qs = qs.select_for_update()
    return qs.first()


def _learner_kind(learner):
    return _s(getattr(learner, "learner_type", "")) or "apprenticeship"

