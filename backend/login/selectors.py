"""Unused Phase 1 reads against docs/learner-phase1-database/backend-contract.md.

No Django imports, default connection, writes, fallback schema or policy decisions.
Every caller must supply query(sql, params) -> sequence of column-name mappings;
the future adapter must propagate database exceptions, never return [] on error.
Results are immutable read records, not models or public response payloads.

These tables are PROPOSED, not asserted to exist. Integration remains blocked on
DB approval, least-privilege credentials and synchronous writer authority. Staff and
relationship reads return policy INPUTS only; never authorize from copied Role.
"""
import json
from types import MappingProxyType

from learner_api.selectors.identity import validate_profile


class IdentityReviewRequired(ValueError):
    """Ambiguous or inconsistent identity; caller must deny, not choose a row."""


# Fixed identifiers only; user values always go through query parameters.
_ACCOUNT = '''a.id AS account_id, a."Subject_type" AS subject_type,
    a."Subject_id" AS subject_id, a."Email" AS email,
    a."Display_name" AS display_name, a."Role" AS stored_role,
    a."Is_active" AS is_active, a."Last_login_at" AS last_login_at,
    (COALESCE(a."Password_hash", '') <> '') AS has_password'''
_CREDENTIAL = '''a."Password_hash" AS password_hash,
    a."Password_set_at" AS password_set_at,
    a."Failed_attempts" AS failed_attempts, a."Locked_until" AS locked_until'''
_TOKENS = {"invitation": '"Learner"."Invitations"',
           "reset": '"Learner"."Password_resets"'}


def _one(rows):
    if len(rows) > 1:
        raise IdentityReviewRequired("Identity needs review")
    return MappingProxyType(dict(rows[0])) if rows else None


def _email(value):
    return str(value or "").strip().lower()


