"""Coordinate effective-plan selection over explicit read dependencies."""

from learner_api.learning_plans.domain.effective_plan import (
    effective_module_ids_from_plan,
)
from learner_api.learning_plans.domain.stored_plan import stored_training_plan


def effective_module_ids(
    learner,
    preset_cache,
    *,
    read_inherited_module_ids,
    read_stored_plan=stored_training_plan,
    saved_plan=...,
):
    """Return effective IDs while preserving canonical-cache precedence."""
    if saved_plan is ... and hasattr(learner, "_canonical_training_plan"):
        saved = list(learner._canonical_training_plan or [])
    else:
        saved = read_stored_plan(learner) if saved_plan is ... else saved_plan
    return effective_module_ids_from_plan(
        saved,
        lambda: read_inherited_module_ids(learner, preset_cache),
    )
