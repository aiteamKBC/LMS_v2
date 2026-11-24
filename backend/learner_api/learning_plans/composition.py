"""Concrete dependency wiring for the learning-plan capability.

Legacy compatibility names stay here so ``learner_api.learning_plan`` no
longer reaches into infrastructure directly while preserving its imports.
"""

from .application.effective_plan import effective_module_ids as select_effective_module_ids
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


def effective_module_ids(learner, preset_cache=None, *, saved_plan=...):
    """Composed effective-plan read using the existing preset infrastructure."""
    cache = request_preset_cache(learner) if preset_cache is None else preset_cache
    return select_effective_module_ids(
        learner,
        cache,
        read_inherited_module_ids=_preset_ids_for,
        saved_plan=saved_plan,
    )


def normalized_plan_snapshot(learner_id, *, using=None):
    """Read the existing normalized snapshot without introducing another reader."""
    from learner_api.training_plan_writes import training_plan_snapshot

    if using is None:
        return training_plan_snapshot(learner_id)
    return training_plan_snapshot(learner_id, using=using)


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
    "effective_module_ids",
    "group_module_ids_bulk",
    "normalized_plan_snapshot",
    "request_preset_cache",
]
