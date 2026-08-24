"""Relational learner persistence helpers.

The module name is retained for import compatibility. Runtime data is stored in
``Learner.learners`` and its normalized child tables; the former Active/Unactive
JSON tables are not read or written here.
"""

import hashlib
import json
import logging
import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.db import DatabaseError, connections, transaction
from django.db.models import Max
from django.utils.dateparse import parse_datetime

from .mappers import get_training_plan
from .models import (
    KsbDefinition,
    KsbProfileVersion,
    LearnerKsbAssignment,
    LearnerProfile,
    LearnerProgressEntry,
    LearnerProgressKsb,
    LearnerQuizAnswer,
    LearnerQuizChosenAnswer,
    LearnerQuizCorrectAnswer,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
)

logger = logging.getLogger(__name__)
ACTIVE_STATUS = "active"


def _s(value):
    return "" if value is None else str(value).strip()


def _number(value):
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _decimal(value):
    if value in (None, ""):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _datetime(value):
    if not value:
        return None
    return value if hasattr(value, "tzinfo") else parse_datetime(str(value))


def _reported_minutes(value):
    text = _s(value)
    if not text:
        return 0.0
    if ":" in text:
        try:
            minutes, seconds, *_ = [float(part) for part in text.split(":")]
            return minutes + seconds / 60
        except (TypeError, ValueError):
            return 0.0
    lower_text = text.lower()
    hour_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", lower_text)]
    minute_matches = [float(amount) for amount in re.findall(r"(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b", lower_text)]
    if hour_matches or minute_matches:
        return sum(hour_matches) * 60 + sum(minute_matches)

    match = re.search(r"\d+(?:\.\d+)?", lower_text)
    if not match:
        return 0.0
    value = float(match.group(0))
    # Small bare numbers are learner-entered hours ("2" => 2h). Larger bare
    # values usually come from component duration fields stored as minutes.
    return value if value > 24 else value * 60


def fmt_hours(hours):
    try:
        value = round(float(hours), 1)
    except (TypeError, ValueError):
        return "0"
    return str(int(value)) if value == int(value) else str(value)


def _progress_text(record, *fields):
    for field in fields:
        value = _s(record.get(field))
        if value:
            return value
    return ""


def otjh_progress_dedupe_key(record, index=0):
    if not isinstance(record, dict):
        return f"entry:{index}"

    kind = _s(record.get("kind")).lower()
    quiz_id = _s(record.get("quizId"))
    if quiz_id:
        return f"quiz:{quiz_id}"

    component_id = _s(record.get("componentId"))
    if component_id:
        return f"component:{component_id}"

    title = _progress_text(record, "title", "quizName", "componentTitle", "component")
    module = _progress_text(record, "moduleTitle", "module")
    week = _progress_text(record, "weekTitle", "week")
    if title:
        return "|".join(part for part in ("legacy", kind, module, week, title) if part)

    ksbs = ",".join(sorted(_s(code).upper() for code in record.get("ksbs") or [] if _s(code)))
    reported_time = _s(record.get("reportedTime")).lower()
    if kind or reported_time or ksbs:
        return "|".join(part for part in ("legacy", kind, reported_time, ksbs) if part)

    return f"entry:{index}"


def dedupe_otjh_progress_records(progress):
    if not isinstance(progress, list):
        return []
    seen = set()
    unique = []
    for index, record in enumerate(progress):
        if not isinstance(record, dict):
            continue
        key = otjh_progress_dedupe_key(record, index)
        if key in seen:
            continue
        seen.add(key)
        unique.append(record)
    return unique


def _component_expected_hours_lookup(components):
    lookup = {}
    if not isinstance(components, list):
        return lookup

    for item in components:
        if not isinstance(item, dict):
            continue
        nested_weeks = item.get("weeks")
        if isinstance(nested_weeks, list):
            for week in nested_weeks:
                for component in (week.get("components") or []) if isinstance(week, dict) else []:
                    component_id = _s(component.get("componentId") or component.get("id"))
                    expected = _number(component.get("expectedOtjh") or component.get("expected_otjh"))
                    if component_id and expected is not None:
                        lookup[component_id] = expected
            continue

        component_id = _s(item.get("componentId") or item.get("id"))
        expected = _number(item.get("expectedOtjh") or item.get("expected_otjh"))
        if component_id and expected is not None:
            lookup[component_id] = expected
    return lookup


class ComponentReferenceError(ValueError):
    """A component-based write named a Component it may not be written against.

    Base class for the two rejections below so callers can map both to one 4xx.
    """


class OrphanComponentReferenceError(ComponentReferenceError):
    """A write named a Component id that does not exist in Curriculum.

    Historically ``component_ref`` was persisted straight from the client, so a
    stale or frontend-generated id produced a row that silently referred to
    nothing while the request still returned success. Callers translate this
    into a 4xx so the client learns the write was rejected instead of being
    told it succeeded.
    """

    def __init__(self, component_id):
        self.component_id = component_id
        super().__init__(
            f'Unknown component reference "{component_id}". '
            'Component-based progress must reference an existing Curriculum component.'
        )


class DeletedComponentReferenceError(ComponentReferenceError):
    """A write named a Component whose effective Curriculum lineage is deleted.

    Distinct from an orphan: the Component exists and historical rows pointing
    at it must keep resolving. It simply may not receive *new* learner activity,
    because the curriculum it belongs to has been withdrawn. ``deleted_level``
    names the level that withdrew it, which is what makes a parent-driven
    deletion explainable to the client.
    """

    def __init__(self, component_id, deleted_level=""):
        self.component_id = component_id
        self.deleted_level = deleted_level or "curriculum"
        super().__init__(
            f'Component "{component_id}" belongs to deleted curriculum '
            f'({self.deleted_level}). New progress cannot be recorded against it.'
        )


