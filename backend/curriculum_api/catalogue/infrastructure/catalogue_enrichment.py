"""Concrete catalogue / infrastructure / catalogue enrichment capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import ksb_mapping_placement
from curriculum_api.catalogue.domain.archive_values import archive_stamp_fields
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_LIST_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_PAGE_SIZE_DEFAULT
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_PAGE_SIZE_MAX
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure import placement_reads
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import learning_read_table
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_sql import live_authoring_rows_sql
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_ksb_profile_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.content_runtime import component_builder_response
from curriculum_api.catalogue.infrastructure.content_runtime import library_component_origin
from curriculum_api.catalogue.infrastructure.content_runtime import library_component_where
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import archived_parent_programme
from django.db import connection


def rows_for_ids(table, column, values):
    from curriculum_api.catalogue.infrastructure.library_reads import rows_for_ids as read
    return read(
        table,
        column,
        values,
        attach_curriculum_names=lambda *args, **kwargs: placement_reads.attach(*args, **kwargs),
        read_source=lambda table: ksb_mapping_placement.read_source(table),
        fetch_all=fetch_all,
        quote_ident=quote_ident,
    )


def library_component_rows(*, search='', types=None, programme_ids=None, origins=None, ids=None, page=1, page_size=LIBRARY_PAGE_SIZE_DEFAULT, detail=False):

    def read_library_component_page(**options):
        from curriculum_api.catalogue.infrastructure.library_reads import read_library_component_page as read_page
        return read_page(**options, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, LIBRARY_LIST_COLUMNS=LIBRARY_LIST_COLUMNS, LIBRARY_PAGE_SIZE_DEFAULT=LIBRARY_PAGE_SIZE_DEFAULT, LIBRARY_PAGE_SIZE_MAX=LIBRARY_PAGE_SIZE_MAX, authoring_table_name=authoring_table_name, clean_str=clean_str, ensure_module_authoring_tables=ensure_module_authoring_tables, database_vendor=lambda: connection.vendor, fetch_all=fetch_all, has_column=has_column, learning_read_table=learning_read_table, library_component_where=library_component_where, parse_int=parse_int, quote_ident=quote_ident)
    from curriculum_api.catalogue.application.component_catalogue import library_component_rows as read
    return read(
        search=search,
        types=types,
        programme_ids=programme_ids,
        origins=origins,
        ids=ids,
        page=page,
        page_size=page_size,
        detail=detail,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        component_builder_response=component_builder_response,
        library_component_origin=library_component_origin,
        read_library_component_page=read_library_component_page,
        rows_for_ids=rows_for_ids,
    )


def home_relationship_rows(*, include_weeks=False):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.infrastructure.projection_sources import _HOME_MODULE_FIELDS, _HOME_GROUP_FIELDS, _HOME_COHORT_FIELDS, _HOME_WEEK_FIELDS
    from functools import partial
    from curriculum_api import ksb_mapping_placement
    from curriculum_api.module_authoring_facts import ksb_counts_selection
    from curriculum_api.catalogue.infrastructure.projection_sources import home_relationship_rows as query
    return query(
        include_weeks=include_weeks,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        _HOME_COHORT_FIELDS=_HOME_COHORT_FIELDS,
        _HOME_GROUP_FIELDS=_HOME_GROUP_FIELDS,
        _HOME_MODULE_FIELDS=_HOME_MODULE_FIELDS,
        _HOME_WEEK_FIELDS=_HOME_WEEK_FIELDS,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        connection=connection,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        fetch_all=fetch_all,
        get_ksb_profile_rows=get_ksb_profile_rows,
        get_program_config_rows=get_program_config_rows,
        ksb_counts_selection=partial(
            ksb_counts_selection, live_authoring_rows_sql=live_authoring_rows_sql,
            AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
            relation=ksb_mapping_placement.relation,
        ),
        quote_ident=quote_ident
    )


def archived_module_payload(row, component_counts):
    from curriculum_api.catalogue.application.archive_queries import archived_module_payload as query
    return query(
        row, component_counts, archive_stamp_fields=archive_stamp_fields,
        archived_parent_programme=archived_parent_programme, clean_str=clean_str,
        module_stored_week_count=module_stored_week_count, parse_int=parse_int,
    )
