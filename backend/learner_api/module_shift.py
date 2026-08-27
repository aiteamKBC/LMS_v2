"""Cohort-mates of a module — the modules a learner can be shifted onto.

Shifting a learner means swapping one module on their learning plan for another
*taught to the same cohort*. A cohort runs several groups, each group teaching
its own modules, so the alternatives to a module are found by walking outwards:

    module -> its group -> that group's cohort -> every group in the cohort
           -> every module those groups teach

The walk has fallbacks at each step because the three link shapes all exist in
the data. Modules authored in the curriculum tree carry cohort_id and group_id
outright; bulk-imported ones carry neither, and are tied to a group only by that
group's `module_ids` list (the same list the learning plan's preset reads). A
module with none of the three simply has no cohort yet — that is a 200 with an
empty list and a reason, not an error: nothing is wrong, there is just nothing
to offer.

The shift itself writes here rather than through the learning-plan endpoint, for
two reasons. The cohort rule is the point of the feature, so it belongs to the
server and not to whichever screen happens to be calling; and a plan may hold
entries whose module has since left the curriculum, which the plan endpoint
rejects wholesale. A shift touches one entry and leaves every other exactly as
it was stored, so a learner part-way through delivery can still be moved.

A learner part-way through a module has progress on its components, and that
progress is the reason the shift is not just a swap of ids: it has to land on
the equivalent components of the module they are moving to. Which component is
"equivalent" is a human judgement, so it is asked rather than guessed — the
progress endpoint pairs each week that has progress with the target module's
week in the same position, and the shift accepts the component-to-component
mapping the user chose — within one limit, that a component can only be matched
to one of the same type. Progress on a video is evidence of having watched a
video; crediting it to a reading would change what the record claims. Progress
that is not mapped stays where it is.

A completed component often carries a reflection awaiting a tutor or coach, or
one they have already marked with feedback. That review belongs to the work, not
to the component, so it travels with it: the submission is repointed and its
status, feedback and reviewer are left untouched.

    GET   /learner_api/module-shift/options/?moduleId=<id>
          -> {cohort, groups, modules: [...], reason}
    GET   /learner_api/module-shift/<pk>/progress/?from=<id>&to=<id>
          -> {weeks: [{order, from, to}], suggested: [...], reason}
    PATCH /learner_api/module-shift/<pk>/  {fromModuleId, toModuleId,
                                            progressMappings: [...]}
          -> the learner's plan, as the learning-plan endpoint returns it
"""
import json
import logging

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .active_users import (
    _component_learning_context,
    _decimal,
    _normalise_weight_class,
    recompute_completed_hours,
    sync_active_user,
)
from .identity import learner_profile_for_source
from .learning_plan import (
    _group_module_ids,
    _module_payload,
    _programme_modules,
    _rows,
    _saved_modules,
    _serialize,
)
from .mappers import _s
from .models import EnrolmentUser, LearnerProgressEntry, LearnerProgressKsb

logger = logging.getLogger(__name__)

