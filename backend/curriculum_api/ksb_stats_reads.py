"""Narrow PostgreSQL inputs for programme KSB summary statistics."""
from collections import Counter

from .catalogue.infrastructure import archive_sql as archive_state
from .catalogue.infrastructure import database_reads, ksb_read_store as ksb_mapping_placement
from .catalogue.domain.content_values import active_component_rows
from .catalogue.domain.archive_policy import active_mapping_rows, active_week_rows
from .catalogue.domain.values import clean_str
from .reporting.domain.ksb_coverage import normalise_code as coverage_normalise_code, float_weight
from learner_api.ksb_exclusions import and_not_excluded
from learner_api.progress_rules import progress_counts_as_achieved


# Match Python str.strip(), including tabs/newlines and Unicode whitespace.
_STRIP_CHARS = ''.join(chr(value) for value in range(0x3100) if chr(value).isspace())


def grouped_scope_rows(module_ids):
    """Compatibility entry point; calculations and SQL have concrete owners."""
    from .reporting.application.programme_statistics import grouped_scope_rows as read
    return read(
        module_ids,
        AUTHORING_COMPONENTS_TABLE=database_reads.AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=database_reads.AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_WEEKS_TABLE=database_reads.AUTHORING_WEEKS_TABLE,
        COMPONENT_COUNT_FIELDS=COMPONENT_COUNT_FIELDS,
        _grouped_rows=_grouped_rows,
        active_component_rows=active_component_rows,
        active_mapping_rows=active_mapping_rows,
        active_week_rows=active_week_rows,
    )


# The component fields the statistics and the delivery ranking group by.
COMPONENT_COUNT_FIELDS = ('module_catalogue_id', 'type')


def grouped_component_counts(module_ids):
    """Compatibility entry point; calculations and SQL have concrete owners."""
    from .reporting.application.programme_statistics import grouped_component_counts as read
    return read(
        module_ids,
        AUTHORING_COMPONENTS_TABLE=database_reads.AUTHORING_COMPONENTS_TABLE,
        COMPONENT_COUNT_FIELDS=COMPONENT_COUNT_FIELDS,
        _grouped_rows=_grouped_rows,
        active_component_rows=active_component_rows,
        clean_str=clean_str,
    )


def _grouped_rows(table, fields, active, ids):
    # Mappings are read with their component's module and their standard's
    # code (ksb_mapping_placement); 'status' is the archive state the active_*
    # filters below read.
    """Compatibility entry point; calculations and SQL have concrete owners."""
    from .reporting.infrastructure.statistics_reads import _grouped_rows as read
    return read(
        table,
        fields,
        active,
        ids,
        AUTHORING_KSB_MAPPINGS_TABLE=database_reads.AUTHORING_KSB_MAPPINGS_TABLE,
        _STRIP_CHARS=_STRIP_CHARS,
        can_select=ksb_mapping_placement.can_select,
        fetch_all=database_reads.fetch_all,
        quote_ident=database_reads.quote_ident,
        read_source=ksb_mapping_placement.read_source,
        uses_status=archive_state.uses_status,
    )


def progress_totals(learner_ids, codes):
    """Compatibility entry point; calculations and SQL have concrete owners."""
    from functools import partial
    from .reporting.application.programme_statistics import progress_totals as read
    from .reporting.infrastructure.statistics_reads import latest_progress_weights
    from .reporting.infrastructure.statistics_reads import progress_outcomes
    return read(
        learner_ids,
        codes,
        coverage_normalise_code=coverage_normalise_code,
        float_weight=float_weight,
        latest_progress_weights=partial(latest_progress_weights, _STRIP_CHARS=_STRIP_CHARS, and_not_excluded=and_not_excluded, connection=database_reads.connection, fetch_all=database_reads.fetch_all),
        progress_counts_as_achieved=progress_counts_as_achieved,
        progress_outcomes=partial(progress_outcomes, fetch_all=database_reads.fetch_all),
    )
