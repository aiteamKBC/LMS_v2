"""Start local Django with the scoped runtime role for ``lms_ideal_test``.

The DSN is read from Windows Credential Manager, verified against the exact
Neon branch/endpoint/database/role, and injected only into this process.  The
project ``.env`` is not edited and unrelated database aliases are suppressed.
"""
from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

import psycopg


BRANCH_ID = "br-orange-shadow-abm8uwwe"
ENDPOINT_ID = "ep-dawn-block-ab5vob3x"
DATABASE_NAME = "neondb"
RUNTIME_ROLE = "lms_local_runtime"
CREDENTIAL_TARGET = "LMS_v2/local/lms_local_runtime"
DIRECT_HOST = f"{ENDPOINT_ID}.eu-west-2.aws.neon.tech"
POOLED_HOST = f"{ENDPOINT_ID}-pooler.eu-west-2.aws.neon.tech"


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


def _read_runtime_url() -> str:
    if os.name != "nt":
        raise RuntimeError("Windows Credential Manager is required")
    advapi32 = ctypes.WinDLL("Advapi32.dll", use_last_error=True)
    pointer = ctypes.POINTER(_Credential)()
    advapi32.CredReadW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(_Credential)),
    ]
    advapi32.CredReadW.restype = wintypes.BOOL
    advapi32.CredFree.argtypes = [ctypes.c_void_p]
    if not advapi32.CredReadW(CREDENTIAL_TARGET, 1, 0, ctypes.byref(pointer)):
        raise RuntimeError("The local runtime credential is unavailable")
    try:
        credential = pointer.contents
        blob = ctypes.string_at(
            credential.CredentialBlob, credential.CredentialBlobSize
        )
        value = blob.decode("utf-16-le").strip()
        if not value:
            raise RuntimeError("The local runtime credential is empty")
        return value
    finally:
        advapi32.CredFree(pointer)


def _validate_url(runtime_url: str) -> None:
    parsed = urlsplit(runtime_url)
    if parsed.username != RUNTIME_ROLE:
        raise RuntimeError("Credential role is not lms_local_runtime")
    if (parsed.hostname or "").casefold() not in {DIRECT_HOST, POOLED_HOST}:
        raise RuntimeError("Credential endpoint is not lms_ideal_test")
    if parsed.path.lstrip("/") != DATABASE_NAME:
        raise RuntimeError("Credential database is not neondb")


