"""Concrete catalogue / infrastructure / structure runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import curriculum_names
from curriculum_api.catalogue.infrastructure import free_course_rows as free_course_catalogue
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.delivery_values import delivery_days_per_week
from curriculum_api.catalogue.domain.delivery_values import delivery_status_for_training_row
from curriculum_api.catalogue.domain.delivery_values import module_stored_session_count
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.read_contracts import CANONICAL_MODULE_ID_PATTERN
from curriculum_api.catalogue.domain.read_contracts import COMPACT_MODULE_OMITTED_KEYS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_SECTION_WARM_LIMIT
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_WORKSPACE_MODULE_FIELDS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_WORKSPACE_WEEK_FIELDS
from curriculum_api.catalogue.domain.read_contracts import TRAINING_MODULE_CATALOGUE_COLUMN
from curriculum_api.catalogue.domain.read_contracts import WEEK_INDEX_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_MODULE_FLAG
from curriculum_api.catalogue.domain.read_contracts import WEEK_OUTLINE_WEEK_FLAG
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import prefetch_authoring_reads
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import _TABLE_COLUMNS_CACHE
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_columns
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.row_queries import safe_module_index_rows
from curriculum_api.catalogue.infrastructure.row_queries import training_index_reads
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import STRUCTURE_REVISION_SOURCES
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_SECTION_WARM_LOCK
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_SECTION_WARM_TARGETS
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.course_pricing import pricing_payload
from curriculum_api.ksb_coverage import SUPPORTED_CLASSIFICATIONS
from curriculum_api.meetings.infrastructure.session_runtime import module_structure_live_session_counts
from curriculum_api.reporting.domain.source_values import codes_from_session_ksb
from curriculum_api.reporting.infrastructure.source_runtime import legacy_weight_class_from_classification
from curriculum_api.reporting.infrastructure.source_runtime import normalise_ksb_classification
from django.db import connection
import time
from curriculum_api.catalogue.infrastructure.storage_context import native_only


def ensure_columns(table, specs):
    from curriculum_api.catalogue.infrastructure.authoring_schema import ensure_columns as implementation
    return implementation(
        table, specs, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        _TABLE_COLUMNS_CACHE=_TABLE_COLUMNS_CACHE, connection=connection, has_column=has_column,
        quote_ident=quote_ident, table_name=table_name,
    )


def is_canonical_module_catalogue_id(value):
    return bool(CANONICAL_MODULE_ID_PATTERN.match(clean_str(value)))


def training_row_column_module_catalogue_id(row):
    return clean_str((row or {}).get(TRAINING_MODULE_CATALOGUE_COLUMN))


def training_row_invalid_explicit_module_catalogue_id(row):
    value = training_row_column_module_catalogue_id(row)
    return value if value and not is_canonical_module_catalogue_id(value) else ''


def training_row_module_catalogue_id(row):
    column_value = training_row_column_module_catalogue_id(row)
    if column_value:
        return column_value if is_canonical_module_catalogue_id(column_value) else ''
    return ''


def written_rows(table, rows):
    from curriculum_api.catalogue.infrastructure.row_persistence import written_rows as implementation
    return implementation(
        table, rows, curriculum_names=curriculum_names,
    )


def note_previous_content_modules(table, *, where_sql=None, where_params=None, key_columns=None, payloads=()):
    from curriculum_api.catalogue.infrastructure.write_notifications import note_previous_content_modules as implementation
    def load_content_cache():
        from curriculum_api import content_cache as operation
        return operation
    return implementation(
        table, where_sql=where_sql, where_params=where_params, key_columns=key_columns,
        payloads=payloads, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, connection=connection,
        fetch_all=fetch_all, load_content_cache=load_content_cache, logger=logger,
        table_name=table_name,
        native_only=native_only,
    )


def programme_authoring_module_rows(programme, config=None, *, module_rows=None):
    from curriculum_api.catalogue.application.module_assembly import programme_authoring_module_rows as query
    return query(
        programme,
        config,
        module_rows=module_rows,
        programme_deleted_row=programme_deleted_row,
        row_has_deleted_at=row_has_deleted_at,
        safe_module_index_rows=safe_module_index_rows,
    )


def authoring_modules_as_training_rows(*, ensure_tables=True, module_rows=None, group_rows=None, cohort_rows=None):
    from curriculum_api.catalogue.application.authoring_rows import authoring_modules_as_training_rows as query
    return query(
        ensure_tables=ensure_tables,
        module_rows=module_rows,
        group_rows=group_rows,
        cohort_rows=cohort_rows,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        COHORT_ROWS_ORDER=COHORT_ROWS_ORDER,
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        TRAINING_MODULE_CATALOGUE_COLUMN=TRAINING_MODULE_CATALOGUE_COLUMN,
        authoring_fetch_all=authoring_fetch_all,
        logger=logger,
        module_index_rows=module_index_rows,
        prefetch_authoring_reads=prefetch_authoring_reads,
        programme_deleted_row=programme_deleted_row,
        training_index_reads=training_index_reads,
    )


def authoring_modules_as_catalogue_rows(*, module_rows=None, week_rows=None):
    from curriculum_api.catalogue.application.authoring_rows import authoring_modules_as_catalogue_rows as query
    return query(
        module_rows=module_rows,
        week_rows=week_rows,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        WEEK_INDEX_COLUMNS=WEEK_INDEX_COLUMNS,
        authoring_fetch_all=authoring_fetch_all,
        json_db_value=json_db_value,
        logger=logger,
        module_index_rows=module_index_rows,
        programme_deleted_row=programme_deleted_row,
    )


def get_module_rows():
    # The authoring tables are the catalogue: the legacy curriculum."Modules"
    # table no longer exists in the curriculum database.
    return authoring_modules_as_catalogue_rows()


def build_modules(module_rows, training_rows, program_configs=None, include_unused=False):
    from curriculum_api.catalogue.application.module_projection import build_modules as query
    return query(
        module_rows,
        training_rows,
        program_configs,
        include_unused,
        codes_from_session_ksb=codes_from_session_ksb,
        delivery_status_for_training_row=delivery_status_for_training_row,
        module_stored_week_count=module_stored_week_count,
        program_config_by_id=program_config_by_id,
        programme_deleted_row=programme_deleted_row,
        training_row_invalid_explicit_module_catalogue_id=training_row_invalid_explicit_module_catalogue_id,
        training_row_module_catalogue_id=training_row_module_catalogue_id,
    )


def compact_module_rows(modules):
    from curriculum_api.catalogue.application.module_projection import compact_module_rows as read
    return read(modules,
        COMPACT_MODULE_OMITTED_KEYS=COMPACT_MODULE_OMITTED_KEYS,
    )


def module_authoring_quality_check(module_payload):
    from curriculum_api.catalogue.application.authoring_metadata import module_authoring_quality_check as read
    return read(
        module_payload,
        SUPPORTED_CLASSIFICATIONS=SUPPORTED_CLASSIFICATIONS,
        normalise_ksb_classification=normalise_ksb_classification,
    )


def mapping_response(row):
    from curriculum_api.catalogue.application.authoring_metadata import mapping_response as read
    return read(
        row,
        legacy_weight_class_from_classification=legacy_weight_class_from_classification,
        normalise_ksb_classification=normalise_ksb_classification,
    )


def training_row_by_id(training_id):
    ident = clean_str(training_id).replace('training-module-', '', 1)
    for row in authoring_modules_as_training_rows():
        candidates = {
            clean_str(row.get('id')),
            clean_str(row.get(TRAINING_MODULE_CATALOGUE_COLUMN)),
            clean_str(row.get('_meta', {}).get(TRAINING_MODULE_CATALOGUE_COLUMN)),
        }
        if ident in candidates or clean_str(training_id) in candidates:
            return row
    return None


def module_structure_uses_session_rows(weeks, session_count, delivery_day_count):
    """Recognise a complete imported structure with one row per session.

    These rows can include a separate holiday/reading row. They must not each
    consume every delivery day, as true calendar-week rows do. Requiring every
    planned session to be authored leaves partial and empty week shells on the
    existing calendar-week mapping.
    """
    counts = module_structure_live_session_counts(weeks)
    count = max(0, parse_int(session_count, 0))
    per_week = max(1, parse_int(delivery_day_count, 1))
    return (
        count > 0
        and sum(counts) == count
        and all(value <= 1 for value in counts)
        and len(counts) > (count + per_week - 1) // per_week
    )


def module_delivery_week_count(module, weeks):
    count = module_stored_session_count(module)
    days = delivery_days_per_week(module)
    if module_structure_uses_session_rows(weeks, count, days):
        return (count + days - 1) // days
    return module_stored_week_count(module, len(weeks))


def module_structure_source_rows(module_catalogue_id):
    from curriculum_api.authoring_read_transport import compact_authoring_rows
    from curriculum_api.catalogue.infrastructure.structure_sources import module_structure_source_rows as query
    return query(
        module_catalogue_id,
        compact_authoring_rows=compact_authoring_rows,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        STRUCTURE_REVISION_SOURCES=STRUCTURE_REVISION_SOURCES,
    )


def with_item_fingerprints(payload):
    from curriculum_api.module_merge import structure_fingerprints
    from curriculum_api.catalogue.application.structure_revisions import with_item_fingerprints as query
    return query(
        payload,
        structure_fingerprints=structure_fingerprints,
    )


def free_programme_module_response(row, components, course=None):
    from curriculum_api.catalogue.application.free_course_projection import free_programme_module_response as query
    return query(
        row,
        components,
        course,
        free_course_catalogue=free_course_catalogue,
        pricing_payload=pricing_payload,
    )


def home_programmes_need_enrichment(overview, authoring_rows, program_configs, *, include_archived=False):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.application.programme_enrichment import home_programmes_need_enrichment as query
    return query(
        overview,
        authoring_rows,
        program_configs,
        include_archived=include_archived,
        is_archived_program_config=is_archived_program_config,
    )


def note_programme_section_read(identifier, visibility, workspace_view):
    target = (clean_str(identifier), visibility, bool(workspace_view))
    with _PROGRAMME_SECTION_WARM_LOCK:
        _PROGRAMME_SECTION_WARM_TARGETS.pop(target, None)
        _PROGRAMME_SECTION_WARM_TARGETS[target] = time.monotonic()
        while len(_PROGRAMME_SECTION_WARM_TARGETS) > PROGRAMME_SECTION_WARM_LIMIT:
            _PROGRAMME_SECTION_WARM_TARGETS.popitem(last=False)


def programme_modules_workspace_payload(payload):
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.application.programme_detail import programme_modules_workspace_payload as query
    return query(
        payload,
        PROGRAMME_WORKSPACE_MODULE_FIELDS=PROGRAMME_WORKSPACE_MODULE_FIELDS,
        PROGRAMME_WORKSPACE_WEEK_FIELDS=PROGRAMME_WORKSPACE_WEEK_FIELDS,
        WEEK_OUTLINE_MODULE_FLAG=WEEK_OUTLINE_MODULE_FLAG,
        WEEK_OUTLINE_WEEK_FLAG=WEEK_OUTLINE_WEEK_FLAG,
    )


def learners_link_programme_by_id():
    """Whether ``Learner.learners`` carries the explicit programme id column.

    The column is added out of band by ``apply_learner_enrolment_id``, so an
    environment that has not run it still has to fall back to name matching.
    """
    return 'programme_id' in learner_schema_columns('learners')


def learners_link_placement_by_id():
    """Whether ``Learner.learners`` carries cohort_id / group_id.

    The two columns below programme_id, added out of band by
    ``sql/2026-09-02_learner_placement_ids.sql``. An environment that has not
    run it keeps matching placements by name, so every read that uses these
    falls back rather than failing.
    """
    columns = learner_schema_columns('learners')
    return 'cohort_id' in columns and 'group_id' in columns
