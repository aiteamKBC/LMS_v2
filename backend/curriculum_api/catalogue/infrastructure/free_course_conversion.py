"""Concrete placement reads, group lock and scoped persistence."""
from django.db import connection, transaction
from curriculum_api import versioning
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.catalogue_sources import find_staff_profile_row
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import update_group_fields

def atomic():
    return transaction.atomic()


def on_commit(callback, **kwargs):
    return transaction.on_commit(callback, **kwargs)


def version_source(name):
    return versioning.source(name)


def convert_to_module(module_catalogue_id, fields):
    from curriculum_api.learning_storage import convert_to_module as implementation
    return implementation(module_catalogue_id, fields)


def lock_group(group_id):
    if connection.vendor != 'postgresql':
        return False
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT group_id FROM {authoring_table_name(GROUPS_TABLE)} '
                       'WHERE group_id = %s FOR UPDATE', [group_id])
        cursor.fetchall()
    return True
