"""Shared authoring readiness latch and the existing guarded local provisioning path.

The production gate is read-only. DDL remains in the existing schema implementation
and is called only under the same runtime-bootstrap decision as before.
"""
from curriculum_api import schema_gate
from .storage_context import native_only
from .database_reads import (
    connection, CURRICULUM_SCHEMA, _TABLE_COLUMNS_CACHE, quote_ident, authoring_table_name,
    AUTHORING_ADVANCED_TABLE, AUTHORING_COMPLETION_TABLE, AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE, AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE,
)

AI_MATERIAL_COLUMN = 'ai_material'
COHORT_AUTHORING_DETAILS_TABLE = 'cohorts'
GROUPS_TABLE = 'groups'
MODULE_TEAMS_SHARES_TABLE = 'module_teams_shares'
_AUTHORING_TABLES_READY = False

AUTHORING_REQUIRED_TABLES = (
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
)


def authoring_json_type():
    return 'jsonb' if connection.vendor == 'postgresql' else 'text'


def ensure_module_authoring_tables():
    """Verify the module-authoring tables exist.

    Schema is owned by migrations. In production this is a cached read-only
    probe that raises SchemaNotProvisioned if a table is missing; it never
    creates or alters anything. Test/local runs delegate to the provisioning
    path below, which still owns the DDL.
    """
    global _AUTHORING_TABLES_READY
    if native_only():
        schema_gate.require_tables('free_courses', 'free_course_weeks', 'free_programme_components')
        return
    if _AUTHORING_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(*AUTHORING_REQUIRED_TABLES)
        _AUTHORING_TABLES_READY = True
        return
    provision_module_authoring_tables()


def provision_module_authoring_tables():
    global _AUTHORING_TABLES_READY
    if _AUTHORING_TABLES_READY:
        return
    from .authoring_schema import provision_module_authoring_tables as implementation
    def provision_course_pricing(*args, **kwargs):
        from curriculum_api.course_pricing_schema import provision as operation
        return operation(*args, **kwargs)
    implementation(
        AI_MATERIAL_COLUMN=AI_MATERIAL_COLUMN,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        AUTHORING_COMPLETION_TABLE=AUTHORING_COMPLETION_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        GROUPS_TABLE=GROUPS_TABLE,
        MODULE_TEAMS_SHARES_TABLE=MODULE_TEAMS_SHARES_TABLE,
        _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE,
        authoring_json_type=authoring_json_type,
        authoring_table_name=authoring_table_name,
        connection=connection,
        provision_course_pricing=provision_course_pricing,
        quote_ident=quote_ident,
    )
    _AUTHORING_TABLES_READY = True


def reset_ready_flag():
    global _AUTHORING_TABLES_READY
    _AUTHORING_TABLES_READY = False
