"""Concrete catalogue / infrastructure / content validation runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import archive_state
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.component_settings import CONTENT_AUTHORING_STATUSES
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.component_composition import validate_ksb_mapping_payload
from curriculum_api.catalogue.infrastructure.content_runtime import validate_mapping_duplicates
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.media_runtime import component_uploaded_video_url
from curriculum_api.catalogue.infrastructure.record_identity import canonical_authoring_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_module_catalogue_id
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule


def validate_component_authoring_payload(component, path):
    from curriculum_api.catalogue.application.content_validation import validate_component_authoring_payload as implementation

    def stored_video_path(value):
        from curriculum_api.catalogue.infrastructure.video_paths import stored_video_path as read
        return read(value)
    return implementation(
        component,
        path,
        CONTENT_AUTHORING_STATUSES=CONTENT_AUTHORING_STATUSES,
        component_uploaded_video_url=component_uploaded_video_url,
        stored_video_path=stored_video_path,
    )


def validate_module_authoring_payload(payload):
    from curriculum_api.catalogue.application.content_validation import validate_module_authoring_payload as implementation

    def read_policy(value):
        from curriculum_api.calendar_policy import read_policy as read
        return read(value)
    return implementation(
        payload,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        read_policy=read_policy,
        validate_component_authoring_payload=validate_component_authoring_payload,
        validate_ksb_mapping_payload=validate_ksb_mapping_payload,
        validate_mapping_duplicates=validate_mapping_duplicates,
    )


def component_context_for_payload(payload):
    from curriculum_api.catalogue.application.component_authoring import component_context_for_payload as implementation

    def retained_live_component_ids(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.free_course_policy_reads import retained_live_component_ids as operation
        return operation(*args, **kwargs)
    return implementation(
        payload,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        archive_state=archive_state,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_exists=authoring_module_exists,
        authoring_upsert=authoring_upsert,
        canonical_authoring_id=canonical_authoring_id,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        json_db_value=json_db_value,
        retained_live_component_ids=retained_live_component_ids,
        unique_module_catalogue_id=unique_module_catalogue_id,
    )
