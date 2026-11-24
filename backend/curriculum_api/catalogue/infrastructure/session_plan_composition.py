"""Concrete catalogue / infrastructure / session plan composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import defaultdict
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.delivery_values import module_stored_session_count
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.calendar_runtime import build_module_session_plan
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_delivery_row
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import module_cohort_selected_holidays
from curriculum_api.session_overrides import apply_session_overrides
from curriculum_api.session_overrides import session_overrides
from curriculum_api.weekly_schedule import first_weekly_session_day
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from curriculum_api.catalogue.application.session_plans import holiday_details_by_date
from curriculum_api.catalogue.domain.session_plan import parse_delivery_days


def module_delivery_session_plan(module, session_count, start, holidays=None, week_count=0):

    def raise_calendar_unavailable(message):
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable
        raise CalendarUnavailable(message)

    def read_module_holidays(module, holidays):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import module_holidays
        return module_holidays(module, holidays)
    from curriculum_api.catalogue.application.session_plans import module_delivery_session_plan as query
    return query(
        module,
        session_count,
        start,
        holidays,
        week_count,
        module_weekly_schedule=module_weekly_schedule,
        build_module_session_plan=build_module_session_plan,
        first_weekly_session_day=first_weekly_session_day,
        module_week_starts_on=module_week_starts_on,
        module_session_clock=module_session_clock,
        apply_session_overrides=apply_session_overrides,
        read_module_holidays=read_module_holidays,
        raise_calendar_unavailable=raise_calendar_unavailable,
        holiday_details_by_date=holiday_details_by_date,
        parse_delivery_days=parse_delivery_days,
    )


def module_delivery_plan(module, session_count, start, holidays=None):
    from curriculum_api.catalogue.application.session_plans import module_delivery_plan as query
    return query(
        module, session_count, start, holidays,
        module_delivery_session_plan=module_delivery_session_plan,
    )


def module_schedule_holidays(schedule, cache=None):
    from curriculum_api.catalogue.application.inherited_calendar import module_schedule_holidays as query
    return query(
        schedule,
        cache,
        module_cohort_selected_holidays=module_cohort_selected_holidays,
    )


def module_session_dates(module, holiday_cache=None):
    from curriculum_api.catalogue.application.session_plans import module_session_dates as query
    return query(
        module,
        holiday_cache,
        module_week_starts_on=module_week_starts_on,
        session_overrides=session_overrides,
        module_schedule_holidays=module_schedule_holidays,
        module_delivery_plan=module_delivery_plan,
    )


def module_session_plan_for_count(module_row, session_count, holidays=None):
    from curriculum_api.catalogue.application.session_plans import module_session_plan_for_count as query
    return query(
        module_row,
        session_count,
        holidays,
        module_cohort_selected_holidays=module_cohort_selected_holidays,
        module_delivery_session_plan=module_delivery_session_plan,
    )


def module_session_plan_for_weeks(module_row, week_count, holidays=None):
    from curriculum_api.catalogue.application.session_plans import module_session_plan_for_weeks as query
    return query(
        module_row,
        week_count,
        holidays,
        module_cohort_selected_holidays=module_cohort_selected_holidays,
        module_delivery_session_plan=module_delivery_session_plan,
    )


def module_week_session_plan(module_row, week_count=0):
    """The dated plan a module's weeks run to, in week order.

    Week N is session N. The module's stored schedule is the authority the
    calendar and the Teams series already read, so the weeks read it too rather
    than each screen re-deriving dates of its own.
    """
    return module_session_plan_for_count(
        module_row,
        module_stored_session_count(module_row, week_count),
    ).get('sessions') or []


def module_week_delivery_slots(module_row, group_row, week_count, *, holidays=None):
    """Every planned delivery slot of each authored week, in delivery order.

    **A week owns one planned slot per delivery day its group runs.** A group
    that meets on Monday gives each week one; a Mon+Fri group gives each week
    two. The Nth live session of the week takes the Nth of them, matched by the
    component's position in ``(display_order, id)`` order -- the one order every
    reader of these rows already walks (the two structure reads, the session
    links and the join-link attach all spell it the same way), so the pairing is
    the same in every process whatever the database returns rows in.

    A live session beyond the week's slot count is an ADDITIONAL one: the group
    does not deliver again that week, so there is no planned date to give it. It
    runs on the date its author gave it, or on none at all.

    The order within a week is the plan's own and is never re-derived here:
    ``build_module_session_plan`` walks a date cursor and emits a slot whenever
    that day is a delivery day, so its slots are already in calendar order and a
    group listed as ``[Friday, Monday]`` still yields Monday before Friday.
    Holiday closures travel on the slots themselves, so a shifted or closed day
    arrives here exactly as the scheduler produced it -- there is no weekday
    arithmetic in this function or in its callers.

    Returns ``(slots_by_week, session_plan)``: one list per authored week in
    week order (empty for a week the plan gives no delivery day at all), and the
    flat plan, so a caller can still match a booked component to its own
    numbered session.
    """
    delivery_module = module_delivery_row(module_row, group_row)
    session_plan = module_session_plan_for_weeks(
        delivery_module, week_count, holidays=holidays,
    ).get('sessions') or []
    slots_by_week_number = defaultdict(list)
    for planned_session in session_plan:
        slots_by_week_number[parse_int(planned_session.get('weekNumber'), 0)].append(planned_session)
    slots_by_week = [list(slots_by_week_number.get(index + 1) or []) for index in range(week_count)]
    return slots_by_week, session_plan
