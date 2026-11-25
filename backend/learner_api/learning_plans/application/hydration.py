"""Coordinate normalized plan hydration without owning persistence details."""

NORMALIZED_PLAN_PREFETCH = "plan_modules__weeks__components"


def hydrate_normalized_plan(
    source,
    profile=None,
    *,
    profile_id=None,
    read_plan,
):
    """Attach the canonical normalized plan to one enrolment source."""
    if hasattr(source, "_canonical_training_plan"):
        return source._canonical_training_plan

    plan = read_plan(source, profile=profile, profile_id=profile_id)
    source._canonical_training_plan = plan
    return plan


def hydrate_normalized_plan_modules(source, profile, *, read_plan):
    """Attach the compact normalized module/week/component tree."""
    if hasattr(source, "_canonical_training_plan"):
        return source._canonical_training_plan

    plan = read_plan(source, profile)
    source._canonical_training_plan = plan
    return plan
