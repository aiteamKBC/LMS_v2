"""Supported learner identity and canonical placement read contracts."""

from .domain.identifiers import VALID_LEARNER_KINDS
from .domain.placement import CACHE, FIELDS, RELATIONS

__all__ = (
    "CACHE",
    "FIELDS",
    "RELATIONS",
    "VALID_LEARNER_KINDS",
    "audit_admin_learner_action",
    "canonical_learner",
    "coach_owns_learner",
    "learner_owns_target",
    "learner_profile_for_source",
    "learner_self_only",
    "learner_self_or_admin",
    "learner_self_or_staff",
    "placement_ids",
    "placement_input",
    "placement_payload",
    "placement_profile",
    "staff_owns_learner",
    "validate_placement",
    "with_placements",
)


def learner_profile_for_source(source, source_pk=None, *, active_only=False, heal=True, fields=None):
    from .composition import learner_profile_for_source as implementation

    return implementation(
        source,
        source_pk,
        active_only=active_only,
        heal=heal,
        fields=fields,
    )


def canonical_learner(kind, enrolment_id):
    from .composition import canonical_learner as implementation

    return implementation(kind, enrolment_id)


def placement_profile(source):
    from .composition import placement_profile as implementation

    return implementation(source)


def with_placements(sources):
    from .composition import with_placements as implementation

    return implementation(sources)


def placement_ids(source):
    from .composition import placement_ids as implementation

    return implementation(source)


def placement_payload(source):
    from .composition import placement_payload as implementation

    return implementation(source)


def placement_input(payload):
    from .composition import placement_input as implementation

    return implementation(payload)


def validate_placement(fields, current=None, *, using="enrolment"):
    from .composition import validate_placement as implementation

    return implementation(fields, current, using=using)


def learner_owns_target(account, learner_id):
    from .composition import learner_owns_target as implementation

    return implementation(account, learner_id)


def staff_owns_learner(account, learner_id):
    from .composition import staff_owns_learner as implementation

    return implementation(account, learner_id)


def coach_owns_learner(account, learner_id):
    from .composition import coach_owns_learner as implementation

    return implementation(account, learner_id)


def learner_self_only(*, kwarg=None, query_param=None, body_field=None):
    from .api.authorization import learner_self_only as implementation

    return implementation(kwarg=kwarg, query_param=query_param, body_field=body_field)


def learner_self_or_staff(*, kwarg=None, query_param=None, body_field=None):
    from .api.authorization import learner_self_or_staff as implementation

    return implementation(kwarg=kwarg, query_param=query_param, body_field=body_field)


def learner_self_or_admin(*, kwarg=None, query_param=None, body_field=None):
    from .api.authorization import learner_self_or_admin as implementation

    return implementation(kwarg=kwarg, query_param=query_param, body_field=body_field)


def audit_admin_learner_action(request, learner_id, response):
    from .api.authorization import audit_admin_learner_action as implementation

    return implementation(request, learner_id, response)
