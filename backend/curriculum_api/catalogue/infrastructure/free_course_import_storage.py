"""Database operations used by the historical content importer; no API dependencies."""
from django.db import connection, transaction
from .free_course_writer_mode import LEGACY, require_mode
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_COURSES_TABLE
from curriculum_api.catalogue.domain.read_contracts import FREE_PROGRAMME_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.course_schema_runtime import FREE_PROGRAMME_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_fetch_all
from curriculum_api.catalogue.infrastructure.free_course_persistence import free_programme_upsert
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows

def atomic():
    return transaction.atomic()


def on_commit(callback):
    return transaction.on_commit(callback)


def vendor():
    return connection.vendor


def require_legacy_mode():
    require_mode(LEGACY)


def lock_import():
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext('curriculum.free_course_content_import'))")
