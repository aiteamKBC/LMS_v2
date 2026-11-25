"""Concrete dependency wiring for the learning-plan capability.

Legacy compatibility names stay here so ``learner_api.learning_plan`` no
longer reaches into infrastructure directly while preserving its imports.
"""

from types import SimpleNamespace

from .application.effective_plan import (
    effective_module_ids as select_effective_module_ids,
)
from .application.effective_plan import (
    effective_plan_projection as project_effective_plan,
    legacy_plan_membership as select_legacy_plan_membership,
)
from .application.hydration import (
    hydrate_normalized_plan as execute_plan_hydration,
)
from .application.hydration import (
    hydrate_normalized_plan_modules as execute_module_hydration,
)
from .application.write_plan import write_normalized_plan as execute_plan_write
from .infrastructure.assignment_reads import (
    GROUP_PRESET_BULK_SQL,
    GROUP_PRESET_BY_ID_SQL,
    GROUP_PRESET_SOURCE,
    GROUP_PRESET_SQL,
    _effective_plan_ids,
    _group_module_ids,
    _group_preset_rows,
    _manual_roster_module_ids,
    _module_ids_from_column,
    _preset_ids_for,
    _rows,
    group_module_ids_bulk,
    request_preset_cache,
)
from .infrastructure.legacy_plan_reads import load_enrolment_learner
from .infrastructure.legacy_plan_writes import save_legacy_plan
from .infrastructure.plan_hydration import (
    read_normalized_plan,
    read_normalized_plan_modules,
)


def effective_module_ids(learner, preset_cache=None, *, saved_plan=...):
    """Composed effective-plan read using the existing preset infrastructure."""
    cache = request_preset_cache(learner) if preset_cache is None else preset_cache
    return select_effective_module_ids(
        learner,
        cache,
        read_inherited_module_ids=_preset_ids_for,
        saved_plan=saved_plan,
    )


def effective_plan_projection(learner, preset_cache=None):
    """Compose the enriched plan projection from existing canonical readers."""
    from learner_api.mappers import get_training_plan

    return project_effective_plan(
        learner,
        preset_cache,
        read_fallback_plan=get_training_plan,
        read_effective_module_ids=effective_module_ids,
    )


def legacy_effective_plan_projection(learner, preset_cache, compatibility):
    """Preserve live root-module patches for the compatibility entry point."""
    return project_effective_plan(
        learner,
        preset_cache,
        read_stored_plan=compatibility.stored_training_plan,
        read_fallback_plan=compatibility.get_training_plan,
        read_effective_module_ids=compatibility._effective_plan_ids,
    )


def legacy_plan_membership(saved_plan, inherited_module_ids, imported_module_ids):
    """Select legacy payload membership through the canonical domain policy."""
    return select_legacy_plan_membership(
        saved_plan,
        inherited_module_ids,
        imported_module_ids,
    )


def hydrate_normalized_plan(source, profile=None, *, profile_id=None):
    """Hydrate the complete normalized plan through its concrete ORM reader."""
    return execute_plan_hydration(
        source,
        profile,
        profile_id=profile_id,
        read_plan=read_normalized_plan,
    )


def hydrate_normalized_plan_modules(source, profile):
    """Hydrate the compact normalized plan through its concrete SQL reader."""
    return execute_module_hydration(
        source,
        profile,
        read_plan=read_normalized_plan_modules,
    )


def compatibility_plan_titles(plan):
    """Expose the existing legacy title-column projection without copying it."""
    from learner_api import learning_plan as compatibility

    return compatibility._plan_titles(plan)


def synchronize_compatibility_plan(learner, *, strict=False):
    """Run the existing legacy-to-normalized projection writer."""
    from learner_api import learning_plan as compatibility

    return compatibility.sync_learning_plan_mirror(learner, strict=strict)


def normalized_plan_snapshot(learner_id, *, using=None):
    """Read the existing normalized snapshot without introducing another reader."""
    from .infrastructure.training_plan_writes import training_plan_snapshot

    if using is None:
        return training_plan_snapshot(learner_id)
    return training_plan_snapshot(learner_id, using=using)


def normalized_plan_profile_for(learner, *, learner_profile_model=None):
    """Resolve normalized ownership without requiring consumers to import ORM."""
    from learner_api.models import LearnerProfile

    from .infrastructure.plan_reads import profile_for

    return profile_for(
        learner,
        LearnerProfile=learner_profile_model or LearnerProfile,
    )


