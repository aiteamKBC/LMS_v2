"""Monthly Submission: the learner's assignment rows, not the learner-wide graph.

The page used to read ``learner-detail?content=summary``: every component,
week, quiz attempt, activity-feed row, KSB and hours figure, rebuilt on each
open. It needs only its assignments. These reads reuse learner detail's own
plan selectors (as ``build_otjh_detail`` and the coach case file already do)
and never call ``build_learner_detail``, whose GET path can advance the
programme status, rewrite the plan, refresh the KSB snapshot and persist
hours. Nothing here writes: the profile is resolved with ``heal=False``.

Statuses, submission counts, activity dates and month labels keep their own
existing reads on the page; this module supplies only what learner detail
contributed to the assignment rows.
"""
import logging

from django.db import connections
from django.http import JsonResponse

from login.errors import DATABASE_ERRORS, database_unavailable
from login.permissions import learner_self_or_staff

from .identity import learner_profile_for_source
from .learner_detail import (
    SOURCE_MODELS, _annotate_otjh, _apply_programme_assignment_template, _resolve_from_master,
)
from .learning_plan import effective_training_plan
from .mappers import _component_marking_statuses, _s, flatten_training_plan, get_training_plan
from .projection_performance import measure_projection
from .weekly_learning import component_content_available

logger = logging.getLogger(__name__)

LIST_UNAVAILABLE = "Could not load your monthly assignments. Please try again."
DATES_UNAVAILABLE = "Could not load your assignment dates. Please try again."
DETAIL_UNAVAILABLE = "Could not load this assignment. Please try again."
NOT_IN_PLAN = "Activity not found in this learner's plan."

# What the list renders, groups and filters by. Brief, topics, files and KSBs
# are read only for the selected assignment (DETAIL_FIELDS).
LIST_FIELDS = ("componentId", "type", "component", "module", "week", "sessionDate", "expectedOtjh")
DETAIL_FIELDS = ("componentId", "assignmentTopics", "assignmentBrief", "assignmentBriefHtml", "description",
                 "resourceUrl", "fileName", "downloadAllowed", "files", "ksbMappings")
# learner-detail's compact projection keeps these even when null.
KEEP_WHEN_NULL = frozenset({"module", "week", "component", "expectedOtjh"})


def _is_assignment(component):
    # Same rule as componentRequiresEvidence in utils/learnerJourney.ts.
    return _s(component.get("type")).strip().lower().replace("-", "_") == "assignment"


def _assignments(components):
    """Assignment components with an identity, first occurrence only."""
    seen, result = set(), []
    for component in components:
        identity = component.get("componentId")
        if not identity or identity in seen or not _is_assignment(component):
            continue
        seen.add(identity)
        result.append(component)
    return result


def _resolved_components(source, assigned_modules):
    """The learner's live plan components, as learner detail resolves them."""
    modules, weeks, components = flatten_training_plan(get_training_plan(source))
    _, _, components = _resolve_from_master(
        modules, weeks, components, assigned_modules=assigned_modules, compact=True)
    return _apply_programme_assignment_template(components, getattr(source, "programme", ""))


def _compact(row):
    return {key: value for key, value in row.items() if value is not None or key in KEEP_WHEN_NULL}


def assignment_list(source, pk):
    """Rows for every assignment in the plan, with marking and completion.

    Every assignment is returned, not one month: the month selector, the
    Overdue view and the total count all span the whole plan.
    """
    components = _resolved_components(source, effective_training_plan(source))
    # On the whole list, before filtering, exactly as learner detail does.
    components, _ = _annotate_otjh(components)
    assignments = _assignments(components)
    ids = [component["componentId"] for component in assignments]
    rows = [_compact({**{key: component.get(key) for key in LIST_FIELDS},
                      "contentAvailable": component_content_available(component)})
            for component in assignments]

    profile = learner_profile_for_source(source, pk, heal=False)
    wanted = set(ids)
    marking = {identity: decision for identity, decision in _component_marking_statuses(source, profile).items()
               if identity in wanted}
    video_progress, component_progress = [], []
    if profile is not None and ids:
        entries = (profile.progress_entries.filter(deleted_at__isnull=True, component_ref__in=ids)
                   .exclude(kind="activity_event").values("kind", "component_ref", "passed", "submitted_at"))
        for entry in entries:
            record = {"componentId": entry["component_ref"], "kind": entry["kind"], "passed": entry["passed"]}
            # The same split as mappers.to_learner_detail.
            if entry["kind"] == "video":
                video_progress.append(record)
            elif entry["kind"] == "component" or (entry["kind"] == "quiz_reading" and entry["submitted_at"]):
                component_progress.append(record)
    return {
        "learner": {"id": str(source.id), "name": _s(source.username)},
        "components": rows,
        "componentMarkingStatus": marking,
        "videoProgress": video_progress,
        "componentProgress": component_progress,
    }


def _module_of(component_id, assigned_modules):
    """The assigned module that owns this component, if the curriculum knows it."""
    module_ids = list(dict.fromkeys(
        _s(entry.get("moduleId")) for entry in assigned_modules
        if isinstance(entry, dict) and _s(entry.get("moduleId"))))
    if not module_ids:
        return None
    with connections["enrolment"].cursor() as cursor:
        cursor.execute("SELECT module_catalogue_id FROM curriculum.components "
                       "WHERE id=%s AND module_catalogue_id=ANY(%s) LIMIT 1", [component_id, module_ids])
        row = cursor.fetchone()
    return _s(row[0]) if row else None


