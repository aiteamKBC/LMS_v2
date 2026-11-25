"""Pure effective-plan selection rules.

The caller supplies inherited module IDs lazily so an explicit or deliberately
empty saved plan never performs a preset read.
"""

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass

from .stored_plan import clean_text


@dataclass(frozen=True)
class EffectivePlanSelection:
    """Ordered module IDs and the compatibility source of appended rows."""

    module_ids: tuple[str, ...]
    inherited_module_ids: tuple[str, ...]
    imported_module_ids: tuple[str, ...]
    has_saved_plan: bool


def effective_module_ids_from_state(
    saved_module_ids: Iterable[object],
    inherited_module_ids: Callable[[], Iterable[object]],
    *,
    has_saved_plan: bool,
    has_explicit_assignment: bool,
    saved_module_count: int | None = None,
) -> list[str]:
    """Select effective IDs from already interpreted plan state.

    ``saved_module_count`` lets narrowed readers retain the distinction between
    a truly empty saved plan and saved IDs outside their requested subset.
    """
    ids = [clean_text(value) for value in saved_module_ids if clean_text(value)]
    if not has_saved_plan:
        return list(inherited_module_ids())
    count = len(ids) if saved_module_count is None else saved_module_count
    if not count or has_explicit_assignment:
        return ids
    planned = set(ids)
    return ids + [value for value in inherited_module_ids() if value not in planned]


def effective_module_ids_from_plan(
    saved_plan: list[Mapping[str, object]] | None,
    inherited_module_ids: Callable[[], Iterable[object]],
) -> list[str]:
    """Apply the existing unsaved/empty/explicit/inherited plan policy."""
    return list(effective_plan_selection_from_plan(
        saved_plan,
        inherited_module_ids,
    ).module_ids)


def effective_plan_selection_from_plan(
    saved_plan: list[Mapping[str, object]] | None,
    inherited_module_ids: Callable[[], Iterable[object]],
    imported_module_ids: Callable[[], Iterable[object]] | None = None,
) -> EffectivePlanSelection:
    """Apply the one stored, inherited and optional imported selection policy.

    Imported subjects are a compatibility input used by Aptem learner plans.
    They remain additive for unsaved and non-explicit plans, including an empty
    imported plan, while an explicit assignment suppresses every addition.
    """
    if saved_plan is None:
        base_ids = list(inherited_module_ids())
        planned = set(base_ids)
        imported = tuple(
            value for value in (imported_module_ids() if imported_module_ids else ())
            if value not in planned
        )
        return EffectivePlanSelection(
            tuple([*base_ids, *imported]),
            (),
            imported,
            False,
        )

    ids = [
        clean_text(entry.get("moduleId"))
        for entry in saved_plan
        if clean_text(entry.get("moduleId"))
    ]
    explicit = any(
        entry.get("assignmentMode") == "explicit" for entry in saved_plan
    )
    planned = set(ids)
    inherited = tuple(
        value for value in inherited_module_ids() if value not in planned
    ) if ids and not explicit else ()
    planned.update(inherited)
    imported = tuple(
        value for value in (imported_module_ids() if imported_module_ids else ())
        if value not in planned
    ) if not explicit else ()
    return EffectivePlanSelection(
        tuple([*ids, *inherited, *imported]),
        inherited,
        imported,
        True,
    )
