"""HTTP adapter for the staff module-to-learner assignment endpoint."""

import json

from django.http import JsonResponse

from learner_api.learning_plans.application.module_assignment import (
    ModuleAssignmentDatabaseFailure,
    ModuleAssignmentInputError,
    ModuleAssignmentNotFound,
    read_module_assignment,
    resolve_module_assignment,
    update_module_assignment,
)


def module_learners(request, module_id, *, dependencies):
    """Preserve the existing module membership GET/PATCH/PUT contract."""
    module_id = dependencies.clean_text(module_id)
    if not module_id:
        return dependencies.error("A module id is required.", 400)

    try:
        module, catalogue = resolve_module_assignment(
            module_id,
            read_all_modules=dependencies.read_all_modules,
            database_error_type=dependencies.database_error_type,
        )
    except ModuleAssignmentNotFound:
        return dependencies.error(
            f"Module {module_id} is not in the module catalogue.", 404
        )
    except ModuleAssignmentDatabaseFailure as exc:
        dependencies.logger.exception("module_learners: catalogue lookup failed")
        return dependencies.error(f"Database error: {exc.original}", 502)

    if request.method == "GET":
        try:
            payload = read_module_assignment(
                module,
                read_learners=dependencies.read_learners,
                serialize_payload=dependencies.serialize_payload,
                database_error_type=dependencies.database_error_type,
            )
            return JsonResponse(payload)
        except ModuleAssignmentDatabaseFailure as exc:
            dependencies.logger.exception("module_learners: read failed")
            return dependencies.error(f"Database error: {exc.original}", 502)

    if request.method not in ("PATCH", "PUT"):
        return dependencies.error("Method not allowed.", 405)
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return dependencies.error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return dependencies.error("Request body must be a JSON object.", 400)
    learner_ids = payload.get("learnerIds")
    if not isinstance(learner_ids, list):
        return dependencies.error("learnerIds must be a list.", 400)
    assigned_ids = {
        dependencies.clean_text(value)
        for value in learner_ids
        if dependencies.clean_text(value)
    }

    try:
        response_payload = update_module_assignment(
            module,
            catalogue,
            assigned_ids,
            read_learners=dependencies.read_learners,
            read_plan_entries=dependencies.read_plan_entries,
            effective_plan_ids=dependencies.effective_plan_ids,
            orphan_module=dependencies.orphan_module,
            plan_field=dependencies.plan_field,
            save_plan=dependencies.save_plan,
            sync_mirror=dependencies.sync_mirror,
            advance_learner=dependencies.advance_learner,
            serialize_payload=dependencies.serialize_payload,
            clean_text=dependencies.clean_text,
            database_error_type=dependencies.database_error_type,
        )
    except ModuleAssignmentInputError as exc:
        return dependencies.error(str(exc), 400)
    except ModuleAssignmentDatabaseFailure as exc:
        log_messages = {
            "read": "module_learners: read failed",
            "save": "module_learners: save failed",
            "read_back": "module_learners: read-back failed",
        }
        if exc.stage == "save":
            learner_id = getattr(exc, "learner_id", "")
            dependencies.logger.exception(
                "%s for learner %s",
                log_messages[exc.stage],
                learner_id,
            )
        else:
            dependencies.logger.exception(log_messages[exc.stage])
        return dependencies.error(f"Database error: {exc.original}", 502)
    return JsonResponse(response_payload)

