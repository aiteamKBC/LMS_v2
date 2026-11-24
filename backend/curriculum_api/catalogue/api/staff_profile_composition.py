"""Concrete catalogue / api / staff profile composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.catalogue_adapters import build_staff_profiles
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.application.staff_profiles import staff_user_profile_source
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.domain.read_contracts import STAFF_PROFILE_READ_ONLY_MESSAGE
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_is_archived
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_staff_profile_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_training_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import build_cohorts_and_groups
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_staff_users_by_access
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_catalogue_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_training_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import build_modules
from django.db import connection
from django.db import connections
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


def _staff_assignment_readers():
    from functools import partial
    from curriculum_api.catalogue.application.staff_assignments import assignment_readers
    from curriculum_api.catalogue.infrastructure.staff_directory import read_assignment_source
    return assignment_readers(
        read_source=partial(
            read_assignment_source, module_index_rows=module_index_rows,
            authoring_fetch_all=authoring_fetch_all, get_program_config_rows=get_program_config_rows,
            groups_table=GROUPS_TABLE, groups_order=GROUP_ROWS_ORDER,
            cohorts_table=COHORT_AUTHORING_DETAILS_TABLE, cohorts_order=COHORT_ROWS_ORDER,
        ),
        project_training=authoring_modules_as_training_rows,
        project_catalogue=authoring_modules_as_catalogue_rows,
        build_cohorts_and_groups=build_cohorts_and_groups,
        serialize_group=serialize_group_authoring_detail,
    )


def _staff_user_profile_reader(*, strict=False):
    from functools import partial
    from curriculum_api.catalogue.application.staff_profiles import build_staff_user_profile_collection as query
    from curriculum_api.catalogue.infrastructure.staff_directory import read_staff_profile_rows
    read_profiles = get_staff_profile_rows
    if strict:
        read_profiles = partial(
            read_staff_profile_rows, fetch_staff_users_by_access=fetch_staff_users_by_access,
            staff_user_profile_source=staff_user_profile_source,
            staff_profile_is_archived=staff_profile_is_archived,
            enrolment_available='enrolment' in connections,
        )
    reads = _staff_assignment_readers() if strict else {
        'authoring_modules_as_catalogue_rows': authoring_modules_as_catalogue_rows,
        'build_cohorts_and_groups': build_cohorts_and_groups,
        'get_program_config_rows': get_program_config_rows,
        'get_training_rows': get_training_rows,
    }
    return partial(
        query, get_staff_profile_rows=read_profiles, build_modules=build_modules,
        build_staff_profiles=build_staff_profiles,
        is_operational_training_row=is_operational_training_row, **reads,
    )


def _curriculum_tutor_profile_reader(*, strict=False):
    from functools import partial
    from curriculum_api.catalogue.application.staff_profiles import build_curriculum_tutor_profile_collection as query
    from curriculum_api.catalogue.infrastructure.staff_directory import read_curriculum_tutor_rows
    reads = _staff_assignment_readers() if strict else {
        'authoring_modules_as_catalogue_rows': authoring_modules_as_catalogue_rows,
        'get_program_config_rows': get_program_config_rows,
        'get_training_rows': get_training_rows,
    }
    reads.pop('build_cohorts_and_groups', None)
    return partial(
        query, read_curriculum_tutor_rows=partial(
            read_curriculum_tutor_rows, connection=connection, table_exists=table_exists,
            table_name=table_name, fetch_all=fetch_all, required=strict,
        ),
        build_modules=build_modules, build_staff_profiles=build_staff_profiles,
        clean_str=clean_str, is_operational_training_row=is_operational_training_row, **reads,
    )


def build_staff_user_profile_collection(role, visibility='operational'):
    return _staff_user_profile_reader()(role, visibility)


def build_curriculum_tutor_profile_collection(visibility='operational'):
    return _curriculum_tutor_profile_reader()(visibility)


def find_staff_user_profile(role, identifier):
    from curriculum_api.catalogue.application.staff_profiles import find_staff_user_profile as query
    return query(
        role,
        identifier,
        build_staff_user_profile_collection=build_staff_user_profile_collection,
    )


@csrf_exempt
def curriculum_staff_profile_collection(request, role):
    if request.method != 'GET':
        return json_error(STAFF_PROFILE_READ_ONLY_MESSAGE, status=405)
    visibility = curriculum_visibility(request)
    # A staff profile carries what the person teaches, so building the list walks
    # the modules, cohorts and groups -- and it read every one of those tables
    # more than once: the programme config twice, the modules table three times.
    # The scope memoises them for the request, which is the difference between
    # ~13 round trips and ~8 on an endpoint the UI asks for twice per page (once
    # for tutors, once for coaches).
    from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable
    try:
        with curriculum_read_scope():
            profiles = _staff_user_profile_reader(strict=True)(role, visibility)
    except StaffDirectoryUnavailable:
        return json_error('Unable to read the staff directory. Please try again.', status=503)
    return curriculum_results_response(profiles)


@csrf_exempt
def curriculum_staff_profile_detail(request, role, identifier):
    if request.method != 'GET':
        return json_error(STAFF_PROFILE_READ_ONLY_MESSAGE, status=405)
    # Same build as the collection above, for one person. See the note there.
    from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable, find_staff_user_profile as query
    try:
        with curriculum_read_scope():
            profile = query(
                role, identifier, build_staff_user_profile_collection=_staff_user_profile_reader(strict=True),
                clean_str=clean_str, normalise=normalise, staff_assignment_key=staff_assignment_key,
            )
    except StaffDirectoryUnavailable:
        return json_error('Unable to read the staff directory. Please try again.', status=503)
    if not profile:
        return json_error(f'{role.title()} profile not found.', status=404)
    return JsonResponse({'schema': CURRICULUM_SCHEMA, 'profile': profile})


@csrf_exempt
def curriculum_tutors(request):
    if request.method != 'GET':
        return json_error(STAFF_PROFILE_READ_ONLY_MESSAGE, status=405)
    visibility = curriculum_visibility(request)
    from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable
    try:
        with curriculum_read_scope():
            profiles = _curriculum_tutor_profile_reader(strict=True)(visibility)
    except StaffDirectoryUnavailable:
        return json_error('Unable to read the tutor catalogue. Please try again.', status=503)
    return curriculum_results_response(profiles)


@csrf_exempt
def curriculum_coaches(request):
    return curriculum_staff_profile_collection(request, 'coach')


@csrf_exempt
def curriculum_tutor_detail(request, identifier):
    return curriculum_staff_profile_detail(request, 'tutor', identifier)