def component_reference_exists(component_id):
    """Does this id resolve to a real Curriculum component?

    This is the **historical** resolver. Soft-deleted components count: a
    learner can legitimately have completed something that was archived
    afterwards, and historical rows must stay joinable to it. This only rejects
    ids that exist nowhere at all. Reporting and lineage reads use this;
    ``component_reference_state`` is what gates a new write.

    Raises DatabaseError if no alias could be reached. A lookup that could not
    run is not evidence of absence, and answering "False" there would reject a
    perfectly valid write as an unknown component.
    """
    component_id = _s(component_id)
    if not component_id:
        return False
    last_error = None
    reachable = False
    for alias in ("default", "enrolment"):
        try:
            with connections[alias].cursor() as cursor:
                cursor.execute(
                    "select 1 from curriculum.components where id = %s limit 1",
                    [component_id],
                )
                reachable = True
                if cursor.fetchone():
                    return True
        except DatabaseError as exc:
            last_error = exc
            logger.debug("Could not verify component %s on %s", component_id, alias, exc_info=True)
            continue
    if not reachable:
        raise last_error
    return False


# Effective soft-delete of a component, level by level, in the order a rejection
# should name. Mirrors the ``is_deleted`` expression of the
# curriculum.component_learning_lineage view (curriculum_api migration 0041):
# deleted_at / is_programme_deleted at every level, and is_archived on
# programmes, which carries no is_programme_deleted column.
_COMPONENT_LINEAGE_DELETED_SQL = """
    select
        (c.deleted_at is not null or coalesce(c.is_programme_deleted, false)) as component_deleted,
        (w.id is not null and (w.deleted_at is not null or coalesce(w.is_programme_deleted, false))) as week_deleted,
        (m.module_catalogue_id is not null and (m.deleted_at is not null or coalesce(m.is_programme_deleted, false))) as module_deleted,
        (g.group_id is not null and (g.deleted_at is not null or coalesce(g.is_programme_deleted, false))) as group_deleted,
        (ch.cohort_id is not null and (ch.deleted_at is not null or coalesce(ch.is_programme_deleted, false))) as cohort_deleted,
        (p.programme_id is not null and (p.deleted_at is not null or coalesce(p.is_archived, false))) as programme_deleted
    from curriculum.components c
    left join curriculum.weeks w on w.id = c.week_id
    left join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
    left join curriculum.groups g on g.group_id = m.group_id
    left join curriculum.cohorts ch on ch.cohort_id = m.cohort_id
    left join curriculum.programmes p on p.programme_id = m.programme_id
    where c.id = %s
    limit 1
"""

_COMPONENT_LINEAGE_LEVELS = ("component", "week", "module", "group", "cohort", "programme")


def component_reference_state(component_id):
    """``("active"|"deleted"|"unknown", deleted_level)`` for a Component id.

    ``"deleted"`` covers parent-driven deletion: a component that is itself
    intact but whose week, module, group, cohort or programme has been
    withdrawn is not valid for new activity. The distinction that matters is
    read vs write, not existence — historical reads still resolve a deleted
    component (see ``component_reference_exists``); only a new authoritative
    write is refused.

    Raises DatabaseError if no alias could answer, for the same reason
    ``component_reference_exists`` does: an unanswered lookup is not evidence,
    and treating it as "deleted" would turn a database hiccup into rejected
    valid work.
    """
    component_id = _s(component_id)
    if not component_id:
        return "unknown", ""
    last_error = None
    reachable = False
    for alias in ("default", "enrolment"):
        try:
            with connections[alias].cursor() as cursor:
                cursor.execute(_COMPONENT_LINEAGE_DELETED_SQL, [component_id])
                row = cursor.fetchone()
        except DatabaseError as exc:
            last_error = exc
            logger.debug("Could not resolve component state for %s on %s", component_id, alias, exc_info=True)
            continue
        reachable = True
        if not row:
            # Answered, and this id is in no curriculum here. The two aliases can
            # be split in production, so keep looking before concluding.
            continue
        for level, deleted in zip(_COMPONENT_LINEAGE_LEVELS, row):
            if deleted:
                return "deleted", level
        return "active", ""
    if not reachable:
        raise last_error
    return "unknown", ""


def _component_learning_context(component_id):
    component_id = _s(component_id)
    if not component_id:
        return {}

    context = {}
    for alias in ("default", "enrolment"):
        try:
            with connections[alias].cursor() as cursor:
                cursor.execute(
                    """
                    select
                        c.id,
                        c.title,
                        c.type,
                        c.expected_otjh,
                        c.points,
                        c.ksb_mappings,
                        w.id,
                        w.title,
                        m.module_catalogue_id,
                        m.title,
                        m.programme_id,
                        coalesce(p.name, m.programme_name),
                        m.cohort_id,
                        m.cohort_name,
                        m.group_id,
                        m.group_name
                    from curriculum.components c
                    left join curriculum.weeks w on w.id = c.week_id
                    left join curriculum.modules m on m.module_catalogue_id = c.module_catalogue_id
                    left join curriculum.programmes p on p.programme_id = m.programme_id
                    where c.id = %s
                    limit 1
                    """,
                    [component_id],
                )
                row = cursor.fetchone()
                if not row:
                    return {}
                (
                    _component_ref,
                    component_title,
                    component_type,
                    expected_otjh,
                    points,
                    canonical_mappings,
                    week_ref,
                    week_title,
                    module_ref,
                    module_title,
                    programme_ref,
                    programme_title,
                    cohort_ref,
                    cohort_title,
                    group_ref,
                    group_title,
                ) = row
                mappings = _normalise_component_ksb_mappings(canonical_mappings)
                if not mappings:
                    cursor.execute(
                        """
                        select ksb_code, ksb_description, source_type, source_id, classification, weight, weight_class
                          from curriculum.ksb_mappings
                         where component_id = %s
                           and coalesce(ksb_code, '') <> ''
                           and deleted_at is null
                           and coalesce(is_programme_deleted, false) = false
                         order by ksb_code, id
                        """,
                        [component_id],
                    )
                    mappings = [
                        {
                            "code": _s(code).upper(),
                            "description": _s(description),
                            "sourceType": _s(source_type),
                            "sourceId": _s(source_id),
                            "classification": _s(classification),
                            "weight": _decimal(weight),
                            "weightClass": _normalise_weight_class(weight_class, classification),
                        }
                        for code, description, source_type, source_id, classification, weight, weight_class in cursor.fetchall()
                        if _s(code)
                    ]
                context = {
                    "componentTitle": _s(component_title),
                    "componentType": _s(component_type),
                    "expectedOtjh": _decimal(expected_otjh),
                    "points": int(points) if points not in (None, "") else None,
                    "weekId": _s(week_ref),
                    "weekTitle": _s(week_title),
                    "moduleId": _s(module_ref),
                    "moduleTitle": _s(module_title),
                    "programmeId": _s(programme_ref),
                    "programme": _s(programme_title),
                    "cohortId": _s(cohort_ref),
                    "cohort": _s(cohort_title),
                    "groupId": _s(group_ref),
                    "group": _s(group_title),
                    "ksbMappings": mappings,
                }
                return context
        except DatabaseError:
            if alias == "enrolment":
                logger.warning("Could not resolve curriculum context for component %s", component_id, exc_info=True)
            continue
    return context


