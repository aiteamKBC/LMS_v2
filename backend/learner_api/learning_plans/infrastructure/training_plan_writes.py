"""Safe canonical learner training-plan reads and reconciliation.

Callers must supply an explicit authorization context and the complete desired
canonical plan for writes. The normalized plan tables are the only authority:
legacy JSON is never read here and is not part of the version fingerprint.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from typing import Any

from curriculum_api.models import (
    ModuleAuthoringComponent,
    ModuleAuthoringModule,
    ModuleAuthoringWeek,
)
from django.db import transaction

from learner_api.models import (
    LearnerProfile,
    LearnerProgressEntry,
    LearnerTrainingPlanComponent,
    LearnerTrainingPlanModule,
    LearnerTrainingPlanWeek,
)

DEFAULT_DATABASE_ALIAS = "enrolment"


class TrainingPlanWriteError(Exception):
    """Base domain error with a stable, endpoint-ready structured payload."""

    error_type = "training_plan_error"

    def __init__(self, code: str, message: str, *, details: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = dict(details or {})

    def as_dict(self) -> dict[str, Any]:
        return {
            "error": {
                "type": self.error_type,
                "code": self.code,
                "message": self.message,
                "details": self.details,
            }
        }


class TrainingPlanValidationError(TrainingPlanWriteError):
    error_type = "validation_error"


class TrainingPlanAuthorizationError(TrainingPlanWriteError):
    error_type = "authorization_error"


class TrainingPlanConflict(TrainingPlanWriteError):
    error_type = "conflict"


class TrainingPlanVersionConflict(TrainingPlanConflict):
    pass


class TrainingPlanDependencyConflict(TrainingPlanConflict):
    pass


class TrainingPlanReparentingConflict(TrainingPlanConflict):
    """Existing assignment placement differs from current Curriculum ownership."""


@dataclass(frozen=True, slots=True)
class TrainingPlanAuthorization:
    """Authorization already resolved by a future endpoint adapter.

    Learner callers are limited to their own canonical LearnerProfile ID.
    Trusted staff/service callers must opt into ``can_manage_all`` explicitly.
    This service never accepts an identity from the plan payload itself.
    """

    learner_id: int | None = None
    can_manage_all: bool = False

    @classmethod
    def for_learner(cls, learner_id: int) -> TrainingPlanAuthorization:
        return cls(learner_id=int(learner_id))

    @classmethod
    def for_staff(cls) -> TrainingPlanAuthorization:
        return cls(can_manage_all=True)

    def assert_can_manage(self, learner_id: int) -> None:
        if self.can_manage_all:
            return
        if self.learner_id is None or int(self.learner_id) != int(learner_id):
            raise TrainingPlanAuthorizationError(
                "learner_access_denied",
                "The caller is not authorized to modify this learner's training plan.",
                details={"learnerId": int(learner_id)},
            )


@dataclass(frozen=True, slots=True)
class _RequestedComponent:
    curriculum_id: str


@dataclass(frozen=True, slots=True)
class _RequestedWeek:
    curriculum_id: str
    components: tuple[_RequestedComponent, ...]


@dataclass(frozen=True, slots=True)
class _RequestedModule:
    curriculum_id: str
    weeks: tuple[_RequestedWeek, ...]


@dataclass(slots=True)
class _ChangeCounts:
    modules: Counter = field(default_factory=Counter)
    weeks: Counter = field(default_factory=Counter)
    components: Counter = field(default_factory=Counter)

    def record(self, entity: str, action: str, amount: int = 1) -> None:
        getattr(self, entity)[action] += amount

    def as_dict(self) -> dict[str, dict[str, int]]:
        return {
            entity: {action: int(counter.get(action, 0)) for action in ("created", "deleted", "moved")}
            for entity, counter in (
                ("modules", self.modules),
                ("weeks", self.weeks),
                ("components", self.components),
            )
        }


@dataclass(frozen=True, slots=True)
class TrainingPlanWriteResult:
    learner_id: int
    plan_version: str
    previous_plan_version: str
    changed: bool
    changes: dict[str, dict[str, int]]
    plan: tuple[dict[str, Any], ...]

    def as_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["learnerId"] = payload.pop("learner_id")
        payload["planVersion"] = payload.pop("plan_version")
        payload["previousPlanVersion"] = payload.pop("previous_plan_version")
        payload["plan"] = list(payload["plan"])
        return payload


@dataclass(frozen=True, slots=True)
class TrainingPlanSnapshot:
    """A read-only canonical hierarchy and its deterministic version."""

    learner_id: int
    plan_version: str
    plan: tuple[dict[str, Any], ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "learnerId": self.learner_id,
            "planVersion": self.plan_version,
            "plan": list(self.plan),
        }


def _canonical_id(value: Any, *, path: str) -> str:
    if value is None or isinstance(value, bool):
        raise TrainingPlanValidationError(
            "invalid_curriculum_id",
            f"{path} must be a non-empty Curriculum identifier.",
            details={"path": path},
        )
    normalized = str(value).strip()
    if not normalized:
        raise TrainingPlanValidationError(
            "invalid_curriculum_id",
            f"{path} must be a non-empty Curriculum identifier.",
            details={"path": path},
        )
    return normalized


def _list(value: Any, *, path: str) -> Sequence[Any]:
    if value is None:
        return ()
    if isinstance(value, (str, bytes, Mapping)) or not isinstance(value, Sequence):
        raise TrainingPlanValidationError(
            "invalid_plan_shape",
            f"{path} must be a list.",
            details={"path": path},
        )
    return value


def _mapping(value: Any, *, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TrainingPlanValidationError(
            "invalid_plan_shape",
            f"{path} must be an object.",
            details={"path": path},
        )
    return value


def _parse_plan(requested_plan: Any) -> tuple[_RequestedModule, ...]:
    modules: list[_RequestedModule] = []
    seen_modules: set[str] = set()
    seen_weeks: set[str] = set()
    seen_components: set[str] = set()

    for module_index, raw_module in enumerate(_list(requested_plan, path="plan")):
        module_path = f"plan[{module_index}]"
        module = _mapping(raw_module, path=module_path)
        module_id = _canonical_id(module.get("moduleId"), path=f"{module_path}.moduleId")
        if module_id in seen_modules:
            raise TrainingPlanValidationError(
                "duplicate_module_assignment",
                "A Curriculum module may only appear once in a learner plan.",
                details={"moduleId": module_id, "path": module_path},
            )
        seen_modules.add(module_id)

        weeks: list[_RequestedWeek] = []
        for week_index, raw_week in enumerate(_list(module.get("weeks", ()), path=f"{module_path}.weeks")):
            week_path = f"{module_path}.weeks[{week_index}]"
            week = _mapping(raw_week, path=week_path)
            week_id = _canonical_id(week.get("weekId"), path=f"{week_path}.weekId")
            if week_id in seen_weeks:
                raise TrainingPlanValidationError(
                    "duplicate_week_assignment",
                    "A Curriculum week may only appear once in a learner plan.",
                    details={"weekId": week_id, "path": week_path},
                )
            seen_weeks.add(week_id)

            components: list[_RequestedComponent] = []
            for component_index, raw_component in enumerate(
                _list(week.get("components", ()), path=f"{week_path}.components")
            ):
                component_path = f"{week_path}.components[{component_index}]"
                component = _mapping(raw_component, path=component_path)
                component_id = _canonical_id(
                    component.get("componentId"), path=f"{component_path}.componentId"
                )
                if component_id in seen_components:
                    raise TrainingPlanValidationError(
                        "duplicate_component_assignment",
                        "A Curriculum component may only appear once in a learner plan.",
                        details={"componentId": component_id, "path": component_path},
                    )
                seen_components.add(component_id)
                components.append(_RequestedComponent(component_id))
            weeks.append(_RequestedWeek(week_id, tuple(components)))
        modules.append(_RequestedModule(module_id, tuple(weeks)))
    return tuple(modules)


def _load_plan(learner_id: int, *, using: str, lock: bool):
    module_query = LearnerTrainingPlanModule._base_manager.using(using)
    if lock:
        module_query = module_query.select_for_update()
    modules = list(
        module_query
        .filter(learner_id=learner_id)
        .only("id", "learner_id", "position", "curriculum_module_id")
        .order_by("position", "id")
    )
    module_ids = [row.id for row in modules]
    week_query = LearnerTrainingPlanWeek._base_manager.using(using)
    if lock:
        week_query = week_query.select_for_update()
    weeks = list(
        week_query
        .filter(plan_module_id__in=module_ids)
        .only("id", "plan_module_id", "position", "curriculum_week_id")
        .order_by("position", "id")
    ) if module_ids else []
    week_ids = [row.id for row in weeks]
    component_query = LearnerTrainingPlanComponent._base_manager.using(using)
    if lock:
        component_query = component_query.select_for_update()
    components = list(
        component_query
        .filter(plan_week_id__in=week_ids)
        .only("id", "plan_week_id", "position", "curriculum_component_id")
        .order_by("position", "id")
    ) if week_ids else []
    return modules, weeks, components


def _load_locked_plan(learner_id: int, *, using: str):
    return _load_plan(learner_id, using=using, lock=True)


def _fingerprint(modules, weeks, components) -> str:
    weeks_by_module: dict[int, list[Any]] = defaultdict(list)
    components_by_week: dict[int, list[Any]] = defaultdict(list)
    for week in weeks:
        weeks_by_module[week.plan_module_id].append(week)
    for component in components:
        components_by_week[component.plan_week_id].append(component)

    canonical = []
    for module in sorted(modules, key=lambda row: (row.position, row.id)):
        module_value = {
            "id": module.id,
            "curriculumId": module.curriculum_module_id,
            "position": module.position,
            "weeks": [],
        }
        for week in sorted(weeks_by_module[module.id], key=lambda row: (row.position, row.id)):
            week_value = {
                "id": week.id,
                "curriculumId": week.curriculum_week_id,
                "position": week.position,
                "components": [],
            }
            for component in sorted(components_by_week[week.id], key=lambda row: (row.position, row.id)):
                week_value["components"].append(
                    {
                        "id": component.id,
                        "curriculumId": component.curriculum_component_id,
                        "position": component.position,
                    }
                )
            module_value["weeks"].append(week_value)
        canonical.append(module_value)
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return f"sha256:{hashlib.sha256(encoded.encode('utf-8')).hexdigest()}"


def empty_training_plan_version() -> str:
    """Return the stable token for a canonical plan containing zero modules."""

    return _fingerprint((), (), ())


def training_plan_snapshot(
    learner_id: int,
    *,
    using: str = DEFAULT_DATABASE_ALIAS,
) -> TrainingPlanSnapshot:
    """Read one plan solely from normalized assignments.

    The endpoint resolves learner ownership separately. A concurrent write can
    only make this token stale; PATCH then rejects it after acquiring the
    learner lock, so a mixed or older read cannot cause a lost update.
    """

    try:
        learner_id = int(learner_id)
    except (TypeError, ValueError) as exc:
        raise TrainingPlanValidationError(
            "invalid_learner_id", "learner_id must be an integer."
        ) from exc
    modules, weeks, components = _load_plan(learner_id, using=using, lock=False)
    return TrainingPlanSnapshot(
        learner_id=learner_id,
        plan_version=_fingerprint(modules, weeks, components),
        plan=_plan_projection(modules, weeks, components),
    )


def _index_unique(rows, key_name: str, *, entity: str):
    indexed = {}
    duplicates = []
    for row in rows:
        key = getattr(row, key_name)
        if key in indexed:
            duplicates.append(key)
        else:
            indexed[key] = row
    if duplicates:
        raise TrainingPlanConflict(
            "ambiguous_existing_plan",
            "The existing plan contains duplicate canonical assignments and cannot be reconciled safely.",
            details={"entity": entity, "curriculumIds": sorted(str(value) for value in set(duplicates))},
        )
    return indexed


def _validate_curriculum(requested: tuple[_RequestedModule, ...], *, using: str) -> None:
    module_ids = {module.curriculum_id for module in requested}
    week_ids = {week.curriculum_id for module in requested for week in module.weeks}
    component_ids = {
        component.curriculum_id
        for module in requested
        for week in module.weeks
        for component in week.components
    }

    modules = ModuleAuthoringModule.objects.using(using).in_bulk(module_ids)
    weeks = ModuleAuthoringWeek.objects.using(using).in_bulk(week_ids)
    components = ModuleAuthoringComponent.objects.using(using).in_bulk(component_ids)

    missing_modules = sorted(module_ids.difference(modules))
    missing_weeks = sorted(week_ids.difference(weeks))
    missing_components = sorted(component_ids.difference(components))
    if missing_modules or missing_weeks or missing_components:
        raise TrainingPlanValidationError(
            "unknown_curriculum_assignment",
            "One or more requested Curriculum records do not exist.",
            details={
                "moduleIds": missing_modules,
                "weekIds": missing_weeks,
                "componentIds": missing_components,
            },
        )

    hierarchy_errors = []
    for module in requested:
        for week in module.weeks:
            canonical_week = weeks[week.curriculum_id]
            if canonical_week.module_catalogue_id != module.curriculum_id:
                hierarchy_errors.append(
                    {
                        "entity": "week",
                        "weekId": week.curriculum_id,
                        "expectedModuleId": canonical_week.module_catalogue_id,
                        "requestedModuleId": module.curriculum_id,
                    }
                )
            for component in week.components:
                canonical_component = components[component.curriculum_id]
                if (
                    canonical_component.week_id != week.curriculum_id
                    or canonical_component.module_catalogue_id != module.curriculum_id
                ):
                    hierarchy_errors.append(
                        {
                            "entity": "component",
                            "componentId": component.curriculum_id,
                            "expectedWeekId": canonical_component.week_id,
                            "requestedWeekId": week.curriculum_id,
                            "expectedModuleId": canonical_component.module_catalogue_id,
                            "requestedModuleId": module.curriculum_id,
                        }
                    )
    if hierarchy_errors:
        raise TrainingPlanValidationError(
            "invalid_curriculum_hierarchy",
            "The requested Curriculum hierarchy is invalid.",
            details={"relationships": hierarchy_errors},
        )


def _historical_reparenting_conflicts(
    modules,
    weeks,
    components,
    *,
    using: str,
) -> list[dict[str, Any]]:
    """Return existing plan rows whose stored parent is now historical.

    Curriculum authors may move a component after a learner plan was assigned.
    The plan-component row is historical learner state: a normal full-plan save
    must not reinterpret that Curriculum edit as permission to delete/recreate
    the assignment under its new week.  New assignments are still checked by
    ``_validate_curriculum`` against the current hierarchy.
    """

    curriculum_ids = {
        component.curriculum_component_id
        for component in components
        if component.curriculum_component_id
    }
    if not curriculum_ids:
        return []

    # Do not materialize the component model here: curriculum.components also
    # carries large JSON/content columns, and a long learner plan can otherwise
    # exceed the request statement timeout merely to compare three identifiers.
    canonical = {
        component_id: (week_id, module_id, status)
        for component_id, week_id, module_id, status in (
            ModuleAuthoringComponent._base_manager.using(using)
            .filter(pk__in=curriculum_ids)
            .values_list("id", "week_id", "module_catalogue_id", "status")
        )
    }
    modules_by_id = {module.id: module for module in modules}
    weeks_by_id = {week.id: week for week in weeks}
    conflicts = []
    for component in components:
        current = canonical.get(component.curriculum_component_id)
        plan_week = weeks_by_id.get(component.plan_week_id)
        plan_module = (
            modules_by_id.get(plan_week.plan_module_id)
            if plan_week is not None
            else None
        )
        if current is None or plan_week is None or plan_module is None:
            continue
        if (
            current[0] == plan_week.curriculum_week_id
            and current[1] == plan_module.curriculum_module_id
        ):
            continue
        conflicts.append({
            "planComponentId": component.id,
            "curriculumComponentId": component.curriculum_component_id,
            "assignedWeekId": plan_week.curriculum_week_id,
            "currentWeekId": current[0],
            "assignedModuleId": plan_module.curriculum_module_id,
            "currentModuleId": current[1],
            "curriculumStatus": current[2],
        })
    return conflicts


def _reject_implicit_reparenting(modules, weeks, components, *, using: str) -> None:
    conflicts = _historical_reparenting_conflicts(
        modules, weeks, components, using=using
    )
    if not conflicts:
        return
    raise TrainingPlanReparentingConflict(
        "historical_component_reparenting",
        "The existing Training Plan contains historical component placement "
        "that requires a separately authorized re-parenting operation.",
        details={
            "planComponentCount": len(conflicts),
            "relationships": conflicts[:50],
            "relationshipsTruncated": len(conflicts) > 50,
            "implicitMutationBlocked": True,
        },
    )


def _plan_projection(modules, weeks, components) -> tuple[dict[str, Any], ...]:
    weeks_by_module: dict[int, list[Any]] = defaultdict(list)
    components_by_week: dict[int, list[Any]] = defaultdict(list)
    for week in weeks:
        weeks_by_module[week.plan_module_id].append(week)
    for component in components:
        components_by_week[component.plan_week_id].append(component)
    return tuple(
        {
            "id": module.id,
            "moduleId": module.curriculum_module_id,
            "position": module.position,
            "weeks": [
                {
                    "id": week.id,
                    "weekId": week.curriculum_week_id,
                    "position": week.position,
                    "components": [
                        {
                            "id": component.id,
                            "componentId": component.curriculum_component_id,
                            "position": component.position,
                        }
                        for component in sorted(
                            components_by_week[week.id], key=lambda row: (row.position, row.id)
                        )
                    ],
                }
                for week in sorted(weeks_by_module[module.id], key=lambda row: (row.position, row.id))
            ],
        }
        for module in sorted(modules, key=lambda row: (row.position, row.id))
    )


def _temporary_base(rows, desired_count: int) -> int:
    maximum = max((row.position for row in rows), default=0)
    return maximum + len(rows) + desired_count + 1024


def _place_rows(
    *,
    model,
    existing_by_curriculum: Mapping[str, Any],
    desired_ids: Sequence[str],
    parent_field: str,
    parent_id: int,
    curriculum_field: str,
    reorder: bool,
    using: str,
    counts: _ChangeCounts,
    count_entity: str,
):
    existing = list(existing_by_curriculum.values())
    desired_rows = []
    if reorder:
        already_ordered = [existing_by_curriculum.get(value) for value in desired_ids]
        if all(row is not None for row in already_ordered) and all(
            row.position == expected
            for expected, row in enumerate(already_ordered, start=1)
        ):
            return already_ordered

        original_positions = {row.id: row.position for row in existing}
        temporary = _temporary_base(existing, len(desired_ids))
        changed_existing = []
        for offset, row in enumerate(existing):
            row.position = temporary + offset
            changed_existing.append(row)
        if changed_existing:
            model._base_manager.using(using).bulk_update(changed_existing, ["position"])

        for index, curriculum_id in enumerate(desired_ids):
            row = existing_by_curriculum.get(curriculum_id)
            if row is None:
                row = model(
                    **{
                        parent_field: parent_id,
                        curriculum_field: curriculum_id,
                        "position": temporary + len(existing) + index,
                    }
                )
                row.save(using=using, force_insert=True)
                counts.record(count_entity, "created")
            desired_rows.append(row)

        moved = []
        for final_position, row in enumerate(desired_rows, start=1):
            if row.id in original_positions and original_positions[row.id] != final_position:
                counts.record(count_entity, "moved")
            row.position = final_position
            moved.append(row)
        if moved:
            model._base_manager.using(using).bulk_update(moved, ["position"])
        return desired_rows

    next_position = max((row.position for row in existing), default=0) + 1
    for curriculum_id in desired_ids:
        row = existing_by_curriculum.get(curriculum_id)
        if row is None:
            row = model(
                **{
                    parent_field: parent_id,
                    curriculum_field: curriculum_id,
                    "position": next_position,
                }
            )
            row.save(using=using, force_insert=True)
            next_position += 1
            counts.record(count_entity, "created")
        desired_rows.append(row)
    return desired_rows


def reconcile_training_plan(
    learner_id: int,
    requested_plan: Any,
    *,
    authorization: TrainingPlanAuthorization,
    expected_version: str | None = None,
    reorder: bool = False,
    using: str = DEFAULT_DATABASE_ALIAS,
) -> TrainingPlanWriteResult:
    """Reconcile one learner's normalized plan without rebuilding unchanged rows.

    ``requested_plan`` is the complete desired tree using the existing API keys
    ``moduleId``, ``weekId`` and ``componentId``.  List order is applied only
    when ``reorder=True``; otherwise every retained row keeps its stored
    position and new rows append after the historical maximum.
    """

    if not isinstance(authorization, TrainingPlanAuthorization):
        raise TrainingPlanAuthorizationError(
            "authorization_required",
            "An explicit TrainingPlanAuthorization is required.",
        )
    try:
        learner_id = int(learner_id)
    except (TypeError, ValueError) as exc:
        raise TrainingPlanValidationError(
            "invalid_learner_id", "learner_id must be an integer."
        ) from exc
    authorization.assert_can_manage(learner_id)
    requested = _parse_plan(requested_plan)

    with transaction.atomic(using=using):
        learner = (
            LearnerProfile._base_manager.using(using)
            .select_for_update()
            .only("id")
            .filter(pk=learner_id)
            .first()
        )
        if learner is None:
            raise TrainingPlanValidationError(
                "learner_not_found",
                "The learner does not exist.",
                details={"learnerId": learner_id},
            )

        current_modules, current_weeks, current_components = _load_locked_plan(
            learner_id, using=using
        )
        previous_version = _fingerprint(current_modules, current_weeks, current_components)
        if expected_version is not None and expected_version != previous_version:
            raise TrainingPlanVersionConflict(
                "stale_plan_version",
                "The training plan changed after it was read.",
                details={
                    "expectedPlanVersion": expected_version,
                    "currentPlanVersion": previous_version,
                },
            )

        _reject_implicit_reparenting(
            current_modules,
            current_weeks,
            current_components,
            using=using,
        )
        _validate_curriculum(requested, using=using)

        weeks_by_module: dict[int, list[Any]] = defaultdict(list)
        components_by_week: dict[int, list[Any]] = defaultdict(list)
        for week in current_weeks:
            weeks_by_module[week.plan_module_id].append(week)
        for component in current_components:
            components_by_week[component.plan_week_id].append(component)

        modules_by_curriculum = _index_unique(
            current_modules, "curriculum_module_id", entity="module"
        )
        requested_module_ids = [module.curriculum_id for module in requested]
        requested_module_set = set(requested_module_ids)
        removed_modules = [
            module for module in current_modules
            if module.curriculum_module_id not in requested_module_set
        ]

        removed_weeks: list[Any] = []
        removed_components: list[Any] = []
        requested_weeks_by_module: dict[str, _RequestedModule] = {
            module.curriculum_id: module for module in requested
        }
        for module in current_modules:
            module_weeks = weeks_by_module[module.id]
            _index_unique(module_weeks, "curriculum_week_id", entity="week")
            for existing_week in module_weeks:
                _index_unique(
                    components_by_week[existing_week.id],
                    "curriculum_component_id",
                    entity="component",
                )
            if module in removed_modules:
                removed_weeks.extend(module_weeks)
                for week in module_weeks:
                    removed_components.extend(components_by_week[week.id])
                continue
            requested_module = requested_weeks_by_module[module.curriculum_module_id]
            week_index = _index_unique(module_weeks, "curriculum_week_id", entity="week")
            desired_week_ids = {week.curriculum_id for week in requested_module.weeks}
            for week in module_weeks:
                if week.curriculum_week_id not in desired_week_ids:
                    removed_weeks.append(week)
                    removed_components.extend(components_by_week[week.id])
                    continue
                requested_week = next(
                    item for item in requested_module.weeks
                    if item.curriculum_id == week.curriculum_week_id
                )
                component_index = _index_unique(
                    components_by_week[week.id], "curriculum_component_id", entity="component"
                )
                desired_component_ids = {
                    component.curriculum_id for component in requested_week.components
                }
                removed_components.extend(
                    component for component in component_index.values()
                    if component.curriculum_component_id not in desired_component_ids
                )

        removed_component_ids = sorted({row.id for row in removed_components})
        if removed_component_ids:
            dependency_rows = list(
                LearnerProgressEntry._base_manager.using(using)
                .filter(plan_component_id__in=removed_component_ids)
                .values("plan_component_id")
                .order_by()
            )
            if dependency_rows:
                by_component = Counter(
                    row["plan_component_id"] for row in dependency_rows
                )
                raise TrainingPlanDependencyConflict(
                    "historical_progress_dependency",
                    "The requested removal would detach historical learner progress.",
                    details={
                        "progressCount": len(dependency_rows),
                        "planComponentCount": len(by_component),
                        "dependencies": [
                            {"planComponentId": component_id, "progressCount": count}
                            for component_id, count in sorted(by_component.items())
                        ],
                        "requestedRemoval": {
                            "moduleCount": len(removed_modules),
                            "weekCount": len({row.id for row in removed_weeks}),
                            "componentCount": len(removed_component_ids),
                        },
                    },
                )

        counts = _ChangeCounts()
        if removed_component_ids:
            LearnerTrainingPlanComponent._base_manager.using(using).filter(
                id__in=removed_component_ids
            ).delete()
            counts.record("components", "deleted", len(removed_component_ids))
        removed_week_ids = sorted({row.id for row in removed_weeks})
        if removed_week_ids:
            LearnerTrainingPlanWeek._base_manager.using(using).filter(
                id__in=removed_week_ids
            ).delete()
            counts.record("weeks", "deleted", len(removed_week_ids))
        removed_module_ids = sorted({row.id for row in removed_modules})
        if removed_module_ids:
            LearnerTrainingPlanModule._base_manager.using(using).filter(
                id__in=removed_module_ids
            ).delete()
            counts.record("modules", "deleted", len(removed_module_ids))

        retained_modules = {
            key: value for key, value in modules_by_curriculum.items()
            if value.id not in set(removed_module_ids)
        }
        plan_modules = _place_rows(
            model=LearnerTrainingPlanModule,
            existing_by_curriculum=retained_modules,
            desired_ids=requested_module_ids,
            parent_field="learner_id",
            parent_id=learner_id,
            curriculum_field="curriculum_module_id",
            reorder=bool(reorder),
            using=using,
            counts=counts,
            count_entity="modules",
        )

        for requested_module, plan_module in zip(requested, plan_modules, strict=True):
            current_module_weeks = [
                week for week in weeks_by_module.get(plan_module.id, [])
                if week.id not in set(removed_week_ids)
            ]
            week_index = _index_unique(
                current_module_weeks, "curriculum_week_id", entity="week"
            )
            desired_week_ids = [week.curriculum_id for week in requested_module.weeks]
            plan_weeks = _place_rows(
                model=LearnerTrainingPlanWeek,
                existing_by_curriculum=week_index,
                desired_ids=desired_week_ids,
                parent_field="plan_module_id",
                parent_id=plan_module.id,
                curriculum_field="curriculum_week_id",
                reorder=bool(reorder),
                using=using,
                counts=counts,
                count_entity="weeks",
            )
            for requested_week, plan_week in zip(requested_module.weeks, plan_weeks, strict=True):
                current_week_components = [
                    component for component in components_by_week.get(plan_week.id, [])
                    if component.id not in set(removed_component_ids)
                ]
                component_index = _index_unique(
                    current_week_components, "curriculum_component_id", entity="component"
                )
                desired_component_ids = [
                    component.curriculum_id for component in requested_week.components
                ]
                _place_rows(
                    model=LearnerTrainingPlanComponent,
                    existing_by_curriculum=component_index,
                    desired_ids=desired_component_ids,
                    parent_field="plan_week_id",
                    parent_id=plan_week.id,
                    curriculum_field="curriculum_component_id",
                    reorder=bool(reorder),
                    using=using,
                    counts=counts,
                    count_entity="components",
                )

        final_modules, final_weeks, final_components = _load_locked_plan(learner_id, using=using)
        plan_version = _fingerprint(final_modules, final_weeks, final_components)
        change_payload = counts.as_dict()
        changed = any(
            value
            for entity in change_payload.values()
            for value in entity.values()
        )
        return TrainingPlanWriteResult(
            learner_id=learner_id,
            plan_version=plan_version,
            previous_plan_version=previous_version,
            changed=changed,
            changes=change_payload,
            plan=_plan_projection(final_modules, final_weeks, final_components),
        )


__all__ = [
    "TrainingPlanAuthorization",
    "TrainingPlanAuthorizationError",
    "TrainingPlanConflict",
    "TrainingPlanDependencyConflict",
    "TrainingPlanReparentingConflict",
    "TrainingPlanSnapshot",
    "TrainingPlanValidationError",
    "TrainingPlanVersionConflict",
    "TrainingPlanWriteError",
    "TrainingPlanWriteResult",
    "empty_training_plan_version",
    "reconcile_training_plan",
    "training_plan_snapshot",
]
