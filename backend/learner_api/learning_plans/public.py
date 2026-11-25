"""Supported cross-capability Learning Plan operations."""

from .application.module_membership import (
    module_member_enrolment_ids,
    module_member_enrolment_ids_by_module,
)
from .application.hydration import NORMALIZED_PLAN_PREFETCH
from .domain.effective_plan import effective_module_ids_from_state
from .domain.membership_policy import members_for_lineages
from .domain.stored_plan import clean_text, maybe_json, stored_training_plan


def effective_module_ids(learner, preset_cache=None, *, saved_plan=...):
    from .composition import effective_module_ids as implementation

    return implementation(learner, preset_cache, saved_plan=saved_plan)


def effective_plan_projection(learner, preset_cache=None):
    """Return the canonical or compatibility plan with inherited IDs appended."""
    from .composition import effective_plan_projection as implementation

    return implementation(learner, preset_cache)


def hydrate_normalized_plan(source, profile=None, *, profile_id=None):
    """Attach the complete normalized plan to an enrolment source."""
    from .composition import hydrate_normalized_plan as implementation

    return implementation(source, profile, profile_id=profile_id)


def hydrate_normalized_plan_modules(source, profile):
    """Attach the compact normalized module tree to an enrolment source."""
    from .composition import hydrate_normalized_plan_modules as implementation

    return implementation(source, profile)


def compatibility_plan_titles(plan):
    """Return the existing module/week/component title-column projection."""
    from .composition import compatibility_plan_titles as implementation

    return implementation(plan)


def synchronize_compatibility_plan(learner, *, strict=False):
    """Synchronize the existing compatibility plan projection."""
    from .composition import synchronize_compatibility_plan as implementation

    return implementation(learner, strict=strict)


def normalized_plan_snapshot(learner_id, *, using=None):
    from .composition import normalized_plan_snapshot as implementation

    return implementation(learner_id, using=using)


def write_normalized_plan(
    learner_id,
    requested_plan,
    *,
    authorization,
    expected_version=None,
    reorder=False,
    using="enrolment",
):
    """Apply a complete normalized plan through the canonical writer."""
    from .composition import write_normalized_plan as implementation

    return implementation(
        learner_id,
        requested_plan,
        authorization=authorization,
        expected_version=expected_version,
        reorder=reorder,
        using=using,
    )


def normalized_plan_authorization_for_learner(learner_id):
    """Return an opaque normalized-writer authorization for one learner."""
    from .composition import normalized_plan_authorization_for_learner as implementation

    return implementation(learner_id)


def normalized_plan_authorization_for_staff():
    """Return an opaque normalized-writer authorization for trusted staff."""
    from .composition import normalized_plan_authorization_for_staff as implementation

    return implementation()


def learner_membership_facts(
    module_ids, profile_ids=None, *, connection, table_exists, columns_for,
):
    from .infrastructure.membership_facts import learner_facts

    return learner_facts(
        module_ids,
        profile_ids,
        connection=connection,
        table_exists=table_exists,
        columns_for=columns_for,
    )


def normalized_plan_profile_for(learner, *, learner_profile_model=None):
    from .composition import normalized_plan_profile_for as implementation

    return implementation(learner, learner_profile_model=learner_profile_model)


def normalized_plan_has_rows(profile, *, plan_module_model=None):
    from .composition import normalized_plan_has_rows as implementation

    return implementation(profile, plan_module_model=plan_module_model)


def normalized_plan_has_module(profile, module_id, *, plan_module_model=None):
    from .composition import normalized_plan_has_module as implementation

    return implementation(
        profile,
        module_id,
        plan_module_model=plan_module_model,
    )


__all__ = [
    "NORMALIZED_PLAN_PREFETCH",
    "clean_text",
    "compatibility_plan_titles",
    "effective_module_ids",
    "effective_module_ids_from_state",
    "effective_plan_projection",
    "hydrate_normalized_plan",
    "hydrate_normalized_plan_modules",
    "learner_membership_facts",
    "maybe_json",
    "members_for_lineages",
    "module_member_enrolment_ids",
    "module_member_enrolment_ids_by_module",
    "normalized_plan_authorization_for_learner",
    "normalized_plan_authorization_for_staff",
    "normalized_plan_has_module",
    "normalized_plan_has_rows",
    "normalized_plan_profile_for",
    "normalized_plan_snapshot",
    "stored_training_plan",
    "synchronize_compatibility_plan",
    "write_normalized_plan",
]