def _normalise_weight_class(value, classification=""):
    raw = _s(value).lower()
    if raw in {"hard", "soft", "possible"}:
        return raw
    classification = _s(classification).lower()
    if classification == "main":
        return "hard"
    if classification == "possible":
        return "possible"
    return "soft"


def _normalise_component_ksb_mappings(value):
    if isinstance(value, str):
        try:
            value = json.loads(value) if value else []
        except (TypeError, ValueError):
            value = []
    if not isinstance(value, list):
        return []
    mappings = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        code = _s(item.get("code") or item.get("ksbCode") or item.get("ksb_code")).upper()
        if not code or code in seen:
            continue
        seen.add(code)
        classification = _s(item.get("classification") or item.get("type"))
        mappings.append({
            "code": code,
            "description": _s(item.get("description") or item.get("ksbDescription") or item.get("ksb_description")),
            "sourceType": _s(item.get("sourceType") or item.get("source_type")),
            "sourceId": _s(item.get("sourceId") or item.get("source_id")),
            "classification": classification,
            "weight": _decimal(item.get("weight")),
            "weightClass": _normalise_weight_class(
                item.get("weightClass") if "weightClass" in item else item.get("weight_class"),
                classification,
            ),
        })
    return mappings


def completed_hours_from_progress(progress, components=None):
    if not isinstance(progress, list):
        return "0"
    expected_hours_by_component = _component_expected_hours_lookup(components)
    hours = 0.0
    for record in dedupe_otjh_progress_records(progress):
        component_id = _s(record.get("componentId"))
        record_expected = _number(record.get("expectedOtjh") or record.get("expected_otjh"))
        if record_expected is not None:
            hours += record_expected
            continue
        expected_hours = expected_hours_by_component.get(component_id)
        if expected_hours is not None:
            hours += expected_hours
            continue
        hours += _reported_minutes(record.get("reportedTime")) / 60
    return fmt_hours(hours)


def replace_training_plan(learner, plan):
    LearnerTrainingPlanModule.objects.filter(learner=learner).delete()
    for module_position, module in enumerate(plan or [], 1):
        module_row = LearnerTrainingPlanModule.objects.create(
            learner=learner,
            position=module_position,
            module_ref=_s(module.get("moduleId")) or None,
            module_title=_s(module.get("moduleTitle")),
        )
        for week_position, week in enumerate(module.get("weeks") or [], 1):
            week_row = LearnerTrainingPlanWeek.objects.create(
                plan_module=module_row,
                position=week_position,
                week_ref=_s(week.get("weekId")) or None,
                week_title=_s(week.get("weekTitle")),
            )
            LearnerTrainingPlanComponent.objects.bulk_create(
                [
                    LearnerTrainingPlanComponent(
                        plan_week=week_row,
                        position=position,
                        component_ref=_s(component.get("componentId")) or None,
                        component_title=_s(component.get("componentTitle")),
                    )
                    for position, component in enumerate(week.get("components") or [], 1)
                ]
            )


def hydrate_training_plan(plan):
    """Expand selected modules into their authored week/component tree.

    Enrolment's module picker stores a deliberately small selection payload.
    Learner delivery needs the complete tree, however, so resolve it from the
    curriculum source before an Active profile is built. Existing detailed
    plans are refreshed too: the authored curriculum remains authoritative.
    """
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except ValueError:
            return []
    if not isinstance(plan, list):
        return []

    selected = [item for item in plan if isinstance(item, dict)]
    module_ids = [_s(item.get("moduleId")) for item in selected if _s(item.get("moduleId"))]
    module_titles = [_s(item.get("moduleTitle")) for item in selected if _s(item.get("moduleTitle"))]
    if not module_ids and not module_titles:
        return selected

    try:
        # Curriculum belongs to the default database. The enrolment alias only
        # owns learner records when the two connections are split in production.
        with connections["default"].cursor() as cursor:
            cursor.execute(
                """
                SELECT m.module_catalogue_id, m.title,
                       w.id, w.title, w.week_number,
                       c.id, c.title, c.type
                FROM curriculum.modules m
                LEFT JOIN curriculum.weeks w ON w.module_catalogue_id = m.module_catalogue_id
                LEFT JOIN curriculum.components c ON c.week_id = w.id
                WHERE m.module_catalogue_id = ANY(%s) OR m.title = ANY(%s)
                ORDER BY m.module_catalogue_id, w.display_order, w.week_number,
                         c.display_order, c.id
                """,
                [module_ids, module_titles],
            )
            rows = cursor.fetchall()
    except DatabaseError:
        logger.exception("Could not expand training-plan modules from curriculum")
        return selected

    titles = {}
    ids_by_title = {}
    weeks_by_module = {}
    seen_weeks = set()
    for module_id, module_title, week_id, week_title, week_number, component_id, component_title, component_type in rows:
        module_id = _s(module_id)
        titles[module_id] = _s(module_title) or module_id
        ids_by_title[titles[module_id]] = module_id
        if not week_id:
            continue
        week_key = (module_id, str(week_id))
        if week_key not in seen_weeks:
            weeks_by_module.setdefault(module_id, []).append({
                "weekId": str(week_id),
                "weekTitle": _s(week_title) or f"Week {week_number}",
                "components": [],
            })
            seen_weeks.add(week_key)
        if component_id:
            weeks_by_module[module_id][-1]["components"].append({
                "componentId": str(component_id),
                "componentTitle": _s(component_title) or _s(component_type) or "Activity",
            })

    expanded = []
    for item in selected:
        module_id = _s(item.get("moduleId"))
        if module_id not in titles:
            module_id = ids_by_title.get(_s(item.get("moduleTitle")), module_id)
        # Keep orphaned/id-less entries intact: they cannot be resolved against
        # current curriculum and should remain visible for staff to correct.
        if not module_id or module_id not in titles:
            expanded.append(item)
            continue
        expanded.append({
            **item,
            "moduleId": module_id,
            "moduleTitle": titles[module_id],
            "weeks": weeks_by_module.get(module_id, []),
        })
    return expanded


