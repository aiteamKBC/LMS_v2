"""Concrete catalogue / infrastructure / media runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import upload_storage
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_UPLOAD_EXTENSIONS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_UPLOAD_MAX_BYTES
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import AI_MATERIAL_COLUMN
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.upload_paths import COMPONENT_UPLOAD_ROOT
from datetime import datetime
from django.utils.text import get_valid_filename
from pathlib import Path


def safe_upload_segment(value, fallback):
    from curriculum_api.catalogue.infrastructure.content_uploads import safe_upload_segment as implementation
    return implementation(
        value,
        fallback,
        get_valid_filename=get_valid_filename,
    )


def component_upload_metadata(module_catalogue_id, component_id, component_type, uploaded_file, allowed_extensions=None):
    from curriculum_api.catalogue.infrastructure.content_uploads import component_upload_metadata as implementation
    return implementation(
        module_catalogue_id,
        component_id,
        component_type,
        uploaded_file,
        allowed_extensions,
        COMPONENT_UPLOAD_EXTENSIONS=COMPONENT_UPLOAD_EXTENSIONS,
        COMPONENT_UPLOAD_MAX_BYTES=COMPONENT_UPLOAD_MAX_BYTES,
        COMPONENT_UPLOAD_ROOT=COMPONENT_UPLOAD_ROOT,
        Path=Path,
        datetime=datetime,
        get_valid_filename=get_valid_filename,
        safe_upload_segment=safe_upload_segment,
        upload_storage=upload_storage,
    )


def component_uploaded_video_url(value):
    from curriculum_api.catalogue.domain.content_validation import component_uploaded_video_url as implementation
    return implementation(
        value,
    )


def ai_material_record(module_catalogue_id):
    from curriculum_api.catalogue.infrastructure.content_uploads import ai_material_record as implementation
    return implementation(
        module_catalogue_id,
        AI_MATERIAL_COLUMN=AI_MATERIAL_COLUMN,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        authoring_fetch_all=authoring_fetch_all,
    )
