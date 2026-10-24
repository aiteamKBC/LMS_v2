"""Read-only identity adapter for Evidence and Reflection lineage.

Canonical identity always comes from the typed enrolment selector. Historical
fallbacks are deliberately separate and report their non-canonical match basis.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum

from .identity import (
    EnrolmentId,
    LearnerProfileId,
    ResolutionStatus,
    resolve_many_for_enrolments,
)


class LineageMatchBasis(str, Enum):
    EXPLICIT_BRIDGE = "explicit_bridge"
    LEGACY_UNIQUE_PRIMARY_EMAIL = "legacy_unique_primary_email"
    LEGACY_NO_EMAIL_EQUAL_PROFILE_PK = "legacy_no_email_equal_profile_pk"


@dataclass(frozen=True)
class LineageResolution:
    status: ResolutionStatus
    requested_enrolment_id: EnrolmentId | None
    profile_id: LearnerProfileId | None = None
    match_basis: LineageMatchBasis | None = None

    @property
    def profile_ids(self):
        return (str(self.profile_id),) if self.profile_id is not None else ()


def _read_rows(cursor, sql, params):
    """Execute one SELECT and expose rows as mappings for the typed core."""
    cursor.execute(sql, params)
    rows = list(cursor.fetchall())
    if not rows:
        return []
    if isinstance(rows[0], Mapping):
        return [dict(row) for row in rows]
    columns = []
    for column in cursor.description or ():
        columns.append(getattr(column, "name", None) or column[0])
    if not columns:
        raise RuntimeError("Identity query did not expose column metadata.")
    return [dict(zip(columns, row)) for row in rows]


def _result(status, requested, *, profile_id=None, match_basis=None):
    return LineageResolution(
        status=status,
        requested_enrolment_id=requested,
        profile_id=LearnerProfileId(int(profile_id)) if profile_id is not None else None,
        match_basis=match_basis,
    )


def _legacy_unique_primary_email(query, requested, account):
    """Resolve one unlinked profile only when the primary email is unique."""
    email = str(account.get("account_email") or "").strip()
    rows = query(
        '''SELECT l.id AS profile_id,
                  count(*) OVER () AS profile_match_count,
                  (SELECT count(*)
                     FROM enrolment."Created_users" same_email
                    WHERE lower(same_email."Email") = lower(%s)
                  ) AS account_email_match_count
             FROM "Learner".learners l
            WHERE l.enrolment_id IS NULL
              AND lower(l.email) = lower(%s)
            ORDER BY l.id
            LIMIT 2''',
        [email, email],
    )
    if len(rows) != 1:
        return _result(
            ResolutionStatus.AMBIGUOUS if rows else ResolutionStatus.MISSING,
            requested,
        )
    row = rows[0]
    try:
        unique_account = int(row.get("account_email_match_count") or 0) == 1
        unique_profile = int(row.get("profile_match_count") or 0) == 1
    except (TypeError, ValueError):
        return _result(ResolutionStatus.AMBIGUOUS, requested)
    if not unique_account or not unique_profile or row.get("profile_id") is None:
        return _result(ResolutionStatus.AMBIGUOUS, requested)
    return _result(
        ResolutionStatus.LEGACY_RESOLVED,
        requested,
        profile_id=row["profile_id"],
        match_basis=LineageMatchBasis.LEGACY_UNIQUE_PRIMARY_EMAIL,
    )


def _normalized_aptem(value):
    value = str(value or "").strip().lstrip("0")
    return value or ""


def _legacy_no_email_equal_profile_pk(query, requested, account):
    """Resolve the historical equal-PK case only when ownership is conflict-free."""
    rows = query(
        '''SELECT l.id AS profile_id,
                  l.aptem_id AS profile_aptem_id,
                  EXISTS (
                      SELECT 1
                        FROM "Learner".learners linked
                       WHERE linked.enrolment_id = %s
                  ) AS explicit_bridge_conflict,
                  EXISTS (
                      SELECT 1
                        FROM enrolment."Created_users" email_owner
                       WHERE email_owner.id <> %s
                         AND nullif(trim(l.email), '') IS NOT NULL
                         AND lower(email_owner."Email") = lower(l.email)
                  ) AS primary_email_owner_conflict,
                  EXISTS (
                      SELECT 1
                        FROM enrolment."Created_users" aptem_owner
                       WHERE aptem_owner.id <> %s
                         AND nullif(trim(l.aptem_id::text), '') IS NOT NULL
                         AND ltrim(trim(aptem_owner.aptem_id::text), '0') =
                             ltrim(trim(l.aptem_id::text), '0')
                  ) AS aptem_owner_conflict
             FROM "Learner".learners l
            WHERE l.id = %s
              AND l.enrolment_id IS NULL''',
        [requested, requested, requested, requested],
    )
    if len(rows) != 1:
        return _result(
            ResolutionStatus.AMBIGUOUS if rows else ResolutionStatus.MISSING,
            requested,
        )
    row = rows[0]
    if (
        row.get("explicit_bridge_conflict")
        or row.get("primary_email_owner_conflict")
        or row.get("aptem_owner_conflict")
    ):
        return _result(ResolutionStatus.AMBIGUOUS, requested)

    account_aptem = _normalized_aptem(account.get("account_aptem_id"))
    profile_aptem = _normalized_aptem(row.get("profile_aptem_id"))
    if account_aptem and account_aptem != profile_aptem:
        return _result(ResolutionStatus.MISMATCH, requested)
    return _result(
        ResolutionStatus.LEGACY_RESOLVED,
        requested,
        profile_id=row["profile_id"],
        match_basis=LineageMatchBasis.LEGACY_NO_EMAIL_EQUAL_PROFILE_PK,
    )


def resolve_lineage_for_enrolment(cursor, enrolment_id):
    """Resolve one already-authorized enrolment to safe lineage profile IDs."""
    raw = str(enrolment_id or "").strip()
    try:
        normalized = int(raw)
    except (TypeError, ValueError):
        return _result(ResolutionStatus.MISSING, None)
    # The previous `id::text = %s` comparisons did not normalize alternate
    # numeric spellings. Retaining that boundary avoids broadening eligibility.
    if raw != str(normalized) or normalized <= 0:
        return _result(ResolutionStatus.MISSING, None)

    requested = EnrolmentId(normalized)
    query = lambda sql, params: _read_rows(cursor, sql, params)
    canonical = resolve_many_for_enrolments([requested], query=query)[requested]
    if canonical.status is ResolutionStatus.RESOLVED:
        return _result(
            ResolutionStatus.RESOLVED,
            requested,
            profile_id=canonical.identity.profile_id,
            match_basis=LineageMatchBasis.EXPLICIT_BRIDGE,
        )
    if canonical.status in (ResolutionStatus.AMBIGUOUS, ResolutionStatus.MISMATCH):
        return _result(canonical.status, requested)

    accounts = query(
        '''SELECT u.id AS account_record_id,
                  u."Email" AS account_email,
                  u.aptem_id AS account_aptem_id
             FROM enrolment."Created_users" u
            WHERE u.id = %s''',
        [requested],
    )
    if len(accounts) != 1:
        return _result(
            ResolutionStatus.AMBIGUOUS if accounts else ResolutionStatus.MISSING,
            requested,
        )
    account = accounts[0]
    if str(account.get("account_email") or "").strip():
        return _legacy_unique_primary_email(query, requested, account)
    return _legacy_no_email_equal_profile_pk(query, requested, account)