def hydrate_source_training_plan(source):
    """Persist an expanded plan on the enrolment source when it changed.

    This self-heals learners activated before this expansion existed as well as
    making every new Active learner immediately able to open their activities.
    """
    plan = get_training_plan(source)
    hydrated = hydrate_training_plan(plan)
    if hydrated == plan:
        return hydrated

    # Apprenticeships use Learning_plan; commercial learners use Training_plan.
    field = "training_plan" if getattr(source, "training_plan", None) else "learning_plan"
    setattr(source, field, hydrated)
    source.save(update_fields=[field])
    return hydrated


def _canonical_ksb_items(items):
    canonical = []
    seen = set()
    for item in items or []:
        if not isinstance(item, dict):
            continue
        code = _s(item.get("code")).upper()
        if not code or code in seen:
            continue
        seen.add(code)
        canonical.append({
            "code": code,
            "number": _s(item.get("number")),
            "type": _s(item.get("type")),
            "description": _s(item.get("description")),
        })
    return canonical


def _ksb_version_hash(items):
    payload = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def replace_learner_ksbs(learner, items, *, source_profile_id=""):
    """Assign one immutable shared KSB profile version to a learner.

    Definitions are stored once per content version in curriculum; the learner
    receives a single assignment row.  The legacy learner_ksbs snapshot is left
    untouched as a rollback/read compatibility fallback.
    """
    canonical = _canonical_ksb_items(items)
    if learner is None or not canonical:
        return None

    source_key = _s(source_profile_id) or f"programme:{_s(getattr(learner, 'programme', '')).casefold()}"
    if source_key == "programme:":
        source_key = "legacy"
    version_hash = _ksb_version_hash(canonical)

    with transaction.atomic(using="enrolment"):
        version, created = KsbProfileVersion.objects.using("enrolment").get_or_create(
            source_profile_id=source_key,
            version_hash=version_hash,
            defaults={
                "programme": _s(getattr(learner, "programme", "")),
                "definition_count": len(canonical),
            },
        )
        if created:
            KsbDefinition.objects.using("enrolment").bulk_create([
                KsbDefinition(
                    profile_version=version,
                    position=position,
                    code=item["code"],
                    number=item["number"],
                    ksb_type=item["type"],
                    description=item["description"],
                )
                for position, item in enumerate(canonical, 1)
            ])
        # An existing learner stays pinned to the version assigned at enrolment.
        # Curriculum edits create a new immutable version for future learners
        # instead of changing historical requirements retroactively.
        LearnerKsbAssignment.objects.using("enrolment").get_or_create(
            learner=learner,
            defaults={"profile_version": version},
        )
    return version


