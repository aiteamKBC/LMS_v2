"""Fail-closed bootstrap for a disposable localhost PostgreSQL benchmark."""
from __future__ import annotations

import os
import re
from urllib.parse import parse_qsl, urlsplit

from django.core.exceptions import ImproperlyConfigured


DATABASE_PREFIX = "lms_learner_benchmark_local_"
LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}
REMOTE_DATABASE_KEYS = (
    "LMS_IDEAL_TEST", "LMS_BENCHMARK_READER_URL", "security_Database_url",
    "AUDIT_DATABASE_URL", "AUDIT_CLONE_DATABASE_URL", "LASR-ADUTIOD-CLNE",
    "KBC_ATTENDANCE_DATABASE_URL", "ASSISTANT_CONVERSATIONS_DATABASE_URL",
    "TICKETING_DATABASE_URL", "COACHING_SESSIONS_DATABASE_URL",
    "SAFEGUARDING_DATABASE_URL", "SafeGuarding_database_url",
    "ASSESSMENT_FETCH_DATABASE_URL", "LEARNER_AUTH_DB_HOST",
    "LEARNER_AUTH_DB_NAME", "LEARNER_AUTH_DB_USER",
    "LEARNER_AUTH_DB_PASSWORD", "LEARNER_AUTH_READS_ENABLED",
)
EXTERNAL_SECRET_KEYS = (
    "OPENAI_API_KEY", "KBC_LMS_API_KEY", "AZURE_STORAGE_ACCOUNT",
    "AZURE_STORAGE_KEY", "AZURE_MATERIALS_STORAGE_ACCOUNT",
    "AZURE_MATERIALS_STORAGE_KEY", "DEFENDER_STORAGE_ACCOUNT",
    "DEFENDER_APPROVED_STORAGE_ACCOUNT", "DEFENDER_QUARANTINE_STORAGE_SAS",
    "DEFENDER_APPROVED_STORAGE_SAS", "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT",
    "MICROSOFT_TENANT_ID", "MICROSOFT_CALLBACK_URI",
    "MICROSOFT_GRAPH_CLIENT_ID", "MICROSOFT_GRAPH_CLIENT_SECRET",
    "MICROSOFT_GRAPH_TENANT_ID",
)
BACKGROUND_FLAGS = (
    "SESSION_RESULTS_AUTOMATIC", "COACH_DASHBOARD_SNAPSHOT_SCHEDULE",
    "COACH_DASHBOARD_BACKGROUND_REFRESH_ENABLED", "CATCHUP_REMINDERS_ENABLED",
    "COACH_RECORDINGS_AUTOMATIC", "ENGLAND_HOLIDAY_AUTO_SYNC",
    "CURRICULUM_WARM", "READ_MODEL_OUTBOX_ENABLED",
    "READ_MODEL_DUAL_WRITE_ENABLED", "CHAT_DEMO_BOOTSTRAP_ENABLED",
    "KBC_MOBILE_API_ENABLED", "KBC_MOBILE_COMMS_ENABLED",
    "KBC_MOBILE_PUSH_ENABLED", "KBC_MOBILE_CALENDAR_WRITES_ENABLED",
    "DEFENDER_STORAGE_INTEGRATION_ENABLED",
)


def validate_local_benchmark_url(value: str) -> str:
    parsed = urlsplit((value or "").strip())
    host = (parsed.hostname or "").casefold().rstrip(".")
    database = parsed.path.lstrip("/")
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ImproperlyConfigured("Local benchmark requires a PostgreSQL URL.")
    if host not in LOOPBACK_HOSTS:
        raise ImproperlyConfigured(
            "Local benchmark PostgreSQL must use an explicit loopback host."
        )
    if not re.fullmatch(r"lms_learner_benchmark_local_[a-z0-9_]+", database):
        raise ImproperlyConfigured(
            "Local benchmark database must have a unique lms_learner_benchmark_local_ prefix."
        )
    if not parsed.username or not parsed.password:
        raise ImproperlyConfigured(
            "Local benchmark requires a dedicated local username and password."
        )
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    unexpected = set(query) - {"connect_timeout", "sslmode", "application_name"}
    if unexpected:
        raise ImproperlyConfigured(
            "Local benchmark URL contains unsupported connection options."
        )
    if parsed.fragment:
        raise ImproperlyConfigured("Local benchmark URL must not contain a fragment.")
    return value.strip()


def bootstrap_local_benchmark_environment(environ=None) -> str:
    """Sanitise the process and install isolation before Django initialises."""
    environ = os.environ if environ is None else environ
    database_url = validate_local_benchmark_url(
        environ.get("LMS_LOCAL_BENCHMARK_DATABASE_URL", "")
    )
    for key in REMOTE_DATABASE_KEYS:
        environ[key] = ""
    for key in EXTERNAL_SECRET_KEYS:
        environ[key] = ""
    for key in BACKGROUND_FLAGS:
        environ[key] = "0"
    for key in (
        "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "PGHOST", "PGHOSTADDR",
        "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGOPTIONS",
    ):
        environ[key] = ""
    environ.update({
        "DATABASE_URL": database_url,
        "DATABASEURL": database_url,
        "Database_url": database_url,
        "ENROLMENT_DATABASE_URL": database_url,
        "LMS_TEST_ACTIVE": "true",
        "LMS_TEST_MODE": "local-benchmark",
        "LMS_LOCAL_BENCHMARK": "true",
        "AZURE_MAIL_ENABLED": "false",
        "CACHE_URL": "",
        "REDIS_URL": "",
        "CHAT_REDIS_URL": "",
        "API_REQUIRE_AUTH": "1",
        "LEARNER_API_REQUIRE_AUTH": "1",
    })
    from .test_isolation import LOCAL_BENCHMARK_MODE, install_test_isolation
    policy = install_test_isolation(environ)
    if policy.mode != LOCAL_BENCHMARK_MODE:
        raise ImproperlyConfigured(
            "Local benchmark isolation cannot replace an already installed policy."
        )
    return database_url


def assert_local_benchmark_databases(databases, database_url: str) -> None:
    parsed = urlsplit(database_url)
    expected_name = parsed.path.lstrip("/")
    expected_host = (parsed.hostname or "").casefold()
    if set(databases) != {"default", "enrolment"}:
        raise ImproperlyConfigured(
            "Local benchmark must configure exactly default and enrolment aliases."
        )
    for alias, config in databases.items():
        if not str(config.get("ENGINE", "")).endswith("postgresql"):
            raise ImproperlyConfigured(f"Local benchmark alias {alias} is not PostgreSQL.")
        if (str(config.get("HOST") or "").casefold(), str(config.get("NAME") or "")) != (
            expected_host, expected_name,
        ):
            raise ImproperlyConfigured(
                f"Local benchmark alias {alias} does not use the disposable database."
            )
