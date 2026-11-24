"""Programme query contracts; runtime callbacks are supplied by the entry point."""
from .catalogue.application.projections import build_programme_list
from .catalogue.application.programme_enrichment import programme_list_needs_module_enrichment
from .catalogue.infrastructure.programme_reads import programme_list_learner_counts
from .catalogue.infrastructure.projection_sources import (
    programme_list_sources, _MODULE_FIELDS, _GROUP_FIELDS, _COHORT_FIELDS, _WEEK_FIELDS,
)
