"""Small Delivery reads. Existing scheduling and write paths are untouched."""
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_access

from . import views
from .calendar_read_rows import live_rows

FLAGS = ('deleted_at', 'is_programme_deleted', 'is_deleted', 'isDeleted', 'isProgrammeDeleted', 'library_state')
MODULE_FIELDS = ('module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id',
                 'cohort_name', 'group_id', 'group_name', 'sessions_number', 'status', 'tutor_name',
                 'start_date', 'end_date', 'source_type', 'is_archived', *FLAGS)


def read_inputs(*, schedule=False):
    # No learner counts, KSBs, programme statistics, authoring trees or schema repair.
    modules = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, ensure_tables=False,
        **({'order_sql': 'programme_id, title',
            'exclude_columns': [*views.MODULE_INDEX_EXCLUDED_COLUMNS, 'description', 'cover_image', 'cover_image_url']}
           if schedule else {'columns': MODULE_FIELDS}))
    groups = views.authoring_fetch_all(views.GROUPS_TABLE, order_sql=views.GROUP_ROWS_ORDER, ensure_tables=False)
    cohorts = views.authoring_fetch_all(views.COHORT_AUTHORING_DETAILS_TABLE, order_sql=views.COHORT_ROWS_ORDER, ensure_tables=False)
    return modules, groups, cohorts


def relationships(modules, groups, cohorts, holidays=()):
    return views.build_cohorts_and_groups(include_learner_counts=False, source={
        'modules': modules,
        'groups': [views.serialize_group_authoring_detail(row) for row in groups],
        'cohorts': [views.serialize_cohort_authoring_detail(row, list(holidays)) for row in cohorts],
    })


def build_overview():
    with views.curriculum_read_scope():
        modules, groups, cohorts = read_inputs()
        cohort_rows, group_rows = relationships(modules, groups, cohorts)
        # The operational catalogue's existing normalized allocation/visibility rule.
        training = views.authoring_modules_as_training_rows(ensure_tables=False,
            module_rows=modules, group_rows=groups, cohort_rows=cohorts)
        allocated = {views.clean_str(row.get('id')) for row in training if views.is_operational_training_row(row)}
        visible_modules = [row for row in modules if views.clean_str(row.get('module_catalogue_id')) in allocated
                           and not views.module_authoring_row_is_archived(row)]
        return {
            'modules': [{
                'id': views.clean_str(row.get('module_catalogue_id')),
                'moduleCatalogueId': views.clean_str(row.get('module_catalogue_id')),
                'groupId': views.clean_str(row.get('group_id')), 'cohortId': views.clean_str(row.get('cohort_id')),
                'tutor': views.clean_str(row.get('tutor_name')), 'status': views.clean_str(row.get('status')),
                'isFreeCourse': views.clean_str(row.get('source_type')).lower() == 'free_course',
            } for row in visible_modules],
            'cohorts': [{key: row.get(key) for key in ('id', 'status')} for row in cohort_rows],
            'groups': [{key: row.get(key) for key in ('id', 'cohortId', 'coach', 'moduleIds')} for row in group_rows],
        }


def build_calendar_snapshot():
    with views.curriculum_read_scope():
        modules, groups, cohorts = read_inputs(schedule=True)
        modules = [row for row in modules if not views.programme_deleted_row(row)]
        holidays = views.get_holiday_rows()
        cohort_rows, group_rows = relationships(modules, groups, cohorts, holidays)
        ids = list(dict.fromkeys(views.clean_str(row.get('module_catalogue_id')) for row in modules
                                 if views.clean_str(row.get('module_catalogue_id'))))
        # Pass read failures through to the caller, before the legacy builder's
        # best-effort fallback could turn an unavailable database into zeroes.
        weeks, components = live_rows(ids)
        selected_holidays = views.cohort_selected_holidays_by_id(cohort_rows, holidays)
        links = views.authoring_session_links_by_catalogue(ids,
            modules_by_catalogue={views.clean_str(row.get('module_catalogue_id')): row for row in modules},
            groups_by_id={views.clean_str(row.get('group_id')): row for row in groups},
            holidays_by_cohort=selected_holidays, week_rows=weeks, component_rows=components)
        sessions = views.build_sessions_from_authoring_modules(modules, selected_holidays,
            groups_by_id={row['id']: {'session_start_time': row.get('startTime'),
                                      'session_end_time': row.get('endTime')} for row in group_rows},
            session_links=links)
        # Count resolved live links before the calendar's existing dated-only
        # filter. Reuse the same module scope and date parser, never invent dates
        # or add incomplete sessions to calendar/Teams collections.
        undated = sum(
            1 for row in modules
            if views.clean_str(row.get('module_catalogue_id'))
            and views.clean_str(row.get('status')).lower() != 'archived'
            for link in (links.get(views.clean_str(row.get('module_catalogue_id'))) or [])
            if not views.parse_date(link.get('date'))
        )
        return {'sessions': sessions, 'undatedSessionCount': undated}


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
    return views.cached_curriculum_value('delivery-calendar:v3', build_calendar_snapshot,
        force=views.request_bypasses_curriculum_cache(request), ttl=30)


def cached_calendar_sessions(request):
    return cached_calendar_snapshot(request)['sessions']


def calendar_sessions(request):
    try:
        rows = cached_calendar_sessions(request)
    except DatabaseError:
        return JsonResponse({'error': 'The session calendar could not be loaded. Please try again.'}, status=503)
    return views.curriculum_results_response(rows)


def response_for(request, section, build):
    try:
        payload = views.cached_curriculum_value(f'delivery-dashboard:v1:{section}', build,
            force=views.request_bypasses_curriculum_cache(request), ttl=30)
    except DatabaseError:
        return JsonResponse({'error': 'Delivery data could not be loaded. Please try again.'}, status=503)
    return JsonResponse(payload)


@require_GET
@require_access('curriculum')
def overview(request):
    return response_for(request, 'overview', build_overview)


@require_GET
@require_access('curriculum')
def sessions(request):
    try:
        snapshot = cached_calendar_snapshot(request)
    except DatabaseError:
        return JsonResponse({'error': 'Delivery data could not be loaded. Please try again.'}, status=503)
    return JsonResponse(slim_sessions(snapshot['sessions'], undated_count=snapshot['undatedSessionCount']))
