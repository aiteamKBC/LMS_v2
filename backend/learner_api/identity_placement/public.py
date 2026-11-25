"""Supported learner identity and canonical placement read contracts."""

from .domain.identifiers import VALID_LEARNER_KINDS
from .domain.placement import CACHE, FIELDS, RELATIONS

__all__ = (
    "CACHE",
    "FIELDS",
    "RELATIONS",
    "VALID_LEARNER_KINDS",
    "canonical_learner",
    "learner_profile_for_source",
    "placement_ids",
    "placement_payload",
    "placement_profile",
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
