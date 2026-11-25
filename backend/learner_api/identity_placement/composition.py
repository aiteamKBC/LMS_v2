"""Concrete wiring for the learner identity and placement capability."""

import logging

from .application import read_placement, resolve_identity
from .domain.identifiers import VALID_LEARNER_KINDS
from .infrastructure import identity_reads, placement_reads

_legacy_identity_logger = logging.getLogger("learner_api.identity")


def _warn_ambiguous_email(email, source_pk, twins):
    _legacy_identity_logger.warning(
        "learner_profile_for_source: %s is enrolled more than once "
        "(Created_users %s and %s), so no profile can be resolved. "
        "Merge them with: manage.py merge_duplicate_enrolments "
        "--pairs <keep>:<retire>",
        email,
        source_pk,
        ", ".join(str(pk) for pk in twins),
    )


def learner_profile_for_source(source, source_pk=None, *, active_only=False, heal=True, fields=None):
    return resolve_identity.resolve_profile_for_source(
        source,
        source_pk,
        active_only=active_only,
        heal=heal,
        fields=fields,
        read_exact=identity_reads.profile_by_enrolment,
        read_unlinked_email=identity_reads.unlinked_profile_by_email,
        duplicate_enrolment_ids=identity_reads.duplicate_enrolment_ids,
        repair_link=identity_reads.repair_enrolment_link,
        read_unlinked_profile_id=identity_reads.unlinked_profile_by_id,
        warn_ambiguous_email=_warn_ambiguous_email,
    )


def canonical_learner(kind, enrolment_id):
    LearnerProfile = identity_reads.learner_profile_model()
    return resolve_identity.resolve_canonical_learner(
        kind,
        enrolment_id,
        valid_kinds=VALID_LEARNER_KINDS,
        missing_error=LearnerProfile.DoesNotExist,
        read_exact_kind=identity_reads.canonical_learner_by_kind,
    )


def placement_profile(source):
    EnrolmentUser = identity_reads.enrolment_user_model()
    return read_placement.placement_profile(
        source,
        is_enrolment_source=lambda value: isinstance(value, EnrolmentUser),
        read_profile=placement_reads.profile_for_enrolment,
    )


def with_placements(sources):
    LearnerProfile = placement_reads.learner_profile_model()
    return read_placement.with_placements(
        sources,
        read_profiles=placement_reads.profiles_for_enrolments,
        ambiguous_error=LearnerProfile.MultipleObjectsReturned,
    )


def placement_ids(source):
    return read_placement.placement_ids(source, read_placement_profile=placement_profile)


def placement_payload(source):
    return read_placement.placement_payload(source, read_placement_ids=placement_ids)
