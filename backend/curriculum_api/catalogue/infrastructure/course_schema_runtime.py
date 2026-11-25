"""Own readiness checks and the unchanged opt-in local provisioning sequence."""
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.domain.read_contracts import FREE_PROGRAMME_COMPONENTS_TABLE
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATES_TABLE
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN
from curriculum_api.catalogue.infrastructure.database_reads import _TABLE_COLUMNS_CACHE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import authoring_json_type
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from django.db import connection
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate


_FREE_PROGRAMME_TABLES_READY = False


FREE_COURSES_TABLE = 'free_courses'


FREE_PROGRAMME_MODULES_TABLE = 'free_course_weeks'


def ensure_free_programme_tables():
    """Verify free-course tables exist; provision only outside production."""
    global _FREE_PROGRAMME_TABLES_READY
    if _FREE_PROGRAMME_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(
            FREE_COURSES_TABLE,
            FREE_PROGRAMME_MODULES_TABLE,
            FREE_PROGRAMME_COMPONENTS_TABLE,
        )
        _FREE_PROGRAMME_TABLES_READY = True
        return
    provision_free_programme_tables()


def provision_free_programme_tables():
    global _FREE_PROGRAMME_TABLES_READY
    if _FREE_PROGRAMME_TABLES_READY:
        return
    from curriculum_api.catalogue.infrastructure.authoring_schema import provision_free_programme_tables as implementation
    implementation(
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        FREE_COURSES_TABLE=FREE_COURSES_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        FREE_PROGRAMME_MODULES_TABLE=FREE_PROGRAMME_MODULES_TABLE,
        authoring_json_type=authoring_json_type,
        authoring_table_name=authoring_table_name,
        connection=connection,
        quote_ident=quote_ident,
    )
    _FREE_PROGRAMME_TABLES_READY = True


WEEK_TEMPLATE_COMPONENTS_TABLE = 'week_template_components'


_WEEK_TEMPLATE_TABLES_READY = False


def ensure_week_template_tables():
    """Verify week-template tables exist; provision only outside production."""
    global _WEEK_TEMPLATE_TABLES_READY
    if _WEEK_TEMPLATE_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(WEEK_TEMPLATES_TABLE, WEEK_TEMPLATE_COMPONENTS_TABLE)
        _WEEK_TEMPLATE_TABLES_READY = True
        return
    provision_week_template_tables()


def provision_week_template_tables():
    global _WEEK_TEMPLATE_TABLES_READY
    if _WEEK_TEMPLATE_TABLES_READY:
        return
    from curriculum_api.catalogue.infrastructure.authoring_schema import provision_week_template_tables as implementation
    implementation(
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE,
        WEEK_TEMPLATE_COMPONENTS_TABLE=WEEK_TEMPLATE_COMPONENTS_TABLE,
        WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN=WEEK_TEMPLATE_REFLECTION_QUESTION_COLUMN,
        _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE,
        authoring_json_type=authoring_json_type,
        authoring_table_name=authoring_table_name,
        connection=connection,
        quote_ident=quote_ident,
    )
    _WEEK_TEMPLATE_TABLES_READY = True


def reset_ready_flags():
    """Forget only the readiness state owned by this module."""
    global _FREE_PROGRAMME_TABLES_READY, _WEEK_TEMPLATE_TABLES_READY
    _FREE_PROGRAMME_TABLES_READY = False
    _WEEK_TEMPLATE_TABLES_READY = False
