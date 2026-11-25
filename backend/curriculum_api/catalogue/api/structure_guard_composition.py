"""Concrete catalogue / api / structure guard composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.infrastructure import free_course_pricing as free_course_pricing
from curriculum_api.catalogue.api.authoring_errors import StaleModuleStructureWrite
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.domain.attachment_content import payload_week_list
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.authoring_errors import ModuleStructureDeltaConflict
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.infrastructure.revision_runtime import module_structure_revision
from curriculum_api.course_pricing import pricing_values


def free_course_sale_values(payload, module_row, is_free_course):
    from curriculum_api.catalogue.application.content_preparation import free_course_sale_values as implementation
    return implementation(
        payload, module_row, is_free_course,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        free_course_pricing=free_course_pricing, pricing_values=pricing_values,
    )


def merge_partial_module_structure(stored, payload):
    from curriculum_api.catalogue.domain.structure_changes import merge_partial_module_structure as implementation
    return implementation(
        stored,
        payload,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        ModuleStructureDeltaConflict=ModuleStructureDeltaConflict,
    )


def locked_attachment_structure(item, catalogue_id):
    from curriculum_api.catalogue.application.hierarchy_commands import locked_attachment_structure as implementation
    return implementation(
        item, catalogue_id,
        StaleModuleStructureWrite=StaleModuleStructureWrite,
        authoring_module_exists=authoring_module_exists,
        clean_str=clean_str,
        get_authoring_structure_payload=get_authoring_structure_payload,
        lock_module_structure_row=lock_module_structure_row,
        module_structure_revision=module_structure_revision,
        payload_week_list=payload_week_list,
    )
