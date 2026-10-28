"""Restore and verify the Phase 4G.5 benchmark Reader on the pinned test branch.

The password is generated in memory and the resulting Reader URL is written to
Windows Credential Manager only after all privilege checks pass.  This helper
never prints a password, URL, or owner credential.
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
READER_ROLE = "lms_benchmark_reader"
CREDENTIAL_TARGET = "LMS_v2/phase4g2/lms_benchmark_reader"
DIRECT_HOST = f"{ENDPOINT_ID}.eu-west-2.aws.neon.tech"
POOLED_HOST = f"{ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"
SQL_PATH = Path(__file__).with_name(
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


def _reader_dsn(owner_dsn: str, password: str) -> str:
    parsed = urlsplit(owner_dsn)
    port = f":{parsed.port}" if parsed.port else ""
    netloc = (
        f"{quote(READER_ROLE, safe='')}:{quote(password, safe='')}@"
        f"{parsed.hostname}{port}"
    )
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query["sslmode"] = "require"
    query["options"] = "-c default_transaction_read_only=on"
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
    credential.Comment = "LMS Phase 4G.5 benchmark Reader DSN"
    credential.CredentialBlobSize = len(blob)
    credential.CredentialBlob = ctypes.cast(
        buffer, ctypes.POINTER(ctypes.c_ubyte)
    )
    credential.Persist = 2
    credential.UserName = READER_ROLE
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    advapi32.CredWriteW.argtypes = [ctypes.POINTER(_Credential), wintypes.DWORD]
    advapi32.CredWriteW.restype = wintypes.BOOL
    if not advapi32.CredWriteW(ctypes.byref(credential), 0):
        raise ctypes.WinError(ctypes.get_last_error())


def _manifest_relations(script: str) -> list[str]:
    blocks = re.findall(
        r"GRANT\s+SELECT\s+ON\s+(.*?)\s+TO\s+lms_benchmark_reader\s*;",
        script,
        flags=re.IGNORECASE | re.DOTALL,
    )
    relations = [item.strip() for block in blocks for item in block.split(",")]
    if len(relations) != 88 or len(set(relations)) != 88:
        raise RuntimeError("Reviewed Reader manifest is not the expected 88 relations")
    return relations


def _verify_owner(cursor) -> None:
    cursor.execute(
        """SELECT current_database(), current_user,
                  current_setting('neon.branch_id', true),
                  current_setting('neon.endpoint_id', true),
                  current_setting('transaction_read_only')"""
    )
    if cursor.fetchone() != (
        DATABASE_NAME,
        OWNER_ROLE,
        BRANCH_ID,
        ENDPOINT_ID,
        "off",
    ):
        raise RuntimeError("Owner connection failed the exact writable-target guard")
    cursor.execute("SELECT to_regrole(%s) IS NULL", (READER_ROLE,))
    if not cursor.fetchone()[0]:
        raise RuntimeError("Reader already exists; refusing a non-idempotent rerun")


def _negative(reader_dsn: str, statement: str) -> bool:
    try:
        with psycopg.connect(reader_dsn) as connection:
            with connection.cursor() as cursor:
                cursor.execute(statement)
            connection.rollback()
    except psycopg.Error:
        return True
    return False


def _verify_reader(reader_dsn: str, manifest: list[str]) -> dict[str, object]:
    checks: dict[str, object] = {}
    schema_placeholders = ",".join(["%s"] * len(APPLICATION_SCHEMAS))
    with psycopg.connect(reader_dsn) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user,current_database(),
                          current_setting('neon.branch_id',true),
                          current_setting('neon.endpoint_id',true),
                          current_setting('transaction_read_only')"""
            )
            checks["identity_exact"] = cursor.fetchone() == (
                READER_ROLE,
                DATABASE_NAME,
                BRANCH_ID,
                ENDPOINT_ID,
                "on",
            )
            cursor.execute(
                """SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
                          AND NOT rolinherit AND NOT rolreplication
                          AND NOT rolbypassrls AND rolcanlogin AND rolconnlimit=4
                   FROM pg_roles WHERE rolname=current_user"""
            )
            checks["role_flags_exact"] = bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT count(*)=0 FROM pg_auth_members
                   WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)"""
            )
            checks["memberships_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                f"""SELECT count(*)=0 FROM pg_class c
                    JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname IN ({schema_placeholders})
                      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)""",
                APPLICATION_SCHEMAS,
            )
            checks["ownership_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                f"""SELECT count(*)=0 FROM pg_class c
                    JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname IN ({schema_placeholders})
                      AND c.relkind IN ('r','p','v','m','f')
                      AND (has_table_privilege(current_user,c.oid,'INSERT')
                        OR has_table_privilege(current_user,c.oid,'UPDATE')
                        OR has_table_privilege(current_user,c.oid,'DELETE')
                        OR has_table_privilege(current_user,c.oid,'TRUNCATE'))""",
                APPLICATION_SCHEMAS,
            )
            checks["application_dml_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                f"""SELECT count(*)=0 FROM pg_class c
                    JOIN pg_namespace n ON n.oid=c.relnamespace
                    WHERE n.nspname IN ({schema_placeholders}) AND c.relkind='S'
                      AND (has_sequence_privilege(current_user,c.oid,'USAGE')
                        OR has_sequence_privilege(current_user,c.oid,'SELECT')
                        OR has_sequence_privilege(current_user,c.oid,'UPDATE'))""",
                APPLICATION_SCHEMAS,
            )
            checks["sequence_privileges_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                f"""SELECT count(*)=0 FROM pg_namespace
                    WHERE nspname IN ({schema_placeholders})
                      AND has_schema_privilege(current_user,oid,'CREATE')""",
                APPLICATION_SCHEMAS,
            )
            checks["schema_create_zero"] = bool(cursor.fetchone()[0])
            cursor.execute(
                "SELECT has_database_privilege(current_user,current_database(),'TEMP')"
            )
            checks["temporary_denied"] = not bool(cursor.fetchone()[0])
            cursor.execute(
                """SELECT has_function_privilege(
                         current_user,
                         '"Coach".refresh_learner_absence_counts(integer,text)',
                         'EXECUTE')"""
            )
            checks["unsafe_function_execute_denied"] = not bool(cursor.fetchone()[0])
            for relation in manifest:
                cursor.execute(sql.SQL("SELECT 1 FROM {} LIMIT 0").format(sql.SQL(relation)))
            checks["manifest_select_88"] = True

    checks["insert_denied"] = _negative(
        reader_dsn,
        "INSERT INTO curriculum.programmes SELECT * FROM curriculum.programmes WHERE false",
    )
    checks["update_denied"] = _negative(
        reader_dsn,
        "UPDATE curriculum.programmes SET programme_id=programme_id WHERE false",
    )
    checks["delete_denied"] = _negative(
        reader_dsn, "DELETE FROM curriculum.programmes WHERE false"
    )
    checks["create_denied"] = _negative(
        reader_dsn, "CREATE TABLE phase4g5_reader_must_not_create(id integer)"
    )
    checks["temp_create_denied"] = _negative(
        reader_dsn, "CREATE TEMP TABLE phase4g5_reader_temp(id integer)"
    )
    checks["create_role_denied"] = _negative(
        reader_dsn, "CREATE ROLE phase4g5_reader_must_not_create_role"
    )
    checks["set_role_denied"] = _negative(reader_dsn, "SET ROLE neondb_owner")
    if not all(checks.values()):
        raise RuntimeError("Reader verification failed: " + json.dumps(checks))
    return checks


def main() -> int:
    reviewed_sql = SQL_PATH.read_text(encoding="utf-8")
    manifest = _manifest_relations(reviewed_sql)
    if reviewed_sql.count(":'reader_password'") != 1:
        raise RuntimeError("Reviewed SQL password placeholder is unexpected")

    owner_dsn = _owner_dsn()
    password = secrets.token_urlsafe(48)
    reader_dsn = _reader_dsn(owner_dsn, password)
    with psycopg.connect(owner_dsn) as connection:
        with connection.cursor() as cursor:
            _verify_owner(cursor)
            password_literal = sql.Literal(password).as_string(connection)
            rendered_sql = reviewed_sql.replace(":'reader_password'", password_literal)
            rendered_sql = re.sub(
                r"(?mi)^\s*(BEGIN|COMMIT)\s*;\s*$", "", rendered_sql
            )
        connection.rollback()
        with connection.transaction():
            with connection.cursor() as cursor:
                cursor.execute(rendered_sql, prepare=False)

    checks = _verify_reader(reader_dsn, manifest)
    _write_generic_credential(reader_dsn)
    print(
        json.dumps(
            {
                "status": "restored-and-verified",
                "branch_id": BRANCH_ID,
                "endpoint_id": ENDPOINT_ID,
                "database": DATABASE_NAME,
                "reader_role": READER_ROLE,
                "manifest_relations": len(manifest),
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