def _verify_connection(runtime_url: str) -> dict[str, object]:
    with psycopg.connect(runtime_url, connect_timeout=15) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT current_user, current_database(),
                          current_setting('neon.branch_id', true),
                          current_setting('neon.endpoint_id', true),
                          current_setting('transaction_read_only'),
                          has_table_privilege(current_user, 'login."Login_sessions"', 'INSERT'),
                          has_table_privilege(current_user, 'login."Login_audit"', 'INSERT'),
                          has_column_privilege(current_user, 'login."Login_accounts"', 'Last_login_at', 'UPDATE'),
                          NOT has_table_privilege(current_user, 'enrolment."Created_users"', 'UPDATE')"""
            )
            row = cursor.fetchone()
    expected = (RUNTIME_ROLE, DATABASE_NAME, BRANCH_ID, ENDPOINT_ID, "off")
    if row[:5] != expected or not all(row[5:]):
        raise RuntimeError("Runtime connection failed its identity/privilege guard")
    return {
        "role": row[0],
        "database": row[1],
        "branch_id": row[2],
        "endpoint_id": row[3],
        "auth_writes": "scoped",
        "learner_writes": "denied",
    }


def _configure_process(runtime_url: str) -> None:
    # Set process values before importing Django.  load_env_file uses setdefault,
    # so these values cannot be replaced by the legacy branch URLs in .env.
    for key in ("DATABASE_URL", "DATABASEURL", "Database_url", "ENROLMENT_DATABASE_URL"):
        os.environ[key] = runtime_url
    os.environ["security_Database_url"] = ""
    os.environ["LMS_IDEAL_TEST"] = ""
    os.environ["LMS_BENCHMARK_READER_URL"] = ""
    os.environ["RUN_APP_ON_TEST_BRANCH"] = ""
    os.environ["LMS_TEST_ACTIVE"] = ""
    os.environ["LMS_TEST_MODE"] = ""

    for key in (
        "AUDIT_DATABASE_URL",
        "AUDIT_CLONE_DATABASE_URL",
        "LASR-ADUTIOD-CLNE",
        "KBC_ATTENDANCE_DATABASE_URL",
        "ASSISTANT_CONVERSATIONS_DATABASE_URL",
        "TICKETING_DATABASE_URL",
        "COACHING_SESSIONS_DATABASE_URL",
        "SAFEGUARDING_DATABASE_URL",
        "SafeGuarding_database_url",
        "ASSESSMENT_FETCH_DATABASE_URL",
        "LEARNER_AUTH_DB_HOST",
        "LEARNER_AUTH_DB_NAME",
        "LEARNER_AUTH_DB_USER",
        "LEARNER_AUTH_DB_PASSWORD",
    ):
        os.environ[key] = ""

    for key in (
        "MICROSOFT_CLIENT_ID",
        "MICROSOFT_CLIENT_SECRET",
        "MICROSOFT_TENANT",
        "MICROSOFT_TENANT_ID",
        "MICROSOFT_GRAPH_CLIENT_ID",
        "MICROSOFT_GRAPH_CLIENT_SECRET",
        "MICROSOFT_GRAPH_TENANT_ID",
        "AZURE_STORAGE_KEY",
        "AZURE_MAIL_SEND_ENABLED",
        "KBC_LMS_API_KEY",
        "OPENAI_API_KEY",
        "REDIS_URL",
        "CACHE_URL",
    ):
        os.environ[key] = ""

    os.environ.update(
        {
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "DJANGO_DEBUG": "true",
            "DB_POOL": "true",
            "DB_POOL_MAX_SIZE": "4",
            "DB_POOL_MIN_SIZE": "2",
            "DB_CONN_MAX_AGE": "0",
            "DB_CONNECT_TIMEOUT": "15",
            "DB_STATEMENT_TIMEOUT_MS": "30000",
            "CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP": "false",
            "READ_MODEL_OUTBOX_ENABLED": "false",
            "READ_MODEL_DUAL_WRITE_ENABLED": "false",
            "COACH_DASHBOARD_SHARED_READ_MODEL_ENABLED": "false",
            "LEARNER_HOME_SHARED_READ_MODEL_ENABLED": "false",
            "KBC_MOBILE_API_ENABLED": "false",
            "KBC_MOBILE_COMMS_ENABLED": "false",
            "KBC_MOBILE_PUSH_ENABLED": "false",
            "KBC_MOBILE_CALENDAR_WRITES_ENABLED": "false",
            "SESSION_RESULTS_AUTOMATIC": "0",
            "COACH_DASHBOARD_SNAPSHOT_SCHEDULE": "0",
            "CATCHUP_REMINDERS_ENABLED": "0",
            "COACH_RECORDINGS_AUTOMATIC": "0",
            "ENGLAND_HOLIDAY_AUTO_SYNC": "0",
            "CURRICULUM_WARM": "0",
        }
    )


def _verify_django_aliases() -> None:
    import django

    django.setup()
    from django.conf import settings
    from django.db import connections

    if set(settings.DATABASES) != {"default", "enrolment"}:
        raise RuntimeError(
            "Unexpected Django database aliases: "
            + ", ".join(sorted(settings.DATABASES))
        )
    for alias in ("default", "enrolment"):
        config = settings.DATABASES[alias]
        if config.get("USER") != RUNTIME_ROLE:
            raise RuntimeError(f"{alias} does not use the scoped runtime role")
        if str(config.get("HOST") or "").casefold() not in {DIRECT_HOST, POOLED_HOST}:
            raise RuntimeError(f"{alias} does not use the pinned endpoint")
        if config.get("NAME") != DATABASE_NAME:
            raise RuntimeError(f"{alias} does not use neondb")
        with connections[alias].cursor() as cursor:
            cursor.execute(
                """SELECT current_user, current_database(),
                          current_setting('neon.branch_id', true),
                          current_setting('neon.endpoint_id', true)"""
            )
            if cursor.fetchone() != (
                RUNTIME_ROLE,
                DATABASE_NAME,
                BRANCH_ID,
                ENDPOINT_ID,
            ):
                raise RuntimeError(f"{alias} runtime identity verification failed")
        connections[alias].close()


def main() -> int:
    runtime_url = _read_runtime_url()
    _validate_url(runtime_url)
    identity = _verify_connection(runtime_url)
    _configure_process(runtime_url)
    backend_dir = Path(__file__).resolve().parent
    os.chdir(backend_dir)
    sys.argv = [str(backend_dir / "manage.py"), "runserver", "127.0.0.1:8000", "--noreload"]
    _verify_django_aliases()
    print(json.dumps({"status": "runtime-verified", **identity}, sort_keys=True))
    print("Starting Django at http://127.0.0.1:8000 (stop with Ctrl+C).")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
