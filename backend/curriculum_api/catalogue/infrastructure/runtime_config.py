"""Concrete catalogue / infrastructure / runtime config capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import OrderedDict
from curriculum_api import curriculum_names
from curriculum_api.catalogue.domain.archive_policy import active_mapping_rows
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPLETION_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from django.db import connection
import logging
import os
import threading


logger = logging.getLogger('curriculum_api.views')


write_logger = logging.getLogger('curriculum_api.writes')


CURRICULUM_WRITE_TRACE = os.environ.get('CURRICULUM_WRITE_TRACE', 'false').lower() == 'true'


_PROGRAMMES_REF = 'only "curriculum"."programmes"' if connection.vendor == 'postgresql' else '"programmes"'


_COHORTS_REF = 'only "curriculum"."cohorts"' if connection.vendor == 'postgresql' else '"cohorts"'


GROUP_ROWS_ORDER = (
    f'{curriculum_names.programme_name_sql("groups", _PROGRAMMES_REF)}, '
    f'{curriculum_names.cohort_name_sql("groups", _COHORTS_REF)}, group_name'
)


COHORT_ROWS_ORDER = f'{curriculum_names.programme_name_sql("cohorts", _PROGRAMMES_REF)}, cohort_name, start_date'


_PROGRAMME_KSB_DESIGN_FORCE = threading.local()


STRUCTURE_REVISION_SOURCES = (
    ('module', AUTHORING_MODULES_TABLE, None, 'module_catalogue_id'),
    ('weeks', AUTHORING_WEEKS_TABLE, active_week_rows, 'id'),
    ('components', AUTHORING_COMPONENTS_TABLE, active_component_rows, 'id'),
    ('mappings', AUTHORING_KSB_MAPPINGS_TABLE, active_mapping_rows, 'id'),
    ('completion', AUTHORING_COMPLETION_TABLE, None, 'module_catalogue_id'),
    ('advanced', AUTHORING_ADVANCED_TABLE, None, 'module_catalogue_id'),
)


_PROGRAMME_SECTION_WARM_TARGETS = OrderedDict()


_PROGRAMME_SECTION_WARM_LOCK = threading.Lock()

import os

CURRICULUM_SHARED_TTL_SECONDS = int(os.environ.get('CURRICULUM_SHARED_TTL_SECONDS', '300'))

# Coalesce repeated invalidations before rebuilding compact payloads.
CURRICULUM_WARM_ENABLED = os.environ.get('CURRICULUM_WARM', 'true').lower() not in {'false', '0', 'no'}
CURRICULUM_WARM_DELAY_SECONDS = float(os.environ.get('CURRICULUM_WARM_DELAY', '2'))
