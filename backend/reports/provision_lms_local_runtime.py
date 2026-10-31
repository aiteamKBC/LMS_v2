"""Provision the least-privilege local LMS runtime role on ``lms_ideal_test``.

This script is deliberately pinned to one Neon branch, endpoint, database and
owner role.  It never prints a password or connection string.  The generated
runtime URL is stored in Windows Credential Manager only after privilege
verification succeeds.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re
import secrets
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg import sql


BRANCH_ID = "br-orange-shadow-abm8uwwe"
ENDPOINT_ID = "ep-dawn-block-ab5vob3x"
DATABASE_NAME = "neondb"
OWNER_ROLE = "neondb_owner"
RUNTIME_ROLE = "lms_local_runtime"
CREDENTIAL_TARGET = "LMS_v2/local/lms_local_runtime"
DIRECT_HOST = f"{ENDPOINT_ID}.eu-west-2.aws.neon.tech"
POOLED_HOST = f"{ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"
READER_SQL_PATH = Path(__file__).with_name(
    "recreate_lms_benchmark_reader_after_reset_not_executed_2026-10-28.sql"
)
APPLICATION_SCHEMAS = (
    "login",
    "enrolment",
    "Learner",
    "curriculum",
    "Audit",
    "Last_audit",
    "fetching_evidence",
    "structured_manual_activities",
    "Coach",
    "Engagement",
)
ACCOUNT_UPDATE_COLUMNS = (
    "Failed_attempts",
    "Locked_until",
    "Last_login_at",
    "Last_login_ip",
    "Role",
    "Updated_at",
)
SESSION_UPDATE_COLUMNS = ("Expires_at", "Last_seen_at", "Revoked_at")
RUNTIME_EXTRA_READ_RELATIONS = (
    # Canonical identity guards added after the Phase 4G Reader manifest.
    '"Learner".progress_transfer_requests',
    # Home metrics exclude KSBs explicitly removed from programme standards.
    '"Learner".learner_progress_ksb_exclusions',
    # Learner Home/My Learning render saved live-session attendance outcomes.
    'curriculum.live_session_learner_attendance',
    # Recovery state is displayed beside the learner's absence history.
    '"Coach".coach_absence_report',
    # Reviewed Teams identity links are required by the learner attendance reader.
    'curriculum.live_session_attendance_aliases',
    'curriculum.live_session_attendance_identity_links',
    'curriculum.live_session_attendance_identity_rules',
    # Recovery and recording evidence feed completed live-session progress.
    'curriculum.live_session_absences',
    'curriculum.live_session_recording_views',
    'curriculum.live_session_artifacts',
    'curriculum.session_result_archive',
    # Staff attendance corrections and manual outcomes are learner-visible.
    '"Coach".coach_attendance_adjustment',
    '"Coach".coach_manual_attendance',
    # Learner workspace delivery mode controls recorded/live attendance display.
    '"Learner".attendance_preferences',
    # Dashboard overview reads completed monthly-signature state.
    '"Learner".learner_monthly_signatures',
    # Learner rewards summary is a read-only wallet/catalogue projection.
    '"Engagement".points_grants',
    '"Engagement".voucher_claims',
    '"Engagement".rewards',
)


class _Credential(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", wintypes.FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def _env_value(key: str) -> str:
    value = os.environ.get(key, "").strip()
    if value:
        return value
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        if raw.startswith(f"{key}="):
            return raw.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"{key} is unavailable")


def _owner_dsn() -> str:
    parsed = urlsplit(_env_value("LMS_IDEAL_TEST"))
    host = (parsed.hostname or "").casefold()
    if host not in {DIRECT_HOST, POOLED_HOST}:
        raise RuntimeError("LMS_IDEAL_TEST is not the pinned test endpoint")
    if parsed.path.lstrip("/") != DATABASE_NAME:
        raise RuntimeError("LMS_IDEAL_TEST is not the pinned test database")
    if parsed.username != OWNER_ROLE:
        raise RuntimeError("LMS_IDEAL_TEST is not the expected owner identity")
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.pop("options", None)
    query["sslmode"] = "require"
    netloc = parsed.netloc.replace(POOLED_HOST, DIRECT_HOST)
    return urlunsplit((parsed.scheme, netloc, parsed.path, urlencode(query), ""))


def _runtime_dsn(owner_dsn: str, password: str) -> str:
    parsed = urlsplit(owner_dsn)
    port = f":{parsed.port}" if parsed.port else ""
    netloc = (
        f"{quote(RUNTIME_ROLE, safe='')}:{quote(password, safe='')}@"
        f"{parsed.hostname}{port}"
    )
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["sslmode"] = "require"
    query.pop("options", None)
    return urlunsplit(
        (parsed.scheme, netloc, parsed.path, urlencode(query, quote_via=quote), "")
    )


def _write_generic_credential(secret: str) -> None:
    if os.name != "nt":
        raise RuntimeError("Windows Credential Manager is required")
    blob = secret.encode("utf-16-le")
    if len(blob) > 5 * 512:
        raise RuntimeError("Credential blob is unexpectedly large")
    buffer = ctypes.create_string_buffer(blob)
    credential = _Credential()
    credential.Type = 1
    credential.TargetName = CREDENTIAL_TARGET
    credential.Comment = "LMS local runtime DSN for lms_ideal_test"
    credential.CredentialBlobSize = len(blob)
    credential.CredentialBlob = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte))
    credential.Persist = 2
    credential.UserName = RUNTIME_ROLE
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(_Credential), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    if not advapi32.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def _manifest_relations() -> list[str]:
    reviewed_sql = READER_SQL_PATH.read_text(encoding="utf-8")
    blocks = re.findall(
        r"GRANT\s+SELECT\s+ON\s+(.*?)\s+TO\s+lms_benchmark_reader\s*;",
        reviewed_sql,
        flags=re.IGNORECASE | re.DOTALL,
    )
    relations = [item.strip() for block in blocks for item in block.split(",")]
    if len(relations) != 88 or len(set(relations)) != 88:
        raise RuntimeError("Reviewed Reader manifest is not the expected 88 relations")
    return relations


def _verify_owner(cursor) -> tuple[str, str]:
    cursor.execute(
        """SELECT current_database(), current_user,
                  current_setting('neon.branch_id', true),
                  current_setting('neon.endpoint_id', true),
                  current_setting('transaction_read_only'),
                  pg_get_serial_sequence('login."Login_sessions"', 'id'),
                  pg_get_serial_sequence('login."Login_audit"', 'id')"""
    )
    row = cursor.fetchone()
    if row[:5] != (DATABASE_NAME, OWNER_ROLE, BRANCH_ID, ENDPOINT_ID, "off"):
        raise RuntimeError("Owner connection failed the exact writable-target guard")
    cursor.execute("SELECT to_regrole(%s) IS NULL", (RUNTIME_ROLE,))
    if not cursor.fetchone()[0]:
        raise RuntimeError("Runtime role already exists; refusing a non-idempotent rerun")
    if not row[5] or not row[6]:
        raise RuntimeError("Required login sequence metadata is missing")
    return row[5], row[6]


def _grant_manifest(cursor, manifest: list[str]) -> None:
    for relation in manifest:
        cursor.execute(
            sql.SQL("GRANT SELECT ON {} TO {}").format(
                sql.SQL(relation), sql.Identifier(RUNTIME_ROLE)
            )
        )


def _create_role(
    cursor, password: str, manifest: list[str], sessions_sequence: str, audit_sequence: str
) -> None:
    cursor.execute(
        sql.SQL(
            "CREATE ROLE {} LOGIN PASSWORD {} NOSUPERUSER NOCREATEDB NOCREATEROLE "
            "NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10"
        ).format(sql.Identifier(RUNTIME_ROLE), sql.Literal(password))
    )
    for setting, value in (
        ("statement_timeout", "30s"),
        ("lock_timeout", "2s"),
        ("idle_in_transaction_session_timeout", "15s"),
        ("search_path", "pg_catalog"),
    ):
        cursor.execute(
            sql.SQL("ALTER ROLE {} SET {} = {}").format(
                sql.Identifier(RUNTIME_ROLE), sql.Identifier(setting), sql.Literal(value)
            )
        )
    cursor.execute(
        sql.SQL("REVOKE ALL ON DATABASE {} FROM {}").format(
            sql.Identifier(DATABASE_NAME), sql.Identifier(RUNTIME_ROLE)
        )
    )
    cursor.execute(
        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
            sql.Identifier(DATABASE_NAME), sql.Identifier(RUNTIME_ROLE)
        )
    )
    cursor.execute(
        sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(
            sql.SQL(", ").join(map(sql.Identifier, APPLICATION_SCHEMAS)),
            sql.Identifier(RUNTIME_ROLE),
        )
    )
    _grant_manifest(cursor, manifest)
    for relation in RUNTIME_EXTRA_READ_RELATIONS:
        cursor.execute(
            sql.SQL("GRANT SELECT ON {} TO {}").format(
                sql.SQL(relation), sql.Identifier(RUNTIME_ROLE)
            )
        )
    cursor.execute(
        sql.SQL('GRANT SELECT ON login."Login_audit" TO {}').format(
            sql.Identifier(RUNTIME_ROLE)
        )
    )
    cursor.execute(
        sql.SQL(
            'GRANT INSERT ON login."Login_sessions", login."Login_audit" TO {}'
        ).format(sql.Identifier(RUNTIME_ROLE))
    )
    cursor.execute(
        sql.SQL('GRANT UPDATE ({}) ON login."Login_accounts" TO {}').format(
            sql.SQL(", ").join(map(sql.Identifier, ACCOUNT_UPDATE_COLUMNS)),
            sql.Identifier(RUNTIME_ROLE),
        )
    )
    cursor.execute(
        sql.SQL('GRANT UPDATE ({}) ON login."Login_sessions" TO {}').format(
            sql.SQL(", ").join(map(sql.Identifier, SESSION_UPDATE_COLUMNS)),
            sql.Identifier(RUNTIME_ROLE),
        )
    )
    for sequence in (sessions_sequence, audit_sequence):
        cursor.execute(
            sql.SQL("GRANT USAGE, SELECT ON SEQUENCE {} TO {}").format(
                sql.SQL(sequence), sql.Identifier(RUNTIME_ROLE)
            )
        )


def _negative(runtime_dsn: str, statement: str) -> bool:
    try:
        with psycopg.connect(runtime_dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement)
            connection.rollback()
    except psycopg.Error:
        return True
    return False


def _verify_runtime(
    runtime_dsn: str, manifest: list[str], sessions_sequence: str, audit_sequence: str
) -> dict[str, object]:
    checks: dict[str, object] = {}
    with psycopg.connect(runtime_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user, current_database(),
                          current_setting('neon.branch_id', true),
                          current_setting('neon.endpoint_id', true),
                          current_setting('transaction_read_only')"""
            )
            checks["identity_exact"] = cursor.fetchone() == (
                RUNTIME_ROLE,
                DATABASE_NAME,
                BRANCH_ID,
                ENDPOINT_ID,
                "off",
            )
            cursor.execute(
                """SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                          AND NOT rolinherit AND NOT rolreplication
                          AND NOT rolbypassrls AND rolcanlogin AND rolconnlimit=10
                   FROM pg_roles WHERE rolname=current_user"""
            )
            checks["role_flags_exact"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_auth_members
                   WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)"""
            )
            checks["memberships_zero"] = bool(cursor.fetchone()[0])
            for relation in manifest:
                cursor.execute(sql.SQL("SELECT 1 FROM {} LIMIT 0").format(sql.SQL(relation)))
            for relation in RUNTIME_EXTRA_READ_RELATIONS:
                cursor.execute(sql.SQL("SELECT 1 FROM {} LIMIT 0").format(sql.SQL(relation)))
            cursor.execute('SELECT 1 FROM login."Login_audit" LIMIT 0')
            checks[f"approved_reads_{len(manifest) + len(RUNTIME_EXTRA_READ_RELATIONS)}"] = True
            cursor.execute(
                """SELECT
                    has_table_privilege(current_user, 'login."Login_sessions"', 'INSERT'),
                    has_table_privilege(current_user, 'login."Login_audit"', 'INSERT'),
                    NOT has_table_privilege(current_user, 'login."Login_accounts"', 'INSERT'),
                    NOT has_table_privilege(current_user, 'login."Login_sessions"', 'DELETE'),
                    NOT has_table_privilege(current_user, 'login."Login_audit"', 'DELETE')"""
            )
            checks["table_dml_exact"] = all(cursor.fetchone())
            for column in ACCOUNT_UPDATE_COLUMNS:
                cursor.execute(
                    "SELECT has_column_privilege(current_user, %s, %s, 'UPDATE')",
                    ('login."Login_accounts"', column),
                )
                if not cursor.fetchone()[0]:
                    raise RuntimeError(f"Missing approved account update column: {column}")
            for column in SESSION_UPDATE_COLUMNS:
                cursor.execute(
                    "SELECT has_column_privilege(current_user, %s, %s, 'UPDATE')",
                    ('login."Login_sessions"', column),
                )
                if not cursor.fetchone()[0]:
                    raise RuntimeError(f"Missing approved session update column: {column}")
            checks["approved_column_updates_exact"] = True
            cursor.execute(
                """SELECT
                    NOT has_column_privilege(current_user, 'login."Login_accounts"', 'Password_hash', 'UPDATE'),
                    NOT has_column_privilege(current_user, 'login."Login_accounts"', 'Is_active', 'UPDATE'),
                    NOT has_column_privilege(current_user, 'login."Login_sessions"', 'Token_hash', 'UPDATE')"""
            )
            checks["sensitive_column_updates_denied"] = all(cursor.fetchone())
            for sequence in (sessions_sequence, audit_sequence):
                cursor.execute(
                    "SELECT has_sequence_privilege(current_user, %s, 'USAGE')",
                    (sequence,),
                )
                if not cursor.fetchone()[0]:
                    raise RuntimeError("Required login sequence usage is missing")
            checks["login_sequences_exact"] = True
            cursor.execute(
                """SELECT NOT (
                    has_table_privilege(current_user, 'enrolment."Created_users"', 'INSERT') OR
                    has_table_privilege(current_user, 'enrolment."Created_users"', 'UPDATE') OR
                    has_table_privilege(current_user, 'enrolment."Created_users"', 'DELETE') OR
                    has_table_privilege(current_user, 'curriculum.programmes', 'INSERT') OR
                    has_table_privilege(current_user, 'curriculum.programmes', 'UPDATE') OR
                    has_table_privilege(current_user, 'curriculum.programmes', 'DELETE'))"""
            )
            checks["learner_and_curriculum_dml_denied"] = bool(cursor.fetchone()[0])
            cursor.execute(
                "SELECT NOT has_database_privilege(current_user,current_database(),'TEMP')"
            )
            checks["temporary_denied"] = bool(cursor.fetchone()[0])

    checks["created_users_update_denied"] = _negative(
        runtime_dsn,
        'UPDATE enrolment."Created_users" SET "Email"="Email" WHERE false',
    )
    checks["curriculum_insert_denied"] = _negative(
        runtime_dsn,
        "INSERT INTO curriculum.programmes SELECT * FROM curriculum.programmes WHERE false",
    )
    checks["create_table_denied"] = _negative(
        runtime_dsn, "CREATE TABLE lms_local_runtime_must_not_create(id integer)"
    )
    checks["create_role_denied"] = _negative(
        runtime_dsn, "CREATE ROLE lms_local_runtime_must_not_create_role"
    )
    checks["set_owner_role_denied"] = _negative(runtime_dsn, "SET ROLE neondb_owner")
    if not all(checks.values()):
        raise RuntimeError("Runtime-role verification failed: " + json.dumps(checks))
    return checks


def main() -> int:
    manifest = _manifest_relations()
    owner_dsn = _owner_dsn()
    password = secrets.token_urlsafe(48)
    runtime_dsn = _runtime_dsn(owner_dsn, password)
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            sessions_sequence, audit_sequence = _verify_owner(cursor)
        connection.rollback()
        with connection.transaction():
            with connection.cursor() as cursor:
                _create_role(
                    cursor, password, manifest, sessions_sequence, audit_sequence
                )

    checks = _verify_runtime(
        runtime_dsn, manifest, sessions_sequence, audit_sequence
    )
    _write_generic_credential(runtime_dsn)
    print(
        json.dumps(
            {
                "status": "provisioned-and-verified",
                "branch_id": BRANCH_ID,
                "endpoint_id": ENDPOINT_ID,
                "database": DATABASE_NAME,
                "runtime_role": RUNTIME_ROLE,
                "read_relations": len(manifest) + len(RUNTIME_EXTRA_READ_RELATIONS),
                "credential_target": CREDENTIAL_TARGET,
                "credential_rotated": True,
                "checks": checks,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
