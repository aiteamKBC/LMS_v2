"""Concrete catalogue / domain / delivery values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.read_contracts import DEFAULT_SESSION_END_TIME
from curriculum_api.catalogue.domain.read_contracts import DEFAULT_SESSION_START_TIME
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.session_overrides import override_clock
from curriculum_api.weekly_schedule import module_weekly_schedule
from datetime import date


def is_operational_training_row(row):
    from curriculum_api.catalogue.domain.hierarchy_values import is_operational_training_row as implementation
    return implementation(
        row,
        programme_deleted_row=programme_deleted_row,
    )


def delivery_status_for_training_row(row):
    from curriculum_api.catalogue.domain.hierarchy_values import delivery_status_for_training_row as implementation
    return implementation(
        row,
        date=date,
        is_operational_training_row=is_operational_training_row,
    )


def delivery_days_per_week(module_row):
    """How many days a week this module delivers on, from its stored delivery day.

    A group can run the same module on more than one day (e.g. Mon + Thu), so
    the calendar session count is the authored week count times this. Never
    below 1: a module with no delivery day still runs once per week.
    """
    weekly = module_weekly_schedule(module_row)
    if weekly:
        return len(weekly)
    raw = clean_str((module_row or {}).get('session_week_day') or (module_row or {}).get('weekDays'))
    if not raw:
        return 1
    return max(1, len([part for part in (piece.strip() for piece in raw.split(',')) if part]))


def module_stored_week_count(module_row, week_count=0):
    """How many WEEKS a module is authored as -- derived from live curriculum.weeks rows.

    ``week_count`` is the live count passed in by callers that have already
    fetched the week rows (the structure endpoint and the catalogue summaries).
    For the resync path the caller queries the week table first.
    The sessions fallback is kept only for the rare case where weeks have not
    been authored yet and the caller passes no live count.
    """
    authored = max(0, parse_int(week_count, 0))
    if authored:
        return authored
    sessions = parse_int((module_row or {}).get('sessions_number'), 0)
    if sessions <= 0:
        return 0
    return max(1, sessions // delivery_days_per_week(module_row))


def module_stored_session_count(module_row, week_count=0):
    """How many sessions a module runs: its stored count, or its weeks if more.

    A week that has been authored is a session whether or not the stored count
    has caught up with it, so the larger of the two wins -- otherwise a seventh
    week added to a six-week module would be served without a date.
    """
    return max(
        parse_int((module_row or {}).get('sessions_number'), 0),
        max(0, parse_int(week_count, 0)),
    )


def module_session_clock(module_row, group_row=None, session_date=None):
    from curriculum_api.catalogue.domain.delivery_pattern import module_session_clock as query
    return query(
        module_row,
        group_row,
        session_date,
        override_clock=override_clock,
        DEFAULT_SESSION_START_TIME=DEFAULT_SESSION_START_TIME,
        DEFAULT_SESSION_END_TIME=DEFAULT_SESSION_END_TIME,
        module_weekly_schedule=module_weekly_schedule,
    )


def attachment_week_count(item, session_count, schedule):
    from curriculum_api.catalogue.domain.attachment_content import attachment_week_count as implementation
    return implementation(
        item,
        session_count,
        schedule,
        delivery_days_per_week=delivery_days_per_week,
    )


def attachment_session_count(item, weeks=None):
    from curriculum_api.catalogue.domain.attachment_content import attachment_session_count as implementation
    return implementation(
        item,
        weeks,
        module_weekly_schedule=module_weekly_schedule,
    )
