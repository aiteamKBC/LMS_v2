"""The learner's learning plan — the modules they will actually be taught.

A learner's group already carries a module set (curriculum.groups.module_ids),
so the plan starts as that preset rather than blank. Staff then tune it: drop a
module the learner doesn't need, or add any module in the catalogue — including
one belonging to another programme, chosen from the programme picker.

Cross-programme modules used to be refused here, because a module from another
programme maps to different KSBs and sits under different funding. That is still
true, and it is why every module carries its programme through to the plan and
the picker: the combination is now allowed but never hidden, so whoever assembles
the plan can see when they have crossed a programme boundary.

Hours come from curriculum.modules.total_otjh (off-the-job hours), summed for
the plan total so staff can see the commitment while editing.

Each row also shows the module's delivery window (curriculum.modules
start_date/end_date), set where the module is scheduled in the curriculum tree.
Read-only here, and re-derived on every read like the hours — the plan decides
which modules are taught, not when. Empty for a module with no window yet.

The saved plan lives on enrolment."Created_users"."Learning_plan" (jsonb), which
also feeds the delivery-side training plan.

    GET   /learner_api/learning-plan/<pk>/            -> {plan, preset, available, programmes, totals}
    PATCH /learner_api/learning-plan/<pk>/            -> save {modules:[...]}

The module builder assigns the same record from the other end -- one module,
every learner -- and that route is documented beside its view below:

    GET   /learner_api/module-learners/<module_id>/   -> {module, learners, totals}
    PATCH /learner_api/module-learners/<module_id>/   -> save {learnerIds:[...]}
"""
import json
import logging
from datetime import date, datetime

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from login.permissions import learner_self_or_staff, staff_only

from .constants import DELIVERY_PROGRAMME_STATUS
from .learner_progression import advance_learner
from .mappers import _s, stored_training_plan, training_plan_field
from .models import EnrolmentUser

logger = logging.getLogger(__name__)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _rows(sql, params):
    # Deliberately the `default` alias: every caller reads curriculum.*, which is
    # owned by curriculum_api and migrated on `default`. Not an oversight — see
    # the note in apprenticeship_agreement._group_dates.
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _hours(value):
    """total_otjh is numeric in Postgres; JSON needs a float (0.0 when unset)."""
    return float(value) if value is not None else 0.0


def _iso_day(value):
    """A date column as YYYY-MM-DD; "" when the module has no window set.

    The column is a real `date`, but psycopg hands back a datetime on some
    drivers and the older rows were written as text — so anything date-like is
    reduced to its first ten characters rather than assumed.
    """
    if value in (None, ""):
        return ""
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m-%d")
    return _s(value)[:10]


def _module_payload(row):
    return {
        "moduleId": _s(row.get("module_catalogue_id")),
        "moduleTitle": _s(row.get("title")) or _s(row.get("module_catalogue_id")),
        "groupName": _s(row.get("group_name")),
        "programmeId": _s(row.get("programme_id")),
        "programmeName": _s(row.get("programme_name")),
        "hours": _hours(row.get("total_otjh")),
        # When this module is delivered, per the curriculum tree. Not editable
        # from the plan — see the module header.
        "startDate": _iso_day(row.get("start_date")),
        "endDate": _iso_day(row.get("end_date")),
    }


#: Modules of a deleted programme, and soft-deleted modules, are not offerable.
_LIVE_MODULE_SQL = """
    SELECT module_catalogue_id, title, group_name, programme_id, programme_name,
           total_otjh, start_date, end_date
    FROM curriculum.modules
    WHERE deleted_at IS NULL AND NOT is_programme_deleted
"""


def _programme_modules(programme):
    """Every module on this programme, whichever group teaches it."""
    if not programme:
        return []
    return [
        _module_payload(r)
        for r in _rows(
            _LIVE_MODULE_SQL + """
              AND (programme_name = %s OR programme_id = %s)
            ORDER BY group_name, title
            """,
            [programme, programme],
        )
    ]


