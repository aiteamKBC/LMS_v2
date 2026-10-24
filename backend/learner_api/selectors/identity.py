"""Read canonical identity for an already-authorized enrolment.

The caller supplies its current query callable and error class, retaining its
existing database alias, request cache and error boundary. No repairs occur here.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Mapping, NewType


# These domains deliberately remain distinct to static analysis even though
# three are represented by integers at runtime. A matching number is not a
# relationship between login, enrolment and Learner profile records.
AccountId = NewType("AccountId", int)
EnrolmentId = NewType("EnrolmentId", int)
LearnerProfileId = NewType("LearnerProfileId", int)
AptemLearnerId = NewType("AptemLearnerId", str)


class ResolutionStatus(str, Enum):
    RESOLVED = "resolved"
    MISSING = "missing"
    AMBIGUOUS = "ambiguous"
    MISMATCH = "mismatch"
    # Reserved for a separately approved compatibility adapter. The canonical
    # selector never infers identity through email or equal numeric keys.
    LEGACY_RESOLVED = "legacy_resolved"


@dataclass(frozen=True)
class CanonicalLearnerIdentity:
    enrolment_id: EnrolmentId
    profile_id: LearnerProfileId
    aptem_id: AptemLearnerId | None
    learner_kind: str
    # Login_accounts.id is not present in this selector's query. In particular,
    # account_record_id below is Created_users.id and must not populate this.
    account_id: AccountId | None = None


@dataclass(frozen=True)
class IdentityResolution:
    status: ResolutionStatus
    requested_enrolment_id: EnrolmentId
    identity: CanonicalLearnerIdentity | None = None
    profile: Mapping[str, object] | None = None

    @property
    def resolved(self):
        return self.status is ResolutionStatus.RESOLVED


_BATCH_METADATA_FIELDS = frozenset({
    "requested_enrolment_id",
    "requested_position",
    "account_match_count",
})


def _profile_matches_canonical_identity(owner):
    """Return the existing profile/account validation verdict without raising."""
    email = str(owner.get('email') or '').strip().casefold()
    account_email = str(owner.get('account_email') or '').strip().casefold()
    aptem = str(owner.get('account_aptem_id') or '').strip().lstrip('0')
    return not (
        owner.get('account_record_id') is None
        or not email
        or email != account_email
        or (aptem and aptem != str(owner.get('aptem_id') or '').lstrip('0'))
    )


def _canonical_identity(owner):
    aptem = str(owner.get("aptem_id") or "").lstrip("0")
    return CanonicalLearnerIdentity(
        enrolment_id=EnrolmentId(int(owner["enrolment_id"])),
        profile_id=LearnerProfileId(int(owner["id"])),
        aptem_id=AptemLearnerId(aptem) if aptem else None,
        learner_kind=str(owner.get("learner_type") or ""),
    )


def _resolution(status, enrolment_id, *, owner=None):
    identity = _canonical_identity(owner) if status is ResolutionStatus.RESOLVED else None
    profile = (
        {key: value for key, value in owner.items() if key not in _BATCH_METADATA_FIELDS}
        if owner is not None and status is ResolutionStatus.RESOLVED
        else None
    )
    return IdentityResolution(
        status=status,
        requested_enrolment_id=enrolment_id,
        identity=identity,
        profile=profile,
    )


def resolve_many_for_enrolments(enrolment_ids, *, query):
    """Resolve authorized enrolment IDs in one read-only query.

    The returned mapping follows first-seen input order and contains one outcome
    for every distinct normalized enrolment ID. Authorization is intentionally
    outside this selector and must already have been applied by the caller.
    """
    requested = list(dict.fromkeys(
        EnrolmentId(int(value)) for value in (enrolment_ids or ())
    ))
    if not requested:
        return {}

    records = query('''WITH requested(enrolment_id, position) AS (
        SELECT value::bigint, position
          FROM unnest(%s::bigint[]) WITH ORDINALITY AS input(value, position)
    ), account_matches AS (
        SELECT requested.enrolment_id AS requested_enrolment_id,
               requested.position AS requested_position,
               u.id AS account_record_id,u."Email" AS account_email,
               u.aptem_id AS account_aptem_id,
               u."Planned_hours" AS programme_planned_hours,
               count(u.id) OVER (
                   PARTITION BY requested.enrolment_id
               ) AS account_match_count
          FROM requested
          LEFT JOIN enrolment."Created_users" u ON u.id=requested.enrolment_id
    )
    SELECT accounts.requested_enrolment_id,accounts.requested_position,
        accounts.account_match_count,
        l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        accounts.account_record_id,accounts.account_email,accounts.account_aptem_id,
        accounts.programme_planned_hours,
        EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t
               WHERE t.enrolment_id=l.enrolment_id) AS progress_transfer_active
      FROM account_matches accounts
      LEFT JOIN "Learner".learners l ON l.enrolment_id=accounts.account_record_id
     ORDER BY accounts.requested_position,l.id''', [requested])

    grouped = {enrolment_id: [] for enrolment_id in requested}
    for owner in records:
        try:
            enrolment_id = EnrolmentId(int(owner.get("requested_enrolment_id")))
        except (TypeError, ValueError):
            continue
        if enrolment_id in grouped:
            grouped[enrolment_id].append(owner)

    outcomes = {}
    for enrolment_id, candidates in grouped.items():
        if not candidates:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.MISSING, enrolment_id)
            continue

        declared_account_counts = {
            int(owner["account_match_count"])
            for owner in candidates
            if owner.get("account_match_count") is not None
        }
        if declared_account_counts == {0}:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.MISSING, enrolment_id)
            continue
        if declared_account_counts and declared_account_counts != {1}:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.AMBIGUOUS, enrolment_id)
            continue

        account_candidates = [
            owner for owner in candidates if owner.get("account_record_id") is not None
        ]
        if not account_candidates:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.MISSING, enrolment_id)
            continue

        profile_candidates = [
            owner for owner in account_candidates if owner.get("id") is not None
        ]
        if not profile_candidates:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.MISSING, enrolment_id)
        elif len(profile_candidates) != 1:
            outcomes[enrolment_id] = _resolution(ResolutionStatus.AMBIGUOUS, enrolment_id)
        elif not _profile_matches_canonical_identity(profile_candidates[0]):
            outcomes[enrolment_id] = _resolution(ResolutionStatus.MISMATCH, enrolment_id)
        else:
            outcomes[enrolment_id] = _resolution(
                ResolutionStatus.RESOLVED,
                enrolment_id,
                owner=profile_candidates[0],
            )
    return outcomes


def profile_for_enrolment(enrolment_id, *, query, error_type):
    records = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        l.programme,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        u.id AS account_record_id,u."Email" AS account_email,u.aptem_id AS account_aptem_id,
        u."Planned_hours" AS programme_planned_hours,
        EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t WHERE t.enrolment_id=l.enrolment_id) AS progress_transfer_active
        FROM "Learner".learners l
        LEFT JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
        WHERE l.enrolment_id=%s''', [enrolment_id])
    if not records:
        return None
    if len(records) != 1:
        raise error_type('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return validate_profile(records[0], error_type=error_type)


def validate_profile(owner, *, error_type):
    if not _profile_matches_canonical_identity(owner):
        raise error_type('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return owner
