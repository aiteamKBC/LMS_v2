"""Concrete reporting / domain / hours values capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code


def otjh_number(value):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import otjh_number as read
    return read(
        value,
        float_weight=float_weight,
    )


def apply_reflection_otjh_to_learners(learners, reflection_rows):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import apply_reflection_otjh_to_learners as read
    return read(
        learners, reflection_rows,
        float_weight=float_weight,
    )


def scope_authored_plan(module_rows, component_rows, coverage_items):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import scope_authored_plan as read
    return read(
        module_rows, component_rows, coverage_items,
        clean_str=clean_str, coverage_normalise_code=coverage_normalise_code, float_weight=float_weight,
        normalise=normalise, otjh_number=otjh_number,
    )


def learner_plan_group_key(plan, learner):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import learner_plan_group_key as read
    return read(
        plan, learner,
        clean_str=clean_str, normalise=normalise,
    )


def learner_authored_plan(plan, learner, unmatched='scope'):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import learner_authored_plan as read
    return read(
        plan, learner, unmatched,
        float_weight=float_weight, learner_plan_group_key=learner_plan_group_key,
    )


def learner_plans_for_scope(plan, learners):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import learner_plans_for_scope as read
    return read(
        plan, learners,
        learner_authored_plan=learner_authored_plan, learner_plan_group_key=learner_plan_group_key,
    )


def scope_otjh_summary(plan, learner_plans, learners, activities):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.domain.otjh import scope_otjh_summary as read
    return read(
        plan, learner_plans, learners, activities,
        float_weight=float_weight, learner_authored_plan=learner_authored_plan, otjh_number=otjh_number,
    )