def _all_modules():
    """The whole catalogue, every programme.

    The picker offers all of it, so the plan is validated against all of it too
    — a module the client could choose has to be a module the server accepts.
    """
    return [
        _module_payload(r)
        for r in _rows(_LIVE_MODULE_SQL + " ORDER BY programme_name, group_name, title", [])
    ]


def _programmes(modules):
    """The programmes to choose between, each with how many modules it offers.

    Derived from the catalogue rather than queried separately, so the picker can
    never list a programme whose modules it would then fail to show.
    """
    counts, names = {}, {}
    for module in modules:
        key = module["programmeId"] or module["programmeName"]
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
        names.setdefault(key, module["programmeName"] or key)
    return [
        {"programmeId": key, "programmeName": names[key], "moduleCount": counts[key]}
        for key in sorted(counts, key=lambda k: names[k].lower())
    ]


def _group_module_ids(programme, group):
    """The module ids preset on the learner's group."""
    if not group:
        return []
    rows = _rows(
        """
        SELECT module_ids
        FROM curriculum.groups
        WHERE group_name = %s AND (programme_name = %s OR programme_id = %s)
        LIMIT 1
        """,
        [group, programme, programme],
    )
    if not rows:
        return []
    ids = rows[0].get("module_ids")
    if isinstance(ids, str):
        try:
            ids = json.loads(ids)
        except ValueError:
            return []
    return [_s(i) for i in ids] if isinstance(ids, list) else []


def _saved_modules(learner):
    """The plan already stored on the learner, if any."""
    return stored_training_plan(learner)


def _orphan_module(entry):
    """A saved module with no catalogue match, in the standard shape.

    Covers two cases: a module retired from the programme since the plan was
    saved, and plans written by the earlier wizard, whose entries carry
    weeks/components and no hours. Flagged so the UI can mark it.
    """
    return {
        "moduleId": _s(entry.get("moduleId")),
        "moduleTitle": _s(entry.get("moduleTitle")) or _s(entry.get("moduleId")),
        "groupName": _s(entry.get("groupName")),
        "programmeName": _s(entry.get("programmeName")),
        "hours": float(entry.get("hours") or 0),
        # The saved snapshot is the only window left for a module that is gone.
        "startDate": _iso_day(entry.get("startDate")),
        "endDate": _iso_day(entry.get("endDate")),
        "orphaned": True,
    }


def _totals(modules):
    return {
        "moduleCount": len(modules),
        "totalHours": round(sum(float(m.get("hours") or 0) for m in modules), 2),
    }


def _plan_titles(plan):
    """The legacy comma-joined title columns, rebuilt from a structured plan.

    ``Created_users`` carries Modules/Weeks/Components as free text alongside
    the structured jsonb, and ``mappers._legacy_plan_from_csv`` still reads them
    for a learner whose plan predates the structured format. They hold *titles*
    joined with ", ", with "module · week · component" hierarchy -- so they are
    rebuilt in that shape here rather than as ids, which would silently make the
    legacy reader reconstruct a plan of id-shaped module names.
    """
    modules, weeks, components = [], [], []
    for module in plan or []:
        if not isinstance(module, dict):
            continue
        module_title = _s(module.get("moduleTitle"))
        if module_title:
            modules.append(module_title)
        for week in module.get("weeks") or []:
            if not isinstance(week, dict):
                continue
            week_title = _s(week.get("weekTitle"))
            if week_title:
                weeks.append(f"{module_title} · {week_title}" if module_title else week_title)
            for component in week.get("components") or []:
                if not isinstance(component, dict):
                    continue
                component_title = _s(component.get("componentTitle"))
                if not component_title:
                    continue
                parts = [p for p in (module_title, week_title, component_title) if p]
                components.append(" · ".join(parts))
    return ", ".join(modules), ", ".join(weeks), ", ".join(components)


