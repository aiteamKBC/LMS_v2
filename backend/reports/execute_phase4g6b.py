"""Execute the tightly scoped Phase 4G.6B grant and synthetic fixture.

The coordinator exists only for the provisioning critical section.  It owns
the sequence lock, recomputes the free range, restarts the sequence and invokes
the already-audited fixture function in one transaction.  No secret is printed.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
from hashlib import sha256
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.parse import urlsplit
from uuid import uuid4

import psycopg
from psycopg.types.json import Jsonb


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.benchmark_credentials import read_benchmark_reader_url  # noqa: E402
from reports.provision_phase4g6_fixture import (  # noqa: E402
    BRANCH_ID,
    DATABASE_NAME,
    DIRECT_HOST,
    ENDPOINT_ID,
    FIXTURE_OWNER_ROLE,
    HANDLE_CREDENTIAL,
    OWNER_ROLE,
    PROVISIONER_CREDENTIAL,
    PROVISIONER_ROLE,
    READER_ROLE,
    SESSION_CREDENTIAL,
    TARGET_TABLES,
    _cleanup_rehearsal,
    _owner_dsn,
    _verify_fixture,
    _write_credential,
)


CONTROL_SCHEMA = "phase4g6b_control"
COORDINATOR = CONTROL_SCHEMA + ".coordinate_fixture(bigint)"
READER_CREDENTIAL = "LMS_v2/phase4g2/lms_benchmark_reader"
AUTH_VERIFIER = Path(__file__).with_name("verify_phase4g6b_auth.py")


def _credential_url(target: str) -> str:
    env = {
        "LMS_BENCHMARK_READER_CREDENTIAL_TARGET": target,
        "LMS_BENCHMARK_READER_URL": "",
    }
    return read_benchmark_reader_url(env)


def _validate_role_url(value: str, role: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.username != role
        or (parsed.hostname or "").casefold() != DIRECT_HOST
        or parsed.path.lstrip("/") != DATABASE_NAME
    ):
        raise RuntimeError(f"{role} credential is not pinned to the approved target")
    return value


def _delete_credential(target: str) -> None:
    if os.name != "nt":
        return
    api = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    api.CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    api.CredDeleteW.restype = wintypes.BOOL
    if not api.CredDeleteW(target, 1, 0):
        error = ctypes.get_last_error()
        if error != 1168:  # ERROR_NOT_FOUND
            raise ctypes.WinError(error)


def _identity(cursor, expected_role: str, read_only: str) -> None:
    cursor.execute(
        """SELECT current_user,current_database(),
                  current_setting('neon.branch_id',true),
                  current_setting('neon.endpoint_id',true),
                  current_setting('transaction_read_only')"""
    )
    if cursor.fetchone() != (
        expected_role, DATABASE_NAME, BRANCH_ID, ENDPOINT_ID, read_only
    ):
        raise RuntimeError(f"{expected_role} failed the exact target identity guard")


def _table_counts(cursor) -> dict[str, int]:
    result = {}
    for table in TARGET_TABLES:
        cursor.execute(f"SELECT count(*) FROM {table}")
        result[table] = cursor.fetchone()[0]
    return result


def _reward_fingerprints(cursor) -> dict[str, list[object]]:
    result = {}
    for table in (
        '"Engagement".shared_reward_saved_progress',
        '"Engagement".shared_reward_outbox',
    ):
        cursor.execute(
            f"""SELECT count(*),min(progress_id),max(progress_id),
                 md5(coalesce(string_agg(md5(to_jsonb(t)::text),''
                     ORDER BY progress_id,md5(to_jsonb(t)::text)),''))
                 FROM {table} t"""
        )
        result[table] = list(cursor.fetchone())
    return result


def _safe_state(cursor) -> dict[str, object]:
    cursor.execute(
        """SELECT last_value,is_called,
                  CASE WHEN is_called THEN last_value+1 ELSE last_value END
           FROM "Learner".learner_progress_entries_id_seq"""
    )
    last_value, is_called, next_value = cursor.fetchone()
    cursor.execute('SELECT max(id),count(*) FROM "Learner".learner_progress_entries')
    max_progress, progress_count = cursor.fetchone()
    cursor.execute(
        """SELECT
          (SELECT max(progress_id) FROM "Engagement".shared_reward_saved_progress),
          (SELECT max(progress_id) FROM "Engagement".shared_reward_outbox),
          (SELECT count(*) FROM "Engagement".shared_reward_saved_progress s
             WHERE NOT EXISTS (SELECT 1 FROM "Learner".learner_progress_entries p
                               WHERE p.id=s.progress_id))"""
    )
    max_saved, max_outbox, orphan_saved = cursor.fetchone()
    upper = max(next_value, max_progress or 0, max_saved or 0, max_outbox or 0) + 1
    if upper - next_value > 1_000_000:
        raise RuntimeError("Safe-window search exceeds the approved bound")
    cursor.execute(
        """WITH refs(id) AS MATERIALIZED (
             SELECT id FROM "Learner".learner_progress_entries
             UNION SELECT progress_id FROM "Engagement".shared_reward_saved_progress
             UNION SELECT progress_id FROM "Engagement".shared_reward_outbox
           )
           SELECT candidate
           FROM generate_series(%s::bigint,%s::bigint) candidate
           WHERE NOT EXISTS (
             SELECT 1 FROM refs WHERE id BETWEEN candidate AND candidate+356
           ) ORDER BY candidate LIMIT 1""",
        (next_value, upper),
    )
    safe = cursor.fetchone()[0]
    return {
        "last_value": last_value,
        "is_called": is_called,
        "next_value": next_value,
        "progress_count": progress_count,
        "max_progress_id": max_progress,
        "max_saved_reward_progress_id": max_saved,
        "max_outbox_progress_id": max_outbox,
        "orphan_saved_reward_rows": orphan_saved,
        "safe_start": safe,
        "safe_end": safe + 356,
    }


def _preflight(owner_dsn: str) -> dict[str, object]:
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            _identity(cursor, OWNER_ROLE, "on")
            cursor.execute(
                """SELECT count(*) FROM pg_stat_activity
                   WHERE datname=current_database() AND pid<>pg_backend_pid()
                     AND backend_type='client backend'"""
            )
            other_sessions = cursor.fetchone()[0]
            cursor.execute(
                """SELECT count(*) FROM pg_locks l
                   WHERE l.pid<>pg_backend_pid() AND l.granted
                     AND l.relation IN (
                       '"Learner".learner_progress_entries'::regclass,
                       '"Learner".learner_progress_entries_id_seq'::regclass,
                       '"Engagement".shared_reward_saved_progress'::regclass,
                       '"Engagement".shared_reward_outbox'::regclass)"""
            )
            relevant_locks = cursor.fetchone()[0]
            if other_sessions or relevant_locks:
                raise RuntimeError("Unexpected database sessions or relevant locks are active")
            cursor.execute(
                """SELECT to_regnamespace(%s) IS NULL,to_regprocedure(%s) IS NULL,
                          to_regprocedure('benchmark_admin.provision_phase4g_fixture(text,text,timestamptz)') IS NOT NULL,
                          to_regprocedure('benchmark_admin.cleanup_phase4g_fixture(jsonb)') IS NOT NULL,
                          to_regrole(%s) IS NOT NULL,to_regrole(%s) IS NOT NULL,
                          (SELECT count(*) FROM benchmark_admin.fixture_receipts),
                          (SELECT count(*) FROM enrolment."Created_users"
                           WHERE "Programme" LIKE 'phase4g_%%')""",
                (CONTROL_SCHEMA, COORDINATOR, FIXTURE_OWNER_ROLE, PROVISIONER_ROLE),
            )
            object_state = cursor.fetchone()
            if object_state != (True, True, True, True, True, True, 0, 0):
                raise RuntimeError("Fixture security objects are not in the expected empty state")
            cursor.execute(
                """SELECT d.deptype,pg_get_userbyid(c.relowner)
                   FROM pg_class c JOIN pg_depend d ON d.objid=c.oid
                   WHERE c.oid='"Learner".learner_progress_entries_id_seq'::regclass
                     AND d.refobjid='"Learner".learner_progress_entries'::regclass"""
            )
            dependency = cursor.fetchone()
            if dependency != ("i", OWNER_ROLE):
                raise RuntimeError("Progress identity sequence ownership changed")
            baseline_counts = _table_counts(cursor)
            rewards = _reward_fingerprints(cursor)
            sequence = _safe_state(cursor)
        connection.rollback()
    return {
        "other_client_sessions": other_sessions,
        "relevant_locks": relevant_locks,
        "sequence_dependency": list(dependency),
        "baseline_counts": baseline_counts,
        "reward_fingerprints": rewards,
        "sequence": sequence,
    }


def _reader_checks(dsn: str, expected_column: bool | None) -> dict[str, object]:
    with psycopg.connect(dsn) as connection:
        with connection.cursor() as cursor:
            _identity(cursor, READER_ROLE, "on")
            cursor.execute(
                """SELECT
                  has_column_privilege(current_user,'"Learner".progress_transfer_requests','enrolment_id','SELECT'),
                  has_table_privilege(current_user,'"Learner".progress_transfer_requests','SELECT'),
                  has_database_privilege(current_user,current_database(),'TEMP'),
                  has_schema_privilege(current_user,'Learner','CREATE'),
                  (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),
                  (SELECT count(*) FROM pg_auth_members m
                     JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=current_user),
                  (SELECT count(*) FROM information_schema.role_table_grants
                     WHERE grantee=current_user AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'))"""
            )
            values = cursor.fetchone()
        connection.rollback()
    expected = (values[0] if expected_column is None else expected_column,
                False, False, False, False, 0, 0)
    if values != expected:
        raise RuntimeError("Reader effective privileges are not the exact expected set")
    return {
        "column_select": values[0], "table_select": values[1],
        "temp": values[2], "learner_schema_create": values[3],
        "bypassrls": values[4], "memberships": values[5], "dml_grants": values[6],
    }


