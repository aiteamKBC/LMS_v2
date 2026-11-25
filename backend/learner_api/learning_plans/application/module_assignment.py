"""Module-side learning-plan orchestration over explicit dependencies."""


class ModuleAssignmentNotFound(LookupError):
    """The requested module is not in the active catalogue."""


class ModuleAssignmentInputError(ValueError):
    """The requested learner assignment cannot be applied."""


class ModuleAssignmentDatabaseFailure(Exception):
    """A database-backed dependency failed at a known compatibility stage."""

    def __init__(self, stage, original):
        super().__init__(str(original))
        self.stage = stage
        self.original = original


def resolve_module_assignment(module_id, *, read_all_modules, database_error_type):
    """Resolve the module before method dispatch, matching the legacy endpoint."""
    try:
        catalogue = {module["moduleId"]: module for module in read_all_modules()}
    except database_error_type as exc:
        raise ModuleAssignmentDatabaseFailure("catalogue", exc) from exc
    module = catalogue.get(module_id)
    if module is None:
        raise ModuleAssignmentNotFound(module_id)
    return module, catalogue


def read_module_assignment(
    module,
    *,
    read_learners,
    serialize_payload,
    database_error_type,
):
    """Read the existing module picker payload."""
    try:
        return serialize_payload(module, read_learners(), {})
    except database_error_type as exc:
        raise ModuleAssignmentDatabaseFailure("read", exc) from exc


def update_module_assignment(
    module,
    catalogue,
    assigned_ids,
    *,
    read_learners,
    read_plan_entries,
    effective_plan_ids,
    orphan_module,
    plan_field,
    save_plan,
    sync_mirror,
    advance_learner,
    serialize_payload,
    clean_text,
    database_error_type,
):
    """Apply the existing bulk module assignment and return its read-back payload."""
    module_id = module["moduleId"]
    try:
        learners = read_learners()
    except database_error_type as exc:
        raise ModuleAssignmentDatabaseFailure("read", exc) from exc

    known_ids = {str(learner.id) for learner in learners}
    unknown = sorted(assigned_ids - known_ids)
    if unknown:
        raise ModuleAssignmentInputError(
            f"Learner {unknown[0]} is not in the learner directory."
        )

    preset_cache = {}
    changed = 0
    for learner in learners:
        should_have = str(learner.id) in assigned_ids
        saved = read_plan_entries(learner)
        plan_ids = effective_plan_ids(learner, preset_cache)
        if should_have == (module_id in plan_ids):
            continue
        if should_have:
            plan_ids = [*plan_ids, module_id]
        else:
            plan_ids = [value for value in plan_ids if value != module_id]

        saved_by_id = {
            clean_text(entry.get("moduleId")): entry for entry in saved
        }
        resolved = []
        seen = set()
        explicit = any(entry.get("assignmentMode") == "explicit" for entry in saved)
        for plan_id in plan_ids:
            if not plan_id or plan_id in seen:
                continue
            seen.add(plan_id)
            resolved.append(
                dict(
                    catalogue.get(plan_id)
                    or orphan_module(saved_by_id.get(plan_id) or {"moduleId": plan_id}),
                    **({"assignmentMode": "explicit"} if explicit else {}),
                )
            )

        field = plan_field(learner)
        try:
            save_plan(learner, field, resolved)
        except database_error_type as exc:
            failure = ModuleAssignmentDatabaseFailure("save", exc)
            failure.learner_id = learner.id
            raise failure from exc
        sync_mirror(learner)
        advance_learner(learner)
        changed += 1

    try:
        payload = serialize_payload(module, read_learners(), {})
    except database_error_type as exc:
        raise ModuleAssignmentDatabaseFailure("read_back", exc) from exc
    return {**payload, "changedCount": changed}