def save_progress_record(learner, record, activity=None):
    """Store progress, quiz detail, KSB links, and feed presentation atomically."""
    if learner is None:
        return None
    # A NEW component-based write must name a Component that exists AND is still
    # valid for new activity.
    #
    #   unknown -> a false success: the row is written, the client is told it
    #              worked, and the activity is invisible to every
    #              Curriculum/Coach report that joins on component_ref.
    #   deleted -> the curriculum it belongs to has been withdrawn, so new
    #              delivery cannot be recorded against it. This is the write
    #              side only: historical rows already pointing at a deleted
    #              Component keep resolving, which is why the read helpers
    #              (component_reference_exists, _component_learning_context)
    #              deliberately still return it.
    #
    # Activity that is genuinely not Component-based (a standalone quiz, for
    # example) carries no componentId and is unaffected.
    component_id = _s(record.get("componentId"))
    if component_id:
        state, deleted_level = component_reference_state(component_id)
        if state == "unknown":
            raise OrphanComponentReferenceError(component_id)
        if state == "deleted":
            raise DeletedComponentReferenceError(component_id, deleted_level)
    component_context = _component_learning_context(record.get("componentId"))
    ksb_mappings = component_context.get("ksbMappings") or record.get("ksbMappings") or []
    if ksb_mappings:
        ksb_items = [
            item for item in ksb_mappings
            if isinstance(item, dict) and _s(item.get("code") or item.get("ksbCode"))
        ]
    else:
        ksb_items = [
            {"code": code}
            for code in (record.get("ksbs") or [])
            if _s(code)
        ]
    with transaction.atomic(using="enrolment"):
        # Serialize writes per learner so two simultaneous submissions cannot
        # claim the same entry/event order.
        learner = LearnerProfile.objects.select_for_update().get(pk=learner.pk)
        next_order = (
            LearnerProgressEntry.objects.filter(learner=learner)
            .aggregate(value=Max("entry_order"))["value"]
            or 0
        ) + 1
        activity = activity if isinstance(activity, dict) else {}
        progress = LearnerProgressEntry.objects.create(
            learner=learner,
            entry_order=next_order,
            kind=_s(record.get("kind")) or "quiz",
            programme_ref=_s(record.get("programmeId") or component_context.get("programmeId")) or None,
            programme_title=_s(record.get("programme") or component_context.get("programme")),
            cohort_ref=_s(record.get("cohortId") or component_context.get("cohortId")) or None,
            cohort_title=_s(record.get("cohort") or component_context.get("cohort")),
            group_ref=_s(record.get("groupId") or component_context.get("groupId")) or None,
            group_title=_s(record.get("group") or component_context.get("group")),
            module_ref=_s(record.get("moduleId") or component_context.get("moduleId")) or None,
            module_title=_s(record.get("moduleTitle") or record.get("module") or component_context.get("moduleTitle") or activity.get("module")),
            week_ref=_s(record.get("weekId") or component_context.get("weekId")) or None,
            week_title=_s(record.get("weekTitle") or record.get("week") or component_context.get("weekTitle") or activity.get("week")),
            component_ref=_s(record.get("componentId")) or None,
            component_title=_s(record.get("componentTitle") or component_context.get("componentTitle") or activity.get("title")),
            component_type=_s(record.get("componentType") or component_context.get("componentType") or activity.get("componentType")),
            expected_otjh=_decimal(record.get("expectedOtjh") or component_context.get("expectedOtjh")),
            points=record.get("points") if record.get("points") not in (None, "") else component_context.get("points"),
            quiz_ref=_s(record.get("quizId")) or None,
            attempt=record.get("attempt"),
            grade=_number(record.get("grade", record.get("Score"))),
            achieved_score=_number(record.get("achievedScore")),
            total_score=_number(record.get("totalScore")),
            passed=record.get("passed") if isinstance(record.get("passed"), bool) else None,
            feedback=_s(record.get("feedback")),
            reported_time=_s(record.get("reportedTime")),
            started_at=_datetime(record.get("startedAt")),
            submitted_at=_datetime(record.get("submittedAt")),
            time_taken=_s(record.get("timeTaken")),
            feed_kind=_s(activity.get("kind") or record.get("kind")),
            feed_action=_s(activity.get("action")),
            feed_title=_s(activity.get("title") or record.get("componentTitle")),
            feed_detail=_s(activity.get("detail")),
            feed_occurred_at=_datetime(activity.get("at") or record.get("submittedAt")),
            # Classified at write time so new rows never need a backfill to be
            # explainable. The guard above has already proven the component
            # resolves, so anything carrying a componentId is component-based.
            component_link_status=(
                "resolved_to_current_component" if component_id
                else "valid_legacy_non_component_activity" if _s(record.get("quizId"))
                else "non_component_activity"
            ),
            component_link_source="direct" if component_id else ("quiz_ref" if _s(record.get("quizId")) else "none"),
        )
        LearnerProgressKsb.objects.bulk_create(
            [
                LearnerProgressKsb(
                    progress=progress,
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
                for position, item in enumerate(ksb_items, 1)
            ]
        )
        for position, answer in enumerate(record.get("questions") or [], 1):
            chosen = answer.get("chosenAnswerId")
            answer_row = LearnerQuizAnswer.objects.create(
                progress=progress,
                position=position,
                question_ref=int(answer.get("questionId")),
                chosen_answer_ref=chosen if not isinstance(chosen, list) else None,
                is_correct=answer.get("correct") if isinstance(answer.get("correct"), bool) else None,
                earned=_number(answer.get("earned")),
            )
            LearnerQuizCorrectAnswer.objects.bulk_create(
                [
                    LearnerQuizCorrectAnswer(
                        quiz_answer=answer_row,
                        position=key_position,
                        answer_ref=int(answer_ref),
                    )
                    for key_position, answer_ref in enumerate(answer.get("correctAnswerId") or [], 1)
                ]
            )
            LearnerQuizChosenAnswer.objects.bulk_create(
                [
                    LearnerQuizChosenAnswer(
                        quiz_answer=answer_row,
                        position=choice_position,
                        answer_ref=int(answer_ref),
                    )
                    for choice_position, answer_ref in enumerate(
                        chosen if isinstance(chosen, list) else [],
                        1,
                    )
                ]
            )
        learner.completed_hours = _number(
            completed_hours_from_progress(learner.training_plan_progress)
        )
        learner.save(update_fields=["completed_hours", "updated_at"])
        return progress


def recompute_completed_hours(learner_id):
    try:
        learner = LearnerProfile.objects.filter(id=learner_id).first()
        if learner is None:
            return None
        value = completed_hours_from_progress(learner.training_plan_progress)
        learner.completed_hours = _number(value)
        learner.save(update_fields=["completed_hours", "updated_at"])
        return value
    except DatabaseError as exc:
        logger.warning("Could not recompute learner hours for %s: %s", learner_id, exc)
        return None


def cohort_delivery_window(programme, cohort):
    """The authored dates a learner inherits by being assigned to a cohort.

    Returns ``(start_date, practical_end_date, apprenticeship_end_date)``. The
    practical end date is the cohort's ``end_date`` — the name every learner
    table already stores it under — and the apprenticeship end date is the
    one authored on the cohort when there is one, otherwise the practical end
    date plus its End Point Assessment period. The apprenticeship date is None
    for a cohort with neither recorded, which is not the same as one that ends
    the day its practical period does.
    """
    programme, cohort = _s(programme), _s(cohort)
    if not programme or not cohort:
        return None, None, None
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                # Table was renamed cohort_authoring_details -> cohorts by
                # curriculum_api migration 0004; same columns.
                'SELECT start_date, end_date, apprenticeship_end_date '
                'FROM curriculum."cohorts" '
                "WHERE lower(btrim(programme_name)) = lower(%s) "
                "AND lower(btrim(cohort_name)) = lower(%s) "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, cohort],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find cohort dates for %s / %s: %s", programme, cohort, exc)
        return None, None, None
    return (row[0], row[1], row[2]) if row else (None, None, None)