def _apply_reader_grant(owner_dsn: str) -> None:
    with psycopg.connect(owner_dsn) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                _identity(cursor, OWNER_ROLE, "off")
                cursor.execute(
                    'GRANT SELECT (enrolment_id) ON TABLE "Learner".progress_transfer_requests TO lms_benchmark_reader'
                )


COORDINATOR_SQL = r"""
CREATE FUNCTION phase4g6b_control.coordinate_fixture(
  p_expected_start bigint DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $function$
DECLARE
  v_next bigint;
  v_upper bigint;
  v_safe bigint;
  v_seq_last bigint;
  v_seq_called boolean;
BEGIN
  IF session_user <> 'lms_fixture_provisioner' THEN
    RAISE EXCEPTION 'Coordinator caller is not the provisioner';
  END IF;
  IF current_database()<>'neondb'
     OR current_setting('neon.branch_id',true)<>'br-orange-shadow-abm8uwwe'
     OR current_setting('neon.endpoint_id',true)<>'ep-dawn-block-ab5vob3x' THEN
    RAISE EXCEPTION 'Coordinator target identity mismatch';
  END IF;
  IF p_expected_start IS NOT NULL THEN
    SELECT last_value,is_called INTO v_seq_last,v_seq_called
      FROM "Learner".learner_progress_entries_id_seq;
    IF v_seq_last<>p_expected_start+356 OR NOT v_seq_called THEN
      RAISE EXCEPTION 'Coordinator post-provision identity assertion failed';
    END IF;
    RETURN p_expected_start;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('phase4g.fixture',0));

  -- CACHE is already 1.  This no-op ALTER obtains the sequence relation lock
  -- before table locks, so every direct nextval consumer must wait.  NOWAIT on
  -- the tables makes the inverse lock order fail closed instead of deadlocking.
  ALTER SEQUENCE "Learner".learner_progress_entries_id_seq CACHE 1;
  LOCK TABLE "Learner".learner_progress_entries,
             "Engagement".shared_reward_saved_progress,
             "Engagement".shared_reward_outbox
    IN SHARE ROW EXCLUSIVE MODE NOWAIT;

  SELECT CASE WHEN is_called THEN last_value+1 ELSE last_value END
    INTO v_next FROM "Learner".learner_progress_entries_id_seq;
  SELECT greatest(v_next,
      coalesce((SELECT max(id)+1 FROM "Learner".learner_progress_entries),v_next),
      coalesce((SELECT max(progress_id)+1 FROM "Engagement".shared_reward_saved_progress),v_next),
      coalesce((SELECT max(progress_id)+1 FROM "Engagement".shared_reward_outbox),v_next))
    INTO v_upper;
  IF v_upper-v_next > 1000000 THEN
    RAISE EXCEPTION 'Coordinator safe-window search exceeds bound';
  END IF;
  WITH refs(id) AS MATERIALIZED (
    SELECT id FROM "Learner".learner_progress_entries
    UNION SELECT progress_id FROM "Engagement".shared_reward_saved_progress
    UNION SELECT progress_id FROM "Engagement".shared_reward_outbox
  )
  SELECT candidate INTO v_safe
  FROM generate_series(v_next,v_upper) candidate
  WHERE NOT EXISTS (SELECT 1 FROM refs WHERE id BETWEEN candidate AND candidate+356)
  ORDER BY candidate LIMIT 1;
  IF v_safe IS NULL OR v_safe<v_next THEN
    RAISE EXCEPTION 'No forward collision-free fixture interval';
  END IF;

  EXECUTE format('ALTER SEQUENCE %I.%I RESTART WITH %s',
                 'Learner','learner_progress_entries_id_seq',v_safe);
  RETURN v_safe;
END
$function$
"""


