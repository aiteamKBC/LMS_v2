"""Pure effective-plan selection rules.

The caller supplies inherited module IDs lazily so an explicit or deliberately
empty saved plan never performs a preset read.
"""

from collections.abc import Callable, Iterable, Mapping

from .stored_plan import clean_text


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
    if saved_plan is None:
        return effective_module_ids_from_state(
            (), inherited_module_ids, has_saved_plan=False,
            has_explicit_assignment=False,
        )
    ids = [
        clean_text(entry.get("moduleId"))
        for entry in saved_plan
        if clean_text(entry.get("moduleId"))
    ]
    return effective_module_ids_from_state(
        ids,
        inherited_module_ids,
        has_saved_plan=True,
        has_explicit_assignment=any(
            entry.get("assignmentMode") == "explicit" for entry in saved_plan
        ),
    )
