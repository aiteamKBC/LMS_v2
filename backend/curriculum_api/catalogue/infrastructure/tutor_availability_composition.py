"""Concrete catalogue / infrastructure / tutor availability composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import surviving_authoring_module_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import safe_group_delivery_rows
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_dates


def module_slot_clash_dates(left, right, holiday_cache=None):
    from curriculum_api.catalogue.application.tutor_availability import module_slot_clash_dates as query
    return query(
        left,
        right,
        holiday_cache,
        module_session_dates=module_session_dates,
        module_session_clock=module_session_clock,
    )


def tutor_conflict_context(module_rows=None):
    from curriculum_api.catalogue.application.tutor_availability import tutor_conflict_context as query
    return query(
        module_rows,
        safe_group_delivery_rows=safe_group_delivery_rows,
        surviving_authoring_module_rows=surviving_authoring_module_rows,
        module_schedule_view=module_schedule_view,
        module_session_dates=module_session_dates,
    )


def find_tutor_schedule_conflicts(candidate, module_rows=None, exclude_catalogue_ids=(), pending=(), context=None):
    from curriculum_api.catalogue.application.tutor_availability import find_tutor_schedule_conflicts as query
    return query(
        candidate,
        module_rows,
        exclude_catalogue_ids,
        pending,
        context,
        tutor_conflict_context=tutor_conflict_context,
        module_slot_clash_dates=module_slot_clash_dates,
        module_session_clock=module_session_clock,
    )


def tutor_schedule_conflicts_created(before, candidate, **kwargs):
    from curriculum_api.catalogue.application.tutor_availability import tutor_schedule_conflicts_created as query
    return query(
        before,
        candidate,
        clean_str=clean_str,
        staff_assignment_key=staff_assignment_key,
        find_tutor_schedule_conflicts=find_tutor_schedule_conflicts,
        tutor_conflict_context=tutor_conflict_context,
        **kwargs,
    )


def first_tutor_schedule_conflict(candidates, module_rows=None):
    from curriculum_api.catalogue.application.tutor_availability import first_tutor_schedule_conflict as query
    return query(
        candidates,
        module_rows,
        tutor_conflict_context=tutor_conflict_context,
        find_tutor_schedule_conflicts=find_tutor_schedule_conflicts,
    )


def group_tutor_assignment_conflict(group_id, tutor_name, module_rows=None):
    from curriculum_api.catalogue.application.tutor_availability import group_tutor_assignment_conflict as query
    return query(
        group_id,
        tutor_name,
        module_rows,
        safe_authoring_module_rows=safe_authoring_module_rows,
        clean_str=clean_str,
        staff_assignment_key=staff_assignment_key,
        module_schedule_view=module_schedule_view,
        surviving_authoring_module_rows=surviving_authoring_module_rows,
        first_tutor_schedule_conflict=first_tutor_schedule_conflict,
    )