MODULE_COLUMNS = """
    module_catalogue_id, title, group_name, programme_name, total_otjh,
    start_date, end_date
"""


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _id_list(value):
    """A group's `module_ids`, which is jsonb on newer rows and text on older."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return []
    return [_s(i) for i in value if _s(i)] if isinstance(value, list) else []


def _module_row(module_id):
    rows = _rows(
        f"""
        SELECT {MODULE_COLUMNS}, cohort_id, cohort_name, group_id
        FROM curriculum.modules
        WHERE module_catalogue_id = %s
        LIMIT 1
        """,
        [module_id],
    )
    return rows[0] if rows else None


def _all_groups():
    return _rows(
        """
        SELECT group_id, group_name, cohort_id, cohort_name, module_ids
        FROM curriculum.groups
        """,
        [],
    )


def _cohort_of(module, groups):
    """(cohort_id, cohort_name) for a module, or (None, name) when unlinked.

    Tried in order of how directly the module states it: its own cohort column,
    then the cohort of the group it names, then the cohort of any group whose
    module list includes it.
    """
    module_id = _s(module.get("module_catalogue_id"))
    cohort_id = _s(module.get("cohort_id"))
    if cohort_id:
        return cohort_id, _s(module.get("cohort_name"))

    group_id = _s(module.get("group_id"))
    if group_id:
        group = next((g for g in groups if _s(g.get("group_id")) == group_id), None)
        if group and _s(group.get("cohort_id")):
            return _s(group.get("cohort_id")), _s(group.get("cohort_name"))

    for group in groups:
        if module_id in _id_list(group.get("module_ids")) and _s(group.get("cohort_id")):
            return _s(group.get("cohort_id")), _s(group.get("cohort_name"))

    return None, ""


def _cohort_modules(cohort_id, groups):
    """Every module taught to a cohort, however it is linked to its group.

    Three sources, unioned: the module's own cohort column, its group column
    pointing at one of the cohort's groups, and the cohort's groups listing it in
    `module_ids`. A module reachable by any of them belongs to the cohort.
    """
    cohort_groups = [g for g in groups if _s(g.get("cohort_id")) == cohort_id]
    group_ids = [_s(g.get("group_id")) for g in cohort_groups if _s(g.get("group_id"))]
    listed_ids = sorted({i for g in cohort_groups for i in _id_list(g.get("module_ids"))})

    rows = _rows(
        f"""
        SELECT {MODULE_COLUMNS}
        FROM curriculum.modules
        WHERE cohort_id = %s
           -- Cast both arrays: a cohort whose groups list no modules sends an
           -- empty list, and Postgres cannot type an empty array on its own.
           OR (group_id IS NOT NULL AND group_id = ANY(%s::text[]))
           OR module_catalogue_id = ANY(%s::text[])
        ORDER BY start_date NULLS LAST, group_name NULLS LAST, title
        """,
        [cohort_id, group_ids, listed_ids],
    )
    return [_module_payload(r) for r in rows], cohort_groups


def module_shift_options(request):
    """The modules taught alongside one module, for the shift picker."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    module_id = _s(request.GET.get("moduleId"))
    if not module_id:
        return _error("moduleId is required.", 400)

    try:
        module = _module_row(module_id)
        if module is None:
            # A plan can hold a module retired from the catalogue; there is
            # nothing left to walk outwards from.
            return JsonResponse({
                "cohort": {"id": "", "name": ""},
                "groups": [],
                "modules": [],
                "reason": "This module is no longer in the curriculum, so its cohort cannot be found.",
            })

        groups = _all_groups()
        cohort_id, cohort_name = _cohort_of(module, groups)
        if not cohort_id:
            return JsonResponse({
                "cohort": {"id": "", "name": ""},
                "groups": [],
                "modules": [],
                "reason": (
                    f"“{_s(module.get('title')) or module_id}” is not linked to a group or cohort yet, "
                    "so there are no cohort modules to shift to. Link it in the curriculum first."
                ),
            })

        modules, cohort_groups = _cohort_modules(cohort_id, groups)
    except DatabaseError as exc:
        logger.exception("module_shift_options: lookup failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "cohort": {"id": cohort_id, "name": cohort_name},
        # Named so the picker can say which groups the alternatives came from.
        "groups": [_s(g.get("group_name")) for g in cohort_groups if _s(g.get("group_name"))],
        "modules": modules,
        "reason": "",
    })