def _install_coordinator(owner_dsn: str) -> None:
    with psycopg.connect(owner_dsn) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                _identity(cursor, OWNER_ROLE, "off")
                cursor.execute("SELECT to_regprocedure(%s) IS NULL", (COORDINATOR,))
                if not cursor.fetchone()[0]:
                    raise RuntimeError("Coordinator already exists")
                cursor.execute("CREATE SCHEMA " + CONTROL_SCHEMA)
                cursor.execute("REVOKE ALL ON SCHEMA " + CONTROL_SCHEMA + " FROM PUBLIC")
                cursor.execute("GRANT USAGE ON SCHEMA " + CONTROL_SCHEMA + " TO " + PROVISIONER_ROLE)
                cursor.execute(COORDINATOR_SQL, prepare=False)
                cursor.execute(
                    "REVOKE ALL ON FUNCTION " + COORDINATOR + " FROM PUBLIC," + PROVISIONER_ROLE
                )
                cursor.execute(
                    "GRANT EXECUTE ON FUNCTION " + COORDINATOR + " TO " + PROVISIONER_ROLE
                )


def _drop_coordinator(owner_dsn: str) -> None:
    with psycopg.connect(owner_dsn) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                _identity(cursor, OWNER_ROLE, "off")
                cursor.execute("DROP FUNCTION IF EXISTS " + COORDINATOR)
                cursor.execute("DROP SCHEMA IF EXISTS " + CONTROL_SCHEMA)


