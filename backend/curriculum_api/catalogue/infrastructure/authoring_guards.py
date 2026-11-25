"""Concrete catalogue / infrastructure / authoring guards capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.authoring_errors import ProgrammeContentRetained
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_CONTENT_RETAINED_MESSAGE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_where_any


def refuse_if_programme_owns_content(plan):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import refuse_if_programme_owns_content as implementation
    return implementation(
        plan, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        PROGRAMME_CONTENT_RETAINED_MESSAGE=PROGRAMME_CONTENT_RETAINED_MESSAGE,
        ProgrammeContentRetained=ProgrammeContentRetained, curriculum_in_clause=curriculum_in_clause,
        curriculum_where_any=curriculum_where_any, fetch_all=fetch_all, table_exists=table_exists,
        table_name=table_name,
    )
