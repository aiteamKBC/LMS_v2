"""HTTP adapter for the active legacy Learning Plan endpoint."""

import json

from django.http import JsonResponse

from learner_api.learning_plans.application.read_plan import read_learning_plan
from learner_api.learning_plans.application.update_plan import (
    LearningPlanDatabaseFailure,
    LearningPlanInputError,
    update_learning_plan,
)


def learning_plan(request, pk, *, dependencies):
    """Preserve the existing GET/PATCH/PUT Learning Plan HTTP contract."""
    try:
        learner = dependencies.load_learner(pk)
    except dependencies.learner_not_found_error:
        return dependencies.error("Learner not found.", 404)
    except dependencies.database_error_type as exc:
        dependencies.logger.exception("learning_plan: lookup failed")
        return dependencies.error(f"Database error: {exc}", 502)

    if request.method == "GET":
        try:
            return JsonResponse(
                read_learning_plan(learner, serialize=dependencies.serialize)
            )
        except dependencies.database_error_type:
            dependencies.logger.exception("learning_plan: read failed")
            return dependencies.error("Could not read the learning plan.", 503)

    if request.method not in ("PATCH", "PUT"):
        return dependencies.error("Method not allowed.", 405)

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return dependencies.error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return dependencies.error("Request body must be a JSON object.", 400)
    modules = payload.get("modules")
    if not isinstance(modules, list):
        return dependencies.error("modules must be a list.", 400)

    if "freeCourses" in payload:
        assignment_error = dependencies.validate_free_courses(
            learner, payload.get("freeCourses")
        )
        if assignment_error is not None:
            return assignment_error

    try:
        update_learning_plan(
            learner,
            modules,
            clean_text=dependencies.clean_text,
            read_all_modules=dependencies.read_all_modules,
            read_plan_entries=dependencies.read_plan_entries,
            read_programme_modules=dependencies.read_programme_modules,
            read_group_module_ids=dependencies.read_group_module_ids,
            plan_field=dependencies.plan_field,
            save_plan=dependencies.save_plan,
            sync_mirror=dependencies.sync_mirror,
            advance_learner=dependencies.advance_learner,
            database_error_type=dependencies.database_error_type,
        )
    except LearningPlanInputError as exc:
        return dependencies.error(str(exc), 400)
    except LearningPlanDatabaseFailure as exc:
        log_messages = {
            "catalogue": "learning_plan: catalogue lookup failed",
            "programme_catalogue": "learning_plan: programme catalogue lookup failed",
            "save": "learning_plan: save failed",
        }
        dependencies.logger.exception(log_messages[exc.stage])
        return dependencies.error(f"Database error: {exc.original}", 502)
    return JsonResponse(
        read_learning_plan(learner, serialize=dependencies.serialize)
    )

