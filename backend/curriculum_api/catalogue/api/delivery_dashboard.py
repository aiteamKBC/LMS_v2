"""Small Delivery reads. Existing scheduling and write paths are untouched."""

from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.domain.read_contracts import MODULE_INDEX_EXCLUDED_COLUMNS
from curriculum_api.catalogue.infrastructure.session_calendar_composition import authored_calendar_snapshot
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_training_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import build_cohorts_and_groups
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_authoring_row_is_archived
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from django.db import DatabaseError
from django.http import JsonResponse

from curriculum_api.catalogue.infrastructure.calendar_row_runtime import live_rows
from curriculum_api.catalogue.application.overview import CurriculumOverviewUnavailable

FLAGS = ('deleted_at', 'is_programme_deleted', 'is_deleted', 'isDeleted', 'isProgrammeDeleted', 'library_state')
MODULE_FIELDS = ('module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id',
                 'cohort_name', 'group_id', 'group_name', 'sessions_number', 'status',
                 # tutor_name is not stored: curriculum_names resolves it from tutor_id,
                 # so a read without tutor_id reports every module as untutored.
                 'tutor_id', 'tutor_name',
                 'start_date', 'end_date', 'source_type', 'is_archived', *FLAGS)


def read_inputs(*, schedule=False, module_ids=None, programme_id=None):
    from curriculum_api.catalogue.infrastructure.calendar_rows import read_inputs as query
    return query(schedule=schedule, module_ids=module_ids, programme_id=programme_id,
        authoring_fetch_all=authoring_fetch_all, modules_table=AUTHORING_MODULES_TABLE,
        groups_table=GROUPS_TABLE, cohorts_table=COHORT_AUTHORING_DETAILS_TABLE,
        group_order=GROUP_ROWS_ORDER, cohort_order=COHORT_ROWS_ORDER,
        module_fields=MODULE_FIELDS, excluded_module_columns=MODULE_INDEX_EXCLUDED_COLUMNS)


def relationships(modules, groups, cohorts, holidays=(), *, include_archived=False):
    from curriculum_api.catalogue.application.calendar_queries import relationships as query
    return query(modules, groups, cohorts, holidays, include_archived=include_archived,
        build_cohorts_and_groups=build_cohorts_and_groups,
        serialize_group=serialize_group_authoring_detail,
        serialize_cohort=serialize_cohort_authoring_detail)


def build_overview():
    with curriculum_read_scope():
        modules, groups, cohorts = read_inputs()
        cohort_rows, group_rows = relationships(modules, groups, cohorts)
        # The operational catalogue's existing normalized allocation/visibility rule.
        training = authoring_modules_as_training_rows(ensure_tables=False,
            module_rows=modules, group_rows=groups, cohort_rows=cohorts)
        allocated = {clean_str(row.get('id')) for row in training if is_operational_training_row(row)}
        visible_modules = [row for row in modules if clean_str(row.get('module_catalogue_id')) in allocated
                           and not module_authoring_row_is_archived(row)]
        # Module Builder counts every live module; Delivery counts only those placed
        # in a group. These totals let the page say where the others are.
        live = [row for row in modules if not module_authoring_row_is_archived(row)
                and not programme_deleted_row(row)]

        def placed(row, key):
            return bool(clean_str(row.get(key)))

        return {
            'moduleTotals': {
                'all': len(live),
                'cohortOnly': sum(1 for row in live if placed(row, 'cohort_id') and not placed(row, 'group_id')),
                'unplaced': sum(1 for row in live if not placed(row, 'cohort_id') and not placed(row, 'group_id')),
            },
            'modules': [{
                'id': clean_str(row.get('module_catalogue_id')),
                'moduleCatalogueId': clean_str(row.get('module_catalogue_id')),
                'groupId': clean_str(row.get('group_id')),
                'tutor': clean_str(row.get('tutor_name')),
                'isFreeCourse': clean_str(row.get('source_type')).lower() == 'free_course',
            } for row in visible_modules],
            'cohorts': [{key: row.get(key) for key in ('id', 'status')} for row in cohort_rows],
            'groups': [{key: row.get(key) for key in ('id', 'cohortId', 'coach', 'moduleIds')} for row in group_rows],
        }


def build_calendar_snapshot(*, visibility='operational', module_ids=None, programme_id=None):
    from curriculum_api.catalogue.application.calendar_queries import build_calendar_snapshot as query
    with curriculum_read_scope():
        return query(visibility=visibility, module_ids=module_ids, programme_id=programme_id,
            read_inputs=read_inputs, read_holidays=get_holiday_rows,
            relationships=relationships, live_rows=live_rows,
            build_snapshot=authored_calendar_snapshot,
            programme_deleted_row=programme_deleted_row, clean_str=clean_str)


def build_calendar_sessions():
    return build_calendar_snapshot()['sessions']


def slim_sessions(rows, *, undated_count=None):
    fields = ('id', 'type', 'date', 'startTime', 'timeZone', 'title', 'status', 'moduleCatalogueId', 'moduleId')
    payload = {'sessions': [{key: row.get(key) for key in fields} for row in rows]}
    if undated_count is not None:
        payload['undatedSessionCount'] = undated_count
    return payload


def build_sessions():
    snapshot = build_calendar_snapshot()
    return slim_sessions(snapshot['sessions'], undated_count=snapshot['undatedSessionCount'])


def cached_calendar_snapshot(request):
    # The chart and calendar share the expensive read, including its per-key
    # build lock and write-epoch invalidation. A navigation never rebuilds both.
    return cached_curriculum_value('delivery-calendar:v4', build_calendar_snapshot,
        force=request_bypasses_curriculum_cache(request), ttl=30)


def cached_calendar_sessions(request):
    return cached_calendar_snapshot(request)['sessions']


def calendar_sessions(request):
    try:
        rows = cached_calendar_sessions(request)
    except (DatabaseError, CurriculumOverviewUnavailable):
        return JsonResponse({'error': 'The session calendar could not be loaded. Please try again.'}, status=503)
    return curriculum_results_response(rows)


def response_for(request, section, build):
    try:
        payload = cached_curriculum_value(f'delivery-dashboard:v3:{section}', build,
            force=request_bypasses_curriculum_cache(request), ttl=30)
    except (DatabaseError, CurriculumOverviewUnavailable):
        return JsonResponse({'error': 'Delivery data could not be loaded. Please try again.'}, status=503)
    return JsonResponse(payload)