def cohort_dates(programme, cohort):
    """The cohort's practical delivery window, for callers that only store one
    end date. See cohort_delivery_window for the apprenticeship end date."""
    start_date, practical_end_date, _ = cohort_delivery_window(programme, cohort)
    return start_date, practical_end_date


def _plan_module_ids(training_plan):
    module_ids = []
    for module in training_plan or []:
        if not isinstance(module, dict):
            continue
        module_id = _s(module.get("moduleId"))
        if module_id:
            module_ids.append(module_id)
    return sorted(set(module_ids))


def _ksb_sort_key(code):
    text = _s(code).upper()
    prefix = text[:1]
    suffix = text[1:]
    parts = []
    for token in re.findall(r"\d+|[A-Z]+", suffix):
        parts.append((0, int(token)) if token.isdigit() else (1, token))
    return (
        {"K": 0, "S": 1, "B": 2}.get(prefix, 99),
        tuple(parts),
        text,
    )


def _ksb_type_from_code(code):
    return {
        "K": "Knowledge",
        "S": "Skills",
        "B": "Behaviours",
    }.get(_s(code).upper()[:1], "")


def _ksb_number_from_code(code):
    text = _s(code).upper()
    return text[1:].strip() if len(text) > 1 else ""


def _clean_ksb_profile_source_id(value):
    text = _s(value)
    if text.lower().startswith("profile:"):
        return text.split(":", 1)[1].strip()
    return text


def _ksb_code_from_parts(code="", ksb_type=""):
    raw_code = _s(code).upper()
    raw_type = _s(ksb_type).upper()
    if raw_code and raw_code[:1] in {"K", "S", "B"}:
        return raw_code
    prefix = raw_type[:1] if raw_type[:1] in {"K", "S", "B"} else ""
    if prefix and raw_code:
        return f"{prefix}{raw_code}"
    return raw_code