# ---------------------------------------------------------------------------
# Progress: pairing a module's weeks with the weeks of the module joined
# ---------------------------------------------------------------------------
def _weeks_with_components(module_id):
    """A module's weeks in delivery order, each with its components in order."""
    rows = _rows(
        """
        SELECT w.id AS week_id, w.week_number, w.title AS week_title,
               c.id AS component_id, c.type, c.title AS component_title,
               c.expected_otjh
        FROM curriculum.weeks w
        LEFT JOIN curriculum.components c ON c.week_id = w.id
        WHERE w.module_catalogue_id = %s
        ORDER BY w.week_number, w.display_order, c.display_order, c.title
        """,
        [module_id],
    )
    weeks, by_id = [], {}
    for row in rows:
        week_id = _s(row.get("week_id"))
        week = by_id.get(week_id)
        if week is None:
            number = row.get("week_number")
            week = {
                "weekId": week_id,
                "weekNumber": number,
                "title": _s(row.get("week_title")) or (f"Week {number}" if number else "Week"),
                "components": [],
            }
            by_id[week_id] = week
            weeks.append(week)
        # LEFT JOIN: an empty week still pairs, it just offers nothing.
        if _s(row.get("component_id")):
            week["components"].append({
                "componentId": _s(row.get("component_id")),
                "title": _s(row.get("component_title")) or _s(row.get("type")),
                "type": _s(row.get("type")),
                "otjHours": float(row["expected_otjh"]) if row.get("expected_otjh") is not None else 0.0,
            })
    return weeks


def _progress_by_component(profile, component_ids):
    """What the learner has recorded against each of these components.

    Keyed on component_ref rather than module_ref: the component is what a
    mapping moves, and older rows can name a component with no module recorded.
    """
    if profile is None or not component_ids:
        return {}
    entries = LearnerProgressEntry.objects.filter(
        learner=profile, component_ref__in=list(component_ids),
    ).exclude(kind="activity_event")

    progress = {}
    for entry in entries:
        item = progress.setdefault(_s(entry.component_ref), {
            "entries": 0, "kinds": [], "lastAt": "", "otjHours": 0.0, "points": 0,
        })
        item["entries"] += 1
        kind = _s(entry.kind)
        if kind and kind not in item["kinds"]:
            item["kinds"].append(kind)
        at = entry.submitted_at or entry.started_at
        if at and at.isoformat() > item["lastAt"]:
            item["lastAt"] = at.isoformat()
        item["otjHours"] += float(entry.expected_otjh or 0)
        item["points"] += int(entry.points or 0)
    return progress


# The reflection a learner writes when they complete a component, and the
# tutor/coach decision on it. No model declares this table; the reflection and
# coach endpoints both reach it with SQL, so this follows suit.
REFLECTION_TABLE = '"Learner"."learning_reflection_submissions"'


def _reviews_by_component(learner, component_ids):
    """The review state attached to each of these components, if any.

    Matched on the learner's enrolment id, which the reflection rows carry as
    text in `learner_id` and (for newer rows) as `enrolment_id`, and on either
    reference to the component — `activity_id` is what the reflection form
    writes, `component_ref` what the curriculum link resolved to.
    """
    if not component_ids:
        return {}
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                f"""
                SELECT coalesce(nullif(component_ref, ''), activity_id) AS component,
                       status, coach_feedback, reviewed_by, reviewed_at
                FROM {REFLECTION_TABLE}
                WHERE (learner_id = %s OR enrolment_id = %s)
                  AND (activity_id = ANY(%s::text[]) OR component_ref = ANY(%s::text[]))
                """,
                [str(learner.pk), learner.pk, list(component_ids), list(component_ids)],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        # The pairing is still useful without it, and the shift reads the rows
        # again for itself before moving anything.
        logger.warning("Could not read reflection reviews for the shift picker", exc_info=True)
        return {}

    reviews = {}
    for component, status, feedback, reviewed_by, reviewed_at in rows:
        reviews[_s(component)] = {
            "status": _s(status),
            "feedback": _s(feedback),
            "reviewedBy": _s(reviewed_by),
            "reviewedAt": reviewed_at.isoformat() if reviewed_at else "",
        }
    return reviews


def _suggested_pair(component, position, type_index, target_week):
    """The obvious target for a progressed component, or "" if there is none.

    Only ever a component of the same type: a watched video is evidence of
    watching a video, and crediting it to a reading would be a different claim
    about what the learner did.

    Within that, the same slot wins — two modules built from one template line up
    — then the same rank among the week's components of that type, which is what
    rescues the pairing when a module has an extra component earlier in the week.
    """
    targets = (target_week or {}).get("components") or []
    same_type = [t for t in targets if t["type"] == component["type"]]
    if not same_type:
        return ""
    if position < len(targets) and targets[position]["type"] == component["type"]:
        return targets[position]["componentId"]
    if type_index < len(same_type):
        return same_type[type_index]["componentId"]
    return same_type[0]["componentId"]