def normalized_plan_has_rows(profile, *, plan_module_model=None):
    """Return whether the normalized owner has any plan modules."""
    from learner_api.models import LearnerTrainingPlanModule

    from .infrastructure.plan_reads import has_plan_rows

    return has_plan_rows(
        profile,
        LearnerTrainingPlanModule=plan_module_model or LearnerTrainingPlanModule,
    )


def normalized_plan_has_module(profile, module_id, *, plan_module_model=None):
    """Return whether the normalized owner contains one Curriculum module."""
    from learner_api.models import LearnerTrainingPlanModule

    from .infrastructure.plan_reads import has_module_row

    return has_module_row(
        profile,
        module_id,
        LearnerTrainingPlanModule=plan_module_model or LearnerTrainingPlanModule,
    )


def write_normalized_plan(
    learner_id,
    requested_plan,
    *,
    authorization,
    expected_version=None,
    reorder=False,
    using="enrolment",
):
    """Wire the supported write use case to the single infrastructure writer."""
    from .infrastructure.training_plan_writes import reconcile_training_plan

    return execute_plan_write(
        learner_id,
        requested_plan,
        authorization=authorization,
        reconcile=reconcile_training_plan,
        expected_version=expected_version,
        reorder=reorder,
        using=using,
    )


def normalized_plan_authorization_for_learner(learner_id):
    """Build the writer's opaque self-service authorization context."""
    from .infrastructure.training_plan_writes import TrainingPlanAuthorization

    return TrainingPlanAuthorization.for_learner(learner_id)


def normalized_plan_authorization_for_staff():
    """Build the writer's opaque trusted-staff authorization context."""
    from .infrastructure.training_plan_writes import TrainingPlanAuthorization

    return TrainingPlanAuthorization.for_staff()


def legacy_http_dependencies(compatibility):
    """Wire extracted HTTP use cases to the live root compatibility namespace.

    Looking up patched root attributes when each request begins preserves the
    existing test and consumer monkey-patch contract while keeping the new
    capability layers independent of ``learner_api.learning_plan``.
    """
    return SimpleNamespace(
        load_learner=lambda pk: load_enrolment_learner(
            compatibility.EnrolmentUser, pk
        ),
        learner_not_found_error=compatibility.EnrolmentUser.DoesNotExist,
        database_error_type=compatibility.DatabaseError,
        logger=compatibility.logger,
        error=compatibility._error,
        clean_text=compatibility._s,
        serialize=compatibility._legacy_serialize,
        validate_free_courses=compatibility._validate_free_course_assignment_snapshot,
        read_all_modules=compatibility._all_modules,
        read_plan_entries=compatibility._plan_entries,
        read_programme_modules=compatibility.learner_programme_modules,
        read_group_module_ids=compatibility.learner_group_module_ids,
        plan_field=compatibility._plan_field,
        save_plan=save_legacy_plan,
        sync_mirror=compatibility.sync_learning_plan_mirror,
        advance_learner=compatibility.advance_learner,
        read_learners=compatibility._picker_learners,
        effective_plan_ids=compatibility._effective_plan_ids,
        orphan_module=compatibility._orphan_module,
        serialize_payload=compatibility._module_learners_payload,
    )


__all__ = [
    "GROUP_PRESET_BULK_SQL",
    "GROUP_PRESET_BY_ID_SQL",
    "GROUP_PRESET_SOURCE",
    "GROUP_PRESET_SQL",
    "_effective_plan_ids",
    "_group_module_ids",
    "_group_preset_rows",
    "_manual_roster_module_ids",
    "_module_ids_from_column",
    "_preset_ids_for",
    "_rows",
    "compatibility_plan_titles",
    "effective_module_ids",
    "effective_plan_projection",
    "group_module_ids_bulk",
    "hydrate_normalized_plan",
    "hydrate_normalized_plan_modules",
    "legacy_effective_plan_projection",
    "legacy_http_dependencies",
    "legacy_plan_membership",
    "normalized_plan_authorization_for_learner",
    "normalized_plan_authorization_for_staff",
    "normalized_plan_has_module",
    "normalized_plan_has_rows",
    "normalized_plan_profile_for",
    "normalized_plan_snapshot",
    "request_preset_cache",
    "synchronize_compatibility_plan",
    "write_normalized_plan",
]
