"""Legacy learning-plan update orchestration over explicit dependencies."""


class LearningPlanInputError(ValueError):
    """The submitted module list does not satisfy the existing contract."""


class LearningPlanDatabaseFailure(Exception):
    """A database-backed dependency failed at a known compatibility stage."""

    def __init__(self, stage, original):
        super().__init__(str(original))
        self.stage = stage
        self.original = original


def update_learning_plan(
    learner,
    modules,
    *,
    clean_text,
    read_all_modules,
    read_plan_entries,
    read_programme_modules,
    read_group_module_ids,
    plan_field,
    save_plan,
    sync_mirror,
    advance_learner,
    database_error_type,
):
    """Resolve and persist the existing legacy plan, preserving all side effects."""
    try:
        catalogue = {module["moduleId"]: module for module in read_all_modules()}
    except database_error_type as exc:
        raise LearningPlanDatabaseFailure("catalogue", exc) from exc

    retained = {
        clean_text(module.get("moduleId")): module
        for module in read_plan_entries(learner)
        if clean_text(module.get("moduleId"))
    }
    resolved = []
    seen = set()
    for entry in modules:
        module_id = clean_text(entry.get("moduleId") if isinstance(entry, dict) else entry)
        if not module_id:
            raise LearningPlanInputError("Every module needs a moduleId.")
        if module_id in seen:
            continue
        if module_id not in catalogue and module_id not in retained:
            raise LearningPlanInputError(
                f"Module '{module_id}' is not in the module catalogue."
            )
        seen.add(module_id)
        resolved.append(dict(catalogue.get(module_id) or retained[module_id]))

    try:
        programme_catalogue = {
            module["moduleId"] for module in read_programme_modules(learner)
        }
    except database_error_type as exc:
        raise LearningPlanDatabaseFailure("programme_catalogue", exc) from exc
    inheritable = [
        module_id
        for module_id in read_group_module_ids(learner)
        if module_id in programme_catalogue
    ]
    if any(module_id not in seen for module_id in inheritable):
        resolved = [dict(entry, assignmentMode="explicit") for entry in resolved]

    field = plan_field(learner)
    try:
        save_plan(learner, field, resolved)
    except database_error_type as exc:
        raise LearningPlanDatabaseFailure("save", exc) from exc
    sync_mirror(learner)
    advance_learner(learner)
    return learner

