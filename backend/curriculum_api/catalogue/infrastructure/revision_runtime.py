"""Concrete catalogue / infrastructure / revision runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.read_contracts import STRUCTURE_REVISION_UNAVAILABLE
from curriculum_api.catalogue.domain.read_contracts import STRUCTURE_REVISION_VOLATILE_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.catalogue_resolution import resolve_stored_module_catalogue_id
from curriculum_api.catalogue.infrastructure.course_storage_reads import with_course_storage
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_record_revision
from curriculum_api.catalogue.infrastructure.placement_runtime import cohort_record_revision
from curriculum_api.catalogue.infrastructure.placement_runtime import group_record_revision
from curriculum_api.catalogue.infrastructure.runtime_config import STRUCTURE_REVISION_SOURCES
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.storage_context import native_only
from curriculum_api.catalogue.infrastructure.template_composition import week_template_revision
from django.db import connection


@with_course_storage
def module_structure_revision(module_catalogue_id, *, source_rows=None):
    from curriculum_api.authoring_read_transport import compact_authoring_rows
    from curriculum_api.catalogue.application.structure_revisions import module_structure_revision as query
    return query(
        module_catalogue_id,
        source_rows=source_rows,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        STRUCTURE_REVISION_SOURCES=STRUCTURE_REVISION_SOURCES,
        connection_vendor=lambda: connection.vendor,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        compact_authoring_rows=compact_authoring_rows,
        authoring_fetch_all=authoring_fetch_all,
        logger=logger,
        column_names=column_names,
        STRUCTURE_REVISION_VOLATILE_COLUMNS=STRUCTURE_REVISION_VOLATILE_COLUMNS,
    )


def structure_payload_with_revision(build_payload, module_catalogue_id, *, source_rows=None):
    from curriculum_api.catalogue.application.structure_revisions import structure_payload_with_revision as query
    return query(
        build_payload, module_catalogue_id,
        source_rows=source_rows,
        module_structure_revision=module_structure_revision,
        STRUCTURE_REVISION_UNAVAILABLE=STRUCTURE_REVISION_UNAVAILABLE,
    )


def stamp_revision_after_write(payload, module_catalogue_id):
    """Stamp a payload whose content this request has just written itself.

    The revision has to describe the state *after* that write, so it is read
    afterwards. Only for a caller that provisioned or saved the structure a
    moment ago; anything that merely reads must use
    ``structure_payload_with_revision`` instead.
    """
    if not payload:
        return payload
    return {
        **payload,
        'structureRevision': module_structure_revision(module_catalogue_id) or STRUCTURE_REVISION_UNAVAILABLE,
    }


def lock_module_structure_row(module_catalogue_id):
    from curriculum_api.catalogue.infrastructure.content_source_writes import lock_module_structure_row as implementation
    def course(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.course_storage_reads import course as operation
        return operation(*args, **kwargs)
    return implementation(
        module_catalogue_id,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_table_name=authoring_table_name,
        clean_str=clean_str,
        connection=connection,
        course=course,
        quote_ident=quote_ident,
    )


def lock_record_row(table, where_sql, params):
    """Hold this record's row for the rest of the transaction.

    The single-table counterpart of ``lock_module_structure_row``, and it exists
    for exactly the same reason: without it the guard is a read followed by a
    write, and two saves that both read revision 41 both pass it -- the second
    overwriting the first with the very payload the check exists to refuse. The
    lock makes check-and-write one operation, so the second save waits here,
    then reads the revision the first one produced and is refused.

    SQLite (the test runner) has no row locks and needs none: a write
    transaction takes the whole database.
    """
    if connection.vendor != 'postgresql':
        return
    if native_only():
        from curriculum_api.catalogue.infrastructure.course_storage_reads import course, free_rows
        from curriculum_api.catalogue.infrastructure.free_course_contract import COLUMNS
        if table in COLUMNS:
            for row in free_rows(table, where_sql, params):
                course(row['module_catalogue_id'], lock=True)
            return
    with connection.cursor() as cursor:
        cursor.execute(
            'select 1 from %s where %s for update' % (table_name(table), where_sql),
            list(params or []),
        )
        cursor.fetchall()


@with_course_storage
def module_record_revision(identifier):
    from curriculum_api.catalogue.application.record_revisions import module_record_revision as query
    return query(
        identifier,
        module_structure_revision=module_structure_revision,
        resolve_stored_module_catalogue_id=resolve_stored_module_catalogue_id,
    )


CURRICULUM_RECORD_REVISIONS = {
    'programme': programme_record_revision,
    'cohort': cohort_record_revision,
    'group': group_record_revision,
    'module': module_record_revision,
    'weekTemplate': week_template_revision,
}


def curriculum_record_revision(kind, identifier):
    from curriculum_api.catalogue.application.record_revisions import curriculum_record_revision as query
    return query(
        kind, identifier,
        CURRICULUM_RECORD_REVISIONS=CURRICULUM_RECORD_REVISIONS, logger=logger,
    )