def sync_learning_plan_mirror(source):
    """Write the learner's assigned plan to the two places that report on it.

    The plan staff edit lives on ``enrolment."Created_users"."Learning_plan"``.
    That is still the record of truth; this copies it outwards so the surfaces
    that already read those tables can see what a learner is assigned:

    * ``"Learner".learners.learning_plan`` -- the mirror every coach, marking
      and reporting surface reads. Previously they had no way to see a learner's
      plan without joining back to enrolment.
    * ``Created_users`` Modules/Weeks/Components -- the legacy title columns,
      kept in step so they cannot describe a plan the learner no longer has.

    Resolved through ``get_training_plan``, which is the same resolver the
    learner's own "My learning" page uses, so the mirror shows what the learner
    sees rather than a second opinion assembled here.

    An unassigned plan writes an empty mirror rather than being skipped: a
    learner whose plan was cleared must not keep a stale copy of it.

    Returns the number of modules mirrored, or 0 if the mirror could not be
    written. Never raises, for the same reason ``advance_learner`` does not: the
    plan itself is already saved by the time this runs, and a failed mirror must
    not turn a successful staff edit into an error. A lagging mirror is
    recoverable -- ``manage.py sync_learning_plans`` rebuilds it from the plan.
    """
    from .active_users import replace_training_plan
    from .mappers import get_training_plan
    from .models import LearnerProfile

    if source is None or not getattr(source, "pk", None):
        return 0

    try:
        plan = get_training_plan(source) or []
        modules_csv, weeks_csv, components_csv = _plan_titles(plan)

        # Matched on enrolment_id, never on a LearnerProfile pk held from before
        # a sync_active_user call: that reference goes stale, and updating by it
        # silently missed 367 rows when the coach assignment did the same thing.
        mirrors = LearnerProfile.objects.filter(enrolment_id=source.pk)
        mirrors.update(learning_plan=plan or None)
        # The jsonb above is what reports read; the learner's own "My learning"
        # page reads LearnerProfile.training_plan, which is assembled from the
        # plan_modules/weeks/components child rows. Both have to be written, or
        # the plan is stored and the learner is still shown an empty page.
        profile = mirrors.first()
        if profile is not None:
            replace_training_plan(profile, plan)
        EnrolmentUser.all_learners.filter(pk=source.pk).update(
            modules=modules_csv,
            weeks=weeks_csv,
            components=components_csv,
        )
    except DatabaseError:
        logger.exception(
            "sync_learning_plan_mirror: could not mirror the plan for learner %s",
            getattr(source, "pk", None),
        )
        return 0
    return len(plan)


def _serialize(learner):
    programme = _s(learner.programme)
    group = _s(learner.group)

    catalogue = _programme_modules(programme)
    by_id = {m["moduleId"]: m for m in catalogue}

    preset_ids = _group_module_ids(programme, group)
    preset = [by_id[i] for i in preset_ids if i in by_id]

    # A saved plan wins; an unsaved learner starts from their group's preset so
    # staff are editing something real rather than an empty list.
    saved = _saved_modules(learner)
    if saved is not None:
        # Re-read hours/titles from the catalogue so an edited module shows its
        # current values. Entries with no catalogue match are kept (the module
        # may have been retired) but normalised to the same shape — plans saved
        # by the older wizard carry weeks/components and no hours at all.
        plan = [
            by_id.get(_s(m.get("moduleId"))) or _orphan_module(m)
            for m in saved
        ]
    else:
        plan = preset

    chosen = {_s(m.get("moduleId")) for m in plan}
    everything = _all_modules()
    learner_programme_id = next(
        (m["programmeId"] for m in catalogue if m["programmeId"]), "",
    )
    return {
        "learner": {
            "id": str(learner.id),
            "name": _s(learner.username),
            "programme": programme,
            "programmeId": learner_programme_id,
            "cohort": _s(learner.cohort),
            "group": group,
            "programmeStatus": _s(learner.programme_status),
        },
        "plan": plan,
        "preset": preset,
        # Anything in the catalogue not already on the plan, whichever programme
        # it belongs to. The picker defaults to the learner's own programme and
        # the rest are a dropdown away.
        "available": [m for m in everything if m["moduleId"] not in chosen],
        "programmes": _programmes(everything),
        "saved": saved is not None,
        "totals": _totals(plan),
    }