def _progress_pairing(learner, from_id, to_id):
    """The weeks of `from_id` holding progress, paired by position with `to_id`."""
    source_weeks = _weeks_with_components(from_id)
    target_weeks = _weeks_with_components(to_id)
    if not source_weeks:
        return [], [], "This module has no weeks, so there is no progress to move."

    profile = learner_profile_for_source(learner)
    if profile is None:
        return [], [], "This learner has no delivery record yet, so no progress is recorded."

    component_ids = [c["componentId"] for w in source_weeks for c in w["components"]]
    progress = _progress_by_component(profile, component_ids)
    if not progress:
        return [], [], "This learner has no recorded progress on this module."
    # Shown against each component so it is plain that a pending or marked
    # review moves with the work rather than being left behind.
    reviews = _reviews_by_component(learner, component_ids)

    pairs, suggested = [], []
    for index, week in enumerate(source_weeks):
        # Only the weeks the learner has actually worked in.
        if not any(c["componentId"] in progress for c in week["components"]):
            continue
        # None when the module being joined is shorter: those components cannot
        # be paired, and the picker says so rather than dropping them silently.
        target = target_weeks[index] if index < len(target_weeks) else None
        pairs.append({
            "order": index + 1,
            "from": {
                **week,
                "components": [
                    {
                        **c,
                        "progress": progress.get(c["componentId"]),
                        "review": reviews.get(c["componentId"]),
                    }
                    for c in week["components"]
                ],
            },
            "to": target,
        })
        # Rank within type as well as position: the suggestion pairs the week's
        # second video with the other week's second video.
        seen_of_type = {}
        for position, component in enumerate(week["components"]):
            type_index = seen_of_type.get(component["type"], 0)
            seen_of_type[component["type"]] = type_index + 1
            if component["componentId"] not in progress:
                continue
            match = _suggested_pair(component, position, type_index, target)
            if match:
                suggested.append({
                    "fromComponentId": component["componentId"],
                    "toComponentId": match,
                })
    return pairs, suggested, ""


