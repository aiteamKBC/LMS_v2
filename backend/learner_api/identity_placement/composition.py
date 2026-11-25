"""Concrete wiring for the learner identity and placement capability."""

import importlib
import logging

from learner_api.validation import ValidationError

from .application import authorize_ownership, read_placement, resolve_identity
from .application import validate_placement as placement_validation
from .domain.identifiers import VALID_LEARNER_KINDS
from .infrastructure import (
    identity_reads,
    identity_writes,
    ownership_reads,
    placement_reads,
    placement_validation_reads,
)

_identity_logger = logging.getLogger(__name__)


def _warn_ambiguous_email(email, source_pk, twins):
    _identity_logger.warning(
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
        repair_link=identity_writes.repair_enrolment_link,
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


def placement_input(payload):
    return placement_validation.placement_input(payload, error_type=ValidationError)


def validate_placement(fields, current=None, *, using="enrolment"):
    return placement_validation.validate_placement(
        fields,
        current,
        using=using,
        programme_exists=placement_validation_reads.programme_exists,
        cohort_exists=placement_validation_reads.cohort_exists,
        group_exists=placement_validation_reads.group_exists,
        error_type=ValidationError,
    )


def learner_owns_target(account, learner_id):
    return authorize_ownership.learner_owns_target(account, learner_id)


def staff_owns_learner(account, learner_id):
    security = importlib.import_module("login.security")
    return authorize_ownership.staff_owns_learner(
        account,
        learner_id,
        read_linked_enrolment=lambda email: ownership_reads.linked_enrolment_id(
            email,
            normalize_email=security.normalize_email,
        ),
    )


def coach_owns_learner(account, learner_id):
    identity = importlib.import_module("login.identity")
    security = importlib.import_module("login.security")
    constants = importlib.import_module("learner_api.constants")
    return authorize_ownership.coach_owns_learner(
        account,
        learner_id,
        read_authorized_coach_email=lambda staff_id: ownership_reads.authorized_coach_email(
            staff_id,
            normalize_email=security.normalize_email,
            accesses_for_staff=identity.accesses_for_staff,
            coach_access=constants.ACCESS_COACH,
        ),
        caseload_contains=ownership_reads.coach_caseload_contains,
    )