@csrf_exempt
# Saving the plan rewrites the learner's modules and can advance their
# programme; only the learner themselves or staff may write it. Reads stay open.
@learner_self_or_staff(kwarg="pk")
def learning_plan(request, pk):
    """GET the learner's plan (with preset + pickable modules), or PATCH to save."""
    try:
        learner = EnrolmentUser.all_learners.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        logger.exception("learning_plan: lookup failed")
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        try:
            return JsonResponse(_serialize(learner))
        except DatabaseError as exc:
            logger.exception("learning_plan: read failed")
            return _error(f"Database error: {exc}", 502)

    if request.method not in ("PATCH", "PUT"):
        return _error("Method not allowed.", 405)

    # ---- save ----
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    modules = payload.get("modules")
    if not isinstance(modules, list):
        return _error("modules must be a list.", 400)

    programme = _s(learner.programme)
    try:
        catalogue = {m["moduleId"]: m for m in _all_modules()}
    except DatabaseError as exc:
        logger.exception("learning_plan: catalogue lookup failed")
        return _error(f"Database error: {exc}", 502)

    # Rebuild each entry from the catalogue rather than trusting the client's
    # titles/hours/dates/programme, and reject anything that is not a live
    # module. A module from another programme is allowed — it is recorded with
    # its own programme, so the plan says plainly where each module came from.
    resolved, seen = [], set()
    for entry in modules:
        module_id = _s(entry.get("moduleId") if isinstance(entry, dict) else entry)
        if not module_id:
            return _error("Every module needs a moduleId.", 400)
        if module_id in seen:
            continue
        if module_id not in catalogue:
            return _error(f"Module '{module_id}' is not in the module catalogue.", 400)
        seen.add(module_id)
        resolved.append(catalogue[module_id])

    field = training_plan_field(learner)
    setattr(learner, field, resolved)
    try:
        learner.save(update_fields=[field])
    except DatabaseError as exc:
        logger.exception("learning_plan: save failed")
        return _error(f"Database error: {exc}", 502)

    # Mirror outwards to the tables that report on the plan: "Learner".learners
    # for every coach and marking surface, and the legacy Modules/Weeks/
    # Components title columns. Never raises -- the plan is already saved above,
    # and refusing here would lose the staff member's edit over a stale mirror.
    sync_learning_plan_mirror(learner)

    # For a commercial learner the plan is the last thing progression waits for:
    # with a start date already passed, agreeing the plan is what makes them
    # Active. Nothing else on this path would notice, so a learner who was ready
    # the moment their plan was saved sat in Delivery until some unrelated edit
    # happened to run the check. Never raises — see advance_learner.
    advance_learner(learner)

    return JsonResponse(_serialize(learner))


# ---------------------------------------------------------------------------
# The same assignment read from the module's side
# ---------------------------------------------------------------------------
# One module, every learner — the inverse of the plan above, and what the Module
# builder's "Assign learners" picker writes. It is deliberately the *same*
# record: a tick here appends this module to that learner's plan on
# enrolment."Created_users", and an untick removes it. There is no separate
# module-roster table to drift out of step with the plans.
#
#     GET   /learner_api/module-learners/<module_id>/   -> {module, learners, totals}
#     PATCH /learner_api/module-learners/<module_id>/   -> save {learnerIds:[...]}
# ---------------------------------------------------------------------------

