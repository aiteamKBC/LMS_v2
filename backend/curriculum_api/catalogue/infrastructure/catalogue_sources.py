"""Concrete catalogue / infrastructure / catalogue sources capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import calendar_holidays
from curriculum_api import schema_compat
from curriculum_api.catalogue.application.staff_profiles import staff_user_profile_source
from curriculum_api.catalogue.domain.holiday_selection import holiday_row_source
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_ROWS_CACHE_TTL_SECONDS
from curriculum_api.catalogue.domain.read_contracts import ENGLAND_HOLIDAYS_TABLE
from curriculum_api.catalogue.domain.read_contracts import HOLIDAY_SOURCE_GOVUK
from curriculum_api.catalogue.domain.read_contracts import NON_DELIVERY_WEEKEND_MESSAGE
from curriculum_api.catalogue.domain.read_contracts import WEEK_INDEX_COLUMNS
from curriculum_api.catalogue.domain.session_plan import holiday_date_set
from curriculum_api.catalogue.domain.staff_identity import is_blank_staff_assignment
from curriculum_api.catalogue.domain.staff_identity import staff_profile_email
from curriculum_api.catalogue.domain.staff_identity import staff_profile_is_archived
from curriculum_api.catalogue.domain.staff_identity import staff_profile_name
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import prefetch_authoring_reads
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.calendar_runtime import authored_holiday_table_name
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import learner_relation_exists
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_staff_users_by_access
from curriculum_api.catalogue.infrastructure.placement_runtime import get_tutor_module_rows
from curriculum_api.catalogue.infrastructure.row_queries import get_authoring_module_rows
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.row_queries import training_index_reads
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_catalogue_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_training_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import get_module_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import learners_link_placement_by_id
from curriculum_api.catalogue.infrastructure.structure_runtime import learners_link_programme_by_id
from datetime import datetime
from django.db import connection
from django.db import connections


@scoped_curriculum_read
def get_training_rows():
    return authoring_modules_as_training_rows()


@scoped_curriculum_read
def get_ksb_profile_rows():
    # curriculum.ksb_profiles was removed: a programme takes its KSBs from its
    # apprenticeship standard (standard_ksbs). Kept as an empty source so the
    # callers that still pass profiles through need no change.
    return []


@scoped_curriculum_read
def get_program_config_rows_raw():
    from curriculum_api.catalogue.infrastructure.programme_reads import get_program_config_rows_raw as implementation
    return implementation(
        fetch_all=fetch_all, has_column=has_column, table_name=table_name,
    )


def get_program_config_rows():
    # Read the stored rows; programme identity is never merged by display name.
    return get_program_config_rows_raw()


def get_holiday_rows(include_archived=False):
    """Every holiday the curriculum knows about, in date order.

    Read once per curriculum_read_scope(): a programme detail build asked for
    the same two tables three times (cohort details, cohort holiday
    selection, session planning). Each caller gets its own list; outside a
    scope every call reads afresh, as before.
    """
    return list(_scoped_holiday_rows(include_archived))


@scoped_curriculum_read
def _scoped_holiday_rows(include_archived=False):
    from curriculum_api.catalogue.infrastructure.holiday_reads import _scoped_holiday_rows as query
    return query(
        include_archived,
        calendar_in_use=calendar_holidays.in_use,
        calendar_rows=calendar_holidays.rows,
        table_exists=table_exists,
        ENGLAND_HOLIDAYS_TABLE=ENGLAND_HOLIDAYS_TABLE,
        fetch_all=fetch_all,
        table_name=table_name,
        authored_holiday_table_name=authored_holiday_table_name,
    )


def get_holiday_rows_safe():
    """Compatibility name: calendar read failures must stop delivery decisions."""
    from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
    try:
        return get_holiday_rows()
    except Exception as exc:
        raise CatalogueReadUnavailable(
            'Holiday calendar is unavailable. Please retry.', code='holiday_calendar_unavailable',
        ) from exc


def england_non_delivery_reason(value, holiday_rows=None):
    """Return why a date cannot host a session or meeting in England."""
    day = value.date() if isinstance(value, datetime) else parse_date(value)
    if not day:
        return ''
    if day.weekday() >= 5:
        return NON_DELIVERY_WEEKEND_MESSAGE
    rows = get_holiday_rows_safe() if holiday_rows is None else (holiday_rows or [])
    bank_holidays = [row for row in rows if holiday_row_source(row) == HOLIDAY_SOURCE_GOVUK]
    match = next((row for row in bank_holidays if day in holiday_date_set([row])), None)
    if not match:
        return ''
    label = clean_str(match.get('title') or match.get('label') or match.get('name'))
    suffix = f' ({label})' if label else ''
    return f'Sessions and meetings cannot be booked on an England and Wales bank holiday{suffix}.'


@scoped_curriculum_read
def get_staff_profile_rows(role, include_archived=False):
    """Every tutor / coach the curriculum knows of, from the one place they live.

    A tutor or a coach is a staff *user*: somebody an administrator invited and
    gave that access to (``enrolment.Staff_users.Access``). Curriculum owns the
    assignment -- which modules a tutor holds, which groups a coach holds, on
    ``curriculum.modules.tutor_name`` / ``curriculum.groups.coach_name`` -- and
    nothing about the person, so it keeps no second copy of them to drift out of
    step with the account they sign in with.

    All consumers use the required staff reader. An unavailable directory is
    distinct from a successful read containing no staff.
    """
    from curriculum_api.catalogue.infrastructure.staff_directory import read_staff_profile_rows
    return read_staff_profile_rows(
        role, include_archived, enrolment_available='enrolment' in connections,
        fetch_staff_users_by_access=fetch_staff_users_by_access,
        staff_user_profile_source=staff_user_profile_source,
        staff_profile_is_archived=staff_profile_is_archived,
    )


def get_tutor_rows():
    return get_staff_profile_rows('tutor')


def get_coach_rows():
    return get_staff_profile_rows('coach')


def canonical_staff_assignment_name(role, value, include_archived=True):
    from curriculum_api.catalogue.application.staff_profiles import canonical_staff_assignment_name as implementation
    return implementation(
        role, value, include_archived, clean_str=clean_str,
        find_staff_profile_row=find_staff_profile_row,
        is_blank_staff_assignment=is_blank_staff_assignment, staff_profile_name=staff_profile_name,
    )


def resolve_staff_assignment_email(role, value, include_archived=True):
    from curriculum_api.catalogue.application.staff_profiles import resolve_staff_assignment_email as implementation
    return implementation(
        role, value, include_archived, clean_str=clean_str,
        find_staff_profile_row=find_staff_profile_row,
        is_blank_staff_assignment=is_blank_staff_assignment,
        staff_profile_email=staff_profile_email,
    )


def get_curriculum_rows(compact=False):
    # Legacy callers include post-save responses: preserve their read behavior.
    from curriculum_api.catalogue.application.overview import get_curriculum_rows as query
    return query(
        compact=compact,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        WEEK_INDEX_COLUMNS=WEEK_INDEX_COLUMNS,
        get_authoring_module_rows=get_authoring_module_rows,
        get_coach_rows=get_coach_rows,
        get_holiday_rows=get_holiday_rows,
        get_ksb_profile_rows=get_ksb_profile_rows,
        get_module_rows=get_module_rows,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        get_tutor_module_rows=get_tutor_module_rows,
        get_tutor_rows=get_tutor_rows,
        prefetch_authoring_reads=prefetch_authoring_reads,
        training_index_reads=training_index_reads,
    )


def get_required_curriculum_rows(compact=False):
    from functools import partial
    from curriculum_api.catalogue.application.overview import build_curriculum_rows
    from curriculum_api.catalogue.infrastructure.overview_reads import read_curriculum_source
    from curriculum_api.catalogue.infrastructure.staff_directory import read_staff_profile_rows
    source = read_curriculum_source(
        compact=compact, prefetch_authoring_reads=prefetch_authoring_reads,
        training_index_reads=training_index_reads, module_index_rows=module_index_rows,
        authoring_fetch_all=authoring_fetch_all,
        groups_table=GROUPS_TABLE, groups_order=GROUP_ROWS_ORDER,
        cohorts_table=COHORT_AUTHORING_DETAILS_TABLE, cohorts_order=COHORT_ROWS_ORDER,
        weeks_table=AUTHORING_WEEKS_TABLE, week_columns=WEEK_INDEX_COLUMNS,
        get_ksb_profile_rows=get_ksb_profile_rows, get_program_config_rows=get_program_config_rows,
        get_holiday_rows=get_holiday_rows, get_tutor_module_rows=get_tutor_module_rows,
        read_staff_profile_rows=partial(
            read_staff_profile_rows, enrolment_available='enrolment' in connections,
            fetch_staff_users_by_access=fetch_staff_users_by_access,
            staff_user_profile_source=staff_user_profile_source,
            staff_profile_is_archived=staff_profile_is_archived,
        ),
    )
    return build_curriculum_rows(
        source, project_training=authoring_modules_as_training_rows,
        project_catalogue=authoring_modules_as_catalogue_rows,
    )


@scoped_curriculum_read
def active_learner_programme_counts():
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.infrastructure.programme_reads import active_learner_programme_counts as query
    return query(
        connection=connection,
        learner_relation_exists=learner_relation_exists,
        learners_link_programme_by_id=learners_link_programme_by_id,
        logger=logger,
        schema_compat=schema_compat,
    )


@scoped_curriculum_read
def delivery_learner_count(counts, record_id, name_key):
    from curriculum_api.catalogue.domain.delivery_identity import delivery_learner_count as query
    return query(
        counts,
        record_id,
        name_key,
    )


@scoped_curriculum_read
def active_learner_delivery_counts():
    from curriculum_api.catalogue.infrastructure.delivery_counts import active_learner_delivery_counts as query
    return query(
        connection=connection,
        learner_relation_exists=learner_relation_exists,
        learners_link_placement_by_id=learners_link_placement_by_id,
        logger=logger,
        schema_compat=schema_compat,
    )


def get_cached_curriculum_rows(compact=False, force=False):
    from curriculum_api.catalogue.application.cached_reads import get_cached_curriculum_rows as query
    return query(
        compact, force, CURRICULUM_ROWS_CACHE_TTL_SECONDS=CURRICULUM_ROWS_CACHE_TTL_SECONDS,
        cached_curriculum_value=cached_curriculum_value, get_curriculum_rows=get_curriculum_rows,
    )


def training_rows_by_id():
    return cached_curriculum_value(
        'training_rows_by_id',
        lambda: {clean_str(row.get('id')): row for row in get_training_rows() if clean_str(row.get('id'))},
    )


def programme_list_sources():
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.infrastructure.projection_sources import _MODULE_FIELDS, _GROUP_FIELDS, _COHORT_FIELDS, _WEEK_FIELDS
    from curriculum_api.catalogue.infrastructure.projection_sources import programme_list_sources as query
    return query(
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        _COHORT_FIELDS=_COHORT_FIELDS,
        _GROUP_FIELDS=_GROUP_FIELDS,
        _MODULE_FIELDS=_MODULE_FIELDS,
        _WEEK_FIELDS=_WEEK_FIELDS,
        authoring_fetch_all=authoring_fetch_all,
        authoring_table_name=authoring_table_name,
        connection=connection,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        fetch_all=fetch_all,
        get_program_config_rows=get_program_config_rows,
        quote_ident=quote_ident
    )


def programme_list_learner_counts(source):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.infrastructure.programme_reads import programme_list_learner_counts as query
    return query(
        source,
        active_learner_programme_counts=active_learner_programme_counts,
        fetch_all=fetch_all,
    )


def find_staff_profile_row(role, identifier, include_archived=True):
    from curriculum_api.catalogue.application.staff_profiles import find_staff_profile_row as query
    return query(
        role,
        identifier,
        include_archived,
        get_staff_profile_rows=get_staff_profile_rows,
    )


def tutor_profile_for_identity(email, name):
    from curriculum_api.catalogue.application.tutor_workspace import tutor_profile_for_identity as implementation
    return implementation(email, name, get_staff_profile_rows=get_staff_profile_rows, clean_str=clean_str)