def _provision(provisioner_dsn: str, namespace: str, token_hash: str) -> dict:
    with psycopg.connect(provisioner_dsn) as connection:
        with connection.transaction():
            with connection.cursor() as cursor:
                _identity(cursor, PROVISIONER_ROLE, "off")
                cursor.execute("SELECT phase4g6b_control.coordinate_fixture(NULL)")
                safe_start = cursor.fetchone()[0]
                cursor.execute(
                    "SELECT benchmark_admin.provision_phase4g_fixture("
                    "%s,%s,clock_timestamp()+interval '75 minutes')",
                    (namespace, token_hash),
                )
                receipt = cursor.fetchone()[0]
                progress_ids = [int(value) for value in receipt["progress_ids"]]
                if (
                    len(progress_ids) != 357
                    or len(set(progress_ids)) != 357
                    or min(progress_ids) != safe_start
                    or max(progress_ids) != safe_start + 356
                ):
                    raise RuntimeError("Provision receipt does not match the locked sequence interval")
                cursor.execute(
                    "SELECT phase4g6b_control.coordinate_fixture(%s)",
                    (safe_start,),
                )
                if cursor.fetchone()[0] != safe_start:
                    raise RuntimeError("Coordinator final assertion did not return the safe start")
                return receipt


def _post_verify(owner_dsn: str, baseline: dict[str, object], receipt: dict) -> dict[str, object]:
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            _identity(cursor, OWNER_ROLE, "on")
            counts = _table_counts(cursor)
            rewards = _reward_fingerprints(cursor)
            sequence = _safe_state(cursor)
            cursor.execute(
                "SELECT to_regnamespace(%s) IS NULL,to_regprocedure(%s) IS NULL",
                (CONTROL_SCHEMA, COORDINATOR),
            )
            control_schema_absent, coordinator_absent = cursor.fetchone()
        connection.rollback()
    expected_deltas = dict.fromkeys(TARGET_TABLES, 1)
    expected_deltas['"Learner".learner_progress_entries'] = 357
    deltas = {key: counts[key] - baseline["baseline_counts"][key] for key in TARGET_TABLES}
    if deltas != expected_deltas:
        raise RuntimeError("Application table deltas are not exactly 364 rows")
    if rewards != baseline["reward_fingerprints"]:
        raise RuntimeError("Historical Engagement fingerprints changed")
    progress_ids = [int(value) for value in receipt["progress_ids"]]
    if sequence["last_value"] != max(progress_ids):
        raise RuntimeError("Sequence state does not match the retained fixture")
    if not (control_schema_absent and coordinator_absent):
        raise RuntimeError("Temporary control objects were not removed")
    return {
        "table_deltas": deltas,
        "reward_fingerprints_unchanged": True,
        "sequence": sequence,
        "coordinator_removed": True,
    }