#: The columns the picker reports. Only these reach the client -- see
#: _learner_picker_row -- but the rows themselves are read whole; see
#: _picker_learners for why.
_PICKER_FIELDS = (
    "id", "username", "email", "learner_type",
    "programme", "cohort", "group", "programme_status",
    "learning_plan", "training_plan",
)


def _plan_field(learner):
    """Which column holds this learner's plan.

    Apprenticeships use "Learning_plan"; commercial learners use
    "Training_plan". The same rule as
    ``active_users.hydrate_source_training_plan``, so a plan written here lands
    in the column the delivery-side sync reads back.
    """
    return training_plan_field(learner)


def _plan_entries(learner):
    """The plan stored on this learner, from whichever column holds it."""
    return stored_training_plan(learner) or []


def _preset_ids_for(learner, cache):
    """The learner's group preset, cached per (programme, group).

    A learner with no saved plan is *shown* their group's preset — see
    ``_serialize`` — so that preset is their effective plan. Assigning one
    module has to keep it: writing only the ticked module would silently drop
    every other module their group teaches.
    """
    key = (_s(learner.programme), _s(learner.group))
    if key not in cache:
        cache[key] = _group_module_ids(*key)
    return cache[key]


def _effective_plan_ids(learner, preset_cache):
    """The module ids this learner is currently taught: saved plan, else preset."""
    saved = stored_training_plan(learner)
    if saved is not None:
        return [_s(entry.get("moduleId")) for entry in saved if _s(entry.get("moduleId"))]
    return list(_preset_ids_for(learner, preset_cache))


def _learner_picker_row(learner, module_id, preset_cache):
    saved = _plan_entries(learner)
    plan_ids = _effective_plan_ids(learner, preset_cache)
    assigned = module_id in plan_ids
    return {
        "id": str(learner.id),
        "name": _s(learner.username) or _s(learner.email) or f"Learner {learner.id}",
        "email": _s(learner.email),
        "learnerType": _s(learner.learner_type) or "apprenticeship",
        "programme": _s(learner.programme),
        "cohort": _s(learner.cohort),
        "group": _s(learner.group),
        "programmeStatus": _s(learner.programme_status),
        "assigned": assigned,
        # True when the tick comes from the group preset rather than a saved
        # plan: nobody has agreed this learner's plan yet, so the module is
        # inherited rather than chosen. Named so the picker can say which it is.
        "fromPreset": assigned and not saved,
        "moduleCount": len(plan_ids),
    }


def _module_facts(module):
    """The module being assigned to, for the picker's own header."""
    return {
        "moduleId": module["moduleId"],
        "moduleTitle": module["moduleTitle"],
        "programmeId": module["programmeId"],
        "programmeName": module["programmeName"],
        "groupName": module["groupName"],
        "hours": module["hours"],
        "startDate": module["startDate"],
        "endDate": module["endDate"],
    }


def _module_learners_payload(module, learners, preset_cache):
    rows = [_learner_picker_row(learner, module["moduleId"], preset_cache) for learner in learners]
    return {
        "module": _module_facts(module),
        "learners": rows,
        "totals": {
            "learnerCount": len(rows),
            "assignedCount": sum(1 for row in rows if row["assigned"]),
        },
    }


def _picker_learners():
    """Every learner in enrolment."Created_users", both kinds, by name.

    Whole rows, not ``.only(*_PICKER_FIELDS)``. A save runs advance_learner
    on each learner it touches, and that reads columns the picker itself
    never shows -- the delivery dates, the apprenticeship window. On a
    deferred instance each of those reads is its own query, so narrowing the
    select traded one wide read for dozens of narrow ones, and left the write
    depending on which columns a caller happened to list.
    """
    return list(EnrolmentUser.all_learners.order_by("username", "id"))


