"""Small Delivery reads. Existing scheduling and write paths are untouched."""
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from login.permissions import require_access

from . import views

FLAGS = ('deleted_at', 'is_programme_deleted', 'is_deleted', 'isDeleted', 'isProgrammeDeleted', 'library_state')
MODULE_FIELDS = ('module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id',
                 'cohort_name', 'group_id', 'group_name', 'sessions_number', 'status', 'tutor_name',
                 'start_date', 'end_date', 'source_type', 'is_archived', *FLAGS)


def read_inputs(*, schedule=False):
    # No learner counts, KSBs, programme statistics, authoring trees or schema repair.
    modules = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, ensure_tables=False,
        **({'exclude_columns': [*views.MODULE_INDEX_EXCLUDED_COLUMNS, 'description', 'cover_image', 'cover_image_url']}
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


def build_sessions():
    with views.curriculum_read_scope():
        modules, groups, cohorts = read_inputs(schedule=True)
        modules = [row for row in modules if not views.programme_deleted_row(row)]
        holidays = views.get_holiday_rows()
        cohort_rows, group_rows = relationships(modules, groups, cohorts, holidays)
        ids = list(dict.fromkeys(views.clean_str(row.get('module_catalogue_id')) for row in modules
                                 if views.clean_str(row.get('module_catalogue_id'))))
        if ids:
            # These exact reads are memoized in the scope and reused by the
            # builder below. Surface transport/schema failures before its legacy
            # best-effort fallback can present an empty successful calendar.
            slots = ','.join(['%s'] * len(ids))
            views.authoring_fetch_all(views.AUTHORING_WEEKS_TABLE,
                f'module_catalogue_id in ({slots})', ids, 'module_catalogue_id, display_order, week_number, id')
            views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE,
                f'module_catalogue_id in ({slots}) and {views.LIVE_SESSION_TYPE_SQL}', ids,
                'module_catalogue_id, week_id, display_order, id')
        # Same batched authored-live-session builder as /curriculum/sessions/.
        # It reads only live component settings and resolves dates/holidays/clocks
        # through the existing planner, not a second timetable implementation.
        sessions = views.build_sessions_from_authoring_modules(modules,
            views.cohort_selected_holidays_by_id(cohort_rows, holidays),
            groups_by_id={row['id']: {'session_start_time': row.get('startTime'),
                                      'session_end_time': row.get('endTime')} for row in group_rows})
        fields = ('id', 'type', 'date', 'startTime', 'title', 'status', 'moduleCatalogueId', 'moduleId')
        return {'sessions': [{key: row.get(key) for key in fields} for row in sessions]}


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
    return response_for(request, 'sessions', build_sessions)