def _coerce_ksb_items(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return []
    if not isinstance(value, list):
        return []

    items = []
    for position, item in enumerate(value, 1):
        if not isinstance(item, dict):
            continue
        code = _ksb_code_from_parts(item.get("code"), item.get("type"))
        number = _s(item.get("number")) or _ksb_number_from_code(code) or _s(item.get("code"))
        description = _s(item.get("description")) or _s(item.get("title"))
        raw_type = _s(item.get("type"))
        normalized_type = _ksb_type_from_code(code) or {
            "KNOWLEDGE": "Knowledge",
            "K": "Knowledge",
            "SKILL": "Skills",
            "SKILLS": "Skills",
            "S": "Skills",
            "BEHAVIOUR": "Behaviours",
            "BEHAVIOURS": "Behaviours",
            "BEHAVIOR": "Behaviours",
            "BEHAVIORS": "Behaviours",
            "B": "Behaviours",
        }.get(raw_type.upper(), raw_type)
        display_order = item.get("displayOrder")
        try:
            display_order = int(display_order)
        except (TypeError, ValueError):
            display_order = position
        if not code:
            continue
        items.append(
            {
                "code": code,
                "number": number,
                "type": normalized_type,
                "description": description,
                "_display_order": display_order,
            }
        )

    items.sort(key=lambda item: (item.get("_display_order", 0), _ksb_sort_key(item.get("code"))))
    for item in items:
        item.pop("_display_order", None)
    return items


def _resolve_programme_id(programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    if module_ids:
        try:
            with connections["enrolment"].cursor() as cursor:
                cursor.execute(
                    "SELECT DISTINCT programme_id FROM curriculum.modules "
                    "WHERE module_catalogue_id = ANY(%s) AND programme_id IS NOT NULL AND programme_id <> '' "
                    "ORDER BY programme_id LIMIT 1",
                    [module_ids],
                )
                row = cursor.fetchone()
        except DatabaseError as exc:
            logger.warning("Could not resolve programme id from module snapshot for %s: %s", module_ids, exc)
        else:
            if row and _s(row[0]):
                return _s(row[0])

    programme = _s(programme)
    if not programme:
        return ""
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(NULLIF(programme_id, ''), NULLIF(name, '')) AS programme_id "
                "FROM curriculum.programmes "
                "WHERE lower(btrim(COALESCE(name, ''))) = lower(%s) "
                "   OR lower(btrim(COALESCE(programme_id, ''))) = lower(%s) "
                "   OR lower(%s) LIKE lower(btrim(COALESCE(name, ''))) || ' %%' "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme, programme, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not resolve programme id for %s: %s", programme, exc)
        return ""
    return _s(row[0]) if row else ""


def _resolve_linkable_programme_id(programme="", training_plan=None):
    """A programme id safe to PERSIST on the learner row, or ''.

    Deliberately stricter than _resolve_programme_id, which exists to pick a
    best-effort programme for a KSB lookup and will happily fall back to the
    most recently updated name match (or to the name itself). Writing that guess
    onto the learner is what this must not do: when an archived programme and
    its replacement share a name, the "most recent" row is the wrong one as
    often as not, and the learner ends up attached to a programme they were
    never enrolled on.

    So only an unambiguous answer is returned. The module snapshot is already
    keyed by programme id, so it is trusted outright; a programme *name* is
    trusted only when it identifies exactly one programme. Anything else
    resolves to '' and the caller leaves the existing link alone.
    """
    module_ids = _plan_module_ids(training_plan)
    if module_ids:
        try:
            with connections["enrolment"].cursor() as cursor:
                cursor.execute(
                    "SELECT DISTINCT programme_id FROM curriculum.modules "
                    "WHERE module_catalogue_id = ANY(%s) "
                    "  AND programme_id IS NOT NULL AND programme_id <> ''",
                    [module_ids],
                )
                rows = cursor.fetchall()
        except DatabaseError as exc:
            logger.warning(
                "Could not resolve programme id from module snapshot for %s: %s",
                module_ids,
                exc,
            )
        else:
            # More than one distinct programme in the snapshot is itself
            # ambiguous, so it is not a link either.
            if len(rows) == 1 and _s(rows[0][0]):
                return _s(rows[0][0])

    programme = _s(programme)
    if not programme:
        return ""
    try:
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT programme_id FROM curriculum.programmes "
                "WHERE lower(btrim(COALESCE(name, ''))) = lower(btrim(%s)) "
                "  AND COALESCE(btrim(programme_id), '') <> ''",
                [programme],
            )
            rows = cursor.fetchall()
    except DatabaseError as exc:
        logger.warning("Could not resolve a linkable programme id for %s: %s", programme, exc)
        return ""
    return _s(rows[0][0]) if len(rows) == 1 else ""


# The three KSB lookups below each run their query inside its own savepoint.
# They already caught DatabaseError and degraded to "no KSBs", which is the right
# behaviour — but catching an error does not un-abort a Postgres transaction, and
# these are called from inside sync_active_user's atomic block. Without the
# savepoint one failed lookup made every subsequent statement fail with "current
# transaction is aborted", so a whole batch of profile writes was silently lost.
def _fetch_ksb_items_for_programme(programme_id, programme):
    try:
        with connections["enrolment"].cursor() as cursor:
            # curriculum.ksb_profiles links to programmes through a single
            # jsonb array, programme_ids, which holds programme ids AND
            # programme names side by side. This query used to read
            # `programme_id = %s OR programme_name = %s` — neither column
            # exists, so it raised every time, was swallowed as a warning, and
            # silently returned no KSBs while leaving the caller's transaction
            # aborted.
            cursor.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE COALESCE(is_active, true) AND ("
                "      (%s <> '' AND programme_ids @> to_jsonb(%s::text)) "
                "   OR (%s <> '' AND programme_ids @> to_jsonb(%s::text))"
                ") "
                # An id match beats a name match: names are not unique.
                "ORDER BY CASE "
                "    WHEN %s <> '' AND programme_ids @> to_jsonb(%s::text) THEN 0 "
                "    ELSE 1 "
                "END, updated_at DESC NULLS LAST LIMIT 1",
                [programme_id, programme_id, programme, programme,
                 programme_id, programme_id],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find KSB profile for %s / %s: %s", programme_id, programme, exc)
        return []
    return _coerce_ksb_items(row[0]) if row else []


def _fetch_ksb_items_from_plan_mappings(programme_id="", programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    if not module_ids:
        return []
    try:
        # Savepointed for the same reason: a failure here must not abort the
        # caller's transaction, only this query.
        with transaction.atomic(using="enrolment"), connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT DISTINCT ON (upper(mapping.ksb_code)) "
                "       upper(mapping.ksb_code) AS code, "
                "       COALESCE(NULLIF(mapping.ksb_description, ''), '') AS description "
                "FROM curriculum.ksb_mappings mapping "
                "LEFT JOIN curriculum.modules module ON module.module_catalogue_id = mapping.module_catalogue_id "
                "WHERE mapping.module_catalogue_id = ANY(%s) "
                "  AND mapping.ksb_code IS NOT NULL "
                "  AND mapping.ksb_code <> '' "
                "  AND ("
                "        (%s = '' AND %s = '') "
                "     OR module.programme_id = %s "
                "     OR module.programme_name = %s "
                "     OR %s LIKE module.programme_name || ' %%'"
                "  ) "
                "ORDER BY upper(mapping.ksb_code), "
                "         CASE mapping.classification "
                "             WHEN 'main' THEN 0 "
                "             WHEN 'secondary' THEN 1 "
                "             WHEN 'possible' THEN 2 "
                "             ELSE 3 "
                "         END, "
                "         mapping.weight DESC, "
                "         mapping.ksb_description",
                [module_ids, programme_id, programme, programme_id, programme, programme],
            )
            rows = cursor.fetchall()
    except DatabaseError as exc:
        logger.warning("Could not derive KSBs from plan mappings for %s / %s: %s", programme_id, programme, exc)
        return []
    items = [
        {
            "code": code,
            "number": _ksb_number_from_code(code),
            "type": _ksb_type_from_code(code),
            "description": _s(description),
        }
        for code, description in rows
        if _s(code)
    ]
    return sorted(items, key=lambda item: _ksb_sort_key(item.get("code")))


def _resolve_ksb_profile_source_id(programme_id="", programme="", training_plan=None):
    module_ids = _plan_module_ids(training_plan)
    try:
        # Savepointed for the same reason as the two helpers above.
        with transaction.atomic(using="enrolment"), connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT COALESCE(NULLIF(ksb_profile_source_id, ''), '') "
                "FROM curriculum.programmes "
                "WHERE (%s <> '' AND programme_id = %s) "
                "   OR name = %s "
                "   OR %s LIKE name || ' %%' "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [programme_id, programme_id, programme, programme],
            )
            row = cursor.fetchone()
            source_id = _clean_ksb_profile_source_id(row[0]) if row else ""
            if source_id:
                return source_id
            if not module_ids:
                return ""
            cursor.execute(
                "SELECT COALESCE(NULLIF(module.ksb_profile_source_id, ''), '') "
                "FROM curriculum.modules module "
                "WHERE module.module_catalogue_id = ANY(%s) "
                "  AND module.ksb_profile_source_id IS NOT NULL "
                "  AND module.ksb_profile_source_id <> '' "
                "  AND ("
                "        (%s = '' AND %s = '') "
                "     OR module.programme_id = %s "
                "     OR module.programme_name = %s "
                "     OR %s LIKE module.programme_name || ' %%'"
                "  ) "
                "ORDER BY module.updated_at DESC NULLS LAST LIMIT 1",
                [module_ids, programme_id, programme, programme_id, programme, programme],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not resolve KSB profile source for %s / %s: %s", programme_id, programme, exc)
        return ""
    return _clean_ksb_profile_source_id(row[0]) if row else ""


def _fetch_ksb_items_from_profile_source(profile_source_id):
    profile_source_id = _clean_ksb_profile_source_id(profile_source_id)
    if not profile_source_id:
        return []
    try:
        # Savepointed: see the note above _fetch_ksb_items_for_programme.
        with transaction.atomic(using="enrolment"), connections["enrolment"].cursor() as cursor:
            cursor.execute(
                "SELECT ksb_items FROM curriculum.ksb_profiles "
                "WHERE is_active AND (id = %s OR ksb_profile_id = %s) "
                "ORDER BY updated_at DESC NULLS LAST LIMIT 1",
                [profile_source_id, profile_source_id],
            )
            row = cursor.fetchone()
    except DatabaseError as exc:
        logger.warning("Could not find KSB profile from source %s: %s", profile_source_id, exc)
        return []
    return _coerce_ksb_items(row[0]) if row else []


def _fetch_ksb_items(programme, training_plan=None):
    programme = _s(programme)
    programme_id = _resolve_programme_id(programme, training_plan=training_plan)
    if not programme and not programme_id:
        return []
    items = _fetch_ksb_items_for_programme(programme_id, programme)
    if items:
        return items
    profile_source_id = _resolve_ksb_profile_source_id(
        programme_id=programme_id,
        programme=programme,
        training_plan=training_plan,
    )
    if profile_source_id:
        items = _fetch_ksb_items_from_profile_source(profile_source_id)
        if items:
            return items
    items = _fetch_ksb_items_from_plan_mappings(
        programme_id=programme_id,
        programme=programme,
        training_plan=training_plan,
    )
    if items:
        return items
    return []


def refresh_learner_ksb_snapshot(learner, source, training_plan=None):
    plan = training_plan if training_plan is not None else get_training_plan(source)
    programme = getattr(source, "programme", None)
    items = _fetch_ksb_items(programme, training_plan=plan)
    if items:
        programme_id = _resolve_programme_id(programme, training_plan=plan)
        profile_source_id = _resolve_ksb_profile_source_id(
            programme_id=programme_id,
            programme=_s(programme),
            training_plan=plan,
        )
        replace_learner_ksbs(
            learner,
            items,
            source_profile_id=profile_source_id or programme_id or _s(programme),
        )
    return items


def sync_active_user(source):
    """Upsert one permanent learner and refresh authored plan/KSB child rows."""
    status = _s(getattr(source, "programme_status", ""))
    start_date, end_date = cohort_dates(
        getattr(source, "programme", None),
        getattr(source, "cohort", None),
    )
    defaults = {
        "full_name": _s(getattr(source, "username", ""))
        or _s(getattr(source, "email", ""))
        or f"Learner {source.id}",
        "email": _s(getattr(source, "email", "")) or f"learner-{source.id}@invalid.local",
        "phone_number": _s(getattr(source, "phone_number", "")),
        "lifecycle_status": "active" if status.lower() == ACTIVE_STATUS else status.lower() or "inactive",
        "programme": _s(getattr(source, "programme", "")),
        "programme_status": status,
        "cohort": _s(getattr(source, "cohort", "")),
        "group_name": _s(getattr(source, "group", "")),
        "start_date": start_date,
        "end_date": end_date,
        "gateway_review_date": end_date - timedelta(days=90) if end_date else None,
    }
    try:
        with transaction.atomic(using="enrolment"):
            source_email = _s(getattr(source, "email", "")).strip()
            # Prefer the explicit link; fall back to email for profiles created
            # before enrolment_id existed (see identity.learner_profile_for_source).
            learner = LearnerProfile.objects.filter(enrolment_id=source.id).first()
            if learner is None:
                learner = (
                    LearnerProfile.objects.filter(email__iexact=source_email).first()
                    if source_email
                    else LearnerProfile.objects.filter(pk=source.id).first()
                )
            # Whether found or about to be created, it belongs to this source row.
            defaults["enrolment_id"] = source.id
            # Carried across on every upsert so the profile never has to guess
            # which kind of learner it belongs to.
            defaults["learner_type"] = (
                _s(getattr(source, "learner_type", "")).lower() or None
            )
            # One identity across both phases: the profile takes the enrolment
            # row's uuid rather than minting its own. Without this the column
            # default would hand every promoted learner a second identifier and
            # re-open the split that apply_user_uuid closed. Guarded because the
            # column is nullable until that command has been run.
            source_uuid = getattr(source, "uuid", None)
            if source_uuid is not None:
                defaults["uuid"] = source_uuid
            # Keep the explicit programme link fresh, so curriculum can scope
            # this learner by id instead of by the programme *name* two
            # programmes can share. Only set when it resolves unambiguously:
            # an unresolvable sync must leave whatever link is already there
            # alone rather than blanking a correct one.
            training_plan = (
                hydrate_source_training_plan(source)
                if status.lower() == ACTIVE_STATUS
                else None
            )
            linkable_programme_id = _resolve_linkable_programme_id(
                defaults["programme"],
                training_plan=training_plan,
            )
            if linkable_programme_id:
                defaults["programme_id"] = linkable_programme_id
            if learner is None:
                # Never force the Created_users primary key into this table:
                # both sequences are independent after the learner-table merge.
                learner = LearnerProfile.objects.create(**defaults)
            else:
                for field, value in defaults.items():
                    setattr(learner, field, value)
                learner.save(update_fields=list(defaults))
            if status.lower() == ACTIVE_STATUS:
                replace_training_plan(learner, training_plan)
                refresh_learner_ksb_snapshot(learner, source, training_plan=training_plan)
        return learner if status.lower() == ACTIVE_STATUS else None
    except DatabaseError as exc:
        logger.warning("Could not sync learner %s: %s", source.id, exc)
        return None
