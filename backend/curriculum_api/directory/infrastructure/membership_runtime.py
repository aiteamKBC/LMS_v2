"""Concrete normalized roster and status-read composition.

SQL, lineage resolution and identity bridging retain their existing owners.
No dependency on the HTTP entry point or legacy views.
"""
from django.db import DatabaseError
from curriculum_api import curriculum_names
from curriculum_api.directory.domain.membership_values import status_key
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from django.db import connection
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_columns
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_table_exists
from curriculum_api.catalogue.infrastructure.catalogue_resolution import programme_identity_candidates
from curriculum_api.catalogue.infrastructure.catalogue_resolution import scope_placement_lineage
from curriculum_api.catalogue.infrastructure.placement_runtime import scope_programme_identifier
from learner_api.learning_plans import public as learner_plans


def learner_facts(module_ids, profile_ids=None):
    """Compatibility adapter for normalized membership facts on the existing connection."""
    return learner_plans.learner_membership_facts(
        module_ids,
        profile_ids,
        connection=connection,
        table_exists=learner_schema_table_exists,
        columns_for=learner_schema_columns,
    )


def placement_lineages(scope, identifiers):
    from curriculum_api.directory.application.status_queries import placement_lineages as implementation
    from curriculum_api.directory.infrastructure.lineage_reads import placement_rows
    def read(scope, identifiers):
        return placement_rows(
            scope, identifiers, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
            COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
            GROUPS_TABLE=GROUPS_TABLE, column_names=column_names,
            NAME_FIELDS=curriculum_names.NAME_FIELDS, DatabaseError=DatabaseError,
            authoring_fetch_all=authoring_fetch_all,
        )
    return implementation(scope, identifiers, scope_placement_lineage=scope_placement_lineage, read_rows=read, clean_str=clean_str)


def members_for_lineages(lineages, facts, programme_candidates):
    return learner_plans.members_for_lineages(lineages, facts, programme_candidates)


def counts_for_lineages(lineages, facts, programme_candidates):
    from curriculum_api.directory.application.status_queries import counts_for_lineages as implementation
    return implementation(lineages, facts, programme_candidates, members_for_lineages=members_for_lineages, status_key=status_key)


def status_counts(scope, identifiers):
    from curriculum_api.directory.application.status_queries import status_counts as implementation
    return implementation(scope, identifiers, curriculum_read_scope=curriculum_read_scope,
        placement_lineages=placement_lineages, scope_programme_identifier=scope_programme_identifier,
        programme_identity_candidates=programme_identity_candidates, learner_facts=learner_facts,
        counts_for_lineages=counts_for_lineages,
    )


def module_member_enrolment_ids(module_id):
    """Enrolment-keyed members; None for a missing target, set() for no members."""
    with curriculum_read_scope(targeted_child_reads=True):
        return learner_plans.module_member_enrolment_ids(
            module_id,
            read_lineages=placement_lineages,
            read_facts=learner_facts,
            programme_identifier=scope_programme_identifier,
            programme_candidates=programme_identity_candidates,
        )


def module_member_enrolment_ids_by_module(module_ids):
    return learner_plans.module_member_enrolment_ids_by_module(
        module_ids,
        curriculum_read_scope=curriculum_read_scope,
        placement_lineages=placement_lineages,
        scope_programme_identifier=scope_programme_identifier,
        programme_identity_candidates=programme_identity_candidates,
        learner_facts=learner_facts,
        members_for_lineages=members_for_lineages,
    )
