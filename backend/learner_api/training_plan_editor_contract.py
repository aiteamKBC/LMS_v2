"""HTTP contract helpers for the canonical Training Plan Editor.

The normalized module/week/component assignments are the complete plan state.
There is no saved/unsaved metadata row, inheritance mode or assignment marker:
zero assigned modules means no Training Plan, and PATCH never accepts an empty
selection.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .training_plan_writes import (
    TrainingPlanAuthorizationError,
    TrainingPlanConflict,
    TrainingPlanValidationError,
    TrainingPlanWriteError,
)


@dataclass(frozen=True, slots=True)
class TrainingPlanEditorRequest:
    module_ids: tuple[str, ...]
    expected_plan_version: str


def _module_id(value: Any, *, index: int) -> str:
    raw = value.get("moduleId") if isinstance(value, Mapping) else value
    if raw is None or isinstance(raw, bool):
        raise TrainingPlanValidationError(
            "invalid_module_id",
            f"modules[{index}].moduleId must be a non-empty Curriculum identifier.",
        )
    module_id = str(raw).strip()
    if not module_id:
        raise TrainingPlanValidationError(
            "invalid_module_id",
            f"modules[{index}].moduleId must be a non-empty Curriculum identifier.",
        )
    return module_id


def parse_training_plan_editor_request(payload: Any) -> TrainingPlanEditorRequest:
    """Validate the future PATCH envelope without mutating or reading a plan."""

    if not isinstance(payload, Mapping):
        raise TrainingPlanValidationError(
            "invalid_request", "Request body must be a JSON object."
        )
    modules = payload.get("modules")
    if not isinstance(modules, list):
        raise TrainingPlanValidationError(
            "invalid_modules", "modules must be a list."
        )
    expected_version = payload.get("expectedPlanVersion")
    if not isinstance(expected_version, str) or not expected_version.strip():
        raise TrainingPlanValidationError(
            "expected_plan_version_required",
            "expectedPlanVersion is required. Reload the plan before saving.",
        )
    if len(expected_version) > 256:
        raise TrainingPlanValidationError(
            "invalid_plan_version", "expectedPlanVersion is not valid."
        )

    module_ids = tuple(_module_id(value, index=index) for index, value in enumerate(modules))
    if not module_ids:
        raise TrainingPlanValidationError(
            "empty_training_plan_not_allowed",
            "A Training Plan must contain at least one module.",
        )
    duplicates = sorted({module_id for module_id in module_ids if module_ids.count(module_id) > 1})
    if duplicates:
        raise TrainingPlanValidationError(
            "duplicate_module_assignment",
            "The request contains duplicate module assignments.",
            details={"moduleIds": duplicates},
        )
    return TrainingPlanEditorRequest(module_ids, expected_version.strip())


def training_plan_editor_error_status(error: TrainingPlanWriteError) -> int:
    """Stable HTTP mapping for the future adapter; no response is emitted here."""

    if isinstance(error, TrainingPlanAuthorizationError):
        return 403
    if isinstance(error, TrainingPlanConflict):
        return 409
    if isinstance(error, TrainingPlanValidationError):
        return 400
    return 500


__all__ = [
    "TrainingPlanEditorRequest",
    "parse_training_plan_editor_request",
    "training_plan_editor_error_status",
]