def assignment_detail(source, component_id):
    """The brief, topics, files and KSBs of one assignment in this learner's plan.

    Resolves only the owning module when it can; the same resolver decides
    visibility, so an unassigned, hidden or non-assignment id is never returned.
    """
    assigned = effective_training_plan(source)
    module_id = _module_of(component_id, assigned)
    attempts = []
    if module_id:
        attempts.append([entry for entry in assigned if isinstance(entry, dict)
                         and _s(entry.get("moduleId")) == module_id])
    # Plans saved before modules carried ids resolve only as a whole.
    attempts.append(assigned)
    for assigned_modules in attempts:
        match = next((component for component in _assignments(_resolved_components(source, assigned_modules))
                      if component.get("componentId") == component_id), None)
        if match is not None:
            return _compact({key: match.get(key) for key in DETAIL_FIELDS})
    return None


# The five schedule fields the page reads (model.ts groupMonthlyAssignments).
DATE_FIELDS = ("date", "date_source", "date_needs_review", "due_timing", "week_end")


def assignment_dates(cursor, pk):
    """Assignment activity dates, exactly as subject-covers computes them.

    Same module scope (``_effective_current_subjects``) and the same reader,
    run unchanged over every component: week placement depends on the whole
    week, so filtering happens only on the result. Entries are kept when their
    curriculum ``type`` is an assignment under the page's rule.

    Known, accepted limit: a legacy plan row without module ids that the page
    lists as an assignment while a curriculum row with the same id has another
    type loses its date here and falls back to its ``sessionDate``. Resolving
    the whole plan to close that gap is deliberately not done.
    """
    from .builder_activity_dates import read_builder_activity_dates
    from .student_activity import _effective_current_subjects

    subjects = _effective_current_subjects(cursor, pk)
    dates = read_builder_activity_dates(cursor, [subject["id"] for subject in subjects])
    if not dates:
        return {}
    cursor.execute("SELECT id, type FROM curriculum.components WHERE id=ANY(%s)", [list(dates)])
    assignments = {str(identity) for identity, kind in cursor.fetchall() if _is_assignment({"type": kind})}
    return {identity: {field: schedule.get(field) for field in DATE_FIELDS}
            for identity, schedule in dates.items() if identity in assignments}


def _private(payload, status=200):
    response = JsonResponse(payload, status=status)
    response["Cache-Control"] = "private, no-store"
    return response


def _source(kind, pk, operation, message):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return None, _private({"error": f"Unknown kind: {kind!r}. Expected 'commercial' or 'apprenticeship'."}, 404)
    try:
        # all_learners: the default manager is scoped to apprenticeship rows.
        return model.all_learners.get(pk=pk), None
    except model.DoesNotExist:
        return None, _private({"error": "Learner not found."}, 404)
    except DATABASE_ERRORS as exc:
        return None, _unavailable(operation, exc, kind, pk, message)


def _unavailable(operation, exc, kind, pk, message):
    # The exception text can name tables and values; it is never returned.
    response = database_unavailable(operation, exc, message=message, logger=logger, area="Learner",
                                    context={"kind": kind, "learner_id": pk})
    response["Cache-Control"] = "private, no-store"
    return response


@learner_self_or_staff(kwarg="pk")
def monthly_submission(request, kind, pk):
    if request.method != "GET":
        return _private({"error": "Method not allowed."}, 405)
    source, error = _source(kind, pk, "monthly_submission.source", LIST_UNAVAILABLE)
    if error is not None:
        return error
    try:
        with measure_projection("monthly-submission", kind=kind, learner_id=pk, section="list") as measurement:
            with measurement.stage("assignments"):
                return _private(assignment_list(source, pk))
    except DATABASE_ERRORS as exc:
        return _unavailable("monthly_submission.build", exc, kind, pk, LIST_UNAVAILABLE)


@learner_self_or_staff(kwarg="pk")
def monthly_submission_assignment(request, kind, pk, component_id):
    if request.method != "GET":
        return _private({"error": "Method not allowed."}, 405)
    if not component_id or len(component_id) > 200:
        return _private({"error": NOT_IN_PLAN}, 404)
    source, error = _source(kind, pk, "monthly_submission_assignment.source", DETAIL_UNAVAILABLE)
    if error is not None:
        return error
    try:
        with measure_projection("monthly-submission", kind=kind, learner_id=pk, section="assignment") as measurement:
            with measurement.stage("assignment"):
                detail = assignment_detail(source, component_id)
    except DATABASE_ERRORS as exc:
        return _unavailable("monthly_submission_assignment.build", exc, kind, pk, DETAIL_UNAVAILABLE)
    if detail is None:
        return _private({"error": NOT_IN_PLAN}, 404)
    return _private(detail)


@learner_self_or_staff(kwarg="pk")
def monthly_submission_dates(request, kind, pk):
    if request.method != "GET":
        return _private({"error": "Method not allowed."}, 405)
    source, error = _source(kind, pk, "monthly_submission_dates.source", DATES_UNAVAILABLE)
    if error is not None:
        return error
    try:
        with measure_projection("monthly-submission", kind=kind, learner_id=pk, section="dates") as measurement:
            with measurement.stage("activity_dates"):
                with connections["enrolment"].cursor() as cursor:
                    dates = assignment_dates(cursor, pk)
    except DATABASE_ERRORS as exc:
        return _unavailable("monthly_submission_dates.build", exc, kind, pk, DATES_UNAVAILABLE)
    return _private({"activity_dates": dates})
