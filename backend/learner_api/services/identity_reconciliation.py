"""Explicit-pair contact reconciliation; never creates or repairs an identity.

The operator command and verified contact synchronization reuse this validator.
Do not attach it to GETs, activation or signals without reviewing writer locks.
Mapping and rollout contract: docs/f01-f02/28-f01-identity-implementation.md.
"""
from dataclasses import dataclass
from uuid import UUID

from learner_api.selectors.identity import validate_profile


class IdentityReconciliationError(Exception):
    """Safe operator failure: codes contain no personal or database payloads."""

    def __init__(self, message="Identity reconciliation refused.", code="identity_review_required", status=409):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class ReconciliationResult:
    status: str
    changed_fields: tuple[str, ...]


def _reconcile_locked(cursor, source_id, profile_id, expected_uuid, *, apply):
    """Internal SQL unit. Caller owns the transaction and rollback boundary."""
    cursor.execute('''SELECT id,uuid,"Username","Email","Phone_number","Learner_type",aptem_id
        FROM enrolment."Created_users" WHERE id=%s OR uuid=%s ORDER BY id FOR UPDATE''',
                   [source_id, expected_uuid])
    sources = cursor.fetchall()
    if not sources:
        raise IdentityReconciliationError(code="missing_source")
    if len(sources) != 1:
        raise IdentityReconciliationError(code="ambiguous_source")
    sid, source_uuid, name, email, phone, kind, aptem = sources[0]
    if sid != source_id or source_uuid != expected_uuid:
        raise IdentityReconciliationError(code="source_identity_conflict")

    cursor.execute('''SELECT id,enrolment_id,uuid,full_name,email,phone_number,learner_type,aptem_id
        FROM "Learner".learners WHERE id=%s OR enrolment_id=%s OR uuid=%s
        ORDER BY id FOR UPDATE''', [profile_id, source_id, expected_uuid])
    profiles = cursor.fetchall()
    if not profiles:
        raise IdentityReconciliationError(code="missing_profile")
    if len(profiles) != 1:
        raise IdentityReconciliationError(code="ambiguous_profile")
    pid, link, profile_uuid, old_name, old_email, old_phone, old_kind, old_aptem = profiles[0]
    if pid != profile_id or link != source_id or profile_uuid != expected_uuid:
        raise IdentityReconciliationError(code="profile_identity_conflict")
    new_name, new_phone = contact_projection(sources[0], profiles[0])
    changed = tuple(field for field, old, new in (
        ("full_name", old_name, new_name), ("phone_number", old_phone, new_phone)
    ) if old != new)
    if not changed:
        return ReconciliationResult("unchanged", ())
    if not apply:
        return ReconciliationResult("would_update", changed)
    cursor.execute('''UPDATE "Learner".learners SET full_name=%s,phone_number=%s
        WHERE id=%s AND enrolment_id=%s AND uuid=%s''',
                   [new_name, new_phone, profile_id, source_id, expected_uuid])
    if cursor.rowcount != 1:
        raise IdentityReconciliationError(code="concurrent_identity_change")
    return ReconciliationResult("updated", changed)


def contact_projection(source, profile):
    """Shared preview/writer rule; IDs and UUIDs are never inferred or replaced."""
    sid, source_uuid, name, email, phone, kind, aptem = source
    pid, link, profile_uuid, old_name, old_email, old_phone, old_kind, old_aptem = profile
    if source_uuid is None or source_uuid != profile_uuid or sid != link:
        raise IdentityReconciliationError(code="profile_identity_conflict")
    validate_profile(dict(account_record_id=sid, account_email=email, email=old_email,
                          account_aptem_id=aptem, aptem_id=old_aptem),
                     error_type=IdentityReconciliationError)
    source_kind = str(kind or "").strip().lower()
    if source_kind not in {"commercial", "apprenticeship"} or source_kind != str(old_kind or "").strip().lower():
        raise IdentityReconciliationError(code="learner_type_conflict")

    # Same NULL/trim/fallback semantics as the existing activation writer.
    new_name = str(name or "").strip() or str(email).strip()
    new_phone = "" if phone is None else str(phone).strip()
    return new_name, new_phone


def reconcile_identity(source_id, profile_id, expected_uuid, *, using, apply=False):
    """Re-read one verified pair and commit contact projection on one connection.

    Explicit failures, no inferred links, no batch discovery and no retries.
    Refuse nested transactions: an 'updated' result must mean commit succeeded.
    Preview takes the same bounded row locks but performs no UPDATE.
    """
    if (type(source_id) is not int or source_id <= 0 or type(profile_id) is not int
            or profile_id <= 0 or type(apply) is not bool):
        raise IdentityReconciliationError(code="invalid_identity")
    try:
        expected_uuid = UUID(str(expected_uuid))
    except (ValueError, TypeError, AttributeError):
        raise IdentityReconciliationError(code="invalid_identity") from None

    from django.db import DatabaseError, connections, transaction

    try:
        connection = connections[using]
        if connection.vendor != "postgresql":
            raise IdentityReconciliationError(code="postgresql_required")
        if connection.in_atomic_block or not connection.get_autocommit():
            raise IdentityReconciliationError(code="outer_transaction_not_allowed")
        with transaction.atomic(using=using, durable=True):
            with connection.cursor() as cursor:
                # Both are transaction-local; do not alter deployment settings.
                cursor.execute("SET LOCAL lock_timeout = '5s'")
                cursor.execute("SET LOCAL statement_timeout = '20s'")
                result = _reconcile_locked(cursor, source_id, profile_id, expected_uuid, apply=apply)
                if apply and result.status == 'updated':
                    from .contact_sync import publish_contact_refresh, invalidate_contact_caches, _verify_worker_connection
                    _verify_worker_connection(connection)
                    scopes = publish_contact_refresh(cursor, source_id)
                    transaction.on_commit(lambda: invalidate_contact_caches(scopes), using=using, robust=True)
        return result
    except DatabaseError:
        raise IdentityReconciliationError("Identity reconciliation failed; no success confirmed.",
                                          "database_error", 503) from None