@csrf_exempt
# The whole learner directory with names and email addresses, and a write that
# changes what other people are taught. Staff/admin only, reads included.
@staff_only()
def module_learners(request, module_id):
    """GET who is assigned to this module, or PATCH to set the assignment."""
    module_id = _s(module_id)
    if not module_id:
        return _error("A module id is required.", 400)

    try:
        catalogue = {m["moduleId"]: m for m in _all_modules()}
    except DatabaseError as exc:
        logger.exception("module_learners: catalogue lookup failed")
        return _error(f"Database error: {exc}", 502)

    module = catalogue.get(module_id)
    if module is None:
        return _error(f"Module {module_id} is not in the module catalogue.", 404)

    if request.method == "GET":
        try:
            return JsonResponse(_module_learners_payload(module, _picker_learners(), {}))
        except DatabaseError as exc:
            logger.exception("module_learners: read failed")
            return _error(f"Database error: {exc}", 502)

    if request.method not in ("PATCH", "PUT"):
        return _error("Method not allowed.", 405)

    # ---- save ----
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    learner_ids = payload.get("learnerIds")
    if not isinstance(learner_ids, list):
        return _error("learnerIds must be a list.", 400)
    assigned_ids = {_s(value) for value in learner_ids if _s(value)}

    try:
        learners = _picker_learners()
    except DatabaseError as exc:
        logger.exception("module_learners: read failed")
        return _error(f"Database error: {exc}", 502)

    known_ids = {str(learner.id) for learner in learners}
    unknown = sorted(assigned_ids - known_ids)
    if unknown:
        return _error(f"Learner {unknown[0]} is not in the learner directory.", 400)

    preset_cache = {}
    changed = 0
    for learner in learners:
        should_have = str(learner.id) in assigned_ids
        saved = _plan_entries(learner)
        plan_ids = _effective_plan_ids(learner, preset_cache)
        # A learner whose effective plan already says the right thing is left
        # alone — including one inheriting the module from their group preset.
        # So opening this picker and saving it unchanged writes nothing, and
        # never converts a preset into an agreed plan behind staff's back.
        if should_have == (module_id in plan_ids):
            continue
        if should_have:
            plan_ids = [*plan_ids, module_id]
        else:
            plan_ids = [value for value in plan_ids if value != module_id]

        # Rebuilt from the catalogue, exactly as the learner's own plan save
        # does it, so titles/hours/dates are current rather than whatever was
        # stored last. A module retired since the plan was agreed has no
        # catalogue row left, and keeps its saved snapshot instead of vanishing.
        saved_by_id = {_s(entry.get("moduleId")): entry for entry in saved}
        resolved, seen = [], set()
        for plan_id in plan_ids:
            if not plan_id or plan_id in seen:
                continue
            seen.add(plan_id)
            resolved.append(
                catalogue.get(plan_id)
                or _orphan_module(saved_by_id.get(plan_id) or {"moduleId": plan_id})
            )

        field = _plan_field(learner)
        setattr(learner, field, resolved)
        try:
            learner.save(update_fields=[field])
        except DatabaseError as exc:
            logger.exception("module_learners: save failed for learner %s", learner.id)
            return _error(f"Database error: {exc}", 502)
        # Same mirror as the learner's own plan save: assigning a module from
        # this side changes the same record, so the reporting tables have to
        # follow it here too or they would only track edits made from one of
        # the two directions.
        sync_learning_plan_mirror(learner)
        # Agreeing a plan is the last gate before Active for a commercial
        # learner, the same as on the learner's own plan save. Never raises.
        advance_learner(learner)
        changed += 1

    try:
        return JsonResponse({
            **_module_learners_payload(module, _picker_learners(), {}),
            "changedCount": changed,
        })
    except DatabaseError as exc:
        logger.exception("module_learners: read-back failed")
        return _error(f"Database error: {exc}", 502)


