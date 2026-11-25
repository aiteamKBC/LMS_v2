"""Placement input and relationship validation over explicit capabilities."""

from ..domain import placement_validation as policy


def placement_input(payload, *, error_type):
    try:
        return policy.placement_input(payload)
    except policy.PlacementInputError as exc:
        raise error_type(str(exc)) from None


def validate_placement(
    fields,
    current=None,
    *,
    using="enrolment",
    programme_exists,
    cohort_exists,
    group_exists,
    error_type,
):
    requested = policy.requested_placement(fields)
    if not requested:
        return {}
    programme, cohort, group = policy.effective_placement(requested, current)
    if programme and not programme_exists(programme, using=using):
        raise error_type("Choose an existing programme ID.")
    if cohort and not cohort_exists(cohort, programme, using=using):
        raise error_type("The cohort must belong to the selected programme.")
    if group and not group_exists(group, programme, cohort, using=using):
        raise error_type("The group must belong to the selected programme and cohort.")
    return requested
