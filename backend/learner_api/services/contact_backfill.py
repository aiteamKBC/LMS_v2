"""Private manifest preparation and guarded contact-only apply/rollback units.

No live apply CLI exists. The cursor must belong to the caller's verified single
transaction; receipts must be durably encrypted before a future real commit.
"""
from collections import Counter
from uuid import UUID

from .identity_reconciliation import IdentityReconciliationError, contact_projection, _reconcile_locked
from .contact_sync import publish_contact_refresh


SOURCE = '''SELECT id,uuid,"Username","Email","Phone_number","Learner_type",aptem_id,
    md5(to_jsonb(u)::text) FROM enrolment."Created_users" u'''
PROFILE = '''SELECT id,enrolment_id,uuid,full_name,email,phone_number,learner_type,aptem_id,
    md5(to_jsonb(l)::text),md5((to_jsonb(l)-'full_name'-'phone_number'-'updated_at')::text),updated_at
    FROM "Learner".learners l'''
SCHEMA = '''SELECT md5(string_agg(value,'|' ORDER BY value)) FROM (
    SELECT pg_get_triggerdef(t.oid)||pg_get_functiondef(t.tgfoid) AS value FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgrelid IN ('"Learner".learners'::regclass,
        'enrolment."Created_users"'::regclass,'public.platform_read_model_outbox'::regclass,
        'public.platform_read_models'::regclass)
    UNION ALL SELECT indexdef FROM pg_indexes WHERE (schemaname='Learner' AND tablename='learners')
        OR (schemaname='enrolment' AND tablename='Created_users')
        OR (schemaname='public' AND tablename IN ('platform_read_model_outbox','platform_read_models'))
    UNION ALL SELECT table_schema||table_name||column_name||data_type||is_nullable||coalesce(column_default,'')
      FROM information_schema.columns WHERE (table_schema='Learner' AND table_name='learners')
        OR (table_schema='enrolment' AND table_name='Created_users')
        OR (table_schema='public' AND table_name IN ('platform_read_model_outbox','platform_read_models'))
) metadata'''


def prepare_manifest(cursor):
    """Read all identities once under the caller's READ ONLY consistent snapshot."""
    cursor.execute(SOURCE + ' ORDER BY id')
    sources = cursor.fetchall()
    cursor.execute(PROFILE + ' ORDER BY id')
    profiles = cursor.fetchall()
    by_source = {s[0]: s for s in sources}
    source_uuids = Counter(s[1] for s in sources)
    profile_uuids = Counter(p[2] for p in profiles)
    links = Counter(p[1] for p in profiles if p[1] is not None)
    counts = Counter(source_rows=len(sources), profile_rows=len(profiles))
    candidates, excluded = [], []
    for profile in profiles:
        pid, sid = profile[:2]
        source = by_source.get(sid)
        reason = None
        if sid is None:
            reason = "unlinked_profiles"
        elif source is None:
            reason = "dangling_profiles"
        elif links[sid] != 1 or source_uuids[source[1]] != 1 or profile_uuids[profile[2]] != 1:
            reason = "ambiguous_profiles"
        else:
            try:
                name, phone = contact_projection(source[:7], profile[:8])
            except IdentityReconciliationError as exc:
                reason = exc.code
        if reason:
            counts[reason] += 1
            excluded.append(dict(profile_id=pid, source_id=sid, reason=reason))
            continue
        if (name, phone) == (profile[3], profile[5]):
            counts["already_correct"] += 1
            continue
        counts["candidates"] += 1
        counts["name_changes"] += int(name != profile[3])
        counts["phone_changes"] += int(phone != profile[5])
        candidates.append(dict(source_id=sid, profile_id=pid, uuid=str(source[1]),
                               source_digest=source[7], target_digest=profile[8], other_digest=profile[9],
                               original_name=profile[3], original_phone=profile[5],
                               original_updated_at=profile[10].isoformat(), name=name, phone=phone))
    for source in sources:
        if source[0] not in links:
            counts["sources_without_profile"] += 1
            excluded.append(dict(source_id=source[0], reason="sources_without_profile"))
    cursor.execute(SCHEMA)
    schema_digest = cursor.fetchone()[0]
    cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
    database, branch = cursor.fetchone()
    return dict(version=1, rows=candidates, counts=dict(counts), excluded=excluded,
                schema_digest=schema_digest, database=database, branch_id=branch)


def run_manifest(cursor, manifest, *, apply=False, rollback=False, receipts=None):
    """Guard every allowlisted pair before a write; transaction aborts on failure.

    Preview is the default. Replay is a no-op only with unchanged source and
    non-contact profile state and exact desired values. Rollback requires a
    matching full post-apply receipt; never restore a whole row or timestamp.
    """
    rows = manifest["rows"]
    if manifest.get("version") != 1 or (rollback and not apply):
        raise IdentityReconciliationError(code="invalid_manifest")
    for key in ("source_id", "profile_id", "uuid"):
        if len({row[key] for row in rows}) != len(rows):
            raise IdentityReconciliationError(code="duplicate_manifest_identity")
    if cursor.connection.autocommit:
        raise IdentityReconciliationError(code="transaction_required")
    cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
    if cursor.fetchone() != (manifest.get("database"), manifest.get("branch_id")) or not manifest.get("branch_id"):
        raise IdentityReconciliationError(code="manifest_database_mismatch")
    cursor.execute(SCHEMA)
    if cursor.fetchone()[0] != manifest["schema_digest"]:
        raise IdentityReconciliationError(code="schema_drift")
    outcomes = []
    for row in sorted(rows, key=lambda r: r["source_id"]):
        sid, pid, uid = row["source_id"], row["profile_id"], UUID(row["uuid"])
        cursor.execute(SOURCE + ' WHERE id=%s FOR UPDATE', [sid])
        source = cursor.fetchone()
        cursor.execute(PROFILE + ' WHERE id=%s FOR UPDATE', [pid])
        profile = cursor.fetchone()
        if source is None or profile is None or source[1] != uid or profile[2] != uid or profile[1] != sid:
            raise IdentityReconciliationError(code="manifest_identity_drift")
        wanted = contact_projection(source[:7], profile[:8])
        if (source[7] != row["source_digest"] or profile[9] != row["other_digest"]
                or wanted != (row["name"], row["phone"])):
            raise IdentityReconciliationError(code="manifest_value_drift")
        if rollback:
            receipt = (receipts or {}).get(str(pid))
            if not receipt or profile[8] != receipt:
                raise IdentityReconciliationError(code="rollback_receipt_mismatch")
            cursor.execute('UPDATE "Learner".learners SET full_name=%s,phone_number=%s WHERE id=%s',
                           [row["original_name"], row["original_phone"], pid])
            publish_contact_refresh(cursor, sid)
            status = "restored"
        elif (profile[3], profile[5]) == wanted:
            status = "already_applied"
        else:
            if profile[8] != row["target_digest"]:
                raise IdentityReconciliationError(code="manifest_target_drift")
            result = _reconcile_locked(cursor, sid, pid, uid, apply=apply)
            status = result.status
            if apply:
                publish_contact_refresh(cursor, sid)
        cursor.execute('SELECT md5(to_jsonb(l)::text) FROM "Learner".learners l WHERE id=%s', [pid])
        outcomes.append(dict(profile_id=pid, status=status, digest=cursor.fetchone()[0]))
    return outcomes