def _aware(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("An explicit timezone-aware instant is required")


def account_candidates_for_email(email, *, query):
    """At most two active identities across ALL roles; no credential material.

    Zero or two candidates must not authenticate. Use account_for_email for
    the existing ambiguity refusal. No learner-type prefilter is permitted.
    """
    rows = query(f'''SELECT {_ACCOUNT} FROM "Learner"."Login_accounts" a
        WHERE a."Email" = %s AND a."Is_active" = TRUE LIMIT 2''', [_email(email)])
    return tuple(MappingProxyType(dict(row)) for row in rows)


def account_for_email(email, *, query):
    """Existing zero/multiple active-email semantics: return None."""
    rows = account_candidates_for_email(email, query=query)
    return rows[0] if len(rows) == 1 else None


def password_account_for_email(email, *, query):
    """Authentication-only projection including hash/lockout; never serialize.

    Select credentials and identity in one read to avoid an ambiguity-check /
    credential-fetch gap. Password verification remains in the existing owner.
    """
    rows = query(f'''SELECT {_ACCOUNT}, {_CREDENTIAL}
        FROM "Learner"."Login_accounts" a
        WHERE a."Email" = %s AND a."Is_active" = TRUE LIMIT 2''', [_email(email)])
    return _one(rows) if len(rows) == 1 else None


def account_for_subject(subject_type, subject_id, *, query):
    """Typed source subject ID, never canonical learner ID; includes inactive."""
    if subject_type not in ("learner", "staff", "employer"):
        raise ValueError("Unknown subject type")
    return _one(query(f'''SELECT {_ACCOUNT} FROM "Learner"."Login_accounts" a
        WHERE a."Subject_type" = %s AND a."Subject_id" = %s LIMIT 2''',
        [subject_type, subject_id]))


def active_account_by_id(account_id, *, query):
    """Internal login account key, never an enrolment or profile identifier."""
    return _one(query(f'''SELECT {_ACCOUNT} FROM "Learner"."Login_accounts" a
        WHERE a.id=%s AND a."Is_active"=TRUE LIMIT 2''', [account_id]))


def session_with_account(token_hash, *, now, query):
    """Active session snapshot, accepting a digest, never a plaintext cookie.

    Current expires_at rule only: no new absolute-lifetime rejection. Does not
    renew, revoke or refresh staff role. Database failures propagate distinctly.
    """
    _aware(now)
    if not token_hash:
        return None
    row = _one(query(f'''SELECT s.id AS session_id,
        s."Expires_at" AS expires_at, s."Revoked_at" AS revoked_at,
        s."Created_at" AS created_at, s."Last_seen_at" AS last_seen_at,
        s."Remember" AS remember, {_ACCOUNT}
        FROM "Learner"."Login_sessions" s
        JOIN "Learner"."Login_accounts" a ON a.id = s."Account_id"
        WHERE s."Token_hash" = %s AND s."Revoked_at" IS NULL LIMIT 2''',
        [token_hash]))
    if (row is None or row["revoked_at"] is not None
            or row["expires_at"] <= now or not row["is_active"]):
        return None
    return row


def subject_identity_for_account(account_id, *, query):
    """Typed source-subject presence; no account/source ID equality assumption."""
    row = _one(query('''SELECT a.id AS account_id,
        a."Subject_type" AS subject_type, a."Subject_id" AS subject_id,
        (s.subject_id IS NOT NULL) AS subject_present
        FROM "Learner"."Login_accounts" a
        LEFT JOIN "Learner".auth_subjects s
          ON s.subject_type = a."Subject_type" AND s.subject_id = a."Subject_id"
        WHERE a.id = %s LIMIT 2''', [account_id]))
    if row is None:
        return None
    if (row["subject_type"] not in ("learner", "staff", "employer")
            or row["subject_id"] is None or row["subject_present"] is not True):
        raise IdentityReviewRequired("Subject identity needs review")
    return row


def subject_for_account(account_id, *, query):
    """Source facts for /me, including draft subjects with no canonical profile.

    This is not AuthUser: retain account.Display_name, the response envelope,
    existing role/access parser and workspace construction in their owners.
    Missing subjects return None; do not synthesize them from account fields.
    """
    row = _one(query('''SELECT a.id AS account_id, s.subject_type, s.subject_id,
        s.email, s.display_name AS source_display_name, s.learner_type,
        s.programme, s.aptem_id, s.position, s.organisation_ids
        FROM "Learner"."Login_accounts" a
        JOIN "Learner".auth_subjects s
          ON s.subject_type = a."Subject_type" AND s.subject_id = a."Subject_id"
        WHERE a.id = %s LIMIT 2''', [account_id]))
    if row is not None and row["organisation_ids"] is not None:
        # Immutable read record; preserve null versus empty array.
        groups = row["organisation_ids"]
        # Django may configure the PostgreSQL JSONB loader to return text.
        if isinstance(groups, str):
            groups = json.loads(groups)
        if groups is not None and not isinstance(groups, (list, tuple)):
            raise IdentityReviewRequired('Employer organisation IDs need review')
        row = MappingProxyType({**row, "organisation_ids": None if groups is None else tuple(groups)})
    return row


def staff_grants_for_actor(account_id, *, query):
    """Fresh raw primary/extra inputs for existing access parsing, not a role.

    Empty grants remain empty (demotion); no fallback to stored_role.
    """
    row = _one(query('''SELECT a.id AS account_id,
        g.staff_id AS staff_subject_id, g.staff_email AS email,
        g.position, g.primary_access, g.access_extra
        FROM "Learner"."Login_accounts" a
        JOIN "Learner".actor_grants g ON g.staff_id = a."Subject_id"
        WHERE a.id = %s AND a."Subject_type" = 'staff'
        AND a."Is_active" = TRUE LIMIT 2''', [account_id]))
    if row is None or row["staff_subject_id"] is None:
        return None
    return row


_LINK = '''SELECT k.account_id, k.learner_id AS canonical_profile_id,
    k.enrolment_id AS legacy_enrolment_id, e.learner_type,
    k.relationship,
    a."Subject_type" AS subject_type, a."Subject_id" AS subject_id,
    (SELECT COUNT(*) FROM "Learner".learners twin
     WHERE twin.enrolment_id = k.enrolment_id) AS profile_count
    FROM "Learner".account_learner_links k
    JOIN "Learner"."Login_accounts" a ON a.id = k.account_id
    LEFT JOIN "Learner".learner_identity_evidence e ON e.enrolment_id = k.enrolment_id
    WHERE k.account_id = %s AND a."Is_active" = TRUE'''


def _checked_link(row):
    if row is None:
        return None
    types = {"self": "learner", "staff_self": "staff",
             "coach": "staff", "employer": "employer"}
    expected_profiles = 0 if row["canonical_profile_id"] is None else 1
    if (row["legacy_enrolment_id"] is None
            or row["profile_count"] != expected_profiles
            or types.get(row["relationship"]) != row["subject_type"]
            or (row["relationship"] == "self"
                and row["subject_id"] != row["legacy_enrolment_id"])):
        raise IdentityReviewRequired("Learner link needs review")
    return row


def learner_link_for_actor(account_id, *, query):
    """Unique self/staff-study mapping. Missing returns None; ambiguity raises.

    Onboarding may return a null canonical ID. The view preserves the existing
    unique staff email match; no canonical repair or ID substitution is allowed.
    """
    return _checked_link(_one(query(_LINK + '''
        AND k.relationship IN ('self', 'staff_self') LIMIT 2''', [account_id])))


def relationship_for_target(account_id, legacy_enrolment_id, relationship, *, query):
    """One ownership fact, NOT authorization; coach additionally needs a grant.

    Mapping/backfill and freshness of these facts need DB approval. Caller must
    still apply the existing endpoint-specific policy and verified subject gate.
    """
    if relationship not in ("self", "staff_self", "coach", "employer"):
        raise ValueError("Unknown relationship")
    return _checked_link(_one(query(_LINK + '''
        AND k.enrolment_id = %s AND k.relationship = %s LIMIT 2''',
        [account_id, legacy_enrolment_id, relationship])))


def profile_for_enrolment(legacy_enrolment_id, *, query, error_type):
    """Existing canonical projection and validator, with independent evidence.

    error_type(message, code, status) is supplied by the existing service owner;
    preserve identity_review_required/409 and text/null/empty planned hours.
    """
    rows = query('''SELECT l.id,l.enrolment_id,l.aptem_id,l.programme_id,l.full_name AS name,
        coalesce(nullif(btrim(programme.name),''),l.programme_id,'') AS programme,
        l.lifecycle_status,l.programme_status,l.cohort,l.cohort_id,
        l.group_name,l.group_id,l.coach_name,l.coach_email,l.email,l.start_date,l.end_date,l.learner_type,
        e.source_record_id AS account_record_id,e.source_email AS account_email,
        e.source_aptem_id AS account_aptem_id,e.programme_planned_hours,
        EXISTS(SELECT 1 FROM "Learner".progress_transfer_requests t
               WHERE t.enrolment_id=l.enrolment_id) AS progress_transfer_active
        FROM "Learner".learners l
        LEFT JOIN "Learner".learner_identity_evidence e ON e.enrolment_id=l.enrolment_id
        LEFT JOIN curriculum.programmes programme ON programme.programme_id=l.programme_id
        WHERE l.enrolment_id=%s LIMIT 2''', [legacy_enrolment_id])
    if not rows:
        return None
    if len(rows) != 1:
        raise error_type('The consolidated learner identity needs review.', 'identity_review_required', 409)
    return MappingProxyType(dict(validate_profile(rows[0], error_type=error_type)))


def learner_access_facts(legacy_enrolment_id, *, query):
    """Source lifecycle inputs; policy/time-zone interpretation stays with caller."""
    return _one(query('''SELECT enrolment_id, source_record_id, learner_type,
        programme, cohort, start_date, lifecycle_status, programme_status,
        onboarding_status, onboarding_completed, employer_id
        FROM "Learner".learner_identity_evidence WHERE enrolment_id=%s LIMIT 2''',
        [legacy_enrolment_id]))


def cohort_access_facts(cohort_id, *, query):
    """Exact stable-key facts only, including tombstone and unmodified date types.

    Does not replace legacy name/month fallback resolution or London access
    policy. Do not interpret the naive updated_at value in machine local time.
    """
    return _one(query('''SELECT cohort_id, cohort_name, programme_name,
        start_date, updated_at, deleted_at FROM "Learner".cohort_access_facts
        WHERE cohort_id=%s LIMIT 2''', [cohort_id]))


def pending_token(kind, token_hash, *, now, query):
    """Unused/unexpired invitation or reset snapshot, not atomic redemption.

    Missing/used/expired all return None. Inactive accounts remain visible:
    invitations activate them, while current resets do not activate accounts.
    No digest or password hash is returned and no token is consumed.
    """
    if kind not in _TOKENS:
        raise ValueError("Unknown token purpose")
    _aware(now)
    if not token_hash:
        return None
    row = _one(query(f'''SELECT t.id AS token_id, t."Email" AS token_email,
        t."Used_at" AS used_at, t."Expires_at" AS expires_at, {_ACCOUNT}
        FROM {_TOKENS[kind]} t
        JOIN "Learner"."Login_accounts" a ON a.id = t."Account_id"
        WHERE t."Token_hash" = %s LIMIT 2''', [token_hash]))
    if row is None or row["used_at"] is not None or row["expires_at"] <= now:
        return None
    return row


def recent_auth_event_count(*, since, query, only_failures=True,
                            ip=None, email=None, event=None):
    """Inclusive lower time bound; same optional filters as recent_failure_count.

    Counts only, no audit records/PII. Does not introduce an IP throttle.
    """
    _aware(since)
    predicates = ['"Created_at" >= %s']
    params = [since]
    if only_failures:
        predicates.append('"Succeeded" = %s')
        params.append(False)
    for column, value in (("Ip_address", ip), ("Email", email), ("Event", event)):
        if value:
            predicates.append(f'"{column}" = %s')
            params.append(_email(value) if column == "Email" else value)
    row = _one(query('SELECT COUNT(*) AS event_count FROM "Learner"."Login_audit" '
                     + 'WHERE ' + ' AND '.join(predicates), params))
    if row is None or type(row["event_count"]) is not int or row["event_count"] < 0:
        raise IdentityReviewRequired("Invalid audit count result")
    return row["event_count"]