# ---------------------------------------------------------------------------
# Onboarding completion -> Delivery
# ---------------------------------------------------------------------------
# The three onboarding reviews are the gate into delivery. Once every one of them
# is signed by each party it needs, the learner has nothing left to complete, so
# the status moves itself on rather than waiting for someone to remember.
ONBOARDING_REVIEW_TYPES = ("eligibility-review", "workspace", "training-plan")

# Statuses a learner can be promoted *out of*. Anything else (Active, Completed,
# Withdrawn, On break) is a deliberate later state, so a late signature must not
# drag the learner backwards into Delivery.
PRE_DELIVERY_STATUSES = {"Fresh user", "Onboarding", "Ready to enrol", ""}


def _fully_signed(review):
    """Whether every party this review needs has signed it."""
    from .review_form import employer_signature_required

    if not review.form_completed:
        return False
    if not _s(review.learner_signature) or not _s(review.admin_signature):
        return False
    if employer_signature_required(review) and not _s(review.employer_signature):
        return False
    return True


def onboarding_complete(learner_kind, learner_id):
    """True when all three onboarding reviews are signed off by every party."""
    from .models import EnrolmentReview

    reviews = EnrolmentReview.objects.filter(
        learner_kind=learner_kind,
        learner_id=learner_id,
        review_type__in=ONBOARDING_REVIEW_TYPES,
    ).exclude(status="cancelled")

    signed = {
        _s(r.review_type) for r in reviews if _fully_signed(r)
    }
    return all(t in signed for t in ONBOARDING_REVIEW_TYPES)


def promote_learner_if_ready(learner_kind, learner_id):
    """Move one learner to Delivery if their onboarding reviews are all signed.

    The signature endpoint calls promote_to_delivery_if_ready() the moment the
    last signature lands, which covers the normal path. This is the safety net
    for everything else: reviews signed before that hook existed, or completed
    through another route. Reading a learner's record re-checks them, so a
    qualifying learner cannot stay stuck at Onboarding.

    Returns the new status when it changed, else None. Never raises.
    """
    try:
        # Commercial learners deliberately have no onboarding-review gate.
        if _s(learner_kind).casefold() == "commercial":
            return None
        if not onboarding_complete(learner_kind, learner_id):
            return None

        learner = EnrolmentUser.all_learners.filter(pk=learner_id).first()
        if learner is None:
            return None
        if _s(learner.programme_status) not in PRE_DELIVERY_STATUSES:
            return None

        learner.programme_status = DELIVERY_PROGRAMME_STATUS
        learner.save(update_fields=["programme_status"])
        return DELIVERY_PROGRAMME_STATUS
    except DatabaseError:
        logger.exception("promote_learner_if_ready: failed for %s/%s", learner_kind, learner_id)
        return None


def promote_to_delivery_if_ready(review):
    """Move a learner to Delivery once their onboarding reviews are all signed.

    Called after a signature is saved. Only ever moves a learner *forward* out of
    the pre-delivery statuses — a learner already Active, Completed or Withdrawn
    is left alone, so a late signature cannot drag them backwards.

    Returns the new status when it changed, else None. Never raises: a failure
    here must not fail the signature that triggered it.
    """
    try:
        # Commercial learners deliberately have no onboarding-review gate.
        if _s(getattr(review, "learner_kind", "")).casefold() == "commercial":
            return None
        if _s(review.review_type) not in ONBOARDING_REVIEW_TYPES:
            return None
        if not onboarding_complete(review.learner_kind, review.learner_id):
            return None

        learner = EnrolmentUser.all_learners.filter(pk=review.learner_id).first()
        if learner is None:
            return None
        if _s(learner.programme_status) not in PRE_DELIVERY_STATUSES:
            return None

        learner.programme_status = DELIVERY_PROGRAMME_STATUS
        learner.save(update_fields=["programme_status"])
        return DELIVERY_PROGRAMME_STATUS
    except DatabaseError:
        logger.exception("promote_to_delivery_if_ready: failed for review %s", review.pk)
        return None
