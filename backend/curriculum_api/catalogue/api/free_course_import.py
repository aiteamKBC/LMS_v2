"""Management-entry composition for the existing insert-only content importer."""
from ..application import free_course_import as use_cases
from ..domain import free_course_import as policy
from ..infrastructure import free_course_import_storage as storage
from curriculum_api.catalogue.infrastructure.structure_runtime import free_programme_module_response
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.authoring_composition import save_module_authoring_structure
from curriculum_api.catalogue.infrastructure.content_validation_runtime import validate_module_authoring_payload


def import_payloads(export):
    return policy.import_payloads(export, free_programme_module_response=free_programme_module_response)


def import_plan(export):
    return use_cases.import_plan(export, storage=storage, import_payloads=import_payloads,
                                validate_module_authoring_payload=validate_module_authoring_payload)


def import_content(export):
    return use_cases.import_content(export, storage=storage, import_plan=import_plan,
        save_module_authoring_structure=save_module_authoring_structure,
        get_authoring_structure_payload=get_authoring_structure_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache)