def _auth_verify() -> dict[str, object]:
    env = {
        key: value for key, value in os.environ.items()
        if key not in {
            "LMS_IDEAL_TEST", "DATABASE_URL", "DATABASEURL", "Database_url",
            "ENROLMENT_DATABASE_URL", "AUDIT_DATABASE_URL", "AUDIT_CLONE_DATABASE_URL",
            "LMS_BENCHMARK_READER_URL",
        }
    }
    completed = subprocess.run(
        [sys.executable, str(AUTH_VERIFIER)], cwd=Path(__file__).resolve().parents[1],
        env=env, check=True, capture_output=True, text=True, timeout=90,
    )
    return json.loads(completed.stdout)


def main() -> int:
    owner_dsn = _owner_dsn()
    reader_dsn = _validate_role_url(_credential_url(READER_CREDENTIAL), READER_ROLE)
    provisioner_dsn = _validate_role_url(
        _credential_url(PROVISIONER_CREDENTIAL), PROVISIONER_ROLE
    )
    preflight = _preflight(owner_dsn)
    reader_before = _reader_checks(reader_dsn, None)
    if not reader_before["column_select"]:
        _apply_reader_grant(owner_dsn)
    reader_after = _reader_checks(reader_dsn, True)

    namespace = "phase4g_" + str(uuid4())
    token = secrets.token_urlsafe(32)
    token_hash = sha256(token.encode("utf-8")).hexdigest()
    receipt = None
    _write_credential(
        SESSION_CREDENTIAL, namespace,
        json.dumps({"namespace": namespace, "token": token}),
        "LMS Phase 4G.6B synthetic Learner session token",
    )
    try:
        _install_coordinator(owner_dsn)
        try:
            receipt = _provision(provisioner_dsn, namespace, token_hash)
        finally:
            _drop_coordinator(owner_dsn)
    except Exception:
        if receipt is None:
            _delete_credential(SESSION_CREDENTIAL)
        raise

    handle = {
        key: receipt[key] for key in (
            "fixture_id", "receipt_id", "namespace", "enrolment_id",
            "learner_id", "account_id", "session_id",
        )
    }
    _write_credential(
        HANDLE_CREDENTIAL, namespace, json.dumps(handle, sort_keys=True, default=str),
        "LMS Phase 4G.6B receipt handle; full receipt remains in PostgreSQL",
    )
    fixture = _verify_fixture(owner_dsn, reader_dsn, receipt)
    cleanup = _cleanup_rehearsal(provisioner_dsn, reader_dsn, receipt)
    post = _post_verify(owner_dsn, preflight, receipt)
    auth = _auth_verify()
    result = {
        "status": "fixture-ready-and-verified",
        "target": {"branch_id": BRANCH_ID, "endpoint_id": ENDPOINT_ID, "database": DATABASE_NAME},
        "preflight": preflight,
        "reader_before": reader_before,
        "reader_after": reader_after,
        "fixture": {
            "application_rows": receipt["application_rows"],
            "control_rows": receipt["control_rows"],
            "progress_rows": len(receipt["progress_ids"]),
            "progress_start": min(int(x) for x in receipt["progress_ids"]),
            "progress_end": max(int(x) for x in receipt["progress_ids"]),
            "checks": fixture,
        },
        "cleanup_rehearsal": cleanup,
        "post_verify": post,
        "authentication": auth,
        "credential_targets": [SESSION_CREDENTIAL, HANDLE_CREDENTIAL],
        "raw_secrets_printed": False,
        "fixture_retained": True,
    }
    print(json.dumps(result, sort_keys=True, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