def module_shift_progress(request, pk):
    """The week-by-week pairing behind the progress step of a shift."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    from_id = _s(request.GET.get("from"))
    to_id = _s(request.GET.get("to"))
    if not from_id or not to_id:
        return _error("from and to module ids are both required.", 400)

    try:
        learner = EnrolmentUser.all_learners.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        logger.exception("module_shift_progress: lookup failed")
        return _error(f"Database error: {exc}", 502)

    try:
        weeks, suggested, reason = _progress_pairing(learner, from_id, to_id)
    except DatabaseError as exc:
        logger.exception("module_shift_progress: pairing failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "weeks": weeks,
        "suggested": suggested,
        "reason": reason,
        "progressedComponents": sum(
            1 for w in weeks for c in w["from"]["components"] if c.get("progress")
        ),
    })


# ---------------------------------------------------------------------------
# Moving the progress
# ---------------------------------------------------------------------------
def _validate_mappings(mappings, from_id, to_id):
    """(pairs, error): the mapping as (from, to) tuples, or why it is refused."""
    if not isinstance(mappings, list):
        return None, "progressMappings must be a list."
    if not mappings:
        return [], ""

    source = {
        c["componentId"]: c for w in _weeks_with_components(from_id) for c in w["components"]
    }
    target = {
        c["componentId"]: c for w in _weeks_with_components(to_id) for c in w["components"]
    }

    pairs, claimed = [], {}
    for item in mappings:
        if not isinstance(item, dict):
            return None, "Every progress mapping must be an object."
        source_id = _s(item.get("fromComponentId"))
        target_id = _s(item.get("toComponentId"))
        # A pair with no target is "leave this progress where it is".
        if not source_id or not target_id:
            continue
        if source_id not in source:
            return None, f"Component '{source_id}' is not part of the module being left."
        if target_id not in target:
            return None, f"Component '{target_id}' is not part of the module being joined."
        # Like for like: progress on a video is evidence of watching a video, so
        # it can only be credited to another video. Checked here and not only in
        # the picker, since this is what the record ends up claiming.
        source_type = source[source_id]["type"]
        target_type = target[target_id]["type"]
        if source_type != target_type:
            return None, (
                f"'{source[source_id]['title']}' is a {source_type or 'component'} and cannot be "
                f"matched to '{target[target_id]['title']}', which is a {target_type or 'component'}."
            )
        # Two components' progress landing on one would credit it twice.
        if claimed.get(target_id, source_id) != source_id:
            return None, "Two components cannot be moved onto the same component."
        claimed[target_id] = source_id
        pairs.append((source_id, target_id))
    return pairs, ""


def _rewrite_ksbs(entry, context):
    """Re-map an entry's KSBs to the ones the component it moved to carries.

    A submission takes its KSBs from the component it was made against, so a
    moved one has to as well, or the learner keeps credit for what the module
    they left mapped to. A target carrying no mappings is the exception: the
    existing links stay, since nothing better is known and losing evidence is
    worse than a stale label.
    """
    mappings = [
        item for item in (context.get("ksbMappings") or [])
        if isinstance(item, dict) and _s(item.get("code") or item.get("ksbCode"))
    ]
    if not mappings:
        return
    LearnerProgressKsb.objects.filter(progress=entry).delete()
    LearnerProgressKsb.objects.bulk_create([
        LearnerProgressKsb(
            progress=entry,
            position=position,
            ksb_code=_s(item.get("code") or item.get("ksbCode")).upper(),
            ksb_description=_s(item.get("description") or item.get("ksbDescription")),
            source_type=_s(item.get("sourceType") or item.get("source_type")),
            source_id=_s(item.get("sourceId") or item.get("source_id")),
            classification=_s(item.get("classification") or item.get("type")),
            weight=_decimal(item.get("weight")),
            weight_class=_normalise_weight_class(
                item.get("weightClass") if "weightClass" in item else item.get("weight_class"),
                item.get("classification") or item.get("type"),
            ),
        )
        for position, item in enumerate(mappings, 1)
    ])


REPOINTED_FIELDS = [
    "legacy_component_ref", "programme_ref", "programme_title",
    "module_ref", "module_title", "week_ref", "week_title",
    "group_ref", "group_title", "cohort_ref", "cohort_title",
    "component_ref", "component_title", "component_type", "expected_otjh", "points",
    "component_link_status", "component_link_source",
]


def _move_review(learner, source_id, target_id, context):
    """Move the reflection and its tutor/coach decision onto the new component.

    (moved, kept). The decision itself — status, feedback, who marked it and
    when — is deliberately not touched: a tutor has read this learner's work and
    said something about it, and that stands whichever component now carries it.
    Only where the submission points is rewritten.

    A learner who already has a submission of the same kind on the target keeps
    it: the table holds one per learner and activity, and overwriting either
    review would throw away a real one.
    """
    moved = kept = 0
    with connections["enrolment"].cursor() as cursor:
        cursor.execute(
            f"""
            SELECT id, learner_kind, learner_id, activity_type
            FROM {REFLECTION_TABLE}
            WHERE (learner_id = %s OR enrolment_id = %s)
              AND (activity_id = %s OR component_ref = %s)
            """,
            [str(learner.pk), learner.pk, source_id, source_id],
        )
        rows = cursor.fetchall()

        for row_id, learner_kind, learner_id, activity_type in rows:
            cursor.execute(
                f"""
                SELECT 1 FROM {REFLECTION_TABLE}
                WHERE learner_kind = %s AND learner_id = %s
                  AND activity_type = %s AND activity_id = %s
                LIMIT 1
                """,
                [learner_kind, learner_id, activity_type, target_id],
            )
            if cursor.fetchone():
                kept += 1
                continue

            cursor.execute(
                f"""
                UPDATE {REFLECTION_TABLE}
                SET activity_id = %s,
                    component_ref = %s,
                    activity_title = coalesce(nullif(%s, ''), activity_title),
                    module_ref = coalesce(nullif(%s, ''), module_ref),
                    module_title = coalesce(nullif(%s, ''), module_title),
                    week_ref = coalesce(nullif(%s, ''), week_ref),
                    week_title = coalesce(nullif(%s, ''), week_title),
                    group_ref = coalesce(nullif(%s, ''), group_ref),
                    cohort_ref = coalesce(nullif(%s, ''), cohort_ref),
                    programme_ref = coalesce(nullif(%s, ''), programme_ref)
                WHERE id = %s
                """,
                [
                    target_id, target_id,
                    _s(context.get("componentTitle")),
                    _s(context.get("moduleId")), _s(context.get("moduleTitle")),
                    _s(context.get("weekId")), _s(context.get("weekTitle")),
                    _s(context.get("groupId")), _s(context.get("cohortId")),
                    _s(context.get("programmeId")),
                    row_id,
                ],
            )
            moved += 1
    return moved, kept


def _repoint_progress(learner, profile, pairs):
    """Move the learner's progress from each source component to its target.

    Only where the activity sits is rewritten — module, week, component, and the
    component's own hours and points. What the learner did is left exactly as it
    was: grades, attempts, scores, timestamps and quiz answers describe an
    attempt that really happened, and rewriting those to match another module's
    quiz would be inventing a record. The reflection and its tutor decision move
    with it, for the same reason.
    """
    counts = {"entries": 0, "reviews": 0, "reviewsKept": 0}
    for source_id, target_id in pairs:
        context = _component_learning_context(target_id)
        if not context:
            continue
        entries = LearnerProgressEntry.objects.filter(
            learner=profile, component_ref=source_id,
        ).exclude(kind="activity_event")
        for entry in entries:
            # What it first pointed at, kept once: the column exists so a
            # repointed row never loses its original reference.
            if not _s(entry.legacy_component_ref):
                entry.legacy_component_ref = entry.component_ref
            entry.programme_ref = _s(context.get("programmeId")) or entry.programme_ref
            entry.programme_title = _s(context.get("programme")) or entry.programme_title
            entry.module_ref = _s(context.get("moduleId")) or entry.module_ref
            entry.module_title = _s(context.get("moduleTitle")) or entry.module_title
            entry.week_ref = _s(context.get("weekId")) or entry.week_ref
            entry.week_title = _s(context.get("weekTitle")) or entry.week_title
            entry.group_ref = _s(context.get("groupId")) or entry.group_ref
            entry.group_title = _s(context.get("group")) or entry.group_title
            entry.cohort_ref = _s(context.get("cohortId")) or entry.cohort_ref
            entry.cohort_title = _s(context.get("cohort")) or entry.cohort_title
            entry.component_ref = target_id
            entry.component_title = _s(context.get("componentTitle")) or entry.component_title
            entry.component_type = _s(context.get("componentType")) or entry.component_type
            if context.get("expectedOtjh") is not None:
                entry.expected_otjh = _decimal(context.get("expectedOtjh"))
            if context.get("points") not in (None, ""):
                entry.points = context.get("points")
            entry.component_link_status = "resolved_to_current_component"
            entry.component_link_source = "direct"
            entry.save(update_fields=REPOINTED_FIELDS)
            _rewrite_ksbs(entry, context)
            counts["entries"] += 1
        moved_reviews, kept_reviews = _move_review(learner, source_id, target_id, context)
        counts["reviews"] += moved_reviews
        counts["reviewsKept"] += kept_reviews
    return counts


def _base_plan(learner):
    """The plan a shift starts from: what is saved, else the group's preset.

    An unsaved learner is shown their group's preset everywhere else, so a shift
    has to move them within that same list — otherwise the first shift for a
    learner whose plan was never saved would be rejected as "not on the plan".
    Materialising it here means that shift saves the preset along with the move,
    which is exactly what agreeing to a plan does.
    """
    saved = _saved_modules(learner)
    if saved:
        return saved

    programme = _s(learner.programme)
    catalogue = {m["moduleId"]: m for m in _programme_modules(programme)}
    preset_ids = _group_module_ids(programme, _s(learner.group))
    return [catalogue[i] for i in preset_ids if i in catalogue]


@csrf_exempt
def module_shift(request, pk):
    """Move a learner from one module to another taught to the same cohort."""
    if request.method not in ("PATCH", "POST"):
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        logger.exception("module_shift: lookup failed")
        return _error(f"Database error: {exc}", 502)

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    from_id = _s(payload.get("fromModuleId"))
    to_id = _s(payload.get("toModuleId"))
    if not from_id or not to_id:
        return _error("fromModuleId and toModuleId are both required.", 400)
    if from_id == to_id:
        return _error("Pick a different module to shift to.", 400)

    try:
        plan = _base_plan(learner)
        if not any(_s(m.get("moduleId")) == from_id for m in plan):
            return _error(f"Module '{from_id}' is not on this learner's plan.", 400)
        if any(_s(m.get("moduleId")) == to_id for m in plan):
            return _error("That module is already on this learner's plan.", 400)

        # The same walk the picker offered, re-run here: the cohort rule is the
        # rule, so it is checked server-side rather than trusted from the client.
        module = _module_row(from_id)
        if module is None:
            return _error(
                f"Module '{from_id}' is no longer in the curriculum, so its cohort cannot be found.",
                400,
            )
        groups = _all_groups()
        cohort_id, cohort_name = _cohort_of(module, groups)
        if not cohort_id:
            return _error(
                f"'{_s(module.get('title')) or from_id}' is not linked to a group or cohort, "
                "so there is nothing to shift within.",
                400,
            )
        options, _cohort_groups = _cohort_modules(cohort_id, groups)
        target = next((m for m in options if m["moduleId"] == to_id), None)
        if target is None:
            return _error(
                f"That module is not taught to {cohort_name or 'this cohort'}.",
                400,
            )

        # Which progress moves with the learner, and onto what. Absent or empty
        # means the plan alone changes: progress then stays on the module they
        # left, which is the honest default for a shift made before any work.
        pairs, mapping_error = _validate_mappings(payload.get("progressMappings") or [], from_id, to_id)
        if mapping_error:
            return _error(mapping_error, 400)

        profile = learner_profile_for_source(learner) if pairs else None
        if pairs and profile is None:
            return _error(
                "This learner has no delivery record, so there is no progress to move.",
                400,
            )

        # The plan and the progress move together: a learner left on the new
        # module with their progress still on the old one, or the reverse, is
        # worse than the shift not happening.
        with transaction.atomic(using="enrolment"):
            # One entry replaced, the rest kept exactly as stored — including any
            # whose module has left the curriculum, which is not this shift's
            # business to rewrite or drop.
            learner.learning_plan = [
                target if _s(m.get("moduleId")) == from_id else m
                for m in plan
            ]
            learner.save(update_fields=["learning_plan"])
            counts = (
                _repoint_progress(learner, profile, pairs) if pairs
                else {"entries": 0, "reviews": 0, "reviewsKept": 0}
            )

        moved = counts["entries"]
        if moved:
            # The component's hours may differ from the one left behind, and the
            # learner's own workspace reads the materialised plan rather than
            # this list — both are derived, so both are refreshed here.
            recompute_completed_hours(profile.id)
        if _s(learner.programme_status).lower() == "active":
            sync_active_user(learner)

        body = _serialize(learner)
        body["progressMoved"] = moved
        body["reviewsMoved"] = counts["reviews"]
        # A review left behind because the target already had one of its own.
        body["reviewsKept"] = counts["reviewsKept"]
        return JsonResponse(body)
    except DatabaseError as exc:
        logger.exception("module_shift: save failed")
        return _error(f"Database error: {exc}", 502)
