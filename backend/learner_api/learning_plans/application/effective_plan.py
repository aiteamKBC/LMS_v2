"""Coordinate effective-plan selection over explicit read dependencies."""

from learner_api.learning_plans.domain.effective_plan import (
    effective_module_ids_from_plan,
    effective_plan_selection_from_plan,
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


def effective_plan_projection(
    learner,
    preset_cache=None,
    *,
    read_stored_plan=stored_training_plan,
    read_fallback_plan,
    read_effective_module_ids,
):
    """Return stored plan entries enriched with newly inherited module IDs.

    Canonical hydrated plans already carry their complete projection and remain
    authoritative. For compatibility plans, retained snapshots keep all stored
    fields and newly inherited modules are appended as minimal ID-bearing rows.
    """
    if hasattr(learner, "_canonical_training_plan"):
        return list(learner._canonical_training_plan or [])

    saved = read_stored_plan(learner)
    plan = list(saved if saved is not None else (read_fallback_plan(learner) or []))
    effective_ids = read_effective_module_ids(
        learner,
        preset_cache if preset_cache is not None else {},
        saved_plan=saved,
    )
    represented = {
        str(entry.get("moduleId") or "").strip()
        for entry in plan
        if isinstance(entry, dict) and str(entry.get("moduleId") or "").strip()
    }
    return plan + [
        {"moduleId": module_id}
        for module_id in effective_ids
        if module_id not in represented
    ]


def legacy_plan_membership(
    saved_plan,
    inherited_module_ids,
    imported_module_ids,
):
    """Select legacy editor membership without assembling its HTTP payload."""
    return effective_plan_selection_from_plan(
        saved_plan,
        lambda: inherited_module_ids,
        imported_module_ids,
    )
